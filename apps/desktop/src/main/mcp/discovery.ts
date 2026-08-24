import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { importMcpServers } from "@polymux/tools";
import type { DiscoveredMcpDto, DiscoveredMcpGroupDto } from "@polymux/protocol";
import { parse as parseToml } from "smol-toml";
import { polymuxDirectoryName } from "../system/paths.js";

/**
 * The agents whose names we know how to write, in the order their groups are
 * listed. Anything else keeping MCP servers in its home directory is still
 * found — the scan walks the home directory rather than working from a list —
 * and only its heading is guessed from the directory name.
 */
const KNOWN_AGENTS: {ids: string[]; label: string}[] = [
  {ids: ["claude"], label: "Claude"},
  {ids: ["codex"], label: "Codex"},
  {ids: ["cursor"], label: "Cursor"},
  {ids: ["gemini"], label: "Gemini CLI"},
  {ids: ["vscode", "code"], label: "VS Code"},
  {ids: ["windsurf"], label: "Windsurf"},
  {ids: ["zed"], label: "Zed"},
  {ids: ["opencode"], label: "OpenCode"},
  {ids: ["copilot", "github-copilot"], label: "GitHub Copilot"},
  {ids: ["cline"], label: "Cline"},
  {ids: ["goose"], label: "goose"},
  {ids: ["amp"], label: "Amp"},
];

/**
 * The file names agents keep MCP servers in. Every one is parsed the same way
 * — `importMcpServers` accepts `mcpServers`, `mcp_servers` and `servers`, so
 * one reader covers all of them — and a file without any is simply skipped.
 */
const CONFIG_FILES = [
  "mcp.json",
  "config.toml",
  "config.json",
  "settings.json",
  "claude_desktop_config.json",
];

/**
 * Polymux's own directories: its servers are already the MCP list. Both
 * spellings are excluded — a side instance keeps its configuration in
 * `~/.polymux-<name>`, and the ordinary `~/.polymux` beside it is the user's
 * own run, not another agent to adopt servers from.
 */
const SELF = new Set([".polymux", polymuxDirectoryName()]);

/**
 * Reads every MCP server configured elsewhere on this machine: the config
 * files under `~/.<agent>/` and `~/.config/<agent>/`, plus Claude Desktop's
 * own application-support file. Files with no servers in them are dropped
 * rather than listed empty — a run of empty headings buries the real finds.
 *
 * `installed` is the set of server ids Polymux already loads, which decides
 * whether a find is offered or reported as one it already has.
 */
export function discoverAgentMcpServers(
  installed: ReadonlySet<string>,
  home = homedir(),
): DiscoveredMcpGroupDto[] {
  const groups: DiscoveredMcpGroupDto[] = [];
  for (const candidate of agentConfigFiles(home)) {
    const servers = readMcpFile(candidate.file).map((config): DiscoveredMcpDto => ({
      id: config.id,
      name: config.name ?? config.id,
      description:
        typeof config.metadata?.description === "string"
          ? config.metadata.description
          : undefined,
      transport: config.transport,
      target: config.transport === "stdio" ? config.command : config.url,
      source: candidate.id,
      path: displayPath(candidate.file, home),
      state: installed.has(config.id) ? "loaded" : "available",
    }));
    if (!servers.length) continue;
    const known = KNOWN_AGENTS.find((agent) => agent.ids.includes(candidate.id));
    groups.push({
      id: `${candidate.id}:${path.basename(candidate.file)}`,
      label: known?.label ?? agentLabel(candidate.id),
      path: displayPath(candidate.file, home),
      servers: servers.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  // Known agents first, in the order above, so the common ones stay at the top
  // however many one-off directories a machine has collected.
  return groups.sort((a, b) => {
    const left = KNOWN_AGENTS.findIndex((agent) => agent.ids.includes(a.id.split(":")[0]));
    const right = KNOWN_AGENTS.findIndex((agent) => agent.ids.includes(b.id.split(":")[0]));
    if (left === right) return a.label.localeCompare(b.label);
    if (left < 0) return 1;
    if (right < 0) return -1;
    return left - right;
  });
}

/**
 * Resolves a discovered server back to the raw configuration entry to copy
 * into ~/.polymux/mcp.json. The file is re-read rather than trusting what the
 * renderer sends back: only the group and the id make the round trip.
 */
export function resolveDiscoveredMcp(
  groupId: string,
  serverId: string,
  home = homedir(),
): {id: string; entry: Record<string, unknown>} {
  for (const candidate of agentConfigFiles(home)) {
    if (`${candidate.id}:${path.basename(candidate.file)}` !== groupId) continue;
    const found = readMcpFile(candidate.file).find((config) => config.id === serverId);
    if (found) return {id: found.id, entry: {...found.metadata, name: found.name ?? found.id}};
  }
  throw new Error(`That MCP server is no longer in ${groupId}`);
}

function readMcpFile(file: string): ReturnType<typeof importMcpServers> {
  const source = read(file);
  if (!source) return [];
  try {
    const parsed = file.endsWith(".toml") ? parseToml(source) : JSON.parse(source);
    // A general settings file only counts when it names its servers: without
    // the key, `importMcpServers` would read every top-level setting as one.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const root = parsed as Record<string, unknown>;
    if (!("mcpServers" in root) && !("mcp_servers" in root) && !("servers" in root))
      return [];
    // A server missing both a command and a url throws for the whole file, so
    // an agent mid-edit costs its own group rather than the entire scan.
    return importMcpServers(root);
  } catch {
    return [];
  }
}

/** Every config file that exists, keyed by the agent it belongs to. */
function agentConfigFiles(home: string): {id: string; file: string}[] {
  const found: {id: string; file: string}[] = [];
  const add = (id: string, file: string) => {
    if (isFile(file) && !found.some((item) => item.file === file)) found.push({id, file});
  };
  const roots: {parent: string; hidden: boolean}[] = [
    {parent: home, hidden: true},
    {parent: path.join(home, ".config"), hidden: false},
  ];
  for (const root of roots) {
    for (const name of entries(root.parent)) {
      if (root.hidden && !name.startsWith(".")) continue;
      if (SELF.has(name) || name === "." || name === "..") continue;
      const id = name.replace(/^\./, "");
      if (!id) continue;
      for (const file of CONFIG_FILES) add(id, path.join(root.parent, name, file));
    }
  }
  // Claude Desktop keeps its servers outside the dotfile layout on macOS.
  add("claude", path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"));
  return found;
}

function entries(directory: string): string[] {
  try {
    return readdirSync(directory, {withFileTypes: true})
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function read(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function isFile(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

/** "open-interpreter" reads as "Open Interpreter" until we know better. */
function agentLabel(id: string): string {
  return id
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

function displayPath(absolute: string, home: string): string {
  return absolute.startsWith(`${home}${path.sep}`)
    ? `~${path.sep}${absolute.slice(home.length + 1)}`
    : absolute;
}
