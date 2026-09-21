import {existsSync, mkdirSync, readFileSync, renameSync, rmSync} from "node:fs";
import {readFile, writeFile} from "node:fs/promises";
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
  mergeKdbx,
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
  WRONG_PASSWORD,
  type PasskeyOffer,
  type VaultMeta,
  type WebAuthnAttestation,
  type WebAuthnCreateRequest,
  type WebAuthnGetRequest,
} from "@polymux/vault";
import type {
  VaultBiometricDto,
  VaultCodesDto,
  VaultCopyField,
  VaultImportResultDto,
  VaultImportStartDto,
  VaultItemDto,
  VaultItemInputDto,
  VaultListDto,
  VaultSecretsDto,
  VaultStatusDto,
  VaultStorageMode,
  VaultStorageResolve,
  VaultSyncDto,
  VaultTotpDto,
  VaultBlobDto,
} from "@polymux/protocol";
import type {Kdbx} from "kdbxweb";
import {type VaultCloudBlob, type VaultCloudStore, vaultChecksum} from "./cloud.js";

export const VAULT_IDLE_SECONDS = 5 * 60;
const VAULT_NAME = "vault.kdbx";
const META_NAME = "vault.meta.json";
const BIOMETRIC_NAME = "biometric.key";

/** OS hooks for biometric unlock, injected so tests can fake them. */
export interface VaultBiometrics {
  isEncryptionAvailable(): boolean;
  canPromptBiometric(): boolean;
  promptBiometric(reason: string): Promise<void>;
  encryptString(password: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class VaultService {
  readonly #vaultPath: string;
  readonly #metaPath: string;
  readonly #biometricPath: string;
  readonly #changed: () => void;
  readonly #biometrics: VaultBiometrics | null;
  #db: Kdbx | null = null;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #pendingImport: {bytes: ArrayBuffer; name: string} | null = null;
  #cloud: VaultCloudStore | null = null;
  #meta: VaultMeta = emptyMeta();
  #syncing = false;
  #syncError: string | undefined;
  /** Master password kept only while unlocked so sync can merge the account
   * copy item-by-item. Cleared on lock with the open database. */
  #password: string | null = null;

  constructor(options: {dataDirectory: string; onChanged: () => void; biometrics?: VaultBiometrics | null}) {
    const legacy = path.join(options.dataDirectory, "locker");
    let directory = path.join(options.dataDirectory, "vault");
    // One-time rename: the vault directory used to be called 'locker'.
    // Move it forward once so existing vaults survive the rename; if the
    // move fails, keep serving the old directory rather than a blank vault.
    if (!existsSync(directory) && existsSync(legacy)) {
      try {
        renameSync(legacy, directory);
      } catch {
        directory = legacy;
      }
    }
    this.#vaultPath = path.join(directory, VAULT_NAME);
    this.#metaPath = path.join(directory, META_NAME);
    this.#biometricPath = path.join(directory, BIOMETRIC_NAME);
    this.#changed = options.onChanged;
    this.#biometrics = options.biometrics ?? null;
    this.#meta = this.#readMeta();
  }

  attachCloud(cloud: VaultCloudStore | null): void {
    this.#cloud = cloud;
  }

  status(): VaultStatusDto {
    return {
      exists: this.#exists(),
      unlocked: this.#db !== null,
      itemCount: this.#db ? listItems(this.#db).length : 0,
      idleLockSeconds: VAULT_IDLE_SECONDS,
      sync: this.syncStatus(),
      biometric: this.biometricStatus(),
    };
  }

  biometricStatus(): VaultBiometricDto {
    const biometrics = this.#biometrics;
    const available =
      biometrics !== null &&
      biometrics.isEncryptionAvailable() &&
      biometrics.canPromptBiometric();
    return {available, enrolled: available && existsSync(this.#biometricPath)};
  }

  /** Store the master password for biometric unlock. Verifies the password
   * against the vault file first, so a typo cannot lock the user out of
   * Touch ID. Only while unlocked. */
  async enrollBiometric(password: string): Promise<VaultStatusDto> {
    this.#requireOpen();
    const biometrics = this.#requireBiometrics();
    const bytes = await readFile(this.#vaultPath);
    await loadDatabase(copyBuffer(bytes), password);
    mkdirSync(path.dirname(this.#biometricPath), {recursive: true});
    await writeFile(this.#biometricPath, biometrics.encryptString(password), {mode: 0o600});
    this.#changed();
    return this.status();
  }

  async disenrollBiometric(): Promise<VaultStatusDto> {
    try {
      rmSync(this.#biometricPath, {force: true});
    } catch {
      // Missing enrollment file is already the desired state.
    }
    this.#changed();
    return this.status();
  }

  /** Prompt for biometrics, then unlock with the stored master password.
   * A wrong-password failure means the password changed elsewhere, so the
   * stale enrollment is cleared rather than retried forever. */
  async unlockBiometric(): Promise<VaultStatusDto> {
    const biometrics = this.#requireBiometrics();
    if (!existsSync(this.#biometricPath)) throw new Error("Touch ID unlock is not set up");
    await biometrics.promptBiometric("Unlock your vault");
    let password: string;
    try {
      password = biometrics.decryptString(readFileSync(this.#biometricPath));
    } catch {
      throw new Error("Touch ID unlock is not set up");
    }
    try {
      return await this.unlock(password);
    } catch (error) {
      if (error instanceof Error && error.message === WRONG_PASSWORD) {
        try {
          rmSync(this.#biometricPath, {force: true});
        } catch {
          // Enrollment already gone; the password error below matters.
        }
      }
      throw error;
    }
  }

  #requireBiometrics(): VaultBiometrics {
    const biometrics = this.#biometrics;
    if (!biometrics || !biometrics.isEncryptionAvailable() || !biometrics.canPromptBiometric())
      throw new Error("Touch ID is not available on this device");
    return biometrics;
  }

  syncStatus(): VaultSyncDto {
    const cloud = this.#cloud;
    const available = cloud?.available() ?? false;
    const signedIn = cloud?.signedIn() ?? false;
    const storage = this.#storage();
    let state: VaultSyncDto["state"] = "offline";
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
      error: storage === "local" ? undefined : this.#syncError,
    };
  }

  async create(password: string): Promise<VaultStatusDto> {
    if (this.#exists()) throw new Error("A vault already exists on this device");
    if (password.length < 8) throw new Error("Use at least 8 characters");
    if (this.#syncOn()) await this.hydrate();
    if (this.#exists()) return this.status();
    mkdirSync(path.dirname(this.#vaultPath), {recursive: true});
    this.#db = await createDatabase(password, "Vault");
    this.#password = password;
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.status();
  }

  async unlock(password: string): Promise<VaultStatusDto> {
    if (!this.#exists() && this.#syncOn()) await this.hydrate();
    if (!this.#exists()) throw new Error("Create a vault first");
    const bytes = await readFile(this.#vaultPath);
    this.#db = await loadDatabase(copyBuffer(bytes), password);
    this.#password = password;
    this.#armIdle();
    this.#changed();
    if (this.#syncOn()) await this.sync({allowPull: false});
    return this.status();
  }

  lock(): VaultStatusDto {
    this.#clearIdle();
    this.#db = null;
    this.#password = null;
    this.#pendingImport = null;
    this.#changed();
    return this.status();
  }

  touch(): void {
    if (this.#db) this.#armIdle();
  }

  list(): VaultListDto {
    const db = this.#requireOpen();
    this.#armIdle();
    return {groups: listGroups(db), items: listItems(db), trash: listTrash(db)};
  }

  reveal(id: string): VaultSecretsDto {
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

  totp(id: string): VaultTotpDto | null {
    const db = this.#requireOpen();
    this.#armIdle();
    return totpFor(db, id);
  }

  codes(): VaultCodesDto[] {
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
  matchesForUrl(url: string): VaultItemDto[] {
    if (!this.#db) return [];
    this.#armIdle();
    return matchItems(listItems(this.#db), url);
  }

  fillFields(id: string): {username: string; password: string; totp: string | null} {
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

  async save(input: VaultItemInputDto): Promise<VaultItemDto> {
    const db = this.#requireOpen();
    const id = upsertItem(db, input);
    await this.#persist();
    this.#armIdle();
    this.#changed();
    const item = readItem(db, id);
    if (!item) throw new Error("The item could not be saved");
    return item;
  }

  async remove(id: string): Promise<VaultListDto> {
    const db = this.#requireOpen();
    if (!removeItem(db, id)) throw new Error("That item is not in the vault");
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.list();
  }

  async restore(ids: string[]): Promise<VaultListDto> {
    const db = this.#requireOpen();
    for (const id of ids) {
      if (!restoreItem(db, id)) throw new Error("That item is not in the vault");
    }
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.list();
  }

  async purge(ids: string[]): Promise<VaultListDto> {
    const db = this.#requireOpen();
    for (const id of ids) {
      if (!purgeItem(db, id)) throw new Error("That item is not in the vault");
    }
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.list();
  }

  async emptyTrash(): Promise<VaultListDto> {
    const db = this.#requireOpen();
    emptyTrash(db);
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.list();
  }

  async pin(ids: string[], pinned: boolean): Promise<VaultListDto> {
    const db = this.#requireOpen();
    if (setPinned(db, ids, pinned) !== ids.length) throw new Error("That item is not in the vault");
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.list();
  }

  async reorder(ids: string[]): Promise<VaultListDto> {
    const db = this.#requireOpen();
    reorderItems(db, ids);
    await this.#persist();
    this.#armIdle();
    this.#changed();
    return this.list();
  }

  async changePassword(current: string, next: string): Promise<VaultStatusDto> {
    if (next.length < 8) throw new Error("Use at least 8 characters");
    const db = this.#requireOpen();
    const bytes = await readFile(this.#vaultPath);
    await loadDatabase(copyBuffer(bytes), current);
    await changeMasterPassword(db, next);
    this.#password = next;
    await this.#persist();
    // Keep Touch ID working across a password change instead of stranding a
    // stale enrollment that could only fail.
    if (existsSync(this.#biometricPath) && this.#biometrics?.isEncryptionAvailable()) {
      try {
        await writeFile(this.#biometricPath, this.#biometrics.encryptString(next), {mode: 0o600});
      } catch {
        // Enrollment refresh is best-effort; a stale file clears itself on
        // the next biometric unlock attempt.
      }
    }
    this.#armIdle();
    this.#changed();
    return this.status();
  }

  copyText(id: string, field: VaultCopyField, recoveryIndex?: number): string {
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

  async importBegin(filePath: string | null): Promise<VaultImportStartDto> {
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

  async importConfirm(password: string): Promise<VaultImportResultDto> {
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
  async hydrate(): Promise<VaultStatusDto> {
    return this.sync({allowPull: this.#db === null});
  }

  /** Local copy always exists; this only toggles whether it syncs to the
   * account. Turning sync on merges the account copy item-by-item,
   * latest write per entry wins, so diverging devices converge. */
  async setStorage(mode: VaultStorageMode, _resolve?: VaultStorageResolve): Promise<VaultStatusDto> {
    if (mode !== "local" && mode !== "account") throw new Error("Choose sync on or off");
    if (mode === "local") {
      this.#meta = {...this.#meta, storage: "local"};
      this.#syncError = undefined;
      this.#writeMeta();
      this.#changed();
      return this.status();
    }
    this.#meta = {...this.#meta, storage: "account"};
    this.#writeMeta();
    return this.sync({allowPull: this.#db === null});
  }

  async sync(options: {allowPull?: boolean; force?: "push" | "pull"} = {}): Promise<VaultStatusDto> {
    if (!this.#syncOn()) {
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
      if (await this.#mergeRemote(remote)) return this.status();
      if (this.#db) {
        // Unlocked: the merge above already converged content, so upload
        // when dirty and never pull over the open vault.
        if (options.force !== "pull" && this.#exists() && this.#meta.dirty) {
          await this.#push();
        }
        this.#syncError = undefined;
        return this.status();
      }
      // Locked: only first-link onto an empty device. A diverged local copy
      // is left alone until unlock, when the merge can run.
      if (!this.#exists()) {
        if (remote && options.allowPull !== false) this.#writeVault(remote);
        return this.status();
      }
      const local = {
        revision: this.#meta.revision,
        updatedAt: this.#meta.updatedAt,
        checksum: this.#meta.checksum,
        dirty: this.#meta.dirty,
        lastSyncedAt: this.#meta.lastSyncedAt,
      };
      const plan = options.force
        ? {action: options.force, reason: "forced"}
        : planSync(local, remote);
      if (plan.action === "push") await this.#push();
      this.#syncError = undefined;
    } catch (error) {
      this.#syncError = error instanceof Error ? error.message : String(error);
    } finally {
      this.#syncing = false;
      this.#changed();
    }
    return this.status();
  }

  /** Upload the on-disk vault. Caller owns sync state and error handling. */
  async #push(): Promise<void> {
    const cloud = this.#cloud;
    if (!cloud || !this.#exists()) return;
    const bytes = await readFile(this.#vaultPath);
    const blob: VaultCloudBlob = {
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

  /** Item-level merge of the account copy into the open vault. Returns true
   * only when it hit a merge-only error (different master password) so the
   * caller skips the blob-level plan. A successful merge persists dirty, so
   * the plan below uploads it. Needs the master password cached at unlock;
   * a copy encrypted with a different password is left alone with an error
   * instead of overwriting either side. */
  async #mergeRemote(remote: VaultCloudBlob | null): Promise<boolean> {
    const db = this.#db;
    const password = this.#password;
    if (!db || !password || !remote || remote.checksum === this.#meta.checksum)
      return false;
    let remoteDb = null;
    try {
      remoteDb = await loadDatabase(copyBuffer(remote.bytes), password);
    } catch (error) {
      this.#syncError =
        error instanceof Error && error.message === WRONG_PASSWORD
          ? "Your account copy uses a different master password, so it was left alone"
          : error instanceof Error
            ? error.message
            : String(error);
      return true;
    }
    const merged = mergeKdbx(db, remoteDb);
    if (merged.added === 0 && merged.updated === 0) return false;
    await this.#persist();
    return false;
  }

  close(): void {
    this.lock();
  }

  /** Encrypted file plus metadata. Safe while locked. */
  exportVault(): VaultBlobDto | null {
    if (!this.#exists()) return null;
    const bytes = readFileSync(this.#vaultPath);
    return {
      bytes: Buffer.from(bytes).toString("base64"),
      meta: this.#meta,
    };
  }

  async importVault(blob: VaultBlobDto): Promise<VaultStatusDto> {
    const bytes = Buffer.from(blob.bytes, "base64");
    if (!bytes.byteLength) throw new Error("That vault copy is empty");
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

  #storage(): VaultStorageMode {
    return this.#meta.storage === "local" ? "local" : "account";
  }

  #syncOn(): boolean {
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
    if (this.#syncOn()) await this.sync({allowPull: false});
  }

  #writeVault(blob: VaultCloudBlob): void {
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
    }, VAULT_IDLE_SECONDS * 1000);
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
