import type { Kdbx } from "kdbxweb";
import { base64ToBytes, bytesToBase64, vaultChecksum } from "./checksum.js";
import type { VaultCloudBlob } from "./cloud.js";
import { emptyMeta, parseVaultMeta, type VaultMeta, type VaultStorage } from "./meta.js";
import { matchItems } from "./match.js";
import {
  createPasskeyCredential,
  getPasskeyAssertion,
  listPasskeysForRequest,
  type PasskeyOffer,
  type WebAuthnAttestation,
  type WebAuthnCreateRequest,
  type WebAuthnGetRequest,
} from "./webauthn.js";
import {
  changeMasterPassword,
  createDatabase,
  emptyTrash,
  listGroups,
  listItems,
  listTotp,
  listTrash,
  loadDatabase,
  LOCKED,
  otpauthFor,
  purgeItem,
  readItem,
  readSecrets,
  removeItem,
  reorderItems,
  restoreItem,
  saveDatabase,
  setPinned,
  totpFor,
  upsertItem,
  type VaultItem,
  type VaultItemInput,
  type VaultSecrets,
} from "./vault.js";

export const SESSION_IDLE_SECONDS = 5 * 60;

export interface VaultBlobStore {
  load(): Promise<{ bytes: Uint8Array; meta: VaultMeta } | null>;
  save(bytes: Uint8Array, meta: VaultMeta): Promise<void>;
}

export interface VaultBlob {
  bytes: string;
  meta: VaultMeta;
}

export interface VaultSessionStatus {
  exists: boolean;
  unlocked: boolean;
  itemCount: number;
  idleLockSeconds: number;
  sync: {
    signedIn: boolean;
    available: boolean;
    state: "offline" | "local" | "syncing" | "synced" | "pending" | "error";
    storage: VaultStorage;
    revision: number;
    lastSyncedAt: string | null;
    conflict?: "cloud-exists";
    error?: string;
  };
}

export interface VaultSessionSecrets {
  password: string;
  totp: ReturnType<typeof totpFor>;
  recoveryCodes: string[];
  passkey: Omit<NonNullable<VaultSecrets["passkey"]>, "privateKeyPem"> | null;
}

/** In-memory KeePass session over a portable encrypted-blob store. */
export class VaultSession {
  readonly #store: VaultBlobStore;
  #bytes: Uint8Array | null = null;
  #meta: VaultMeta = emptyMeta();
  #db: Kdbx | null = null;
  #idle: ReturnType<typeof setTimeout> | null = null;

  constructor(store: VaultBlobStore) {
    this.#store = store;
  }

  async hydrate(): Promise<VaultSessionStatus> {
    const loaded = await this.#store.load();
    if (loaded) {
      this.#bytes = loaded.bytes;
      this.#meta = loaded.meta;
    } else {
      this.#bytes = null;
      this.#meta = emptyMeta();
    }
    return this.status();
  }

  status(): VaultSessionStatus {
    const exists = this.#bytes !== null;
    const storage = this.#meta.storage === "local" ? "local" : "account";
    return {
      exists,
      unlocked: this.#db !== null,
      itemCount: this.#db ? listItems(this.#db).length : 0,
      idleLockSeconds: SESSION_IDLE_SECONDS,
      sync: {
        signedIn: false,
        available: false,
        state: storage === "local" ? "local" : exists ? "local" : "offline",
        storage,
        revision: this.#meta.revision,
        lastSyncedAt: this.#meta.lastSyncedAt,
      },
    };
  }

  async create(password: string): Promise<VaultSessionStatus> {
    if (this.#bytes) throw new Error("A vault already exists on this device");
    if (password.length < 8) throw new Error("Use at least 8 characters");
    this.#db = await createDatabase(password, "Vault");
    await this.#persist();
    this.#armIdle();
    return this.status();
  }

  async unlock(password: string): Promise<VaultSessionStatus> {
    if (!this.#bytes) throw new Error("Create a vault first");
    this.#db = await loadDatabase(copyBuffer(this.#bytes), password);
    this.#armIdle();
    return this.status();
  }

  lock(): VaultSessionStatus {
    this.#clearIdle();
    this.#db = null;
    return this.status();
  }

  list(): { groups: ReturnType<typeof listGroups>; items: ReturnType<typeof listItems>; trash: ReturnType<typeof listTrash> } {
    const db = this.#requireOpen();
    this.#armIdle();
    return { groups: listGroups(db), items: listItems(db), trash: listTrash(db) };
  }

  reveal(id: string): VaultSessionSecrets {
    const db = this.#requireOpen();
    this.#armIdle();
    const secrets = readSecrets(db, id);
    return {
      password: secrets.password,
      totp: secrets.totp ? totpFor(db, id) : null,
      recoveryCodes: secrets.recoveryCodes,
      passkey: secrets.passkey
        ? {
            relyingParty: secrets.passkey.relyingParty,
            username: secrets.passkey.username,
            credentialId: secrets.passkey.credentialId,
            userHandle: secrets.passkey.userHandle,
          }
        : null,
    };
  }

  totp(id: string) {
    const db = this.#requireOpen();
    this.#armIdle();
    return totpFor(db, id);
  }

  codes() {
    const db = this.#requireOpen();
    this.#armIdle();
    return listTotp(db).map((row) => ({
      id: row.id,
      code: row.code,
      next: row.next,
      period: row.period,
      remaining: row.remaining,
    }));
  }

  otpauth(id: string) {
    const db = this.#requireOpen();
    this.#armIdle();
    return otpauthFor(db, id);
  }

  matchesForUrl(url: string): VaultItem[] {
    if (!this.#db) return [];
    this.#armIdle();
    return matchItems(listItems(this.#db), url);
  }

  listPasskeys(request: WebAuthnGetRequest): PasskeyOffer[] {
    const db = this.#requireOpen();
    this.#armIdle();
    return listPasskeysForRequest(db, request);
  }

  async getPasskey(request: WebAuthnGetRequest) {
    const db = this.#requireOpen();
    const assertion = await getPasskeyAssertion(db, request);
    this.#armIdle();
    return assertion;
  }

  async createPasskey(request: WebAuthnCreateRequest): Promise<WebAuthnAttestation & { itemId: string }> {
    const db = this.#requireOpen();
    const created = await createPasskeyCredential(db, request);
    await this.#persist();
    this.#armIdle();
    return { ...created.attestation, itemId: created.itemId };
  }

  fillFields(id: string): { username: string; password: string; totp: string | null } {
    const db = this.#requireOpen();
    this.#armIdle();
    const item = readItem(db, id);
    if (!item) throw new Error("That item is not in the vault");
    const secrets = readSecrets(db, id);
    return {
      username: item.username,
      password: secrets.password,
      totp: totpFor(db, id)?.code ?? null,
    };
  }

  async save(input: VaultItemInput): Promise<VaultItem> {
    const db = this.#requireOpen();
    const id = upsertItem(db, input);
    await this.#persist();
    this.#armIdle();
    const item = readItem(db, id);
    if (!item) throw new Error("The item could not be saved");
    return item;
  }

  async remove(id: string) {
    const db = this.#requireOpen();
    if (!removeItem(db, id)) throw new Error("That item is not in the vault");
    await this.#persist();
    this.#armIdle();
    return this.list();
  }

  async restore(ids: string[]) {
    const db = this.#requireOpen();
    for (const id of ids) {
      if (!restoreItem(db, id)) throw new Error("That item is not in the vault");
    }
    await this.#persist();
    this.#armIdle();
    return this.list();
  }

  async purge(ids: string[]) {
    const db = this.#requireOpen();
    for (const id of ids) {
      if (!purgeItem(db, id)) throw new Error("That item is not in the vault");
    }
    await this.#persist();
    this.#armIdle();
    return this.list();
  }

  async emptyTrash() {
    const db = this.#requireOpen();
    emptyTrash(db);
    await this.#persist();
    this.#armIdle();
    return this.list();
  }

  async pin(ids: string[], pinned: boolean) {
    const db = this.#requireOpen();
    if (setPinned(db, ids, pinned) !== ids.length) throw new Error("That item is not in the vault");
    await this.#persist();
    this.#armIdle();
    return this.list();
  }

  async reorder(ids: string[]) {
    const db = this.#requireOpen();
    reorderItems(db, ids);
    await this.#persist();
    this.#armIdle();
    return this.list();
  }

  async changePassword(current: string, next: string): Promise<VaultSessionStatus> {
    if (next.length < 8) throw new Error("Use at least 8 characters");
    const db = this.#requireOpen();
    if (!this.#bytes) throw new Error(LOCKED);
    await loadDatabase(copyBuffer(this.#bytes), current);
    await changeMasterPassword(db, next);
    await this.#persist();
    this.#armIdle();
    return this.status();
  }

  copyText(id: string, field: string, recoveryIndex?: number): string {
    const db = this.#requireOpen();
    this.#armIdle();
    if (field === "totp") {
      const totp = totpFor(db, id);
      if (!totp) throw new Error("This item has no authenticator code");
      return totp.code;
    }
    const item = readItem(db, id);
    if (!item) throw new Error("That item is not in the vault");
    if (field === "username") return item.username;
    if (field === "url") return item.url;
    if (field === "notes") return item.notes;
    const secrets = readSecrets(db, id);
    if (field === "recovery") {
      const code = secrets.recoveryCodes[recoveryIndex ?? -1];
      if (!code) throw new Error("That recovery code is not stored");
      return code;
    }
    if (!secrets.password) throw new Error("This item has no password");
    return secrets.password;
  }

  async setStorage(mode: VaultStorage): Promise<VaultSessionStatus> {
    if (mode !== "local" && mode !== "account") throw new Error("Choose This device or Account");
    this.#meta = { ...this.#meta, storage: mode };
    if (this.#bytes) await this.#store.save(this.#bytes, this.#meta);
    return this.status();
  }

  exportBlob(): VaultBlob | null {
    if (!this.#bytes) return null;
    return { bytes: bytesToBase64(this.#bytes), meta: this.#meta };
  }

  async importBlob(blob: VaultBlob): Promise<VaultSessionStatus> {
    const meta = parseVaultMeta(blob.meta) ?? emptyMeta();
    const bytes = base64ToBytes(blob.bytes);
    if (!bytes.byteLength) throw new Error("That vault copy is empty");
    this.lock();
    this.#bytes = bytes;
    this.#meta = {
      ...meta,
      checksum: meta.checksum || vaultChecksum(bytes),
    };
    await this.#store.save(this.#bytes, this.#meta);
    return this.status();
  }

  async importCloud(blob: VaultCloudBlob): Promise<VaultSessionStatus> {
    return this.importBlob({
      bytes: bytesToBase64(blob.bytes),
      meta: {
        revision: blob.revision,
        updatedAt: blob.updatedAt,
        checksum: blob.checksum || vaultChecksum(blob.bytes),
        dirty: false,
        lastSyncedAt: new Date().toISOString(),
        storage: "account",
      },
    });
  }

  async acknowledgePush(): Promise<VaultSessionStatus> {
    if (!this.#bytes) return this.status();
    this.#meta = {
      ...this.#meta,
      dirty: false,
      lastSyncedAt: new Date().toISOString(),
      storage: this.#meta.storage === "local" ? "local" : "account",
    };
    await this.#store.save(this.#bytes, this.#meta);
    return this.status();
  }

  #requireOpen(): Kdbx {
    if (!this.#db) throw new Error(LOCKED);
    return this.#db;
  }

  async #persist(): Promise<void> {
    if (!this.#db) return;
    const bytes = await saveDatabase(this.#db);
    this.#bytes = bytes;
    this.#meta = {
      revision: this.#meta.revision + 1,
      updatedAt: new Date().toISOString(),
      checksum: vaultChecksum(bytes),
      dirty: true,
      lastSyncedAt: this.#meta.lastSyncedAt,
      storage: this.#meta.storage === "local" ? "local" : "account",
    };
    await this.#store.save(bytes, this.#meta);
  }

  #armIdle(): void {
    this.#clearIdle();
    this.#idle = setTimeout(() => {
      this.lock();
    }, SESSION_IDLE_SECONDS * 1000);
    this.#idle.unref?.();
  }

  #clearIdle(): void {
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = null;
  }
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

export function parseVaultBlob(value: unknown): VaultBlob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.bytes !== "string" || !row.bytes) return null;
  const meta = parseVaultMeta(row.meta);
  if (!meta) return null;
  return { bytes: row.bytes, meta };
}
