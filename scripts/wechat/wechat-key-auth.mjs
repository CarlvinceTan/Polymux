import {createHmac, pbkdf2Sync, timingSafeEqual} from 'node:crypto';

/** Authenticate one SQLCipher 4 first page using a raw 32-byte AES key. */
export function isKeyForDatabase(page, key) {
  if (!Buffer.isBuffer(page) || !Buffer.isBuffer(key) || key.length !== 32 || page.length !== 4096) return false;
  let macKey;
  try {
    const salt = Buffer.from(page.subarray(0, 16)).map(byte => byte ^ 0x3a);
    macKey = pbkdf2Sync(key, salt, 2, 32, 'sha512');
    const pageNumber = Buffer.alloc(4); pageNumber.writeUInt32LE(1);
    const mac = createHmac('sha512', macKey).update(page.subarray(16, 4032)).update(pageNumber).digest();
    return timingSafeEqual(mac, page.subarray(4032));
  } catch { return false; }
  finally { macKey?.fill(0); }
}
