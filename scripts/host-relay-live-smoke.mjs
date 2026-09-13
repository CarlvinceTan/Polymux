import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp, rm, readFile} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import path from "node:path";

const relayOrigin = process.env.POLYMUX_CONNECT_SMOKE_RELAY?.trim()
  || "https://connect.polymux.com";
const relayUrl = new URL(relayOrigin);
const loopback = relayUrl.hostname === "127.0.0.1" || relayUrl.hostname === "localhost" || relayUrl.hostname === "[::1]";
if (relayUrl.protocol !== "https:" && !(loopback && relayUrl.protocol === "http:"))
  throw new Error("The live relay smoke test requires HTTPS or a loopback HTTP relay");

const cliEntry = path.resolve("apps/cli/dist/polymux.mjs");
const hostHome = await mkdtemp(path.join(tmpdir(), "polymux-connect-smoke-"));
const port = await availablePort();
let host = null;

try {
  const health = await requestJson(`${relayUrl.origin}/healthz`);
  assert.deepEqual(health, {ok: true, service: "polymux-connect", protocol: 1});
  const discovery = await requestJson(`${relayUrl.origin}/connect-config`);
  assert.equal(discovery.version, 1);
  const socketOrigin = new URL(discovery.webSocketOrigin);
  if (loopback) assert.equal(socketOrigin.origin, relayUrl.origin);
  else {
    assert.equal(socketOrigin.protocol, "https:");
    assert.match(socketOrigin.hostname, /\.workers\.dev$/);
  }

  const first = await startHost({hostHome, port, relayOrigin, requirePairingCode: true});
  host = first.child;
  const expectedPrefix = `${relayUrl.origin}/h/`;
  assert.match(first.endpoint, new RegExp(`^${escapeRegExp(expectedPrefix)}`));
  assert.match(first.pairingCode, /^\d{9}$/);

  const pending = await requestJsonEventually(`${relayUrl.origin}/connect`, {
    method: "POST",
    headers: {"content-type": "application/json", origin: "tauri://localhost"},
    body: JSON.stringify({
      code: first.pairingCode,
      desktopId: "polymux-connect-live-smoke",
      deviceName: "Polymux Connect live smoke",
    }),
  });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.secret, undefined);
  const notApproved = await fetch(`${first.endpoint}/polymux-host/v1/rpc`, {method: 'POST', headers: {authorization: `Bearer ${pending.token}`, 'content-type': 'application/json'}, body: JSON.stringify({method: 'team.list', args: []})});
  assert.equal(notApproved.status, 401);
  const admin = (await readFile(path.join(hostHome, 'config/host-admin-token'), 'utf8')).trim();
  await requestJson(`http://127.0.0.1:${port}/polymux-host/v1/admin/devices/approve`, {method: 'POST', headers: {authorization: `Bearer ${admin}`, 'content-type': 'application/json'}, body: JSON.stringify({id: pending.id, number: pending.number})});
  const approved = await requestJson(`${first.endpoint}/polymux-host/v1/pair/status`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: pending.id, token: pending.token})});
  const paired = approved.credentials;
  assert.equal(typeof paired.secret, "string");
  assert.ok(paired.secret.length >= 32);

  await assertTeamList(first.endpoint, paired.secret);
  await stopHost(host);
  host = null;

  const restarted = await startHost({hostHome, port, relayOrigin, requirePairingCode: false});
  host = restarted.child;
  assert.equal(restarted.endpoint, first.endpoint);
  await assertTeamList(restarted.endpoint, paired.secret);

  console.log(JSON.stringify({
    ok: true,
    endpoint: first.endpoint,
    checks: ["health", "socket discovery", "connect code", "pre-approval denial", "number matching", "authenticated RPC", "Host restart", "saved pairing reconnect"],
  }));
} finally {
  if (host) await stopHost(host);
  await rm(hostHome, {recursive: true, force: true});
}

async function assertTeamList(endpoint, secret) {
  const value = await requestJson(`${endpoint}/polymux-host/v1/rpc`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      origin: "tauri://localhost",
    },
    body: JSON.stringify({method: "team.list", args: []}),
  });
  assert.ok(Array.isArray(value.result));
}

async function requestJson(url, init) {
  const response = await fetch(url, {...init, signal: AbortSignal.timeout(20_000)});
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`Polymux Connect returned HTTP ${response.status}: ${String(value.error ?? "unknown error")}`);
  return value;
}

async function requestJsonEventually(url, init) {
  let failure;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await requestJson(url, init);
    } catch (error) {
      failure = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw failure;
}

async function startHost({hostHome, port, relayOrigin, requirePairingCode}) {
  const child = spawn(process.execPath, [cliEntry, "host", "serve"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NO_COLOR: "1",
      POLYMUX_HOME: hostHome,
      POLYMUX_HOST_PORT: String(port),
      POLYMUX_HOST_RELAY_ENDPOINT: relayOrigin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout = boundedLog(stdout + chunk); });
  child.stderr.on("data", (chunk) => { stderr = boundedLog(stderr + chunk); });

  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => fail("Host did not become ready within 20 seconds"), 20_000);
      const inspect = () => {
        const endpoint = stdout.match(/Polymux Host is running at (https?:\/\/\S+)\.\r?\n/)?.[1];
        const pairingCode = stdout.match(/Connect code: (\d{9})/)?.[1] ?? null;
        if (!endpoint || requirePairingCode && !pairingCode) return;
        clearTimeout(timeout);
        cleanup();
        resolve({child, endpoint, pairingCode});
      };
      const exited = (code, signal) => fail(`Host exited before readiness (${code ?? signal ?? "unknown"})`);
      const failed = (error) => fail(`Host could not start: ${error.message}`);
      const fail = (message) => {
        clearTimeout(timeout);
        cleanup();
        reject(new Error(`${message}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      };
      const cleanup = () => {
        child.stdout.off("data", inspect);
        child.off("exit", exited);
        child.off("error", failed);
      };
      child.stdout.on("data", inspect);
      child.once("exit", exited);
      child.once("error", failed);
      inspect();
    });
  } catch (error) {
    await stopHost(child);
    throw error;
  }
}

async function stopHost(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a Host test port");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

function boundedLog(value) {
  return value.length <= 16_000 ? value : value.slice(-16_000);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
