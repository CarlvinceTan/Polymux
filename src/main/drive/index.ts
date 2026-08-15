import path from "node:path";
import {homedir} from "node:os";
import type {
  DriveEntryDto,
  DriveProviderDto,
  DriveProviderId,
  DriveS3ConfigRequest,
  DriveStatusDto,
  JsonValue,
} from "@midas/protocol";
import {DRIVE_PROVIDERS, driveSaveOrder} from "@midas/protocol";
import {DropboxDrive} from "./dropbox.js";
import {GoogleDrive} from "./google-drive.js";
import {LocalDrive} from "./local.js";
import {OneDrive} from "./onedrive.js";
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
}

/**
 * The drive, across every storage backend.
 *
 * Its job is routing and settings: which providers exist, which are connected,
 * which one a new file should go to, and where each one's configuration lives.
 * Everything that actually touches storage is an adapter, so adding a provider
 * never changes this file beyond one entry in `#adapters`.
 */
export class Drive {
  readonly #storage: DrivePreferenceStore;
  readonly #pickers: DrivePickers;
  readonly #onChange: ((status: DriveStatusDto) => void) | undefined;
  readonly #adapters = new Map<DriveProviderId, DriveAdapter>();
  readonly #local: LocalDrive;
  readonly #s3: S3Drive;
  #saveOrder: DriveProviderId[];
  /** The last probe, so the renderer can paint immediately on open rather than
   * waiting on every provider's network round trip. */
  #status: DriveStatusDto | null = null;

  constructor(options: DriveOptions) {
    this.#storage = options.storage;
    this.#pickers = options.pickers;
    this.#onChange = options.onChange;

    const stored = this.#preferences();
    this.#saveOrder = driveSaveOrder(stored.saveOrder);
    this.#local = new LocalDrive(
      typeof stored.localRoot === "string" && stored.localRoot
        ? stored.localRoot
        : path.join(homedir(), "Midas"),
    );
    this.#s3 = new S3Drive(options.secrets, s3Settings(stored.s3));

    this.#adapters.set("local", this.#local);
    this.#adapters.set(
      "google-drive",
      new GoogleDrive(options.secrets, options.parent),
    );
    this.#adapters.set(
      "dropbox",
      new DropboxDrive(options.secrets, options.parent),
    );
    this.#adapters.set("onedrive", new OneDrive(options.secrets, options.parent));
    this.#adapters.set("s3", this.#s3);
  }

  /** The last known state, probing once if nothing has been read yet. */
  async status(): Promise<DriveStatusDto> {
    return this.#status ?? (await this.refresh());
  }

  /** Re-probes every provider. Adapters are asked in parallel because a
   * provider that is slow to answer must not hold up the ones that are not. */
  async refresh(): Promise<DriveStatusDto> {
    const providers = await Promise.all(
      DRIVE_PROVIDERS.map(async (entry): Promise<DriveProviderDto> => {
        const adapter = this.#adapters.get(entry.value);
        const probe = adapter
          ? await adapter.probe().catch(
              (cause: unknown): DriveProbe => ({
                // An adapter's probe is meant to absorb its own failures; one
                // that throws anyway must still not take the whole drive down.
                state: "error",
                accounts: [],
                usage: null,
                root: null,
                error: cause instanceof Error ? cause.message : String(cause),
              }),
            )
          : ({
              state: "unavailable",
              accounts: [],
              usage: null,
              root: null,
              error: "No adapter is registered for this provider.",
            } satisfies DriveProbe);
        return {
          id: entry.value,
          name: entry.label,
          kind: entry.kind,
          ...probe,
        };
      }),
    );
    return this.#publish({providers, saveOrder: [...this.#saveOrder]});
  }

  async connect(provider: DriveProviderId): Promise<DriveStatusDto> {
    const adapter = this.#require(provider);
    if (!adapter.connect)
      throw new Error(`${provider} has nothing to connect to.`);
    await adapter.connect();
    return this.refresh();
  }

  async disconnect(
    provider: DriveProviderId,
    accountId?: string,
  ): Promise<DriveStatusDto> {
    const adapter = this.#require(provider);
    if (!adapter.disconnect)
      throw new Error(`${provider} cannot be disconnected.`);
    await adapter.disconnect(accountId);
    if (provider === "s3") this.#save({s3: null});
    return this.refresh();
  }

  async setSaveOrder(order: DriveProviderId[]): Promise<DriveStatusDto> {
    this.#saveOrder = driveSaveOrder(order);
    this.#save({saveOrder: this.#saveOrder});
    return this.refresh();
  }

  /** Points the local provider at a folder, asking for one when none is given. */
  async setLocalRoot(target: string | null): Promise<DriveStatusDto> {
    const chosen = target ?? (await this.#pickers.folder());
    if (!chosen) return this.status();
    this.#local.setRoot(chosen);
    this.#save({localRoot: chosen});
    return this.refresh();
  }

  async saveS3(config: DriveS3ConfigRequest): Promise<DriveStatusDto> {
    await this.#s3.configure(config);
    const settings = this.#s3.settings();
    this.#save({s3: settings ? (settings as unknown as JsonValue) : null});
    return this.refresh();
  }

  async list(provider: DriveProviderId, target = ""): Promise<DriveEntryDto[]> {
    return this.#require(provider).list(target);
  }

  async createFolder(
    provider: DriveProviderId,
    parentPath: string,
    name: string,
  ): Promise<DriveEntryDto> {
    return this.#require(provider).createFolder(parentPath, name);
  }

  /** Uploads files from this Mac, opening a picker when none are named. */
  async upload(
    provider: DriveProviderId,
    parentPath: string,
    paths?: string[],
  ): Promise<DriveEntryDto[]> {
    const adapter = this.#require(provider);
    const chosen = paths?.length ? paths : await this.#pickers.files();
    const uploaded: DriveEntryDto[] = [];
    // Sequential on purpose: a dozen parallel uploads to one account is a good
    // way to be rate-limited, and the drive has no progress UI to justify it.
    for (const item of chosen)
      uploaded.push(await adapter.upload(parentPath, item));
    return uploaded;
  }

  async download(provider: DriveProviderId, target: string): Promise<string> {
    const adapter = this.#require(provider);
    const destination = path.join(
      this.#pickers.downloads(),
      path.basename(target) || "download",
    );
    await adapter.download(target, destination);
    return destination;
  }

  async remove(provider: DriveProviderId, paths: string[]): Promise<void> {
    const adapter = this.#require(provider);
    for (const target of paths) await adapter.remove(target);
  }

  async rename(
    provider: DriveProviderId,
    target: string,
    name: string,
  ): Promise<DriveEntryDto> {
    return this.#require(provider).rename(target, name);
  }

  async move(
    provider: DriveProviderId,
    paths: string[],
    destinationFolder: string,
  ): Promise<DriveEntryDto[]> {
    const adapter = this.#require(provider);
    const moved: DriveEntryDto[] = [];
    for (const target of paths)
      moved.push(await adapter.move(target, destinationFolder));
    return moved;
  }

  async copy(provider: DriveProviderId, paths: string[]): Promise<DriveEntryDto[]> {
    const adapter = this.#require(provider);
    const copied: DriveEntryDto[] = [];
    for (const target of paths) copied.push(await adapter.copy(target));
    return copied;
  }

  /**
   * Where a new file should go: the first provider in the save order that is
   * actually connected. Local is the backstop because it cannot be logged out.
   */
  async preferredProvider(): Promise<DriveProviderId> {
    const status = await this.status();
    for (const id of this.#saveOrder)
      if (status.providers.find((entry) => entry.id === id)?.state === "connected")
        return id;
    return "local";
  }

  #require(provider: DriveProviderId): DriveAdapter {
    const adapter = this.#adapters.get(provider);
    if (!adapter) throw new Error(`${provider} is not a known storage provider.`);
    return adapter;
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
