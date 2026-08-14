import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { Skill, SkillDiagnostic, SkillLoadResult } from "./types.js";

export interface SkillLocation {
  path: string;
  source: Skill["source"];
  includeRootMarkdown?: boolean;
}
export interface SkillLoaderOptions {
  home?: string;
  official?: string[];
  bundled?: string[];
  configured?: string[];
  isEnabled?: (skill: Skill) => boolean;
}

export class SkillLoader {
  readonly #locations: SkillLocation[];
  readonly #isEnabled: (skill: Skill) => boolean;
  constructor(options: SkillLoaderOptions = {}) {
    const home = options.home ?? homedir();
    this.#locations = [
      ...(options.official ?? []).map((path): SkillLocation => ({
        path,
        source: "official",
        includeRootMarkdown: true,
      })),
      // ~/.agents/skills is the cross-agent standard directory that
      // Vercel's `npx skills` CLI installs into, so packages added there
      // appear in Midas automatically. Agent-specific stores such as
      // ~/.codex/skills stay unsourced: a personal skill becomes Midas's by
      // being copied into ~/.midas/skills, which also wins name clashes so
      // in-app edits keep authority.
      {
        path: join(home, ".agents", "skills"),
        source: "agents",
        includeRootMarkdown: false,
      },
      {
        path: join(home, ".midas", "skills"),
        source: "midas",
        includeRootMarkdown: true,
      },
      ...(options.bundled ?? []).map((path): SkillLocation => ({
        path,
        source: "bundled",
        includeRootMarkdown: true,
      })),
      ...(options.configured ?? []).map((path): SkillLocation => ({
        path,
        source: "configured",
        includeRootMarkdown: true,
      })),
    ];
    this.#isEnabled = options.isEnabled ?? (() => true);
  }

  load(): SkillLoadResult {
    const byName = new Map<string, Skill>();
    const diagnostics: SkillDiagnostic[] = [];
    for (const location of this.#locations) {
      const result = loadLocation(location);
      diagnostics.push(...result.diagnostics);
      for (const skill of result.skills) {
        const existing = byName.get(skill.name);
        if (existing?.source === "official") {
          // Official skills ship with the application and stay authoritative;
          // a same-named skill in a user directory is ignored, not an override.
          diagnostics.push({
            severity: "warning",
            message: `Duplicate skill ${skill.name}; official skill wins`,
            path: skill.filePath,
          });
          continue;
        }
        if (existing)
          diagnostics.push({
            severity: "warning",
            message: `Duplicate skill ${skill.name}; later location wins`,
            path: skill.filePath,
          });
        byName.set(skill.name, skill);
      }
    }
    return { skills: [...byName.values()].filter(this.#isEnabled), diagnostics };
  }
}

function loadLocation(location: SkillLocation): SkillLoadResult {
  const skills: Skill[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  const root = resolve(location.path);
  if (!existsSync(root)) return { skills, diagnostics };
  const visit = (directory: string, rootLevel: boolean): void => {
    const skillFile = join(directory, "SKILL.md");
    if (existsSync(skillFile) && statSync(skillFile).isFile()) {
      loadFile(skillFile, location.source, skills, diagnostics);
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (
        entry.isDirectory() ||
        (entry.isSymbolicLink() && safeDirectory(path))
      )
        visit(path, false);
      else if (
        rootLevel &&
        location.includeRootMarkdown &&
        entry.isFile() &&
        entry.name.endsWith(".md")
      )
        loadFile(path, location.source, skills, diagnostics);
    }
  };
  visit(root, true);
  return { skills, diagnostics };
}

function loadFile(
  filePath: string,
  source: Skill["source"],
  skills: Skill[],
  diagnostics: SkillDiagnostic[],
): void {
  const content = readFileSync(filePath, "utf8");
  const frontmatter = parseFrontmatter(content);
  const name =
    typeof frontmatter.name === "string"
      ? frontmatter.name
      : basename(dirname(filePath));
  const description =
    typeof frontmatter.description === "string"
      ? frontmatter.description.trim()
      : "";
  for (const message of validateName(name))
    diagnostics.push({ severity: "warning", message, path: filePath });
  if (!description) {
    diagnostics.push({
      severity: "error",
      message: "description is required",
      path: filePath,
    });
    return;
  }
  if (description.length > 1024)
    diagnostics.push({
      severity: "warning",
      message: "description exceeds 1024 characters",
      path: filePath,
    });
  const manifest = skillManifest(dirname(filePath));
  skills.push({
    name,
    description,
    filePath,
    baseDir: dirname(filePath),
    source,
    disableModelInvocation: frontmatter["disable-model-invocation"] === true,
    allowedTools:
      typeof frontmatter["allowed-tools"] === "string"
        ? frontmatter["allowed-tools"].split(/\s+/).filter(Boolean)
        : undefined,
    displayName: manifest.displayName,
    author:
      typeof frontmatter.author === "string" ? frontmatter.author : undefined,
    category:
      typeof frontmatter.category === "string"
        ? frontmatter.category
        : undefined,
    updatedAt: fileUpdatedAt(filePath),
  });
}

interface SkillManifest {
  displayName?: string;
}

function skillManifest(baseDir: string): SkillManifest {
  const metadataPath = join(baseDir, "agents", "openai.yaml");
  if (!existsSync(metadataPath) || !statSync(metadataPath).isFile()) return {};
  const metadata = readFileSync(metadataPath, "utf8");
  return {
    displayName: metadata.match(
      /^\s+display_name:\s*["']?([^"'\r\n]+?)["']?\s*$/m,
    )?.[1],
  };
}

function fileUpdatedAt(filePath: string): string | undefined {
  try {
    return statSync(filePath).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function parseFrontmatter(content: string): Record<string, string | boolean> {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end < 0) return {};
  const result: Record<string, string | boolean> = {};
  for (const line of content.slice(3, end).split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    let value: string | boolean = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (value === "true") value = true;
    else if (value === "false") value = false;
    result[key] = value;
  }
  return result;
}

function validateName(name: string): string[] {
  const errors: string[] = [];
  if (name.length > 64) errors.push("name exceeds 64 characters");
  if (!/^[a-z0-9-]+$/.test(name))
    errors.push("name must use lowercase letters, numbers, and hyphens");
  if (name.startsWith("-") || name.endsWith("-") || name.includes("--"))
    errors.push("name has invalid hyphen placement");
  return errors;
}
function safeDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function parseSkillCommand(
  text: string,
  skills: Skill[],
): { skill: Skill; arguments: string } | null {
  const match = text.trim().match(/^\/skill:([a-z0-9-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const skill = skills.find((item) => item.name === match[1]);
  if (!skill) throw new Error(`Unknown skill: ${match[1]}`);
  return { skill, arguments: match[2] ?? "" };
}
