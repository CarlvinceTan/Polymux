<script lang="ts">
  import {onDestroy, onMount} from 'svelte';
  import type {ArtifactDto, ConversationDto, GoalDto, JsonValue, MessageDto, ReferenceDto, RunEventDto} from '@midas/protocol';
  import TitleBar from './lib/components/chat/TitleBar.svelte';
  import ChatPane, {type ChatMessage} from './lib/components/chat/ChatPane.svelte';
  import TimelineRail from './lib/components/chat/TimelineRail.svelte';
  import type {AgentActivityKind} from './lib/components/chat/AgentActivity.svelte';
  import type {ActiveGoal} from './lib/components/chat/GoalBar.svelte';
  import SpeechOrb from './lib/components/chat/SpeechOrb.svelte';
  import HistoryDrawer, {type HistoryChat} from './lib/components/shell/HistoryDrawer.svelte';
  import SummaryPanel, {type SummarySection, type ReferenceItem} from './lib/components/workspace/SummaryPanel.svelte';
  import WorkspaceDrawer, {type WorkspaceTab, type WorkspaceTabKind} from './lib/components/workspace/WorkspaceDrawer.svelte';
  import Tooltip from './lib/components/shared/Tooltip.svelte';
  import OptionsModal from './lib/components/options/OptionsModal.svelte';
  import {midasApi} from './lib/api/midas';
  import {applyTheme, startThemeSync} from './lib/theme';
  import {
    conversationPanelState,
    drawerMotionMs,
    initialPanelState,
    summaryWasDismissed,
    togglePanelState,
    type PanelMode,
    type PanelState,
  } from './lib/state/panels';
  import {
    MIN_HISTORY_WIDTH,
    MIN_WORKSPACE_WIDTH,
    SPLIT_LAYOUT_MIN_WIDTH,
    SUMMARY_RESERVED_COLUMN,
    resolvePanelWidths,
  } from './lib/layout/layoutSizing';

  type Conversation = HistoryChat & {messages: ChatMessage[]; goal?: ActiveGoal};
  type SummaryTask = {id: string; title: string; status: 'pending' | 'active' | 'completed' | 'failed'};

  const api = midasApi();
  let conversations: Conversation[] = [];
  let activeId = '';
  let draftConversation: Conversation = emptyDraft();
  let loadError = '';
  let runByConversation: Record<string, string> = {};
  let liveAssistantByConversation: Record<string, string> = {};

  // Panel state. Summary and Workspace are mutually exclusive, and Workspace
  // only borrows Summary's space: closing it hands the space back.
  let panelState: PanelState = initialPanelState;
  let summaryDismissed = false;
  /** Holds the Summary control hidden until Workspace's closing slide finishes. */
  let workspaceClearing = false;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  let historyOpen = false;
  let historyWidth = 240;
  let panelPriority: 'history' | 'workspace' = 'workspace';
  let trackedPanels = {history: false, workspace: false};
  let historyResizing = false;
  let workspaceWidth = 540;
  let workspaceResizing = false;
  let workspaceExpanded = false;
  let viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;

  let voiceOpen = false;
  let voiceInChat = false;
  let voiceStartedEmpty = false;
  let voiceMuted = false;
  let outputMuted = false;
  let voicePaused = false;
  let optionsOpen = false;
  let startupVisible = true;
  let startupLeaving = false;
  let startupMinimumElapsed = false;
  let startupReady = false;
  let startupMinimumTimer: ReturnType<typeof setTimeout> | undefined;
  let startupRemovalTimer: ReturnType<typeof setTimeout> | undefined;
  let speechModeEnabled = true;
  let windowActive = true;
  let queueHeight = 0;
  let showJumpToLatest = false;
  let outputs: Array<{id: string; name: string}> = [];
  let references: ReferenceItem[] = [];
  let tasksByConversation: Record<string, SummaryTask[]> = {};
  let tasks: SummaryTask[] = [];
  let workspaceTabs: WorkspaceTab[] = [];
  let activeTabId: string | null = null;

  $: mode = panelState.mode;
  $: active = activeId ? conversations.find((chat) => chat.id === activeId) ?? draftConversation : draftConversation;
  $: tasks = tasksByConversation[active.id] ?? [];
  $: running = Boolean(runByConversation[active.id]);
  $: historyChats = conversations.map(({id, title, updatedAt}) => ({id, title, updatedAt}));
  $: timeline = active.messages
    .filter((message) => message.text)
    .map((message) => ({id: message.id, title: message.role === 'user' ? 'You' : 'Midas', preview: message.text.slice(0, 160)}));

  // Must run before anything derived from the panel mode below: reactive
  // statements run in declaration order, so opening Summary after the column
  // derivations would show the card while the grid still reserved no space for it.
  $: syncConversationPanel(active.messages.length > 0, viewportWidth >= SPLIT_LAYOUT_MIN_WIDTH, summaryDismissed);

  $: if (mode !== 'workspace' && workspaceExpanded) workspaceExpanded = false;
  $: applyPanelLayout(viewportWidth, historyOpen, mode === 'workspace' && !workspaceExpanded, historyWidth, workspaceWidth);

  $: workspaceColumn = mode === 'workspace' ? `${workspaceWidth}px` : '0px';
  $: workspacePanelWidth = workspaceExpanded
    ? `calc(100vw - ${historyOpen ? historyWidth : 0}px)`
    : `${workspaceWidth}px`;
  $: contentRightColumn = mode === 'summary' ? `${SUMMARY_RESERVED_COLUMN}px` : workspaceColumn;
  /**
   * What the composer reserves on its right. It follows the panel docking in
   * and out, but deliberately ignores `expanded`: expanding is a slide, and a
   * composer that widened to the viewport as the panel took it over would
   * visibly reflow for the whole transition instead of sliding away intact.
   */
  $: composerColumn = mode === 'summary'
    ? `${SUMMARY_RESERVED_COLUMN}px`
    : mode === 'workspace' ? `${workspaceWidth}px` : '0px';
  $: dockedHistoryWidth = viewportWidth >= SPLIT_LAYOUT_MIN_WIDTH && historyOpen ? historyWidth : 0;
  $: dockedRightWidth = viewportWidth >= SPLIT_LAYOUT_MIN_WIDTH
    ? mode === 'summary' ? SUMMARY_RESERVED_COLUMN : mode === 'workspace' ? workspaceWidth : 0
    : 0;
  $: chatAreaWidth = Math.max(0, viewportWidth - dockedHistoryWidth - dockedRightWidth);
  $: chatColumnWidth = Math.min(792, Math.max(0, chatAreaWidth - 8));
  $: timelineLeft = dockedHistoryWidth + (chatAreaWidth - chatColumnWidth) / 2 - 34;
  $: showTimelineRail = timeline.length > 2 && chatAreaWidth >= 880 && !workspaceExpanded;

  onDestroy(() => {
    clearTimeout(clearTimer);
    clearTimeout(startupMinimumTimer);
    clearTimeout(startupRemovalTimer);
    unsubscribeEvents?.();
    stopThemeSync?.();
  });

  let unsubscribeEvents: (() => void) | undefined;
  let stopThemeSync: (() => void) | undefined;

  onMount(() => {
    startupMinimumTimer = setTimeout(() => {
      startupMinimumElapsed = true;
      finishStartupWhenReady();
    }, 2000);
    stopThemeSync = startThemeSync();
    void api.permissions.ensureFirstRun().catch(() => {});
    const settingsLoad = api.general.get().then((settings) => {
      applyTheme(settings.theme);
      speechModeEnabled = settings.speechModeEnabled;
    }).catch(() => {});
    windowActive = document.hasFocus();
    unsubscribeEvents = api.runs.subscribe(handleRunEvent);
    void Promise.all([settingsLoad, loadHistory()]).finally(() => {
      startupReady = true;
      finishStartupWhenReady();
    });
  });

  function finishStartupWhenReady(): void {
    if (!startupVisible || startupLeaving || !startupMinimumElapsed || !startupReady) return;
    startupLeaving = true;
    startupRemovalTimer = setTimeout(() => startupVisible = false, 240);
  }

  function syncConversationPanel(hasMessages: boolean, splitLayout: boolean, dismissed: boolean): void {
    const next = conversationPanelState(panelState, {hasMessages, splitLayout, summaryDismissed: dismissed});
    if (next !== panelState) setPanelState(next);
  }

  function setPanelState(next: PanelState): void {
    const previous = panelState.mode;
    panelState = next;
    scheduleWorkspaceClear(previous, next.mode);
  }

  /**
   * A control that vanished for the workspace must not reappear on top of the
   * panel while it is still sliding away, so it stays hidden for exactly the
   * length of the closing animation.
   */
  function scheduleWorkspaceClear(previous: PanelMode, next: PanelMode): void {
    clearTimeout(clearTimer);
    if (previous === 'workspace' && next !== 'workspace') {
      workspaceClearing = true;
      clearTimer = setTimeout(() => workspaceClearing = false, drawerMotionMs());
    } else {
      workspaceClearing = false;
    }
  }

  function togglePanel(requested: 'summary' | 'workspace'): void {
    const next = togglePanelState(panelState, requested);
    if (requested === 'summary') summaryDismissed = summaryWasDismissed(panelState, next);
    setPanelState(next);
  }

  function openWorkspace(): void {
    if (panelState.mode === 'workspace') return;
    panelState = togglePanelState(panelState, 'workspace');
    workspaceClearing = false;
  }

  function updateActive(mutator: (chat: Conversation) => Conversation): void {
    if (activeId) conversations = conversations.map((chat) => chat.id === activeId ? mutator(chat) : chat);
    else draftConversation = mutator(draftConversation);
  }

  function newChat(): void {
    activeId = '';
    draftConversation = emptyDraft();
    setPanelState(initialPanelState);
    summaryDismissed = false;
    workspaceExpanded = false;
    clearConversationResources();
  }

  async function openChat(id: string): Promise<void> {
    activeId = id;
    summaryDismissed = false;
    setPanelState(initialPanelState);
    await loadConversation(id);
  }

  async function send(text: string, files: File[], asGoal = false): Promise<void> {
    if (!text && !files.length) return;
    const sentAt = new Date().toISOString();
    let conversationId = activeId;
    const title = active.title === 'New chat' ? (text || files[0]?.name || 'New chat').slice(0, 42) : active.title;
    if (!conversationId) {
      const created = await api.conversations.create(title);
      conversationId = created.id;
      activeId = created.id;
      conversations = [{...fromConversation(created), messages: []}, ...conversations];
    } else if (active.title === 'New chat') {
      await rename(title);
    }

    const existingRun = runByConversation[conversationId];
    if (existingRun && !existingRun.startsWith('pending:')) {
      const steered: ChatMessage = {id: crypto.randomUUID(), role: 'user', text, files: files.map((file) => file.name), sentAt, asGoal};
      updateConversation(conversationId, (chat) => ({...chat, messages: [...chat.messages, steered]}));
      if (asGoal) await setGoal(conversationId, text || files[0]?.name || 'Review attached files');
      await api.runs.steer(existingRun, text, steered.id);
      return;
    }

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const userMessage: ChatMessage = {id: userId, role: 'user', text, files: files.map((file) => file.name), sentAt, asGoal};
    updateConversation(conversationId, (chat) => ({
      ...chat,
      title,
      updatedAt: Date.now(),
      goal: asGoal ? {id: crypto.randomUUID(), text: text || files[0]?.name || 'Review attached files', startedAt: sentAt, status: 'active'} : chat.goal,
      messages: [...chat.messages, userMessage, {id: assistantId, role: 'assistant', text: '', startedAt: sentAt, activities: [{id: crypto.randomUUID(), kind: 'thinking', status: 'active', label: 'Thinking'}]}],
    }));
    liveAssistantByConversation = {...liveAssistantByConversation, [conversationId]: assistantId};
    runByConversation = {...runByConversation, [conversationId]: `pending:${assistantId}`};
    setConversationTasks(conversationId, []);

    try {
      const attachmentPaths = files.length ? await api.files.paths(files) : [];
      const {runId} = await api.runs.start({conversationId, text, messageId: userId, attachments: attachmentPaths, asGoal});
      runByConversation = {...runByConversation, [conversationId]: runId};
      updateLiveAssistant(conversationId, (message) => ({...message, runId}));
      if (asGoal) await refreshGoal(conversationId);
      await loadHistory();
    } catch (error) {
      failRun(conversationId, error instanceof Error ? error.message : String(error));
    }
  }

  async function stop(): Promise<void> {
    const runId = runByConversation[active.id];
    if (runId && !runId.startsWith('pending:')) await api.runs.cancel(runId);
  }

  async function rename(title: string): Promise<void> {
    if (!activeId) { draftConversation = {...draftConversation, title}; return; }
    const updated = await api.conversations.rename(activeId, title);
    if (updated) updateConversation(activeId, (chat) => ({...chat, title: updated.title, updatedAt: Date.parse(updated.updatedAt)}));
  }
  async function renameHistory(id: string, title: string): Promise<void> {
    const updated = await api.conversations.rename(id, title);
    if (updated) updateConversation(id, (chat) => ({...chat, title: updated.title, updatedAt: Date.parse(updated.updatedAt)}));
  }
  async function deleteHistory(id: string): Promise<void> {
    await api.conversations.remove(id);
    conversations = conversations.filter((chat) => chat.id !== id);
    if (activeId === id) newChat();
  }

  async function loadHistory(): Promise<void> {
    try {
      const stored = await api.conversations.list();
      const current = new Map(conversations.map((chat) => [chat.id, chat]));
      conversations = stored.map((item) => ({
        ...fromConversation(item),
        messages: current.get(item.id)?.messages ?? [],
        goal: current.get(item.id)?.goal,
      }));
      loadError = '';
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadConversation(id: string): Promise<void> {
    try {
      const [storedMessages, storedGoal, artifacts, storedReferences] = await Promise.all([
        api.conversations.messages(id),
        api.goals.get(id),
        api.resources.artifacts(id),
        api.resources.references(id),
      ]);
      const current = conversations.find((chat) => chat.id === id)?.messages ?? [];
      updateConversation(id, (chat) => ({...chat, messages: mergeMessages(storedMessages, current), goal: fromGoal(storedGoal)}));
      applyResources(artifacts, storedReferences);
      loadError = '';
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }
  }

  function handleRunEvent(event: RunEventDto): void {
    const conversationId = event.conversationId;
    if (!conversationId) return;
    const payload = asRecord(event.payload);
    if (event.type === 'run.started') runByConversation = {...runByConversation, [conversationId]: event.runId};
    if (event.type === 'message.text.delta') {
      const delta = typeof payload.delta === 'string' ? payload.delta : '';
      updateLiveAssistant(conversationId, (message) => ({...message, text: message.text + delta}));
    }
    if (event.type === 'message.completed') {
      const completed = asRecord(payload.message);
      const text = contentText(completed.content);
      if (text) updateLiveAssistant(conversationId, (message) => ({...message, text}));
    }
    if (event.type === 'tool.started') {
      const call = asRecord(payload.toolCall);
      const name = typeof call.name === 'string' ? call.name : 'tool';
      const id = typeof call.id === 'string' ? call.id : crypto.randomUUID();
      updateLiveAssistant(conversationId, (message) => ({...message, activities: [...(message.activities ?? []).filter((item) => item.status !== 'active' || item.kind !== 'thinking'), {id, kind: activityKind(name), status: 'active', label: activityLabel(name)}]}));
      if (isSubagentTask(name)) {
        const arguments_ = asRecord(call.arguments);
        const description = typeof arguments_.description === 'string' ? arguments_.description.trim() : '';
        updateConversationTasks(conversationId, (current) => [
          ...current.filter((task) => task.id !== id),
          {id, title: description || 'Delegated task', status: 'active'},
        ]);
      }
    }
    if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      const call = asRecord(payload.toolCall);
      const name = typeof call.name === 'string' ? call.name : 'tool';
      const id = typeof call.id === 'string' ? call.id : '';
      updateLiveAssistant(conversationId, (message) => ({...message, activities: (message.activities ?? []).map((item) => item.id === id ? {...item, status: event.type === 'tool.failed' ? 'failed' : 'completed'} : item)}));
      if (isSubagentTask(name)) {
        const status = event.type === 'tool.failed' || toolResultFailed(payload.result) ? 'failed' : 'completed';
        updateConversationTasks(conversationId, (current) => current.map((task) => task.id === id ? {...task, status} : task));
      }
    }
    if (event.type === 'run.completed' || event.type === 'run.cancelled' || event.type === 'run.failed') {
      const completedAt = new Date(event.timestamp).toISOString();
      const failure = event.type === 'run.failed' ? runFailureMessage(payload) : '';
      updateLiveAssistant(conversationId, (message) => ({
        ...message,
        text: failure && !message.text ? failure : message.text,
        sentAt: completedAt,
        completedAt,
        activities: (message.activities ?? []).map((item) => ({...item, status: item.status === 'active' ? (event.type === 'run.failed' ? 'failed' : 'completed') : item.status})),
      }));
      updateConversationTasks(conversationId, (current) => current.map((task) => task.status === 'active'
        ? {...task, status: event.type === 'run.completed' ? 'completed' : 'failed'}
        : task));
      const next = {...runByConversation}; delete next[conversationId]; runByConversation = next;
    }
    if (event.type === 'run.settled') void settleConversation(conversationId);
  }

  async function settleConversation(conversationId: string): Promise<void> {
    const stored = await api.conversations.messages(conversationId);
    const current = conversations.find((chat) => chat.id === conversationId)?.messages ?? [];
    updateConversation(conversationId, (chat) => ({...chat, messages: mergeMessages(stored, current)}));
    const next = {...liveAssistantByConversation}; delete next[conversationId]; liveAssistantByConversation = next;
    await Promise.all([refreshGoal(conversationId), loadHistory()]);
    if (activeId === conversationId) {
      const [artifacts, storedReferences] = await Promise.all([api.resources.artifacts(conversationId), api.resources.references(conversationId)]);
      applyResources(artifacts, storedReferences);
    }
  }

  function updateConversation(id: string, mutator: (chat: Conversation) => Conversation): void {
    conversations = conversations.map((chat) => chat.id === id ? mutator(chat) : chat);
  }

  function setConversationTasks(conversationId: string, next: SummaryTask[]): void {
    tasksByConversation = {...tasksByConversation, [conversationId]: next};
  }

  function updateConversationTasks(conversationId: string, mutator: (tasks: SummaryTask[]) => SummaryTask[]): void {
    setConversationTasks(conversationId, mutator(tasksByConversation[conversationId] ?? []));
  }

  function updateLiveAssistant(conversationId: string, mutator: (message: ChatMessage) => ChatMessage): void {
    const id = liveAssistantByConversation[conversationId];
    if (!id) return;
    updateConversation(conversationId, (chat) => ({...chat, messages: chat.messages.map((message) => message.id === id ? mutator(message) : message)}));
  }

  function failRun(conversationId: string, reason: string): void {
    const completedAt = new Date().toISOString();
    const detail = cleanIpcError(reason);
    updateLiveAssistant(conversationId, (message) => ({...message, text: `Unable to start the agent: ${detail}`, sentAt: completedAt, completedAt, activities: [{id: crypto.randomUUID(), kind: 'thinking', status: 'failed', label: 'Agent failed to start'}]}));
    const next = {...runByConversation}; delete next[conversationId]; runByConversation = next;
  }

  function cleanIpcError(message: string): string {
    return message
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '')
      .trim();
  }

  async function setGoal(conversationId: string, objective: string): Promise<void> {
    const current = await api.goals.get(conversationId);
    await api.goals.execute({conversationId, action: current ? 'update' : 'create', objective});
    await refreshGoal(conversationId);
  }

  async function refreshGoal(conversationId: string): Promise<void> {
    const stored = await api.goals.get(conversationId);
    updateConversation(conversationId, (chat) => ({...chat, goal: fromGoal(stored)}));
  }

  async function editGoal(text: string): Promise<void> {
    if (!activeId) return;
    await api.goals.execute({conversationId: activeId, action: 'update', objective: text});
    await refreshGoal(activeId);
  }

  async function toggleGoalPaused(): Promise<void> {
    if (!activeId || !active.goal) return;
    await api.goals.execute({conversationId: activeId, action: active.goal.status === 'paused' ? 'resume' : 'pause'});
    await refreshGoal(activeId);
  }

  async function deleteGoal(): Promise<void> {
    if (!activeId) return;
    await api.goals.execute({conversationId: activeId, action: 'clear'});
    await refreshGoal(activeId);
  }

  async function editMessage(id: string, text: string, files: File[]): Promise<void> {
    updateActive((chat) => ({...chat, messages: chat.messages.map((message) => message.id === id ? {...message, text, files: [...(message.files ?? []), ...files.map((file) => file.name)]} : message)}));
    const attachmentPaths = files.length ? await api.files.paths(files) : [];
    const updated = await api.conversations.updateMessage(id, {content: text, attachments: attachmentPaths});
    if (updated) updateActive((chat) => ({...chat, messages: chat.messages.map((message) => message.id === id ? fromMessage(updated) : message)}));
  }

  async function setFeedback(id: string, feedback: 'up' | 'down' | null): Promise<void> {
    const message = active.messages.find((item) => item.id === id);
    updateActive((chat) => ({...chat, messages: chat.messages.map((item) => item.id === id ? {...item, feedback} : item)}));
    await api.conversations.updateMessage(id, {metadata: {feedback, asGoal: message?.asGoal ?? false}});
  }

  function clearConversationResources(): void {
    outputs = []; references = []; workspaceTabs = []; activeTabId = null;
  }

  function applyResources(artifacts: ArtifactDto[], storedReferences: ReferenceDto[]): void {
    outputs = artifacts.map(({id, name}) => ({id, name}));
    references = storedReferences.map(({id, title, kind, uri}) => ({id, title, kind, uri}));
    const resourceTabs = artifacts.map(artifactTab);
    workspaceTabs = [...workspaceTabs.filter((tab) => tab.kind === 'side-chat' || tab.kind === 'summary'), ...resourceTabs];
    if (activeTabId && !workspaceTabs.some((tab) => tab.id === activeTabId)) activeTabId = workspaceTabs[0]?.id ?? null;
  }

  function openTab(tab: WorkspaceTab): void {
    if (!workspaceTabs.some((current) => current.id === tab.id)) workspaceTabs = [...workspaceTabs, tab];
    activeTabId = tab.id;
    openWorkspace();
  }

  /**
   * Closing the last tab leaves the panel open on its launcher rather than
   * dismissing it: the panel is a place, and closing what is inside it is not
   * the same gesture as putting it away.
   */
  function closeTab(id: string): void {
    const index = workspaceTabs.findIndex((tab) => tab.id === id);
    const closing = workspaceTabs[index];
    workspaceTabs = workspaceTabs.filter((tab) => tab.id !== id);
    if (activeTabId === id) activeTabId = workspaceTabs[Math.max(0, index - 1)]?.id ?? null;
    // The embedded browser's native view outlives the Svelte component, so the
    // tab closing is what actually tears it down.
    if (closing?.kind === 'browser') void api.browser.close(id);
  }

  function newTab(kind: WorkspaceTabKind = 'document'): void {
    openTab({id: crypto.randomUUID(), title: 'New tab', kind});
  }

  function viewSummary(section: SummarySection): void {
    openTab({id: `summary-${section}`, title: section[0].toUpperCase() + section.slice(1), kind: 'summary', section});
  }

  function createOutput(kind: 'document' | 'presentation' | 'spreadsheet'): void {
    const mapped: Record<typeof kind, WorkspaceTabKind> = {document: 'document', presentation: 'slides', spreadsheet: 'sheet'};
    const id = crypto.randomUUID();
    const name = `Untitled ${kind}`;
    outputs = [...outputs, {id, name}];
    openTab({id, title: name, kind: mapped[kind]});
  }

  async function attachReferences(files: File[]): Promise<void> {
    if (!activeId) return;
    const added = await api.resources.addFiles(activeId, files);
    references = [...references, ...added.map(({id, title, kind, uri}) => ({id, title, kind, uri}))];
  }

  /** Voice opens on its own full surface; Minimise is what docks it into the
   * conversation. Opening straight into the docked view left the orb sharing
   * the screen with the welcome copy it was meant to replace. */
  function openVoice(): void {
    voiceStartedEmpty = active.messages.length === 0;
    voiceInChat = false;
    voiceOpen = true;
  }

  function closeVoice(): void {
    voiceOpen = false;
    voiceInChat = false;
    voiceStartedEmpty = false;
  }

  /**
   * Both surfaces resize against the same conversation floor, so neither can
   * crush the chat below the width that keeps the composer toolbar on one
   * line. The drawer touched last keeps its width; the other gives way, but
   * never below its own minimum. Runs reactively so opening, resizing, mode
   * changes, and viewport changes all settle to a valid layout.
   */
  function applyPanelLayout(viewport: number, historyActive: boolean, workspaceActive: boolean, currentHistory: number, currentWorkspace: number): void {
    if (historyActive && !trackedPanels.history) panelPriority = 'history';
    if (workspaceActive && !trackedPanels.workspace) panelPriority = 'workspace';
    trackedPanels = {history: historyActive, workspace: workspaceActive};
    if (viewport < SPLIT_LAYOUT_MIN_WIDTH) return;
    const resolved = resolvePanelWidths({
      viewportWidth: viewport,
      historyOpen: historyActive,
      workspaceOpen: workspaceActive,
      historyWidth: currentHistory,
      workspaceWidth: currentWorkspace,
      priority: panelPriority,
    });
    if (resolved.historyWidth !== historyWidth) historyWidth = resolved.historyWidth;
    if (resolved.workspaceWidth !== workspaceWidth) workspaceWidth = resolved.workspaceWidth;
  }

  function emptyDraft(): Conversation {
    return {id: '', title: 'New chat', updatedAt: Date.now(), messages: []};
  }

  function fromConversation(conversation: ConversationDto): Conversation {
    return {
      id: conversation.id,
      title: conversation.title,
      updatedAt: Date.parse(conversation.updatedAt),
      messages: [],
    };
  }

  function mergeMessages(stored: MessageDto[], current: ChatMessage[]): ChatMessage[] {
    const mapped = stored
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => {
        const mapped = fromMessage(message);
        const previous = current.find((item) => item.id === message.id)
          ?? (message.runId && message.role === 'assistant'
            ? current.find((item) => item.role === 'assistant' && item.runId === message.runId)
            : undefined);
        return previous ? {
          ...mapped,
          activities: previous.activities,
          startedAt: previous.startedAt,
          completedAt: previous.completedAt,
        } : mapped;
      });
    const representedIds = new Set(mapped.map((message) => message.id));
    const representedRuns = new Set(mapped.flatMap((message) => message.runId ? [message.runId] : []));
    // A run can be active (or can fail before producing a durable assistant
    // message) while the history refresh already contains its user message.
    // Keep that live assistant row until a stored message for the same id/run
    // replaces it, otherwise subsequent stream and error events have no target.
    const live = current.filter((message) =>
      !representedIds.has(message.id)
      && !(message.runId && representedRuns.has(message.runId)),
    );
    return [...mapped, ...live].sort((a, b) =>
      (a.sentAt ?? a.startedAt ?? '').localeCompare(b.sentAt ?? b.startedAt ?? ''),
    );
  }

  function fromMessage(message: MessageDto): ChatMessage {
    const metadata = asRecord(message.metadata);
    const feedback = metadata.feedback === 'up' || metadata.feedback === 'down' ? metadata.feedback : null;
    return {
      id: message.id,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      text: contentText(message.content),
      files: message.attachments.map((attachment) => attachment.name),
      sentAt: message.createdAt,
      asGoal: metadata.asGoal === true,
      feedback,
      runId: message.runId ?? undefined,
    };
  }

  function fromGoal(goal: GoalDto | null): ActiveGoal | undefined {
    if (!goal || (goal.status !== 'active' && goal.status !== 'paused')) return undefined;
    return {id: goal.id, text: goal.objective, startedAt: goal.createdAt, status: goal.status};
  }

  function artifactTab(artifact: ArtifactDto): WorkspaceTab {
    const kinds: Record<ArtifactDto['kind'], WorkspaceTabKind> = {
      document: 'document', slides: 'slides', sheet: 'sheet', photo: 'photo', video: 'video', other: 'document',
    };
    return {id: artifact.id, title: artifact.name, kind: kinds[artifact.kind]};
  }

  function asRecord(value: JsonValue | undefined): Record<string, JsonValue> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, JsonValue>
      : {};
  }

  function contentText(value: JsonValue | undefined): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join('\n');
    const record = asRecord(value);
    if (typeof record.text === 'string') return record.text;
    return record.content === undefined ? '' : contentText(record.content);
  }

  function runFailureMessage(payload: Record<string, JsonValue>): string {
    const result = asRecord(payload.result);
    const failure = asRecord(result.error);
    const message = typeof failure.message === 'string' ? failure.message : 'The agent could not complete this response.';
    const authenticationFailure = /(?:missing authentication|unauthori[sz]ed|invalid api key|\b401\b)/i.test(message);
    return authenticationFailure
      ? 'Unable to respond: The selected provider rejected its saved API key. Remove it or add a valid key in Options → Provider.'
      : `Unable to respond: ${message}`;
  }

  function isSubagentTask(name: string): boolean {
    return name.toLowerCase() === 'task';
  }

  function toolResultFailed(value: JsonValue | undefined): boolean {
    const result = asRecord(value);
    const metadata = asRecord(result.metadata);
    return result.isError === true || metadata.status === 'failed';
  }

  function activityKind(name: string): AgentActivityKind {
    const normalized = name.toLowerCase();
    if (normalized.includes('read')) return 'reading';
    if (normalized.includes('search') || normalized.includes('web')) return 'searching';
    if (normalized.includes('write') || normalized.includes('edit')) return 'editing';
    if (normalized.includes('mcp')) return 'plugin';
    return 'running';
  }

  function activityLabel(name: string): string {
    return name.replaceAll('_', ' ').replaceAll('-', ' ').replace(/^./, (first) => first.toUpperCase());
  }
</script>

<svelte:window
  bind:innerWidth={viewportWidth}
  on:focus={() => windowActive = true}
  on:blur={() => windowActive = false}
/>

<main
  class:has-conversation={active.messages.length > 0 || (voiceOpen && voiceInChat)}
  class:voice-in-chat={voiceOpen && voiceInChat}
  class:empty-voice-chat={voiceStartedEmpty && voiceOpen && voiceInChat}
  class:panel-open={mode !== 'none'}
  class:workspace-open={mode === 'workspace'}
  class:summary-open={mode === 'summary'}
  class:workspace-expanded={workspaceExpanded}
  class:workspace-resizing={workspaceResizing}
  class:history-resizing={historyResizing}
  class:history-open={historyOpen}
  class:has-queue={queueHeight > 0}
  style={`--history-column: ${historyOpen ? historyWidth : 0}px; --history-offset: ${historyOpen ? historyWidth : 0}px; --content-right-column: ${contentRightColumn}; --content-composer-column: ${composerColumn}; --content-docked-column: ${workspaceWidth}px; --workspace-panel-width: ${workspacePanelWidth}; --workspace-expanded-tab-left: ${historyOpen ? 8 : 44}px; --history-panel-width: ${historyWidth}px; --queue-height: ${queueHeight}px; --timeline-left: ${timelineLeft}px`}
>
  <div class="window-drag-region" aria-hidden="true"></div>
  <div class:visible={!windowActive} class="inactive-traffic-lights" aria-hidden="true">
    <i></i><i></i><i></i>
  </div>

  <TitleBar
    title={active.title}
    showTitle={active.messages.length > 0}
    showSummary={active.messages.length > 0 && !workspaceClearing}
    hideNewChat={workspaceExpanded}
    {historyOpen}
    {mode}
    onRename={rename}
    onToggleHistory={() => historyOpen = !historyOpen}
    onNewChat={newChat}
    onTogglePanel={togglePanel}
  />

  <HistoryDrawer
    chats={historyChats}
    {activeId}
    open={historyOpen}
    width={historyWidth}
    resizing={historyResizing}
    reservedWidth={mode === 'workspace' && !workspaceExpanded ? MIN_WORKSPACE_WIDTH : 0}
    onOpen={openChat}
    onRename={renameHistory}
    onDelete={deleteHistory}
    onResize={(value) => { panelPriority = 'history'; historyWidth = value; }}
    onResizeState={(value) => historyResizing = value}
  />

  {#if showTimelineRail}<TimelineRail items={timeline}/>{/if}

  <ChatPane
    messages={active.messages}
    {running}
    goal={active.goal ?? null}
    speechMode={voiceOpen && voiceInChat}
    {speechModeEnabled}
    {showJumpToLatest}
    onSend={send}
    onStop={stop}
    onVoice={openVoice}
    onOptions={() => optionsOpen = true}
    onEditGoal={editGoal}
    onToggleGoalPaused={toggleGoalPaused}
    onDeleteGoal={deleteGoal}
    onQueueHeight={(value) => queueHeight = value}
    onJumpAvailability={(value) => showJumpToLatest = value}
    onEdit={editMessage}
    onFeedback={setFeedback}
  />

  {#if voiceOpen}
    <SpeechOrb
      state="listening"
      inChat={voiceInChat}
      muted={voiceMuted}
      {outputMuted}
      paused={voicePaused}
      onToggleChat={() => voiceInChat = !voiceInChat}
      onToggleMuted={() => voiceMuted = !voiceMuted}
      onToggleOutputMuted={() => outputMuted = !outputMuted}
      onTogglePaused={() => voicePaused = !voicePaused}
      onClose={closeVoice}
    />
  {/if}

  {#if mode === 'summary'}
    <SummaryPanel
      {outputs}
      {references}
      {tasks}
      onOpenOutput={(output) => openTab({id: output.id, title: output.name, kind: 'document'})}
      onOpenReference={(reference) => openTab({id: reference.id, title: reference.title, kind: reference.kind === 'web' ? 'browser' : 'document', url: reference.uri})}
      onViewAll={viewSummary}
      onCreateOutput={createOutput}
      onAttachReferences={attachReferences}
    />
  {/if}

  <WorkspaceDrawer
    tabs={workspaceTabs}
    {activeTabId}
    open={mode === 'workspace'}
    expanded={workspaceExpanded}
    resizing={workspaceResizing}
    reservedWidth={historyOpen ? MIN_HISTORY_WIDTH : 0}
    summaryData={{outputs, references, tasks}}
    onSelect={(id) => activeTabId = id}
    onClose={closeTab}
    onNew={newTab}
    onToggleExpand={() => workspaceExpanded = !workspaceExpanded}
    onResize={(value) => { panelPriority = 'workspace'; workspaceWidth = value; }}
    onResizeState={(value) => workspaceResizing = value}
    browserObscured={optionsOpen || (voiceOpen && !voiceInChat)}
    onTabState={(id, patch) => workspaceTabs = workspaceTabs.map((tab) => tab.id === id ? {...tab, ...patch, title: patch.title ?? tab.title, url: patch.url ?? tab.url} : tab)}
  />

  {#if optionsOpen}<OptionsModal
    onClose={() => optionsOpen = false}
    onGeneralChange={(settings) => {
      speechModeEnabled = settings.speechModeEnabled;
      if (!speechModeEnabled) closeVoice();
    }}
  />{/if}

  {#if startupVisible}
    <div class:leaving={startupLeaving} class="startup-splash" role="status" aria-label="Loading Midas">
      <div class="startup-brand">
        <img src="polymux.svg" alt="" aria-hidden="true"/>
        <span>Midas</span>
      </div>
    </div>
  {/if}

  <Tooltip/>
</main>

<style>
  .startup-splash{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;pointer-events:none;background:var(--app-bg)}
  .startup-splash.leaving{animation:startup-cover-out .24s ease forwards}
  .startup-brand{position:relative;left:-10px;display:flex;align-items:center;gap:8px;opacity:.78;animation:startup-brand-in 2s cubic-bezier(.22,1,.36,1) forwards}
  .startup-brand img{width:48px;height:39px;display:block;object-fit:contain}
  .startup-brand span{color:var(--neutral-950);font-size:32px;font-weight:750;letter-spacing:-.045em;line-height:1;text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased}
  :global(:root[data-theme="dark"]) .startup-brand img{filter:invert(1)}
  @keyframes startup-brand-in{from{left:-10px;opacity:.78}to{left:0;opacity:1}}
  @keyframes startup-cover-out{from{opacity:1}to{opacity:0}}
  @media (prefers-reduced-motion:reduce){.startup-splash{animation:none;opacity:1}.startup-brand{left:0;animation:none;opacity:1}}
</style>
