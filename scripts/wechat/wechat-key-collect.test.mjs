import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {
  isKeyForDatabase,
  lldbKeyCaptureCommands,
  migrateLegacyRegistry,
  recordRegistryKey,
  collectWeChatKeys,
} from "./wechat-key-collect.mjs";

test("legacy keys migrate only when well-formed", () => {
  const registry = migrateLegacyRegistry({
    config: {account_wxid: "wxid_demo", db_dir: "/tmp/db"},
    keys: {entries: {
      "message/message_0.db": {key_hex: "ab".repeat(32)},
      "message/message_1.db": {key_hex: "not-hex"},
      "../escape.db": {key_hex: "cd".repeat(32)},
      "contact/contact.db": {},
    }},
  }, []);
  assert.deepEqual(registry, {accounts: {
    wxid_demo: {dbDir: "/tmp/db", keys: {"message/message_0.db": "ab".repeat(32)}},
  }});
  assert.deepEqual(migrateLegacyRegistry(null, []), {accounts: {}});
  assert.deepEqual(migrateLegacyRegistry({
    config: {account_wxid: "not-a-wxid"},
    keys: {entries: {"message/message_0.db": {key_hex: "ab".repeat(32)}}},
  }, []), {accounts: {}});
});

test("collecting again preserves native-only and unrelated provisioned keys", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "wechat-collect-repeat-"));
  try {
    const registryPath = path.join(home, "store.json");
    await recordRegistryKey({home, registryPath, wxid: "wxid_native", entry: "message/message_0.db", hex: "ab".repeat(32)});
    await collectWeChatKeys({home, registryPath});
    assert.equal(JSON.parse(await readFile(registryPath, "utf8")).accounts.wxid_native.keys["message/message_0.db"], "ab".repeat(32));
    await mkdir(path.join(home, ".wx-rs"));
    await writeFile(path.join(home, ".wx-rs/config.json"), JSON.stringify({account_wxid: "wxid_legacy", db_dir: path.join(home, "legacy-db")}));
    await writeFile(path.join(home, ".wx-rs/keys.json"), JSON.stringify({entries: {"session/session.db": {key_hex: "cd".repeat(32)}}}));
    await collectWeChatKeys({home, registryPath});
    const stored = JSON.parse(await readFile(registryPath, "utf8"));
    assert.equal(stored.accounts.wxid_native.keys["message/message_0.db"], "ab".repeat(32));
    assert.equal(stored.accounts.wxid_legacy.keys["session/session.db"], "cd".repeat(32));
    assert.equal((await stat(registryPath)).mode & 0o777, 0o600);
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

test("invalid registry data cannot overwrite a provisioned key file", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "wechat-collect-invalid-"));
  try {
    const registryPath = path.join(home, "store.json");
    await writeFile(registryPath, "{interrupted previous file");
    await assert.rejects(collectWeChatKeys({home, registryPath}), /registry/i);
    assert.equal(await readFile(registryPath, "utf8"), "{interrupted previous file");
    await assert.rejects(recordRegistryKey({home, registryPath, wxid: "wxid_me", entry: "../escape.db", hex: "ab".repeat(32)}));
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

test("key validation rejects short buffers without touching WeChat", () => {
  assert.equal(isKeyForDatabase(Buffer.alloc(0), Buffer.alloc(32)), false);
  assert.equal(isKeyForDatabase(Buffer.alloc(4096), Buffer.alloc(32)), false);
  assert.equal(isKeyForDatabase(Buffer.alloc(4096), Buffer.alloc(16)), false);
});

test("LLDB capture stays on public API without offsets", () => {
  const commands = lldbKeyCaptureCommands();
  assert.match(commands, /sqlite3_key/);
  assert.doesNotMatch(commands, /0x[0-9a-f]{4,}/i);
  assert.match(commands, /not validated for WeChat 4\.1\.11/);
  assert.doesNotMatch(commands, /memory read|register read|<hex>/);
});

test("hand-recorded keys pick up the live directory and stay owner-only", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "wechat-collect-home-"));
  const root = path.join(
    home, "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_demo/db_storage");
  await mkdir(path.join(root, "message"), {recursive: true});
  const out = await recordRegistryKey({
    home,
    registryPath: path.join(home, "store.json"),
    wxid: "wxid_demo",
    entry: "message/message_0.db",
    hex: "AB".repeat(32),
  });
  const stored = JSON.parse(await readFile(out, "utf8"));
  assert.equal(stored.accounts.wxid_demo.dbDir, root);
  assert.equal(stored.accounts.wxid_demo.keys["message/message_0.db"], "ab".repeat(32));
  assert.equal((await stat(out)).mode & 0o777, 0o600);
  await rm(home, {recursive: true, force: true});
});

test("recording cannot replace an existing key without an authenticated readable database", async t => {
  const home = await mkdtemp(path.join(tmpdir(), "wechat-record-auth-"));
  t.after(() => rm(home, {recursive: true, force: true}));
  const dbDir = path.join(home, "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_demo/db_storage");
  await mkdir(path.join(dbDir, "message"), {recursive: true});
  const registryPath = path.join(home, "store.json"), entry = "message/message_0.db";
  const options = {home, registryPath, wxid: "wxid_demo", entry};
  await recordRegistryKey({...options, hex: "ab".repeat(32)});
  const before = await readFile(registryPath);
  await assert.rejects(recordRegistryKey({...options, hex: "cd".repeat(32)}), /must be readable/);
  assert.deepEqual(await readFile(registryPath), before);
  const source = path.join(dbDir, entry);
  await copyFile(new URL('../../packages/wechat/test/fixtures/wechat/head_image.db', import.meta.url), source);
  const encrypted = await readFile(source);
  await assert.rejects(recordRegistryKey({...options, hex: "cd".repeat(32)}), /does not authenticate/);
  assert.deepEqual(await readFile(registryPath), before);
  const key = (await readFile(new URL('../../packages/wechat/test/fixtures/wechat/head_image.key', import.meta.url), 'utf8')).trim();
  await recordRegistryKey({...options, hex: key});
  assert.equal(JSON.parse(await readFile(registryPath, 'utf8')).accounts.wxid_demo.keys[entry], key);
  assert.deepEqual(await readFile(source), encrypted);
});

test("a hand-captured key cannot choose arbitrarily between cloned account directories", async t => {
  const home = await mkdtemp(path.join(tmpdir(), "wechat-record-clones-"));
  t.after(() => rm(home, {recursive: true, force: true}));
  for (const app of ['com.tencent.xinWeChat', 'com.tencent.xinWeChat2'])
    await mkdir(path.join(home, `Library/Containers/${app}/Data/Documents/xwechat_files/wxid_demo/db_storage`), {recursive: true});
  const registryPath = path.join(home, 'store.json');
  await assert.rejects(recordRegistryKey({home, registryPath, wxid: 'wxid_demo', entry: 'message/message_0.db', hex: 'ab'.repeat(32)}), /multiple database containers/);
  await assert.rejects(readFile(registryPath), /ENOENT/);
});

function runCli(args, input = '') {
  return new Promise(resolve => {
    const child = execFile(process.execPath, [fileURLToPath(new URL('./wechat-key-collect.mjs', import.meta.url)), ...args],
      {timeout: 10_000}, (error, stdout, stderr) => resolve({code: error?.code ?? 0, stdout, stderr}));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

test("the key recorder uses stdin and refuses unsupported, incomplete and conflicting CLI options", async t => {
  const home = await mkdtemp(path.join(tmpdir(), "wechat-record-cli-"));
  t.after(() => rm(home, {recursive: true, force: true}));
  const registryPath = path.join(home, 'store.json'), key = 'ab'.repeat(32);
  const base = ['--home', home, '--out', registryPath];
  for (const args of [
    ['--capture'], ['--out', '--check'], ['--set', 'wxid_demo'],
    ['--set', 'wxid_demo', 'message/message_0.db', key], ['--check', '--check'],
    ['--set', 'wxid_demo', 'message/message_0.db', '--no-validate'],
    ['--capture', 'wxid_demo', '--check'], ['--capture', 'wxid_demo', '--lldb'],
  ]) {
    const result = await runCli([...base, ...args]);
    assert.notEqual(result.code, 0);
    assert.ok(!result.stderr.includes(key));
    await assert.rejects(readFile(registryPath), /ENOENT/);
  }
  const args = [...base, '--set', 'wxid_demo', 'message/message_0.db'];
  for (const input of ['', 'not a key', key + '\n' + key, 'a'.repeat(257)]) {
    assert.notEqual((await runCli(args, input)).code, 0);
    await assert.rejects(readFile(registryPath), /ENOENT/);
  }
  const recorded = await runCli(args, key + '\n');
  assert.equal(recorded.code, 0, recorded.stderr);
  assert.ok(!recorded.stdout.includes(key) && !recorded.stderr.includes(key));
  assert.equal(JSON.parse(await readFile(registryPath, 'utf8')).accounts.wxid_demo.keys['message/message_0.db'], key);
});

test('the key recorder CLI also runs from paths containing spaces', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'wechat key path '));
  t.after(() => rm(home, {recursive: true, force: true}));
  const script = path.join(home, 'key collector.mjs');
  await copyFile(new URL('./wechat-key-collect.mjs', import.meta.url), script);
  await copyFile(new URL('./wechat-key-auth.mjs', import.meta.url), path.join(home, 'wechat-key-auth.mjs'));
  const result = await new Promise(resolve => {
    execFile(process.execPath, [script, '--capture'], {timeout: 10_000}, (error, stdout, stderr) => resolve({error, stdout, stderr}));
  });
  assert.equal(result.error?.code, 1);
  assert.match(result.stderr, /Unknown or incomplete/);
});

test('a canonical account ID resolves the authenticated Desktop container suffix', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'wechat-canonical-key-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const dbDir = path.join(home, 'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_demo_a1b2/db_storage');
  await mkdir(path.join(dbDir, 'head_image'), {recursive: true});
  await copyFile(new URL('../../packages/wechat/test/fixtures/wechat/head_image.db', import.meta.url), path.join(dbDir, 'head_image/head_image.db'));
  const key = (await readFile(new URL('../../packages/wechat/test/fixtures/wechat/head_image.key', import.meta.url), 'utf8')).trim();
  const registryPath = path.join(home, 'store.json');
  await recordRegistryKey({home, registryPath, wxid: 'wxid_demo', entry: 'head_image/head_image.db', hex: key});
  assert.equal(JSON.parse(await readFile(registryPath, 'utf8')).accounts.wxid_demo.dbDir, dbDir);
});
