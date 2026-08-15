import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import path from "node:path";
import {SECURE_STORAGE_UNAVAILABLE, quarantineUnreadable, type SecretCipher} from "./credential-store.js";

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
    if (!this.#cipher.isEncryptionAvailable()) throw new Error(SECURE_STORAGE_UNAVAILABLE);
    let file: PoolFile;
    try {
      file = JSON.parse(this.#cipher.decryptString(Buffer.from(encoded, "base64"))) as PoolFile;
      if (!file.providers || typeof file.providers !== "object") throw new Error("malformed pool file");
    } catch {
      // The OS key that encrypted this file no longer matches — a dev bundle
      // was re-signed under a new identity, keychain access was denied and
      // Chromium fell back to a throwaway session key, or the login keychain
      // was reset. The ciphertext is unrecoverable; keeping it wedges every
      // pool operation (add, list, chat) behind a decrypt error forever.
      // Move it aside and start with an empty pool so keys can be re-added.
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
