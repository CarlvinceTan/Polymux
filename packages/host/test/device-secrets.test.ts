import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDecipheriv, createHash} from 'node:crypto';
import {saveDeviceSecret} from '../src/device-secrets.js';
test('headless device credentials are encrypted and removed independently', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'polymux-secret-test-'));
  try {
    await saveDeviceSecret(root, 'test-admin', 'device-a', 'secret-a');
    await saveDeviceSecret(root, 'test-admin', 'device-b', 'secret-b');
    const file = path.join(root, 'device-a.json'); const raw = await readFile(file, 'utf8');
    assert.equal(raw.includes('secret-a'), false); assert.equal((await stat(file)).mode & 0o777, 0o600);
    const value = JSON.parse(raw);
    const key = createHash('sha256').update('polymux-device-secret:test-admin').digest();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
    decipher.setAAD(Buffer.from('device-a')); decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    assert.equal(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString(), 'secret-a');
    await saveDeviceSecret(root, 'test-admin', 'device-a', null);
    await assert.rejects(readFile(file)); assert.ok(await readFile(path.join(root, 'device-b.json')));
    await assert.rejects(saveDeviceSecret(root, 'test-admin', '../outside', 'bad'));
  } finally { await rm(root, {recursive: true, force: true}); }
});
