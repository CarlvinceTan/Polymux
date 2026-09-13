import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {test} from "node:test";
import {LockerService} from "./service.js";
import type {LockerCloudBlob, LockerCloudStore} from "./cloud.js";

class MemoryCloud implements LockerCloudStore {
  signedInFlag = true;
  blob: LockerCloudBlob | null = null;
  pulls = 0;
  pushes = 0;

  available(): boolean {
    return true;
  }

  signedIn(): boolean {
    return this.signedInFlag;
  }

  async pull(): Promise<LockerCloudBlob | null> {
    this.pulls += 1;
    return this.blob
      ? {...this.blob, bytes: new Uint8Array(this.blob.bytes)}
      : null;
  }

  async push(blob: LockerCloudBlob): Promise<void> {
    this.pushes += 1;
    this.blob = {
      ...blob,
      bytes: new Uint8Array(blob.bytes),
    };
  }
}

async function withLocker(
  run: (locker: LockerService, cloud: MemoryCloud) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-locker-"));
  const cloud = new MemoryCloud();
  const locker = new LockerService({dataDirectory: root, onChanged: () => {}});
  locker.attachCloud(cloud);
  try {
    await run(locker, cloud);
  } finally {
    locker.close();
    await rm(root, {recursive: true, force: true});
  }
}

test("a new locker defaults to account storage", async () => {
  await withLocker(async (locker) => {
    assert.equal(locker.status().sync.storage, "account");
    await locker.create("correct horse");
    assert.equal(locker.status().sync.storage, "account");
  });
});

test("signed in and account uploads the encrypted vault", async () => {
  await withLocker(async (locker, cloud) => {
    await locker.create("correct horse");
    assert.equal(cloud.pushes, 1);
    assert.ok(cloud.blob);
  });
});

test("signed in but local does not upload", async () => {
  await withLocker(async (locker, cloud) => {
    await locker.setStorage("local");
    await locker.create("correct horse");
    await locker.save({title: "GitHub", username: "ada", password: "s3cret", url: "https://github.com"});
    assert.equal(locker.status().sync.storage, "local");
    assert.equal(locker.status().sync.state, "local");
    assert.equal(locker.status().sync.error, undefined);
    assert.equal(cloud.pushes, 0);
    assert.equal(cloud.pulls, 0);
  });
});

test("switching to local stops later uploads and leaves the cloud copy", async () => {
  await withLocker(async (locker, cloud) => {
    await locker.create("correct horse");
    assert.equal(cloud.pushes, 1);
    const kept = cloud.blob;
    await locker.setStorage("local");
    await locker.save({title: "Local only", password: "nope"});
    assert.equal(cloud.pushes, 1);
    assert.equal(cloud.blob?.checksum, kept?.checksum);
    assert.equal(locker.status().sync.state, "local");
    assert.equal(locker.status().sync.error, undefined);
  });
});

test("switching to account with an empty cloud uploads this device", async () => {
  await withLocker(async (locker, cloud) => {
    await locker.setStorage("local");
    await locker.create("correct horse");
    assert.equal(cloud.pushes, 0);
    const next = await locker.setStorage("account");
    assert.equal(next.sync.storage, "account");
    assert.equal(next.sync.conflict, undefined);
    assert.equal(cloud.pushes, 1);
  });
});

test("switching to account asks which copy to keep when the cloud already has a vault", async () => {
  await withLocker(async (locker, cloud) => {
    await locker.setStorage("local");
    await locker.create("correct horse");
    cloud.blob = {
      bytes: new Uint8Array([1, 2, 3, 4]),
      revision: 8,
      updatedAt: "2026-09-01T00:00:00.000Z",
      checksum: "cloud-copy",
    };
    const conflicted = await locker.setStorage("account");
    assert.equal(conflicted.sync.conflict, "cloud-exists");
    assert.equal(cloud.pushes, 0);
    const kept = await locker.setStorage("account", "keep-local");
    assert.equal(kept.sync.conflict, undefined);
    assert.equal(cloud.pushes, 1);
    assert.notEqual(cloud.blob?.checksum, "cloud-copy");
  });
});

test("hydrate while local never talks to the cloud", async () => {
  await withLocker(async (locker, cloud) => {
    await locker.setStorage("local");
    await locker.create("correct horse");
    cloud.blob = {
      bytes: new Uint8Array([9, 9, 9]),
      revision: 4,
      updatedAt: "2026-09-01T00:00:00.000Z",
      checksum: "should-not-pull",
    };
    await locker.lock();
    await locker.hydrate();
    assert.equal(cloud.pulls, 0);
    assert.equal(cloud.pushes, 0);
    assert.equal(locker.status().exists, true);
  });
});

test("CSV import lands logins in the open vault", async () => {
  await withLocker(async (locker) => {
    await locker.create("correct horse");
    const csv = path.join(tmpdir(), `polymux-locker-${Date.now()}.csv`);
    await writeFile(csv, "name,url,username,password,note\nGitHub,https://github.com,ada,s3cret,work\n");
    try {
      const result = await locker.importBegin(csv);
      assert.equal(result.status, "imported");
      if (result.status !== "imported") return;
      assert.equal(result.imported, 1);
      assert.equal(locker.list().items[0]?.title, "GitHub");
      assert.equal(locker.reveal(locker.list().items[0].id).password, "s3cret");
    } finally {
      await rm(csv, {force: true});
    }
  });
});

test("KeePass import copies entries into the open vault", async () => {
  await withLocker(async (source) => {
    await source.create("correct horse");
    await source.save({title: "Mail", username: "ada", password: "pw", url: "https://mail.example"});
    source.lock();
    const blob = source.exportVault();
    assert.ok(blob?.bytes);
    const kdbx = path.join(tmpdir(), `polymux-locker-${Date.now()}.kdbx`);
    await writeFile(kdbx, Buffer.from(blob.bytes, "base64"));
    try {
      await withLocker(async (target) => {
        await target.create("other password");
        const start = await target.importBegin(kdbx);
        assert.equal(start.status, "needs-password");
        const result = await target.importConfirm("correct horse");
        assert.equal(result.imported, 1);
        const item = target.list().items.find((entry) => entry.title === "Mail");
        assert.ok(item);
        assert.equal(target.reveal(item.id).password, "pw");
      });
    } finally {
      await rm(kdbx, {force: true});
    }
  });
});

test("export and import share the encrypted vault blob", async () => {
  await withLocker(async (source) => {
    await source.create("correct horse");
    await source.unlock("correct horse");
    await source.save({title: "GitHub", username: "ada", password: "s3cret", url: "https://github.com"});
    source.lock();
    const blob = source.exportVault();
    assert.ok(blob?.bytes);
    await withLocker(async (target) => {
      await target.importVault(blob);
      await target.unlock("correct horse");
      assert.equal(target.list().items[0]?.title, "GitHub");
      assert.equal(target.reveal(target.list().items[0].id).password, "s3cret");
    });
  });
});
