import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
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

/**
 * On macOS this state almost always means Keychain access was denied — the
 * dialog was dismissed, or the ad-hoc-signed dev bundle changed identity —
 * and Chromium remembers the denial for the rest of the process.
 */
export const SECURE_STORAGE_UNAVAILABLE =
  "Secure credential storage is unavailable. Restart FlareAI and click \"Always Allow\" when macOS asks for keychain access.";

const OPENCODE_PROVIDERS = new Set(["opencode", "opencode-go"]);

/**
 * OpenCode already owns a credential file for its providers. Treat it as a
 * read-only runtime source so a background or development build can use the
 * user's existing OpenCode Go login without copying the secret into another
 * plaintext file or depending on Electron's current Keychain identity.
 */
export class OpenCodeCredentialFallback implements CredentialStore {
  readonly #primary: CredentialStore;
  readonly #filePath: string;

  constructor(
    primary: CredentialStore,
    filePath = path.join(homedir(), ".local", "share", "opencode", "auth.json"),
  ) {
    this.#primary = primary;
    this.#filePath = filePath;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    try {
      const credential = await this.#primary.read(providerId);
      if (credential) return credential;
    } catch (cause) {
      if (!OPENCODE_PROVIDERS.has(providerId) || !isSecureStorageUnavailable(cause)) throw cause;
    }
    return OPENCODE_PROVIDERS.has(providerId) ? this.#external(providerId) : undefined;
  }

  async list(): Promise<readonly CredentialInfo[]> {
    let primary: readonly CredentialInfo[] = [];
    try {
      primary = await this.#primary.list();
    } catch (cause) {
      if (!isSecureStorageUnavailable(cause)) throw cause;
    }
    const merged = new Map(primary.map((item) => [item.providerId, item]));
    for (const providerId of OPENCODE_PROVIDERS) {
      const credential = await this.#external(providerId);
      if (credential && !merged.has(providerId)) merged.set(providerId, {providerId, type: credential.type});
    }
    return [...merged.values()];
  }

  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
    return this.#primary.modify(providerId, fn);
  }

  delete(providerId: string): Promise<void> {
    return this.#primary.delete(providerId);
  }

  async #external(providerId: string): Promise<Credential | undefined> {
    const source = await readFile(this.#filePath, "utf8").catch((cause: NodeJS.ErrnoException): undefined => {
      if (cause.code === "ENOENT") return undefined;
      throw cause;
    });
    if (!source) return undefined;
    try {
      const value = JSON.parse(source) as Record<string, unknown>;
      const entry = value[providerId];
      if (!entry || typeof entry !== "object") return undefined;
      const record = entry as Record<string, unknown>;
      if (record.type === "api" && typeof record.key === "string" && record.key)
        return {type: "api_key", key: record.key};
      if (
        record.type === "oauth" &&
        typeof record.access === "string" &&
        typeof record.refresh === "string" &&
        typeof record.expires === "number"
      ) return {type: "oauth", access: record.access, refresh: record.refresh, expires: record.expires};
    } catch {
      // OpenCode owns this file. A partial write or newer schema should make
      // the fallback unavailable, never damage or replace its state.
    }
    return undefined;
  }
}

function isSecureStorageUnavailable(cause: unknown): boolean {
  return cause instanceof Error && cause.message === SECURE_STORAGE_UNAVAILABLE;
}

/** Preserves an unreadable secrets file for inspection while clearing the
 * path for a fresh store. */
export async function quarantineUnreadable(filePath: string): Promise<void> {
  const quarantined = `${filePath}.unreadable-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await rename(filePath, quarantined).catch((): undefined => undefined);
  console.warn(`Saved credential storage at ${filePath} could not be decrypted (the OS encryption key changed). Moved it to ${quarantined}; please re-add the keys.`);
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
      throw new Error(SECURE_STORAGE_UNAVAILABLE);
    try {
      return JSON.parse(this.#cipher.decryptString(Buffer.from(encoded, "base64"))) as Credential;
    } catch {
      // Encrypted under an OS key that no longer matches (see the pool's
      // recovery path). The blob can never be read again; report the provider
      // as unconfigured so a fresh credential can be saved over it.
      console.warn(`The stored credential for ${providerId} could not be decrypted (the OS encryption key changed); treating it as absent.`);
      return undefined;
    }
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
        throw new Error(SECURE_STORAGE_UNAVAILABLE);
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
    let value: Partial<CredentialFile>;
    try {
      value = JSON.parse(source) as Partial<CredentialFile>;
    } catch {
      value = {};
    }
    if (value.version !== 1 || !value.credentials || typeof value.credentials !== "object") {
      // A corrupt store can never be read; move it aside so new credentials
      // can be saved instead of failing every operation forever.
      await quarantineUnreadable(this.#filePath);
      return {version: 1, credentials: {}};
    }
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
