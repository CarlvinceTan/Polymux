import { existsSync, mkdirSync, readFileSync } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import type { Stats } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  GoalManager,
  MemoryManager,
  PolymuxAgent,
  SkillLoader,
  createComputerTools,
  type AgentPrompts,
  type SkillLoaderOptions,
} from "@polymux/agent";
import { Computer } from "@polymux/computer";
import { ComputerHistoryManager } from "@polymux/computer";
import type { ActiveAgentRun } from "@polymux/core";
import type {
  InferenceModel,
  InferenceService,
  ModelRef,
} from "@polymux/inference";
import { PiInference } from "@polymux/inference/pi";
import type {
  ChatDto,
  MailFolderDto,
  ChatMessageDto,
  SetupLocalRuntimeRequest,
  BrowserExtensionDto,
  BrowserImportResultDto,
  BrowserSettingsDto,
  GeneralSettingsDto,
  GoalCommandRequest,
  McpServerDto,
  PluginDto,
  SaveCustomMcpRequest,
  SaveCustomSkillRequest,
  ModelDto,
  ModelRole,
  ModelRoleAssignmentDto,
  ModelRolesDto,
  ReasoningEffort,
  ProviderDto,
  RunEventDto,
  ScheduleDto,
  SkillDto,
  SkillUploadFile,
  AppPermissionKind,
  SystemPermissionKind,
  SystemPermissionStatus,
  WorkspaceRevealDto,
  JsonValue,
  DefaultAppDto,
  EnqueueManagerJobRequest,
  ManagerSnapshotDto,
} from "@polymux/protocol";
import { createAppleMailSearcher } from "./hub/apple-mail.js";
import {
  channels,
  commsPlatform,
  mailProvider,
  driveProvider,
  driveS3Config,
  driveSource,
  LOCAL_RUNTIMES,
  isAppPermissionKind,
  validateGoalCommand,
  validateSaveEmailAccount,
  validateStartRun,
} from "@polymux/protocol";
import { SqliteStorage } from "@polymux/storage/sqlite";
import type { StoredMessage } from "@polymux/storage";
import { ProfileManager } from "./profiles.js";
import {
  createNativeTools,
  importMcpServers,
  McpManager,
  ToolRegistry,
} from "@polymux/tools";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import {
  createProvider,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
  app,
  dialog,
  nativeTheme,
  Notification,
  safeStorage,
  session,
  shell,
  type BrowserWindow,
  type IpcMain,
  type IpcMainInvokeEvent,
} from "electron";

import { assistantText, eventDto, storedEventDto } from "./backend/dto.js";
import { ChatPool, type JobPriority } from "./agent/chat-pool.js";
import {
  shouldBoundGoalContinuation,
  shouldResumePausedGoal,
  shouldUseGoalProgressContext,
} from "./agent/goal-intent.js";
import {
  managerClaimContextThroughSequence,
  managerContextThroughSequence,
  managerJobRequiresExclusiveRun,
  managerRunCapacity,
} from "./agent/manager-scheduler.js";
import {
  WORKSPACE_BOOT_ID,
  audioBuffer,
  browserHistoryQuery,
  browserImportRequest,
  browserPermission,
  browserSettingsPatch,
  computerHistoryPatch,
  computerHistoryQuery,
  computerHistoryRange,
  clearDataOptions,
  customMcpRequest,
  customSkillRequest,
  json,
  knownRate,
  loginValues,
  mailListRequest,
  number,
  optionalStringArray,
  origin,
  permissionDecision,
  positiveRate,
  required,
  taskCardInput,
  taskCardPatch,
  scheduleInput,
  schedulePatch,
  sendMailRequest,
  skillUploadFiles,
  systemPermission,
  workspaceSnapshot,
} from "./backend/requests.js";
import {
  applyThemeSource,
  browserSettingsPreference,
  browserSettingsUpdate,
  generalSettingsPreference,
  generalSettingsUpdate,
  hasOnboardingFlag,
  reasoningEffort,
} from "./backend/settings.js";
import type { CustomProviderConfig } from "./backend/models.js";
import type { RoleSelection } from "./backend/models.js";
import {
  customProviderPreference,
  customProviderRequest,
  discoverModels,
  discoverModelsRequest,
  MODEL_ROLES,
  modelFromEnvironment,
  modelPreference,
  modelRole,
  modelRolesPreference,
  setupLocalRuntimeRequest,
  updateCustomProviderRequest,
} from "./backend/models.js";
import {
  adoptLegacyMcpConfig,
  approximateLocation,
  browserAppName,
  browserBundleId,
  mimetypeOf,
  skillInstructions,
} from "./backend/host.js";
import { speechModeAfterRoleChange } from "./backend/speech-mode.js";
import { autoRolePicks } from "./backend/role-advisor.js";
import {
  EncryptedCredentialStore,
  OpenCodeCredentialFallback,
} from "./system/credential-store.js";
import {
  appVersion,
  checkForUpdates,
  installUpdate,
  startUpdateChecks,
  stopUpdateChecks,
} from "./system/updater.js";
import { HookEngine } from "./agent/hooks.js";
import { officialSkillsHome } from "./skills/official.js";
import {
  EXTENSION_INSTALL_URL,
  readExtensionStatus,
  readExternalPromptSnapshot,
} from "./browser/extension.js";
import { ProtectedSkillGuard, combineHooks } from "./skills/protected.js";
import { AgentSurfaceServer } from "./agent/surface.js";
import { AgentSurfaceAdapter } from "./agent/surface-adapter.js";
import { createPolymuxUiInspectionTool } from "./agent/ui-inspection.js";
import {
  createCurrentLocationResolutionTool,
  reverseGeocodeCurrentLocation,
} from "./agent/location-resolution.js";
import { refreshLocationForPrompt } from "./agent/prompt-location-refresh.js";
import { createBrowserControlTools } from "./browser/control-tools.js";
import {
  createInAppBrowserBatchTool,
  createInAppBrowserReadTool,
  createInAppBrowserTool,
  type InAppBrowserResearchTool,
} from "./browser/embedded-tools.js";
import { createHubDraftTool, createWorkspaceTool } from "./workspace/tools.js";
import { RunResourceRecorder } from "./agent/run-resources.js";
import { EncryptedApiKeyPool } from "./inference/api-key-pool.js";
import {
  openAICodexInteraction,
  providerOAuthError,
  ProviderOAuthSessions,
} from "./inference/provider-oauth.js";
import { WhisperDictation } from "./system/dictation.js";
import {
  discoverAgentSkills,
  resolveDiscoveredSkill,
} from "./skills/discovery.js";
import { installSkillPackage, searchSkillRegistry } from "./skills/registry.js";
import {
  declaredPermissions,
  permissionsToRequest,
} from "./skills/permissions.js";
import {
  discoverAgentMcpServers,
  resolveDiscoveredMcp,
} from "./mcp/discovery.js";
import { searchMcpRegistry } from "./mcp/registry.js";
import { PluginRegistry } from "./plugins/registry.js";
import { readManifest as readPluginManifest } from "./plugins/manifest.js";
import { ModelCatalog } from "./inference/model-catalog.js";
import {
  Autofill,
  AUTOFILL_CHANNEL,
  autofillMessage,
} from "./browser/autofill.js";
import { BrowsingData } from "./browser/data.js";
import { Downloads } from "./browser/downloads.js";
import { EmbeddedBrowser } from "./browser/embedded.js";
import { EncryptedLoginVault } from "./browser/logins.js";
import { SitePermissions, originOf } from "./browser/permissions.js";
import { applyImport } from "./browser/import/apply.js";
import { discoverBrowsers, importFrom } from "./browser/import/discovery.js";
import { importFromFile } from "./browser/import/files.js";
import type { ImportedData } from "./browser/import/types.js";
import { siteFaviconDataUrl } from "./browser/favicon.js";
import { RotatingInference } from "./inference/rotating.js";
import {
  AccessibilityComputerHistoryFrames,
  ElectronComputerHistorySystem,
} from "./agent/computer-history.js";
import { NativeInteractionEvents } from "./agent/interaction-events.js";
import {
  compactPromptWindows,
  needsFreshDesktopContext,
} from "./agent/environment-context.js";
import { createPerRunCallLimit } from "./agent/tool-budget.js";
import { RecordingCapture } from "./recording/capture.js";
import { createRecordingTool } from "./recording/tools.js";
import { RecordingMenubar } from "./recording/menubar.js";
import { ComputerUseMenubar } from "./computer-use/menubar.js";
import { PillIcon } from "./computer-use/pill-icon.js";
import { WindowControlMonitor } from "./computer-use/monitor.js";
import { AxReader, type AxWindow } from "./system/ax-reader.js";
import { FileReloadWatcher } from "./system/file-reload-watcher.js";
import { DirectoryWatcher } from "./system/directory-watcher.js";
import { polymuxPath } from "./system/paths.js";
import {
  Notifier,
  notificationBody,
  type NotificationRequest,
} from "./system/notifications.js";
import { Scheduler } from "./scheduler/index.js";
import { createScheduleTool } from "./scheduler/tools.js";
import { TaskBoard } from "./tasks/index.js";
import { createTasksTool } from "./tasks/tools.js";
import { Communications } from "./hub/index.js";
import { HubCache } from "./hub/cache.js";
import { Drive, createDriveTools } from "@polymux/drive";
import { electronConsent } from "./system/drive-consent.js";
import { sessionScopedSnapshot } from "./workspace/snapshot.js";
import { PreviewGrants } from "./workspace/preview.js";
import type { Homeserver, MatrixRoom } from "@polymux/hub";
/**
 * How recent a message has to be to be worth announcing. Anything older is
 * history a bridge is catching up on rather than something just said.
 */
// pi-ai normally loads OAuth flows through runtime-relative imports. Electron
// packages the bundled main process without those source-relative files, so
// register the static loaders that pi-ai provides for standalone bundles.
registerBunOAuthFlows();

const MESSAGE_NOTIFICATION_MAX_AGE_MS = 60_000;
/** Remote unlinking happens outside Polymux, so it needs a quiet current-state check. */
const COMMS_STATUS_INTERVAL_MS = 30_000;

/** The part of BridgeHost the backend needs: what is installed, and what is held back. */
interface BridgeInventory {
  inventory: () => Promise<
    {
      platform: string;
      binary: string;
      installed: boolean;
      blocked: { reason: string; permission?: SystemPermissionKind } | null;
    }[]
  >;
  networkConfig: (platform: string) => Promise<Record<string, string>>;
  configureNetwork: (
    platform: string,
    values: Record<string, string>,
  ) => Promise<void>;
  retryBlocked: () => Promise<void>;
  ensure: (platform: string) => Promise<void>;
}
import { cancelCookieLogin, runCookieLogin } from "./hub/cookie-login.js";
import { createCommunicationsTools } from "./hub/tools.js";
import { parse as parseToml } from "smol-toml";
import { FirstRunPermissions } from "./system/first-run-permissions.js";
import { AppPermissions } from "./system/app-permissions.js";
import { ContactLookup } from "./hub/contacts.js";
import { Reminders } from "./reminders/index.js";
import { createRemindersTools } from "./reminders/tools.js";
import {
  openSystemPermissionSettings,
  permissionStatus,
  requestSystemPermission,
  systemPermissionStatus,
  useAppPermissions,
} from "./system/permissions.js";

export interface DesktopBackendOptions {
  dataDirectory: string;
  window: BrowserWindow;
  ipcMain: IpcMain;
  model?: ModelRef;
  toolDirectory?: string;
  officialSkillDirectories?: string[];
  /**
   * Skills that back a first-class surface rather than an optional add-on:
   * always loaded, and kept out of the Skills list because the surface they
   * belong to is where they are configured. The set is the contents of
   * `resources/skills/core`, read at startup, so shipping a skill into that
   * folder is the whole of making it core.
   */
  coreSkills?: string[];
  /**
   * Polymux's own prompts, read from `resources/prompts`. Not skills:
   * they are never listed, never switchable, and never something the model
   * chooses to open — `main.md` is loaded into every run that can delegate,
   * and the rest belong to the judge, the compactor and the memory jobs.
   */
  agentPrompts?: AgentPrompts;
  /** Background automation must never invoke Notification Center or surface a
   * delayed OS prompt above the user's foreground app. */
  suppressSystemNotifications?: boolean;
  /** Isolated background automation must not initialize Squirrel or its macOS
   * background UI. Ordinary packaged sessions still check automatically. */
  suppressAutomaticUpdateChecks?: boolean;
  codexConfigPath?: string;
  /** Path to the bundled native/ax-reader.swift accessibility helper. */
  axReaderSourcePath?: string;
  axEventsSourcePath?: string;
  /** Path to native/pill-image.swift, which draws the Computer Use pill. */
  pillImageSourcePath?: string;
  /** Path to the bundled native/app-permissions.swift privacy helper. */
  appPermissionsSourcePath?: string;
  /** Path to the bundled native/contacts.swift bounded lookup helper. */
  contactsSourcePath?: string;
  /** Path to the bundled native/reminders.swift EventKit helper. */
  remindersSourcePath?: string;
  /** Rebuilds profile-bound services while keeping the app window alive. */
  reloadForProfileChange?: () => void;
  /** Selects the designated default only for a fresh app launch. */
  selectDefaultProfile?: boolean;
  /**
   * The app-scoped message hub. It outlives this backend: closing a window
   * closes the backend, but the hub and its bridges run until the app quits.
   * Absent when the hub failed to start, which degrades messaging to an
   * externally configured deployment.
   */
  hub?: {
    homeserver: Homeserver;
    directory: string;
    bridges?: BridgeInventory;
    /** Brings the in-process WeChat bridge up for Polymux's own account. */
    startWeChat?: (owner: string) => Promise<boolean>;
    /** Takes it back down again, when WeChat is unlinked from the Hub tab. */
    stopWeChat?: () => Promise<void>;
    /**
     * Registers who to tell when a conversation moves. The homeserver is built
     * before the window, so it reports into the host and the host hands the
     * listener over here.
     */
    onActivity?: (
      listener: (activity: {
        roomId: string;
        sender: string;
        senderName: string | null;
        type: string;
        ts: number;
      }) => void,
    ) => void;
  };
}

/**
 * The drawing both icon scripts share: an AppKit image in `source` becomes a
 * base64 PNG in `icon`. Drawn into a 32px bitmap rather than taken at the
 * icon's own 1024px natural size, because that is what a retina row would
 * resample down to anyway.
 */
const JXA_ICON_TO_PNG = `  const px = 32;
  let icon = '';
  if (!source.isNil()) {
    const drawn = $.NSImage.alloc.initWithSize($.NSMakeSize(px, px));
    drawn.lockFocus;
    source.drawInRectFromRectOperationFraction(
      $.NSMakeRect(0, 0, px, px), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1.0);
    drawn.unlockFocus;
    const rep = $.NSBitmapImageRep.alloc.initWithData(drawn.TIFFRepresentation);
    icon = ObjC.unwrap(
      rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $())
        .base64EncodedStringWithOptions(0));
  }
`;

/**
 * Asks LaunchServices which application opens one file, and returns its
 * display name with its icon as base64 PNG. Written as JXA because that is the
 * only way to reach AppKit without a compiled helper; `argv[0]` is the file, so
 * no path is ever spliced into the source.
 */
const FILE_OWNER_SCRIPT = `function run(argv) {
  ObjC.import('AppKit');
  const target = $.NSURL.fileURLWithPath(argv[0]);
  const appUrl = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(target);
  if (appUrl.isNil()) return 'null';
  const appPath = ObjC.unwrap(appUrl.path);
  const source = $.NSWorkspace.sharedWorkspace.iconForFile(appPath);
${JXA_ICON_TO_PNG}
  const name = ObjC.unwrap($.NSFileManager.defaultManager.displayNameAtPath(appPath))
    .replace(/\\.app$/, '');
  return JSON.stringify({name: name, icon: icon});
}`;

/**
 * The icon of an application by the path of its bundle, as base64 PNG — or an
 * empty string once the app is gone and only its row remains. The same JXA
 * route rather than Electron's getFileIcon, which answers with one generic
 * application icon for every bundle; a column of fallbacks reads as data
 * rather than as "nothing".
 */
const APP_ICON_SCRIPT = `function run(argv) {
  ObjC.import('AppKit');
  const source = $.NSWorkspace.sharedWorkspace.iconForFile(argv[0]);
${JXA_ICON_TO_PNG}
  return icon;
}`;

export class DesktopBackend {
  #window: BrowserWindow;
  /** Every Polymux renderer allowed to use the preload API. Detached
   * workspace windows are trusted without becoming the embedded-browser
   * owner represented by `#window`. */
  readonly #trustedWindows = new Map<number, BrowserWindow>();
  readonly #ipcMain: IpcMain;
  readonly #storage: SqliteStorage;
  readonly #profiles: ProfileManager;
  #agent?: PolymuxAgent;
  #model?: ModelRef;
  /** Per-role model overrides, each with the reasoning level it was assigned
   * at. An absent role follows the main model. */
  #roleOverrides: Partial<Record<ModelRole, RoleSelection>> = {};
  readonly #models: MutableModels;
  readonly #customProviders = new Map<string, CustomProviderConfig>();
  readonly #providerOAuth = new ProviderOAuthSessions();
  readonly #credentials: EncryptedCredentialStore;
  readonly #apiKeys: EncryptedApiKeyPool;
  readonly #inference: InferenceService;
  readonly #skills: SkillLoader;
  readonly #coreSkills: ReadonlySet<string>;
  readonly #agentPrompts: AgentPrompts;
  readonly #suppressAutomaticUpdateChecks: boolean;
  readonly #agentSkillOptions: SkillLoaderOptions;
  readonly #goals: GoalManager;
  readonly #memory: MemoryManager;
  readonly #computerHistory: ComputerHistoryManager;
  readonly #computer: Computer;
  readonly #computerSystem: ElectronComputerHistorySystem;
  readonly #interactionEvents: NativeInteractionEvents;
  #computerObservationStarted = false;
  readonly #recording: RecordingCapture;
  readonly #computerUse: ComputerUseMenubar;
  readonly #windowControl: WindowControlMonitor;
  readonly #firstRunPermissions: FirstRunPermissions;
  readonly #reminders: Reminders;
  /**
   * App grants macOS has given a final answer for this session, so the sweep
   * before each run costs nothing once every answer is in. Deliberately not
   * persisted: a restart is the cheapest possible way to notice a grant that
   * changed while the app was not running.
   */
  readonly #permissionsSettled = new Set<AppPermissionKind>();
  readonly #dictation: WhisperDictation;
  readonly #mcp = new McpManager();
  readonly #registry: ToolRegistry;
  readonly #browserResearchTool?: InAppBrowserResearchTool;
  readonly #hooks = new HookEngine();
  readonly #agentSurface = new AgentSurfaceServer();
  readonly #runResources: RunResourceRecorder;
  readonly #managerJobs: ChatPool;
  readonly #drainingManagerConversations = new Set<string>();
  readonly #notifier: Notifier;
  /** Runs a schedule started, so the schedule's own notification is not
   * doubled by the one every finished run would otherwise get. */
  readonly #scheduledRunIds = new Set<string>();
  readonly #scheduler: Scheduler;
  readonly #tasks: TaskBoard;
  readonly #surfaceMenubar = new AgentSurfaceAdapter({
    onStop: () => {
      // "Stop Using <App>" from the Computer Use pill: end browser control
      // and cancel whatever run was driving it.
      for (const lease of this.#agentSurface.snapshot().leases)
        this.#agentSurface.releaseLease(lease.id);
      for (const run of this.#activeRuns.values())
        run.control.cancel(new Error("Stopped from the Computer Use menu"));
    },
  });
  readonly #activeRuns = new Map<string, ActiveAgentRun>();
  /** Conversation id -> the goal continuation run currently working on it. */
  readonly #goalContinuations = new Map<string, string>();
  readonly #mcpToolNames = new Set<string>();
  readonly #registeredChannels: string[] = [];
  readonly #mcpConfigs = new Map<
    string,
    ReturnType<typeof importMcpServers>[number]
  >();
  readonly #plugins = new PluginRegistry();
  /** Read once, on the first thing that needs it. */
  #pluginsLoaded?: Promise<void>;
  /** The namespaced ids of the servers plugins contribute, so the MCP tab can
   * be given everything except them: a plugin is configured on its own card,
   * and a row there that could not be edited or removed would be a dead end. */
  readonly #pluginMcpIds = new Set<string>();
  readonly #mcpConfigPath: string;
  readonly #customSkillDirectory: string;
  readonly #mcpConfigWatcher: FileReloadWatcher;
  readonly #customSkillWatcher: DirectoryWatcher;
  readonly #codexMcpConfigPath: string;
  #mcpReloadPending = false;
  #mcpReloadInFlight?: Promise<McpServerDto[]>;
  #closing = false;
  readonly #modelCatalog: ModelCatalog;
  readonly #embeddedBrowser: EmbeddedBrowser;
  readonly #axReader: AxReader;
  /** Last trusted window listing, retained as a fallback if a refresh fails. */
  #windowSnapshot: { at: number; windows: AxWindow[] } = { at: 0, windows: [] };
  #windowRefresh?: Promise<void>;
  #locationRefresh?: Promise<void>;
  readonly #sitePermissions: SitePermissions;
  readonly #downloads: Downloads;
  readonly #loginVault: EncryptedLoginVault;
  readonly #autofill: Autofill;
  readonly #browsingData: BrowsingData;
  readonly #comms: Communications;
  #commsStatusTimer?: NodeJS.Timeout;
  #commsStatusRefresh?: Promise<void>;
  /** The hub's first screen, kept across quitting. */
  readonly #hubCache: HubCache;
  /** The last folder list read per account, so an envelope page can be cached
   * with the folders it belongs beside — the mail pane needs both, and they
   * arrive on separate calls. */
  readonly #mailFolders = new Map<string, MailFolderDto[]>();
  readonly #drive: Drive;
  /** Pins every run's tools to one folder, overriding the default output
   * folder. Set by tests and by hosts that embed the backend. */
  readonly #toolDirectory: string | undefined;
  readonly #reloadForProfileChange?: () => void;

  constructor(options: DesktopBackendOptions) {
    this.#window = options.window;
    this.#trustedWindows.set(options.window.webContents.id, options.window);
    this.#ipcMain = options.ipcMain;
    this.#toolDirectory = options.toolDirectory;
    this.#reloadForProfileChange = options.reloadForProfileChange;
    this.#coreSkills = new Set(options.coreSkills ?? []);
    this.#agentPrompts = options.agentPrompts ?? {};
    this.#suppressAutomaticUpdateChecks =
      options.suppressAutomaticUpdateChecks === true;
    this.#storage = new SqliteStorage(
      path.join(options.dataDirectory, "polymux.sqlite"),
    );
    this.#profiles = new ProfileManager(
      this.#storage,
      options.dataDirectory,
      polymuxPath(),
      polymuxPath("profiles"),
    );
    if (options.selectDefaultProfile) this.#profiles.selectDefault();
    const activeProfile = this.#profiles.snapshot().activeId;
    const profileDirectory = this.#profiles.directory(activeProfile);
    mkdirSync(profileDirectory, { recursive: true });
    const personalSkills = path.join(profileDirectory, "skills");
    this.#skills = new SkillLoader({
      official: options.officialSkillDirectories,
      personal: personalSkills,
    });
    this.#agentSkillOptions = {
      official: options.officialSkillDirectories,
      personal: personalSkills,
      // Core integrations have no Skills-list toggle, so nothing may switch
      // them off — including a stale preference from before they were core.
      isEnabled: (skill) =>
        this.#coreSkills.has(skill.name) ||
        this.#integrationEnabled("skill-enabled", skill.name),
    };
    this.#managerJobs = new ChatPool(this.#storage);
    this.#credentials = new EncryptedCredentialStore(
      path.join(profileDirectory, "credentials.json"),
      safeStorage,
    );
    this.#apiKeys = new EncryptedApiKeyPool(
      path.join(profileDirectory, "api-keys.json"),
      safeStorage,
    );
    this.#models = builtinModels({
      // The default profile retains the convenient read-only OpenCode login
      // bridge. Named profiles are strict isolation boundaries and may only
      // see credentials saved inside their own profile directory.
      credentials:
        activeProfile === "default"
          ? new OpenCodeCredentialFallback(this.#credentials)
          : this.#credentials,
    });
    for (const config of customProviderPreference(
      this.#profilePreference("custom-providers")?.value,
    ))
      this.#registerCustomProvider(config);
    this.#inference = new RotatingInference(
      new PiInference(this.#models),
      this.#apiKeys,
    );
    this.#goals = new GoalManager(this.#storage);
    this.#memory = new MemoryManager({
      // Outside the Electron data directory on purpose: the vault is plain
      // Markdown meant to be opened, searched, and edited by hand, and it is
      // the same layout Codex keeps at ~/.codex/memories.
      directory: polymuxPath("memories"),
      legacyStorage: this.#storage,
    });
    this.#axReader = new AxReader({
      sourcePath: options.axReaderSourcePath ?? "",
      cacheDirectory: path.join(options.dataDirectory, "bin"),
    });
    // Installed before anything reads a grant, so the first status query has a
    // helper to ask rather than answering "unknown" and offering Settings for
    // a permission that was granted all along.
    useAppPermissions(
      new AppPermissions({
        sourcePath: options.appPermissionsSourcePath ?? "",
        cacheDirectory: path.join(options.dataDirectory, "bin"),
      }),
    );
    this.#reminders = new Reminders({
      sourcePath: options.remindersSourcePath ?? "",
      cacheDirectory: path.join(options.dataDirectory, "bin"),
      access: { ensure: () => this.#requireAppPermission("reminders") },
    });
    this.#interactionEvents = new NativeInteractionEvents({
      sourcePath: options.axEventsSourcePath ?? "",
      cacheDirectory: path.join(options.dataDirectory, "bin"),
    });
    this.#computerSystem = new ElectronComputerHistorySystem();
    this.#computerHistory = new ComputerHistoryManager({
      directory: path.join(options.dataDirectory, "computer-history"),
      frames: new AccessibilityComputerHistoryFrames(this.#axReader),
      system: this.#computerSystem,
    });
    this.#computer = new Computer(() => this.#computerStateInput(), {
      search: ({ query, app, since, until, limit }) =>
        this.#computerHistory.store.search(query, { app, since, until, limit }),
    });
    // Record & Replay runs on its own tap and its own reads: a demonstration
    // the user just asked for must not depend on the ambient history being
    // switched on, or be narrowed by a capture policy written for it.
    this.#recording = new RecordingCapture({
      directory: path.join(options.dataDirectory, "recordings"),
      // Recording is the one thing Polymux does while the user is deliberately
      // in another app, so its state and its controls belong in the menu bar
      // rather than behind the window they just left.
      indicator: new RecordingMenubar({
        onStop: () => void this.#recording.stop("controls_stopped"),
        onCancel: () => void this.#recording.stop("controls_cancelled"),
      }),
      createEvents: () =>
        new NativeInteractionEvents({
          sourcePath: options.axEventsSourcePath ?? "",
          cacheDirectory: path.join(options.dataDirectory, "bin"),
        }),
      readWindow: async () => {
        const snapshot = await this.#axReader.snapshot(process.pid);
        if (!snapshot.trusted || snapshot.skipped || !snapshot.app) return null;
        return {
          app: snapshot.app,
          ...(snapshot.bundleId ? { bundleId: snapshot.bundleId } : {}),
          ...(snapshot.title ? { title: snapshot.title } : {}),
          ...(snapshot.url ? { url: snapshot.url } : {}),
          ...(snapshot.text ? { text: snapshot.text } : {}),
        };
      },
    });
    // Computer Use drives native windows from a skill, through bash — nothing
    // here is called when it takes one. Its lease registry is the one honest
    // signal, so the pill is driven from that rather than from a hook that
    // does not exist.
    this.#computerUse = new ComputerUseMenubar({
      icon: new PillIcon({
        sourcePath: options.pillImageSourcePath ?? "",
        cacheDirectory: path.join(options.dataDirectory, "bin"),
      }),
      onStopAll: () => {
        for (const run of this.#activeRuns.values())
          run.control.cancel(new Error("Stopped from the Computer Use menu"));
        this.#computerUse.hide();
      },
    });
    this.#windowControl = new WindowControlMonitor({
      registryPath: polymuxPath("state", "window-control-leases.json"),
      windows: () => this.#windowSnapshot.windows,
      onChange: (apps) => void this.#computerUse.update(apps),
    });
    this.#dictation = new WhisperDictation({
      modelDirectory: path.join(options.dataDirectory, "whisper"),
    });
    this.#firstRunPermissions = new FirstRunPermissions({
      store: this.#storage,
      status: systemPermissionStatus,
      onReady: () => this.#startComputerObservation(),
    });
    this.#modelCatalog = new ModelCatalog({ cacheDir: options.dataDirectory });
    this.#downloads = new Downloads({
      records: this.#storage,
      preferences: () => {
        const settings = this.#browserSettings();
        return {
          directory: settings.downloadDirectory,
          askWhereToSave: settings.askWhereToSave,
        };
      },
      send: (downloads) => {
        if (!this.#closing && !this.#window.isDestroyed())
          this.#window.webContents.send(channels.browserEvent, {
            type: "downloads",
            downloads,
          });
      },
      shell: {
        openPath: (target) => void shell.openPath(target),
        showItemInFolder: (target) => shell.showItemInFolder(target),
      },
    });
    this.#embeddedBrowser = new EmbeddedBrowser({
      window: options.window,
      downloads: this.#downloads,
      send: (event) => {
        if (!this.#closing && !this.#window.isDestroyed())
          this.#window.webContents.send(channels.browserEvent, event);
      },
      onVisit: (visit) => {
        // Local browsing lands in the same table an import writes to, tagged
        // so "clear what I imported" stays a separate act from clearing what
        // the user did here.
        this.#storage.recordVisit({
          url: visit.url,
          title: visit.title,
          source: "local",
        });
      },
      onTabReset: (tabId) => this.#sitePermissions.dismissTab(tabId),
    });
    this.#loginVault = new EncryptedLoginVault(
      path.join(options.dataDirectory, "logins.json"),
      safeStorage,
    );
    this.#autofill = new Autofill({
      records: this.#storage,
      vault: this.#loginVault,
      enabled: () => this.#browserSettings().autofillEnabled,
      changed: () => {
        if (!this.#closing && !this.#window.isDestroyed())
          this.#window.webContents.send(channels.browserEvent, {
            type: "logins",
          });
      },
    });
    this.#browsingData = new BrowsingData({
      session: () => session.defaultSession,
      records: this.#storage,
    });
    this.#sitePermissions = new SitePermissions({
      records: this.#storage,
      tabIdFor: (contents) => this.#embeddedBrowser.tabIdFor(contents),
      prompt: (prompt) => {
        if (this.#closing || this.#window.isDestroyed()) return;
        this.#window.webContents.send(channels.browserEvent, {
          type: "permission",
          prompt,
        });
        // The run is stopped until this is answered, so it is worth saying so
        // to a user who has looked away.
        this.#notifier.notify({
          kind: "agent-attention",
          title: "Polymux needs your answer",
          body: notificationBody(
            `${prompt.origin || "A page"} is asking for ${prompt.permission}.`,
          ),
        });
      },
    });
    // Polymux's own configuration lives in ~/.polymux next to its skills, not
    // buried in the platform's application-support directory: it is a file the
    // user is meant to be able to open, and a skill or script may be asked to.
    this.#mcpConfigPath = path.join(profileDirectory, "mcp.json");
    adoptLegacyMcpConfig(
      path.join(options.dataDirectory, "mcp.json"),
      this.#mcpConfigPath,
    );
    this.#customSkillDirectory = path.join(profileDirectory, "skills");
    this.#codexMcpConfigPath =
      options.codexConfigPath ?? path.join(homedir(), ".codex", "config.toml");
    this.#mcpConfigWatcher = new FileReloadWatcher(this.#mcpConfigPath, () =>
      this.#requestMcpReload(),
    );
    // A skill most often appears because the agent just wrote one from a
    // recording, and the Skills tab should show it without the user reloading.
    // The directory itself is watched, so an upload or an install lands too.
    this.#customSkillWatcher = new DirectoryWatcher(
      this.#customSkillDirectory,
      () => {
        if (this.#closing || this.#window.isDestroyed()) return;
        try {
          this.#window.webContents.send(
            channels.skillsChanged,
            this.#skillDtos(),
          );
        } catch {
          // A window mid-teardown is not worth failing a file watch over.
        }
      },
      { debounceMs: 500 },
    );
    // A message landing anywhere in the hub is pushed straight to the window,
    // so a conversation on screen updates as it arrives.
    options.hub?.onActivity?.((activity) => {
      if (this.#closing || this.#window.isDestroyed()) return;
      this.#window.webContents.send(channels.commsActivity, {
        chatId: activity.roomId,
        sender: activity.sender,
      });
      // Only what a person actually said, and never the user's own message
      // coming back down their own sync.
      if (activity.type !== "m.room.message") return;
      if (this.#comms?.userId && activity.sender === this.#comms.userId) return;
      // A bridge backfills a conversation's history when it connects, and
      // every one of those events lands here exactly like a live one. They
      // have already been read wherever they came from, so announcing them
      // fires a burst of notifications for messages the user answered days
      // ago; only a message that just arrived is news.
      if (Date.now() - activity.ts > MESSAGE_NOTIFICATION_MAX_AGE_MS) return;
      this.#notifier.notify({
        kind: "message-received",
        title: activity.senderName || activity.sender || "New message",
        body: "Sent you a message.",
      });
    });
    this.#hubCache = new HubCache(this.#storage);
    const contacts = options.contactsSourcePath
      ? new ContactLookup({
          sourcePath: options.contactsSourcePath,
          cacheDirectory: path.join(options.dataDirectory, "bin"),
        })
      : undefined;
    this.#comms = new Communications({
      credentials: this.#credentials,
      appleMailSearch: createAppleMailSearcher(),
      contactLookup: contacts ? (alias) => contacts.find(alias) : undefined,
      // App-scoped and possibly absent; the backend only points comms at it.
      embedded: options.hub
        ? {
            baseUrl: options.hub.homeserver.baseUrl,
            directory: options.hub.directory,
            provision: (localpart) =>
              options.hub!.homeserver.createLocalUser(localpart),
            inventory: options.hub.bridges
              ? () => options.hub!.bridges!.inventory()
              : undefined,
            networkConfig: options.hub.bridges
              ? (platform) => options.hub!.bridges!.networkConfig(platform)
              : undefined,
            configureNetwork: options.hub.bridges
              ? (platform, values) =>
                  options.hub!.bridges!.configureNetwork(platform, values)
              : undefined,
            retryBlocked: options.hub.bridges
              ? () => options.hub!.bridges!.retryBlocked()
              : undefined,
            ensure: options.hub.bridges
              ? (platform) => options.hub!.bridges!.ensure(platform)
              : undefined,
            startWeChat: options.hub.startWeChat,
            stopWeChat: options.hub.stopWeChat,
          }
        : undefined,
      storage: {
        getPreference: (key) => this.#storage.getPreference(key),
        setPreference: (key, value) => this.#storage.setPreference(key, value),
      },
      onChange: (status) => {
        if (!this.#closing && !this.#window.isDestroyed())
          this.#window.webContents.send(channels.commsChanged, status);
      },
      // Parented, so the network's sign-in page opens as a sheet over Polymux
      // rather than as a window that can end up behind it.
      cookieLogin: (request) => runCookieLogin(request, this.#window),
      cancelCookieLogin,
      // The same window seam the drive flow uses, on its own session so that
      // signing into a Google drive and a Gmail mailbox stay separate acts.
      mailConsent: electronConsent(
        () => (this.#window.isDestroyed() ? undefined : this.#window),
        "mail",
      ),
    });
    this.#drive = new Drive({
      storage: {
        getPreference: (key) => this.#storage.getPreference(key),
        setPreference: (key, value) => this.#storage.setPreference(key, value),
      },
      // Drive secrets ride the same OS-encrypted store as the model provider
      // keys, so tokens are never written as plaintext either.
      secrets: {
        read: async (id) => {
          const credential = await this.#credentials.read(id);
          return credential?.type === "api_key" ? credential.key : undefined;
        },
        write: async (id, secret) => {
          await this.#credentials.modify(id, async () => ({
            type: "api_key",
            key: secret,
          }));
        },
        clear: async (id) => {
          await this.#credentials.delete(id);
        },
      },
      pickers: {
        // Parented, so both open as sheets over the app rather than as windows
        // that can end up behind it — an upload picker lost behind the app is
        // indistinguishable from an upload button that does nothing.
        folder: async () => {
          const { dialog } = await import("electron");
          const result = await dialog.showOpenDialog(this.#window, {
            properties: ["openDirectory", "createDirectory"],
            title: "Choose the Drive folder",
          });
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        files: async () => {
          const { dialog } = await import("electron");
          const result = await dialog.showOpenDialog(this.#window, {
            properties: ["openFile", "multiSelections"],
            title: "Upload to Drive",
          });
          return result.canceled ? [] : result.filePaths;
        },
        downloads: () => app.getPath("downloads"),
      },
      consent: electronConsent(() =>
        this.#window.isDestroyed() ? undefined : this.#window,
      ),
      onChange: (status) => {
        if (!this.#closing && !this.#window.isDestroyed())
          this.#window.webContents.send(channels.driveChanged, status);
      },
    });
    this.#runResources = new RunResourceRecorder(this.#storage);
    this.#notifier = new Notifier({
      preferences: () => {
        const general = this.#generalSettings();
        return {
          enabled:
            !options.suppressSystemNotifications &&
            general.notificationsEnabled,
          kinds: general.notifications,
        };
      },
      present: (request) => this.#presentNotification(request),
      supported: () => Notification.isSupported(),
      // The window is re-aimed when one closes and another opens, so this is
      // read at post time rather than captured here.
      focused: () =>
        !this.#closing &&
        !this.#window.isDestroyed() &&
        this.#window.isFocused(),
    });
    // A schedule that fires while the user is elsewhere is the case system
    // notifications exist for, so both outcomes are announced around the run
    // rather than from inside the scheduler, which owns the clock and no UI.
    this.#scheduler = new Scheduler(this.#storage, async (schedule) => {
      try {
        const result = await this.#runSchedule(schedule);
        this.#notifier.notify({
          kind: "schedule-completed",
          title: schedule.title,
          body: notificationBody(
            result.summary ?? "This scheduled task finished.",
          ),
        });
        return result;
      } catch (error) {
        this.#notifier.notify({
          kind: "schedule-failed",
          title: schedule.title,
          body: notificationBody(
            error instanceof Error ? error.message : String(error),
          ),
        });
        throw error;
      }
    });
    this.#scheduler.subscribe((items) => {
      if (!this.#closing && !this.#window.isDestroyed())
        this.#window.webContents.send(channels.schedulesChanged, items);
    });
    this.#tasks = new TaskBoard(this.#managerJobs);
    this.#tasks.subscribe((items) => {
      if (!this.#closing && !this.#window.isDestroyed())
        this.#window.webContents.send(channels.tasksChanged, items);
    });
    this.#registry = new ToolRegistry(
      createNativeTools({
        cwd: (context) => this.#runDirectory(context.runId),
      }),
    );
    for (const tool of createComputerTools(this.#computer))
      this.#registry.register(tool);
    for (const tool of createRemindersTools(this.#reminders))
      this.#registry.register(tool);
    for (const tool of createBrowserControlTools(this.#agentSurface, {
      currentRead: true,
      embeddedBrowser: this.#embeddedBrowser,
      computer: this.#computer,
    }))
      this.#registry.register(tool);
    // The in-app Browser is the default surface for web work, so the agent
    // drives it directly rather than through the user's external browser.
    const inAppBrowserTool = createInAppBrowserTool(this.#embeddedBrowser);
    const boundResearch = createPerRunCallLimit(
        6,
        "The bounded public-research budget is complete. Do not open, read, snapshot, or interact with more research pages; synthesize from the current first-party evidence and state any remaining uncertainty.",
      );
      const workflowActions = new Set([
        "tabs",
        "show",
        "close",
        "get",
        "fill",
        "type",
        "select",
        "check",
        "uncheck",
        "upload",
        "dialog",
        "wait",
      ]);
      this.#registry.register(
        boundResearch(
          inAppBrowserTool,
          (input) =>
            !workflowActions.has(
              String((input as { action?: unknown })?.action ?? ""),
            ),
        ),
      );
      this.#registry.register(
        boundResearch(createInAppBrowserBatchTool(this.#embeddedBrowser)),
      );
      this.#browserResearchTool = createInAppBrowserReadTool(
        this.#embeddedBrowser,
      );
    this.#registry.register(boundResearch(this.#browserResearchTool));
    // The work the agent does lands in places the user cannot see while it
    // happens, so it needs a way to answer "show me" by opening one.
    // Both halves of the workspace surface run off the same revealer: one
    // shows a pane, the other writes into it. Only the showing half is kept
    // from delegated runs.
    this.#registry.register(createWorkspaceTool(this.#workspaceRevealer()));
    this.#registry.register(createHubDraftTool(this.#workspaceRevealer()));
    this.#registry.register(
        createPolymuxUiInspectionTool({
          openSettings: async (mode) => {
            await this.#window.webContents.executeJavaScript(
              `window.dispatchEvent(new CustomEvent("polymux:agent-inspect-settings", {detail: {mode: ${JSON.stringify(mode)}}}))`,
            );
            await new Promise((resolve) => setTimeout(resolve, 350));
          },
          snapshot: async () => {
            const semantic = await this.#window.webContents
              .executeJavaScript(`(() => {
            const visible = (element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
            };
            const images = [...document.images].filter(visible).map((image) => ({
              alt: image.alt || image.getAttribute("aria-label") || "",
              source: image.currentSrc || image.src || "",
              loaded: image.complete && image.naturalWidth > 0,
              width: image.naturalWidth,
              height: image.naturalHeight,
            }));
            return {text: document.body.innerText.slice(0, 12000), images};
          })()`);
            const image = await this.#window.webContents.capturePage();
            return {
              image: {
                data: image.toPNG().toString("base64"),
                mimeType: "image/png" as const,
              },
              text: String(semantic?.text ?? ""),
              images: Array.isArray(semantic?.images) ? semantic.images : [],
            };
          },
        }),
      );
    this.#registry.register(
        createCurrentLocationResolutionTool({
          current: () => {
            const settings = this.#generalSettings();
            return {
              enabled: settings.locationEnabled,
              location: settings.locationEnabled ? settings.location : null,
            };
          },
          resolve: reverseGeocodeCurrentLocation,
        }),
      );
    // Asking for something to happen every morning is a chat request like any
    // other, so the agent needs a way to write one down.
    this.#registry.register(createScheduleTool(this.#scheduler));
    this.#registry.register(
      createTasksTool(
        this.#tasks,
        (runId) => this.#storage.getRun(runId)?.conversationId ?? null,
      ),
    );
    // Showing the agent a workflow is a chat request too, so the recorder is
    // always present rather than something the user has to switch on first.
    this.#registry.register(createRecordingTool(this.#recording));
    // Messaging and email are app capabilities rather than an MCP server the
    // user has to register, so their tools are always present.
    for (const tool of createCommunicationsTools(this.#comms, {
      searchAllEmail: true,
      searchAllEmailTimeoutMs: 3_500,
    }))
      this.#registry.register(tool);
    // Same reasoning as messaging: the drives the user connected in Settings
    // are an app capability, so the agent can act on all of them without an
    // MCP server standing in between.
    for (const tool of createDriveTools(this.#drive))
      this.#registry.register(tool);
    // Loopback only; a failed bind (port in use) degrades to no browser control.
    void this.#agentSurface.start().catch(() => {});
    // Prime the window listing; each turn still awaits a fresh snapshot.
    void this.#refreshOpenWindows();
    // Mirror active computer-use browser leases into the user's Agent Surface
    // menu-bar pill (the ChatGPT-desktop-style Computer Use capsule), when
    // that presentation layer is installed.
    this.#agentSurface.onLeasesChanged = (leases) => {
      if (leases.length === 0)
        void this.#surfaceMenubar.release("polymux-browser");
      else
        void this.#surfaceMenubar.acquireWindow("polymux-browser", {
          appName: browserAppName(),
          bundleId: browserBundleId(),
          windowTitle: leases[0].tab.title || leases[0].tab.url,
          sessionId: "polymux-browser",
        });
    };
    this.#roleOverrides = modelRolesPreference(
      this.#profilePreference("model-roles")?.value,
    );
    if (options.model && process.env.POLYMUX_MODEL_ALL_ROLES === "1") {
      const reasoning =
        reasoningEffort(process.env.POLYMUX_REASONING, "low") ?? "low";
      for (const role of MODEL_ROLES) {
        if (role !== "main")
          this.#roleOverrides[role] = { ...options.model, reasoning };
      }
    }
    const storedModel = modelPreference(
      this.#profilePreference("model")?.value,
    );
    if (options.model) this.#selectModel(options.model, false);
    else if (storedModel && this.#inference.getModel(storedModel))
      this.#selectModel(storedModel, false);
    // Providers may have changed while the app was closed; selection above
    // already built the agent with the effective roles, so this only settles
    // the speech-mode consequence of the current automatic picks.
    this.#reconcileAutoRoles(false);
  }

  /**
   * Points the backend at a fresh app window after the previous one closed.
   * Everything long-lived — runs, storage, MCP connections, the works — kept
   * going while no window existed; only the event sink and the IPC frame
   * guard need re-aiming.
   */
  /** Credentials for the bridged-media protocol handler. See `comms-media.ts`. */
  /**
   * Which application this Mac hands a web link to.
   *
   * Read rather than remembered: the answer is a LaunchServices lookup, and a
   * user who changes their default browser expects the next menu to say so.
   * The icon is redrawn at 32px so a 16px glyph is sharp on a retina screen,
   * and arrives as a data url because a page cannot read one off the disk.
   */
  async #defaultApp(target?: string): Promise<DefaultAppDto | null> {
    if (target) return this.#appForFile(target);
    try {
      const { app } = await import("electron");
      const info = await app.getApplicationInfoForProtocol("http://");
      if (!info?.name) return null;
      const icon = info.icon?.isEmpty() ? null : info.icon;
      return {
        name: info.name,
        icon: icon ? icon.resize({ width: 32, height: 32 }).toDataURL() : null,
      };
    } catch {
      // A platform or a machine that cannot say. The menu falls back to naming
      // the browser generically rather than to nothing at all.
      return null;
    }
  }

  /**
   * Which application owns a *file*, which Electron has no answer for:
   * `getApplicationInfoForProtocol` speaks only of protocols, and
   * `getFileIcon` hands back the same generic application icon for every
   * bundle, so neither can say "Preview" and draw Preview's icon.
   *
   * LaunchServices can, through AppKit, and `osascript` reaches AppKit without
   * a helper to compile or ship. The icon is drawn into a bitmap at the size
   * it will be shown rather than taken at its natural size, because an app
   * icon's natural size is 1024px.
   */
  async #appForFile(filePath: string): Promise<DefaultAppDto | null> {
    // Keyed by extension: what opens a `.pdf` is a property of the type, not
    // of the file, and a menu opened twice should not ask macOS twice.
    const key = path.extname(filePath).toLowerCase();
    const cached = this.#fileApps.get(key);
    if (cached !== undefined) return cached;
    let answer: DefaultAppDto | null = null;
    try {
      const { stdout } = await promisify(execFile)(
        "osascript",
        ["-l", "JavaScript", "-e", FILE_OWNER_SCRIPT, filePath],
        { timeout: 4000, maxBuffer: 1024 * 1024 },
      );
      const parsed: unknown = JSON.parse(stdout.trim() || "null");
      if (parsed && typeof parsed === "object" && "name" in parsed) {
        const { name, icon } = parsed as { name?: unknown; icon?: unknown };
        if (typeof name === "string" && name)
          answer = {
            name,
            icon:
              typeof icon === "string" && icon
                ? `data:image/png;base64,${icon}`
                : null,
          };
      }
    } catch {
      // No answer is a fair answer: the menu names the choice generically.
      answer = null;
    }
    // Only a type that resolved is remembered, so a transient failure — a
    // timeout under load — is asked again rather than cached as "nothing".
    if (answer) this.#fileApps.set(key, answer);
    return answer;
  }

  readonly #fileApps = new Map<string, DefaultAppDto>();

  get mediaAuth(): { homeserverUrl: string; token: string | null } {
    return this.#comms.mediaAuth;
  }

  profileSnapshot() {
    return this.#profiles.snapshot();
  }

  /**
   * The files the renderer may read. Held here rather than beside the protocol
   * handler so that minting a grant is something only a handler can do — the
   * page asks for a path it already knows about, and gets back a url that says
   * nothing about where the file actually is.
   */
  readonly previewGrants = new PreviewGrants();

  attachWindow(window: BrowserWindow): void {
    this.#window = window;
    this.trustWindow(window);
    this.#embeddedBrowser.attachWindow(window);
  }

  /** Grants a secondary Polymux window access to the app IPC surface without
   * moving browser views or changing which window agent reveals target. */
  trustWindow(window: BrowserWindow): void {
    this.#trustedWindows.set(window.webContents.id, window);
    this.#sitePermissions.install(
      window.webContents.session,
      window.webContents,
    );
  }

  untrustWindow(window: BrowserWindow | number): void {
    this.#trustedWindows.delete(
      typeof window === "number" ? window : window.webContents.id,
    );
  }

  /** Rescues the embedded browser's pages before their window is destroyed. */
  detachWindow(): void {
    this.#embeddedBrowser.detachWindow();
  }

  register(): void {
    // The first window never goes through attachWindow, so it installs its
    // permission handlers from here; every later window installs from there.
    this.#sitePermissions.install(
      this.#window.webContents.session,
      this.#window.webContents,
    );
    this.#registerAutofill();
    if (this.#firstRunPermissions.completed()) this.#startComputerObservation();
    this.#scheduler.start();
    this.#handle(channels.profilesList, () => this.#profiles.snapshot());
    this.#handle(channels.profilesCreate, (_event, name: unknown) =>
      this.#profiles.create(required(name, "profile name")),
    );
    this.#handle(
      channels.profilesRename,
      (_event, id: unknown, name: unknown) =>
        this.#profiles.rename(
          required(id, "profile id"),
          required(name, "profile name"),
        ),
    );
    this.#handle(channels.profilesSetDefault, (_event, id: unknown) =>
      this.#profiles.setDefault(required(id, "profile id")),
    );
    this.#handle(channels.profilesDuplicate, (_event, id: unknown) =>
      this.#profiles.duplicate(required(id, "profile id")),
    );
    this.#handle(channels.profilesRemove, async (_event, id: unknown) => {
      const before = this.#profiles.snapshot().activeId;
      const result = await this.#profiles.remove(required(id, "profile id"));
      if (result.activeId !== before)
        setTimeout(() => this.#reloadForProfileChange?.(), 0);
      return result;
    });
    this.#handle(channels.profilesSelect, (_event, id: unknown) => {
      const before = this.#profiles.snapshot().activeId;
      const result = this.#profiles.select(required(id, "profile id"));
      if (result.activeId !== before)
        setTimeout(() => this.#reloadForProfileChange?.(), 0);
      return result;
    });
    // WhatsApp and similar platforms can be unlinked from the phone. Their
    // bridge process stays alive, so process supervision cannot notice that
    // account-state change. Poll the small provisioning status surface and let
    // Communications emit only when its fingerprint actually changes.
    this.#commsStatusTimer = setInterval(() => {
      if (this.#closing || this.#commsStatusRefresh) return;
      this.#commsStatusRefresh = this.#comms
        .status()
        .then((status) => this.#hubCache.putStatus(status))
        .catch((): undefined => undefined)
        .finally(() => {
          this.#commsStatusRefresh = undefined;
        });
    }, COMMS_STATUS_INTERVAL_MS);
    this.#commsStatusTimer.unref();
    // Nothing is asked for here. A permission dialog at launch is one nobody
    // pressed anything to get, and it arrives before there is even a window to
    // explain it — so the grant is asked for where the user is: in onboarding,
    // from the button on its row in Settings, or at the moment something
    // actually needs it. ComputerHistory without the grant captures nothing and says
    // so on its own row, which is the honest state rather than a surprise.
    applyThemeSource(this.#generalSettings().theme);
    // Basic mode owns no memory switches, so it holds them all on.
    if (!this.#generalSettings().advancedMode) this.#enableAllMemory();
    this.#handle(channels.generalGet, () => this.#generalSettings());
    this.#handle(channels.generalUpdate, (_event, value: unknown) => {
      const previous = this.#generalSettings();
      const next = generalSettingsUpdate(value, previous);
      applyThemeSource(next.theme);
      // Basic mode has no Memory tab, so it cannot be the mode that leaves
      // memory switched off with nowhere to switch it back on.
      if (!next.advancedMode && previous.advancedMode !== next.advancedMode)
        this.#enableAllMemory();
      this.#storeGeneralSettings(next);
      // Flipping advanced mode changes which layer answers for the roles, so
      // the automatic consequences are re-derived under the new flag — which
      // can itself store a speech-mode change, so the settings are re-read
      // rather than answered from the pre-reconcile snapshot.
      if (previous.advancedMode !== next.advancedMode)
        this.#reconcileAutoRoles();
      return this.#generalSettings();
    });
    // Deliberately past every switch, including the focus check: this is sent
    // from Settings, where the window is certainly in front, and its whole job
    // is to show whether the OS lets one through. Gating it behind the very
    // switches the user is trying to test would answer the wrong question.
    this.#handle(channels.generalTestNotification, () => {
      if (!Notification.isSupported()) return "unsupported" as const;
      this.#presentNotification({
        kind: "agent-completed",
        title: "Polymux",
        body: "System notifications are working.",
      });
      return "posted" as const;
    });
    this.#handle(channels.generalLocate, () => approximateLocation());
    this.#handle(channels.generalVersion, () => appVersion());
    this.#handle(channels.generalCheckUpdates, () => checkForUpdates());
    this.#handle(channels.generalInstallUpdate, () => installUpdate());
    if (!this.#suppressAutomaticUpdateChecks) startUpdateChecks();
    this.#handle(channels.permissionsStatus, (_event, value: unknown) =>
      permissionStatus(systemPermission(value)),
    );
    this.#handle(channels.permissionsEnsureFirstRun, () =>
      this.#firstRunPermissions.ensure(),
    );
    this.#handle(channels.permissionsRequest, (_event, value: unknown) =>
      requestSystemPermission(systemPermission(value)),
    );
    this.#handle(channels.permissionsRequestAll, () =>
      this.#ensurePermissions(),
    );
    this.#handle(channels.permissionsOpenSettings, (_event, value: unknown) =>
      openSystemPermissionSettings(systemPermission(value, true)),
    );
    this.#handle(channels.dictationPrepare, () => {
      this.#requireMicrophone();
      return this.#dictation.prepare();
    });
    this.#handle(
      channels.dictationTranscribe,
      (_event, audio: unknown, final: unknown) => {
        this.#requireMicrophone();
        return this.#dictation.transcribe(audioBuffer(audio), final !== false);
      },
    );
    this.#handle(channels.conversationsList, () =>
      this.#storage.listConversations(),
    );
    this.#handle(channels.conversationsCreate, (_event, title?: string) =>
      this.#storage.createConversation({
        id: crypto.randomUUID(),
        title: title?.trim() || "New chat",
      }),
    );
    this.#handle(
      channels.conversationsRename,
      (_event, id: string, title: string) =>
        this.#storage.updateConversation(required(id, "conversation id"), {
          title: required(title, "title"),
        }),
    );
    this.#handle(channels.conversationsRemove, async (_event, id: string) => {
      const conversationId = required(id, "conversation id");
      // A run can still be appending durable events after the renderer asks to
      // delete its conversation. Cancelling and settling every run in that
      // conversation first keeps those writes from racing the FK cascade.
      // Repeat once children have settled because a parent may have registered
      // a delegated run immediately before observing cancellation.
      while (true) {
        const active = [...this.#activeRuns.entries()]
          .filter(
            ([runId]) =>
              this.#storage.getRun(runId)?.conversationId === conversationId,
          )
          .map(([, run]) => run);
        if (!active.length) break;
        for (const run of active)
          run.control.cancel(new Error("Conversation deleted"));
        await Promise.allSettled(active.map((run) => run.result));
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      this.#runResources.forget(conversationId);
      const removed = this.#storage.deleteConversation(conversationId);
      if (this.#managerJobs.removeChat(conversationId))
        this.#publishManagerJobs();
      return removed;
    });
    this.#handle(channels.messagesList, (_event, id: string) =>
      this.#storage
        .listMessages(required(id, "conversation id"))
        .map((message) => this.#messageDto(message)),
    );
    this.#handle(
      channels.messagesUpdate,
      (
        _event,
        id: string,
        patch: { content?: unknown; metadata?: unknown; attachments?: unknown },
      ) => {
        const messageId = required(id, "message id");
        const updated = this.#storage.updateMessage(messageId, {
          content:
            patch.content === undefined ? undefined : json(patch.content),
          metadata:
            patch.metadata === undefined ? undefined : json(patch.metadata),
        });
        if (!updated) return null;
        const existingPaths = new Set(
          this.#storage
            .listAttachments(messageId)
            .map((attachment) => attachment.path),
        );
        for (const attachmentPath of optionalStringArray(
          patch.attachments,
          "attachments",
        )) {
          if (existingPaths.has(attachmentPath)) continue;
          this.#storage.addAttachment({
            id: crypto.randomUUID(),
            messageId,
            name: path.basename(attachmentPath),
            path: attachmentPath,
            mimeType: null,
            size: null,
            sha256: null,
          });
          existingPaths.add(attachmentPath);
        }
        return this.#messageDto(updated);
      },
    );
    this.#handle(channels.runsStart, (_event, value: unknown) =>
      this.#startRun(validateStartRun(value)),
    );
    this.#handle(channels.runsCancel, (_event, runId: string) => {
      this.#activeRuns.get(required(runId, "run id"))?.control.cancel();
    });
    this.#handle(
      channels.runsSteer,
      (_event, runId: string, text: string, messageId?: string) => {
        const id = required(runId, "run id");
        const value = required(text, "text");
        const run = this.#storage.getRun(id);
        if (!run) throw new Error(`Run not found: ${id}`);
        // Resolve the live run before persisting: a run that settled between the
        // click and this handler must not leave an orphaned user message behind.
        const active = this.#requireRun(id);
        active.control.steer({
          role: "user",
          content: value,
        });
        this.#storage.appendMessage({
          id: messageId
            ? required(messageId, "message id")
            : crypto.randomUUID(),
          conversationId: run.conversationId,
          runId: id,
          role: "user",
          content: value,
        });
      },
    );
    this.#handle(channels.managerSnapshot, () => this.#managerSnapshot());
    this.#handle(channels.managerEnqueue, (_event, value: unknown) => {
      const request = managerJobRequest(value);
      const visible =
        this.#storage.listMessages(request.chatId).at(-1)?.sequence ?? 0;
      const contextThroughSequence = managerContextThroughSequence({
        jobs: this.#managerJobs.list(request.chatId),
        chatId: request.chatId,
        job: request,
        latestSequence: visible,
      });
      const job = this.#managerJobs.enqueue({
        ...request,
        contextThroughSequence,
      });
      this.#publishManagerJobs();
      void this.#drainManagerConversation(job.chatId);
      return job;
    });
    this.#handle(channels.managerCancel, (_event, id: string) => {
      const job = this.#managerJobs.cancel(required(id, "manager job id"));
      if (job.runId)
        this.#activeRuns
          .get(job.runId)
          ?.control.cancel(new Error(`Manager job ${job.id} cancelled`));
      this.#publishManagerJobs();
      void this.#drainManagerConversation(job.chatId);
      return job;
    });
    this.#handle(
      channels.managerReprioritize,
      (_event, id: string, priority: JobPriority) => {
        const job = this.#managerJobs.reprioritize(
          required(id, "manager job id"),
          managerPriority(priority),
        );
        this.#publishManagerJobs();
        return job;
      },
    );
    this.#handle(
      channels.managerReorder,
      (_event, id: string, targetId: string) => {
        const jobs = this.#managerJobs.reorder(
          required(id, "manager job id"),
          required(targetId, "target manager job id"),
        );
        this.#publishManagerJobs();
        return jobs;
      },
    );
    this.#handle(
      channels.runEventsList,
      (_event, runId: string, afterSequence = 0) => {
        const id = required(runId, "run id");
        const run = this.#storage.getRun(id);
        const conversationId = run?.conversationId ?? "";
        return this.#storage
          .listRunEvents(id, number(afterSequence))
          .map((event) =>
            storedEventDto(event, conversationId, run?.parentRunId ?? null),
          );
      },
    );
    this.#handle(channels.goalsExecute, (_event, value: unknown) =>
      this.#executeGoal(validateGoalCommand(value)),
    );
    this.#handle(channels.goalsGet, (_event, conversationId: string) =>
      this.#goals.get(required(conversationId, "conversation id")),
    );
    this.#handle(channels.schedulesList, () => this.#scheduler.list());
    this.#handle(channels.schedulesCreate, (_event, value: unknown) =>
      this.#scheduler.create(scheduleInput(value)),
    );
    this.#handle(
      channels.schedulesUpdate,
      (_event, id: string, value: unknown) =>
        this.#scheduler.update(
          required(id, "schedule id"),
          schedulePatch(value),
        ),
    );
    this.#handle(channels.schedulesRemove, (_event, id: string) => {
      this.#scheduler.remove(required(id, "schedule id"));
    });
    this.#handle(channels.schedulesRunNow, (_event, id: string) =>
      this.#scheduler.runNow(required(id, "schedule id")),
    );
    this.#handle(channels.schedulesMarkRead, (_event, id: string) =>
      this.#scheduler.markRead(required(id, "schedule id")),
    );
    this.#handle(channels.tasksList, (_event, chatId: string) =>
      this.#tasks.list(required(chatId, "chat id")),
    );
    this.#handle(channels.tasksCreate, (_event, value: unknown) =>
      this.#tasks.create(taskCardInput(value)),
    );
    this.#handle(channels.tasksUpdate, (_event, id: string, value: unknown) =>
      this.#tasks.update(required(id, "card id"), taskCardPatch(value)),
    );
    this.#handle(channels.tasksRemove, (_event, id: string) => {
      this.#tasks.remove(required(id, "card id"));
    });
    this.#handle(channels.tasksMarkRead, (_event, id: string) =>
      this.#tasks.markRead(required(id, "card id")),
    );
    this.#handle(channels.memoryStatus, () => this.#memory.status());
    this.#handle(channels.memoryEntries, () =>
      this.#memory.list().map((entry) => ({
        id: entry.id,
        scope: entry.scope,
        kind: entry.kind,
        content: entry.content,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
    );
    this.#handle(channels.memorySetEnabled, (_event, enabled: boolean) => {
      if (typeof enabled !== "boolean")
        throw new Error("enabled must be a boolean");
      return this.#memory.setEnabled(enabled);
    });
    this.#handle(channels.computerHistoryStatus, () =>
      this.#computerHistory.status(),
    );
    this.#handle(
      channels.computerHistorySetEnabled,
      async (_event, enabled: boolean) => {
        if (typeof enabled !== "boolean")
          throw new Error("enabled must be a boolean");
        if (enabled) await requestSystemPermission("accessibility");
        const status = this.#computerHistory.setEnabled(enabled);
        if (enabled) {
          await this.#computerHistory.captureOnce();
          return this.#computerHistory.status();
        }
        return status;
      },
    );
    this.#handle(channels.computerHistoryUpdate, (_event, value: unknown) =>
      this.#computerHistory.update(computerHistoryPatch(value)),
    );
    this.#handle(
      channels.computerHistoryForget,
      (_event, since: unknown, until: unknown) => {
        const range = computerHistoryRange(since, until);
        return this.#computerHistory.forget(range.since, range.until);
      },
    );
    this.#handle(
      channels.computerHistoryRemoveEntry,
      (_event, value: unknown) =>
        this.#computerHistory.removeEntry(required(value, "history entry id")),
    );
    this.#handle(
      channels.computerHistoryRevealEntry,
      (_event, value: unknown) => {
        const id = required(value, "history entry id");
        const entry = this.#computerHistory.store
          .entries({ limit: Number.MAX_SAFE_INTEGER })
          .find((candidate) => candidate.id === id);
        if (!entry || !existsSync(entry.path))
          throw new Error("History entry is no longer available");
        shell.showItemInFolder(entry.path);
      },
    );
    this.#handle(channels.computerHistoryEntries, (_event, value?: unknown) => {
      const options = computerHistoryQuery(value);
      return this.#computerHistory.store.entries(options);
    });
    // Parented like the other pickers, so it opens as a sheet over the app.
    this.#handle(channels.computerHistoryPickApp, async () => {
      const { dialog } = await import("electron");
      const result = await dialog.showOpenDialog(this.#window, {
        title: "Choose an application",
        defaultPath: "/Applications",
        properties: ["openFile"],
        filters: [{ name: "Applications", extensions: ["app"] }],
      });
      const chosen = result.canceled ? null : (result.filePaths[0] ?? null);
      return chosen ? path.basename(chosen).replace(/\.app$/i, "") : null;
    });
    // The app's own icon, by the name the list holds. A row for an app that
    // has since been removed simply gets no icon back and keeps its glyph.
    this.#handle(
      channels.computerHistoryAppIcon,
      async (_event, value: unknown) => {
        const name = required(value, "application name");
        if (process.platform !== "darwin" || name.includes("/")) return null;
        const bundle = await applicationBundle(name);
        if (!bundle) return null;
        try {
          // Through LaunchServices, the route the open-with menu takes: an app
          // path in, its own icon out.
          const { stdout } = await promisify(execFile)(
            "osascript",
            ["-l", "JavaScript", "-e", APP_ICON_SCRIPT, bundle],
            { timeout: 4000, maxBuffer: 1024 * 1024 },
          );
          const icon = stdout.trim();
          return icon ? `data:image/png;base64,${icon}` : null;
        } catch (error) {
          console.warn(`Could not read the icon for ${name}`, error);
          return null;
        }
      },
    );
    this.#handle(channels.mcpList, () => this.#mcpDtos(this.#mcp.snapshots()));
    this.#handle(channels.mcpReload, () => this.reloadMcp());
    this.#handle(
      channels.mcpSetEnabled,
      async (_event, id: string, enabled: boolean) => {
        this.#setIntegrationEnabled(
          "mcp-enabled",
          required(id, "MCP id"),
          enabled,
        );
        return this.#reloadMcpAfterMutation();
      },
    );
    this.#handle(channels.mcpSaveCustom, async (_event, value: unknown) => {
      await this.#saveCustomMcp(customMcpRequest(value));
      return this.#reloadMcpAfterMutation();
    });
    this.#handle(channels.mcpRemoveCustom, async (_event, id: unknown) => {
      await this.#removeCustomMcp(required(id, "MCP id"));
      return this.#reloadMcpAfterMutation();
    });
    this.#handle(
      channels.mcpSearchRegistry,
      (_event, query: unknown, cursor: unknown) =>
        searchMcpRegistry(
          typeof query === "string" ? query : "",
          typeof cursor === "string" ? cursor : "",
        ),
    );
    this.#handle(channels.mcpDiscover, () =>
      discoverAgentMcpServers(new Set(this.#mcpConfigs.keys())),
    );
    this.#handle(
      channels.mcpAdopt,
      async (_event, groupId: unknown, serverId: unknown) => {
        const found = resolveDiscoveredMcp(
          required(groupId, "MCP group id"),
          required(serverId, "MCP id"),
        );
        await this.#writeMcpConfig((servers) => {
          servers[found.id] = found.entry;
        });
        return this.#reloadMcpAfterMutation();
      },
    );
    this.#handle(
      channels.workspaceSnapshotGet,
      (_event, conversationId: unknown) => {
        const stored = this.#storage.getPreference(
          `workspace-snapshot:${required(conversationId, "conversation id")}`,
        );
        return stored
          ? sessionScopedSnapshot(stored.value, WORKSPACE_BOOT_ID)
          : null;
      },
    );
    this.#handle(
      channels.workspaceSnapshotSave,
      (_event, conversationId: unknown, snapshot: unknown) => {
        this.#storage.setPreference(
          `workspace-snapshot:${required(conversationId, "conversation id")}`,
          // Through the existing json() laundering: optional DTO fields do not
          // satisfy JsonValue's index signature structurally.
          json({
            ...workspaceSnapshot(snapshot),
            bootId: WORKSPACE_BOOT_ID,
          }) as JsonValue,
        );
      },
    );
    // Every read below records what it answered with, so the next launch has
    // it before the network does. The cache is written to, never read from,
    // here: the one read is the snapshot the renderer seeds from.
    this.#handle(channels.commsSnapshot, () => this.#hubCache.snapshot());
    this.#handle(channels.commsStatus, async () => {
      const status = await this.#comms.status();
      this.#hubCache.putStatus(status);
      return status;
    });
    this.#handle(channels.commsRefresh, () => this.#comms.refresh());
    this.#handle(channels.commsEmailSignIn, (provider) =>
      this.#comms.emailSignIn(mailProvider(provider)),
    );
    this.#handle(channels.commsWake, (_event, value: unknown) =>
      this.#comms.wake(commsPlatform(value)),
    );
    this.#handle(channels.commsSetHubUrl, (_event, baseUrl: unknown) =>
      this.#comms.setHubUrl(required(baseUrl, "hub address")),
    );
    this.#handle(channels.commsConnect, () => this.#comms.connect());
    this.#handle(
      channels.commsSignIn,
      (_event, userId: unknown, password: unknown) =>
        this.#comms.signIn(
          required(userId, "Matrix user ID"),
          required(password, "password"),
        ),
    );
    // Signing out takes the copy with it: a stale inbox left on disk is a
    // privacy problem, not merely a wrong screen.
    this.#handle(channels.commsSignOut, async () => {
      const status = await this.#comms.signOut();
      this.#hubCache.clear();
      return status;
    });
    this.#handle(
      channels.commsLoginStart,
      (_event, platform: unknown, flowId: unknown) =>
        this.#comms.loginStart(
          commsPlatform(platform),
          required(flowId, "login method"),
        ),
    );
    this.#handle(
      channels.commsLoginSubmit,
      (
        _event,
        platform: unknown,
        loginId: unknown,
        stepId: unknown,
        values: unknown,
      ) =>
        this.#comms.loginSubmit(
          commsPlatform(platform),
          required(loginId, "login id"),
          required(stepId, "step id"),
          loginValues(values),
        ),
    );
    this.#handle(
      channels.commsLoginWait,
      (_event, platform: unknown, loginId: unknown, stepId: unknown) =>
        this.#comms.loginWait(
          commsPlatform(platform),
          required(loginId, "login id"),
          required(stepId, "step id"),
        ),
    );
    this.#handle(
      channels.commsLoginCookies,
      (_event, platform: unknown, loginId: unknown, stepId: unknown) =>
        this.#comms.loginCookies(
          commsPlatform(platform),
          required(loginId, "login id"),
          required(stepId, "step id"),
        ),
    );
    this.#handle(
      channels.commsLoginCancel,
      (_event, platform: unknown, loginId: unknown) =>
        this.#comms.loginCancel(
          commsPlatform(platform),
          required(loginId, "login id"),
        ),
    );
    this.#handle(
      channels.commsBridgeSetup,
      (_event, platform: unknown, values: unknown) =>
        this.#comms.bridgeSetup(commsPlatform(platform), loginValues(values)),
    );
    // Unlinking an account is a sign-out of that account, so the copy goes
    // with it for the same two reasons: its chats and message bodies must not
    // survive it on disk, and leaving them there is what made the hub open on
    // the *previous* WhatsApp account's conversations after linking a new one.
    // The whole prefix, because `hub:chats` is one blob of every platform's
    // chats and a cached page is keyed by room id alone — neither can be
    // pruned down to one platform, and a cold paint is the entire cost.
    this.#handle(
      channels.commsBridgeLogout,
      async (_event, platform: unknown, accountId: unknown) => {
        const status = await this.#comms.bridgeLogout(
          commsPlatform(platform),
          required(accountId, "account id"),
        );
        this.#hubCache.clear();
        return status;
      },
    );
    // The hub speaks Matrix — rooms and events. The renderer speaks chats and
    // messages, so the shapes are mapped here rather than leaking room ids
    // and mxc uris into the UI.
    this.#handle(channels.commsChats, async () => {
      const rooms = await this.#comms.chats();
      const chats = rooms.map((room): ChatDto => ({
        id: room.roomId,
        name: room.name,
        platform: room.platform,
        avatarUrl: room.avatarUrl,
        unread: room.unread,
        lastActivity: room.lastActivity,
        preview: room.preview,
        group: room.group,
      }));
      this.#hubCache.putChats(chats);
      return chats;
    });
    this.#handle(
      channels.commsChatMessages,
      async (_event, chatId: unknown, limit: unknown, before: unknown) => {
        const result = await this.#comms.readChat(
          required(chatId, "chat id"),
          typeof limit === "number" ? limit : 50,
          typeof before === "string" ? before : undefined,
        );
        const me = this.#comms.userId;
        const page = {
          // Carried through so the reader can walk further back: without it
          // a conversation stops at whatever the first page happened to hold.
          nextBefore: result.nextBefore ?? null,
          messages: result.messages.map((message): ChatMessageDto => ({
            id: message.eventId,
            chatId: message.roomId || required(chatId, "chat id"),
            sender: message.sender,
            senderName: message.senderName || message.sender,
            senderAvatarUrl: message.senderAvatarUrl,
            body: message.body,
            sentAt: message.sentAt,
            mine: Boolean(me) && message.sender === me,
            attachments: message.attachments,
            viewIn: message.viewIn,
            reactions: message.reactions,
            replyTo: message.replyTo,
          })),
        };
        // Only the newest page is worth keeping: it is what a conversation
        // opens on, and a page reached by scrolling back is one the reader is
        // already looking at.
        if (typeof before !== "string")
          this.#hubCache.putChatPage(
            required(chatId, "chat id"),
            page.messages,
            page.nextBefore,
          );
        return page;
      },
    );
    this.#handle(
      channels.commsChatMarkRead,
      async (_event, chatId: unknown, messageId: unknown) => {
        if (this.#generalSettings().hubIncognitoMode) return false;
        await this.#comms.markChatRead(
          required(chatId, "chat id"),
          required(messageId, "message id"),
        );
        return true;
      },
    );
    // The hub answers a send with the event id it minted. The renderer shows
    // the sent message immediately rather than re-reading the room, so it is
    // handed the whole message — an id alone lands in the thread as a blank.
    this.#handle(
      channels.commsChatSend,
      async (
        _event,
        chatId: unknown,
        text: unknown,
        replyTo: unknown,
      ): Promise<ChatMessageDto> => {
        const room = required(chatId, "chat id");
        const body = required(text, "message");
        const answering = typeof replyTo === "string" ? replyTo : undefined;
        const eventId = await this.#comms.sendChat(room, body, answering);
        return {
          id: eventId,
          chatId: room,
          sender: this.#comms.userId ?? "",
          senderName: "You",
          senderAvatarUrl: null,
          body,
          sentAt: new Date().toISOString(),
          mine: true,
          attachments: [],
          reactions: [],
          replyTo: answering ?? null,
        };
      },
    );
    this.#handle(
      channels.commsChatSendFiles,
      async (_event, chatId: unknown, paths: unknown) => {
        const { readFile } = await import("node:fs/promises");
        const files = await Promise.all(
          optionalStringArray(paths, "paths").map(async (file) => ({
            name: path.basename(file),
            mimetype: mimetypeOf(file),
            bytes: new Uint8Array(await readFile(file)),
          })),
        );
        await this.#comms.sendChatFiles(required(chatId, "chat id"), files);
      },
    );
    this.#handle(channels.commsChatPickFiles, async () => {
      const { dialog } = await import("electron");
      const result = await dialog.showOpenDialog({
        properties: ["openFile", "multiSelections"],
        title: "Attach files",
      });
      return result.canceled ? [] : result.filePaths;
    });
    this.#handle(
      channels.commsChatSendAudio,
      async (_event, chatId: unknown, bytes: unknown, mimetype: unknown) => {
        if (!(bytes instanceof Uint8Array))
          throw new Error("voice note must be bytes");
        const type =
          typeof mimetype === "string" && mimetype ? mimetype : "audio/webm";
        // Named for when it was taken, which is all a voice note has to go on.
        const name = `voice-${new Date().toISOString().replace(/[:.]/g, "-")}.${
          type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm"
        }`;
        await this.#comms.sendChatFiles(required(chatId, "chat id"), [
          { name, mimetype: type, bytes },
        ]);
      },
    );
    this.#handle(
      channels.commsChatReact,
      (_event, chatId: unknown, messageId: unknown, key: unknown) =>
        this.#comms.reactToChat(
          required(chatId, "chat id"),
          required(messageId, "message id"),
          required(key, "reaction"),
        ),
    );
    this.#handle(
      channels.commsChatUnreact,
      (_event, chatId: unknown, reactionId: unknown) =>
        this.#comms.unreactChat(
          required(chatId, "chat id"),
          required(reactionId, "reaction id"),
        ),
    );
    this.#handle(
      channels.commsMailFolders,
      async (_event, account: unknown) => {
        const folders = await this.#comms.mailFolders(
          typeof account === "string" ? account : undefined,
        );
        if (typeof account === "string")
          this.#mailFolders.set(account, folders);
        return folders;
      },
    );
    this.#handle(
      channels.commsMailEnvelopes,
      async (_event, value: unknown) => {
        const request = mailListRequest(value);
        const envelopes = await this.#comms.mailEnvelopes(request);
        // The first page of a plain listing is what the mail pane opens on. A
        // search or a later page is where the user went next, and caching it
        // would only push out the screen worth having.
        const folders = request.account
          ? this.#mailFolders.get(request.account)
          : undefined;
        if (
          folders &&
          request.account &&
          request.folder &&
          !request.query &&
          (request.page ?? 1) === 1
        )
          this.#hubCache.putMailbox(
            request.account,
            request.folder,
            folders,
            envelopes,
          );
        return envelopes;
      },
    );
    this.#handle(
      channels.commsMailMessage,
      async (_event, id: unknown, account: unknown, folder: unknown) => {
        const message = await this.#comms.mailMessage(
          required(id, "message id"),
          typeof account === "string" ? account : undefined,
          typeof folder === "string" ? folder : undefined,
        );
        if (typeof account === "string" && typeof folder === "string")
          this.#hubCache.putMail(account, folder, message);
        return message;
      },
    );
    this.#handle(channels.commsMailSend, async (_event, value: unknown) => {
      const request = sendMailRequest(value);
      await this.#comms.emailSend({
        account: request.account,
        to: request.to,
        cc: request.cc ?? [],
        bcc: request.bcc ?? [],
        subject: request.subject,
        body: request.body,
        draft: request.draft,
        attachments: request.attachments,
        importance: request.importance,
        inReplyTo: request.inReplyTo,
        references: request.references,
      });
      // An edited draft replaces the copy it came from; leaving both would
      // make the folder grow a version per save.
      const replaces = request.replacesDraft;
      if (replaces)
        await this.#comms
          .mailDelete([replaces.id], request.account, replaces.folder)
          .catch(() => {});
    });
    this.#handle(
      channels.commsMailDelete,
      (_event, ids: unknown, account: unknown, folder: unknown) =>
        this.#comms.mailDelete(
          optionalStringArray(ids, "ids"),
          typeof account === "string" ? account : undefined,
          typeof folder === "string" ? folder : undefined,
        ),
    );
    this.#handle(
      channels.commsMailDownload,
      (_event, id: unknown, account: unknown, folder: unknown) =>
        this.#comms.mailDownload(
          required(id, "message id"),
          typeof account === "string" ? account : undefined,
          typeof folder === "string" ? folder : undefined,
        ),
    );
    this.#handle(channels.commsMailOpenFile, async (_event, file: unknown) => {
      const { shell } = await import("electron");
      const error = await shell.openPath(required(file, "file path"));
      if (error) throw new Error(error);
    });
    this.#handle(channels.commsMailPickFiles, async () => {
      const { dialog } = await import("electron");
      const result = await dialog.showOpenDialog({
        properties: ["openFile", "multiSelections"],
        title: "Attach files",
      });
      return result.canceled ? [] : result.filePaths;
    });
    this.#handle(
      channels.commsMailMove,
      (
        _event,
        ids: unknown,
        target: unknown,
        account: unknown,
        folder: unknown,
      ) =>
        this.#comms.mailMove(
          optionalStringArray(ids, "ids"),
          required(target, "target folder"),
          typeof account === "string" ? account : undefined,
          typeof folder === "string" ? folder : undefined,
        ),
    );
    this.#handle(
      channels.commsMailFlag,
      (
        _event,
        ids: unknown,
        flag: unknown,
        on: unknown,
        account: unknown,
        folder: unknown,
      ) =>
        this.#comms.mailFlag(
          optionalStringArray(ids, "ids"),
          flag === "flagged" ? "flagged" : "seen",
          on === true,
          typeof account === "string" ? account : undefined,
          typeof folder === "string" ? folder : undefined,
        ),
    );
    this.#handle(channels.commsEmailSave, (_event, value: unknown) =>
      this.#comms.emailSave(validateSaveEmailAccount(value)),
    );
    this.#handle(channels.commsEmailRemove, async (_event, id: unknown) => {
      const status = await this.#comms.emailRemove(required(id, "account id"));
      // Same reason as signing out: the mail of an account that has been
      // removed must not survive it on disk.
      this.#hubCache.clear();
      this.#mailFolders.clear();
      return status;
    });
    this.#handle(channels.commsEmailTest, (_event, id: unknown) =>
      this.#comms.emailTest(required(id, "account id")),
    );
    this.#handle(channels.skillsList, () => this.#skillDtos());
    this.#handle(channels.skillsReload, () => this.#skillDtos());
    this.#handle(
      channels.skillsSetEnabled,
      async (_event, name: string, enabled: boolean) => {
        const skill = required(name, "skill name");
        this.#setIntegrationEnabled("skill-enabled", skill, enabled);
        // Switching a skill on is the moment its grants are worth asking for:
        // the user is here, and the alternative is the agent meeting the refusal
        // on its own halfway through the first thing it is asked to do.
        if (enabled) await this.#ensurePermissions([skill]);
        return this.#skillDtos();
      },
    );
    this.#handle(channels.skillsSaveCustom, async (_event, value: unknown) => {
      await this.#saveCustomSkill(customSkillRequest(value));
      return this.#skillDtos();
    });
    this.#handle(channels.skillsRemoveCustom, async (_event, name: unknown) => {
      await this.#removeCustomSkill(required(name, "skill name"));
      return this.#skillDtos();
    });
    this.#handle(channels.skillsUpload, async (_event, value: unknown) => {
      const installed = await this.#uploadSkill(skillUploadFiles(value));
      await this.#ensurePermissions(installed);
      return this.#skillDtos();
    });
    this.#handle(channels.skillsInstall, async (_event, spec: unknown) => {
      const installed = await installSkillPackage(
        required(spec, "skill package"),
        this.#customSkillDirectory,
      );
      await this.#ensurePermissions(installed.map((skill) => skill.name));
      return this.#skillDtos();
    });
    this.#handle(
      channels.skillsSearchRegistry,
      (_event, query: unknown, limit: unknown) =>
        searchSkillRegistry(
          typeof query === "string" ? query : "",
          typeof limit === "number" && Number.isFinite(limit) ? limit : 15,
        ),
    );
    this.#handle(channels.skillsDiscover, () =>
      discoverAgentSkills(
        new Set(this.#skills.load().skills.map((skill) => skill.name)),
      ),
    );
    this.#handle(channels.skillsAdopt, async (_event, target: unknown) => {
      const adopted = await this.#adoptSkill(required(target, "skill path"));
      await this.#ensurePermissions(adopted ? [adopted] : undefined);
      return this.#skillDtos();
    });
    this.#handle(channels.pluginsList, () => this.#pluginDtos());
    this.#handle(
      channels.pluginsSetEnabled,
      async (_event, id: unknown, enabled: unknown) => {
        this.#setIntegrationEnabled(
          "plugin-enabled",
          required(id, "plugin id"),
          enabled,
        );
        // Switching a plugin off has to stop its servers and drop its skills,
        // both of which the reload is what actually does.
        await this.#reloadMcpAfterMutation();
        return this.#pluginDtos();
      },
    );
    this.#handle(channels.pluginsInstall, async (_event, id: unknown) => {
      await this.#ensurePlugins();
      await this.#plugins.install(required(id, "plugin id"));
      await this.#reloadMcpAfterMutation();
      return this.#pluginDtos();
    });
    this.#handle(channels.pluginsRemove, async (_event, id: unknown) => {
      await this.#ensurePlugins();
      await this.#plugins.remove(required(id, "plugin id"));
      await this.#reloadMcpAfterMutation();
      return this.#pluginDtos();
    });
    this.#handle(channels.pluginsMarketplaces, async () => {
      await this.#ensurePlugins();
      return this.#plugins.marketplaces();
    });
    this.#handle(
      channels.pluginsAddMarketplace,
      async (_event, source: unknown) => {
        await this.#ensurePlugins();
        await this.#plugins.addMarketplace(required(source, "marketplace"));
        return this.#plugins.marketplaces();
      },
    );
    this.#handle(
      channels.pluginsRemoveMarketplace,
      async (_event, id: unknown) => {
        await this.#ensurePlugins();
        await this.#plugins.removeMarketplace(required(id, "marketplace id"));
        return this.#plugins.marketplaces();
      },
    );
    this.#handle(channels.pluginsBrowse, async (_event, query: unknown) => {
      await this.#ensurePlugins();
      const result = await this.#plugins.browse(
        typeof query === "string" ? query : "",
      );
      const errors = Object.values(result.errors);
      // Every marketplace failing is a failure; one of several failing is a
      // shorter list, and saying so would bury the plugins that did arrive.
      if (errors.length && !result.plugins.length) throw new Error(errors[0]!);
      return result.plugins;
    });
    this.#handle(channels.pluginsUpload, async (_event, value: unknown) => {
      await this.#ensurePlugins();
      await this.#uploadPlugin(skillUploadFiles(value));
      await this.#reloadMcpAfterMutation();
      return this.#pluginDtos();
    });
    this.#handle(channels.modelsList, () =>
      this.#inference.listModels().map((model) => this.#modelDto(model)),
    );
    this.#handle(
      channels.modelsSelect,
      async (_event, provider: string, modelId: string) => {
        const ref = {
          provider: required(provider, "provider"),
          id: required(modelId, "model id"),
        };
        await this.#assertProviderConfigured(ref.provider);
        return this.#selectModel(ref);
      },
    );
    this.#handle(channels.modelsRoles, () => this.#modelRoles());
    this.#handle(
      channels.modelsAssignRole,
      (
        _event,
        role: unknown,
        provider: unknown,
        modelId: unknown,
        reasoning: unknown,
      ) => {
        const effort =
          reasoning === undefined ? null : reasoningEffort(reasoning, null);
        if (reasoning !== undefined && !effort)
          throw new Error("reasoning must be a supported reasoning effort");
        return this.#assignRole(modelRole(role), {
          provider: required(provider, "provider"),
          id: required(modelId, "model id"),
          ...(effort ? { reasoning: effort } : {}),
        });
      },
    );
    this.#handle(channels.modelsClearRole, (_event, role: unknown) =>
      this.#clearRole(modelRole(role)),
    );
    this.#handle(channels.modelsMetadata, () =>
      this.#modelCatalog.metadataFor(
        this.#inference
          .listModels()
          .map((model) => ({ provider: model.provider, id: model.id })),
      ),
    );
    this.#handle(channels.workspacePreview, async (_event, target: unknown) => {
      const resolved = required(target, "file path");
      let stats: Stats;
      try {
        stats = await stat(resolved);
      } catch {
        throw new Error(`No such file: ${resolved}`);
      }
      if (!stats.isFile()) throw new Error(`Not a file: ${resolved}`);
      return this.previewGrants.url(resolved);
    });
    this.#handle(channels.browserOpen, (_event, tabId: string, url?: string) =>
      this.#embeddedBrowser.open(required(tabId, "tab id"), url),
    );
    this.#handle(
      channels.browserNavigate,
      (_event, tabId: string, url: string) =>
        this.#embeddedBrowser.navigate(
          required(tabId, "tab id"),
          required(url, "url"),
        ),
    );
    this.#handle(
      channels.browserHistory,
      (_event, tabId: string, delta: -1 | 1) =>
        this.#embeddedBrowser.history(
          required(tabId, "tab id"),
          delta === -1 ? -1 : 1,
        ),
    );
    this.#handle(channels.browserReload, (_event, tabId: string) =>
      this.#embeddedBrowser.reload(required(tabId, "tab id")),
    );
    this.#handle(
      channels.browserSetBounds,
      (
        _event,
        tabId: string,
        bounds: { x: number; y: number; width: number; height: number },
      ) => this.#embeddedBrowser.setBounds(required(tabId, "tab id"), bounds),
    );
    this.#handle(
      channels.browserSetVisible,
      (_event, tabId: string, visible: boolean) =>
        this.#embeddedBrowser.setVisible(
          required(tabId, "tab id"),
          Boolean(visible),
        ),
    );
    this.#handle(channels.browserClose, (_event, tabId: string) =>
      this.#embeddedBrowser.close(required(tabId, "tab id")),
    );
    this.#handle(channels.browserOpenExternal, (_event, url: string) =>
      import("electron").then(({ shell }) =>
        shell.openExternal(required(url, "url")),
      ),
    );
    this.#handle(channels.browserDefaultApp, async (_event, target: unknown) =>
      this.#defaultApp(
        typeof target === "string" && target ? target : undefined,
      ),
    );
    this.#handle(
      channels.browserOpenPath,
      async (_event, filePath: unknown) => {
        // The path arrives from a link in model-written markdown, so it is
        // treated as input: it must be an existing regular file, and it is
        // resolved before the shell ever sees it. Directories and specials are
        // refused rather than handed to the desktop to interpret.
        const resolved = path.resolve(required(filePath, "file path"));
        let stats: Stats;
        try {
          stats = await stat(resolved);
        } catch {
          throw new Error(`No such file: ${resolved}`);
        }
        if (!stats.isFile()) throw new Error(`Not a file: ${resolved}`);
        const { shell } = await import("electron");
        const error = await shell.openPath(resolved);
        if (error) throw new Error(error);
      },
    );
    this.#handle(channels.extensionStatus, () => this.#extensionStatus());
    this.#handle(channels.extensionDismiss, () => {
      this.#storage.setPreference("extension-prompt-dismissed", true);
      return this.#extensionStatus();
    });
    this.#handle(channels.extensionOpenInstall, () =>
      import("electron").then(({ shell }) =>
        shell.openExternal(EXTENSION_INSTALL_URL),
      ),
    );
    this.#handle(channels.browserHistoryList, (_event, options: unknown) =>
      this.#storage.listHistory(browserHistoryQuery(options)),
    );
    this.#handle(channels.browserHistoryForget, (_event, url: unknown) => {
      this.#storage.deleteHistoryEntry(required(url, "url"));
      return this.#storage.listHistory({});
    });
    this.#handle(channels.browserHistoryClear, (_event, options: unknown) => {
      const input =
        options && typeof options === "object"
          ? (options as Record<string, unknown>)
          : {};
      this.#storage.clearHistory(
        input.source === "import" ? { source: "import" } : {},
      );
      return this.#storage.listHistory({});
    });
    this.#handle(channels.browserImportSources, () => discoverBrowsers());
    this.#handle(
      channels.browserImportRun,
      async (_event, request: unknown) => {
        // The browser and profile are looked up from the id rather than taken as
        // a path, so a payload cannot name a file of its own choosing.
        const data = await importFrom(browserImportRequest(request));
        return this.#applyImport(data);
      },
    );
    this.#handle(channels.browserImportFile, async (_event, file: unknown) => {
      const chosen =
        file === undefined || file === null
          ? ((
              await dialog.showOpenDialog(this.#window, {
                properties: ["openFile"],
                filters: [
                  {
                    name: "Exported passwords or cookies",
                    extensions: ["csv", "txt"],
                  },
                ],
              })
            ).filePaths[0] ?? null)
          : required(file, "file");
      if (!chosen)
        return {
          cookiesImported: 0,
          cookiesSkipped: 0,
          passwordsImported: 0,
          passwordsSkipped: 0,
          historyImported: 0,
          historySkipped: 0,
          problems: [],
        };
      return this.#applyImport(await importFromFile(chosen));
    });
    this.#handle(channels.browserSitesList, () => this.#browsingData.sites());
    this.#handle(channels.browserClearSiteData, (_event, site: unknown) =>
      this.#browsingData.clearSite(origin(site)),
    );
    this.#handle(
      channels.browserClearBrowsingData,
      async (_event, options: unknown) => {
        const wanted = clearDataOptions(options);
        await this.#browsingData.clearAll(wanted);
        if (wanted.downloads) this.#downloads.clear();
        if (wanted.permissions) this.#sitePermissions.clear();
        if (wanted.logins) await this.#autofill.clear();
      },
    );
    this.#handle(channels.browserLoginsList, () => this.#autofill.list());
    this.#handle(
      channels.browserLoginSave,
      (_event, site: unknown, username: unknown, password: unknown) =>
        this.#autofill.save(
          origin(site),
          required(username, "username"),
          required(password, "password"),
        ),
    );
    this.#handle(channels.browserLoginReveal, (_event, id: unknown) =>
      this.#autofill.reveal(required(id, "login id")),
    );
    this.#handle(channels.browserLoginDelete, (_event, id: unknown) =>
      this.#autofill.delete(required(id, "login id")),
    );
    this.#handle(channels.browserSettingsGet, () => this.#browserSettings());
    this.#handle(
      channels.browserSettingsUpdate,
      async (_event, patch: unknown) => {
        const requested = browserSettingsPatch(patch);
        // A null directory asks for the picker, which only this side can open.
        // Parented to the window, like the drive's own folder chooser.
        const chosen =
          requested.downloadDirectory === null
            ? ((
                await dialog.showOpenDialog(this.#window, {
                  properties: ["openDirectory", "createDirectory"],
                })
              ).filePaths[0] ?? null)
            : null;
        const settings = browserSettingsUpdate(
          requested,
          this.#browserSettings(),
          chosen,
        );
        this.#storage.setPreference("browser-settings", { ...settings });
        return settings;
      },
    );
    this.#handle(channels.browserPauseDownload, (_event, id: unknown) =>
      this.#downloads.pause(required(id, "download id")),
    );
    this.#handle(channels.browserResumeDownload, (_event, id: unknown) =>
      this.#downloads.resume(required(id, "download id")),
    );
    this.#handle(channels.browserCancelDownload, (_event, id: unknown) =>
      this.#downloads.cancel(required(id, "download id")),
    );
    this.#handle(channels.browserRemoveDownload, (_event, id: unknown) =>
      this.#downloads.remove(required(id, "download id")),
    );
    this.#handle(channels.browserClearDownloads, () => this.#downloads.clear());
    this.#handle(channels.browserPermissionsList, () =>
      this.#sitePermissions.list(),
    );
    this.#handle(
      channels.browserPermissionSet,
      (_event, site: unknown, permission: unknown, decision: unknown) =>
        this.#sitePermissions.set(
          origin(site),
          browserPermission(permission),
          permissionDecision(decision),
        ),
    );
    this.#handle(channels.browserPermissionsClear, (_event, site: unknown) =>
      this.#sitePermissions.clear(
        site === undefined ? undefined : origin(site),
      ),
    );
    this.#handle(
      channels.browserPermissionRespond,
      (_event, id: unknown, decision: unknown, remember: unknown) => {
        this.#sitePermissions.respond(
          required(id, "prompt id"),
          decision === "allow" ? "allow" : "deny",
          remember === true,
        );
      },
    );
    this.#handle(
      channels.browserFind,
      (_event, tabId: string, text: string, forward: boolean) =>
        this.#embeddedBrowser.find(
          required(tabId, "tab id"),
          String(text ?? ""),
          forward !== false,
        ),
    );
    this.#handle(channels.browserStopFind, (_event, tabId: string) =>
      this.#embeddedBrowser.stopFind(required(tabId, "tab id")),
    );
    this.#handle(channels.browserPrint, (_event, tabId: string) =>
      this.#embeddedBrowser.print(required(tabId, "tab id")),
    );
    this.#handle(channels.browserScreenshot, (_event, tabId: string) =>
      this.#embeddedBrowser.screenshot(required(tabId, "tab id")),
    );
    // Links in chat show the site's icon too, and the renderer is no more able
    // to load one there than it is in a tab. The renderer hands over the link's
    // own address rather than a guess at an icon path: which icon is right
    // depends on what the page declares and on the scheme in use, and only this
    // side knows the second of those.
    this.#handle(channels.browserFavicon, (_event, url: string) =>
      siteFaviconDataUrl(session.defaultSession, required(url, "url"), {
        prefersDark: nativeTheme.shouldUseDarkColors,
      }),
    );
    this.#handle(channels.browserDownloadsList, () =>
      this.#embeddedBrowser.downloads(),
    );
    this.#handle(channels.browserOpenDownload, (_event, id: string) =>
      this.#embeddedBrowser.openDownload(required(id, "download id")),
    );
    this.#handle(channels.browserOpenDownloadsFolder, () =>
      this.#embeddedBrowser.openDownloadsFolder(),
    );
    this.#handle(channels.driveStatus, () => this.#drive.status());
    this.#handle(channels.driveRefresh, () => this.#drive.refresh());
    this.#handle(channels.driveConnect, (_event, provider: unknown) =>
      this.#drive.connect(driveProvider(provider)),
    );
    this.#handle(
      channels.driveDisconnect,
      (_event, provider: unknown, accountId: unknown) =>
        this.#drive.disconnect(
          driveProvider(provider),
          typeof accountId === "string" ? accountId : undefined,
        ),
    );
    this.#handle(channels.driveSetSaveOrder, (_event, order: unknown) =>
      this.#drive.setSaveOrder(
        Array.isArray(order) ? order.map((entry) => driveProvider(entry)) : [],
      ),
    );
    this.#handle(channels.driveSetLocalRoot, (_event, target: unknown) =>
      this.#drive.setLocalRoot(typeof target === "string" ? target : null),
    );
    this.#handle(
      channels.driveRevealEntry,
      async (_event, source: unknown, target: unknown) => {
        // `describe` resolves the entry through whichever source holds it, which
        // is what turns a virtual-drive path back into a real one on disk.
        const entry = await this.#drive.describe(
          driveSource(source),
          required(target, "path"),
        );
        const onDisk = entry.path.includes("#")
          ? entry.path.slice(entry.path.indexOf("/") + 1)
          : entry.path;
        // Nothing to say if it cannot be shown — an unmounted share is not an
        // error the user can do anything with from here.
        if (existsSync(onDisk)) shell.showItemInFolder(onDisk);
      },
    );
    this.#handle(
      channels.driveOpenEntry,
      async (_event, source: unknown, target: unknown) => {
        const from = driveSource(source);
        const path_ = required(target, "path");
        const entry = await this.#drive.describe(from, path_);
        const onDisk = entry.path.includes("#")
          ? entry.path.slice(entry.path.indexOf("/") + 1)
          : entry.path;
        // A file on a volume opens where it already is. Silent on failure by
        // design: a share that went away mid-session should do nothing rather
        // than raise an error the user cannot act on.
        if (existsSync(onDisk)) {
          await shell.openPath(onDisk);
          return;
        }
        // Otherwise it lives somewhere with no page to send the user to — an S3
        // object, or any provider that does not publish a link. Fetching it and
        // handing it to the application that owns the type is the nearest thing
        // to opening it, and beats a control that does nothing.
        const downloaded = await this.#drive.download(from, path_);
        await shell.openPath(downloaded);
      },
    );
    this.#handle(
      channels.driveAddShare,
      async (_event, target: unknown, label: unknown) => {
        // No path means the user is choosing one, which is a folder picker over
        // whatever they have mounted rather than a bespoke "browse the network"
        // dialog: macOS already puts shares under /Volumes once they are open.
        const chosen =
          typeof target === "string" && target
            ? target
            : ((
                await dialog.showOpenDialog(this.#window, {
                  properties: ["openDirectory"],
                  defaultPath: "/Volumes",
                })
              ).filePaths[0] ?? null);
        if (!chosen) return this.#drive.status();
        return this.#drive.addShare(
          chosen,
          typeof label === "string" ? label : undefined,
        );
      },
    );
    this.#handle(channels.driveRemoveShare, (_event, id: unknown) =>
      this.#drive.removeShare(required(id, "share")),
    );
    this.#handle(channels.driveSaveS3, (_event, config: unknown) =>
      this.#drive.saveS3(driveS3Config(config)),
    );
    this.#handle(
      channels.driveList,
      (_event, source: unknown, target: unknown) =>
        this.#drive.list(
          driveSource(source),
          typeof target === "string" ? target : "",
        ),
    );
    this.#handle(
      channels.driveCreateFolder,
      (_event, source: unknown, parentPath: unknown, name: unknown) =>
        this.#drive.createFolder(
          driveSource(source),
          typeof parentPath === "string" ? parentPath : "",
          required(name, "folder name"),
        ),
    );
    this.#handle(
      channels.driveUpload,
      (
        event,
        source: unknown,
        parentPath: unknown,
        paths: unknown,
        operationId: unknown,
      ) =>
        this.#drive.upload(
          driveSource(source),
          typeof parentPath === "string" ? parentPath : "",
          Array.isArray(paths)
            ? paths.filter(
                (entry): entry is string => typeof entry === "string",
              )
            : undefined,
          {
            onProgress:
              typeof operationId === "string"
                ? (completed, total) =>
                    event.sender.send(
                      channels.driveProgress,
                      operationId,
                      completed,
                      total,
                    )
                : undefined,
          },
        ),
    );
    this.#handle(
      channels.driveDownload,
      (_event, source: unknown, target: unknown) =>
        this.#drive.download(
          driveSource(source),
          required(target, "file path"),
        ),
    );
    this.#handle(
      channels.driveRemove,
      (_event, source: unknown, paths: unknown) =>
        this.#drive.remove(
          driveSource(source),
          Array.isArray(paths)
            ? paths.filter(
                (entry): entry is string => typeof entry === "string",
              )
            : [],
        ),
    );
    this.#handle(
      channels.driveRename,
      (_event, source: unknown, target: unknown, name: unknown) =>
        this.#drive.rename(
          driveSource(source),
          required(target, "file path"),
          required(name, "name"),
        ),
    );
    this.#handle(
      channels.driveMove,
      (
        event,
        source: unknown,
        paths: unknown,
        destination: unknown,
        operationId: unknown,
      ) =>
        this.#drive.move(
          driveSource(source),
          Array.isArray(paths)
            ? paths.filter(
                (entry): entry is string => typeof entry === "string",
              )
            : [],
          typeof destination === "string" ? destination : "",
          typeof operationId === "string"
            ? (completed, total) =>
                event.sender.send(
                  channels.driveProgress,
                  operationId,
                  completed,
                  total,
                )
            : undefined,
        ),
    );
    this.#handle(
      channels.driveCopy,
      (_event, source: unknown, paths: unknown) =>
        this.#drive.copy(
          driveSource(source),
          Array.isArray(paths)
            ? paths.filter(
                (entry): entry is string => typeof entry === "string",
              )
            : [],
        ),
    );
    this.#handle(channels.providersList, () => this.#providerDtos());
    this.#handle(
      channels.providersSaveApiKey,
      async (_event, providerId: string, apiKey: string) => {
        const id = required(providerId, "provider");
        const provider = this.#models.getProvider(id);
        if (!provider) throw new Error(`Unknown provider: ${id}`);
        if (!provider.auth.apiKey)
          throw new Error(
            `${provider.name} does not support API-key authentication`,
          );
        await this.#apiKeys.add(id, required(apiKey, "API key"));
        const updated = await this.#providerDto(id);
        const currentUsable = this.#model
          ? (await this.#providerDto(this.#model.provider)).configured
          : false;
        if (!currentUsable) {
          const model = this.#inference.listModels(id)[0];
          if (model)
            this.#selectModel({ provider: model.provider, id: model.id });
        }
        this.#reconcileAutoRoles();
        return updated;
      },
    );
    this.#handle(
      channels.providersRemoveApiKey,
      async (_event, providerId: string, keyId: string) => {
        const id = required(providerId, "provider");
        if (!this.#models.getProvider(id))
          throw new Error(`Unknown provider: ${id}`);
        await this.#apiKeys.remove(id, required(keyId, "API key id"));
        this.#reconcileAutoRoles();
        return this.#providerDto(id);
      },
    );
    this.#handle(
      channels.providersConnectOAuth,
      async (event, providerId: string) => {
        const id = required(providerId, "provider");
        const provider = this.#models.getProvider(id);
        if (!provider) throw new Error(`Unknown provider: ${id}`);
        if (!provider.auth.oauth)
          throw new Error(`${provider.name} does not support account login`);
        if (id !== "openai-codex")
          throw new Error(
            "Only OpenAI Codex account login is available in Settings",
          );
        const controller = this.#providerOAuth.begin(id);
        const cancel = () => controller.abort();
        event.sender.once("destroyed", cancel);
        try {
          try {
            await this.#models.login(
              id,
              "oauth",
              openAICodexInteraction(id, controller.signal, (value) => {
                if (!event.sender.isDestroyed())
                  event.sender.send(channels.providersOAuthEvent, value);
              }),
            );
          } catch (reason) {
            throw providerOAuthError(reason);
          }
        } finally {
          event.sender.removeListener("destroyed", cancel);
          this.#providerOAuth.finish(id, controller);
        }
        const updated = await this.#providerDto(id);
        const preferred =
          this.#inference
            .listModels(id)
            .find((model) => model.id === "gpt-5.6-luna") ??
          this.#inference.listModels(id)[0];
        if (preferred) {
          const ref = {
            provider: preferred.provider,
            id: preferred.id,
            reasoning: "low" as const,
          };
          this.#selectModel(ref);
          this.#setReasoningLevel("low");
        }
        this.#reconcileAutoRoles();
        return updated;
      },
    );
    this.#handle(
      channels.providersCancelOAuth,
      (_event, providerId: string) => {
        const id = required(providerId, "provider");
        this.#providerOAuth.cancel(id);
      },
    );
    this.#handle(
      channels.providersDisconnectOAuth,
      async (_event, providerId: string) => {
        const id = required(providerId, "provider");
        const provider = this.#models.getProvider(id);
        if (!provider) throw new Error(`Unknown provider: ${id}`);
        if (!provider.auth.oauth)
          throw new Error(`${provider.name} does not support account login`);
        this.#providerOAuth.cancel(id);
        await this.#models.logout(id);
        this.#roleOverrides = Object.fromEntries(
          Object.entries(this.#roleOverrides).filter(
            ([, ref]) => ref?.provider !== id,
          ),
        );
        this.#persistRoles();
        this.#reconcileAutoRoles(false);
        return this.#providerDto(id);
      },
    );
    this.#handle(
      channels.providersCreateCustom,
      async (_event, value: unknown) => {
        const request = customProviderRequest(value);
        const id = this.#availableCustomProviderId(request.name);
        const config: CustomProviderConfig = {
          id,
          name: request.name,
          baseUrl: request.baseUrl,
          logoDataUrl: request.logoDataUrl,
          models: request.models.map((model) => ({
            id: model.id,
            name: model.name ?? model.id,
          })),
        };
        this.#registerCustomProvider(config);
        this.#persistCustomProviders();
        if (request.apiKey) await this.#apiKeys.add(id, request.apiKey);
        this.#reconcileAutoRoles();
        return this.#providerDto(id);
      },
    );
    this.#handle(
      channels.providersUpdateCustom,
      async (_event, value: unknown) => {
        const request = updateCustomProviderRequest(value);
        if (!this.#customProviders.has(request.id))
          throw new Error(`Unknown custom provider: ${request.id}`);
        const config: CustomProviderConfig = {
          id: request.id,
          name: request.name,
          baseUrl: request.baseUrl,
          logoDataUrl: request.logoDataUrl,
          models: request.models.map((model) => ({
            id: model.id,
            name: model.name ?? model.id,
          })),
        };
        this.#registerCustomProvider(config);
        this.#persistCustomProviders();
        if (this.#model?.provider === request.id) {
          const current = config.models.some(
            (model) => model.id === this.#model!.id,
          );
          this.#selectModel(
            {
              provider: request.id,
              id: current ? this.#model.id : config.models[0]!.id,
            },
            !current,
          );
        }
        this.#reconcileAutoRoles();
        return this.#providerDto(request.id);
      },
    );
    this.#handle(channels.providersDiscoverModels, (_event, value: unknown) =>
      discoverModels(discoverModelsRequest(value)),
    );
    this.#handle(
      channels.providersSetupLocalRuntime,
      (_event, value: unknown) =>
        this.#setupLocalRuntime(setupLocalRuntimeRequest(value)),
    );
    this.#handle(channels.artifactsList, (_event, conversationId: string) =>
      this.#storage.listArtifacts(required(conversationId, "conversation id")),
    );
    this.#handle(channels.referencesList, (_event, conversationId: string) =>
      this.#storage.listReferences(required(conversationId, "conversation id")),
    );
    this.#handle(
      channels.referencesAddFiles,
      (
        _event,
        conversationId: string,
        files: Array<{
          name: string;
          path: string;
          mimeType: string | null;
          size: number;
        }>,
      ) => {
        const id = required(conversationId, "conversation id");
        if (!Array.isArray(files)) throw new Error("files must be an array");
        return files.map((file) =>
          this.#storage.createReference({
            id: crypto.randomUUID(),
            conversationId: id,
            kind: "file",
            title: required(file.name, "file name"),
            uri: required(file.path, "file path"),
            metadata: { mimeType: file.mimeType, size: file.size },
          }),
        );
      },
    );
    this.#mcpConfigWatcher.start();
    this.#customSkillWatcher.start();
    this.#windowControl.start();
    queueMicrotask(() => {
        for (const conversationId of new Set(
          this.#managerJobs
            .list()
            .filter((job) => job.status === "queued")
            .map((job) => job.chatId),
        ))
          void this.#drainManagerConversation(conversationId);
    });
  }

  async reloadMcp(): Promise<McpServerDto[]> {
    if (this.#mcpReloadInFlight) return this.#mcpReloadInFlight;
    const reload = this.#performMcpReload();
    this.#mcpReloadInFlight = reload;
    try {
      return await reload;
    } finally {
      if (this.#mcpReloadInFlight === reload)
        this.#mcpReloadInFlight = undefined;
      if (
        this.#mcpReloadPending &&
        this.#activeRuns.size === 0 &&
        !this.#closing
      )
        queueMicrotask(() => this.#requestMcpReload());
    }
  }

  async #performMcpReload(): Promise<McpServerDto[]> {
    await this.#migrateCodexMcpConfig();
    const source = await readFile(this.#mcpConfigPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "{}";
        throw error;
      },
    );
    // ~/.polymux/mcp.json is the one place servers are read from, which is what
    // makes every one of them editable and removable in Settings. Another
    // agent's servers arrive through Auto discovery, as copies.
    const configs = importMcpServers(JSON.parse(source)).map((config) => ({
      ...config,
      metadata: { ...config.metadata, source: "polymux" },
      enabled: this.#integrationEnabled(
        "mcp-enabled",
        config.id,
        config.enabled !== false,
      ),
    }));
    const plugins = await this.#pluginMcpConfigs();
    this.#mcpConfigs.clear();
    for (const config of [...configs, ...plugins])
      this.#mcpConfigs.set(config.id, config);
    this.#mcp.configure([...configs, ...plugins]);
    const snapshots = await this.#mcp.connectEnabled();
    for (const name of this.#mcpToolNames) this.#registry.remove(name);
    this.#mcpToolNames.clear();
    for (const tool of this.#mcp.tools()) {
      this.#registry.register(tool);
      this.#mcpToolNames.add(tool.name);
    }
    return this.#mcpDtos(snapshots);
  }

  /** The state file is read once, and every later caller waits on that read
   * rather than starting another. */
  #ensurePlugins(): Promise<void> {
    this.#pluginsLoaded ??= this.#plugins.load().catch((error: unknown) => {
      // A plugins.json we cannot write leaves the app without plugins, not
      // without MCP servers: the reload this sits inside must still finish.
      console.error("Could not read installed plugins", error);
      this.#pluginsLoaded = undefined;
    });
    return this.#pluginsLoaded;
  }

  /**
   * Every enabled plugin's servers, and — as a side effect, because the two
   * are read from the same folders — the skill directories the agent loads
   * them from.
   *
   * A plugin's server ids are namespaced with the plugin they came from, so a
   * plugin cannot take over a server the user configured themselves and two
   * plugins shipping the same server both run. The Plugins tab reports the
   * clash under its own name; nothing here silently drops one.
   */
  async #pluginMcpConfigs(): Promise<ReturnType<typeof importMcpServers>> {
    await this.#ensurePlugins();
    const runtimes = this.#plugins.runtime((id) =>
      this.#integrationEnabled("plugin-enabled", id),
    );
    this.#pluginMcpIds.clear();
    // Replaced rather than appended to: a disabled or removed plugin has to
    // lose its skills on the next run, not keep them until a restart.
    this.#agentSkillOptions.configured = runtimes.flatMap((runtime) =>
      runtime.skillDirectory ? [runtime.skillDirectory] : [],
    );
    return runtimes.flatMap((runtime) =>
      runtime.mcpServers.map((server) => {
        const id = `plugin:${runtime.pluginId}:${server.id}`;
        this.#pluginMcpIds.add(id);
        return {
          ...server,
          id,
          metadata: { ...server.metadata, source: "plugin" },
        };
      }),
    );
  }

  /** Snapshots as the MCP tab sees them: everything except what a plugin
   * brought, which belongs to its plugin's card instead. */
  #mcpDtos(snapshots: ReturnType<McpManager["snapshots"]>): McpServerDto[] {
    return snapshots
      .filter((snapshot) => !this.#pluginMcpIds.has(snapshot.id))
      .map((snapshot) => this.#mcpDto(snapshot));
  }

  /**
   * Polymux used to run Codex's servers straight out of ~/.codex/config.toml,
   * which left them unremovable here. They are copied across once so nothing
   * a user already had disappears; after that the copy is theirs, and deleting
   * it stays deleted rather than being re-imported on the next reload.
   */
  async #migrateCodexMcpConfig(): Promise<void> {
    if (this.#storage.getPreference("mcp-codex-migrated")?.value === true)
      return;
    const codexSource = await readFile(this.#codexMcpConfigPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      },
    );
    const codexConfigs = codexSource
      ? importMcpServers(parseToml(codexSource))
      : [];
    if (codexConfigs.length)
      await this.#writeMcpConfig((servers) => {
        for (const config of codexConfigs) {
          // A Polymux entry of the same id wins: it was the deliberate local
          // override of Codex's, and stays that way.
          if (config.id in servers) continue;
          servers[config.id] = {
            ...config.metadata,
            name: config.name ?? config.id,
          };
        }
      });
    this.#storage.setPreference("mcp-codex-migrated", true);
  }

  async close(reason = "Polymux is closing"): Promise<void> {
    this.#closing = true;
    if (this.#commsStatusTimer) clearInterval(this.#commsStatusTimer);
    stopUpdateChecks();
    this.#surfaceMenubar.close();
    void this.#agentSurface.close();
    this.#embeddedBrowser.closeAll();
    this.#mcpConfigWatcher.stop();
    this.#customSkillWatcher.stop();
    this.#windowControl.stop();
    this.#computerUse.hide();
    this.#computerHistory.stop();
    this.#interactionEvents.stop();
    // A recording that outlived the app would keep a tap alive with nobody to
    // end it, so an app quit ends it as an interruption rather than a stop.
    this.#recording.stop("interrupted");
    this.#scheduler.stop();
    this.#dictation.close();
    const activeRuns = [...this.#activeRuns.values()];
    for (const run of activeRuns) run.control.cancel(new Error(reason));
    for (const channel of this.#registeredChannels)
      this.#ipcMain.removeHandler(channel);
    await Promise.allSettled([
      ...activeRuns.map((run) => run.result),
      ...(this.#mcpReloadInFlight ? [this.#mcpReloadInFlight] : []),
    ]);
    // Consolidation is started after a turn and runs in the background, so on
    // quit it can still be in flight. Waiting for it is what makes a session's
    // memory survive the app closing rather than dying with the process.
    await this.#agent?.settleGoalWork();
    await this.#mcp.close();
    this.#storage.close();
  }

  /**
   * A goal continuation is a run the agent started for itself, so the host has
   * to adopt it: without this it would stream nowhere and could not be
   * cancelled from the UI.
   */
  #trackGoalContinuation(
    conversationId: string,
    runId: string,
    active: ActiveAgentRun,
  ): void {
    if (this.#closing) {
      active.control.cancel(new Error("Polymux is closing"));
      return;
    }
    this.#goalContinuations.set(conversationId, runId);
    this.#activeRuns.set(runId, active);
    void this.#forwardEvents(runId, active);
  }

  /**
   * A subagent's events would otherwise reach storage and stop there: the
   * runtime starts the run itself, so nothing forwards it. Tracked like any
   * other run — cancelling the parent already cancels it through the tool call's
   * signal, so this only adds the event stream the task transcript reads.
   */
  #trackSubagentRun(runId: string, active: ActiveAgentRun): void {
    if (this.#closing) return;
    this.#activeRuns.set(runId, active);
    void this.#forwardEvents(runId, active);
  }

  /** The user speaking outranks a goal continuation still working. */
  #preemptGoalContinuation(conversationId: string): void {
    const runId = this.#goalContinuations.get(conversationId);
    this.#goalContinuations.delete(conversationId);
    if (!runId) return;
    this.#activeRuns
      .get(runId)
      ?.control.cancel(new Error("Superseded by a new user message"));
  }

  /**
   * Where a run's file tools work.
   *
   * Each conversation writes into its own folder under the output root, so what
   * one chat produced can be found as a group instead of heaped in with every
   * other chat's. A run whose conversation cannot be read — a tool call arriving
   * after the conversation was deleted — falls back to the root rather than
   * failing the call.
   */
  #runDirectory(runId: string): string {
    if (this.#toolDirectory) return this.#toolDirectory;
    const conversationId = this.#storage.getRun(runId)?.conversationId;
    if (!conversationId) return this.#drive.outputRoot();
    try {
      return this.#drive.outputFolderSync();
    } catch {
      // An output root that cannot be created — a folder the user moved onto a
      // volume that is no longer mounted — must not take every tool down with
      // it; the home folder always exists.
      return homedir();
    }
  }

  async #startRun(
    request: ReturnType<typeof validateStartRun> & {
      reuseUserMessage?: boolean;
      contextThroughSequence?: number;
      executionScopeId?: string;
      replyToMessageId?: string;
    },
    preparedRunId?: string,
  ): Promise<{ runId: string }> {
    this.#preemptGoalContinuation(request.conversationId);
    // Only deictic/current-screen requests pay for a synchronous AX refresh.
    // Other turns use the latest trusted snapshot and refresh it in parallel
    // for later, avoiding desktop inspection on the inference critical path.
    const desktopContext = needsFreshDesktopContext(request.text)
      ? this.#refreshOpenWindows()
      : (void this.#refreshOpenWindows(), Promise.resolve());
    const locationContext = this.#refreshPromptLocation(request.text);
    await Promise.all([
      this.#prepareMcpForRun(),
      desktopContext,
      locationContext,
    ]);
    const agent = await this.#ensureConfiguredAgent();
    const pausedGoal = this.#storage.getGoal(request.conversationId);
    const maxTaskDispatches =
      pausedGoal &&
      (pausedGoal.status === "active" || pausedGoal.status === "paused") &&
      shouldBoundGoalContinuation(request.text, pausedGoal.objective)
        ? 2
        : undefined;
    if (
      pausedGoal?.status === "paused" &&
      shouldResumePausedGoal(request.text, pausedGoal.objective)
    )
      this.#storage.updateGoal(request.conversationId, { status: "active" });
    const runId = preparedRunId ?? crypto.randomUUID();
    const active = agent.start({
      conversationId: request.conversationId,
      text: request.text,
      userMessageId: request.messageId,
      reuseUserMessage: request.reuseUserMessage,
      attachments: request.attachments,
      asGoal: request.asGoal,
      reasoning: request.reasoning,
      speechMode: request.speechMode,
      runId,
      contextThroughSequence: request.contextThroughSequence,
      executionScopeId: request.executionScopeId,
      replyToMessageId: request.replyToMessageId,
      maxTaskDispatches,
      goalProgressContext: Boolean(
        pausedGoal &&
        (pausedGoal.status === "active" || pausedGoal.status === "paused") &&
        shouldUseGoalProgressContext(request.text, pausedGoal.objective),
      ),
    });
    this.#activeRuns.set(runId, active);
    void this.#forwardEvents(runId, active);
    return { runId };
  }

  #activeTopLevelRuns(): Array<{ runId: string; conversationId: string }> {
    const result: Array<{ runId: string; conversationId: string }> = [];
    for (const runId of this.#activeRuns.keys()) {
      const run = this.#storage.getRun(runId);
      if (!run || run.parentRunId) continue;
      result.push({ runId, conversationId: run.conversationId });
    }
    return result;
  }

  async #drainManagerConversation(conversationId: string): Promise<void> {
    if (this.#closing || this.#drainingManagerConversations.has(conversationId))
      return;
    this.#drainingManagerConversations.add(conversationId);
    try {
      while (!this.#closing) {
        const jobs = this.#managerJobs.list();
        const capacity = managerRunCapacity({
          jobs,
          activeTopLevelRuns: this.#activeTopLevelRuns(),
          chatId: conversationId,
        });
        if (capacity <= 0) return;
        const next = this.#managerJobs.nextReady(conversationId);
        if (!next) return;
        const conversationOccupied =
          jobs.some(
            (job) => job.chatId === conversationId && job.status === "running",
          ) ||
          this.#activeTopLevelRuns().some(
            (run) => run.conversationId === conversationId,
          );
        if (managerJobRequiresExclusiveRun(next) && conversationOccupied)
          return;
        const runId = crypto.randomUUID();
        const dependencyBoundary = managerClaimContextThroughSequence(
          next,
          this.#storage.listMessages(conversationId).at(-1)?.sequence ?? 0,
        );
        const claimed = this.#managerJobs.claimNext(runId, conversationId, {
          contextThroughSequence: dependencyBoundary,
        });
        if (!claimed || claimed.id !== next.id) return;
        this.#publishManagerJobs();
        try {
          await this.#startRun(
            {
              conversationId: claimed.chatId,
              text: claimed.text,
              messageId: claimed.messageId,
              reuseUserMessage: Boolean(
                this.#storage.getMessage(claimed.messageId),
              ),
              attachments: claimed.attachments,
              asGoal: claimed.asGoal,
              contextThroughSequence: claimed.contextThroughSequence ?? 0,
              executionScopeId: claimed.executionScopeId,
              replyToMessageId: claimed.replyToMessageId,
            },
            runId,
          );
        } catch (error) {
          this.#managerJobs.fail(
            claimed.id,
            error instanceof Error ? error.message : String(error),
          );
          this.#publishManagerJobs();
          continue;
        }
      }
    } finally {
      this.#drainingManagerConversations.delete(conversationId);
    }
  }

  #drainManagerQueues(): void {
    for (const conversationId of new Set(
      this.#managerJobs
        .list()
        .filter((job) => job.status === "queued")
        .map((job) => job.chatId),
    ))
      void this.#drainManagerConversation(conversationId);
  }

  /**
   * One firing of a schedule. It runs through the same agent as a typed
   * message — a schedule is an instruction the user wrote, just delivered by
   * the clock — and lands in a conversation of its own so the thread can be
   * opened and read like any other.
   */
  async #runSchedule(schedule: ScheduleDto): Promise<{
    summary?: string;
    conversationId?: string;
    runId?: string;
  }> {
    if (!schedule.prompt.trim())
      throw new Error("This schedule has no instruction to run");
    // Every firing appends to the same conversation, so the thread reads as
    // one recurring task rather than a new chat each morning.
    const previous = schedule.history.find(
      (entry) => entry.conversationId,
    )?.conversationId;
    const conversationId =
      (previous && this.#storage.getConversation(previous)?.id) ??
      this.#storage.createConversation({
        id: randomUUID(),
        title: schedule.title,
      }).id;
    const before = this.#storage.listMessages(conversationId).length;
    const { runId } = await this.#startRun({
      conversationId,
      text: schedule.prompt,
      messageId: randomUUID(),
      attachments: [],
    } as ReturnType<typeof validateStartRun>);
    this.#scheduledRunIds.add(runId);
    const active = this.#activeRuns.get(runId);
    // #forwardEvents owns the events and the settling; awaiting the same
    // promise here only waits for the end of it.
    if (active) await active.result;
    const run = this.#storage.getRun(runId);
    if (run?.status === "failed")
      throw new Error(
        typeof run.error === "string" && run.error
          ? run.error
          : "The scheduled run failed",
      );
    return {
      conversationId,
      runId,
      summary: this.#runSummary(conversationId, before),
    };
  }

  /**
   * Hands a notification to the OS. Clicking it brings the app back, which is
   * the only thing every one of these notifications is asking the user to do —
   * a notification that does nothing when clicked reads as broken.
   */
  #presentNotification(request: NotificationRequest): void {
    const notification = new Notification({
      title: request.title,
      body: request.body,
    });
    notification.on("click", () => {
      if (this.#closing || this.#window.isDestroyed()) return;
      if (this.#window.isMinimized()) this.#window.restore();
      this.#window.show();
      this.#window.focus();
      app.focus({ steal: true });
    });
    notification.show();
  }

  /**
   * Announces a finished top-level run. Delegated runs are the agent talking
   * to itself and a scheduled run has already been announced as a schedule,
   * so neither earns a second interruption.
   */
  #notifyRunSettled(runId: string): void {
    const wasScheduled = this.#scheduledRunIds.delete(runId);
    if (wasScheduled) return;
    const run = this.#storage.getRun(runId);
    if (!run || run.parentRunId) return;
    const conversation = run.conversationId
      ? this.#storage.getConversation(run.conversationId)
      : null;
    const title = conversation?.title?.trim() || "Polymux";
    if (run.status === "failed") {
      this.#notifier.notify({
        kind: "agent-completed",
        title,
        body: notificationBody(
          typeof run.error === "string" && run.error
            ? run.error
            : "The run failed.",
        ),
      });
      return;
    }
    const summary = run.conversationId
      ? this.#runSummary(run.conversationId, 0)
      : undefined;
    this.#notifier.notify({
      kind: "agent-completed",
      title,
      body: notificationBody(summary ?? "The agent finished."),
    });
  }

  /** The agent's closing words, as the account of what the run achieved. */
  #runSummary(conversationId: string, afterCount: number): string | undefined {
    const produced = this.#storage
      .listMessages(conversationId)
      .slice(afterCount);
    for (let index = produced.length - 1; index >= 0; index -= 1) {
      const message = produced[index];
      if (message.role !== "assistant") continue;
      const trimmed = assistantText(message.content);
      if (!trimmed) continue;
      return trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}…` : trimmed;
    }
    return undefined;
  }

  async #prepareMcpForRun(): Promise<void> {
    // Concurrent runs share the stable MCP tool set already in use. Once the
    // last run settles, pending configuration is applied before a new run can
    // snapshot the registry.
    if (this.#activeRuns.size > 0) return;
    while (!this.#closing) {
      if (this.#mcpReloadPending) {
        await this.#reloadMcpAndPublish();
        continue;
      }
      const reload = this.#mcpReloadInFlight;
      if (!reload) return;
      try {
        await reload;
      } catch {
        // Reload errors are published by the owner; the previous tool set stays active.
      }
    }
  }

  async #forwardEvents(runId: string, active: ActiveAgentRun): Promise<void> {
    try {
      for await (const event of active.events) {
        const run = this.#storage.getRun(runId);
        const conversationId = run?.conversationId ?? "";
        // Links the reply cites and files written during the run feed the
        // Summary panel.
        this.#runResources.record(conversationId, runId, event);
        if (!this.#window.isDestroyed())
          this.#window.webContents.send(
            channels.runEvent,
            eventDto(event, conversationId, run?.parentRunId ?? null),
          );
      }
      await active.result;
    } catch {
      // The agent already publishes a durable run.failed event. Settling below
      // still lets the renderer replace optimistic state with stored messages.
    } finally {
      this.#browserResearchTool?.cleanupRun(runId);
      this.#activeRuns.delete(runId);
      const settledRun = this.#storage.getRun(runId);
      const goalConversation = settledRun?.conversationId;
      const managerJob = this.#managerJobs.forRun(runId);
      if (managerJob?.status === "running") {
        if (settledRun?.status === "completed")
          this.#managerJobs.complete(managerJob.id);
        else if (settledRun?.status === "cancelled")
          this.#managerJobs.cancel(managerJob.id);
        else
          this.#managerJobs.fail(
            managerJob.id,
            settledRun?.error &&
              typeof settledRun.error === "object" &&
              !Array.isArray(settledRun.error) &&
              typeof settledRun.error.message === "string"
              ? settledRun.error.message
              : "Run interrupted",
          );
        this.#publishManagerJobs();
      }
      if (
        goalConversation &&
        this.#goalContinuations.get(goalConversation) === runId
      )
        this.#goalContinuations.delete(goalConversation);
      if (this.#activeRuns.size === 0 && this.#mcpReloadPending)
        await this.#reloadMcpAndPublish();
      this.#notifyRunSettled(runId);
      if (!this.#window.isDestroyed()) {
        const settled = this.#storage.getRun(runId);
        const conversationId = settled?.conversationId ?? "";
        this.#window.webContents.send(channels.runEvent, {
          runId,
          conversationId,
          parentRunId: settled?.parentRunId ?? null,
          sequence: Number.MAX_SAFE_INTEGER,
          timestamp: Date.now(),
          type: "run.settled",
          payload: { runId, conversationId },
        } satisfies RunEventDto);
      }
      this.#drainManagerQueues();
    }
  }

  #requestMcpReload(): void {
    if (this.#closing) return;
    if (this.#activeRuns.size || this.#mcpReloadInFlight) {
      this.#mcpReloadPending = true;
      return;
    }
    void this.#reloadMcpAndPublish();
  }

  async #reloadMcpAndPublish(): Promise<void> {
    if (this.#closing) return;
    this.#mcpReloadPending = false;
    try {
      const servers = await this.reloadMcp();
      this.#publishMcpChange({ servers, error: null });
    } catch (error) {
      this.#publishMcpChange({
        servers: this.#mcpDtos(this.#mcp.snapshots()),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #reloadMcpAfterMutation(): Promise<McpServerDto[]> {
    if (this.#activeRuns.size || this.#mcpReloadInFlight) {
      this.#mcpReloadPending = true;
      return this.#mcpDtos(this.#mcp.snapshots());
    }
    return this.reloadMcp();
  }

  #publishMcpChange(change: {
    servers: McpServerDto[];
    error: string | null;
  }): void {
    if (!this.#window.isDestroyed())
      this.#window.webContents.send(channels.mcpChanged, change);
  }

  #executeGoal(request: GoalCommandRequest) {
    if (request.action === "update") {
      const goal = this.#storage.updateGoal(request.conversationId, {
        objective: request.objective!,
      });
      if (!goal) throw new Error("No goal exists for this conversation");
      return goal;
    }
    return this.#goals.execute(
      request.conversationId,
      request.action === "create"
        ? { action: "create", objective: request.objective! }
        : { action: request.action },
    );
  }

  /**
   * Asks macOS for everything the app is entitled to ask for and does not yet
   * have, so a grant is settled while the user is here rather than in the
   * middle of a run. Called when a skill is installed or switched on — with
   * that skill's name — and again before every run with no names at all.
   *
   * Three rules keep it quiet. A grant macOS has already decided is never
   * asked for twice, because it shows its dialog once and a second call only
   * costs a process. A grant the user switched off is not asked for at all —
   * that switch is a refusal to use the capability, not a request to be
   * reminded of it. And a permission macOS has no dialog for is skipped
   * outright: "asking" for Full Disk Access means opening System Settings,
   * which is a thing to do when someone pressed a button, never something to
   * do to them because a run was starting.
   */
  async #ensurePermissions(
    names?: Iterable<string>,
  ): Promise<AppPermissionKind[]> {
    // App grants only. The app's own permissions are swept below and each has
    // a row with its own Allow button, so folding them in here would let a
    // press on "ask again" — which sits with the skill grants — open the
    // Microphone pane instead, and on a fresh build that is what it would
    // always do.
    const withheld: AppPermissionKind[] = [];
    if (process.platform !== "darwin") return withheld;
    const settings = this.#generalSettings();
    const only = names ? new Set(names) : undefined;
    const declared = new Set<AppPermissionKind>();
    for (const skill of this.#skills.load().skills) {
      // Without names this is the pre-run sweep, which covers what is actually
      // loaded: every core skill, and the optional ones switched on.
      const active = only
        ? only.has(skill.name)
        : this.#coreSkills.has(skill.name) ||
          this.#integrationEnabled("skill-enabled", skill.name);
      if (active)
        for (const kind of declaredPermissions(skill)) declared.add(kind);
    }
    const statuses = new Map<AppPermissionKind, SystemPermissionStatus>();
    for (const kind of declared) {
      if (this.#permissionsSettled.has(kind)) continue;
      const status = await permissionStatus(kind);
      statuses.set(kind, status);
      // "not-determined" is the only status worth revisiting: a granted one is
      // done, and a refused one cannot be changed from here. Nothing is
      // remembered across a restart, so a grant reset outside the app is
      // noticed the next time Polymux runs.
      if (status !== "not-determined") this.#permissionsSettled.add(kind);
    }
    const { kinds } = permissionsToRequest(
      statuses.keys(),
      settings,
      (kind) => statuses.get(kind) ?? "unknown",
    );
    for (const kind of kinds) {
      this.#permissionsSettled.add(kind);
      if ((await requestSystemPermission(kind)) !== "granted")
        withheld.push(kind);
    }
    // A grant that was already decided against is reported too. macOS will not
    // show its dialog a second time, so the caller offering System Settings is
    // the only thing left that can change the answer.
    for (const [kind, status] of statuses)
      if (
        status !== "not-determined" &&
        status !== "granted" &&
        !withheld.includes(kind)
      )
        withheld.push(kind);
    // The app's own grants are deliberately not swept here. Each has a row
    // with its own button, and a run starting is not a reason to ask for a
    // capability that run may never use.
    return withheld;
  }

  #skillDtos(): SkillDto[] {
    // Core integrations stay loaded for the agent; they are only kept out of
    // the Skills list, which is the optional-add-on surface.
    return this.#skills
      .load()
      .skills.filter((skill) => !this.#coreSkills.has(skill.name))
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: skill.source,
        filePath: skill.filePath,
        disableModelInvocation: skill.disableModelInvocation,
        allowedTools: skill.allowedTools ?? [],
        permissions: declaredPermissions(skill),
        enabled: this.#integrationEnabled("skill-enabled", skill.name),
        editable: skill.source === "polymux",
        instructions:
          skill.source === "polymux"
            ? skillInstructions(readFileSync(skill.filePath, "utf8"))
            : undefined,
        displayName: skill.displayName,
        author: skill.author,
        category: skill.category,
        updatedAt: skill.updatedAt,
      }));
  }

  /**
   * The installed plugins, each told what of its own the user already has
   * standalone. The comparison is made here rather than in the registry
   * because this is where both lists exist: the Skills tab's own skills, and
   * the servers configured in ~/.polymux/mcp.json.
   */
  #pluginDtos(): PluginDto[] {
    const skills = new Map(
      this.#skills
        .load()
        .skills.map((skill) => [skill.name, skill.source] as const),
    );
    const mcpServers = new Map(
      [...this.#mcpConfigs.values()]
        .filter((config) => !this.#pluginMcpIds.has(config.id))
        .map((config) => [config.id, "polymux"] as const),
    );
    return this.#plugins.list({
      skills,
      mcpServers,
      isEnabled: (id) => this.#integrationEnabled("plugin-enabled", id),
    });
  }

  #integrationEnabled(
    key: "skill-enabled" | "mcp-enabled" | "plugin-enabled",
    id: string,
    fallback = true,
  ): boolean {
    const value = this.#profilePreference(key)?.value;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fallback;
    const stored = (value as Record<string, unknown>)[id];
    return typeof stored === "boolean" ? stored : fallback;
  }

  #setIntegrationEnabled(
    key: "skill-enabled" | "mcp-enabled" | "plugin-enabled",
    id: string,
    enabled: unknown,
  ): void {
    if (typeof enabled !== "boolean")
      throw new Error("enabled must be a boolean");
    const value = this.#profilePreference(key)?.value;
    const current =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, boolean>)
        : {};
    this.#setProfilePreference(key, { ...current, [id]: enabled });
  }

  #profilePreference(key: string) {
    return this.#profiles.preference(key);
  }

  #setProfilePreference(key: string, value: JsonValue): void {
    this.#profiles.setPreference(key, value);
  }

  /**
   * Every server Polymux runs is written here, so one editor covers adding a
   * custom server, adopting a discovered one and removing either. The file is
   * replaced by rename, so a crash mid-write leaves the previous list intact.
   */
  async #writeMcpConfig(
    edit: (servers: Record<string, unknown>) => void,
  ): Promise<void> {
    const source = await readFile(this.#mcpConfigPath, "utf8").catch(
      (error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? "{}" : Promise.reject(error),
    );
    const root = JSON.parse(source) as Record<string, unknown>;
    const existing = root.mcpServers;
    const servers =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    edit(servers);
    root.mcpServers = servers;
    await mkdir(path.dirname(this.#mcpConfigPath), { recursive: true });
    const temporary = `${this.#mcpConfigPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(root, null, 2)}\n`, "utf8");
    await rename(temporary, this.#mcpConfigPath);
  }

  async #saveCustomMcp(request: SaveCustomMcpRequest): Promise<void> {
    await this.#writeMcpConfig((servers) => {
      servers[request.id] =
        request.transport === "stdio"
          ? {
              name: request.name,
              description: request.description,
              command: request.command,
              args: request.args,
              env: request.env,
              cwd: request.cwd,
            }
          : {
              name: request.name,
              description: request.description,
              url: request.url,
              headers: request.headers,
            };
    });
  }

  async #removeCustomMcp(id: string): Promise<void> {
    await this.#writeMcpConfig((servers) => {
      if (!(id in servers))
        throw new Error(`MCP server is not removable: ${id}`);
      delete servers[id];
    });
    const cached = this.#profilePreference("mcp-capabilities")?.value;
    if (cached && typeof cached === "object" && !Array.isArray(cached)) {
      const next = { ...cached };
      delete next[id];
      this.#setProfilePreference("mcp-capabilities", next);
    }
  }

  /**
   * Dismissing the chip is a "not now", not a "never". Once the extension is
   * actually seen reporting, the dismissal is cleared, so if it is later
   * removed the chip comes back rather than staying silently suppressed.
   */
  #extensionStatus(): BrowserExtensionDto {
    const status = readExtensionStatus();
    if (status.installed) {
      if (
        this.#storage.getPreference("extension-prompt-dismissed")?.value ===
        true
      )
        this.#storage.setPreference("extension-prompt-dismissed", false);
      return { ...status, promptToInstall: false };
    }
    const dismissed =
      this.#storage.getPreference("extension-prompt-dismissed")?.value === true;
    return { ...status, promptToInstall: !dismissed };
  }

  async #saveCustomSkill(request: SaveCustomSkillRequest): Promise<void> {
    // A personal skill may not take a built-in skill's name. The loader keeps
    // the built-in authoritative, so the write would otherwise succeed and
    // then be silently ignored — the user edits a skill and nothing changes.
    const clash = this.#skills
      .load()
      .skills.find((candidate) => candidate.name === request.name);
    if (clash && clash.source !== "polymux")
      throw new Error(
        `${request.name} is a built-in skill and cannot be replaced. Save your version under a different name.`,
      );
    const destination = path.join(this.#customSkillDirectory, request.name);
    if (request.originalName && request.originalName !== request.name) {
      const original = path.join(
        this.#customSkillDirectory,
        request.originalName,
      );
      await rename(original, destination);
    }
    await mkdir(destination, { recursive: true });
    const contents = `---\nname: ${request.name}\ndescription: ${request.description}\n---\n\n${request.instructions.trim()}\n`;
    const temporary = path.join(destination, "SKILL.md.tmp");
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, path.join(destination, "SKILL.md"));
  }

  async #removeCustomSkill(name: string): Promise<void> {
    const skill = this.#skills
      .load()
      .skills.find((candidate) => candidate.name === name);
    if (!skill || skill.source !== "polymux")
      throw new Error(`Skill is not removable: ${name}`);
    const root = path.resolve(this.#customSkillDirectory);
    const destination = path.resolve(root, name);
    if (path.dirname(destination) !== root)
      throw new Error(`Invalid skill name: ${name}`);
    await rm(destination, { recursive: true, force: false });
    const stored = this.#profilePreference("skill-enabled")?.value;
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      const next = { ...stored };
      delete next[name];
      this.#setProfilePreference("skill-enabled", next);
    }
  }

  /**
   * Copies a skill another agent already has into ~/.polymux/skills. A copy,
   * not a link or a second sourced directory: the other agent stays free to
   * change or remove its own copy, and the user can edit Polymux's in place.
   */
  async #adoptSkill(displayed: string): Promise<string> {
    const source = resolveDiscoveredSkill(displayed);
    const result = new SkillLoader({ configured: [source] }).load();
    const skill = result.skills.find(
      (item) => item.filePath === path.join(source, "SKILL.md"),
    );
    if (!skill) throw new Error("That folder no longer holds a valid SKILL.md");
    const destination = path.join(this.#customSkillDirectory, skill.name);
    const exists = await stat(destination).then(
      () => true,
      (error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? false : Promise.reject(error),
    );
    if (exists) throw new Error(`A skill named ${skill.name} already exists`);
    await mkdir(this.#customSkillDirectory, { recursive: true });
    await cp(source, destination, { recursive: true });
    return skill.name;
  }

  async #uploadSkill(files: SkillUploadFile[]): Promise<string[]> {
    const skillFiles = files.filter(
      (file) =>
        file.relativePath.split("/").length === 2 &&
        path.basename(file.relativePath) === "SKILL.md",
    );
    if (skillFiles.length !== 1)
      throw new Error(
        "Choose one skill folder with a SKILL.md at its top level",
      );
    const rootName = skillFiles[0]!.relativePath.split("/")[0]!;
    const selected = files.filter((file) =>
      file.relativePath.startsWith(`${rootName}/`),
    );
    const temporary = path.join(
      this.#customSkillDirectory,
      `.upload-${randomUUID()}`,
    );
    await mkdir(temporary, { recursive: true });
    try {
      for (const file of selected) {
        const relative = file.relativePath.slice(rootName.length + 1);
        if (
          !relative ||
          path.isAbsolute(relative) ||
          relative.split(/[\\/]/).includes("..")
        )
          throw new Error("Skill folder contains an invalid path");
        const destination = path.join(temporary, relative);
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(file.path, destination);
      }
      const result = new SkillLoader({ configured: [temporary] }).load();
      const skill = result.skills.find(
        (item) => item.filePath === path.join(temporary, "SKILL.md"),
      );
      if (!skill)
        throw new Error(
          "The selected folder does not contain a valid SKILL.md with a name and description",
        );
      const diagnostic = result.diagnostics.find(
        (item) => item.severity === "error",
      );
      if (diagnostic) throw new Error(diagnostic.message);
      const destination = path.join(this.#customSkillDirectory, skill.name);
      const exists = await stat(destination).then(
        () => true,
        (error: NodeJS.ErrnoException) =>
          error.code === "ENOENT" ? false : Promise.reject(error),
      );
      if (exists) throw new Error(`A skill named ${skill.name} already exists`);
      await rename(temporary, destination);
      return [skill.name];
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Copies a chosen plugin folder in. The folder is assembled in a staging
   * directory first and only handed to the registry once its manifest reads,
   * so a folder that turns out not to be a plugin leaves nothing behind.
   */
  async #uploadPlugin(files: SkillUploadFile[]): Promise<void> {
    const manifests = files.filter(
      (file) =>
        file.relativePath.split("/").length === 3 &&
        file.relativePath.split("/")[1] === ".claude-plugin" &&
        path.basename(file.relativePath) === "plugin.json",
    );
    if (manifests.length !== 1)
      throw new Error(
        "Choose one plugin folder with a .claude-plugin/plugin.json inside it",
      );
    const rootName = manifests[0]!.relativePath.split("/")[0]!;
    const selected = files.filter((file) =>
      file.relativePath.startsWith(`${rootName}/`),
    );
    const staging = await mkdtemp(
      path.join(tmpdir(), "polymux-plugin-upload-"),
    );
    try {
      for (const file of selected) {
        const relative = file.relativePath.slice(rootName.length + 1);
        if (
          !relative ||
          path.isAbsolute(relative) ||
          relative.split(/[\\/]/).includes("..")
        )
          throw new Error("Plugin folder contains an invalid path");
        const destination = path.join(staging, relative);
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(file.path, destination);
      }
      await this.#plugins.installLocal(
        staging,
        readPluginManifest(staging).name,
      );
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  /** Writes decoded data into this app's own session and vault. Kept in one
   * place so every import route — a browser, a file — lands the same way. */
  #applyImport(data: ImportedData): Promise<BrowserImportResultDto> {
    return applyImport(data, {
      cookies: session.defaultSession.cookies,
      visits: {
        record: (visits) =>
          this.#storage.recordVisits(
            visits.map((visit) => ({
              url: visit.url,
              title: visit.title,
              visitedAt: new Date(visit.visitedAt * 1000).toISOString(),
              visitCount: visit.visitCount,
              source: "import" as const,
            })),
          ),
      },
      logins: {
        save: (origin, username, password, source) =>
          this.#autofill.save(origin, username, password, source),
      },
    });
  }

  #browserSettings(): BrowserSettingsDto {
    return browserSettingsPreference(
      this.#storage.getPreference("browser-settings")?.value,
    );
  }

  #generalSettings(): GeneralSettingsDto {
    const stored = this.#storage.getPreference("general-access")?.value;
    const settings = generalSettingsPreference(stored);
    // First-run setup predates nothing: an install that already asked for
    // permissions has been used before, so it must not be sent back through
    // setup just because this flag did not exist when it was last written.
    if (
      !settings.onboardingCompleted &&
      !hasOnboardingFlag(stored) &&
      this.#firstRunPermissions.completed()
    )
      return { ...settings, onboardingCompleted: true };
    return settings;
  }

  #storeGeneralSettings(settings: GeneralSettingsDto): void {
    this.#storage.setPreference("general-access", {
      theme: settings.theme,
      language: settings.language,
      currency: settings.currency,
      advancedMode: settings.advancedMode,
      speechModeEnabled: settings.speechModeEnabled,
      dictationAutoStopSeconds: settings.dictationAutoStopSeconds,
      timeEnabled: settings.timeEnabled,
      locationEnabled: settings.locationEnabled,
      hubIncognitoMode: settings.hubIncognitoMode,
      reasoningLevel: settings.reasoningLevel,
      onboardingCompleted: settings.onboardingCompleted,
      permissions: settings.permissions,
      notificationsEnabled: settings.notificationsEnabled,
      notifications: settings.notifications,
      location: settings.location,
    });
  }

  /**
   * What is open on the machine, for the ambient context block. Titles only,
   * and only while accessibility is granted — the same permission ComputerHistory
   * reads through. Cached briefly so a burst of runs costs one listing, and a
   * failure answers with the last reading rather than failing the turn.
   */
  /**
   * Whether a capability is available right now: the OS grant *and* the user's
   * own switch for it in Settings. Turning the switch off leaves the grant
   * alone, so switching it back on costs nothing.
   */
  /**
   * Settles an app grant at the moment a tool needs it, which is the whole
   * reason such a capability is a tool rather than a shelled-out command: this
   * is a real point of use, so the dialog raised here is one the user's own
   * request brought about, and the tool waits for the answer instead of
   * failing and leaving them to work out why.
   *
   * The switches come first and never prompt. Turning a capability off is a
   * refusal to use it, so the honest answer is to say so — raising a system
   * dialog for something the user has switched off would be absurd.
   */
  async #requireAppPermission(kind: AppPermissionKind): Promise<string | null> {
    const settings = this.#generalSettings();
    if (!settings.appPermissionsEnabled)
      return "App access for skills is switched off in Settings → General → Permissions.";
    if (!settings.permissions[kind])
      return `${kind} access is switched off in Settings → General → Permissions.`;
    if ((await permissionStatus(kind)) === "granted") return null;
    if ((await requestSystemPermission(kind)) === "granted") return null;
    // macOS raises its dialog once. Past that the only thing that changes the
    // answer is the pane, so say where rather than asking again next turn.
    return `Polymux has not been given access to ${kind}. Allow it in System Settings → Privacy & Security.`;
  }

  #permissionAvailable(kind: SystemPermissionKind): boolean {
    const settings = this.#generalSettings();
    // The master switch covers every app grant at once. It is a refusal to use
    // them, not a revocation: macOS still holds whatever it granted, so
    // switching it back on needs no second trip through System Settings.
    if (isAppPermissionKind(kind) && !settings.appPermissionsEnabled)
      return false;
    if (!settings.permissions[kind]) return false;
    return systemPermissionStatus(kind) === "granted";
  }

  /** The switch is the app's own, so the refusal names it rather than macOS. */
  #requireMicrophone(): void {
    if (!this.#generalSettings().permissions.microphone)
      throw new Error(
        "Microphone access is switched off in Settings → General → Permissions",
      );
  }

  /** The seam both workspace tools drive: a pane to show, and what the hub is
   * linked to, which is what says whether a draft has anywhere to land. */
  #workspaceRevealer() {
    return {
      reveal: (request: WorkspaceRevealDto) => {
        if (!this.#closing && !this.#window.isDestroyed())
          this.#window.webContents.send(channels.workspaceReveal, request);
      },
      linked: async () => {
        const status = await this.#comms.status();
        return {
          mailAccounts: status.email.accounts.map((account) => ({
            id: account.id,
            email: account.email,
          })),
          chats: (await this.#comms.chats().catch((): MatrixRoom[] => [])).map(
            (chat) => ({
              id: chat.roomId,
              name: chat.name,
            }),
          ),
        };
      },
    };
  }

  async #refreshOpenWindows(): Promise<AxWindow[]> {
    if (!this.#permissionAvailable("accessibility")) return [];
    if (!this.#windowRefresh) {
      this.#windowRefresh = this.#axReader
        .windows(process.pid)
        .then((result) => {
          if (result.trusted)
            this.#windowSnapshot = { at: Date.now(), windows: result.windows };
        })
        .catch(() => {})
        .finally(() => {
          this.#windowRefresh = undefined;
        });
    }
    await this.#windowRefresh;
    return this.#windowSnapshot.windows;
  }

  async #refreshPromptLocation(prompt: string): Promise<void> {
    // A second top-level run may arrive while another prompt is refreshing.
    // Let that exact attempt settle, then re-evaluate this prompt against the
    // resulting state; never silently inherit the first prompt's eligibility.
    if (this.#locationRefresh) await this.#locationRefresh;
    if (!this.#locationRefresh) {
      this.#locationRefresh = refreshLocationForPrompt(prompt, {
        current: () => {
          const settings = this.#generalSettings();
          return {
            enabled: settings.locationEnabled,
            location: settings.location,
          };
        },
        permission: async () => {
          const state = await this.#window.webContents
            .executeJavaScript(`(async () => {
            if (!navigator.permissions) return "unsupported";
            try {
              const result = await navigator.permissions.query({name: "geolocation"});
              return ["granted", "denied", "prompt"].includes(result.state) ? result.state : "unsupported";
            } catch { return "unsupported"; }
          })()`);
          return state === "granted" || state === "denied" || state === "prompt"
            ? state
            : "unsupported";
        },
        position: async (signal) => {
          const value = await this.#window.webContents
            .executeJavaScript(`new Promise((resolve, reject) => {
            if (!navigator.geolocation) { reject(new Error("unavailable")); return; }
            navigator.geolocation.getCurrentPosition(
              position => resolve({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                updatedAt: new Date(position.timestamp).toISOString(),
              }),
              error => reject(new Error(error && error.message ? error.message : "location unavailable")),
              {enableHighAccuracy: true, maximumAge: 0, timeout: 4000},
            );
          })`);
          if (signal.aborted) throw signal.reason;
          return value;
        },
        persist: (location) => {
          const current = this.#generalSettings();
          if (!current.locationEnabled) return;
          this.#storeGeneralSettings(
            generalSettingsUpdate({ location }, current),
          );
        },
      })
        .then(() => {})
        .finally(() => {
          this.#locationRefresh = undefined;
        });
    }
    await this.#locationRefresh;
  }

  #environmentPromptContext() {
    const settings = this.#generalSettings();
    const now = new Date();
    const capturedForTurn = now.toISOString();
    const externalBrowser = readExternalPromptSnapshot(
      now.getTime(),
      undefined,
      100,
    );
    const offsetMinutes = -now.getTimezoneOffset();
    const offsetSign = offsetMinutes >= 0 ? "+" : "-";
    const offsetHours = String(
      Math.floor(Math.abs(offsetMinutes) / 60),
    ).padStart(2, "0");
    const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(
      2,
      "0",
    );
    const windows = this.#windowSnapshot.windows
      .map(({ app, title, frontmost }) => ({ app, title, frontmost }))
      .sort((left, right) => Number(right.frontmost) - Number(left.frontmost));
    return {
      windowsCapturedAt: this.#windowSnapshot.at
        ? new Date(this.#windowSnapshot.at).toISOString()
        : undefined,
      browserTabsCapturedAt: capturedForTurn,
      externalBrowserCapturedAt: externalBrowser?.capturedAt,
      time: settings.timeEnabled
        ? {
            local: new Intl.DateTimeFormat(undefined, {
              dateStyle: "full",
              timeStyle: "long",
            }).format(now),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            utcOffset: `${offsetSign}${offsetHours}:${offsetRemainder}`,
            instant: now.toISOString(),
          }
        : undefined,
      locationEnabled: settings.locationEnabled,
      locationResolverAvailable: true,
      location:
        settings.locationEnabled && settings.location
          ? settings.location
          : undefined,
      browserTabs: this.#embeddedBrowser.promptTabs(12),
      // Read a wider bounded inventory here; prompt selection first filters
      externalBrowserTabs:
        // by the user's request and only then keeps twenty. Capping before
        // relevance would hide a useful inactive tab in a busy browser.
        externalBrowser?.tabs,
      // Frontmost first: the window the user is actually in is the one an
      // ambiguous "this" most often means.
      windows: compactPromptWindows(windows, 20),
    };
  }

  #computerStateInput() {
    const now = Date.now();
    const external = readExternalPromptSnapshot(
      now,
      undefined,
      Number.MAX_SAFE_INTEGER,
    );
    return {
      windowsCapturedAt: this.#windowSnapshot.at
        ? new Date(this.#windowSnapshot.at).toISOString()
        : undefined,
      browserTabsCapturedAt: new Date(now).toISOString(),
      externalBrowserCapturedAt: external.capturedAt,
      locked: this.#computerSystem.current().locked,
      windows: this.#windowSnapshot.windows.map(
        ({ app, title, frontmost }) => ({ app, title, frontmost }),
      ),
      browserTabs: this.#embeddedBrowser.tabs(),
      externalBrowserTabs: external.tabs,
    };
  }

  #startComputerObservation(): void {
    this.#computerHistory.start();
    if (this.#computerObservationStarted) return;
    this.#computerObservationStarted = true;
    void this.#interactionEvents
      .start((event) => {
        this.#computer.observe(event);
        // History remains independently optional: record() applies its enabled,
        // privacy, and interaction-event settings before retaining anything.
        this.#computerHistory.record(event);
      })
      .catch(() => {
        this.#computerObservationStarted = false;
      });
  }

  /** Switch every memory surface on, for the mode that offers no way to. */
  #enableAllMemory(): void {
    if (!this.#memory.status().enabled) this.#memory.setEnabled(true);
    if (this.#computerHistory.settings().enabled) return;
    // Switched on, never asked for: this runs at launch in basic mode, and a
    // dialog raised from here is one the user did nothing to invite.
    this.#computerHistory.setEnabled(true);
    void this.#computerHistory.captureOnce().catch(() => {});
  }

  #selectModel(ref: ModelRef, persist = true): ModelDto {
    const model = this.#inference.getModel(ref);
    if (!model) throw new Error(`Unknown model: ${ref.provider}/${ref.id}`);
    this.#model = ref;
    this.#buildAgent(ref);
    if (persist)
      this.#setProfilePreference("model", {
        provider: ref.provider,
        id: ref.id,
      });
    return this.#modelDto(model);
  }

  #buildAgent(ref: ModelRef): void {
    this.#agent = new PolymuxAgent({
      inference: this.#inference,
      storage: this.#storage,
      memory: this.#memory,
      computerHistory: this.#computerHistory,
      drive: { promptContext: () => this.#drive.promptContext() },
      environment: { promptContext: () => this.#environmentPromptContext() },
      tools: this.#registry,
      model: ref,
      // Both fall back to the main model inside the agent when undefined, so
      // an override that no longer resolves simply stops applying.
      subagentModel: this.#effectiveRole("subagent"),
      judgeModel: this.#effectiveRole("judge"),
      compactionModel: this.#effectiveRole("compaction"),
      // The level chosen with a role's model applies wherever that model runs;
      // undefined leaves the run on the level it was started at.
      subagentReasoning: this.#effectiveRole("subagent")?.reasoning,
      judgeReasoning: this.#effectiveRole("judge")?.reasoning,
      compactionReasoning: this.#effectiveRole("compaction")?.reasoning,
      skills: this.#agentSkillOptions,
      prompts: this.#agentPrompts,
      // The guard runs first so a built-in skill stays read-only even when the
      // user's own hooks would have allowed the call.
      hooks: combineHooks(
        new ProtectedSkillGuard(officialSkillsHome()),
        this.#hooks,
      ),
      onGoalContinuation: ({ conversationId, runId, run }) =>
        this.#trackGoalContinuation(conversationId, runId, run),
      onSubagentRun: ({ runId, run }) => this.#trackSubagentRun(runId, run),
    });
  }

  /** A stored override only counts while the model it names still exists. */
  #usableRole(role: ModelRole): RoleSelection | undefined {
    const ref = this.#roleOverrides[role];
    return ref && this.#inference.getModel(ref) ? ref : undefined;
  }

  /** What a role actually runs with: the stored override, or — while basic
   * mode hides the roles UI — the automatic pick for the available models.
   * The picks are computed, never persisted, so they track provider changes
   * on their own and step aside the moment advanced mode returns control. */
  #effectiveRole(role: ModelRole): RoleSelection | undefined {
    const override = this.#usableRole(role);
    if (override || role === "main") return override;
    if (this.#generalSettings().advancedMode) return undefined;
    return autoRolePicks(this.#inference.listModels(), this.#model)[role];
  }

  /** Re-derives what follows from the automatic picks after anything that can
   * change them: provider changes, the main model, or the advanced-mode flag.
   * Speech mode flips only when the effective speech assignment transitions,
   * so a user who switched it off stays off until the assignment changes. */
  #reconcileAutoRoles(rebuild = true): void {
    const assigned = Boolean(this.#effectiveRole("speech"));
    const marker =
      this.#profilePreference("speech-role-assigned")?.value === true;
    if (assigned !== marker) {
      this.#setProfilePreference("speech-role-assigned", assigned);
      this.#setSpeechModeForRoleChange("speech", assigned);
    }
    // The agent snapshots its role models when built, so a change in the
    // picks only reaches runs through a rebuild. Callers that already rebuilt
    // (role persistence does) skip the second one.
    if (rebuild && this.#model) this.#buildAgent(this.#model);
  }

  #modelRoles(): ModelRolesDto {
    const assignment = (
      ref: RoleSelection | undefined,
    ): ModelRoleAssignmentDto | null => {
      if (!ref) return null;
      const model = this.#inference.getModel(ref);
      if (!model) return null;
      // A model that never reasons reports no level, so the row can say so
      // rather than implying a choice the provider ignores.
      const reasoning = model.reasoning ? ref.reasoning : undefined;
      return {
        provider: ref.provider,
        id: ref.id,
        name: model.name ?? ref.id,
        ...(reasoning ? { reasoning } : {}),
      };
    };
    // Main's level is the one runs are started at, which the composer owns, so
    // it is read back from the general settings rather than stored twice.
    return {
      main: assignment(
        this.#model
          ? {
              ...this.#model,
              reasoning: this.#generalSettings().reasoningLevel,
            }
          : undefined,
      ),
      subagent: assignment(this.#effectiveRole("subagent")),
      judge: assignment(this.#effectiveRole("judge")),
      compaction: assignment(this.#effectiveRole("compaction")),
      speech: assignment(this.#effectiveRole("speech")),
      image: assignment(this.#effectiveRole("image")),
      video: assignment(this.#effectiveRole("video")),
    };
  }

  async #assignRole(
    role: ModelRole,
    ref: RoleSelection,
  ): Promise<ModelRolesDto> {
    await this.#assertProviderConfigured(ref.provider);
    if (role === "main") {
      this.#selectModel(ref);
      // Main runs read their level from the general settings, so a level chosen
      // with the main model lands there — the composer picks it up as its own.
      if (ref.reasoning) this.#setReasoningLevel(ref.reasoning);
      return this.#modelRoles();
    }
    if (!this.#inference.getModel(ref))
      throw new Error(`Unknown model: ${ref.provider}/${ref.id}`);
    this.#roleOverrides = { ...this.#roleOverrides, [role]: ref };
    this.#persistRoles();
    // A deliberate assignment always turns speech mode on; the transition
    // logic in the reconcile then only aligns its marker.
    this.#setSpeechModeForRoleChange(role, true);
    this.#reconcileAutoRoles(false);
    return this.#modelRoles();
  }

  #clearRole(role: ModelRole): ModelRolesDto {
    // The main model is what everything else falls back to, so there is
    // nothing to clear it to.
    if (role === "main") throw new Error("The main model cannot be cleared");
    const { [role]: _removed, ...rest } = this.#roleOverrides;
    this.#roleOverrides = rest;
    this.#persistRoles();
    // Deliberately clearing speech switches speech mode off even when an
    // automatic pick still stands; the reconcile only aligns its marker.
    this.#setSpeechModeForRoleChange(role, false);
    this.#reconcileAutoRoles(false);
    return this.#modelRoles();
  }

  #persistRoles(): void {
    this.#setProfilePreference(
      "model-roles",
      Object.fromEntries(
        Object.entries(this.#roleOverrides).map(([role, ref]) => [
          role,
          {
            provider: ref.provider,
            id: ref.id,
            ...(ref.reasoning ? { reasoning: ref.reasoning } : {}),
          },
        ]),
      ),
    );
    if (this.#model) this.#buildAgent(this.#model);
  }

  /** Writes the level main runs start at, leaving every other general setting
   * as it stands. */
  #setReasoningLevel(reasoning: ReasoningEffort): void {
    const settings = this.#generalSettings();
    this.#storage.setPreference("general-access", {
      theme: settings.theme,
      language: settings.language,
      currency: settings.currency,
      advancedMode: settings.advancedMode,
      speechModeEnabled: settings.speechModeEnabled,
      dictationAutoStopSeconds: settings.dictationAutoStopSeconds,
      timeEnabled: settings.timeEnabled,
      locationEnabled: settings.locationEnabled,
      reasoningLevel: reasoning,
      onboardingCompleted: settings.onboardingCompleted,
      location: settings.location,
    });
  }

  /** Model assignment provides the automatic default; the ordinary settings
   * switch remains free to override it until the speech role changes again. */
  #setSpeechModeForRoleChange(role: ModelRole, assigned: boolean): void {
    const settings = this.#generalSettings();
    const speechModeEnabled = speechModeAfterRoleChange(
      role,
      assigned,
      settings.speechModeEnabled,
    );
    if (speechModeEnabled !== settings.speechModeEnabled)
      this.#storeGeneralSettings({ ...settings, speechModeEnabled });
  }

  #modelDto(model: InferenceModel): ModelDto {
    // A zero cache rate on a paid model means the provider has no such
    // feature, not that caching is free — most paid models publish exactly
    // that. Zero is only a real price when the whole model is free.
    const free = model.cost?.input === 0 && model.cost?.output === 0;
    return {
      ...model,
      cost: {
        input: knownRate(model.cost?.input),
        output: knownRate(model.cost?.output),
        cacheRead: free
          ? knownRate(model.cost?.cacheRead)
          : positiveRate(model.cost?.cacheRead),
        cacheWrite: free
          ? knownRate(model.cost?.cacheWrite)
          : positiveRate(model.cost?.cacheWrite),
      },
      selected:
        this.#model?.provider === model.provider && this.#model.id === model.id,
      custom: this.#customProviders.has(model.provider),
    };
  }

  #availableCustomProviderId(name: string): string {
    const stem = `custom-${
      name
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "provider"
    }`;
    let id = stem;
    let suffix = 2;
    while (this.#models.getProvider(id)) id = `${stem}-${suffix++}`;
    return id;
  }

  #registerCustomProvider(config: CustomProviderConfig): void {
    const models: Array<Model<"openai-completions">> = config.models.map(
      (model) => ({
        id: model.id,
        name: model.name,
        api: "openai-completions",
        provider: config.id,
        baseUrl: config.baseUrl,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 8_192,
      }),
    );
    this.#models.setProvider(
      createProvider({
        id: config.id,
        name: config.name,
        baseUrl: config.baseUrl,
        auth: {
          apiKey: {
            name: `${config.name} API key`,
            resolve: async ({ credential }) => ({
              auth: { apiKey: credential?.key ?? "polymux-local" },
              source: credential?.key ? "Saved API key" : "Custom endpoint",
            }),
          },
        },
        models,
        api: openAICompletionsApi(),
      }),
    );
    this.#customProviders.set(config.id, config);
  }

  #persistCustomProviders(): void {
    this.#setProfilePreference(
      "custom-providers",
      [...this.#customProviders.values()].map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        logoDataUrl: provider.logoDataUrl,
        models: provider.models.map((model) => ({
          id: model.id,
          name: model.name,
        })),
      })),
    );
  }

  async #providerDtos(): Promise<ProviderDto[]> {
    const configured = await Promise.all(
      this.#models
        .getProviders()
        .map((provider) => this.#providerDto(provider.id)),
    );
    // A local runtime nobody has set up yet is still offered, in the same list
    // as everything else, so it is found where providers are looked for rather
    // than behind a custom-endpoint form.
    const known = new Set(configured.map((provider) => provider.id));
    return [
      ...configured,
      ...LOCAL_RUNTIMES.filter((runtime) => !known.has(runtime.id)).map(
        (runtime): ProviderDto => ({
          id: runtime.id,
          name: runtime.name,
          baseUrl: runtime.baseUrl,
          apiKeyLabel: null,
          supportsOAuth: false,
          storedCredential: false,
          configured: false,
          source: null,
          modelCount: 0,
          custom: true,
          localRuntime: true,
          apiKeys: [],
        }),
      ),
    ];
  }

  /** Reads the models off a local server and files it as a provider under the
   * runtime's own id, so it keeps its name and logo. */
  async #setupLocalRuntime(
    request: SetupLocalRuntimeRequest,
  ): Promise<ProviderDto> {
    const runtime = LOCAL_RUNTIMES.find((item) => item.id === request.id);
    if (!runtime) throw new Error(`Unknown local runtime: ${request.id}`);
    const baseUrl = request.baseUrl ?? runtime.baseUrl;
    const models = await discoverModels({ baseUrl });
    this.#registerCustomProvider({
      id: runtime.id,
      name: runtime.name,
      baseUrl,
      models: models.map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
      })),
    });
    this.#persistCustomProviders();
    this.#reconcileAutoRoles();
    return this.#providerDto(runtime.id);
  }

  async #providerDto(providerId: string): Promise<ProviderDto> {
    const provider = this.#models.getProvider(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    const [stored, auth, apiKeys] = await Promise.all([
      this.#credentials.read(providerId),
      this.#models.checkAuth(providerId).catch((): undefined => undefined),
      this.#apiKeys.list(providerId),
    ]);
    return {
      id: provider.id,
      name: provider.name,
      logoDataUrl: this.#customProviders.get(provider.id)?.logoDataUrl,
      baseUrl: this.#customProviders.get(provider.id)?.baseUrl,
      apiKeyLabel: provider.auth.apiKey?.name ?? null,
      supportsOAuth: provider.auth.oauth !== undefined,
      storedCredential: stored !== undefined || apiKeys.length > 0,
      // Configuration means a credential is present, not that its latest
      // authentication attempt succeeded. Invalid keys remain visible as
      // invalid in the detail pane without making the rail look disconnected.
      configured:
        auth !== undefined || stored !== undefined || apiKeys.length > 0,
      source: apiKeys.length
        ? `${apiKeys.length} saved API ${apiKeys.length === 1 ? "key" : "keys"}`
        : (auth?.source ?? null),
      modelCount: provider.getModels().length,
      custom: this.#customProviders.has(provider.id),
      apiKeys,
    };
  }

  async #assertProviderConfigured(providerId: string): Promise<void> {
    const provider = await this.#providerDto(providerId);
    if (provider.configured) return;
    throw new Error(
      `${provider.name} is not configured. Add its API key in Settings → Provider, or choose a configured model.`,
    );
  }

  /** Keep a stale model preference from making chat unusable after credentials
   * are removed or changed. The user's selection wins while it is usable;
   * otherwise the first configured provider becomes the active model. */
  async #ensureConfiguredAgent(): Promise<PolymuxAgent> {
    if (this.#model) {
      const current = await this.#providerDto(this.#model.provider);
      if (current.configured) return this.#requireAgent();
    }

    const providers = await this.#providerDtos();
    for (const provider of providers) {
      if (!provider.configured) continue;
      const model = this.#inference.listModels(provider.id)[0];
      if (!model) continue;
      this.#selectModel({ provider: model.provider, id: model.id });
      return this.#requireAgent();
    }

    throw new Error(
      "No model provider is configured. Add an API key in Settings → Provider, then choose a model.",
    );
  }

  #messageDto(message: StoredMessage) {
    return {
      ...message,
      attachments: this.#storage.listAttachments(message.id),
    };
  }

  #managerSnapshot(): ManagerSnapshotDto {
    return {
      enabled: true,
      jobs: this.#managerJobs.list(),
    };
  }

  #publishManagerJobs(): void {
    if (this.#closing || this.#window.isDestroyed()) return;
    this.#window.webContents.send(
      channels.managerChanged,
      this.#managerSnapshot(),
    );
  }

  #requireAgent(): PolymuxAgent {
    if (!this.#agent)
      throw new Error(
        "No inference model is configured. Set POLYMUX_MODEL to provider/model.",
      );
    return this.#agent;
  }

  #requireRun(runId: string): ActiveAgentRun {
    const run = this.#activeRuns.get(required(runId, "run id"));
    if (!run) throw new Error(`Run is not active: ${runId}`);
    return run;
  }

  #mcpDto(snapshot: ReturnType<McpManager["snapshots"]>[number]): McpServerDto {
    const config = this.#mcpConfigs.get(snapshot.id);
    const capabilities = this.#mcpCapabilities(snapshot);
    return {
      ...snapshot,
      ...capabilities,
      name: config?.name ?? snapshot.id,
      description:
        typeof config?.metadata?.description === "string"
          ? config.metadata.description
          : undefined,
      source:
        config?.metadata?.source === "codex"
          ? "codex"
          : config?.metadata?.source === "official"
            ? "official"
            : "polymux",
      editable: config?.metadata?.source === "polymux",
      enabled: this.#integrationEnabled(
        "mcp-enabled",
        snapshot.id,
        config?.enabled !== false,
      ),
      transport: config?.transport ?? "stdio",
      ...(config?.transport === "stdio"
        ? {
            command: config.command,
            args: config.args,
            env: config.env,
            cwd: config.cwd,
          }
        : config?.transport === "streamable-http"
          ? { url: config.url, headers: config.headers }
          : {}),
    };
  }

  #mcpCapabilities(
    snapshot: ReturnType<McpManager["snapshots"]>[number],
  ): Pick<McpServerDto, "toolNames" | "resourceUris" | "promptNames"> {
    const current = {
      toolNames: snapshot.toolNames,
      resourceUris: snapshot.resourceUris,
      promptNames: snapshot.promptNames,
    };
    const value = this.#profilePreference("mcp-capabilities")?.value;
    const cache =
      value && typeof value === "object" && !Array.isArray(value) ? value : {};
    if (snapshot.status === "connected") {
      const previous = cache[snapshot.id];
      if (JSON.stringify(previous) !== JSON.stringify(current))
        this.#setProfilePreference("mcp-capabilities", {
          ...cache,
          [snapshot.id]: current,
        });
      return current;
    }
    const saved = cache[snapshot.id];
    if (!saved || typeof saved !== "object" || Array.isArray(saved))
      return current;
    const record = saved as Record<string, unknown>;
    return {
      toolNames:
        Array.isArray(record.toolNames) &&
        record.toolNames.every((item) => typeof item === "string")
          ? record.toolNames
          : current.toolNames,
      resourceUris:
        Array.isArray(record.resourceUris) &&
        record.resourceUris.every((item) => typeof item === "string")
          ? record.resourceUris
          : current.resourceUris,
      promptNames:
        Array.isArray(record.promptNames) &&
        record.promptNames.every((item) => typeof item === "string")
          ? record.promptNames
          : current.promptNames,
    };
  }

  #handle<T extends unknown[]>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: T) => unknown,
  ): void {
    this.#registeredChannels.push(channel);
    this.#ipcMain.handle(channel, (event, ...args) => {
      const trustedWindow = this.#trustedWindows.get(event.sender.id);
      if (
        !trustedWindow ||
        event.senderFrame !== trustedWindow.webContents.mainFrame
      )
        throw new Error("Rejected IPC from an untrusted frame");
      return listener(event, ...(args as T));
    });
  }

  /**
   * The autofill channel, which is the one place a *web page* talks to the
   * main process. Everything else is rejected unless it came from the app
   * window; this is rejected unless it came from a browser tab we opened.
   *
   * The origin is taken from the sender's own URL rather than from the
   * message, so a page cannot claim to be a site it is not and read back the
   * password saved for it.
   */
  #registerAutofill(): void {
    this.#ipcMain.on(AUTOFILL_CHANNEL, (event, payload: unknown) => {
      if (!this.#embeddedBrowser.tabIdFor(event.sender)) return;
      const message = autofillMessage(payload);
      if (!message) return;
      const actual = originOf(event.sender.getURL());
      if (!actual || actual !== message.origin) return;
      if (message.kind === "submitted")
        void this.#autofill
          .captureSubmission(message)
          .catch((error: unknown) =>
            console.warn("Could not save the submitted login", error),
          );
    });
  }
}

function managerJobRequest(value: unknown): EnqueueManagerJobRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Manager job request must be an object");
  const input = value as Record<string, unknown>;
  const priority =
    input.priority === undefined ? undefined : managerPriority(input.priority);
  return {
    ...(typeof input.id === "string"
      ? { id: required(input.id, "manager job id") }
      : {}),
    chatId: required(input.chatId, "chat id"),
    text: typeof input.text === "string" ? input.text : "",
    attachments: optionalStringArray(input.attachments, "attachments"),
    asGoal: input.asGoal === true,
    ...(priority ? { priority } : {}),
    dependencyIds: optionalStringArray(input.dependencyIds, "dependency ids"),
  };
}

function managerPriority(value: unknown): JobPriority {
  if (
    value === "background" ||
    value === "normal" ||
    value === "urgent" ||
    value === "attention"
  )
    return value;
  throw new Error(`Unknown manager priority: ${String(value)}`);
}

/**
 * Where an application named in ComputerHistory's exclusions actually lives.
 *
 * The usual folders first, since that is where almost everything is, and
 * Spotlight after — an app run from a disk image, a developer build, or
 * anywhere else the user pointed the picker at is still theirs to exclude, and
 * a row with no icon reads as a failure rather than as a location.
 */
async function applicationBundle(name: string): Promise<string | null> {
  const roots = [
    "/Applications",
    "/Applications/Utilities",
    "/System/Applications",
    "/System/Applications/Utilities",
    path.join(homedir(), "Applications"),
  ];
  const direct = roots
    .map((root) => path.join(root, `${name}.app`))
    .find((candidate) => existsSync(candidate));
  if (direct) return direct;
  try {
    const { stdout } = await promisify(execFile)("mdfind", [
      "-name",
      `${name}.app`,
      "-onlyin",
      "/",
    ]);
    const match = stdout
      .split("\n")
      .find((line) => line.endsWith(`/${name}.app`) && existsSync(line));
    return match ?? null;
  } catch {
    // Spotlight can be off or indexing; the glyph stands in.
    return null;
  }
}

export { modelFromEnvironment } from "./backend/models.js";
