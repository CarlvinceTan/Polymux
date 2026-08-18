import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { SECURE_STORAGE_UNAVAILABLE, type SecretCipher } from "../system/credential-store.js";

/**
 * Passwords the embedded browser has saved.
 *
 * Kept in its own encrypted file rather than in the database, for the same
 * reason the API keys are: SQLite is readable by anything that can open the
 * file, and a password is not a preference. The public half of a login — which
 * site, which username — lives in `saved_logins`, and the secret is filed here
 * under that row's id.
 *
 * Nothing here is exposed over IPC. The renderer lists logins from the
 * database and asks for exactly one password at a time, when the user has
 * asked to see or use it.
 */

/** Shown when the file exists but this process holds the wrong OS key. */
export const LOGINS_LOCKED =
  "Your saved passwords cannot be read by this build of FlareAI, so they have been left untouched rather than overwritten. Start FlareAI normally and allow keychain access to use them.";

interface VaultFile {
  version: 1;
  /** Login row id → password. */
  passwords: Record<string, string>;
}

export class EncryptedLoginVault {
  readonly #filePath: string;
  readonly #cipher: SecretCipher;
  #writes: Promise<unknown> = Promise.resolve();
  #loaded?: Promise<VaultFile>;
  /** Set when the stored file exists but this process cannot decrypt it. The
   * passwords are still in there, so nothing may overwrite them. */
  #locked = false;

  constructor(filePath: string, cipher: SecretCipher) {
    this.#filePath = filePath;
    this.#cipher = cipher;
  }

  get locked(): boolean {
    return this.#locked;
  }

  async read(id: string): Promise<string | null> {
    return (await this.#load()).passwords[id] ?? null;
  }

  async write(id: string, password: string): Promise<void> {
    await this.#change((file) => {
      file.passwords[id] = password;
    });
  }

  async delete(id: string): Promise<void> {
    await this.#change((file) => {
      delete file.passwords[id];
    });
  }

  /** Drops every password. Used only by "clear browsing data" with logins
   * ticked, which is the one place the user asks for exactly this. */
  async clear(): Promise<void> {
    await this.#change((file) => {
      file.passwords = {};
    });
  }

  async #change(update: (file: VaultFile) => void): Promise<void> {
    const operation = this.#writes
      .catch((): undefined => undefined)
      .then(async () => {
        if (!this.#cipher.isEncryptionAvailable()) throw new Error(SECURE_STORAGE_UNAVAILABLE);
        const file = await this.#load();
        // Writing now would encrypt an empty vault over passwords that are
        // still there and still readable by the app that owns them.
        if (this.#locked) throw new Error(LOGINS_LOCKED);
        update(file);
        await mkdir(path.dirname(this.#filePath), { recursive: true });
        const encrypted = this.#cipher.encryptString(JSON.stringify(file)).toString("base64");
        const temporary = `${this.#filePath}.tmp`;
        await writeFile(temporary, encrypted, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.#filePath);
      });
    this.#writes = operation;
    return operation;
  }

  async #load(): Promise<VaultFile> {
    // A rejected read must not be cached: after a transient failure the next
    // caller retries against the file instead of failing for the process's
    // lifetime.
    this.#loaded ??= this.#readVault().catch((error: unknown) => {
      this.#loaded = undefined;
      throw error;
    });
    return this.#loaded;
  }

  async #readVault(): Promise<VaultFile> {
    const encoded = await readFile(this.#filePath, "utf8").catch(
      (error: NodeJS.ErrnoException): undefined => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (!encoded) return { version: 1, passwords: {} };
    if (!this.#cipher.isEncryptionAvailable()) throw new Error(SECURE_STORAGE_UNAVAILABLE);
    try {
      return JSON.parse(this.#cipher.decryptString(Buffer.from(encoded, "base64"))) as VaultFile;
    } catch {
      // This process cannot read the file, which is not the same as the file
      // being broken. The usual cause is a different app identity holding a
      // different OS key — `electron .` during development, a re-signed dev
      // bundle, or keychain access denied. The real app, launched normally,
      // still decrypts it. Moving it aside would take the user's passwords
      // away from the app that owns them, so it is left exactly where it is
      // and the vault locks instead: reads report empty, writes refuse.
      this.#locked = true;
      console.warn("Saved passwords could not be decrypted by this build; leaving them untouched");
      return { version: 1, passwords: {} };
    }
  }
}
