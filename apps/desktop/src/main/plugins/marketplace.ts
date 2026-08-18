import { createWriteStream } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * A marketplace is a git repository with `.claude-plugin/marketplace.json` at
 * its root — there is no central index to query, which is why one is *added*
 * by repository rather than searched for. FlareAI ships with Anthropic's own
 * added already, so the tab is not empty on first open.
 */
export const BUILTIN_MARKETPLACE_SOURCE = "anthropics/claude-code";

export interface MarketplaceRef {
  owner: string;
  repo: string;
}

/** Accepts `owner/repo` and github.com URLs, the two shapes people paste. */
export function parseMarketplaceSource(spec: string): MarketplaceRef {
  const text = spec.trim().replace(/\/+$/, "");
  if (!text) throw new Error("Enter a marketplace like anthropics/claude-code");
  const fromUrl = text.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+)/i);
  const [owner, repo] = fromUrl
    ? [fromUrl[1]!, fromUrl[2]!]
    : (() => {
        const parts = text.split("/");
        if (parts.length !== 2) throw new Error("Enter a marketplace like owner/repo");
        return [parts[0]!, parts[1]!] as const;
      })();
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo))
    throw new Error("Enter a marketplace like owner/repo");
  return { owner, repo: repo.replace(/\.git$/i, "") };
}

/** The id a source is filed under: the repository name, which is what the
 * plugin ids the user sees are prefixed with. */
export function marketplaceId(reference: MarketplaceRef): string {
  return reference.repo.toLowerCase();
}

export interface CatalogEntry {
  name: string;
  description: string;
  version?: string;
  author?: string;
  homepage?: string;
  /** Where the plugin's own files are, resolved at install time. */
  source: PluginSource;
}
/** A path inside the marketplace repository, or another repository entirely. */
export type PluginSource =
  | { kind: "path"; path: string }
  | { kind: "github"; owner: string; repo: string; path?: string };

export interface Catalog {
  name: string;
  plugins: CatalogEntry[];
}

/**
 * Reads a marketplace's catalog. The file is fetched raw rather than by
 * cloning the repository: a catalog is read every time the tab opens, and
 * pulling a whole repository to list names would make browsing cost what
 * installing does.
 */
export async function fetchCatalog(reference: MarketplaceRef): Promise<Catalog> {
  // `HEAD` follows whatever the repository calls its default branch, so this
  // works for `main` and `master` without asking which one it is.
  const url = `https://raw.githubusercontent.com/${reference.owner}/${reference.repo}/HEAD/.claude-plugin/marketplace.json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (response.status === 404)
    throw new Error(
      `${reference.owner}/${reference.repo} has no .claude-plugin/marketplace.json — it is not a plugin marketplace`,
    );
  if (!response.ok)
    throw new Error(`GitHub returned ${response.status} for ${reference.owner}/${reference.repo}`);
  return parseCatalog(await response.text(), reference);
}

export function parseCatalog(source: string, reference: MarketplaceRef): Catalog {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`${reference.owner}/${reference.repo} has an unreadable marketplace.json`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${reference.owner}/${reference.repo} has an unreadable marketplace.json`);
  const root = value as Record<string, unknown>;
  const name = typeof root.name === "string" && root.name.trim() ? root.name.trim() : reference.repo;
  const rows = Array.isArray(root.plugins) ? root.plugins : [];
  const seen = new Set<string>();
  const plugins: CatalogEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const entry = row as Record<string, unknown>;
    if (typeof entry.name !== "string" || !entry.name.trim()) continue;
    const pluginName = entry.name.trim();
    if (seen.has(pluginName)) continue;
    const source = pluginSource(entry.source, pluginName);
    // A source shape we cannot resolve would install nothing, so the entry is
    // left out of the catalog rather than listed and then failing on click.
    if (!source) continue;
    seen.add(pluginName);
    plugins.push({
      name: pluginName,
      description: typeof entry.description === "string" ? entry.description.trim() : "",
      version: typeof entry.version === "string" ? entry.version : undefined,
      author: personName(entry.author),
      homepage: typeof entry.homepage === "string" ? entry.homepage : undefined,
      source,
    });
  }
  return { name, plugins };
}

/**
 * `source` is either a path inside this repository or another repository. A
 * plain string is the common case and means a path; the object forms name the
 * kind. Anything else — a bare git URL to a host we cannot fetch a tarball
 * from — is unresolvable, and says so by returning undefined.
 */
function pluginSource(value: unknown, pluginName: string): PluginSource | undefined {
  if (value === undefined) return { kind: "path", path: `plugins/${pluginName}` };
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const github = trimmed.match(/^(?:https?:\/\/(?:www\.)?github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
    // "./plugins/x" is a path; "owner/repo" is a repository. The leading dot
    // is what separates them, since both are two slash-joined segments.
    if (github && !trimmed.startsWith(".") && !trimmed.startsWith("/") && trimmed.includes("github.com"))
      return { kind: "github", owner: github[1]!, repo: github[2]! };
    return { kind: "path", path: normalizeRelative(trimmed) };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const kind = typeof record.source === "string" ? record.source : "";
  if (kind === "github") {
    const repo = typeof record.repo === "string" ? record.repo : "";
    const [owner, name] = repo.split("/");
    if (!owner || !name) return undefined;
    return {
      kind: "github",
      owner,
      repo: name.replace(/\.git$/i, ""),
      path: typeof record.path === "string" ? normalizeRelative(record.path) : undefined,
    };
  }
  if (typeof record.path === "string") return { kind: "path", path: normalizeRelative(record.path) };
  return undefined;
}

/** Keeps a catalog path inside the repository it came from: a `..` segment
 * would write outside the plugin's own folder on extraction. */
function normalizeRelative(value: string): string {
  const cleaned = path.posix
    .normalize(value.replace(/\\/g, "/").replace(/^\.\//, ""))
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!cleaned || cleaned === "." || cleaned.split("/").includes("..")) return "";
  return cleaned;
}

function personName(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const name = (value as Record<string, unknown>).name;
    if (typeof name === "string") return name.trim() || undefined;
  }
  return undefined;
}

/**
 * Downloads a repository's default branch and returns the extracted root.
 * Same route the skills installer takes — a tarball rather than `git clone`,
 * so no git binary is required on the machine.
 */
export async function downloadRepository(
  reference: MarketplaceRef,
  staging: string,
): Promise<string> {
  const url = `https://codeload.github.com/${reference.owner}/${reference.repo}/tar.gz/HEAD`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (response.status === 404)
    throw new Error(
      `${reference.owner}/${reference.repo} was not found on GitHub (private repositories are not supported)`,
    );
  if (!response.ok || !response.body)
    throw new Error(`GitHub returned ${response.status} for ${reference.owner}/${reference.repo}`);
  const archive = path.join(staging, "package.tar.gz");
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    createWriteStream(archive),
  );
  const extracted = path.join(staging, "extracted");
  await mkdir(extracted, { recursive: true });
  await run("tar", ["-xzf", archive, "-C", extracted], { timeout: 120_000 });
  const [root] = await readdir(extracted);
  if (!root) throw new Error("The downloaded package was empty");
  return path.join(extracted, root);
}

/** Reads a catalog out of an already-extracted repository, which is how an
 * install re-reads the marketplace it is installing from. */
export async function readCatalogFrom(root: string, reference: MarketplaceRef): Promise<Catalog> {
  const file = path.join(root, ".claude-plugin", "marketplace.json");
  const source = await readFile(file, "utf8").catch(() => "");
  if (!source)
    throw new Error(`${reference.owner}/${reference.repo} has no .claude-plugin/marketplace.json`);
  return parseCatalog(source, reference);
}
