import type { BrowserEventDto, McpChangeDto, MidasApi, RunEventDto } from "@midas/protocol";
import { channels } from "@midas/protocol";
import { contextBridge, ipcRenderer, webUtils } from "electron";

const api: MidasApi = {
  general: {
    get: () => ipcRenderer.invoke(channels.generalGet),
    update: (settings) => ipcRenderer.invoke(channels.generalUpdate, settings),
    locate: () => ipcRenderer.invoke(channels.generalLocate),
  },
  permissions: {
    ensureFirstRun: () => ipcRenderer.invoke(channels.permissionsEnsureFirstRun),
    status: (permission) =>
      ipcRenderer.invoke(channels.permissionsStatus, permission),
    request: (permission) =>
      ipcRenderer.invoke(channels.permissionsRequest, permission),
    openSettings: (permission) =>
      ipcRenderer.invoke(channels.permissionsOpenSettings, permission),
  },
  dictation: {
    transcribe: (audio) => ipcRenderer.invoke(channels.dictationTranscribe, audio),
  },
  conversations: {
    list: () => ipcRenderer.invoke(channels.conversationsList),
    create: (title) => ipcRenderer.invoke(channels.conversationsCreate, title),
    rename: (id, title) =>
      ipcRenderer.invoke(channels.conversationsRename, id, title),
    remove: (id) => ipcRenderer.invoke(channels.conversationsRemove, id),
    messages: (id) => ipcRenderer.invoke(channels.messagesList, id),
    updateMessage: (id, patch) =>
      ipcRenderer.invoke(channels.messagesUpdate, id, patch),
  },
  runs: {
    start: (request) => ipcRenderer.invoke(channels.runsStart, request),
    cancel: (runId) => ipcRenderer.invoke(channels.runsCancel, runId),
    steer: (runId, text, messageId) =>
      ipcRenderer.invoke(channels.runsSteer, runId, text, messageId),
    events: (runId, afterSequence) =>
      ipcRenderer.invoke(channels.runEventsList, runId, afterSequence),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: RunEventDto) =>
        listener(value);
      ipcRenderer.on(channels.runEvent, receive);
      return () => ipcRenderer.removeListener(channels.runEvent, receive);
    },
  },
  goals: {
    execute: (request) => ipcRenderer.invoke(channels.goalsExecute, request),
    get: (conversationId) =>
      ipcRenderer.invoke(channels.goalsGet, conversationId),
  },
  files: {
    paths: async (files) => files.map((file) => webUtils.getPathForFile(file)),
  },
  resources: {
    artifacts: (conversationId) =>
      ipcRenderer.invoke(channels.artifactsList, conversationId),
    references: (conversationId) =>
      ipcRenderer.invoke(channels.referencesList, conversationId),
    addFiles: (conversationId, files) => ipcRenderer.invoke(
      channels.referencesAddFiles,
      conversationId,
      files.map((file) => ({
        name: file.name,
        path: webUtils.getPathForFile(file),
        mimeType: file.type || null,
        size: file.size,
      })),
    ),
  },
  memory: {
    status: () => ipcRenderer.invoke(channels.memoryStatus),
    setEnabled: (enabled) => ipcRenderer.invoke(channels.memorySetEnabled, enabled),
    list: (conversationId) =>
      ipcRenderer.invoke(channels.memoryList, conversationId),
    remember: (content, conversationId) =>
      ipcRenderer.invoke(channels.memoryRemember, content, conversationId),
    forget: (id) => ipcRenderer.invoke(channels.memoryForget, id),
  },
  chronicle: {
    status: () => ipcRenderer.invoke(channels.chronicleStatus),
    setEnabled: (enabled) =>
      ipcRenderer.invoke(channels.chronicleSetEnabled, enabled),
    entries: (options) =>
      ipcRenderer.invoke(channels.chronicleEntries, options),
  },
  mcp: {
    list: () => ipcRenderer.invoke(channels.mcpList),
    reload: () => ipcRenderer.invoke(channels.mcpReload),
    setEnabled: (id, enabled) => ipcRenderer.invoke(channels.mcpSetEnabled, id, enabled),
    saveCustom: (request) => ipcRenderer.invoke(channels.mcpSaveCustom, request),
    removeCustom: (id) => ipcRenderer.invoke(channels.mcpRemoveCustom, id),
    searchRegistry: (query) => ipcRenderer.invoke(channels.mcpSearchRegistry, query),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: McpChangeDto) =>
        listener(value);
      ipcRenderer.on(channels.mcpChanged, receive);
      return () => ipcRenderer.removeListener(channels.mcpChanged, receive);
    },
  },
  skills: {
    list: () => ipcRenderer.invoke(channels.skillsList),
    reload: () => ipcRenderer.invoke(channels.skillsReload),
    setEnabled: (name, enabled) => ipcRenderer.invoke(channels.skillsSetEnabled, name, enabled),
    saveCustom: (request) => ipcRenderer.invoke(channels.skillsSaveCustom, request),
    removeCustom: (name) => ipcRenderer.invoke(channels.skillsRemoveCustom, name),
    upload: (files) => ipcRenderer.invoke(channels.skillsUpload, files.map((file) => ({
      path: webUtils.getPathForFile(file),
      relativePath: file.webkitRelativePath,
    }))),
    install: (spec) => ipcRenderer.invoke(channels.skillsInstall, spec),
    searchRegistry: (query) => ipcRenderer.invoke(channels.skillsSearchRegistry, query),
  },
  models: {
    list: () => ipcRenderer.invoke(channels.modelsList),
    select: (provider, id) =>
      ipcRenderer.invoke(channels.modelsSelect, provider, id),
    metadata: () => ipcRenderer.invoke(channels.modelsMetadata),
  },
  browser: {
    embedded: true,
    open: (tabId, url) => ipcRenderer.invoke(channels.browserOpen, tabId, url),
    navigate: (tabId, url) => ipcRenderer.invoke(channels.browserNavigate, tabId, url),
    history: (tabId, delta) => ipcRenderer.invoke(channels.browserHistory, tabId, delta),
    reload: (tabId) => ipcRenderer.invoke(channels.browserReload, tabId),
    setBounds: (tabId, bounds) => ipcRenderer.invoke(channels.browserSetBounds, tabId, bounds),
    setVisible: (tabId, visible) => ipcRenderer.invoke(channels.browserSetVisible, tabId, visible),
    close: (tabId) => ipcRenderer.invoke(channels.browserClose, tabId),
    openExternal: (url) => ipcRenderer.invoke(channels.browserOpenExternal, url),
    find: (tabId, text, forward) => ipcRenderer.invoke(channels.browserFind, tabId, text, forward),
    stopFind: (tabId) => ipcRenderer.invoke(channels.browserStopFind, tabId),
    print: (tabId) => ipcRenderer.invoke(channels.browserPrint, tabId),
    screenshot: (tabId) => ipcRenderer.invoke(channels.browserScreenshot, tabId),
    downloads: () => ipcRenderer.invoke(channels.browserDownloadsList),
    openDownload: (id) => ipcRenderer.invoke(channels.browserOpenDownload, id),
    openDownloadsFolder: () => ipcRenderer.invoke(channels.browserOpenDownloadsFolder),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: BrowserEventDto) =>
        listener(value);
      ipcRenderer.on(channels.browserEvent, receive);
      return () => ipcRenderer.removeListener(channels.browserEvent, receive);
    },
  },
  providers: {
    list: () => ipcRenderer.invoke(channels.providersList),
    saveApiKey: (provider, apiKey) =>
      ipcRenderer.invoke(channels.providersSaveApiKey, provider, apiKey),
    removeApiKey: (provider, keyId) =>
      ipcRenderer.invoke(channels.providersRemoveApiKey, provider, keyId),
    createCustom: (request) =>
      ipcRenderer.invoke(channels.providersCreateCustom, request),
    updateCustom: (request) =>
      ipcRenderer.invoke(channels.providersUpdateCustom, request),
  },
};

contextBridge.exposeInMainWorld("midas", api);
