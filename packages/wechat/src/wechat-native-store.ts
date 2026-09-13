import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { zstdDecompressSync } from "node:zlib";

/**
 * WeChat's own databases, read directly.
 *
 * The loopback relay served conversation lists, history pages, and unread
 * counts over HTTP from a daemon whose activation is machine-bound. Every one
 * of those answers is already sitting in SQLCipher databases under the
 * signed-in account's container, keyed per database. With the raw keys —
 * extracted by Polymux's own collector or recorded earlier by an external
 * tool — the same rows can be read here, without the daemon, in process.
 *
 * Nothing here writes to WeChat's stores: the encrypted files are snapshotted,
 * the plaintext snapshot is written to a private temporary file, and queries
 * run against that copy. The snapshot is live: as WeChat commits new frames to
 * its own write-ahead log, the committed pages are decrypted once and patched
 * into the copy, so following the account costs pages, not databases.
 */

/**
 * Where Polymux's own key collector records what it extracted, one entry per
 * database of each account it has seen. The fallback is the registry an
 * external tool may already have provisioned on this Mac.
 */
export function defaultWeChatStoreRegistryPath(home: string = homedir()): string {
  if (process.platform === "darwin")
    return path.join(home, "Library/Application Support/Polymux/wechat/store.json");
  return path.join(home, ".polymux", "wechat", "store.json");
}

export interface WeChatNativeAccount {
  /** The signed-in account this store belongs to, from its directory name. */
  wxid: string;
  /** The account's `db_storage` root. */
  dbDir: string;
  /** Raw 32-byte key per database, relative to `dbDir` (`message/message_0.db`). */
  keys: Map<string, Buffer>;
}

export interface WeChatNativeStoreOptions {
  /** Overridable for tests; the user's home directory otherwise. */
  home?: string;
  /** Exact registry file; defaults to Polymux's own, then the legacy one. */
  registryPath?: string;
  /** Set to ignore the legacy fallback registry entirely. */
  excludeLegacyRegistry?: boolean;
  log?: (message: string) => void;
}

/**
 * Every WeChat account on this Mac with a usable key registry, one per
 * container directory. An account with no keys is still reported: the
 * collector can run later, and callers decide what to do without keys.
 */
export async function resolveWeChatAccounts(
  options: WeChatNativeStoreOptions = {},
): Promise<WeChatNativeAccount[]> {
  const home = options.home ?? homedir();
  const accounts = new Map<string, WeChatNativeAccount>();
  const rootByWxid = new Map<string, string>();
  for (const dbDir of await weChatDatabaseRoots(home)) {
    const wxid = path.basename(path.dirname(dbDir));
    if (!/^wxid_[A-Za-z0-9_-]+$/.test(wxid)) continue;
    rootByWxid.set(wxid, dbDir);
    accounts.set(wxid, {wxid, dbDir, keys: new Map()});
  }
  await applyRegistry(
    await readRegistryFile(options.registryPath ?? defaultWeChatStoreRegistryPath(home)),
    accounts,
  );
  if (!options.excludeLegacyRegistry)
    await applyLegacyRegistry(home, accounts);
  // A registry that records keys but no directory still points at the live
  // container this Mac keeps; only a directory-less stranger is reported
  // without one, so readers never resolve against the working directory.
  for (const account of accounts.values())
    if ((!account.dbDir || account.dbDir === ".") && rootByWxid.has(account.wxid))
      account.dbDir = rootByWxid.get(account.wxid)!;
  return [...accounts.values()];
}

/** Every account container directory WeChat keeps, clones included. */
async function weChatDatabaseRoots(home: string): Promise<string[]> {
  const containers = path.join(home, "Library/Containers");
  const apps = (await entriesOf(containers))
    .filter((entry) => entry.isDirectory() && /^com\.tencent\.xinWeChat\d*$/.test(entry.name))
    .map((entry) => path.join(containers, entry.name, "Data/Documents/xwechat_files"));
  const roots: string[] = [];
  for (const root of apps)
    for (const account of await entriesOf(root))
      if (account.isDirectory() && account.name.startsWith("wxid_"))
        roots.push(path.join(root, account.name, "db_storage"));
  return roots;
}

async function entriesOf(
  directory: string,
): Promise<Array<{name: string; isDirectory: () => boolean}>> {
  return readdir(directory, {withFileTypes: true}).catch(
    (): Array<{name: string; isDirectory: () => boolean}> => [],
  );
}

interface StoredAccount {
  dbDir?: string;
  keys?: Record<string, string>;
}

async function applyRegistry(
  stored: {accounts?: Record<string, StoredAccount>} | null,
  accounts: Map<string, WeChatNativeAccount>,
): Promise<void> {
  if (!stored?.accounts) return;
  for (const [wxid, record] of Object.entries(stored.accounts)) {
    if (!record || !/^wxid_[A-Za-z0-9_-]+$/.test(wxid) || typeof record.dbDir !== "string") continue;
    const account = accounts.get(wxid) ?? {wxid, dbDir: record.dbDir, keys: new Map()};
    // A record without a directory (hand-entered keys, a `--set` before any
    // migration) must not wipe the root discovered from the live container:
    // an empty override would resolve reads against the process working
    // directory instead.
    if (record.dbDir) account.dbDir = record.dbDir;
    for (const [entry, hex] of Object.entries(record.keys ?? {})) {
      if (!isDatabaseEntry(entry)) continue;
      if (typeof hex !== "string" || !/^[0-9a-f]{64}$/i.test(hex)) continue;
      account.keys.set(entry, Buffer.from(hex, "hex"));
    }
    accounts.set(wxid, account);
  }
}

/** Registry entries are database paths relative to the account root. */
function isDatabaseEntry(entry: unknown): entry is string {
  return typeof entry === "string" && entry.endsWith(".db") &&
    !entry.includes("..") && !path.isAbsolute(entry);
}

async function readRegistryFile(
  file: string,
): Promise<{accounts?: Record<string, StoredAccount>} | null> {
  const contents = await readFile(file, "utf8").catch((): null => null);
  if (!contents) return null;
  try {
    return JSON.parse(contents) as {accounts?: Record<string, StoredAccount>};
  } catch {
    return null;
  }
}

/** `~/.wx-rs` shape, kept readable so an already-provisioned Mac keeps working. */
async function applyLegacyRegistry(
  home: string,
  accounts: Map<string, WeChatNativeAccount>,
): Promise<void> {
  const config = await readFile(path.join(home, ".wx-rs/config.json"), "utf8")
    .catch((): null => null);
  if (!config) return;
  let parsed: {account_wxid?: string; db_dir?: string};
  try {
    parsed = JSON.parse(config) as {account_wxid?: string; db_dir?: string};
  } catch {
    return;
  }
  const keys = await readFile(path.join(home, ".wx-rs/keys.json"), "utf8")
    .then((raw): Record<string, {key_hex?: string}> =>
      (JSON.parse(raw) as {entries?: Record<string, {key_hex?: string}>}).entries ?? {})
    .catch((): Record<string, {key_hex?: string}> => ({}));
  const wxid = typeof parsed.account_wxid === "string" ? parsed.account_wxid : null;
  const dbDir = typeof parsed.db_dir === "string" ? parsed.db_dir : null;
  if (!wxid || !/^wxid_[A-Za-z0-9_-]+$/.test(wxid)) return;
  const account = accounts.get(wxid) ??
    {wxid, dbDir: dbDir ?? "", keys: new Map()};
  if (dbDir) account.dbDir = dbDir;
  for (const [entry, record] of Object.entries(keys)) {
    if (!isDatabaseEntry(entry)) continue;
    const hex = record?.key_hex;
    if (typeof hex !== "string" || !/^[0-9a-f]{64}$/i.test(hex)) continue;
    if (!account.keys.has(entry)) account.keys.set(entry, Buffer.from(hex, "hex"));
  }
  accounts.set(wxid, account);
}

// ---- live snapshot: worker client ------------------------------------------

/** One worker round-trip must never wedge the stream; a stuck decrypt is
 * killed and rebuilt instead. */
const SNAPSHOT_OP_TIMEOUT_MS = 60_000;

export interface SqlcipherLiveSnapshotOptions {
  /** Exact worker script; defaults to the checkout copy beside the sources. */
  workerPath?: string;
}

function defaultSnapshotWorkerPath(): string {
  return fileURLToPath(
    new URL("../../../scripts/wechat/wechat-snapshot-worker.mjs", import.meta.url),
  );
}

interface SnapshotPending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface SnapshotWorkerMessage {
  id?: unknown;
  ok?: unknown;
  result?: unknown;
  error?: unknown;
}

/**
 * A decrypted, current copy of one SQLCipher database.
 *
 * The split is deliberate: decrypting every page of a large store (or
 * rebuilding it after a checkpoint) is seconds of AES and HMAC, so all file
 * work runs in a worker thread (`scripts/wechat/wechat-snapshot-worker.mjs`)
 * while this side keeps only fast read-only queries against the snapshot
 * file. The public shape is unchanged: `open`, `refresh`, `query`, `close`.
 *
 * A worker that dies or stalls is replaced, and the next operation rebuilds
 * from the main file — the same recovery a torn WAL already triggers. Full
 * rebuilds swap atomically on the worker side, so a query opening the path
 * always sees a complete database, old or new.
 */
export class SqlcipherLiveSnapshot {
  readonly #main: string;
  #keyHex: string;
  readonly #snapshotFile: string;
  readonly #workerPath: string;
  #worker: Worker | null = null;
  #nextId = 1;
  #pending = new Map<number, SnapshotPending>();
  #closed = false;
  #operations: Promise<void> = Promise.resolve();
  #termination: Promise<void> = Promise.resolve();
  #closing: Promise<void> | null = null;

  constructor(main: string, key: Buffer, options: SqlcipherLiveSnapshotOptions = {}) {
    this.#main = main;
    this.#keyHex = key.toString("hex");
    // Every reader owns its copy, including two readers in the same process.
    // Closing or replacing one must never remove another's database.
    this.#snapshotFile = path.join(
      tmpdir(),
      `polymux-wechat-live-${randomUUID()}-p${process.pid}.db`,
    );
    this.#workerPath = options.workerPath ?? defaultSnapshotWorkerPath();
  }

  /** The plaintext copy's path; readable only while this snapshot is open. */
  get file(): string {
    return this.#snapshotFile;
  }

  async open(): Promise<void> {
    await this.#enqueue(async () => {
      if (this.#closed) throw new Error("WeChat snapshot is closed");
      await this.#call("open");
    });
  }

  /**
   * Folds newly committed log frames into the copy. Returns whether anything
   * changed. A checkpoint resets the log under a new salt; the copy then
   * rebuilds from the main file, which holds every committed page again.
   */
  async refresh(): Promise<boolean> {
    return await this.#enqueue(async () => {
      if (this.#closed) return false;
      return (await this.#call("refresh")) as boolean;
    });
  }

  /** Replace only this reader's key, after the worker authenticates the whole
   * encrypted source. Existing borrowers keep the same serialized snapshot. */
  async replaceKey(key: Buffer): Promise<boolean> {
    if (!Buffer.isBuffer(key) || key.length !== 32)
      throw new Error("WeChat snapshot replacement key is invalid");
    const keyHex = key.toString("hex");
    return await this.#enqueue(async () => {
      if (this.#closed) throw new Error("WeChat snapshot is closed");
      if (keyHex === this.#keyHex) return false;
      await this.#request("replace-key", SNAPSHOT_OP_TIMEOUT_MS, {keyHex});
      this.#keyHex = keyHex;
      return true;
    });
  }

  /** Runs one read against the plaintext copy. Fresh data needs `refresh`. */
  async query<T>(read: (database: DatabaseSync) => T): Promise<T> {
    return await this.#enqueue(() => {
      if (this.#closed) throw new Error("WeChat snapshot is closed");
      const database = new DatabaseSync(this.#snapshotFile, {readOnly: true});
      try {
        return read(database);
      } finally {
        database.close();
      }
    });
  }

  async close(): Promise<void> {
    if (this.#closing) return await this.#closing;
    this.#closed = true;
    this.#closing = (async () => {
      // Stop file work before unlinking: an old worker must never publish a
      // late snapshot after close, or overlap its replacement after a crash.
      await this.#kill(new Error("WeChat snapshot is closed"));
      await this.#operations;
      await rm(this.#snapshotFile, {force: true}).catch((): undefined => undefined);
      await rm(`${this.#snapshotFile}.tmp`, {force: true}).catch((): undefined => undefined);
    })();
    return await this.#closing;
  }

  #enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const task = this.#operations.then(operation);
    this.#operations = task.then((): undefined => undefined, (): undefined => undefined);
    return task;
  }

  /** One round-trip, replacing a dead worker once so a crash rebuilds. */
  async #call(op: "open" | "refresh"): Promise<unknown> {
    try {
      return await this.#request(op, SNAPSHOT_OP_TIMEOUT_MS);
    } catch (error) {
      if (this.#closed) throw error;
      await this.#kill(error instanceof Error ? error : new Error(String(error)));
      return await this.#request(op, SNAPSHOT_OP_TIMEOUT_MS);
    }
  }

  async #request(op: string, timeoutMs: number, payload: Record<string, string> = {}): Promise<unknown> {
    await this.#termination;
    if (this.#closed) throw new Error("WeChat snapshot is closed");
    const worker = this.#spawn();
    const id = this.#nextId++;
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        const timeout = new Error(`WeChat snapshot ${op} timed out`);
        void this.#kill(timeout);
        reject(timeout);
      }, timeoutMs);
      timer.unref?.();
      this.#pending.set(id, {resolve, reject, timer});
      try {
        worker.postMessage({id, op, ...payload});
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  #spawn(): Worker {
    const existing = this.#worker;
    if (existing) return existing;
    let worker: Worker;
    try {
      worker = new Worker(this.#workerPath, {
        workerData: {main: this.#main, keyHex: this.#keyHex, snapshotFile: this.#snapshotFile},
      });
    } catch (error) {
      throw new Error(
        `WeChat snapshot worker is unavailable at ${this.#workerPath}: ` +
        (error instanceof Error ? error.message : String(error)),
      );
    }
    worker.on("message", (message: SnapshotWorkerMessage) => {
      if (this.#worker !== worker) return;
      if (typeof message?.id !== "number") return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(
        typeof message.error === "string" ? message.error : "WeChat snapshot worker failed",
      ));
    });
    worker.on("error", (error: Error) => {
      if (this.#worker === worker) void this.#kill(error);
    });
    worker.once("exit", (code: number) => {
      if (this.#worker !== worker) return;
      this.#worker = null;
      this.#failAll(new Error(`WeChat snapshot worker exited with code ${code}`));
    });
    this.#worker = worker;
    return worker;
  }

  #kill(error: Error): Promise<void> {
    const worker = this.#worker;
    this.#worker = null;
    if (worker) this.#termination = Promise.all([
      this.#termination,
      worker.terminate().catch((): undefined => undefined),
    ]).then((): undefined => undefined);
    this.#failAll(error);
    return this.#termination;
  }

  #failAll(error: Error): void {
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const {reject, timer} of pending) {
      clearTimeout(timer);
      reject(error);
    }
  }
}

// ---- schema helpers --------------------------------------------------------

/**
 * WeChat packs its own message-type enumeration into `local_type`; the low 32
 * bits carry the type the rest of the ecosystem names. The bridge keys its
 * media, reply, and recall handling off these strings, so an unknown value
 * stays unknown rather than masquerading as text.
 */
export function weChatKindFromLocalType(localType: number): string {
  const type = Number(localType) & 0xffffffff;
  if (type === 1) return "text";
  if (type === 3) return "image";
  if (type === 34 || type === 35) return "audio";
  if (type === 43) return "video";
  if (type === 47) return "emoticon";
  if (type === 48) return "location";
  if (type === 49) return "appmsg";
  if (type === 50) return "call";
  if (type === 10000) return "system";
  if (type === 10002) return "recalled";
  return String(type);
}

/** WCDB marks zstd-compressed columns with its own compression-type flag. */
function decompressIfPacked(value: unknown, flag: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) {
    if (flag === 4) {
      try {
        return zstdDecompressSync(value, {maxOutputLength: 4 * 1024 * 1024}).toString("utf8");
      } catch {
        return null;
      }
    }
    return Buffer.from(value).toString("utf8");
  }
  return null;
}

/** The per-chat message table, named by the chat id's digest. */
export function weChatMessageTable(chatId: string): string {
  return `Msg_${createHash("md5").update(chatId).digest("hex")}`;
}

/**
 * A native message row shaped like the external history reader's output, so
 * everything downstream keeps one vocabulary. Identifiers wider than a
 * JavaScript number arrive as strings and stay strings.
 */
export interface NativeHistoryRow {
  local_id: number;
  server_id: string;
  local_type: number;
  create_time: number;
  real_sender_id: number | null;
  sender_wxid: string | null;
  message_kind: string;
  message_content: string | null;
}

interface RawMessageRow {
  local_id: number;
  server_id: string | null;
  local_type: number | bigint;
  create_time: number;
  real_sender_id: number | null;
  sender_wxid: string | null;
  message_content: unknown;
  ct_content: number | bigint | null;
}

function rowOfNative(raw: RawMessageRow): NativeHistoryRow {
  return {
    local_id: Number(raw.local_id),
    server_id: String(raw.server_id ?? "0"),
    local_type: typeof raw.local_type === "bigint" ? Number(raw.local_type) : raw.local_type,
    create_time: Number(raw.create_time),
    real_sender_id: raw.real_sender_id == null ? null : Number(raw.real_sender_id),
    sender_wxid: raw.sender_wxid ?? null,
    message_kind: weChatKindFromLocalType(Number(raw.local_type)),
    message_content: decompressIfPacked(raw.message_content, raw.ct_content),
  };
}

const HISTORY_PAGE_MAX = 65_536;
const HISTORY_COLUMNS = `local_id, CAST(server_id AS TEXT) AS server_id, local_type, create_time,
  real_sender_id, message_content, WCDB_CT_message_content AS ct_content,
  (SELECT user_name FROM Name2Id WHERE rowid = real_sender_id) AS sender_wxid`;

// ---- per-account store -----------------------------------------------------

export interface WeChatConversation {
  chatId: string;
  name: string | null;
  unreadCount: number;
  markedUnread: boolean;
  isGroup: boolean;
  /** Authored time of the newest row, in seconds. */
  lastTimestamp: number | null;
  summary: string | null;
}

export interface WeChatGroupMember {
  wxid: string;
  displayName: string | null;
}

/**
 * Reads one account's live databases. A database this account has no key for
 * makes its specific reads throw; a caller that cannot use an answer should
 * fall back to whatever else serves it rather than lose the rest.
 */
export interface WeChatNativeStoreRuntimeOptions extends SqlcipherLiveSnapshotOptions {
  /** Only this own registry is reloaded; no discovery or legacy fallback. */
  registryPath?: string;
  registryRefreshMs?: number;
  log?: (message: string) => void;
}

export class WeChatNativeStore {
  readonly #account: WeChatNativeAccount;
  readonly #workerPath?: string;
  readonly #options: WeChatNativeStoreRuntimeOptions;
  readonly #snapshots = new Map<string, Promise<SqlcipherLiveSnapshot>>();
  readonly #registryCandidates = new Set<SqlcipherLiveSnapshot>();
  readonly #keyGenerations = new Map<string, number>();
  #registryRevision = 0;
  #registryReadAt = -Infinity;
  #registryTask: Promise<boolean> | null = null;
  #open = true;
  #closing: Promise<void> | null = null;

  constructor(account: WeChatNativeAccount, options: WeChatNativeStoreRuntimeOptions = {}) {
    this.#account = {...account, keys: new Map([...account.keys].map(([entry, key]) => [entry, Buffer.from(key)]))};
    this.#workerPath = options.workerPath;
    this.#options = {...options};
    if (options.registryRefreshMs !== undefined &&
        (!Number.isFinite(options.registryRefreshMs) || options.registryRefreshMs < 0))
      throw new Error("WeChat registry refresh interval is invalid");
  }

  get wxid(): string {
    // Desktop appends a storage discriminator to the account directory. It is
    // not part of the sender identity stored in Name2Id/message rows.
    return path.basename(path.dirname(this.#account.dbDir)) === this.#account.wxid
      ? this.#account.wxid.replace(/^(wxid_[A-Za-z0-9]+)_[a-f0-9]{4}$/i, "$1")
      : this.#account.wxid;
  }

  get dbDir(): string {
    return this.#account.dbDir;
  }

  /** Whether the registry has a key for this database. */
  has(entry: string): boolean {
    return this.#account.keys.has(entry);
  }

  get registryRevision(): number { return this.#registryRevision; }

  /** A rotated or re-added shard may restart its local row numbers. */
  keyGeneration(entry: string): number { return this.#keyGenerations.get(entry) ?? 0; }

  #keyChanged(entry: string): void {
    this.#keyGenerations.set(entry, this.keyGeneration(entry) + 1);
    this.#registryRevision += 1;
  }

  /** Discover newly provisioned keys without restarting the bridge. Account
   * identity and container stay pinned; malformed updates preserve the last
   * configuration. Every changed key is authenticated before admission. */
  async refreshRegistry(force = false): Promise<boolean> {
    if (!this.#open || !this.#options.registryPath) return false;
    if (this.#registryTask) return await this.#registryTask;
    if (!force && performance.now() - this.#registryReadAt < (this.#options.registryRefreshMs ?? 5_000)) return false;
    this.#registryReadAt = performance.now();
    const task = this.#reloadRegistry(this.#options.registryPath);
    this.#registryTask = task;
    try { return await task; }
    finally { if (this.#registryTask === task) this.#registryTask = null; }
  }

  async #reloadRegistry(file: string): Promise<boolean> {
    const stored = await readRegistryFile(file);
    if (!stored?.accounts || typeof stored.accounts !== "object" || Array.isArray(stored.accounts))
      throw new Error("The Polymux WeChat key registry is unavailable or invalid");
    const accounts = Object.entries(stored.accounts);
    if (accounts.length !== 1) throw new Error("WeChat key refresh requires the same single account");
    const [wxid, account] = accounts[0];
    if ((wxid !== this.#account.wxid && wxid !== this.wxid) ||
        typeof account?.dbDir !== "string" || !path.isAbsolute(account.dbDir) ||
        path.resolve(account.dbDir) !== path.resolve(this.dbDir))
      throw new Error("WeChat key refresh cannot change the selected account or container");
    if (!account.keys || typeof account.keys !== "object" || Array.isArray(account.keys) ||
        Object.entries(account.keys).some(([entry, hex]) => !isDatabaseEntry(entry) ||
          typeof hex !== "string" || !/^[a-f0-9]{64}$/i.test(hex)))
      throw new Error("The Polymux WeChat key registry is invalid");
    const before = this.#registryRevision;
    const failures: Error[] = [];
    for (const [entry, hex] of Object.entries(account.keys)) {
      if (!this.#open) break;
      const key = Buffer.from(hex, "hex");
      if (this.#account.keys.get(entry)?.equals(key)) continue;
      let candidate: SqlcipherLiveSnapshot | null = null;
      try {
        const existing = await this.#snapshots.get(entry)?.catch((): null => null);
        if (!this.#open) break;
        if (existing) {
          await existing.replaceKey(key);
        } else {
          candidate = new SqlcipherLiveSnapshot(path.join(this.dbDir, entry), key,
            {...(this.#workerPath ? {workerPath: this.#workerPath} : {})});
          this.#registryCandidates.add(candidate);
          await candidate.open();
        }
        if (!this.#open) {
          await candidate?.close();
          break;
        }
        if (candidate) this.#snapshots.set(entry, Promise.resolve(candidate));
        this.#account.keys.set(entry, key);
        this.#keyChanged(entry);
      } catch (error) {
        await candidate?.close().catch((): undefined => undefined);
        failures.push(new Error(`The refreshed WeChat key did not authenticate ${entry}`, {cause: error}));
      } finally {
        if (candidate) this.#registryCandidates.delete(candidate);
      }
    }
    if (this.#open) for (const entry of [...this.#account.keys.keys()]) {
      if (Object.hasOwn(account.keys, entry)) continue;
      this.#account.keys.delete(entry);
      this.#keyChanged(entry);
      const snapshot = this.#snapshots.get(entry);
      this.#snapshots.delete(entry);
      await snapshot?.then(live => live.close(), (): undefined => undefined);
    }
    if (failures.length) throw new AggregateError(failures, "Some refreshed WeChat keys could not be authenticated");
    return this.#registryRevision !== before;
  }

  async #refreshRegistryForRead(): Promise<void> {
    await this.refreshRegistry().catch(() => {
      this.#options.log?.("[wechat] key registry refresh delayed; keeping the selected account's verified keys");
    });
  }

  /**
   * Opens (or returns) the live snapshot for one database. One snapshot per
   * entry per store, shared by every read and by the watcher, so a burst of
   * history reads and the stream refresh the same copy instead of racing.
   */
  async snapshot(entry: string): Promise<SqlcipherLiveSnapshot> {
    await this.#refreshRegistryForRead();
    if (!this.#open) throw new Error("WeChat native store is closed");
    const key = this.#account.keys.get(entry);
    if (!key) throw new Error(`No key is recorded for ${entry}`);
    const existing = this.#snapshots.get(entry);
    if (existing) return existing;
    const live = new SqlcipherLiveSnapshot(
      path.join(this.#account.dbDir, entry),
      key,
      {...(this.#workerPath ? {workerPath: this.#workerPath} : {})},
    );
    const snapshot = live.open().then((): SqlcipherLiveSnapshot => live);
    snapshot.catch(() => {
      if (this.#snapshots.get(entry) === snapshot) this.#snapshots.delete(entry);
      // A failed open still owns its worker thread; release it rather than
      // leaking one per retried lookup against a broken registry.
      void live.close().catch((): undefined => undefined);
    });
    this.#snapshots.set(entry, snapshot);
    return snapshot;
  }

  async close(): Promise<void> {
    if (this.#closing) return await this.#closing;
    this.#open = false;
    const snapshots = [...this.#snapshots.values()];
    this.#snapshots.clear();
    this.#closing = (async () => {
      await Promise.all([
        ...snapshots.map(snapshot => snapshot.then(live => live.close(), (): undefined => undefined)),
        ...[...this.#registryCandidates].map(candidate => candidate.close()),
      ]);
      await this.#registryTask?.catch((): undefined => undefined);
    })();
    await this.#closing;
  }

  /** Explicitly relink a closed bridge using the same key configuration. */
  async reopen(): Promise<void> {
    await this.#closing;
    this.#closing = null;
    this.#registryReadAt = -Infinity;
    this.#open = true;
  }

  /** Every message shard this account has keys for, oldest number first. */
  messageShards(): string[] {
    return [...this.#account.keys.keys()]
      .filter((entry) => /^message\/message_\d+\.db$/.test(entry))
      .sort((left, right) =>
        Number(/message_(\d+)\.db$/.exec(left)?.[1]) - Number(/message_(\d+)\.db$/.exec(right)?.[1]));
  }

  /**
   * Every keyed shard holding this chat. A conversation can span several
   * files, and its local row IDs restart in each file. Recheck table presence
   * after refresh so a newly created table is not hidden by an older hit.
   */
  async shardsOf(chatId: string): Promise<string[]> {
    await this.#refreshRegistryForRead();
    const shards: string[] = [];
    for (const entry of this.messageShards()) {
      const found = await this.snapshot(entry).then(
        async (snapshot) => {
          await snapshot.refresh();
          return await snapshot.query((database) =>
          database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
            .get(weChatMessageTable(chatId)) !== undefined);
        },
        () => false,
      );
      if (found) shards.push(entry);
    }
    return shards;
  }

  /** The newest keyed shard for current local-ID and sender lookups. History
   * merges all shards; inbound cursors are scoped to individual shard files. */
  async shardOf(chatId: string): Promise<string | null> {
    return (await this.shardsOf(chatId)).at(-1) ?? null;
  }

  /**
   * A newest-first page of one chat's native rows, strictly older than
   * `until` when given. This is the contract the bridge's paging helper is
   * written against: exclusive boundary, descending time, rows from the same
   * second kept together in a stable local-id order.
   */
  async historyPage(
    chatId: string,
    {until, limit}: {until?: number; limit: number},
  ): Promise<NativeHistoryRow[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("WeChat history limit is invalid");
    if (until !== undefined && (!Number.isSafeInteger(until) || until <= 0))
      throw new Error("WeChat history cursor is invalid");
    const rows: NativeHistoryRow[] = [];
    // Newest copies win when WeChat retains a server message in two files.
    for (const entry of (await this.shardsOf(chatId)).reverse()) {
      const snapshot = await this.snapshot(entry);
      rows.push(...await snapshot.query((database) => {
        const found = database.prepare(
          `SELECT ${HISTORY_COLUMNS} FROM ${weChatMessageTable(chatId)}
           WHERE (? IS NULL OR create_time < ?)
           ORDER BY create_time DESC, local_id DESC LIMIT ?`,
        ).all(until ?? null, until ?? null, Math.min(limit, HISTORY_PAGE_MAX)) as unknown as RawMessageRow[];
        return found.map(rowOfNative);
      }));
    }
    const seen = new Set<string>();
    return rows.filter(row => {
      if (!/^[1-9]\d*$/.test(row.server_id)) return true;
      if (seen.has(row.server_id)) return false;
      seen.add(row.server_id);
      return true;
    }).sort((a, b) => b.create_time - a.create_time || b.local_id - a.local_id)
      .slice(0, Math.min(limit, HISTORY_PAGE_MAX));
  }

  /** Rows committed after a local row id, oldest first — the stream's wake. */
  async rowsSince(chatId: string, localId: number, limit = 200, shard?: string): Promise<NativeHistoryRow[]> {
    if (!Number.isSafeInteger(localId) || localId < 0) throw new Error("WeChat history cursor is invalid");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("WeChat history limit is invalid");
    const entry = shard ?? await this.shardOf(chatId);
    if (!entry) return [];
    if (!this.messageShards().includes(entry)) throw new Error("WeChat message shard is invalid");
    const snapshot = await this.snapshot(entry);
    await snapshot.refresh();
    return await snapshot.query((database) => {
      const rows = database.prepare(
        `SELECT ${HISTORY_COLUMNS} FROM ${weChatMessageTable(chatId)}
         WHERE local_id > ? ORDER BY local_id ASC LIMIT ?`,
      ).all(localId, Math.min(limit, HISTORY_PAGE_MAX)) as unknown as RawMessageRow[];
      return rows.map(rowOfNative);
    });
  }

  /** Reads every registered chat from one refreshed shard while opening its
   * plaintext snapshot only once. Missing chat tables are omitted. */
  async rowsSinceForChats(
    shard: string,
    cursors: ReadonlyMap<string, number>,
    limit = 200,
  ): Promise<Map<string, NativeHistoryRow[]>> {
    if (!this.messageShards().includes(shard)) throw new Error("WeChat message shard is invalid");
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("WeChat history limit is invalid");
    for (const localId of cursors.values())
      if (!Number.isSafeInteger(localId) || localId < 0) throw new Error("WeChat history cursor is invalid");
    const snapshot = await this.snapshot(shard);
    await snapshot.refresh();
    return await snapshot.query((database) => {
      const tables = new Set((database.prepare(
        "SELECT name FROM sqlite_master WHERE type='table'",
      ).all() as Array<{name: string}>).map((row) => row.name));
      const rows = new Map<string, NativeHistoryRow[]>();
      for (const [chatId, localId] of cursors) {
        const table = weChatMessageTable(chatId);
        if (!tables.has(table)) continue;
        const found = database.prepare(
          `SELECT ${HISTORY_COLUMNS} FROM ${table}
           WHERE local_id > ? ORDER BY local_id ASC LIMIT ?`,
        ).all(localId, Math.min(limit, HISTORY_PAGE_MAX)) as unknown as RawMessageRow[];
        rows.set(chatId, found.map(rowOfNative));
      }
      return rows;
    });
  }

  /** The highest local row id a chat currently has, or zero for an empty one. */
  async maxLocalId(chatId: string, shard?: string): Promise<number> {
    const entry = shard ?? await this.shardOf(chatId);
    if (!entry) return 0;
    if (!this.messageShards().includes(entry)) throw new Error("WeChat message shard is invalid");
    const snapshot = await this.snapshot(entry);
    await snapshot.refresh();
    return await snapshot.query((database) => {
      const row = database.prepare(
        `SELECT MAX(local_id) AS top FROM ${weChatMessageTable(chatId)}`,
      ).get() as {top: number | null} | undefined;
      return Number(row?.top ?? 0);
    });
  }

  /**
   * The whole session directory, exactly as WeChat's own chat list holds it.
   * Hidden entries and service folders are kept: the bridge filters what it
   * does not bridge, and the raw list is also the read-state source.
   */
  async conversations(): Promise<WeChatConversation[]> {
    const session = await this.snapshot("session/session.db");
    await session.refresh();
    const rows = await session.query((database) =>
      database.prepare(
        "SELECT username, unread_count, status, last_timestamp, summary FROM SessionTable",
      ).all() as Array<{
        username: unknown;
        unread_count: unknown;
        status: unknown;
        last_timestamp: unknown;
        summary: unknown;
      }>);
    const chatIds: string[] = [];
    const states: Array<{unread: number; marked: boolean; last: number | null; summary: string | null}> = [];
    for (const row of rows) {
      if (typeof row.username !== "string" || !row.username) continue;
      const status = typeof row.status === "bigint" ? row.status : BigInt(Number(row.status ?? 0));
      chatIds.push(row.username);
      states.push({
        unread: Number(row.unread_count) || 0,
        marked: (status & 0x1000n) !== 0n,
        last: row.last_timestamp == null ? null : Number(row.last_timestamp),
        summary: typeof row.summary === "string" ? row.summary.slice(0, 2_048) : null,
      });
    }
    const names = await this.displayNames(chatIds);
    return chatIds.map((chatId, index) => ({
      chatId,
      name: names.get(chatId) ?? null,
      unreadCount: states[index].unread,
      markedUnread: states[index].marked,
      isGroup: /@chatroom$/i.test(chatId),
      lastTimestamp: states[index].last,
      summary: states[index].summary,
    }));
  }

  /** Nicknames and remarks from the contact store, keyed by WeChat id. */
  async displayNames(chatIds: readonly string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (!this.has("contact/contact.db") || chatIds.length === 0) return names;
    let contact: SqlcipherLiveSnapshot;
    try {
      contact = await this.snapshot("contact/contact.db");
      await contact.refresh();
    } catch {
      return names;
    }
    const placeholders = chatIds.map(() => "?").join(", ");
    const rows = await contact.query((database) =>
      database.prepare(
        `SELECT username, nick_name, remark, alias FROM contact WHERE username IN (${placeholders})`,
      ).all(...chatIds) as Array<{username: string; nick_name: unknown; remark: unknown; alias: unknown}>)
      .catch((): Array<{username: string; nick_name: unknown; remark: unknown; alias: unknown}> => []);
    for (const row of rows) {
      if (typeof row.username !== "string") continue;
      const remark = typeof row.remark === "string" ? row.remark.trim() : "";
      const nick = typeof row.nick_name === "string" ? row.nick_name.trim() : "";
      const alias = typeof row.alias === "string" ? row.alias.trim() : "";
      const chosen = remark || nick || alias;
      if (chosen) names.set(row.username, chosen);
    }
    return names;
  }

  /**
   * A group's members, from the contact store's own directory — including
   * members who never spoke. A display name falls back to nothing rather
   * than to the raw id, which the bridge replaces with its own placeholder.
   */
  async members(chatId: string): Promise<Array<{wxid: string; displayName: string | null}>> {
    if (!/^[1-9]\d{0,30}@chatroom$/.test(chatId))
      throw new Error("This is not a WeChat group");
    const contact = await this.snapshot("contact/contact.db");
    await contact.refresh();
    return await contact.query((database) => {
      const room = database.prepare(
        "SELECT id FROM contact WHERE username = ?",
      ).get(chatId) as {id: number} | undefined;
      if (!room) return [];
      const rows = database.prepare(
        `SELECT n.username AS wxid, c.nick_name AS nick_name, c.remark AS remark
         FROM chatroom_member m
         JOIN name2id n ON n.rowid = m.member_id
         LEFT JOIN contact c ON c.username = n.username
         WHERE m.room_id = ?`,
      ).all(room.id) as Array<{wxid: unknown; nick_name: unknown; remark: unknown}>;
      const members: Array<{wxid: string; displayName: string | null}> = [];
      for (const row of rows) {
        if (typeof row.wxid !== "string" || !/^[A-Za-z0-9_-]+$/.test(row.wxid)) continue;
        const nick = typeof row.nick_name === "string" ? row.nick_name.trim() : "";
        const remark = typeof row.remark === "string" ? row.remark.trim() : "";
        members.push({wxid: row.wxid, displayName: nick || remark || null});
      }
      return members;
    });
  }

  /**
   * The participant number WeChat gives this account inside one chat, from
   * the shard's own id directory. A message's `real_sender_id` compared to
   * this is the exact authorship test, better than any calibration.
   */
  async selfSenderId(chatId: string): Promise<string | null> {
    const entry = await this.shardOf(chatId);
    if (!entry) return null;
    const snapshot = await this.snapshot(entry);
    await snapshot.refresh();
    return await snapshot.query((database) => {
      const row = database.prepare(
        "SELECT rowid FROM Name2Id WHERE user_name = ?",
      ).get(this.wxid) as {rowid: number} | undefined;
      return row ? String(row.rowid) : null;
    });
  }
}
