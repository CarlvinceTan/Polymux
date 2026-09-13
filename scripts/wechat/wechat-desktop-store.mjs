import {createDecipheriv, createHash, createHmac, pbkdf2Sync, timingSafeEqual} from "node:crypto";
import {mkdtemp, readFile, readdir, realpath, rm, stat, writeFile} from "node:fs/promises";
import {homedir, tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {zstdDecompressSync} from "node:zlib";

import {desktopAccount} from "./wechat-account-registry.mjs";

const PAGE = 4096;
const RESERVE = 80;
const MAX_BYTES = 128 * 1024 * 1024;

function checksum(bytes, bigEndian, initial = [0, 0]) {
  let [a, b] = initial;
  for (let offset = 0; offset < bytes.length; offset += 8) {
    a = (a + (bigEndian ? bytes.readUInt32BE(offset) : bytes.readUInt32LE(offset)) + b) >>> 0;
    b = (b + (bigEndian ? bytes.readUInt32BE(offset + 4) : bytes.readUInt32LE(offset + 4)) + a) >>> 0;
  }
  return [a, b];
}

/** SQLite's WAL checksum covers the header and a running chain of frames.
 * Retain only frames through the last commit; an unfinished transaction is
 * never part of the catalog. https://sqlite.org/fileformat.html#walformat */
function committedPages(wal) {
  if (!wal?.length) return {pages: new Map(), size: 0};
  if (wal.length < 32) throw new Error("WeChat catalog WAL is incomplete");
  const magic = wal.readUInt32BE(0);
  if (![0x377f0682, 0x377f0683].includes(magic) || wal.readUInt32BE(4) !== 3007000 || wal.readUInt32BE(8) !== PAGE)
    throw new Error("WeChat catalog WAL format is unsupported");
  const bigEndian = magic === 0x377f0683;
  let sum = checksum(wal.subarray(0, 24), bigEndian);
  if (sum[0] !== wal.readUInt32BE(24) || sum[1] !== wal.readUInt32BE(28))
    throw new Error("WeChat catalog WAL header checksum failed");
  const frames = [];
  let committed = 0, size = 0;
  for (let offset = 32; offset + 24 + PAGE <= wal.length; offset += 24 + PAGE) {
    const header = wal.subarray(offset, offset + 24);
    // SQLite can retain frames from the previous WAL generation after reset.
    if (!header.subarray(8, 16).equals(wal.subarray(16, 24))) break;
    const page = wal.subarray(offset + 24, offset + 24 + PAGE);
    sum = checksum(page, bigEndian, checksum(header.subarray(0, 8), bigEndian, sum));
    if (sum[0] !== header.readUInt32BE(16) || sum[1] !== header.readUInt32BE(20))
      throw new Error("WeChat catalog WAL frame checksum failed");
    const number = header.readUInt32BE(0), commitSize = header.readUInt32BE(4);
    if (!number || number * PAGE > MAX_BYTES || commitSize * PAGE > MAX_BYTES)
      throw new Error("WeChat catalog WAL page is invalid");
    frames.push([number, page]);
    if (commitSize) {committed = frames.length; size = commitSize;}
  }
  return {pages: new Map(frames.slice(0, committed)), size};
}

/** Decrypt a stable SQLCipher 4 snapshot with the already provisioned raw
 * key. Every used page must authenticate before SQLite sees any plaintext. */
export function decryptDesktopSnapshot(main, wal, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || main.length < PAGE ||
      main.length % PAGE || main.length > MAX_BYTES)
    throw new Error("WeChat catalog database format is unsupported");
  const salt = main.subarray(0, 16);
  const hmacSalt = Buffer.from(salt).map((byte) => byte ^ 0x3a);
  const macKey = pbkdf2Sync(key, hmacSalt, 2, 32, "sha512");
  const committed = committedPages(wal);
  const count = committed.size || main.length / PAGE;
  const plain = Buffer.alloc(count * PAGE);
  for (let number = 1; number <= count; number += 1) {
    const page = committed.pages.get(number) ?? main.subarray((number - 1) * PAGE, number * PAGE);
    if (page.length !== PAGE) throw new Error("WeChat catalog snapshot is missing a page");
    const start = number === 1 ? 16 : 0;
    const pageNumber = Buffer.alloc(4); pageNumber.writeUInt32LE(number);
    const mac = createHmac("sha512", macKey).update(page.subarray(start, PAGE - 64)).update(pageNumber).digest();
    if (!timingSafeEqual(mac, page.subarray(PAGE - 64)))
      throw new Error("WeChat catalog page authentication failed");
    const decipher = createDecipheriv("aes-256-cbc", key, page.subarray(PAGE - RESERVE, PAGE - 64));
    decipher.setAutoPadding(false);
    const body = Buffer.concat([decipher.update(page.subarray(start, PAGE - RESERVE)), decipher.final()]);
    body.copy(plain, (number - 1) * PAGE + start);
  }
  Buffer.from("SQLite format 3\0").copy(plain);
  if (plain.readUInt16BE(16) !== PAGE || plain[20] !== RESERVE || !plain.subarray(21, 24).equals(Buffer.from([64, 32, 32])))
    throw new Error("WeChat catalog SQLite header is invalid");
  // This private copy already includes committed WAL pages and has no WAL.
  plain[18] = plain[19] = 1;
  plain.writeUInt32BE(count, 28);
  plain.copy(plain, 92, 24, 28);
  return plain;
}

async function fileState(file) {
  try {
    const value = await stat(file, {bigint: true});
    if (!value.isFile() || value.size > BigInt(MAX_BYTES)) throw new Error("WeChat catalog file is invalid");
    return `${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}`;
  } catch (error) {if (error.code === "ENOENT") return null; throw error;}
}

async function stableSnapshot(file) {
  const readIndex = async () => {
    try {return (await readFile(`${file}-shm`)).subarray(0, 96);}
    catch (error) {if (error.code === "ENOENT") return Buffer.alloc(0); throw error;}
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await Promise.all([fileState(file), fileState(`${file}-wal`)]);
    if (!before[0]) throw new Error("WeChat's native database is unavailable");
    const index = await readIndex();
    const main = await readFile(file);
    const wal = before[1] ? await readFile(`${file}-wal`).catch((error) => {
      if (error.code === "ENOENT") return Buffer.alloc(0); throw error;
    }) : Buffer.alloc(0);
    const after = await Promise.all([fileState(file), fileState(`${file}-wal`)]);
    if (before.every((value, i) => value === after[i]) && index.equals(await readIndex()))
      return {main, wal: nativeWalIsEmpty(index) ? Buffer.alloc(0) : wal};
  }
  throw new Error("WeChat's native database is changing; try again");
}

/** A reset WAL can retain stale full-size frames. SQLite's initialized,
 * duplicated and checksummed index is authoritative when mxFrame is zero.
 * https://www.sqlite.org/walformat.html#the_mxframe_field */
export function nativeWalIsEmpty(index) {
  if (index.length !== 96 || !index.subarray(0, 48).equals(index.subarray(48, 96)) ||
      index.readUInt32LE(0) !== 3007000 || index[12] !== 1 || index.readUInt32LE(16) !== 0) return false;
  const sum = checksum(index.subarray(0, 40), false);
  return sum[0] === index.readUInt32LE(40) && sum[1] === index.readUInt32LE(44);
}

function xml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&apos;");
}

export function nativeStickerRows(store) {
  const rows = store.prepare(`
    WITH ordering AS (
      SELECT md5, rowid AS position FROM kFavEmoticonOrderTable
      UNION ALL SELECT md5, 100000 + rowid FROM kCustomEmoticonOrderTable
    )
    SELECT e.*, MIN(o.position) AS position FROM ordering o
    JOIN kNonStoreEmoticonTable e ON e.md5 = o.md5
    GROUP BY e.md5 ORDER BY position
  `).all();
  return rows.filter((row) => /^[a-f\d]{32}$/i.test(row.md5)).map((row) => {
    const id = row.md5.toLowerCase();
    const attributes = {md5: id, type: 2, productid: row.product_id,
      cdnurl: row.cdn_url, thumburl: row.thumb_url, aeskey: row.aes_key,
      encrypturl: row.encrypt_url, externurl: row.extern_url, externmd5: row.extern_md5,
      tpurl: row.tp_url, authkey: row.auth_key};
    return {id, xml: `<msg><emoji ${Object.entries(attributes)
      .filter(([, value]) => value != null && value !== "")
      .map(([name, value]) => `${name}="${xml(value)}"`).join(" ")} /></msg>`};
  });
}

/** Reads a stable private copy, never the live database. The raw key remains
 * in memory and the authenticated plaintext copy is removed on every exit. */
async function desktopConfiguration(options = {}) {
  const {home = homedir(), accountWxid} = options;
  if (options.registryPath || process.env.POLYMUX_WECHAT_STORE_REGISTRY || process.env.POLYMUX_WECHAT_PROVIDER === "native") {
    const account = await desktopAccount(options);
    return {db_dir: account.dbDir, keys: account.keys};
  }
  const config = JSON.parse(await readFile(path.join(home, ".wx-rs/config.json"), "utf8"));
  const configured = String(config.account_wxid ?? "");
  const suffix = configured.startsWith(`${accountWxid}_`) ? configured.slice(accountWxid.length + 1) : "";
  if (!accountWxid || (configured !== accountWxid && !/^[a-f\d]{4}$/i.test(suffix)) ||
      path.basename(path.dirname(String(config.db_dir ?? ""))) !== configured)
    throw new Error("WeChat native database belongs to a different account");
  if (typeof config.db_dir !== "string" || typeof config.key_file !== "string")
    throw new Error("WeChat native database is not configured");
  return config;
}

export async function withDesktopDatabase(options, entry, read) {
  const config = await desktopConfiguration(options);
  // config.key_file is the legacy raw key.hex; the current reader provisions
  // a separate per-database key registry beside it.
  const keys = config.keys ? {entries: Object.fromEntries(Object.entries(config.keys).map(([entry, key_hex]) => [entry, {key_hex}]))}
    : JSON.parse(await readFile(path.join(path.dirname(config.key_file), "keys.json"), "utf8"));
  const hex = keys.entries?.[entry]?.key_hex;
  if (typeof hex !== "string" || !/^[a-f\d]{64}$/i.test(hex))
    throw new Error("WeChat native database key is unavailable");
  const {main, wal} = await stableSnapshot(path.join(config.db_dir, entry));
  const plain = decryptDesktopSnapshot(main, wal, Buffer.from(hex, "hex"));
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-store-"));
  try {
    const file = path.join(directory, "snapshot.db");
    await writeFile(file, plain, {mode: 0o600});
    const store = new DatabaseSync(file, {readOnly: true});
    try {return read(store);} finally {store.close();}
  } finally {
    plain.fill(0);
    await rm(directory, {recursive: true, force: true});
  }
}

/** Native saved/custom stickers, including items absent from message history. */
export async function loadDesktopStickers(options = {}) {
  return withDesktopDatabase(options, "emoticon/emoticon.db", nativeStickerRows);
}

export function nativeSessionReadStates(store) {
  return store.prepare("SELECT username, unread_count, status FROM SessionTable").all().map((row) => {
    if (typeof row.username !== "string" || !row.username ||
        !Number.isSafeInteger(row.unread_count) || row.unread_count < 0 ||
        !Number.isSafeInteger(row.status) || row.status < 0)
      throw new Error("WeChat native unread state is invalid");
    // Desktop 4.1.11's MarkSessionUnread sets status bit 12 without changing
    // unread_count. The CLI's /unread list excludes these manually marked chats.
    return {chatId: row.username, unreadCount: row.unread_count,
      markedUnread: (BigInt(row.status) & 0x1000n) !== 0n};
  });
}

export async function loadDesktopReadStates(options = {}) {
  return withDesktopDatabase(options, "session/session.db", nativeSessionReadStates);
}

/** The shared name is nick_name. remark is this account's private label. */
export function nativeGroupInfo(store, chatId) {
  if (typeof chatId !== "string" || !/^[1-9]\d{0,30}@chatroom$/.test(chatId))
    throw new Error("This is not a WeChat group");
  const row = store.prepare("SELECT username, nick_name, is_in_chat_room, delete_flag FROM contact WHERE username = ?").get(chatId);
  if (!row || typeof row.nick_name !== "string")
    throw new Error("WeChat's group name is unavailable");
  return {chatId, name: row.nick_name, isMember: row.is_in_chat_room === 1 && row.delete_flag === 0};
}

export async function loadDesktopGroupInfo(options, chatId) {
  return withDesktopDatabase(options, "contact/contact.db", store => nativeGroupInfo(store, chatId));
}

/** Match the canonical message before reading its metadata. WeChat stores
 * mention targets in source, often Zstandard-compressed and omitted by the CLI. */
export function nativeMessageSource(store, {chatId, serverId, localId, timestamp}) {
  if (typeof chatId !== "string" || !/^[1-9]\d*@chatroom$/.test(chatId) ||
      typeof serverId !== "string" || !/^[1-9]\d{0,18}$/.test(serverId) ||
      BigInt(serverId) > 9223372036854775807n ||
      !/^[1-9]\d*$/.test(String(localId)) || !Number.isSafeInteger(Number(localId)) ||
      !Number.isSafeInteger(timestamp) || timestamp <= 0)
    throw new Error("Invalid native WeChat message identity");
  const table = `Msg_${createHash("md5").update(chatId).digest("hex")}`;
  if (!store.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) return null;
  const rows = store.prepare(`SELECT source, WCDB_CT_source FROM ${table}
    WHERE server_id=CAST(? AS INTEGER) AND local_id=? AND create_time=? LIMIT 2`)
    .all(serverId, Number(localId), timestamp);
  if (rows.length > 1) throw new Error("Native WeChat message source is ambiguous");
  if (!rows.length) return null;
  const row = rows[0];
  if (row.source == null) return "";
  if (typeof row.source === "string" && row.source.length <= 65536) return row.source;
  if (!(row.source instanceof Uint8Array) || row.source.length > 65536 || row.WCDB_CT_source !== 4)
    throw new Error("Unsupported native WeChat message source");
  return zstdDecompressSync(row.source, {maxOutputLength: 65536}).toString("utf8");
}

export async function loadDesktopMessageSource(options, identity) {
  const config = await desktopConfiguration(options);
  const keys = config.keys ? {entries: Object.fromEntries(Object.entries(config.keys).map(([entry, key_hex]) => [entry, {key_hex}]))}
    : JSON.parse(await readFile(path.join(path.dirname(config.key_file), "keys.json"), "utf8"));
  let result = null;
  for (const entry of Object.keys(keys.entries ?? {}).filter(name => /^message\/message_\d+\.db$/.test(name))) {
    const source = await withDesktopDatabase(options, entry, store => nativeMessageSource(store, identity));
    if (source == null) continue;
    if (result != null) throw new Error("Native WeChat message source is ambiguous across databases");
    result = source;
  }
  return result;
}

/** The message history must first establish this exact chat/local/time/server
 * identity. Desktop can leave a sent voice's media row at svr_id=0. */
export function nativeVoiceData(store, {chatId, serverId, localId, createTime}) {
  if (!chatId || !/^[1-9]\d{0,18}$/.test(serverId) || BigInt(serverId) > 9223372036854775807n ||
      !/^[1-9]\d*$/.test(String(localId)) || !Number.isSafeInteger(Number(localId)) ||
      !Number.isSafeInteger(createTime) || createTime <= 0)
    throw new Error("WeChat voice identity is invalid");
  const rows = store.prepare(`SELECT voice_data FROM VoiceInfo
    WHERE chat_name_id IN (SELECT rowid FROM Name2Id WHERE user_name = ?)
      AND (svr_id = CAST(? AS INTEGER) OR
        (svr_id = 0 AND local_id = ? AND create_time = ?)) LIMIT 2`)
    .all(chatId, serverId, Number(localId), createTime);
  if (rows.length > 1) throw new Error("WeChat voice identity is ambiguous");
  if (!rows.length) return null;
  const bytes = Buffer.from(rows[0].voice_data ?? []);
  if (!bytes.length || bytes.length > 8 * 1024 * 1024)
    throw new Error("WeChat voice payload is invalid");
  const header = Buffer.from("#!SILK_V3");
  if (bytes.subarray(0, header.length).equals(header) ||
      (bytes[0] === 2 && bytes.subarray(1, header.length + 1).equals(header))) return bytes;
  // Some Desktop rows contain only length-prefixed SILK packets. Restore the
  // file header in our private buffer only after validating every boundary.
  // The isolated decoder must still accept the audio and enforce its PCM cap.
  let offset = 0, packets = 0;
  while (offset < bytes.length) {
    if (offset + 2 > bytes.length || ++packets > 4096) throw new Error("WeChat voice payload is invalid");
    const length = bytes.readInt16LE(offset);
    if (length <= 0 || offset + 2 + length > bytes.length) throw new Error("WeChat voice payload is invalid");
    offset += 2 + length;
  }
  return Buffer.concat([Buffer.from([2]), header, bytes]);
}

export async function loadDesktopVoice(options, identity) {
  const config = await desktopConfiguration(options);
  const keys = config.keys ? {entries: Object.fromEntries(Object.entries(config.keys).map(([entry, key_hex]) => [entry, {key_hex}]))}
    : JSON.parse(await readFile(path.join(path.dirname(config.key_file), "keys.json"), "utf8"));
  const entries = Object.keys(keys.entries ?? {}).filter(name => /^message\/media_\d+\.db$/.test(name));
  let result = null;
  for (const entry of entries) {
    const bytes = await withDesktopDatabase(options, entry, store => nativeVoiceData(store, identity));
    if (bytes) {
      if (result) throw new Error("WeChat voice identity occurs in multiple media shards");
      result = bytes;
    }
  }
  return result;
}

/** Resolve only the signed-in account's file cache and require the native
 * message's size and digest. A reused filename never selects different bytes. */
export async function loadDesktopFile(options, {name, size, md5, createTime}) {
  if (typeof name !== "string" || !name || name === "." || name === ".." ||
      /[\\/\x00-\x1f]/.test(name) || !Number.isSafeInteger(size) || size <= 0 || size > 200 * 1024 * 1024 ||
      typeof md5 !== "string" || !/^[a-f\d]{32}$/i.test(md5) ||
      !Number.isSafeInteger(createTime) || createTime <= 0) return null;
  const config = await desktopConfiguration(options);
  const accountRoot = await realpath(path.dirname(config.db_dir));
  const date = new Date(createTime * 1000);
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const candidate = path.join(accountRoot, "msg", "file", month, name);
  let resolved;
  try {resolved = await realpath(candidate);} catch (error) {if (error.code === "ENOENT") return null; throw error;}
  if (!resolved.startsWith(`${accountRoot}${path.sep}`)) return null;
  const info = await stat(resolved);
  if (!info.isFile() || info.size !== size) return null;
  const bytes = await readFile(resolved);
  if (bytes.length !== size || createHash("md5").update(bytes).digest("hex") !== md5.toLowerCase()) return null;
  return {localPath: resolved, size, md5: md5.toLowerCase()};
}

/** The resource row binds a video cache basename to one exact message. The
 * original is preferred; a thumbnail or a nearby file is never substituted. */
export function nativeVideoDigest(db, {chatId, serverId, localId, createTime}) {
  if (typeof chatId !== 'string' || !chatId || !/^[1-9]\d{0,18}$/.test(String(serverId)) ||
      !/^\d+$/.test(String(localId)) || !Number.isSafeInteger(Number(localId)) ||
      !Number.isSafeInteger(createTime) || createTime <= 0) return null;
    const rows = db.prepare(`SELECT r.packed_info FROM MessageResourceInfo r JOIN ChatName2Id c ON c.rowid=r.chat_id
      WHERE c.user_name=? AND r.message_local_id=? AND CAST(r.message_svr_id AS TEXT)=?
      AND r.message_create_time=? AND (r.message_local_type & 4294967295)=43`).all(chatId, Number(localId), String(serverId), createTime);
    if (rows.length !== 1) return null;
    if (!(rows[0].packed_info instanceof Uint8Array)) return null;
    const bytes = Buffer.from(rows[0].packed_info), marker=Buffer.from([0x12,0x22,0x0a,0x20]);
    // This resource shape contains exactly one digest field. A new shape
    // needs an explicit reader instead of fishing a hex string from a blob.
    if (bytes.length !== 36 || !bytes.subarray(0,4).equals(marker)) return null;
    const value = bytes.subarray(4).toString('ascii');
    return /^[a-f0-9]{32}$/i.test(value) ? value.toLowerCase() : null;
}

export async function loadDesktopVideo(options, request) {
  const digest = await withDesktopDatabase(options, 'message/message_resource.db', db => nativeVideoDigest(db, request));
  if (!digest) return null;
  const config = await desktopConfiguration(options);
  return readDesktopVideoCache(path.dirname(config.db_dir), digest, request);
}

export async function readDesktopVideoCache(accountRoot, digest, {serverId, md5, size}) {
  if (!/^[a-f0-9]{32}$/.test(digest) || !/^[1-9]\d{0,18}$/.test(String(serverId)) ||
      (md5 != null && !/^[a-f0-9]{32}$/i.test(md5)) ||
      (size != null && (!Number.isSafeInteger(size) || size<=0 || size>200*1024*1024))) return null;
  const root = await realpath(accountRoot);
  const videoRoot = path.join(root,'msg','video');
  const months = (await readdir(videoRoot).catch(() => [])).filter(value => /^\d{4}-\d{2}$/.test(value)).sort().reverse();
  for (const suffix of ['_raw.mp4','.mp4']) for (const month of months) {
    const file = await realpath(path.join(videoRoot,month,`${digest}${suffix}`)).catch(() => null);
    if (!file || !file.startsWith(`${root}${path.sep}`)) continue;
    const info=await stat(file);
    if (!info.isFile() || info.size<12 || info.size>200*1024*1024 || (size && info.size!==size)) continue;
    const bytes=await readFile(file);
    if (bytes.length!==info.size || bytes.subarray(4,8).toString('ascii')!=='ftyp') continue;
    const actual=createHash('md5').update(bytes).digest('hex');
    if (md5 && actual!==md5.toLowerCase()) continue;
    return {localPath:file,size:bytes.length,md5:actual,name:`wechat-${serverId}.mp4`,mimeType:'video/mp4'};
  }
  return null;
}
