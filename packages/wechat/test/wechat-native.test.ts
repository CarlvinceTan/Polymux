import assert from "node:assert/strict";
import {createCipheriv, createHmac, pbkdf2Sync, randomBytes} from "node:crypto";
import {chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import type {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {
  defaultWeChatStoreRegistryPath,
  resolveWeChatAccounts,
  SqlcipherLiveSnapshot,
  weChatKindFromLocalType,
  weChatMessageTable,
  WeChatNativeStore,
} from "../src/wechat-native-store.js";
import {
  committedWalFrames,
  isKeyFor,
  walIndexSaysEmpty,
} from "../../../scripts/wechat/wechat-snapshot-worker.mjs";
import {nativeRowToMessage} from "../src/wechat-wal-stream.js";

test("local message types map to bridge kinds without masquerading unknowns", () => {
  assert.equal(weChatKindFromLocalType(1), "text");
  assert.equal(weChatKindFromLocalType(3), "image");
  assert.equal(weChatKindFromLocalType(34), "audio");
  assert.equal(weChatKindFromLocalType(43), "video");
  assert.equal(weChatKindFromLocalType(47), "emoticon");
  assert.equal(weChatKindFromLocalType(49), "appmsg");
  assert.equal(weChatKindFromLocalType(10000), "system");
  assert.equal(weChatKindFromLocalType(10002), "recalled");
  assert.equal(weChatKindFromLocalType(99999), "99999");
});

test("chat tables are addressed by chat id digest", () => {
  const table = weChatMessageTable("filehelper");
  assert.match(table, /^Msg_[0-9a-f]{32}$/);
  assert.equal(table, weChatMessageTable("filehelper"));
  assert.notEqual(table, weChatMessageTable("other"));
});

test("a torn or foreign WAL is null, never a partial commit", () => {
  assert.equal(committedWalFrames(Buffer.alloc(0)), null);
  assert.equal(committedWalFrames(Buffer.alloc(64)), null);
  assert.equal(walIndexSaysEmpty(Buffer.alloc(0)), false);
  assert.equal(walIndexSaysEmpty(Buffer.alloc(96)), false);
});

test("a wrong key never authenticates a database page", () => {
  assert.equal(isKeyFor(Buffer.alloc(0), Buffer.alloc(32)), false);
  assert.equal(isKeyFor(Buffer.alloc(4096), Buffer.alloc(32)), false);
  assert.equal(isKeyFor(Buffer.alloc(4096), Buffer.alloc(16)), false);
});

test("native rows map to watcher messages without loss", () => {
  const message = nativeRowToMessage({
    local_id: 7,
    server_id: "123",
    local_type: 1,
    create_time: 1788665978,
    real_sender_id: 2,
    sender_wxid: "wxid_me",
    message_kind: "text",
    message_content: "hello",
  }, "filehelper");
  assert.deepEqual(message, {
    chatId: "filehelper",
    localId: 7,
    serverId: "123",
    timestamp: 1788665978,
    realSenderId: 2,
    senderWxid: "wxid_me",
    kind: "text",
    body: "hello",
  });
});

test("account discovery never touches a real conversation", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "wechat-native-home-"));
  const registryPath = path.join(home, "store.json");
  await writeFile(registryPath, JSON.stringify({accounts: {
    wxid_demo: {dbDir: path.join(home, "db"), keys: {"message/message_0.db": "ab".repeat(32)}},
    "not-a-wxid": {dbDir: path.join(home, "db"), keys: {}},
    wxid_bad: {dbDir: path.join(home, "db"), keys: {"message/message_0.db": "not-hex"}},
  }}));
  const accounts = await resolveWeChatAccounts({home, registryPath, excludeLegacyRegistry: true});
  const demo = accounts.find((account) => account.wxid === "wxid_demo");
  assert.ok(demo);
  assert.equal(demo.keys.get("message/message_0.db")?.toString("hex"), "ab".repeat(32));
  assert.ok(!accounts.some((account) => account.wxid === "not-a-wxid"));
  const store = new WeChatNativeStore(demo);
  assert.deepEqual(store.messageShards(), ["message/message_0.db"]);
  assert.equal(await store.shardOf("filehelper").catch(() => "unreachable"), null);
  await store.close();
});

test("the registry path stays platform-local", () => {
  assert.match(defaultWeChatStoreRegistryPath("/tmp/home"), /store\.json$/);
});

test("optional names tolerate an unprovisioned contact store", async () => {
  const store = new WeChatNativeStore({wxid: "wxid_fixture", dbDir: "/unused-fixture", keys: new Map()});
  assert.deepEqual(await store.displayNames([]), new Map());
  assert.deepEqual(await store.displayNames(["filehelper"]), new Map());
  await store.close();
});

test("a directory-less registry record keeps the discovered root", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "wechat-native-root-"));
  const root = path.join(
    home, "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_demo/db_storage");
  await mkdir(path.join(root, "message"), {recursive: true});
  const registryPath = path.join(home, "store.json");
  await writeFile(registryPath, JSON.stringify({accounts: {
    // Hand-entered keys (`--set`) carry no directory; the live container wins.
    wxid_demo: {dbDir: "", keys: {"message/message_0.db": "ab".repeat(32)}},
    wxid_escaped: {dbDir: "/tmp", keys: {
      "../escape.db": "cd".repeat(32),
      "/abs.db": "cd".repeat(32),
      "message/message_0.db": "ef".repeat(32),
    }},
  }}));
  const accounts = await resolveWeChatAccounts({home, registryPath, excludeLegacyRegistry: true});
  const demo = accounts.find((account) => account.wxid === "wxid_demo");
  assert.ok(demo);
  assert.equal(demo.dbDir, root);
  const escaped = accounts.find((account) => account.wxid === "wxid_escaped");
  assert.ok(escaped);
  assert.deepEqual([...escaped.keys.keys()], ["message/message_0.db"]);
});

test("live snapshots are private to the process", () => {
  const live = new SqlcipherLiveSnapshot(
    path.join(tmpdir(), "wechat-snapshot-check.db"), Buffer.alloc(32));
  assert.match(live.file, new RegExp(`-p${process.pid}\\.db$`));
});

const SNAP_PAGE = 4096;

function pageNumberLE(number: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(number);
  return buffer;
}

/**
 * Test-only SQLCipher page encryption, the exact mirror of the worker's
 * decrypt: page one's salt stays plaintext, every body is AES-256-CBC, and
 * every page carries its IV and HMAC-SHA512. Reusing the live salt lets the
 * same helper build WAL frames the worker accepts.
 */
function encryptPages(plain: Buffer, key: Buffer, salt: Buffer): Buffer {
  assert.equal(plain.length % SNAP_PAGE, 0);
  assert.ok(plain.length >= SNAP_PAGE);
  const macKey = pbkdf2Sync(key, Buffer.from(salt).map((byte) => byte ^ 0x3a), 2, 32, "sha512");
  const pages = plain.length / SNAP_PAGE;
  const out = Buffer.alloc(plain.length);
  for (let number = 1; number <= pages; number += 1) {
    const base = (number - 1) * SNAP_PAGE;
    const start = number === 1 ? 16 : 0;
    if (number === 1) salt.copy(out, 0);
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    cipher.setAutoPadding(false);
    const body = Buffer.concat([
      cipher.update(plain.subarray(base + start, base + SNAP_PAGE - 80)),
      cipher.final(),
    ]);
    body.copy(out, base + start);
    iv.copy(out, base + SNAP_PAGE - 80);
    createHmac("sha512", macKey)
      .update(out.subarray(base + start, base + SNAP_PAGE - 64))
      .update(pageNumberLE(number))
      .digest()
      .copy(out, base + SNAP_PAGE - 64);
  }
  return out;
}

function walChecksum(bytes: Buffer, initial: [number, number] = [0, 0]): [number, number] {
  let [a, b] = initial;
  for (let offset = 0; offset < bytes.length; offset += 8) {
    a = (a + bytes.readUInt32LE(offset) + b) >>> 0;
    b = (b + bytes.readUInt32LE(offset + 4) + a) >>> 0;
  }
  return [a, b];
}

/** A WAL the worker accepts: chained little-endian checksums, one commit. */
function buildWal(
  frames: Array<{pageNumber: number; page: Buffer; commitSize: number}>,
  salt1: number,
): Buffer {
  const header = Buffer.alloc(32);
  header.writeUInt32BE(0x377f0682, 0);
  header.writeUInt32BE(3007000, 4);
  header.writeUInt32BE(SNAP_PAGE, 8);
  header.writeUInt32BE(0, 12);
  header.writeUInt32BE(salt1, 16);
  header.writeUInt32BE(0x12345678, 20);
  let [a, b] = walChecksum(header.subarray(0, 24));
  header.writeUInt32BE(a, 24);
  header.writeUInt32BE(b, 28);
  const parts: Buffer[] = [header];
  for (const frame of frames) {
    const frameHeader = Buffer.alloc(24);
    frameHeader.writeUInt32BE(frame.pageNumber, 0);
    frameHeader.writeUInt32BE(frame.commitSize, 4);
    frameHeader.writeUInt32BE(salt1, 8);
    frameHeader.writeUInt32BE(0x12345678, 12);
    [a, b] = walChecksum(frameHeader.subarray(0, 8), [a, b]);
    [a, b] = walChecksum(frame.page, [a, b]);
    frameHeader.writeUInt32BE(a, 16);
    frameHeader.writeUInt32BE(b, 20);
    parts.push(frameHeader, frame.page);
  }
  return Buffer.concat(parts);
}

function readUsernames(live: SqlcipherLiveSnapshot): Promise<string[]> {
  return live.query((database: DatabaseSync) =>
    (database.prepare("SELECT username FROM head_image ORDER BY rowid").all() as Array<{username: string}>)
      .map((row) => row.username));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures", "wechat");

/**
 * The head_image fixture is a real SQLCipher file, so the decrypt, patch,
 * and rebuild below prove the worker against ground truth rather than a
 * stand-in. A handwritten database cannot serve: vanilla SQLite packs cells
 * into the page tail that SQLCipher reserves, so only a genuine store has
 * the layout the worker reads.
 */
async function withSnapshotHome(
  body: (dir: {main: string; key: Buffer; salt: Buffer}) => Promise<void>,
): Promise<void> {
  const home = await mkdtemp(path.join(tmpdir(), "wechat-snapshot-live-"));
  const main = path.join(home, "head_image.db");
  await copyFile(path.join(fixtures, "head_image.db"), main);
  const key = Buffer.from((await readFile(path.join(fixtures, "head_image.key"), "utf8")).trim(), "hex");
  const salt = Buffer.from((await readFile(main)).subarray(0, 16));
  try { await body({main, key, salt}); }
  finally { await rm(home, {recursive: true, force: true}); }
}

async function sourceState(files: readonly string[]): Promise<Array<{bytes: Buffer; mode: number}>> {
  return await Promise.all(files.map(async (file) => ({
    bytes: await readFile(file),
    mode: (await stat(file)).mode & 0o777,
  })));
}

/**
 * Every in-body, same-length occurrence is edited — the value lives in both
 * the table leaf and its autoindex, and moving both keeps the two in
 * agreement. The btree stays valid, only values move.
 */
function editedPage(plain: Buffer, from: string, to: string): Buffer {
  const needle = Buffer.from(from);
  const edited = Buffer.from(plain);
  let at = -1;
  let count = 0;
  while ((at = edited.indexOf(needle, at + 1)) !== -1) {
    assert.ok(at > SNAP_PAGE && (at % SNAP_PAGE) < SNAP_PAGE - 80, `${from} edit must stay in-body`);
    Buffer.from(to).copy(edited, at);
    count += 1;
  }
  assert.ok(count > 0, `${from} must occur`);
  return edited;
}

test("a snapshot decrypts a real store through the worker", async () => {
  await withSnapshotHome(async ({main, key}) => {
    const live = new SqlcipherLiveSnapshot(main, key);
    try {
      await live.open();
      const tables = await live.query((database) =>
        (database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name: string}>)
          .map((row) => row.name));
      assert.deepEqual(tables, ["head_image"]);
      assert.deepEqual(await readUsernames(live), ["wxid_friend", "44161457724@chatroom"]);
      assert.equal(await live.refresh(), false);
    } finally {
      await live.close();
    }
    await assert.rejects(readFile(live.file), /ENOENT/);
  });
});

test("a snapshot patches committed frames and rebuilds on checkpoint", async () => {
  await withSnapshotHome(async ({main, key, salt}) => {
    const live = new SqlcipherLiveSnapshot(main, key);
    try {
      await live.open();
      const plain = await readFile(live.file);
      const first = editedPage(plain, "wxid_friend", "wxid_frienD");
      const second = editedPage(first, "44161457724@chatroom", "44161457724@chatrooM");
      const page2 = (buffer: Buffer): Buffer => buffer.subarray(SNAP_PAGE, 2 * SNAP_PAGE);
      const walSalt = 0x0ddc0ffee >>> 0;
      // The first log generation rebuilds; extending it under the same salt
      // exercises the incremental patch path instead.
      await writeFile(`${main}-wal`, buildWal(
        [{pageNumber: 2, page: page2(encryptPages(first, key, salt)), commitSize: 3}],
        walSalt,
      ));
      assert.equal(await live.refresh(), true);
      assert.deepEqual(await readUsernames(live), ["wxid_frienD", "44161457724@chatroom"]);
      await writeFile(`${main}-wal`, buildWal(
        [
          {pageNumber: 2, page: page2(encryptPages(first, key, salt)), commitSize: 0},
          {pageNumber: 2, page: page2(encryptPages(second, key, salt)), commitSize: 3},
        ],
        walSalt,
      ));
      assert.equal(await live.refresh(), true);
      assert.deepEqual(await readUsernames(live), ["wxid_frienD", "44161457724@chatrooM"]);

      // A checkpoint absorbs the log into the main file; the copy rebuilds.
      await writeFile(main, encryptPages(await readFile(live.file), key, salt));
      await rm(`${main}-wal`, {force: true});
      assert.equal(await live.refresh(), true);
      assert.deepEqual(await readUsernames(live), ["wxid_frienD", "44161457724@chatrooM"]);
      assert.equal(await live.refresh(), false);
    } finally {
      await live.close();
    }
    await assert.rejects(readFile(live.file), /ENOENT/);
  });
});

test("a wrong key fails the open before any plaintext is written", async () => {
  await withSnapshotHome(async ({main}) => {
    const live = new SqlcipherLiveSnapshot(main, randomBytes(32));
    try {
      await assert.rejects(live.open(), /page authentication failed/);
    } finally {
      await live.close();
    }
    await assert.rejects(readFile(live.file), /ENOENT/);
  });
});

test("snapshot success, retry failure, and close never mutate encrypted sources", async () => {
  await withSnapshotHome(async ({main, key, salt}) => {
    const wal = `${main}-wal`;
    const shm = `${main}-shm`;
    const bootstrap = new SqlcipherLiveSnapshot(main, key);
    await bootstrap.open();
    const plain = await readFile(bootstrap.file);
    await bootstrap.close();
    const encrypted = encryptPages(editedPage(plain, "wxid_friend", "wxid_frienD"), key, salt);
    await writeFile(wal, buildWal([
      {pageNumber: 2, page: encrypted.subarray(SNAP_PAGE, 2 * SNAP_PAGE), commitSize: 3},
    ], 0x10203040));
    await writeFile(shm, Buffer.from("synthetic watcher index bytes"));
    await chmod(main, 0o640);
    await chmod(wal, 0o604);
    await chmod(shm, 0o444);
    const sources = [main, wal, shm];
    const before = await sourceState(sources);

    const live = new SqlcipherLiveSnapshot(main, key);
    try {
      await live.open();
      assert.equal(await live.refresh(), false);
      assert.deepEqual(await readUsernames(live), ["wxid_frienD", "44161457724@chatroom"]);
    } finally {
      await live.close();
    }

    const failing = new SqlcipherLiveSnapshot(main, randomBytes(32));
    try {
      await assert.rejects(failing.open(), /page authentication failed/);
    } finally {
      await failing.close();
    }
    assert.deepEqual(await sourceState(sources), before);
  });
});

test("two readers of one database own independent snapshots", async () => {
  await withSnapshotHome(async ({main, key}) => {
    const first = new SqlcipherLiveSnapshot(main, key);
    const second = new SqlcipherLiveSnapshot(main, key);
    try {
      await first.open();
      await second.open();
      await first.close();
      assert.deepEqual(await readUsernames(second), ["wxid_friend", "44161457724@chatroom"]);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});

test("a closed store can be explicitly relinked without reusing plaintext", async () => {
  await withSnapshotHome(async ({main, key}) => {
    const store = new WeChatNativeStore({wxid: "wxid_fixture", dbDir: path.dirname(main), keys: new Map([["head_image.db", key]])});
    try {
      const first = await store.snapshot("head_image.db");
      await store.close();
      await store.reopen();
      const second = await store.snapshot("head_image.db");
      assert.notEqual(second.file, first.file);
      await assert.rejects(readFile(first.file), /ENOENT/);
      assert.deepEqual(await readUsernames(second), ["wxid_friend", "44161457724@chatroom"]);
    } finally { await store.close(); }
  });
});

test("concurrent checkpoint refreshes and reads see a complete snapshot", async () => {
  await withSnapshotHome(async ({main, key, salt}) => {
    const live = new SqlcipherLiveSnapshot(main, key);
    try {
      await live.open();
      const plain = await readFile(live.file);
      await writeFile(main, encryptPages(editedPage(plain, "wxid_friend", "wxid_frienD"), key, salt));
      await Promise.all(Array.from({length: 12}, async () => {
        await live.refresh();
        assert.deepEqual(await readUsernames(live), ["wxid_frienD", "44161457724@chatroom"]);
      }));
    } finally {
      await live.close();
    }
  });
});

test("key replacement authenticates before publishing and preserves existing snapshot borrowers", async () => {
  await withSnapshotHome(async ({main, key}) => {
    const live = new SqlcipherLiveSnapshot(main, key);
    try {
      await live.open();
      const plain = await readFile(live.file);
      const before = await sourceState([main]);
      await assert.rejects(live.replaceKey(randomBytes(32)), /authentication failed/);
      assert.deepEqual(await readFile(live.file), plain);
      assert.deepEqual(await sourceState([main]), before);
      const replacement = randomBytes(32);
      const next = editedPage(plain, "wxid_friend", "wxid_frienD");
      await writeFile(main, encryptPages(next, replacement, randomBytes(16)));
      const rotated = await sourceState([main]);
      const update = live.replaceKey(replacement);
      const readers = Array.from({length: 6}, () => readUsernames(live));
      assert.equal(await update, true);
      for (const names of await Promise.all(readers))
        assert.deepEqual(names, ["wxid_frienD", "44161457724@chatroom"]);
      assert.equal(await live.refresh(), false);
      assert.deepEqual(await sourceState([main]), rotated);
      assert.equal(await live.replaceKey(replacement), false);
    } finally { await live.close(); }
  });
});

test("own registry reload admits authenticated shards and rotated keys while pinning the account", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "wechat-registry-reload-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const dbDir = path.join(root, "wxid_fixture", "db_storage");
  await mkdir(path.join(dbDir, "message"), {recursive: true});
  const registryPath = path.join(root, "store.json");
  const first = "message/message_0.db", second = "message/message_1.db";
  const key = Buffer.from((await readFile(path.join(fixtures, "head_image.key"), "utf8")).trim(), "hex");
  await copyFile(path.join(fixtures, "head_image.db"), path.join(dbDir, first));
  await copyFile(path.join(fixtures, "head_image.db"), path.join(dbDir, second));
  const registry = (keys: Record<string, string>) => ({accounts: {wxid_fixture: {dbDir, keys}}});
  const save = async (value: unknown) => writeFile(registryPath, JSON.stringify(value), {mode: 0o600});
  await save(registry({[first]: key.toString("hex")}));
  const store = new WeChatNativeStore({wxid: "wxid_fixture", dbDir, keys: new Map([[first, key]])},
    {registryPath, registryRefreshMs: 0});
  t.after(() => store.close());
  const borrowed = await store.snapshot(first);
  const plain = await readFile(borrowed.file);
  const sources = [path.join(dbDir, first), path.join(dbDir, second)];
  const before = await sourceState(sources);

  await save(registry({[first]: randomBytes(32).toString("hex"), [second]: key.toString("hex")}));
  await assert.rejects(store.refreshRegistry(true), /could not be authenticated/);
  assert.deepEqual(store.messageShards(), [first, second]);
  assert.equal(store.keyGeneration(first), 0);
  assert.equal(store.keyGeneration(second), 1);
  assert.deepEqual(await readUsernames(borrowed), ["wxid_friend", "44161457724@chatroom"]);
  assert.deepEqual(await sourceState(sources), before);

  const nextKey = randomBytes(32);
  await writeFile(sources[0], encryptPages(editedPage(plain, "wxid_friend", "wxid_frienD"), nextKey, randomBytes(16)));
  await save(registry({[first]: nextKey.toString("hex"), [second]: key.toString("hex")}));
  const rotated = await sourceState(sources);
  assert.equal(await store.refreshRegistry(true), true);
  assert.equal(await store.snapshot(first), borrowed);
  assert.equal(store.keyGeneration(first), 1);
  assert.deepEqual(await readUsernames(borrowed), ["wxid_frienD", "44161457724@chatroom"]);
  assert.deepEqual(await sourceState(sources), rotated);

  const revision = store.registryRevision;
  await writeFile(registryPath, '{"accounts":');
  await assert.rejects(store.refreshRegistry(true), /unavailable or invalid/);
  await save({accounts: {wxid_other: {dbDir, keys: {[first]: nextKey.toString("hex")}}}});
  await assert.rejects(store.refreshRegistry(true), /cannot change/);
  await save({accounts: {wxid_fixture: {dbDir: path.join(root, "foreign"), keys: {}}}});
  await assert.rejects(store.refreshRegistry(true), /cannot change/);
  await save({accounts: {...registry({}).accounts, wxid_other: {dbDir, keys: {}}}});
  await assert.rejects(store.refreshRegistry(true), /same single account/);
  assert.equal(store.registryRevision, revision);
  assert.deepEqual(store.messageShards(), [first, second]);

  await save(registry({[first]: nextKey.toString("hex"), [second]: key.toString("hex")}));
  const retired = await store.snapshot(second);
  await save(registry({[first]: nextKey.toString("hex")}));
  assert.equal(await store.refreshRegistry(true), true);
  assert.equal(store.has(second), false);
  await assert.rejects(readFile(retired.file), /ENOENT/);
  await save(registry({[first]: nextKey.toString("hex"), [second]: key.toString("hex")}));
  await store.refreshRegistry(true);
  assert.equal(store.keyGeneration(second), 3);
  assert.deepEqual(await sourceState(sources), rotated);
});

test("closing during key admission drains the candidate worker and removes its private copy", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "wechat-registry-close-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const registryPath = path.join(root, "store.json");
  const workerPath = path.join(root, "delayed-worker.mjs");
  const entered = path.join(root, "entered.json");
  await writeFile(workerPath, `
import {parentPort, workerData} from 'node:worker_threads';
import {writeFile} from 'node:fs/promises';
parentPort.on('message', async () => {
  await writeFile(workerData.snapshotFile, 'temporary fixture copy', {mode: 0o600});
  await writeFile(${JSON.stringify(entered)}, JSON.stringify({file: workerData.snapshotFile}));
});
`);
  await writeFile(registryPath, JSON.stringify({accounts: {wxid_fixture: {
    dbDir: root, keys: {"message/message_0.db": randomBytes(32).toString("hex")},
  }}}));
  const store = new WeChatNativeStore({wxid: "wxid_fixture", dbDir: root, keys: new Map()},
    {registryPath, workerPath});
  t.after(() => store.close());
  const admission = store.refreshRegistry(true);
  const rejected = assert.rejects(admission, /could not be authenticated/);
  let marker: {file: string} | null = null;
  const deadline = Date.now() + 2_000;
  while (!marker && Date.now() < deadline) {
    marker = await readFile(entered, "utf8").then(raw => JSON.parse(raw) as {file: string}, (): null => null);
    if (!marker) await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(marker, "the candidate worker must be active before closing it");
  await store.close();
  await rejected;
  assert.deepEqual(store.messageShards(), []);
  await assert.rejects(readFile(marker.file), /ENOENT/);
  assert.equal(await store.refreshRegistry(true), false);
});


test("account storage suffix is excluded from native sender identity", () => {
  const store = new WeChatNativeStore({wxid:"wxid_abc123_abcd", dbDir:"/fixture/wxid_abc123_abcd/db_storage", keys:new Map()});
  assert.equal(store.wxid,"wxid_abc123");
  const exact = new WeChatNativeStore({wxid:"wxid_abc123", dbDir:"/fixture/wxid_abc123/db_storage", keys:new Map()});
  assert.equal(exact.wxid,"wxid_abc123");
  const unmatched = new WeChatNativeStore({wxid:"wxid_abc123_abcd", dbDir:"/fixture/another/db_storage", keys:new Map()});
  assert.equal(unmatched.wxid,"wxid_abc123_abcd");
});
