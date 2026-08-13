import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import path from "node:path";
import type {SecretCipher} from "./credential-store.js";

export interface ApiKeySummary {
  id: string;
  label: string;
  active: boolean;
  status: "ready" | "rate_limited" | "invalid";
}

interface ApiKeyEntry {
  id: string;
  key: string;
  status: ApiKeySummary["status"];
}

interface PoolFile {
  version: 1;
  providers: Record<string, {activeKeyId?: string; keys: ApiKeyEntry[]}>;
}

export class EncryptedApiKeyPool {
  readonly #filePath: string;
  readonly #cipher: SecretCipher;
  #writes: Promise<unknown> = Promise.resolve();

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
      status: item.status,
    }));
  }

  async add(providerId: string, key: string): Promise<void> {
    await this.#write(async (file) => {
      const pool = file.providers[providerId] ??= {keys: []};
      if (pool.keys.some((item) => item.key === key)) return;
      const item = {id: crypto.randomUUID(), key, status: "ready" as const};
      pool.keys.push(item);
      pool.activeKeyId ??= item.id;
    });
  }

  async remove(providerId: string, keyId: string): Promise<void> {
    await this.#write(async (file) => {
      const pool = file.providers[providerId];
      if (!pool) return;
      pool.keys = pool.keys.filter((item) => item.id !== keyId);
      if (pool.activeKeyId === keyId) pool.activeKeyId = pool.keys.find((item) => item.status === "ready")?.id ?? pool.keys[0]?.id;
      if (!pool.keys.length) delete file.providers[providerId];
    });
  }

  async candidates(providerId: string): Promise<Array<{id: string; key: string}>> {
    const pool = (await this.#load()).providers[providerId];
    if (!pool) return [];
    return [...pool.keys]
      .filter((item) => item.status !== "invalid")
      .sort((a, b) => Number(b.id === pool.activeKeyId) - Number(a.id === pool.activeKeyId))
      .map(({id, key}) => ({id, key}));
  }

  async markSuccess(providerId: string, keyId: string): Promise<void> {
    await this.#update(providerId, keyId, (pool, item) => {
      item.status = "ready";
      pool.activeKeyId = item.id;
    });
  }

  async markFailure(providerId: string, keyId: string, reason: "rate_limit" | "auth"): Promise<void> {
    await this.#update(providerId, keyId, (pool, item) => {
      item.status = reason === "auth" ? "invalid" : "rate_limited";
      pool.activeKeyId = pool.keys.find((candidate) => candidate.id !== item.id && candidate.status !== "invalid")?.id;
    });
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
      if (!this.#cipher.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this device");
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
    const encoded = await readFile(this.#filePath, "utf8").catch((error: NodeJS.ErrnoException): undefined => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!encoded) return {version: 1, providers: {}};
    if (!this.#cipher.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this device");
    return JSON.parse(this.#cipher.decryptString(Buffer.from(encoded, "base64"))) as PoolFile;
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return `••••${key.slice(-2)}`;
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
