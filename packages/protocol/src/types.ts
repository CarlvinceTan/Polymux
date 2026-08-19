export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ConversationId = string;
export type RunId = string;

export interface ConversationDto {
  id: ConversationId;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}
export interface AttachmentDto {
  id: string;
  messageId: string;
  name: string;
  path: string;
  mimeType: string | null;
  size: number | null;
  sha256: string | null;
  createdAt: string;
}
export interface MessageDto {
  id: string;
  conversationId: ConversationId;
  runId: RunId | null;
  role: "system" | "user" | "assistant" | "tool";
  content: JsonValue;
  createdAt: string;
  sequence: number;
  attachments: AttachmentDto[];
  metadata: JsonValue;
}
export interface GoalDto {
  id: string;
  conversationId: ConversationId;
  objective: string;
  status: "active" | "paused" | "completed" | "blocked";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
export interface MemoryStatusDto {
  enabled: boolean;
  directory: string;
  storedBytes: number;
  registryPath: string;
  summaryPath: string;
  memories: number;
  userMemories: number;
  conversationMemories: number;
  latestMemoryAt: string | null;
  consolidatedAt: string | null;
  consolidationError: string | null;
  consolidationRetryAfter: string | null;
  pendingMemories: number;
}
export type ChronicleCapturePolicy = "all" | "except" | "only";
export interface ChronicleStatusDto {
  enabled: boolean;
  running: boolean;
  directory: string;
  lastCapturedAt: string | null;
  lastError: string | null;
  storedFrames: number;
  storedBytes: number;
  storedEvents: number;
  /** "all" records everywhere; "except" and "only" read the lists below. */
  capturePolicy: ChronicleCapturePolicy;
  apps: string[];
  sites: string[];
  recordPrivateBrowsing: boolean;
  interactionEvents: boolean;
  distilledThrough: string | null;
}
export interface ChronicleSettingsPatchDto {
  capturePolicy?: ChronicleCapturePolicy;
  apps?: string[];
  sites?: string[];
  recordPrivateBrowsing?: boolean;
  interactionEvents?: boolean;
}
export interface ChronicleEntryDto {
  id: string;
  capturedAt: string;
  sourceId: string;
  sourceName: string;
  displayId: string | null;
  width: number;
  height: number;
  path: string;
  change: number;
  reason: "change" | "heartbeat" | "initial";
  bytes: number;
}
export interface GeneralSettingsDto {
  theme: "light" | "dark" | "system";
  /** BCP 47 tag the interface is drawn in, or "system" to follow the host
   * locale. It steers the UI only — what language the agent replies in stays
   * the user's business, decided by what they write to it. */
  language: string;
  currency: "USD" | "AUD" | "EUR" | "GBP" | "SGD" | "JPY" | null;
  speechModeEnabled: boolean;
  /** Seconds of silence after which dictation stops listening on its own, or
   * null to keep listening until it is switched off by hand. */
  dictationAutoStopSeconds: number | null;
  timeEnabled: boolean;
  locationEnabled: boolean;
  reasoningLevel: ReasoningEffort;
  /**
   * Whether the full settings surface is on offer. Off by default: basic mode
   * hides the composer's model picker and the Model and Memory tabs, leaving
   * the model to be chosen from whichever provider is configured and every
   * memory option switched on.
   */
  advancedMode: boolean;
  /** False until the first-run setup has been finished or dismissed. */
  onboardingCompleted: boolean;
  /**
   * Whether the app may *use* each OS permission, independently of whether
   * macOS has granted it. Switching one off stops the app reaching for the
   * capability without touching the grant, so turning it back on needs no
   * second trip through System Settings.
   */
  permissions: Record<SystemPermissionKind, boolean>;
  /**
   * Whether the app may post system notifications at all, and which events
   * earn one. The master switch is kept separate from the per-event map so
   * turning it off silences everything without forgetting which events the
   * user had chosen — flipping it back on restores that choice rather than
   * every event at once.
   */
  notificationsEnabled: boolean;
  notifications: Record<NotificationKind, boolean>;
  /**
   * The master switch over every app grant a skill can declare. Off means the
   * app refuses to use them and never asks for one, and — the point of keeping
   * it separate from the grants themselves — it takes nothing back from macOS,
   * so switching it on again costs no second trip through System Settings.
   */
  appPermissionsEnabled: boolean;
  location: {
    latitude: number;
    longitude: number;
    accuracy: number;
    updatedAt: string;
  } | null;
}
export interface GeneralSettingsUpdate {
  theme?: GeneralSettingsDto["theme"];
  language?: GeneralSettingsDto["language"];
  currency?: GeneralSettingsDto["currency"];
  speechModeEnabled?: boolean;
  dictationAutoStopSeconds?: GeneralSettingsDto["dictationAutoStopSeconds"];
  timeEnabled?: boolean;
  locationEnabled?: boolean;
  reasoningLevel?: ReasoningEffort;
  advancedMode?: boolean;
  onboardingCompleted?: boolean;
  permissions?: Partial<Record<SystemPermissionKind, boolean>>;
  notificationsEnabled?: boolean;
  notifications?: Partial<Record<NotificationKind, boolean>>;
  appPermissionsEnabled?: boolean;
  location?: GeneralSettingsDto["location"];
}
/**
 * An event worth interrupting the user for. Each one is a row in Settings and
 * a key in the map above, so adding a kind here is all it takes for the row
 * and its stored switch to follow.
 */
export type NotificationKind =
  | "schedule-completed"
  | "schedule-failed"
  | "agent-completed"
  | "agent-attention"
  | "message-received";

export const NOTIFICATION_KINDS: NotificationKind[] = [
  "schedule-completed",
  "schedule-failed",
  "agent-completed",
  "agent-attention",
  "message-received",
];

/** How much the model is asked to reason before answering. Mirrors the
 * inference package's effort levels so the renderer can persist the choice
 * without importing the inference package directly. */
export type ReasoningEffort =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
/**
 * The grants the app reaches for itself, for capabilities it ships with. Every
 * one of them is Electron's to ask for, and each is a row in Settings whether
 * or not anything is currently using it.
 */
export type BuiltInPermissionKind =
  | "microphone"
  | "screen-recording"
  | "accessibility"
  // The only one macOS will not prompt for: it is switched on by hand in
  // System Settings, so it is never "not-determined" — either this process can
  // read what the grant covers or it cannot.
  | "full-disk-access";

/**
 * The grants a *skill* needs, because it drives one of the user's own apps.
 * Electron can neither read nor prompt for these, so they go through the
 * native helper; and unlike the built-in ones they are asked for when a skill
 * that declares one is installed, rather than at first run.
 */
export type AppPermissionKind =
  | "reminders"
  | "calendars"
  | "contacts"
  | "photos"
  // Driving another application, which macOS records per (FlareAI, target app)
  // pair rather than as one switch. It is presented as one row all the same:
  // the pane it opens is the one place any of those pairs can be changed.
  | "automation";

export type SystemPermissionKind = BuiltInPermissionKind | AppPermissionKind;

export const BUILT_IN_PERMISSION_KINDS: BuiltInPermissionKind[] = [
  "microphone",
  "screen-recording",
  "accessibility",
  "full-disk-access",
];

export const APP_PERMISSION_KINDS: AppPermissionKind[] = [
  "reminders",
  "calendars",
  "contacts",
  "photos",
  "automation",
];

export function isAppPermissionKind(
  value: unknown,
): value is AppPermissionKind {
  return APP_PERMISSION_KINDS.includes(value as AppPermissionKind);
}
export type SystemPermissionStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";
export interface FirstRunPermissionDto {
  firstRun: boolean;
  microphone: SystemPermissionStatus;
  screenRecording: SystemPermissionStatus;
}
export interface McpServerDto {
  id: string;
  name: string;
  description?: string;
  /** "official" marks a server bundled with the app, like official skills. */
  source: "official" | "flareai" | "codex";
  editable: boolean;
  enabled: boolean;
  transport: "stdio" | "streamable-http";
  status: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
  toolNames: string[];
  resourceUris: string[];
  promptNames: string[];
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}
export interface SaveCustomMcpRequest {
  id: string;
  name: string;
  description?: string;
  transport: "stdio" | "streamable-http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}
export interface DiscoveredMcpDto {
  id: string;
  name: string;
  description?: string;
  transport: "stdio" | "streamable-http";
  /** The command or url the server runs on, shown as its one-line detail. */
  target: string;
  /** The agent whose configuration it was found in, e.g. "codex". */
  source: string;
  /** The scanned file, with the home directory shortened to "~". */
  path: string;
  /**
   * "loaded" — FlareAI already runs a server with this id.
   * "available" — it can be copied into ~/.flareai/mcp.json.
   */
  state: "loaded" | "available";
}
/** Servers found in one agent's configuration file. */
export interface DiscoveredMcpGroupDto {
  id: string;
  /** The agent the file belongs to, e.g. "Codex". */
  label: string;
  path: string;
  servers: DiscoveredMcpDto[];
}
export interface McpChangeDto {
  servers: McpServerDto[];
  error: string | null;
}
export interface McpRegistryEntryDto {
  id: string;
  name: string;
  description: string;
  url: string;
  repository?: string;
  requiredHeaders: string[];
}
/** One page of registry results. `nextCursor` is empty once the registry has
 * nothing further; entries can be empty while it is not, because remote-less
 * servers are dropped after the page arrives. */
export interface McpRegistryPageDto {
  entries: McpRegistryEntryDto[];
  nextCursor: string;
}
export interface SkillDto {
  name: string;
  description: string;
  source: "official" | "codex" | "flareai" | "agents" | "bundled" | "configured";
  filePath: string;
  disableModelInvocation: boolean;
  allowedTools: string[];
  /**
   * The app grants this skill declared in its own frontmatter, e.g.
   * `permissions: reminders`. Read from the SKILL.md rather than a list kept
   * here, so a skill installed from anywhere can say what it needs — and so
   * installing it can ask for that grant instead of leaving the agent to hit
   * the refusal mid-run.
   */
  permissions: AppPermissionKind[];
  enabled: boolean;
  editable: boolean;
  instructions?: string;
  displayName?: string;
  author?: string;
  category?: string;
  /** ISO timestamp of the SKILL.md's last modification. */
  updatedAt?: string;
}
export interface SaveCustomSkillRequest {
  originalName?: string;
  name: string;
  description: string;
  instructions: string;
}
export interface SkillUploadFile {
  path: string;
  relativePath: string;
}
/** One entry of the skills.sh directory (GitHub-backed skill registry). */
export interface SkillRegistryEntryDto {
  /** Installable package spec, e.g. "vercel-labs/skills/find-skills". */
  id: string;
  name: string;
  /** Repository the skill ships from, e.g. "vercel-labs/skills". */
  source: string;
  installs: number;
}
/** One skill found sitting in another agent's directory on this machine. */
export interface DiscoveredSkillDto {
  name: string;
  description: string;
  /** The skill's own folder, shown so the user can see where it came from. */
  path: string;
  /**
   * "loaded" — FlareAI already reads this skill, either because the directory
   * is one it sources or because a skill of that name is installed already.
   * "available" — it can be copied into ~/.flareai/skills.
   */
  state: "loaded" | "available";
}
/** Skills found under one agent's home, e.g. every skill in ~/.codex/skills. */
export interface DiscoveredSkillGroupDto {
  id: string;
  /** The agent the directory belongs to, e.g. "Codex". */
  label: string;
  /** The scanned directory, with the home directory shortened to "~". */
  directory: string;
  skills: DiscoveredSkillDto[];
}
/**
 * What a plugin brings with it. A plugin is installed and removed whole, so
 * these are reported rather than listed as separate rows: the Skills and MCP
 * tabs stay a view of what the user added directly, and everything a plugin
 * contributed is read on its own card.
 */
export interface PluginContributionsDto {
  /** Skill names, loaded by the agent but deliberately absent from Skills. */
  skills: string[];
  /** MCP server ids, connected but deliberately absent from the MCP tab. */
  mcpServers: string[];
  /** Counted rather than named: FlareAI has no surface for these yet. */
  commands: number;
  agents: number;
  hooks: number;
}
/**
 * A name a plugin contributes that the user already has standalone. The
 * plugin's copy is what runs, so the clash is surfaced on the plugin's card
 * rather than silently resolved.
 */
export interface PluginConflictDto {
  kind: "skill" | "mcp";
  name: string;
  /** Where the standalone copy came from, e.g. "flareai" or "official". */
  existingSource: string;
}
export interface PluginDto {
  /** "<marketplace>/<plugin>", unique across every marketplace added. */
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  homepage?: string;
  /** The marketplace it was installed from, by id. */
  marketplace: string;
  marketplaceName: string;
  /** The installed folder, with the home directory shortened to "~". */
  directory: string;
  enabled: boolean;
  contributions: PluginContributionsDto;
  conflicts: PluginConflictDto[];
  /** Set when the plugin is installed but could not be read. */
  error?: string;
}
/** One entry of a marketplace's catalog, installed or not. */
export interface MarketplacePluginDto {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  homepage?: string;
  /** True when a plugin of this id is already installed. */
  installed: boolean;
}
export interface PluginMarketplaceDto {
  id: string;
  name: string;
  /** The `owner/repo` (or URL) the catalog was added from. */
  source: string;
  /** How many plugins its catalog lists, or 0 when it could not be read. */
  pluginCount: number;
  /** True for the marketplace FlareAI ships with, which cannot be removed. */
  builtin: boolean;
  error?: string;
}
export interface ModelDto {
  provider: string;
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
  };
  selected: boolean;
  custom: boolean;
}
/**
 * The jobs a model can be assigned to. `main` is the model the agent answers
 * with; `task`, `judge` and `compaction` are overrides that fall back to `main`
 * when unset. `speech`, `image` and `video` are recorded preferences for the
 * generation surfaces — nothing calls them yet, so they only persist a choice.
 */
export type ModelRole =
  | "main"
  | "task"
  | "judge"
  | "compaction"
  | "speech"
  | "image"
  | "video";
export interface ModelRoleAssignmentDto {
  provider: string;
  id: string;
  /** Display name of the assigned model, or its id when it is unknown. */
  name: string;
  /** How hard the role's model is asked to think. Absent when the model takes
   * no effort level, in which case the provider's own default applies. */
  reasoning?: ReasoningEffort;
}
/**
 * What each role currently points at. `null` means nothing is assigned: for
 * `task` and `judge` that is "follow the main model", and for the generation
 * roles it is "not set". `main` is never null once a model has been chosen.
 */
export type ModelRolesDto = Record<ModelRole, ModelRoleAssignmentDto | null>;
/**
 * Facts about a model that the inference layer does not carry, sourced from
 * the models.dev catalogue. Every field is optional: the catalogue does not
 * know every model, and a missing entry must degrade to showing nothing
 * rather than blocking the model list.
 */
export interface ModelMetadataDto {
  description?: string;
  family?: string;
  /** The lab that built the model, as distinct from the provider serving it. */
  lab?: string;
  knowledgeCutoff?: string;
  releaseDate?: string;
  lastUpdated?: string;
  openWeights?: boolean;
  toolCall?: boolean;
  structuredOutput?: boolean;
  temperature?: boolean;
  attachment?: boolean;
  contextLimit?: number;
  outputLimit?: number;
}
export interface ProviderDto {
  id: string;
  name: string;
  logoDataUrl?: string;
  baseUrl?: string;
  apiKeyLabel: string | null;
  supportsOAuth: boolean;
  storedCredential: boolean;
  configured: boolean;
  source: string | null;
  modelCount: number;
  custom: boolean;
  /** A model server on this machine that FlareAI knows how to set up. Offered
   * in the provider list before it exists, so it is found where every other
   * provider is found rather than behind a custom-endpoint form. */
  localRuntime?: boolean;
  apiKeys: Array<{
    id: string;
    label: string;
    active: boolean;
    status: "ready" | "rate_limited" | "invalid";
  }>;
}
export interface CreateCustomProviderRequest {
  name: string;
  baseUrl: string;
  logoDataUrl?: string;
  apiKey?: string;
  models: Array<{id: string; name?: string}>;
}
export interface UpdateCustomProviderRequest extends Omit<CreateCustomProviderRequest, "apiKey"> {
  id: string;
}
/** Turn a known local runtime into a configured provider by reading the models
 * off it. `baseUrl` overrides the runtime's default port. */
export interface SetupLocalRuntimeRequest {
  id: string;
  baseUrl?: string;
}
/** Ask a local or remote OpenAI-compatible endpoint what it can serve. */
export interface DiscoverModelsRequest {
  baseUrl: string;
  apiKey?: string;
}

export type RunEventDto = {
  runId: RunId;
  conversationId: ConversationId;
  /** Set when this run is a subagent's: the run that delegated to it. The
   * renderer routes those events to the task's own transcript rather than into
   * the conversation the parent is writing. */
  parentRunId?: RunId | null;
  sequence: number;
  timestamp: number;
  type: string;
  payload: JsonValue;
};

export interface ArtifactDto {
  id: string;
  conversationId: ConversationId | null;
  runId: RunId | null;
  kind: "document" | "slides" | "sheet" | "photo" | "video" | "other";
  name: string;
  path: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
  updatedAt: string;
  metadata: JsonValue;
}

export interface ReferenceDto {
  id: string;
  conversationId: ConversationId;
  runId: RunId | null;
  kind: "web" | "file" | "other";
  title: string;
  uri: string;
  createdAt: string;
  metadata: JsonValue;
}

/** State of the FlareAI browser extension, which backs `browser_tabs`. */
export interface BrowserExtensionDto {
  /** True while a recent tab snapshot proves the extension is reporting. */
  installed: boolean;
  /** ISO timestamp of the last snapshot, or null if it has never reported. */
  lastReportedAt: string | null;
  /**
   * True when the title-bar chip should be shown: not installed, and not
   * dismissed since the last time it was seen installed.
   */
  promptToInstall: boolean;
}

export interface StartRunRequest {
  conversationId: ConversationId;
  text: string;
  messageId?: string;
  attachments?: string[];
  asGoal?: boolean;
  reasoning?: ReasoningEffort;
  /**
   * Set while the user is driving the conversation by speech rather than
   * typing. Transcribed speech arrives as ordinary text, so without this the
   * agent cannot tell the two apart and cannot shape replies for listening.
   */
  speechMode?: boolean;
}
export interface StartRunResponse {
  runId: RunId;
}
export interface GoalCommandRequest {
  conversationId: ConversationId;
  action: "view" | "create" | "update" | "pause" | "resume" | "clear";
  objective?: string;
}


/** Live page state for an embedded workspace-browser tab. */
export interface BrowserPageStateDto {
  tabId: string;
  url: string;
  title: string;
  /** The page's icon as a `data:` url, already fetched by the main process —
   * the renderer's CSP allows no remote images. Null until one arrives, and
   * again from the moment the tab navigates. */
  faviconUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}
export interface BrowserDownloadDto {
  id: string;
  title: string;
  path: string;
  kind: "document" | "image" | "pdf" | "spreadsheet" | "file";
  completedAt: string;
  url: string;
  state: "progressing" | "paused" | "completed" | "cancelled" | "interrupted";
  receivedBytes: number;
  /** Zero when the server sent no length, which is why progress is reported as
   * bytes rather than a fraction the UI would have to guard. */
  totalBytes: number;
}

export interface BrowserSettingsDto {
  /** Where downloads land when the user is not asked each time. */
  downloadDirectory: string;
  askWhereToSave: boolean;
  autofillEnabled: boolean;
}

export type PermissionDecisionDto = "allow" | "deny" | "ask";

/** The permissions the embedded browser will negotiate on a site's behalf.
 * Deliberately shorter than Electron's own list: anything absent stays denied
 * outright rather than gaining a prompt nobody designed. */
export type BrowserPermissionDto =
  | "geolocation"
  | "media"
  | "notifications"
  | "clipboard-read"
  | "pointerLock"
  | "fullscreen"
  | "openExternal";

export interface SitePermissionDto {
  origin: string;
  permission: BrowserPermissionDto;
  decision: PermissionDecisionDto;
  updatedAt: string;
}

/** A site the browser is holding data for. Cookie counts come from the cookie
 * jar itself; Electron exposes no per-origin storage figure, so none is
 * promised here. */
export interface BrowserSiteDto {
  origin: string;
  cookies: number;
  permissions: number;
  logins: number;
}

/** A saved login as the renderer is allowed to see it. The password is not a
 * field: it is returned only by an explicit, one-at-a-time reveal. */
export interface SavedLoginDto {
  id: string;
  origin: string;
  username: string;
  source: "manual" | "import";
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface BrowserProfileDto {
  id: string;
  name: string;
  path: string;
  /** False when the profile is present but unreadable — Safari without Full
   * Disk Access, or a Firefox profile behind a Primary Password. `reason` says
   * which, so the UI can tell the user what to do instead of failing blankly. */
  readable: boolean;
  reason: string | null;
}

export interface BrowserSourceDto {
  id: string;
  name: string;
  family: "chromium" | "firefox" | "safari";
  profiles: BrowserProfileDto[];
  /** Set when nothing can be read from this browser directly and the only way
   * in is a file the user exports themselves. */
  fileImportOnly: boolean;
}

export interface BrowserImportRequestDto {
  sourceId: string;
  profileId: string;
  cookies: boolean;
  passwords: boolean;
  history: boolean;
}

export interface BrowserImportResultDto {
  cookiesImported: number;
  cookiesSkipped: number;
  passwordsImported: number;
  passwordsSkipped: number;
  historyImported: number;
  historySkipped: number;
  /** Human-readable reasons things were skipped, deduplicated. Empty on a
   * clean run. */
  problems: string[];
}

/** One page in the browsing history. `visitCount` is what survives collapsing
 * repeat visits onto a single url. */
export interface BrowserHistoryEntryDto {
  url: string;
  title: string;
  visitedAt: string;
  visitCount: number;
  source: "local" | "import";
}

/** A live permission request from a page, waiting on the user. */
export interface BrowserPermissionPromptDto {
  id: string;
  tabId: string;
  origin: string;
  permission: BrowserPermissionDto;
}
export interface BrowserFoundDto {
  tabId: string;
  matches: number;
  activeMatch: number;
}
export type BrowserEventDto =
  /** The agent opened a tab of its own; the renderer surfaces it so the user
   * can watch the page it is working in. `show` is set when the user asked to
   * be shown the page, which is the only case that brings the workspace
   * forward on its own. */
  | { type: "opened"; tab: { tabId: string; url: string; title: string }; show: boolean }
  /** A tab went away in the main process; the renderer drops its workspace tab
   * rather than leaving one pointed at nothing. */
  | { type: "closed"; tabId: string }
  | { type: "state"; state: BrowserPageStateDto }
  | { type: "downloads"; downloads: BrowserDownloadDto[] }
  | { type: "found"; found: BrowserFoundDto }
  /** The page took keyboard focus. Clicks inside the embedded web contents
   * never reach the renderer, so this is how the chrome around it knows to
   * drop its own focus (the address bar's caret, above all). */
  | { type: "focus"; tabId: string }
  /** A page asked for a capability and nothing is stored for it yet. The
   * renderer prompts; `browser.respondToPermission` settles it. */
  | { type: "permission"; prompt: BrowserPermissionPromptDto }
  /** A login was saved, imported or removed. Sent so an open Settings tab
   * reflects a password captured in a browser tab without being reopened. */
  | { type: "logins" };

export interface AppVersionDto {
  version: string;
  electron: string;
  platform: string;
  packaged: boolean;
}
export interface AppUpdateDto {
  /** `downloading` means an update exists and Squirrel is fetching it;
   * `ready` means it is staged and only a restart is left. `unsupported`
   * means this build has no update channel to check against. */
  status:
    | "current"
    | "downloading"
    | "ready"
    | "unsupported"
    | "error";
  version: string;
  latest: string | null;
  checkedAt: string;
  message: string | null;
}

/**
 * Platforms the Communications tab can link. Every messaging platform except
 * `matrix` itself reaches the network through a bridge; `matrix` is the hub's
 * own account, which the others are attached to.
 */
export type CommsPlatform =
  | "whatsapp"
  | "telegram"
  | "signal"
  | "discord"
  | "slack"
  | "messenger"
  | "instagram"
  | "linkedin"
  | "googlechat"
  | "gmessages"
  | "twitter"
  | "bluesky"
  | "gvoice"
  | "zulip"
  | "imessage"
  | "wechat"
  | "matrix";

/**
 * The local Matrix homeserver plus bridge fleet that carries every messaging
 * platform. Bridges are only reachable through this hub, so its status gates
 * everything else in the tab.
 */
export interface CommsHubDto {
  /** Local proxy that fronts the homeserver and the bridge provisioning routes. */
  baseUrl: string;
  /** The homeserver itself, which the proxy does not expose the admin API of. */
  homeserverUrl: string;
  /**
   * Whether FlareAI can create its own account on the hub, which is what lets
   * messaging be set up without the user entering anything.
   */
  canAutoConnect: boolean;
  /** Deployment root, when one was found on disk. */
  directory: string | null;
  status: "unconfigured" | "unreachable" | "reachable" | "signed-in";
  /** Matrix ID the app holds an access token for. */
  userId: string | null;
  homeserverName: string | null;
  error: string | null;
}

/**
 * A value a bridge needs before it can run at all, as distinct from a login.
 * Telegram is the case this exists for: its bridge will not connect without an
 * api_id/api_hash pair, and the pair belongs to whoever registered it, so each
 * user supplies their own rather than inheriting one baked into the app.
 */
export interface CommsSetupFieldDto {
  id: string;
  name: string;
  description: string | null;
  /** Where the user gets the value. */
  helpUrl: string | null;
  secret: boolean;
}

export interface CommsBridgeSetupDto {
  fields: CommsSetupFieldDto[];
  /** Whether every required field already has a value on this machine. */
  configured: boolean;
}

/** One linked remote account on a bridge. Most networks allow exactly one. */
export interface CommsBridgeAccountDto {
  id: string;
  /** Remote-side label: a phone number, handle, or display name. */
  name: string;
  state: "connected" | "connecting" | "bad-credentials" | "unknown";
  error: string | null;
}

/** A way to link an account, as advertised by the bridge itself. */
export interface CommsLoginFlowDto {
  id: string;
  name: string;
  description: string;
}

export interface CommsBridgeDto {
  platform: CommsPlatform;
  name: string;
  /**
   * Which provisioning dialect the bridge speaks. `legacy` bridges predate the
   * step-based login API and can only be linked from their management room, so
   * the tab points the user there instead of driving the flow itself.
   */
  api: "bridgev2" | "legacy" | "none";
  state:
    | "unknown"
    | "unavailable"
    | "unreachable"
    /**
     * Installed and able to run, but not running: nothing is linked to it, so
     * it is not started until its platform is opened. Distinct from
     * `unreachable`, which is a bridge that was asked for and did not answer.
     */
    | "dormant"
    | "logged-out"
    | "connecting"
    | "connected"
    | "error";
  accounts: CommsBridgeAccountDto[];
  flows: CommsLoginFlowDto[];
  /** Configuration the bridge needs before login, or null when it needs none. */
  setup: CommsBridgeSetupDto | null;
  /** Management room to fall back to when the flow cannot be driven here. */
  managementRoomHint: string | null;
  error: string | null;
  /**
   * A macOS grant this bridge is held back by, when `error` describes one. It
   * is the difference between telling someone where the switch is and putting
   * it in front of them, so anything that renders the error should offer this
   * as a button. Absent whenever no grant would change the answer.
   */
  permission?: SystemPermissionKind | null;
}

/** One prompt in a `user_input` login step. */
export interface CommsLoginFieldDto {
  id: string;
  /** Maps to the input type the field should be rendered with. */
  type: "username" | "phone_number" | "email" | "password" | "2fa_code" | "token" | "url" | "unknown";
  name: string;
  description: string | null;
  /** Regex the value must satisfy before it is worth submitting. */
  pattern: string | null;
}

/** A cookie or storage value a `cookies` login step needs collected. */
export interface CommsLoginCookieFieldDto {
  /** Where the value lives in the logged-in page. */
  source: "cookie" | "local_storage" | "request_header" | "request_body" | "special";
  id: string;
  required: boolean;
}

/**
 * One step of a bridge login, mirroring the bridge's own step machine. The UI
 * renders a step, collects what it asks for, and posts back for the next one.
 */
export type CommsLoginStepDto =
  | {
      type: "user_input";
      loginId: string;
      stepId: string;
      instructions: string | null;
      fields: CommsLoginFieldDto[];
    }
  | {
      type: "cookies";
      loginId: string;
      stepId: string;
      instructions: string | null;
      /** Page to sign in on. */
      url: string;
      /** Navigating here means the sign-in finished. */
      waitForUrl: string | null;
      userAgent: string | null;
      fields: CommsLoginCookieFieldDto[];
    }
  | {
      type: "display_and_wait";
      loginId: string;
      stepId: string;
      instructions: string | null;
      display: "qr" | "code" | "emoji" | "nothing";
      /** QR payload to render, or the literal code to read out. */
      data: string | null;
      imageUrl: string | null;
    }
  | {
      type: "complete";
      loginId: string;
      accountId: string | null;
      accountName: string | null;
    };

export interface CommsEmailEndpointDto {
  kind: "imap" | "maildir" | "notmuch" | "smtp" | "sendmail" | "none";
  host: string | null;
  port: number | null;
  encryption: "tls" | "start-tls" | "none" | null;
  login: string | null;
  auth: "password" | "oauth2" | "command" | "keyring" | "none";
}

export interface CommsEmailAccountDto {
  /** Account key, unique across the user's mailboxes. */
  id: string;
  displayName: string | null;
  email: string;
  isDefault: boolean;
  incoming: CommsEmailEndpointDto;
  outgoing: CommsEmailEndpointDto;
  /** Whether FlareAI holds the password for this account in encrypted storage. */
  secretStored: boolean;
  status: "unknown" | "ok" | "error";
  error: string | null;
}

/** Known provider whose server settings the UI can fill in for the user. */
/** A mail provider FlareAI can sign in to on the user's behalf. */
export type CommsMailProvider = "google" | "microsoft";

export type CommsEmailPreset = "gmail" | "outlook" | "icloud" | "lark" | "fastmail" | "custom";

export interface SaveEmailAccountRequest {
  /** Existing account key when editing, absent when adding. */
  originalId?: string;
  id: string;
  displayName?: string;
  email: string;
  preset: CommsEmailPreset;
  imapHost: string;
  imapPort: number;
  imapEncryption: "tls" | "start-tls" | "none";
  imapLogin?: string;
  smtpHost: string;
  smtpPort: number;
  smtpEncryption: "tls" | "start-tls" | "none";
  smtpLogin?: string;
  /**
   * Plaintext only in transit from the settings form; it is written to
   * OS-encrypted storage and never returned to the renderer.
   */
  password?: string;
  isDefault?: boolean;
}

/** A mailbox folder, classified by the IMAP special-use flags it advertises. */
export interface MailFolderDto {
  /** Full IMAP path, e.g. "[Gmail]/Spam". */
  name: string;
  /** Leaf name for display, e.g. "Spam". */
  label: string;
  role: "inbox" | "drafts" | "sent" | "junk" | "trash" | "archive" | "flagged" | "other";
}

export interface MailAddressDto {
  name: string | null;
  address: string;
}

/** A message header row, as listed in a folder. */
export interface MailEnvelopeDto {
  /** Folder-relative id: only meaningful together with its folder. */
  id: string;
  subject: string;
  from: MailAddressDto;
  to: MailAddressDto | null;
  date: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
  hasAttachment: boolean;
  /**
   * The first line or so of the message, for the list row to show under the
   * subject. Empty when the body could not be peeked at cheaply.
   */
  preview?: string;
}

/** A file carried by a message, as announced by its MIME part. */
export interface MailAttachmentDto {
  name: string;
  mime: string | null;
}

export interface MailMessageDto {
  id: string;
  subject: string;
  from: MailAddressDto | null;
  to: MailAddressDto[];
  cc: MailAddressDto[];
  /** Only ever present on a message we sent: a received one never carries it. */
  bcc: MailAddressDto[];
  date: string;
  /** The message as text, always present — the fallback when there is no
   * HTML part, and what a reader falls back to if the markup is unusable. */
  body: string;
  /** The sender's own HTML, unsanitised, or null when the message has none.
   * Whatever displays it is responsible for sanitising it first. */
  html: string | null;
  attachments: MailAttachmentDto[];
  /** RFC 5322 Message-ID, needed so a reply threads in the recipient's client. */
  messageId: string | null;
  /** The chain this message is part of, oldest first, from its References. */
  references: string[];
}

export interface MailListRequest {
  account?: string;
  folder?: string;
  page?: number;
  pageSize?: number;
  /** How the folder is ordered; date, newest first, when unset. */
  sort?: "date-desc" | "date-asc" | "subject" | "from";
  /** Plain words to look for. Turned into an IMAP search by the
   * main process, so callers never have to speak it. */
  query?: string;
}

/** How a message announces its priority to the recipient's mail client. */
export type MailImportance = "high" | "normal" | "low";
export interface SendMailRequest {
  account?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** Saves to the drafts folder instead of sending. */
  draft?: boolean;
  /** Absolute paths to files to attach. */
  attachments?: string[];
  /** Marks the message urgent or low priority for the recipient's client.
   * "normal" is the default and writes no header. */
  importance?: MailImportance;
  /** Message-ID being answered, so the reply threads for the recipient. */
  inReplyTo?: string;
  /** The chain so far, which the reply extends. */
  references?: string[];
  /** A draft this replaces: saving an edited draft deletes the old copy
   * rather than leaving two versions in the folder. */
  replacesDraft?: {id: string; folder: string} | null;
}

/** One conversation on a linked messaging platform. */
export interface ChatDto {
  id: string;
  name: string;
  platform: string;
  /** Room avatar as an http(s) url the renderer can show, when it has one. */
  avatarUrl?: string | null;
  /** Unread messages the account has not acknowledged. */
  unread?: number;
  /**
   * When the newest message landed, as an ISO string. Drives the ordering of
   * the list: a chat list sorted by anything but recency is a list nobody can
   * find their last conversation in.
   */
  lastActivity?: string | null;
  /** One line of the newest message, for the row under the name. */
  preview?: string | null;
  /** Whether this is a group, which is drawn and named differently. */
  group?: boolean;
}

/** An image, voice note, video, or file carried by a message. */
export interface ChatAttachmentDto {
  kind: "image" | "audio" | "video" | "file";
  /** Resolvable url for the bytes, already authenticated. */
  url: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  /** Natural dimensions for an image or video, when the sender gave them. */
  width?: number | null;
  height?: number | null;
  /** Playback length in seconds, for audio and video. */
  duration?: number | null;
  /** A sticker, which is shown at a sticker's size rather than a photo's. */
  sticker?: boolean;
}

export interface ChatMessageDto {
  id: string;
  chatId: string;
  sender: string;
  /** The sender's own name, rather than the `@platform_id:server` puppet. */
  senderName?: string;
  senderAvatarUrl?: string | null;
  body: string;
  sentAt: string;
  /** True when the signed-in account sent it. */
  mine: boolean;
  /** Media the message carries. Text messages have none. */
  attachments?: ChatAttachmentDto[];
  /**
   * Set when the message holds something FlareAI cannot bring across — a
   * voice note on a network with no media API, a photo whose key the source
   * app never unlocked. Names the app that can show it, and how to open it,
   * so the placeholder is a way through rather than a dead end.
   */
  viewIn?: {app: string; url: string} | null;
  /** One entry per distinct emoji on the message. */
  reactions?: ChatReactionDto[];
  /** The message this one answers, when it is a reply. */
  replyTo?: string | null;
}

export interface ChatReactionDto {
  key: string;
  count: number;
  /** Set when the signed-in account is one of the reactors, so it can undo it. */
  mineEventId?: string | null;
}

export interface ChatActivityDto {
  /** The conversation that moved. */
  chatId: string;
  /** Who wrote it, so a view can tell its own echo from someone else's. */
  sender: string;
}

/**
 * What the hub knew when the app last quit, handed back in one read.
 *
 * The hub's panes are network-bound, so a launch used to be a skeleton until
 * IMAP and the homeserver answered. This is the paint-first half: the renderer
 * seeds itself from here before its first frame, then fetches and replaces
 * whatever moved. Everything in it is a copy — stale by definition, never
 * authoritative, and safe to be empty.
 */
export interface HubSnapshotDto {
  status: CommsStatusDto | null;
  chats: ChatDto[];
  /** A folder's first page, with the folder list it was read against. */
  mailboxes: Array<{
    account: string;
    folder: string;
    folders: MailFolderDto[];
    envelopes: MailEnvelopeDto[];
  }>;
  /** Message bodies already read, so opening one again is instant. */
  mail: Array<{account: string; folder: string; message: MailMessageDto}>;
  /** The newest page of the conversations most recently looked at. */
  messages: Array<{chatId: string; messages: ChatMessageDto[]; nextBefore: string | null}>;
}

export interface ChatPageDto {
  /** Newest first, the order the thread paints in. */
  messages: ChatMessageDto[];
  /** Passed back as `before` for the older page, or null at the room's start. */
  nextBefore: string | null;
}

export interface CommsStatusDto {
  hub: CommsHubDto;
  bridges: CommsBridgeDto[];
  email: {
    accounts: CommsEmailAccountDto[];
    /**
     * Providers this build can sign a mailbox in to. Empty where no OAuth
     * client is registered, which is what keeps a button that could only fail
     * off the screen.
     */
    signInProviders: CommsMailProvider[];
  };
}

/**
 * A surface the agent has been asked to show, pushed to the renderer so the
 * workspace opens on it.
 *
 * The agent works in places the user cannot see — a draft saved to a mailbox,
 * a file written to a drive, a schedule it wrote down — and "show me" is then
 * an instruction to *navigate*, not to describe. This is that instruction: a
 * surface, and enough to say where inside it to land.
 */
export interface WorkspaceRevealDto {
  surface: WorkspaceSurface;
  /**
   * Whether this may move what the user is looking at. False lands the request
   * where it belongs — a draft in its composer — without opening the workspace
   * or fronting a tab, which is how a delegated run writes something the user
   * finds waiting rather than being switched to. Defaults to true.
   */
  focus?: boolean;
  /** Hub, mail half: the mailbox, the folder, and the message to open. */
  mail?: {
    account: string;
    folder?: string;
    /** Folder-relative id. Without one the newest message in the folder wins,
     * which is what "the draft you just wrote" means. */
    messageId?: string;
    /** Narrows that fallback to the newest message carrying this subject. */
    subject?: string;
    /**
     * Opens the mail composer already written, instead of landing on a
     * message. Nothing is saved or sent: the user reads it in the pane they
     * would have typed it in, and decides.
     *
     * `mode` other than "new" answers the message `messageId`/`subject` names:
     * the composer opens as a real reply or forward — recipients, Re:/Fwd:
     * subject, quoted body, threading headers — with `body` above the quote.
     */
    compose?: {
      to?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
      body?: string;
      /** Absolute paths, the same as a message sent outright takes. */
      attachments?: string[];
      importance?: MailImportance;
      mode?: "new" | "reply" | "reply-all" | "forward";
    };
  };
  /**
   * Hub, messaging half: the room to open, by id or by name. `draft` fills
   * that chat's message box without sending — the messaging half's equivalent
   * of `mail.compose`.
   */
  chat?: {id?: string; name?: string; draft?: string; replyTo?: string};
  /** Drive: which source to browse, and the folder to land in. */
  drive?: {source?: string; path?: string};
}

/** The workspace surfaces the agent can ask for by name. */
export type WorkspaceSurface = "hub" | "drive" | "schedule" | "summary";

/**
 * What the workspace looked like for one conversation: which tabs were open,
 * which was front, and whether the drawer was showing. Restored when the chat
 * is reopened — tabs are re-created, not kept live, so a browser tab reloads
 * its url rather than resuming a session.
 */
export interface WorkspaceSnapshotDto {
  tabs: Array<{
    id: string;
    title: string;
    kind: string;
    url?: string;
    favicon?: string | null;
    section?: string;
  }>;
  activeTabId: string | null;
  open: boolean;
}

/**
 * Backends the drive can read and write. `local` is this Mac's filesystem and
 * is always present; the rest are accounts the user connects. Adding one means
 * adding an adapter in `packages/drive` and a case here — nothing else in the
 * drive is provider-aware.
 *
 * `all` is not a backend at all: it is the virtual drive, the union of every
 * connected source. It holds nothing of its own and cannot be connected or
 * disconnected, which is why it carries the `virtual` kind and stays out of
 * the settings list.
 */
/** The application a protocol opens in: its name, and its icon as a data url
 * because a renderer cannot read one off the disk. */
export interface DefaultAppDto {
  name: string;
  /** `data:image/png;base64,...`, drawn at 32px so a 16px glyph stays sharp. */
  icon: string | null;
}

export type DriveProviderId =
  | "all"
  | "local"
  | "network"
  | "google-drive"
  | "dropbox"
  | "onedrive"
  | "s3";

/**
 * How a provider is connected, which is what decides the shape of its settings
 * panel: a folder picker, an OAuth button, or a credentials form.
 */
export type DriveProviderKind = "virtual" | "local" | "network" | "oauth" | "s3";

/**
 * `unconfigured` is distinct from `logged-out` on purpose: the first means this
 * build has no client credentials for the provider so the connect button cannot
 * work at all, the second means it can and the user simply has not used it.
 */
export type DriveProviderState =
  | "connected"
  | "logged-out"
  | "unconfigured"
  | "unavailable"
  | "error";

export interface DriveAccountDto {
  id: string;
  name: string;
  email: string | null;
}

/** Bytes. Either side is null when the provider does not report it — S3 has no
 * quota to read, and some accounts are uncapped. */
export interface DriveUsageDto {
  used: number | null;
  total: number | null;
}

export interface DriveProviderDto {
  id: DriveProviderId;
  name: string;
  kind: DriveProviderKind;
  state: DriveProviderState;
  accounts: DriveAccountDto[];
  usage: DriveUsageDto | null;
  /** The local filesystem root, or the S3 bucket. Null for OAuth providers,
   * which keep their own app folder. */
  root: string | null;
  error: string | null;
}

/**
 * One browsable place in the drive: a provider plus the account it is signed in
 * as. Providers can hold several accounts, so the provider id alone no longer
 * says where a file should go — every drive operation addresses a source.
 *
 * The id is `<provider>#<accountId>`, opaque above the drive manager. The local
 * provider spends its two accounts on the folders the app always offers: the
 * output root and this Mac's home folder.
 */
export interface DriveSourceDto {
  id: string;
  provider: DriveProviderId;
  accountId: string;
  /** The provider's own name — "Google Drive", "This Mac". */
  name: string;
  /** Which account, set only when the provider has more than one signed in.
   * The switcher reads as `<name> – <accountLabel>` when this is set, which is
   * what tells two connected Google accounts apart; with a single account
   * there is nothing to tell apart and this is null. */
  accountLabel: string | null;
  state: DriveProviderState;
  usage: DriveUsageDto | null;
  root: string | null;
  error: string | null;
}

export interface DriveStatusDto {
  providers: DriveProviderDto[];
  /** Every place that can be browsed right now, in the order the switcher
   * should show them: the output folder, this Mac, then connected accounts. */
  sources: DriveSourceDto[];
  /**
   * Write preference, most-preferred first. A new file goes to the first
   * provider in this list that is currently connected, which is how the drive
   * picks a destination without asking every time.
   */
  saveOrder: DriveProviderId[];
}

export interface DriveEntryDto {
  /** Provider-scoped and opaque: a Drive file id, an S3 key, an absolute path. */
  id: string;
  name: string;
  kind: "folder" | "file";
  /** Bytes, or null for folders and anything the provider does not size. */
  size: number | null;
  /** ISO 8601, or null when the provider reports no timestamp. */
  modifiedAt: string | null;
  provider: DriveProviderId;
  /** Where the entry lives, in the provider's own addressing. Pass it back to
   * `list` to descend into a folder. */
  path: string;
  mimeType: string | null;
  /**
   * The provider's own token for *this* version of the entry — a Dropbox rev,
   * an S3 or Graph ETag, mtime and size for a local file. Opaque: it is only
   * ever compared for equality, never parsed or ordered.
   *
   * It is what makes a write conditional. A run that read a file holds the
   * version it read, and its write says "only if the file is still that one",
   * so an edit made in between — by another chat, by the user in the provider's
   * own web page, from their phone — fails the write instead of silently
   * replacing what it never saw. Null means the provider offered none, and the
   * write proceeds unconditionally.
   */
  version?: string | null;
  /**
   * Where the provider shows this file on the web, when it has such a page.
   *
   * Only the cloud providers do: a local or network file lives on a volume and
   * is opened in the OS file browser instead, and an S3 object has no
   * user-facing page at all. Null means there is nothing to open.
   */
  webUrl?: string | null;
}

export interface DriveS3ConfigRequest {
  bucket: string;
  region: string;
  /** Set for S3-compatible services (R2, MinIO, Backblaze); null means AWS. */
  endpoint: string | null;
  accessKeyId: string;
  /** Omitted when editing an existing config to keep the stored secret. */
  secretAccessKey?: string;
  /** Confines the drive to one prefix of the bucket rather than its root. */
  prefix: string | null;
  /** Required by most S3-compatible services, which do not do vhost addressing. */
  forcePathStyle: boolean;
}

/** 0 is Sunday, matching `Date#getDay`. */
export type ScheduleWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * How often a schedule fires, as data rather than prose. The main process
 * computes every next run from these fields and the view renders the same
 * fields as a sentence, so neither side can drift from the other.
 *
 * `time` is 24-hour "HH:MM" read in `timeZone`, defaulting to this Mac's zone.
 */
export type ScheduleFrequencyDto =
  | {kind: "once"; at: number; timeZone?: string}
  | {kind: "hourly"; interval?: number; minute?: number; timeZone?: string}
  | {kind: "daily"; interval?: number; time: string; timeZone?: string}
  | {kind: "weekly"; interval?: number; days: ScheduleWeekday[]; time: string; timeZone?: string}
  | {kind: "monthly"; interval?: number; dayOfMonth: number; time: string; timeZone?: string}
  | {kind: "yearly"; interval?: number; month: number; dayOfMonth: number; time: string; timeZone?: string}
  /**
   * Anything the pickers cannot say — "every 15 minutes on weekdays between 9
   * and 5". Standard five-field cron, read in `timeZone`.
   */
  | {kind: "cron"; expression: string; timeZone?: string};

/**
 * `done` is a one-off that has already fired: it has no next run, so it is
 * neither active nor paused, and the view greys it out rather than showing a
 * cadence that will never come round again.
 */
export type ScheduleStatusDto = "active" | "paused" | "running" | "failed" | "done";

/** One firing, kept so the detail panel can say what the agent actually did. */
export interface ScheduleRunDto {
  id: string;
  startedAt: number;
  finishedAt?: number;
  outcome: "running" | "succeeded" | "failed";
  /** The agent's own account of the run — its closing message, trimmed. */
  summary?: string;
  error?: string;
  /** Where the run happened, so the detail panel can open the full thread. */
  conversationId?: string;
  runId?: string;
}

export interface ScheduleDto {
  id: string;
  title: string;
  /** The instruction the agent runs each time. */
  prompt: string;
  frequency: ScheduleFrequencyDto;
  status: ScheduleStatusDto;
  createdAt: number;
  nextRunAt?: number;
  lastRunAt?: number;
  /** Newest first, capped — the whole history is not worth keeping forever. */
  history: ScheduleRunDto[];
  /** A finished run the user has not opened yet. Drives the blue dot. */
  unread: boolean;
}

export interface ScheduleInput {
  title: string;
  prompt: string;
  frequency: ScheduleFrequencyDto;
}

export interface SchedulePatch {
  title?: string;
  prompt?: string;
  frequency?: ScheduleFrequencyDto;
  /** Only the two states the user can choose; the rest the scheduler owns. */
  status?: "active" | "paused";
}

export interface FlareAIApi {
  extension: {
    /** Whether the browser extension is installed, and whether to prompt. */
    status(): Promise<BrowserExtensionDto>;
    /** Hides the title-bar chip until the extension is seen and lost again. */
    dismiss(): Promise<BrowserExtensionDto>;
    /** Opens the install page in the user's own browser. */
    openInstall(): Promise<void>;
  };
  general: {
    get(): Promise<GeneralSettingsDto>;
    update(settings: GeneralSettingsUpdate): Promise<GeneralSettingsDto>;
    /** Installed build identity, shown in the General settings tab. */
    version(): Promise<AppVersionDto>;
    /** Asks the configured update feed whether a newer build exists. */
    checkForUpdates(): Promise<AppUpdateDto>;
    /** Restarts into a downloaded update. No-op when none is staged. */
    installUpdate(): Promise<AppUpdateDto>;
    /**
     * Posts a sample notification past every switch, so Settings can show
     * whether the OS is letting them through at all. Answers "unsupported"
     * where the platform will never show one.
     */
    testNotification(): Promise<"posted" | "unsupported">;
    /**
     * Network-based approximate location (city-level), used when the
     * platform geolocation service cannot produce a position.
     */
    locate(): Promise<NonNullable<GeneralSettingsDto["location"]>>;
  };
  window: {
    /**
     * Full-screen state of the app window, pushed on every change and once on
     * subscribe. The renderer only reserves room for the macOS traffic lights
     * while they are on screen, which they are not in full screen.
     */
    subscribeFullscreen(listener: (fullscreen: boolean) => void): () => void;
  };
  permissions: {
    ensureFirstRun(): Promise<FirstRunPermissionDto>;
    status(permission: SystemPermissionKind): Promise<SystemPermissionStatus>;
    request(permission: SystemPermissionKind): Promise<SystemPermissionStatus>;
    /**
     * Asks macOS for every grant the app is entitled to ask for and does not
     * already have, in one pass. It is the button behind "ask again": each
     * grant macOS has already decided is left alone, because it shows its
     * dialog once and System Settings is the only place a refusal changes.
     *
     * Answers with the grants that are still not given, so a caller can offer
     * that pane rather than leaving a button that appears to do nothing —
     * which is what a sweep looks like when everything has already been
     * decided and there is no dialog left to raise.
     */
    requestAll(): Promise<AppPermissionKind[]>;
    openSettings(permission: SystemPermissionKind | "location"): Promise<void>;
  };
  dictation: {
    /**
     * Downloads the local speech-to-text model if it is not on the machine
     * yet, so the first press of the microphone transcribes straight away
     * instead of waiting on ~148MB. Safe to call at any time and as often as
     * you like: it resolves immediately once the model is in place, and
     * overlapping calls share the one download.
     */
    prepare(): Promise<void>;
    /**
     * Transcribes a mono 16kHz 16-bit WAV recording with the local
     * speech-to-text engine and resolves to the recognised text.
     *
     * @param final Whether the recording is finished. Passing false marks the
     *   pass as a partial, which trades a little accuracy for latency because
     *   another pass is coming right behind it.
     */
    transcribe(audio: ArrayBuffer, final?: boolean): Promise<string>;
  };
  conversations: {
    list(): Promise<ConversationDto[]>;
    create(title?: string): Promise<ConversationDto>;
    rename(id: ConversationId, title: string): Promise<ConversationDto | null>;
    remove(id: ConversationId): Promise<boolean>;
    messages(id: ConversationId): Promise<MessageDto[]>;
    updateMessage(
      id: string,
      patch: { content?: JsonValue; metadata?: JsonValue; attachments?: string[] },
    ): Promise<MessageDto | null>;
  };
  runs: {
    start(request: StartRunRequest): Promise<StartRunResponse>;
    cancel(runId: RunId): Promise<void>;
    steer(runId: RunId, text: string, messageId?: string): Promise<void>;
    events(runId: RunId, afterSequence?: number): Promise<RunEventDto[]>;
    subscribe(listener: (event: RunEventDto) => void): () => void;
  };
  goals: {
    execute(request: GoalCommandRequest): Promise<GoalDto | null>;
    get(conversationId: ConversationId): Promise<GoalDto | null>;
  };
  workspace: {
    snapshot(conversationId: ConversationId): Promise<WorkspaceSnapshotDto | null>;
    saveSnapshot(conversationId: ConversationId, snapshot: WorkspaceSnapshotDto): Promise<void>;
    /**
     * Grants the page read access to one file on disk and answers with the url
     * that serves it. The url carries a token, never the path, so a page can
     * only ever load a file the host handed it — the same boundary the browser
     * tool draws when it refuses a `file://` url.
     */
    preview(path: string): Promise<string>;
    /** What the agent asks to be shown; the drawer opens on it. */
    subscribeReveal(listener: (request: WorkspaceRevealDto) => void): () => void;
  };
  files: { paths(files: File[]): Promise<string[]> };
  resources: {
    artifacts(conversationId: ConversationId): Promise<ArtifactDto[]>;
    references(conversationId: ConversationId): Promise<ReferenceDto[]>;
    addFiles(conversationId: ConversationId, files: File[]): Promise<ReferenceDto[]>;
  };
  memory: {
    status(): Promise<MemoryStatusDto>;
    setEnabled(enabled: boolean): Promise<MemoryStatusDto>;
  };
  chronicle: {
    status(): Promise<ChronicleStatusDto>;
    setEnabled(enabled: boolean): Promise<ChronicleStatusDto>;
    update(patch: ChronicleSettingsPatchDto): Promise<ChronicleStatusDto>;
    /** Deletes every frame and event captured in the window. */
    forget(since: string, until: string): Promise<ChronicleStatusDto>;
    entries(options?: {
      since?: string;
      until?: string;
      limit?: number;
    }): Promise<ChronicleEntryDto[]>;
  };
  mcp: {
    list(): Promise<McpServerDto[]>;
    reload(): Promise<McpServerDto[]>;
    setEnabled(id: string, enabled: boolean): Promise<McpServerDto[]>;
    saveCustom(request: SaveCustomMcpRequest): Promise<McpServerDto[]>;
    removeCustom(id: string): Promise<McpServerDto[]>;
    searchRegistry(query: string, cursor?: string): Promise<McpRegistryPageDto>;
    /**
     * Scans the MCP configuration files of the other agents installed on this
     * machine, grouped by which one they belong to.
     */
    discover(): Promise<DiscoveredMcpGroupDto[]>;
    /** Copies a discovered server into ~/.flareai/mcp.json, where it becomes
     * an ordinary FlareAI entry: editable, and removable. */
    adopt(groupId: string, serverId: string): Promise<McpServerDto[]>;
    subscribe(listener: (change: McpChangeDto) => void): () => void;
  };
  skills: {
    list(): Promise<SkillDto[]>;
    reload(): Promise<SkillDto[]>;
    /**
     * Fires when the skills directory changes under the tab's feet — most
     * often because the agent just wrote a skill from a recording.
     */
    subscribe(listener: (skills: SkillDto[]) => void): () => void;
    setEnabled(name: string, enabled: boolean): Promise<SkillDto[]>;
    saveCustom(request: SaveCustomSkillRequest): Promise<SkillDto[]>;
    removeCustom(name: string): Promise<SkillDto[]>;
    upload(files: File[]): Promise<SkillDto[]>;
    /**
     * Installs a package from the skills.sh ecosystem (GitHub-backed), e.g.
     * "vercel-labs/skills/find-skills" or a skills.sh / github.com URL.
     */
    install(spec: string): Promise<SkillDto[]>;
    /** Searches the skills.sh directory (minimum two characters). */
    searchRegistry(query: string, limit?: number): Promise<SkillRegistryEntryDto[]>;
    /**
     * Scans the skill directories of the other agents installed on this
     * machine, grouped by which one they belong to.
     */
    discover(): Promise<DiscoveredSkillGroupDto[]>;
    /** Copies a discovered skill's folder into ~/.flareai/skills. */
    adopt(path: string): Promise<SkillDto[]>;
  };
  /**
   * Claude Code plugins: a bundle of skills, MCP servers, commands, agents and
   * hooks installed as one unit from a marketplace. Whatever a plugin brings
   * stays on its own card — the `skills` and `mcp` surfaces above list only
   * what the user added directly.
   */
  plugins: {
    list(): Promise<PluginDto[]>;
    setEnabled(id: string, enabled: boolean): Promise<PluginDto[]>;
    /** Installs `<marketplace>/<plugin>` from an added marketplace. */
    install(id: string): Promise<PluginDto[]>;
    remove(id: string): Promise<PluginDto[]>;
    marketplaces(): Promise<PluginMarketplaceDto[]>;
    /** Adds a marketplace by `owner/repo` or a github.com URL. */
    addMarketplace(source: string): Promise<PluginMarketplaceDto[]>;
    removeMarketplace(id: string): Promise<PluginMarketplaceDto[]>;
    /** Every added marketplace's catalog, filtered by `query` when given. */
    browse(query?: string): Promise<MarketplacePluginDto[]>;
    /**
     * Installs a plugin folder chosen on this machine — one holding a
     * `.claude-plugin/plugin.json` — under the local marketplace, which is
     * where anything not from a repository is filed.
     */
    upload(files: File[]): Promise<PluginDto[]>;
  };
  /**
   * Messaging bridges and email accounts. Linking runs entirely here rather
   * than through a bridge's management room, so a QR scan or cookie sign-in is
   * a step in this API rather than a chat command the user has to type.
   */
  comms: {
    status(): Promise<CommsStatusDto>;
    /**
     * What the hub showed last time, read from disk rather than the network.
     * Called before the first paint: it is what lets the hub open on content
     * instead of a skeleton, and every fetch after it is a correction.
     */
    snapshot(): Promise<HubSnapshotDto>;
    /** Re-probes the hub, every bridge, and every mailbox. */
    refresh(): Promise<CommsStatusDto>;
    /**
     * Starts a bridge that is not running yet, because its platform has just
     * been opened. Safe to fire on hover: a bridge already up makes this a
     * plain status read.
     */
    wake(platform: CommsPlatform): Promise<CommsStatusDto>;
    setHubUrl(baseUrl: string): Promise<CommsStatusDto>;
    /**
     * Sets messaging up with no input from the user: FlareAI creates its own
     * account on the local hub and keeps the token in encrypted storage.
     */
    connect(): Promise<CommsStatusDto>;
    /**
     * Signs in as an existing account instead of provisioning one. Only needed
     * for a hub FlareAI cannot provision into, such as a remote homeserver.
     */
    signIn(userId: string, password: string): Promise<CommsStatusDto>;
    signOut(): Promise<CommsStatusDto>;
    /** Begins a link and resolves to the first step to render. */
    loginStart(platform: CommsPlatform, flowId: string): Promise<CommsLoginStepDto>;
    /** Answers a `user_input` step. */
    loginSubmit(
      platform: CommsPlatform,
      loginId: string,
      stepId: string,
      values: Record<string, string>,
    ): Promise<CommsLoginStepDto>;
    /**
     * Waits out a `display_and_wait` step. Resolves when the remote side acts
     * on the QR or code, so callers should treat it as long-lived.
     */
    loginWait(
      platform: CommsPlatform,
      loginId: string,
      stepId: string,
    ): Promise<CommsLoginStepDto>;
    /**
     * Runs a `cookies` step by opening the network's own sign-in page in a
     * dedicated window and harvesting the session once it lands. Resolves when
     * the user finishes signing in, or rejects if they close the window.
     */
    loginCookies(
      platform: CommsPlatform,
      loginId: string,
      stepId: string,
    ): Promise<CommsLoginStepDto>;
    /** Abandons an in-flight login. */
    loginCancel(platform: CommsPlatform, loginId: string): Promise<CommsStatusDto>;
    /** Unlinks a remote account from a bridge. */
    bridgeLogout(platform: CommsPlatform, accountId: string): Promise<CommsStatusDto>;
    /**
     * Records the values a bridge needs before it can run, then restarts it so
     * they take effect. Used for Telegram's api_id/api_hash pair.
     */
    bridgeSetup(
      platform: CommsPlatform,
      values: Record<string, string>,
    ): Promise<CommsStatusDto>;
    /** Conversations across every linked messaging platform. */
    chats(): Promise<ChatDto[]>;
    /**
     * One page of a conversation, newest first, with the token that reaches
     * the page before it. Scrolling back up a long history is walking that
     * token until it comes back null.
     */
    chatMessages(chatId: string, limit?: number, before?: string): Promise<ChatPageDto>;
    /** `replyTo` quotes an earlier message, the way every network does it. */
    chatSend(chatId: string, text: string, replyTo?: string): Promise<ChatMessageDto>;
    /** Sends files into a conversation, one message each. */
    chatSendFiles(chatId: string, paths: string[]): Promise<void>;
    /** Opens the file picker for the composer's attach button. */
    chatPickFiles(): Promise<string[]>;
    /** Sends a recorded voice note, as bytes rather than a file on disk. */
    chatSendAudio(chatId: string, bytes: Uint8Array, mimetype: string): Promise<void>;
    /** Puts an emoji on a message. */
    chatReact(chatId: string, messageId: string, key: string): Promise<string>;
    /** Takes a reaction back, given the id `chatReact` returned. */
    chatUnreact(chatId: string, reactionId: string): Promise<void>;
    /** Marks a chat read up to `messageId`, clearing its unread count. */
    chatMarkRead(chatId: string, messageId: string): Promise<void>;
    mailFolders(account?: string): Promise<MailFolderDto[]>;
    mailEnvelopes(request: MailListRequest): Promise<MailEnvelopeDto[]>;
    mailMessage(id: string, account?: string, folder?: string): Promise<MailMessageDto>;
    /** Sends, or saves to drafts when `draft` is set. */
    mailSend(request: SendMailRequest): Promise<void>;
    /** Moves messages to another folder — how junk and trash are applied. */
    mailMove(ids: string[], target: string, account?: string, folder?: string): Promise<void>;
    /** Erases messages outright. Emptying trash is this over every id in it. */
    mailDelete(ids: string[], account?: string, folder?: string): Promise<void>;
    /**
     * Saves a message's attachments to the downloads directory and returns
     * where they landed, so the caller can open them.
     */
    mailDownload(id: string, account?: string, folder?: string): Promise<string[]>;
    /** Opens a saved file with whatever the OS uses for it. */
    mailOpenFile(path: string): Promise<void>;
    /** Picks files to attach, returning their paths. Empty if cancelled. */
    mailPickFiles(): Promise<string[]>;
    /** Adds or removes an IMAP flag, e.g. marking a message read. */
    mailFlag(
      ids: string[],
      flag: "seen" | "flagged",
      on: boolean,
      account?: string,
      folder?: string,
    ): Promise<void>;
    emailSave(request: SaveEmailAccountRequest): Promise<CommsStatusDto>;
    emailRemove(id: string): Promise<CommsStatusDto>;
    /** Opens IMAP and SMTP connections to prove the account works. */
    emailTest(id: string): Promise<CommsEmailAccountDto>;
    /**
     * Signs a mailbox in with its provider. The address comes back from the
     * provider, so nothing about the account is asked for first — and an
     * address already set up is converted rather than duplicated.
     */
    emailSignIn(provider: CommsMailProvider): Promise<CommsStatusDto>;
    subscribe(listener: (status: CommsStatusDto) => void): () => void;
    /**
     * Fires as a message lands in a conversation, so the open thread updates
     * as it arrives rather than whenever it is next polled.
     */
    subscribeActivity(listener: (activity: ChatActivityDto) => void): () => void;
  };
  models: {
    list(): Promise<ModelDto[]>;
    select(provider: string, id: string): Promise<ModelDto>;
    /** What every role currently points at. */
    roles(): Promise<ModelRolesDto>;
    /** Points `role` at a model, at the reasoning level chosen with it when the
     * model takes one. Assigning `main` also switches the agent. */
    assignRole(
      role: ModelRole,
      provider: string,
      id: string,
      reasoning?: ReasoningEffort,
    ): Promise<ModelRolesDto>;
    /** Clears a role's override so it follows the main model again. */
    clearRole(role: ModelRole): Promise<ModelRolesDto>;
    /** Catalogue detail for the current models, keyed `<provider>:<id>`. */
    metadata(): Promise<Record<string, ModelMetadataDto>>;
  };
  /**
   * The embedded workspace browser: real Chromium web contents hosted by the
   * main process, positioned under a renderer-measured rectangle. `embedded`
   * is false in the browser demo, where BrowserView falls back to an iframe.
   */
  browser: {
    embedded: boolean;
    /** Answers with the tab's live page, so a pane mounting over a tab that
     * already loaded — every tab the agent opens — knows there is a page there
     * without waiting on a state event that is not coming. */
    open(tabId: string, url?: string): Promise<{url: string; title: string}>;
    navigate(tabId: string, url: string): Promise<void>;
    history(tabId: string, delta: -1 | 1): Promise<void>;
    reload(tabId: string): Promise<void>;
    setBounds(tabId: string, bounds: {x: number; y: number; width: number; height: number}): Promise<void>;
    setVisible(tabId: string, visible: boolean): Promise<void>;
    close(tabId: string): Promise<void>;
    openExternal(url: string): Promise<void>;
    /**
     * The application this Mac opens something with, named and drawn the way
     * the user knows it. A menu offering to hand something over says which
     * application it means — "Open in Helium", with Helium's own icon — rather
     * than "open externally", which names nothing.
     *
     * With no `target` this is the browser web links go to. With a file path it
     * is whatever owns that file's type: "Open in Preview" for a PDF.
     */
    defaultApp(target?: string): Promise<DefaultAppDto | null>;
    /**
     * Reveals a local file in its default application. Separate from
     * `openExternal` because the path comes from model-written markdown: the
     * main process resolves and checks it rather than handing the string to
     * the shell.
     */
    openPath(filePath: string): Promise<void>;
    find(tabId: string, text: string, forward: boolean): Promise<void>;
    stopFind(tabId: string): Promise<void>;
    print(tabId: string): Promise<void>;
    screenshot(tabId: string): Promise<BrowserDownloadDto | null>;
    /**
     * A site icon as a `data:` url, or null when the site has none. Fetched by
     * the main process: the renderer's CSP allows no remote images, so an icon
     * has to arrive as bytes rather than as a url to load.
     */
    favicon(url: string): Promise<string | null>;
    downloads(): Promise<BrowserDownloadDto[]>;
    openDownload(id: string): Promise<void>;
    openDownloadsFolder(): Promise<void>;
    pauseDownload(id: string): Promise<BrowserDownloadDto[]>;
    resumeDownload(id: string): Promise<BrowserDownloadDto[]>;
    cancelDownload(id: string): Promise<BrowserDownloadDto[]>;
    /** Forgets one entry. The file on disk is left where it is — this is the
     * history, not the download. */
    removeDownload(id: string): Promise<BrowserDownloadDto[]>;
    clearDownloads(): Promise<BrowserDownloadDto[]>;
    settings(): Promise<BrowserSettingsDto>;
    /** Passing `downloadDirectory: null` opens the folder picker in the main
     * process, the same way the drive's local root is chosen. */
    updateSettings(
      patch: Partial<Omit<BrowserSettingsDto, "downloadDirectory">> & {
        downloadDirectory?: string | null;
      },
    ): Promise<BrowserSettingsDto>;
    permissions(): Promise<SitePermissionDto[]>;
    setPermission(
      origin: string,
      permission: BrowserPermissionDto,
      decision: PermissionDecisionDto,
    ): Promise<SitePermissionDto[]>;
    /** Drops one site's decisions, or every site's when origin is omitted. */
    clearPermissions(origin?: string): Promise<SitePermissionDto[]>;
    /** Answers a live prompt. `remember` stores the decision for next time. */
    respondToPermission(
      id: string,
      decision: "allow" | "deny",
      remember: boolean,
    ): Promise<void>;
    sites(): Promise<BrowserSiteDto[]>;
    /** Clears one site's cookies, storage and caches. Chromium clears cookies
     * at the registrable domain, so neighbouring subdomains go with it. */
    clearSiteData(origin: string): Promise<BrowserSiteDto[]>;
    /** The whole jar: cookies, storage, caches and history. Saved logins are
     * kept unless `logins` is set. */
    clearBrowsingData(options: {
      cookies: boolean;
      cache: boolean;
      downloads: boolean;
      permissions: boolean;
      logins: boolean;
    }): Promise<void>;
    logins(): Promise<SavedLoginDto[]>;
    saveLogin(
      origin: string,
      username: string,
      password: string,
    ): Promise<SavedLoginDto[]>;
    /** Returns one password in the clear, for a reveal or copy the user asked
     * for. Never called to populate a list. */
    revealLogin(id: string): Promise<string | null>;
    deleteLogin(id: string): Promise<SavedLoginDto[]>;
    /** The browsers found on this machine, with their readable profiles. */
    importSources(): Promise<BrowserSourceDto[]>;
    /** Pages visited, newest first. `query` matches url or title. Named apart
     * from `history` above, which is this tab's back/forward navigation. */
    browsingHistory(options?: {query?: string; limit?: number}): Promise<BrowserHistoryEntryDto[]>;
    forgetHistoryEntry(url: string): Promise<BrowserHistoryEntryDto[]>;
    /** Everything, or just what an import brought in. */
    clearHistory(options?: {source?: "import"}): Promise<BrowserHistoryEntryDto[]>;
    importFrom(request: BrowserImportRequestDto): Promise<BrowserImportResultDto>;
    /** The fallback path: a passwords CSV or a Netscape cookies.txt the user
     * exported themselves. Passing no path opens the file picker. */
    importFile(path?: string): Promise<BrowserImportResultDto>;
    subscribe(listener: (event: BrowserEventDto) => void): () => void;
  };
  /**
   * Files, across every storage backend the user has connected. Browsing is
   * per-provider rather than merged: a path only means something inside the
   * provider that issued it.
   */
  drive: {
    status(): Promise<DriveStatusDto>;
    /** Re-probes every provider's credentials and quota. */
    refresh(): Promise<DriveStatusDto>;
    /**
     * Connects an account. OAuth providers open the provider's own consent page
     * in a dedicated window and resolve once it lands; rejects if the user
     * closes it.
     */
    connect(provider: DriveProviderId): Promise<DriveStatusDto>;
    /** Drops one account's stored credentials. Omitting `accountId`
     * disconnects every account of the provider. */
    disconnect(provider: DriveProviderId, accountId?: string): Promise<DriveStatusDto>;
    setSaveOrder(order: DriveProviderId[]): Promise<DriveStatusDto>;
    /**
     * Points the local provider at the folder agent output is written to.
     * Passing null opens a picker. Defaults to `~/Documents/FlareAI`.
     */
    setLocalRoot(path: string | null): Promise<DriveStatusDto>;
    /**
     * Adds a network share by its mount point. Passing no path opens a folder
     * picker. Several can be connected at once, each its own place in the
     * drive; adding one already there renames it rather than duplicating it.
     */
    addShare(path?: string | null, label?: string): Promise<DriveStatusDto>;
    /**
     * Shows an entry where it actually lives.
     *
     * For this Mac and for a network share that is the OS file browser, which
     * is the honest answer: the file is a file on a volume. Cloud providers
     * have no such place, so they are the caller's to open on the web.
     */
    revealEntry(source: string, path: string): Promise<void>;
    /**
     * Opens the file itself, the way double-clicking it in the OS file browser
     * would. Only for entries that are on a volume; a cloud file has no such
     * path and is opened at its `webUrl` instead.
     */
    openEntry(source: string, path: string): Promise<void>;
    /** Forgets a share. The files on the server are untouched. */
    removeShare(id: string): Promise<DriveStatusDto>;
    saveS3(config: DriveS3ConfigRequest): Promise<DriveStatusDto>;
    /** One folder's contents. `path` empty means the source's root. */
    list(source: string, path?: string): Promise<DriveEntryDto[]>;
    createFolder(source: string, parentPath: string, name: string): Promise<DriveEntryDto>;
    /** Uploads files and folders chosen on this Mac. Empty `paths` opens a
     * picker; a folder is recreated with everything under it. */
    upload(source: string, parentPath: string, paths?: string[]): Promise<DriveEntryDto[]>;
    /** Fetches to the downloads folder and resolves to where it landed. */
    download(source: string, path: string): Promise<string>;
    remove(source: string, paths: string[]): Promise<void>;
    rename(source: string, path: string, name: string): Promise<DriveEntryDto>;
    /** Moves entries into another folder of the same source. */
    move(source: string, paths: string[], destinationFolder: string): Promise<DriveEntryDto[]>;
    /** Duplicates entries alongside themselves. */
    copy(source: string, paths: string[]): Promise<DriveEntryDto[]>;
    subscribe(listener: (status: DriveStatusDto) => void): () => void;
  };
  /**
   * Recurring instructions the agent runs on its own. The main process owns
   * the clock and the run history; the renderer only ever edits and reads.
   */
  schedules: {
    list(): Promise<ScheduleDto[]>;
    create(input: ScheduleInput): Promise<ScheduleDto>;
    update(id: string, patch: SchedulePatch): Promise<ScheduleDto>;
    remove(id: string): Promise<void>;
    /** Fires the schedule now without disturbing its cadence. */
    runNow(id: string): Promise<ScheduleDto>;
    /** Clears the unread mark a finished run left behind. */
    markRead(id: string): Promise<ScheduleDto>;
    subscribe(listener: (items: ScheduleDto[]) => void): () => void;
  };
  providers: {
    list(): Promise<ProviderDto[]>;
    saveApiKey(provider: string, apiKey: string): Promise<ProviderDto>;
    removeApiKey(provider: string, keyId: string): Promise<ProviderDto>;
    createCustom(request: CreateCustomProviderRequest): Promise<ProviderDto>;
    updateCustom(request: UpdateCustomProviderRequest): Promise<ProviderDto>;
    discoverModels(
      request: DiscoverModelsRequest,
    ): Promise<Array<{id: string; name?: string}>>;
    setupLocalRuntime(request: SetupLocalRuntimeRequest): Promise<ProviderDto>;
  };
}
