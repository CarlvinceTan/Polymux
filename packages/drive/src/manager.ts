import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { access, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { locks } from "@flareai/core";
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
  DRIVE_ALL_ACCOUNT,
  DRIVE_CONNECTABLE,
  DRIVE_LOCAL_HOME,
  DRIVE_LOCAL_OUTPUTS,
  DRIVE_PROVIDERS,
  driveSaveOrder,
  driveSourceId,
  parseDriveSourceId,
} from "@flareai/protocol";
import { DropboxDrive } from "./dropbox.js";
import { GoogleDrive } from "./google-drive.js";
import { LocalDrive } from "./local.js";
import { NetworkDrive } from "./network.js";
import { OneDrive } from "./onedrive.js";
import { LEGACY_ACCOUNT_ID } from "./oauth.js";
import { S3Drive, type S3Settings } from "./s3.js";
import { VirtualDrive } from "./virtual.js";

/**
 * What the agent's system prompt is told about the drive. Structural on
 * purpose: the agent package describes the same shape without depending on
 * this one.
 */
export interface DriveContext {
  defaultSource: string;
  order: string[];
  connected: string[];
  reach: string[];
}
import { uniqueName } from "./types.js";
import type {
  DriveAdapter,
  DriveConsentPrompt,
  DrivePreferenceStore,
  DriveProbe,
  DriveSecretStore,
} from "./types.js";

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
  /** Opens a provider's sign-in page. The host owns the window; the flow does
   * not. */
  consent: DriveConsentPrompt;
  onChange?: (status: DriveStatusDto) => void;
}

interface DrivePreferences {
  saveOrder?: unknown;
  localRoot?: unknown;
  s3?: unknown;
  /** Connected account ids per provider. Only OAuth providers appear; local
   * and S3 have exactly one account each and need no list. */
  accounts?: unknown;
  /** Network shares, each `{id, path, label}`. Stored rather than discovered,
   * because a share that is not mounted right now still has to be listed. */
  shares?: unknown;
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
/** A share as it is stored: where it is mounted, and what to call it. */
interface NetworkShare {
  id: string;
  path: string;
  label: string;
}

export class Drive {
  readonly #storage: DrivePreferenceStore;
  readonly #secrets: DriveSecretStore;
  readonly #pickers: DrivePickers;
  readonly #consent: DriveConsentPrompt;
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
  /**
   * The version last read at each path, keyed the same way its write lock is.
   *
   * Bounded by what has actually been read this session and dropped as soon as
   * a write settles, so it never grows into a second index of the drive — the
   * thing `VirtualDrive` deliberately refuses to keep.
   */
  readonly #versions = new Map<string, string>();

  constructor(options: DriveOptions) {
    this.#storage = options.storage;
    this.#secrets = options.secrets;
    this.#pickers = options.pickers;
    this.#consent = options.consent;
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
      sources.set(id, { id, provider, accountId, adapter });
    };

    // The virtual drive reads the table it is being put into, so it is built
    // from a live view rather than a copy: connecting an account changes what
    // it lists without anything having to rebuild it.
    add(
      "all",
      DRIVE_ALL_ACCOUNT,
      new VirtualDrive(
        () =>
          [...this.#sources.values()]
            .filter((source) => source.provider !== "all")
            // The home source is the whole of `~`, kept so the agent can reach
            // files that were never FlareAI's. The virtual drive is the other
            // thing entirely — FlareAI's own folder in each place, gathered
            // into one — so listing home here buried it: every folder in the
            // user's home directory arrived alongside, and a folder just
            // created sorted away among them.
            .filter(
              (source) =>
                source.id !== driveSourceId("local", DRIVE_LOCAL_HOME),
            )
            // The home source is the whole of `~`, kept so the agent can reach
            // files that were never FlareAI's. The virtual drive is the other
            // thing entirely — FlareAI's own folder in each place, gathered
            // into one — so listing home here buried it: every folder in the
            // user's home directory arrived alongside, and a folder just
            // created sorted away among them.
            .map(({ id, provider, adapter }) => ({ id, provider, adapter })),
        () => this.preferredSource(),
      ),
    );

    add("local", DRIVE_LOCAL_OUTPUTS, this.#outputs);
    // Unconfined on purpose: this source exists so the agent and the user can
    // reach files that were never FlareAI's to begin with.
    add("local", DRIVE_LOCAL_HOME, new LocalDrive(homedir()));

    const accounts = this.#accounts();
    for (const accountId of accounts["google-drive"] ?? [])
      add(
        "google-drive",
        accountId,
        new GoogleDrive(this.#secrets, this.#consent, accountId),
      );
    for (const accountId of accounts.dropbox ?? [])
      add(
        "dropbox",
        accountId,
        new DropboxDrive(this.#secrets, this.#consent, accountId),
      );
    for (const accountId of accounts.onedrive ?? [])
      add(
        "onedrive",
        accountId,
        new OneDrive(this.#secrets, this.#consent, accountId),
      );
    // One source per share, so several can be connected at once and each
    // becomes its own row in the drive — the same shape as an OAuth account,
    // except what is stored is a mount path rather than a credential.
    for (const share of this.#shares())
      add("network", share.id, new NetworkDrive(share.path, share.label));

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

  /**
   * The network shares the user has added.
   *
   * Stored rather than discovered: a share that is not mounted right now still
   * has to appear in Settings so it can be reconnected, and `/Volumes` only
   * lists what is attached this minute.
   */
  #shares(): NetworkShare[] {
    const stored = this.#preferences().shares;
    if (!Array.isArray(stored)) return [];
    const shares: NetworkShare[] = [];
    for (const entry of stored) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const sharePath = typeof record.path === "string" ? record.path : "";
      if (!sharePath) continue;
      shares.push({
        // The path is the identity: adding the same share twice is the same
        // share, whatever it was called the second time.
        id: typeof record.id === "string" && record.id ? record.id : sharePath,
        path: sharePath,
        label:
          typeof record.label === "string" && record.label
            ? record.label
            : path.basename(sharePath) || sharePath,
      });
    }
    return shares;
  }

  /** Adds a share, or renames one already there. Returns the refreshed drive. */
  async addShare(sharePath: string, label?: string): Promise<DriveStatusDto> {
    if (!sharePath) throw new Error("A share needs a folder.");
    const shares = this.#shares().filter((share) => share.path !== sharePath);
    shares.push({
      id: sharePath,
      path: sharePath,
      label: label || path.basename(sharePath) || sharePath,
    });
    this.#save({ shares: shares as unknown as JsonValue });
    this.#build();
    return this.refresh();
  }

  /** Forgets a share. The files are untouched — only FlareAI stops listing it. */
  async removeShare(id: string): Promise<DriveStatusDto> {
    const shares = this.#shares().filter((share) => share.id !== id);
    this.#save({ shares: shares as unknown as JsonValue });
    this.#build();
    return this.refresh();
  }

  #setAccounts(accounts: Partial<Record<DriveProviderId, string[]>>): void {
    this.#save({ accounts: accounts as unknown as JsonValue });
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
      [...this.#sources.values()].map(async (source) => {
        const probe = await probeSafely(source.adapter);
        // The home source is intentionally unrestricted. Walking it would be
        // slow and would not describe space used by FlareAI anyway.
        if (
          probe.state === "connected" &&
          probe.usage &&
          !(source.provider === "local" && source.accountId === DRIVE_LOCAL_HOME)
        ) {
          probe.usage.appUsed = await appStorageUsed(source.adapter);
        }
        return { source, probe };
      }),
    );

    // How many accounts each provider actually has signed in right now, which
    // is what decides whether naming one is information or noise.
    const perProvider = new Map<DriveProviderId, number>();
    for (const { source } of probed)
      perProvider.set(
        source.provider,
        (perProvider.get(source.provider) ?? 0) + 1,
      );

    const sources: DriveSourceDto[] = probed.map(({ source, probe }) => {
      const catalogue = DRIVE_PROVIDERS.find(
        (entry) => entry.value === source.provider,
      );
      return {
        id: source.id,
        provider: source.provider,
        accountId: source.accountId,
        name: catalogue?.label ?? source.provider,
        // The account only earns a place in the label when there is another
        // one to tell it apart from. With a single Google account signed in,
        // "Google Drive" is the whole truth and the address is noise —
        // the same reason "This Mac – local" would be.
        accountLabel:
          source.provider === "local" ||
          (perProvider.get(source.provider) ?? 0) < 2
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
    const providers: DriveProviderDto[] = DRIVE_CONNECTABLE.map((entry) => {
      const mine = probed.filter(
        ({ source }) => source.provider === entry.value,
      );
      const connected = mine.find(({ probe }) => probe.state === "connected");
      const lead = connected ?? mine[0];
      return {
        id: entry.value,
        name: entry.label,
        kind: entry.kind,
        state: lead?.probe.state ?? "unavailable",
        accounts: mine.flatMap(({ source, probe }) =>
          // Re-keyed to the drive's own account id: the provider's idea of an
          // account id is not what disconnect takes.
          probe.accounts.map((account) => ({
            ...account,
            id: source.accountId,
          })),
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
    if (provider === "local") throw new Error("Local storage is always connected.");
    // The virtual drive is a view of the others; there is nothing to sign in to.
    if (provider === "all")
      throw new Error("All storage is a view of what you have connected.");

    const accounts = this.#accounts();
    const existing = accounts[provider] ?? [];
    // The seeded legacy account is a slot, not a connection. Reusing it when it
    // holds no credential keeps a first sign-in on the old id, which is what
    // lets an upgraded build recognise it later.
    const reusable =
      existing.length === 1 && existing[0] === LEGACY_ACCOUNT_ID
        ? await this.#isLoggedOut(driveSourceId(provider, LEGACY_ACCOUNT_ID))
        : false;
    const accountId = reusable ? LEGACY_ACCOUNT_ID : randomUUID();

    if (!reusable) {
      this.#setAccounts({ ...accounts, [provider]: [...existing, accountId] });
    }

    const source = this.#sources.get(driveSourceId(provider, accountId));
    if (!source?.adapter.connect) {
      if (!reusable) this.#setAccounts({ ...accounts, [provider]: existing });
      throw new Error(`${provider} has nothing to connect to.`);
    }

    try {
      await source.adapter.connect();
    } catch (cause) {
      // A cancelled or failed consent must not leave a dead account in the
      // switcher.
      if (!reusable) this.#setAccounts({ ...accounts, [provider]: existing });
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

    if (provider === "s3") this.#save({ s3: null });
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
    this.#save({ saveOrder: this.#saveOrder });
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
    this.#save({ localRoot: chosen });
    return this.refresh();
  }

  /** Where agent output is written: one folder for everything it makes. */
  outputRoot(): string {
    return this.#outputRoot;
  }

  /**
   * Where output goes, created if it is not there yet.
   *
   * One folder, not one per chat. A subfolder per conversation meant a user
   * looking for something they made last week had to know which chat made it,
   * and left a heap of near-empty folders behind — so files land here and the
   * agent puts them in a structure that suits the work when there is one.
   */
  async outputFolder(): Promise<string> {
    await mkdir(this.#outputRoot, { recursive: true });
    return this.#outputRoot;
  }

  /**
   * The same folder, for callers that cannot await.
   *
   * The agent's file tools resolve their working directory synchronously on
   * every call, and a tool that has already been handed a relative path has no
   * moment left to wait in.
   */
  outputFolderSync(): string {
    mkdirSync(this.#outputRoot, { recursive: true });
    return this.#outputRoot;
  }

  async saveS3(config: DriveS3ConfigRequest): Promise<DriveStatusDto> {
    await this.#s3.configure(config);
    const settings = this.#s3.settings();
    this.#save({ s3: settings ? (settings as unknown as JsonValue) : null });
    return this.refresh();
  }

  async list(source: string, target = ""): Promise<DriveEntryDto[]> {
    return this.#require(source).list(target);
  }

  /** What one entry is. Falls back to the path for the providers that address
   * files by one, so every source can answer. */
  async describe(source: string, target: string): Promise<DriveEntryDto> {
    const adapter = this.#require(source);
    if (adapter.describe) return adapter.describe(target);
    return {
      id: target,
      name: path.basename(target) || target,
      kind: "file",
      size: null,
      modifiedAt: null,
      provider: adapter.id,
      path: target,
      mimeType: null,
    };
  }

  /**
   * Creates a folder, stepping the name aside rather than failing when a
   * sibling already has it. The name is a suggestion the app made, not one the
   * user typed, so "Untitled folder" twice in a row is an ordinary thing to
   * ask for. A listing that cannot be read is not a reason to refuse: the
   * create is attempted as asked and the provider decides.
   */
  async createFolder(
    source: string,
    parentPath: string,
    name: string,
  ): Promise<DriveEntryDto> {
    const adapter = this.#require(source);
    // Held across the listing *and* the create, because those two steps are
    // what decide the name: two runs asking for "Untitled folder" at the same
    // moment would otherwise both see no sibling and both create it.
    return locks.run(
      pathKey(source, childPath(adapter, parentPath, name)),
      async () => {
        const siblings = await adapter
          .list(parentPath)
          .catch((): DriveEntryDto[] => []);
        return adapter.createFolder(
          parentPath,
          uniqueName(
            name,
            siblings.map((entry) => entry.name),
          ),
        );
      },
    );
  }

  /**
   * Uploads files and folders from this Mac, opening a picker when none are
   * named.
   *
   * `expectVersions` asks for the write to be conditional: each file replaces
   * what is there only while it is still the version this drive last read at
   * that path, and a `DriveConflictError` says it is not. Left off, the write
   * is unconditional — which is right for a file being *created*, and for the
   * user dragging something into the drive themselves, since they are looking
   * at what they are replacing.
   */
  async upload(
    source: string,
    parentPath: string,
    paths?: string[],
    options?: { expectVersions?: boolean; onProgress?: (completed: number, total: number) => void },
  ): Promise<DriveEntryDto[]> {
    const chosen = paths?.length ? paths : await this.#pickers.files();
    const uploaded: DriveEntryDto[] = [];
    // Sequential on purpose: a dozen parallel uploads to one account is a good
    // way to be rate-limited, and the drive has no progress UI to justify it.
    for (const item of chosen)
      uploaded.push(await this.#uploadItem(source, parentPath, item, options));
    // Uploading changes both the folder listing and FlareAI's share of the
    // provider quota. Re-probe before resolving so settings subscribers never
    // keep showing the pre-upload byte count after the new file is visible.
    if (uploaded.length) await this.refresh();
    return uploaded;
  }

  /**
   * One dropped thing. A file is a single write; a folder is the folder made
   * on the far side and then everything under it, because no provider takes a
   * directory as an upload — dragging one in has to be spelled out as the
   * tree it stands for.
   */
  async #uploadItem(
    source: string,
    parentPath: string,
    item: string,
    options?: { expectVersions?: boolean; onProgress?: (completed: number, total: number) => void },
  ): Promise<DriveEntryDto> {
    const adapter = this.#require(source);
    if ((await stat(item)).isDirectory()) {
      const folder = await this.createFolder(
        source,
        parentPath,
        path.basename(item),
      );
      // Into the folder that was actually made, not the name asked for: a
      // taken name is given a suffix, and the children belong in the folder
      // that exists.
      for (const child of (await readdir(item)).sort())
        await this.#uploadItem(
          source,
          folder.path,
          path.join(item, child),
          options,
        );
      return folder;
    }
    // Per destination, and taken here rather than around the whole drop: an
    // upload replaces what is at that name, so two runs writing the same one
    // is a lost update, while two runs writing different names is just two
    // deliverables and must stay parallel.
    return locks.run(
      pathKey(source, childPath(adapter, parentPath, path.basename(item))),
      async () => {
        const at = childPath(adapter, parentPath, path.basename(item));
        let ifMatch =
          options?.expectVersions && adapter.conditionalWrites
            ? this.versionSeen(source, at)
            : null;
        if (
          options?.expectVersions &&
          adapter.conditionalWrites &&
          !ifMatch &&
          adapter.existingChild
        ) {
          const existing = await adapter.existingChild(
            parentPath,
            path.basename(item),
          );
          if (existing) ifMatch = this.versionSeen(source, existing);
        }
        const entry = await adapter.upload(parentPath, item, { ifMatch, onProgress: options?.onProgress });
        // The file just written is the new baseline, so a run that writes
        // twice in a row does not fail its own second write. An adapter
        // that reported no version leaves nothing remembered, which makes
        // the next write unconditional rather than wrongly conditional.
        if (entry.version)
          this.#versions.set(pathKey(source, entry.path), entry.version);
        else this.#versions.delete(pathKey(source, at));
        return entry;
      },
    );
  }

  /** Fetches an entry to an exact path, for callers that have somewhere of
   * their own to put it rather than wanting it in the downloads folder. */
  async downloadTo(
    source: string,
    target: string,
    destination: string,
  ): Promise<void> {
    const adapter = this.#require(source);
    await adapter.download(target, destination);
    // Reading is what establishes the baseline a later write is conditional on,
    // so the version is noted here rather than asked for again at write time —
    // asking then would read whatever the *other* run had just written and
    // cheerfully overwrite it, which is the bug this exists to prevent.
    await this.#noteVersion(source, target);
  }

  /**
   * The version this drive last saw at a path, if it has seen one.
   *
   * Deliberately not a cache of contents or a substitute for asking the
   * provider: it is only ever handed back to that same provider as "this is
   * what I read", and a value that has gone stale is exactly what makes the
   * write fail rather than what makes it wrong.
   */
  versionSeen(source: string, target: string): string | null {
    return this.#versions.get(pathKey(source, target)) ?? null;
  }

  /** Forgets a remembered version, so the next read establishes a fresh one. */
  forgetVersion(source: string, target: string): void {
    this.#versions.delete(pathKey(source, target));
  }

  async #noteVersion(source: string, target: string): Promise<void> {
    const adapter = this.#require(source);
    if (!adapter.conditionalWrites || !adapter.version) return;
    const version = await adapter.version(target).catch((): null => null);
    if (version) this.#versions.set(pathKey(source, target), version);
    else this.#versions.delete(pathKey(source, target));
  }

  async download(source: string, target: string): Promise<string> {
    const adapter = this.#require(source);
    const destination = await freePath(
      this.#pickers.downloads(),
      await downloadName(adapter, target),
    );
    await adapter.download(target, destination);
    return destination;
  }

  async remove(source: string, paths: string[]): Promise<void> {
    const adapter = this.#require(source);
    for (const target of paths)
      await locks.run(pathKey(source, target), () => adapter.remove(target));
  }

  async rename(
    source: string,
    target: string,
    name: string,
  ): Promise<DriveEntryDto> {
    const adapter = this.#require(source);
    return locks.run(pathKey(source, target), () =>
      adapter.rename(target, name),
    );
  }

  async move(
    source: string,
    paths: string[],
    destinationFolder: string,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<DriveEntryDto[]> {
    const adapter = this.#require(source);
    const moved: DriveEntryDto[] = [];
    for (const target of paths)
      moved.push(
        await locks.run(pathKey(source, target), () =>
          adapter.move(target, destinationFolder, {onProgress}),
        ),
      );
    if (moved.length) await this.refresh();
    return moved;
  }

  async copy(source: string, paths: string[]): Promise<DriveEntryDto[]> {
    const adapter = this.#require(source);
    const copied: DriveEntryDto[] = [];
    for (const target of paths) copied.push(await adapter.copy(target));
    return copied;
  }

  /**
   * What the agent is told about where a deliverable goes. Read from the last
   * published status and the stored save order rather than by probing: the
   * system prompt is rebuilt on every run, so this must never wait on a
   * provider — a stale line here is corrected by the next status, while a
   * network call here would slow every turn.
   */
  promptContext(): DriveContext {
    const sources = (this.#status?.sources ?? []).filter(
      (source) => source.provider !== "all" && source.state === "connected",
    );
    const label = (provider: DriveProviderId): string =>
      DRIVE_PROVIDERS.find((entry) => entry.value === provider)?.label ??
      provider;
    return {
      defaultSource: driveSourceId("all", DRIVE_ALL_ACCOUNT),
      order: this.#saveOrder.map(label),
      connected: sources.map(
        (source) =>
          `${source.accountLabel ? `${source.name} – ${source.accountLabel}` : source.name} (${source.id})`,
      ),
      // The boundary is the reason a "look in my Drive" request can fail with
      // everything connected: the cloud providers are scoped to FlareAI's own
      // folder, so a file the user put there themselves is not visible.
      reach: [...new Set(sources.map((source) => reachOf(source.provider)))],
    };
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

    const { provider } = parseDriveSourceId(source);
    const first = [...this.#sources.values()].find(
      (entry) => entry.provider === provider,
    );
    if (!first) throw new Error(`${source} is not a known storage location.`);
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

/** How far a provider's connection reaches, in one clause the agent can quote. */
function reachOf(provider: DriveProviderId): string {
  switch (provider) {
    case "google-drive":
    case "dropbox":
    case "onedrive":
      return "the cloud drives hold only FlareAI's own folder — files the user put there themselves are outside it";
    case "local":
      return "Local storage reaches the output folder and the whole home directory";
    case "network":
      return "a network share reaches whatever it has mounted";
    case "s3":
      return "S3 reaches the whole bucket or its configured prefix";
    default:
      return `${provider} reaches what it is configured for`;
  }
}

/**
 * What a downloaded file should be called on this Mac.
 *
 * Drive and Graph address files by an opaque id, so the path a caller holds is
 * not a name: without asking the provider, "Quarterly report.pdf" saves as
 * `1a2B3c...` with no extension and opens in nothing. The basename is the
 * fallback for the providers whose paths really are paths.
 */
async function downloadName(
  adapter: DriveAdapter,
  target: string,
): Promise<string> {
  const described = await adapter
    .describe?.(target)
    .then((entry) => entry.name)
    // A failed lookup must not fail the download it was only naming.
    .catch((): null => null);
  return described || path.basename(target) || "download";
}

/**
 * A path in `folder` that nothing is using yet: `report.pdf`, then
 * `report (2).pdf`. Downloading the same file twice is a normal thing to do,
 * and silently overwriting the first copy is not what it looks like it does.
 */
async function freePath(folder: string, name: string): Promise<string> {
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length) || name;
  for (let suffix = 1; ; suffix += 1) {
    const candidate = path.join(
      folder,
      suffix === 1 ? name : `${stem} (${suffix})${extension}`,
    );
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
}

/** An adapter's probe is meant to absorb its own failures; one that throws
 * anyway must still not take the whole drive down. */
async function probeSafely(adapter: DriveAdapter): Promise<DriveProbe> {
  return adapter.probe().catch((cause: unknown): DriveProbe => ({
    state: "error",
    accounts: [],
    usage: null,
    root: null,
    error: cause instanceof Error ? cause.message : String(cause),
  }));
}

/** Totals the files below an adapter's bounded root. A provider can still show
 * account quota when this secondary measurement fails. */
async function appStorageUsed(adapter: DriveAdapter): Promise<number | null> {
  try {
    let used = 0;
    const folders = [""];
    while (folders.length) {
      const entries = await adapter.list(folders.pop()!);
      for (const entry of entries) {
        if (entry.kind === "folder") folders.push(entry.path);
        else if (entry.size !== null) used += entry.size;
      }
    }
    return used;
  } catch {
    return null;
  }
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

/**
 * Where a file called `name` will land, in the provider's own addressing.
 *
 * The fallback is a slash join, which is right for every provider whose paths
 * are paths; local files are absolute and S3 keys carry a prefix, so both
 * answer for themselves. Getting this wrong is quiet rather than loud — the
 * lock and the version would simply be filed under a name nothing else uses,
 * and both guards would stop firing without anything failing.
 */
function childPath(
  adapter: DriveAdapter,
  parentPath: string,
  name: string,
): string {
  if (adapter.childPath) return adapter.childPath(parentPath, name);
  const parent = trimSlashes(parentPath);
  return parent ? `${parent}/${name}` : name;
}

/**
 * The lock a write to one destination takes.
 *
 * Deliberately as narrow as the thing being replaced: the source and the exact
 * destination path, so two runs saving different deliverables — two drafts, two
 * reports — never wait on each other, and only two runs aiming at the same file
 * are put in order. Reads take no lock at all.
 */
function pathKey(source: string, target: string): string {
  return `drive:${source}:${trimSlashes(target)}`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}
