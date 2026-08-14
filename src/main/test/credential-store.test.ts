import assert from "node:assert/strict";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {EncryptedCredentialStore, type SecretCipher} from "../credential-store.js";
import {EncryptedApiKeyPool} from "../api-key-pool.js";

const cipher: SecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 0xa5)),
  decryptString: (value) => Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString(),
};

test("persists encrypted credentials without exposing their values", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "midas-credentials-"));
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
  const directory = await mkdtemp(path.join(tmpdir(), "midas-credentials-"));
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
  const directory = await mkdtemp(path.join(tmpdir(), "midas-key-pool-"));
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
  const directory = await mkdtemp(path.join(tmpdir(), "midas-opencode-key-"));
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
