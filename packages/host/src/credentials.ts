import {execFile} from "node:child_process";
import {createCipheriv, createDecipheriv, createHash, randomBytes} from "node:crypto";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import path from "node:path";
import type {Credential, CredentialInfo, CredentialStore} from "@earendil-works/pi-ai";
import type {CommandRunner} from "@polymux/hub";

/**
 * Headless secret storage. Desktop keeps these blobs in the OS keychain via
 * Electron's safeStorage; a server has neither, so both the Hub credential
 * store and the mailbox keychain shim below seal their files with a key
 * derived from the local administration secret. The files live next to the
 * admin secret at 0600, so anyone who can read them already owns the Host.
 */

function keyFor(adminSecret: string, scope: string): Buffer {
  if (!adminSecret) throw new Error("Local administration must be configured before storing secrets.");
  return createHash("sha256").update(`polymux-headless:${scope}:${adminSecret}`).digest();
}

interface SealedFile {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

function seal(key: Buffer, plaintext: string): SealedFile {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function openSealed(key: Buffer, file: SealedFile): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(file.iv, "base64"));
  decipher.setAuthTag(Buffer.from(file.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(file.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function writeSealedJson(file: string, key: Buffer, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(seal(key, JSON.stringify(value))), {mode: 0o600});
  await rename(temporary, file);
}

/**
 * Reads a sealed file, quarantining it (rather than deleting it) when the
 * administration secret no longer decrypts it — the same posture Desktop
 * takes when the OS encryption key changes under it.
 */
async function readSealedJson<T>(file: string, key: Buffer): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (cause: unknown) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
  try {
    return JSON.parse(openSealed(key, JSON.parse(raw) as SealedFile)) as T;
  } catch {
    const quarantined = `${file}.unreadable-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await rename(file, quarantined).catch((): undefined => undefined);
    console.warn(`Sealed storage at ${file} could not be decrypted (the administration secret changed). Moved it to ${quarantined}; stored secrets need re-adding.`);
    return null;
  }
}

/** File-backed CredentialStore for the Hub's Matrix token and API keys. */
export class HeadlessCredentialStore implements CredentialStore {
  readonly #file: string;
  readonly #key: Buffer;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(file: string, adminSecret: string) {
    this.#file = file;
    this.#key = keyFor(adminSecret, "credentials");
  }

  async read(providerId: string): Promise<Credential | undefined> {
    const stored = await readSealedJson<Record<string, Credential>>(this.#file, this.#key);
    return stored?.[providerId];
  }

  async flush(): Promise<void> { await this.#queue; }

  async list(): Promise<readonly CredentialInfo[]> {
    const stored = await readSealedJson<Record<string, Credential>>(this.#file, this.#key);
    return Object.entries(stored ?? {}).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const task = this.#queue.then(async () => {
      const stored = await readSealedJson<Record<string, Credential>>(this.#file, this.#key) ?? {};
      const next = await fn(stored[providerId]);
      if (next !== undefined) {
        stored[providerId] = next;
        await writeSealedJson(this.#file, this.#key, stored);
      }
      return next;
    });
    this.#queue = task.catch((): undefined => undefined);
    return task;
  }

  delete(providerId: string): Promise<void> {
    const task = this.#queue.then(async () => {
      const stored = await readSealedJson<Record<string, Credential>>(this.#file, this.#key) ?? {};
      if (stored[providerId] !== undefined) {
        delete stored[providerId];
        await writeSealedJson(this.#file, this.#key, stored);
      }
    });
    this.#queue = task.catch((): undefined => undefined);
    return task;
  }
}

/**
 * Splits one `security` stdin line the way the shell would: single-quoted
 * runs are literal, and `'\\''` inside them is an escaped quote. Only what
 * EmailSecrets emits needs to parse — a subcommand plus `-s`/`-a`/`-w`
 * flags — anything else falls through to a real spawn below.
 */
export function splitSecurityLine(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quoted = false;
  let index = 0;
  while (index < line.length) {
    const char = line[index]!;
    if (quoted) {
      if (char === "'") quoted = false;
      else current += char;
      index += 1;
      continue;
    }
    if (char === "'") {
      quoted = true;
      started = true;
      index += 1;
      continue;
    }
    if (char === "\\" && index + 1 < line.length) {
      current += line[index + 1]!;
      started = true;
      index += 2;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      index += 1;
      continue;
    }
    current += char;
    started = true;
    index += 1;
  }
  if (started) tokens.push(current);
  return tokens;
}

function securityOptions(tokens: string[]): Map<string, string> | null {
  const options = new Map<string, string>();
  for (let index = 1; index < tokens.length; index += 1) {
    const flag = tokens[index]!;
    if (flag === "-U" && tokens[0] === "add-generic-password") continue;
    if (flag === "-w" && tokens[0] === "find-generic-password") continue;
    if (!["-s", "-a", "-w"].includes(flag) || index + 1 >= tokens.length) return null;
    options.set(flag, tokens[++index]!);
  }
  return options;
}

/**
 * Runs mailbox secrets without macOS. EmailSecrets shells out to the
 * `security` CLI; headless Linux has no such binary, so the three
 * subcommands it uses are emulated against a sealed file while every other
 * command spawns for real. OAuth sign-in still needs a browser and fails
 * with a clear error from the caller; password mailboxes work fully.
 */
export function createKeychainShimRun(file: string, adminSecret: string): CommandRunner {
  const key = keyFor(adminSecret, "email-secrets");
  let queue: Promise<unknown> = Promise.resolve();
  const update = <T>(
    fn: (secrets: Record<string, Record<string, string>>) => Promise<T>,
    writeBack = true,
  ): Promise<T> => {
    const task = queue.then(async () => {
      const stored = await readSealedJson<Record<string, Record<string, string>>>(file, key) ?? {};
      const secrets: Record<string, Record<string, string>> = Object.create(null);
      for (const [service, accounts] of Object.entries(stored)) {
        secrets[service] = Object.assign(Object.create(null), accounts);
      }
      const result = await fn(secrets);
      // A read must not rewrite the sealed file. Besides the pointless I/O, a
      // rewrite can land after the caller has already shut down.
      if (writeBack) await writeSealedJson(file, key, secrets);
      return result;
    });
    queue = task.catch((): undefined => undefined);
    return task;
  };

  return async (command, args, input) => {
    if (command !== "security" || args[0] !== "-i" || typeof input !== "string") {
      return new Promise((resolve) => {
        execFile(command, args, (error, stdout, stderr) => {
          if (error) {
            const code = typeof (error as {code?: unknown}).code === "number"
              ? (error as {code: number}).code
              : 1;
            resolve({code, stdout: String(stdout), stderr: String(stderr)});
            return;
          }
          resolve({code: 0, stdout: String(stdout), stderr: String(stderr)});
        });
      });
    }
    const tokens = splitSecurityLine(input.trim());
    return update(async (secrets) => {
      const options = securityOptions(tokens);
      if (!options) return {code: 1, stdout: "", stderr: "invalid security options"};
      const service = options.get("-s");
      const account = options.get("-a");
      if (!service || !account) return {code: 1, stdout: "", stderr: "missing service or account"};
      switch (tokens[0]) {
        case "find-generic-password": {
          const secret = secrets[service]?.[account];
          return secret === undefined
            ? {code: 44, stdout: "", stderr: "no such entry"}
            : {code: 0, stdout: `${secret}\n`, stderr: ""};
        }
        case "add-generic-password": {
          const secret = options.get("-w");
          if (secret === undefined) return {code: 1, stdout: "", stderr: "missing secret"};
          secrets[service] ??= Object.create(null);
          secrets[service]![account] = secret;
          return {code: 0, stdout: "", stderr: ""};
        }
        case "delete-generic-password": {
          delete secrets[service]?.[account];
          return {code: 0, stdout: "", stderr: ""};
        }
        default:
          return {code: 1, stdout: "", stderr: `unsupported security subcommand: ${tokens[0] ?? ""}`};
      }
    }, tokens[0] !== "find-generic-password");
  };
}
