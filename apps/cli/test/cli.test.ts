import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {PassThrough, Writable} from "node:stream";
import {promptSecret, secretFromStdin} from "../src/secrets.js";
import {mkdtemp, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {pathToFileURL} from "node:url";
import type {TeamHostServerSnapshot} from "@polymux/host";
import {
  parseDeviceInvitation,
  assistantText,
  cliEntryMatches,
  flagString,
  linuxUnit,
  macPlist,
  hostNetworkOptions,
  parseAvatarOption,
  parseConnectTarget,
  parseFlags,
  parseLaptopAccess,
  snapshotText,
  terminalQr,
} from "../src/index.js";
import {formatTeamHostSetupCode, qrMatrix} from "@polymux/protocol";

test("CLI recognises a launched entrypoint through a canonical path alias", {
  skip: process.platform === "win32",
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-cli-entry-"));
  const entry = path.join(directory, "polymux.mjs");
  const alias = path.join(directory, "polymux-alias.mjs");
  try {
    await writeFile(entry, "export {};\n");
    await symlink(entry, alias);
    assert.equal(cliEntryMatches(alias, pathToFileURL(entry).href), true);
    assert.equal(cliEntryMatches(path.join(directory, "missing.mjs"), pathToFileURL(entry).href), false);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("CLI extracts only assistant prose", () => {
  assert.equal(assistantText([
    {type: "reasoning", text: "private"},
    {type: "text", text: "Hello"},
    {type: "tool", text: "ignored"},
    {type: "text", text: "from the Host"},
  ]), "Hello\n\nfrom the Host");
});

test("CLI renders a compact, high-contrast terminal QR with a quiet zone", () => {
  const setup = formatTeamHostSetupCode(
    "https://connect.polymux.com/h/86c92dd5-5042-4aa4-a33f-b656bf641e28",
    "K7M2P9X4Q",
  );
  const size = qrMatrix(setup).length;
  const lines = terminalQr(setup).split("\n");
  const printable = lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""));

  assert.equal(lines.length, Math.ceil((size + 8) / 2));
  assert.ok(lines.every((line) => line.startsWith("\u001b[30;47m") && line.endsWith("\u001b[0m")));
  assert.ok(printable.every((line) => line.length === size + 8));
  assert.ok(printable.slice(0, 2).every((line) => line.trim() === ""));
  assert.ok(printable.every((line) => line.slice(0, 4) === "    " && line.slice(-4) === "    "));
  assert.match(printable.join(""), /[█▀▄]/);
});

test("interactive Host pairing shows the QR while piped output stays scriptable", () => {
  const snapshot: TeamHostServerSnapshot = {
    state: "listening" as const,
    approvals: [], connectedDevices: [],
    endpoint: "https://connect.polymux.com/h/demo",
    pairingCode: "K7M2P9X4Q",
    pairingExpiresAt: "2026-09-06T08:15:00.000Z",
    pairedDesktopName: null,
    detail: null,
  };
  const interactive = snapshotText(snapshot, true);
  const piped = snapshotText(snapshot, false);

  assert.match(interactive, /Scan with Polymux on your other device/);
  assert.match(interactive, /\u001b\[30;47m/);
  assert.match(interactive, /Connect code: K7M2P9X4Q/);
  assert.equal(piped.includes("\u001b["), false);
  assert.equal(piped.includes("Scan with Polymux Phone"), false);
  assert.match(piped, /Setup code: pmx1:/);
});

test("service definitions run the CLI in Host mode", () => {
  const paths = {
    root: "/srv/polymux data",
    data: "/srv/polymux data/host",
    config: "/srv/polymux data/config",
    state: "/srv/polymux data/host/state.json",
    adminSecret: "/srv/polymux data/config/host-admin-token",
  };
  const unit = linuxUnit("/opt/polymux/polymux.mjs", paths);
  assert.match(unit, /host serve/);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /EnvironmentFile=-"\/srv\/polymux data\/config\/host\.env"/);
  const plist = macPlist("/Applications/Polymux CLI/polymux.mjs", paths);
  assert.match(plist, /<string>host<\/string><string>serve<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  if (process.platform === "darwin") {
    const lint = spawnSync("plutil", ["-lint", "-"], {input: plist, encoding: "utf8"});
    assert.equal(lint.status, 0, lint.stderr);
  }
});

test('installation invitations accept only secure endpoints and temporary tokens', () => {
  const encode = (endpoint: string, invitation = 'a'.repeat(43)) => Buffer.from(JSON.stringify({endpoint, invitation})).toString('base64url');
  assert.equal(parseDeviceInvitation(encode('https://connect.polymux.com/h/device')).invitation.length, 43);
  for (const endpoint of ['http://example.com', 'https://user:pass@example.com', 'file:///tmp/x', 'https://example.com?token=secret']) assert.throws(() => parseDeviceInvitation(encode(endpoint)));
  assert.throws(() => parseDeviceInvitation(encode('https://example.com', 'short')));
  assert.throws(() => parseDeviceInvitation('$(whoami)'));
});

test('CLI flag parser handles values, equals signs, and negations', () => {
  assert.deepEqual(parseFlags(['serve', '--port', '0']).positional, ['serve']);
  assert.equal(flagString(parseFlags(['--port', '0']), 'port'), '0');
  assert.equal(flagString(parseFlags(['--port=1234']), 'port'), '1234');
  assert.equal(parseFlags(['--no-pairing']).pairing, false);
  assert.equal(parseFlags(['--json']).json, true);
  assert.deepEqual(parseFlags(['run', 'Maya', '--', '--not-a-flag']).positional, ['run', 'Maya', '--not-a-flag']);
  assert.deepEqual(parseFlags(['--role', 'Helper', 'Maya']).positional, ['Maya']);
  assert.equal(flagString(parseFlags(['--role', 'Helper']), 'role'), 'Helper');
  assert.deepEqual(parseFlags(['--json', 'chat']).positional, ['chat']);
  assert.deepEqual(parseFlags(['--unpin', 'item']).positional, ['item']);
  assert.deepEqual(parseFlags(['--as-goal', 'Fix', 'the', 'bug']).positional, ['Fix', 'the', 'bug']);
  assert.equal(parseFlags(['--as-goal=false'])['as-goal'], false);
  assert.equal(parseFlags(['--no-json=false']).json, true);
  assert.equal(parseFlags(['--json', '--no-json']).json, false);
  assert.throws(() => parseFlags(['--json=maybe']), /true or false/);
  assert.throws(() => parseFlags(['--password', '--json']), /requires a value/);
  assert.deepEqual(parseFlags(['--password-value-stdin', 'item']).positional, ['item']);
});

test('Host networking distinguishes the default listener from explicit local-only configuration', () => {
  assert.deepEqual(hostNetworkOptions(parseFlags([]), {}), {
    listen: '127.0.0.1', publicEndpoint: null, relayEndpoint: 'https://connect.polymux.com',
  });
  for (const flags of [['--listen', '127.0.0.1'], ['--no-relay'], ['--relay=off']])
    assert.equal(hostNetworkOptions(parseFlags(flags), {}).relayEndpoint, null);
  assert.equal(hostNetworkOptions(parseFlags([]), {POLYMUX_HOST_LISTEN: '127.0.0.1'}).relayEndpoint, null);
  assert.equal(hostNetworkOptions(parseFlags([]), {POLYMUX_HOST_PUBLIC_ENDPOINT: 'https://host.example.com'}).relayEndpoint, null);
  assert.equal(hostNetworkOptions(parseFlags(['--relay=https://relay.example.com']), {POLYMUX_HOST_RELAY_ENDPOINT: 'off'}).relayEndpoint, 'https://relay.example.com');
});

test('hidden password input preserves whitespace and restores terminal mode on submit and cancel', async () => {
  for (const action of ['submit', 'interrupt', 'eof']) {
    const rawModes: boolean[] = [];
    const input = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode(raw: boolean) { rawModes.push(raw); return this; },
    });
    let displayed = '';
    const output = new Writable({write(chunk, _encoding, done) { displayed += chunk; done(); }});
    const result = promptSecret('Locker password', input as unknown as NodeJS.ReadStream, output);
    if (action === 'submit') {
      input.write('  private password  \r');
      assert.equal(await result, '  private password  ');
    } else {
      const rejected = assert.rejects(result, /cancelled/);
      if (action === 'interrupt') input.write('\x03');
      else input.end();
      await rejected;
    }
    assert.equal(displayed, 'Locker password: \n');
    assert.deepEqual(rawModes, [true, false]);
    input.destroy();
    output.destroy();
  }
});

test('piped secret input removes only one line ending', async () => {
  for (const text of ['  private password  ', '  private password  \n', '  private password  \r\n']) {
    const input = new PassThrough();
    input.end(text);
    assert.equal(await secretFromStdin(input as unknown as NodeJS.ReadStream), '  private password  ');
  }
});

test('CLI validates avatar and laptop options before calling the Host', () => {
  assert.deepEqual(parseAvatarOption(undefined, undefined), {shape: 'circle', color: '#7557FF'});
  assert.deepEqual(parseAvatarOption('cube', '#112233'), {shape: 'cube', color: '#112233'});
  assert.throws(() => parseAvatarOption('pyramid', undefined));
  assert.throws(() => parseAvatarOption(undefined, 'red'));
  assert.equal(parseLaptopAccess(undefined), 'off');
  assert.equal(parseLaptopAccess('ask'), 'ask');
  assert.throws(() => parseLaptopAccess('always'));
});

test('CLI distinguishes setup codes from installation invitations', () => {
  const setup = formatTeamHostSetupCode(
    'https://connect.polymux.com/h/86c92dd5-5042-4aa4-a33f-b656bf641e28',
    'K7M2P9X4Q',
  );
  assert.equal(parseConnectTarget(`Setup code: ${setup}`).kind, 'setup-code');
  const invitation = Buffer.from(JSON.stringify({endpoint: 'https://connect.polymux.com/h/device', invitation: 'a'.repeat(43)})).toString('base64url');
  assert.equal(parseConnectTarget(invitation).kind, 'invitation');
  assert.equal(parseConnectTarget('not-a-token').kind, 'unknown');
});
