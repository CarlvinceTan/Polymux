import {constants as fsConstants} from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import {readFileSync, readdirSync, statSync} from "node:fs";
import {homedir} from "node:os";
import path from "node:path";
import {MemoryManager} from "@polymux/agent";
import type {
  ExternalAgentProfileDto,
  ExternalConfigurationSection,
  ExternalConfigurationSummaryDto,
  UpdateAgentRuntimeRequest,
} from "@polymux/protocol";
import {importMcpServers} from "@polymux/tools";
import {parse as parseToml} from "smol-toml";

type AcpRequest = Extract<UpdateAgentRuntimeRequest, {kind: "acp"}>;
type ConfigurationPlacement = "direct" | "parent" | "home";
type McpFormat = "json" | "jsonc" | "toml" | "yaml";

interface McpLocation {
  file: string;
  format: McpFormat;
  key?: "mcp" | "mcpServers" | "mcp_servers";
  importable?: boolean;
}

interface AgentFamily {
  id: string;
  verified: boolean;
  defaultDirectories: string[];
  placement: ConfigurationPlacement;
  configEnvironment?: string;
  settingsFiles: string[];
  settingsDirectories: string[];
  skillDirectories: string[];
  pluginDirectories: string[];
  memoryFiles: string[];
  memoryDirectories: string[];
  mcpLocations: McpLocation[];
  supportsSync: boolean;
  syncUnavailableReason?: string;
}

const EMPTY_ASSETS: Pick<AgentFamily,
  "settingsFiles" | "settingsDirectories" | "skillDirectories" |
  "pluginDirectories" | "memoryFiles" | "memoryDirectories" | "mcpLocations"> = {
  settingsFiles: [],
  settingsDirectories: [],
  skillDirectories: [],
  pluginDirectories: [],
  memoryFiles: [],
  memoryDirectories: [],
  mcpLocations: [],
};

/** Config layouts verified against each agent's own documentation. Unknown ACP
 * registry entries remain runnable, but never receive a guessed import root. */
const FAMILIES: Record<string, AgentFamily> = {
  claude: {
    id: "claude", verified: true, defaultDirectories: [".claude"], placement: "direct",
    configEnvironment: "CLAUDE_CONFIG_DIR", supportsSync: true,
    settingsFiles: ["settings.json", "keybindings.json", "remote-settings.json", "CLAUDE.md"],
    settingsDirectories: ["agents", "commands", "rules", "output-styles"],
    skillDirectories: ["skills", "skill"], pluginDirectories: ["plugins"],
    memoryFiles: ["CLAUDE.md"], memoryDirectories: ["memory"],
    mcpLocations: [],
  },
  codex: {
    id: "codex", verified: true, defaultDirectories: [".codex"], placement: "direct",
    configEnvironment: "CODEX_HOME", supportsSync: true,
    settingsFiles: ["config.toml", "AGENTS.md"], settingsDirectories: ["rules", "prompts"],
    skillDirectories: ["skills"], pluginDirectories: [],
    memoryFiles: ["AGENTS.md"], memoryDirectories: ["memory"],
    mcpLocations: [],
  },
  pi: {
    id: "pi", verified: true, defaultDirectories: [path.join(".pi", "agent")], placement: "direct",
    configEnvironment: "PI_CODING_AGENT_DIR", supportsSync: true,
    settingsFiles: ["settings.json", "models.json", "keybindings.json", "AGENTS.md"],
    settingsDirectories: ["prompts", "themes"], skillDirectories: ["skills"],
    pluginDirectories: ["extensions"], memoryFiles: ["AGENTS.md"], memoryDirectories: ["memory"],
    // Only Pi's own MCP file is imported or synced. MCP configs from Claude,
    // Codex, and other agent homes are deliberately ignored.
    mcpLocations: [{file: "mcp.json", format: "json"}],
  },
  opencode: {
    id: "opencode", verified: true,
    defaultDirectories: [path.join(".config", "opencode"), ".opencode"], placement: "direct",
    configEnvironment: "OPENCODE_CONFIG_DIR", supportsSync: true,
    settingsFiles: ["opencode.json", "opencode.jsonc", "AGENTS.md"],
    settingsDirectories: ["agents", "commands", "modes"], skillDirectories: ["skills"],
    pluginDirectories: ["plugins"], memoryFiles: ["AGENTS.md"], memoryDirectories: ["memory"],
    mcpLocations: [],
  },
  junie: {
    id: "junie", verified: true, defaultDirectories: [".junie"], placement: "direct",
    configEnvironment: "JUNIE_HOME", supportsSync: true,
    settingsFiles: ["config.json", "settings.json", "AGENTS.md"],
    settingsDirectories: ["agents", "commands", "models"], skillDirectories: ["skills"],
    pluginDirectories: ["extensions"], memoryFiles: ["AGENTS.md"], memoryDirectories: ["memory"],
    mcpLocations: [],
  },
  poolside: {
    id: "poolside", verified: true, defaultDirectories: [path.join(".config", "poolside")], placement: "home",
    supportsSync: false,
    syncUnavailableReason: "Poolside follows the shared XDG configuration root, so linking it would also expose unrelated app configuration. Import a private copy instead.",
    settingsFiles: ["settings.yaml"], settingsDirectories: [], skillDirectories: ["skills"],
    pluginDirectories: [], memoryFiles: ["AGENTS.md"], memoryDirectories: [],
    mcpLocations: [],
  },
  gemini: {
    id: "gemini", verified: true, defaultDirectories: [".gemini"], placement: "parent",
    configEnvironment: "GEMINI_CLI_HOME", supportsSync: true,
    settingsFiles: ["settings.json", "keybindings.json", "GEMINI.md"], settingsDirectories: [],
    skillDirectories: ["skills"], pluginDirectories: ["extensions"],
    memoryFiles: ["GEMINI.md"], memoryDirectories: ["memory"],
    mcpLocations: [],
  },
  qwen: {
    id: "qwen", verified: true, defaultDirectories: [".qwen"], placement: "direct",
    configEnvironment: "QWEN_HOME", supportsSync: true,
    settingsFiles: ["settings.json", "QWEN.md"], settingsDirectories: ["extensions"],
    skillDirectories: ["skills"], pluginDirectories: ["extensions"],
    memoryFiles: ["QWEN.md"], memoryDirectories: ["memory"],
    mcpLocations: [],
  },
  "github-copilot": {
    id: "github-copilot", verified: true, defaultDirectories: [".copilot"], placement: "direct",
    configEnvironment: "COPILOT_HOME", supportsSync: true,
    // config.json and auth/state files are intentionally excluded.
    settingsFiles: ["settings.json", "AGENTS.md"],
    settingsDirectories: ["agents", "hooks", "instructions"], skillDirectories: ["skills"],
    pluginDirectories: ["extensions", "installed-plugins"],
    memoryFiles: ["AGENTS.md"], memoryDirectories: ["instructions"], mcpLocations: [],
  },
  "mistral-vibe": {
    id: "mistral-vibe", verified: true, defaultDirectories: [".vibe"], placement: "direct",
    configEnvironment: "VIBE_HOME", supportsSync: true,
    settingsFiles: ["config.toml", "AGENTS.md"], settingsDirectories: ["agents", "prompts", "tools"],
    skillDirectories: ["skills"], pluginDirectories: [],
    memoryFiles: ["AGENTS.md"], memoryDirectories: ["memory"],
    mcpLocations: [],
  },
};

const FAMILY_ALIASES: Record<string, string> = {
  "claude-acp": "claude",
  "claude-agent": "claude",
  "claude-agent-acp": "claude",
  "codex-acp": "codex",
  "pi-acp": "pi",
  "qwen-code": "qwen",
  "github-copilot-cli": "github-copilot",
  "copilot-cli": "github-copilot",
  vibe: "mistral-vibe",
};

const SAFE_ENVIRONMENT_KEYS = [
  "PATH", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "SHELL",
  "TMPDIR", "TMP", "TEMP", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE",
  "TERM", "COLORTERM", "NO_COLOR", "FORCE_COLOR", "TZ",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
] as const;

export function externalAgentId(runtime: AcpRequest): string {
  const explicit = safeId(runtime.agentId ?? "");
  if (explicit) return FAMILY_ALIASES[explicit] ?? explicit;
  const identity = `${runtime.name} ${runtime.command} ${(runtime.args ?? []).join(" ")}`.toLowerCase();
  if (/claude(?:-code|-agent)?/.test(identity)) return "claude";
  if (/\bcodex\b/.test(identity)) return "codex";
  if (/\bpi(?:-acp)?\b/.test(identity)) return "pi";
  if (/\bopencode\b/.test(identity)) return "opencode";
  if (/\bgemini\b/.test(identity)) return "gemini";
  if (/\bqwen(?:-code)?\b/.test(identity)) return "qwen";
  if (/\bcopilot\b/.test(identity)) return "github-copilot";
  if (/\b(?:mistral[- ]?)?vibe\b/.test(identity)) return "mistral-vibe";
  if (/\bjunie\b/.test(identity)) return "junie";
  if (/\bpoolside\b|\bpool\s+acp\b/.test(identity)) return "poolside";
  return safeId(runtime.name) || "agent";
}

/** Finds user configurations this runtime could inherit. Inspection is
 * metadata-only: credentials, transcripts and file contents never cross IPC. */
export function inspectExternalAgentProfiles(
  runtime: AcpRequest,
  sourceDirectory?: string,
  options: {home?: string; cwd?: string; environment?: NodeJS.ProcessEnv} = {},
): ExternalAgentProfileDto[] {
  const home = options.home ?? homedir();
  const cwd = path.resolve(options.cwd || runtime.cwd || home);
  const family = agentFamily(runtime);
  const directories = sourceDirectory?.trim()
    ? [resolveUserPath(sourceDirectory, home)]
    : candidateDirectories(family, home, options.environment ?? process.env);
  if (!directories.length) return [unsupportedProfile(runtime, family)];
  return directories.map((directory, index) => {
    const summaries = summarize(directory, family, cwd);
    const exists = isDirectory(directory);
    return {
      id: directory,
      agentId: family.id,
      agentName: runtime.name.trim() || "External agent",
      name: candidateName(runtime.name, directory, family.defaultDirectories, index),
      directory,
      exists,
      supportsImport: family.verified,
      supportsSync: family.verified && family.supportsSync && exists,
      importUnavailableReason: family.verified
        ? null
        : "Polymux does not yet have a verified configuration adapter for this agent. Start clean to avoid exposing unrelated files.",
      syncUnavailableReason: family.supportsSync
        ? exists ? null : "No configuration folder exists at this location yet."
        : family.syncUnavailableReason ?? "Polymux does not yet know a safe live configuration root for this agent.",
      summaries,
    };
  });
}

/** Exact managed config path read by the child for imported and clean modes. */
export function managedExternalConfigurationDirectory(
  runtime: AcpRequest,
  runtimeDirectory: string,
  managedHome: string,
): string {
  const family = agentFamily(runtime);
  const relative = family.defaultDirectories[0] || `.${family.id}`;
  if (family.placement === "home") return path.join(managedHome, relative);
  if (family.placement === "parent") return path.join(runtimeDirectory, relative);
  return runtimeDirectory;
}

/** Returns a complete, deliberately small child environment. It does not
 * inherit API keys, auth variables, alternate homes, or host XDG roots. */
export function externalAgentEnvironment(
  runtime: AcpRequest,
  configurationDirectory: string,
  managedHome: string,
): NodeJS.ProcessEnv {
  const family = agentFamily(runtime);
  const environment: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(runtime.registryEnvironment ?? {})) {
    if (safeRegistryEnvironmentEntry(key, value)) environment[key] = value;
  }
  environment.HOME = managedHome;
  environment.USERPROFILE = managedHome;
  environment.XDG_CONFIG_HOME = path.join(managedHome, ".config");
  environment.XDG_DATA_HOME = path.join(managedHome, ".local", "share");
  environment.XDG_STATE_HOME = path.join(managedHome, ".local", "state");
  environment.XDG_CACHE_HOME = path.join(managedHome, ".cache");
  // Reusing only the package tarball cache avoids reinstalling public ACP
  // adapters for each profile without exposing npm credentials or settings.
  environment.npm_config_cache = process.env.npm_config_cache?.trim() || path.join(homedir(), ".npm");
  if (family.configEnvironment) {
    environment[family.configEnvironment] = family.placement === "parent"
      ? path.dirname(configurationDirectory)
      : configurationDirectory;
  }
  if (family.id === "opencode") {
    environment.OPENCODE_CONFIG_DIR = configurationDirectory;
    environment.OPENCODE_CONFIG = firstExisting(configurationDirectory, ["opencode.json", "opencode.jsonc"])
      ?? path.join(configurationDirectory, "opencode.json");
  }
  const runtimeRoot = path.dirname(managedHome);
  if (family.id === "qwen") environment.QWEN_RUNTIME_DIR = path.join(runtimeRoot, "runtime");
  if (family.id === "github-copilot") environment.COPILOT_CACHE_HOME = path.join(runtimeRoot, "cache");

  // Current official registry launch defaults. These are non-secret runtime
  // flags, not renderer-provided environment values.
  const registryId = safeId(runtime.agentId ?? "");
  if (registryId === "auggie") environment.AUGMENT_DISABLE_AUTO_UPDATE = "1";
  if (registryId === "factory-droid") {
    environment.DROID_DISABLE_AUTO_UPDATE = "true";
    environment.FACTORY_DROID_AUTO_UPDATE_ENABLED = "false";
  }
  if (registryId === "fast-agent") environment.FAST_AGENT_MODEL = "codexplan";
  return environment;
}

function safeRegistryEnvironmentEntry(key: string, value: unknown): value is string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) &&
    typeof value === "string" &&
    value.length <= 4_096 &&
    !value.includes("\0") &&
    !/(?:TOKEN|SECRET|PASSWORD|PASS|KEY|CREDENTIAL|AUTH|COOKIE)/i.test(key) &&
    !/^(?:HOME|USERPROFILE|PATH|PATHEXT|NODE_OPTIONS|ELECTRON_RUN_AS_NODE)$/i.test(key) &&
    !/^(?:XDG_|DYLD_|LD_|POLYMUX_|npm_|NPM_)/.test(key);
}

/** Only Pi's MCP file may be edited while a synced profile is active. */
export function externalMcpFile(agentId: string, directory: string): string | undefined {
  const id = FAMILY_ALIASES[safeId(agentId)] ?? safeId(agentId);
  return id === "pi" ? path.join(directory, "mcp.json") : undefined;
}

export function externalMcpKey(agentId: string): "mcpServers" | "mcp" | undefined {
  const id = FAMILY_ALIASES[safeId(agentId)] ?? safeId(agentId);
  return id === "pi" ? "mcpServers" : undefined;
}

export async function importExternalConfiguration(options: {
  runtime: AcpRequest;
  sourceDirectory: string;
  profileDirectory: string;
  runtimeDirectory: string;
  sections: ExternalConfigurationSection[];
  cwd?: string;
}): Promise<void> {
  const source = path.resolve(options.sourceDirectory);
  const family = agentFamily(options.runtime);
  if (!family.verified) throw new Error(`${options.runtime.name} does not yet have a verified configuration importer`);
  if (!isDirectory(source)) throw new Error("That external configuration folder no longer exists");
  const selected = new Set(options.sections);
  await mkdir(options.profileDirectory, {recursive: true});
  await mkdir(options.runtimeDirectory, {recursive: true});

  if (selected.has("settings")) {
    for (const name of family.settingsFiles)
      await mergeCopy(path.join(source, name), path.join(options.runtimeDirectory, name));
    for (const name of family.settingsDirectories)
      await mergeCopy(path.join(source, name), path.join(options.runtimeDirectory, name));
  }

  if (selected.has("skills")) {
    for (const folder of family.skillDirectories) {
      const origin = path.join(source, folder);
      if (!isDirectory(origin)) continue;
      await mergeCopy(origin, path.join(options.profileDirectory, "skills"));
      await mergeCopy(origin, path.join(options.runtimeDirectory, folder));
    }
  }

  if (selected.has("plugins")) {
    for (const folder of family.pluginDirectories)
      await mergeCopy(path.join(source, folder), path.join(options.runtimeDirectory, folder));
  }

  if (selected.has("mcp"))
    await mergeMcpConfiguration(
      externalMcpEntries(source, family).filter(hasMcpEntry),
      path.join(options.profileDirectory, "mcp.json"),
    );

  if (selected.has("memory")) {
    const memoryFiles = externalMemoryFiles(source, family, path.resolve(options.cwd || options.profileDirectory));
    const memory = new MemoryManager({directory: path.join(options.profileDirectory, "memories")});
    for (const file of memoryFiles) {
      const relative = path.relative(source, file);
      if (relative && !relative.startsWith("..")) await mergeCopy(file, path.join(options.runtimeDirectory, relative));
      const content = await readFile(file, "utf8").catch(() => "");
      if (content.trim()) memory.remember(content, {kind: "imported"});
    }
  }
}

function agentFamily(runtime: AcpRequest): AgentFamily {
  const id = externalAgentId(runtime);
  return FAMILIES[id] ?? {
    id,
    verified: false,
    defaultDirectories: [],
    placement: "home",
    supportsSync: false,
    ...EMPTY_ASSETS,
  };
}

function unsupportedProfile(runtime: AcpRequest, family: AgentFamily): ExternalAgentProfileDto {
  const reason = "Polymux does not yet have a verified configuration adapter for this agent. Start clean to avoid exposing unrelated files.";
  return {
    id: `unsupported:${family.id}`,
    agentId: family.id,
    agentName: runtime.name.trim() || "External agent",
    name: `${runtime.name.trim() || "External agent"} configuration`,
    directory: "",
    exists: false,
    supportsImport: false,
    supportsSync: false,
    importUnavailableReason: reason,
    syncUnavailableReason: "The official ACP registry does not publish this agent's configuration layout.",
    summaries: sectionKinds().map((kind) => summary(kind, [], false, reason)),
  };
}

function candidateDirectories(family: AgentFamily, home: string, environment: NodeJS.ProcessEnv): string[] {
  if (!family.verified) return [];
  const candidates: string[] = [];
  const add = (value: string, includeMissing = false) => {
    const resolved = path.resolve(value);
    if ((includeMissing || isDirectory(resolved)) && !candidates.includes(resolved)) candidates.push(resolved);
  };
  if (family.configEnvironment && environment[family.configEnvironment]?.trim()) {
    const configured = resolveUserPath(environment[family.configEnvironment]!, home);
    add(family.placement === "parent" ? path.join(configured, family.defaultDirectories[0]!) : configured, true);
  }
  family.defaultDirectories.forEach((relative, index) => add(path.join(home, relative), index === 0));
  for (const relative of family.defaultDirectories) {
    const defaultPath = path.join(home, relative);
    const parent = path.dirname(defaultPath);
    const basename = path.basename(defaultPath);
    try {
      for (const entry of readdirSync(parent, {withFileTypes: true})) {
        if ((!entry.isDirectory() && !entry.isSymbolicLink()) || !entry.name.startsWith(`${basename}-`)) continue;
        add(path.join(parent, entry.name));
      }
    } catch {
      // A missing or locked parent produces only the default empty candidate.
    }
  }
  return candidates;
}

function summarize(directory: string, family: AgentFamily, cwd: string): ExternalConfigurationSummaryDto[] {
  const settings = [
    ...family.settingsFiles.filter((name) => isFile(path.join(directory, name))),
    ...family.settingsDirectories.flatMap((name) => directoryNames(path.join(directory, name)).map((item) => `${name}/${item}`)),
  ];
  const skills = family.skillDirectories.flatMap((folder) =>
    directoryNames(path.join(directory, folder)).filter((name) => isFile(path.join(directory, folder, name, "SKILL.md"))),
  );
  const plugins = externalPluginNames(directory, family);
  const mcpEntries = externalMcpEntries(directory, family);
  const mcpImportable = mcpEntries.every(hasMcpEntry);
  const memory = externalMemoryFiles(directory, family, cwd).map((file) => path.basename(file));
  return [
    summary("settings", settings),
    summary("skills", skills),
    summary("plugins", plugins),
    summary("mcp", mcpEntries.map((entry) => entry.id), mcpImportable,
      mcpImportable ? null : "This format stays with the external agent and is imported with its settings."),
    summary("memory", memory),
  ];
}

function sectionKinds(): ExternalConfigurationSection[] {
  return ["settings", "skills", "plugins", "mcp", "memory"];
}

function summary(
  kind: ExternalConfigurationSection,
  items: string[],
  importable = true,
  detail: string | null = null,
): ExternalConfigurationSummaryDto {
  const unique = [...new Set(items)].sort((left, right) => left.localeCompare(right));
  return {kind, count: unique.length, items: unique.slice(0, 12), importable, detail};
}

function externalPluginNames(directory: string, family: AgentFamily): string[] {
  const names = family.pluginDirectories.flatMap((folder) =>
    directoryNames(path.join(directory, folder)).filter((name) => name !== "installed_plugins.json"),
  );
  if (family.id === "claude") {
    const settings = jsonFile(path.join(directory, "settings.json"));
    const enabled = record(settings?.enabledPlugins);
    if (enabled) names.push(...Object.keys(enabled));
    const installed = jsonFile(path.join(directory, "plugins", "installed_plugins.json"));
    const plugins = record(installed?.plugins) ?? record(installed?.installedPlugins) ?? record(installed);
    if (plugins) names.push(...Object.keys(plugins));
  }
  return [...new Set(names)];
}

interface ExternalMcpEntry {id: string; entry?: Record<string, unknown>}

function externalMcpEntries(directory: string, family: AgentFamily): ExternalMcpEntry[] {
  const entries = new Map<string, Record<string, unknown> | undefined>();
  const add = (root: unknown, key?: McpLocation["key"]) => {
    const container = record(root);
    const selected = key && container ? container[key] : root;
    if (Array.isArray(selected)) {
      for (const item of selected) {
        const value = record(item);
        const id = typeof value?.name === "string" ? value.name : typeof value?.id === "string" ? value.id : "";
        if (id) entries.set(id, value);
      }
      return;
    }
    const normalized = key ? {mcpServers: selected} : root;
    try {
      for (const config of importMcpServers(normalized))
        entries.set(config.id, {...config.metadata, name: config.name ?? config.id});
    } catch {
      const values = record(selected);
      if (values) for (const [id, value] of Object.entries(values)) {
        const item = record(value);
        if (item) entries.set(id, normalizeAgentMcp(item));
      }
    }
  };
  for (const location of family.mcpLocations) {
    const target = path.join(directory, location.file);
    const source = readText(target);
    if (!source) continue;
    if (location.format === "yaml") {
      for (const id of yamlSectionNames(source, location.key ?? "mcp_servers")) entries.set(id, undefined);
      continue;
    }
    try {
      const parsed = location.format === "toml" ? parseToml(source) : parseJson(source, location.format === "jsonc");
      add(parsed, location.key);
      if (location.importable === false) for (const id of entries.keys()) entries.set(id, undefined);
    } catch {
      // Ignore a file while it is mid-edit.
    }
  }
  return [...entries].map(([id, entry]) => ({id, entry}));
}

function normalizeAgentMcp(value: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(value.command)) {
    const [command, ...args] = value.command.filter((item): item is string => typeof item === "string");
    return {command, args, env: record(value.environment) ?? record(value.env)};
  }
  return value;
}

function hasMcpEntry(entry: ExternalMcpEntry): entry is {id: string; entry: Record<string, unknown>} {
  return !!entry.entry;
}

function externalMemoryFiles(directory: string, family: AgentFamily, cwd: string): string[] {
  const files: string[] = [];
  const add = (file: string) => { if (isFile(file) && !files.includes(file)) files.push(file); };
  for (const name of family.memoryFiles) add(path.join(directory, name));
  for (const folder of family.memoryDirectories) {
    for (const name of directoryNames(path.join(directory, folder))) {
      const file = path.join(directory, folder, name);
      if (name.endsWith(".md")) add(file);
    }
  }
  if (family.id === "claude") {
    const project = path.join(directory, "projects", claudeProjectName(cwd), "memory");
    for (const name of directoryNames(project)) if (name.endsWith(".md")) add(path.join(project, name));
  }
  return files;
}

async function mergeMcpConfiguration(
  entries: Array<{id: string; entry: Record<string, unknown>}>,
  destination: string,
): Promise<void> {
  if (!entries.length) return;
  const source = await readFile(destination, "utf8").catch(() => "{}");
  let root: Record<string, unknown>;
  try {
    const parsed = JSON.parse(source) as unknown;
    root = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { root = {}; }
  const current = record(root.mcpServers) ?? {};
  for (const {id, entry} of entries) if (!(id in current)) current[id] = entry;
  root.mcpServers = current;
  await mkdir(path.dirname(destination), {recursive: true});
  await writeFile(destination, `${JSON.stringify(root, null, 2)}\n`, {encoding: "utf8", mode: 0o600});
}

async function mergeCopy(source: string, destination: string): Promise<void> {
  const info = await stat(source).catch((): null => null);
  if (!info) return;
  if (info.isDirectory()) {
    await mkdir(destination, {recursive: true});
    for (const entry of await readdir(source, {withFileTypes: true})) {
      if (entry.isSymbolicLink()) continue;
      await mergeCopy(path.join(source, entry.name), path.join(destination, entry.name));
    }
    return;
  }
  if (!info.isFile()) return;
  await mkdir(path.dirname(destination), {recursive: true});
  await copyFile(source, destination, fsConstants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}

function candidateName(agentName: string, directory: string, defaults: string[], index: number): string {
  const basename = path.basename(directory);
  if (defaults.some((entry) => path.basename(entry) === basename)) return `${agentName} Default`;
  const defaultName = path.basename(defaults[0] ?? "");
  const suffix = defaultName && basename.startsWith(`${defaultName}-`)
    ? basename.slice(defaultName.length + 1)
    : basename.replace(/^\./, "");
  return suffix ? `${agentName} ${title(suffix)}` : `${agentName} ${index + 1}`;
}

function title(value: string): string {
  return value.split(/[-_.]/).filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function safeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function resolveUserPath(value: string, home: string): string {
  return path.resolve(value === "~" ? home : value.startsWith("~/") ? path.join(home, value.slice(2)) : value);
}

function claudeProjectName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function directoryNames(directory: string): string[] {
  try {
    return readdirSync(directory, {withFileTypes: true})
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch { return []; }
}

function jsonFile(file: string): Record<string, unknown> | undefined {
  try { return record(parseJson(readFileSync(file, "utf8"), file.endsWith(".jsonc"))); }
  catch { return undefined; }
}

function parseJson(source: string, comments: boolean): unknown {
  return JSON.parse(comments ? stripJsonComments(source) : source);
}

function stripJsonComments(source: string): string {
  let result = "";
  let string = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (string) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') string = false;
      continue;
    }
    if (character === '"') { string = true; result += character; continue; }
    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    result += character;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}

function yamlSectionNames(source: string, section: string): string[] {
  const lines = source.split(/\r?\n/);
  const names: string[] = [];
  let baseIndent = -1;
  for (const line of lines) {
    if (baseIndent < 0) {
      const match = line.match(new RegExp(`^(\\s*)${section}:\\s*(?:#.*)?$`));
      if (match) baseIndent = match[1]!.length;
      continue;
    }
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= baseIndent) break;
    const match = line.match(/^\s*([A-Za-z0-9_.-]+):\s*(?:#.*)?$/);
    if (match && indent === baseIndent + 2) names.push(match[1]!);
  }
  return names;
}

function firstExisting(directory: string, names: string[]): string | undefined {
  return names.map((name) => path.join(directory, name)).find(isFile);
}

function readText(file: string): string {
  try { return readFileSync(file, "utf8"); }
  catch { return ""; }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isDirectory(target: string): boolean {
  try { return statSync(target).isDirectory(); }
  catch { return false; }
}

function isFile(target: string): boolean {
  try { return statSync(target).isFile(); }
  catch { return false; }
}
