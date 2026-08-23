import type {
  DriveAccountDto,
  DriveEntryDto,
  DriveProviderId,
  DriveProviderState,
  DriveUsageDto,
  JsonValue,
} from "@polymux/protocol";

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

  /**
   * What one entry is, for a caller holding only a path.
   *
   * Providers that address files by an opaque id — Drive and Graph — need this
   * for anything user-facing: the id is not a filename, so a download that
   * names the local file after it produces `1a2B3c...` with no extension. An
   * adapter whose paths are already paths can leave it out.
   */
  describe?(path: string): Promise<DriveEntryDto>;

  list(path: string): Promise<DriveEntryDto[]>;
  createFolder(parentPath: string, name: string): Promise<DriveEntryDto>;
  /**
   * Uploads a file that already exists on this Mac.
   *
   * `options.ifMatch` is the version the caller believes is there. An adapter
   * that sets `conditionalWrites` must refuse the write with a
   * `DriveConflictError` when it no longer matches; one that does not is never
   * given the option in the first place, so silently ignoring it is not a
   * failure mode that can happen.
   */
  upload(
    parentPath: string,
    localPath: string,
    options?: DriveWriteOptions,
  ): Promise<DriveEntryDto>;

  /**
   * Whether `upload` honours `ifMatch`.
   *
   * Only an adapter whose upload genuinely *replaces* the file at that name has
   * anything to be conditional about: one that renames around a collision
   * cannot lose an edit, because it never overwrites one.
   */
  readonly conditionalWrites?: boolean;

  /**
   * How this provider addresses `name` inside `parentPath`.
   *
   * A path is the provider's own, and joining with a slash only happens to be
   * right for some of them: local files are absolute, so `report.md` in the
   * root is `/Users/…/Polymux/report.md` and not `report.md`. Anything that
   * has to name a destination *before* writing to it — the write lock, the
   * version a conditional write is checked against — asks here, or the two
   * halves end up filing the same file under two different names and neither
   * guard fires.
   */
  childPath?(parentPath: string, name: string): string;

  /** Resolves an existing child to its opaque provider path. Needed by
   * id-addressed providers so a version remembered from a read can be matched
   * to a later write expressed as parent plus filename. */
  existingChild?(parentPath: string, name: string): Promise<string | null>;

  /**
   * The current version of one entry, or null when the provider states none.
   * Read before a write to establish what is being replaced, and cheap by
   * design — a metadata call, never the bytes.
   */
  version?(path: string): Promise<string | null>;
  /** Writes the entry to `destination` on this Mac. */
  download(path: string, destination: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(path: string, name: string): Promise<DriveEntryDto>;
  /** Moves an entry into another folder of the same provider. Moving between
   * providers is the drive's job, not an adapter's — it has to go through this
   * Mac to get there. */
  move(path: string, destinationFolder: string, options?: DriveWriteOptions): Promise<DriveEntryDto>;
  /** Copies an entry alongside itself, named so the two can be told apart. */
  copy(path: string): Promise<DriveEntryDto>;
}

/** What a caller asks of a write beyond the bytes themselves. */
export interface DriveWriteOptions {
  /** Only replace the entry if this is still its version. */
  ifMatch?: string | null;
  /** Bytes the provider has acknowledged, against the file's total bytes. */
  onProgress?: (completed: number, total: number) => void;
}

/**
 * A write refused because what it would have replaced is no longer what the
 * caller read.
 *
 * Deliberately its own type rather than a plain `Error`: the whole point is
 * that the caller can tell "somebody else changed this" from "the upload
 * failed", and do something about it — re-read and merge — instead of
 * reporting a dead end.
 */
export class DriveConflictError extends Error {
  readonly path: string;
  /** The version the caller expected, and what is actually there now. */
  readonly expected: string | null;
  readonly found: string | null;

  constructor(options: {
    path: string;
    expected: string | null;
    found: string | null;
  }) {
    super(
      `${options.path} changed since it was read, so it was not overwritten.`,
    );
    this.name = "DriveConflictError";
    this.path = options.path;
    this.expected = options.expected;
    this.found = options.found;
  }
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
  getPreference(key: string): { value: unknown } | undefined | null;
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

/** A consent window that is open. Closing one already closed does nothing. */
export interface DriveConsentWindow {
  close(): void;
}

/**
 * Shows a provider's sign-in page.
 *
 * This is the drive's one seam onto the host: opening a window is the only
 * thing OAuth needs that plain Node cannot do, and keeping it an interface is
 * what lets this package stay Electron-free. The host shows `url` and reports
 * a dismissal; it decides nothing about the flow, since the code that comes
 * back is checked against the state the client generated either way.
 */
export interface DriveConsentPrompt {
  open(request: {
    provider: DriveProviderId;
    /** Window title, already localised to the provider's name. */
    title: string;
    url: string;
    /** Called if the user closes the window before the provider answers. */
    onClosed: () => void;
  }): Promise<DriveConsentWindow>;
}

/**
 * A name no sibling is using: "Untitled folder", "Untitled folder 1",
 * "Untitled folder 2", and so on — the suffix counts the extra copies rather
 * than numbering the folder itself.
 *
 * A new folder is created with a suggested name rather than one the user
 * typed, so a second one in the same place must not fail on the collision the
 * suggestion itself caused.
 */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (entry) => entry.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const extension = dot <= 0 ? "" : name.slice(dot);
  for (let index = 1; ; index += 1) {
    const candidate = `${stem} ${index}${extension}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
