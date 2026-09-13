import assert from "node:assert/strict";
import { test } from "node:test";
import { LockerSession, type LockerBlobStore } from "../src/session.js";
import { emptyMeta, type VaultMeta } from "../src/meta.js";

class MemoryStore implements LockerBlobStore {
  data: { bytes: Uint8Array; meta: VaultMeta } | null = null;

  async load() {
    return this.data
      ? { bytes: new Uint8Array(this.data.bytes), meta: { ...this.data.meta } }
      : null;
  }

  async save(bytes: Uint8Array, meta: VaultMeta) {
    this.data = { bytes: new Uint8Array(bytes), meta: { ...meta } };
  }
}

test("a portable session creates, unlocks, and fills without Node APIs in totp", async () => {
  const store = new MemoryStore();
  const session = new LockerSession(store);
  await session.hydrate();
  assert.equal(session.status().exists, false);
  assert.equal(session.status().sync.storage, "account");
  await session.create("correct horse");
  const item = await session.save({
    title: "GitHub",
    username: "ada",
    password: "s3cret",
    url: "https://github.com",
    totpSecret: "JBSWY3DPEHPK3PXP",
    recoveryCodes: ["AAAA-1111"],
  });
  session.lock();
  const again = new LockerSession(store);
  await again.hydrate();
  assert.equal(again.status().exists, true);
  assert.equal(again.status().unlocked, false);
  await again.unlock("correct horse");
  const match = again.matchesForUrl("https://github.com/login")[0];
  assert.equal(match?.id, item.id);
  const fill = again.fillFields(item.id);
  assert.equal(fill.username, "ada");
  assert.equal(fill.password, "s3cret");
  assert.equal(fill.totp?.length, 6);
  assert.equal(again.reveal(item.id).recoveryCodes[0], "AAAA-1111");
});

test("export and import keep the encrypted blob and storage setting", async () => {
  const source = new LockerSession(new MemoryStore());
  await source.hydrate();
  await source.create("correct horse");
  await source.setStorage("local");
  const blob = source.exportBlob();
  assert.ok(blob);
  const target = new LockerSession(new MemoryStore());
  await target.hydrate();
  await target.importBlob(blob);
  assert.equal(target.status().exists, true);
  assert.equal(target.status().sync.storage, "local");
  await target.unlock("correct horse");
});

test("an empty store still reports account as the default storage", async () => {
  const session = new LockerSession(new MemoryStore());
  await session.hydrate();
  assert.deepEqual(session.status().sync.storage, emptyMeta().storage);
});
