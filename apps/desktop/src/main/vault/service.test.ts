import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {test} from "node:test";
import {VaultService, type VaultBiometrics} from "./service.js";
import type {VaultCloudBlob, VaultCloudStore} from "./cloud.js";

class MemoryCloud implements VaultCloudStore {
  signedInFlag = true;
  blob: VaultCloudBlob | null = null;
  pulls = 0;
  pushes = 0;

  available(): boolean {
    return true;
  }

  signedIn(): boolean {
    return this.signedInFlag;
  }

  async pull(): Promise<VaultCloudBlob | null> {
    this.pulls += 1;
    return this.blob
      ? {...this.blob, bytes: new Uint8Array(this.blob.bytes)}
      : null;
  }

  async push(blob: VaultCloudBlob): Promise<void> {
    this.pushes += 1;
    this.blob = {
      ...blob,
      bytes: new Uint8Array(blob.bytes),
    };
  }
}

function fakeBiometrics(): VaultBiometrics & {prompts: () => number} {
  let count = 0;
  return {
    prompts: () => count,
    isEncryptionAvailable: () => true,
    canPromptBiometric: () => true,
    promptBiometric: async () => {
      count += 1;
    },
    encryptString: (password: string) => Buffer.from(`enc:${password}`),
    decryptString: (encrypted: Buffer) => {
      const text = encrypted.toString();
      if (!text.startsWith("enc:")) throw new Error("decrypt failed");
      return text.slice(4);
    },
  };
}

async function withVault(
  run: (vault: VaultService, cloud: MemoryCloud) => Promise<void>,
  biometrics?: VaultBiometrics | null,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-vault-"));
  const cloud = new MemoryCloud();
  const vault = new VaultService({dataDirectory: root, onChanged: () => {}, biometrics});
  vault.attachCloud(cloud);
  try {
    await run(vault, cloud);
  } finally {
    vault.close();
    await rm(root, {recursive: true, force: true});
  }
}

test("a new vault defaults to account storage", async () => {
  await withVault(async (vault) => {
    assert.equal(vault.status().sync.storage, "account");
    await vault.create("correct horse");
    assert.equal(vault.status().sync.storage, "account");
  });
});

test("signed in and account uploads the encrypted vault", async () => {
  await withVault(async (vault, cloud) => {
    await vault.create("correct horse");
    assert.equal(cloud.pushes, 1);
    assert.ok(cloud.blob);
  });
});

test("signed in but local does not upload", async () => {
  await withVault(async (vault, cloud) => {
    await vault.setStorage("local");
    await vault.create("correct horse");
    await vault.save({title: "GitHub", username: "ada", password: "s3cret", url: "https://github.com"});
    assert.equal(vault.status().sync.storage, "local");
    assert.equal(vault.status().sync.state, "local");
    assert.equal(vault.status().sync.error, undefined);
    assert.equal(cloud.pushes, 0);
    assert.equal(cloud.pulls, 0);
  });
});

test("switching to local stops later uploads and leaves the cloud copy", async () => {
  await withVault(async (vault, cloud) => {
    await vault.create("correct horse");
    assert.equal(cloud.pushes, 1);
    const kept = cloud.blob;
    await vault.setStorage("local");
    await vault.save({title: "Local only", password: "nope"});
    assert.equal(cloud.pushes, 1);
    assert.equal(cloud.blob?.checksum, kept?.checksum);
    assert.equal(vault.status().sync.state, "local");
    assert.equal(vault.status().sync.error, undefined);
  });
});

test("switching to account with an empty cloud uploads this device", async () => {
  await withVault(async (vault, cloud) => {
    await vault.setStorage("local");
    await vault.create("correct horse");
    assert.equal(cloud.pushes, 0);
    const next = await vault.setStorage("account");
    assert.equal(next.sync.storage, "account");
    assert.equal(next.sync.conflict, undefined);
    assert.equal(cloud.pushes, 1);
  });
});

test("switching to account merges the cloud copy, newest entry wins", async () => {
  const makeRoot = () => mkdtemp(path.join(tmpdir(), "polymux-vault-"));
  const rootA = await makeRoot();
  const rootB = await makeRoot();
  const cloud = new MemoryCloud();
  const deviceA = new VaultService({dataDirectory: rootA, onChanged: () => {}});
  const deviceB = new VaultService({dataDirectory: rootB, onChanged: () => {}});
  deviceA.attachCloud(cloud);
  deviceB.attachCloud(cloud);
  try {
    await deviceB.create("correct horse");
    await deviceB.save({title: "From B", username: "b", password: "pw-b"});
    await deviceA.setStorage("local");
    await deviceA.create("correct horse");
    await deviceA.save({title: "From A", username: "a", password: "pw-a"});
    const next = await deviceA.setStorage("account");
    assert.equal(next.sync.storage, "account");
    assert.equal(next.sync.conflict, undefined);
    const titlesA = deviceA.list().items.map((item) => item.title).sort();
    assert.deepEqual(titlesA, ["From A", "From B"]);
    await deviceB.sync();
    const titlesB = deviceB.list().items.map((item) => item.title).sort();
    assert.deepEqual(titlesB, ["From A", "From B"]);
  } finally {
    deviceA.close();
    deviceB.close();
    await rm(rootA, {recursive: true, force: true});
    await rm(rootB, {recursive: true, force: true});
  }
});

test("hydrate while local never talks to the cloud", async () => {
  await withVault(async (vault, cloud) => {
    await vault.setStorage("local");
    await vault.create("correct horse");
    cloud.blob = {
      bytes: new Uint8Array([9, 9, 9]),
      revision: 4,
      updatedAt: "2026-09-01T00:00:00.000Z",
      checksum: "should-not-pull",
    };
    await vault.lock();
    await vault.hydrate();
    assert.equal(cloud.pulls, 0);
    assert.equal(cloud.pushes, 0);
    assert.equal(vault.status().exists, true);
  });
});

test("CSV import lands logins in the open vault", async () => {
  await withVault(async (vault) => {
    await vault.create("correct horse");
    const csv = path.join(tmpdir(), `polymux-vault-${Date.now()}.csv`);
    await writeFile(csv, "name,url,username,password,note\nGitHub,https://github.com,ada,s3cret,work\n");
    try {
      const result = await vault.importBegin(csv);
      assert.equal(result.status, "imported");
      if (result.status !== "imported") return;
      assert.equal(result.imported, 1);
      assert.equal(vault.list().items[0]?.title, "GitHub");
      assert.equal(vault.reveal(vault.list().items[0].id).password, "s3cret");
    } finally {
      await rm(csv, {force: true});
    }
  });
});

test("KeePass import copies entries into the open vault", async () => {
  await withVault(async (source) => {
    await source.create("correct horse");
    await source.save({title: "Mail", username: "ada", password: "pw", url: "https://mail.example"});
    source.lock();
    const blob = source.exportVault();
    assert.ok(blob?.bytes);
    const kdbx = path.join(tmpdir(), `polymux-vault-${Date.now()}.kdbx`);
    await writeFile(kdbx, Buffer.from(blob.bytes, "base64"));
    try {
      await withVault(async (target) => {
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
  await withVault(async (source) => {
    await source.create("correct horse");
    await source.unlock("correct horse");
    await source.save({title: "GitHub", username: "ada", password: "s3cret", url: "https://github.com"});
    source.lock();
    const blob = source.exportVault();
    assert.ok(blob?.bytes);
    await withVault(async (target) => {
      await target.importVault(blob);
      await target.unlock("correct horse");
      assert.equal(target.list().items[0]?.title, "GitHub");
      assert.equal(target.reveal(target.list().items[0].id).password, "s3cret");
    });
  });
});

test("biometric unlock enrolls while unlocked and unlocks without the password", async () => {
  const biometrics = fakeBiometrics();
  await withVault(async (vault) => {
    assert.deepEqual(vault.biometricStatus(), {available: true, enrolled: false});
    await vault.create("correct horse");
    await vault.enrollBiometric("correct horse");
    assert.deepEqual(vault.biometricStatus(), {available: true, enrolled: true});
    vault.lock();
    assert.equal(vault.status().unlocked, false);
    const next = await vault.unlockBiometric();
    assert.equal(next.unlocked, true);
    assert.equal(biometrics.prompts(), 1);
  }, biometrics);
});

test("biometric enroll rejects a wrong password", async () => {
  await withVault(async (vault) => {
    await vault.create("correct horse");
    await assert.rejects(vault.enrollBiometric("wrong password"));
    assert.equal(vault.biometricStatus().enrolled, false);
  }, fakeBiometrics());
});

test("biometric enrollment survives a password change", async () => {
  const biometrics = fakeBiometrics();
  await withVault(async (vault) => {
    await vault.create("correct horse");
    await vault.enrollBiometric("correct horse");
    await vault.changePassword("correct horse", "new correct horse");
    vault.lock();
    const next = await vault.unlockBiometric();
    assert.equal(next.unlocked, true);
    assert.equal(biometrics.prompts(), 1);
  }, biometrics);
});

test("biometric unlock without an adapter is unavailable", async () => {
  await withVault(async (vault) => {
    assert.deepEqual(vault.biometricStatus(), {available: false, enrolled: false});
    await vault.create("correct horse");
    await assert.rejects(vault.enrollBiometric("correct horse"));
    vault.lock();
    await assert.rejects(vault.unlockBiometric());
  });
});
