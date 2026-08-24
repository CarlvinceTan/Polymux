import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type {
  MarketplacePluginDto,
  PluginDto,
  PluginMarketplaceDto,
} from "@polymux/protocol";
import {
  BUILTIN_MARKETPLACE_SOURCE,
  downloadRepository,
  fetchCatalog,
  marketplaceId,
  parseMarketplaceSource,
  readCatalogFrom,
  type Catalog,
  type CatalogEntry,
  type MarketplaceRef,
} from "./marketplace.js";
import { readContributions, readManifest, pluginSkillDirectory, pluginMcpServers } from "./manifest.js";
import { polymuxHome } from "../system/paths.js";

/** Where a plugin uploaded from this machine is filed. It has no repository,
 * so it is never fetched, never listed in Browse, and cannot be removed on its
 * own — removing its last plugin is what empties it. */
export const LOCAL_MARKETPLACE = "local";

/** One marketplace the user has added, as recorded on disk. */
interface StoredMarketplace {
  id: string;
  source: string;
  name: string;
}
/** One installed plugin. The folder is derived, not stored: a recorded path
 * would go stale the moment the home directory moves. */
interface StoredPlugin {
  id: string;
  marketplace: string;
  name: string;
  version?: string;
}
interface StoredState {
  marketplaces: StoredMarketplace[];
  plugins: StoredPlugin[];
}

/**
 * What one enabled plugin contributes to a run, resolved for the backend to
 * feed into the agent. Kept separate from the DTO because these are absolute
 * paths and live server configs rather than something to put on screen.
 */
export interface PluginRuntime {
  pluginId: string;
  skillDirectory?: string;
  mcpServers: ReturnType<typeof pluginMcpServers>;
}

/**
 * The plugins on this machine: which marketplaces were added, which plugins
 * were installed from them, and what each one contributes.
 *
 * Plugins live in `~/.polymux/plugins/<marketplace>/<plugin>` and the state
 * file sits beside them, in the same `~/.polymux` the skills and MCP servers
 * use — a plugin is a folder the user can open, not a database row.
 */
export class PluginRegistry {
  readonly #root: string;
  readonly #stateFile: string;
  #state: StoredState = { marketplaces: [], plugins: [] };
  /** Catalogs are re-read per browse, not per keystroke: a marketplace is a
   * file on GitHub, and refetching it for every character typed would rate
   * limit the user out of their own search. */
  readonly #catalogs = new Map<string, { catalog: Catalog; readAt: number }>();

  constructor(home = homedir()) {
    this.#root = path.join(polymuxHome(home), "plugins");
    this.#stateFile = path.join(polymuxHome(home), "plugins.json");
  }

  /** Reads the state file, seeding the built-in marketplace on first run. */
  async load(): Promise<void> {
    const source = await readFile(this.#stateFile, "utf8").catch(() => "");
    this.#state = parseState(source);
    if (!this.#state.marketplaces.length) {
      const reference = parseMarketplaceSource(BUILTIN_MARKETPLACE_SOURCE);
      this.#state.marketplaces.push({
        id: marketplaceId(reference),
        source: BUILTIN_MARKETPLACE_SOURCE,
        name: reference.repo,
      });
      await this.#save();
    }
  }

  directoryOf(plugin: StoredPlugin): string {
    return path.join(this.#root, plugin.marketplace, plugin.name);
  }

  /**
   * Every installed plugin, with what it contributes and anything of that name
   * the user already has standalone. `existing` is what to check against — the
   * Skills tab's own list and the MCP configuration — passed in rather than
   * read here, so the registry stays free of the backend's state.
   */
  list(existing: {
    skills: Map<string, string>;
    mcpServers: Map<string, string>;
    isEnabled: (id: string) => boolean;
  }): PluginDto[] {
    const marketplaces = new Map(this.#state.marketplaces.map((entry) => [entry.id, entry]));
    return this.#state.plugins
      .map((plugin): PluginDto => {
        const directory = this.directoryOf(plugin);
        const marketplace = marketplaces.get(plugin.marketplace);
        const base = {
          id: plugin.id,
          name: plugin.name,
          marketplace: plugin.marketplace,
          marketplaceName: marketplace?.name ?? plugin.marketplace,
          directory: displayPath(directory),
          enabled: existing.isEnabled(plugin.id),
        };
        if (!existsSync(directory))
          return {
            ...base,
            description: "",
            version: plugin.version,
            contributions: { skills: [], mcpServers: [], commands: 0, agents: 0, hooks: 0 },
            conflicts: [],
            error: "This plugin's files are missing; remove it and install it again",
          };
        try {
          const manifest = readManifest(directory);
          const contributions = readContributions(directory);
          const conflicts = [
            ...contributions.skills.flatMap((name) => {
              const source = existing.skills.get(name);
              return source ? [{ kind: "skill" as const, name, existingSource: source }] : [];
            }),
            ...contributions.mcpServers.flatMap((name) => {
              const source = existing.mcpServers.get(name);
              return source ? [{ kind: "mcp" as const, name, existingSource: source }] : [];
            }),
          ];
          return {
            ...base,
            description: manifest.description,
            version: manifest.version ?? plugin.version,
            author: manifest.author,
            homepage: manifest.homepage,
            contributions,
            conflicts,
          };
        } catch (error) {
          return {
            ...base,
            description: "",
            version: plugin.version,
            contributions: { skills: [], mcpServers: [], commands: 0, agents: 0, hooks: 0 },
            conflicts: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The skill directories and MCP servers of every enabled plugin. Disabled
   * plugins contribute nothing — switching one off has to actually stop its
   * servers, not merely grey out a row.
   */
  runtime(isEnabled: (id: string) => boolean): PluginRuntime[] {
    const runtimes: PluginRuntime[] = [];
    for (const plugin of this.#state.plugins) {
      if (!isEnabled(plugin.id)) continue;
      const directory = this.directoryOf(plugin);
      if (!existsSync(directory)) continue;
      runtimes.push({
        pluginId: plugin.id,
        skillDirectory: pluginSkillDirectory(directory),
        mcpServers: pluginMcpServers(directory),
      });
    }
    return runtimes;
  }

  /** The marketplaces there is something to browse in. The local one holds
   * uploads and has nothing to fetch, so it is not one of them. */
  marketplaces(): PluginMarketplaceDto[] {
    return this.#state.marketplaces.filter((entry) => entry.id !== LOCAL_MARKETPLACE).map((entry) => {
      const cached = this.#catalogs.get(entry.id);
      return {
        id: entry.id,
        name: cached?.catalog.name ?? entry.name,
        source: entry.source,
        pluginCount: cached?.catalog.plugins.length ?? 0,
        builtin: entry.source === BUILTIN_MARKETPLACE_SOURCE,
      };
    });
  }

  async addMarketplace(spec: string): Promise<void> {
    const reference = parseMarketplaceSource(spec);
    const id = marketplaceId(reference);
    if (this.#state.marketplaces.some((entry) => entry.id === id))
      throw new Error(`${reference.owner}/${reference.repo} has already been added`);
    // Fetched before it is recorded, so a repository that is not a marketplace
    // fails at the moment the user asks rather than the next time they browse.
    const catalog = await fetchCatalog(reference);
    this.#catalogs.set(id, { catalog, readAt: Date.now() });
    this.#state.marketplaces.push({
      id,
      source: `${reference.owner}/${reference.repo}`,
      name: catalog.name,
    });
    await this.#save();
  }

  async removeMarketplace(id: string): Promise<void> {
    const found = this.#state.marketplaces.find((entry) => entry.id === id);
    if (!found || found.id === LOCAL_MARKETPLACE) throw new Error("That marketplace is not added");
    if (found.source === BUILTIN_MARKETPLACE_SOURCE)
      throw new Error("The built-in marketplace cannot be removed");
    if (this.#state.plugins.some((plugin) => plugin.marketplace === id))
      throw new Error("Remove this marketplace's plugins before removing it");
    this.#state.marketplaces = this.#state.marketplaces.filter((entry) => entry.id !== id);
    this.#catalogs.delete(id);
    await this.#save();
  }

  /** Every added marketplace's catalog, narrowed by `query`. A marketplace
   * that cannot be reached contributes its error rather than failing the
   * whole list: one unreachable repository should not empty the tab. */
  async browse(query: string): Promise<{ plugins: MarketplacePluginDto[]; errors: Record<string, string> }> {
    const text = query.trim().toLowerCase();
    const installed = new Set(this.#state.plugins.map((plugin) => plugin.id));
    const plugins: MarketplacePluginDto[] = [];
    const errors: Record<string, string> = {};
    for (const entry of this.#state.marketplaces) {
      if (entry.id === LOCAL_MARKETPLACE) continue;
      let catalog: Catalog;
      try {
        catalog = await this.#catalog(entry);
      } catch (error) {
        errors[entry.id] = error instanceof Error ? error.message : String(error);
        continue;
      }
      for (const plugin of catalog.plugins) {
        const id = `${entry.id}/${plugin.name}`;
        if (text && !`${plugin.name} ${plugin.description}`.toLowerCase().includes(text)) continue;
        plugins.push({
          id,
          name: plugin.name,
          description: plugin.description,
          version: plugin.version,
          author: plugin.author,
          homepage: plugin.homepage,
          installed: installed.has(id),
        });
      }
    }
    plugins.sort((a, b) => a.name.localeCompare(b.name));
    return { plugins, errors };
  }

  /**
   * Installs `<marketplace>/<plugin>`. The repository is downloaded to a
   * staging directory and the plugin's own folder moved into place only once
   * it reads as a plugin, so a failed install leaves nothing half-written.
   */
  async install(id: string): Promise<void> {
    if (this.#state.plugins.some((plugin) => plugin.id === id))
      throw new Error("That plugin is already installed");
    const separator = id.indexOf("/");
    const marketplace = separator < 0 ? "" : id.slice(0, separator);
    const name = separator < 0 ? "" : id.slice(separator + 1);
    const entry = this.#state.marketplaces.find((item) => item.id === marketplace);
    if (!entry || !name) throw new Error(`${id} is not a plugin in an added marketplace`);
    const reference = parseMarketplaceSource(entry.source);
    const staging = await mkdtemp(path.join(tmpdir(), "polymux-plugin-install-"));
    try {
      const root = await downloadRepository(reference, staging);
      const catalog = await readCatalogFrom(root, reference);
      const plugin = catalog.plugins.find((item) => item.name === name);
      if (!plugin) throw new Error(`${name} is no longer listed in ${entry.source}`);
      const folder = await this.#stagePluginFolder(plugin, root, staging, reference);
      const destination = path.join(this.#root, marketplace, name);
      if (existsSync(destination)) throw new Error(`${name} is already installed`);
      const manifest = readManifest(folder);
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(folder, destination);
      this.#state.plugins.push({
        id,
        marketplace,
        name,
        version: manifest.version ?? plugin.version,
      });
      await this.#save();
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  /**
   * Files a folder from this machine under the local marketplace. A plugin
   * that came off a disk has no repository to name, and inventing one would
   * put a row in Browse that cannot be installed again.
   */
  async installLocal(source: string, name: string): Promise<string> {
    if (!name || name.includes("..") || name.includes("/") || name.includes(path.sep))
      throw new Error("That plugin's name cannot be used as a folder");
    this.#ensureLocalMarketplace();
    const id = `${LOCAL_MARKETPLACE}/${name}`;
    if (this.#state.plugins.some((plugin) => plugin.id === id))
      throw new Error(`A plugin named ${name} is already installed`);
    const destination = path.join(this.#root, LOCAL_MARKETPLACE, name);
    if (existsSync(destination)) throw new Error(`A plugin named ${name} is already installed`);
    const manifest = readManifest(source);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(source, destination);
    this.#state.plugins.push({ id, marketplace: LOCAL_MARKETPLACE, name, version: manifest.version });
    await this.#save();
    return id;
  }

  /** Added on the first upload rather than at startup, so a user who never
   * uploads one never sees an empty marketplace in the list. */
  #ensureLocalMarketplace(): void {
    if (this.#state.marketplaces.some((entry) => entry.id === LOCAL_MARKETPLACE)) return;
    this.#state.marketplaces.push({ id: LOCAL_MARKETPLACE, source: "", name: LOCAL_MARKETPLACE });
  }

  async remove(id: string): Promise<void> {
    const found = this.#state.plugins.find((plugin) => plugin.id === id);
    if (!found) throw new Error("That plugin is not installed");
    await rm(this.directoryOf(found), { recursive: true, force: true });
    this.#state.plugins = this.#state.plugins.filter((plugin) => plugin.id !== id);
    // The local marketplace exists only to hold uploads, so the last one
    // leaving takes it with them rather than leaving an empty heading.
    if (!this.#state.plugins.some((plugin) => plugin.marketplace === LOCAL_MARKETPLACE))
      this.#state.marketplaces = this.#state.marketplaces.filter((entry) => entry.id !== LOCAL_MARKETPLACE);
    await this.#save();
  }

  has(id: string): boolean {
    return this.#state.plugins.some((plugin) => plugin.id === id);
  }

  /** Resolves a catalog entry's `source` to a folder inside `staging`. A path
   * entry is already in the downloaded repository; a github entry is a second
   * download. */
  async #stagePluginFolder(
    plugin: CatalogEntry,
    root: string,
    staging: string,
    reference: MarketplaceRef,
  ): Promise<string> {
    if (plugin.source.kind === "path") {
      if (!plugin.source.path)
        throw new Error(`${plugin.name} points outside ${reference.owner}/${reference.repo}`);
      const folder = path.join(root, plugin.source.path);
      if (!existsSync(folder))
        throw new Error(`${plugin.name} is missing from ${reference.owner}/${reference.repo}`);
      return folder;
    }
    const nested = await mkdtemp(path.join(staging, "source-"));
    const downloaded = await downloadRepository(
      { owner: plugin.source.owner, repo: plugin.source.repo },
      nested,
    );
    const folder = plugin.source.path ? path.join(downloaded, plugin.source.path) : downloaded;
    if (!existsSync(folder))
      throw new Error(`${plugin.name} is missing from ${plugin.source.owner}/${plugin.source.repo}`);
    return folder;
  }

  async #catalog(entry: StoredMarketplace): Promise<Catalog> {
    const cached = this.#catalogs.get(entry.id);
    if (cached && Date.now() - cached.readAt < 5 * 60_000) return cached.catalog;
    const catalog = await fetchCatalog(parseMarketplaceSource(entry.source));
    this.#catalogs.set(entry.id, { catalog, readAt: Date.now() });
    // A marketplace seeded before it was ever read is filed under its
    // repository name; this is the first moment it can be called what it
    // calls itself, so the stored name catches up.
    if (entry.name !== catalog.name) {
      entry.name = catalog.name;
      await this.#save();
    }
    return catalog;
  }

  async #save(): Promise<void> {
    await mkdir(path.dirname(this.#stateFile), { recursive: true });
    const temporary = `${this.#stateFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, "utf8");
    await rename(temporary, this.#stateFile);
  }
}

export function parseState(source: string): StoredState {
  if (!source.trim()) return { marketplaces: [], plugins: [] };
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { marketplaces: [], plugins: [] };
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { marketplaces: [], plugins: [] };
  const root = value as Record<string, unknown>;
  const marketplaces = (Array.isArray(root.marketplaces) ? root.marketplaces : []).flatMap(
    (row): StoredMarketplace[] => {
      if (!row || typeof row !== "object") return [];
      const entry = row as Record<string, unknown>;
      if (typeof entry.id !== "string" || typeof entry.source !== "string") return [];
      return [{
        id: entry.id,
        source: entry.source,
        name: typeof entry.name === "string" ? entry.name : entry.id,
      }];
    },
  );
  const known = new Set(marketplaces.map((entry) => entry.id));
  const plugins = (Array.isArray(root.plugins) ? root.plugins : []).flatMap(
    (row): StoredPlugin[] => {
      if (!row || typeof row !== "object") return [];
      const entry = row as Record<string, unknown>;
      if (typeof entry.id !== "string" || typeof entry.marketplace !== "string") return [];
      // A plugin whose marketplace was removed has nowhere to be listed under,
      // and no folder we would know how to find. Dropping it here is what
      // makes removing a marketplace a complete operation.
      if (!known.has(entry.marketplace)) return [];
      const name = typeof entry.name === "string" ? entry.name : entry.id.split("/").slice(1).join("/");
      if (!name || name.includes("..") || name.includes(path.sep)) return [];
      return [{
        id: entry.id,
        marketplace: entry.marketplace,
        name,
        version: typeof entry.version === "string" ? entry.version : undefined,
      }];
    },
  );
  return { marketplaces, plugins };
}

function displayPath(absolute: string, home = homedir()): string {
  return absolute.startsWith(`${home}${path.sep}`)
    ? `~${path.sep}${absolute.slice(home.length + 1)}`
    : absolute;
}
