import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import path from "node:path";
import type {Credential, CredentialInfo, CredentialStore} from "@earendil-works/pi-ai";

export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface CredentialFile {
  version: 1;
  credentials: Record<string, string>;
}

/** Persists only OS-encrypted credential blobs. Secrets are never returned by
 * renderer-facing APIs and plaintext is never written to disk. */
export class EncryptedCredentialStore implements CredentialStore {
  readonly #filePath: string;
  readonly #cipher: SecretCipher;
  readonly #chains = new Map<string, Promise<unknown>>();

  constructor(filePath: string, cipher: SecretCipher) {
    this.#filePath = filePath;
    this.#cipher = cipher;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    const encoded = (await this.#load()).credentials[providerId];
    if (!encoded) return undefined;
    if (!this.#cipher.isEncryptionAvailable())
      throw new Error("Secure credential storage is unavailable on this device");
    return JSON.parse(this.#cipher.decryptString(Buffer.from(encoded, "base64"))) as Credential;
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const file = await this.#load();
    const entries = await Promise.all(Object.keys(file.credentials).map(async (providerId) => {
      const credential = await this.read(providerId);
      return credential ? {providerId, type: credential.type} : undefined;
    }));
    return entries.filter((entry): entry is CredentialInfo => entry !== undefined);
  }

  async modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
    return this.#enqueue(providerId, async () => {
      const current = await this.read(providerId);
      const next = await fn(current);
      if (next === undefined) return current;
      if (!this.#cipher.isEncryptionAvailable())
        throw new Error("Secure credential storage is unavailable on this device");
      const file = await this.#load();
      file.credentials[providerId] = this.#cipher.encryptString(JSON.stringify(next)).toString("base64");
      await this.#save(file);
      return next;
    });
  }

  async delete(providerId: string): Promise<void> {
    await this.#enqueue(providerId, async () => {
      const file = await this.#load();
      if (!(providerId in file.credentials)) return;
      delete file.credentials[providerId];
      await this.#save(file);
    });
  }

  async #load(): Promise<CredentialFile> {
    const source = await readFile(this.#filePath, "utf8").catch((error: NodeJS.ErrnoException): undefined => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!source) return {version: 1, credentials: {}};
    const value = JSON.parse(source) as Partial<CredentialFile>;
    if (value.version !== 1 || !value.credentials || typeof value.credentials !== "object")
      throw new Error("The credential store has an unsupported format");
    return {version: 1, credentials: {...value.credentials}};
  }

  async #save(file: CredentialFile): Promise<void> {
    await mkdir(path.dirname(this.#filePath), {recursive: true});
    const temporary = `${this.#filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(file, null, 2), {encoding: "utf8", mode: 0o600});
    await rename(temporary, this.#filePath);
  }

  #enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#chains.get(providerId) ?? Promise.resolve();
    const current = previous.catch((): undefined => undefined).then(task);
    this.#chains.set(providerId, current);
    void current.finally(() => {
      if (this.#chains.get(providerId) === current) this.#chains.delete(providerId);
    }).catch((): undefined => undefined);
    return current;
  }
}
