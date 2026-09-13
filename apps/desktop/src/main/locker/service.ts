import {existsSync, mkdirSync, readFileSync} from "node:fs";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {writeFileAtomicSync} from "@polymux/core";
import {
  createDatabase,
  createPasskeyCredential,
  emptyMeta,
  emptyTrash,
  getPasskeyAssertion,
  importCsvLogins,
  importKdbxFile,
  listGroups,
  listItems,
  listPasskeysForRequest,
  listTotp,
  listTrash,
  loadDatabase,
  LOCKED,
  matchItems,
  otpauthFor,
  parseVaultMeta,
  planSync,
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
  changeMasterPassword,
  type PasskeyOffer,
  type VaultMeta,
  type WebAuthnAttestation,
  type WebAuthnCreateRequest,
  type WebAuthnGetRequest,
} from "@polymux/locker";
import type {
  LockerCodesDto,
  LockerCopyField,
  LockerImportResultDto,
  LockerImportStartDto,
  LockerItemDto,
  LockerItemInputDto,
  LockerListDto,
  LockerSecretsDto,
  LockerStatusDto,
  LockerStorageMode,
  LockerStorageResolve,
  LockerSyncDto,
  LockerTotpDto,
  LockerVaultBlobDto,
} from "@polymux/protocol";
import type {Kdbx} from "kdbxweb";
import {type LockerCloudBlob, type LockerCloudStore, vaultChecksum} from "./cloud.js";

export const LOCKER_IDLE_SECONDS = 5 * 60;
const VAULT_NAME = "vault.kdbx";
const META_NAME = "vault.meta.json";

export class LockerService {
  readonly #vaultPath: string;
  readonly #metaPath: string;
  readonly #changed: () => void;
  #db: Kdbx | null = null;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #pendingImport: {bytes: ArrayBuffer; name: string} | null = null;
  #cloud: LockerCloudStore | null = null;
  #meta: VaultMeta = emptyMeta();
  #syncing = false;
  #syncError: string | undefined;
  #conflict: "cloud-exists" | undefined;

  constructor(options: {dataDirectory: string; onChanged: () => void}) {
    const directory = path.join(options.dataDirectory, "locker");
    this.#vaultPath = path.join(directory, VAULT_NAME);
    this.#metaPath = path.join(directory, META_NAME);
    this.#changed = options.onChanged;
    this.#meta = this.#readMeta();
  }

  attachCloud(cloud: LockerCloudStore | null): void {
    this.#cloud = cloud;
  }

  status(): LockerStatusDto {
    return {
      exists: this.#exists(),
      unlocked: this.#db !== null,
      itemCount: this.#db ? listItems(this.#db).length : 0,
      idleLockSeconds: LOCKER_IDLE_SECONDS,
      sync: this.syncStatus(),
    };
  }

  syncStatus(): LockerSyncDto {
    const cloud = this.#cloud;
    const available = cloud?.available() ?? false;
    const signedIn = cloud?.signedIn() ?? false;
    const storage = this.#storage();
    let state: LockerSyncDto["state"] = "offline";
    if (storage === "local") state = "local";
    else if (this.#syncing) state = "syncing";
    else if (this.#syncError) state = "error";
    else if (!available) state = "offline";
    else if (!signedIn) state = this.#exists() ? "local" : "offline";
    else if (this.#meta.dirty) state = "pending";
    else if (this.#meta.lastSyncedAt) state = "synced";
    else state = this.#exists() ? "local" : "offline";
    return {
      signedIn,
      available,
      state,
      storage,
      revision: this.#meta.revision,
      lastSyncedAt: this.#meta.lastSyncedAt,
      conflict: this.#conflict,
      error: storage === "local" ? undefined : this.#syncError,
    };
  }

  async create(password: string): Promise<LockerStatusDto> {
    if (this.#exists()) throw new Error("A locker already exists on this device");
    if (password.length < 8) throw new Error("Use at least 8 characters");
    if (this.#accounts()) await this.hydrate();
    if (this.#exists()) return this.status();
    mkdirSync(path.dirname(this.#vaultPath), {recursive: true});
    this.#db = await createDatabase(password, "Locker");
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.status();
  }

  async unlock(password: string): Promise<LockerStatusDto> {
    if (!this.#exists() && this.#accounts()) await this.hydrate();
    if (!this.#exists()) throw new Error("Create a locker first");
    const bytes = await readFile(this.#vaultPath);
    this.#db = await loadDatabase(copyBuffer(bytes), password);
    this.#armIdle();
    this.#changed();
    return this.status();
  }

  lock(): LockerStatusDto {
    this.#clearIdle();
    this.#db = null;
    this.#pendingImport = null;
    this.#changed();
    return this.status();
  }

  touch(): void {
    if (this.#db) this.#armIdle();
  }

  list(): LockerListDto {
    const db = this.#requireOpen();
    this.#armIdle();
    return {groups: listGroups(db), items: listItems(db), trash: listTrash(db)};
  }

  reveal(id: string): LockerSecretsDto {
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

  totp(id: string): LockerTotpDto | null {
    const db = this.#requireOpen();
    this.#armIdle();
    return totpFor(db, id);
  }

  codes(): LockerCodesDto[] {
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

  otpauth(id: string): string | null {
    const db = this.#requireOpen();
    this.#armIdle();
    return otpauthFor(db, id);
  }

  /** Entries for a page, without secrets. Locked and missing vaults return
   * an empty list so the browser can offer unlock without leaking titles. */
  matchesForUrl(url: string): LockerItemDto[] {
    if (!this.#db) return [];
    this.#armIdle();
    return matchItems(listItems(this.#db), url);
  }

  fillFields(id: string): {username: string; password: string; totp: string | null} {
    const db = this.#requireOpen();
    this.#armIdle();
    const item = readItem(db, id);
    if (!item) throw new Error("That item is not in the locker");
    const secrets = readSecrets(db, id);
    return {
      username: item.username,
      password: secrets.password,
      totp: totpFor(db, id)?.code ?? null,
    };
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

  async createPasskey(request: WebAuthnCreateRequest): Promise<WebAuthnAttestation & {itemId: string}> {
    const db = this.#requireOpen();
    const created = await createPasskeyCredential(db, request);
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return {...created.attestation, itemId: created.itemId};
  }

  async save(input: LockerItemInputDto): Promise<LockerItemDto> {
    const db = this.#requireOpen();
    const id = upsertItem(db, input);
    await this.#persist();
    this.#armIdle();
    this.#changed();
    const item = readItem(db, id);
    if (!item) throw new Error("The item could not be saved");
    return item;
  }

  async remove(id: string): Promise<LockerListDto> {
    const db = this.#requireOpen();
    if (!removeItem(db, id)) throw new Error("That item is not in the locker");
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.list();
  }

  async restore(ids: string[]): Promise<LockerListDto> {
    const db = this.#requireOpen();
    for (const id of ids) {
      if (!restoreItem(db, id)) throw new Error("That item is not in the locker");
    }
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.list();
  }

  async purge(ids: string[]): Promise<LockerListDto> {
    const db = this.#requireOpen();
    for (const id of ids) {
      if (!purgeItem(db, id)) throw new Error("That item is not in the locker");
    }
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.list();
  }

  async emptyTrash(): Promise<LockerListDto> {
    const db = this.#requireOpen();
    emptyTrash(db);
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.list();
  }

  async pin(ids: string[], pinned: boolean): Promise<LockerListDto> {
    const db = this.#requireOpen();
    if (setPinned(db, ids, pinned) !== ids.length) throw new Error("That item is not in the locker");
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.list();
  }

  async reorder(ids: string[]): Promise<LockerListDto> {
    const db = this.#requireOpen();
    reorderItems(db, ids);
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.list();
  }

  async changePassword(current: string, next: string): Promise<LockerStatusDto> {
    if (next.length < 8) throw new Error("Use at least 8 characters");
    const db = this.#requireOpen();
    const bytes = await readFile(this.#vaultPath);
    await loadDatabase(copyBuffer(bytes), current);
    await changeMasterPassword(db, next);
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.status();
  }

  copyText(id: string, field: LockerCopyField, recoveryIndex?: number): string {
    const db = this.#requireOpen();
    this.#armIdle();
    if (field === "totp") {
      const totp = totpFor(db, id);
      if (!totp) throw new Error("This item has no authenticator code");
      return totp.code;
    }
    const item = readItem(db, id);
    if (!item) throw new Error("That item is not in the locker");
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

  async importBegin(filePath: string | null): Promise<LockerImportStartDto> {
    const db = this.#requireOpen();
    if (!filePath) return {status: "cancelled"};
    const bytes = copyBuffer(await readFile(filePath));
    const name = path.basename(filePath);
    if (filePath.toLowerCase().endsWith(".csv")) {
      const result = importCsvLogins(db, Buffer.from(bytes).toString("utf8"));
      await this.#persist();
      this.#armIdle();
      this.#changed();
      return {status: "imported", ...result};
    }
    if (filePath.toLowerCase().endsWith(".kdbx")) {
      this.#pendingImport = {bytes, name};
      return {status: "needs-password", name};
    }
    throw new Error("Choose a KeePass (.kdbx) or CSV file");
  }

  async importConfirm(password: string): Promise<LockerImportResultDto> {
    const db = this.#requireOpen();
    const pending = this.#pendingImport;
    if (!pending) throw new Error("Choose a KeePass file first");
    const folder = pending.name.replace(/\.kdbx$/i, "") || "Imported";
    const result = await importKdbxFile(db, pending.bytes, password, folder);
    this.#pendingImport = null;
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return result;
  }

  /** Pull or push the encrypted blob. Safe while locked; skips a pull while unlocked. */
  async hydrate(): Promise<LockerStatusDto> {
    return this.sync({allowPull: this.#db === null});
  }

  async setStorage(mode: LockerStorageMode, resolve?: LockerStorageResolve): Promise<LockerStatusDto> {
    if (mode !== "local" && mode !== "account") throw new Error("Choose This device or Account");
    if (mode === "local") {
      this.#meta = {...this.#meta, storage: "local"};
      this.#conflict = undefined;
      this.#syncError = undefined;
      this.#writeMeta();
      this.#changed();
      return this.status();
    }
    this.#meta = {...this.#meta, storage: "account"};
    this.#writeMeta();
    if (resolve === "keep-local") {
      this.#conflict = undefined;
      return this.sync({allowPull: false, force: "push"});
    }
    if (resolve === "keep-cloud") {
      this.#conflict = undefined;
      if (this.#db) this.lock();
      return this.sync({allowPull: true, force: "pull"});
    }
    const cloud = this.#cloud;
    if (cloud?.signedIn() && this.#exists()) {
      try {
        const remote = await cloud.pull();
        if (remote && (this.#meta.checksum !== remote.checksum || !this.#meta.lastSyncedAt)) {
          this.#conflict = "cloud-exists";
          this.#syncError = undefined;
          this.#changed();
          return this.status();
        }
      } catch (error) {
        this.#syncError = error instanceof Error ? error.message : String(error);
        this.#changed();
        return this.status();
      }
    }
    this.#conflict = undefined;
    return this.hydrate();
  }

  async sync(options: {allowPull?: boolean; force?: "push" | "pull"} = {}): Promise<LockerStatusDto> {
    if (!this.#accounts()) {
      this.#syncError = undefined;
      return this.status();
    }
    const cloud = this.#cloud;
    if (!cloud?.signedIn()) {
      this.#syncError = undefined;
      return this.status();
    }
    if (this.#syncing) return this.status();
    this.#syncing = true;
    this.#changed();
    try {
      const remote = await cloud.pull();
      const local = this.#exists()
        ? {
            revision: this.#meta.revision,
            updatedAt: this.#meta.updatedAt,
            checksum: this.#meta.checksum,
            dirty: this.#meta.dirty,
            lastSyncedAt: this.#meta.lastSyncedAt,
          }
        : null;
      const plan = options.force
        ? {action: options.force, reason: "forced"}
        : planSync(local, remote);
      if (plan.action === "pull") {
        if (options.allowPull === false || this.#db) {
          this.#syncError = undefined;
          return this.status();
        }
        if (!remote) return this.status();
        this.#writeVault(remote);
      } else if (plan.action === "push") {
        const bytes = this.#exists() ? await readFile(this.#vaultPath) : null;
        if (!bytes) return this.status();
        const blob: LockerCloudBlob = {
          bytes,
          revision: this.#meta.revision,
          updatedAt: this.#meta.updatedAt,
          checksum: this.#meta.checksum || vaultChecksum(bytes),
        };
        await cloud.push(blob);
        this.#meta = {
          ...this.#meta,
          dirty: false,
          lastSyncedAt: new Date().toISOString(),
          checksum: blob.checksum,
          storage: "account",
        };
        this.#writeMeta();
      }
      this.#syncError = undefined;
    } catch (error) {
      this.#syncError = error instanceof Error ? error.message : String(error);
    } finally {
      this.#syncing = false;
      this.#changed();
    }
    return this.status();
  }

  close(): void {
    this.lock();
  }

  /** Encrypted file plus metadata. Safe while locked. */
  exportVault(): LockerVaultBlobDto | null {
    if (!this.#exists()) return null;
    const bytes = readFileSync(this.#vaultPath);
    return {
      bytes: Buffer.from(bytes).toString("base64"),
      meta: this.#meta,
    };
  }

  async importVault(blob: LockerVaultBlobDto): Promise<LockerStatusDto> {
    const bytes = Buffer.from(blob.bytes, "base64");
    if (!bytes.byteLength) throw new Error("That locker copy is empty");
    if (this.#db) this.lock();
    this.#writeVault({
      bytes,
      revision: blob.meta.revision,
      updatedAt: blob.meta.updatedAt,
      checksum: blob.meta.checksum || vaultChecksum(bytes),
    });
    this.#meta = {
      ...this.#meta,
      dirty: blob.meta.dirty,
      lastSyncedAt: blob.meta.lastSyncedAt,
      storage: blob.meta.storage === "local" ? "local" : "account",
    };
    this.#writeMeta();
    this.#changed();
    return this.status();
  }

  #storage(): LockerStorageMode {
    return this.#meta.storage === "local" ? "local" : "account";
  }

  #accounts(): boolean {
    return this.#storage() === "account";
  }

  #exists(): boolean {
    return existsSync(this.#vaultPath);
  }

  #requireOpen(): Kdbx {
    if (!this.#db) throw new Error(LOCKED);
    return this.#db;
  }

  async #persist(): Promise<void> {
    if (!this.#db) return;
    const bytes = await saveDatabase(this.#db);
    mkdirSync(path.dirname(this.#vaultPath), {recursive: true});
    writeFileAtomicSync(this.#vaultPath, bytes);
    this.#meta = {
      revision: this.#meta.revision + 1,
      updatedAt: new Date().toISOString(),
      checksum: vaultChecksum(bytes),
      dirty: true,
      lastSyncedAt: this.#meta.lastSyncedAt,
      storage: this.#storage(),
    };
    this.#writeMeta();
    if (this.#accounts()) await this.sync({allowPull: false});
  }

  #writeVault(blob: LockerCloudBlob): void {
    mkdirSync(path.dirname(this.#vaultPath), {recursive: true});
    writeFileAtomicSync(this.#vaultPath, blob.bytes);
    this.#meta = {
      revision: blob.revision,
      updatedAt: blob.updatedAt,
      checksum: blob.checksum || vaultChecksum(blob.bytes),
      dirty: false,
      lastSyncedAt: new Date().toISOString(),
      storage: "account",
    };
    this.#writeMeta();
  }

  #readMeta(): VaultMeta {
    try {
      return parseVaultMeta(JSON.parse(readFileSync(this.#metaPath, "utf8"))) ?? emptyMeta();
    } catch {
      return emptyMeta();
    }
  }

  #writeMeta(): void {
    mkdirSync(path.dirname(this.#metaPath), {recursive: true});
    writeFileAtomicSync(this.#metaPath, `${JSON.stringify(this.#meta)}\n`);
  }

  #armIdle(): void {
    this.#clearIdle();
    this.#idleTimer = setTimeout(() => {
      this.lock();
    }, LOCKER_IDLE_SECONDS * 1000);
    this.#idleTimer.unref?.();
  }

  #clearIdle(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
  }
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
