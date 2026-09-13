import assert from 'node:assert/strict';
import test from 'node:test';
import {LockerSession} from '@polymux/locker';
import {createDeviceLocker} from './device-locker';

test('an on-device session unlocks without a Host', async () => {
  const memory = {data: null as {bytes: Uint8Array; meta: import('@polymux/locker').VaultMeta} | null};
  const session = new LockerSession({
    async load() {
      return memory.data ? {bytes: new Uint8Array(memory.data.bytes), meta: {...memory.data.meta}} : null;
    },
    async save(bytes, meta) {
      memory.data = {bytes: new Uint8Array(bytes), meta: {...meta}};
    },
  });
  await session.hydrate();
  await session.create('correct horse');
  await session.save({title: 'Site', username: 'ada', password: 's3cret', url: 'https://example.com', totpSecret: 'JBSWY3DPEHPK3PXP'});
  session.lock();
  await session.unlock('correct horse');
  const item = session.list().items[0];
  assert.equal(item.title, 'Site');
  assert.equal(session.fillFields(item.id).password, 's3cret');
  assert.equal(session.fillFields(item.id).totp?.length, 6);
});

test('device locker manages items on-device without a Host', async () => {
  const memory = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear: () => memory.clear(),
    key: () => null,
    get length() {
      return memory.size;
    },
  } as Storage;
  const locker = createDeviceLocker({});
  const created = await locker.call('locker.create', ['correct horse']) as {exists: boolean; unlocked: boolean; sync: {storage: string}};
  assert.equal(created.exists, true);
  assert.equal(created.unlocked, true);
  assert.equal(created.sync.storage, 'account');
  const saved = await locker.call('locker.save', [{title: 'Site', username: 'ada', password: 's3cret', totpSecret: 'JBSWY3DPEHPK3PXP'}]) as {id: string; title: string};
  assert.equal(saved.title, 'Site');
  const list = await locker.call('locker.list') as {items: Array<{id: string}>};
  assert.equal(list.items.length, 1);
  const secrets = await locker.call('locker.reveal', [saved.id]) as {password: string; totp: {code: string} | null};
  assert.equal(secrets.password, 's3cret');
  assert.equal(secrets.totp?.code.length, 6);
  const local = await locker.call('locker.setStorage', ['local']) as {sync: {storage: string}};
  assert.equal(local.sync.storage, 'local');
});

test('device locker uses Host export when online', async () => {
  const memory = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear: () => memory.clear(),
    key: () => null,
    get length() {
      return memory.size;
    },
  } as Storage;
  const called: string[] = [];
  const locker = createDeviceLocker({
    online: () => true,
    host: async (method) => {
      called.push(method);
      if (method === 'locker.export') return null;
      if (method === 'locker.status')
        return {exists: false, unlocked: false, itemCount: 0, idleLockSeconds: 300, sync: {signedIn: false, available: false, state: 'offline', storage: 'account', revision: 0, lastSyncedAt: null}};
      throw new Error(`unexpected ${method}`);
    },
  });
  const status = await locker.call('locker.status') as {exists: boolean};
  assert.equal(status.exists, false);
  assert.ok(called.includes('locker.export'));
  assert.ok(called.includes('locker.status'));
});

function mockStorage(): void {
  const memory = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear: () => memory.clear(),
    key: () => null,
    get length() {
      return memory.size;
    },
  } as Storage;
}

class MemoryCloud {
  signedInFlag = true;
  blob: {bytes: Uint8Array; revision: number; updatedAt: string; checksum: string} | null = null;
  pulls = 0;
  pushes = 0;
  available() {
    return true;
  }
  signedIn() {
    return this.signedInFlag;
  }
  async pull() {
    this.pulls += 1;
    return this.blob ? {...this.blob, bytes: new Uint8Array(this.blob.bytes)} : null;
  }
  async push(blob: {bytes: Uint8Array; revision: number; updatedAt: string; checksum: string}) {
    this.pushes += 1;
    this.blob = {...blob, bytes: new Uint8Array(blob.bytes)};
  }
}

test('signed-in device locker pulls the account vault without a Host', async () => {
  mockStorage();
  const seedStore = {data: null as {bytes: Uint8Array; meta: import('@polymux/locker').VaultMeta} | null};
  const seed = new LockerSession({
    async load() {
      return seedStore.data ? {bytes: new Uint8Array(seedStore.data.bytes), meta: {...seedStore.data.meta}} : null;
    },
    async save(bytes, meta) {
      seedStore.data = {bytes: new Uint8Array(bytes), meta: {...meta}};
    },
  });
  await seed.hydrate();
  await seed.create('correct horse');
  await seed.save({title: 'Site', username: 'ada', password: 's3cret'});
  const exported = seed.exportBlob();
  assert.ok(exported);
  const cloud = new MemoryCloud();
  cloud.blob = {
    bytes: Uint8Array.from(Buffer.from(exported.bytes, 'base64')),
    revision: exported.meta.revision,
    updatedAt: exported.meta.updatedAt,
    checksum: exported.meta.checksum,
  };
  const locker = createDeviceLocker({cloud});
  await locker.call('locker.unlock', ['correct horse']);
  const list = await locker.call('locker.list') as {items: Array<{title: string}>};
  assert.equal(list.items[0]?.title, 'Site');
  assert.ok(cloud.pulls > 0);
});

test('device locker local-only does not upload to the account', async () => {
  mockStorage();
  const cloud = new MemoryCloud();
  const locker = createDeviceLocker({cloud});
  await locker.call('locker.setStorage', ['local']);
  await locker.call('locker.create', ['correct horse']);
  await locker.call('locker.save', [{title: 'Local', password: 'nope'}]);
  assert.equal(cloud.pushes, 0);
  assert.equal(cloud.pulls, 0);
});
