import {detectDesktopDeviceType} from './team/device-type.js';
import {openWeChatDesktop} from '@polymux/wechat';
import {updateDeviceMessage} from './team/device-message.js';
import {DeviceConnections} from "./team/device-connections.js";
import {AccountService} from "./account/account-service.js";
import {AccountDevices} from "./account/account-devices.js";
import {duplicateConversation} from "./backend/duplicate-conversation";
import {rewindConversation} from "./backend/rewind-conversation";
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
import { homedir, tmpdir, userInfo } from "node:os";
import path from "node:path";
import {
  GoalManager,
  MemoryManager,
  PolymuxAgent,
  SkillLoader,
  type AgentPrompts,
  type SkillLoaderOptions,
} from "@polymux/agent";
import { ComputerHistoryManager } from "@polymux/computer";
import type { ActiveAgentRun, AgentToolResult } from "@polymux/core";
import type {
  InferenceModel,
  InferenceService,
  JsonObject,
  ModelRef,
} from "@polymux/inference";
import { PiInference } from "@polymux/inference/pi";
import type {
  ChatDto,
  ChatMentionsDto,
  BroadcastRecipientDto,
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
  CalendarExportRequest,
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
  MessageDto,
  AgentRuntimeDto,
  ConnectExternalProfileRequest,
  CreateChatRequest,
  MergeContactLinkRequest,
  RenameContactRequest,
  SetAgentProviderRequest,
  CreateTeamGroupRequest,
  CreateBotRequest,
  UpdateTeamGroupRequest,
  UpdateBotRequest,
  SendTeamGroupMessageRequest,
  SendAgentMessageRequest,
  PairTeamHostRequest,
  LaptopCapabilityLeaseDto,
  AgentMessageOriginDto,
  TeamGroupDto,
  TeamHostDto,
  BotDto,
  ProfileDto,
  WorkspaceAppDto,
  WorkspaceAppsDto,
  UsageStatsDto,
  PhonePointDto,
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
  validateGoalCommand,
  validateSaveEmailAccount,
  validateSaveMailSignatures,
  validateStartRun,
} from "@polymux/protocol";
import { SqliteStorage } from "@polymux/storage/sqlite";
import { summarizeUsage } from "@polymux/storage";
import type { StoredMessage } from "@polymux/storage";
import { ProfileManager } from "./profiles.js";
import {TeamComputerManager, createTeamWorkspaceTool} from "./team/computers.js";
import {TeamService, createAgentMessageTool, createTeamSetupTool, createTeamConnectionsTool, type BotTransfer} from "./team/service.js";
import {TeamHostClient, TeamHostServer, type TeamDeviceRequest} from "./team/host-server.js";
import {
  createNativeTools,
  importMcpServers,
  McpManager,
  ToolMcpServer,
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
  clipboard,
  desktopCapturer,
  dialog,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  powerMonitor,
  safeStorage,
  session,
  shell,
  webContents,
  type BrowserWindow,
  type IpcMain,
  type IpcMainInvokeEvent,
} from "electron";

import { assistantText, eventDto, storedEventDto } from "./backend/dto.js";
import {writeClipboardContent} from "./system/clipboard.js";
import {ComputerHistoryActivities} from "./agent/computer-history-activities.js";
import {BuiltinAgentRuntime} from "./agent-runtime/builtin.js";
import {AcpAgentRuntime} from "./agent-runtime/acp.js";
import {hostWorkspaceTools, teamWorkspaceTools, teamToolContext} from "./agent-runtime/workspace-tools.js";
import {listAcpRegistry} from "./agent-runtime/registry.js";
import {
  externalAgentEnvironment,
  externalAgentId,
  externalMcpFile,
  externalMcpKey,
  importExternalConfiguration,
  inspectExternalAgentProfiles,
  managedExternalConfigurationDirectory,
} from "./agent-runtime/configuration.js";
import type {AgentRuntime, AgentRuntimeConfig} from "./agent-runtime/types.js";
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
  terminalInput,
  terminalSessionId,
  workspaceSnapshot,
} from "./backend/requests.js";
import {
  applyThemeSource,
  browserSettingsPreference,
  browserSettingsUpdate,
  generalSettingsPreference,
  generalSettingsUpdate,
  reasoningEffort,
} from "./backend/settings.js";
import { generalSettingsStorage } from "./backend/general-settings-storage.js";
import {searchSuggestions} from "./browser/suggestions.js";
import type { CustomProviderConfig } from "./backend/models.js";
import type { RoleSelection } from "./backend/models.js";
import {
  customProviderPreference,
  customProviderRequest,
  discoverModels,
  discoverModelsRequest,
  MODEL_ROLES,
  modelPreference,
  modelRole,
  modelRolesPreference,
  setupLocalRuntimeRequest,
  updateCustomProviderRequest,
} from "./backend/models.js";
import {preferredModel} from "./backend/model-selection.js";
import {
  approximateLocation,
  browserAppName,
  browserBundleId,
  mimetypeOf,
  skillInstructions,
} from "./backend/host.js";
import { speechModeAfterRoleChange } from "./backend/speech-mode.js";
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
} from "./skills/permissions.js";
import {
  discoverAgentMcpServers,
  resolveDiscoveredMcp,
} from "./mcp/discovery.js";
import {financeReadRequest, readBank} from "./finance/bank.js";
import { searchMcpRegistry } from "./mcp/registry.js";
import { PluginRegistry } from "./plugins/registry.js";
import { readManifest as readPluginManifest } from "./plugins/manifest.js";
import { ModelCatalog } from "./inference/model-catalog.js";
import {
  Autofill,
  AUTOFILL_CHANNEL,
  WEBAUTHN_CHANNEL,
  autofillMessage,
} from "./browser/autofill.js";
import {
  buildAutofillOffer,
  parseAutofillItem,
  type AutofillPage,
} from "./browser/locker-fill.js";
import { BrowsingData } from "./browser/data.js";
import { Downloads } from "./browser/downloads.js";
import { EmbeddedBrowser } from "./browser/embedded.js";
import { EncryptedLoginVault } from "./browser/logins.js";
import { SitePermissions, originOf } from "./browser/permissions.js";
import { WebAuthnAccounts } from "./browser/webauthn-accounts.js";
import { applyImport } from "./browser/import/apply.js";
import { discoverBrowsers, importFrom } from "./browser/import/discovery.js";
import { importFromFile } from "./browser/import/files.js";
import type { ImportedData } from "./browser/import/types.js";
import { siteFaviconDataUrl } from "./browser/favicon.js";
import { fetchPageTitle } from "./browser/page-title.js";
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
import { WindowControlMenubar } from "./window-control/menubar.js";
import { PillIcon } from "./window-control/pill-icon.js";
import { WindowControlMonitor } from "./window-control/monitor.js";
import {captureLeasedWindowPreview} from "./window-control/preview.js";
import { AxReader, type AxWindow } from "./system/ax-reader.js";
import { FileReloadWatcher } from "./system/file-reload-watcher.js";
import { DirectoryWatcher } from "./system/directory-watcher.js";
import { polymuxPath } from "./system/paths.js";
import {
  activateNotification,
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
import { Broadcasts } from "./hub/broadcasts.js";
import { ContactLinks } from "./hub/contact-links.js";
import { Drive, createDriveTools } from "@polymux/drive";
import { LockerService } from "./locker/service.js";
import { SupabaseLockerCloud } from "./locker/cloud.js";
import {
  lockerCopyField,
  lockerId,
  lockerIds,
  lockerItemInput,
  lockerPassword,
  lockerStorageMode,
  lockerStorageResolve,
  lockerVaultBlob,
  lockerWebAuthnCreate,
  lockerWebAuthnGet,
} from "./locker/requests.js";
import { electronConsent } from "./system/drive-consent.js";
import { sessionScopedSnapshot } from "./workspace/snapshot.js";
import { PreviewGrants, copyGrantedFile, previewTarget } from "./workspace/preview.js";
import type {
  Homeserver,
  MatrixRoom,
} from "@polymux/hub";
import type {
  WeChatSessionState,
  WeChatStickerCatalogEntry,
} from "@polymux/wechat";
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
      supported: boolean;
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
import { PermissionGuide } from "./system/permission-guide.js";
import { FirstRunPermissions } from "./system/first-run-permissions.js";
import { AppPermissions } from "./system/app-permissions.js";
import { ContactLookup } from "./hub/contacts.js";
import { Reminders } from "./reminders/index.js";
import { createRemindersTools } from "./reminders/tools.js";
import { PhoneController } from "./phone/controller.js";
import { createPhoneTool } from "./phone/tools.js";
import { TerminalSessions } from "./terminal/sessions.js";
import { IdeService } from "./ide/service.js";
import { requiredPath } from "./ide/paths.js";
import { NativeCalendar } from "./calendar/index.js";
import { serializeIcsEvents } from "./calendar/ics.js";
import {
  openSystemPermissionSettings,
  permissionStatus,
  requestSystemPermission,
  systemPermissionStatus,
  useAppPermissions,
} from "./system/permissions.js";
import {builtInPermissionRequestsUser} from "./system/permission-platform.js";

export interface DesktopBackendOptions {
  dataDirectory: string;
  /** Directory containing the packaged whisper.cpp runtime, when bundled. */
  dictationBinaryDirectory?: string;
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
  /** Path to the bundled native/ax-reader.swift accessibility helper. */
  axReaderSourcePath?: string;
  axEventsSourcePath?: string;
  /** Path to native/pill-image.swift, which draws the window-control pill. */
  pillImageSourcePath?: string;
  /** Path to the bundled native/app-permissions.swift privacy helper. */
  appPermissionsSourcePath?: string;
  permissionGuideSourcePath?: string;
  /** Path to the bundled native/contacts.swift bounded lookup helper. */
  contactsSourcePath?: string;
  /** Path to the bundled native/reminders.swift EventKit helper. */
  remindersSourcePath?: string;
  /** Path to the bundled native/calendar.swift EventKit helper. */
  calendarSourcePath?: string;
  /** Path to the bundled native/pty-host.c Terminal helper. */
  ptyHostSourcePath?: string;
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
    loadOlderWeChatHistory?: (roomId: string, limit: number, oldestCachedAt?: number) => Promise<boolean>;
  refreshWeChatMedia?: (roomId: string, eventIds: string[]) => Promise<boolean>;
    /** True only when WeChat's persistent relay can send immediately. */
    weChatOutboundReady?: () => Promise<boolean>;
    weChatOutboundFailure?: () => string | null;
    weChatNativeOnly?: boolean;
    /** Fails closed before a live-test action can wake or enqueue the wrong chat. */
    assertWeChatLiveTestDestination?: (roomId: string) => void;
    /** Passive sender state used by ordinary status polling. */
    weChatOutboundStatus?: () => Promise<boolean>;
    weChatNativeReadable?: () => boolean;
    /** Account-native stickers already observed by the WeChat bridge. */
    weChatStickers?: () => Promise<WeChatStickerCatalogEntry[]>;
    weChatMembers?: (roomId: string) => Promise<import("@polymux/protocol").ChatMemberDto[] | null>;
    weChatGroupInfo?: (roomId: string) => Promise<import("@polymux/protocol").ChatGroupInfoDto>;
    renameWeChatGroup?: (roomId: string, name: string, expectedName: string) => Promise<import("@polymux/protocol").ChatGroupInfoDto>;
    /** Read-only desktop sign-in state after an explicit WeChat wake attempt. */
    weChatSessionState?: () => Promise<WeChatSessionState | null>;
    weChatLogin?: () => Promise<import('@polymux/protocol').WeChatLoginDto>;
    /** Takes it back down again, when WeChat is unlinked from the Hub tab. */
    stopWeChat?: () => Promise<void>;
    waitForWeChatOutbound?: (eventId: string) => Promise<void>;
    discardOutbound?: (eventId: string) => void;
    outboundDeliveryStatus?: (eventId: string) => "unconfirmed" | null;
    recallWeChat?: (roomId: string, eventId: string) => Promise<void>;
    markWeChatRead?: (roomId: string, eventId: string) => Promise<void>;
    /**
     * Registers who to tell when a conversation moves. The homeserver is built
     * before the window, so it reports into the host and the host hands the
     * listener over here.
     */
    onActivity?: (listener: (activity: HubMessageActivity) => void) => void;
  };
}

const MAX_NEW_TAB_APPS = 4;
const DEFAULT_NEW_TAB_APPS = ["drive", "calendar", "hub", "tasks"] as const;
const MEDIA_IMAGE_EXTENSIONS = ["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "webp"] as const;
const MEDIA_VIDEO_EXTENSIONS = ["m4v", "mov", "mp4", "ogv", "webm"] as const;

/** Browser is intentionally absent: it is Polymux's core workspace surface. */
const OFFICIAL_WORKSPACE_APPS: ReadonlyArray<Omit<WorkspaceAppDto, "enabled">> = [
  {
    id: "hub",
    name: "Hub",
    description: "Messages and email across connected accounts.",
    official: true,
    workspaceKind: "hub",
    settingsKind: "hub",
    entry: null,
    pinnable: true,
  },
  {
    id: "drive",
    name: "Drive",
    description: "Files from this computer and connected storage.",
    official: true,
    workspaceKind: "drive",
    settingsKind: "drive",
    entry: null,
    pinnable: true,
  },
  {
    id: "media",
    name: "Media",
    description: "Photos and videos.",
    official: true,
    workspaceKind: "media",
    settingsKind: null,
    entry: null,
    pinnable: true,
  },
  {
    id: "tasks",
    name: "Tasks",
    description: "Tasks created and managed by you and your agent.",
    official: true,
    workspaceKind: "tasks",
    settingsKind: null,
    entry: null,
    pinnable: true,
  },
  {
    id: "calendar",
    name: "Calendar",
    description: "Events and availability from connected calendars.",
    official: true,
    workspaceKind: "calendar",
    settingsKind: null,
    entry: null,
    pinnable: true,
  },
  {
    id: "phone",
    name: "Phone",
    description: "A shared phone screen for you and your agent.",
    official: true,
    workspaceKind: "phone",
    settingsKind: null,
    entry: null,
    pinnable: true,
  },
  {
    id: "locker",
    name: "Locker",
    description: "Passwords, authenticator codes, recovery codes and passkeys.",
    official: true,
    workspaceKind: "locker",
    settingsKind: null,
    entry: null,
    pinnable: true,
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "A command line on this computer.",
    official: true,
    workspaceKind: "terminal",
    settingsKind: null,
    entry: null,
    pinnable: true,
  },
  {
    id: "ide",
    name: "IDE",
    description: "A project folder, the file in front of you, and a terminal.",
    official: true,
    workspaceKind: "ide",
    settingsKind: null,
    entry: null,
    pinnable: true,
  },
  {
    id: "finance",
    name: "Finance",
    description: "Bank accounts and agent payments.",
    official: true,
    workspaceKind: "finance",
    settingsKind: null,
    entry: null,
    pinnable: true,
  },
  {
    id: "usage",
    name: "Usage",
    description: "Tokens, API-equivalent spend, and activity over time.",
    official: true,
    workspaceKind: "usage",
    settingsKind: null,
    entry: null,
    pinnable: true,
  },
];

interface HubMessageActivity {
  roomId: string;
  sender: string;
  senderName: string | null;
  type: string;
  ts: number;
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
  readonly #dataDirectory: string;
  readonly #phone: PhoneController;
  readonly #terminal: TerminalSessions;
  readonly #profiles: ProfileManager;
  #agent?: PolymuxAgent;
  #agentRuntime?: AgentRuntime;
  /** A Team member owns its own long-lived runtime/session. */
  readonly #teamRuntimes = new Map<string, {profileId: string; key: string; runtime: AgentRuntime}>();
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
  readonly #computerHistoryActivities: ComputerHistoryActivities;
  readonly #computerSystem: ElectronComputerHistorySystem;
  readonly #interactionEvents: NativeInteractionEvents;
  #computerObservationStarted = false;
  readonly #recording: RecordingCapture;
  readonly #windowControlMenubar: WindowControlMenubar;
  readonly #windowControl: WindowControlMonitor;
  readonly #firstRunPermissions: FirstRunPermissions;
  readonly #permissionGuide?: PermissionGuide;
  #permissionSettingsRequest = 0;
  readonly #reminders: Reminders;
  readonly #calendar: NativeCalendar;
  readonly #stopCalendarChanges: () => void;
  /**
   * App grants macOS has given a final answer for this session, so the sweep
   * before each run costs nothing once every answer is in. Deliberately not
   * persisted: a restart is the cheapest possible way to notice a grant that
   * changed while the app was not running.
   */
  readonly #dictation: WhisperDictation;
  readonly #mcp = new McpManager();
  readonly #registry: ToolRegistry;
  /** Host-owned app tools shared with ACP agents over a scoped loopback MCP server. */
  readonly #workspaceToolMcp: ToolMcpServer;
  readonly #teamToolMcp: ToolMcpServer;
  /** Fail-closed tool surface for Team runs; never inherits active-profile tools. */
  readonly #teamRegistry: ToolRegistry;
  readonly #teamComputers: TeamComputerManager;
  readonly #team: TeamService;
  readonly #teamHostServer: TeamHostServer;
  #deviceConnections!: DeviceConnections;
  readonly #account: AccountService;
  #accountDevices!: AccountDevices;
  readonly #remoteBots = new Map<string, BotDto>();
  readonly #remoteRunIds = new Set<string>();
  readonly #remoteRunHosts = new Map<string, string>();
  readonly #remoteRunConversations = new Map<string, string>();
  readonly #remoteRunPolls = new Set<string>();
  readonly #remoteRunSequences = new Map<string, number>();
  readonly #remoteTeamRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #remoteTeamRefreshFailures = new Map<string, number>();
  readonly #remoteDevicePolling = new Set<string>();
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
      // "Stop Using <App>" from the window-control pill: end browser control
      // and cancel whatever run was driving it.
      for (const lease of this.#agentSurface.snapshot().leases)
        this.#agentSurface.releaseLease(lease.id);
      for (const run of this.#activeRuns.values())
        run.control.cancel(new Error("Stopped from the window-control menu"));
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
  readonly #plugins: PluginRegistry;
  /** Read once, on the first thing that needs it. */
  #pluginsLoaded?: Promise<void>;
  /** The namespaced ids of the servers plugins contribute, so the MCP tab can
   * be given everything except them: a plugin is configured on its own card,
   * and a row there that could not be edited or removed would be a dead end. */
  readonly #pluginMcpIds = new Set<string>();
  readonly #mcpConfigPath: string;
  readonly #mcpConfigKey: "mcpServers" | "mcp" | undefined;
  readonly #customSkillDirectory: string;
  readonly #mcpConfigWatcher: FileReloadWatcher;
  readonly #customSkillWatcher: DirectoryWatcher;
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
  readonly #webAuthnAccounts: WebAuthnAccounts;
  readonly #downloads: Downloads;
  readonly #loginVault: EncryptedLoginVault;
  readonly #autofill: Autofill;
  readonly #autofillPages = new Map<string, AutofillPage>();
  readonly #autofillDismissed = new Set<string>();
  readonly #browsingData: BrowsingData;
  readonly #comms: Communications;
  /** Polymux-local recipient sets whose sends fan out into private DMs. */
  readonly #broadcasts: Broadcasts;
  readonly #contactLinks: ContactLinks;
  #commsStatusTimer?: NodeJS.Timeout;
  #commsStatusRefresh?: Promise<void>;
  /** The hub's first screen, kept across quitting. */
  readonly #hubCache: HubCache;
  /** The last folder list read per account, so an envelope page can be cached
   * with the folders it belongs beside — the mail pane needs both, and they
   * arrive on separate calls. */
  readonly #mailFolders = new Map<string, MailFolderDto[]>();
  readonly #drive: Drive;
  readonly #locker: LockerService;
  readonly #ide = new IdeService();
  /** Pins every run's tools to one folder, overriding the default output
   * folder. Set by tests and by hosts that embed the backend. */
  readonly #toolDirectory: string | undefined;
  readonly #reloadForProfileChange?: () => void;

  constructor(options: DesktopBackendOptions) {
    this.#dataDirectory = options.dataDirectory;
    this.#phone = new PhoneController({
      ios: { dataDirectory: options.dataDirectory },
    });
    this.#terminal = new TerminalSessions({
      sourcePath: options.ptyHostSourcePath ?? "",
      cacheDirectory: path.join(options.dataDirectory, "bin"),
      onEvent: (event) => this.#sendToTrustedWindows(channels.terminalEvent, event),
    });
    this.#window = options.window;
    this.#trustedWindows.set(options.window.webContents.id, options.window);
    this.#ipcMain = options.ipcMain;
    this.#locker = new LockerService({
      dataDirectory: options.dataDirectory,
      onChanged: () => {
        this.#sendToTrustedWindows(channels.lockerChanged, this.#locker.status());
        this.#refreshAutofillOffers();
      },
    });
    this.#agentSurface.attachLocker({
      status: () => this.#locker.status(),
      unlock: (password) => this.#locker.unlock(password),
      lock: () => this.#locker.lock(),
      matches: (url) => this.#locker.matchesForUrl(url),
      fill: (id) => this.#locker.fillFields(id),
      save: (item) => this.#locker.save(item),
      totp: (id) => this.#locker.totp(id),
      export: () => this.#locker.exportVault(),
      import: (blob) => this.#locker.importVault(blob),
      passkeys: (request) => this.#locker.listPasskeys(request),
      getPasskey: (request) => this.#locker.getPasskey(request),
      createPasskey: (request) => this.#locker.createPasskey(request),
    });
    powerMonitor.on("suspend", () => this.#locker.lock());
    powerMonitor.on("lock-screen", () => this.#locker.lock());
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
    const profileSnapshot = this.#profiles.snapshot();
    const activeProfile = profileSnapshot.activeId;
    const profile = profileSnapshot.profiles.find((candidate) => candidate.id === activeProfile)!;
    const profileDirectory = this.#profiles.directory(activeProfile);
    mkdirSync(profileDirectory, { recursive: true });
    const personalSkills = profile.source
      ? path.join(profile.source.directory, "skills")
      : path.join(profileDirectory, "skills");
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
    this.#memory = new MemoryManager({directory: path.join(profileDirectory, "memories")});
    this.#plugins = new PluginRegistry(homedir(), profileDirectory);
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
    this.#calendar = new NativeCalendar({
      sourcePath: options.calendarSourcePath ?? "",
      cacheDirectory: path.join(options.dataDirectory, "bin"),
      access: { ensure: () => this.#requireCalendarPermission() },
    });
    this.#stopCalendarChanges = this.#calendar.subscribe(() => {
      if (!this.#closing) this.#sendToTrustedWindows(channels.calendarChanged);
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
    this.#computerHistoryActivities = new ComputerHistoryActivities({
      store: this.#computerHistory.store,
      inference: this.#inference,
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
    // Window control drives native windows from the bundled skill, through
    // bash — nothing here is called when it takes one. Its lease registry
    // is the one honest signal, so the pill is driven from that rather than
    // from a hook that does not exist.
    this.#windowControlMenubar = new WindowControlMenubar({
      icon: new PillIcon({
        sourcePath: options.pillImageSourcePath ?? "",
        cacheDirectory: path.join(options.dataDirectory, "bin"),
      }),
      onStopAll: () => {
        for (const run of this.#activeRuns.values())
          run.control.cancel(new Error("Stopped from the window-control menu"));
        this.#windowControlMenubar.hide();
      },
    });
    this.#windowControl = new WindowControlMonitor({
      registryPath: polymuxPath("state", "window-control-leases.json"),
      windows: () => this.#windowSnapshot.windows,
      onChange: (apps) => void this.#windowControlMenubar.update(apps),
    });
    this.#dictation = new WhisperDictation({
      modelDirectory: path.join(options.dataDirectory, "whisper"),
      binaryDirectory: options.dictationBinaryDirectory,
    });
    if (options.permissionGuideSourcePath)
      this.#permissionGuide = new PermissionGuide(options.permissionGuideSourcePath, path.join(options.dataDirectory, "bin"));
    this.#firstRunPermissions = new FirstRunPermissions({
      store: this.#storage,
      enabled: (permission) =>
        builtInPermissionRequestsUser(permission) &&
        this.#generalSettings().permissions[permission],
      status: systemPermissionStatus,
      request: (permission) => this.#requestSystemPermission(permission),
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
      onTabReset: (tabId) => {
        this.#sitePermissions.dismissTab(tabId);
        this.#webAuthnAccounts.dismissTab(tabId);
        this.#clearAutofill(tabId);
      },
    });
    this.#webAuthnAccounts = new WebAuthnAccounts({
      tabIdForFrame: (frame) =>
        this.#embeddedBrowser.tabIdFor(
          frame ? (webContents.fromFrame(frame) ?? null) : null,
        ),
      prompt: (prompt) => {
        if (this.#closing || this.#window.isDestroyed()) return;
        this.#window.webContents.send(channels.browserEvent, {
          type: "webauthn",
          prompt,
        });
        this.#notifier.notify({
          kind: "agent-attention",
          title: "Choose a passkey",
          body: notificationBody(
            `Choose the account to use on ${prompt.relyingPartyId}.`,
          ),
          target: { kind: "browser", tabId: prompt.tabId },
        });
      },
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
          target: {kind: "browser", tabId: prompt.tabId},
        });
      },
    });
    // Polymux's own configuration lives in ~/.polymux next to its skills, not
    // buried in the platform's application-support directory: it is a file the
    // user is meant to be able to open, and a skill or script may be asked to.
    const sourcedMcp = profile.source
      ? externalMcpFile(profile.source.agentId, profile.source.directory)
      : undefined;
    this.#mcpConfigPath = sourcedMcp ?? path.join(profileDirectory, "mcp.json");
    this.#mcpConfigKey = sourcedMcp && profile.source
      ? externalMcpKey(profile.source.agentId)
      : undefined;
    // A synced profile edits the external agent's live skill directory. Local
    // and imported profiles keep their editable copy inside ~/.polymux.
    this.#customSkillDirectory = personalSkills;
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
    // The in-process callback retains the richer metadata used by native
    // notifications. UI freshness follows Matrix `/sync` below, which also
    // works when Communications points at an external homeserver.
    options.hub?.onActivity?.((activity) => {
      void this.#notifyHubMessage(activity);
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
            loadOlderWeChatHistory: options.hub.loadOlderWeChatHistory,
            refreshWeChatMedia: options.hub.refreshWeChatMedia,
            weChatOutboundReady: options.hub.weChatOutboundReady,
            weChatOutboundFailure: options.hub.weChatOutboundFailure,
            weChatNativeOnly: options.hub.weChatNativeOnly,
            assertWeChatLiveTestDestination:
              options.hub.assertWeChatLiveTestDestination,
            weChatOutboundStatus: options.hub.weChatOutboundStatus,
            weChatNativeReadable: options.hub.weChatNativeReadable,
            weChatStickers: options.hub.weChatStickers,
            weChatMembers: options.hub.weChatMembers,
            weChatGroupInfo: options.hub.weChatGroupInfo,
            renameWeChatGroup: options.hub.renameWeChatGroup,
            weChatSessionState: options.hub.weChatSessionState,
            weChatLogin: options.hub.weChatLogin,
            stopWeChat: options.hub.stopWeChat,
            waitForWeChatOutbound: options.hub.waitForWeChatOutbound,
            discardOutbound: options.hub.discardOutbound,
            outboundDeliveryStatus: options.hub.outboundDeliveryStatus,
            recallWeChat: options.hub.recallWeChat,
            markWeChatRead: options.hub.markWeChatRead,
          }
        : undefined,
      storage: {
        getPreference: (key) => this.#storage.getPreference(key),
        setPreference: (key, value) => this.#storage.setPreference(key, value),
      },
      onChange: (status) => {
        if (this.#closing) return;
        // The configured rail is local, durable state. Keep the next Hub
        // mount's first paint current and notify detached workspace windows as
        // well as the primary window where Settings usually lives.
        this.#hubCache.putStatus(status);
        this.#sendToTrustedWindows(channels.commsChanged, status);
      },
      onActivity: (activity) => {
        if (this.#closing || this.#window.isDestroyed()) return;
        this.#window.webContents.send(channels.commsActivity, {
          chatId: activity.roomId,
          sender: activity.sender,
        });
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
    this.#comms.startBackgroundSync();
    this.#broadcasts = new Broadcasts(this.#storage, {
      openDirect: (recipient) => {
        if (!recipient.remoteId)
          throw new Error(`${recipient.name} is not available for a new direct chat.`);
        return this.#comms.createChat({
          platform: recipient.platform,
          accountId: recipient.accountId,
          participantIds: [recipient.remoteId],
        });
      },
      send: async (chatId, body) => {
        await this.#comms.sendChat(chatId, body);
      },
    });
    this.#contactLinks = new ContactLinks(this.#storage);
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
    this.#runResources = new RunResourceRecorder(
      {
        createArtifact: (input) => this.#storage.createArtifact(input),
        listArtifacts: (conversationId) =>
          this.#storage.listArtifacts(conversationId),
        createReference: (input) => this.#storage.createReference(input),
        listReferences: (conversationId) =>
          this.#storage.listReferences(conversationId),
        updateReferenceTitle: (id, title) =>
          this.#storage.updateReferenceTitle(id, title),
        pageTitleFor: (url) => historyPageTitle(this.#storage, url),
      },
      undefined,
      {
        resolveTitle: (url) => fetchPageTitle(session.defaultSession, url),
        onChanged: (conversationId) => {
          if (!this.#closing && !this.#window.isDestroyed())
            this.#window.webContents.send(
              channels.resourcesChanged,
              conversationId,
            );
        },
      },
    );
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
          target: {
            kind: "conversation",
            conversationId: result.conversationId,
          },
        });
        return result;
      } catch (error) {
        this.#notifier.notify({
          kind: "schedule-failed",
          title: schedule.title,
          body: notificationBody(
            error instanceof Error ? error.message : String(error),
          ),
          target: {
            kind: "workspace",
            request: { surface: "tasks" },
          },
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
    this.#teamComputers = new TeamComputerManager();
    this.#team = new TeamService({
      storage: this.#storage,
      profiles: this.#profiles,
      computers: this.#teamComputers,
      isConversationRunning: (conversationId) =>
        [...this.#activeRuns.keys()].some(
          (runId) => this.#storage.getRun(runId)?.conversationId === conversationId,
        ),
      deliver: (message) => this.#deliverAgentMessage(message),
      requestLaptopAccess: (member, capability, tool) =>
        this.#requestTeamLaptopAccess(member.name, capability, tool),
      publish: () => { this.#publishAllBots(); },
      publishGroups: (groups) => {
        if (!this.#closing && !this.#window.isDestroyed())
          this.#window.webContents.send(channels.teamGroupsChanged, groups);
      },
      writeHostSecret: async (hostId, secret) => {
        const credentialId = `polymux-host:${hostId}`;
        if (secret === null) {
          await this.#credentials.delete(credentialId);
          return;
        }
        await this.#credentials.modify(credentialId, async () => ({
          type: "api_key",
          key: secret,
        }));
      },
      validateProfile: (profileId) => this.#assertTeamProfile(profileId),
      transferDirectory: path.join(this.#dataDirectory, "team-transfers"),
    });
    const publicHostEndpoint = process.env.POLYMUX_HOST_PUBLIC_ENDPOINT?.trim() || null;
    this.#teamHostServer = new TeamHostServer({
      deviceType: detectDesktopDeviceType(),
      storage: this.#storage,
      host: process.env.POLYMUX_HOST_LISTEN?.trim() || undefined,
      port: hostPort(process.env.POLYMUX_HOST_PORT),
      publicEndpoint: publicHostEndpoint,
      relayEndpoint: hostRelayEndpoint(publicHostEndpoint),
      call: (method, args) => this.#handleTeamHostCall(method, args),
      onPeerApproved: async (peer) => {
        if (peer.endpoint && peer.hostId && peer.secret) {
          await this.#team.savePeerConnection(peer.endpoint, {hostId: peer.hostId, deviceName: peer.deviceName, secret: peer.secret, deviceType: peer.deviceType});
          this.#publishTeamHost();
        }
      },
    });
    this.#deviceConnections = new DeviceConnections(this.#teamHostServer, this.#team, hostRelayEndpoint(publicHostEndpoint) ?? "https://connect.polymux.com", async () => { await this.#teamList(); this.#publishTeamHost(); });
    this.#account = new AccountService({
      url: process.env.POLYMUX_SUPABASE_URL?.trim() || null,
      anonKey: process.env.POLYMUX_SUPABASE_ANON_KEY?.trim() || null,
      credentials: this.#credentials,
      openExternal: (url) => void shell.openExternal(url),
      onBeforeSessionChange: () => this.#accountDevices.withdraw(),
      onSignedIn: () => {
        this.#accountDevices?.start();
        this.#publishAccount();
        void this.#locker.hydrate();
      },
      onSignedOut: () => {
        this.#accountDevices?.revoke();
        this.#publishAccount();
        this.#sendToTrustedWindows(channels.lockerChanged, this.#locker.status());
      },
    });
    this.#accountDevices = new AccountDevices({
      service: this.#account,
      team: this.#team,
      hostServer: this.#teamHostServer,
      credentials: this.#credentials,
      appVersion: appVersion().version,
      onHostsChanged: () => this.#publishTeamHost(),
    });
    this.#locker.attachCloud(new SupabaseLockerCloud(this.#account));
    void this.#account.restore().then(() => {
      if (this.#account.status().signedIn) this.#accountDevices.start();
      void this.#locker.hydrate();
    });
    this.#team.setLocalHostInfo(() => {
      const snapshot = this.#teamHostServer.snapshot();
      return {
        endpoint: snapshot.endpoint,
        deviceType: snapshot.deviceType,
        pairingCode: snapshot.pairingCode,
        pairingExpiresAt: snapshot.pairingExpiresAt,
        pairedDesktopName: snapshot.pairedDesktopName,
        detail: snapshot.detail,
      };
    });
    this.#team.setLaptopBroker(async (member, capability, tool, input, _context, requiresApproval) =>
      this.#teamHostServer.requestDevice({
        memberId: member.id,
        memberName: member.name,
        capability,
        tool: tool.name,
        input: input as unknown as JsonValue,
        requiresApproval,
      }),
    );
    void this.#teamHostServer.start().then(() => this.#team.publish());
    const teamNativeTools = createNativeTools({
      cwd: (context) => this.#runDirectory(context.runId),
    }).map((tool) => this.#teamComputers.wrapNativeTool(
      tool,
      (runId) => this.#team.botForRun(runId)?.id ?? null,
    ));
    this.#registry = new ToolRegistry(teamNativeTools);
    this.#teamRegistry = new ToolRegistry(teamNativeTools);
    const remindersTools = createRemindersTools(this.#reminders);
    for (const tool of remindersTools)
      this.#registry.register(tool);
    for (const tool of createBrowserControlTools(this.#agentSurface, {
      currentRead: true,
      embeddedBrowser: this.#embeddedBrowser,
    })) {
      const guarded = this.#team.guardLaptopTool(tool, "browser");
      this.#registry.register(guarded);
      this.#teamRegistry.register(guarded);
    }
    // The in-app Browser is the default surface for web work, so the agent
    // drives it directly rather than through the user's external browser.
    const inAppBrowserTool = this.#team.guardLaptopTool(
      createInAppBrowserTool(this.#embeddedBrowser),
      "browser",
    );
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
      const browserWorkflowTool = boundResearch(
        inAppBrowserTool,
        (input) =>
          !workflowActions.has(
            String((input as { action?: unknown })?.action ?? ""),
          ),
      );
      this.#registry.register(browserWorkflowTool);
      this.#teamRegistry.register(browserWorkflowTool);
      const browserBatchTool = boundResearch(this.#team.guardLaptopTool(
        createInAppBrowserBatchTool(this.#embeddedBrowser),
        "browser",
      ));
      this.#registry.register(browserBatchTool);
      this.#teamRegistry.register(browserBatchTool);
      this.#browserResearchTool = this.#team.guardLaptopTool(
        createInAppBrowserReadTool(this.#embeddedBrowser),
        "browser",
      ) as InAppBrowserResearchTool;
    const browserReadTool = boundResearch(this.#browserResearchTool);
    this.#registry.register(browserReadTool);
    this.#teamRegistry.register(browserReadTool);
    // The work the agent does lands in places the user cannot see while it
    // happens, so it needs a way to answer "show me" by opening one.
    // Both halves of the workspace surface run off the same revealer: one
    // shows a pane, the other writes into it. Only the showing half is kept
    // from delegated runs.
    const workspaceTool = createWorkspaceTool(this.#workspaceRevealer());
    const hubDraftTool = createHubDraftTool(this.#workspaceRevealer());
    this.#registry.register(workspaceTool);
    this.#registry.register(hubDraftTool);
    const phoneTool = createPhoneTool(this.#phone);
    this.#registry.register(phoneTool);
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
    const scheduleTool = createScheduleTool(this.#scheduler);
    this.#registry.register(scheduleTool);
    const tasksTool = createTasksTool(
      this.#tasks,
      (runId) => this.#storage.getRun(runId)?.conversationId ?? null,
    );
    this.#registry.register(tasksTool);
    // Showing the agent a workflow is a chat request too, so the recorder is
    // always present rather than something the user has to switch on first.
    this.#registry.register(createRecordingTool(this.#recording));
    const agentMessageTool = createAgentMessageTool(
      this.#team,
      (input, context) => this.#brokerTeamAgentMessage(input, context.runId),
    );
    this.#registry.register(agentMessageTool);
    this.#teamRegistry.register(agentMessageTool);
    this.#teamRegistry.register(createTeamWorkspaceTool(
      this.#teamComputers,
      (runId) => this.#team.botForRun(runId)?.id ?? null,
      () => this.#drive.outputFolderSync(),
    ));
    this.#teamRegistry.register(createTeamConnectionsTool(this.#team, {
      pool: async () => this.#connectionsPool(),
      connect: async (botId, connections) => {
        const bot = this.#team.bot(botId);
        if (!bot) throw new Error("Unknown Team member");
        const nextSkills = [...new Set([...(bot.skills ?? []), ...(connections.skills ?? [])])];
        const nextMcp = [...new Set([...(bot.mcpServers ?? []), ...(connections.mcpServers ?? [])])];
        const nextPlugins = [...new Set([...(bot.plugins ?? []), ...(connections.plugins ?? [])])];
        return this.#updateBot(botId, {skills: nextSkills, mcpServers: nextMcp, plugins: nextPlugins});
      },
      disconnect: async (botId, connections) => {
        const bot = this.#team.bot(botId);
        if (!bot) throw new Error("Unknown Team member");
        const removeSkills = new Set(connections.skills ?? []);
        const removeMcp = new Set(connections.mcpServers ?? []);
        const removePlugins = new Set(connections.plugins ?? []);
        const nextSkills = (bot.skills ?? []).filter((s) => !removeSkills.has(s));
        const nextMcp = (bot.mcpServers ?? []).filter((m) => !removeMcp.has(m));
        const nextPlugins = (bot.plugins ?? []).filter((p) => !removePlugins.has(p));
        return this.#updateBot(botId, {skills: nextSkills, mcpServers: nextMcp, plugins: nextPlugins});
      },
    }));
    this.#registry.register(createTeamSetupTool(this.#team, {
      options: async () => {
        const host = this.#team.host();
        const profiles = await this.#teamProfiles(host.hostId);
        const connections = await this.#connectionsPool();
        return {host, profiles, connections};
      },
      list: async () => this.#teamList(),
      create: async (request) => this.#createBot(request),
      update: async (id, request) => this.#updateBot(id, request),
      remove: async (id) => this.#removeBot(id),
    }));
    // Messaging and email are app capabilities rather than an MCP server the
    // user has to register, so their tools are always present.
    const communicationsTools = createCommunicationsTools(this.#comms, {
      searchAllEmail: true,
      searchAllEmailTimeoutMs: 3_500,
    });
    for (const tool of communicationsTools)
      this.#registry.register(tool);
    const driveTools = createDriveTools(this.#drive);
    for (const tool of driveTools)
      this.#registry.register(tool);
    this.#workspaceToolMcp = new ToolMcpServer({
      name: "Polymux Workspace",
      version: appVersion().version,
      instructions: [
        "These are Polymux's host-owned tools for Hub, Drive, Browser, Phone, Tasks, Schedule, Reminders, Team, and the workspace drawer.",
        "Use workspace_show to reveal Hub or Drive results when the user asks to see them; use the browser tool's show action for a web page.",
        "Inventory and message context are not permission to send or mutate anything.",
        "A draft must remain unsent. Before a real send, resolve the exact account, recipient, and payload and obtain the user's explicit approval required by the tool description.",
      ].join(" "),
      tools: () => hostWorkspaceTools({
        workspace: workspaceTool,
        hubDraft: hubDraftTool,
        phone: phoneTool,
        browser: [browserWorkflowTool, browserBatchTool, browserReadTool],
        communications: communicationsTools,
        drive: driveTools,
        reminders: remindersTools,
        schedule: scheduleTool,
        tasks: tasksTool,
        agentMessage: agentMessageTool,
        teamSetup: this.#registry.get("team_setup")!,
      }),
      context: (conversationId) => {
        if (this.#team.botByConversation(conversationId)) throw new Error("Assistant tools are unavailable to Team bots");
        const runId = [...this.#activeRuns.keys()].reverse().find((candidate) =>
          this.#storage.getRun(candidate)?.conversationId === conversationId &&
          this.#storage.getRun(candidate)?.status === "running" &&
          !this.#activeRuns.get(candidate)?.control.aborted,
        );
        if (!runId) throw new Error("Workspace tools require an active Assistant run");
        return {runId, budgetScope: runId, subagent: false};
      },
    });
    this.#teamToolMcp = new ToolMcpServer({
      name: "Polymux Team",
      version: appVersion().version,
      instructions: "Use agent_message to coordinate and reply to Team groups. Messages retain your bot identity and do not grant the recipient your permissions. team_workspace and team_connections apply only to your own bot.",
      tools: () => teamWorkspaceTools({
        agentMessage: agentMessageTool,
        workspace: this.#teamRegistry.get("team_workspace")!,
        connections: this.#teamRegistry.get("team_connections")!,
      }),
      context: (conversationId) => teamToolContext(
        conversationId,
        this.#team.botByConversation(conversationId)?.conversationId,
        [...this.#activeRuns].flatMap(([id, active]) => {
          const run = this.#storage.getRun(id);
          return run && !active.control.aborted ? [run] : [];
        }),
      ),
    });
    // Native and ACP agents now receive the same host-owned app capabilities.
    // Native tools are registered above; ACP receives this conversation-scoped
    // MCP view of those exact tool instances.
    // Loopback only; a failed bind (port in use) degrades to no browser control.
    void this.#agentSurface.start().catch(() => {});
    // Prime the window listing; each turn still awaits a fresh snapshot.
    void this.#refreshOpenWindows();
    // Mirror active window-control browser leases into the user's Agent Surface
    // menu-bar pill, when
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
    // already built the agent with the assigned roles, so this only settles
    // the speech-mode consequence of any assignment that disappeared.
    this.#reconcileRoles(false);
    this.#configureAgentRuntime();
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

  /** Sends app-scoped state to every renderer that shares this backend. A
   * detached Hub is still a live Hub even while Settings is in the primary
   * window. */
  #sendToTrustedWindows(channel: string, ...args: unknown[]): void {
    for (const [id, window] of this.#trustedWindows) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        this.#trustedWindows.delete(id);
        continue;
      }
      try {
        window.webContents.send(channel, ...args);
      } catch {
        // One window tearing down must not keep the others stale.
      }
    }
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
    this.#webAuthnAccounts.install(session.defaultSession);
    this.#registerAutofill();
    this.#registerWebAuthn();
    if (this.#firstRunPermissions.completed()) this.#startComputerObservation();
    this.#scheduler.start();
    this.#handle(channels.phoneStatus, () => this.#phone.status());
    this.#handle(channels.phoneConnect, () => this.#phone.connect());
    this.#handle(
      channels.phonePairAndroid,
      (_event, pairingAddress: unknown, pairingCode: unknown, connectAddress: unknown) =>
        this.#phone.pairAndroid(
          required(pairingAddress, "Android pairing address"),
          required(pairingCode, "Android pairing code"),
          typeof connectAddress === "string" && connectAddress.trim()
            ? connectAddress.trim()
            : undefined,
        ),
    );
    this.#handle(channels.phoneIosSigningStatus, () =>
      this.#phone.iosSigningStatus(),
    );
    this.#handle(
      channels.phoneIosSigningBegin,
      (_event, email: unknown, password: unknown) =>
        this.#phone.iosSigningBegin(
          required(email, "Apple Account email"),
          required(password, "Apple Account password"),
        ),
    );
    this.#handle(
      channels.phoneIosSigningComplete,
      (_event, code: unknown) =>
        this.#phone.iosSigningComplete(required(code, "Apple verification code")),
    );
    this.#handle(channels.phoneIosSigningLogout, () =>
      this.#phone.iosSigningLogout(),
    );
    this.#handle(channels.phoneStop, () => this.#phone.stop());
    this.#handle(channels.phoneFrame, () => this.#phone.frame());
    this.#handle(channels.phoneTap, (_event, point: unknown) =>
      this.#phone.tap(point as PhonePointDto),
    );
    this.#handle(
      channels.phoneSwipe,
      (_event, from: unknown, to: unknown, durationMs: unknown) =>
        this.#phone.swipe(
          from as PhonePointDto,
          to as PhonePointDto,
          typeof durationMs === "number" ? durationMs : undefined,
        ),
    );
    this.#handle(channels.phoneType, (_event, value: unknown) =>
      this.#phone.type(required(value, "phone text")),
    );
    this.#handle(channels.phoneHome, () => this.#phone.home());
    this.#handle(channels.terminalCreate, (_event, cwd: unknown) =>
      this.#terminal.create(typeof cwd === "string" && cwd ? cwd : undefined),
    );
    this.#handle(channels.terminalAttach, (_event, id: unknown, cols: unknown, rows: unknown) =>
      this.#terminal.attach(
        terminalSessionId(id),
        terminalSize(cols, "columns"),
        terminalSize(rows, "rows"),
      ),
    );
    this.#handle(channels.terminalWrite, (_event, id: unknown, data: unknown) => {
      const input = terminalInput(data);
      if (input === undefined) return;
      this.#terminal.write(terminalSessionId(id), input);
    });
    this.#handle(channels.terminalResize, (_event, id: unknown, cols: unknown, rows: unknown) => {
      this.#terminal.resize(
        terminalSessionId(id),
        terminalSize(cols, "columns"),
        terminalSize(rows, "rows"),
      );
    });
    this.#handle(channels.terminalClose, (_event, id: unknown) => {
      this.#terminal.close(terminalSessionId(id));
    });
    this.#handle(channels.profilesList, () => this.#profilesForRenderer());
    this.#handle(channels.agentRuntimeGet, () => this.#agentRuntimeDto());
    this.#handle(channels.agentRuntimeRegistry, () => listAcpRegistry());
    this.#handle(
      channels.agentRuntimeInspectConfiguration,
      (_event, value: unknown, sourceDirectory: unknown) => {
        const runtime = agentRuntimeRequest(value);
        if (runtime.kind !== "acp") throw new Error("Only external agents have configuration to inspect");
        return inspectExternalAgentProfiles(
          runtime,
          typeof sourceDirectory === "string" ? sourceDirectory : undefined,
          {cwd: runtime.cwd ?? this.#profiles.directory()},
        );
      },
    );
    this.#handle(channels.agentRuntimeUpdate, async (_event, value: unknown) => {
      if (this.#activeRuns.size)
        throw new Error("Wait for the active agent run to finish before switching agents.");
      const config = agentRuntimeRequest(value);
      await this.#agentRuntime?.close?.();
      this.#setProfilePreference("agent-runtime", config as unknown as JsonValue);
      this.#configureAgentRuntime(config);
      return this.#agentRuntimeDto();
    });
    this.#handle(channels.agentRuntimeSettings, () => {
      const runtime = this.#agentRuntime;
      return runtime instanceof AcpAgentRuntime
        ? runtime.settings()
        : {authMethods: [], authRequired: false, supportsLogout: false, configOptions: [], providers: [], supportsProviders: false};
    });
    this.#handle(channels.agentRuntimeAuthenticate, async (_event, id: unknown) => {
      if (this.#activeRuns.size)
        throw new Error("Wait for the active agent run to finish before signing in.");
      const runtime = this.#agentRuntime;
      if (!(runtime instanceof AcpAgentRuntime))
        throw new Error("The active agent does not expose ACP authentication.");
      return runtime.authenticate(required(id, "ACP authentication method"));
    });
    this.#handle(channels.agentRuntimeLogout, async () => {
      if (this.#activeRuns.size)
        throw new Error("Wait for the active agent run to finish before signing out.");
      const runtime = this.#agentRuntime;
      if (!(runtime instanceof AcpAgentRuntime))
        throw new Error("The active agent does not expose ACP authentication.");
      return runtime.logout();
    });
    this.#handle(channels.agentRuntimeSetConfigOption, async (_event, id: unknown, value: unknown) => {
      if (this.#activeRuns.size)
        throw new Error("Wait for the active agent run to finish before changing its options.");
      const runtime = this.#agentRuntime;
      const config = this.#runtimeConfig();
      if (!(runtime instanceof AcpAgentRuntime) || config.kind !== "acp")
        throw new Error("The active agent does not expose ACP options.");
      const optionId = required(id, "ACP option");
      if (typeof value !== "string" && typeof value !== "boolean")
        throw new Error("ACP option value must be a selection or switch");
      const settings = await runtime.setConfigOption(optionId, value);
      const next = {...config, config: {...config.config, [optionId]: value}};
      this.#setProfilePreference("agent-runtime", next as unknown as JsonValue);
      return settings;
    });
    this.#handle(channels.agentRuntimeSetProvider, async (_event, value: unknown) => {
      if (this.#activeRuns.size)
        throw new Error("Wait for the active agent run to finish before changing its providers.");
      const runtime = this.#agentRuntime;
      if (!(runtime instanceof AcpAgentRuntime))
        throw new Error("The active agent does not expose ACP providers.");
      return runtime.setProvider(agentProviderRequest(value));
    });
    this.#handle(channels.agentRuntimeDisableProvider, async (_event, id: unknown) => {
      if (this.#activeRuns.size)
        throw new Error("Wait for the active agent run to finish before changing its providers.");
      const runtime = this.#agentRuntime;
      if (!(runtime instanceof AcpAgentRuntime))
        throw new Error("The active agent does not expose ACP providers.");
      return runtime.disableProvider(required(id, "ACP provider"));
    });
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
      const profileId = required(id, "profile id");
      const assigned = this.#team.list().filter((member) => member.profileId === profileId);
      if (assigned.length)
        throw new Error(`Move ${assigned.map((member) => member.name).join(", ")} to another profile before deleting this one.`);
      const before = this.#profiles.snapshot().activeId;
      const result = await this.#profiles.remove(profileId);
      if (result.activeId !== before)
        setTimeout(() => this.#reloadForProfileChange?.(), 0);
      return result;
    });
    this.#handle(channels.profilesConnectExternal, async (_event, value: unknown) =>
      this.#connectExternalProfile(externalProfileConnectionRequest(value)),
    );
    this.#handle(
      channels.profilesOpenFolder,
      async (_event, id: unknown, target: unknown) => {
        const profile = this.#profiles.snapshot().profiles.find(
          (candidate) => candidate.id === required(id, "profile id"),
        );
        if (!profile) throw new Error("Unknown profile");
        const directory = target === "source" && profile.source
          ? profile.source.directory
          : this.#profiles.directory(profile.id);
        if (target === "source" && profile.source && !existsSync(directory))
          throw new Error("That external configuration folder no longer exists. Change the profile source to reconnect it.");
        if (target !== "source") await mkdir(directory, {recursive: true});
        const error = await shell.openPath(directory);
        if (error) throw new Error(error);
      },
    );
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
    this.#handle(channels.generalGet, () => this.#generalSettings());
    this.#handle(channels.generalUpdate, (_event, value: unknown) => {
      const previous = this.#generalSettings();
      const next = generalSettingsUpdate(value, previous);
      applyThemeSource(next.theme);
      this.#storeGeneralSettings(next);
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
    this.#handle(channels.clipboardWrite, (_event, value: unknown) =>
      writeClipboardContent(value, {
        clipboard,
        fetch: (url) => net.fetch(url),
        imageFromBuffer: (buffer) => nativeImage.createFromBuffer(buffer),
        imageFromPath: (file) => nativeImage.createFromPath(file),
        resolveLocalFile: (url) => previewTarget(this.previewGrants, url),
      }),
    );
    this.#handle(channels.lockerStatus, () => this.#locker.status());
    this.#handle(channels.lockerCreate, (_event, password: unknown) =>
      this.#locker.create(lockerPassword(password)),
    );
    this.#handle(channels.lockerUnlock, (_event, password: unknown) =>
      this.#locker.unlock(lockerPassword(password)),
    );
    this.#handle(channels.lockerLock, () => this.#locker.lock());
    this.#handle(channels.lockerTouch, () => this.#locker.touch());
    this.#handle(channels.lockerList, () => this.#locker.list());
    this.#handle(channels.lockerReveal, (_event, id: unknown) =>
      this.#locker.reveal(lockerId(id)),
    );
    this.#handle(channels.lockerTotp, (_event, id: unknown) =>
      this.#locker.totp(lockerId(id)),
    );
    this.#handle(channels.lockerSave, (_event, value: unknown) =>
      this.#locker.save(lockerItemInput(value)),
    );
    this.#handle(channels.lockerRemove, (_event, id: unknown) =>
      this.#locker.remove(lockerId(id)),
    );
    this.#handle(channels.lockerRestore, (_event, ids: unknown) =>
      this.#locker.restore(lockerIds(ids)),
    );
    this.#handle(channels.lockerPurge, (_event, ids: unknown) =>
      this.#locker.purge(lockerIds(ids)),
    );
    this.#handle(channels.lockerEmptyTrash, () => this.#locker.emptyTrash());
    this.#handle(channels.lockerPin, (_event, ids: unknown, pinned: unknown) =>
      this.#locker.pin(lockerIds(ids), pinned === true),
    );
    this.#handle(channels.lockerReorder, (_event, ids: unknown) =>
      this.#locker.reorder(lockerIds(ids)),
    );
    this.#handle(channels.lockerChangePassword, (_event, current: unknown, next: unknown) =>
      this.#locker.changePassword(lockerPassword(current, "Current password"), lockerPassword(next, "New password")),
    );
    this.#handle(channels.lockerCodes, () => this.#locker.codes());
    this.#handle(channels.lockerOtpauth, (_event, id: unknown) =>
      this.#locker.otpauth(lockerId(id)),
    );
    this.#handle(
      channels.lockerCopy,
      (_event, id: unknown, field: unknown, recoveryIndex: unknown) => {
        const text = this.#locker.copyText(
          lockerId(id),
          lockerCopyField(field),
          typeof recoveryIndex === "number" ? recoveryIndex : undefined,
        );
        clipboard.writeText(text);
        return true;
      },
    );
    this.#handle(channels.lockerImportBegin, async () => {
      const result = await dialog.showOpenDialog(this.#window, {
        title: "Import into Locker",
        properties: ["openFile"],
        filters: [
          { name: "KeePass or CSV", extensions: ["kdbx", "csv"] },
          { name: "KeePass", extensions: ["kdbx"] },
          { name: "CSV", extensions: ["csv"] },
        ],
      });
      return this.#locker.importBegin(
        result.canceled ? null : (result.filePaths[0] ?? null),
      );
    });
    this.#handle(channels.lockerImportConfirm, (_event, password: unknown) =>
      this.#locker.importConfirm(lockerPassword(password, "KeePass password")),
    );
    this.#handle(channels.lockerSync, () => this.#locker.hydrate());
    this.#handle(channels.lockerSetStorage, (_event, mode: unknown, resolve: unknown) =>
      this.#locker.setStorage(lockerStorageMode(mode), lockerStorageResolve(resolve)),
    );
    this.#handle(channels.financeRead, (_event, value: unknown) => {
      const request = financeReadRequest(value);
      const server = this.#mcp.snapshots().find(server => server.id === request.serverId);
      if (server?.status !== "connected") throw new Error("BankMCP is not connected");
      return readBank(request, this.#mcp.toolsForServers([request.serverId]));
    });
    this.#handle(channels.usageGet, (_event, agentId: unknown) => this.#usageStats(agentId));
    this.#handle(channels.idePickFolder, async () => {
      const result = await dialog.showOpenDialog(this.#window, {
        properties: ["openDirectory"],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    });
    this.#handle(channels.ideList, (_event, root: unknown, target: unknown) =>
      this.#ide.list(
        requiredPath(root, "project"),
        typeof target === "string" ? target : "",
      ),
    );
    this.#handle(channels.ideRead, (_event, root: unknown, target: unknown) =>
      this.#ide.read(requiredPath(root, "project"), requiredPath(target, "file")),
    );
    this.#handle(channels.ideWrite, (_event, root: unknown, target: unknown, content: unknown) => {
      if (typeof content !== "string") throw new Error("File content is required");
      return this.#ide.write(
        requiredPath(root, "project"),
        requiredPath(target, "file"),
        content,
      );
    });
    this.#handle(channels.ideCreate, (_event, root: unknown, target: unknown, content: unknown) =>
      this.#ide.create(
        requiredPath(root, "project"),
        requiredPath(target, "file"),
        typeof content === "string" ? content : "",
      ),
    );
    this.#handle(channels.ideMove, (_event, root: unknown, from: unknown, to: unknown) =>
      this.#ide.move(
        requiredPath(root, "project"),
        requiredPath(from, "file"),
        requiredPath(to, "destination"),
      ),
    );
    if (!this.#suppressAutomaticUpdateChecks) startUpdateChecks();
    this.#handle(channels.permissionsStatus, (_event, value: unknown) =>
      permissionStatus(systemPermission(value)),
    );
    this.#handle(channels.permissionsEnsureFirstRun, () =>
      this.#firstRunPermissions.ensure(),
    );
    this.#handle(channels.permissionsRequest, (_event, value: unknown) =>
      this.#requestSystemPermission(systemPermission(value)),
    );
    this.#handle(channels.permissionsOpenSettings, async (_event, value: unknown) => {
      const kind = systemPermission(value, true);
      const request = ++this.#permissionSettingsRequest;
      if (kind !== "screen-recording") this.#permissionGuide?.dismiss();
      // Linux grants media through its portal, without a separate Settings
      // destination. Keep the new link actionable on that platform too.
      if (process.platform === "linux" && (kind === "microphone" || kind === "screen-recording")) {
        await this.#requestSystemPermission(kind);
        return;
      }
      await openSystemPermissionSettings(kind);
      if (kind === "screen-recording" && request === this.#permissionSettingsRequest)
        await this.#permissionGuide?.open();
    });
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
      this.#team.assistantConversations(),
    );
    this.#handle(channels.conversationsListArchived, () =>
      this.#team.archivedAssistantConversations(),
    );
    this.#handle(channels.conversationsDuplicate, async (_event, id: string, throughMessageId?: string) => {
      const conversationId = required(id, 'conversation id');
      const deviceId = this.#team.executionDevice(conversationId);
      if (deviceId === this.#team.localHost().hostId) return duplicateConversation(this.#storage, conversationId, throughMessageId === undefined ? undefined : required(throughMessageId, 'fork message id'));
      const copy = await (await this.#remoteTeamClient(deviceId)).call<{id: string; title: string}>('conversations.duplicate', [conversationId, ...(throughMessageId === undefined ? [] : [required(throughMessageId, 'fork message id')])]);
      const mirror = this.#storage.createConversation({id: copy.id, title: copy.title});
      this.#storage.setPreference(`assistant.device:${copy.id}`, deviceId);
      return mirror;
    });
    this.#handle(channels.conversationsCreate, (_event, title?: string) =>
      this.#storage.createConversation({
        id: crypto.randomUUID(),
        title: title?.trim() || "New chat",
      }),
    );
    this.#handle(
      channels.conversationsRename,
      async (_event, id: string, title: string) => {
        const deviceId = this.#team.executionDevice(required(id, 'conversation id'));
        if (deviceId !== this.#team.localHost().hostId) await (await this.#remoteTeamClient(deviceId)).call('conversations.rename', [id, required(title, 'title')]);
        return this.#storage.updateConversation(id, {title: required(title, 'title')});
      },
    );
    this.#handle(channels.conversationsArchive, async (_event, id: string) =>
      this.#setAssistantArchived(required(id, "conversation id"), true),
    );
    this.#handle(channels.conversationsUnarchive, async (_event, id: string) =>
      this.#setAssistantArchived(required(id, "conversation id"), false),
    );
    this.#handle(channels.conversationsRemove, async (_event, id: string) => {
      const conversationId = required(id, "conversation id");
      const deviceId = this.#team.executionDevice(conversationId);
      if (deviceId !== this.#team.localHost().hostId) await (await this.#remoteTeamClient(deviceId)).call('conversations.remove', [conversationId]);
      // A run can still be appending durable events after the renderer asks to
      // delete its conversation. Cancelling and settling every run in that
      // conversation first keeps those writes from racing the FK cascade.
      // Repeat once children have settled because a parent may have registered
      // a delegated run immediately before observing cancellation.
      await this.#settleConversationRuns(conversationId, "Conversation deleted");
      this.#runResources.forget(conversationId);
      const removed = this.#storage.deleteConversation(conversationId);
      if (this.#managerJobs.removeChat(conversationId))
        this.#publishManagerJobs();
      return removed;
    });
    this.#handle(channels.messagesList, async (_event, id: string) => {
      const conversationId = required(id, "conversation id");
      const deviceId = this.#team.executionDevice(conversationId);
      if (deviceId !== this.#team.localHost().hostId) return (await this.#remoteTeamClient(deviceId)).call<MessageDto[]>("conversations.messages", [conversationId]);
      const remoteMember = this.#remoteMemberByConversation(conversationId);
      if (remoteMember)
        return (await this.#remoteTeamClient(remoteMember.hostId)).call<MessageDto[]>("conversations.messages", [conversationId]);
      return this.#storage.listMessages(conversationId).map((message) => this.#messageDto(message));
    });
    this.#handle(
      channels.messagesUpdate,
      async (
        _event,
        id: string,
        patch: { conversationId?: string; content?: unknown; metadata?: unknown; attachments?: unknown },
      ) => {
        const messageId = required(id, "message id");
        if (patch.conversationId) {
          const deviceId = this.#remoteMemberByConversation(patch.conversationId)?.hostId ?? this.#team.executionDevice(patch.conversationId);
          if (deviceId !== this.#team.localHost().hostId) {
            const client = await this.#remoteTeamClient(deviceId);
            const attachments: string[] = [];
            for (const file of optionalStringArray(patch.attachments, 'attachments')) {
              if ((await stat(file)).size > 12 * 1024 * 1024) throw new Error('Remote attachments must be smaller than 12 MB.');
              const uploaded = await client.call<{path:string}>('conversations.upload', [{conversationId: patch.conversationId, name: path.basename(file), data: (await readFile(file)).toString('base64')}]);
              attachments.push(uploaded.path);
            }
            return client.call<MessageDto>('conversations.updateMessage', [messageId, {...patch, attachments} as JsonValue]);
          }
        }
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
    this.#handle(channels.teamList, () => this.#teamList());
    this.#handle(channels.teamGroupsList, () => this.#team.groups());
    this.#handle(channels.teamGroupCreate, async (_event, value: CreateTeamGroupRequest) =>
      this.#createTeamGroup(value),
    );
    this.#handle(channels.teamGroupUpdate, async (_event, id: string, value: UpdateTeamGroupRequest) =>
      this.#updateTeamGroup(required(id, "Team group id"), value),
    );
    this.#handle(channels.teamGroupMarkRead, (_event, id: string) =>
      this.#team.markGroupRead(required(id, "Team group id")),
    );
    this.#handle(channels.teamGroupRemove, async (_event, id: string) => {
      const groupId = required(id, "Team group id");
      const group = this.#team.group(groupId);
      if (!group) return false;
      await this.#settleConversationRuns(group.conversationId, "Team group deleted");
      return this.#team.removeGroup(groupId);
    });
    this.#handle(channels.teamGroupSend, async (_event, value: SendTeamGroupMessageRequest) =>
      this.#sendTeamGroupMessage(value),
    );
    this.#handle(channels.teamProfiles, async (_event, hostId?: string) =>
      this.#teamProfiles(typeof hostId === "string" && hostId ? hostId : this.#team.host().hostId),
    );
    this.#handle(channels.teamCreate, async (_event, value: CreateBotRequest) =>
      this.#createBot(value),
    );
    this.#handle(
      channels.teamUpdate,
      async (_event, id: string, value: UpdateBotRequest) =>
        this.#updateBot(required(id, "Team member id"), value),
    );
    this.#handle(channels.teamMarkRead, async (_event, id: string) => this.#botMutation<BotDto>(
      required(id, "Team member id"), "team.markRead", [],
      (memberId) => this.#team.markRead(memberId),
    ));
    this.#handle(channels.teamRemove, async (_event, id: string) =>
      this.#removeBot(required(id, "Team member id")),
    );
    this.#handle(channels.teamSend, async (_event, value: SendAgentMessageRequest) => this.#sendTeamMessage(value));
    this.#handle(channels.teamComputerStart, async (_event, id: string) => this.#botMutation<BotDto>(
      required(id, "Team member id"), "team.startComputer", [],
      (memberId) => this.#team.startComputer(memberId),
    ));
    this.#handle(channels.teamComputerStop, async (_event, id: string) => this.#botMutation<BotDto>(
      required(id, "Team member id"), "team.stopComputer", [],
      (memberId) => this.#team.stopComputer(memberId),
    ));
    this.#handle(channels.teamLeases, async (_event, id?: string) => this.#teamLeases(id));
    this.#handle(
      channels.teamLeaseGrant,
      async (_event, id: string, capabilities: LaptopCapabilityLeaseDto["capabilities"], minutes?: number) => this.#botMutation<LaptopCapabilityLeaseDto>(
        required(id, "Team member id"),
        "team.grantLease",
        [capabilities as unknown as JsonValue, minutes ?? 15],
        (memberId) => this.#team.grantLease(memberId, capabilities ?? [], minutes),
      ),
    );
    this.#handle(channels.teamLeaseRevoke, async (_event, id: string) => this.#revokeTeamLease(required(id, "lease id")));
    this.#handle(channels.devicePairing, async (_event, request: import('@polymux/protocol').DevicePairingRequest) => {
      const state = await this.#deviceConnections.request(request);
      if (state.connected || request.action === 'approve' || request.action === 'revoke') {
        await this.#teamList();
        this.#publishTeamHost();
      }
      return state;
    });
    this.#handle(channels.teamHostGet, () => this.#team.host());
    this.#handle(channels.accountGet, () => this.#account.status());
    this.#handle(channels.accountSignInWithPassword, (_event, email: string, password: string) =>
      this.#account.signInWithPassword(required(email, "Email"), String(password ?? "")));
    this.#handle(channels.accountSignUp, (_event, email: string, password: string) =>
      this.#account.signUp(required(email, "Email"), String(password ?? "")));
    this.#handle(channels.accountResendConfirmation, (_event, email: string) =>
      this.#account.resendConfirmation(required(email, "Email")));
    this.#handle(channels.accountRequestPasswordReset, (_event, email: string) =>
      this.#account.requestPasswordReset(required(email, "Email")));
    this.#handle(channels.accountUpdatePassword, (_event, password: string) =>
      this.#account.updatePassword(String(password ?? "")));
    this.#handle(channels.accountSignInWithOAuth, (_event, provider: string) => {
      if (provider !== "google" && provider !== "apple") throw new Error("Unknown sign-in provider.");
      return this.#account.signInWithOAuth(provider);
    });
    this.#handle(channels.accountSwitch, (_event, userId: string) =>
      this.#account.switchTo(required(userId, "Account")));
    this.#handle(channels.accountSignOut, () => this.#account.signOut());
    this.#handle(channels.teamHostsList, () => this.#team.hosts());
    this.#handle(channels.teamHostBeginPairing, (_event, preserveFailures?: boolean) => {
      this.#teamHostServer.beginPairing(preserveFailures === true);
      return this.#publishTeamHost();
    });
    this.#handle(channels.teamHostPair, async (_event, value: PairTeamHostRequest) => {
      const host = await this.#team.pairHost(value);
      await this.#teamList();
      this.#publishTeamHost();
      return host;
    });
    this.#handle(channels.teamHostLocal, async () => {
      await this.#team.useLocalHost();
      return this.#publishTeamHost();
    });
    this.#handle(channels.teamHostDefault, (_event, hostId: string) => {
      this.#team.setDefaultHost(required(hostId, "Host id"));
      return this.#publishTeamHost();
    });
    this.#handle(channels.teamHostRemove, async (_event, hostId: string) => {
      const id = required(hostId, "Host id");
      this.#stopRemoteTeamRefresh(id);
      const hosts = await this.#team.removeHost(id);
      this.#teamHostServer.revokePeer(id);
      for (const [memberId, member] of this.#remoteBots) if (member.hostId === id) this.#remoteBots.delete(memberId);
      for (const [runId, hostId] of this.#remoteRunHosts) if (hostId === id) {
        this.#remoteRunHosts.delete(runId); this.#remoteRunConversations.delete(runId); this.#remoteRunIds.delete(runId);
        const job = this.#managerJobs.forRun(runId);
        if (job?.status === 'running') this.#managerJobs.fail(job.id, 'Device disconnected. The remote work may still be running.');
      }
      this.#publishManagerJobs();
      this.#publishAllBots();
      this.#publishTeamHost();
      return hosts;
    });
    this.#handle(channels.teamHostResetPairing, () => {
      this.#teamHostServer.resetPairing();
      return this.#publishTeamHost();
    });
    this.#handle(channels.runsStart, async (_event, value: unknown) => {
      const request = validateStartRun(value);
      return this.#startRun(request);
    });
    this.#handle(channels.runsCancel, async (_event, runId: string) => {
      const id = required(runId, "run id");
      const hostId = this.#remoteRunHosts.get(id);
      if (hostId) {
        await (await this.#remoteTeamClient(hostId)).call("runs.cancel", [id]);
        return;
      }
      this.#activeRuns.get(id)?.control.cancel();
    });
    this.#handle(
      channels.runsSteer,
      (_event, runId: string, text: string, messageId?: string) => {
        const id = required(runId, "run id");
        const value = required(text, "text");
        const hostId = this.#remoteRunHosts.get(id);
        if (hostId)
          return this.#remoteTeamClient(hostId).then((client) => client.call("runs.steer", [id, value, messageId ?? null]));
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
    this.#handle(channels.managerCancel, async (_event, id: string) => {
      const job = this.#managerJobs.cancel(required(id, "manager job id"));
      if (job.runId && this.#remoteRunHosts.has(job.runId)) await (await this.#remoteTeamClient(this.#remoteRunHosts.get(job.runId)!)).call('runs.cancel', [job.runId]);
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
      async (_event, runId: string, afterSequence = 0) => {
        const id = required(runId, "run id");
        const hostId = this.#remoteRunHosts.get(id);
        if (hostId)
          return (await this.#remoteTeamClient(hostId)).call<RunEventDto[]>("runs.events", [id, number(afterSequence)]);
        const run = this.#storage.getRun(id);
        const conversationId = run?.conversationId ?? "";
        return this.#storage
          .listRunEvents(id, number(afterSequence))
          .map((event) =>
            storedEventDto(event, conversationId, run?.parentRunId ?? null),
          );
      },
    );
    this.#handle(channels.activityPreview, async (_event, value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const request = value as {kind?: unknown; tabId?: unknown; runId?: unknown};
      if (request.kind === "browser") {
        const tabId = typeof request.tabId === "string" ? request.tabId.trim() : "";
        return tabId ? this.#embeddedBrowser.preview(tabId) : null;
      }
      if (request.kind === "computer") {
        const runId = typeof request.runId === "string" ? request.runId.trim() : "";
        if (!runId) return null;
        return captureLeasedWindowPreview({
          registryPath: polymuxPath("state", "window-control-leases.json"),
          runId,
          sources: () => desktopCapturer.getSources({
            types: ["window"],
            thumbnailSize: {width: 720, height: 450},
            fetchWindowIcons: false,
          }),
        });
      }
      return null;
    });
    this.#handle(channels.goalsExecute, (_event, value: unknown) =>
      this.#executeGoal(validateGoalCommand(value)),
    );
    this.#handle(channels.goalsGet, async (_event, conversationId: string) => {
      const id = required(conversationId, 'conversation id');
      const deviceId = this.#team.executionDevice(id);
      return deviceId === this.#team.localHost().hostId ? this.#goals.get(id) : (await this.#remoteTeamClient(deviceId)).call('goals.get', [id]);
    });
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
    this.#handle(channels.calendarCalendars, () => this.#calendar.calendars());
    this.#handle(
      channels.calendarSnapshot,
      (_event, start: unknown, end: unknown) =>
        this.#calendar.snapshot(
          required(start, "calendar range start"),
          required(end, "calendar range end"),
        ),
    );
    this.#handle(
      channels.calendarEvents,
      (_event, start: unknown, end: unknown, calendarIds: unknown) =>
        this.#calendar.events(
          required(start, "calendar range start"),
          required(end, "calendar range end"),
          calendarIds === undefined ? undefined : optionalStringArray(calendarIds, "calendar ids"),
        ),
    );
    this.#handle(channels.calendarCreate, (_event, value: unknown) =>
      this.#calendar.create(value),
    );
    this.#handle(channels.calendarUpdate, (_event, id: unknown, value: unknown) =>
      this.#calendar.update(required(id, "event id"), value),
    );
    this.#handle(channels.calendarRemove, async (_event, id: unknown) => {
      await this.#calendar.remove(required(id, "event id"));
    });
    this.#handle(channels.calendarImport, async (_event, calendarId: unknown) => {
      const result = await dialog.showOpenDialog(this.#window, {
        title: "Import Calendar",
        properties: ["openFile"],
        filters: [{name: "Calendar files", extensions: ["ics", "ical"]}],
      });
      const file = result.canceled ? undefined : result.filePaths[0];
      if (!file) return {imported: 0, skipped: 0, fileName: null};
      return this.#calendar.importIcs(
        await readFile(file, "utf8"),
        required(calendarId, "calendar id"),
        path.basename(file),
      );
    });
    this.#handle(channels.calendarExport, async (_event, value: unknown) => {
      const request = calendarExportRequest(value);
      const events = await this.#calendar.events(request.start, request.end, request.calendarIds);
      const result = await dialog.showSaveDialog(this.#window, {
        title: "Export Calendar",
        defaultPath: `Calendar ${new Date(request.start).toISOString().slice(0, 10)}.ics`,
        filters: [{name: "Calendar file", extensions: ["ics"]}],
      });
      if (result.canceled || !result.filePath) return null;
      await writeFile(result.filePath, serializeIcsEvents(events), "utf8");
      return result.filePath;
    });
    this.#handle(channels.calendarOpenAccounts, async () => {
      if (process.platform === "darwin")
        await shell.openExternal("x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension");
    });
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
        if (enabled) await this.#requestSystemPermission("accessibility");
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
    this.#handle(channels.computerHistoryActivities, (_event, value?: unknown) => {
      const options = computerHistoryQuery(value);
      return this.#computerHistoryActivities.list({
        ...options,
        model: this.#usableRole("compaction") ?? this.#model,
      });
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
    this.#handle(channels.commsEmailSignIn, (_event, provider: unknown) =>
      this.#comms.emailSignIn(mailProvider(provider)),
    );
    this.#handle(channels.commsWake, (_event, value: unknown) =>
      this.#comms.wake(commsPlatform(value)),
    );
    this.#handle(channels.commsWeChatLogin, () => this.#comms.weChatLogin());
    this.#handle(channels.commsWeChatOpen, () => openWeChatDesktop());
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
        ...(room.remoteId ? {remoteId: room.remoteId} : {}),
        ...(room.currentPortal ? {currentPortal: true} : {}),
        ...(room.space ? {space: true} : {}),
        ...(room.defaultSpace ? {defaultSpace: true} : {}),
        ...(room.parentIds?.length ? {parentIds: room.parentIds} : {}),
        accountIds: room.accountIds,
        unreadByAccount: room.unreadByAccount,
        avatarUrl: room.avatarUrl,
        unread: room.unread,
        lastActivity: room.lastActivity,
        preview: room.preview,
        group: room.group,
        official: room.official,
      }));
      this.#hubCache.putChats(chats);
      return chats;
    });
    this.#handle(channels.commsChatContacts, () => this.#comms.contacts());
    this.#handle(channels.commsChatMembers, (_event, chatId: unknown) =>
      this.#comms.chatMembers(required(chatId, "chat id")),
    );
    this.#handle(channels.commsChatGroupInfo, (_event, chatId: unknown) =>
      this.#comms.chatGroupInfo(required(chatId, "chat id")),
    );
    this.#handle(channels.commsChatRenameGroup, (_event, chatId: unknown, name: unknown, expectedName: unknown) => {
      if (typeof expectedName !== "string") throw new Error("The current group name is required");
      return this.#comms.renameChatGroup(required(chatId, "chat id"), required(name, "group name"), expectedName);
    });
    this.#handle(channels.commsContactLinks, () => this.#contactLinks.list());
    this.#handle(channels.commsContactLinkMerge, async (_event, input: unknown) => {
      const value = (input ?? {}) as Partial<MergeContactLinkRequest>;
      const requested = Array.isArray(value.members)
        ? value.members.flatMap((raw) => {
            if (!raw || typeof raw !== "object") return [];
            const member = raw as unknown as Record<string, unknown>;
            const chatId = required(member.chatId, "chat id");
            const remoteId = typeof member.remoteId === "string" && member.remoteId.trim()
              ? member.remoteId.trim()
              : null;
            return [{platform: commsPlatform(member.platform), remoteId, chatId}];
          })
        : [];
      const rooms = await this.#comms.chats();
      const members = requested.map((requestedMember) => {
        const normalizedRemote = requestedMember.remoteId?.normalize("NFKC").toLowerCase();
        const room = rooms.find((candidate) =>
          candidate.platform === requestedMember.platform &&
          (candidate.roomId === requestedMember.chatId ||
            (normalizedRemote && candidate.remoteId?.normalize("NFKC").toLowerCase() === normalizedRemote)));
        if (!room || room.group || room.space)
          throw new Error("Only current direct conversations can be linked.");
        return {
          platform: commsPlatform(room.platform),
          remoteId: room.remoteId ?? null,
          chatId: room.roomId,
        };
      });
      return this.#contactLinks.merge({
        name: required(value.name, "contact name"),
        members,
      });
    });
    this.#handle(channels.commsContactRename, async (_event, input: unknown) => {
      const value = (input ?? {}) as Partial<RenameContactRequest>;
      const raw = value.member;
      if (!raw || typeof raw !== "object") throw new Error("Choose a contact to rename.");
      const requested = {
        platform: commsPlatform(raw.platform),
        remoteId: typeof raw.remoteId === "string" && raw.remoteId.trim()
          ? raw.remoteId.trim()
          : null,
        chatId: required(raw.chatId, "chat id"),
      };
      const normalizedRemote = requested.remoteId?.normalize("NFKC").toLowerCase();
      const rooms = await this.#comms.chats();
      const room = rooms.find((candidate) =>
        candidate.platform === requested.platform &&
        (candidate.roomId === requested.chatId ||
          (normalizedRemote && candidate.remoteId?.normalize("NFKC").toLowerCase() === normalizedRemote)));
      if (!room || room.group || room.space)
        throw new Error("Only a current direct contact can be renamed.");
      return this.#contactLinks.rename({
        name: required(value.name, "contact name"),
        member: {
          platform: commsPlatform(room.platform),
          remoteId: room.remoteId ?? null,
          chatId: room.roomId,
        },
      });
    });
    this.#handle(channels.commsContactLinkRemove, (_event, id: unknown) => {
      this.#contactLinks.remove(required(id, "contact link id"));
    });
    this.#handle(channels.commsChatCreate, async (_event, input: unknown) => {
      const value = (input ?? {}) as Partial<CreateChatRequest>;
      const participantIds = Array.isArray(value.participantIds)
        ? value.participantIds
            .filter((id): id is string => typeof id === "string")
            .map((id) => id.trim())
            .filter(Boolean)
        : [];
      if (participantIds.length === 0) throw new Error("Choose at least one person.");
      if (participantIds.length > 128) throw new Error("A group can include at most 128 people here.");
      const roomId = await this.#comms.createChat({
        platform: commsPlatform(value.platform),
        accountId: required(value.accountId, "account id"),
        participantIds,
        ...(typeof value.name === "string" ? {name: value.name} : {}),
      });
      // The bridge has created a new portal. The next list read is the source
      // of truth; retaining the old snapshot would paint a list that omits it.
      this.#hubCache.clear();
      return roomId;
    });
    this.#handle(channels.commsBroadcasts, () => this.#broadcasts.list());
    this.#handle(channels.commsBroadcastCreate, (_event, input: unknown) => {
      const value = (input ?? {}) as {name?: unknown; recipients?: unknown};
      const recipients = Array.isArray(value.recipients)
        ? value.recipients.flatMap((raw): BroadcastRecipientDto[] => {
            if (!raw || typeof raw !== "object") return [];
            const recipient = raw as Record<string, unknown>;
            const chatId = typeof recipient.chatId === "string" && recipient.chatId.trim()
              ? recipient.chatId.trim()
              : null;
            const remoteId = typeof recipient.remoteId === "string" && recipient.remoteId.trim()
              ? recipient.remoteId.trim()
              : null;
            if (!chatId && !remoteId) return [];
            return [{
              id: required(recipient.id, "contact id"),
              name: required(recipient.name, "contact name"),
              platform: commsPlatform(recipient.platform),
              accountId: required(recipient.accountId, "account id"),
              accountName: typeof recipient.accountName === "string"
                ? recipient.accountName
                : required(recipient.accountId, "account id"),
              remoteId,
              chatId,
              avatarUrl: typeof recipient.avatarUrl === "string" ? recipient.avatarUrl : null,
            }];
          })
        : [];
      return this.#broadcasts.create({
        name: required(value.name, "broadcast name"),
        recipients,
      });
    });
    this.#handle(channels.commsBroadcastMessages, (_event, broadcastId: unknown) =>
      this.#broadcasts.messages(required(broadcastId, "broadcast id")));
    this.#handle(
      channels.commsBroadcastSend,
      (_event, broadcastId: unknown, text: unknown) =>
        this.#broadcasts.send(
          required(broadcastId, "broadcast id"),
          required(text, "message"),
        ),
    );
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
          messages: result.messages.map((message): ChatMessageDto => {
            // Imported outgoing history may use the linked account's bridge
            // ghost rather than the Matrix account. MatrixHub resolves that
            // losslessly from the bridge database; retain the direct-id check
            // for external hubs that do not expose local bridge state.
            const mine = message.mine || (Boolean(me) && message.sender === me);
            return {
              id: message.eventId,
              chatId: message.roomId || required(chatId, "chat id"),
              sender: message.sender,
              // Quotes, reply previews and cached pages also read this field.
              // Ownership wins over an incomplete bridge profile everywhere.
              senderName: mine ? "You" : message.senderName || message.sender,
              senderAvatarUrl: message.senderAvatarUrl,
              body: message.body,
              notice: message.notice,
              deliveryStatus: message.deliveryStatus,
              sentAt: message.sentAt,
              mine,
              attachments: message.attachments,
              linkPreview: message.linkPreview,
              forwarded: message.forwarded,
              call: message.call,
              viewIn: message.viewIn,
              reactions: message.reactions,
              replyTo: message.replyTo,
            };
          }),
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
        mentions: unknown,
      ): Promise<ChatMessageDto> => {
        const room = required(chatId, "chat id");
        const body = required(text, "message");
        const answering = typeof replyTo === "string" ? replyTo : undefined;
        const eventId = await this.#comms.sendChat(
          room,
          body,
          answering,
          chatMentions(mentions),
        );
        return {
          id: eventId,
          deliveryStatus: this.#comms.outboundDeliveryStatus(eventId),
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
          type.includes("wav")
            ? "wav"
            : type.includes("ogg")
              ? "ogg"
              : type.includes("mp4")
                ? "m4a"
                : "webm"
        }`;
        await this.#comms.sendChatFiles(required(chatId, "chat id"), [
          { name, mimetype: type, bytes },
        ]);
      },
    );
    this.#handle(
      channels.commsChatStickers,
      (_event, chatId: unknown) =>
        this.#comms.chatStickers(required(chatId, "chat id")),
    );
    this.#handle(
      channels.commsChatSendSticker,
      (_event, chatId: unknown, stickerId: unknown) =>
        this.#comms.sendChatSticker(
          required(chatId, "chat id"),
          required(stickerId, "sticker id"),
        ),
    );
    this.#handle(
      channels.commsChatRecall,
      (_event, chatId: unknown, messageId: unknown) =>
        this.#comms.recallChat(
          required(chatId, "chat id"),
          required(messageId, "message id"),
        ),
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
      const result = await this.#comms.emailSend({
        account: request.account,
        to: request.to,
        cc: request.cc ?? [],
        bcc: request.bcc ?? [],
        subject: request.subject,
        body: request.body,
        html: request.html,
        draft: request.draft,
        attachments: request.attachments,
        inlineAttachments: request.inlineAttachments,
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
      return result.draft ? {draft: result.draft} : {};
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
      channels.commsMailAttachment,
      (_event, id: unknown, part: unknown, account: unknown, folder: unknown) =>
        this.#comms.mailAttachment(
          required(id, "message id"),
          required(part, "attachment part"),
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
    this.#handle(channels.commsEmailSignaturesSave, (_event, value: unknown) =>
      this.#comms.emailSignaturesSave(validateSaveMailSignatures(value)),
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
        // Installing or enabling instructions does not request OS access.
        // Built-in features request their own grants at the point of use.
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
      await this.#uploadSkill(skillUploadFiles(value));
      return this.#skillDtos();
    });
    this.#handle(channels.skillsInstall, async (_event, spec: unknown) => {
      await installSkillPackage(
        required(spec, "skill package"),
        this.#customSkillDirectory,
      );
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
      await this.#adoptSkill(required(target, "skill path"));
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
    this.#handle(channels.pluginsViews, async () => {
      await this.#ensurePlugins();
      return this.#plugins.views((id) => this.#integrationEnabled("plugin-enabled", id));
    });
    this.#handle(channels.pluginsUpload, async (_event, value: unknown) => {
      await this.#ensurePlugins();
      await this.#uploadPlugin(skillUploadFiles(value));
      await this.#reloadMcpAfterMutation();
      return this.#pluginDtos();
    });
    this.#handle(channels.appsList, () => this.#workspaceApps());
    this.#handle(channels.appsBrowse, async (_event, query: unknown) => {
      const text = typeof query === "string" ? query.trim().toLocaleLowerCase() : "";
      const installed = new Set((await this.#workspaceApps()).apps.map((app) => app.id));
      return OFFICIAL_WORKSPACE_APPS
        .filter((app) => !text || `${app.name} ${app.description}`.toLocaleLowerCase().includes(text))
        .map((app) => ({
          id: app.id,
          name: app.name,
          description: app.description,
          author: "Polymux",
          official: true,
          installed: installed.has(app.id),
        }));
    });
    this.#handle(channels.appsInstall, async (_event, id: unknown) => {
      const appId = required(id, "app id");
      if (!OFFICIAL_WORKSPACE_APPS.some((app) => app.id === appId))
        throw new Error("Unknown marketplace app");
      return this.#workspaceApps();
    });
    this.#handle(
      channels.appsSetEnabled,
      async (_event, id: unknown, enabled: unknown) => {
        const appId = required(id, "app id");
        if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
        const before = await this.#workspaceApps();
        const app = before.apps.find((candidate) => candidate.id === appId);
        if (!app) throw new Error("Unknown app");
        this.#setIntegrationEnabled("app-enabled", appId, enabled);
        if (!enabled && before.pinnedIds.includes(appId))
          this.#setProfilePreference("app-pins", before.pinnedIds.filter((candidate) => candidate !== appId));
        return this.#workspaceApps();
      },
    );
    this.#handle(channels.appsSetPinned, async (_event, value: unknown) => {
      if (!Array.isArray(value) || value.length > MAX_NEW_TAB_APPS)
        throw new Error(`Pinned apps must be an array of at most ${MAX_NEW_TAB_APPS} app ids`);
      const ids = value.map((id) => required(id, "app id"));
      if (new Set(ids).size !== ids.length) throw new Error("Pinned apps cannot contain duplicates");
      const snapshot = await this.#workspaceApps();
      const available = new Set(snapshot.apps.filter((app) => app.enabled && app.pinnable).map((app) => app.id));
      if (ids.some((id) => !available.has(id))) throw new Error("Only enabled workspace apps can be pinned");
      this.#setProfilePreference("app-pins", ids);
      return this.#workspaceApps();
    });
    this.#handle(channels.appsRemove, async (_event, id: unknown) => {
      const appId = required(id, "app id");
      const snapshot = await this.#workspaceApps();
      const app = snapshot.apps.find((candidate) => candidate.id === appId);
      if (!app) throw new Error("Unknown app");
      if (app.official) throw new Error("Official apps cannot be uninstalled");
      throw new Error("This marketplace app is not managed by the installed App registry");
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
    this.#handle(channels.workspaceSaveAs, async (_event, target: unknown) => {
      const url = required(target, "preview url");
      const file = previewTarget(this.previewGrants, url);
      if (!file) throw new Error("Not granted");
      const result = await dialog.showSaveDialog(this.#window, {
        defaultPath: path.join(app.getPath("downloads"), path.basename(file)),
      });
      if (result.canceled || !result.filePath) return null;
      return copyGrantedFile(file, result.filePath);
    });
    this.#handle(channels.workspacePick, async () => {
      const result = await dialog.showOpenDialog(this.#window, {
        properties: ["openFile"],
        filters: [
          {name: "Media", extensions: [...MEDIA_IMAGE_EXTENSIONS, ...MEDIA_VIDEO_EXTENSIONS]},
          {name: "Photos", extensions: [...MEDIA_IMAGE_EXTENSIONS]},
          {name: "Videos", extensions: [...MEDIA_VIDEO_EXTENSIONS]},
        ],
      });
      const chosen = result.canceled ? undefined : result.filePaths[0];
      if (!chosen) return null;
      return {url: this.previewGrants.url(chosen), name: path.basename(chosen)};
    });
    this.#handle(
      channels.browserOpen,
      (
        _event,
        tabId: string,
        url?: string,
        viewport?: {width: number; height: number},
      ) => this.#embeddedBrowser.open(required(tabId, "tab id"), url, viewport),
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
    this.#handle(channels.browserSuggestions, (_event, query: unknown) =>
      searchSuggestions(required(query, "search query")),
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
    this.#handle(
      channels.browserAutofillFill,
      (_event, tabId: unknown, itemId: unknown) =>
        this.#fillAutofill(required(tabId, "tab id"), required(itemId, "item id")),
    );
    this.#handle(channels.browserAutofillDismiss, (_event, tabId: unknown) => {
      this.#dismissAutofill(required(tabId, "tab id"));
    });
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
      channels.browserWebAuthnRespond,
      (_event, id: unknown, credentialId: unknown) => {
        this.#webAuthnAccounts.respond(
          required(id, "passkey prompt id"),
          typeof credentialId === "string" ? credentialId : undefined,
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
    this.#handle(channels.browserPreview, (_event, tabId: string) =>
      this.#embeddedBrowser.preview(required(tabId, "tab id")),
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
          const lastUsed =
            modelPreference(this.#profilePreference("model")?.value) ??
            this.#model;
          const model = preferredModel(
            this.#inference.listModels(id),
            lastUsed,
          );
          if (model)
            this.#selectModel({ provider: model.provider, id: model.id });
        }
        this.#reconcileRoles();
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
        this.#reconcileRoles();
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
        // Signing in must not replace the model the user last selected. Only
        // choose a model for a first-time setup that has no selection yet.
        if (!this.#model) {
          const lastUsed = modelPreference(
            this.#profilePreference("model")?.value,
          );
          const preferred = preferredModel(
            this.#inference.listModels(id),
            lastUsed?.provider === id ? lastUsed : undefined,
          );
          if (preferred)
            this.#selectModel({ provider: preferred.provider, id: preferred.id });
        }
        this.#reconcileRoles();
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
        this.#reconcileRoles(false);
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
        this.#reconcileRoles();
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
        this.#reconcileRoles();
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
      this.#runResources.present(
        this.#storage.listReferences(
          required(conversationId, "conversation id"),
        ),
      ),
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
    const source = await readFile(this.#mcpConfigPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "{}";
        throw error;
      },
    );
    // The active profile reads one MCP config file: its own Polymux mcp.json,
    // or a synced Pi profile's ~/.pi/agent/mcp.json. Claude, Codex, and other
    // agent homes are not consulted during reload.
    const parsed = JSON.parse(source) as unknown;
    const configuration = this.#mcpConfigKey
      ? {mcpServers: parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)[this.#mcpConfigKey] ?? {}
          : {}}
      : parsed;
    const configs = importMcpServers(configuration).map((config) => ({
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

  async close(reason = "Polymux is closing"): Promise<void> {
    this.#closing = true;
    this.#stopRemoteTeamRefresh();
    await this.#comms.close();
    if (this.#commsStatusTimer) clearInterval(this.#commsStatusTimer);
    stopUpdateChecks();
    this.#surfaceMenubar.close();
    void this.#agentSurface.close();
    this.#embeddedBrowser.closeAll();
    this.#webAuthnAccounts.close();
    this.#mcpConfigWatcher.stop();
    this.#customSkillWatcher.stop();
    this.#windowControl.stop();
    this.#windowControlMenubar.hide();
    this.#computerHistory.stop();
    this.#interactionEvents.stop();
    // A recording that outlived the app would keep a tap alive with nobody to
    // end it, so an app quit ends it as an interruption rather than a stop.
    this.#recording.stop("interrupted");
    this.#scheduler.stop();
    this.#dictation.close();
    this.#permissionGuide?.close();
    await this.#phone.close();
    this.#terminal.closeAll();
    this.#locker.close();
    this.#stopCalendarChanges();
    this.#calendar.close();
    const activeRuns = [...this.#activeRuns.values()];
    for (const run of activeRuns) run.control.cancel(new Error(reason));
    for (const channel of this.#registeredChannels)
      this.#ipcMain.removeHandler(channel);
    this.#ipcMain.removeHandler(WEBAUTHN_CHANNEL);
    await Promise.allSettled([
      ...activeRuns.map((run) => run.result),
      ...(this.#mcpReloadInFlight ? [this.#mcpReloadInFlight] : []),
    ]);
    // Consolidation is started after a turn and runs in the background, so on
    // quit it can still be in flight. Waiting for it is what makes a session's
    // memory survive the app closing rather than dying with the process.
    await this.#agent?.settleGoalWork();
    await this.#agentRuntime?.close?.();
    await Promise.allSettled(
      [...this.#teamRuntimes.values()].map(({runtime}) => runtime.close?.()),
    );
    this.#teamRuntimes.clear();
    this.#deviceConnections.close();
    this.#accountDevices?.stop();
    await this.#teamHostServer.close();
    await this.#workspaceToolMcp.close();
    await this.#teamToolMcp.close();
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

  async #teamProfiles(hostId: string): Promise<ProfileDto[]> {
    const host = this.#team.hosts().find((candidate) => candidate.hostId === hostId);
    if (!host) throw new Error("That Polymux Host is not configured on this Desktop.");
    return host.mode === "local"
      ? this.#profilesForRenderer().profiles
      : (await this.#remoteTeamClient(hostId)).call<ProfileDto[]>("team.profiles");
  }

  async #connectionsPool() {
    const skills = (await this.#skillDtos()).map((s) => ({
      name: s.name,
      description: s.description,
    }));
    const mcpServers = this.#mcpDtos(this.#mcp.snapshots()).map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
    }));
    const plugins = this.#pluginDtos().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));
    return {skills, mcpServers, plugins};
  }

  async #brokerTeamAgentMessage(input: JsonObject, runId: string): Promise<AgentToolResult | null> {
    if (input.action === "list") {
      const members = [...this.#team.list(), ...this.#remoteBots.values()];
      const assistants = this.#team.targets().filter((target) => target.kind === "assistant");
      return {
        content: [
          ...members.map((member) => `- ${member.name} [team] — ${member.role} (${member.id}) · ${member.hostName}`),
          ...assistants.map((conversation) => `- ${conversation.name} [assistant] (${conversation.id})`),
        ].join("\n") || "No other Polymux agents or Assistant chats are available.",
      };
    }
    if (input.action !== "send" || typeof input.to !== "string" || typeof input.message !== "string") return null;
    const run = this.#storage.getRun(runId);
    if (!run) return null;
    const sourceMember = this.#team.botByConversation(run.conversationId);
    const attachments = Array.isArray(input.attachments)
      ? input.attachments.filter((item): item is string => typeof item === "string")
      : [];
    const message = await this.#sendTeamMessage({
      to: input.to,
      text: input.message,
      attachments,
      ...(sourceMember ? {fromMemberId: sourceMember.id, automatic: true} : {fromConversationId: run.conversationId}),
    });
    return {
      content: `Delivered agent message ${message.id} to ${input.to}.`,
      metadata: {messageId: message.id, recipient: input.to},
    };
  }

  #teamGroupMemberIds(value: unknown): string[] {
    if (!Array.isArray(value)) throw new Error("Choose Team group members");
    const memberIds = [...new Set(value.map((id) => required(id, "Team member id")))];
    if (memberIds.length < 2) throw new Error("Choose at least two bots");
    for (const id of memberIds)
      if (!this.#bot(id)) throw new Error("A selected bot is no longer available");
    return memberIds;
  }

  #createTeamGroup(request: CreateTeamGroupRequest): TeamGroupDto {
    return this.#team.createGroup({
      name: required(request?.name, "Team group name"),
      memberIds: this.#teamGroupMemberIds(request?.memberIds),
    });
  }

  #updateTeamGroup(id: string, request: UpdateTeamGroupRequest): TeamGroupDto {
    return this.#team.updateGroup(id, {
      ...(request?.name === undefined ? {} : {name: required(request.name, "Team group name")}),
      ...(request?.memberIds === undefined ? {} : {memberIds: this.#teamGroupMemberIds(request.memberIds)}),
    });
  }

  async #sendTeamGroupMessage(request: SendTeamGroupMessageRequest): Promise<MessageDto> {
    const group = this.#team.group(required(request?.id, "Team group id"));
    if (!group) throw new Error("Unknown Team group");
    const text = required(request?.text, "message");
    const memberIds = group.memberIds.filter((id) => this.#bot(id));
    if (!memberIds.length) throw new Error("This group has no available bots");
    const stored = this.#storage.appendMessage({
      id: crypto.randomUUID(),
      conversationId: group.conversationId,
      runId: null,
      role: "user",
      content: text,
      metadata: {teamGroupMessage: {memberIds} as unknown as JsonValue},
    });
    const instruction = [
      text,
      "",
      `This came from the Team group “${group.name}”. Reply to ${group.conversationId} with agent_message when you have a useful response.`,
      "Write the reply as a conversational message; use longer structure only when the work needs it.",
    ].join("\n");
    const deliveries = await Promise.allSettled(memberIds.map((to) => this.#sendTeamMessage({
      to,
      text: instruction,
      fromConversationId: group.conversationId,
    })));
    const failedMemberIds = deliveries.flatMap((result, index) => result.status === "rejected" ? [memberIds[index]!] : []);
    const deliveredMemberIds = memberIds.filter((_, index) => deliveries[index]?.status === "fulfilled");
    const updated = this.#storage.updateMessage(stored.id, {
      metadata: {
        teamGroupMessage: {memberIds, deliveredMemberIds, failedMemberIds} as unknown as JsonValue,
      },
    }) ?? stored;
    this.#team.publish();
    if (!deliveredMemberIds.length)
      throw new Error("The message was saved, but no bot could receive it");
    return this.#messageDto(updated);
  }

  async #sendTeamMessage(request: SendAgentMessageRequest): Promise<MessageDto> {
    const targetName = request.to.normalize("NFKC").toLocaleLowerCase();
    const target = [...this.#team.list(), ...this.#remoteBots.values()].find((member) =>
      member.id === request.to || member.name.normalize("NFKC").toLocaleLowerCase() === targetName,
    );
    const assistantTarget = target ? null : this.#team.targets().find((candidate) =>
      candidate.kind === "assistant" && (
        candidate.id === request.to || candidate.name.normalize("NFKC").toLocaleLowerCase() === targetName
      ),
    ) ?? null;
    if (!target && !assistantTarget) throw new Error("Unknown Team member or Assistant chat");
    const sourceMember = request.fromMemberId ? this.#bot(request.fromMemberId) : null;
    const conversation = !sourceMember && request.fromConversationId
      ? this.#storage.getConversation(request.fromConversationId)
      : null;
    if (!sourceMember && !conversation) throw new Error("An Assistant source conversation is required");
    const sourceHostId = sourceMember?.hostId ?? this.#team.localHost().hostId;
    const targetHostId = target?.hostId ?? this.#team.localHost().hostId;
    if (request.attachments?.length && sourceHostId !== targetHostId)
      throw new Error("Cross-Host agent messages currently support text only. Move the bot or send the attachment separately.");
    const source: AgentMessageOriginDto = sourceMember ? {
      kind: "team",
      memberId: sourceMember.id,
      conversationId: sourceMember.conversationId,
      name: sourceMember.name,
      role: sourceMember.role,
      avatar: sourceMember.avatar,
      traceId: crypto.randomUUID(),
      hop: 0,
      automatic: request.automatic === true,
    } : {
      kind: "assistant",
      memberId: null,
      conversationId: conversation!.id,
      name: conversation!.title || "Assistant",
      role: null,
      avatar: null,
      traceId: crypto.randomUUID(),
      hop: 0,
      automatic: false,
    };
    if (assistantTarget)
      return this.#messageDto(await this.#team.sendFromOrigin({...request, to: assistantTarget.id}, source));
    const host = this.#hostForMember(target!.id);
    const targeted = {...request, to: target!.id};
    if (host.mode === "local")
      return this.#messageDto(await this.#team.sendFromOrigin(targeted, source));
    return (await this.#remoteTeamClient(host.hostId)).call<MessageDto>(
      "team.sendExternal",
      [targeted as unknown as JsonValue, source as unknown as JsonValue],
    );
  }

  async #createBot(request: CreateBotRequest): Promise<BotDto> {
    const hostId = request.hostId?.trim() || this.#team.host().hostId;
    const host = this.#team.hosts().find((candidate) => candidate.hostId === hostId);
    if (!host) throw new Error("Choose a configured Polymux Host.");
    if (host.mode === "local") return this.#team.create({...request, hostId});
    const member = await this.#remoteTeamMutation<BotDto>(
      hostId,
      "team.create",
      [{...request, hostId} as unknown as JsonValue],
    );
    return {...member, hostId, hostName: host.deviceName};
  }

  async #updateBot(id: string, request: UpdateBotRequest): Promise<BotDto> {
    const current = this.#bot(id);
    if (!current) throw new Error("Unknown Team member");
    const targetHostId = request.hostId?.trim() || current.hostId;
    if (targetHostId !== current.hostId)
      return this.#moveBot(current, targetHostId, request);
    const host = this.#hostForMember(id);
    if (host.mode === "local") return this.#team.update(id, request);
    const member = await this.#remoteTeamMutation<BotDto>(
      host.hostId,
      "team.update",
      [id, request as unknown as JsonValue],
    );
    return {...member, hostId: host.hostId, hostName: host.deviceName};
  }

  async #moveBot(
    current: BotDto,
    targetHostId: string,
    request: UpdateBotRequest,
  ): Promise<BotDto> {
    const sourceHost = this.#hostForMember(current.id);
    const targetHost = this.#team.hosts().find((host) => host.hostId === targetHostId);
    if (!targetHost) throw new Error("Choose a configured Polymux Host.");
    const transfer = sourceHost.mode === "local"
      ? await this.#team.exportBot(current.id)
      : await (await this.#remoteTeamClient(sourceHost.hostId)).call<BotTransfer>("team.export", [current.id]);
    transfer.member = {
      ...transfer.member,
      ...(request.name === undefined ? {} : {name: request.name}),
      ...(request.role === undefined ? {} : {role: request.role}),
      ...(request.avatar === undefined ? {} : {avatar: request.avatar}),
      ...(request.laptopAccess === undefined ? {} : {laptopAccess: request.laptopAccess}),
      ...(request.skills === undefined ? {} : {skills: request.skills}),
      ...(request.mcpServers === undefined ? {} : {mcpServers: request.mcpServers}),
      ...(request.plugins === undefined ? {} : {plugins: request.plugins}),
    };
    const profileId = request.profileId ?? current.profileId;
    let imported = false;
    try {
      if (targetHost.mode === "local")
        await this.#team.importBot(transfer, profileId);
      else
        await (await this.#remoteTeamClient(targetHost.hostId)).call<BotDto>(
          "team.import",
          [transfer as unknown as JsonValue, profileId],
        );
      imported = true;
      if (!await this.#removeBotFromHost(current, sourceHost))
        throw new Error("The source Host did not release the bot.");
    } catch (error) {
      if (imported) await this.#removeBotFromHost(
        {...current, hostId: targetHost.hostId, hostName: targetHost.deviceName},
        targetHost,
      ).catch(() => {});
      throw error;
    }
    const members = await this.#teamList();
    const moved = members.find((member) => member.id === current.id && member.hostId === targetHost.hostId);
    if (!moved) throw new Error("The bot moved, but the destination Host did not return it.");
    return moved;
  }

  async #removeBot(id: string): Promise<boolean> {
    const member = this.#bot(id);
    if (!member) return false;
    const removed = await this.#removeBotFromHost(member, this.#hostForMember(id));
    await this.#teamList();
    return removed;
  }

  async #removeBotFromHost(member: BotDto, host: TeamHostDto): Promise<boolean> {
    if (host.mode === "remote")
      return (await this.#remoteTeamClient(host.hostId)).call<boolean>("team.remove", [member.id]);
    await this.#settleConversationRuns(member.conversationId, "Team member deleted");
    await this.#teamRuntimes.get(member.id)?.runtime.close?.();
    this.#teamRuntimes.delete(member.id);
    return this.#team.remove(member.id);
  }

  async #botMutation<T>(
    id: string,
    method: string,
    args: JsonValue[],
    local: (id: string) => T | Promise<T>,
  ): Promise<T> {
    const host = this.#hostForMember(id);
    if (host.mode === "local") return local(id);
    return this.#remoteTeamMutation<T>(host.hostId, method, [id, ...args]);
  }

  async #teamLeases(id?: string): Promise<LaptopCapabilityLeaseDto[]> {
    if (id) return this.#botMutation(
      id,
      "team.leases",
      [],
      (memberId) => this.#team.leases(memberId),
    );
    const remote = await Promise.all(this.#team.hosts().filter((host) => host.mode === "remote").map(async (host) =>
      (await this.#remoteTeamClient(host.hostId)).call<LaptopCapabilityLeaseDto[]>("team.leases"),
    ));
    return [...this.#team.leases(), ...remote.flat()];
  }

  async #revokeTeamLease(id: string): Promise<boolean> {
    if (this.#team.revokeLease(id)) return true;
    for (const host of this.#team.hosts()) {
      if (host.mode !== "remote") continue;
      if (await (await this.#remoteTeamClient(host.hostId)).call<boolean>("team.revokeLease", [id])) return true;
    }
    return false;
  }

  async #remoteTeamClient(hostId: string): Promise<TeamHostClient> {
    const host = this.#team.hosts().find((candidate) => candidate.hostId === hostId);
    if (!host || host.mode !== "remote" || !host.endpoint)
      throw new Error("That Polymux Host is not configured on this Desktop.");
    const credential = await this.#credentials.read(`polymux-host:${hostId}`);
    if (!credential || credential.type !== "api_key" || !credential.key)
      throw new Error("The Polymux Host pairing secret is unavailable. Pair this Desktop again.");
    return new TeamHostClient(host.endpoint, credential.key, this.#team.localHost().deviceType);
  }

  #remoteMemberByConversation(conversationId: string): BotDto | null {
    for (const member of this.#remoteBots.values())
      if (member.conversationId === conversationId) return member;
    return null;
  }

  #bot(id: string): BotDto | null {
    return this.#team.bot(id) ?? this.#remoteBots.get(id) ?? null;
  }

  #hostForMember(id: string): TeamHostDto {
    const member = this.#bot(id);
    if (!member) throw new Error("Unknown Team member");
    const host = this.#team.hosts().find((candidate) => candidate.hostId === member.hostId);
    if (!host) throw new Error(`${member.name}'s Host is no longer configured.`);
    return host;
  }

  async #teamList(): Promise<BotDto[]> {
    const remotes = this.#team.hosts().filter((host) => host.mode === "remote");
    const configured = new Set(remotes.map((host) => host.hostId));
    for (const hostId of [...this.#remoteTeamRefreshTimers.keys()])
      if (!configured.has(hostId)) this.#stopRemoteTeamRefresh(hostId);
    for (const [id, member] of this.#remoteBots)
      if (!configured.has(member.hostId)) this.#remoteBots.delete(id);
    await Promise.all(remotes.map(async (host) => {
      try {
        await this.#refreshRemoteTeamSnapshot(host.hostId, false);
        this.#setRemoteHostState(host.hostId, "connected", null);
      } catch (error) {
        this.#setRemoteHostState(
          host.hostId,
          "disconnected",
          error instanceof Error ? error.message : String(error),
        );
      }
      this.#startRemoteTeamRefresh(host.hostId);
    }));
    return this.#publishAllBots();
  }

  async #remoteTeamMutation<T>(hostId: string, method: string, args: JsonValue[]): Promise<T> {
    const result = await (await this.#remoteTeamClient(hostId)).call<T>(method, args);
    await this.#teamList();
    return result;
  }

  #applyRemoteBots(host: TeamHostDto, members: BotDto[]): void {
    for (const [id, member] of this.#remoteBots)
      if (member.hostId === host.hostId) this.#remoteBots.delete(id);
    for (const member of members)
      this.#remoteBots.set(member.id, {...member, hostId: host.hostId, hostName: host.deviceName});
  }

  #publishAllBots(): BotDto[] {
    const byId = new Map<string, BotDto>();
    for (const member of this.#team.list()) byId.set(member.id, member);
    for (const member of this.#remoteBots.values())
      if (!byId.has(member.id)) byId.set(member.id, member);
    const members = [...byId.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (!this.#closing && !this.#window.isDestroyed())
      this.#window.webContents.send(channels.teamChanged, members);
    return members;
  }

  async #refreshRemoteTeamSnapshot(hostId: string, publish = true): Promise<BotDto[]> {
    const host = this.#team.hosts().find((candidate) => candidate.hostId === hostId);
    if (!host || host.mode !== "remote") throw new Error("That Polymux Host is not configured.");
    const client = await this.#remoteTeamClient(hostId);
    const [members, runs, deviceInfo] = await Promise.all([
      client.call<BotDto[]>("team.list"),
      client.call<Array<{runId: string; conversationId: string}>>("runs.activeAll"),
      client.call<{deviceType?: import("@polymux/protocol").DeviceType}>("devices.info"),
    ]);
    if (!this.#team.hosts().some(candidate => candidate.hostId === hostId)) return [];
    if (deviceInfo.deviceType && deviceInfo.deviceType !== host.deviceType) {
      this.#team.setRemoteHostState(hostId, "connected", null, deviceInfo.deviceType);
      this.#publishTeamHost();
    }
    this.#applyRemoteBots(host, members);
    const activeRunIds = new Set(runs.map((run) => run.runId));
    for (const [runId, runHostId] of [...this.#remoteRunHosts]) {
      if (runHostId !== hostId || activeRunIds.has(runId) || this.#remoteRunPolls.has(runId)) continue;
      this.#remoteRunIds.delete(runId);
      this.#remoteRunHosts.delete(runId);
      this.#remoteRunConversations.delete(runId);
      this.#remoteRunSequences.delete(runId);
    }
    for (const {runId, conversationId} of runs) {
      if (!members.some(member => member.conversationId === conversationId) && this.#team.executionDevice(conversationId) !== hostId) continue;
      this.#remoteRunConversations.set(runId, conversationId);
      this.#remoteRunIds.add(runId);
      this.#remoteRunHosts.set(runId, hostId);
      void this.#pollRemoteRun(runId, hostId);
    }
    return publish ? this.#publishAllBots() : members;
  }

  #startRemoteTeamRefresh(hostId: string): void {
    void this.#pollRemoteDeviceRequests(hostId);
    this.#scheduleRemoteTeamRefresh(hostId, 2_000);
  }

  #scheduleRemoteTeamRefresh(hostId: string, delayMs: number): void {
    if (this.#remoteTeamRefreshTimers.has(hostId)) return;
    const timer = setTimeout(async () => {
      this.#remoteTeamRefreshTimers.delete(hostId);
      if (this.#closing || !this.#team.hosts().some((host) => host.hostId === hostId && host.mode === "remote")) {
        this.#stopRemoteTeamRefresh(hostId);
        return;
      }
      let nextDelay = 2_000;
      try {
        await this.#refreshRemoteTeamSnapshot(hostId);
        this.#remoteTeamRefreshFailures.set(hostId, 0);
        this.#setRemoteHostState(hostId, "connected", null);
      } catch (error) {
        const failures = (this.#remoteTeamRefreshFailures.get(hostId) ?? 0) + 1;
        this.#remoteTeamRefreshFailures.set(hostId, failures);
        nextDelay = Math.min(30_000, 2_000 * 2 ** Math.min(failures, 4));
        this.#setRemoteHostState(
          hostId,
          "disconnected",
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!this.#closing && this.#team.hosts().some((host) => host.hostId === hostId))
        this.#scheduleRemoteTeamRefresh(hostId, nextDelay);
    }, delayMs);
    timer.unref?.();
    this.#remoteTeamRefreshTimers.set(hostId, timer);
  }

  #stopRemoteTeamRefresh(hostId?: string): void {
    const hostIds = hostId ? [hostId] : [...this.#remoteTeamRefreshTimers.keys()];
    for (const id of hostIds) {
      const timer = this.#remoteTeamRefreshTimers.get(id);
      if (timer) clearTimeout(timer);
      this.#remoteTeamRefreshTimers.delete(id);
      this.#remoteTeamRefreshFailures.delete(id);
    }
  }

  #setRemoteHostState(
    hostId: string,
    state: "connected" | "disconnected" | "error",
    detail: string | null,
  ): void {
    const before = this.#team.hosts().find((host) => host.hostId === hostId);
    if (!before) return;
    if (before.state === state && before.detail === detail) return;
    const next = this.#team.setRemoteHostState(hostId, state, detail);
    if (before.state !== next.state || before.detail !== next.detail) this.#publishTeamHost();
  }

  #publishTeamHost(): TeamHostDto {
    const host = this.#team.host();
    if (!this.#closing && !this.#window.isDestroyed()) {
      this.#window.webContents.send(channels.teamHostChanged, host);
      this.#window.webContents.send(channels.teamHostsChanged, this.#team.hosts());
    }
    return host;
  }

  #publishAccount(): void {
    if (!this.#closing && !this.#window.isDestroyed())
      this.#window.webContents.send(channels.accountChanged, this.#account.status());
  }

  async #pollRemoteDeviceRequests(hostId: string): Promise<void> {
    if (this.#remoteDevicePolling.has(hostId)) return;
    this.#remoteDevicePolling.add(hostId);
    try {
      while (!this.#closing && this.#team.hosts().some((host) => host.hostId === hostId && host.mode === "remote")) {
        try {
          const client = await this.#remoteTeamClient(hostId);
          const request = await client.nextDeviceRequest();
          if (!this.#team.hosts().some(host => host.hostId === hostId)) return;
          if (!request) continue;
          const resolution = await this.#resolveRemoteDeviceRequest(request);
          await client.resolveDeviceRequest(request.id, resolution.approved, resolution.result);
        } catch {
          if (!this.#closing) await delay(1_000);
        }
      }
    } finally {
      this.#remoteDevicePolling.delete(hostId);
    }
  }

  async #resolveRemoteDeviceRequest(request: TeamDeviceRequest): Promise<{
    approved: boolean;
    result: AgentToolResult;
  }> {
    if (request.capability === "team" && request.tool === "agent_message") {
      const input = request.input && typeof request.input === "object" && !Array.isArray(request.input)
        ? request.input as JsonObject
        : {};
      if (input.action === "list") return {
        approved: true,
        result: (await this.#brokerTeamAgentMessage(input, "")) ?? {content: "No other Polymux agents are available."},
      };
      if (input.action !== "send" || typeof input.to !== "string" || typeof input.message !== "string")
        return {approved: false, result: {content: "The cross-Host agent message is invalid.", isError: true}};
      try {
        const message = await this.#sendTeamMessage({
          fromMemberId: request.memberId,
          to: input.to,
          text: input.message,
          automatic: true,
          attachments: Array.isArray(input.attachments)
            ? input.attachments.filter((item): item is string => typeof item === "string")
            : [],
        });
        return {
          approved: true,
          result: {
            content: `Delivered agent message ${message.id} to ${input.to}.`,
            metadata: {messageId: message.id, recipient: input.to},
          },
        };
      } catch (error) {
        return {
          approved: false,
          result: {content: error instanceof Error ? error.message : String(error), isError: true},
        };
      }
    }
    const safeName = request.capability === "browser"
      ? request.tool === "browser" || request.tool.startsWith("browser_")
      : request.capability === "computer"
        ? request.tool.startsWith("computer_")
        : false;
    const tool = safeName ? this.#registry.get(request.tool) : undefined;
    if (!tool) return {
      approved: false,
      result: {content: `The paired laptop refused unavailable ${request.capability} tool ${request.tool}.`, isError: true},
    };
    let approved = !request.requiresApproval;
    if (request.requiresApproval) {
      const answer = await dialog.showMessageBox(this.#window, {
        type: "question",
        title: `${request.memberName} needs this laptop`,
        message: `Allow ${request.memberName} to use ${request.capability} controls on this laptop?`,
        detail: `Polymux Host requested “${request.tool}”. Access lasts for 15 minutes and can be revoked from Team.`,
        buttons: ["Allow for 15 minutes", "Deny"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      approved = answer.response === 0;
    }
    if (!approved) return {
      approved: false,
      result: {content: `${request.memberName} was not granted access to this laptop.`, isError: true},
    };
    try {
      const result = await tool.execute(request.input as JsonObject, {
        runId: `remote-device:${request.id}`,
        budgetScope: `remote-device:${request.memberId}`,
        turn: 0,
        callId: request.id,
        signal: new AbortController().signal,
        emitProgress: async () => {},
      });
      return {approved, result};
    } catch (error) {
      return {
        approved,
        result: {content: error instanceof Error ? error.message : String(error), isError: true},
      };
    }
  }

  async #pollRemoteRun(runId: string, hostId: string): Promise<void> {
    if (this.#remoteRunPolls.has(runId)) return;
    this.#remoteRunPolls.add(runId);
    let sequence = this.#remoteRunSequences.get(runId) ?? 0;
    try {
      while (!this.#closing && this.#remoteRunHosts.get(runId) === hostId) {
        try {
          const events = await (await this.#remoteTeamClient(hostId)).call<RunEventDto[]>("runs.events", [runId, sequence]);
          for (const event of events) {
            sequence = Math.max(sequence, event.sequence);
            this.#remoteRunSequences.set(runId, sequence);
            if (!this.#window.isDestroyed()) this.#window.webContents.send(channels.runEvent, event);
          }
          if (events.some((event) => ["run.completed", "run.cancelled", "run.failed", "run.settled"].includes(event.type))) {
            const job = this.#managerJobs.forRun(runId);
            if (job?.status === 'running') {
              if (events.some(event => event.type === 'run.failed')) this.#managerJobs.fail(job.id, 'The remote run failed.');
              else if (events.some(event => event.type === 'run.cancelled')) this.#managerJobs.cancel(job.id);
              else this.#managerJobs.complete(job.id);
              this.#publishManagerJobs();
            }
            this.#remoteRunIds.delete(runId);
            this.#remoteRunHosts.delete(runId);
      this.#remoteRunConversations.delete(runId);
            this.#remoteRunSequences.delete(runId);
            if (job) void this.#drainManagerConversation(job.chatId);
            return;
          }
          await delay(250);
        } catch {
          // A remote Host can briefly disappear while the laptop changes
          // networks. The durable event log is replayed from `sequence` after
          // reconnect, so no agent output is lost or duplicated.
          await delay(1_000);
        }
      }
    } finally {
      this.#remoteRunPolls.delete(runId);
    }
  }

  async #handleTeamHostCall(method: string, args: JsonValue[]): Promise<JsonValue> {
    switch (method) {
      case "team.list": return this.#team.list() as unknown as JsonValue;
      case "team.profiles": return this.#profilesForRenderer().profiles as unknown as JsonValue;
      case "team.create": return this.#team.create(args[0] as unknown as CreateBotRequest) as unknown as JsonValue;
      case "team.update": return this.#team.update(required(args[0], "Team member id"), args[1] as unknown as UpdateBotRequest) as unknown as JsonValue;
      case "team.markRead": return this.#team.markRead(required(args[0], "Team member id")) as unknown as JsonValue;
      case "team.remove": {
        const id = required(args[0], "Team member id");
        const member = this.#team.require(id);
        await this.#settleConversationRuns(member.conversationId, "Team member deleted");
        await this.#teamRuntimes.get(id)?.runtime.close?.();
        this.#teamRuntimes.delete(id);
        return await this.#team.remove(id);
      }
      case "team.export": return await this.#team.exportBot(
        required(args[0], "Team member id"),
      ) as unknown as JsonValue;
      case "team.import": return await this.#team.importBot(
        args[0] as unknown as BotTransfer,
        required(args[1], "profile id"),
      ) as unknown as JsonValue;
      case "team.send": return this.#messageDto(await this.#team.send(args[0] as unknown as SendAgentMessageRequest)) as unknown as JsonValue;
      case "team.sendExternal": return this.#messageDto(await this.#team.sendFromOrigin(
        args[0],
        args[1],
      )) as unknown as JsonValue;
      case "team.startComputer": return await this.#team.startComputer(required(args[0], "Team member id")) as unknown as JsonValue;
      case "team.stopComputer": return await this.#team.stopComputer(required(args[0], "Team member id")) as unknown as JsonValue;
      case "team.leases": return this.#team.leases(typeof args[0] === "string" ? args[0] : undefined) as unknown as JsonValue;
      case "team.grantLease": return this.#team.grantLease(
        required(args[0], "Team member id"),
        Array.isArray(args[1]) ? args[1] as LaptopCapabilityLeaseDto["capabilities"] : [],
        typeof args[2] === "number" ? args[2] : undefined,
      ) as unknown as JsonValue;
      case "team.revokeLease": return this.#team.revokeLease(required(args[0], "lease id"));
      case 'assistant.ensure': {
        const id = required(args[0], 'conversation id');
        if (this.#team.botByConversation(id)) throw new Error('This id belongs to a bot.');
        return (this.#storage.getConversation(id) ?? this.#storage.createConversation({id, title: typeof args[1] === 'string' ? args[1] : 'Assistant'})) as unknown as JsonValue;
      }
      case 'conversations.duplicate': return duplicateConversation(this.#storage, required(args[0], 'conversation id'), args[1] === undefined ? undefined : required(args[1], 'fork message id')) as unknown as JsonValue;
      case "conversations.list": return this.#team.assistantConversations() as unknown as JsonValue;
      case "conversations.listArchived": return this.#team.archivedAssistantConversations() as unknown as JsonValue;
      case "conversations.create": return this.#storage.createConversation({
        id: crypto.randomUUID(),
        title: typeof args[0] === "string" && args[0].trim() ? args[0].trim() : "New chat",
      }) as unknown as JsonValue;
      case "conversations.rename": return this.#storage.updateConversation(
        required(args[0], "conversation id"),
        {title: required(args[1], "title")},
      ) as unknown as JsonValue;
      case "conversations.archive": return await this.#setAssistantArchived(
        required(args[0], "conversation id"),
        true,
      ) as unknown as JsonValue;
      case "conversations.unarchive": return await this.#setAssistantArchived(
        required(args[0], "conversation id"),
        false,
      ) as unknown as JsonValue;
      case "conversations.remove": {
        const conversationId = required(args[0], "conversation id");
        await this.#settleConversationRuns(conversationId, "Conversation deleted from Polymux Phone");
        this.#runResources.forget(conversationId);
        const removed = this.#storage.deleteConversation(conversationId);
        if (this.#managerJobs.removeChat(conversationId)) this.#publishManagerJobs();
        return removed;
      }
      case 'goals.get': return this.#goals.get(required(args[0], 'conversation id')) as unknown as JsonValue;
      case 'goals.execute': return this.#executeLocalGoal(validateGoalCommand(args[0])) as unknown as JsonValue;
      case 'conversations.updateMessage': {
        const message = updateDeviceMessage(this.#storage, required(args[0], 'message id'), args[1] as Parameters<typeof updateDeviceMessage>[2]);
        return message ? this.#messageDto(message) as unknown as JsonValue : null;
      }
      case "conversations.messages": return this.#storage
        .listMessages(required(args[0], "conversation id"))
        .map((message) => this.#messageDto(message)) as unknown as JsonValue;
      case "conversations.upload": return await this.#saveMobileUpload(args[0]);
      case "hub.chats": return await this.#mobileHubChats();
      case "hub.messages": return await this.#mobileHubMessages(
        required(args[0], "chat id"),
        typeof args[1] === "number" ? args[1] : 50,
        typeof args[2] === "string" ? args[2] : undefined,
      ) as unknown as JsonValue;
      case "hub.markRead": {
        if (this.#generalSettings().hubIncognitoMode) return false;
        await this.#comms.markChatRead(
          required(args[0], "chat id"),
          required(args[1], "message id"),
        );
        return true;
      }
      case "hub.send": return await this.#mobileHubSend(
        required(args[0], "chat id"),
        required(args[1], "message"),
      ) as unknown as JsonValue;
      case "hub.sendFiles": return await this.#mobileHubSendFiles(args[0], args[1]);
      case "runs.start": return await this.#startLocalRun(validateStartRun(args[0])) as unknown as JsonValue;
      case "runs.active": return this.#activeTopLevelRuns()
        .filter((run) => Boolean(this.#team.botByConversation(run.conversationId))) as unknown as JsonValue;
      case "runs.activeAll": return this.#activeTopLevelRuns().filter(run => !this.#remoteRunHosts.has(run.runId)) as unknown as JsonValue;
      case "runs.cancel": {
        this.#activeRuns.get(required(args[0], "run id"))?.control.cancel();
        return null;
      }
      case "runs.steer": {
        const runId = required(args[0], "run id");
        const text = required(args[1], "text");
        const run = this.#storage.getRun(runId);
        if (!run) throw new Error(`Run not found: ${runId}`);
        this.#requireRun(runId).control.steer({role: "user", content: text});
        this.#storage.appendMessage({
          id: typeof args[2] === "string" && args[2] ? args[2] : crypto.randomUUID(),
          conversationId: run.conversationId,
          runId,
          role: "user",
          content: text,
        });
        return null;
      }
      case "runs.events": {
        const runId = required(args[0], "run id");
        const run = this.#storage.getRun(runId);
        const conversationId = run?.conversationId ?? "";
        return this.#storage.listRunEvents(runId, typeof args[1] === "number" ? args[1] : 0)
          .map((event) => storedEventDto(event, conversationId, run?.parentRunId ?? null)) as unknown as JsonValue;
      }
      case "locker.status": return this.#locker.status() as unknown as JsonValue;
      case "locker.create": return await this.#locker.create(lockerPassword(args[0])) as unknown as JsonValue;
      case "locker.unlock": return await this.#locker.unlock(lockerPassword(args[0])) as unknown as JsonValue;
      case "locker.lock": return this.#locker.lock() as unknown as JsonValue;
      case "locker.list": return this.#locker.list() as unknown as JsonValue;
      case "locker.reveal": return this.#locker.reveal(lockerId(args[0])) as unknown as JsonValue;
      case "locker.totp": return this.#locker.totp(lockerId(args[0])) as unknown as JsonValue;
      case "locker.save": return await this.#locker.save(lockerItemInput(args[0])) as unknown as JsonValue;
      case "locker.remove": return await this.#locker.remove(lockerId(args[0])) as unknown as JsonValue;
      case "locker.restore": return await this.#locker.restore(lockerIds(args[0])) as unknown as JsonValue;
      case "locker.purge": return await this.#locker.purge(lockerIds(args[0])) as unknown as JsonValue;
      case "locker.emptyTrash": return await this.#locker.emptyTrash() as unknown as JsonValue;
      case "locker.pin": return await this.#locker.pin(lockerIds(args[0]), args[1] === true) as unknown as JsonValue;
      case "locker.reorder": return await this.#locker.reorder(lockerIds(args[0])) as unknown as JsonValue;
      case "locker.changePassword": return await this.#locker.changePassword(
        lockerPassword(args[0], "Current password"),
        lockerPassword(args[1], "New password"),
      ) as unknown as JsonValue;
      case "locker.codes": return this.#locker.codes() as unknown as JsonValue;
      case "locker.otpauth": return this.#locker.otpauth(lockerId(args[0])) as unknown as JsonValue;
      case "locker.copy": return this.#locker.copyText(
        lockerId(args[0]),
        lockerCopyField(args[1]),
        typeof args[2] === "number" ? args[2] : undefined,
      );
      case "locker.sync": return await this.#locker.hydrate() as unknown as JsonValue;
      case "locker.setStorage": return await this.#locker.setStorage(
        lockerStorageMode(args[0]),
        lockerStorageResolve(args[1]),
      ) as unknown as JsonValue;
      case "locker.export": return this.#locker.exportVault() as unknown as JsonValue;
      case "locker.import": return await this.#locker.importVault(lockerVaultBlob(args[0])) as unknown as JsonValue;
      default: throw new Error(`Unsupported Host method: ${method}`);
    }
  }

  async #mobileHubChats(): Promise<JsonValue> {
    const rooms = await this.#comms.chats();
    const chats = rooms.map((room): ChatDto => ({
      id: room.roomId,
      name: room.name,
      platform: room.platform,
      ...(room.remoteId ? {remoteId: room.remoteId} : {}),
      ...(room.currentPortal ? {currentPortal: true} : {}),
      ...(room.space ? {space: true} : {}),
      ...(room.defaultSpace ? {defaultSpace: true} : {}),
      ...(room.parentIds?.length ? {parentIds: room.parentIds} : {}),
      accountIds: room.accountIds,
      unreadByAccount: room.unreadByAccount,
      avatarUrl: room.avatarUrl,
      unread: room.unread,
      lastActivity: room.lastActivity,
      preview: room.preview,
      group: room.group,
      official: room.official,
    }));
    this.#hubCache.putChats(chats);
    return chats as unknown as JsonValue;
  }

  async #mobileHubMessages(
    chatId: string,
    limit: number,
    before?: string,
  ): Promise<{messages: ChatMessageDto[]; nextBefore: string | null}> {
    const result = await this.#comms.readChat(chatId, Math.max(1, Math.min(100, limit)), before);
    const me = this.#comms.userId;
    const page = {
      nextBefore: result.nextBefore ?? null,
      messages: result.messages.map((message): ChatMessageDto => {
        const mine = message.mine || (Boolean(me) && message.sender === me);
        return {
          id: message.eventId,
          chatId: message.roomId || chatId,
          sender: message.sender,
          senderName: mine ? "You" : message.senderName || message.sender,
          senderAvatarUrl: message.senderAvatarUrl,
          body: message.body,
          notice: message.notice,
          deliveryStatus: message.deliveryStatus,
          sentAt: message.sentAt,
          mine,
          attachments: message.attachments,
          linkPreview: message.linkPreview,
          forwarded: message.forwarded,
          call: message.call,
          viewIn: message.viewIn,
          reactions: message.reactions,
          replyTo: message.replyTo,
        };
      }),
    };
    if (!before) this.#hubCache.putChatPage(chatId, page.messages, page.nextBefore);
    return page;
  }

  async #mobileHubSend(chatId: string, body: string): Promise<ChatMessageDto> {
    const eventId = await this.#comms.sendChat(chatId, body);
    return {
      id: eventId,
      deliveryStatus: this.#comms.outboundDeliveryStatus(eventId),
      chatId,
      sender: this.#comms.userId ?? "",
      senderName: "You",
      senderAvatarUrl: null,
      body,
      sentAt: new Date().toISOString(),
      mine: true,
      attachments: [],
      reactions: [],
      replyTo: null,
    };
  }

  async #mobileHubSendFiles(chatValue: JsonValue, filesValue: JsonValue): Promise<JsonValue> {
    const chatId = required(chatValue, "chat id");
    if (!Array.isArray(filesValue) || !filesValue.length) throw new Error("Choose at least one file");
    if (filesValue.length > 6) throw new Error("Send at most six files at once");
    const files = filesValue.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("A Hub attachment is invalid");
      const input = value as Record<string, JsonValue>;
      const name = path.basename(required(input.name, "file name"))
        .replace(/[^a-z0-9._ -]+/gi, "_").slice(0, 180) || "attachment";
      const encoded = required(input.data, "file data");
      if (encoded.length > 16 * 1024 * 1024 || !/^[a-z0-9+/]*={0,2}$/i.test(encoded))
        throw new Error(`${name} is invalid or larger than 12 MB`);
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.byteLength > 12 * 1024 * 1024) throw new Error(`${name} is larger than 12 MB`);
      return {
        name,
        mimetype: typeof input.mimeType === "string" && input.mimeType
          ? input.mimeType.slice(0, 160)
          : "application/octet-stream",
        bytes: new Uint8Array(bytes),
      };
    });
    await this.#comms.sendChatFiles(chatId, files);
    return null;
  }

  async #saveMobileUpload(value: JsonValue): Promise<JsonValue> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Mobile upload must be an object");
    const input = value as Record<string, JsonValue>;
    const conversationId = required(input.conversationId, "conversation id");
    if (!this.#storage.getConversation(conversationId))
      throw new Error("That conversation no longer exists");
    const suppliedName = path.basename(required(input.name, "file name"));
    const name = suppliedName.replace(/[^a-z0-9._ -]+/gi, "_").slice(0, 180) || "attachment";
    const encoded = required(input.data, "file data");
    if (encoded.length > 16 * 1024 * 1024 || !/^[a-z0-9+/]*={0,2}$/i.test(encoded))
      throw new Error("The mobile attachment is invalid or larger than 12 MB");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.byteLength > 12 * 1024 * 1024)
      throw new Error("Mobile attachments may be at most 12 MB");
    const directory = path.join(this.#dataDirectory, "mobile-uploads", conversationId);
    await mkdir(directory, {recursive: true});
    const target = path.join(directory, `${crypto.randomUUID()}-${name}`);
    await writeFile(target, bytes);
    return {
      path: target,
      name,
      mimeType: typeof input.mimeType === "string" ? input.mimeType.slice(0, 160) : null,
      size: bytes.byteLength,
    };
  }

  async #setAssistantArchived(conversationId: string, archived: boolean) {
    const conversation = this.#storage.getConversation(conversationId);
    if (!conversation) return null;
    if (!this.#team.isAssistantConversation(conversationId))
      throw new Error("Only assistant chats can be archived.");
    if (Boolean(conversation.archivedAt) === archived) return conversation;
    const deviceId = this.#team.executionDevice(conversationId);
    if (deviceId !== this.#team.localHost().hostId)
      await (await this.#remoteTeamClient(deviceId)).call(
        archived ? "conversations.archive" : "conversations.unarchive",
        [conversationId],
      );
    if (archived) {
      await this.#settleConversationRuns(conversationId, "Conversation archived");
      this.#runResources.forget(conversationId);
      if (this.#managerJobs.removeChat(conversationId)) this.#publishManagerJobs();
    }
    return this.#storage.updateConversation(conversationId, {archived});
  }

  async #settleConversationRuns(conversationId: string, reason: string): Promise<void> {
    // Repeat after settling because a parent can register a child immediately
    // before it observes cancellation.
    while (true) {
      const active = [...this.#activeRuns.entries()]
        .filter(([runId]) => this.#storage.getRun(runId)?.conversationId === conversationId)
        .map(([, run]) => run);
      if (!active.length) return;
      for (const run of active) run.control.cancel(new Error(reason));
      await Promise.allSettled(active.map((run) => run.result));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  #cancelQueuedManagerJobs(conversationId: string): void {
    let changed = false;
    for (const job of this.#managerJobs.list(conversationId)) {
      if (job.status === "queued") {
        this.#managerJobs.cancel(job.id);
        changed = true;
      }
    }
    if (changed) this.#publishManagerJobs();
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
      if (this.#team.botByConversation(request.conversationId)) return this.#startLocalRun(request, preparedRunId);
      const member = this.#remoteMemberByConversation(request.conversationId);
      const localId = this.#team.localHost().hostId;
      const savedDevice = this.#team.executionDevice(request.conversationId);
      const deviceId = member?.hostId ?? request.deviceId ?? savedDevice;
      if (!member && deviceId !== savedDevice && (this.#storage.listMessages(request.conversationId).length || savedDevice !== localId)) throw new Error('Choose another device in a new Assistant chat.');
      if (deviceId === localId) return this.#startLocalRun(request, preparedRunId);
      const client = await this.#remoteTeamClient(deviceId);
      if (!member) {
        await client.call('assistant.ensure', [request.conversationId, this.#storage.getConversation(request.conversationId)?.title ?? 'Assistant']);
        this.#storage.setPreference(`assistant.device:${request.conversationId}`, deviceId);
      }
      const attachments: string[] = [];
      for (const file of request.attachments ?? []) {
        const info = await stat(file);
        if (!info.isFile() || info.size > 12 * 1024 * 1024) throw new Error('Remote attachments must be files smaller than 12 MB.');
        const uploaded = await client.call<{path: string}>('conversations.upload', [{conversationId: request.conversationId, name: path.basename(file), data: (await readFile(file)).toString('base64')}]);
        attachments.push(uploaded.path);
      }
      const result = await client.call<{runId: string}>('runs.start', [{...request, deviceId: undefined, attachments} as unknown as JsonValue]);
      if (preparedRunId) { this.#managerJobs.replaceRun(preparedRunId, result.runId); this.#publishManagerJobs(); }
      this.#remoteRunConversations.set(result.runId, request.conversationId);
      this.#remoteRunIds.add(result.runId);
      this.#remoteRunHosts.set(result.runId, deviceId);
      void this.#pollRemoteRun(result.runId, deviceId);
      return result;
  }

  async #startLocalRun(
    request: ReturnType<typeof validateStartRun> & {
      reuseUserMessage?: boolean;
      contextThroughSequence?: number;
      executionScopeId?: string;
      replyToMessageId?: string;
    },
    preparedRunId?: string,
  ): Promise<{ runId: string }> {
    if (request.rewind) {
      this.#cancelQueuedManagerJobs(request.conversationId);
      await this.#settleConversationRuns(request.conversationId, "Edited and resent");
      rewindConversation(this.#storage, {
        conversationId: request.conversationId,
        messageId: request.messageId!,
        content: json(request.text),
        attachments: request.attachments,
      });
    }
    this.#preemptGoalContinuation(request.conversationId);
    const bot = this.#team.botByConversation(request.conversationId);
    if (bot) await this.#teamComputers.start(bot.id);
    // Only deictic/current-screen requests pay for a synchronous AX refresh.
    // Other turns use the latest trusted snapshot and refresh it in parallel
    // for later, avoiding desktop inspection on the inference critical path.
    const desktopContext = bot
      ? Promise.resolve()
      : needsFreshDesktopContext(request.text)
        ? this.#refreshOpenWindows()
        : (void this.#refreshOpenWindows(), Promise.resolve());
    const locationContext = bot
      ? Promise.resolve()
      : this.#refreshPromptLocation(request.text);
    await Promise.all([
      this.#prepareMcpForRun(),
      desktopContext,
      locationContext,
    ]);
    const agent = await this.#ensureConfiguredRuntime(request.conversationId);
    if (request.rewind) await agent.resetHistory(request.conversationId);
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
      reuseUserMessage: Boolean(request.reuseUserMessage || request.rewind),
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
      identity: bot ? {
        name: bot.name,
        role: bot.role,
        bots: this.#team.list()
          .filter((member) => member.id !== bot.id)
          .map((member) => ({name: member.name, role: member.role})),
      } : undefined,
    });
    this.#activeRuns.set(runId, active);
    if (bot) this.#team.publish();
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
    for (const [runId, conversationId] of this.#remoteRunConversations) result.push({runId, conversationId});
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
   * Announces a genuinely incoming live message. A bridge may write the
   * signed-in person's own message as a remote-account ghost, so suppressing
   * only the Matrix user id would announce it as coming from "Unknown user".
   */
  async #notifyHubMessage(activity: HubMessageActivity): Promise<void> {
    if (this.#closing || this.#window.isDestroyed()) return;
    if (activity.type !== "m.room.message") return;
    // A bridge backfills a conversation's history when it connects, and every
    // one of those events lands here exactly like a live one. Only a message
    // that just arrived is news.
    if (Date.now() - activity.ts > MESSAGE_NOTIFICATION_MAX_AGE_MS) return;
    const comms = this.#comms;
    if (comms?.userId && activity.sender === comms.userId) return;
    const mine = await comms
      ?.senderIsMine(activity.roomId, activity.sender)
      .catch((): boolean => false);
    if (mine || this.#closing || this.#window.isDestroyed()) return;
    this.#notifier.notify({
      kind: "message-received",
      title: activity.senderName || activity.sender || "New message",
      body: "Sent you a message.",
      target: {
        kind: "workspace",
        request: { surface: "hub", chat: { id: activity.roomId } },
      },
    });
  }

  /**
   * Hands a notification to the OS. Clicking it brings the app back and, when
   * the event names one, opens the exact conversation or workspace surface it
   * came from.
   */
  #presentNotification(request: NotificationRequest): void {
    const notification = new Notification({
      title: request.title,
      body: request.body,
    });
    notification.on("click", () => {
      if (this.#closing || this.#window.isDestroyed()) return;
      activateNotification(request, {
        restore: () => {
          if (this.#window.isMinimized()) this.#window.restore();
        },
        show: () => this.#window.show(),
        focusWindow: () => this.#window.focus(),
        focusApp: () => app.focus({steal: true}),
        open: (target) =>
          this.#window.webContents.send(
            channels.windowOpenNotificationTarget,
            target,
          ),
      });
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
        target: run.conversationId
          ? {kind: "conversation", conversationId: run.conversationId}
          : undefined,
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
      target: run.conversationId
        ? {kind: "conversation", conversationId: run.conversationId}
        : undefined,
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
      this.#team.publish();
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
      if (!this.#storage.getRun(runId)?.parentRunId) void this.#teamHostServer.notifyPhones();
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

  async #executeGoal(request: GoalCommandRequest) {
    const deviceId = this.#team.executionDevice(request.conversationId);
    if (deviceId !== this.#team.localHost().hostId) return (await this.#remoteTeamClient(deviceId)).call('goals.execute', [request as unknown as JsonValue]);
    return this.#executeLocalGoal(request);
  }

  #executeLocalGoal(request: GoalCommandRequest) {
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
   * the servers configured for the active MCP profile.
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

  /** Installed Apps for the active profile. Official Apps inherit the active
   * agent's default until the user makes an explicit choice. App installation
   * is deliberately independent from the plugin registry. */
  async #workspaceApps(): Promise<WorkspaceAppsDto> {
    const officialDefault = this.#runtimeConfig().kind === "polymux";
    const official = OFFICIAL_WORKSPACE_APPS.map((app): WorkspaceAppDto => ({
      ...app,
      enabled: this.#integrationEnabled("app-enabled", app.id, officialDefault),
    }));
    const apps = official;
    const available = new Set(apps.filter((app) => app.enabled && app.pinnable).map((app) => app.id));
    const stored = this.#profilePreference("app-pins")?.value;
    const requested = Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string")
      : DEFAULT_NEW_TAB_APPS.filter((id) => official.some((app) => app.id === id && app.enabled));
    const pinnedIds = requested.filter((id, index) => available.has(id) && requested.indexOf(id) === index).slice(0, MAX_NEW_TAB_APPS);
    return {apps, pinnedIds};
  }

  #usageStats(value: unknown): UsageStatsDto {
    const filter = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const scope = filter.scope === "assistant" || filter.scope === "team" ? filter.scope : "all";
    const agentId = typeof filter.agentId === "string" && filter.agentId.trim() ? filter.agentId.trim() : null;
    const source = this.#storage.loadUsageSource();
    for (const run of source.runs) {
      if (run.agent?.kind !== "acp") continue;
      run.agent.id = externalAgentId({kind: "acp", agentId: run.agent.id, name: run.agent.name, command: "", args: []});
    }
    return {
      identity: this.#usageIdentity(),
      ...summarizeUsage(source, new Date(), {scope, agentId}, this.#usageCatalog()),
    };
  }

  #usageCatalog(): {
    plugins: {id: string; name: string; skills: string[]; mcpServerIds: string[]}[];
    connections: {id: string; name: string}[];
  } {
    let plugins: PluginDto[] = [];
    try {
      plugins = this.#pluginDtos();
    } catch {
      plugins = [];
    }
    return {
      plugins: plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        skills: plugin.contributions.skills,
        mcpServerIds: plugin.contributions.mcpServers,
      })),
      connections: this.#mcpDtos(this.#mcp.snapshots()).map((server) => ({
        id: server.id,
        name: server.name,
      })),
    };
  }

  #usageIdentity(): UsageStatsDto["identity"] {
    const account = this.#account.status();
    if (account.profile) {
      const local = account.profile.email.split("@")[0]?.trim();
      return {
        name: account.profile.name.trim() || account.profile.email,
        handle: local ? `@${local}` : null,
        avatarUrl: account.profile.avatarUrl || null,
        badge: "Account",
      };
    }
    let username = "";
    try {
      username = userInfo().username?.trim() ?? "";
    } catch {
      username = "";
    }
    if (username)
      return {name: username, handle: `@${username}`, avatarUrl: null, badge: null};
    const snapshot = this.#profiles.snapshot();
    const active = snapshot.profiles.find((profile) => profile.id === snapshot.activeId);
    return {
      name: active?.name?.trim() || "Polymux",
      handle: null,
      avatarUrl: null,
      badge: null,
    };
  }

  #integrationEnabled(
    key: "skill-enabled" | "mcp-enabled" | "plugin-enabled" | "app-enabled",
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
    key: "skill-enabled" | "mcp-enabled" | "plugin-enabled" | "app-enabled",
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
    const key = this.#mcpConfigKey ?? "mcpServers";
    const existing = root[key];
    const servers =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    edit(servers);
    root[key] = servers;
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
    const result = new SkillLoader({
      configured: [source],
      includeUserLocations: false,
    }).load();
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
      const result = new SkillLoader({
        configured: [temporary],
        includeUserLocations: false,
      }).load();
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
    return generalSettingsPreference(stored);
  }

  #storeGeneralSettings(settings: GeneralSettingsDto): void {
    this.#storage.setPreference("general-access", generalSettingsStorage(settings));
  }

  /** Built-in tools request only the native grant they need, at point of use.
   * Installing instructions or connecting an MCP is not a permission request. */
  async #requireAppPermission(kind: AppPermissionKind): Promise<string | null> {
    if ((await permissionStatus(kind)) === "granted") return null;
    if ((await this.#requestSystemPermission(kind)) === "granted") return null;
    // macOS raises its dialog once. Past that the only thing that changes the
    // answer is the pane, so say where rather than asking again next turn.
    return `Polymux has not been given access to ${kind}. Allow it in System Settings → Privacy & Security.`;
  }

  /** Calendar requests its native grant only when its workspace feature is used. */
  async #requireCalendarPermission(): Promise<string | null> {
    if (!this.#generalSettings().permissions.calendars)
      return "Calendar access is switched off in Settings → General → Permissions.";
    if ((await permissionStatus("calendars")) === "granted") return null;
    if ((await this.#requestSystemPermission("calendars")) === "granted") return null;
    return "Polymux has not been given access to Calendars. Allow it in System Settings → Privacy & Security → Calendars.";
  }

  /**
   * Uses the app renderer for cross-platform microphone consent. Electron only
   * exposes a main-process request method on macOS; Windows and Linux raise
   * their privacy UI, where one exists, from a real media request instead.
   * The stream is stopped immediately because this is consent setup, not a
   * recording.
   */
  async #requestSystemPermission(
    kind: SystemPermissionKind,
  ): Promise<SystemPermissionStatus> {
    return requestSystemPermission(kind, {
      requestMicrophone: async () => {
        if (this.#window.isDestroyed()) return "unknown";
        const status = await this.#window.webContents.executeJavaScript(`(async () => {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
            return "unknown";
          try {
            const stream = await navigator.mediaDevices.getUserMedia({audio: true});
            for (const track of stream.getTracks()) track.stop();
            return "granted";
          } catch (error) {
            const name = error && typeof error === "object" && "name" in error
              ? String(error.name)
              : "";
            return name === "NotAllowedError" || name === "SecurityError"
              ? "denied"
              : "unknown";
          }
        })()`, true);
        return status === "granted" || status === "denied"
          ? status
          : "unknown";
      },
    });
  }

  #permissionAvailable(kind: SystemPermissionKind): boolean {
    const settings = this.#generalSettings();
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
      wake: async (request: WorkspaceRevealDto) => {
        if (!request.chat?.draft) return;
        const wantedId = request.chat.id?.trim().toLowerCase();
        const wantedName = request.chat.name?.trim().toLowerCase();
        const chat = (await this.#comms.chats().catch((): MatrixRoom[] => []))
          .find((candidate) =>
            !candidate.space &&
            ((wantedId && candidate.roomId.toLowerCase() === wantedId) ||
              (wantedName && candidate.name.toLowerCase() === wantedName)),
          );
        if (chat?.platform === "wechat") await this.#comms.wake("wechat");
      },
      chatForContact: (contactId: string, accountId?: string) =>
        this.#comms.chatForContact(contactId, accountId),
      linked: async () => {
        const status = await this.#comms.status();
        return {
          mailAccounts: status.email.accounts.map((account) => ({
            id: account.id,
            email: account.email,
          })),
          chats: (await this.#comms.chats().catch((): MatrixRoom[] => []))
            .filter((chat) => !chat.space)
            .map((chat) => ({
              id: chat.roomId,
              name: chat.name,
            })),
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

  #startComputerObservation(): void {
    this.#computerHistory.start();
    if (this.#computerObservationStarted) return;
    this.#computerObservationStarted = true;
    void this.#interactionEvents
      .start((event) => {
        // History remains independently optional: record() applies its enabled,
        // privacy, and interaction-event settings before retaining anything.
        this.#computerHistory.record(event);
      })
      .catch(() => {
        this.#computerObservationStarted = false;
      });
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
      subagentModel: this.#usableRole("subagent"),
      judgeModel: this.#usableRole("judge"),
      compactionModel: this.#usableRole("compaction"),
      // The level chosen with a role's model applies wherever that model runs;
      // undefined leaves the run on the level it was started at.
      subagentReasoning: this.#usableRole("subagent")?.reasoning,
      judgeReasoning: this.#usableRole("judge")?.reasoning,
      compactionReasoning: this.#usableRole("compaction")?.reasoning,
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
    if (this.#runtimeConfig().kind === "polymux")
      this.#agentRuntime = new BuiltinAgentRuntime(this.#agent);
  }

  #runtimeConfig(profileId = this.#profiles.snapshot().activeId): AgentRuntimeConfig {
    const stored = this.#profiles.preference("agent-runtime", profileId)?.value;
    if (!stored || typeof stored !== "object" || Array.isArray(stored) || stored.kind !== "acp")
      return {kind: "polymux"};
    if (typeof stored.name !== "string" || typeof stored.command !== "string")
      return {kind: "polymux"};
    const base = {
      kind: "acp",
      name: stored.name.trim() || "ACP Agent",
      command: stored.command.trim(),
      args: Array.isArray(stored.args) ? stored.args.filter((item): item is string => typeof item === "string") : [],
      ...(typeof stored.cwd === "string" && stored.cwd.trim() ? {cwd: stored.cwd.trim()} : {}),
      config: agentRuntimeConfigValues(stored.config),
      registryEnvironment: agentRegistryEnvironment(stored.registryEnvironment),
    } satisfies Extract<AgentRuntimeConfig, {kind: "acp"}>;
    const agentId = typeof stored.agentId === "string" && stored.agentId.trim()
      ? stored.agentId.trim()
      : externalAgentId(base);
    const configId = typeof stored.configId === "string" && stored.configId.trim()
      ? stored.configId.trim()
      : agentId;
    return {...base, agentId, configId};
  }

  #profilesForRenderer() {
    const snapshot = this.#profiles.snapshot();
    return {
      ...snapshot,
      profiles: snapshot.profiles.map((profile) => {
        const runtime = this.#runtimeConfig(profile.id);
        return {
          ...profile,
          agent: runtime.kind === "polymux"
            ? {kind: "polymux" as const, id: "polymux", name: "Polymux"}
            : {kind: "acp" as const, id: runtime.agentId!, name: runtime.name},
          teamEligible: true,
        };
      }),
    };
  }

  async #connectExternalProfile(
    request: ConnectExternalProfileRequest,
  ): Promise<ReturnType<ProfileManager["snapshot"]>> {
    if (this.#activeRuns.size)
      throw new Error("Wait for the active agent run to finish before switching agents.");
    let runtime = agentRuntimeRequest(request.runtime);
    if (runtime.kind !== "acp") throw new Error("An external profile requires an ACP agent");
    const before = this.#profiles.snapshot();
    const current = before.profiles.find((profile) => profile.id === before.activeId)!;
    if (request.profileId) {
      if (!before.profiles.some((profile) => profile.id === request.profileId))
        throw new Error("Unknown profile");
      const stored = this.#profiles.preference("agent-runtime", request.profileId)?.value;
      const storedRuntime = stored ? agentRuntimeRequest(stored) : null;
      if (!storedRuntime || storedRuntime.kind !== "acp")
        throw new Error("That profile no longer has an external agent to sync");
      runtime = storedRuntime;
    }
    let targetId = request.profileId ?? current.id;
    const target = this.#profiles.snapshot().profiles.find((profile) => profile.id === targetId);
    if (!target) throw new Error("Unknown profile");
    const priorSource = target.source;

    const sourceDirectory = request.sourceDirectory?.trim()
      ? inspectExternalAgentProfiles(runtime, request.sourceDirectory, {
          cwd: runtime.cwd ?? this.#profiles.directory(targetId),
        })[0]?.directory
      : undefined;
    if ((request.mode === "merge" || request.mode === "import" || request.mode === "sync") && !sourceDirectory)
      throw new Error("Choose an external configuration folder first");

    const inspected = sourceDirectory
      ? inspectExternalAgentProfiles(runtime, sourceDirectory, {
          cwd: runtime.cwd ?? this.#profiles.directory(targetId),
        })[0]
      : undefined;
    if ((request.mode === "merge" || request.mode === "import") && !inspected?.supportsImport)
      throw new Error(inspected?.importUnavailableReason ?? `${runtime.name} does not yet support configuration import`);

    let nextSource: ProfileDto["source"] = null;
    if (request.mode === "sync") {
      if (!inspected?.exists) throw new Error("That external configuration folder no longer exists");
      if (!inspected.supportsSync)
        throw new Error(inspected.syncUnavailableReason ?? `${runtime.name} cannot be kept in sync safely.`);
      nextSource = {
        kind: "external",
        agentId: runtime.agentId!,
        agentName: runtime.name,
        directory: inspected.directory,
      };
    }

    const profileDirectory = this.#profiles.directory(targetId);
    const runtimeRoot = path.join(profileDirectory, "agents", runtime.configId!);
    const managedHome = path.join(runtimeRoot, "home");
    const runtimeDirectory = managedExternalConfigurationDirectory(runtime, runtimeRoot, managedHome);
    await mkdir(managedHome, {recursive: true});
    await mkdir(runtimeDirectory, {recursive: true});
    if (request.mode === "merge" || request.mode === "import") {
      await importExternalConfiguration({
        runtime,
        sourceDirectory: sourceDirectory!,
        profileDirectory,
        runtimeDirectory,
        sections: request.sections?.length
          ? request.sections
          : ["settings", "skills", "plugins", "mcp", "memory"],
        cwd: runtime.cwd,
      });
    }
    // Profile identity and source change only after every fallible inspection
    // and copy has completed. A failed import therefore leaves an existing
    // profile attached to exactly the source it had before the attempt.
    if (request.profileName?.trim() && request.profileName.trim() !== target.name)
      this.#profiles.rename(targetId, request.profileName);
    this.#profiles.setSource(targetId, nextSource);
    this.#profiles.setPreference("agent-runtime", runtime as unknown as JsonValue, targetId);
    const shouldActivate = !request.profileId && before.activeId !== targetId;
    if (shouldActivate) this.#profiles.select(targetId);
    const result = this.#profiles.snapshot();
    this.#sendToTrustedWindows(channels.profilesChanged, this.#profilesForRenderer());

    const committedSource = result.profiles.find((profile) => profile.id === targetId)?.source ?? null;
    const needsReload = shouldActivate || (before.activeId === targetId && JSON.stringify(priorSource) !== JSON.stringify(committedSource));
    if (needsReload) setTimeout(() => this.#reloadForProfileChange?.(), 0);
    else if (result.activeId === targetId) {
      await this.#agentRuntime?.close?.();
      this.#configureAgentRuntime(runtime);
      if (request.mode === "merge") await this.reloadMcp();
    }
    return result;
  }

  #configureAgentRuntime(config = this.#runtimeConfig()): void {
    if (config.kind === "acp") {
      this.#agentRuntime = undefined;
      const snapshot = this.#profiles.snapshot();
      const profile = snapshot.profiles.find((candidate) => candidate.id === snapshot.activeId)!;
      const profileDirectory = this.#profiles.directory(profile.id);
      const runtimeRoot = path.join(profileDirectory, "agents", config.configId ?? config.agentId ?? "agent");
      const managedHome = path.join(runtimeRoot, "home");
      const configurationDirectory = profile.source?.agentId === config.agentId
        ? profile.source.directory
        : managedExternalConfigurationDirectory(config, runtimeRoot, managedHome);
      const cwd = config.cwd ?? path.join(profileDirectory, "workspace");
      if (profile.source && !existsSync(configurationDirectory)) {
        console.warn(`[acp:${config.name}] External configuration source is missing: ${configurationDirectory}`);
        return;
      }
      if (!profile.source) mkdirSync(configurationDirectory, {recursive: true});
      mkdirSync(managedHome, {recursive: true});
      if (!config.cwd) mkdirSync(cwd, {recursive: true});
      this.#agentRuntime = new AcpAgentRuntime(
        {
          ...config,
          cwd,
          environment: externalAgentEnvironment(config, configurationDirectory, managedHome),
        },
        this.#storage,
        appVersion().version,
        (request) => this.#requestAcpPermission(request),
        (conversationId) => this.#acpMcpServers(conversationId),
        (conversationId) => this.#workspaceToolMcp.revoke(conversationId),
      );
      return;
    }
    this.#agentRuntime = this.#agent ? new BuiltinAgentRuntime(this.#agent) : undefined;
  }

  async #teamRuntime(member: BotDto): Promise<AgentRuntime> {
    const config = this.#runtimeConfig(member.profileId);
    const key = JSON.stringify({
      profileId: member.profileId,
      runtime: config,
      model: this.#profiles.preference("model", member.profileId)?.value ?? null,
      roles: this.#profiles.preference("model-roles", member.profileId)?.value ?? null,
      source: this.#profiles.snapshot().profiles.find((profile) => profile.id === member.profileId)?.source ?? null,
      skills: member.skills ?? null,
      mcpServers: member.mcpServers ?? null,
      plugins: member.plugins ?? null,
    });
    const existing = this.#teamRuntimes.get(member.id);
    if (existing?.key === key) return existing.runtime;
    await existing?.runtime.close?.();
    const runtime = config.kind === "acp"
      ? this.#teamAcpRuntime(member, config)
      : this.#teamBuiltinRuntime(member);
    this.#teamRuntimes.set(member.id, {profileId: member.profileId, key, runtime});
    return runtime;
  }

  #assertTeamProfile(profileId: string): void {
    if (!this.#profiles.snapshot().profiles.some((profile) => profile.id === profileId))
      throw new Error("This bot's profile no longer exists");
  }

  #teamAcpRuntime(
    member: BotDto,
    config: Extract<AgentRuntimeConfig, {kind: "acp"}>,
  ): AgentRuntime {
    const profile = this.#profiles.snapshot().profiles.find(
      (candidate) => candidate.id === member.profileId,
    );
    if (!profile) throw new Error("This bot's profile no longer exists");
    const profileDirectory = this.#profiles.directory(profile.id);
    const runtimeRoot = path.join(
      profileDirectory,
      "team-agents",
      member.id,
      config.configId ?? config.agentId ?? "agent",
    );
    const managedHome = path.join(runtimeRoot, "home");
    const configurationDirectory = profile.source?.agentId === config.agentId
      ? profile.source.directory
      : managedExternalConfigurationDirectory(config, runtimeRoot, managedHome);
    const cwd = path.join(runtimeRoot, "workspace");
    if (profile.source && !existsSync(configurationDirectory))
      throw new Error(`${profile.name}'s external configuration folder is missing`);
    if (!profile.source) mkdirSync(configurationDirectory, {recursive: true});
    mkdirSync(managedHome, {recursive: true});
    mkdirSync(cwd, {recursive: true});
    return new AcpAgentRuntime(
      {
        ...config,
        cwd,
        environment: externalAgentEnvironment(config, configurationDirectory, managedHome),
      },
      this.#storage,
      appVersion().version,
      // Re-read policy at request time: switching Laptop access to Off revokes
      // authority even if this ACP process was already connected.
      (request) => this.#requestTeamAcpPermission(this.#team.bot(member.id) ?? member, request),
      () => this.#teamAcpMcpServers(this.#team.bot(member.id) ?? member),
      (conversationId) => this.#teamToolMcp.revoke(conversationId),
    );
  }

  #teamBuiltinRuntime(member: BotDto): AgentRuntime {
    const profile = this.#profiles.snapshot().profiles.find((candidate) => candidate.id === member.profileId);
    if (!profile) throw new Error("This bot's profile no longer exists");
    const profileDirectory = this.#profiles.directory(profile.id);
    const credentials = new EncryptedCredentialStore(
      path.join(profileDirectory, "credentials.json"),
      safeStorage,
    );
    const credentialSource = profile.id === "default"
      ? new OpenCodeCredentialFallback(credentials)
      : credentials;
    const models = builtinModels({credentials: credentialSource});
    for (const config of customProviderPreference(
      this.#profiles.preference("custom-providers", profile.id)?.value,
    )) {
      const providerModels: Array<Model<"openai-completions">> = config.models.map((model) => ({
        id: model.id,
        name: model.name,
        api: "openai-completions",
        provider: config.id,
        baseUrl: config.baseUrl,
        reasoning: false,
        input: ["text"],
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
        contextWindow: 128_000,
        maxTokens: 8_192,
      }));
      models.setProvider(createProvider({
        id: config.id,
        name: config.name,
        baseUrl: config.baseUrl,
        auth: {
          apiKey: {
            name: `${config.name} API key`,
            resolve: async ({credential}) => ({
              auth: {apiKey: credential?.key ?? "polymux-local"},
              source: credential?.key ? "Saved API key" : "Custom endpoint",
            }),
          },
        },
        models: providerModels,
        api: openAICompletionsApi(),
      }));
    }
    const inference = new RotatingInference(
      new PiInference(models),
      new EncryptedApiKeyPool(path.join(profileDirectory, "api-keys.json"), safeStorage),
    );
    const preferred = modelPreference(this.#profiles.preference("model", profile.id)?.value);
    const availableModels = inference.listModels();
    const lastUsed = preferred && inference.getModel(preferred)
      ? preferred
      : this.#model && inference.getModel(this.#model)
        ? this.#model
        : undefined;
    const model = preferredModel(availableModels, lastUsed);
    if (!model) throw new Error(`No model is available in ${profile.name}`);
    const roles = modelRolesPreference(this.#profiles.preference("model-roles", profile.id)?.value);
    const personalSkills = profile.source
      ? path.join(profile.source.directory, "skills")
      : path.join(profileDirectory, "skills");
    const skillEnabled = this.#profiles.preference("skill-enabled", profile.id)?.value;
    const enabled = skillEnabled && typeof skillEnabled === "object" && !Array.isArray(skillEnabled)
      ? skillEnabled as Record<string, JsonValue>
      : {};
    const assignedPlugins = new Set(member.plugins ?? []);
    const pluginList = this.#pluginDtos();
    const pluginSkills = pluginList
      .filter((plugin) => assignedPlugins.has(plugin.id))
      .flatMap((plugin) => plugin.contributions.skills);
    const pluginMcpServers = pluginList
      .filter((plugin) => assignedPlugins.has(plugin.id))
      .flatMap((plugin) => plugin.contributions.mcpServers);
    const assignedServerIds = new Set([...(member.mcpServers ?? []), ...pluginMcpServers]);
    const mcpTools = assignedServerIds.size > 0
      ? this.#mcp.toolsForServers(assignedServerIds)
      : [];
    const botTools = new ToolRegistry(this.#teamRegistry.list());
    for (const tool of mcpTools) {
      botTools.register(tool);
    }
    const assignedSkillNames = member.skills !== undefined || member.plugins !== undefined
      ? new Set([...(member.skills ?? []), ...pluginSkills])
      : null;
    const agent = new PolymuxAgent({
      inference,
      storage: this.#storage,
      memory: new MemoryManager({directory: path.join(profileDirectory, "memories")}),
      computerHistory: this.#computerHistory,
      drive: {promptContext: () => this.#drive.promptContext()},
      environment: {
        promptContext: () => {
          const context = this.#environmentPromptContext();
          const capabilities = new Set(
            this.#team.leases(member.id).flatMap((lease) => lease.capabilities),
          );
          return {
            ...context,
            identityScoped: true,
            locationEnabled: false,
            location: undefined,
            browserTabs: capabilities.has("browser") ? context.browserTabs : [],
            externalBrowserTabs: capabilities.has("browser") ? context.externalBrowserTabs : [],
            windows: capabilities.has("computer") ? context.windows : [],
          };
        },
      },
      tools: botTools,
      model,
      subagentModel: roles.subagent,
      judgeModel: roles.judge,
      compactionModel: roles.compaction,
      subagentReasoning: roles.subagent?.reasoning,
      judgeReasoning: roles.judge?.reasoning,
      compactionReasoning: roles.compaction?.reasoning,
      skills: {
        official: this.#agentSkillOptions.official,
        personal: personalSkills,
        configured: this.#agentSkillOptions.configured,
        isEnabled: (skill) => this.#coreSkills.has(skill.name) || (
          assignedSkillNames !== null
            ? assignedSkillNames.has(skill.name)
            : enabled[skill.name] !== false
        ),
      },
      prompts: this.#agentPrompts,
      hooks: combineHooks(new ProtectedSkillGuard(officialSkillsHome()), this.#hooks),
      onGoalContinuation: ({conversationId, runId, run}) =>
        this.#trackGoalContinuation(conversationId, runId, run),
      onSubagentRun: ({runId, run}) => this.#trackSubagentRun(runId, run),
    });
    return new BuiltinAgentRuntime(agent);
  }

  #agentRuntimeDto(): AgentRuntimeDto {
    const config = this.#runtimeConfig();
    return config.kind === "polymux"
      ? {kind: "polymux", name: "Polymux Agent"}
      : {
          kind: "acp",
          name: config.name,
          command: config.command,
          args: config.args,
          cwd: config.cwd ?? null,
          config: {...config.config},
          agentId: config.agentId!,
          configId: config.configId!,
          registryEnvironment: agentRegistryEnvironment(config.registryEnvironment),
        };
  }

  async #acpMcpServers(
    conversationId: string,
  ): Promise<import("@agentclientprotocol/sdk").McpServer[]> {
    const configured = [...this.#mcpConfigs.values()]
      .filter((config) => config.enabled !== false && this.#integrationEnabled("mcp-enabled", config.id))
      .map((config) => config.transport === "stdio"
        ? {
            name: config.name ?? config.id,
            command: resolveExecutable(config.command),
            args: config.args ?? [],
            env: Object.entries(config.env ?? {}).map(([name, value]) => ({name, value})),
          }
        : {
            type: "http" as const,
            name: config.name ?? config.id,
            url: config.url,
            headers: Object.entries(config.headers ?? {}).map(([name, value]) => ({name, value})),
          });
    return [await this.#workspaceToolMcp.descriptor(conversationId), ...configured];
  }

  async #teamAcpMcpServers(
    member: BotDto,
  ): Promise<import("@agentclientprotocol/sdk").McpServer[]> {
    const assignedPlugins = new Set(member.plugins ?? []);
    const pluginMcpServers = this.#pluginDtos()
      .filter((plugin) => assignedPlugins.has(plugin.id))
      .flatMap((plugin) => plugin.contributions.mcpServers);
    const assignedIds = new Set([...(member.mcpServers ?? []), ...pluginMcpServers]);
    const configured = [...this.#mcpConfigs.values()]
      .filter((config) => assignedIds.has(config.id) && config.enabled !== false && this.#integrationEnabled("mcp-enabled", config.id))
      .map((config) => config.transport === "stdio"
        ? {
            name: config.name ?? config.id,
            command: resolveExecutable(config.command),
            args: config.args ?? [],
            env: Object.entries(config.env ?? {}).map(([name, value]) => ({name, value})),
          }
        : {
            type: "http" as const,
            name: config.name ?? config.id,
            url: config.url,
            headers: Object.entries(config.headers ?? {}).map(([name, value]) => ({name, value})),
          });
    return [await this.#teamToolMcp.descriptor(member.conversationId), ...configured];
  }

  async #requestAcpPermission(
    request: import("@agentclientprotocol/sdk").RequestPermissionRequest,
  ): Promise<import("@agentclientprotocol/sdk").RequestPermissionResponse> {
    if (this.#closing || this.#window.isDestroyed())
      return {outcome: {outcome: "cancelled"}};
    const rejectIndex = request.options.findIndex(
      (option) => option.kind === "reject_once" || option.kind === "reject_always",
    );
    const {response} = await dialog.showMessageBox(this.#window, {
      type: "question",
      title: "Agent permission",
      message: request.toolCall.title || "The agent wants to use a tool",
      detail: "Choose exactly what this agent may do.",
      buttons: request.options.map((option) => option.name),
      cancelId: rejectIndex >= 0 ? rejectIndex : -1,
      defaultId: rejectIndex >= 0 ? rejectIndex : 0,
      noLink: true,
    });
    const option = request.options[response];
    return option
      ? {outcome: {outcome: "selected", optionId: option.optionId}}
      : {outcome: {outcome: "cancelled"}};
  }

  async #requestTeamAcpPermission(
    member: BotDto,
    request: import("@agentclientprotocol/sdk").RequestPermissionRequest,
  ): Promise<import("@agentclientprotocol/sdk").RequestPermissionResponse> {
    const reject = request.options.find(
      (option) => option.kind === "reject_once" || option.kind === "reject_always",
    );
    if (member.laptopAccess === "off" || this.#closing || this.#window.isDestroyed())
      return reject
        ? {outcome: {outcome: "selected", optionId: reject.optionId}}
        : {outcome: {outcome: "cancelled"}};
    const rejectIndex = reject ? request.options.indexOf(reject) : -1;
    const {response} = await dialog.showMessageBox(this.#window, {
      type: "question",
      title: `${member.name} needs permission`,
      message: request.toolCall.title || `${member.name} wants to use a tool`,
      detail: `${member.name} is running ${member.profileName}'s configured agent. Choose exactly what it may do.`,
      buttons: request.options.map((option) => option.name),
      cancelId: rejectIndex,
      defaultId: rejectIndex >= 0 ? rejectIndex : 0,
      noLink: true,
    });
    const option = request.options[response];
    return option
      ? {outcome: {outcome: "selected", optionId: option.optionId}}
      : {outcome: {outcome: "cancelled"}};
  }

  async #requestTeamLaptopAccess(
    memberName: string,
    capability: LaptopCapabilityLeaseDto["capabilities"][number],
    tool: string,
  ): Promise<boolean> {
    if (this.#closing || this.#window.isDestroyed()) return false;
    const {response} = await dialog.showMessageBox(this.#window, {
      type: "question",
      title: `${memberName} needs this laptop`,
      message: `Allow ${memberName} to use ${capability} on this laptop for 15 minutes?`,
      detail: `${tool} will run through the local Polymux device broker. The bot's isolated computer receives no laptop mount or reusable credential.`,
      buttons: ["Not now", "Allow for 15 minutes"],
      cancelId: 0,
      defaultId: 0,
      noLink: true,
    });
    return response === 1;
  }

  #deliverAgentMessage(input: {
    conversationId: string;
    text: string;
    messageId: string;
    /** Peer mail carries a source; host-authored turns such as a new bot's
     * setup cue do not need one. */
    source?: AgentMessageOriginDto;
  }): void {
    const active = [...this.#activeRuns.entries()]
      .reverse()
      .find(([runId]) => {
        const run = this.#storage.getRun(runId);
        return run?.conversationId === input.conversationId && !run.parentRunId;
      });
    if (active) {
      active[1].control.steer({role: "user", content: input.text});
      return;
    }
    void this.#startRun({
      conversationId: input.conversationId,
      text: input.text,
      messageId: input.messageId,
      attachments: [],
      reuseUserMessage: true,
    } as ReturnType<typeof validateStartRun> & {reuseUserMessage: boolean}).catch((error) => {
      const message = this.#storage.getMessage(input.messageId);
      if (!message) return;
      const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
        ? {...message.metadata}
        : {};
      this.#storage.updateMessage(input.messageId, {
        metadata: {
          ...metadata,
          deliveryError: error instanceof Error ? error.message : String(error),
        },
      });
    });
  }

  /** A stored override only counts while the model it names still exists. */
  #usableRole(role: ModelRole): RoleSelection | undefined {
    const ref = this.#roleOverrides[role];
    return ref && this.#inference.getModel(ref) ? ref : undefined;
  }

  /** Re-derives what follows from role assignments after provider or model
   * changes. Speech mode flips only when its usable assignment transitions,
   * so a user who switched it off stays off until the assignment changes. */
  #reconcileRoles(rebuild = true): void {
    const assigned = Boolean(this.#usableRole("speech"));
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
      subagent: assignment(this.#usableRole("subagent")),
      judge: assignment(this.#usableRole("judge")),
      compaction: assignment(this.#usableRole("compaction")),
      speech: assignment(this.#usableRole("speech")),
      image: assignment(this.#usableRole("image")),
      video: assignment(this.#usableRole("video")),
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
    this.#reconcileRoles(false);
    return this.#modelRoles();
  }

  #clearRole(role: ModelRole): ModelRolesDto {
    // The main model is what everything else falls back to, so there is
    // nothing to clear it to.
    if (role === "main") throw new Error("The main model cannot be cleared");
    const { [role]: _removed, ...rest } = this.#roleOverrides;
    this.#roleOverrides = rest;
    this.#persistRoles();
    // Deliberately clearing speech switches speech mode off; the reconcile
    // then aligns its assignment marker.
    this.#setSpeechModeForRoleChange(role, false);
    this.#reconcileRoles(false);
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
    this.#storeGeneralSettings({...settings, reasoningLevel: reasoning});
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
    this.#reconcileRoles();
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
   * are removed or changed. The user's last selection wins while it is usable;
   * otherwise the first model from a configured provider is used. */
  async #ensureConfiguredAgent(): Promise<PolymuxAgent> {
    if (this.#model) {
      const current = await this.#providerDto(this.#model.provider);
      if (current.configured) return this.#requireAgent();
    }

    const providers = await this.#providerDtos();
    const configuredModels = providers
      .filter((provider) => provider.configured)
      .flatMap((provider) => this.#inference.listModels(provider.id));
    const lastUsed = modelPreference(
      this.#profilePreference("model")?.value,
    );
    const model = preferredModel(configuredModels, lastUsed);
    if (model) {
      this.#selectModel({ provider: model.provider, id: model.id });
      return this.#requireAgent();
    }

    throw new Error(
      "No model provider is configured. Add an API key in Settings → Provider, then choose a model.",
    );
  }

  async #ensureConfiguredRuntime(conversationId?: string): Promise<AgentRuntime> {
    const bot = conversationId
      ? this.#team.botByConversation(conversationId)
      : null;
    if (bot) return this.#teamRuntime(bot);
    const config = this.#runtimeConfig();
    if (config.kind === "acp") {
      if (!this.#agentRuntime || this.#agentRuntime.id !== `acp:${config.command}`)
        this.#configureAgentRuntime(config);
      return this.#agentRuntime!;
    }
    await this.#ensureConfiguredAgent();
    if (!this.#agentRuntime) this.#configureAgentRuntime(config);
    return this.#agentRuntime!;
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
      const tabId = this.#embeddedBrowser.tabIdFor(event.sender);
      if (!tabId) return;
      const message = autofillMessage(payload);
      if (!message) return;
      const actual = originOf(event.sender.getURL());
      if (!actual || actual !== message.origin) return;
      if (message.kind === "page") {
        this.#noteAutofillPage(tabId, message);
        return;
      }
      void this.#autofill
        .captureSubmission(message)
        .catch((error: unknown) =>
          console.warn("Could not save the submitted login", error),
        );
    });
  }

  #registerWebAuthn(): void {
    this.#ipcMain.handle(WEBAUTHN_CHANNEL, async (event, payload: unknown) => {
      const tabId = this.#embeddedBrowser.tabIdFor(event.sender);
      if (!tabId) return {error: "Not a browser tab"};
      const origin = originOf(event.sender.getURL());
      if (!origin) return {error: "That page has no origin"};
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return {error: "Passkey request is required"};
      const input = payload as Record<string, unknown>;
      const action = typeof input.action === "string" ? input.action : "";
      try {
        const status = this.#locker.status();
        if (action === "status")
          return {unlocked: status.unlocked, exists: status.exists, locked: !status.unlocked};
        if (!status.unlocked) return {locked: true, error: "Locker is locked"};
        if (action === "offers") {
          const request = lockerWebAuthnGet({...input, origin});
          return {offers: this.#locker.listPasskeys(request)};
        }
        if (action === "get") {
          const request = lockerWebAuthnGet({...input, origin});
          return {credential: await this.#locker.getPasskey(request)};
        }
        if (action === "create") {
          const request = lockerWebAuthnCreate({...input, origin});
          return {credential: await this.#locker.createPasskey(request)};
        }
        return {error: "Unknown passkey request"};
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          locked: /locked|wrong master password/i.test(message),
          invalidState: /already saved/i.test(message),
          error: message,
        };
      }
    });
  }

  #lockerAutofillAvailable(): boolean {
    return this.#integrationEnabled(
      "app-enabled",
      "locker",
      this.#runtimeConfig().kind === "polymux",
    );
  }

  #lockerAutofillState(): "missing" | "locked" | "unlocked" {
    if (!this.#lockerAutofillAvailable()) return "missing";
    const status = this.#locker.status();
    if (!status.exists) return "missing";
    return status.unlocked ? "unlocked" : "locked";
  }

  #noteAutofillPage(tabId: string, page: AutofillPage): void {
    const previous = this.#autofillPages.get(tabId);
    if (!previous || previous.origin !== page.origin) this.#autofillDismissed.delete(tabId);
    this.#autofillPages.set(tabId, page);
    this.#publishAutofill(tabId);
  }

  #dismissAutofill(tabId: string): void {
    this.#autofillDismissed.add(tabId);
    this.#sendAutofillOffer(tabId, null);
  }

  #clearAutofill(tabId: string): void {
    this.#autofillPages.delete(tabId);
    this.#autofillDismissed.delete(tabId);
    this.#sendAutofillOffer(tabId, null);
  }

  #refreshAutofillOffers(): void {
    for (const tabId of this.#autofillPages.keys()) {
      this.#autofillDismissed.delete(tabId);
      this.#publishAutofill(tabId);
    }
  }

  #publishAutofill(tabId: string): void {
    if (this.#autofillDismissed.has(tabId)) return;
    this.#sendAutofillOffer(tabId, this.#buildAutofillOffer(tabId));
  }

  #buildAutofillOffer(tabId: string) {
    const page = this.#autofillPages.get(tabId);
    if (!page) return null;
    const locker = this.#lockerAutofillState();
    return buildAutofillOffer({
      tabId,
      page,
      locker,
      lockerItems: locker === "unlocked" ? this.#locker.matchesForUrl(page.origin) : [],
      browserLogins: this.#browserSettings().autofillEnabled
        ? this.#autofill.forOrigin(page.origin)
        : [],
    });
  }

  #sendAutofillOffer(
    tabId: string,
    offer: ReturnType<typeof buildAutofillOffer>,
  ): void {
    if (this.#closing || this.#window.isDestroyed()) return;
    this.#sendToTrustedWindows(channels.browserEvent, { type: "autofill", tabId, offer });
  }

  async #fillAutofill(tabId: string, itemId: string): Promise<boolean> {
    const page = this.#autofillPages.get(tabId);
    const contents = this.#embeddedBrowser.webContentsFor(tabId);
    if (!page || !contents) return false;
    const actual = originOf(contents.getURL());
    if (!actual || actual !== page.origin) return false;
    const parsed = parseAutofillItem(itemId);
    if (!parsed) return false;
    if (parsed.source === "browser") return this.#autofill.fill(contents, parsed.id);
    if (this.#lockerAutofillState() !== "unlocked") return false;
    const fields = this.#locker.fillFields(parsed.id);
    this.#autofill.send(contents, {
      username: fields.username || undefined,
      password: fields.password || undefined,
      totp: fields.totp || undefined,
    });
    return true;
  }
}

/** Mentions cross an IPC boundary and ultimately become notifications on
 * remote services. Keep that surface deliberately narrow: joined Matrix ids
 * and the exact single-token labels the composer can insert. */
function chatMentions(value: unknown): ChatMentionsDto | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const users = Array.isArray(input.users)
    ? input.users.slice(0, 100).flatMap((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
        const mention = raw as Record<string, unknown>;
        const userId = typeof mention.userId === "string" ? mention.userId.trim() : "";
        const label = typeof mention.label === "string" ? mention.label.trim() : "";
        if (
          !/^@[^:\s]+:[^\s]+$/u.test(userId) ||
          userId.length > 255 ||
          !/^@[^@\s]+$/u.test(label) ||
          label.length > 128
        ) return [];
        return [{userId, label}];
      })
    : [];
  const deduplicated = [...new Map(users.map((mention) => [
    `${mention.userId}\0${mention.label}`,
    mention,
  ])).values()];
  const everyone = input.everyone === true;
  return deduplicated.length > 0 || everyone
    ? {users: deduplicated, ...(everyone ? {everyone: true} : {})}
    : undefined;
}

function calendarExportRequest(value: unknown): CalendarExportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Calendar export request must be an object");
  const input = value as Record<string, unknown>;
  const start = required(input.start, "calendar range start");
  const end = required(input.end, "calendar range end");
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(start) >= Date.parse(end))
    throw new Error("Calendar export range is invalid");
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    ...(input.calendarIds === undefined
      ? {}
      : {calendarIds: optionalStringArray(input.calendarIds, "calendar ids")}),
  };
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

function agentRuntimeRequest(value: unknown): AgentRuntimeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Agent runtime must be an object");
  const input = value as Record<string, unknown>;
  if (input.kind === "polymux") return {kind: "polymux"};
  if (input.kind !== "acp") throw new Error("Unknown agent runtime");
  const command = required(input.command, "ACP command").trim();
  if (!command) throw new Error("ACP command cannot be empty");
  const name = typeof input.name === "string" && input.name.trim()
    ? input.name.trim()
    : "ACP Agent";
  const args = optionalStringArray(input.args, "ACP arguments");
  const cwd = input.cwd == null ? undefined : required(input.cwd, "ACP working directory").trim() || undefined;
  const partial = {
    kind: "acp" as const,
    name,
    command,
    args,
    ...(cwd ? {cwd} : {}),
    config: agentRuntimeConfigValues(input.config),
    registryEnvironment: agentRegistryEnvironment(input.registryEnvironment),
  };
  const requestedAgentId = typeof input.agentId === "string" ? input.agentId.trim() : "";
  const agentId = requestedAgentId && /^[a-z0-9][a-z0-9-]*$/i.test(requestedAgentId)
    ? requestedAgentId.toLowerCase()
    : externalAgentId(partial);
  const requestedConfigId = typeof input.configId === "string" ? input.configId.trim() : "";
  const configId = requestedConfigId && /^[a-z0-9][a-z0-9-]*$/i.test(requestedConfigId)
    ? requestedConfigId
    : randomUUID();
  return {...partial, agentId, configId};
}

function externalProfileConnectionRequest(value: unknown): ConnectExternalProfileRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("External profile connection must be an object");
  const input = value as Record<string, unknown>;
  if (!input.runtime || typeof input.runtime !== "object" || Array.isArray(input.runtime))
    throw new Error("External profile connection requires an ACP runtime");
  const runtime = agentRuntimeRequest(input.runtime);
  if (runtime.kind !== "acp") throw new Error("External profile connection requires an ACP runtime");
  const mode = input.mode;
  if (mode !== "clean" && mode !== "merge" && mode !== "import" && mode !== "sync")
    throw new Error("Unknown external profile connection mode");
  const sections = Array.isArray(input.sections)
    ? input.sections.filter((section): section is ConnectExternalProfileRequest["sections"][number] =>
        section === "settings" || section === "skills" || section === "plugins" || section === "mcp" || section === "memory",
      )
    : undefined;
  return {
    runtime,
    mode,
    ...(typeof input.sourceDirectory === "string" ? {sourceDirectory: input.sourceDirectory} : {}),
    ...(sections ? {sections} : {}),
    ...(typeof input.profileName === "string" ? {profileName: input.profileName} : {}),
    ...(typeof input.profileId === "string" ? {profileId: input.profileId} : {}),
  };
}

function agentRuntimeConfigValues(value: unknown): Record<string, string | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string | boolean] =>
    typeof entry[1] === "string" || typeof entry[1] === "boolean",
  ));
}

function agentRegistryEnvironment(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => {
    const [key, item] = entry;
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) &&
      typeof item === "string" &&
      item.length <= 4_096 &&
      !item.includes("\0") &&
      !isReservedRegistryEnvironmentKey(key);
  }));
}

function isReservedRegistryEnvironmentKey(key: string): boolean {
  return /(?:TOKEN|SECRET|PASSWORD|PASS|KEY|CREDENTIAL|AUTH|COOKIE)/i.test(key) ||
    /^(?:HOME|USERPROFILE|PATH|PATHEXT|NODE_OPTIONS|ELECTRON_RUN_AS_NODE)$/i.test(key) ||
    /^(?:XDG_|DYLD_|LD_|POLYMUX_|npm_|NPM_)/.test(key);
}

function agentProviderRequest(value: unknown): SetAgentProviderRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("ACP provider must be an object");
  const input = value as Record<string, unknown>;
  const headers = input.headers && typeof input.headers === "object" && !Array.isArray(input.headers)
    ? Object.fromEntries(Object.entries(input.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : undefined;
  return {
    id: required(input.id, "ACP provider"),
    apiType: required(input.apiType, "ACP provider protocol"),
    baseUrl: required(input.baseUrl, "ACP provider base URL"),
    ...(headers ? {headers} : {}),
  };
}

function resolveExecutable(command: string): string {
  if (path.isAbsolute(command)) return command;
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, command);
    if (existsSync(candidate)) return candidate;
  }
  return command;
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

function hostPort(value: string | undefined): number {
  if (!value?.trim()) return process.env.POLYMUX_DEV_INSTANCE?.trim() ? 0 : 47_680;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error("POLYMUX_HOST_PORT must be an integer from 1 to 65535");
  return parsed;
}

function hostRelayEndpoint(publicEndpoint: string | null): string | null {
  const configured = process.env.POLYMUX_HOST_RELAY_ENDPOINT;
  if (configured !== undefined) {
    const value = configured.trim();
    return !value || value === "0" || value.toLowerCase() === "off" ? null : value;
  }
  if (publicEndpoint || process.env.POLYMUX_HOST_LISTEN?.trim() || process.env.NODE_TEST_CONTEXT)
    return null;
  return "https://connect.polymux.com";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function historyPageTitle(
  storage: Pick<SqliteStorage, "getHistoryEntry">,
  url: string,
): string | null {
  for (const candidate of historyUrlCandidates(url)) {
    const title = storage.getHistoryEntry(candidate)?.title.trim() ?? "";
    if (!title || /^https?:\/\//i.test(title)) continue;
    try {
      const host = new URL(candidate).hostname.replace(/^www\./, "");
      if (title === host || title === new URL(candidate).hostname) continue;
    } catch {
      // A stored title that is not a host still wins.
    }
    return title;
  }
  return null;
}

/** www, trailing slash, and hash are the usual ways a cited url and a visited
 * url disagree while still being the same page. */
function historyUrlCandidates(url: string): string[] {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const urls = new Set<string>([parsed.toString()]);
    const hosts = parsed.hostname.startsWith("www.")
      ? [parsed.hostname, parsed.hostname.slice(4)]
      : [parsed.hostname, `www.${parsed.hostname}`];
    const path =
      parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/$/, "");
    for (const host of hosts) {
      for (const pathname of path === "/" ? ["/", ""] : [path, `${path}/`]) {
        const next = new URL(parsed.toString());
        next.hostname = host;
        next.pathname = pathname || "/";
        urls.add(next.toString());
      }
    }
    return [...urls];
  } catch {
    return [url];
  }
}

function terminalSize(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} must be a number`);
  return value;
}

export { modelFromEnvironment } from "./backend/models.js";
