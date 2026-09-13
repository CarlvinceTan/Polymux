import {createDecipheriv, createHash} from 'node:crypto';
import {readFile, readdir, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import type {WeChatNativeStore} from './wechat-native-store.js';

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export function localImageType(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (/^GIF8[79]a/.test(b.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

/** WeChat's on-disk V2 envelope: padded AES prefix, clear middle, XOR tail. */
export function decodeWeChatDat(data: Buffer, key: Buffer, xor: number): Buffer | null {
  if (data.length > MAX_IMAGE_BYTES || data.length < 15 || !data.subarray(0, 6).equals(Buffer.from([7,8,86,50,8,7]))) return null;
  const clearPrefix = data.readUInt32LE(6), tail = data.readUInt32LE(10);
  const encryptedEnd = 15 + clearPrefix + 16 - clearPrefix % 16;
  const tailStart = data.length - tail;
  if (!clearPrefix || encryptedEnd > tailStart || tailStart < 15) return null;
  try {
    const cipher = createDecipheriv('aes-128-ecb', key, null);
    const prefix = Buffer.concat([cipher.update(data.subarray(15, encryptedEnd)), cipher.final()]);
    if (prefix.length !== clearPrefix) return null;
    const suffix = Buffer.from(data.subarray(tailStart));
    for (let i = 0; i < suffix.length; i++) suffix[i] ^= xor;
    const bytes = Buffer.concat([prefix, data.subarray(encryptedEnd, tailStart), suffix]);
    return localImageType(bytes) ? bytes : null;
  } catch { return null; }
}

/** Use the structured resource digest, never an arbitrary nearby hex string. */
export function resourceImageDigest(blob: Uint8Array): string | null {
  const bytes = Buffer.from(blob), marker = Buffer.from([0x12,0x22,0x0a,0x20]);
  const matches = new Set<string>();
  for (let offset = bytes.indexOf(marker); offset >= 0; offset = bytes.indexOf(marker, offset + 4)) {
    const value = bytes.subarray(offset + 4, offset + 36).toString('ascii');
    if (/^[a-f0-9]{32}$/i.test(value)) matches.add(value.toLowerCase());
  }
  return matches.size === 1 ? [...matches][0] : null;
}

export async function readLocalWeChatPhoto(store: WeChatNativeStore, chatId: string, localId: string, sentAt: number): Promise<{bytes: Buffer; mimeType: string; thumbnail: boolean} | null> {
  if (!/^\d+$/.test(localId) || !Number.isSafeInteger(Number(localId)) || !Number.isFinite(sentAt) || sentAt <= 0 || !store.has('message/message_resource.db')) return null;
  const snapshot = await store.snapshot('message/message_resource.db');
  // A cached snapshot otherwise misses resource rows committed after its
  // first photo lookup, even when the new image file is already on disk.
  await snapshot.refresh();
  const digest = await snapshot.query(db => {
    const rows = db.prepare(`SELECT r.packed_info FROM MessageResourceInfo r JOIN ChatName2Id c ON c.rowid = r.chat_id
      WHERE c.user_name = ? AND r.message_local_id = ? AND (r.message_local_type & 4294967295) = 3
      AND r.message_create_time = ?`).all(chatId, Number(localId), Math.floor(sentAt / 1000)) as Array<{packed_info: Uint8Array}>;
    const ids = new Set(rows.map(row => resourceImageDigest(row.packed_info)).filter((id): id is string => !!id));
    return ids.size === 1 ? [...ids][0] : null;
  });
  if (!digest) return null;
  const accountRoot = await realpath(path.dirname(store.dbDir));
  const chatRoot = path.join(accountRoot, 'msg', 'attach', createHash('md5').update(chatId).digest('hex'));
  const months = (await readdir(chatRoot).catch((): string[] => [])).filter(name => /^\d{4}-\d{2}$/.test(name)).sort().reverse();
  // Derivation uses only this container's own account metadata, never a memory scan.
  const documents = path.dirname(path.dirname(accountRoot));
  const candidates = [path.join(documents, 'app_data/net/kvcomm'), path.join(documents, 'xwechat/net/kvcomm')];
  const codes = new Set<number>();
  for (const dir of candidates) for (const name of await readdir(dir).catch((): string[] => [])) {
    const value = /^key_(\d+)_.*\.statistic$/.exec(name)?.[1];
    if (value && Number(value) <= 0xffffffff) codes.add(Number(value));
  }
  const names = [...new Set([store.wxid.replace(/_[a-f0-9]{4}$/i, ''), store.wxid])];
  for (const suffix of ['', '_h', '_t']) for (const month of months) {
    const file = path.join(chatRoot, month, 'Img', `${digest}${suffix}.dat`);
    const resolved = await realpath(file).catch((): null => null);
    if (!resolved || !resolved.startsWith(`${accountRoot}${path.sep}`)) continue;
    const info = await stat(resolved);
    if (!info.isFile() || !info.size || info.size > MAX_IMAGE_BYTES) continue;
    const data = await readFile(resolved);
    if (data.length !== info.size) continue;
    if (localImageType(data)) return {bytes: data, mimeType: localImageType(data)!, thumbnail: suffix === '_t'};
    for (const code of codes) for (const name of names) {
      const key = Buffer.from(createHash('md5').update(`${code}${name}`).digest('hex').slice(0, 16), 'ascii');
      const bytes = decodeWeChatDat(data, key, code & 255);
      if (bytes) return {bytes, mimeType: localImageType(bytes)!, thumbnail: suffix === '_t'};
    }
  }
  return null;
}

export async function readLocalWeChatSticker(store: WeChatNativeStore, digest: string): Promise<{bytes: Buffer; mimeType: string} | null> {
  if (!/^[a-f0-9]{32}$/.test(digest)) return null;
  const root = await realpath(path.dirname(store.dbDir));
  const months = (await readdir(path.join(root, 'cache')).catch((): string[] => [])).filter(m => /^\d{4}-\d{2}$/.test(m)).sort().reverse();
  for (const month of months) {
    const file = await realpath(path.join(root, 'cache', month, 'Emoticon', digest.slice(0, 2), digest)).catch((): null => null);
    if (!file || !file.startsWith(`${root}${path.sep}`)) continue;
    const info = await stat(file);
    if (!info.isFile() || info.size <= 0 || info.size > 8 * 1024 * 1024) continue;
    const bytes = await readFile(file), mimeType = localImageType(bytes);
    if (mimeType && bytes.length === info.size && createHash('md5').update(bytes).digest('hex') === digest) return {bytes, mimeType};
  }
  return null;
}
