import type {
  DriveAccountDto,
  DriveEntryDto,
  DriveProviderId,
  DriveProviderState,
  DriveUsageDto,
  JsonValue,
} from "@flareai/protocol";


/**
 * What a provider reports about itself when the drive probes it. The manager
 * turns this into the DTO by adding the catalogue's name and kind, so an
 * adapter never repeats what `DRIVE_PROVIDERS` already says.
 */
export interface DriveProbe {
  state: DriveProviderState;
  accounts: DriveAccountDto[];
  usage: DriveUsageDto | null;
  root: string | null;
  error: string | null;
}

/**
 * One storage backend.
 *
 * Every method addresses entries by the provider's own `path`, which is opaque
 * to everything above: an absolute filesystem path for local, a file id for
 * Google Drive, a key for S3. The empty string always means the provider's
 * root, so callers can open a drive without knowing which provider they got.
 *
 * Adapters throw plain `Error`s; the manager is what turns a failure into an
 * `error` state on the next probe.
 */
export interface DriveAdapter {
  readonly id: DriveProviderId;

  /** Credentials and quota as they stand right now. Called on every refresh,
   * so it should be cheap and must not throw — report trouble as `error`. */
  probe(): Promise<DriveProbe>;

  /** Connects an account. OAuth adapters open a consent window here. */
  connect?(): Promise<void>;

  /** Forgets stored credentials. Omitting the id drops every account. */
  disconnect?(accountId?: string): Promise<void>;

  list(path: string): Promise<DriveEntryDto[]>;
  createFolder(parentPath: string, name: string): Promise<DriveEntryDto>;
  /** Uploads a file that already exists on this Mac. */
  upload(parentPath: string, localPath: string): Promise<DriveEntryDto>;
  /** Writes the entry to `destination` on this Mac. */
  download(path: string, destination: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(path: string, name: string): Promise<DriveEntryDto>;
  /** Moves an entry into another folder of the same provider. Moving between
   * providers is the drive's job, not an adapter's — it has to go through this
   * Mac to get there. */
  move(path: string, destinationFolder: string): Promise<DriveEntryDto>;
  /** Copies an entry alongside itself, named so the two can be told apart. */
  copy(path: string): Promise<DriveEntryDto>;
}

/**
 * `Report.docx` → `Report copy.docx`. The suffix goes before the extension so
 * the copy still opens in the same application as the original.
 */
export function copyName(name: string): string {
  const dot = name.lastIndexOf(".");
  // A leading dot is the whole name of a hidden file, not an extension.
  if (dot <= 0) return `${name} copy`;
  return `${name.slice(0, dot)} copy${name.slice(dot)}`;
}

/** The slice of app storage the drive keeps its settings in. */
export interface DrivePreferenceStore {
  getPreference(key: string): {value: unknown} | undefined | null;
  setPreference(key: string, value: JsonValue): void;
}

/**
 * Where adapters keep tokens and secrets. Backed by the app's OS-encrypted
 * credential store, so nothing here is ever written as plaintext.
 */
export interface DriveSecretStore {
  read(id: string): Promise<string | undefined>;
  write(id: string, secret: string): Promise<void>;
  clear(id: string): Promise<void>;
}
