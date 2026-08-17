import type { BrowserEventDto, ChatActivityDto, CommsStatusDto, DriveStatusDto, McpChangeDto, FlareAIApi, RunEventDto, ScheduleDto } from "@flareai/protocol";
import { channels } from "@flareai/protocol";
import { contextBridge, ipcRenderer, webUtils } from "electron";

const api: FlareAIApi = {
  extension: {
    status: () => ipcRenderer.invoke(channels.extensionStatus),
    dismiss: () => ipcRenderer.invoke(channels.extensionDismiss),
    openInstall: () => ipcRenderer.invoke(channels.extensionOpenInstall),
  },
  general: {
    get: () => ipcRenderer.invoke(channels.generalGet),
    update: (settings) => ipcRenderer.invoke(channels.generalUpdate, settings),
    locate: () => ipcRenderer.invoke(channels.generalLocate),
    version: () => ipcRenderer.invoke(channels.generalVersion),
    checkForUpdates: () => ipcRenderer.invoke(channels.generalCheckUpdates),
    installUpdate: () => ipcRenderer.invoke(channels.generalInstallUpdate),
  },
  window: {
    subscribeFullscreen(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: boolean) =>
        listener(value);
      ipcRenderer.on(channels.windowFullscreen, receive);
      return () =>
        ipcRenderer.removeListener(channels.windowFullscreen, receive);
    },
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
    prepare: () => ipcRenderer.invoke(channels.dictationPrepare),
    transcribe: (audio, final) =>
      ipcRenderer.invoke(channels.dictationTranscribe, audio, final),
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
  schedules: {
    list: () => ipcRenderer.invoke(channels.schedulesList),
    create: (input) => ipcRenderer.invoke(channels.schedulesCreate, input),
    update: (id, patch) => ipcRenderer.invoke(channels.schedulesUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(channels.schedulesRemove, id),
    runNow: (id) => ipcRenderer.invoke(channels.schedulesRunNow, id),
    markRead: (id) => ipcRenderer.invoke(channels.schedulesMarkRead, id),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, items: ScheduleDto[]) =>
        listener(items);
      ipcRenderer.on(channels.schedulesChanged, receive);
      return () => ipcRenderer.removeListener(channels.schedulesChanged, receive);
    },
  },
  goals: {
    execute: (request) => ipcRenderer.invoke(channels.goalsExecute, request),
    get: (conversationId) =>
      ipcRenderer.invoke(channels.goalsGet, conversationId),
  },
  workspace: {
    snapshot: (conversationId) =>
      ipcRenderer.invoke(channels.workspaceSnapshotGet, conversationId),
    saveSnapshot: (conversationId, snapshot) =>
      ipcRenderer.invoke(channels.workspaceSnapshotSave, conversationId, snapshot),
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
  comms: {
    status: () => ipcRenderer.invoke(channels.commsStatus),
    refresh: () => ipcRenderer.invoke(channels.commsRefresh),
    wake: (platform) => ipcRenderer.invoke(channels.commsWake, platform),
    setHubUrl: (baseUrl) => ipcRenderer.invoke(channels.commsSetHubUrl, baseUrl),
    connect: () => ipcRenderer.invoke(channels.commsConnect),
    signIn: (userId, password) => ipcRenderer.invoke(channels.commsSignIn, userId, password),
    signOut: () => ipcRenderer.invoke(channels.commsSignOut),
    loginStart: (platform, flowId) =>
      ipcRenderer.invoke(channels.commsLoginStart, platform, flowId),
    loginSubmit: (platform, loginId, stepId, values) =>
      ipcRenderer.invoke(channels.commsLoginSubmit, platform, loginId, stepId, values),
    loginWait: (platform, loginId, stepId) =>
      ipcRenderer.invoke(channels.commsLoginWait, platform, loginId, stepId),
    loginCookies: (platform, loginId, stepId) =>
      ipcRenderer.invoke(channels.commsLoginCookies, platform, loginId, stepId),
    loginCancel: (platform, loginId) =>
      ipcRenderer.invoke(channels.commsLoginCancel, platform, loginId),
    bridgeLogout: (platform, accountId) =>
      ipcRenderer.invoke(channels.commsBridgeLogout, platform, accountId),
    bridgeSetup: (platform, values) =>
      ipcRenderer.invoke(channels.commsBridgeSetup, platform, values),
    chats: () => ipcRenderer.invoke(channels.commsChats),
    chatMessages: (chatId, limit, before) =>
      ipcRenderer.invoke(channels.commsChatMessages, chatId, limit, before),
    chatSend: (chatId, text, replyTo) =>
      ipcRenderer.invoke(channels.commsChatSend, chatId, text, replyTo),
    chatSendFiles: (chatId, paths) =>
      ipcRenderer.invoke(channels.commsChatSendFiles, chatId, paths),
    chatPickFiles: () => ipcRenderer.invoke(channels.commsChatPickFiles),
    chatSendAudio: (chatId, bytes, mimetype) =>
      ipcRenderer.invoke(channels.commsChatSendAudio, chatId, bytes, mimetype),
    chatReact: (chatId, messageId, key) =>
      ipcRenderer.invoke(channels.commsChatReact, chatId, messageId, key),
    chatUnreact: (chatId, reactionId) =>
      ipcRenderer.invoke(channels.commsChatUnreact, chatId, reactionId),
    chatMarkRead: (chatId, messageId) =>
      ipcRenderer.invoke(channels.commsChatMarkRead, chatId, messageId),
    mailFolders: (account) => ipcRenderer.invoke(channels.commsMailFolders, account),
    mailEnvelopes: (request) => ipcRenderer.invoke(channels.commsMailEnvelopes, request),
    mailMessage: (id, account, folder) =>
      ipcRenderer.invoke(channels.commsMailMessage, id, account, folder),
    mailSend: (request) => ipcRenderer.invoke(channels.commsMailSend, request),
    mailMove: (ids, target, account, folder) =>
      ipcRenderer.invoke(channels.commsMailMove, ids, target, account, folder),
    mailFlag: (ids, flag, on, account, folder) =>
      ipcRenderer.invoke(channels.commsMailFlag, ids, flag, on, account, folder),
    mailDelete: (ids, account, folder) =>
      ipcRenderer.invoke(channels.commsMailDelete, ids, account, folder),
    mailDownload: (id, account, folder) =>
      ipcRenderer.invoke(channels.commsMailDownload, id, account, folder),
    mailOpenFile: (path) => ipcRenderer.invoke(channels.commsMailOpenFile, path),
    mailPickFiles: () => ipcRenderer.invoke(channels.commsMailPickFiles),
    emailSave: (request) => ipcRenderer.invoke(channels.commsEmailSave, request),
    emailRemove: (id) => ipcRenderer.invoke(channels.commsEmailRemove, id),
    emailTest: (id) => ipcRenderer.invoke(channels.commsEmailTest, id),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: CommsStatusDto) =>
        listener(value);
      ipcRenderer.on(channels.commsChanged, receive);
      return () => ipcRenderer.removeListener(channels.commsChanged, receive);
    },
    subscribeActivity(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: ChatActivityDto) =>
        listener(value);
      ipcRenderer.on(channels.commsActivity, receive);
      return () => ipcRenderer.removeListener(channels.commsActivity, receive);
    },
  },
  drive: {
    status: () => ipcRenderer.invoke(channels.driveStatus),
    refresh: () => ipcRenderer.invoke(channels.driveRefresh),
    connect: (provider) => ipcRenderer.invoke(channels.driveConnect, provider),
    disconnect: (provider, accountId) =>
      ipcRenderer.invoke(channels.driveDisconnect, provider, accountId),
    setSaveOrder: (order) => ipcRenderer.invoke(channels.driveSetSaveOrder, order),
    setLocalRoot: (path) => ipcRenderer.invoke(channels.driveSetLocalRoot, path),
    saveS3: (config) => ipcRenderer.invoke(channels.driveSaveS3, config),
    conversationFolder: (conversationId) =>
      ipcRenderer.invoke(channels.driveConversationFolder, conversationId),
    list: (source, path) => ipcRenderer.invoke(channels.driveList, source, path),
    createFolder: (source, parentPath, name) =>
      ipcRenderer.invoke(channels.driveCreateFolder, source, parentPath, name),
    upload: (source, parentPath, paths) =>
      ipcRenderer.invoke(channels.driveUpload, source, parentPath, paths),
    download: (source, path) =>
      ipcRenderer.invoke(channels.driveDownload, source, path),
    remove: (source, paths) => ipcRenderer.invoke(channels.driveRemove, source, paths),
    rename: (source, path, name) =>
      ipcRenderer.invoke(channels.driveRename, source, path, name),
    move: (source, paths, destinationFolder) =>
      ipcRenderer.invoke(channels.driveMove, source, paths, destinationFolder),
    copy: (source, paths) => ipcRenderer.invoke(channels.driveCopy, source, paths),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: DriveStatusDto) =>
        listener(value);
      ipcRenderer.on(channels.driveChanged, receive);
      return () => ipcRenderer.removeListener(channels.driveChanged, receive);
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
    discover: () => ipcRenderer.invoke(channels.skillsDiscover),
    adopt: (path) => ipcRenderer.invoke(channels.skillsAdopt, path),
  },
  models: {
    list: () => ipcRenderer.invoke(channels.modelsList),
    select: (provider, id) =>
      ipcRenderer.invoke(channels.modelsSelect, provider, id),
    metadata: () => ipcRenderer.invoke(channels.modelsMetadata),
    roles: () => ipcRenderer.invoke(channels.modelsRoles),
    assignRole: (role, provider, id) =>
      ipcRenderer.invoke(channels.modelsAssignRole, role, provider, id),
    clearRole: (role) => ipcRenderer.invoke(channels.modelsClearRole, role),
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
    openPath: (filePath) => ipcRenderer.invoke(channels.browserOpenPath, filePath),
    find: (tabId, text, forward) => ipcRenderer.invoke(channels.browserFind, tabId, text, forward),
    stopFind: (tabId) => ipcRenderer.invoke(channels.browserStopFind, tabId),
    print: (tabId) => ipcRenderer.invoke(channels.browserPrint, tabId),
    screenshot: (tabId) => ipcRenderer.invoke(channels.browserScreenshot, tabId),
    favicon: (url) => ipcRenderer.invoke(channels.browserFavicon, url),
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
    discoverModels: (request) =>
      ipcRenderer.invoke(channels.providersDiscoverModels, request),
    setupLocalRuntime: (request) =>
      ipcRenderer.invoke(channels.providersSetupLocalRuntime, request),
  },
};

contextBridge.exposeInMainWorld("flareai", api);
