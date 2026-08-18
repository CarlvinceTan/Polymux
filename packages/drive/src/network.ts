import { stat, statfs } from "node:fs/promises";
import path from "node:path";
import type { DriveAccountDto, DriveEntryDto } from "@flareai/protocol";
import { LocalDrive } from "./local.js";
import type { DriveAdapter, DriveProbe } from "./types.js";

/**
 * A shared folder on the network.
 *
 * The bytes are reached exactly the way local ones are — an SMB, AFP or NFS
 * volume is a path under `/Volumes` once macOS has mounted it — so every
 * operation delegates to a `LocalDrive` rooted there rather than reimplementing
 * a filesystem.
 *
 * What is different is the one thing that matters: it can be *gone*. The local
 * drive is contractually always connected, which is why the manager refuses to
 * disconnect it; a share is unmounted, the server sleeps, the VPN drops. So the
 * whole of this class is a probe that answers "is it there right now" honestly,
 * and a refusal to create the root when it is not.
 *
 * That last part is the trap worth naming: `LocalDrive` makes its root if it is
 * missing, which is right for a folder on this Mac and catastrophic here. An
 * unmounted share is an empty directory at the mount point, so creating it
 * would write the user's files into `/Volumes/Share` on the *local* disk, where
 * they would sit invisibly until the real volume mounted over the top of them.
 * Everything below refuses to act unless the mount is live.
 */
export class NetworkDrive implements DriveAdapter {
  readonly id = "network" as const;
  readonly #inner: LocalDrive;
  #root: string;
  /** What the user called this share, shown as its account name. */
  #label: string;

  constructor(root: string, label?: string) {
    this.#root = root;
    this.#label = label || path.basename(root) || root;
    this.#inner = new LocalDrive(root);
  }

  get root(): string {
    return this.#root;
  }

  setRoot(root: string, label?: string): void {
    this.#root = root;
    if (label !== undefined) this.#label = label;
    this.#inner.setRoot(root);
  }

  /**
   * Whether the share is mounted, without creating anything.
   *
   * A mount point that exists but is not a directory, or is not there at all,
   * reports `logged-out` rather than `error`: the share is not broken, it is
   * simply not attached, and the user's fix is to mount it rather than to
   * debug anything.
   */
  async probe(): Promise<DriveProbe> {
    const account: DriveAccountDto = {id: this.#root, name: this.#label, email: null};
    let mounted = false;
    try {
      mounted = (await stat(this.#root)).isDirectory();
    } catch {
      mounted = false;
    }
    if (!mounted)
      return {
        state: "logged-out",
        accounts: [account],
        usage: null,
        root: this.#root,
        error: null,
      };

    try {
      const info = await statfs(this.#root);
      const total = info.blocks * info.bsize;
      return {
        state: "connected",
        accounts: [account],
        // The server's free space, which is what decides whether a file can be
        // written — the local disk's has nothing to do with it.
        usage: {used: total - info.bfree * info.bsize, total},
        root: this.#root,
        error: null,
      };
    } catch (cause) {
      // Mounted but unreadable: stale handle, permissions, a server that went
      // away mid-session. That is a fault rather than an absence.
      return {
        state: "error",
        accounts: [account],
        usage: null,
        root: this.#root,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  /** Refuses every operation while the share is not mounted, so nothing is
   * ever written to the bare mount point on the local disk. */
  async #mounted(): Promise<void> {
    try {
      if ((await stat(this.#root)).isDirectory()) return;
    } catch {
      // Falls through to the throw below.
    }
    throw new Error(
      `${this.#label} is not connected. Mount the share and try again.`,
    );
  }

  async list(target: string): Promise<DriveEntryDto[]> {
    await this.#mounted();
    return this.#inner.list(target);
  }

  async describe(target: string): Promise<DriveEntryDto> {
    await this.#mounted();
    return this.#inner.describe(target);
  }

  async createFolder(parentPath: string, name: string): Promise<DriveEntryDto> {
    await this.#mounted();
    return this.#inner.createFolder(parentPath, name);
  }

  async upload(parentPath: string, localPath: string): Promise<DriveEntryDto> {
    await this.#mounted();
    return this.#inner.upload(parentPath, localPath);
  }

  async download(target: string, destination: string): Promise<void> {
    await this.#mounted();
    await this.#inner.download(target, destination);
  }

  async remove(target: string): Promise<void> {
    await this.#mounted();
    await this.#inner.remove(target);
  }

  async rename(target: string, name: string): Promise<DriveEntryDto> {
    await this.#mounted();
    return this.#inner.rename(target, name);
  }

  async move(target: string, destinationFolder: string): Promise<DriveEntryDto> {
    await this.#mounted();
    return this.#inner.move(target, destinationFolder);
  }

  async copy(target: string): Promise<DriveEntryDto> {
    await this.#mounted();
    return this.#inner.copy(target);
  }
}
