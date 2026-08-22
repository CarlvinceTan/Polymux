import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import type {DriveEntryDto, DriveProviderId} from "@flareai/protocol";
import type {DriveAdapter, DriveProbe, DriveWriteOptions} from "./types.js";

/**
 * One place a file can be, from the virtual drive's point of view.
 */
export interface VirtualSource {
  id: string;
  provider: DriveProviderId;
  adapter: DriveAdapter;
}

/**
 * The drive as one drive.
 *
 * Every provider already keeps FlareAI's files in a folder of its own — Drive
 * makes `FlareAI`, Dropbox and OneDrive use their app folders, S3 takes a
 * prefix. This stacks those folders into a single listing so the user has one
 * place to look instead of a switcher to remember, and a new file simply goes
 * wherever the save order says.
 *
 * There is deliberately **no index**. A stored map of path to provider is
 * faster to list and wrong the moment a file is added from Drive's own web
 * page or from another machine, and reconciling it is a whole class of bug
 * that a local-first app does not need to own. Instead every listing asks the
 * providers themselves, in parallel, and each row carries the provider that
 * answered — so what is on screen is what is really there.
 *
 * A virtual path is `<sourceId>/<path within that source>`. Source ids never
 * contain a slash, so splitting on the first one always recovers both halves,
 * including for local paths that begin with a slash of their own.
 */
export class VirtualDrive implements DriveAdapter {
  readonly id = "all" as const;
  readonly #sources: () => VirtualSource[];
  readonly #preferred: () => Promise<string>;

  constructor(sources: () => VirtualSource[], preferred: () => Promise<string>) {
    this.#sources = sources;
    this.#preferred = preferred;
  }

  /** Always reachable: it is a view, so it cannot be logged out of. Usage is
   * what the connected providers add up to, ignoring the ones with nothing to
   * report rather than counting them as zero. */
  async probe(): Promise<DriveProbe> {
    const probes = await Promise.all(
      this.#sources().map((source) =>
        source.adapter.probe().catch((): DriveProbe | null => null),
      ),
    );
    const usable = probes.filter(
      (probe): probe is DriveProbe => probe?.state === "connected",
    );
    const sum = (pick: (probe: DriveProbe) => number | null): number | null => {
      const known = usable.map(pick).filter((value): value is number => value !== null);
      return known.length ? known.reduce((total, value) => total + value, 0) : null;
    };
    return {
      state: "connected",
      accounts: [],
      usage: {
        used: sum((probe) => probe.usage?.used ?? null),
        total: sum((probe) => probe.usage?.total ?? null),
        appUsed: sum((probe) => probe.usage?.appUsed ?? null),
      },
      root: null,
      error: null,
    };
  }

  /**
   * The root is every source's root at once; anything deeper belongs to the
   * one source that answered for it.
   *
   * Two providers holding a file of the same name give two rows rather than
   * one: they are two files, and quietly showing one of them would be the
   * drive lying about what the user has.
   */
  async list(target: string): Promise<DriveEntryDto[]> {
    if (target) {
      const {source, inner} = this.#resolve(target);
      const entries = await source.adapter.list(inner);
      return entries.map((entry) => this.#lift(source, entry));
    }

    // Parallel, because one slow provider must not decide how long the whole
    // drive takes to open — and one that is failing must not empty it either.
    const listed = await Promise.all(
      this.#sources().map(async (source) =>
        source.adapter
          .list("")
          .then((entries) => entries.map((entry) => this.#lift(source, entry)))
          .catch((): DriveEntryDto[] => []),
      ),
    );
    return listed.flat();
  }

  async describe(target: string): Promise<DriveEntryDto> {
    const {source, inner} = this.#resolve(target);
    const described = await source.adapter.describe?.(inner);
    return described
      ? this.#lift(source, described)
      : {
          id: target,
          name: path.basename(inner) || inner,
          kind: "file",
          size: null,
          modifiedAt: null,
          provider: source.provider,
          path: target,
          mimeType: null,
        };
  }

  async createFolder(parentPath: string, name: string): Promise<DriveEntryDto> {
    const {source, inner} = await this.#target(parentPath);
    return this.#lift(source, await source.adapter.createFolder(inner, name));
  }

  async upload(parentPath: string, localPath: string): Promise<DriveEntryDto> {
    const {source, inner} = await this.#target(parentPath);
    return this.#lift(source, await source.adapter.upload(inner, localPath));
  }

  async download(target: string, destination: string): Promise<void> {
    const {source, inner} = this.#resolve(target);
    await source.adapter.download(inner, destination);
  }

  async remove(target: string): Promise<void> {
    const {source, inner} = this.#resolve(target);
    await source.adapter.remove(inner);
  }

  async rename(target: string, name: string): Promise<DriveEntryDto> {
    const {source, inner} = this.#resolve(target);
    return this.#lift(source, await source.adapter.rename(inner, name));
  }

  async copy(target: string): Promise<DriveEntryDto> {
    const {source, inner} = this.#resolve(target);
    return this.#lift(source, await source.adapter.copy(inner));
  }

  /**
   * Moving inside one provider is that provider's job. Moving between two is
   * the drive's: there is no path from one company's servers to another's, so
   * the bytes come through this Mac and the original is only dropped once the
   * copy has arrived.
   */
  async move(target: string, destinationFolder: string, options?: DriveWriteOptions): Promise<DriveEntryDto> {
    const from = this.#resolve(target);
    const to = this.#resolve(destinationFolder);
    if (from.source.id === to.source.id)
      return this.#lift(
        from.source,
        await from.source.adapter.move(from.inner, to.inner),
      );

    return this.#lift(
      to.source,
      await this.#transfer(from.source, from.inner, to.source, to.inner, options),
    );
  }

  /** Copies one tree across providers and removes the source only after the
   * complete destination subtree exists. */
  async #transfer(
    from: VirtualSource,
    fromPath: string,
    to: VirtualSource,
    toFolder: string,
    options?: DriveWriteOptions,
  ): Promise<DriveEntryDto> {
    const described = await from.adapter.describe?.(fromPath);
    const named = described ?? {
      id: fromPath,
      name: path.basename(fromPath) || fromPath,
      kind: "file" as const,
      size: null,
      modifiedAt: null,
      provider: from.provider,
      path: fromPath,
      mimeType: null,
    };
    if (named.kind === "folder") {
      const created = await to.adapter.createFolder(toFolder, named.name);
      const children = await from.adapter.list(fromPath);
      for (const child of children)
        await this.#transfer(from, child.path, to, created.path, options);
      await from.adapter.remove(fromPath);
      return created;
    }

    const scratch = await mkdtemp(path.join(tmpdir(), "flareai-drive-move-"));
    try {
      const staged = path.join(scratch, named.name || "file");
      await from.adapter.download(fromPath, staged);
      const uploaded = await to.adapter.upload(toFolder, staged, options);
      // Only now: a delete before the upload lands is how a move loses a file.
      await from.adapter.remove(fromPath);
      return uploaded;
    } finally {
      await rm(scratch, {recursive: true, force: true});
    }
  }

  /** Where a new file goes when the caller named the virtual root: whatever
   * the save order prefers. Inside a folder, it goes where that folder is. */
  async #target(parentPath: string): Promise<{source: VirtualSource; inner: string}> {
    if (parentPath) return this.#resolve(parentPath);
    const preferred = await this.#preferred();
    const source =
      this.#sources().find((entry) => entry.id === preferred) ?? this.#sources()[0];
    if (!source) throw new Error("No storage is connected yet.");
    return {source, inner: ""};
  }

  #resolve(target: string): {source: VirtualSource; inner: string} {
    const slash = target.indexOf("/");
    const id = slash < 0 ? target : target.slice(0, slash);
    const inner = slash < 0 ? "" : target.slice(slash + 1);
    const source = this.#sources().find((entry) => entry.id === id);
    if (!source)
      throw new Error(`${target} is not in any connected storage.`);
    return {source, inner};
  }

  /** An entry as the virtual drive sees it: the provider that holds it is kept
   * so the row can say so, and the path is rewritten so it round-trips. */
  #lift(source: VirtualSource, entry: DriveEntryDto): DriveEntryDto {
    return {
      ...entry,
      // The source is the authority on which provider holds this, not the
      // adapter's own idea of itself: the badge beside the name has to match
      // the account the row actually came from.
      provider: source.provider,
      path: `${source.id}/${entry.path}`,
      id: `${source.id}/${entry.id}`,
    };
  }
}
