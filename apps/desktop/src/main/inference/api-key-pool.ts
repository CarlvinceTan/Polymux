import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import path from "node:path";
import {SECURE_STORAGE_UNAVAILABLE, quarantineUnreadable, type SecretCipher} from "../system/credential-store.js";

/**
 * Shown when the stored keys exist but this process holds the wrong OS key.
 * Adding a key would overwrite the file, so the pool refuses and says why.
 */
export const API_KEYS_LOCKED =
  "Your saved API keys cannot be read by this build of FlareAI, so they have been left untouched rather than overwritten. Start FlareAI normally and allow keychain access to use them.";

export interface ApiKeySummary {
  id: string;
  label: string;
  active: boolean;
  status: "ready" | "rate_limited" | "invalid";
}

interface ApiKeyEntry {
  id: string;
  key: string;
  /** @deprecated Runtime health used to be persisted. It is accepted only so
   * existing stores can be migrated without losing their keys. */
  status?: ApiKeySummary["status"];
}

interface PoolFile {
  version: 1;
  providers: Record<string, {activeKeyId?: string; keys: ApiKeyEntry[]}>;
}

export class EncryptedApiKeyPool {
  readonly #filePath: string;
  readonly #cipher: SecretCipher;
  readonly #statuses = new Map<string, ApiKeySummary["status"]>();
  #writes: Promise<unknown> = Promise.resolve();
  #loaded?: Promise<PoolFile>;
  /** Set when the stored file exists but this process cannot decrypt it. The
   * keys are still in there, so nothing may overwrite them. */
  #locked = false;

  constructor(filePath: string, cipher: SecretCipher) {
    this.#filePath = filePath;
    this.#cipher = cipher;
  }

  async list(providerId: string): Promise<ApiKeySummary[]> {
    const pool = (await this.#load()).providers[providerId];
    return (pool?.keys ?? []).map((item) => ({
      id: item.id,
      label: maskKey(item.key),
      active: item.id === pool?.activeKeyId,
      status: this.#status(providerId, item),
    }));
  }

  async add(providerId: string, key: string): Promise<void> {
    assertCompleteKey(providerId, key);
    await this.#write(async (file) => {
      const pool = file.providers[providerId] ??= {keys: []};
      if (pool.keys.some((item) => item.key === key)) return;
      const item = {id: crypto.randomUUID(), key};
      pool.keys.push(item);
      pool.activeKeyId ??= item.id;
      this.#statuses.set(this.#statusKey(providerId, item.id), "ready");
    });
  }

  async remove(providerId: string, keyId: string): Promise<void> {
    await this.#write(async (file) => {
      const pool = file.providers[providerId];
      if (!pool) return;
      this.#statuses.delete(this.#statusKey(providerId, keyId));
      pool.keys = pool.keys.filter((item) => item.id !== keyId);
      if (pool.activeKeyId === keyId) pool.activeKeyId = pool.keys.find((item) => this.#status(providerId, item) === "ready")?.id ?? pool.keys[0]?.id;
      if (!pool.keys.length) delete file.providers[providerId];
    });
  }

  async candidates(providerId: string): Promise<Array<{id: string; key: string}>> {
    const pool = (await this.#load()).providers[providerId];
    if (!pool) return [];
    return [...pool.keys]
      .filter((item) => this.#status(providerId, item) !== "invalid")
      .sort((a, b) => Number(b.id === pool.activeKeyId) - Number(a.id === pool.activeKeyId))
      .map(({id, key}) => ({id, key}));
  }

  async markSuccess(providerId: string, keyId: string): Promise<void> {
    await this.#update(providerId, keyId, (pool, item) => {
      this.#statuses.set(this.#statusKey(providerId, item.id), "ready");
      pool.activeKeyId = item.id;
    });
  }

  async markFailure(providerId: string, keyId: string, reason: "rate_limit" | "auth"): Promise<void> {
    await this.#update(providerId, keyId, (pool, item) => {
      this.#statuses.set(this.#statusKey(providerId, item.id), reason === "auth" ? "invalid" : "rate_limited");
      pool.activeKeyId = pool.keys.find((candidate) => candidate.id !== item.id && this.#status(providerId, candidate) !== "invalid")?.id;
    });
  }

  #status(providerId: string, item: ApiKeyEntry): ApiKeySummary["status"] {
    if (!isCompleteKey(providerId, item.key)) return "invalid";
    return this.#statuses.get(this.#statusKey(providerId, item.id)) ?? "ready";
  }

  #statusKey(providerId: string, keyId: string): string {
    return `${providerId}\0${keyId}`;
  }

  async #update(providerId: string, keyId: string, update: (pool: PoolFile["providers"][string], item: ApiKeyEntry) => void): Promise<void> {
    await this.#write(async (file) => {
      const pool = file.providers[providerId];
      const item = pool?.keys.find((candidate) => candidate.id === keyId);
      if (pool && item) update(pool, item);
    });
  }

  async #write(change: (file: PoolFile) => Promise<void>): Promise<void> {
    const operation = this.#writes.catch((): undefined => undefined).then(async () => {
      if (!this.#cipher.isEncryptionAvailable()) throw new Error(SECURE_STORAGE_UNAVAILABLE);
      const file = await this.#load();
      // Writing now would encrypt an empty pool over keys that are still
      // there and still valid for the app that owns them.
      if (this.#locked) throw new Error(API_KEYS_LOCKED);
      await change(file);
      await mkdir(path.dirname(this.#filePath), {recursive: true});
      const encrypted = this.#cipher.encryptString(JSON.stringify(file)).toString("base64");
      const temporary = `${this.#filePath}.tmp`;
      await writeFile(temporary, encrypted, {encoding: "utf8", mode: 0o600});
      await rename(temporary, this.#filePath);
    });
    this.#writes = operation;
    return operation;
  }

  async #load(): Promise<PoolFile> {
    // A rejected read must not be cached: after a transient failure the next
    // caller retries against the file instead of failing for the process's
    // lifetime.
    this.#loaded ??= this.#readPool().catch((error: unknown) => {
      this.#loaded = undefined;
      throw error;
    });
    return this.#loaded;
  }

  async #readPool(): Promise<PoolFile> {
    const encoded = await readFile(this.#filePath, "utf8").catch((error: NodeJS.ErrnoException): undefined => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!encoded) return {version: 1, providers: {}};
    if (!this.#cipher.isEncryptionAvailable()) {
      // The pool may belong to a normally launched/signed build. Keep it
      // untouched and let another configured credential source (for example
      // OpenCode's own auth file) serve this process.
      this.#locked = true;
      return {version: 1, providers: {}};
    }
    let plaintext: string;
    try {
      plaintext = this.#cipher.decryptString(Buffer.from(encoded, "base64"));
    } catch {
      // This process cannot read the file, which is not the same as the file
      // being broken. The usual cause is a different app identity holding a
      // different OS key — `electron .` during development, a re-signed dev
      // bundle, a renamed app, or keychain access denied so Chromium fell back
      // to a throwaway session key. The real app, launched normally, still
      // decrypts it perfectly. Renaming it here would take the user's keys
      // away from the app that owns them, so the file is left exactly where it
      // is and the pool locks instead: reads report empty, writes refuse.
      this.#locked = true;
      console.warn(
        `API keys at ${this.#filePath} could not be decrypted by this process (its OS encryption key does not match). The file has been left untouched — start FlareAI normally, and allow keychain access, to use the keys again.`,
      );
      return {version: 1, providers: {}};
    }
    let file: PoolFile;
    try {
      // Decryption succeeded, so this really is our file and its contents are
      // damaged rather than merely unreadable. Nothing can recover it, and
      // leaving it in place would wedge every pool operation forever.
      file = JSON.parse(plaintext) as PoolFile;
      if (!file.providers || typeof file.providers !== "object") throw new Error("malformed pool file");
    } catch {
      await quarantineUnreadable(this.#filePath);
      return {version: 1, providers: {}};
    }
    // A key's invalid/rate-limited state describes one running session, not
    // the credential itself. Drop legacy persisted states on startup.
    for (const [providerId, pool] of Object.entries(file.providers)) {
      for (const item of pool.keys) delete item.status;
      if (!pool.keys.some((item) => item.id === pool.activeKeyId && isCompleteKey(providerId, item.key)))
        pool.activeKeyId = pool.keys.find((item) => isCompleteKey(providerId, item.key))?.id;
    }
    return file;
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return `••••${key.slice(-2)}`;
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function isCompleteKey(providerId: string, key: string): boolean {
  if (providerId !== "opencode" && providerId !== "opencode-go") return true;
  return /^sk-.{12,}$/.test(key);
}

function assertCompleteKey(providerId: string, key: string): void {
  if (!isCompleteKey(providerId, key))
    throw new Error("Enter the full OpenCode API key beginning with sk-, not a masked value or key fragment");
}
