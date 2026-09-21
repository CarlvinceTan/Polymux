import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {access, chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {createServer} from "node:net";
import {createServer as createHttpServer} from "node:http";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {parseTeamHostSetupCode} from "@polymux/protocol";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const bundle = path.join(root, "apps/cli/dist/polymux.mjs");
const installer = path.join(root, "apps/site/public/install.sh");

test("built CLI preserves command arguments and empty JSON results", {timeout: 20_000}, async () => {
  const home = await mkdtemp(path.join(tmpdir(), "polymux-cli-dispatch-"));
  const requests: Array<{method: string; args: unknown[]}> = [];
  const server = createHttpServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body) as {method: string; args: unknown[]};
    requests.push(rpc);
    const results: Record<string, unknown> = {
      "team.list": [{id: "bot", name: "Maya", conversationId: "conversation", deviceAccess: {server: "ask"}}],
      "team.create": {id: "bot", name: "Maya"},
      "team.update": {id: "bot", name: "Maya"},
      "runs.start": {runId: "run"},
      "runs.events": [{sequence: 1, type: "run.completed"}],
      "conversations.messages": [],
      "vault.save": {id: "existing-entry"},
      "goals.get": null,
    };
    response.writeHead(200, {"content-type": "application/json"});
    response.end(JSON.stringify({result: results[rpc.method]}));
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await mkdir(path.join(home, "host"), {recursive: true});
    await mkdir(path.join(home, "config"), {recursive: true});
    await writeFile(path.join(home, "host/state.json"), JSON.stringify({
      endpoint: `http://127.0.0.1:${address.port}`,
    }));
    await writeFile(path.join(home, "config/host-admin-token"), "test-admin-token");
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      POLYMUX_HOME: home,
      POLYMUX_VAULT_ITEM_PASSWORD: undefined,
    };

    for (const [args, asGoal] of [
      [["--as-goal", "Fix", "the", "bug"], true],
      [["Fix", "--as-goal", "the", "bug"], true],
      [["Fix", "the", "bug", "--as-goal"], true],
      [["--as-goal=false", "Fix", "the", "bug"], false],
      [["--no-as-goal", "Fix", "the", "bug"], false],
    ] as const) {
      requests.length = 0;
      const result = await run(process.execPath, [bundle, "run", "Maya", ...args], environment);
      assert.equal(result.code, 0, result.stderr);
      const started = requests.find((request) => request.method === "runs.start");
      assert.ok(started);
      const input = started.args[0] as {conversationId: string; text: string; asGoal?: boolean};
      assert.equal(input.conversationId, "conversation");
      assert.equal(input.text, "Fix the bug");
      assert.equal(input.asGoal ?? false, asGoal);
    }

    requests.length = 0;
    const saved = await run(process.execPath, [
      bundle, "vault", "save", "--id", "existing-entry", "--title", "Updated",
    ], environment);
    assert.equal(saved.code, 0, saved.stderr);
    const save = requests.find((request) => request.method === "vault.save");
    assert.equal((save?.args[0] as {id?: string})?.id, "existing-entry");

    const goal = await run(process.execPath, [bundle, "goals", "get", "--json", "conversation"], environment);
    assert.equal(goal.code, 0, goal.stderr);
    assert.equal(goal.stdout, "null\n");

    requests.length = 0;
    const created = await run(process.execPath, [bundle, 'team', 'create', 'Maya', '--role', 'Helper', '--profile', 'default'], environment);
    assert.equal(created.code, 0, created.stderr);
    const create = requests.find((request) => request.method === 'team.create')?.args[0] as {laptopAccess: string; deviceAccess: unknown};
    assert.equal(create.laptopAccess, 'allow');
    assert.deepEqual(create.deviceAccess, {});

    requests.length = 0;
    const updated = await run(process.execPath, [bundle, 'team', 'update', 'Maya', '--device-access', 'desktop=off'], environment);
    assert.equal(updated.code, 0, updated.stderr);
    const update = requests.find((request) => request.method === 'team.update')?.args[1] as {deviceAccess: unknown};
    assert.deepEqual(update.deviceAccess, {server: 'ask', desktop: 'off'});

    requests.length = 0;
    const obsolete = await run(process.execPath, [bundle, 'team', 'create', 'Maya', '--role', 'Helper', '--profile', 'default', '--laptop', 'off'], environment);
    assert.equal(obsolete.code, 1);
    assert.match(obsolete.stderr, /instead of --laptop/);
    assert.equal(requests.length, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(home, {recursive: true, force: true});
  }
});

test("built CLI serves, pairs a Desktop, and accepts authenticated RPC", {timeout: 20_000}, async () => {
  const home = await mkdtemp(path.join(tmpdir(), "polymux-cli-live-"));
  const port = await availablePort();
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    POLYMUX_HOME: home,
    POLYMUX_HOST_LISTEN: "127.0.0.1",
    POLYMUX_HOST_PORT: String(port),
  };
  const host = spawn(process.execPath, [bundle, "host", "serve"], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  host.stdout.setEncoding("utf8");
  host.stderr.setEncoding("utf8");
  host.stdout.on("data", (chunk: string) => output += chunk);
  host.stderr.on("data", (chunk: string) => errors += chunk);

  try {
    await waitUntil(
      () => output.includes(`Polymux Host is running at http://127.0.0.1:${port}.`),
      () => `Host did not become ready.\nstdout:\n${output}\nstderr:\n${errors}`,
    );

    const health = await fetch(`http://127.0.0.1:${port}/polymux-host/v1/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as {paired: boolean}).paired, false);

    const status = await run(process.execPath, [bundle, "host", "status"], environment);
    assert.equal(status.code, 0, status.stderr);
    assert.match(status.stdout, /Status: running/);
    assert.match(status.stdout, /Desktop: not paired/);

    const pairing = await run(process.execPath, [bundle, "host", "pair"], environment);
    assert.equal(pairing.code, 0, pairing.stderr);
    const setup = parseTeamHostSetupCode(pairing.stdout);
    assert.deepEqual(setup?.endpoint, `http://127.0.0.1:${port}`);
    const code = setup?.code;
    assert.ok(code);

    const paired = await fetch(`http://127.0.0.1:${port}/polymux-host/v1/pair`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({code, desktopId: "integration-desktop", deviceName: "Integration Desktop"}),
    });
    const challenge = await paired.json() as {id: string; token: string; number: string};
    assert.equal(paired.status, 202);
    const approval = await run(process.execPath, [bundle, 'devices', 'approve', challenge.id, challenge.number], environment);
    assert.equal(approval.code, 0, approval.stderr);
    const result = await fetch(`http://127.0.0.1:${port}/polymux-host/v1/pair/status`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(challenge)});
    const {credentials} = await result.json() as {credentials: {secret: string}};
    const secret = credentials.secret;
    assert.ok(secret);

    const rpc = await fetch(`http://127.0.0.1:${port}/polymux-host/v1/rpc`, {
      method: "POST",
      headers: {authorization: `Bearer ${secret}`, "content-type": "application/json"},
      body: JSON.stringify({method: "team.list", args: []}),
    });
    const rpcBody = await rpc.json();
    assert.equal(rpc.status, 200, JSON.stringify(rpcBody));
    assert.deepEqual(rpcBody, {result: []});

    const pairedStatus = await run(process.execPath, [bundle, "host", "status"], environment);
    assert.equal(pairedStatus.code, 0, pairedStatus.stderr);
    assert.match(pairedStatus.stdout, /Desktop: paired/);
  } finally {
    host.kill("SIGTERM");
    const exit = await waitForExit(host);
    const stateRemained = await access(path.join(home, "host/state.json")).then(() => true, () => false);
    await rm(home, {recursive: true, force: true});
    assert.equal(exit.code, 0, `Host exited unexpectedly.\nstdout:\n${output}\nstderr:\n${errors}`);
    assert.equal(stateRemained, false, "Graceful shutdown left a stale Host state file");
  }
});

test("built CLI serves the Vault vault and Hub mail state", {timeout: 30_000}, async () => {
  const home = await mkdtemp(path.join(tmpdir(), "polymux-cli-vault-"));
  const port = await availablePort();
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    POLYMUX_HOME: home,
    POLYMUX_HOST_LISTEN: "127.0.0.1",
    POLYMUX_HOST_PORT: String(port),
    POLYMUX_VAULT_PASSWORD: "correct horse battery staple",
    POLYMUX_VAULT_ITEM_PASSWORD: undefined,
    POLYMUX_EMAIL_PASSWORD: undefined,
  };
  const host = spawn(process.execPath, [bundle, "host", "serve"], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  host.stdout.setEncoding("utf8");
  host.stdout.on("data", (chunk: string) => output += chunk);

  const cli = async (args: string[], input?: string): Promise<string> => {
    const result = await run(process.execPath, [bundle, ...args], environment, input);
    assert.equal(result.code, 0, `${args.join(" ")} failed:\n${result.stderr}`);
    return result.stdout;
  };
  try {
    await waitUntil(
      () => output.includes(`Polymux Host is running at http://127.0.0.1:${port}.`),
      () => `Host did not become ready.\nstdout:\n${output}`,
    );

    const created = JSON.parse(await cli(["vault", "create"])) as {exists: boolean; unlocked: boolean};
    assert.equal(created.exists, true);
    assert.equal(created.unlocked, true);
    const saved = JSON.parse(await cli([
      "vault", "save", "--title", "Integration login",
      "--username", "integration-user", "--password-value-stdin",
    ], " integration-secret \n")) as {id: string};
    assert.ok(saved.id);
    const list = JSON.parse(await cli(["vault", "list"])) as {items: Array<{id: string}>};
    assert.ok(list.items.some((item) => item.id === saved.id));
    const updated = JSON.parse(await cli([
      "vault", "save", "--id", saved.id, "--title", "Updated login",
    ])) as {id: string; title: string};
    assert.equal(updated.id, saved.id);
    assert.equal(updated.title, "Updated login");
    const updatedList = JSON.parse(await cli(["vault", "list"])) as {items: Array<{id: string}>};
    assert.equal(updatedList.items.length, list.items.length);
    assert.equal(await cli(["vault", "copy", saved.id, "password"]), " integration-secret \n");
    assert.equal(
      (JSON.parse(await cli(["vault", "lock"])) as {unlocked: boolean}).unlocked,
      false,
    );
    assert.equal(
      (JSON.parse(await cli(["vault", "unlock"])) as {unlocked: boolean}).unlocked,
      true,
    );
    const nextPassword = " replacement master password ";
    assert.equal(
      (JSON.parse(await cli(["vault", "change-password", "--new-stdin"], `${nextPassword}\n`)) as {unlocked: boolean}).unlocked,
      true,
    );
    await cli(["vault", "lock"]);
    const oldPassword = await run(process.execPath, [bundle, "vault", "unlock"], environment);
    assert.notEqual(oldPassword.code, 0, "The old master password still unlocked the vault after replacement");
    assert.equal(
      (JSON.parse(await cli(["vault", "status"])) as {unlocked: boolean}).unlocked,
      false,
    );
    assert.equal(
      (JSON.parse(await cli(["vault", "unlock", "--password-stdin"], `${nextPassword}\n`)) as {unlocked: boolean}).unlocked,
      true,
    );
    assert.equal(await cli(["vault", "copy", saved.id, "password"]), " integration-secret \n");
    const exported = await cli(["vault", "export"]);
    assert.ok(JSON.parse(exported).bytes);
    await cli(["vault", "remove", saved.id]);
    await cli(["vault", "empty-trash"]);

    assert.equal(await cli(["hub", "email-accounts"]), "[]\n");
    const accounts = JSON.parse(await cli([
      "hub", "email-save", "local", "--email", "user@example.com", "--preset", "custom",
      "--imap-host", "127.0.0.1", "--imap-port", "10943", "--imap-encryption", "tls",
      "--smtp-host", "127.0.0.1", "--smtp-port", "10025", "--smtp-encryption", "none",
      "--password-value-stdin",
    ], "mail-secret\n")) as Array<{id: string}>;
    assert.deepEqual(accounts.map((account) => account.id), ["local"]);
    await cli(["hub", "email-remove", "local"]);
    assert.equal(await cli(["hub", "email-accounts"]), "[]\n");
  } finally {
    host.kill("SIGTERM");
    await waitForExit(host).catch((): undefined => undefined);
    await rm(home, {recursive: true, force: true});
  }
});

test("public installer verifies the archive and invokes Host installation", {timeout: 20_000}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-installer-"));
  const release = path.join(directory, "release");
  const payload = path.join(directory, "payload");
  const commands = path.join(directory, "commands");
  const prefix = path.join(directory, "install");
  const marker = path.join(directory, "invocations.txt");
  await Promise.all([
    mkdir(release, {recursive: true}),
    mkdir(payload, {recursive: true}),
    mkdir(commands, {recursive: true}),
  ]);

  try {
    const fakeCli = path.join(payload, "polymux.mjs");
    await writeFile(fakeCli, [
      'import {appendFileSync} from "node:fs";',
      'appendFileSync(process.env.POLYMUX_TEST_MARKER, `${process.argv.slice(2).join(" ")}\\n`);',
      'if (process.argv.includes("--version")) process.stdout.write("installer-test\\n");',
      "",
    ].join("\n"));

    await writeFile(path.join(payload, 'usage-worker.js'), '// packaged usage worker\n');
    const archive = path.join(release, "polymux-cli.tar.gz");
    const packed = spawnSync("tar", ["-czf", archive, "-C", payload, "polymux.mjs", "usage-worker.js"], {
      encoding: "utf8",
    });
    assert.equal(packed.status, 0, packed.stderr);
    const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
    await writeFile(`${archive}.sha256`, `${digest}  polymux-cli.tar.gz\n`);

    const nodeVersion = "24.20.0";
    const nodePlatform = process.platform === "darwin" ? "darwin" : "linux";
    const nodeArchitecture = process.arch === "arm64" ? "arm64" : "x64";
    const nodeDirectoryName = `node-v${nodeVersion}-${nodePlatform}-${nodeArchitecture}`;
    const nodeDirectory = path.join(directory, nodeDirectoryName);
    await mkdir(path.join(nodeDirectory, "bin"), {recursive: true});
    await writeFile(path.join(nodeDirectory, "bin/node"), '#!/bin/sh\nexec "$POLYMUX_TEST_NODE" "$@"\n');
    await chmod(path.join(nodeDirectory, "bin/node"), 0o755);
    const nodeArchiveName = `${nodeDirectoryName}.tar.gz`;
    const nodeArchive = path.join(release, nodeArchiveName);
    const packedNode = spawnSync("tar", ["-czf", nodeArchive, "-C", directory, nodeDirectoryName], {
      encoding: "utf8",
    });
    assert.equal(packedNode.status, 0, packedNode.stderr);
    const nodeDigest = createHash("sha256").update(await readFile(nodeArchive)).digest("hex");
    await writeFile(path.join(release, "SHASUMS256.txt"), `${nodeDigest}  ${nodeArchiveName}\n`);

    const curl = path.join(commands, "curl");
    await writeFile(curl, [
      "#!/bin/sh",
      'output=""',
      'source=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -o) shift; output="$1" ;;',
      '    https://*) source="$1" ;;',
      '  esac',
      '  shift',
      'done',
      'source="${source%%\\?*}"',
      'cp "$POLYMUX_TEST_RELEASE/${source##*/}" "$output"',
      "",
    ].join("\n"));
    await chmod(curl, 0o755);

    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${commands}${path.delimiter}/usr/bin${path.delimiter}/bin`,
      POLYMUX_INSTALL_DIR: prefix,
      POLYMUX_TEST_MARKER: marker,
      POLYMUX_TEST_RELEASE: release,
      POLYMUX_TEST_NODE: process.execPath,
    };
    const installed = await run("sh", [installer, "host"], environment);
    assert.equal(installed.code, 0, installed.stderr);
    assert.match(installed.stdout, /Installed Polymux CLI/);
    assert.equal(await readFile(path.join(prefix, 'share/polymux-cli/usage-worker.js'), 'utf8'), '// packaged usage worker\n');
    assert.match(await readFile(marker, "utf8"), /^host install\n$/);

    const launcher = path.join(prefix, "bin/polymux");
    assert.equal((await stat(launcher)).mode & 0o777, 0o755);
    assert.match(await readFile(launcher, "utf8"), new RegExp(`${nodeDirectoryName}/bin/node`));
    const version = await run(launcher, ["--version"], environment);
    assert.equal(version.code, 0, version.stderr);
    assert.equal(version.stdout, "installer-test\n");
    assert.match(await readFile(marker, "utf8"), /^host install\n--version\n$/);

    const invitation = Buffer.from(JSON.stringify({endpoint: 'https://connect.polymux.com/h/test', invitation: 'a'.repeat(43)})).toString('base64url');
    const connected = await run('sh', [installer, 'connect', invitation], environment);
    assert.equal(connected.code, 0, connected.stderr);
    assert.ok((await readFile(marker, 'utf8')).endsWith(`connect ${invitation}\n`));

    await writeFile(`${archive}.sha256`, `${"0".repeat(64)}  polymux-cli.tar.gz\n`);
    const rejected = await run("sh", [installer, "cli"], {
      ...environment,
      POLYMUX_INSTALL_DIR: path.join(directory, "rejected"),
    });
    assert.notEqual(rejected.code, 0);
    await assert.rejects(access(path.join(directory, "rejected/bin/polymux")));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  input?: string,
): Promise<{code: number; stdout: string; stderr: string}> {
  const child = spawn(command, args, {cwd: root, env, stdio: ["pipe", "pipe", "pipe"]});
  child.stdin.end(input);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => stdout += chunk);
  child.stderr.on("data", (chunk: string) => stderr += chunk);
  const exit = await waitForExit(child);
  return {code: exit.code ?? 1, stdout, stderr};
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<{code: number | null; signal: NodeJS.Signals | null}> {
  if (child.exitCode !== null) return {code: child.exitCode, signal: child.signalCode};
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Child process timed out"));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({code, signal});
    });
  });
}

async function waitUntil(check: () => boolean, failure: () => string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(failure());
}

test('packaged global usage worker scans only an empty fixture home', {timeout: 15000}, async () => {
  const {Worker} = await import('node:worker_threads');
  const directory = await mkdtemp(path.join(tmpdir(), 'polymux-cli-usage-worker-'));
  const worker = new Worker(path.join(root, 'apps/cli/dist/usage-worker.js'), {
    env: {PATH: process.env.PATH ?? '', HOME: directory, USERPROFILE: directory,
      XDG_CONFIG_HOME: path.join(directory, '.config'), XDG_DATA_HOME: path.join(directory, '.local/share'),
      XDG_STATE_HOME: path.join(directory, '.local/state'), XDG_CACHE_HOME: path.join(directory, '.cache'),
      APPDATA: path.join(directory, 'AppData/Roaming'), LOCALAPPDATA: path.join(directory, 'AppData/Local')},
    workerData: {cacheDirectory: path.join(directory, 'usage-cache'), excludedRoots: []},
    stdout: true, stderr: true,
  });
  worker.stdout.resume(); worker.stderr.resume();
  try {
    const result = await new Promise<any>((resolve, reject) => {worker.once('message', resolve); worker.once('error', reject);});
    assert.equal(result.error, undefined);
    assert.equal(result.discovery.status, 'ready');
    assert.ok(result.discovery.supportedAgents > 0);
    assert.deepEqual(result.source.runs, []);
  } finally {await worker.terminate(); await rm(directory, {recursive: true, force: true});}
});
