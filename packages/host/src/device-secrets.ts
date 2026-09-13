import {createCipheriv, createHash, randomBytes} from 'node:crypto';
import {mkdir, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

/** Headless grants are encrypted under the local administration secret. */
export async function saveDeviceSecret(directory: string, adminSecret: string, deviceId: string, secret: string | null): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(deviceId)) throw new Error('Invalid device identity.');
  if (!adminSecret) throw new Error('Local administration must be configured before connecting another device.');
  await mkdir(directory, {recursive: true, mode: 0o700});
  const target = path.join(directory, `${deviceId}.json`);
  if (secret === null) { await rm(target, {force: true}); return; }
  const key = createHash('sha256').update(`polymux-device-secret:${adminSecret}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(deviceId));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify({version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64')}), {mode: 0o600});
  await rename(temporary, target);
}
