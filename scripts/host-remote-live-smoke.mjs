import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import path from "node:path";

const sshHost = process.env.POLYMUX_REMOTE_SMOKE_SSH?.trim();
const remoteNode = process.env.POLYMUX_REMOTE_SMOKE_NODE?.trim() || "node";
const relayOrigin = process.env.POLYMUX_CONNECT_SMOKE_RELAY?.trim()
  || "https://connect.polymux.com";

if (!sshHost)
  throw new Error("POLYMUX_REMOTE_SMOKE_SSH must name an SSH Host, for example aorus");
if (!/^[a-zA-Z0-9._@:-]+$/.test(sshHost))
  throw new Error("POLYMUX_REMOTE_SMOKE_SSH contains unsupported characters");
if (!/^[a-zA-Z0-9_./-]+$/.test(remoteNode))
  throw new Error("POLYMUX_REMOTE_SMOKE_NODE must be a command or absolute path without spaces");

const relayUrl = new URL(relayOrigin);
const loopback = relayUrl.hostname === "127.0.0.1" || relayUrl.hostname === "localhost" || relayUrl.hostname === "[::1]";
if (relayUrl.protocol !== "https:" && !(loopback && relayUrl.protocol === "http:"))
  throw new Error("The remote Host smoke test requires HTTPS or a loopback HTTP relay");

const cliEntry = path.resolve("apps/cli/dist/polymux.mjs");
const runToken = randomUUID().replaceAll("-", "");
const remoteRoot = `/tmp/polymux-remote-host-smoke-${runToken}`;
const remoteHome = `${remoteRoot}/home`;
const remoteCli = `${remoteRoot}/polymux.mjs`;
const stdoutPath = `${remoteRoot}/host.stdout`;
const stderrPath = `${remoteRoot}/host.stderr`;
const pidPath = `${remoteRoot}/host.pid`;
let provider = null;
let memberId = null;
let hostRunning = false;
let pairedSecret = null;

try {
  const health = await requestJson(`${relayUrl.origin}/healthz`);
  assert.deepEqual(health, {ok: true, service: "polymux-connect", protocol: 1});
  const discovery = await requestJson(`${relayUrl.origin}/connect-config`);
  assert.equal(discovery.version, 1);
  const webSocketOrigin = new URL(discovery.webSocketOrigin);
  assert.ok(webSocketOrigin.protocol === "https:" || loopback && webSocketOrigin.protocol === "http:");

  await remote(`umask 077; mkdir -p ${quote(remoteRoot)}`);
  await command("scp", [
    "-q", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--",
    cliEntry, `${sshHost}:${remoteCli}`,
  ]);
  const port = await remotePort();

  const first = await startRemoteHost(port, true);
  hostRunning = true;
  assert.match(first.endpoint, new RegExp(`^${escapeRegExp(relayUrl.origin)}/h/`));
  assert.match(first.pairingCode, /^\d{9}$/);

  const unauthorised = await fetch(`${first.endpoint}/polymux-host/v1/rpc`, {
    method: "POST",
    headers: {"content-type": "application/json", origin: "tauri://localhost"},
    body: JSON.stringify({method: "team.list", args: []}),
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(unauthorised.status, 401);

  const pending = await requestJsonEventually(`${relayUrl.origin}/connect`, {
    method: "POST",
    headers: {"content-type": "application/json", origin: "tauri://localhost"},
    body: JSON.stringify({
      code: first.pairingCode,
      desktopId: `polymux-remote-live-smoke-${runToken}`,
      deviceName: "Polymux remote Host live smoke",
    }),
  });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.secret, undefined);
  await remote(`env ${quote(`POLYMUX_HOME=${remoteHome}`)} ${quote(remoteNode)} ${quote(remoteCli)} devices approve ${quote(pending.id)} ${quote(pending.number)}`);
  const approved = await requestJson(`${first.endpoint}/polymux-host/v1/pair/status`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: pending.id, token: pending.token})});
  const paired = approved.credentials;
  assert.equal(typeof paired.secret, "string");
  assert.ok(paired.secret.length >= 32);
  pairedSecret = paired.secret;

  const profiles = await rpc(first.endpoint, pairedSecret, "team.profiles");
  assert.ok(Array.isArray(profiles) && profiles.length > 0);
  const profile = profiles.find((candidate) => candidate?.isDefault) ?? profiles[0];
  assert.equal(typeof profile.id, "string");

  const member = await rpc(first.endpoint, pairedSecret, "team.create", [{
    name: "Remote smoke agent",
    role: "Remote Host verifier",
    profileId: profile.id,
    avatar: {shape: "pebble", color: "#3b93f0"},
    automaticCommunication: true,
    laptopAccess: "off",
  }]);
  assert.equal(member.name, "Remote smoke agent");
  memberId = member.id;

  const started = await rpc(first.endpoint, pairedSecret, "team.startComputer", [memberId]);
  const computer = started.computer;
  provider = computer?.provider === "podman" || computer?.provider === "docker"
    ? computer.provider
    : null;
  assert.equal(computer?.state, "running", computer?.detail ?? "remote Team computer did not start");
  assert.ok(provider, "remote Team computer did not report Docker or Podman");
  const container = containerName(memberId);
  const volume = `${container}-workspace`;
  const inspected = JSON.parse(await remote(`${quote(provider)} inspect ${quote(container)}`))[0];
  assert.equal(inspected.HostConfig.NetworkMode, "none");
  assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
  assert.ok(inspected.HostConfig.CapDrop?.includes("ALL"));
  assert.ok(inspected.HostConfig.SecurityOpt?.some((value) => value.includes("no-new-privileges")));
  assert.equal(inspected.HostConfig.PidsLimit, 512);
  assert.equal(inspected.HostConfig.Memory, 2 * 1024 * 1024 * 1024);
  assert.equal(inspected.HostConfig.NanoCpus, 2_000_000_000);
  assert.equal(inspected.Config.Labels?.["app.polymux.bot"], "true");
  assert.ok(inspected.Mounts?.some((mount) => mount.Name === volume && mount.Destination === "/workspace"));

  const workspaceMarker = `remote-workspace-${runToken}`;
  await remote(`${quote(provider)} exec ${quote(container)} sh -lc ${quote(`printf '%s' ${quote(workspaceMarker)} > /workspace/remote-smoke.txt`)}`);
  await rpc(first.endpoint, pairedSecret, "team.stopComputer", [memberId]);

  await stopRemoteHost();
  hostRunning = false;
  const restarted = await startRemoteHost(port, false);
  hostRunning = true;
  assert.equal(restarted.endpoint, first.endpoint);

  const persisted = await rpc(restarted.endpoint, pairedSecret, "team.list");
  assert.ok(persisted.some((candidate) => candidate.id === memberId && candidate.name === member.name));
  const restartedMember = await rpc(restarted.endpoint, pairedSecret, "team.startComputer", [memberId]);
  assert.equal(
    restartedMember.computer?.state,
    "running",
    restartedMember.computer?.detail ?? "remote Team computer did not restart",
  );
  const restoredMarker = await remote(`${quote(provider)} exec ${quote(container)} cat /workspace/remote-smoke.txt`);
  assert.equal(restoredMarker.trim(), workspaceMarker);

  assert.equal(await rpc(restarted.endpoint, pairedSecret, "team.remove", [memberId]), true);
  memberId = null;
  const removed = await remote(`${quote(provider)} inspect ${quote(container)}`, {allowFailure: true});
  assert.notEqual(removed.code, 0);
  const removedVolume = await remote(`${quote(provider)} volume inspect ${quote(volume)}`, {allowFailure: true});
  assert.notEqual(removedVolume.code, 0);

  console.log(JSON.stringify({
    ok: true,
    sshHost,
    endpoint: first.endpoint,
    provider,
    checks: [
      "relay health and discovery",
      "remote outbound Host registration",
      "cross-machine pairing",
      "unauthorised RPC rejection",
      "authenticated Team RPC",
      "isolated Team computer",
      "persistent remote workspace",
      "Host restart",
      "saved pairing reconnect",
      "remote cleanup",
    ],
  }));
} finally {
  if (hostRunning) await stopRemoteHost().catch(() => {});
  if (memberId) {
    const container = containerName(memberId);
    const cleanupProviders = provider ? [provider] : ["podman", "docker"];
    for (const cleanupProvider of cleanupProviders) {
      await remote(`${quote(cleanupProvider)} rm -f ${quote(container)}`, {allowFailure: true}).catch(() => {});
      await remote(`${quote(cleanupProvider)} volume rm ${quote(`${container}-workspace`)}`, {allowFailure: true}).catch(() => {});
    }
  }
  if (!remoteRoot.startsWith("/tmp/polymux-remote-host-smoke-"))
    throw new Error("Refusing to clean an unexpected remote smoke directory");
  await remote(`rm -rf ${quote(remoteRoot)}`, {allowFailure: true}).catch(() => {});
}

async function rpc(endpoint, secret, method, args = []) {
  const value = await requestJson(`${endpoint}/polymux-host/v1/rpc`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      origin: "tauri://localhost",
    },
    body: JSON.stringify({method, args}),
  });
  return value.result;
}

async function requestJson(url, init) {
  const response = await fetch(url, {...init, signal: AbortSignal.timeout(40_000)});
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`Polymux Connect returned HTTP ${response.status}: ${String(value.error ?? "unknown error")}`);
  return value;
}

async function requestJsonEventually(url, init) {
  let failure;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      return await requestJson(url, init);
    } catch (error) {
      failure = error;
      await delay(250);
    }
  }
  throw failure;
}

async function remotePort() {
  const script = "const net=require('node:net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})";
  const result = await remote(`${quote(remoteNode)} -e ${quote(script)}`);
  const port = Number(result.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`The remote Host returned an invalid test port: ${result.trim()}`);
  return port;
}

async function startRemoteHost(port, requirePairingCode) {
  const launch = [
    "nohup env",
    quote(`POLYMUX_HOME=${remoteHome}`),
    quote(`POLYMUX_HOST_PORT=${port}`),
    quote(`POLYMUX_HOST_RELAY_ENDPOINT=${relayUrl.origin}`),
    quote(remoteNode),
    quote(remoteCli),
    "host serve",
    `> ${quote(stdoutPath)}`,
    `2> ${quote(stderrPath)}`,
    "< /dev/null &",
    `printf '%s' $! > ${quote(pidPath)}`,
  ].join(" ");
  await remote(`: > ${quote(stdoutPath)}; : > ${quote(stderrPath)}; ${launch}`);

  let stdout = "";
  let stderr = "";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    [stdout, stderr] = await Promise.all([
      remote(`cat ${quote(stdoutPath)}`, {allowFailure: true}).then((result) => result.output),
      remote(`cat ${quote(stderrPath)}`, {allowFailure: true}).then((result) => result.output),
    ]);
    const endpoint = stdout.match(/Polymux Host is running at (https?:\/\/\S+)\.\r?\n/)?.[1];
    const pairingCode = stdout.match(/Connect code: (\d{9})/)?.[1] ?? null;
    if (endpoint && (!requirePairingCode || pairingCode)) return {endpoint, pairingCode};
    const alive = await remoteProcessAlive();
    if (!alive) break;
    await delay(250);
  }
  await stopRemoteHost().catch(() => {});
  throw new Error(`Remote Host did not become ready\nstdout:\n${redact(stdout)}\nstderr:\n${redact(stderr)}`);
}

async function remoteProcessAlive() {
  const result = await remote(
    `pid=$(cat ${quote(pidPath)} 2>/dev/null) || exit 1; kill -0 "$pid" 2>/dev/null`,
    {allowFailure: true},
  );
  return result.code === 0;
}

async function stopRemoteHost() {
  const script = [
    `pid=$(cat ${quote(pidPath)} 2>/dev/null) || exit 0`,
    `command=$(ps -p "$pid" -o command= 2>/dev/null || true)`,
    `case "$command" in *${quote(remoteCli)}*) ;; *) exit 0 ;; esac`,
    `kill -TERM "$pid" 2>/dev/null || true`,
    `for attempt in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || exit 0; sleep .1; done`,
    `kill -KILL "$pid" 2>/dev/null || true`,
  ].join("; ");
  await remote(script, {allowFailure: true});
}

async function remote(script, options = {}) {
  return command("ssh", [
    "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", sshHost, script,
  ], options);
}

async function command(executable, args, options = {}) {
  const child = spawn(executable, args, {stdio: ["ignore", "pipe", "pipe"]});
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout = bounded(stdout + chunk); });
  child.stderr.on("data", (chunk) => { stderr = bounded(stderr + chunk); });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (value) => resolve(value ?? 1));
  });
  const result = {code, output: stdout, error: stderr};
  if (code !== 0 && !options.allowFailure)
    throw new Error(`${executable} exited with ${code}: ${redact(stderr || stdout)}`);
  return options.allowFailure ? result : stdout;
}

function containerName(id) {
  const safe = id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32) || "member";
  return `polymux-team-${safe}`;
}

function quote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function redact(value) {
  return bounded(value).replace(/Connect code: \d{9}/g, "Connect code: [redacted]");
}

function bounded(value) {
  return value.length <= 24_000 ? value : value.slice(-24_000);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
