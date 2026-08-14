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
export interface MemoryDto {
  id: string;
  scope: "user" | "conversation";
  scopeId: string | null;
  kind: string;
  content: string;
  confidence: number;
  updatedAt: string;
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
  rolloutSummaries: number;
  latestMemoryAt: string | null;
  latestRolloutAt: string | null;
}
export interface ChronicleStatusDto {
  enabled: boolean;
  running: boolean;
  directory: string;
  lastCapturedAt: string | null;
  lastError: string | null;
  storedFrames: number;
  storedBytes: number;
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
  currency: "USD" | "AUD" | "EUR" | "GBP" | "SGD" | "JPY" | null;
  speechModeEnabled: boolean;
  timeEnabled: boolean;
  locationEnabled: boolean;
  location: {
    latitude: number;
    longitude: number;
    accuracy: number;
    updatedAt: string;
  } | null;
}
export interface GeneralSettingsUpdate {
  theme?: GeneralSettingsDto["theme"];
  currency?: GeneralSettingsDto["currency"];
  speechModeEnabled?: boolean;
  timeEnabled?: boolean;
  locationEnabled?: boolean;
  location?: GeneralSettingsDto["location"];
}
export type SystemPermissionKind =
  | "microphone"
  | "screen-recording"
  | "accessibility";
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
  source: "official" | "midas" | "codex";
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
export interface SkillDto {
  name: string;
  description: string;
  source: "official" | "codex" | "midas" | "agents" | "bundled" | "configured";
  filePath: string;
  disableModelInvocation: boolean;
  allowedTools: string[];
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

export type RunEventDto = {
  runId: RunId;
  conversationId: ConversationId;
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

export interface StartRunRequest {
  conversationId: ConversationId;
  text: string;
  messageId?: string;
  attachments?: string[];
  asGoal?: boolean;
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
}
export interface BrowserFoundDto {
  tabId: string;
  matches: number;
  activeMatch: number;
}
export type BrowserEventDto =
  | { type: "state"; state: BrowserPageStateDto }
  | { type: "downloads"; downloads: BrowserDownloadDto[] }
  | { type: "found"; found: BrowserFoundDto };

export interface MidasApi {
  general: {
    get(): Promise<GeneralSettingsDto>;
    update(settings: GeneralSettingsUpdate): Promise<GeneralSettingsDto>;
    /**
     * Network-based approximate location (city-level), used when the
     * platform geolocation service cannot produce a position.
     */
    locate(): Promise<NonNullable<GeneralSettingsDto["location"]>>;
  };
  permissions: {
    ensureFirstRun(): Promise<FirstRunPermissionDto>;
    status(permission: SystemPermissionKind): Promise<SystemPermissionStatus>;
    request(permission: SystemPermissionKind): Promise<SystemPermissionStatus>;
    openSettings(permission: SystemPermissionKind | "location"): Promise<void>;
  };
  dictation: {
    /**
     * Transcribes a mono 16kHz 16-bit WAV recording with the local
     * speech-to-text engine and resolves to the recognised text.
     */
    transcribe(audio: ArrayBuffer): Promise<string>;
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
  files: { paths(files: File[]): Promise<string[]> };
  resources: {
    artifacts(conversationId: ConversationId): Promise<ArtifactDto[]>;
    references(conversationId: ConversationId): Promise<ReferenceDto[]>;
    addFiles(conversationId: ConversationId, files: File[]): Promise<ReferenceDto[]>;
  };
  memory: {
    status(): Promise<MemoryStatusDto>;
    setEnabled(enabled: boolean): Promise<MemoryStatusDto>;
    list(conversationId?: ConversationId): Promise<MemoryDto[]>;
    remember(
      content: string,
      conversationId?: ConversationId,
    ): Promise<MemoryDto>;
    forget(id: string): Promise<boolean>;
  };
  chronicle: {
    status(): Promise<ChronicleStatusDto>;
    setEnabled(enabled: boolean): Promise<ChronicleStatusDto>;
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
    searchRegistry(query: string): Promise<McpRegistryEntryDto[]>;
    subscribe(listener: (change: McpChangeDto) => void): () => void;
  };
  skills: {
    list(): Promise<SkillDto[]>;
    reload(): Promise<SkillDto[]>;
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
    searchRegistry(query: string): Promise<SkillRegistryEntryDto[]>;
  };
  models: {
    list(): Promise<ModelDto[]>;
    select(provider: string, id: string): Promise<ModelDto>;
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
    open(tabId: string, url?: string): Promise<void>;
    navigate(tabId: string, url: string): Promise<void>;
    history(tabId: string, delta: -1 | 1): Promise<void>;
    reload(tabId: string): Promise<void>;
    setBounds(tabId: string, bounds: {x: number; y: number; width: number; height: number}): Promise<void>;
    setVisible(tabId: string, visible: boolean): Promise<void>;
    close(tabId: string): Promise<void>;
    openExternal(url: string): Promise<void>;
    find(tabId: string, text: string, forward: boolean): Promise<void>;
    stopFind(tabId: string): Promise<void>;
    print(tabId: string): Promise<void>;
    screenshot(tabId: string): Promise<BrowserDownloadDto | null>;
    downloads(): Promise<BrowserDownloadDto[]>;
    openDownload(id: string): Promise<void>;
    openDownloadsFolder(): Promise<void>;
    subscribe(listener: (event: BrowserEventDto) => void): () => void;
  };
  providers: {
    list(): Promise<ProviderDto[]>;
    saveApiKey(provider: string, apiKey: string): Promise<ProviderDto>;
    removeApiKey(provider: string, keyId: string): Promise<ProviderDto>;
    createCustom(request: CreateCustomProviderRequest): Promise<ProviderDto>;
    updateCustom(request: UpdateCustomProviderRequest): Promise<ProviderDto>;
  };
}
