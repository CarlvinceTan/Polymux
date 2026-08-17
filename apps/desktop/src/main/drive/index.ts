import {randomUUID} from "node:crypto";
import {mkdirSync} from "node:fs";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {homedir} from "node:os";
import type {
  DriveEntryDto,
  DriveProviderDto,
  DriveProviderId,
  DriveS3ConfigRequest,
  DriveSourceDto,
  DriveStatusDto,
  JsonValue,
} from "@flareai/protocol";
import {
  DRIVE_LOCAL_HOME,
  DRIVE_LOCAL_OUTPUTS,
  DRIVE_PROVIDERS,
  driveSaveOrder,
  driveSourceId,
  parseDriveSourceId,
} from "@flareai/protocol";
import {DropboxDrive} from "./dropbox.js";
import {GoogleDrive} from "./google-drive.js";
import {LocalDrive} from "./local.js";
import {OneDrive} from "./onedrive.js";
import {LEGACY_ACCOUNT_ID} from "./oauth.js";
import {S3Drive, type S3Settings} from "./s3.js";
import type {
  DriveAdapter,
  DrivePreferenceStore,
  DriveProbe,
  DriveSecretStore,
} from "./types.js";
import type {BrowserWindow} from "electron";

/** Where the drive's non-secret settings live in app storage. */
const PREFERENCE_KEY = "drive";

/**
 * Where agent output goes when the user has not said otherwise.
 *
 * Documents rather than the home folder: what the agent produces is the user's
 * work, and it should land somewhere they already look for their own files and
 * that Time Machine and iCloud already cover.
 */
export function defaultOutputRoot(): string {
  return path.join(homedir(), "Documents", "FlareAI");
}

/** The one account id S3 and the local folders have; neither can hold two. */
const SINGLE_ACCOUNT = LEGACY_ACCOUNT_ID;

export interface DrivePickers {
  /** Picks a folder on this Mac. Null when the user cancels. */
  folder(): Promise<string | null>;
  /** Picks files to upload. Empty when the user cancels. */
  files(): Promise<string[]>;
  /** Where downloads land. */
  downloads(): string;
}

export interface DriveOptions {
  storage: DrivePreferenceStore;
  secrets: DriveSecretStore;
  pickers: DrivePickers;
  /** The app window, so consent sheets open over it. */
  parent: () => BrowserWindow | undefined;
  onChange?: (status: DriveStatusDto) => void;
}

interface DrivePreferences {
  saveOrder?: unknown;
  localRoot?: unknown;
  s3?: unknown;
  /** Connected account ids per provider. Only OAuth providers appear; local
   * and S3 have exactly one account each and need no list. */
  accounts?: unknown;
}

/** One browsable place: an adapter plus which account it speaks for. */
interface DriveSource {
  id: string;
  provider: DriveProviderId;
  accountId: string;
  adapter: DriveAdapter;
}

/**
 * The drive, across every storage backend.
 *
 * Its job is routing and settings: which providers exist, which accounts are
 * signed in to each, which one a new file should go to, and where each one's
 * configuration lives. Everything that actually touches storage is an adapter,
 * so adding a provider never changes this file beyond one entry in `#build`.
 *
 * Callers address a *source* — `<provider>#<accountId>` — rather than a
 * provider, because a provider can hold several accounts and a path only means
 * something inside the account that issued it.
 */
export class Drive {
  readonly #storage: DrivePreferenceStore;
  readonly #secrets: DriveSecretStore;
  readonly #pickers: DrivePickers;
  readonly #parent: () => BrowserWindow | undefined;
  readonly #onChange: ((status: DriveStatusDto) => void) | undefined;
  /** Keyed by source id, rebuilt whenever an account is added or dropped. */
  #sources = new Map<string, DriveSource>();
  #outputs: LocalDrive;
  #s3: S3Drive;
  #outputRoot: string;
  #saveOrder: DriveProviderId[];
  /** The last probe, so the renderer can paint immediately on open rather than
   * waiting on every provider's network round trip. */
  #status: DriveStatusDto | null = null;

  constructor(options: DriveOptions) {
    this.#storage = options.storage;
    this.#secrets = options.secrets;
    this.#pickers = options.pickers;
    this.#parent = options.parent;
    this.#onChange = options.onChange;

    const stored = this.#preferences();
    this.#saveOrder = driveSaveOrder(stored.saveOrder);
    this.#outputRoot =
      typeof stored.localRoot === "string" && stored.localRoot
        ? stored.localRoot
        : defaultOutputRoot();
    this.#outputs = new LocalDrive(this.#outputRoot);
    this.#s3 = new S3Drive(options.secrets, s3Settings(stored.s3));
    this.#build();
  }

  /**
   * Assembles the source table from what is configured.
   *
   * The two local sources are always present and are not accounts the user
   * signs in to: one is where output is written, the other is this Mac itself,
   * so a file can be picked up from anywhere in the home folder.
   */
  #build(): void {
    const sources = new Map<string, DriveSource>();
    const add = (
      provider: DriveProviderId,
      accountId: string,
      adapter: DriveAdapter,
    ): void => {
      const id = driveSourceId(provider, accountId);
      sources.set(id, {id, provider, accountId, adapter});
    };

    add("local", DRIVE_LOCAL_OUTPUTS, this.#outputs);
    // Unconfined on purpose: this source exists so the agent and the user can
    // reach files that were never FlareAI's to begin with.
    add("local", DRIVE_LOCAL_HOME, new LocalDrive(homedir()));

    const accounts = this.#accounts();
    for (const accountId of accounts["google-drive"] ?? [])
      add(
        "google-drive",
        accountId,
        new GoogleDrive(this.#secrets, this.#parent, accountId),
      );
    for (const accountId of accounts.dropbox ?? [])
      add(
        "dropbox",
        accountId,
        new DropboxDrive(this.#secrets, this.#parent, accountId),
      );
    for (const accountId of accounts.onedrive ?? [])
      add(
        "onedrive",
        accountId,
        new OneDrive(this.#secrets, this.#parent, accountId),
      );
    add("s3", SINGLE_ACCOUNT, this.#s3);

    this.#sources = sources;
  }

  /**
   * Which accounts are signed in per provider.
   *
   * A build upgraded from before accounts existed has no list but may well have
   * a credential, so every OAuth provider is seeded with the legacy account —
   * its adapter falls back to the old credential id and reports itself as
   * logged out if there was nothing there.
   */
  #accounts(): Partial<Record<DriveProviderId, string[]>> {
    const stored = this.#preferences().accounts;
    const record =
      typeof stored === "object" && stored !== null
        ? (stored as Record<string, unknown>)
        : null;
    const result: Partial<Record<DriveProviderId, string[]>> = {};
    for (const provider of ["google-drive", "dropbox", "onedrive"] as const) {
      const list = record?.[provider];
      result[provider] = Array.isArray(list)
        ? list.filter((id): id is string => typeof id === "string" && id !== "")
        : [LEGACY_ACCOUNT_ID];
    }
    return result;
  }

  #setAccounts(accounts: Partial<Record<DriveProviderId, string[]>>): void {
    this.#save({accounts: accounts as unknown as JsonValue});
    this.#build();
  }

  /** The last known state, probing once if nothing has been read yet. */
  async status(): Promise<DriveStatusDto> {
    return this.#status ?? (await this.refresh());
  }

  /** Re-probes every source. Adapters are asked in parallel because a provider
   * that is slow to answer must not hold up the ones that are not. */
  async refresh(): Promise<DriveStatusDto> {
    const probed = await Promise.all(
      [...this.#sources.values()].map(async (source) => ({
        source,
        probe: await probeSafely(source.adapter),
      })),
    );

    const sources: DriveSourceDto[] = probed.map(({source, probe}) => {
      const catalogue = DRIVE_PROVIDERS.find(
        (entry) => entry.value === source.provider,
      );
      return {
        id: source.id,
        provider: source.provider,
        accountId: source.accountId,
        name: catalogue?.label ?? source.provider,
        // The account only earns a place in the label when the provider can
        // hold more than one; "This Mac – local" would be noise.
        accountLabel:
          source.provider === "local"
            ? null
            : (probe.accounts[0]?.email ?? probe.accounts[0]?.name ?? null),
        state: probe.state,
        usage: probe.usage,
        root: probe.root,
        error: probe.error,
      };
    });

    // The settings tab still thinks in providers: one row per backend, showing
    // every account signed in to it.
    const providers: DriveProviderDto[] = DRIVE_PROVIDERS.map((entry) => {
      const mine = probed.filter(({source}) => source.provider === entry.value);
      const connected = mine.find(({probe}) => probe.state === "connected");
      const lead = connected ?? mine[0];
      return {
        id: entry.value,
        name: entry.label,
        kind: entry.kind,
        state: lead?.probe.state ?? "unavailable",
        accounts: mine.flatMap(({source, probe}) =>
          // Re-keyed to the drive's own account id: the provider's idea of an
          // account id is not what disconnect takes.
          probe.accounts.map((account) => ({...account, id: source.accountId})),
        ),
        usage: lead?.probe.usage ?? null,
        root: lead?.probe.root ?? null,
        error: lead?.probe.error ?? null,
      };
    });

    return this.#publish({
      providers,
      sources,
      saveOrder: [...this.#saveOrder],
    });
  }

  /**
   * Signs in another account.
   *
   * The account id is minted here rather than taken from the provider: it has
   * to exist before the consent flow runs, since it is what scopes the
   * credential the flow writes. A cancelled sign-in leaves nothing behind.
   */
  async connect(provider: DriveProviderId): Promise<DriveStatusDto> {
    if (provider === "local")
      throw new Error("This Mac is always connected.");

    const accounts = this.#accounts();
    const existing = accounts[provider] ?? [];
    // The seeded legacy account is a slot, not a connection. Reusing it when it
    // holds no credential keeps a first sign-in on the old id, which is what
    // lets an upgraded build recognise it later.
    const reusable = existing.length === 1 && existing[0] === LEGACY_ACCOUNT_ID
      ? await this.#isLoggedOut(driveSourceId(provider, LEGACY_ACCOUNT_ID))
      : false;
    const accountId = reusable ? LEGACY_ACCOUNT_ID : randomUUID();

    if (!reusable) {
      this.#setAccounts({...accounts, [provider]: [...existing, accountId]});
    }

    const source = this.#sources.get(driveSourceId(provider, accountId));
    if (!source?.adapter.connect) {
      if (!reusable)
        this.#setAccounts({...accounts, [provider]: existing});
      throw new Error(`${provider} has nothing to connect to.`);
    }

    try {
      await source.adapter.connect();
    } catch (cause) {
      // A cancelled or failed consent must not leave a dead account in the
      // switcher.
      if (!reusable) this.#setAccounts({...accounts, [provider]: existing});
      throw cause;
    }
    return this.refresh();
  }

  async #isLoggedOut(id: string): Promise<boolean> {
    const source = this.#sources.get(id);
    if (!source) return true;
    return (await probeSafely(source.adapter)).state !== "connected";
  }

  /** Drops one account, or every account of a provider when none is named. */
  async disconnect(
    provider: DriveProviderId,
    accountId?: string,
  ): Promise<DriveStatusDto> {
    const accounts = this.#accounts();
    const targets = accountId
      ? [accountId]
      : (accounts[provider] ?? [SINGLE_ACCOUNT]);

    for (const target of targets) {
      const source = this.#sources.get(driveSourceId(provider, target));
      if (source?.adapter.disconnect) await source.adapter.disconnect();
    }

    if (provider === "s3") this.#save({s3: null});
    else
      this.#setAccounts({
        ...accounts,
        [provider]: (accounts[provider] ?? []).filter(
          (id) => !targets.includes(id),
        ),
      });
    return this.refresh();
  }

  async setSaveOrder(order: DriveProviderId[]): Promise<DriveStatusDto> {
    this.#saveOrder = driveSaveOrder(order);
    this.#save({saveOrder: this.#saveOrder});
    return this.refresh();
  }

  /**
   * Points agent output at a folder, asking for one when none is given.
   *
   * Only the output source moves: "This Mac" is the home folder by definition
   * and is not the user's to relocate.
   */
  async setLocalRoot(target: string | null): Promise<DriveStatusDto> {
    const chosen = target ?? (await this.#pickers.folder());
    if (!chosen) return this.status();
    this.#outputRoot = chosen;
    this.#outputs.setRoot(chosen);
    this.#save({localRoot: chosen});
    return this.refresh();
  }

  /** Where agent output is written, before the per-conversation subfolder. */
  outputRoot(): string {
    return this.#outputRoot;
  }

  /**
   * The folder this conversation's output belongs in, created if it is not
   * there yet.
   *
   * Each chat gets its own subfolder so a run's files are findable as a group
   * rather than heaped together with every other chat's. The id is appended
   * when a title is given because two chats may well be called the same thing,
   * and the folder has to stay stable when one of them is renamed.
   */
  async conversationFolder(
    conversationId: string,
    title?: string,
  ): Promise<string> {
    const folder = path.join(
      this.#outputRoot,
      folderName(conversationId, title),
    );
    await mkdir(folder, {recursive: true});
    return folder;
  }

  /**
   * The same folder, for callers that cannot await.
   *
   * The agent's file tools resolve their working directory synchronously on
   * every call, and a tool that has already been handed a relative path has no
   * moment left to wait in.
   */
  conversationFolderSync(conversationId: string, title?: string): string {
    const folder = path.join(
      this.#outputRoot,
      folderName(conversationId, title),
    );
    mkdirSync(folder, {recursive: true});
    return folder;
  }

  async saveS3(config: DriveS3ConfigRequest): Promise<DriveStatusDto> {
    await this.#s3.configure(config);
    const settings = this.#s3.settings();
    this.#save({s3: settings ? (settings as unknown as JsonValue) : null});
    return this.refresh();
  }

  async list(source: string, target = ""): Promise<DriveEntryDto[]> {
    return this.#require(source).list(target);
  }

  async createFolder(
    source: string,
    parentPath: string,
    name: string,
  ): Promise<DriveEntryDto> {
    return this.#require(source).createFolder(parentPath, name);
  }

  /** Uploads files from this Mac, opening a picker when none are named. */
  async upload(
    source: string,
    parentPath: string,
    paths?: string[],
  ): Promise<DriveEntryDto[]> {
    const adapter = this.#require(source);
    const chosen = paths?.length ? paths : await this.#pickers.files();
    const uploaded: DriveEntryDto[] = [];
    // Sequential on purpose: a dozen parallel uploads to one account is a good
    // way to be rate-limited, and the drive has no progress UI to justify it.
    for (const item of chosen)
      uploaded.push(await adapter.upload(parentPath, item));
    return uploaded;
  }

  /** Fetches an entry to an exact path, for callers that have somewhere of
   * their own to put it rather than wanting it in the downloads folder. */
  async downloadTo(
    source: string,
    target: string,
    destination: string,
  ): Promise<void> {
    await this.#require(source).download(target, destination);
  }

  async download(source: string, target: string): Promise<string> {
    const adapter = this.#require(source);
    const destination = path.join(
      this.#pickers.downloads(),
      path.basename(target) || "download",
    );
    await adapter.download(target, destination);
    return destination;
  }

  async remove(source: string, paths: string[]): Promise<void> {
    const adapter = this.#require(source);
    for (const target of paths) await adapter.remove(target);
  }

  async rename(
    source: string,
    target: string,
    name: string,
  ): Promise<DriveEntryDto> {
    return this.#require(source).rename(target, name);
  }

  async move(
    source: string,
    paths: string[],
    destinationFolder: string,
  ): Promise<DriveEntryDto[]> {
    const adapter = this.#require(source);
    const moved: DriveEntryDto[] = [];
    for (const target of paths)
      moved.push(await adapter.move(target, destinationFolder));
    return moved;
  }

  async copy(source: string, paths: string[]): Promise<DriveEntryDto[]> {
    const adapter = this.#require(source);
    const copied: DriveEntryDto[] = [];
    for (const target of paths) copied.push(await adapter.copy(target));
    return copied;
  }

  /** Every source that can be written to right now, for the agent's tools. */
  async writableSources(): Promise<DriveSourceDto[]> {
    return (await this.status()).sources.filter(
      (source) => source.state === "connected",
    );
  }

  /**
   * Where a new file should go: the first provider in the save order that has
   * a connected account. The output folder is the backstop, since it cannot be
   * logged out of.
   */
  async preferredSource(): Promise<string> {
    const status = await this.status();
    for (const provider of this.#saveOrder) {
      const source = status.sources.find(
        (entry) => entry.provider === provider && entry.state === "connected",
      );
      if (source) return source.id;
    }
    return driveSourceId("local", DRIVE_LOCAL_OUTPUTS);
  }

  /**
   * Resolves a source id to its adapter, accepting a bare provider id as
   * shorthand for that provider's first account — which is what the save order
   * and anything written by an older build hold.
   */
  #require(source: string): DriveAdapter {
    const direct = this.#sources.get(source);
    if (direct) return direct.adapter;

    const {provider} = parseDriveSourceId(source);
    const first = [...this.#sources.values()].find(
      (entry) => entry.provider === provider,
    );
    if (!first)
      throw new Error(`${source} is not a known storage location.`);
    return first.adapter;
  }

  #preferences(): DrivePreferences {
    const value = this.#storage.getPreference(PREFERENCE_KEY)?.value;
    return typeof value === "object" && value !== null
      ? (value as DrivePreferences)
      : {};
  }

  #save(patch: Record<string, JsonValue | null>): void {
    this.#storage.setPreference(PREFERENCE_KEY, {
      ...this.#preferences(),
      ...patch,
    } as JsonValue);
  }

  #publish(status: DriveStatusDto): DriveStatusDto {
    this.#status = status;
    this.#onChange?.(status);
    return status;
  }
}

/** An adapter's probe is meant to absorb its own failures; one that throws
 * anyway must still not take the whole drive down. */
async function probeSafely(adapter: DriveAdapter): Promise<DriveProbe> {
  return adapter.probe().catch(
    (cause: unknown): DriveProbe => ({
      state: "error",
      accounts: [],
      usage: null,
      root: null,
      error: cause instanceof Error ? cause.message : String(cause),
    }),
  );
}

/**
 * A conversation's folder name: its title, reduced to something a filesystem
 * and a person can both read, with a slice of the id to keep two same-named
 * chats apart.
 */
function folderName(conversationId: string, title?: string): string {
  const slug = (title ?? "")
    .normalize("NFKD")
    // Separators and the characters Finder and Windows both object to.
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  const suffix = conversationId.slice(0, 8);
  // A leading dot would hide the folder, and an empty slug leaves the id to
  // name it on its own.
  return slug && !slug.startsWith(".") ? `${slug} (${suffix})` : suffix;
}

/** Reads back a stored S3 connection, ignoring one written by a build whose
 * shape no longer matches. */
function s3Settings(value: unknown): S3Settings | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.bucket !== "string" || typeof record.region !== "string")
    return null;
  return {
    bucket: record.bucket,
    region: record.region,
    endpoint: typeof record.endpoint === "string" ? record.endpoint : null,
    accessKeyId:
      typeof record.accessKeyId === "string" ? record.accessKeyId : "",
    prefix: typeof record.prefix === "string" ? record.prefix : null,
    forcePathStyle: record.forcePathStyle === true,
  };
}
