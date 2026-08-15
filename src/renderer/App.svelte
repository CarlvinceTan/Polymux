<script lang="ts">
  import {onDestroy, onMount} from 'svelte';
  import {readableError} from './lib/errors';
  import type {ArtifactDto, ConversationDto, DriveProviderId, DriveStatusDto, GoalDto, JsonValue, MessageDto, ReasoningEffort, ReferenceDto, RunEventDto} from '@midas/protocol';
  import TitleBar from './lib/components/chat/TitleBar.svelte';
  import ChatPane, {type ChatMessage} from './lib/components/chat/ChatPane.svelte';
  import TimelineRail, {TIMELINE_RAIL_MINIMUM} from './lib/components/chat/TimelineRail.svelte';
  import type {ActiveGoal} from './lib/components/chat/GoalBar.svelte';
  import SpeechOrb from './lib/components/chat/SpeechOrb.svelte';
  import ChatDrawer, {type ChatEntry} from './lib/components/shell/ChatDrawer.svelte';
  import SummaryPanel, {type SummarySection, type ReferenceItem} from './lib/components/workspace/SummaryPanel.svelte';
  import WorkspaceDrawer, {SINGLETON_TAB_IDS, type WorkspaceTab, type WorkspaceTabKind} from './lib/components/workspace/WorkspaceDrawer.svelte';
  import {driveEntryKind, type DriveEntry} from './lib/components/workspace/DriveView.svelte';
  import type {ScheduleItem, ScheduleFrequency} from './lib/components/workspace/ScheduleView.svelte';
  import Tooltip from './lib/components/shared/Tooltip.svelte';
  import {recordVisit} from './lib/browser/visitHistory';
  import SettingsModal from './lib/components/settings/SettingsModal.svelte';
  import Onboarding from './lib/components/onboarding/Onboarding.svelte';
  import {midasApi} from './lib/api/midas';
  import {applyTheme, startThemeSync} from './lib/theme';
  import {
    conversationPanelState,
    initialPanelState,
    summaryWasDismissed,
    togglePanelState,
    type PanelState,
  } from './lib/state/panels';
  import {
    MIN_CHAT_DRAWER_WIDTH,
    MIN_WORKSPACE_WIDTH,
    SPLIT_LAYOUT_MIN_WIDTH,
    SUMMARY_RESERVED_COLUMN,
    resolvePanelWidths,
  } from './lib/layout/layoutSizing';
  import {activityPresentation, upsertActivity} from './lib/conversation/activities';
  import type {AgentActivityItem} from './lib/components/chat/AgentActivity.svelte';

  type Conversation = ChatEntry & {messages: ChatMessage[]; goal?: ActiveGoal};
  type SummaryTask = {id: string; title: string; status: 'pending' | 'active' | 'completed' | 'failed'};
  type QueuedSend = {id: string; text: string; files: File[]; asGoal: boolean};

  const api = midasApi();
  let conversations: Conversation[] = [];
  let activeId = '';
  let draftConversation: Conversation = emptyDraft();
  let loadError = '';
  let runByConversation: Record<string, string> = {};
  let liveAssistantByConversation: Record<string, string> = {};
  /** Messages typed while a run was going. They wait their turn instead of
   * interrupting: only ⌘/Ctrl+Enter (or the Steer action on a queued row)
   * reaches a running agent straight away. */
  let queuedByConversation: Record<string, QueuedSend[]> = {};

  // Panel state. Summary and Workspace are mutually exclusive, and Workspace
  // only borrows Summary's space: closing it hands the space back.
  let panelState: PanelState = initialPanelState;
  let summaryDismissed = false;

  let chatDrawerOpen = false;
  let chatDrawerWidth = 240;
  let panelPriority: 'chatDrawer' | 'workspace' = 'workspace';
  let trackedPanels = {chatDrawer: false, workspace: false};
  let chatDrawerResizing = false;
  let workspaceWidth = 420;
  let workspaceResizing = false;
  let workspaceExpanded = false;
  let viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;

  let voiceOpen = false;
  let voiceInChat = false;
  let voiceStartedEmpty = false;
  let voiceMuted = false;
  let outputMuted = false;
  let voicePaused = false;
  let settingsOpen = false;
  let onboardingOpen = false;
  /**
   * Dev-only: `?onboarding` reopens first-run setup over a profile that has
   * already completed it, and keeps it from recording that it ran. Behind
   * `import.meta.env.DEV`, which Vite folds to `false` for a packaged build,
   * so this and everything it guards is dropped from production output.
   */
  const onboardingPreview =
    import.meta.env.DEV && new URLSearchParams(location.search).has('onboarding');
  // index.html paints the splash before this bundle even loads, so startup is
  // driven by taking that element over rather than by rendering one here.
  // (theme-boot's dead-bundle deadline stands down by itself: it only fires
  // on an empty #app, and this mount fills it.)
  const startupSplash = document.getElementById('startup-splash');
  // Main marks the first window of a process as the cold start; a window
  // reopened while the app kept running gets `coldStart=0` and no splash.
  const coldStart = new URLSearchParams(window.location.search).get('coldStart') !== '0';
  let startupVisible = coldStart && startupSplash !== null;
  if (!startupVisible) startupSplash?.remove();
  let startupLeaving = false;
  let startupMinimumElapsed = false;
  let startupReady = false;
  let startupDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let startupRemovalTimer: ReturnType<typeof setTimeout> | undefined;
  let speechModeEnabled = true;
  let dictationAutoStopSeconds: number | null = 6;
  let reasoningLevel: ReasoningEffort = 'medium';
  let windowActive = true;
  let queueHeight = 0;
  /** Text handed back to the composer when a queued message is edited. */
  let composerInsertion: {id: string; text: string} | null = null;
  let showJumpToLatest = false;
  let outputs: Array<{id: string; name: string}> = [];
  let references: ReferenceItem[] = [];
  let tasksByConversation: Record<string, SummaryTask[]> = {};
  let tasks: SummaryTask[] = [];
  let workspaceTabs: WorkspaceTab[] = [];
  let activeTabId: string | null = null;
  /** There is no scheduling backend yet, so the desktop starts empty. The
   * browser demo — the same one that supplies demo chats and mail — seeds a few
   * rows so the view can be worked on outside the app. */
  const demoHour = 3_600_000;
  const demoNow = Date.now();
  let scheduleItems: ScheduleItem[] = window.midas ? [] : [
    {id: 'demo-brief', title: 'Morning brief', frequency: {kind: 'weekly', days: [1, 2, 3, 4, 5], time: '08:00'}, status: 'active', prompt: 'Summarise my inbox and calendar for the day.', nextRunAt: demoNow + 14 * demoHour, lastRunAt: demoNow - 10 * demoHour},
    {id: 'demo-inbox', title: 'Triage inbox', frequency: {kind: 'hourly', interval: 2}, status: 'running', prompt: 'Triage new mail and flag anything that needs a reply.', nextRunAt: demoNow + 2 * demoHour, lastRunAt: demoNow - demoHour},
    {id: 'demo-report', title: 'Weekly spend report', frequency: {kind: 'weekly', days: [5], time: '17:00'}, status: 'paused', prompt: 'Total this week\u2019s spend and compare it to last week.', lastRunAt: demoNow - 96 * demoHour},
    {id: 'demo-backup', title: 'Archive finished work', frequency: {kind: 'weekly', days: [0], time: '02:00'}, status: 'failed', prompt: 'Move finished documents into the archive folder.', nextRunAt: demoNow + 70 * demoHour, lastRunAt: demoNow - 98 * demoHour},
  ];


  $: mode = panelState.mode;
  $: active = activeId ? conversations.find((chat) => chat.id === activeId) ?? draftConversation : draftConversation;
  $: tasks = tasksByConversation[active.id] ?? [];
  $: running = Boolean(runByConversation[active.id]);
  $: queued = (queuedByConversation[active.id] ?? []).map((item) => ({
    id: item.id,
    text: item.text,
    files: item.files.map((file) => ({name: file.name, type: file.type})),
  }));
  $: chatEntries = conversations.map(({id, title, updatedAt}) => ({id, title, updatedAt}));
  $: timeline = buildTimeline(active.messages);

  /**
   * One point per exchange rather than per message: the peek shows the prompt
   * that opened the turn above the reply it drew, so a single hover reads as a
   * question and its answer instead of half of one.
   */
  function buildTimeline(messages: typeof active.messages) {
    const turns: Array<{id: string; prompt: string; reply: string}> = [];
    for (const message of messages) {
      if (!message.text) continue;
      const open = turns[turns.length - 1];
      if (message.role === 'user') turns.push({id: message.id, prompt: message.text, reply: ''});
      else if (open && !open.reply) open.reply = message.text;
      else turns.push({id: message.id, prompt: '', reply: message.text});
    }
    return turns;
  }

  // Must run before anything derived from the panel mode below: reactive
  // statements run in declaration order, so opening Summary after the column
  // derivations would show the card while the grid still reserved no space for it.
  $: syncConversationPanel(active.messages.length > 0, viewportWidth >= SPLIT_LAYOUT_MIN_WIDTH, summaryDismissed);

  $: if (mode !== 'workspace' && workspaceExpanded) workspaceExpanded = false;
  $: applyPanelLayout(viewportWidth, chatDrawerOpen, mode === 'workspace' && !workspaceExpanded, chatDrawerWidth, workspaceWidth);

  $: workspaceColumn = mode === 'workspace' ? `${workspaceWidth}px` : '0px';
  $: workspacePanelWidth = workspaceExpanded
    ? `calc(100vw - ${chatDrawerOpen ? chatDrawerWidth : 0}px)`
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
  $: dockedChatDrawerWidth = viewportWidth >= SPLIT_LAYOUT_MIN_WIDTH && chatDrawerOpen ? chatDrawerWidth : 0;
  $: dockedRightWidth = viewportWidth >= SPLIT_LAYOUT_MIN_WIDTH
    ? mode === 'summary' ? SUMMARY_RESERVED_COLUMN : mode === 'workspace' ? workspaceWidth : 0
    : 0;
  $: chatAreaWidth = Math.max(0, viewportWidth - dockedChatDrawerWidth - dockedRightWidth);
  $: chatColumnWidth = Math.min(792, Math.max(0, chatAreaWidth - 8));
  $: timelineLeft = dockedChatDrawerWidth + 10;
  // The rail's hover shape is a bell curve three points wide on either side of
  // the pointer, so it needs seven turns before it can draw in full. Below that
  // it is a stub that never resolves into the shape, and stands down instead.
  $: showTimelineRail = timeline.length >= TIMELINE_RAIL_MINIMUM && chatAreaWidth >= 880 && !workspaceExpanded;

  onDestroy(() => {
    clearTimeout(startupDeadlineTimer);
    clearTimeout(startupRemovalTimer);
    unsubscribeEvents?.();
    unsubscribeBrowser?.();
    unsubscribeFullscreen?.();
    cancelAnimationFrame(chromeShiftFrame);
    stopThemeSync?.();
  });

  let unsubscribeEvents: (() => void) | undefined;
  let unsubscribeBrowser: (() => void) | undefined;
  let unsubscribeFullscreen: (() => void) | undefined;
  let chromeShiftFrame = 0;
  let stopThemeSync: (() => void) | undefined;

  onMount(() => {
    if (startupVisible) {
      // The cover waits for the slide to finish, which theme-boot announces —
      // the slide starts when the window reaches the screen, so waiting for it
      // rather than for a timer is what makes the whole of it visible.
      if (document.documentElement.dataset.splash === 'done') startupMinimumElapsed = true;
      else document.addEventListener('midas:splash-done', () => {
        startupMinimumElapsed = true;
        finishStartupWhenReady();
      }, {once: true});
      // The splash covers the whole window, so a load that never settles would
      // leave the app unreachable behind it. After eight seconds it lifts and
      // shows whatever did load, error states included.
      startupDeadlineTimer = setTimeout(() => {
        startupMinimumElapsed = true;
        startupReady = true;
        finishStartupWhenReady();
      }, 8000);
    }
    stopThemeSync = startThemeSync();
    const settingsLoad = api.general.get().then((settings) => {
      applyTheme(settings.theme);
      speechModeEnabled = settings.speechModeEnabled;
      dictationAutoStopSeconds = settings.dictationAutoStopSeconds;
      reasoningLevel = settings.reasoningLevel;
      onboardingOpen = onboardingPreview || !settings.onboardingCompleted;
      // Setup explains each permission and lets the user start the prompt
      // itself. Asking here would fire the macOS dialogs first, with no
      // context, which is the surest way to a permanent refusal.
      if (!onboardingOpen) void api.permissions.ensureFirstRun().catch(() => {});
    }).catch(() => {});
    windowActive = document.hasFocus();
    unsubscribeEvents = api.runs.subscribe(handleRunEvent);
    // A tab the agent opened for itself becomes a real workspace tab, so its
    // browsing happens in the open rather than in a view nobody can see.
    unsubscribeBrowser = api.browser.subscribe((event) => {
      if (event.type === 'closed') {
        if (workspaceTabs.some((current) => current.id === event.tabId)) closeTab(event.tabId);
        return;
      }
      if (event.type !== 'opened') return;
      const tab: WorkspaceTab = {id: event.tab.tabId, title: event.tab.title || event.tab.url, kind: 'browser', url: event.tab.url};
      // `show` is the agent answering "show me this" — the one case where it
      // may bring the workspace forward. Otherwise the tab is added quietly and
      // only becomes active if the workspace is already the panel in use, so
      // background browsing never takes the screen off what the user is doing.
      if (event.show) {
        openTab(tab);
        return;
      }
      if (workspaceTabs.some((current) => current.id === tab.id)) return;
      workspaceTabs = [...workspaceTabs, tab];
      if (panelState.mode === 'workspace') activeTabId = tab.id;
    });
    // macOS hides its traffic lights in full screen; the stylesheet keys the
    // room reserved for them off this attribute, so the controls close the gap.
    unsubscribeFullscreen = api.window.subscribeFullscreen((fullscreen) => {
      const root = document.documentElement;
      // Main sends this as the window starts travelling, which is the last
      // moment the renderer can paint anything the screen will show before
      // macOS freezes the contents for its zoom. Either way the flag holds the
      // inset's move unanimated so it is over before that freeze; the two
      // directions differ only in how long it is held, and the stylesheet
      // keys the restore's blanking off the value.
      cancelAnimationFrame(chromeShiftFrame);
      root.dataset.chromeShift = fullscreen ? 'enter' : 'restore';
      root.dataset.fullscreen = String(fullscreen);
      if (fullscreen) {
        // Going in, there is nothing to wait for: two frames and the ordinary
        // transitions are back.
        chromeShiftFrame = requestAnimationFrame(() => {
          chromeShiftFrame = requestAnimationFrame(() => delete root.dataset.chromeShift);
        });
        return;
      }
      // Coming back, the controls stay blank until frames reach the screen
      // again — which is what the gap marks, since frame callbacks stop with
      // the freeze — and the fade plays from there. The elapsed bound covers a
      // transition that never produces such a gap, reduced motion among them.
      const start = performance.now();
      let previous = start;
      const step = (now: number): void => {
        if (now - previous > 120 || now - start > 900) {
          delete root.dataset.chromeShift;
          return;
        }
        previous = now;
        chromeShiftFrame = requestAnimationFrame(step);
      };
      chromeShiftFrame = requestAnimationFrame(step);
    });
    void Promise.all([settingsLoad, loadChats()]).finally(() => {
      startupReady = true;
      finishStartupWhenReady();
    });
  });

  function finishStartupWhenReady(): void {
    if (!startupVisible || startupLeaving || !startupMinimumElapsed || !startupReady) return;
    startupLeaving = true;
    clearTimeout(startupDeadlineTimer);
    startupSplash?.classList.add('leaving');
    startupRemovalTimer = setTimeout(() => {
      startupVisible = false;
      startupSplash?.remove();
    }, 240);
  }

  function syncConversationPanel(hasMessages: boolean, splitLayout: boolean, dismissed: boolean): void {
    const next = conversationPanelState(panelState, {hasMessages, splitLayout, summaryDismissed: dismissed});
    if (next !== panelState) setPanelState(next);
  }

  function setPanelState(next: PanelState): void {
    panelState = next;
  }

  function togglePanel(requested: 'summary' | 'workspace'): void {
    const next = togglePanelState(panelState, requested);
    if (requested === 'summary') summaryDismissed = summaryWasDismissed(panelState, next);
    setPanelState(next);
  }

  function changeReasoningLevel(value: ReasoningEffort): void {
    reasoningLevel = value;
    void api.general.update({reasoningLevel: value}).catch(() => {});
  }

  function openWorkspace(): void {
    if (panelState.mode === 'workspace') return;
    panelState = togglePanelState(panelState, 'workspace');
  }

  function updateActive(mutator: (chat: Conversation) => Conversation): void {
    if (activeId) conversations = conversations.map((chat) => chat.id === activeId ? mutator(chat) : chat);
    else draftConversation = mutator(draftConversation);
  }

  /**
   * The panels belong to the window, not to a chat: Summary and Workspace keep
   * whatever the user left them at while chats change underneath. An expanded
   * Workspace is the one exception — it covers the conversation the user just
   * chose, so switching chats hands the space back without closing the drawer.
   */
  function switchTo(id: string): void {
    stashWorkspace();
    activeId = id;
    workspaceExpanded = false;
  }

  function newChat(): void {
    switchTo('');
    draftConversation = emptyDraft();
    clearConversationResources();
  }

  async function openChat(id: string): Promise<void> {
    switchTo(id);
    await restoreWorkspace(id);
    await loadConversation(id);
    await drainQueue(id);
  }

  async function send(text: string, files: File[], asGoal = false, immediate = false): Promise<void> {
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
    // A run that has not reported its id yet cannot be steered, so those wait
    // in the queue too even when the send asked to go now.
    if (existingRun && !(immediate && !existingRun.startsWith('pending:'))) {
      enqueue(conversationId, {id: crypto.randomUUID(), text, files, asGoal});
      return;
    }
    if (existingRun) {
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
      const {runId} = await api.runs.start({conversationId, text, messageId: userId, attachments: attachmentPaths, asGoal, reasoning: reasoningLevel});
      runByConversation = {...runByConversation, [conversationId]: runId};
      updateLiveAssistant(conversationId, (message) => ({...message, runId}));
      if (asGoal) await refreshGoal(conversationId);
      await loadChats();
    } catch (error) {
      failRun(conversationId, readableError(error));
    }
  }

  async function stop(): Promise<void> {
    const runId = runByConversation[active.id];
    // Stopping means stopping: nothing queued behind this run should start on
    // its own once the cancel lands.
    setQueued(active.id, []);
    if (runId && !runId.startsWith('pending:')) await api.runs.cancel(runId);
  }

  function setQueued(conversationId: string, items: QueuedSend[]): void {
    if (items.length) queuedByConversation = {...queuedByConversation, [conversationId]: items};
    else {
      const next = {...queuedByConversation};
      delete next[conversationId];
      queuedByConversation = next;
    }
  }

  function enqueue(conversationId: string, item: QueuedSend): void {
    setQueued(conversationId, [...(queuedByConversation[conversationId] ?? []), item]);
  }

  function takeQueued(conversationId: string, id: string): QueuedSend | undefined {
    const items = queuedByConversation[conversationId] ?? [];
    const item = items.find((queuedItem) => queuedItem.id === id);
    if (item) setQueued(conversationId, items.filter((queuedItem) => queuedItem.id !== id));
    return item;
  }

  /** Starts the next queued message once the conversation is idle. Only the open
   * conversation drains, because a run always starts against the active chat;
   * the rest wait until they are reopened. */
  async function drainQueue(conversationId: string): Promise<void> {
    if (activeId !== conversationId || runByConversation[conversationId]) return;
    const items = queuedByConversation[conversationId] ?? [];
    if (!items.length) return;
    setQueued(conversationId, items.slice(1));
    await send(items[0].text, items[0].files, items[0].asGoal);
  }

  async function steerQueued(id: string): Promise<void> {
    const item = takeQueued(active.id, id);
    if (item) await send(item.text, item.files, item.asGoal, true);
  }

  function editQueued(id: string): void {
    const item = takeQueued(active.id, id);
    if (item) composerInsertion = {id: item.id, text: item.text};
  }

  function reorderQueued(sourceId: string, targetId: string): void {
    const items = queuedByConversation[active.id] ?? [];
    const from = items.findIndex((item) => item.id === sourceId);
    const to = items.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...items];
    next.splice(to, 0, ...next.splice(from, 1));
    setQueued(active.id, next);
  }

  async function rename(title: string): Promise<void> {
    if (!activeId) { draftConversation = {...draftConversation, title}; return; }
    const updated = await api.conversations.rename(activeId, title);
    if (updated) updateConversation(activeId, (chat) => ({...chat, title: updated.title, updatedAt: Date.parse(updated.updatedAt)}));
  }
  async function renameChatTitle(id: string, title: string): Promise<void> {
    const updated = await api.conversations.rename(id, title);
    if (updated) updateConversation(id, (chat) => ({...chat, title: updated.title, updatedAt: Date.parse(updated.updatedAt)}));
  }
  async function deleteChat(id: string): Promise<void> {
    await api.conversations.remove(id);
    conversations = conversations.filter((chat) => chat.id !== id);
    if (activeId === id) newChat();
  }

  async function loadChats(): Promise<void> {
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
      loadError = readableError(error);
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
      loadError = readableError(error);
    }
  }

  function handleRunEvent(event: RunEventDto): void {
    const conversationId = event.conversationId;
    if (!conversationId) return;
    const payload = asRecord(event.payload);
    if (event.type === 'run.started') runByConversation = {...runByConversation, [conversationId]: event.runId};
    if (event.type === 'message.text.delta') {
      const delta = typeof payload.delta === 'string' ? payload.delta : '';
      updateLiveAssistant(conversationId, (message) => ({
        ...message,
        text: message.text + delta,
        activities: (message.activities ?? []).map((item) => item.kind === 'thinking' && item.status === 'active' ? {...item, status: 'completed'} : item),
      }));
    }
    if (event.type === 'message.reasoning.delta') {
      const id = `${event.runId}:thinking`;
      updateLiveAssistant(conversationId, (message) => ({
        ...message,
        activities: upsertActivity(
          message.activities ?? [],
          {id, kind: 'thinking', status: 'active', label: 'Thinking'},
        ),
      }));
    }
    if (event.type === 'message.completed') {
      const completed = asRecord(payload.message);
      const text = contentText(completed.content);
      // Mid-run narration (tool calls follow) folds into the activity group so
      // only the run's final answer stays as the visible message body.
      if (payload.phase === 'commentary' && text) {
        updateLiveAssistant(conversationId, (message) => ({
          ...message,
          text: '',
          activities: [
            ...(message.activities ?? []),
            {id: `${event.runId}:commentary:${event.sequence}`, kind: 'commentary', status: 'completed', label: text},
          ],
        }));
      } else if (text) {
        updateLiveAssistant(conversationId, (message) => ({...message, text}));
      }
    }
    if (event.type === 'context.compacting') {
      const id = `${event.runId}:compaction`;
      updateLiveAssistant(conversationId, (message) => ({
        ...message,
        activities: upsertActivity(
          (message.activities ?? []).filter((item) => item.status !== 'active' || (item.kind !== 'thinking' && item.kind !== 'compacting')),
          {id, kind: 'compacting', status: 'active', label: 'Optimising Conversation'},
        ),
      }));
    }
    if (event.type === 'context.compacted') {
      const id = `${event.runId}:compaction`;
      updateLiveAssistant(conversationId, (message) => ({
        ...message,
        activities: (message.activities ?? []).map((item) => item.id === id ? {...item, status: 'completed'} : item),
      }));
    }
    if (event.type === 'tool.started') {
      const call = asRecord(payload.toolCall);
      const name = typeof call.name === 'string' ? call.name : 'tool';
      const id = typeof call.id === 'string' ? call.id : crypto.randomUUID();
      const presentation = activityPresentation(name, asRecord(call.arguments));
      updateLiveAssistant(conversationId, (message) => ({
        ...message,
        activities: upsertActivity(
          (message.activities ?? []).filter((item) => item.status !== 'active' || (item.kind !== 'thinking' && item.kind !== 'compacting')),
          {id, ...presentation, status: 'active'},
        ),
      }));
      if (isSubagentTask(name)) {
        const arguments_ = asRecord(call.arguments);
        const description = typeof arguments_.description === 'string' ? arguments_.description.trim() : '';
        updateConversationTasks(conversationId, (current) => [
          ...current.filter((task) => task.id !== id),
          {id, title: description || 'Delegated task', status: 'active'},
        ]);
      }
    }
    if (event.type === 'tool.progress') {
      const id = typeof payload.toolCallId === 'string' ? payload.toolCallId : '';
      const label = typeof payload.message === 'string' ? payload.message.trim() : '';
      // Each progress report becomes a sub-step of its tool's activity row;
      // starting a new step settles the one before it.
      if (id && label) updateLiveAssistant(conversationId, (message) => ({
        ...message,
        activities: (message.activities ?? []).map((item) => item.id === id ? {
          ...item,
          steps: [
            ...(item.steps ?? []).map((step) => step.status === 'active' ? {...step, status: 'completed' as const} : step),
            {id: `${id}:${event.sequence}`, label, status: 'active' as const},
          ],
        } : item),
      }));
    }
    if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      const call = asRecord(payload.toolCall);
      const name = typeof call.name === 'string' ? call.name : 'tool';
      const id = typeof call.id === 'string' ? call.id : '';
      const detail = activityResultDetail(payload);
      const status = event.type === 'tool.failed' ? 'failed' as const : 'completed' as const;
      updateLiveAssistant(conversationId, (message) => ({...message, activities: (message.activities ?? []).map((item) => item.id === id ? {
        ...item,
        status,
        result: detail || item.result,
        steps: item.steps?.map((step) => step.status === 'active' ? {...step, status} : step),
      } : item)}));
      if (isSubagentTask(name)) {
        const status = event.type === 'tool.failed' || toolResultFailed(payload.result) ? 'failed' : 'completed';
        updateConversationTasks(conversationId, (current) => current.map((task) => task.id === id ? {...task, status} : task));
      }
      // Pages read and files written land in Summary as the run works, rather
      // than all at once when it settles.
      if (event.type === 'tool.completed') scheduleResourceRefresh(conversationId);
    }
    if (event.type === 'run.completed' || event.type === 'run.cancelled' || event.type === 'run.failed') {
      const completedAt = new Date(event.timestamp).toISOString();
      const failure = event.type === 'run.failed' ? runFailureMessage(payload) : '';
      const result = asRecord(payload.result);
      // A run that invoked no tools is a plain reply: drop its activity trail
      // (a seeded "Thinking" row at most) so no "Worked for Ns" group renders.
      const noWork = event.type === 'run.completed' && result.hadWorkActivity === false;
      const lastAgentMessage = typeof result.lastAgentMessage === 'string' ? result.lastAgentMessage : '';
      updateLiveAssistant(conversationId, (message) => ({
        ...message,
        text: failure && !message.text ? failure : message.text || lastAgentMessage,
        sentAt: completedAt,
        completedAt,
        activities: noWork
          ? []
          : (message.activities ?? []).map((item) => ({...item, status: item.status === 'active' ? (event.type === 'run.failed' ? 'failed' : 'completed') : item.status})),
      }));
      updateConversationTasks(conversationId, (current) => current.map((task) => task.status === 'active'
        ? {...task, status: event.type === 'run.completed' ? 'completed' : 'failed'}
        : task));
      const next = {...runByConversation}; delete next[conversationId]; runByConversation = next;
    }
    if (event.type === 'run.settled') void settleConversation(conversationId);
  }

  let resourceRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  /** Tool calls finish in bursts; one refresh per quiet moment is enough. */
  function scheduleResourceRefresh(conversationId: string): void {
    if (activeId !== conversationId) return;
    clearTimeout(resourceRefreshTimer);
    resourceRefreshTimer = setTimeout(() => { void refreshResources(conversationId); }, 500);
  }

  async function refreshResources(conversationId: string): Promise<void> {
    if (activeId !== conversationId) return;
    try {
      const [artifacts, storedReferences] = await Promise.all([
        api.resources.artifacts(conversationId),
        api.resources.references(conversationId),
      ]);
      if (activeId === conversationId) applyResources(artifacts, storedReferences);
    } catch {
      // A refresh that misses is retried by the next tool call, and by settle.
    }
  }

  async function settleConversation(conversationId: string): Promise<void> {
    const stored = await api.conversations.messages(conversationId);
    const current = conversations.find((chat) => chat.id === conversationId)?.messages ?? [];
    updateConversation(conversationId, (chat) => ({...chat, messages: mergeMessages(stored, current)}));
    await persistActivities(stored, current);
    const next = {...liveAssistantByConversation}; delete next[conversationId]; liveAssistantByConversation = next;
    await Promise.all([refreshGoal(conversationId), loadChats()]);
    clearTimeout(resourceRefreshTimer);
    await refreshResources(conversationId);
    await drainQueue(conversationId);
  }

  /** Once a run settles, the live assistant row holds the final activities,
   * duration and completion time. Persist them into the stored assistant
   * message's metadata so a reloaded chat still shows "Worked for Ns" and the
   * expanded activity list exactly as it looked during the run. */
  async function persistActivities(stored: MessageDto[], current: ChatMessage[]): Promise<void> {
    const settled = stored.filter((message) => message.role === 'assistant' && message.runId);
    for (const storedMessage of settled) {
      const live = current.find((item) => item.role === 'assistant' && item.runId === storedMessage.runId);
      if (!live || !live.activities?.length) continue;
      const existing = asRecord(storedMessage.metadata);
      await api.conversations.updateMessage(storedMessage.id, {
        metadata: {
          ...existing,
          activities: live.activities as JsonValue,
          startedAt: live.startedAt ?? null,
          completedAt: live.completedAt ?? null,
        },
      });
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

  /** Tab kinds a stored snapshot may re-create; anything else is stale data. */
  const RESTORABLE_TAB_KINDS = new Set<WorkspaceTabKind>(['document', 'slides', 'sheet', 'photo', 'video', 'browser', 'side-chat', 'summary', 'drive', 'schedule', 'hub']);
  /** True while a snapshot is being applied, so the auto-save sits out. */
  let workspaceRestoring = false;
  let workspaceSaveTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Saves the outgoing chat's workspace and releases its live browser pages.
   * A past chat keeps its layout, not its sessions: reopening re-creates the
   * tabs and a browser tab reloads its url.
   */
  function stashWorkspace(): void {
    const leaving = activeId;
    if (!leaving) return;
    const snapshot = {
      tabs: workspaceTabs.map((tab) => ({...tab})),
      activeTabId,
      open: mode === 'workspace',
    };
    void api.workspace.saveSnapshot(leaving, snapshot).catch(() => {});
    for (const tab of workspaceTabs)
      if (tab.kind === 'browser') void api.browser.close(tab.id).catch(() => {});
  }

  async function restoreWorkspace(id: string): Promise<void> {
    workspaceRestoring = true;
    try {
      const saved = await api.workspace.snapshot(id).catch(() => null);
      const tabs = (saved?.tabs ?? [])
        .filter((tab) => RESTORABLE_TAB_KINDS.has(tab.kind as WorkspaceTabKind))
        .map((tab) => ({
          id: tab.id,
          title: tab.title,
          kind: tab.kind as WorkspaceTabKind,
          ...(tab.url ? {url: tab.url} : {}),
          ...(tab.favicon ? {favicon: tab.favicon} : {}),
          ...(tab.section ? {section: tab.section as 'outputs' | 'references' | 'tasks'} : {}),
        }));
      workspaceTabs = tabs;
      activeTabId =
        saved?.activeTabId && tabs.some((tab) => tab.id === saved.activeTabId)
          ? saved.activeTabId
          : (tabs[0]?.id ?? null);
      // The snapshot still records whether the drawer was showing, but opening
      // it is no longer the chat's call: whether Workspace is open follows the
      // window, so restoring only re-creates what was inside it.
    } finally {
      workspaceRestoring = false;
    }
  }

  /** Debounced save of the open chat's layout, so quitting mid-chat keeps it. */
  function scheduleWorkspaceSave(): void {
    if (workspaceRestoring || !activeId) return;
    if (workspaceSaveTimer) clearTimeout(workspaceSaveTimer);
    const conversationId = activeId;
    const snapshot = {
      tabs: workspaceTabs.map((tab) => ({...tab})),
      activeTabId,
      open: mode === 'workspace',
    };
    workspaceSaveTimer = setTimeout(() => {
      void api.workspace.saveSnapshot(conversationId, snapshot).catch(() => {});
    }, 400);
  }

  $: workspaceTabs, activeTabId, mode, scheduleWorkspaceSave();

  function applyResources(artifacts: ArtifactDto[], storedReferences: ReferenceDto[]): void {
    outputs = artifacts.map(({id, name}) => ({id, name}));
    references = storedReferences.map(({id, title, kind, uri}) => ({id, title, kind, uri}));
    const resourceTabs = artifacts.map(artifactTab);
    workspaceTabs = [...workspaceTabs.filter((tab) => tab.kind === 'side-chat' || tab.kind === 'summary' || tab.kind === 'drive' || tab.kind === 'schedule' || tab.kind === 'hub' || tab.kind === 'browser'), ...resourceTabs];
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

  const singletonTitles: Partial<Record<WorkspaceTabKind, string>> = {drive: 'Drive', schedule: 'Schedule', 'side-chat': 'Chat', hub: 'Hub'};

  function newTab(kind: WorkspaceTabKind = 'document'): void {
    const singletonId = SINGLETON_TAB_IDS[kind];
    if (singletonId) openTab({id: singletonId, title: singletonTitles[kind] ?? 'New tab', kind});
    else openTab({id: crypto.randomUUID(), title: 'New tab', kind});
  }

  /** Sizes and dates the desktop has no local filesystem to report yet, so the
   * browser demo supplies a folder that exercises every column. */
  const demoDriveFiles: DriveEntry[] = window.midas ? [] : [
    {id: 'demo-f1', name: 'Launch plan.docx', kind: 'document', size: 48_310, modifiedAt: demoNow - 2 * demoHour},
    {id: 'demo-f2', name: 'Q3 regional revenue breakdown (final).xlsx', kind: 'spreadsheet', size: 1_284_912, modifiedAt: demoNow - 26 * demoHour},
    {id: 'demo-f3', name: 'Launch deck.pptx', kind: 'presentation', size: 8_420_115, modifiedAt: demoNow - 50 * demoHour},
    {id: 'demo-f4', name: 'hero.png', kind: 'image', size: 640_220, modifiedAt: demoNow - 5 * demoHour},
    {id: 'demo-f5', name: 'walkthrough.mp4', kind: 'video', size: 42_118_300, modifiedAt: demoNow - 120 * demoHour},
    {id: 'demo-f6', name: 'notes.md', kind: 'document', size: 3_902, modifiedAt: demoNow - demoHour},
  ];

  /** The agent's files for this conversation, browsable as a small tree: what it
   * produced and what it was given, kept apart. */
  $: conversationDriveRoot = {
    id: 'drive-root',
    name: 'Drive',
    kind: 'folder',
    children: [
      {id: 'drive-outputs', name: 'Outputs', kind: 'folder', children: [...demoDriveFiles, ...outputs.map(({id, name}) => ({id, name, kind: driveEntryKind(name)}))]},
      {id: 'drive-references', name: 'References', kind: 'folder', children: references.map(({id, title, kind, uri}) => ({
        id,
        name: title,
        kind: kind === 'web' ? 'file' : driveEntryKind(title),
        uri,
      }))},
    ],
  } satisfies DriveEntry;

  /**
   * Storage, beyond this conversation's own files.
   *
   * The conversation tree stays the default source because it is what the
   * drive is for most of the time; connected providers join it as further
   * sources, each browsed a folder at a time.
   */
  const CONVERSATION_SOURCE = 'conversation';
  let driveStatus: DriveStatusDto | null = null;
  let driveSourceId = CONVERSATION_SOURCE;
  let driveLoading = false;
  /** Folders already fetched, keyed `<provider>:<path>`. Cleared when the
   * source changes, since a path only means something inside its provider. */
  let driveFolders: Record<string, DriveEntry[]> = {};

  onMount(() => {
    void loadDriveStatus();
    return api.drive.subscribe((next) => {
      driveStatus = next;
    });
  });

  async function loadDriveStatus(): Promise<void> {
    try {
      driveStatus = await api.drive.status();
    } catch {
      // A drive that cannot be reached is not a reason to fail the workspace;
      // the source picker simply offers this conversation alone.
    }
  }

  $: driveSources = [
    {id: CONVERSATION_SOURCE, name: 'This chat'},
    // Only connected providers are offered: a source in the switch is a
    // promise that opening it will show something.
    ...(driveStatus?.providers ?? [])
      .filter((provider) => provider.state === 'connected')
      .map((provider) => ({id: provider.id, name: provider.name})),
  ];

  $: driveRoot =
    driveSourceId === CONVERSATION_SOURCE
      ? conversationDriveRoot
      : ({
          id: 'drive-root',
          name: driveSources.find((source) => source.id === driveSourceId)?.name ?? 'Drive',
          kind: 'folder',
          // The root's path is the empty string for every provider, which is
          // what lets one tree builder serve all of them. `driveFolders` is
          // named here rather than only inside the builder because a reactive
          // statement tracks what it references itself, not what its callees
          // read — without it the tree would never see a folder arrive.
          children: driveBranch(driveFolders, driveSourceId, ''),
        } satisfies DriveEntry);

  /**
   * Builds a folder's children out of what has been fetched, attaching each
   * subfolder's own children when those have been fetched too. Anything not
   * loaded yet is simply an empty folder until walking into it asks for it.
   */
  function driveBranch(
    folders: Record<string, DriveEntry[]>,
    source: string,
    path: string,
  ): DriveEntry[] {
    return (folders[`${source}:${path}`] ?? []).map((entry) =>
      entry.kind === 'folder'
        ? {...entry, children: driveBranch(folders, source, entry.id)}
        : entry);
  }

  function selectDriveSource(id: string): void {
    driveSourceId = id;
    driveFolders = {};
    if (id !== CONVERSATION_SOURCE) void loadDriveFolder('');
  }

  /** Fetches one folder from the active provider. */
  async function loadDriveFolder(path: string): Promise<void> {
    if (driveSourceId === CONVERSATION_SOURCE) return;
    const provider = driveSourceId as DriveProviderId;
    driveLoading = true;
    try {
      const entries = await api.drive.list(provider, path);
      driveFolders = {
        ...driveFolders,
        [`${provider}:${path}`]: entries.map((entry) => ({
          // The provider's path is the id the drive navigates by: it is
          // unique within the provider and is what every action takes back.
          id: entry.path,
          name: entry.name,
          kind: entry.kind === 'folder' ? 'folder' : driveEntryKind(entry.name),
          size: entry.size ?? undefined,
          modifiedAt: entry.modifiedAt ? Date.parse(entry.modifiedAt) : undefined,
          children: entry.kind === 'folder' ? [] : undefined,
          // Carried onto the row so it can wear its provider's mark, the way
          // the old browser badged a file with where it lives.
          provider: entry.provider,
        })),
      };
    } catch (cause) {
      console.error('Listing the drive folder failed', cause);
    } finally {
      driveLoading = false;
    }
  }

  /**
   * The drive's toolbar actions, live only on a real storage provider — the
   * conversation tree is a view of what the agent produced, not a folder
   * anything can be written into.
   */
  $: driveActions =
    driveSourceId === CONVERSATION_SOURCE
      ? null
      : {
          newFolder: (parent: DriveEntry, name: string) => void runDriveAction(async (provider) => {
            await api.drive.createFolder(provider, driveFolderPath(parent), name);
            return driveFolderPath(parent);
          }),
          upload: (parent: DriveEntry) => void runDriveAction(async (provider) => {
            // No paths means the main process opens a file picker.
            await api.drive.upload(provider, driveFolderPath(parent));
            return driveFolderPath(parent);
          }),
          rename: (entry: DriveEntry, name: string) => void runDriveAction(async (provider) => {
            await api.drive.rename(provider, entry.id, name);
            return driveParentPath(entry);
          }),
          move: (entries: DriveEntry[], destination: DriveEntry) => void runDriveAction(async (provider) => {
            const from = driveParentPath(entries[0]);
            await api.drive.move(provider, entries.map((entry) => entry.id), driveFolderPath(destination));
            // Both ends of the move changed, and the destination is only
            // worth re-reading if it has ever been opened.
            await loadDriveFolder(driveFolderPath(destination));
            return from;
          }),
          duplicate: (entries: DriveEntry[]) => void runDriveAction(async (provider) => {
            await api.drive.copy(provider, entries.map((entry) => entry.id));
            return driveParentPath(entries[0]);
          }),
          download: (entry: DriveEntry) => void runDriveAction(async (provider) => {
            await api.drive.download(provider, entry.id);
            return null;
          }),
          remove: (entries: DriveEntry[]) => void runDriveAction(async (provider) => {
            await api.drive.remove(provider, entries.map((entry) => entry.id));
            return driveParentPath(entries[0]);
          }),
        };

  /** Runs a drive action and reloads whichever folder it changed. */
  async function runDriveAction(
    action: (provider: DriveProviderId) => Promise<string | null>,
  ): Promise<void> {
    if (driveSourceId === CONVERSATION_SOURCE) return;
    try {
      const reload = await action(driveSourceId as DriveProviderId);
      if (reload !== null) await loadDriveFolder(reload);
    } catch (cause) {
      console.error('The drive action failed', cause);
    }
  }

  /** The root folder's path is the empty string, not its synthetic id. */
  function driveFolderPath(entry: DriveEntry): string {
    return entry.id === 'drive-root' ? '' : entry.id;
  }

  /** Which folder an entry sits in, so a change to it reloads the right one.
   * Found by search rather than by trimming the path, because a provider's
   * paths may be opaque ids with no parent inside them. */
  function driveParentPath(entry: DriveEntry): string {
    for (const [key, children] of Object.entries(driveFolders))
      if (children.some((child) => child.id === entry.id))
        return key.slice(key.indexOf(':') + 1);
    return '';
  }

  function openDriveEntry(entry: DriveEntry): void {
    openTab({id: entry.id, title: entry.name, kind: entry.kind === 'image' ? 'photo' : entry.kind === 'video' ? 'video' : entry.kind === 'spreadsheet' ? 'sheet' : entry.kind === 'presentation' ? 'slides' : 'document'});
  }

  function toggleSchedule(item: ScheduleItem): void {
    scheduleItems = scheduleItems.map((entry) => entry.id === item.id
      ? {...entry, status: entry.status === 'paused' ? 'active' : 'paused'}
      : entry);
  }

  function deleteSchedule(item: ScheduleItem): void {
    scheduleItems = scheduleItems.filter((entry) => entry.id !== item.id);
  }

  function updateScheduleFrequency(item: ScheduleItem, frequency: ScheduleFrequency): void {
    scheduleItems = scheduleItems.map((entry) => entry.id === item.id ? {...entry, frequency} : entry);
  }

  /** Running a schedule by hand is the same ask the schedule itself makes, so
   * it goes through the chat rather than a side channel: the run then has a
   * conversation to report into, like every other one. */
  function runScheduleNow(item: ScheduleItem): void {
    workspaceExpanded = false;
    void send(item.prompt ?? item.title, []);
  }

  /**
   * There is no scheduling backend yet, so creating one is a request rather
   * than a form: the composer is seeded with the sentence the agent needs and
   * the user finishes it in their own words.
   */
  function createSchedule(): void {
    workspaceExpanded = false;
    composerInsertion = {id: crypto.randomUUID(), text: 'Schedule this for me: '};
  }

  function openVisit(url: string, title: string): void {
    openTab({id: crypto.randomUUID(), title, kind: 'browser', url});
  }

  /**
   * A link the agent mentioned. Pages it worked on in the user's own browser
   * belong there — that tab already holds the session and the state the work
   * depends on — and everything else opens in the in-app Browser, which is the
   * default surface. A page already open in a workspace tab is just revealed.
   */
  /** A link in a message opens in the system browser: following one is leaving
   * the conversation, not asking Midas to work on the page — the workspace
   * browser stays for pages Midas itself is on. */
  function openLink(url: string): void {
    void api.browser.openExternal(url);
  }

  /** The embedded browser reports its page as it settles, which is also where
   * a visit becomes worth remembering for the launcher. */
  function updateTabState(id: string, patch: {title?: string; url?: string; favicon?: string | null}): void {
    workspaceTabs = workspaceTabs.map((tab) => tab.id === id
      ? {...tab, ...patch, title: patch.title ?? tab.title, url: patch.url ?? tab.url, favicon: patch.favicon === undefined ? tab.favicon : patch.favicon}
      : tab);
    const tab = workspaceTabs.find((entry) => entry.id === id);
    // Browsing the user does here is their own; Summary lists what the agent
    // used, so only agent-driven pages become references.
    if (tab?.kind === 'browser' && tab.url) recordVisit({url: tab.url, title: tab.title, favicon: tab.favicon});
  }

  /** A workspace suggestion is a request for the agent, so it goes straight to
   * the chat as the user's own message. The panel gives up its expanded state
   * first, since the conversation is behind it. */
  function suggestPrompt(text: string): void {
    workspaceExpanded = false;
    void send(text, []);
  }

  function viewSummary(section: SummarySection): void {
    openTab({id: `summary-${section}`, title: section[0].toUpperCase() + section.slice(1), kind: 'summary', section});
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
  function applyPanelLayout(viewport: number, chatDrawerActive: boolean, workspaceActive: boolean, currentChatDrawer: number, currentWorkspace: number): void {
    if (chatDrawerActive && !trackedPanels.chatDrawer) panelPriority = 'chatDrawer';
    if (workspaceActive && !trackedPanels.workspace) panelPriority = 'workspace';
    trackedPanels = {chatDrawer: chatDrawerActive, workspace: workspaceActive};
    if (viewport < SPLIT_LAYOUT_MIN_WIDTH) return;
    const resolved = resolvePanelWidths({
      viewportWidth: viewport,
      chatDrawerOpen: chatDrawerActive,
      workspaceOpen: workspaceActive,
      chatDrawerWidth: currentChatDrawer,
      workspaceWidth: currentWorkspace,
      priority: panelPriority,
    });
    if (resolved.chatDrawerWidth !== chatDrawerWidth) chatDrawerWidth = resolved.chatDrawerWidth;
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
    const visibleStored = stored.filter((message, index, messages) =>
      message.role !== 'assistant'
      || !message.runId
      || !messages.slice(index + 1).some((later) => later.role === 'assistant' && later.runId === message.runId),
    );
    const mapped = visibleStored
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      // The goal loop writes its own continuation prompts as user messages so
      // the agent sees them; the user never typed them, so they stay hidden.
      .filter((message) => asRecord(message.metadata).goalContinuation !== true)
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
    // message) while the chat-list refresh already contains its user message.
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
    const activities = Array.isArray(metadata.activities) ? metadata.activities as AgentActivityItem[] : undefined;
    return {
      id: message.id,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      text: contentText(message.content),
      files: message.attachments.map((attachment) => attachment.name),
      sentAt: message.createdAt,
      asGoal: metadata.asGoal === true,
      feedback,
      runId: message.runId ?? undefined,
      activities,
      startedAt: typeof metadata.startedAt === 'string' ? metadata.startedAt : undefined,
      completedAt: typeof metadata.completedAt === 'string' ? metadata.completedAt : undefined,
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
    if (authenticationFailure)
      return 'Unable to respond: The selected provider rejected its saved API key. Remove it or add a valid key in Settings → Provider.';
    const rateLimited = /(?:rate.?limit|429|too many requests|quota|usage limit|free.?usage)/i.test(message);
    if (rateLimited)
      return 'Unable to respond: The provider is temporarily rate-limiting requests. Wait a moment, then try again.';
    return `Unable to respond: ${message}`;
  }

  function isSubagentTask(name: string): boolean {
    return name.toLowerCase() === 'task';
  }

  /** A short excerpt of a tool's output for the row's expandable detail —
   * enough to see what the call produced without opening the raw transcript. */
  function activityResultDetail(payload: Record<string, JsonValue>): string {
    const text = contentText(asRecord(payload.result).content ?? asRecord(payload.error).message).trim();
    return text.length > 280 ? `${text.slice(0, 280)}…` : text;
  }

  function toolResultFailed(value: JsonValue | undefined): boolean {
    const result = asRecord(value);
    const metadata = asRecord(result.metadata);
    return result.isError === true || metadata.status === 'failed';
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
  class:chat-drawer-resizing={chatDrawerResizing}
  class:chat-drawer-open={chatDrawerOpen}
  class:has-queue={queueHeight > 0}
  style={`--chat-drawer-column: ${chatDrawerOpen ? chatDrawerWidth : 0}px; --chat-drawer-offset: ${chatDrawerOpen ? chatDrawerWidth : 0}px; --content-right-column: ${contentRightColumn}; --content-composer-column: ${composerColumn}; --content-docked-column: ${workspaceWidth}px; --workspace-panel-width: ${workspacePanelWidth}; --workspace-expanded-tab-left: ${chatDrawerOpen ? "8px" : "calc(var(--chrome-inset) + 8px + var(--titlebar-control-size) + var(--titlebar-control-lead))"}; --chat-drawer-panel-width: ${chatDrawerWidth}px; --queue-height: ${queueHeight}px; --timeline-left: ${timelineLeft}px`}
>
  <div class="window-drag-region" aria-hidden="true"></div>
  <div class:visible={!windowActive} class="inactive-traffic-lights" aria-hidden="true">
    <i></i><i></i><i></i>
  </div>

  <TitleBar
    title={active.title}
    showTitle={active.messages.length > 0}
    showSummary={mode === 'summary' || active.messages.length > 0}
    hideNewChat={workspaceExpanded}
    {chatDrawerOpen}
    {mode}
    onRename={rename}
    onToggleChatDrawer={() => chatDrawerOpen = !chatDrawerOpen}
    onNewChat={newChat}
    onTogglePanel={togglePanel}
    onOpenSettings={() => settingsOpen = true}
    onOpenDrive={() => newTab('drive')}
    onOpenHub={() => newTab('hub')}
    onOpenSchedule={() => newTab('schedule')}
  />

  <ChatDrawer
    chats={chatEntries}
    {activeId}
    open={chatDrawerOpen}
    width={chatDrawerWidth}
    resizing={chatDrawerResizing}
    reservedWidth={mode === 'workspace' && !workspaceExpanded ? MIN_WORKSPACE_WIDTH : 0}
    onOpen={openChat}
    onRename={renameChatTitle}
    onDelete={deleteChat}
    onResize={(value) => { panelPriority = 'chatDrawer'; chatDrawerWidth = value; }}
    onResizeState={(value) => chatDrawerResizing = value}
  />

  {#if showTimelineRail}<TimelineRail items={timeline}/>{/if}

  <ChatPane
    messages={active.messages}
    {running}
    {queued}
    goal={active.goal ?? null}
    speechMode={voiceOpen && voiceInChat}
    {speechModeEnabled}
    {dictationAutoStopSeconds}
    {showJumpToLatest}
    onSend={send}
    onStop={stop}
    onVoice={openVoice}
    reasoning={reasoningLevel}
    onReasoningChange={changeReasoningLevel}
    onEditGoal={editGoal}
    onToggleGoalPaused={toggleGoalPaused}
    onDeleteGoal={deleteGoal}
    onQueueHeight={(value) => queueHeight = value}
    onSteerQueued={(id) => void steerQueued(id)}
    onRemoveQueued={(id) => void takeQueued(active.id, id)}
    onEditQueued={editQueued}
    onReorderQueued={reorderQueued}
    insertion={composerInsertion}
    onInsertionApplied={() => composerInsertion = null}
    onJumpAvailability={(value) => showJumpToLatest = value}
    onOpenLink={openLink}
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
      onAttachReferences={attachReferences}
    />
  {/if}

  <WorkspaceDrawer
    tabs={workspaceTabs}
    {activeTabId}
    open={mode === 'workspace'}
    expanded={workspaceExpanded}
    resizing={workspaceResizing}
    reservedWidth={chatDrawerOpen ? MIN_CHAT_DRAWER_WIDTH : 0}
    summaryData={{outputs, references, tasks}}
    {driveRoot}
    {driveSources}
    {driveSourceId}
    {driveLoading}
    {driveActions}
    onSelectDriveSource={selectDriveSource}
    onDriveNavigate={(entry) => void loadDriveFolder(entry.id)}
    {scheduleItems}
    onOpenDriveEntry={openDriveEntry}
    onToggleSchedule={toggleSchedule}
    onCreateSchedule={createSchedule}
    onDeleteSchedule={deleteSchedule}
    onRunSchedule={runScheduleNow}
    onScheduleFrequency={updateScheduleFrequency}
    onSelect={(id) => activeTabId = id}
    onClose={closeTab}
    onNew={newTab}
    onSuggest={suggestPrompt}
    onOpenUrl={openVisit}
    onToggleExpand={() => workspaceExpanded = !workspaceExpanded}
    onResize={(value) => { panelPriority = 'workspace'; workspaceWidth = value; }}
    onResizeState={(value) => workspaceResizing = value}
    browserObscured={settingsOpen || (voiceOpen && !voiceInChat)}
    onTabState={updateTabState}
  />

  {#if settingsOpen}<SettingsModal
    onClose={() => settingsOpen = false}
    onGeneralChange={(settings) => {
      speechModeEnabled = settings.speechModeEnabled;
      dictationAutoStopSeconds = settings.dictationAutoStopSeconds;
      if (!speechModeEnabled) closeVoice();
    }}
  />{/if}

  {#if onboardingOpen}
    <!-- Mounted beneath the splash, whose welcome lockup sits at the same
         point on screen: lifting the cover is then a crossfade between two
         identical brands, and only the rest of setup appears. -->
    <Onboarding
      {api}
      revealed={!startupVisible || startupLeaving}
      preview={onboardingPreview}
      onFinish={() => {
        onboardingOpen = false;
        // Anything setup did not grant is still requested the old way, so a
        // skipped run does not leave enabled features without permission.
        void api.permissions.ensureFirstRun().catch(() => {});
      }}
    />
  {/if}

  <Tooltip/>
</main>
