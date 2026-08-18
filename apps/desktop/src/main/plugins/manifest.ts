import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { SkillLoader } from "@flareai/agent";
import { importMcpServers } from "@flareai/tools";
import type { PluginContributionsDto } from "@flareai/protocol";

/**
 * What a plugin says about itself. Everything is optional but the name, and
 * even that falls back to the folder — a plugin that is only a `skills/`
 * directory and a one-line manifest is a valid plugin.
 */
export interface PluginManifest {
  name: string;
  description: string;
  version?: string;
  author?: string;
  homepage?: string;
}

export const MANIFEST_FILE = path.join(".claude-plugin", "plugin.json");

export function readManifest(directory: string): PluginManifest {
  const fallback = path.basename(directory);
  const source = read(path.join(directory, MANIFEST_FILE));
  if (!source) return { name: fallback, description: "" };
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`${fallback} has an unreadable .claude-plugin/plugin.json`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${fallback} has an unreadable .claude-plugin/plugin.json`);
  const root = value as Record<string, unknown>;
  return {
    name: typeof root.name === "string" && root.name.trim() ? root.name.trim() : fallback,
    description: typeof root.description === "string" ? root.description.trim() : "",
    version: typeof root.version === "string" ? root.version : undefined,
    author: personName(root.author),
    homepage: typeof root.homepage === "string" ? root.homepage : undefined,
  };
}

/**
 * Everything the plugin contributes, read off the disk rather than off the
 * manifest: the manifest does not have to declare its directories, so the
 * folders themselves are the only honest answer.
 *
 * Skills and MCP servers are named because FlareAI runs them and the names are
 * what can clash with something the user already has. Commands, agents and
 * hooks are counted only — the app has no surface for them yet, and a count
 * that says "3 commands, not used" is truer than a list that implies they are.
 */
export function readContributions(directory: string): PluginContributionsDto {
  return {
    skills: pluginSkillNames(directory),
    mcpServers: pluginMcpServers(directory).map((server) => server.id),
    commands: countMarkdown(path.join(directory, "commands")),
    agents: countMarkdown(path.join(directory, "agents")),
    hooks: countHooks(directory),
  };
}

/** The plugin's skills directory, or undefined when it ships none. Passed to
 * the agent's loader as a `configured` location — never to the loader behind
 * the Skills tab, which is what keeps a plugin's skills off that list. */
export function pluginSkillDirectory(directory: string): string | undefined {
  const skills = path.join(directory, "skills");
  return isDirectory(skills) ? skills : undefined;
}

export function pluginSkillNames(directory: string): string[] {
  const skills = pluginSkillDirectory(directory);
  if (!skills) return [];
  return new SkillLoader({ configured: [skills] })
    .load()
    .skills.map((skill) => skill.name)
    .sort();
}

/**
 * The plugin's MCP servers, with `${CLAUDE_PLUGIN_ROOT}` resolved to where the
 * plugin actually landed. Plugins bundle their servers beside their manifest
 * and address them through that variable, so leaving it unexpanded would
 * launch a command that does not exist.
 */
export function pluginMcpServers(directory: string): ReturnType<typeof importMcpServers> {
  const file = path.join(directory, ".mcp.json");
  const source = read(file);
  if (!source) return [];
  try {
    const parsed = JSON.parse(expandRoot(source, directory));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const root = parsed as Record<string, unknown>;
    if (!("mcpServers" in root) && !("servers" in root)) return [];
    return importMcpServers(root);
  } catch {
    // A malformed .mcp.json costs the plugin its servers, not the whole list.
    return [];
  }
}

/** Substituted before parsing so it reaches every string — command, args, cwd,
 * env and header values alike — without walking the parsed shape. JSON escapes
 * the separator on Windows, but the path is a POSIX one on the platforms this
 * app ships for. */
function expandRoot(source: string, directory: string): string {
  return source
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", directory)
    .replaceAll("$CLAUDE_PLUGIN_ROOT", directory);
}

function countMarkdown(directory: string): number {
  if (!isDirectory(directory)) return 0;
  let total = 0;
  const visit = (current: string, depth: number): void => {
    if (depth > 4) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".md")) total += 1;
    }
  };
  visit(directory, 0);
  return total;
}

/** Hook matchers, not files: one hooks.json declares several, and the number
 * that matters is how many would fire. */
function countHooks(directory: string): number {
  const source = read(path.join(directory, "hooks", "hooks.json"));
  if (!source) return 0;
  try {
    const parsed = JSON.parse(source) as { hooks?: Record<string, unknown> };
    const root = parsed?.hooks ?? (parsed as Record<string, unknown>);
    if (!root || typeof root !== "object") return 0;
    return Object.values(root).reduce<number>(
      (total, value) => total + (Array.isArray(value) ? value.length : 0),
      0,
    );
  } catch {
    return 0;
  }
}

function personName(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const name = (value as Record<string, unknown>).name;
    if (typeof name === "string") return name.trim() || undefined;
  }
  return undefined;
}

function read(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function isDirectory(target: string): boolean {
  try {
    return existsSync(target) && statSync(target).isDirectory();
  } catch {
    return false;
  }
}
