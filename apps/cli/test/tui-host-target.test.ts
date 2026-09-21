import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {TeamHostClient} from '@polymux/host';
import {saveDeviceSecret, loadDeviceSecret} from '../../../packages/host/src/device-secrets.js';
import {tuiHost} from '../src/tui/host-target.js';

test('TUI selects only an unambiguous paired Host and decrypts only its bound grant', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'polymux-tui-host-target-'));
  const directory = path.join(root, 'host/devices');
  const local = new TeamHostClient('http://127.0.0.1:1', 'local-secret');
  local.call = async <T>() => [{hostId: 'desktop-a', deviceName: 'Desktop', mode: 'remote', endpoint: 'https://example.test'}] as T;
  try {
    await saveDeviceSecret(directory, local.secret, 'desktop-a', 'paired-grant');
    assert.equal((await tuiHost(local, root)).client, local);
    const target = await tuiHost(local, root, 'Desktop');
    assert.equal(target.client.endpoint, 'https://example.test');
    assert.equal(target.client.secret, 'paired-grant');
    assert.equal(target.hostId, 'desktop-a');
    await assert.rejects(tuiHost(local, root, 'missing'), /not paired/);
    await assert.rejects(loadDeviceSecret(directory, 'wrong-secret', 'desktop-a'));
    await assert.rejects(loadDeviceSecret(directory, local.secret, '../desktop-a'), /identity/);
    await writeFile(path.join(directory, 'desktop-b.json'), await readFile(path.join(directory, 'desktop-a.json')));
    await assert.rejects(loadDeviceSecret(directory, local.secret, 'desktop-b'), /authenticate|auth/i);
    local.call = async <T>() => [{hostId: 'a', deviceName: 'Same'}, {hostId: 'b', deviceName: 'Same'}] as T;
    await assert.rejects(tuiHost(local, root, 'Same'), /More than one/);
  } finally {await rm(root, {recursive: true, force: true});}
});
