import assert from "node:assert/strict";
import {mkdtemp, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {EncryptedCredentialStore, type SecretCipher} from "./credential-store.js";
import {EncryptedApiKeyPool} from "../inference/api-key-pool.js";

const cipher: SecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 0xa5)),
  decryptString: (value) => Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString(),
};

/** Simulates a store written under an OS key that no longer matches: every
 * decryption of the old data fails, exactly like safeStorage after the
 * keychain key changed. */
const mismatchedCipher: SecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString: cipher.encryptString,
  decryptString: () => {
    throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
  },
};

test("persists encrypted credentials without exposing their values", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-credentials-"));
  const file = path.join(directory, "credentials.json");
  try {
    const store = new EncryptedCredentialStore(file, cipher);
    await store.modify("anthropic", async () => ({type: "api_key", key: "sk-secret-value"}));

    const onDisk = await readFile(file, "utf8");
    assert.doesNotMatch(onDisk, /sk-secret-value/);
    assert.deepEqual(await store.list(), [{providerId: "anthropic", type: "api_key"}]);

    const reopened = new EncryptedCredentialStore(file, cipher);
    assert.deepEqual(await reopened.read("anthropic"), {type: "api_key", key: "sk-secret-value"});
    await reopened.delete("anthropic");
    assert.equal(await reopened.read("anthropic"), undefined);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("refuses to persist a secret when OS encryption is unavailable", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-credentials-"));
  try {
    const unavailable = new EncryptedCredentialStore(path.join(directory, "credentials.json"), {
      ...cipher,
      isEncryptionAvailable: () => false,
    });
    await assert.rejects(
      unavailable.modify("openai", async () => ({type: "api_key", key: "secret"})),
      /Secure credential storage is unavailable/,
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("stores multiple encrypted API keys and changes the active key after a limit", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-key-pool-"));
  const file = path.join(directory, "api-keys.json");
  try {
    const pool = new EncryptedApiKeyPool(file, cipher);
    await pool.add("anthropic", "sk-first-secret");
    await pool.add("anthropic", "sk-second-secret");
    const initial = await pool.candidates("anthropic");
    assert.deepEqual(initial.map((item) => item.key), ["sk-first-secret", "sk-second-secret"]);

    await pool.markFailure("anthropic", initial[0]!.id, "rate_limit");
    const rotated = await pool.candidates("anthropic");
    assert.equal(rotated[0]!.key, "sk-second-secret");
    assert.equal((await pool.list("anthropic"))[0]!.status, "rate_limited");

    const reopened = new EncryptedApiKeyPool(file, cipher);
    assert.deepEqual(
      (await reopened.list("anthropic")).map((item) => item.status),
      ["ready", "ready"],
      "provider failures must not invalidate keys across app restarts",
    );
    assert.deepEqual(
      (await reopened.candidates("anthropic")).map((item) => item.key),
      ["sk-second-secret", "sk-first-secret"],
    );

    const onDisk = await readFile(file, "utf8");
    assert.doesNotMatch(onDisk, /sk-(first|second)-secret/);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("rejects incomplete OpenCode keys instead of treating them as configured", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-opencode-key-"));
  try {
    const pool = new EncryptedApiKeyPool(path.join(directory, "api-keys.json"), cipher);
    await assert.rejects(
      pool.add("opencode-go", "df"),
      /full OpenCode API key beginning with sk-/,
    );
    assert.deepEqual(await pool.list("opencode-go"), []);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("keys this process cannot decrypt are left alone, not moved or overwritten", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-key-pool-stale-"));
  const file = path.join(directory, "api-keys.json");
  try {
    // The user's real keys, saved by the real app.
    await new EncryptedApiKeyPool(file, cipher).add("openai", "sk-the-users-real-key");
    const original = await readFile(file, "utf8");

    // Another build — `electron .`, a re-signed bundle, a denied keychain
    // prompt — holds a different OS key. It cannot read the file, but the file
    // is not broken, so it must survive untouched.
    const other = new EncryptedApiKeyPool(file, mismatchedCipher);
    assert.deepEqual(await other.list("openai"), [], "unreadable keys are reported as absent");
    await assert.rejects(other.add("openai", "sk-would-clobber"), /left untouched rather than overwritten/);

    const names = await readdir(directory);
    assert.deepEqual(names, ["api-keys.json"], "nothing is quarantined or left behind");
    assert.equal(await readFile(file, "utf8"), original, "the ciphertext is byte-for-byte unchanged");

    // The app that owns the keys still has them.
    assert.deepEqual(
      (await new EncryptedApiKeyPool(file, cipher).candidates("openai")).map((item) => item.key),
      ["sk-the-users-real-key"],
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("recovers when the pool file decrypts to a malformed document", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-key-pool-malformed-"));
  const file = path.join(directory, "api-keys.json");
  try {
    await writeFile(file, cipher.encryptString("[]").toString("base64"), "utf8");
    const pool = new EncryptedApiKeyPool(file, cipher);
    assert.deepEqual(await pool.list("openai"), []);
    await pool.add("openai", "sk-back-again");
    assert.deepEqual((await pool.candidates("openai")).map((item) => item.key), ["sk-back-again"]);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("recovers when the credential store is corrupt or its key changed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-credentials-stale-"));
  const file = path.join(directory, "credentials.json");
  try {
    await writeFile(file, "not json", "utf8");
    const corrupt = new EncryptedCredentialStore(file, cipher);
    assert.equal(await corrupt.read("openai"), undefined);
    await corrupt.modify("openai", async () => ({type: "api_key", key: "sk-regenerated"}));
    assert.deepEqual(await new EncryptedCredentialStore(file, cipher).read("openai"), {type: "api_key", key: "sk-regenerated"});

    // A credential blob encrypted under a previous OS key reads as absent and
    // can be overwritten, instead of failing every store operation.
    await writeFile(file, JSON.stringify({version: 1, credentials: {anthropic: "stale-blob"}}), "utf8");
    const mismatched = new EncryptedCredentialStore(file, mismatchedCipher);
    assert.equal(await mismatched.read("anthropic"), undefined);
    assert.deepEqual(await mismatched.list(), []);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
