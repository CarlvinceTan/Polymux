import assert from "node:assert/strict";
import {test} from "node:test";
import {
  DESKTOP_OFFLINE,
  LockerSession,
  MISSING_CLOUD_VAULT,
  WRONG_PASSWORD,
  preferDesktopLoopback,
  pullAccountVault,
  shouldUseCloudSync,
  syncSessionWithCloud,
  type LockerBlobStore,
  type LockerCloudBlob,
  type LockerCloudStore,
  type VaultMeta,
} from "../src/index.js";

class MemoryStore implements LockerBlobStore {
  data: {bytes: Uint8Array; meta: VaultMeta} | null = null;
  async load() {
    return this.data ? {bytes: new Uint8Array(this.data.bytes), meta: {...this.data.meta}} : null;
  }
  async save(bytes: Uint8Array, meta: VaultMeta) {
    this.data = {bytes: new Uint8Array(bytes), meta: {...meta}};
  }
}

class MemoryCloud implements LockerCloudStore {
  signedInFlag = true;
  blob: LockerCloudBlob | null = null;
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
  async push(blob: LockerCloudBlob) {
    this.pushes += 1;
    this.blob = {...blob, bytes: new Uint8Array(blob.bytes)};
  }
}

test("desktop loopback wins while Polymux is reachable", async () => {
  const result = await preferDesktopLoopback(
    async () => "desktop",
    async () => "device",
  );
  assert.equal(result.source, "desktop");
  assert.equal(result.value, "desktop");
});

test("desktop loopback falls back only when desktop is offline", async () => {
  const result = await preferDesktopLoopback(
    async () => {
      throw Object.assign(new Error("Open Polymux to use Locker"), {code: DESKTOP_OFFLINE});
    },
    async () => "device",
  );
  assert.equal(result.source, "device");
  assert.equal(result.value, "device");
});

test("desktop loopback does not swallow unrelated errors", async () => {
  await assert.rejects(
    () =>
      preferDesktopLoopback(
        async () => {
          throw new Error("locked");
        },
        async () => "device",
      ),
    /locked/,
  );
});

test("signed-in extension can pull and unlock the account vault without desktop", async () => {
  const source = new LockerSession(new MemoryStore());
  await source.hydrate();
  await source.create("correct horse");
  await source.save({title: "GitHub", username: "ada", password: "s3cret", url: "https://github.com"});
  source.lock();
  const exported = source.exportBlob();
  assert.ok(exported);
  const cloud = new MemoryCloud();
  cloud.blob = {
    bytes: Uint8Array.from(Buffer.from(exported.bytes, "base64")),
    revision: exported.meta.revision,
    updatedAt: exported.meta.updatedAt,
    checksum: exported.meta.checksum,
  };

  const session = new LockerSession(new MemoryStore());
  await session.hydrate();
  await pullAccountVault(session, cloud);
  assert.equal(session.status().exists, true);
  await session.unlock("correct horse");
  assert.equal(session.list().items[0]?.title, "GitHub");
  assert.equal(session.fillFields(session.list().items[0].id).password, "s3cret");
});

test("a wrong master password does not talk to the server", async () => {
  const source = new LockerSession(new MemoryStore());
  await source.hydrate();
  await source.create("correct horse");
  const exported = source.exportBlob();
  assert.ok(exported);
  const cloud = new MemoryCloud();
  cloud.blob = {
    bytes: Uint8Array.from(Buffer.from(exported.bytes, "base64")),
    revision: 1,
    updatedAt: exported.meta.updatedAt,
    checksum: exported.meta.checksum,
  };
  const session = new LockerSession(new MemoryStore());
  await session.hydrate();
  await pullAccountVault(session, cloud);
  const pulls = cloud.pulls;
  await assert.rejects(() => session.unlock("wrong password"), (error: unknown) => {
    assert.equal(error instanceof Error && error.message, WRONG_PASSWORD);
    return true;
  });
  assert.equal(cloud.pulls, pulls);
  assert.equal(cloud.pushes, 0);
});

test("a missing cloud vault is an error on the signed-in unlock path", async () => {
  const session = new LockerSession(new MemoryStore());
  await session.hydrate();
  const cloud = new MemoryCloud();
  await assert.rejects(() => pullAccountVault(session, cloud), (error: unknown) => {
    assert.equal(error instanceof Error && error.message, MISSING_CLOUD_VAULT);
    return true;
  });
});

test("local-only does not upload or pull after sign-in", async () => {
  const session = new LockerSession(new MemoryStore());
  await session.hydrate();
  await session.setStorage("local");
  await session.create("correct horse");
  const cloud = new MemoryCloud();
  cloud.blob = {
    bytes: new Uint8Array([9, 9, 9]),
    revision: 8,
    updatedAt: "2026-09-01T00:00:00.000Z",
    checksum: "should-not-pull",
  };
  const result = await syncSessionWithCloud(session, cloud);
  assert.equal(result.status.sync.storage, "local");
  assert.equal(cloud.pulls, 0);
  assert.equal(cloud.pushes, 0);
  assert.equal(shouldUseCloudSync("local", true), false);
});

test("account storage pushes dirty ciphertext after a local save", async () => {
  const session = new LockerSession(new MemoryStore());
  await session.hydrate();
  await session.create("correct horse");
  const cloud = new MemoryCloud();
  await syncSessionWithCloud(session, cloud);
  assert.equal(cloud.pushes, 1);
  await session.save({title: "Mail", password: "pw"});
  await syncSessionWithCloud(session, cloud, {allowPull: false});
  assert.equal(cloud.pushes, 2);
  assert.equal(session.exportBlob()?.meta.dirty, false);
});
