import { execFile } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { SkillLoader } from "@midas/agent";

const run = promisify(execFile);

export interface SkillPackageRef {
  owner: string;
  repo: string;
  /** Optional path or skill name narrowing a multi-skill repository. */
  subpath?: string;
}

/**
 * Accepts the shapes people copy from the skills.sh ecosystem, which uses
 * GitHub as its registry: `owner/repo`, `owner/repo/skill`, skills.sh pages,
 * and github.com URLs (including /tree/<branch>/<path> deep links).
 */
export function parseSkillPackage(spec: string): SkillPackageRef {
  const text = spec.trim().replace(/\/+$/, "");
  if (!text) throw new Error("Enter a skill package like vercel-labs/skills/find-skills");
  const fromUrl = text.match(
    /^https?:\/\/(?:www\.)?(skills\.sh|github\.com)\/([^/]+)\/([^/]+)(?:\/(.+))?$/i,
  );
  const [owner, repo, rest] = fromUrl
    ? [fromUrl[2]!, fromUrl[3]!, fromUrl[4]]
    : (() => {
        const parts = text.split("/");
        if (parts.length < 2) throw new Error("Enter a skill package like owner/repo or owner/repo/skill");
        return [parts[0]!, parts[1]!, parts.slice(2).join("/") || undefined] as const;
      })();
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo))
    throw new Error("Enter a skill package like owner/repo or owner/repo/skill");
  // GitHub deep links carry /tree/<branch>/ or /blob/<branch>/ before the path.
  const subpath = rest?.replace(/^(?:tree|blob)\/[^/]+\/?/, "").replace(/\/SKILL\.md$/i, "") || undefined;
  return { owner, repo, subpath };
}

export interface InstalledSkillSummary {
  name: string;
  directory: string;
}

/**
 * Downloads a skill package from GitHub — the registry behind skills.sh —
 * and installs every matching skill folder into `destinationDirectory`.
 * Mirrors what `npx skills add` does, but lands the result where Midas keeps
 * its custom skills.
 */
export async function installSkillPackage(
  spec: string,
  destinationDirectory: string,
): Promise<InstalledSkillSummary[]> {
  const reference = parseSkillPackage(spec);
  const staging = await mkdtemp(path.join(tmpdir(), "midas-skill-install-"));
  try {
    const extracted = await downloadRepository(reference, staging);
    const candidates = await findSkillDirectories(extracted, reference.subpath);
    if (!candidates.length)
      throw new Error(
        reference.subpath
          ? `No skill named or located at "${reference.subpath}" was found in ${reference.owner}/${reference.repo}`
          : `No SKILL.md files were found in ${reference.owner}/${reference.repo}`,
      );
    if (candidates.length > 12)
      throw new Error(
        `${reference.owner}/${reference.repo} contains ${candidates.length} skills; add the skill name, e.g. ${reference.owner}/${reference.repo}/<skill>`,
      );
    const installed: InstalledSkillSummary[] = [];
    for (const candidate of candidates) {
      const loaded = new SkillLoader({ configured: [candidate] }).load();
      const skill = loaded.skills.find((item) => item.filePath === path.join(candidate, "SKILL.md"));
      if (!skill) {
        const problem = loaded.diagnostics.find((item) => item.severity === "error");
        throw new Error(problem ? `${path.basename(candidate)}: ${problem.message}` : `${path.basename(candidate)} has an invalid SKILL.md`);
      }
      const destination = path.join(destinationDirectory, skill.name);
      if (existsSync(destination)) throw new Error(`A skill named ${skill.name} already exists`);
      installed.push({ name: skill.name, directory: destination });
    }
    await mkdir(destinationDirectory, { recursive: true });
    for (const [index, candidate] of candidates.entries())
      await rename(candidate, installed[index]!.directory);
    return installed;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function downloadRepository(reference: SkillPackageRef, staging: string): Promise<string> {
  const url = `https://codeload.github.com/${reference.owner}/${reference.repo}/tar.gz/HEAD`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (response.status === 404)
    throw new Error(`${reference.owner}/${reference.repo} was not found on GitHub (private repositories are not supported)`);
  if (!response.ok || !response.body)
    throw new Error(`GitHub returned ${response.status} for ${reference.owner}/${reference.repo}`);
  const archive = path.join(staging, "package.tar.gz");
  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(archive));
  const extracted = path.join(staging, "extracted");
  await mkdir(extracted, { recursive: true });
  await run("tar", ["-xzf", archive, "-C", extracted], { timeout: 60_000 });
  const [root] = await readdir(extracted);
  if (!root) throw new Error("The downloaded package was empty");
  return path.join(extracted, root);
}

/** Walks the extracted repository for directories holding a SKILL.md. */
async function findSkillDirectories(root: string, subpath?: string): Promise<string[]> {
  const matches: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      matches.push(directory);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      await visit(path.join(directory, entry.name), depth + 1);
    }
  };
  if (subpath) {
    const direct = path.join(root, subpath);
    const directStat = await stat(direct).catch((): null => null);
    if (directStat?.isDirectory()) {
      await visit(direct, 0);
      return matches;
    }
    // Not a repository path — treat it as a skill name anywhere in the tree.
    // The registry names skills by their SKILL.md frontmatter, which does
    // not always match the folder, so check both.
    await visit(root, 0);
    const named: string[] = [];
    for (const match of matches) {
      if (path.basename(match) === subpath) {
        named.push(match);
        continue;
      }
      const frontmatterName = await skillFrontmatterName(path.join(match, "SKILL.md"));
      if (frontmatterName === subpath) named.push(match);
    }
    return named;
  }
  await visit(root, 0);
  return matches;
}

async function skillFrontmatterName(skillFile: string): Promise<string | undefined> {
  const contents = await readFile(skillFile, "utf8").catch(() => "");
  if (!contents.startsWith("---")) return undefined;
  const end = contents.indexOf("\n---", 3);
  if (end < 0) return undefined;
  return contents
    .slice(3, end)
    .match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];
}

export interface SkillRegistryEntry {
  /** Installable package spec, e.g. "vercel-labs/skills/find-skills". */
  id: string;
  name: string;
  /** Repository the skill ships from, e.g. "vercel-labs/skills". */
  source: string;
  installs: number;
}

/** Searches the skills.sh directory — the same index `npx skills find` uses. */
export async function searchSkillRegistry(query: string): Promise<SkillRegistryEntry[]> {
  const text = query.trim();
  if (text.length < 2) return [];
  const url = `https://skills.sh/api/search?q=${encodeURIComponent(text)}&limit=15`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`skills.sh returned ${response.status}`);
  const body = (await response.json()) as { skills?: Array<Record<string, unknown>> };
  return (body.skills ?? []).flatMap((entry) => {
    const id = typeof entry.id === "string" ? entry.id : "";
    const name = typeof entry.name === "string" ? entry.name : "";
    const source = typeof entry.source === "string" ? entry.source : "";
    if (!id || !name || !source) return [];
    return [{
      id,
      name,
      source,
      installs: typeof entry.installs === "number" ? entry.installs : 0,
    }];
  });
}
