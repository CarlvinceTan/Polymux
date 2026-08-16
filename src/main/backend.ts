import { readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { GoalManager, MemoryManager, FlareAIAgent, SkillLoader, type SkillLoaderOptions } from "@flareai/agent";
import { ChronicleManager } from "@flareai/chronicle";
import type { ActiveAgentRun, AgentRunEvent } from "@flareai/core";
import type { InferenceModel, InferenceService, ModelRef } from "@flareai/inference";
import { PiInference } from "@flareai/inference/pi";
import type {
  CreateCustomProviderRequest,
  GeneralSettingsDto,
  GoalCommandRequest,
  McpServerDto,
  SaveCustomMcpRequest,
  SaveCustomSkillRequest,
  ModelDto,
  ModelRole,
  ModelRoleAssignmentDto,
  ModelRolesDto,
  ProviderDto,
  ReasoningEffort,
  RunEventDto,
  SkillDto,
  SkillUploadFile,
  MailListRequest,
  SendMailRequest,
  SystemPermissionKind,
  UpdateCustomProviderRequest,
  JsonValue,
  WorkspaceSnapshotDto,
} from "@flareai/protocol";
import {
  channels,
  commsPlatform,
  driveProvider,
  driveS3Config,
  languageLabel,
  SUPPORTED_LANGUAGES,
  supportedLanguage,
  validateGoalCommand,
  validateSaveEmailAccount,
  validateStartRun,
} from "@flareai/protocol";
import { SqliteStorage } from "@flareai/storage/sqlite";
import type { StoredMessage } from "@flareai/storage";
import {
  createNativeTools,
  importMcpServers,
  McpManager,
  ToolRegistry,
} from "@flareai/tools";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import {createProvider, type Model, type MutableModels} from "@earendil-works/pi-ai";
import {openAICompletionsApi} from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {app, safeStorage, session, type BrowserWindow, type IpcMain, type IpcMainInvokeEvent} from "electron";
import {EncryptedCredentialStore} from "./credential-store.js";
import {
  appVersion,
  checkForUpdates,
  installUpdate,
  startUpdateChecks,
  stopUpdateChecks,
} from "./updater.js";
import { HookEngine } from "./hooks.js";
import { AgentSurfaceServer } from "./agent-surface.js";
import { AgentSurfaceAdapter } from "./agent-surface-adapter.js";
import { createBrowserControlTools } from "./browser-control-tools.js";
import { createInAppBrowserTool } from "./in-app-browser-tools.js";
import { RunResourceRecorder } from "./run-resources.js";
import {EncryptedApiKeyPool} from "./api-key-pool.js";
import {WhisperDictation} from "./dictation.js";
import {installSkillPackage, searchSkillRegistry} from "./skill-registry.js";
import {searchMcpRegistry} from "./mcp-registry.js";
import {ModelCatalog} from "./model-catalog.js";
import {EmbeddedBrowser} from "./embedded-browser.js";
import {faviconDataUrl} from "./favicon.js";
import {RotatingInference} from "./rotating-inference.js";
import {
  AccessibilityChronicleFrames,
  ElectronChronicleSystem,
} from "./chronicle.js";
import {AxReader} from "./ax-reader.js";
import {FileReloadWatcher} from "./file-reload-watcher.js";
import {Communications} from "./communications/index.js";
import {Drive} from "./drive/index.js";
import {sessionScopedSnapshot} from "./workspace-snapshot.js";
import type {Homeserver} from "./homeserver/index.js";

/** The part of BridgeHost the backend needs: what is installed, and what is held back. */
interface BridgeInventory {
  inventory: () => Promise<
    {
      platform: string;
      binary: string;
      installed: boolean;
      blocked: {reason: string; permission?: SystemPermissionKind} | null;
    }[]
  >;
  networkConfig: (platform: string) => Promise<Record<string, string>>;
  configureNetwork: (platform: string, values: Record<string, string>) => Promise<void>;
  retryBlocked: () => Promise<void>;
  ensure: (platform: string) => Promise<void>;
}
import {cancelCookieLogin, runCookieLogin} from "./communications/cookie-login.js";
import {createCommunicationsTools} from "./communications-tools.js";
import {parse as parseToml} from "smol-toml";
import {FirstRunPermissions} from "./first-run-permissions.js";
import {
  openSystemPermissionSettings,
  requestSystemPermission,
  systemPermissionStatus,
} from "./system-permissions.js";

export interface DesktopBackendOptions {
  dataDirectory: string;
  window: BrowserWindow;
  ipcMain: IpcMain;
  model?: ModelRef;
  toolDirectory?: string;
  officialSkillDirectories?: string[];
  codexConfigPath?: string;
  /** Path to the bundled native/ax-reader.swift accessibility helper. */
  axReaderSourcePath?: string;
  /**
   * The app-scoped message hub. It outlives this backend: closing a window
   * closes the backend, but the hub and its bridges run until the app quits.
   * Absent when the hub failed to start, which degrades messaging to an
   * externally configured deployment.
   */
  hub?: {homeserver: Homeserver; directory: string; bridges?: BridgeInventory};
}

interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  logoDataUrl?: string;
  models: Array<{id: string; name: string}>;
}

export class DesktopBackend {
  #window: BrowserWindow;
  readonly #ipcMain: IpcMain;
  readonly #storage: SqliteStorage;
  #agent?: FlareAIAgent;
  #model?: ModelRef;
  /** Per-role model overrides. An absent role follows the main model. */
  #roleOverrides: Partial<Record<ModelRole, ModelRef>> = {};
  readonly #models: MutableModels;
  readonly #customProviders = new Map<string, CustomProviderConfig>();
  readonly #credentials: EncryptedCredentialStore;
  readonly #apiKeys: EncryptedApiKeyPool;
  readonly #inference: InferenceService;
  readonly #skills: SkillLoader;
  readonly #agentSkillOptions: SkillLoaderOptions;
  readonly #goals: GoalManager;
  readonly #memory: MemoryManager;
  readonly #chronicle: ChronicleManager;
  readonly #firstRunPermissions: FirstRunPermissions;
  readonly #dictation: WhisperDictation;
  readonly #mcp = new McpManager();
  readonly #registry: ToolRegistry;
  readonly #hooks = new HookEngine();
  readonly #agentSurface = new AgentSurfaceServer();
  readonly #runResources: RunResourceRecorder;
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
  readonly #mcpConfigPath: string;
  readonly #customSkillDirectory: string;
  readonly #mcpConfigWatcher: FileReloadWatcher;
  readonly #codexMcpConfigPath: string;
  readonly #codexMcpConfigWatcher: FileReloadWatcher;
  #mcpReloadPending = false;
  #mcpReloadInFlight?: Promise<McpServerDto[]>;
  #closing = false;
  readonly #modelCatalog: ModelCatalog;
  readonly #embeddedBrowser: EmbeddedBrowser;
  readonly #comms: Communications;
  readonly #drive: Drive;

  constructor(options: DesktopBackendOptions) {
    this.#window = options.window;
    this.#ipcMain = options.ipcMain;
    this.#skills = new SkillLoader({
      official: options.officialSkillDirectories,
    });
    this.#agentSkillOptions = {
      official: options.officialSkillDirectories,
      isEnabled: (skill) => this.#integrationEnabled("skill-enabled", skill.name),
    };
    this.#storage = new SqliteStorage(
      path.join(options.dataDirectory, "flareai.sqlite"),
    );
    this.#credentials = new EncryptedCredentialStore(
      path.join(options.dataDirectory, "credentials.json"),
      safeStorage,
    );
    this.#apiKeys = new EncryptedApiKeyPool(
      path.join(options.dataDirectory, "api-keys.json"),
      safeStorage,
    );
    this.#models = builtinModels({credentials: this.#credentials});
    for (const config of customProviderPreference(this.#storage.getPreference("custom-providers")?.value))
      this.#registerCustomProvider(config);
    this.#inference = new RotatingInference(
      new PiInference(this.#models),
      this.#apiKeys,
    );
    this.#goals = new GoalManager(this.#storage);
    this.#memory = new MemoryManager({
      directory: path.join(options.dataDirectory, "memories"),
      legacyStorage: this.#storage,
    });
    this.#chronicle = new ChronicleManager({
      directory: path.join(options.dataDirectory, "chronicle"),
      frames: new AccessibilityChronicleFrames(new AxReader({
        sourcePath: options.axReaderSourcePath ?? "",
        cacheDirectory: path.join(options.dataDirectory, "bin"),
      })),
      system: new ElectronChronicleSystem(),
    });
    this.#dictation = new WhisperDictation({
      modelDirectory: path.join(options.dataDirectory, "whisper"),
    });
    this.#firstRunPermissions = new FirstRunPermissions({
      store: this.#storage,
      microphoneEnabled: () => this.#generalSettings().speechModeEnabled,
      screenRecordingEnabled: () => false,
      status: systemPermissionStatus,
      request: requestSystemPermission,
      onReady: () => this.#chronicle.start(),
    });
    this.#modelCatalog = new ModelCatalog({cacheDir: options.dataDirectory});
    this.#embeddedBrowser = new EmbeddedBrowser({
      window: options.window,
      downloadsDir: app.getPath("downloads"),
      send: (event) => {
        if (!this.#closing && !this.#window.isDestroyed())
          this.#window.webContents.send(channels.browserEvent, event);
      },
    });
    this.#mcpConfigPath = path.join(options.dataDirectory, "mcp.json");
    this.#customSkillDirectory = path.join(homedir(), ".flareai", "skills");
    this.#codexMcpConfigPath = options.codexConfigPath ?? path.join(homedir(), ".codex", "config.toml");
    this.#mcpConfigWatcher = new FileReloadWatcher(
      this.#mcpConfigPath,
      () => this.#requestMcpReload(),
    );
    this.#codexMcpConfigWatcher = new FileReloadWatcher(
      this.#codexMcpConfigPath,
      () => this.#requestMcpReload(),
    );
    this.#comms = new Communications({
      credentials: this.#credentials,
      // App-scoped and possibly absent; the backend only points comms at it.
      embedded: options.hub
        ? {
            baseUrl: options.hub.homeserver.baseUrl,
            directory: options.hub.directory,
            provision: (localpart) => options.hub!.homeserver.createLocalUser(localpart),
            inventory: options.hub.bridges
              ? () => options.hub!.bridges!.inventory()
              : undefined,
            networkConfig: options.hub.bridges
              ? (platform) => options.hub!.bridges!.networkConfig(platform)
              : undefined,
            configureNetwork: options.hub.bridges
              ? (platform, values) => options.hub!.bridges!.configureNetwork(platform, values)
              : undefined,
            retryBlocked: options.hub.bridges
              ? () => options.hub!.bridges!.retryBlocked()
              : undefined,
            ensure: options.hub.bridges
              ? (platform) => options.hub!.bridges!.ensure(platform)
              : undefined,
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
      // Parented, so the network's sign-in page opens as a sheet over FlareAI
      // rather than as a window that can end up behind it.
      cookieLogin: (request) => runCookieLogin(request, this.#window),
      cancelCookieLogin,
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
          const {dialog} = await import("electron");
          const result = await dialog.showOpenDialog(this.#window, {
            properties: ["openDirectory", "createDirectory"],
            title: "Choose the Drive folder",
          });
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        files: async () => {
          const {dialog} = await import("electron");
          const result = await dialog.showOpenDialog(this.#window, {
            properties: ["openFile", "multiSelections"],
            title: "Upload to Drive",
          });
          return result.canceled ? [] : result.filePaths;
        },
        downloads: () => app.getPath("downloads"),
      },
      parent: () => (this.#window.isDestroyed() ? undefined : this.#window),
      onChange: (status) => {
        if (!this.#closing && !this.#window.isDestroyed())
          this.#window.webContents.send(channels.driveChanged, status);
      },
    });
    this.#runResources = new RunResourceRecorder(this.#storage);
    this.#registry = new ToolRegistry(
      createNativeTools({ cwd: options.toolDirectory ?? homedir() }),
    );
    for (const tool of createBrowserControlTools(this.#agentSurface))
      this.#registry.register(tool);
    // The in-app Browser is the default surface for web work, so the agent
    // drives it directly rather than through the user's external browser.
    this.#registry.register(createInAppBrowserTool(this.#embeddedBrowser));
    // Messaging and email are app capabilities rather than an MCP server the
    // user has to register, so their tools are always present.
    for (const tool of createCommunicationsTools(this.#comms))
      this.#registry.register(tool);
    // Loopback only; a failed bind (port in use) degrades to no browser control.
    void this.#agentSurface.start().catch(() => {});
    // Mirror active browser-control leases into the user's Agent Surface
    // menu-bar pill (the ChatGPT-desktop-style Computer Use capsule), when
    // that presentation layer is installed.
    this.#agentSurface.onLeasesChanged = (leases) => {
      if (leases.length === 0) void this.#surfaceMenubar.release("flareai-browser");
      else
        void this.#surfaceMenubar.acquireWindow("flareai-browser", {
          appName: browserAppName(),
          bundleId: browserBundleId(),
          windowTitle: leases[0].tab.title || leases[0].tab.url,
          sessionId: "flareai-browser",
        });
    };
    this.#roleOverrides = modelRolesPreference(this.#storage.getPreference("model-roles")?.value);
    const storedModel = modelPreference(this.#storage.getPreference("model")?.value);
    if (options.model) this.#selectModel(options.model, false);
    else if (storedModel && this.#inference.getModel(storedModel))
      this.#selectModel(storedModel, false);
  }

  /**
   * Points the backend at a fresh app window after the previous one closed.
   * Everything long-lived — runs, storage, MCP connections, the works — kept
   * going while no window existed; only the event sink and the IPC frame
   * guard need re-aiming.
   */
  attachWindow(window: BrowserWindow): void {
    this.#window = window;
    this.#embeddedBrowser.attachWindow(window);
  }

  /** Rescues the embedded browser's pages before their window is destroyed. */
  detachWindow(): void {
    this.#embeddedBrowser.detachWindow();
  }

  register(): void {
    if (this.#firstRunPermissions.completed()) this.#chronicle.start();
    // Accessibility capture cannot ask through a media-access dialog the way
    // microphone capture can; surface the system prompt at launch so text
    // capture does not fail silently until the user visits Options.
    const chronicleSettings = this.#chronicle.settings();
    if (
      chronicleSettings.enabled &&
      systemPermissionStatus("accessibility") !== "granted"
    )
      void requestSystemPermission("accessibility");
    this.#handle(channels.generalGet, () => this.#generalSettings());
    this.#handle(channels.generalUpdate, (_event, value: unknown) => {
      const next = generalSettingsUpdate(value, this.#generalSettings());
      this.#storage.setPreference("general-access", {
        theme: next.theme,
        language: next.language,
        currency: next.currency,
        speechModeEnabled: next.speechModeEnabled,
        timeEnabled: next.timeEnabled,
        locationEnabled: next.locationEnabled,
        onboardingCompleted: next.onboardingCompleted,
        location: next.location,
      });
      return next;
    });
    this.#handle(channels.generalLocate, () => approximateLocation());
    this.#handle(channels.generalVersion, () => appVersion());
    this.#handle(channels.generalCheckUpdates, () => checkForUpdates());
    this.#handle(channels.generalInstallUpdate, () => installUpdate());
    startUpdateChecks();
    this.#handle(channels.permissionsStatus, (_event, value: unknown) =>
      systemPermissionStatus(systemPermission(value)),
    );
    this.#handle(channels.permissionsEnsureFirstRun, () =>
      this.#firstRunPermissions.ensure(),
    );
    this.#handle(channels.permissionsRequest, (_event, value: unknown) =>
      requestSystemPermission(systemPermission(value)),
    );
    this.#handle(channels.permissionsOpenSettings, (_event, value: unknown) =>
      openSystemPermissionSettings(systemPermission(value, true)),
    );
    this.#handle(channels.dictationTranscribe, (_event, audio: unknown, final: unknown) =>
      this.#dictation.transcribe(audioBuffer(audio), final !== false),
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
    this.#handle(channels.conversationsRemove, (_event, id: string) => {
      const conversationId = required(id, "conversation id");
      this.#runResources.forget(conversationId);
      return this.#storage.deleteConversation(conversationId);
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
        const updated = this.#storage.updateMessage(
          messageId,
          {
            content:
              patch.content === undefined ? undefined : json(patch.content),
            metadata:
              patch.metadata === undefined ? undefined : json(patch.metadata),
          },
        );
        if (!updated) return null;
        const existingPaths = new Set(this.#storage.listAttachments(messageId).map((attachment) => attachment.path));
        for (const attachmentPath of optionalStringArray(patch.attachments, "attachments")) {
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
    this.#handle(channels.runsSteer, (_event, runId: string, text: string, messageId?: string) => {
      const id = required(runId, "run id");
      const value = required(text, "text");
      const run = this.#storage.getRun(id);
      if (!run) throw new Error(`Run not found: ${id}`);
      // Resolve the live run before persisting: a run that settled between the
      // click and this handler must not leave an orphaned user message behind.
      const active = this.#requireRun(id);
      this.#storage.appendMessage({
        id: messageId ? required(messageId, "message id") : crypto.randomUUID(),
        conversationId: run.conversationId,
        runId: id,
        role: "user",
        content: value,
      });
      active.control.steer({
        role: "user",
        content: value,
      });
    });
    this.#handle(
      channels.runEventsList,
      (_event, runId: string, afterSequence = 0) => {
        const id = required(runId, "run id");
        const conversationId = this.#storage.getRun(id)?.conversationId ?? "";
        return this.#storage
          .listRunEvents(id, number(afterSequence))
          .map((event) => storedEventDto(event, conversationId));
      },
    );
    this.#handle(channels.goalsExecute, (_event, value: unknown) =>
      this.#executeGoal(validateGoalCommand(value)),
    );
    this.#handle(channels.goalsGet, (_event, conversationId: string) =>
      this.#goals.get(required(conversationId, "conversation id")),
    );
    this.#handle(channels.memoryStatus, () => this.#memory.status());
    this.#handle(channels.memorySetEnabled, (_event, enabled: boolean) => {
      if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
      return this.#memory.setEnabled(enabled);
    });
    this.#handle(channels.chronicleStatus, () => this.#chronicle.status());
    this.#handle(channels.chronicleSetEnabled, async (_event, enabled: boolean) => {
      if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
      if (enabled) await requestSystemPermission("accessibility");
      const status = this.#chronicle.setEnabled(enabled);
      if (enabled) {
        await this.#chronicle.captureOnce();
        return this.#chronicle.status();
      }
      return status;
    });
    this.#handle(channels.chronicleEntries, (_event, value?: unknown) => {
      const options = chronicleQuery(value);
      return this.#chronicle.store.entries(options);
    });
    this.#handle(channels.mcpList, () =>
      this.#mcp.snapshots().map((snapshot) => this.#mcpDto(snapshot)),
    );
    this.#handle(channels.mcpReload, () => this.reloadMcp());
    this.#handle(channels.mcpSetEnabled, async (_event, id: string, enabled: boolean) => {
      this.#setIntegrationEnabled("mcp-enabled", required(id, "MCP id"), enabled);
      return this.#reloadMcpAfterMutation();
    });
    this.#handle(channels.mcpSaveCustom, async (_event, value: unknown) => {
      await this.#saveCustomMcp(customMcpRequest(value));
      return this.#reloadMcpAfterMutation();
    });
    this.#handle(channels.mcpRemoveCustom, async (_event, id: unknown) => {
      await this.#removeCustomMcp(required(id, "MCP id"));
      return this.#reloadMcpAfterMutation();
    });
    this.#handle(channels.mcpSearchRegistry, (_event, query: unknown) =>
      searchMcpRegistry(typeof query === "string" ? query : ""),
    );
    this.#handle(channels.workspaceSnapshotGet, (_event, conversationId: unknown) => {
      const stored = this.#storage.getPreference(
        `workspace-snapshot:${required(conversationId, "conversation id")}`,
      );
      return stored ? sessionScopedSnapshot(stored.value, WORKSPACE_BOOT_ID) : null;
    });
    this.#handle(
      channels.workspaceSnapshotSave,
      (_event, conversationId: unknown, snapshot: unknown) => {
        this.#storage.setPreference(
          `workspace-snapshot:${required(conversationId, "conversation id")}`,
          // Through the existing json() laundering: optional DTO fields do not
          // satisfy JsonValue's index signature structurally.
          json({...workspaceSnapshot(snapshot), bootId: WORKSPACE_BOOT_ID}) as JsonValue,
        );
      },
    );
    this.#handle(channels.commsStatus, () => this.#comms.status());
    this.#handle(channels.commsRefresh, () => this.#comms.refresh());
    this.#handle(channels.commsWake, (_event, value: unknown) =>
      this.#comms.wake(commsPlatform(value)),
    );
    this.#handle(channels.commsSetHubUrl, (_event, baseUrl: unknown) =>
      this.#comms.setHubUrl(required(baseUrl, "hub address")),
    );
    this.#handle(channels.commsConnect, () => this.#comms.connect());
    this.#handle(channels.commsSignIn, (_event, userId: unknown, password: unknown) =>
      this.#comms.signIn(required(userId, "Matrix user ID"), required(password, "password")),
    );
    this.#handle(channels.commsSignOut, () => this.#comms.signOut());
    this.#handle(channels.commsLoginStart, (_event, platform: unknown, flowId: unknown) =>
      this.#comms.loginStart(commsPlatform(platform), required(flowId, "login method")),
    );
    this.#handle(
      channels.commsLoginSubmit,
      (_event, platform: unknown, loginId: unknown, stepId: unknown, values: unknown) =>
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
    this.#handle(channels.commsLoginCancel, (_event, platform: unknown, loginId: unknown) =>
      this.#comms.loginCancel(commsPlatform(platform), required(loginId, "login id")),
    );
    this.#handle(channels.commsBridgeSetup, (_event, platform: unknown, values: unknown) =>
      this.#comms.bridgeSetup(commsPlatform(platform), loginValues(values)),
    );
    this.#handle(channels.commsBridgeLogout, (_event, platform: unknown, accountId: unknown) =>
      this.#comms.bridgeLogout(commsPlatform(platform), required(accountId, "account id")),
    );
    this.#handle(channels.commsChats, () => this.#comms.chats());
    this.#handle(
      channels.commsChatMessages,
      async (_event, chatId: unknown, limit: unknown, before: unknown) => {
        const result = await this.#comms.readChat(
          required(chatId, "chat id"),
          typeof limit === "number" ? limit : 50,
          typeof before === "string" ? before : undefined,
        );
        return result.messages;
      },
    );
    this.#handle(channels.commsChatSend, (_event, chatId: unknown, text: unknown) =>
      this.#comms.sendChat(required(chatId, "chat id"), required(text, "message")),
    );
    this.#handle(channels.commsMailFolders, (_event, account: unknown) =>
      this.#comms.mailFolders(typeof account === "string" ? account : undefined),
    );
    this.#handle(channels.commsMailEnvelopes, (_event, value: unknown) =>
      this.#comms.mailEnvelopes(mailListRequest(value)),
    );
    this.#handle(
      channels.commsMailMessage,
      (_event, id: unknown, account: unknown, folder: unknown) =>
        this.#comms.mailMessage(
          required(id, "message id"),
          typeof account === "string" ? account : undefined,
          typeof folder === "string" ? folder : undefined,
        ),
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
      const {shell} = await import("electron");
      const error = await shell.openPath(required(file, "file path"));
      if (error) throw new Error(error);
    });
    this.#handle(channels.commsMailPickFiles, async () => {
      const {dialog} = await import("electron");
      const result = await dialog.showOpenDialog({
        properties: ["openFile", "multiSelections"],
        title: "Attach files",
      });
      return result.canceled ? [] : result.filePaths;
    });
    this.#handle(
      channels.commsMailMove,
      (_event, ids: unknown, target: unknown, account: unknown, folder: unknown) =>
        this.#comms.mailMove(
          optionalStringArray(ids, "ids"),
          required(target, "target folder"),
          typeof account === "string" ? account : undefined,
          typeof folder === "string" ? folder : undefined,
        ),
    );
    this.#handle(
      channels.commsMailFlag,
      (_event, ids: unknown, flag: unknown, on: unknown, account: unknown, folder: unknown) =>
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
    this.#handle(channels.commsEmailRemove, (_event, id: unknown) =>
      this.#comms.emailRemove(required(id, "account id")),
    );
    this.#handle(channels.commsEmailTest, (_event, id: unknown) =>
      this.#comms.emailTest(required(id, "account id")),
    );
    this.#handle(channels.skillsList, () => this.#skillDtos());
    this.#handle(channels.skillsReload, () => this.#skillDtos());
    this.#handle(channels.skillsSetEnabled, (_event, name: string, enabled: boolean) => {
      this.#setIntegrationEnabled("skill-enabled", required(name, "skill name"), enabled);
      return this.#skillDtos();
    });
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
      await installSkillPackage(required(spec, "skill package"), this.#customSkillDirectory);
      return this.#skillDtos();
    });
    this.#handle(channels.skillsSearchRegistry, (_event, query: unknown) =>
      searchSkillRegistry(typeof query === "string" ? query : ""),
    );
    this.#handle(channels.modelsList, () =>
      this.#inference.listModels().map((model) => this.#modelDto(model)),
    );
    this.#handle(channels.modelsSelect, async (_event, provider: string, modelId: string) => {
      const ref = {
        provider: required(provider, "provider"),
        id: required(modelId, "model id"),
      };
      await this.#assertProviderConfigured(ref.provider);
      return this.#selectModel(ref);
    });
    this.#handle(channels.modelsRoles, () => this.#modelRoles());
    this.#handle(channels.modelsAssignRole, (_event, role: unknown, provider: unknown, modelId: unknown) =>
      this.#assignRole(modelRole(role), {
        provider: required(provider, "provider"),
        id: required(modelId, "model id"),
      }),
    );
    this.#handle(channels.modelsClearRole, (_event, role: unknown) =>
      this.#clearRole(modelRole(role)),
    );
    this.#handle(channels.modelsMetadata, () =>
      this.#modelCatalog.metadataFor(
        this.#inference.listModels().map((model) => ({provider: model.provider, id: model.id})),
      ),
    );
    this.#handle(channels.browserOpen, (_event, tabId: string, url?: string) =>
      this.#embeddedBrowser.open(required(tabId, "tab id"), url),
    );
    this.#handle(channels.browserNavigate, (_event, tabId: string, url: string) =>
      this.#embeddedBrowser.navigate(required(tabId, "tab id"), required(url, "url")),
    );
    this.#handle(channels.browserHistory, (_event, tabId: string, delta: -1 | 1) =>
      this.#embeddedBrowser.history(required(tabId, "tab id"), delta === -1 ? -1 : 1),
    );
    this.#handle(channels.browserReload, (_event, tabId: string) =>
      this.#embeddedBrowser.reload(required(tabId, "tab id")),
    );
    this.#handle(channels.browserSetBounds, (_event, tabId: string, bounds: {x: number; y: number; width: number; height: number}) =>
      this.#embeddedBrowser.setBounds(required(tabId, "tab id"), bounds),
    );
    this.#handle(channels.browserSetVisible, (_event, tabId: string, visible: boolean) =>
      this.#embeddedBrowser.setVisible(required(tabId, "tab id"), Boolean(visible)),
    );
    this.#handle(channels.browserClose, (_event, tabId: string) =>
      this.#embeddedBrowser.close(required(tabId, "tab id")),
    );
    this.#handle(channels.browserOpenExternal, (_event, url: string) =>
      import("electron").then(({shell}) => shell.openExternal(required(url, "url"))),
    );
    this.#handle(channels.browserFind, (_event, tabId: string, text: string, forward: boolean) =>
      this.#embeddedBrowser.find(required(tabId, "tab id"), String(text ?? ""), forward !== false),
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
    // to load one there than it is in a tab.
    this.#handle(channels.browserFavicon, (_event, url: string) =>
      faviconDataUrl(session.defaultSession, required(url, "url")),
    );
    this.#handle(channels.browserDownloadsList, () => this.#embeddedBrowser.downloads());
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
    this.#handle(channels.driveSaveS3, (_event, config: unknown) =>
      this.#drive.saveS3(driveS3Config(config)),
    );
    this.#handle(channels.driveList, (_event, provider: unknown, target: unknown) =>
      this.#drive.list(
        driveProvider(provider),
        typeof target === "string" ? target : "",
      ),
    );
    this.#handle(
      channels.driveCreateFolder,
      (_event, provider: unknown, parentPath: unknown, name: unknown) =>
        this.#drive.createFolder(
          driveProvider(provider),
          typeof parentPath === "string" ? parentPath : "",
          required(name, "folder name"),
        ),
    );
    this.#handle(
      channels.driveUpload,
      (_event, provider: unknown, parentPath: unknown, paths: unknown) =>
        this.#drive.upload(
          driveProvider(provider),
          typeof parentPath === "string" ? parentPath : "",
          Array.isArray(paths)
            ? paths.filter((entry): entry is string => typeof entry === "string")
            : undefined,
        ),
    );
    this.#handle(channels.driveDownload, (_event, provider: unknown, target: unknown) =>
      this.#drive.download(driveProvider(provider), required(target, "file path")),
    );
    this.#handle(channels.driveRemove, (_event, provider: unknown, paths: unknown) =>
      this.#drive.remove(
        driveProvider(provider),
        Array.isArray(paths)
          ? paths.filter((entry): entry is string => typeof entry === "string")
          : [],
      ),
    );
    this.#handle(
      channels.driveRename,
      (_event, provider: unknown, target: unknown, name: unknown) =>
        this.#drive.rename(
          driveProvider(provider),
          required(target, "file path"),
          required(name, "name"),
        ),
    );
    this.#handle(
      channels.driveMove,
      (_event, provider: unknown, paths: unknown, destination: unknown) =>
        this.#drive.move(
          driveProvider(provider),
          Array.isArray(paths)
            ? paths.filter((entry): entry is string => typeof entry === "string")
            : [],
          typeof destination === "string" ? destination : "",
        ),
    );
    this.#handle(channels.driveCopy, (_event, provider: unknown, paths: unknown) =>
      this.#drive.copy(
        driveProvider(provider),
        Array.isArray(paths)
          ? paths.filter((entry): entry is string => typeof entry === "string")
          : [],
      ),
    );
    this.#handle(channels.providersList, () => this.#providerDtos());
    this.#handle(channels.providersSaveApiKey, async (_event, providerId: string, apiKey: string) => {
      const id = required(providerId, "provider");
      const provider = this.#models.getProvider(id);
      if (!provider) throw new Error(`Unknown provider: ${id}`);
      if (!provider.auth.apiKey) throw new Error(`${provider.name} does not support API-key authentication`);
      await this.#apiKeys.add(id, required(apiKey, "API key"));
      const updated = await this.#providerDto(id);
      const currentUsable = this.#model
        ? (await this.#providerDto(this.#model.provider)).configured
        : false;
      if (!currentUsable) {
        const model = this.#inference.listModels(id)[0];
        if (model) this.#selectModel({provider: model.provider, id: model.id});
      }
      return updated;
    });
    this.#handle(channels.providersRemoveApiKey, async (_event, providerId: string, keyId: string) => {
      const id = required(providerId, "provider");
      if (!this.#models.getProvider(id)) throw new Error(`Unknown provider: ${id}`);
      await this.#apiKeys.remove(id, required(keyId, "API key id"));
      return this.#providerDto(id);
    });
    this.#handle(channels.providersCreateCustom, async (_event, value: unknown) => {
      const request = customProviderRequest(value);
      const id = this.#availableCustomProviderId(request.name);
      const config: CustomProviderConfig = {
        id,
        name: request.name,
        baseUrl: request.baseUrl,
        logoDataUrl: request.logoDataUrl,
        models: request.models.map((model) => ({id: model.id, name: model.name ?? model.id})),
      };
      this.#registerCustomProvider(config);
      this.#persistCustomProviders();
      if (request.apiKey) await this.#apiKeys.add(id, request.apiKey);
      return this.#providerDto(id);
    });
    this.#handle(channels.providersUpdateCustom, async (_event, value: unknown) => {
      const request = updateCustomProviderRequest(value);
      if (!this.#customProviders.has(request.id)) throw new Error(`Unknown custom provider: ${request.id}`);
      const config: CustomProviderConfig = {
        id: request.id,
        name: request.name,
        baseUrl: request.baseUrl,
        logoDataUrl: request.logoDataUrl,
        models: request.models.map((model) => ({id: model.id, name: model.name ?? model.id})),
      };
      this.#registerCustomProvider(config);
      this.#persistCustomProviders();
      if (this.#model?.provider === request.id) {
        const current = config.models.some((model) => model.id === this.#model!.id);
        this.#selectModel({provider: request.id, id: current ? this.#model.id : config.models[0]!.id}, !current);
      }
      return this.#providerDto(request.id);
    });
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
        files: Array<{ name: string; path: string; mimeType: string | null; size: number }>,
      ) => {
        const id = required(conversationId, "conversation id");
        if (!Array.isArray(files)) throw new Error("files must be an array");
        return files.map((file) => this.#storage.createReference({
          id: crypto.randomUUID(),
          conversationId: id,
          kind: "file",
          title: required(file.name, "file name"),
          uri: required(file.path, "file path"),
          metadata: {mimeType: file.mimeType, size: file.size},
        }));
      },
    );
    this.#mcpConfigWatcher.start();
    this.#codexMcpConfigWatcher.start();
  }

  async reloadMcp(): Promise<McpServerDto[]> {
    if (this.#mcpReloadInFlight) return this.#mcpReloadInFlight;
    const reload = this.#performMcpReload();
    this.#mcpReloadInFlight = reload;
    try {
      return await reload;
    } finally {
      if (this.#mcpReloadInFlight === reload) this.#mcpReloadInFlight = undefined;
      if (this.#mcpReloadPending && this.#activeRuns.size === 0 && !this.#closing)
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
    const codexSource = await readFile(this.#codexMcpConfigPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      },
    );
    const codexConfigs = codexSource
      ? importMcpServers(parseToml(codexSource)).map((config) => ({
          ...config,
          metadata: {...config.metadata, source: "codex"},
        }))
      : [];
    const flareaiConfigs = importMcpServers(JSON.parse(source)).map((config) => ({
      ...config,
      metadata: {...config.metadata, source: "flareai"},
    }));
    // A FlareAI-local entry intentionally overrides a Codex entry with the same
    // id, so personal experiments never require changing ChatGPT's setup.
    const configs = [...new Map(
      [...codexConfigs, ...flareaiConfigs].map((config) => [config.id, config]),
    ).values()].map((config) => ({
      ...config,
      enabled: this.#integrationEnabled("mcp-enabled", config.id, config.enabled !== false),
    }));
    this.#mcpConfigs.clear();
    for (const config of configs) this.#mcpConfigs.set(config.id, config);
    this.#mcp.configure(configs);
    const snapshots = await this.#mcp.connectEnabled();
    for (const name of this.#mcpToolNames) this.#registry.remove(name);
    this.#mcpToolNames.clear();
    for (const tool of this.#mcp.tools()) {
      this.#registry.register(tool);
      this.#mcpToolNames.add(tool.name);
    }
    return snapshots.map((snapshot) => this.#mcpDto(snapshot));
  }

  async close(): Promise<void> {
    this.#closing = true;
    stopUpdateChecks();
    this.#surfaceMenubar.close();
    void this.#agentSurface.close();
    this.#embeddedBrowser.closeAll();
    this.#mcpConfigWatcher.stop();
    this.#codexMcpConfigWatcher.stop();
    this.#chronicle.stop();
    this.#dictation.close();
    const activeRuns = [...this.#activeRuns.values()];
    for (const run of activeRuns)
      run.control.cancel(new Error("FlareAI is closing"));
    for (const channel of this.#registeredChannels)
      this.#ipcMain.removeHandler(channel);
    await Promise.allSettled([
      ...activeRuns.map((run) => run.result),
      ...(this.#mcpReloadInFlight ? [this.#mcpReloadInFlight] : []),
    ]);
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
      active.control.cancel(new Error("FlareAI is closing"));
      return;
    }
    this.#goalContinuations.set(conversationId, runId);
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

  async #startRun(
    request: ReturnType<typeof validateStartRun>,
  ): Promise<{ runId: string }> {
    this.#preemptGoalContinuation(request.conversationId);
    await this.#prepareMcpForRun();
    const agent = await this.#ensureConfiguredAgent();
    const runId = crypto.randomUUID();
    const active = agent.start({
      conversationId: request.conversationId,
      text: request.text,
      userMessageId: request.messageId,
      attachments: request.attachments,
      asGoal: request.asGoal,
      reasoning: request.reasoning,
      runId,
    });
    this.#activeRuns.set(runId, active);
    void this.#forwardEvents(runId, active);
    return { runId };
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
        const conversationId = this.#storage.getRun(runId)?.conversationId ?? "";
        // Pages opened and files written during the run feed the Summary panel.
        this.#runResources.record(conversationId, runId, event);
        if (!this.#window.isDestroyed())
          this.#window.webContents.send(
            channels.runEvent,
            eventDto(event, conversationId),
          );
      }
      await active.result;
    } catch {
      // The agent already publishes a durable run.failed event. Settling below
      // still lets the renderer replace optimistic state with stored messages.
    } finally {
      this.#activeRuns.delete(runId);
      const goalConversation = this.#storage.getRun(runId)?.conversationId;
      if (
        goalConversation &&
        this.#goalContinuations.get(goalConversation) === runId
      )
        this.#goalContinuations.delete(goalConversation);
      if (this.#activeRuns.size === 0 && this.#mcpReloadPending)
        await this.#reloadMcpAndPublish();
      if (!this.#window.isDestroyed()) {
        const conversationId = this.#storage.getRun(runId)?.conversationId ?? "";
        this.#window.webContents.send(channels.runEvent, {
          runId,
          conversationId,
          sequence: Number.MAX_SAFE_INTEGER,
          timestamp: Date.now(),
          type: "run.settled",
          payload: {runId, conversationId},
        } satisfies RunEventDto);
      }
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
        servers: this.#mcp.snapshots().map((snapshot) => this.#mcpDto(snapshot)),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #reloadMcpAfterMutation(): Promise<McpServerDto[]> {
    if (this.#activeRuns.size || this.#mcpReloadInFlight) {
      this.#mcpReloadPending = true;
      return this.#mcp.snapshots().map((snapshot) => this.#mcpDto(snapshot));
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

  #skillDtos(): SkillDto[] {
    return this.#skills.load().skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      filePath: skill.filePath,
      disableModelInvocation: skill.disableModelInvocation,
      allowedTools: skill.allowedTools ?? [],
      enabled: this.#integrationEnabled("skill-enabled", skill.name),
      editable: skill.source === "flareai",
      instructions: skill.source === "flareai" ? skillInstructions(readFileSync(skill.filePath, "utf8")) : undefined,
      displayName: skill.displayName,
      author: skill.author,
      category: skill.category,
      updatedAt: skill.updatedAt,
    }));
  }

  #integrationEnabled(key: "skill-enabled" | "mcp-enabled", id: string, fallback = true): boolean {
    const value = this.#storage.getPreference(key)?.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
    const stored = (value as Record<string, unknown>)[id];
    return typeof stored === "boolean" ? stored : fallback;
  }

  #setIntegrationEnabled(key: "skill-enabled" | "mcp-enabled", id: string, enabled: unknown): void {
    if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
    const value = this.#storage.getPreference(key)?.value;
    const current = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, boolean>
      : {};
    this.#storage.setPreference(key, {...current, [id]: enabled});
  }

  async #saveCustomMcp(request: SaveCustomMcpRequest): Promise<void> {
    const source = await readFile(this.#mcpConfigPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => error.code === "ENOENT" ? "{}" : Promise.reject(error),
    );
    const root = JSON.parse(source) as Record<string, unknown>;
    const existing = root.mcpServers;
    const servers = existing && typeof existing === "object" && !Array.isArray(existing)
      ? {...existing as Record<string, unknown>}
      : {};
    servers[request.id] = request.transport === "stdio"
      ? {name: request.name, description: request.description, command: request.command, args: request.args, env: request.env, cwd: request.cwd}
      : {name: request.name, description: request.description, url: request.url, headers: request.headers};
    root.mcpServers = servers;
    await mkdir(path.dirname(this.#mcpConfigPath), {recursive: true});
    const temporary = `${this.#mcpConfigPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(root, null, 2)}\n`, "utf8");
    await rename(temporary, this.#mcpConfigPath);
  }

  async #removeCustomMcp(id: string): Promise<void> {
    const source = await readFile(this.#mcpConfigPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => error.code === "ENOENT" ? "{}" : Promise.reject(error),
    );
    const root = JSON.parse(source) as Record<string, unknown>;
    const existing = root.mcpServers;
    if (!existing || typeof existing !== "object" || Array.isArray(existing) || !(id in existing))
      throw new Error(`MCP server is not removable: ${id}`);
    const servers = {...existing as Record<string, unknown>};
    delete servers[id];
    root.mcpServers = servers;
    const temporary = `${this.#mcpConfigPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(root, null, 2)}\n`, "utf8");
    await rename(temporary, this.#mcpConfigPath);
    const cached = this.#storage.getPreference("mcp-capabilities")?.value;
    if (cached && typeof cached === "object" && !Array.isArray(cached)) {
      const next = {...cached};
      delete next[id];
      this.#storage.setPreference("mcp-capabilities", next);
    }
  }

  async #saveCustomSkill(request: SaveCustomSkillRequest): Promise<void> {
    const destination = path.join(this.#customSkillDirectory, request.name);
    if (request.originalName && request.originalName !== request.name) {
      const original = path.join(this.#customSkillDirectory, request.originalName);
      await rename(original, destination);
    }
    await mkdir(destination, {recursive: true});
    const contents = `---\nname: ${request.name}\ndescription: ${request.description}\n---\n\n${request.instructions.trim()}\n`;
    const temporary = path.join(destination, "SKILL.md.tmp");
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, path.join(destination, "SKILL.md"));
  }

  async #removeCustomSkill(name: string): Promise<void> {
    const skill = this.#skills.load().skills.find((candidate) => candidate.name === name);
    if (!skill || skill.source !== "flareai") throw new Error(`Skill is not removable: ${name}`);
    const root = path.resolve(this.#customSkillDirectory);
    const destination = path.resolve(root, name);
    if (path.dirname(destination) !== root) throw new Error(`Invalid skill name: ${name}`);
    await rm(destination, {recursive: true, force: false});
    const stored = this.#storage.getPreference("skill-enabled")?.value;
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      const next = {...stored};
      delete next[name];
      this.#storage.setPreference("skill-enabled", next);
    }
  }

  async #uploadSkill(files: SkillUploadFile[]): Promise<void> {
    const skillFiles = files.filter((file) => file.relativePath.split("/").length === 2 && path.basename(file.relativePath) === "SKILL.md");
    if (skillFiles.length !== 1) throw new Error("Choose one skill folder with a SKILL.md at its top level");
    const rootName = skillFiles[0]!.relativePath.split("/")[0]!;
    const selected = files.filter((file) => file.relativePath.startsWith(`${rootName}/`));
    const temporary = path.join(this.#customSkillDirectory, `.upload-${randomUUID()}`);
    await mkdir(temporary, {recursive: true});
    try {
      for (const file of selected) {
        const relative = file.relativePath.slice(rootName.length + 1);
        if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new Error("Skill folder contains an invalid path");
        const destination = path.join(temporary, relative);
        await mkdir(path.dirname(destination), {recursive: true});
        await copyFile(file.path, destination);
      }
      const result = new SkillLoader({configured: [temporary]}).load();
      const skill = result.skills.find((item) => item.filePath === path.join(temporary, "SKILL.md"));
      if (!skill) throw new Error("The selected folder does not contain a valid SKILL.md with a name and description");
      const diagnostic = result.diagnostics.find((item) => item.severity === "error");
      if (diagnostic) throw new Error(diagnostic.message);
      const destination = path.join(this.#customSkillDirectory, skill.name);
      const exists = await stat(destination).then(() => true, (error: NodeJS.ErrnoException) => error.code === "ENOENT" ? false : Promise.reject(error));
      if (exists) throw new Error(`A skill named ${skill.name} already exists`);
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, {recursive: true, force: true});
      throw error;
    }
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
      return {...settings, onboardingCompleted: true};
    return settings;
  }

  #environmentPromptContext() {
    const settings = this.#generalSettings();
    const now = new Date();
    const offsetMinutes = -now.getTimezoneOffset();
    const offsetSign = offsetMinutes >= 0 ? "+" : "-";
    const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
    const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
    return {
      time: settings.timeEnabled
        ? {
            local: new Intl.DateTimeFormat(undefined, {
              dateStyle: "full",
              timeStyle: "long",
            }).format(now),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            utcOffset: `${offsetSign}${offsetHours}:${offsetRemainder}`,
          }
        : undefined,
      language:
        settings.language === "system"
          ? undefined
          : languageLabel(settings.language),
      locationEnabled: settings.locationEnabled,
      location:
        settings.locationEnabled && settings.location
          ? settings.location
          : undefined,
    };
  }

  #selectModel(ref: ModelRef, persist = true): ModelDto {
    const model = this.#inference.getModel(ref);
    if (!model) throw new Error(`Unknown model: ${ref.provider}/${ref.id}`);
    this.#model = ref;
    this.#buildAgent(ref);
    if (persist)
      this.#storage.setPreference("model", {
        provider: ref.provider,
        id: ref.id,
      });
    return this.#modelDto(model);
  }

  #buildAgent(ref: ModelRef): void {
    this.#agent = new FlareAIAgent({
      inference: this.#inference,
      storage: this.#storage,
      memory: this.#memory,
      chronicle: this.#chronicle,
      environment: { promptContext: () => this.#environmentPromptContext() },
      tools: this.#registry,
      model: ref,
      // Both fall back to the main model inside the agent when undefined, so
      // an override that no longer resolves simply stops applying.
      taskModel: this.#usableRole("task"),
      judgeModel: this.#usableRole("judge"),
      skills: this.#agentSkillOptions,
      hooks: this.#hooks,
      onGoalContinuation: ({ conversationId, runId, run }) =>
        this.#trackGoalContinuation(conversationId, runId, run),
    });
  }

  /** A stored override only counts while the model it names still exists. */
  #usableRole(role: ModelRole): ModelRef | undefined {
    const ref = this.#roleOverrides[role];
    return ref && this.#inference.getModel(ref) ? ref : undefined;
  }

  #modelRoles(): ModelRolesDto {
    const assignment = (ref: ModelRef | undefined): ModelRoleAssignmentDto | null => {
      if (!ref) return null;
      const model = this.#inference.getModel(ref);
      if (!model) return null;
      return { provider: ref.provider, id: ref.id, name: model.name ?? ref.id };
    };
    return {
      main: assignment(this.#model),
      task: assignment(this.#usableRole("task")),
      judge: assignment(this.#usableRole("judge")),
      speech: assignment(this.#usableRole("speech")),
      image: assignment(this.#usableRole("image")),
      video: assignment(this.#usableRole("video")),
    };
  }

  async #assignRole(role: ModelRole, ref: ModelRef): Promise<ModelRolesDto> {
    await this.#assertProviderConfigured(ref.provider);
    if (role === "main") {
      this.#selectModel(ref);
      return this.#modelRoles();
    }
    if (!this.#inference.getModel(ref))
      throw new Error(`Unknown model: ${ref.provider}/${ref.id}`);
    this.#roleOverrides = { ...this.#roleOverrides, [role]: ref };
    this.#persistRoles();
    return this.#modelRoles();
  }

  #clearRole(role: ModelRole): ModelRolesDto {
    // The main model is what everything else falls back to, so there is
    // nothing to clear it to.
    if (role === "main") throw new Error("The main model cannot be cleared");
    const {[role]: _removed, ...rest} = this.#roleOverrides;
    this.#roleOverrides = rest;
    this.#persistRoles();
    return this.#modelRoles();
  }

  #persistRoles(): void {
    this.#storage.setPreference(
      "model-roles",
      Object.fromEntries(
        Object.entries(this.#roleOverrides).map(([role, ref]) => [
          role,
          { provider: ref.provider, id: ref.id },
        ]),
      ),
    );
    if (this.#model) this.#buildAgent(this.#model);
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
        cacheRead: free ? knownRate(model.cost?.cacheRead) : positiveRate(model.cost?.cacheRead),
        cacheWrite: free ? knownRate(model.cost?.cacheWrite) : positiveRate(model.cost?.cacheWrite),
      },
      selected: this.#model?.provider === model.provider && this.#model.id === model.id,
      custom: this.#customProviders.has(model.provider),
    };
  }

  #availableCustomProviderId(name: string): string {
    const stem = `custom-${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "provider"}`;
    let id = stem;
    let suffix = 2;
    while (this.#models.getProvider(id)) id = `${stem}-${suffix++}`;
    return id;
  }

  #registerCustomProvider(config: CustomProviderConfig): void {
    const models: Array<Model<"openai-completions">> = config.models.map((model) => ({
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
    this.#models.setProvider(createProvider({
      id: config.id,
      name: config.name,
      baseUrl: config.baseUrl,
      auth: {apiKey: {
        name: `${config.name} API key`,
        resolve: async ({credential}) => ({
          auth: {apiKey: credential?.key ?? "flareai-local"},
          source: credential?.key ? "Saved API key" : "Custom endpoint",
        }),
      }},
      models,
      api: openAICompletionsApi(),
    }));
    this.#customProviders.set(config.id, config);
  }

  #persistCustomProviders(): void {
    this.#storage.setPreference("custom-providers", [...this.#customProviders.values()].map((provider) => ({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      logoDataUrl: provider.logoDataUrl,
      models: provider.models.map((model) => ({id: model.id, name: model.name})),
    })));
  }

  async #providerDtos(): Promise<ProviderDto[]> {
    return Promise.all(this.#models.getProviders().map((provider) => this.#providerDto(provider.id)));
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
      configured: auth !== undefined || stored !== undefined || apiKeys.length > 0,
      source: apiKeys.length ? `${apiKeys.length} saved API ${apiKeys.length === 1 ? "key" : "keys"}` : auth?.source ?? null,
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
  async #ensureConfiguredAgent(): Promise<FlareAIAgent> {
    if (this.#model) {
      const current = await this.#providerDto(this.#model.provider);
      if (current.configured) return this.#requireAgent();
    }

    const providers = await this.#providerDtos();
    for (const provider of providers) {
      if (!provider.configured) continue;
      const model = this.#inference.listModels(provider.id)[0];
      if (!model) continue;
      this.#selectModel({provider: model.provider, id: model.id});
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

  #requireAgent(): FlareAIAgent {
    if (!this.#agent)
      throw new Error(
        "No inference model is configured. Set FLAREAI_MODEL to provider/model.",
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
      description: typeof config?.metadata?.description === "string" ? config.metadata.description : undefined,
      source: config?.metadata?.source === "codex"
        ? "codex"
        : config?.metadata?.source === "official"
          ? "official"
          : "flareai",
      editable: config?.metadata?.source === "flareai",
      enabled: this.#integrationEnabled("mcp-enabled", snapshot.id, config?.enabled !== false),
      transport: config?.transport ?? "stdio",
      ...(config?.transport === "stdio"
        ? {command: config.command, args: config.args, env: config.env, cwd: config.cwd}
        : config?.transport === "streamable-http"
          ? {url: config.url, headers: config.headers}
          : {}),
    };
  }

  #mcpCapabilities(snapshot: ReturnType<McpManager["snapshots"]>[number]): Pick<McpServerDto, "toolNames" | "resourceUris" | "promptNames"> {
    const current = {toolNames: snapshot.toolNames, resourceUris: snapshot.resourceUris, promptNames: snapshot.promptNames};
    const value = this.#storage.getPreference("mcp-capabilities")?.value;
    const cache = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    if (snapshot.status === "connected") {
      const previous = cache[snapshot.id];
      if (JSON.stringify(previous) !== JSON.stringify(current))
        this.#storage.setPreference("mcp-capabilities", {...cache, [snapshot.id]: current});
      return current;
    }
    const saved = cache[snapshot.id];
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return current;
    const record = saved as Record<string, unknown>;
    return {
      toolNames: Array.isArray(record.toolNames) && record.toolNames.every((item) => typeof item === "string") ? record.toolNames : current.toolNames,
      resourceUris: Array.isArray(record.resourceUris) && record.resourceUris.every((item) => typeof item === "string") ? record.resourceUris : current.resourceUris,
      promptNames: Array.isArray(record.promptNames) && record.promptNames.every((item) => typeof item === "string") ? record.promptNames : current.promptNames,
    };
  }

  #handle<T extends unknown[]>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: T) => unknown,
  ): void {
    this.#registeredChannels.push(channel);
    this.#ipcMain.handle(channel, (event, ...args) => {
      if (
        event.sender.id !== this.#window.webContents.id ||
        event.senderFrame !== this.#window.webContents.mainFrame
      )
        throw new Error("Rejected IPC from an untrusted frame");
      return listener(event, ...(args as T));
    });
  }
}

function eventDto(event: AgentRunEvent, conversationId: string): RunEventDto {
  return {
    runId: event.runId,
    conversationId,
    sequence: event.sequence,
    timestamp: event.timestamp,
    type: event.type,
    payload: json(event),
  };
}
function storedEventDto(
  event: {
    runId: string;
    sequence: number;
    type: string;
    payload: unknown;
    createdAt: string;
  },
  conversationId: string,
): RunEventDto {
  const timestamp =
    typeof event.payload === "object" &&
    event.payload &&
    "timestamp" in event.payload
      ? Number(event.payload.timestamp)
      : Date.parse(event.createdAt);
  return {
    runId: event.runId,
    conversationId,
    sequence: event.sequence,
    timestamp,
    type: event.type,
    payload: json(event.payload),
  };
}
function json(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}
function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
/**
 * Answers to a bridge login step. Field ids come from the bridge, so the map is
 * accepted as-is apart from requiring every value to be a string.
 */
function mailListRequest(value: unknown): MailListRequest {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    account: typeof input.account === "string" ? input.account : undefined,
    folder: typeof input.folder === "string" ? input.folder : undefined,
    page: typeof input.page === "number" ? input.page : undefined,
    pageSize: typeof input.pageSize === "number" ? input.pageSize : undefined,
    sort: MAIL_SORTS.includes(input.sort as string)
      ? (input.sort as MailListRequest["sort"])
      : undefined,
    query: typeof input.query === "string" && input.query.trim() ? input.query : undefined,
  };
}

const MAIL_SORTS = ["date-desc", "date-asc", "subject", "from"];

function sendMailRequest(value: unknown): SendMailRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Mail request must be an object");
  const input = value as Record<string, unknown>;
  const to = optionalStringArray(input.to, "to");
  if (to.length === 0) throw new Error("At least one recipient is required");
  return {
    account: typeof input.account === "string" ? input.account : undefined,
    to,
    cc: optionalStringArray(input.cc, "cc"),
    bcc: optionalStringArray(input.bcc, "bcc"),
    subject: typeof input.subject === "string" ? input.subject : "",
    body: typeof input.body === "string" ? input.body : "",
    draft: input.draft === true,
    attachments: optionalStringArray(input.attachments, "attachments"),
    inReplyTo: typeof input.inReplyTo === "string" ? input.inReplyTo : undefined,
    references: optionalStringArray(input.references, "references"),
    replacesDraft: draftReference(input.replacesDraft),
  };
}

/** The draft an edited message replaces, when it came from one. */
function draftReference(value: unknown): SendMailRequest["replacesDraft"] {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  return typeof input.id === "string" && typeof input.folder === "string"
    ? {id: input.id, folder: input.folder}
    : null;
}

/** Identifies this run of the app, for the snapshot drawer-openness rule. */
const WORKSPACE_BOOT_ID = randomUUID();

/**
 * A workspace snapshot from the renderer: tab records with whatever fields
 * they carried, plus the active tab and drawer state. Tab kinds are validated
 * by the renderer on restore, so storage only guards the shape.
 */
function workspaceSnapshot(value: unknown): WorkspaceSnapshotDto {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Workspace snapshot must be an object");
  const input = value as Record<string, unknown>;
  const tabs = Array.isArray(input.tabs) ? input.tabs : [];
  return {
    tabs: tabs
      .filter((tab): tab is Record<string, unknown> => !!tab && typeof tab === "object")
      .map((tab) => ({
        id: String(tab.id ?? ""),
        title: String(tab.title ?? ""),
        kind: String(tab.kind ?? ""),
        ...(typeof tab.url === "string" ? {url: tab.url} : {}),
        ...(typeof tab.favicon === "string" ? {favicon: tab.favicon} : {}),
        ...(typeof tab.section === "string" ? {section: tab.section} : {}),
      }))
      .filter((tab) => tab.id && tab.kind),
    activeTabId: typeof input.activeTabId === "string" ? input.activeTabId : null,
    open: input.open === true,
  };
}

function loginValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Login values must be an object");
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, item] of entries)
    if (typeof item !== "string") throw new Error(`${key} must be a string`);
  return Object.fromEntries(entries) as Record<string, string>;
}
function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => required(item, `${label}[${index}]`));
}

/**
 * Every kind the protocol declares, as a map rather than a list of literals so
 * that a kind added to SystemPermissionKind fails to compile here instead of
 * being rejected at the IPC boundary — which is how Accessibility ended up
 * unaskable from onboarding while both sides of it worked.
 */
const SYSTEM_PERMISSIONS: Record<SystemPermissionKind, true> = {
  microphone: true,
  "screen-recording": true,
  accessibility: true,
  "full-disk-access": true,
};

function systemPermission(value: unknown): SystemPermissionKind;
function systemPermission(
  value: unknown,
  includeLocation: true,
): SystemPermissionKind | "location";
function systemPermission(
  value: unknown,
  includeLocation = false,
): SystemPermissionKind | "location" {
  if (typeof value === "string" && Object.hasOwn(SYSTEM_PERMISSIONS, value))
    return value as SystemPermissionKind;
  if (includeLocation && value === "location") return "location";
  throw new Error(`Unknown system permission: ${String(value)}`);
}
function number(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error("sequence must be a non-negative integer");
  return Number(value);
}

function chronicleQuery(value: unknown): {
  since?: Date;
  until?: Date;
  limit?: number;
} {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Chronicle query must be an object");
  const record = value as Record<string, unknown>;
  const result: { since?: Date; until?: Date; limit?: number } = {};
  for (const key of ["since", "until"] as const) {
    const raw = record[key];
    if (raw === undefined) continue;
    if (typeof raw !== "string" || !Number.isFinite(Date.parse(raw)))
      throw new Error(`${key} must be an ISO timestamp`);
    result[key] = new Date(raw);
  }
  if (record.limit !== undefined) {
    if (!Number.isSafeInteger(record.limit) || Number(record.limit) < 1)
      throw new Error("limit must be a positive integer");
    result.limit = Math.min(Number(record.limit), 1_000);
  }
  return result;
}

export function modelFromEnvironment(
  value = process.env.FLAREAI_MODEL,
): ModelRef | undefined {
  if (!value) return undefined;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1)
    throw new Error("FLAREAI_MODEL must use provider/model format");
  return {
    provider: value.slice(0, separator),
    id: value.slice(separator + 1),
  };
}

/**
 * City-level position from the network. Chromium's own geolocation needs a
 * Google API key (or a CoreLocation grant the dev bundle rarely holds), so
 * the renderer falls back to this whenever the platform service fails; for
 * agent context — weather, local time, nearby places — city-level is enough.
 */
async function approximateLocation(): Promise<NonNullable<GeneralSettingsDto["location"]>> {
  const services = ["https://ipwho.is/", "https://ipapi.co/json/"];
  let failure = "the network location services did not respond";
  for (const service of services) {
    try {
      const response = await fetch(service, {
        signal: AbortSignal.timeout(6_000),
        headers: { accept: "application/json" },
      });
      if (!response.ok) continue;
      const body = (await response.json()) as Record<string, unknown>;
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude))
        return {
          latitude,
          longitude,
          // IP geolocation is city-scale; advertise that honestly.
          accuracy: 25_000,
          updatedAt: new Date().toISOString(),
        };
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Could not determine an approximate location: ${failure}`);
}

function audioBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value))
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("Dictation audio must be binary");
}

const BROWSER_IDENTITIES: Record<string, { name: string; bundleId: string }> = {
  chrome: { name: "Google Chrome", bundleId: "com.google.Chrome" },
  brave: { name: "Brave Browser", bundleId: "com.brave.Browser" },
  edge: { name: "Microsoft Edge", bundleId: "com.microsoft.edgemac" },
  arc: { name: "Arc", bundleId: "company.thebrowser.Browser" },
  chromium: { name: "Chromium", bundleId: "org.chromium.Chromium" },
};

function tabContextBrowser(): { name: string; bundleId: string } | null {
  try {
    const payload = JSON.parse(
      readFileSync(
        path.join(
          homedir(),
          "Library",
          "Application Support",
          "flareai-tab-context",
          "tabs.json",
        ),
        "utf8",
      ),
    ) as { browser?: string };
    return BROWSER_IDENTITIES[payload.browser ?? ""] ?? null;
  } catch {
    return null;
  }
}

function browserAppName(): string {
  return tabContextBrowser()?.name ?? "Browser";
}

function browserBundleId(): string | undefined {
  return tabContextBrowser()?.bundleId;
}

/** Whether a stored settings record predates the first-run setup flag. */
function hasOnboardingFlag(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "onboardingCompleted" in (value as Record<string, unknown>)
  );
}

function generalSettingsPreference(value: unknown): GeneralSettingsDto {
  const defaults: GeneralSettingsDto = {
    theme: "light",
    language: "system",
    currency: null,
    speechModeEnabled: true,
    dictationAutoStopSeconds: 6,
    timeEnabled: true,
    locationEnabled: true,
    reasoningLevel: "medium",
    onboardingCompleted: false,
    location: null,
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return defaults;
  const record = value as Record<string, unknown>;
  return {
    theme:
      record.theme === "light" || record.theme === "dark" || record.theme === "system"
        ? record.theme
        : defaults.theme,
    language: supportedLanguage(record.language) ?? defaults.language,
    currency: supportedCurrency(record.currency),
    speechModeEnabled:
      typeof record.speechModeEnabled === "boolean"
        ? record.speechModeEnabled
        : defaults.speechModeEnabled,
    dictationAutoStopSeconds:
      record.dictationAutoStopSeconds === null
        ? null
        : (autoStopSeconds(record.dictationAutoStopSeconds) ??
          defaults.dictationAutoStopSeconds),
    timeEnabled:
      typeof record.timeEnabled === "boolean"
        ? record.timeEnabled
        : defaults.timeEnabled,
    locationEnabled:
      typeof record.locationEnabled === "boolean"
        ? record.locationEnabled
        : defaults.locationEnabled,
    onboardingCompleted:
      typeof record.onboardingCompleted === "boolean"
        ? record.onboardingCompleted
        : defaults.onboardingCompleted,
    // `thinkingLevel` is the pre-rename key: settings written before the
    // rename still carry it, so an existing choice is not reset to the default.
    reasoningLevel:
      reasoningEffort(
        record.reasoningLevel ?? record.thinkingLevel,
        defaults.reasoningLevel,
      ) ?? defaults.reasoningLevel,
    location: locationPreference(record.location),
  };
}

function generalSettingsUpdate(
  value: unknown,
  current: GeneralSettingsDto,
): GeneralSettingsDto {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("General settings must be an object");
  const record = value as Record<string, unknown>;
  if (
    record.theme !== undefined &&
    record.theme !== "light" &&
    record.theme !== "dark" &&
    record.theme !== "system"
  )
    throw new Error("theme must be light, dark, or system");
  if (record.language !== undefined && !supportedLanguage(record.language))
    throw new Error(
      `language must be one of: ${SUPPORTED_LANGUAGES.map((item) => item.value).join(", ")}`,
    );
  if (record.currency !== undefined && record.currency !== null && !supportedCurrency(record.currency))
    throw new Error("currency must be USD, AUD, EUR, GBP, SGD, or JPY");
  if (record.timeEnabled !== undefined && typeof record.timeEnabled !== "boolean")
    throw new Error("timeEnabled must be a boolean");
  if (
    record.onboardingCompleted !== undefined &&
    typeof record.onboardingCompleted !== "boolean"
  )
    throw new Error("onboardingCompleted must be a boolean");
  if (
    record.speechModeEnabled !== undefined &&
    typeof record.speechModeEnabled !== "boolean"
  )
    throw new Error("speechModeEnabled must be a boolean");
  if (
    record.dictationAutoStopSeconds !== undefined &&
    record.dictationAutoStopSeconds !== null &&
    !autoStopSeconds(record.dictationAutoStopSeconds)
  )
    throw new Error(
      `dictationAutoStopSeconds must be null or a whole number of seconds between ${AUTO_STOP_MIN_SECONDS} and ${AUTO_STOP_MAX_SECONDS}`,
    );
  if (
    record.locationEnabled !== undefined &&
    typeof record.locationEnabled !== "boolean"
  )
    throw new Error("locationEnabled must be a boolean");
  if (
    record.reasoningLevel !== undefined &&
    !reasoningEffort(record.reasoningLevel, null)
  )
    throw new Error("reasoningLevel must be a supported reasoning effort");
  const locationEnabled =
    typeof record.locationEnabled === "boolean"
      ? record.locationEnabled
      : current.locationEnabled;
  const location =
    record.location === undefined
      ? current.location
      : record.location === null
        ? null
        : requiredLocation(record.location);
  const onboardingCompleted =
    typeof record.onboardingCompleted === "boolean"
      ? record.onboardingCompleted
      : current.onboardingCompleted;
  return {
    onboardingCompleted,
    theme:
      record.theme === "light" || record.theme === "dark" || record.theme === "system"
        ? record.theme
        : current.theme,
    language: supportedLanguage(record.language) ?? current.language,
    currency:
      record.currency === undefined
        ? current.currency
        : record.currency === null
          ? null
          : supportedCurrency(record.currency),
    speechModeEnabled:
      typeof record.speechModeEnabled === "boolean"
        ? record.speechModeEnabled
        : current.speechModeEnabled,
    dictationAutoStopSeconds:
      record.dictationAutoStopSeconds === undefined
        ? current.dictationAutoStopSeconds
        : record.dictationAutoStopSeconds === null
          ? null
          : (autoStopSeconds(record.dictationAutoStopSeconds) as number),
    timeEnabled:
      typeof record.timeEnabled === "boolean"
        ? record.timeEnabled
        : current.timeEnabled,
    locationEnabled,
    location: locationEnabled ? location : null,
    reasoningLevel:
      record.reasoningLevel === undefined
        ? current.reasoningLevel
        : (reasoningEffort(record.reasoningLevel, current.reasoningLevel) as ReasoningEffort),
  };
}

const REASONING_EFFORTS: ReasoningEffort[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Returns the value when it names a supported effort, otherwise the fallback.
 * The fallback may be null when the caller needs to know whether a raw value
 * was accepted at all (update validation). */
function reasoningEffort(
  value: unknown,
  fallback: ReasoningEffort | null,
): ReasoningEffort | null {
  return typeof value === "string" &&
    REASONING_EFFORTS.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : fallback;
}

const AUTO_STOP_MIN_SECONDS = 2;
const AUTO_STOP_MAX_SECONDS = 60;

/** Returns the value when it is a usable silence window, otherwise null. Null
 * doubles as "never stop on its own", so callers separate that case out before
 * asking. */
function autoStopSeconds(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= AUTO_STOP_MIN_SECONDS &&
    value <= AUTO_STOP_MAX_SECONDS
    ? value
    : null;
}

function supportedCurrency(
  value: unknown,
): Exclude<GeneralSettingsDto["currency"], null> | null {
  return value === "USD" || value === "AUD" || value === "EUR" ||
    value === "GBP" || value === "SGD" || value === "JPY"
    ? value
    : null;
}

function locationPreference(value: unknown): GeneralSettingsDto["location"] {
  try {
    return value === null || value === undefined ? null : requiredLocation(value);
  } catch {
    return null;
  }
}

function requiredLocation(value: unknown): NonNullable<GeneralSettingsDto["location"]> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("location must be an object or null");
  const record = value as Record<string, unknown>;
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  const accuracy = Number(record.accuracy);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
    throw new Error("location latitude is invalid");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
    throw new Error("location longitude is invalid");
  if (!Number.isFinite(accuracy) || accuracy < 0)
    throw new Error("location accuracy is invalid");
  if (typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt)))
    throw new Error("location updatedAt is invalid");
  return { latitude, longitude, accuracy, updatedAt: record.updatedAt };
}

const MODEL_ROLES: ModelRole[] = ["main", "task", "judge", "speech", "image", "video"];

function modelRole(value: unknown): ModelRole {
  if (typeof value === "string" && (MODEL_ROLES as string[]).includes(value))
    return value as ModelRole;
  throw new Error(`Unknown model role: ${String(value)}`);
}

function modelRolesPreference(value: unknown): Partial<Record<ModelRole, ModelRef>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const roles: Partial<Record<ModelRole, ModelRef>> = {};
  for (const role of MODEL_ROLES) {
    if (role === "main") continue;
    const ref = modelPreference(record[role]);
    if (ref) roles[role] = ref;
  }
  return roles;
}

function modelPreference(value: unknown): ModelRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.provider !== "string" || typeof record.id !== "string")
    return undefined;
  return { provider: record.provider, id: record.id };
}

function customProviderPreference(value: unknown): CustomProviderConfig[] {
  if (!Array.isArray(value)) return [];
  const configs: CustomProviderConfig[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.baseUrl !== "string" || !Array.isArray(record.models)) continue;
    const models = record.models.flatMap((model) => {
      if (!model || typeof model !== "object" || Array.isArray(model)) return [];
      const entry = model as Record<string, unknown>;
      return typeof entry.id === "string" && typeof entry.name === "string" ? [{id: entry.id, name: entry.name}] : [];
    });
    const logoDataUrl = validProviderLogo(record.logoDataUrl);
    if (models.length) configs.push({id: record.id, name: record.name, baseUrl: record.baseUrl, logoDataUrl, models});
  }
  return configs;
}

function customProviderRequest(value: unknown): CreateCustomProviderRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Custom provider must be an object");
  const record = value as Record<string, unknown>;
  const name = required(record.name, "provider name");
  const rawUrl = required(record.baseUrl, "base URL");
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("base URL must be a valid URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("base URL must use HTTP or HTTPS");
  if (!Array.isArray(record.models) || record.models.length === 0)
    throw new Error("at least one model is required");
  const seen = new Set<string>();
  const models = record.models.map((model) => {
    if (!model || typeof model !== "object" || Array.isArray(model))
      throw new Error("each model must be an object");
    const entry = model as Record<string, unknown>;
    const id = required(entry.id, "model id");
    if (seen.has(id)) throw new Error(`duplicate model id: ${id}`);
    seen.add(id);
    const modelName = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined;
    return {id, name: modelName};
  });
  const apiKey = typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined;
  const logoDataUrl = validProviderLogo(record.logoDataUrl);
  return {name, baseUrl: url.toString().replace(/\/$/, ""), logoDataUrl, apiKey, models};
}

function updateCustomProviderRequest(value: unknown): UpdateCustomProviderRequest {
  const request = customProviderRequest(value);
  const record = value as Record<string, unknown>;
  return {id: required(record.id, "provider id"), ...request};
}

function integrationId(value: unknown, label: string): string {
  const id = required(value, label);
  if (!/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/i.test(id))
    throw new Error(`${label} may contain letters, numbers, dashes, underscores, and dots`);
  return id;
}

function customMcpRequest(value: unknown): SaveCustomMcpRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("MCP server must be an object");
  const record = value as Record<string, unknown>;
  const id = integrationId(record.id, "MCP id");
  const name = required(record.name, "MCP name");
  const description = optionalText(record.description);
  const transport = record.transport === "streamable-http" ? "streamable-http" : "stdio";
  const args = optionalStrings(record.args, "MCP arguments");
  const env = optionalStringRecord(record.env, "MCP environment");
  const headers = optionalStringRecord(record.headers, "MCP headers");
  if (transport === "stdio")
    return {id, name, description, transport, command: required(record.command, "MCP command"), args, env, cwd: optionalText(record.cwd)};
  const url = required(record.url, "MCP URL");
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("MCP URL must use HTTP or HTTPS");
  return {id, name, description, transport, url: parsed.toString(), headers};
}

function customSkillRequest(value: unknown): SaveCustomSkillRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Skill must be an object");
  const record = value as Record<string, unknown>;
  const name = integrationId(record.name, "skill name");
  const originalName = record.originalName === undefined
    ? undefined
    : integrationId(record.originalName, "original skill name");
  const description = required(record.description, "skill description");
  if (/\r|\n/.test(description)) throw new Error("skill description must be one line");
  const instructions = required(record.instructions, "skill instructions");
  return {originalName, name, description, instructions};
}

function skillUploadFiles(value: unknown): SkillUploadFile[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Choose a skill folder to upload");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid skill folder");
    const record = item as Record<string, unknown>;
    return {path: required(record.path, "skill file path"), relativePath: required(record.relativePath, "skill relative path")};
  });
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStrings(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error(`${label} must be a list of strings`);
  return value.map((item) => item.trim()).filter(Boolean);
}

function optionalStringRecord(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.values(value).every((item) => typeof item === "string"))
    throw new Error(`${label} must contain text values`);
  return value as Record<string, string>;
}

function skillInstructions(contents: string): string {
  if (!contents.startsWith("---")) return contents.trim();
  const end = contents.indexOf("\n---", 3);
  return end < 0 ? contents.trim() : contents.slice(end + 4).trim();
}

function validProviderLogo(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 1_500_000 || !/^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(value))
    throw new Error("provider image must be a PNG, JPEG, WebP, GIF, or SVG under 1 MB");
  return value;
}

/** Zero is a real price — free models publish it — so only a missing or
 * malformed rate becomes null (rendered as "unavailable"). */
function knownRate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** For rates where zero means "not offered" rather than "free". */
function positiveRate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}
