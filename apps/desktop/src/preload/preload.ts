import type { BrowserEventDto, ChatActivityDto, CommsStatusDto, DriveStatusDto, McpChangeDto, PolymuxApi, ProviderOAuthEventDto, RunEventDto, ScheduleDto, SkillDto, WorkspaceRevealDto } from "@polymux/protocol";
import { channels } from "@polymux/protocol";
import { contextBridge, ipcRenderer, webUtils } from "electron";

const api: PolymuxApi = {
  mobile: {
    status: () => ipcRenderer.invoke(channels.mobileStatus),
    connect: () => ipcRenderer.invoke(channels.mobileConnect),
    pairAndroid: (pairingAddress, pairingCode, connectAddress) =>
      ipcRenderer.invoke(channels.mobilePairAndroid, pairingAddress, pairingCode, connectAddress),
    iosSigningStatus: () => ipcRenderer.invoke(channels.mobileIosSigningStatus),
    iosSigningBegin: (email, password) =>
      ipcRenderer.invoke(channels.mobileIosSigningBegin, email, password),
    iosSigningComplete: (code) => ipcRenderer.invoke(channels.mobileIosSigningComplete, code),
    iosSigningLogout: () => ipcRenderer.invoke(channels.mobileIosSigningLogout),
    stop: () => ipcRenderer.invoke(channels.mobileStop),
    frame: () => ipcRenderer.invoke(channels.mobileFrame),
    tap: (point) => ipcRenderer.invoke(channels.mobileTap, point),
    swipe: (from, to, durationMs) =>
      ipcRenderer.invoke(channels.mobileSwipe, from, to, durationMs),
    type: (value) => ipcRenderer.invoke(channels.mobileType, value),
    home: () => ipcRenderer.invoke(channels.mobileHome),
  },
  terminal: {
    create: (cwd) => ipcRenderer.invoke(channels.terminalCreate, cwd),
    attach: (id, cols, rows) => ipcRenderer.invoke(channels.terminalAttach, id, cols, rows),
    write: (id, data) => ipcRenderer.invoke(channels.terminalWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke(channels.terminalResize, id, cols, rows),
    close: (id) => ipcRenderer.invoke(channels.terminalClose, id),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: import("@polymux/protocol").TerminalEventDto) =>
        listener(value);
      ipcRenderer.on(channels.terminalEvent, receive);
      return () => ipcRenderer.removeListener(channels.terminalEvent, receive);
    },
  },
  ide: {
    pickFolder: () => ipcRenderer.invoke(channels.idePickFolder),
    list: (root, path) => ipcRenderer.invoke(channels.ideList, root, path),
    read: (root, path) => ipcRenderer.invoke(channels.ideRead, root, path),
    write: (root, path, content) => ipcRenderer.invoke(channels.ideWrite, root, path, content),
    create: (root, path, content) => ipcRenderer.invoke(channels.ideCreate, root, path, content),
    move: (root, from, to) => ipcRenderer.invoke(channels.ideMove, root, from, to),
  },
  agentRuntime: {
    get: () => ipcRenderer.invoke(channels.agentRuntimeGet),
    registry: () => ipcRenderer.invoke(channels.agentRuntimeRegistry),
    inspectConfiguration: (request, sourceDirectory) =>
      ipcRenderer.invoke(channels.agentRuntimeInspectConfiguration, request, sourceDirectory),
    update: (request) => ipcRenderer.invoke(channels.agentRuntimeUpdate, request),
    settings: () => ipcRenderer.invoke(channels.agentRuntimeSettings),
    authenticate: (methodId) => ipcRenderer.invoke(channels.agentRuntimeAuthenticate, methodId),
    logout: () => ipcRenderer.invoke(channels.agentRuntimeLogout),
    setConfigOption: (id, value) => ipcRenderer.invoke(channels.agentRuntimeSetConfigOption, id, value),
    setProvider: (request) => ipcRenderer.invoke(channels.agentRuntimeSetProvider, request),
    disableProvider: (id) => ipcRenderer.invoke(channels.agentRuntimeDisableProvider, id),
  },
  profiles: {
    list: () => ipcRenderer.invoke(channels.profilesList),
    create: (name) => ipcRenderer.invoke(channels.profilesCreate, name),
    select: (id) => ipcRenderer.invoke(channels.profilesSelect, id),
    rename: (id, name) => ipcRenderer.invoke(channels.profilesRename, id, name),
    setDefault: (id) => ipcRenderer.invoke(channels.profilesSetDefault, id),
    duplicate: (id) => ipcRenderer.invoke(channels.profilesDuplicate, id),
    remove: (id) => ipcRenderer.invoke(channels.profilesRemove, id),
    connectExternal: (request) => ipcRenderer.invoke(channels.profilesConnectExternal, request),
    openFolder: (id, target) => ipcRenderer.invoke(channels.profilesOpenFolder, id, target),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
      ipcRenderer.on(channels.profilesChanged, receive);
      return () => ipcRenderer.removeListener(channels.profilesChanged, receive);
    },
  },
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
    testNotification: () => ipcRenderer.invoke(channels.generalTestNotification),
  },
  clipboard: {
    write: (content) => ipcRenderer.invoke(channels.clipboardWrite, content),
  },
  vault: {
    status: () => ipcRenderer.invoke(channels.vaultStatus),
    create: (password) => ipcRenderer.invoke(channels.vaultCreate, password),
    unlock: (password) => ipcRenderer.invoke(channels.vaultUnlock, password),
    unlockBiometric: () => ipcRenderer.invoke(channels.vaultUnlockBiometric),
    biometricStatus: () => ipcRenderer.invoke(channels.vaultBiometricStatus),
    enrollBiometric: (password) => ipcRenderer.invoke(channels.vaultBiometricEnroll, password),
    disenrollBiometric: () => ipcRenderer.invoke(channels.vaultBiometricDisenroll),
    lock: () => ipcRenderer.invoke(channels.vaultLock),
    touch: () => ipcRenderer.invoke(channels.vaultTouch),
    list: () => ipcRenderer.invoke(channels.vaultList),
    reveal: (id) => ipcRenderer.invoke(channels.vaultReveal, id),
    totp: (id) => ipcRenderer.invoke(channels.vaultTotp, id),
    codes: () => ipcRenderer.invoke(channels.vaultCodes),
    otpauth: (id) => ipcRenderer.invoke(channels.vaultOtpauth, id),
    save: (item) => ipcRenderer.invoke(channels.vaultSave, item),
    remove: (id) => ipcRenderer.invoke(channels.vaultRemove, id),
    restore: (ids) => ipcRenderer.invoke(channels.vaultRestore, ids),
    purge: (ids) => ipcRenderer.invoke(channels.vaultPurge, ids),
    emptyTrash: () => ipcRenderer.invoke(channels.vaultEmptyTrash),
    pin: (ids, pinned) => ipcRenderer.invoke(channels.vaultPin, ids, pinned),
    reorder: (ids) => ipcRenderer.invoke(channels.vaultReorder, ids),
    changePassword: (current, next) => ipcRenderer.invoke(channels.vaultChangePassword, current, next),
    copy: (id, field, recoveryIndex) =>
      ipcRenderer.invoke(channels.vaultCopy, id, field, recoveryIndex),
    importBegin: () => ipcRenderer.invoke(channels.vaultImportBegin),
    importConfirm: (password) => ipcRenderer.invoke(channels.vaultImportConfirm, password),
    sync: () => ipcRenderer.invoke(channels.vaultSync),
    setStorage: (mode, resolve) => ipcRenderer.invoke(channels.vaultSetStorage, mode, resolve),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: import("@polymux/protocol").VaultStatusDto) =>
        listener(value);
      ipcRenderer.on(channels.vaultChanged, receive);
      return () => ipcRenderer.removeListener(channels.vaultChanged, receive);
    },
  },
  finance: {
    read: (request) => ipcRenderer.invoke(channels.financeRead, request),
  },
  usage: {
    get: (filter) => ipcRenderer.invoke(channels.usageGet, filter ?? {}),
  },
  window: {
    openWorkspaceView: (kind, conversationId, placement) =>
      ipcRenderer.invoke(channels.windowOpenWorkspaceView, kind, conversationId, placement),
    subscribeNotificationTarget(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) =>
        listener(value);
      ipcRenderer.on(channels.windowOpenNotificationTarget, receive);
      return () =>
        ipcRenderer.removeListener(channels.windowOpenNotificationTarget, receive);
    },
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
    listArchived: () => ipcRenderer.invoke(channels.conversationsListArchived),
    create: (title) => ipcRenderer.invoke(channels.conversationsCreate, title),
    duplicate: (id, throughMessageId) => ipcRenderer.invoke(channels.conversationsDuplicate, id, throughMessageId),
    rename: (id, title) =>
      ipcRenderer.invoke(channels.conversationsRename, id, title),
    archive: (id) => ipcRenderer.invoke(channels.conversationsArchive, id),
    unarchive: (id) => ipcRenderer.invoke(channels.conversationsUnarchive, id),
    remove: (id) => ipcRenderer.invoke(channels.conversationsRemove, id),
    messages: (id) => ipcRenderer.invoke(channels.messagesList, id),
    updateMessage: (id, patch) =>
      ipcRenderer.invoke(channels.messagesUpdate, id, patch),
  },
  devices: {request: (value) => ipcRenderer.invoke(channels.devicePairing, value)},
  account: {
    get: () => ipcRenderer.invoke(channels.accountGet),
    signInWithPassword: (email, password) => ipcRenderer.invoke(channels.accountSignInWithPassword, email, password),
    signUp: (email, password) => ipcRenderer.invoke(channels.accountSignUp, email, password),
    resendConfirmation: (email) => ipcRenderer.invoke(channels.accountResendConfirmation, email),
    requestPasswordReset: (email) => ipcRenderer.invoke(channels.accountRequestPasswordReset, email),
    updatePassword: (password) => ipcRenderer.invoke(channels.accountUpdatePassword, password),
    signInWithOAuth: (provider) => ipcRenderer.invoke(channels.accountSignInWithOAuth, provider),
    switchTo: (userId) => ipcRenderer.invoke(channels.accountSwitch, userId),
    signOut: () => ipcRenderer.invoke(channels.accountSignOut),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: import("@polymux/protocol").AccountStatusDto) => listener(value);
      ipcRenderer.on(channels.accountChanged, receive);
      return () => { ipcRenderer.removeListener(channels.accountChanged, receive); };
    },
  },
  team: {
    list: () => ipcRenderer.invoke(channels.teamList),
    groups: () => ipcRenderer.invoke(channels.teamGroupsList),
    createGroup: (request) => ipcRenderer.invoke(channels.teamGroupCreate, request),
    updateGroup: (id, request) => ipcRenderer.invoke(channels.teamGroupUpdate, id, request),
    markGroupRead: (id) => ipcRenderer.invoke(channels.teamGroupMarkRead, id),
    removeGroup: (id) => ipcRenderer.invoke(channels.teamGroupRemove, id),
    sendGroup: (request) => ipcRenderer.invoke(channels.teamGroupSend, request),
    profiles: (hostId) => ipcRenderer.invoke(channels.teamProfiles, hostId),
    agentRegistry: (hostId) => ipcRenderer.invoke(channels.teamAgentRegistry, hostId),
    agentSettings: (id, request) => ipcRenderer.invoke(channels.teamAgentSettings, id, request),
    create: (request) => ipcRenderer.invoke(channels.teamCreate, request),
    update: (id, request) => ipcRenderer.invoke(channels.teamUpdate, id, request),
    markRead: (id) => ipcRenderer.invoke(channels.teamMarkRead, id),
    remove: (id) => ipcRenderer.invoke(channels.teamRemove, id),
    retrySetup: (id) => ipcRenderer.invoke(channels.teamRetrySetup, id),
    send: (request) => ipcRenderer.invoke(channels.teamSend, request),
    startComputer: (id) => ipcRenderer.invoke(channels.teamComputerStart, id),
    stopComputer: (id) => ipcRenderer.invoke(channels.teamComputerStop, id),
    leases: (id) => ipcRenderer.invoke(channels.teamLeases, id),
    grantLease: (id, capabilities, minutes) =>
      ipcRenderer.invoke(channels.teamLeaseGrant, id, capabilities, minutes),
    revokeLease: (id) => ipcRenderer.invoke(channels.teamLeaseRevoke, id),
    host: () => ipcRenderer.invoke(channels.teamHostGet),
    hosts: () => ipcRenderer.invoke(channels.teamHostsList),
    beginHostPairing: (preserveFailures?: boolean) => ipcRenderer.invoke(channels.teamHostBeginPairing, preserveFailures),
    pairHost: (request) => ipcRenderer.invoke(channels.teamHostPair, request),
    useLocalHost: () => ipcRenderer.invoke(channels.teamHostLocal),
    setDefaultHost: (hostId) => ipcRenderer.invoke(channels.teamHostDefault, hostId),
    removeHost: (hostId) => ipcRenderer.invoke(channels.teamHostRemove, hostId),
    resetHostPairing: () => ipcRenderer.invoke(channels.teamHostResetPairing),
    subscribeHost(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: import("@polymux/protocol").TeamHostDto) => listener(value);
      ipcRenderer.on(channels.teamHostChanged, receive);
      return () => ipcRenderer.removeListener(channels.teamHostChanged, receive);
    },
    subscribeHosts(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: import("@polymux/protocol").TeamHostDto[]) => listener(value);
      ipcRenderer.on(channels.teamHostsChanged, receive);
      return () => ipcRenderer.removeListener(channels.teamHostsChanged, receive);
    },
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: import("@polymux/protocol").BotDto[]) => listener(value);
      ipcRenderer.on(channels.teamChanged, receive);
      return () => ipcRenderer.removeListener(channels.teamChanged, receive);
    },
    subscribeGroups(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: import("@polymux/protocol").TeamGroupDto[]) => listener(value);
      ipcRenderer.on(channels.teamGroupsChanged, receive);
      return () => ipcRenderer.removeListener(channels.teamGroupsChanged, receive);
    },
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
  activity: {
    preview: (request) => ipcRenderer.invoke(channels.activityPreview, request),
  },
  manager: {
    snapshot: () => ipcRenderer.invoke(channels.managerSnapshot),
    enqueue: (request) => ipcRenderer.invoke(channels.managerEnqueue, request),
    cancel: (id) => ipcRenderer.invoke(channels.managerCancel, id),
    reprioritize: (id, priority) => ipcRenderer.invoke(channels.managerReprioritize, id, priority),
    reorder: (id, targetId) => ipcRenderer.invoke(channels.managerReorder, id, targetId),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: import("@polymux/protocol").ManagerSnapshotDto) => listener(value);
      ipcRenderer.on(channels.managerChanged, receive);
      return () => ipcRenderer.removeListener(channels.managerChanged, receive);
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
  calendar: {
    snapshot: (start, end) =>
      ipcRenderer.invoke(channels.calendarSnapshot, start, end),
    calendars: () => ipcRenderer.invoke(channels.calendarCalendars),
    events: (start, end, calendarIds) =>
      ipcRenderer.invoke(channels.calendarEvents, start, end, calendarIds),
    create: (input) => ipcRenderer.invoke(channels.calendarCreate, input),
    update: (id, patch) => ipcRenderer.invoke(channels.calendarUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(channels.calendarRemove, id),
    importFile: (calendarId) => ipcRenderer.invoke(channels.calendarImport, calendarId),
    exportFile: (request) => ipcRenderer.invoke(channels.calendarExport, request),
    openAccounts: () => ipcRenderer.invoke(channels.calendarOpenAccounts),
    subscribe(listener) {
      const receive = () => listener();
      ipcRenderer.on(channels.calendarChanged, receive);
      return () => ipcRenderer.removeListener(channels.calendarChanged, receive);
    },
  },
  tasks: {
    list: (chatId) => ipcRenderer.invoke(channels.tasksList, chatId),
    create: (input) => ipcRenderer.invoke(channels.tasksCreate, input),
    update: (id, patch) => ipcRenderer.invoke(channels.tasksUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(channels.tasksRemove, id),
    markRead: (id) => ipcRenderer.invoke(channels.tasksMarkRead, id),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, items: import("@polymux/protocol").TaskCardDto[]) =>
        listener(items);
      ipcRenderer.on(channels.tasksChanged, receive);
      return () => ipcRenderer.removeListener(channels.tasksChanged, receive);
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
    preview: (path) => ipcRenderer.invoke(channels.workspacePreview, path),
    saveAs: (url) => ipcRenderer.invoke(channels.workspaceSaveAs, url),
    pick: () => ipcRenderer.invoke(channels.workspacePick),
    subscribeReveal(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: WorkspaceRevealDto) =>
        listener(value);
      ipcRenderer.on(channels.workspaceReveal, receive);
      return () => ipcRenderer.removeListener(channels.workspaceReveal, receive);
    },
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
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, conversationId: string) =>
        listener(conversationId);
      ipcRenderer.on(channels.resourcesChanged, receive);
      return () => ipcRenderer.removeListener(channels.resourcesChanged, receive);
    },
  },
  memory: {
    status: () => ipcRenderer.invoke(channels.memoryStatus),
    setEnabled: (enabled) => ipcRenderer.invoke(channels.memorySetEnabled, enabled),
    entries: () => ipcRenderer.invoke(channels.memoryEntries),
  },
  computerHistory: {
    status: () => ipcRenderer.invoke(channels.computerHistoryStatus),
    update: (patch: unknown) => ipcRenderer.invoke(channels.computerHistoryUpdate, patch),
    forget: (since: string, until: string) =>
      ipcRenderer.invoke(channels.computerHistoryForget, since, until),
    removeEntry: (id: string) => ipcRenderer.invoke(channels.computerHistoryRemoveEntry, id),
    revealEntry: (id: string) => ipcRenderer.invoke(channels.computerHistoryRevealEntry, id),
    setEnabled: (enabled) =>
      ipcRenderer.invoke(channels.computerHistorySetEnabled, enabled),
    entries: (options) =>
      ipcRenderer.invoke(channels.computerHistoryEntries, options),
    activities: (options) =>
      ipcRenderer.invoke(channels.computerHistoryActivities, options),
    pickApp: () => ipcRenderer.invoke(channels.computerHistoryPickApp),
    appIcon: (name: string) => ipcRenderer.invoke(channels.computerHistoryAppIcon, name),
  },
  mcp: {
    list: () => ipcRenderer.invoke(channels.mcpList),
    reload: () => ipcRenderer.invoke(channels.mcpReload),
    setEnabled: (id, enabled) => ipcRenderer.invoke(channels.mcpSetEnabled, id, enabled),
    saveCustom: (request) => ipcRenderer.invoke(channels.mcpSaveCustom, request),
    removeCustom: (id) => ipcRenderer.invoke(channels.mcpRemoveCustom, id),
    searchRegistry: (query, cursor) => ipcRenderer.invoke(channels.mcpSearchRegistry, query, cursor ?? ""),
    discover: () => ipcRenderer.invoke(channels.mcpDiscover),
    adopt: (groupId, serverId) => ipcRenderer.invoke(channels.mcpAdopt, groupId, serverId),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: McpChangeDto) =>
        listener(value);
      ipcRenderer.on(channels.mcpChanged, receive);
      return () => ipcRenderer.removeListener(channels.mcpChanged, receive);
    },
  },
  comms: {
    status: () => ipcRenderer.invoke(channels.commsStatus),
    snapshot: () => ipcRenderer.invoke(channels.commsSnapshot),
    refresh: () => ipcRenderer.invoke(channels.commsRefresh),
    wake: (platform) => ipcRenderer.invoke(channels.commsWake, platform),
    weChatLogin: () => ipcRenderer.invoke(channels.commsWeChatLogin),
    weChatOpen: () => ipcRenderer.invoke(channels.commsWeChatOpen),
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
    chatContacts: () => ipcRenderer.invoke(channels.commsChatContacts),
    chatMembers: (chatId) => ipcRenderer.invoke(channels.commsChatMembers, chatId),
    chatGroupInfo: (chatId) => ipcRenderer.invoke(channels.commsChatGroupInfo, chatId),
    chatRenameGroup: (chatId, name, expectedName) => ipcRenderer.invoke(channels.commsChatRenameGroup, chatId, name, expectedName),
    contactLinks: () => ipcRenderer.invoke(channels.commsContactLinks),
    contactLinkMerge: (request) => ipcRenderer.invoke(channels.commsContactLinkMerge, request),
    contactRename: (request) => ipcRenderer.invoke(channels.commsContactRename, request),
    contactLinkRemove: (id) => ipcRenderer.invoke(channels.commsContactLinkRemove, id),
    chatCreate: (request) => ipcRenderer.invoke(channels.commsChatCreate, request),
    broadcasts: () => ipcRenderer.invoke(channels.commsBroadcasts),
    broadcastCreate: (request) => ipcRenderer.invoke(channels.commsBroadcastCreate, request),
    broadcastMessages: (broadcastId) =>
      ipcRenderer.invoke(channels.commsBroadcastMessages, broadcastId),
    broadcastSend: (broadcastId, text) =>
      ipcRenderer.invoke(channels.commsBroadcastSend, broadcastId, text),
    chatMessages: (chatId, limit, before) =>
      ipcRenderer.invoke(channels.commsChatMessages, chatId, limit, before),
    chatSend: (chatId, text, replyTo, mentions) =>
      ipcRenderer.invoke(channels.commsChatSend, chatId, text, replyTo, mentions),
    chatSendFiles: (chatId, paths) =>
      ipcRenderer.invoke(channels.commsChatSendFiles, chatId, paths),
    chatPickFiles: () => ipcRenderer.invoke(channels.commsChatPickFiles),
    chatSendAudio: (chatId, bytes, mimetype) =>
      ipcRenderer.invoke(channels.commsChatSendAudio, chatId, bytes, mimetype),
    chatStickers: (chatId) =>
      ipcRenderer.invoke(channels.commsChatStickers, chatId),
    chatSendSticker: (chatId, stickerId) =>
      ipcRenderer.invoke(channels.commsChatSendSticker, chatId, stickerId),
    chatRecall: (chatId, messageId) =>
      ipcRenderer.invoke(channels.commsChatRecall, chatId, messageId),
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
    mailAttachment: (id, part, account, folder) =>
      ipcRenderer.invoke(channels.commsMailAttachment, id, part, account, folder),
    mailDownload: (id, account, folder) =>
      ipcRenderer.invoke(channels.commsMailDownload, id, account, folder),
    mailOpenFile: (path) => ipcRenderer.invoke(channels.commsMailOpenFile, path),
    mailPickFiles: () => ipcRenderer.invoke(channels.commsMailPickFiles),
    emailSave: (request) => ipcRenderer.invoke(channels.commsEmailSave, request),
    emailSignaturesSave: (request) =>
      ipcRenderer.invoke(channels.commsEmailSignaturesSave, request),
    emailRemove: (id) => ipcRenderer.invoke(channels.commsEmailRemove, id),
    emailTest: (id) => ipcRenderer.invoke(channels.commsEmailTest, id),
    emailSignIn: (provider) => ipcRenderer.invoke(channels.commsEmailSignIn, provider),
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
    revealEntry: (source, path) => ipcRenderer.invoke(channels.driveRevealEntry, source, path),
    openEntry: (source, path) => ipcRenderer.invoke(channels.driveOpenEntry, source, path),
    addShare: (path, label) => ipcRenderer.invoke(channels.driveAddShare, path, label),
    removeShare: (id) => ipcRenderer.invoke(channels.driveRemoveShare, id),
    saveS3: (config) => ipcRenderer.invoke(channels.driveSaveS3, config),
    list: (source, path) => ipcRenderer.invoke(channels.driveList, source, path),
    createFolder: (source, parentPath, name) =>
      ipcRenderer.invoke(channels.driveCreateFolder, source, parentPath, name),
    upload: (source, parentPath, paths, onProgress) => {
      const operationId = crypto.randomUUID();
      const receive = (_event: Electron.IpcRendererEvent, id: string, completed: number, total: number) => {
        if (id === operationId && total > 0) onProgress?.(Math.min(1, completed / total));
      };
      ipcRenderer.on(channels.driveProgress, receive);
      return ipcRenderer.invoke(channels.driveUpload, source, parentPath, paths, operationId)
        .finally(() => ipcRenderer.removeListener(channels.driveProgress, receive));
    },
    download: (source, path) =>
      ipcRenderer.invoke(channels.driveDownload, source, path),
    remove: (source, paths) => ipcRenderer.invoke(channels.driveRemove, source, paths),
    rename: (source, path, name) =>
      ipcRenderer.invoke(channels.driveRename, source, path, name),
    move: (source, paths, destinationFolder, onProgress) => {
      const operationId = crypto.randomUUID();
      const receive = (_event: Electron.IpcRendererEvent, id: string, completed: number, total: number) => {
        if (id === operationId && total > 0) onProgress?.(Math.min(1, completed / total));
      };
      ipcRenderer.on(channels.driveProgress, receive);
      return ipcRenderer.invoke(channels.driveMove, source, paths, destinationFolder, operationId)
        .finally(() => ipcRenderer.removeListener(channels.driveProgress, receive));
    },
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
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, skills: SkillDto[]) => listener(skills);
      ipcRenderer.on(channels.skillsChanged, receive);
      return () => ipcRenderer.removeListener(channels.skillsChanged, receive);
    },
    setEnabled: (name, enabled) => ipcRenderer.invoke(channels.skillsSetEnabled, name, enabled),
    saveCustom: (request) => ipcRenderer.invoke(channels.skillsSaveCustom, request),
    removeCustom: (name) => ipcRenderer.invoke(channels.skillsRemoveCustom, name),
    upload: (files) => ipcRenderer.invoke(channels.skillsUpload, files.map((file) => ({
      path: webUtils.getPathForFile(file),
      relativePath: file.webkitRelativePath,
    }))),
    install: (spec) => ipcRenderer.invoke(channels.skillsInstall, spec),
    searchRegistry: (query, limit) => ipcRenderer.invoke(channels.skillsSearchRegistry, query, limit ?? 15),
    discover: () => ipcRenderer.invoke(channels.skillsDiscover),
    adopt: (path) => ipcRenderer.invoke(channels.skillsAdopt, path),
  },
  plugins: {
    list: () => ipcRenderer.invoke(channels.pluginsList),
    setEnabled: (id, enabled) => ipcRenderer.invoke(channels.pluginsSetEnabled, id, enabled),
    install: (id) => ipcRenderer.invoke(channels.pluginsInstall, id),
    remove: (id) => ipcRenderer.invoke(channels.pluginsRemove, id),
    marketplaces: () => ipcRenderer.invoke(channels.pluginsMarketplaces),
    addMarketplace: (source) => ipcRenderer.invoke(channels.pluginsAddMarketplace, source),
    removeMarketplace: (id) => ipcRenderer.invoke(channels.pluginsRemoveMarketplace, id),
    browse: (query) => ipcRenderer.invoke(channels.pluginsBrowse, query),
    views: () => ipcRenderer.invoke(channels.pluginsViews),
    upload: (files) => ipcRenderer.invoke(channels.pluginsUpload, files.map((file) => ({
      path: webUtils.getPathForFile(file),
      relativePath: file.webkitRelativePath,
    }))),
  },
  apps: {
    list: () => ipcRenderer.invoke(channels.appsList),
    browse: (query) => ipcRenderer.invoke(channels.appsBrowse, query),
    install: (id) => ipcRenderer.invoke(channels.appsInstall, id),
    setEnabled: (id, enabled) => ipcRenderer.invoke(channels.appsSetEnabled, id, enabled),
    setPinned: (ids) => ipcRenderer.invoke(channels.appsSetPinned, ids),
    remove: (id) => ipcRenderer.invoke(channels.appsRemove, id),
  },
  models: {
    list: () => ipcRenderer.invoke(channels.modelsList),
    select: (provider, id) =>
      ipcRenderer.invoke(channels.modelsSelect, provider, id),
    metadata: () => ipcRenderer.invoke(channels.modelsMetadata),
    roles: () => ipcRenderer.invoke(channels.modelsRoles),
    assignRole: (role, provider, id, reasoning) =>
      ipcRenderer.invoke(channels.modelsAssignRole, role, provider, id, reasoning),
    clearRole: (role) => ipcRenderer.invoke(channels.modelsClearRole, role),
    resetRole: (role) => ipcRenderer.invoke(channels.modelsResetRole, role),
  },
  browser: {
    embedded: true,
    open: (tabId, url, viewport) => ipcRenderer.invoke(channels.browserOpen, tabId, url, viewport),
    navigate: (tabId, url) => ipcRenderer.invoke(channels.browserNavigate, tabId, url),
    history: (tabId, delta) => ipcRenderer.invoke(channels.browserHistory, tabId, delta),
    reload: (tabId) => ipcRenderer.invoke(channels.browserReload, tabId),
    setBounds: (tabId, bounds) => ipcRenderer.invoke(channels.browserSetBounds, tabId, bounds),
    setVisible: (tabId, visible) => ipcRenderer.invoke(channels.browserSetVisible, tabId, visible),
    close: (tabId) => ipcRenderer.invoke(channels.browserClose, tabId),
    openExternal: (url) => ipcRenderer.invoke(channels.browserOpenExternal, url),
    defaultApp: (target) => ipcRenderer.invoke(channels.browserDefaultApp, target),
    openPath: (filePath) => ipcRenderer.invoke(channels.browserOpenPath, filePath),
    find: (tabId, text, forward) => ipcRenderer.invoke(channels.browserFind, tabId, text, forward),
    stopFind: (tabId) => ipcRenderer.invoke(channels.browserStopFind, tabId),
    print: (tabId) => ipcRenderer.invoke(channels.browserPrint, tabId),
    preview: (tabId) => ipcRenderer.invoke(channels.browserPreview, tabId),
    screenshot: (tabId) => ipcRenderer.invoke(channels.browserScreenshot, tabId),
    favicon: (url) => ipcRenderer.invoke(channels.browserFavicon, url),
    downloads: () => ipcRenderer.invoke(channels.browserDownloadsList),
    openDownload: (id) => ipcRenderer.invoke(channels.browserOpenDownload, id),
    openDownloadsFolder: () => ipcRenderer.invoke(channels.browserOpenDownloadsFolder),
    pauseDownload: (id) => ipcRenderer.invoke(channels.browserPauseDownload, id),
    resumeDownload: (id) => ipcRenderer.invoke(channels.browserResumeDownload, id),
    cancelDownload: (id) => ipcRenderer.invoke(channels.browserCancelDownload, id),
    removeDownload: (id) => ipcRenderer.invoke(channels.browserRemoveDownload, id),
    clearDownloads: () => ipcRenderer.invoke(channels.browserClearDownloads),
    settings: () => ipcRenderer.invoke(channels.browserSettingsGet),
    updateSettings: (patch) => ipcRenderer.invoke(channels.browserSettingsUpdate, patch),
    permissions: () => ipcRenderer.invoke(channels.browserPermissionsList),
    setPermission: (site, permission, decision) =>
      ipcRenderer.invoke(channels.browserPermissionSet, site, permission, decision),
    clearPermissions: (site) => ipcRenderer.invoke(channels.browserPermissionsClear, site),
    respondToPermission: (id, decision, remember) =>
      ipcRenderer.invoke(channels.browserPermissionRespond, id, decision, remember),
    respondToWebAuthn: (id, credentialId) =>
      ipcRenderer.invoke(channels.browserWebAuthnRespond, id, credentialId),
    sites: () => ipcRenderer.invoke(channels.browserSitesList),
    clearSiteData: (site) => ipcRenderer.invoke(channels.browserClearSiteData, site),
    clearBrowsingData: (options) => ipcRenderer.invoke(channels.browserClearBrowsingData, options),
    logins: () => ipcRenderer.invoke(channels.browserLoginsList),
    saveLogin: (site, username, password) =>
      ipcRenderer.invoke(channels.browserLoginSave, site, username, password),
    revealLogin: (id) => ipcRenderer.invoke(channels.browserLoginReveal, id),
    deleteLogin: (id) => ipcRenderer.invoke(channels.browserLoginDelete, id),
    fillAutofill: (tabId, itemId) =>
      ipcRenderer.invoke(channels.browserAutofillFill, tabId, itemId),
    dismissAutofill: (tabId) => ipcRenderer.invoke(channels.browserAutofillDismiss, tabId),
    browsingHistory: (options) => ipcRenderer.invoke(channels.browserHistoryList, options),
    suggestions: (query) => ipcRenderer.invoke(channels.browserSuggestions, query),
    forgetHistoryEntry: (url) => ipcRenderer.invoke(channels.browserHistoryForget, url),
    clearHistory: (options) => ipcRenderer.invoke(channels.browserHistoryClear, options),
    importSources: () => ipcRenderer.invoke(channels.browserImportSources),
    importFrom: (request) => ipcRenderer.invoke(channels.browserImportRun, request),
    importFile: (path) => ipcRenderer.invoke(channels.browserImportFile, path),
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
    connectOAuth: (provider) =>
      ipcRenderer.invoke(channels.providersConnectOAuth, provider),
    cancelOAuth: (provider) =>
      ipcRenderer.invoke(channels.providersCancelOAuth, provider),
    disconnectOAuth: (provider) =>
      ipcRenderer.invoke(channels.providersDisconnectOAuth, provider),
    subscribeOAuth(listener) {
      const receive = (_event: Electron.IpcRendererEvent, value: ProviderOAuthEventDto) =>
        listener(value);
      ipcRenderer.on(channels.providersOAuthEvent, receive);
      return () => ipcRenderer.removeListener(channels.providersOAuthEvent, receive);
    },
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

contextBridge.exposeInMainWorld("polymux", api);
