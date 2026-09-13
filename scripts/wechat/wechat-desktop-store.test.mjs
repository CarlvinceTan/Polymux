import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {DatabaseSync} from "node:sqlite";
import {zstdCompressSync} from "node:zlib";
import {decryptDesktopSnapshot, loadDesktopFile, loadDesktopStickers, nativeGroupInfo, nativeMessageSource, nativeSessionReadStates, nativeVideoDigest, readDesktopVideoCache, nativeVoiceData, nativeWalIsEmpty} from "./wechat-desktop-store.mjs";

test('native video resource requires the exact message and one structured digest', () => {
  const db=new DatabaseSync(':memory:'), digest='ab'.repeat(16);
  const request={chatId:'filehelper',serverId:'9072123356052134871',localId:'223',createTime:1788662525};
  try {
    db.exec(`CREATE TABLE ChatName2Id(user_name TEXT); INSERT INTO ChatName2Id VALUES('filehelper'),('another');
      CREATE TABLE MessageResourceInfo(chat_id INTEGER,message_local_id INTEGER,message_svr_id INTEGER,message_create_time INTEGER,message_local_type INTEGER,packed_info BLOB);`);
    const insert=db.prepare('INSERT INTO MessageResourceInfo VALUES(1,223,9072123356052134871,1788662525,43,?)');
    insert.run(Buffer.concat([Buffer.from([0x12,0x22,0x0a,0x20]),Buffer.from(digest)]));
    assert.equal(nativeVideoDigest(db,request),digest);
    for(const changed of [{chatId:'another'},{localId:'224'},{serverId:'9072123356052134872'},{createTime:1788662526}])
      assert.equal(nativeVideoDigest(db,{...request,...changed}),null);
    db.prepare('UPDATE MessageResourceInfo SET packed_info=?').run(Buffer.from('arbitrary '+digest));
    assert.equal(nativeVideoDigest(db,request),null);
    db.exec('UPDATE MessageResourceInfo SET packed_info=NULL');
    assert.equal(nativeVideoDigest(db,request),null);
    db.prepare('UPDATE MessageResourceInfo SET packed_info=?').run(Buffer.concat([Buffer.from([0x12,0x22,0x0a,0x20]),Buffer.from(digest)]));
    insert.run(Buffer.concat([Buffer.from([0x12,0x22,0x0a,0x20]),Buffer.from(digest)]));
    assert.equal(nativeVideoDigest(db,request),null, 'duplicate resource identities are ambiguous');
  } finally {db.close();}
});

test('video cache chooses an original and rejects swapped bytes, thumbnails and escaping paths', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'wechat-video-cache-'));
  const digest='ab'.repeat(16), directory=path.join(root,'msg/video/2026-09');
  const bytes=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom'),Buffer.alloc(64)]);
  const request={serverId:'123',size:bytes.length,md5:createHash('md5').update(bytes).digest('hex')};
  try {
    await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,`${digest}_thumb.jpg`),bytes);
    assert.equal(await readDesktopVideoCache(root,digest,request),null);
    const original=path.join(directory,`${digest}_raw.mp4`);await writeFile(original,bytes);
    assert.equal((await readDesktopVideoCache(root,digest,request))?.localPath,await realpath(original));
    assert.equal(await readDesktopVideoCache(root,digest,{...request,md5:'0'.repeat(32)}),null);
    assert.equal(await readDesktopVideoCache(root,'../escape',request),null);
    await rm(original);const outside=path.join(root,'..',`outside-${path.basename(root)}.mp4`);
    await writeFile(outside,bytes);
    try {await symlink(outside,original);assert.equal(await readDesktopVideoCache(root,digest,request),null);}
    finally {await rm(outside,{force:true});}
  } finally {await rm(root,{recursive:true,force:true});}
});

test("group settings use the shared native name and reject private labels or missing membership", () => {
  const store = new DatabaseSync(":memory:");
  try {
    store.exec("CREATE TABLE contact(username TEXT,nick_name TEXT,remark TEXT,is_in_chat_room INTEGER,delete_flag INTEGER); INSERT INTO contact VALUES ('123456@chatroom','学习小组 🐷','My private label',1,0)");
    assert.deepEqual(nativeGroupInfo(store, "123456@chatroom"), {chatId: "123456@chatroom", name: "学习小组 🐷", isMember: true});
    for (const chatId of ["filehelper", "123457@chatroom", "123456@chatroom' OR 1=1"])
      assert.throws(() => nativeGroupInfo(store, chatId));
    store.exec("UPDATE contact SET is_in_chat_room=0");
    assert.equal(nativeGroupInfo(store, "123456@chatroom").isMember, false);
    store.exec("UPDATE contact SET is_in_chat_room=1,delete_flag=1");
    assert.equal(nativeGroupInfo(store, "123456@chatroom").isMember, false);
  } finally {store.close();}
});

test("compressed mention metadata requires the exact chat, server id, local id and time", () => {
  const store = new DatabaseSync(":memory:");
  const identity = {chatId: "123456@chatroom", serverId: "1167859275151065185", localId: "50", timestamp: 1788665978};
  const table = `Msg_${createHash("md5").update(identity.chatId).digest("hex")}`;
  const source = "<msgsource><atuserlist>wxid_me</atuserlist></msgsource>";
  try {
    store.exec(`CREATE TABLE ${table}(server_id INTEGER,local_id INTEGER,create_time INTEGER,source BLOB,WCDB_CT_source INTEGER)`);
    const insert = store.prepare(`INSERT INTO ${table} VALUES (CAST(? AS INTEGER),?,?,?,?)`);
    insert.run(identity.serverId, 50, identity.timestamp, zstdCompressSync(Buffer.from(source)), 4);
    assert.equal(nativeMessageSource(store, identity), source);
    for (const other of [{chatId: "123457@chatroom"}, {serverId: "1167859275151065186"}, {localId: "51"}, {timestamp: identity.timestamp + 1}])
      assert.equal(nativeMessageSource(store, {...identity, ...other}), null);
    assert.throws(() => nativeMessageSource(store, {...identity, chatId: "x;DROP TABLE"}), /identity/);
    store.prepare(`UPDATE ${table} SET source=?`).run(zstdCompressSync(Buffer.alloc(65537, 120)));
    assert.throws(() => nativeMessageSource(store, identity), /larger than|output length|buffer/i);
    store.prepare(`UPDATE ${table} SET source=?,WCDB_CT_source=NULL`).run(source);
    assert.equal(nativeMessageSource(store, identity), source);
    insert.run(identity.serverId, 50, identity.timestamp, source, null);
    assert.throws(() => nativeMessageSource(store, identity), /ambiguous/);
  } finally {store.close();}
});

test("a zero-server-id voice requires its exact conversation, local row and timestamp", () => {
  const store = new DatabaseSync(":memory:");
  const bytes = Buffer.from("\x02#!SILK_V3fixture");
  const identity = {chatId: "filehelper", serverId: "9072123356052134871", localId: "223", createTime: 1788662525};
  try {
    store.exec(`CREATE TABLE Name2Id(user_name TEXT PRIMARY KEY);
      CREATE TABLE VoiceInfo(chat_name_id INTEGER,create_time INTEGER,local_id INTEGER,svr_id INTEGER,voice_data BLOB);
      INSERT INTO Name2Id VALUES ('filehelper'),('another_chat');`);
    const insert = store.prepare("INSERT INTO VoiceInfo VALUES (?,?,?,?,?)");
    insert.run(1, identity.createTime, 223, 0, bytes);
    insert.run(2, identity.createTime, 223, 0, Buffer.from("wrong conversation"));
    assert.deepEqual(nativeVoiceData(store, identity), bytes);
    assert.equal(nativeVoiceData(store, {...identity, localId: "224"}), null);
    assert.equal(nativeVoiceData(store, {...identity, createTime: identity.createTime + 1}), null);
    store.exec("UPDATE VoiceInfo SET svr_id=123 WHERE chat_name_id=1");
    assert.equal(nativeVoiceData(store, identity), null, "a different known server id must never use the local fallback");
    store.exec("UPDATE VoiceInfo SET svr_id=9072123356052134871 WHERE chat_name_id=1");
    assert.deepEqual(nativeVoiceData(store, identity), bytes);
    insert.run(1, identity.createTime, 223, 0, bytes);
    assert.throws(() => nativeVoiceData(store, identity), /ambiguous/);
  } finally {store.close();}
});

test("headerless native voice packets decode identically and malformed boundaries are rejected", async () => {
  const {encode, decode} = await import("silk-wasm");
  const pcm = Buffer.alloc(24_000 * 2 / 5);
  for (let n = 0; n < pcm.length / 2; n++) pcm.writeInt16LE(Math.round(3000 * Math.sin(n * 2 * Math.PI * 440 / 24000)), n * 2);
  const encoded = Buffer.from((await encode(pcm, 24000)).data);
  assert.equal(encoded.subarray(0, 10).toString("binary"), "\x02#!SILK_V3");
  const raw = encoded.subarray(10), before = Buffer.from(raw);
  const store = new DatabaseSync(":memory:");
  const identity = {chatId: "filehelper", serverId: "9072123356052134871", localId: "223", createTime: 1788662525};
  try {
    store.exec(`CREATE TABLE Name2Id(user_name TEXT); INSERT INTO Name2Id VALUES('filehelper');
      CREATE TABLE VoiceInfo(chat_name_id INTEGER,create_time INTEGER,local_id INTEGER,svr_id INTEGER,voice_data BLOB);`);
    store.prepare('INSERT INTO VoiceInfo VALUES(1,1788662525,223,9072123356052134871,?)').run(raw);
    const restored = nativeVoiceData(store, identity);
    assert.deepEqual(restored, encoded);
    assert.deepEqual((await decode(restored, 24000)).data, (await decode(encoded, 24000)).data);
    assert.deepEqual(raw, before, "normalizing never changes the native payload");
    assert.deepEqual(Buffer.from(store.prepare('SELECT voice_data FROM VoiceInfo').get().voice_data), before);
    for (const invalid of [Buffer.alloc(0), raw.subarray(0, raw.length - 1), Buffer.from([0]),
      Buffer.from([0, 0]), Buffer.from([255, 255]), Buffer.from([5, 0, 1]),
      Buffer.concat(Array.from({length: 4097}, () => Buffer.from([1, 0, 1])))]) {
      store.prepare('UPDATE VoiceInfo SET voice_data=?').run(invalid);
      assert.throws(() => nativeVoiceData(store, identity), /voice payload is invalid/);
    }
  } finally {store.close();}
});

test("native file cache matching requires the account, bytes and contained path", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "wechat-native-file-test-"));
  try {
    const account = path.join(home, "wxid_fixture_1234");
    const registry = path.join(home, ".wx-rs");
    const createTime = 1788662561;
    const date = new Date(createTime * 1000);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const cache = path.join(account, "msg/file", month);
    await mkdir(cache, {recursive: true}); await mkdir(registry);
    await writeFile(path.join(registry, "config.json"), JSON.stringify({account_wxid: "wxid_fixture_1234",
      db_dir: path.join(account, "db_storage"), key_file: path.join(registry, "key.hex")}));
    const bytes = Buffer.from("exact native test attachment");
    const file = path.join(cache, "sample.mp4");
    await writeFile(file, bytes);
    const options = {home, accountWxid: "wxid_fixture"};
    const request = {name: "sample.mp4", createTime, size: bytes.length, md5: createHash("md5").update(bytes).digest("hex")};
    assert.equal((await loadDesktopFile(options, request))?.localPath, await realpath(file));
    assert.equal(await loadDesktopFile(options, {...request, md5: "0".repeat(32)}), null);
    assert.equal(await loadDesktopFile(options, {...request, name: "../sample.mp4"}), null);
    await assert.rejects(loadDesktopFile({...options, accountWxid: "wxid_other"}, request), /different account/);
    const outside = path.join(home, "outside.mp4");
    await writeFile(outside, bytes); await rm(file); await symlink(outside, file);
    assert.equal(await loadDesktopFile(options, request), null);
  } finally {await rm(home, {recursive: true, force: true});}
});

test("manual unread survives a zero message count without confusing other native flags", () => {
  const store = new DatabaseSync(":memory:");
  try {
    store.exec(`CREATE TABLE SessionTable(username TEXT, unread_count INTEGER, status INTEGER);
      INSERT INTO SessionTable VALUES ('manual', 0, 4096), ('messages', 7, 4096), ('read', 0, 32), ('combined', 0, 4128);`);
    assert.deepEqual(nativeSessionReadStates(store), [
      {chatId: "manual", unreadCount: 0, markedUnread: true},
      {chatId: "messages", unreadCount: 7, markedUnread: true},
      {chatId: "read", unreadCount: 0, markedUnread: false},
      {chatId: "combined", unreadCount: 0, markedUnread: true},
    ]);
    store.exec("UPDATE SessionTable SET status = 32 WHERE username = 'combined'");
    assert.deepEqual(nativeSessionReadStates(store).at(-1), {chatId: "combined", unreadCount: 0, markedUnread: false});
    for (const value of ["NULL", "-1", "'invalid'", "1.5"]) {
      store.exec(`UPDATE SessionTable SET status = ${value} WHERE username = 'combined'`);
      assert.throws(() => nativeSessionReadStates(store), /invalid/);
    }
  } finally {store.close();}
});

const fixture = new URL("./fixtures/wechat-desktop-store/", import.meta.url);
const main = await readFile(new URL("catalog.db", fixture));
const wal = await readFile(new URL("catalog.db-wal", fixture));
const key = Buffer.alloc(32, 0x11);

test("only a validated empty WAL index permits ignoring stale reset frames", async () => {
  const index = await readFile(new URL("empty-wal-index.bin", fixture));
  assert.equal(nativeWalIsEmpty(index), true);
  assert.equal(nativeWalIsEmpty(index.subarray(0, 48)), false);
  const torn = Buffer.from(index); torn[8] ^= 1;
  assert.equal(nativeWalIsEmpty(torn), false);
  const corrupt = Buffer.from(index); corrupt[8] ^= 1; corrupt[56] ^= 1;
  assert.equal(nativeWalIsEmpty(corrupt), false);
  const nonempty = Buffer.from(index); nonempty.writeUInt32LE(1, 16); nonempty.writeUInt32LE(1, 64);
  assert.equal(nativeWalIsEmpty(nonempty), false);
});

test("authenticates an independently generated SQLCipher database and its committed WAL", () => {
  const before = decryptDesktopSnapshot(main, Buffer.alloc(0), key);
  const after = decryptDesktopSnapshot(main, wal, key);
  assert.equal(after.subarray(0, 16).toString(), "SQLite format 3\0");
  assert.notDeepEqual(before, after, "committed stickers must not disappear behind the main file");
  assert.throws(() => decryptDesktopSnapshot(main, wal, Buffer.alloc(32, 0x22)), /authentication/);
  const corrupt = Buffer.from(main); corrupt[160] ^= 1;
  assert.throws(() => decryptDesktopSnapshot(corrupt, Buffer.alloc(0), key), /authentication/);
  const corruptWal = Buffer.from(wal); corruptWal[100] ^= 1;
  assert.throws(() => decryptDesktopSnapshot(main, corruptWal, key), /checksum/);
  // The last frame carries the commit marker. A partially written frame is
  // ignored along with the earlier uncommitted frames in that transaction.
  assert.deepEqual(decryptDesktopSnapshot(main, wal.subarray(0, wal.length - 1), key), before);
});

test("loads favorites from the matching account, retaining exact escaped CDN references", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "polymux-wechat-store-test-"));
  try {
    const registry = path.join(home, ".wx-rs");
    const db = path.join(home, "wxid_fixture_1234", "db_storage");
    await mkdir(registry, {recursive: true});
    await mkdir(path.join(db, "emoticon"), {recursive: true});
    await writeFile(path.join(registry, "config.json"), JSON.stringify({
      account_wxid: "wxid_fixture_1234", db_dir: db, key_file: path.join(registry, "key.hex"),
    }));
    await writeFile(path.join(registry, "keys.json"), JSON.stringify({entries: {
      "emoticon/emoticon.db": {key_hex: key.toString("hex")},
    }}));
    await writeFile(path.join(db, "emoticon/emoticon.db"), main);
    await writeFile(path.join(db, "emoticon/emoticon.db-wal"), wal);
    const entries = await loadDesktopStickers({home, accountWxid: "wxid_fixture"});
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, "a".repeat(32));
    assert.match(entries[0].xml, /cdnurl="https:\/\/example.com\/sticker\?a=1&amp;b=2"/);
    await assert.rejects(loadDesktopStickers({home, accountWxid: "wxid_other"}), /different account/);
    assert.deepEqual(await readFile(path.join(db, "emoticon/emoticon.db")), main);
    assert.deepEqual(await readFile(path.join(db, "emoticon/emoticon.db-wal")), wal);
  } finally {await rm(home, {recursive: true, force: true});}
});
