import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Where the mirrored copy lives, next to the personal skills it shadows. */
export function officialSkillsHome(home = homedir()): string {
  return path.join(home, ".flareai", "official-skills");
}

const MANIFEST = ".installed.json";

/**
 * Mirrors the skills bundled inside the app into `~/.flareai/official-skills`
 * and returns that directory, so every skill FlareAI loads sits under the
 * user's own `~/.flareai` where it can be read, diffed, and pointed at by the
 * scripts the skills themselves run — rather than inside an app bundle that is
 * replaced wholesale on update.
 *
 * The mirror is app-owned: an update rewrites it, and `ProtectedSkillGuard`
 * keeps the agent's file tools out of it. Personal skills belong in
 * `~/.flareai/skills`; a built-in skill of the same name stays authoritative
 * in the loader, so saving one under a built-in's name is refused rather than
 * silently ignored.
 */
export function installOfficialSkills(source: string, home = homedir()): string {
  const target = officialSkillsHome(home);
  if (!existsSync(source)) return target;
  const digest = treeDigest(source);
  if (readManifest(target) === digest) return target;
  // Staged next to the target and swapped in: a crash or a quit mid-copy
  // leaves the previous mirror whole rather than a half-written skill set.
  const staging = `${target}.installing`;
  rmSync(staging, {recursive: true, force: true});
  mkdirSync(path.dirname(target), {recursive: true});
  cpSync(source, staging, {recursive: true});
  writeFileSync(path.join(staging, MANIFEST), `${JSON.stringify({digest})}\n`);
  const retired = `${target}.retiring`;
  rmSync(retired, {recursive: true, force: true});
  if (existsSync(target)) renameSync(target, retired);
  renameSync(staging, target);
  rmSync(retired, {recursive: true, force: true});
  return target;
}

function readManifest(target: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(target, MANIFEST), "utf8"));
    const digest = (parsed as {digest?: unknown} | null)?.digest;
    return typeof digest === "string" ? digest : null;
  } catch {
    return null;
  }
}

/**
 * Content and mode of every file, in a stable order. Mode matters: the skills
 * ship shell and Python entry points that stop working if the copy loses its
 * executable bit, so a mirror that differs only in mode has to be rewritten.
 */
function treeDigest(directory: string): string {
  const hash = createHash("sha256");
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, {withFileTypes: true}).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const absolute = path.join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        hash.update(`d ${relative}\n`);
        walk(absolute, relative);
      } else if (entry.isFile()) {
        hash.update(`f ${relative} ${statSync(absolute).mode & 0o777}\n`);
        hash.update(readFileSync(absolute));
      }
    }
  };
  walk(directory, "");
  return hash.digest("hex");
}
