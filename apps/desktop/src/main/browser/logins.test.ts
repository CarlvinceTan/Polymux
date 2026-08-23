import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { SecretCipher } from "../system/credential-store.js";
import { EncryptedLoginVault, LOGINS_LOCKED } from "./logins.js";

/** Stands in for Electron's safeStorage. `key` identifies the OS key: a vault
 * written under one and read under another is what a re-signed build looks
 * like. */
function cipher(key = "one", available = true): SecretCipher {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(`${key}:${value}`),
    decryptString: (value: Buffer) => {
      const text = value.toString();
      if (!text.startsWith(`${key}:`)) throw new Error("wrong key");
      return text.slice(key.length + 1);
    },
  } as SecretCipher;
}

function vaultPath(): { file: string; directory: string } {
  const directory = mkdtempSync(path.join(tmpdir(), "polymux-logins-"));
  return { file: path.join(directory, "logins.json"), directory };
}

test("a password round-trips and never sits in the file as plain text", async () => {
  const { file, directory } = vaultPath();
  try {
    const vault = new EncryptedLoginVault(file, cipher());
    await vault.write("login-1", "hunter2");
    assert.equal(await vault.read("login-1"), "hunter2");
    assert.equal(await vault.read("login-2"), null);

    const onDisk = readFileSync(file, "utf8");
    assert.equal(onDisk.includes("hunter2"), false, "the password is not readable on disk");

    // A second vault over the same file reads what the first wrote.
    assert.equal(await new EncryptedLoginVault(file, cipher()).read("login-1"), "hunter2");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deleting one password leaves the others", async () => {
  const { file, directory } = vaultPath();
  try {
    const vault = new EncryptedLoginVault(file, cipher());
    await vault.write("login-1", "first");
    await vault.write("login-2", "second");
    await vault.delete("login-1");
    assert.equal(await vault.read("login-1"), null);
    assert.equal(await vault.read("login-2"), "second");

    await vault.clear();
    assert.equal(await vault.read("login-2"), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a vault this build cannot read locks instead of overwriting it", async () => {
  const { file, directory } = vaultPath();
  try {
    // Written by the real app under its own OS key.
    await new EncryptedLoginVault(file, cipher("real")).write("login-1", "hunter2");
    const before = readFileSync(file, "utf8");

    // Opened by a build holding a different key — a dev run, or a re-signed
    // bundle. The passwords are still valid for the app that owns them, so
    // they must survive untouched.
    const other = new EncryptedLoginVault(file, cipher("other"));
    assert.equal(await other.read("login-1"), null, "reads report empty");
    assert.equal(other.locked, true);
    await assert.rejects(() => other.write("login-2", "new"), new RegExp(LOGINS_LOCKED.slice(0, 30)));
    assert.equal(readFileSync(file, "utf8"), before, "the file on disk is unchanged");

    // And the real app still reads it.
    assert.equal(await new EncryptedLoginVault(file, cipher("real")).read("login-1"), "hunter2");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("without OS encryption the vault refuses rather than writing in the clear", async () => {
  const { file, directory } = vaultPath();
  try {
    const vault = new EncryptedLoginVault(file, cipher("one", false));
    await assert.rejects(() => vault.write("login-1", "hunter2"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent writes all land instead of racing each other out of the file", async () => {
  const { file, directory } = vaultPath();
  try {
    const vault = new EncryptedLoginVault(file, cipher());
    await Promise.all([
      vault.write("a", "1"),
      vault.write("b", "2"),
      vault.write("c", "3"),
    ]);
    const reopened = new EncryptedLoginVault(file, cipher());
    assert.equal(await reopened.read("a"), "1");
    assert.equal(await reopened.read("b"), "2");
    assert.equal(await reopened.read("c"), "3");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a corrupt file does not take the process down", async () => {
  const { file, directory } = vaultPath();
  try {
    writeFileSync(file, "not base64 and not encrypted either");
    const vault = new EncryptedLoginVault(file, cipher());
    assert.equal(await vault.read("login-1"), null);
    assert.equal(vault.locked, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
