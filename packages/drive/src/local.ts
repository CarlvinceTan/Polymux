import {copyFile, cp, mkdir, readdir, rename, rm, stat, statfs} from "node:fs/promises";
import path from "node:path";
import type {DriveEntryDto} from "@flareai/protocol";
import {
  copyName,
  DriveConflictError,
  type DriveAdapter,
  type DriveProbe,
  type DriveWriteOptions,
} from "./types.js";

/**
 * This Mac's filesystem, confined to one folder.
 *
 * Paths are absolute, but every one is checked against the root before it is
 * touched: the drive is a window onto a folder the user chose, and a `..` in a
 * name must not be able to walk out of it.
 */
export class LocalDrive implements DriveAdapter {
  readonly id = "local" as const;
  #root: string;
  /** Memoised so the root is only created once per location. */
  #ready: Promise<void> | null = null;

  constructor(root: string) {
    this.#root = root;
  }

  setRoot(root: string): void {
    this.#root = root;
    this.#ready = null;
  }

  /**
   * Creates the root if it is not there.
   *
   * The folder is one the user picked or that the app chose, and either can be
   * moved or thrown away while the app is running. Every operation that touches
   * the disk goes through this, so a missing root reads as an empty drive that
   * can still be written to rather than as a failure on every click.
   */
  async #ensureRoot(): Promise<void> {
    this.#ready ??= mkdir(this.#root, {recursive: true}).then((): void => undefined);
    await this.#ready;
  }

  async probe(): Promise<DriveProbe> {
    try {
      await this.#ensureRoot();
      const info = await statfs(this.#root);
      const total = info.blocks * info.bsize;
      return {
        state: "connected",
        accounts: [{id: "local", name: path.basename(this.#root), email: null}],
        // The volume's free space, not this folder's — a folder has no quota,
        // and what the user needs to know is whether the disk can take more.
        usage: {used: total - info.bfree * info.bsize, total, appUsed: null},
        root: this.#root,
        error: null,
      };
    } catch (cause) {
      return {
        state: "error",
        accounts: [],
        usage: null,
        root: this.#root,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  async describe(target: string): Promise<DriveEntryDto> {
    const full = this.#resolve(target);
    const info = await stat(full);
    return {
      id: full,
      name: path.basename(full),
      kind: info.isDirectory() ? "folder" : "file",
      size: info.isDirectory() ? null : info.size,
      modifiedAt: info.mtime.toISOString(),
      provider: this.id,
      path: full,
      mimeType: null,
    };
  }

  async list(target: string): Promise<DriveEntryDto[]> {
    await this.#ensureRoot();
    const directory = this.#resolve(target);
    const names = await readdir(directory, {withFileTypes: true});
    const entries = await Promise.all(
      names
        // Dotfiles are machinery rather than the user's documents, and a drive
        // that shows .DS_Store in every folder is noise.
        .filter((entry) => !entry.name.startsWith("."))
        .map(async (entry): Promise<DriveEntryDto> => {
          const full = path.join(directory, entry.name);
          const info = await stat(full).catch((): null => null);
          return {
            id: full,
            name: entry.name,
            kind: entry.isDirectory() ? ("folder" as const) : ("file" as const),
            size: entry.isDirectory() ? null : (info?.size ?? null),
            modifiedAt: info ? info.mtime.toISOString() : null,
            provider: this.id,
            path: full,
            mimeType: null,
          };
        }),
    );
    return entries;
  }

  async createFolder(parentPath: string, name: string): Promise<DriveEntryDto> {
    await this.#ensureRoot();
    const full = this.#resolve(path.join(this.#resolve(parentPath), name));
    await mkdir(full, {recursive: false});
    const info = await stat(full);
    return {
      id: full,
      name,
      kind: "folder",
      size: null,
      modifiedAt: info.mtime.toISOString(),
      provider: this.id,
      path: full,
      mimeType: null,
    };
  }

  readonly conditionalWrites = true;

  /**
   * A local file has no server to hand out a token, so its version is what the
   * filesystem already tracks: modification time and size. Two writes a
   * millisecond apart with identical length would collide — but they can only
   * arrive that way from inside this process, where the write lock has already
   * put them in order.
   */
  async version(target: string): Promise<string | null> {
    try {
      const info = await stat(this.#resolve(target));
      return `${info.mtimeMs}:${info.size}`;
    } catch {
      // No file is a real answer: it means nothing is being replaced.
      return null;
    }
  }

  childPath(parentPath: string, name: string): string {
    return this.#resolve(path.join(this.#resolve(parentPath), name));
  }

  async upload(
    parentPath: string,
    localPath: string,
    options?: DriveWriteOptions,
  ): Promise<DriveEntryDto> {
    await this.#ensureRoot();
    const name = path.basename(localPath);
    const full = this.#resolve(path.join(this.#resolve(parentPath), name));
    if (options?.ifMatch !== undefined && options.ifMatch !== null) {
      const found = await this.version(full);
      if (found !== options.ifMatch)
        throw new DriveConflictError({
          path: full,
          expected: options.ifMatch,
          found,
        });
    }
    await copyFile(localPath, full);
    const info = await stat(full);
    options?.onProgress?.(info.size, info.size);
    return {
      id: full,
      name,
      kind: "file",
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      provider: this.id,
      path: full,
      mimeType: null,
      version: `${info.mtimeMs}:${info.size}`,
    };
  }

  async download(target: string, destination: string): Promise<void> {
    await copyFile(this.#resolve(target), destination);
  }

  async remove(target: string): Promise<void> {
    await rm(this.#resolve(target), {recursive: true, force: true});
  }

  async rename(target: string, name: string): Promise<DriveEntryDto> {
    const from = this.#resolve(target);
    const to = this.#resolve(path.join(path.dirname(from), name));
    await rename(from, to);
    const info = await stat(to);
    return {
      id: to,
      name,
      kind: info.isDirectory() ? "folder" : "file",
      size: info.isDirectory() ? null : info.size,
      modifiedAt: info.mtime.toISOString(),
      provider: this.id,
      path: to,
      mimeType: null,
    };
  }

  async move(target: string, destinationFolder: string): Promise<DriveEntryDto> {
    const from = this.#resolve(target);
    const to = this.#resolve(
      path.join(this.#resolve(destinationFolder), path.basename(from)),
    );
    await rename(from, to);
    return this.#describe(to);
  }

  async copy(target: string): Promise<DriveEntryDto> {
    const from = this.#resolve(target);
    const to = this.#resolve(
      path.join(path.dirname(from), copyName(path.basename(from))),
    );
    const info = await stat(from);
    // `cp` handles a folder; `copyFile` is the cheaper path for a plain file.
    if (info.isDirectory()) await cp(from, to, {recursive: true});
    else await copyFile(from, to);
    return this.#describe(to);
  }

  async #describe(target: string): Promise<DriveEntryDto> {
    const info = await stat(target);
    return {
      id: target,
      name: path.basename(target),
      kind: info.isDirectory() ? "folder" : "file",
      size: info.isDirectory() ? null : info.size,
      modifiedAt: info.mtime.toISOString(),
      provider: this.id,
      path: target,
      mimeType: null,
    };
  }

  /**
   * Turns a caller's path into an absolute one inside the root, refusing
   * anything that escapes. The empty path is the root itself, which is how a
   * caller opens a drive it knows nothing about.
   */
  #resolve(target: string): string {
    const absolute = target
      ? path.resolve(this.#root, target)
      : path.resolve(this.#root);
    const root = path.resolve(this.#root);
    // The separator matters: without it `/Users/me/drive-old` passes as being
    // inside `/Users/me/drive`.
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`))
      throw new Error("That path is outside the drive folder.");
    return absolute;
  }
}
