import { readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { GoalManager, MemoryManager, MidasAgent, SkillLoader, type SkillLoaderOptions } from "@midas/agent";
import { ChronicleManager } from "@midas/chronicle";
import type { ActiveAgentRun, AgentRunEvent } from "@midas/core";
import type { InferenceModel, InferenceService, ModelRef } from "@midas/inference";
import { PiInference } from "@midas/inference/pi";
import type {
  CreateCustomProviderRequest,
  GeneralSettingsDto,
  GoalCommandRequest,
  McpServerDto,
  SaveCustomMcpRequest,
  SaveCustomSkillRequest,
  ModelDto,
  ProviderDto,
  RunEventDto,
  SkillDto,
  SkillUploadFile,
  SystemPermissionKind,
  UpdateCustomProviderRequest,
} from "@midas/protocol";
import {
  channels,
  validateGoalCommand,
  validateStartRun,
} from "@midas/protocol";
import { SqliteStorage } from "@midas/storage/sqlite";
import type { StoredMessage } from "@midas/storage";
import {
  createNativeTools,
  importMcpServers,
  McpManager,
  ToolRegistry,
} from "@midas/tools";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import {createProvider, type Model, type MutableModels} from "@earendil-works/pi-ai";
import {openAICompletionsApi} from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {app, safeStorage, type BrowserWindow, type IpcMain, type IpcMainInvokeEvent} from "electron";
import {EncryptedCredentialStore} from "./credential-store.js";
import {EncryptedApiKeyPool} from "./api-key-pool.js";
import {WhisperDictation} from "./dictation.js";
import {installSkillPackage, searchSkillRegistry} from "./skill-registry.js";
import {searchMcpRegistry} from "./mcp-registry.js";
import {ModelCatalog} from "./model-catalog.js";
import {EmbeddedBrowser} from "./embedded-browser.js";
import {RotatingInference} from "./rotating-inference.js";
import {
  AccessibilityChronicleFrames,
  ElectronChronicleSystem,
} from "./chronicle.js";
import {AxReader} from "./ax-reader.js";
import {FileReloadWatcher} from "./file-reload-watcher.js";
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
}

interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  logoDataUrl?: string;
  models: Array<{id: string; name: string}>;
}

export class DesktopBackend {
  readonly #window: BrowserWindow;
  readonly #ipcMain: IpcMain;
  readonly #storage: SqliteStorage;
  #agent?: MidasAgent;
  #model?: ModelRef;
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
  readonly #activeRuns = new Map<string, ActiveAgentRun>();
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
      path.join(options.dataDirectory, "midas.sqlite"),
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
    this.#inference = new RotatingInference(new PiInference(this.#models), this.#apiKeys);
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
    this.#customSkillDirectory = path.join(homedir(), ".midas", "skills");
    this.#codexMcpConfigPath = options.codexConfigPath ?? path.join(homedir(), ".codex", "config.toml");
    this.#mcpConfigWatcher = new FileReloadWatcher(
      this.#mcpConfigPath,
      () => this.#requestMcpReload(),
    );
    this.#codexMcpConfigWatcher = new FileReloadWatcher(
      this.#codexMcpConfigPath,
      () => this.#requestMcpReload(),
    );
    this.#registry = new ToolRegistry(
      createNativeTools({ cwd: options.toolDirectory ?? homedir() }),
    );
    const storedModel = modelPreference(this.#storage.getPreference("model")?.value);
    if (options.model) this.#selectModel(options.model, false);
    else if (storedModel && this.#inference.getModel(storedModel))
      this.#selectModel(storedModel, false);
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
        currency: next.currency,
        speechModeEnabled: next.speechModeEnabled,
        timeEnabled: next.timeEnabled,
        locationEnabled: next.locationEnabled,
        location: next.location,
      });
      return next;
    });
    this.#handle(channels.generalLocate, () => approximateLocation());
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
    this.#handle(channels.dictationTranscribe, (_event, audio: unknown) =>
      this.#dictation.transcribe(audioBuffer(audio)),
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
    this.#handle(channels.conversationsRemove, (_event, id: string) =>
      this.#storage.deleteConversation(required(id, "conversation id")),
    );
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
        return updated ? this.#messageDto(updated) : null;
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
      this.#storage.appendMessage({
        id: messageId ? required(messageId, "message id") : crypto.randomUUID(),
        conversationId: run.conversationId,
        runId: id,
        role: "user",
        content: value,
      });
      this.#requireRun(id).control.steer({
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
    this.#handle(channels.memoryList, (_event, conversationId?: string) =>
      this.#memory.list(conversationId),
    );
    this.#handle(channels.memoryStatus, () => this.#memory.status());
    this.#handle(channels.memorySetEnabled, (_event, enabled: boolean) => {
      if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
      return this.#memory.setEnabled(enabled);
    });
    this.#handle(
      channels.memoryRemember,
      (_event, content: string, conversationId?: string) =>
        this.#memory.remember(required(content, "content"), {
          conversationId,
        }),
    );
    this.#handle(channels.memoryForget, (_event, id: string) =>
      this.#memory.forget(required(id, "memory id")),
    );
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
    this.#handle(channels.browserDownloadsList, () => this.#embeddedBrowser.downloads());
    this.#handle(channels.browserOpenDownload, (_event, id: string) =>
      this.#embeddedBrowser.openDownload(required(id, "download id")),
    );
    this.#handle(channels.browserOpenDownloadsFolder, () =>
      this.#embeddedBrowser.openDownloadsFolder(),
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
    const midasConfigs = importMcpServers(JSON.parse(source)).map((config) => ({
      ...config,
      metadata: {...config.metadata, source: "midas"},
    }));
    // A Midas-local entry intentionally overrides a Codex entry with the same
    // id, so personal experiments never require changing ChatGPT's setup.
    const configs = [...new Map(
      [...codexConfigs, ...midasConfigs].map((config) => [config.id, config]),
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
    this.#embeddedBrowser.closeAll();
    this.#mcpConfigWatcher.stop();
    this.#codexMcpConfigWatcher.stop();
    this.#chronicle.stop();
    const activeRuns = [...this.#activeRuns.values()];
    for (const run of activeRuns)
      run.control.cancel(new Error("Midas is closing"));
    for (const channel of this.#registeredChannels)
      this.#ipcMain.removeHandler(channel);
    await Promise.allSettled([
      ...activeRuns.map((run) => run.result),
      ...(this.#mcpReloadInFlight ? [this.#mcpReloadInFlight] : []),
    ]);
    await this.#mcp.close();
    this.#storage.close();
  }

  async #startRun(
    request: ReturnType<typeof validateStartRun>,
  ): Promise<{ runId: string }> {
    await this.#prepareMcpForRun();
    const agent = await this.#ensureConfiguredAgent();
    const runId = crypto.randomUUID();
    const active = agent.start({
      conversationId: request.conversationId,
      text: request.text,
      userMessageId: request.messageId,
      attachments: request.attachments,
      asGoal: request.asGoal,
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
        if (!this.#window.isDestroyed())
          this.#window.webContents.send(
            channels.runEvent,
            eventDto(event, this.#storage.getRun(runId)?.conversationId ?? ""),
          );
      }
      await active.result;
    } catch {
      // The agent already publishes a durable run.failed event. Settling below
      // still lets the renderer replace optimistic state with stored messages.
    } finally {
      this.#activeRuns.delete(runId);
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
      editable: skill.source === "midas",
      instructions: skill.source === "midas" ? skillInstructions(readFileSync(skill.filePath, "utf8")) : undefined,
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
    if (!skill || skill.source !== "midas") throw new Error(`Skill is not removable: ${name}`);
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
    return generalSettingsPreference(
      this.#storage.getPreference("general-access")?.value,
    );
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
    this.#agent = new MidasAgent({
      inference: this.#inference,
      storage: this.#storage,
      memory: this.#memory,
      chronicle: this.#chronicle,
      environment: { promptContext: () => this.#environmentPromptContext() },
      tools: this.#registry,
      model: ref,
      skills: this.#agentSkillOptions,
    });
    if (persist)
      this.#storage.setPreference("model", {
        provider: ref.provider,
        id: ref.id,
      });
    return this.#modelDto(model);
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
          auth: {apiKey: credential?.key ?? "midas-local"},
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
      `${provider.name} is not configured. Add its API key in Options → Provider, or choose a configured model.`,
    );
  }

  /** Keep a stale model preference from making chat unusable after credentials
   * are removed or changed. The user's selection wins while it is usable;
   * otherwise the first configured provider becomes the active model. */
  async #ensureConfiguredAgent(): Promise<MidasAgent> {
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
      "No model provider is configured. Add an API key in Options → Provider, then choose a model.",
    );
  }

  #messageDto(message: StoredMessage) {
    return {
      ...message,
      attachments: this.#storage.listAttachments(message.id),
    };
  }

  #requireAgent(): MidasAgent {
    if (!this.#agent)
      throw new Error(
        "No inference model is configured. Set MIDAS_MODEL to provider/model.",
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
          : "midas",
      editable: config?.metadata?.source === "midas",
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
function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => required(item, `${label}[${index}]`));
}

function systemPermission(value: unknown): SystemPermissionKind;
function systemPermission(
  value: unknown,
  includeLocation: true,
): SystemPermissionKind | "location";
function systemPermission(
  value: unknown,
  includeLocation = false,
): SystemPermissionKind | "location" {
  if (
    value === "microphone" ||
    value === "screen-recording" ||
    (includeLocation && value === "location")
  ) return value;
  throw new Error("Unknown system permission");
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
  value = process.env.MIDAS_MODEL,
): ModelRef | undefined {
  if (!value) return undefined;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1)
    throw new Error("MIDAS_MODEL must use provider/model format");
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

function generalSettingsPreference(value: unknown): GeneralSettingsDto {
  const defaults: GeneralSettingsDto = {
    theme: "light",
    currency: null,
    speechModeEnabled: true,
    timeEnabled: true,
    locationEnabled: true,
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
    currency: supportedCurrency(record.currency),
    speechModeEnabled:
      typeof record.speechModeEnabled === "boolean"
        ? record.speechModeEnabled
        : defaults.speechModeEnabled,
    timeEnabled:
      typeof record.timeEnabled === "boolean"
        ? record.timeEnabled
        : defaults.timeEnabled,
    locationEnabled:
      typeof record.locationEnabled === "boolean"
        ? record.locationEnabled
        : defaults.locationEnabled,
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
  if (record.currency !== undefined && record.currency !== null && !supportedCurrency(record.currency))
    throw new Error("currency must be USD, AUD, EUR, GBP, SGD, or JPY");
  if (record.timeEnabled !== undefined && typeof record.timeEnabled !== "boolean")
    throw new Error("timeEnabled must be a boolean");
  if (
    record.speechModeEnabled !== undefined &&
    typeof record.speechModeEnabled !== "boolean"
  )
    throw new Error("speechModeEnabled must be a boolean");
  if (
    record.locationEnabled !== undefined &&
    typeof record.locationEnabled !== "boolean"
  )
    throw new Error("locationEnabled must be a boolean");
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
  return {
    theme:
      record.theme === "light" || record.theme === "dark" || record.theme === "system"
        ? record.theme
        : current.theme,
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
    timeEnabled:
      typeof record.timeEnabled === "boolean"
        ? record.timeEnabled
        : current.timeEnabled,
    locationEnabled,
    location: locationEnabled ? location : null,
  };
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
