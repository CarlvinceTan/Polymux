<script lang="ts">
  import {onDestroy, onMount, type ComponentProps} from 'svelte';
  import {readableError} from './lib/shared/errors';
  import type {AppUpdateDto, ArtifactDto, BrowserExtensionDto, ConversationDto, DefaultAppDto, DriveProviderId, DriveStatusDto, GoalDto, JsonValue, ManagerJobDto, ManagerSnapshotDto, MessageDto, ReasoningEffort, ReferenceDto, RunEventDto, WorkspaceRevealDto} from '@polymux/protocol';
  import TitleBar from './lib/features/chat/TitleBar.svelte';
  import ChatPane, {type ChatMessage} from './lib/features/chat/ChatPane.svelte';
  import TimelineRail, {TIMELINE_RAIL_MINIMUM} from './lib/features/chat/TimelineRail.svelte';
  import type {ActiveGoal} from './lib/features/chat/GoalBar.svelte';
  import SpeechOrb from './lib/features/chat/SpeechOrb.svelte';
  import ChatDrawer, {type ChatEntry} from './lib/features/shell/ChatDrawer.svelte';
  import ChatSearchModal from './lib/features/shell/ChatSearchModal.svelte';
  import SummaryPanel, {type SummarySection, type ReferenceItem} from './lib/features/workspace/SummaryPanel.svelte';
  import WorkspaceDrawer, {SINGLETON_TAB_IDS, type WorkspaceTab, type WorkspaceTabKind} from './lib/features/workspace/WorkspaceDrawer.svelte';
  import {seedHub, warmHub, revealInHub} from './lib/features/workspace/HubView.svelte';
  import {driveEntryKind, type DriveEntry} from './lib/features/workspace/DriveView.svelte';
  import {warmCurrentCalendar} from './lib/features/workspace/calendar-session';
  import OpenMenu, {type OpenAnchor, type OpenChoice} from './lib/shared/components/OpenMenu.svelte';
  import {unreadScheduleCount, type ScheduleItem, type ScheduleFrequency, type ScheduleRun} from './lib/features/workspace/ScheduleView.svelte';
  import {unreadTasksCount, type TaskCard} from './lib/features/workspace/TasksView.svelte';
  import {recordVisit} from './lib/features/workspace/visitHistory';
  import Tooltip from './lib/shared/components/Tooltip.svelte';
  import type SettingsPageComponent from './lib/features/settings/SettingsPage.svelte';
  import {polymuxApi} from './lib/api/polymux';
  import {applyTheme, startThemeSync} from './lib/shared/theme';
  import {applyLanguage, locale, startLanguageSync, t, translate, withLocale, type MessageKey} from './i18n';
  import {driveProviderName} from './i18n/names';
  import {
    conversationPanelState,
    initialPanelState,
    summaryWasDismissed,
    togglePanelState,
    type PanelState,
  } from './lib/shared/state/panels';
  import {
    MIN_CHAT_DRAWER_WIDTH,
    MIN_WORKSPACE_WIDTH,
    SPLIT_LAYOUT_MIN_WIDTH,
    SUMMARY_RESERVED_COLUMN,
    resolvePanelWidths,
  } from './lib/shared/layout/layoutSizing';
  import {activityPresentation, runThinkingActivity, toolResultFailed, upsertActivity, visibleCommentaryLabel} from './lib/features/chat/activities';
  import {inferQueuePriority, shouldSteerLiveTurn} from './lib/features/chat/queuePolicy';
  import {addConversationRun as withConversationRun, bindPendingRun, latestConversationRun, removeConversationRun as withoutConversationRun} from './lib/features/chat/runAttribution';
  import {platformForChat, primeChatPlatforms} from './lib/shared/state/chatPlatforms';
  import {startupReleaseNotes} from './lib/shared/state/startupReleaseNotes';
  import {applyTaskEvent, emptyTranscript, type TaskTranscript} from './lib/features/workspace/taskTranscript';
  import type {AgentActivityItem} from './lib/features/chat/AgentActivity.svelte';

  type Conversation = ChatEntry & {messages: ChatMessage[]; goal?: ActiveGoal};
  /** `id` is the parent's tool call id, which is what a task tab is keyed by;
   * `runId` is the subagent's own run, and only arrives once it has started. */
  type SummaryTask = {id: string; title: string; status: 'pending' | 'active' | 'completed' | 'failed'; parentRunId?: string; callId?: string; runId?: string; prompt?: string};
  type QueuedSend = {id: string; text: string; files: File[]; asGoal: boolean};

  const api = polymuxApi();
  const requestedWorkspaceView = (() => {
    const value = new URLSearchParams(window.location.search).get('workspaceView');
    return value === 'drive' || value === 'schedule' || value === 'calendar' || value === 'hub' || value === 'tasks' ? value : null;
  })();
  let conversations: Conversation[] = [];
  let activeId = '';
  let openingId = '';
  let draftConversation: Conversation = emptyDraft();
  /** Every top-level run remains independently addressable. A conversation can
   * have several manager-owned runs at once; array order is start order and the
   * latest run is the only implicit target for an explicit Steer action. */
  let runsByConversation: Record<string, string[]> = {};
  /** Which reasoning block each run's thinking row last appended, so a new
   * block starts a fresh paragraph instead of continuing the previous one.
   * Plain bookkeeping, never rendered, so it stays out of reactive state. */
  const reasoningBlock: Record<string, string> = {};
  /** Top-level run id to its own live assistant row. Never key this by
   * conversation: interleaved deltas must not overwrite a sibling run. */
  let liveAssistantByRun: Record<string, string> = {};
  /** Messages typed while a run was going. They wait their turn instead of
   * interrupting: only ⌘/Ctrl+Enter (or the Steer action on a queued row)
   * reaches a running agent straight away. */
  let queuedByConversation: Record<string, QueuedSend[]> = {};
  let managerEnabled = false;
  let managerJobs: ManagerJobDto[] = [];
  let managerReady: Promise<void> = Promise.resolve();
  let update: AppUpdateDto | null = null;

  // Panel state. Summary and Workspace are mutually exclusive, and Workspace
  // only borrows Summary's space: closing it hands the space back.
  let panelState: PanelState = requestedWorkspaceView
    ? {mode: 'workspace', summaryReturns: false}
    : initialPanelState;
  let summaryDismissed = false;

  let chatDrawerOpen = false;
  let chatSearchOpen = false;
  let chatDrawerWidth = 240;
  let panelPriority: 'chatDrawer' | 'workspace' = 'workspace';
  let trackedPanels = {chatDrawer: false, workspace: false};
  let chatDrawerResizing = false;
  let workspaceWidth = 420;
  let workspaceResizing = false;
  let workspaceExpanded = requestedWorkspaceView !== null;
  let viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;

  // Dragging the window edge reclamps both drawer widths on every frame. The
  // drawer-motion transitions are tuned for a discrete open/close, so during a
  // live resize the conversation column and its fixed-position chrome trail the
  // viewport by the transition duration and the workspace panel paints over
  // them. Suppress the same transitions a handle drag suppresses, and let them
  // back in once the drag has settled.
  let windowResizing = false;
  let windowResizeSettle: ReturnType<typeof setTimeout> | undefined;
  const WINDOW_RESIZE_SETTLE_MS = 140;

  function markWindowResizing(): void {
    windowResizing = true;
    if (windowResizeSettle) clearTimeout(windowResizeSettle);
    windowResizeSettle = setTimeout(() => { windowResizing = false; }, WINDOW_RESIZE_SETTLE_MS);
  }

  /**
   * Expanding and minimising the workspace are driven here rather than by the
   * CSS width transition. A transitioned width lands on fractional pixels for
   * the whole slide, and the panel's one-pixel left divider, drawn at that
   * fractional edge, is anti-aliased across two pixels at partial alpha — at
   * the divider's own weight that reads as the edge vanishing until the panel
   * settles. Stepping the width in whole pixels keeps the edge on the pixel
   * grid, so the divider stays a hairline the whole way across.
   */
  const WORKSPACE_MOTION_MS = 440;
  let workspaceMotionWidth: number | null = null;
  let workspaceMotionFrame = 0;
  let workspaceMotionState: boolean | null = null;
  let workspaceExpandedWidth = viewportWidth - (chatDrawerOpen ? chatDrawerWidth : 0);
  let workspaceMotionProgress = workspaceExpanded ? 1 : 0;

  /** `cubic-bezier(.45,0,.55,1)`, the shared drawer easing, solved for x. */
  function drawerEase(t: number): number {
    const curveX = (u: number) => 3 * (1 - u) ** 2 * u * 0.45 + 3 * (1 - u) * u ** 2 * 0.55 + u ** 3;
    const curveY = (u: number) => 3 * (1 - u) * u ** 2 + u ** 3;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      if (curveX(mid) < t) low = mid; else high = mid;
    }
    return curveY((low + high) / 2);
  }

  function animateWorkspaceWidth(to: number): void {
    const panel = document.querySelector('aside.workspace-drawer');
    const from = workspaceMotionWidth ?? (panel ? panel.getBoundingClientRect().width : to);
    cancelAnimationFrame(workspaceMotionFrame);
    if (Math.round(from) === Math.round(to)) { workspaceMotionWidth = null; return; }
    // Enter motion at the width already on screen. Leaving this null until the
    // first animation frame gives the reactive target width one paint in which
    // to flash through before the stepped motion takes over.
    workspaceMotionWidth = Math.round(from);
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / WORKSPACE_MOTION_MS);
      workspaceMotionWidth = Math.round(from + (to - from) * drawerEase(progress));
      if (progress < 1) workspaceMotionFrame = requestAnimationFrame(step);
      else workspaceMotionWidth = null;
    };
    workspaceMotionFrame = requestAnimationFrame(step);
  }

  // Only the expand/minimise flip is animated here; docking the panel in and
  // out is still the CSS slide, which moves the whole panel as one layer.
  $: if (typeof window !== 'undefined' && mode === 'workspace' && workspaceMotionState !== workspaceExpanded) {
    const first = workspaceMotionState === null;
    workspaceMotionState = workspaceExpanded;
    if (!first) {
      animateWorkspaceWidth(workspaceExpanded ? viewportWidth - (chatDrawerOpen ? chatDrawerWidth : 0) : workspaceWidth);
    }
  }
  $: if (mode !== 'workspace') { workspaceMotionState = workspaceExpanded; }

  let voiceOpen = false;
  let voiceInChat = false;
  let voiceStartedEmpty = false;
  let voiceMuted = false;
  let outputMuted = false;
  let voicePaused = false;
  let settingsOpen = false;
  let SettingsPage: typeof SettingsPageComponent | null = null;
  /** The tab Settings opens on, set by whatever asked for it. Cleared on close
   * so the next plain open lands where it always has. */
  let settingsMode: ComponentProps<typeof SettingsPageComponent>['initialMode'] = '';

  function openSettings(mode: ComponentProps<typeof SettingsPageComponent>['initialMode'] = ''): void {
    settingsMode = mode;
    settingsOpen = true;
    void import('./lib/features/settings/SettingsPage.svelte').then((module) => {
      SettingsPage = module.default;
    });
  }
  // index.html paints the splash before this bundle even loads, so startup is
  // driven by taking that element over rather than by rendering one here.
  // (theme-boot's dead-bundle deadline stands down by itself: it only fires
  // on an empty #app, and this mount fills it.)
  const startupSplash = document.getElementById('startup-splash');
  // Main marks the first window of a process as the cold start; a window
  // reopened while the app kept running gets `coldStart=0` and no splash.
  const coldStart = new URLSearchParams(window.location.search).get('coldStart') !== '0';
  // The startup shell already played the animation in this same window and
  // this document opened on its settled lockup (theme-boot). The cover is
  // still up, so it must leave through the ordinary staged exit — not the
  // immediate removal a warm reopen gets.
  const settledSplash = new URLSearchParams(window.location.search).has('splashSettled');
  const requestedConversationId = new URLSearchParams(window.location.search).get('conversationId');
  let startupVisible = (coldStart || settledSplash) && startupSplash !== null;
  if (!startupVisible) startupSplash?.remove();
  // The cover is click-through and the app under it is only held at opacity 0,
  // so the pointer still reaches the controls behind it — and a tooltip is
  // portaled to the body, above the splash, where it would be the one piece of
  // interface visible during the opening. Marking the root keeps them down
  // until the handover is over.
  if (startupVisible) document.documentElement.dataset.startup = 'covered';
  let startupLeaving = false;
  /**
   * Whether the splash is lifting onto the app rather than onto setup. Setup
   * paints its own matching lockup and wants the app exactly as it is; the app
   * fades itself in under the cover instead, so the two halves cross rather
   * than one being pulled off the other.
   */
  let startupToApp = false;
  let startupMinimumElapsed = false;
  let startupReady = false;
  let startupDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let startupRemovalTimer: ReturnType<typeof setTimeout> | undefined;
  let speechModeEnabled = true;
  /** Off by default, matching the stored setting: basic mode until asked for. */
  let advancedMode = false;
  let pinnedViews: Array<'drive' | 'schedule' | 'calendar' | 'hub' | 'tasks'> = [];
  let dictationAutoStopSeconds: number | null = 6;
  let reasoningLevel: ReasoningEffort = 'medium';
  let windowActive = true;
  let queueHeight = 0;
  let agentFileDragActive = false;
  /** Text handed back to the composer when a queued message is edited. */
  let composerInsertion: {id: string; text: string} | null = null;
  let showJumpToLatest = false;
  let outputs: Array<{id: string; name: string}> = [];
  let references: ReferenceItem[] = [];
  let tasksByConversation: Record<string, SummaryTask[]> = {};
  let tasks: SummaryTask[] = [];
  /** A delegated run as it happens, keyed by the task row it belongs to. Live
   * only: a task tab is not restored with the workspace, so nothing here has to
   * survive a chat switch. */
  let taskTranscripts: Record<string, TaskTranscript> = {};
  /** The subagent's run id back to the task row that started it — events arrive
   * knowing only the run. */
  let taskIdByRunId: Record<string, string> = {};
  /** Each task row's fleet name, recorded from the `task` tool result's
   * metadata. A continued dispatch addresses its worker by that name, which is
   * how its row is found and resumed instead of a second row appearing. */
  let taskRowByName: Record<string, Record<string, string>> = {};
  let workspaceTabs: WorkspaceTab[] = requestedWorkspaceView
    ? [{
        id: SINGLETON_TAB_IDS[requestedWorkspaceView]!,
        title: translate(`workspace.${requestedWorkspaceView}`),
        kind: requestedWorkspaceView,
      }]
    : [];
  let activeTabId: string | null = workspaceTabs[0]?.id ?? null;
  /** Owned by the main process, which keeps the clock and the run history;
   * this is a mirror kept current by `schedules.subscribe`. */
  let scheduleItems: ScheduleItem[] = [];
  let scheduleError = '';
  let taskItems: TaskCard[] = [];
  let tasksError = '';


  $: mode = panelState.mode;
  $: active = activeId ? conversations.find((chat) => chat.id === activeId) ?? draftConversation : draftConversation;
  $: tasks = tasksByConversation[active.id] ?? [];
  $: running = Boolean(runsByConversation[active.id]?.length);
  $: queued = managerEnabled
    ? managerJobs
      .filter((job) => job.chatId === active.id && job.status === 'queued')
      .map((job) => ({
        id: job.id,
        text: job.text,
        files: job.attachments.map((path) => ({name: fileName(path), type: ''})),
      }))
    : (queuedByConversation[active.id] ?? []).map((item) => ({
      id: item.id,
      text: item.text,
      files: item.files.map((file) => ({name: file.name, type: file.type})),
    }));
  $: chatEntries = conversations.map(({id, title, updatedAt}) => ({
    id,
    title,
    updatedAt,
    running: Boolean(runsByConversation[id]?.length),
  }));
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
  $: workspacePanelWidth = workspaceMotionWidth !== null
    ? `${workspaceMotionWidth}px`
    : workspaceExpanded
      ? `calc(100vw - ${chatDrawerOpen ? chatDrawerWidth : 0}px)`
      : `${workspaceWidth}px`;
  $: workspaceExpandedWidth = viewportWidth - (chatDrawerOpen ? chatDrawerWidth : 0);
  $: workspaceMotionProgress = workspaceMotionWidth === null
    ? (workspaceExpanded ? 1 : 0)
    : Math.max(0, Math.min(1,
      (workspaceMotionWidth - workspaceWidth) /
      Math.max(1, workspaceExpandedWidth - workspaceWidth)));
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
  // The search entry point lives with the drawer, so closing the drawer closes it.
  $: if (!chatDrawerOpen) chatSearchOpen = false;

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
    unsubscribeReveal?.();
    unsubscribeManager?.();
    if (agentInspectionListener) window.removeEventListener('polymux:agent-inspect-settings', agentInspectionListener);
    cancelAnimationFrame(chromeShiftFrame);
    cancelAnimationFrame(workspaceMotionFrame);
    clearTimeout(resourceRefreshTimer);
    clearTimeout(windowResizeSettle);
    clearTimeout(calendarWarmTimer);
    stopThemeSync?.();
    stopLanguageSync?.();
  });

  onMount(() => {
    void api.general.checkForUpdates().then((value) => update = value).catch(() => {});
  });

  let unsubscribeEvents: (() => void) | undefined;
  let unsubscribeBrowser: (() => void) | undefined;
  let unsubscribeFullscreen: (() => void) | undefined;
  let unsubscribeReveal: (() => void) | undefined;
  let unsubscribeManager: (() => void) | undefined;
  let agentInspectionListener: ((event: Event) => void) | undefined;
  let chromeShiftFrame = 0;
  let stopThemeSync: (() => void) | undefined;
  let stopLanguageSync: (() => void) | undefined;
  let calendarWarmTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    agentInspectionListener = (event: Event) => {
      const detail = (event as CustomEvent<{mode?: string}>).detail;
      if (detail?.mode === 'memory') openSettings('computer-history');
    };
    window.addEventListener('polymux:agent-inspect-settings', agentInspectionListener);
    if (startupVisible) {
      // The cover waits for the mark's sequence to finish, which theme-boot
      // announces — it starts when the window reaches the screen, so waiting
      // for it rather than for a timer is what makes the whole of it visible.
      const splashState = document.documentElement.dataset.splash;
      // 'settled' is the handoff document: the sequence was watched through in
      // the shell, so there is nothing left to wait for.
      if (splashState === 'done' || splashState === 'settled') startupMinimumElapsed = true;
      else document.addEventListener('polymux:splash-done', () => {
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
    stopLanguageSync = startLanguageSync();
    const settingsLoad = api.general.get().then((settings) => {
      applyTheme(settings.theme);
      applyLanguage(settings.language);
      speechModeEnabled = settings.speechModeEnabled;
      advancedMode = settings.advancedMode;
      pinnedViews = settings.pinnedViews;
      dictationAutoStopSeconds = settings.dictationAutoStopSeconds;
      reasoningLevel = settings.reasoningLevel;
      void api.permissions.ensureFirstRun().catch(() => {});
      // Calendar data is stable enough to prepare after first paint, but only
      // after macOS has already granted access. A warm must never become a
      // surprise permission prompt.
      if (settings.permissions.calendars) {
        void api.permissions.status('calendars').then((status) => {
          if (status !== 'granted') return;
          calendarWarmTimer = setTimeout(() => void warmCurrentCalendar().catch(() => {}), 2_500);
        }).catch(() => {});
      }
      return settings;
    }).catch(() => null);
    refreshExtensionStatus();
    // What the hub knew when the app last quit, read from disk. It is local
    // and it is what the hub paints from, so it happens now rather than on the
    // warm's timer: a Hub opened in the first two seconds should still open on
    // mail rather than on a skeleton.
    void seedHub();
    // The hub's mailboxes and conversations, fetched while the user is reading
    // whatever they opened the app for. It is the slowest tab to build and the
    // one most likely to be opened, so it is worth having ready; the delay
    // keeps it out of the way of the first paint.
    setTimeout(() => void warmHub(), 2_500);
    windowActive = document.hasFocus();
    unsubscribeEvents = api.runs.subscribe(handleRunEvent);
    unsubscribeManager = api.manager.subscribe(applyManagerSnapshot);
    managerReady = api.manager.snapshot().then(applyManagerSnapshot).catch(() => {});
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
    // "Show me the draft you wrote": the agent naming a surface to put up.
    unsubscribeReveal = api.workspace.subscribeReveal(revealSurface);
    unsubscribeFullscreen = api.window.subscribeFullscreen((fullscreen) => {
      const root = document.documentElement;
      // Main sends this as the window starts travelling, which is the last
      // moment the renderer can paint anything the screen will show before
      // macOS freezes the contents for its zoom. Either way the flag holds the
      // inset's move unanimated so it is over before that freeze; the two
      // directions differ only in how long it is held, and the stylesheet
      // keys the restore's blanking off the value.
      cancelAnimationFrame(chromeShiftFrame);
      // A width animation in flight would fight the fullscreen zoom; snap it
      // to its target rather than leaving the panel frozen mid-motion.
      cancelAnimationFrame(workspaceMotionFrame);
      workspaceMotionWidth = null;
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
    void Promise.all([settingsLoad, loadChats()]).then(async ([settings]) => {
      if (requestedConversationId && conversations.some((chat) => chat.id === requestedConversationId))
        await openChat(requestedConversationId);
      if (requestedWorkspaceView === null && settings) {
        const appInfo = await api.general.version().catch(() => null);
        const releaseNotes = appInfo?.packaged
          ? startupReleaseNotes(window.localStorage, appInfo.version, settings.onboardingCompleted)
          : null;
        if (releaseNotes) openVisit(releaseNotes.url, releaseNotes.title);
      }
    }).finally(() => {
      startupReady = true;
      document.documentElement.dataset.appReady = 'true';
      finishStartupWhenReady();
    });
  });

  function finishStartupWhenReady(): void {
    if (!startupVisible || startupLeaving || !startupMinimumElapsed || !startupReady) return;
    startupLeaving = true;
    clearTimeout(startupDeadlineTimer);
    startupToApp = true;
    startupSplash?.classList.add('leaving');
    startupSplash?.classList.add('to-app');
    // Comfortably past the staged exit's own 760ms rather than level with it:
    // cutting the element at the exact frame the fade ends takes the tail of
    // it off on any machine that ran a frame late.
    startupRemovalTimer = setTimeout(() => {
      startupVisible = false;
      startupSplash?.remove();
      delete document.documentElement.dataset.startup;
    }, 860);
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

  /**
   * What the agent asks to be shown.
   *
   * The agent works where the user cannot see it — a draft saved to a mailbox,
   * a file written to a drive — so "show me" has to be able to *navigate*
   * rather than describe. The tab is opened first, then the surface is told
   * where to land inside itself; the hub holds the target if its component has
   * not mounted yet, since both happen in the same breath. This only ever
   * brings the workspace forward, which is the whole request.
   *
   * `focus: false` is the exception, and the reason delegated runs can draft
   * without fighting over the screen: the request still lands — the words go
   * into the composer they were written for — but no tab is opened and nothing
   * is brought forward. If the hub is not mounted the request waits there for
   * it, so the user finds the draft when they next open it, or when the run
   * they are talking to shows them.
   */
  function revealSurface(request: WorkspaceRevealDto): void {
    const quiet = request.focus === false;
    // Summary is a panel rather than a tab — it takes the same space the
    // workspace does — so showing it means putting that panel up, not opening
    // something inside the drawer.
    if (request.surface === 'summary') {
      if (quiet) return;
      if (panelState.mode !== 'summary') {
        summaryDismissed = false;
        setPanelState(togglePanelState(panelState, 'summary'));
      }
      return;
    }
    const kind: WorkspaceTabKind = request.surface;
    if (request.surface === 'hub' && (request.mail || request.chat))
      revealInHub({mail: request.mail, chat: request.chat});
    if (request.surface === 'drive' && !quiet) {
      const source = request.drive?.source;
      if (source && driveSources.some((item) => item.id === source)) driveSourceId = source;
      void loadDriveFolder(request.drive?.path ?? '');
    }
    if (!quiet) newTab(kind);
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
    openingId = id;
    workspaceExpanded = false;
    taskItems = [];
    if (id) void applyTasks(Promise.resolve(), id);
  }

  function newChat(): void {
    switchTo('');
    draftConversation = emptyDraft();
    clearConversationResources();
  }

  /**
   * A chat whose messages are not cached yet is loaded *before* activeId moves.
   * Switching first would render it with an empty message list, and every
   * surface keyed on `active.messages.length === 0` — the welcome pane, the
   * title, the summary panel — would flash the new-chat state for the frames
   * the fetch takes. openingId drops a load the user has already switched past.
   */
  async function openChat(id: string): Promise<void> {
    if (id === activeId) return;
    openingId = id;
    const cached = conversations.find((chat) => chat.id === id);
    if (cached && cached.messages.length === 0) {
      await loadConversation(id, () => {
        if (openingId !== id) return false;
        switchTo(id);
        return true;
      });
      if (openingId !== id) return;
      await restoreWorkspace(id);
    } else {
      switchTo(id);
      await restoreWorkspace(id);
      await loadConversation(id);
    }
    if (openingId !== id) return;
    await drainQueue(id);
  }

  function openChatFromSearch(id: string): void {
    workspaceExpanded = false;
    void openChat(id);
  }

  async function send(text: string, files: File[], asGoal = false, immediate = false): Promise<void> {
    if (!text && !files.length) return;
    const sentAt = new Date().toISOString();
    let conversationId = activeId;
    // A draft carries no title of its own — the placeholder shown for it is
    // drawn from the catalog at render time, so it follows the language rather
    // than freezing whichever one the draft happened to open in.
    const title = active.title || (text || files[0]?.name || translate('chat.untitled')).slice(0, 42);
    if (!conversationId) {
      const created = await api.conversations.create(title);
      conversationId = created.id;
      activeId = created.id;
      openingId = created.id;
      conversations = [{...fromConversation(created), messages: []}, ...conversations];
    } else if (!active.title) {
      await rename(title);
    }

    const existingRun = latestRun(conversationId);
    if (existingRun) await managerReady;
    const steerCurrent = shouldSteerLiveTurn({
      runId: existingRun,
      immediate,
      hasActiveDelegation: (tasksByConversation[conversationId] ?? []).some((task) => task.status === 'active'),
    });
    // A run that has not reported its id yet cannot be steered, so those wait
    // in the queue too even when the send asked to go now.
    if (existingRun && !steerCurrent) {
      if (managerEnabled) {
        const attachmentPaths = files.length ? await api.files.paths(files) : [];
        await api.manager.enqueue({
          id: crypto.randomUUID(),
          chatId: conversationId,
          text,
          attachments: attachmentPaths,
          asGoal,
          priority: inferQueuePriority(text),
        });
      } else {
        enqueue(conversationId, {id: crypto.randomUUID(), text, files, asGoal});
      }
      return;
    }
    if (existingRun) {
      const steered: ChatMessage = {id: crypto.randomUUID(), role: 'user', text, files: files.map((file) => file.name), sentAt, asGoal};
      // The live turn keeps writing into the message it started, which sits
      // above this one — so it moves to the foot of the transcript instead.
      // What the agent says next is a reply to the steer, and reading it above
      // the words it answers is the wrong order.
      const liveId = liveAssistantByRun[existingRun];
      updateConversation(conversationId, (chat) => {
        const live = chat.messages.find((message) => message.id === liveId);
        const rest = live ? chat.messages.filter((message) => message.id !== liveId) : chat.messages;
        return {...chat, messages: live ? [...rest, steered, live] : [...rest, steered]};
      });
      if (asGoal) await setGoal(conversationId, text || files[0]?.name || translate('goal.reviewAttached'));
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
      goal: asGoal ? {id: crypto.randomUUID(), text: text || files[0]?.name || translate('goal.reviewAttached'), startedAt: sentAt, status: 'active'} : chat.goal,
      messages: [...chat.messages, userMessage, {id: assistantId, role: 'assistant', text: '', startedAt: sentAt, activities: [{id: crypto.randomUUID(), kind: 'thinking', status: 'active', label: translate('activity.thinking')}]}],
    }));
    const pendingRunId = `pending:${assistantId}`;
    liveAssistantByRun = {...liveAssistantByRun, [pendingRunId]: assistantId};
    addConversationRun(conversationId, pendingRunId);
    setConversationTasks(conversationId, []);
    taskTranscripts = {};
    taskIdByRunId = {};

    try {
      const attachmentPaths = files.length ? await api.files.paths(files) : [];
      const {runId} = await api.runs.start({conversationId, text, messageId: userId, attachments: attachmentPaths, asGoal, reasoning: reasoningLevel, speechMode: voiceOpen});
      bindRun(conversationId, pendingRunId, runId);
      updateLiveAssistant(conversationId, runId, (message) => ({...message, runId}));
      if (asGoal) await refreshGoal(conversationId);
      await loadChats();
    } catch (error) {
      failRun(conversationId, pendingRunId, readableError(error));
    }
  }

  async function stop(): Promise<void> {
    const runIds = runsByConversation[active.id] ?? [];
    // Stopping means stopping: nothing queued behind this run should start on
    // its own once the cancel lands.
    if (managerEnabled) {
      const queuedJobs = managerJobs.filter((job) => job.chatId === active.id && job.status === 'queued');
      await Promise.all(queuedJobs.map((job) => api.manager.cancel(job.id)));
    } else {
      setQueued(active.id, []);
    }
    await Promise.all(runIds.filter((runId) => !runId.startsWith('pending:')).map((runId) => api.runs.cancel(runId)));
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
    if (managerEnabled) return;
    if (activeId !== conversationId || runsByConversation[conversationId]?.length) return;
    const items = queuedByConversation[conversationId] ?? [];
    if (!items.length) return;
    setQueued(conversationId, items.slice(1));
    await send(items[0].text, items[0].files, items[0].asGoal);
  }

  async function steerQueued(id: string): Promise<void> {
    if (managerEnabled) {
      const item = managerJobs.find((job) => job.id === id && job.status === 'queued');
      if (!item) return;
      await api.manager.cancel(id);
      await send(item.text, [], item.asGoal, true);
      return;
    }
    const item = takeQueued(active.id, id);
    if (item) await send(item.text, item.files, item.asGoal, true);
  }

  async function editQueued(id: string): Promise<void> {
    if (managerEnabled) {
      const item = managerJobs.find((job) => job.id === id && job.status === 'queued');
      if (!item) return;
      await api.manager.cancel(id);
      composerInsertion = {id: item.id, text: item.text};
      return;
    }
    const item = takeQueued(active.id, id);
    if (item) composerInsertion = {id: item.id, text: item.text};
  }

  function reorderQueued(sourceId: string, targetId: string): void {
    if (managerEnabled) {
      void api.manager.reorder(sourceId, targetId).catch((error) => {
        console.error('Could not reorder queued work:', readableError(error));
      });
      return;
    }
    const items = queuedByConversation[active.id] ?? [];
    const from = items.findIndex((item) => item.id === sourceId);
    const to = items.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...items];
    next.splice(to, 0, ...next.splice(from, 1));
    setQueued(active.id, next);
  }

  async function removeQueued(id: string): Promise<void> {
    if (managerEnabled) {
      await api.manager.cancel(id);
      return;
    }
    takeQueued(active.id, id);
  }

  function applyManagerSnapshot(snapshot: ManagerSnapshotDto): void {
    managerEnabled = snapshot.enabled;
    managerJobs = snapshot.jobs;
    if (!snapshot.enabled) return;
    for (const job of snapshot.jobs)
      if (job.status === 'running' && job.runId) ensureManagedLive(job);
  }

  function ensureManagedLive(job: ManagerJobDto): void {
    if (!job.runId) return;
    const chat = conversations.find((candidate) => candidate.id === job.chatId);
    if (!chat) {
      void loadChats().then(() => ensureManagedLive(job));
      return;
    }
    const existingLiveId = liveAssistantByRun[job.runId];
    const existingLive = chat.messages.find((message) => message.id === existingLiveId);
    if (existingLive?.runId === job.runId) return;
    const startedAt = job.startedAt ?? new Date().toISOString();
    const assistantId = `manager:${job.id}`;
    const assistant: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      text: '',
      runId: job.runId,
      startedAt,
      activities: [{id: crypto.randomUUID(), kind: 'thinking', status: 'active', label: translate('activity.thinking')}],
    };
    liveAssistantByRun = {...liveAssistantByRun, [job.runId]: assistantId};
    addConversationRun(job.chatId, job.runId);
    updateConversation(job.chatId, (conversation) => ({
      ...conversation,
      updatedAt: Date.parse(startedAt),
      messages: [...conversation.messages, assistant],
    }));
    void loadConversation(job.chatId);
  }

  /** A run event can outrun the manager snapshot which assigns that run to its
   * durable job. Give the run an attributable row immediately so its first
   * deltas are not lost; the later snapshot recognizes the same run key. */
  function ensureEventLive(conversationId: string, runId: string, timestamp: number): void {
    if (liveAssistantByRun[runId]) return;
    const chat = conversations.find((candidate) => candidate.id === conversationId);
    if (!chat) {
      void loadChats().then(() => ensureEventLive(conversationId, runId, timestamp));
      return;
    }
    const startedAt = new Date(timestamp).toISOString();
    const assistantId = `run:${runId}`;
    liveAssistantByRun = {...liveAssistantByRun, [runId]: assistantId};
    addConversationRun(conversationId, runId);
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      updatedAt: Date.parse(startedAt),
      messages: [...conversation.messages, {
        id: assistantId,
        role: 'assistant',
        text: '',
        runId,
        startedAt,
        activities: [{id: crypto.randomUUID(), kind: 'thinking', status: 'active', label: translate('activity.thinking')}],
      }],
    }));
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
    } catch (error) {
      console.error('Could not load chats:', readableError(error));
    }
  }

  async function loadConversation(id: string, onLoaded?: () => boolean): Promise<void> {
    try {
      const [storedMessages, storedGoal, artifacts, storedReferences] = await Promise.all([
        api.conversations.messages(id),
        api.goals.get(id),
        api.resources.artifacts(id),
        api.resources.references(id),
      ]);
      const current = conversations.find((chat) => chat.id === id)?.messages ?? [];
      updateConversation(id, (chat) => ({...chat, messages: mergeMessages(storedMessages, current), goal: fromGoal(storedGoal)}));
      if (onLoaded && !onLoaded()) return;
      if (activeId === id) applyResources(artifacts, storedReferences);
    } catch (error) {
      console.error('Could not load the conversation:', readableError(error));
    }
  }

  function handleRunEvent(event: RunEventDto): void {
    const conversationId = event.conversationId;
    if (!conversationId) return;
    // A subagent shares its parent's conversation but not its transcript: its
    // reasoning and tool trail belong to the task tab, and folding them into the
    // live assistant message would narrate one run as if it were the other.
    if (event.parentRunId) {
      applySubagentEvent(event);
      return;
    }
    const payload = asRecord(event.payload);
    if (event.type === 'run.started') {
      const managed = managerJobs.find((job) => job.runId === event.runId && job.status === 'running');
      if (managed) ensureManagedLive(managed);
      else if (!liveAssistantByRun[event.runId]) {
        const pending = (runsByConversation[conversationId] ?? []).find((runId) => runId.startsWith('pending:'));
        if (pending) bindRun(conversationId, pending, event.runId);
      }
      ensureEventLive(conversationId, event.runId, event.timestamp);
      addConversationRun(conversationId, event.runId);
    }
    if (event.type === 'message.text.delta') {
      const delta = typeof payload.delta === 'string' ? payload.delta : '';
      updateLiveAssistant(conversationId, event.runId, (message) => ({
        ...message,
        text: message.text + delta,
        activities: (message.activities ?? []).map((item) => item.kind === 'thinking' && item.status === 'active' ? {...item, status: 'completed'} : item),
      }));
    }
    if (event.type === 'message.final_rejected') {
      // Streaming makes a draft visible before the runtime can validate it.
      // Once rejected, quarantine that prose immediately so a repair turn or
      // max-turn failure cannot leave internal scratch as the apparent answer.
      updateLiveAssistant(conversationId, event.runId, (message) => ({...message, text: ''}));
    }
    if (event.type === 'message.reasoning.delta') {
      const id = `${event.runId}:thinking`;
      const delta = typeof payload.delta === 'string' ? payload.delta : '';
      // The whole run shares one thinking row, so a later reasoning block —
      // a new turn, or a new block within one — is separated from the last
      // rather than running into its final word.
      const block = `${typeof payload.turn === 'number' ? payload.turn : 0}:${typeof payload.index === 'number' ? payload.index : 0}`;
      const separator = reasoningBlock[id] !== undefined && reasoningBlock[id] !== block ? '\n\n' : '';
      reasoningBlock[id] = block;
      updateLiveAssistant(conversationId, event.runId, (message) => {
        const existing = runThinkingActivity(message.activities ?? [], event.runId);
        return {
          ...message,
          activities: upsertActivity(
            message.activities ?? [],
            {
              ...existing,
              id: existing?.id ?? id,
              kind: 'thinking',
              status: 'active',
              label: translate('activity.thinking'),
              result: `${existing?.result ?? ''}${separator}${delta}`,
            },
          ),
        };
      });
    }
    if (event.type === 'message.completed') {
      const completed = asRecord(payload.message);
      const text = contentText(completed.content);
      const commentaryLabel = visibleCommentaryLabel(text);
      // Mid-run narration (tool calls follow) folds into the activity group so
      // only the run's final answer stays as the visible message body.
      //
      // Judged on what the text actually says, not on whether there is any:
      // a block carrying only a newline is truthy, and folding one into the
      // trail drew a row with an icon, a disclosure chevron and no words.
      if (payload.phase === 'commentary') {
        updateLiveAssistant(conversationId, event.runId, (message) => ({
          ...message,
          text: '',
          activities: commentaryLabel ? [
            ...(message.activities ?? []),
            {id: `${event.runId}:commentary:${event.sequence}`, kind: 'commentary', status: 'completed', label: commentaryLabel},
          ] : message.activities,
        }));
      } else if (text) {
        updateLiveAssistant(conversationId, event.runId, (message) => ({...message, text}));
      }
    }
    if (event.type === 'context.compacting') {
      const id = `${event.runId}:compaction`;
      updateLiveAssistant(conversationId, event.runId, (message) => ({
        ...message,
        activities: upsertActivity(
          (message.activities ?? []).filter((item) => item.status !== 'active' || (item.kind !== 'thinking' && item.kind !== 'compacting')),
          {id, kind: 'compacting', status: 'active', label: translate('activity.compacting')},
        ),
      }));
    }
    if (event.type === 'context.compacted') {
      const id = `${event.runId}:compaction`;
      updateLiveAssistant(conversationId, event.runId, (message) => ({
        ...message,
        activities: (message.activities ?? []).map((item) => item.id === id ? {...item, status: 'completed'} : item),
      }));
    }
    if (event.type === 'tool.started') {
      const call = asRecord(payload.toolCall);
      const name = typeof call.name === 'string' ? call.name : 'tool';
      const id = typeof call.id === 'string' ? call.id : crypto.randomUUID();
      const presentation = activityPresentation(name, asRecord(call.arguments));
      updateLiveAssistant(conversationId, event.runId, (message) => ({
        ...message,
        activities: upsertActivity(
          (message.activities ?? []).filter((item) => item.status !== 'active' || (item.kind !== 'thinking' && item.kind !== 'compacting')),
          {id, ...presentation, status: 'active'},
        ),
      }));
      // A messaging row wants its platform's logo, which only the hub's chat
      // list knows. When the run reaches a conversation before the hub has
      // ever been opened, the list is fetched now and the row picks its logo
      // up as soon as the answer lands.
      const chatId = typeof asRecord(call.arguments).chat_id === 'string' ? String(asRecord(call.arguments).chat_id) : '';
      if (name.startsWith('message_') && chatId && !presentation.logo) void primeChatPlatforms().then(() => {
        const logo = platformForChat(chatId);
        if (!logo) return;
        updateLiveAssistant(conversationId, event.runId, (message) => ({
          ...message,
          activities: (message.activities ?? []).map((item) => item.id === id ? {...item, logo} : item),
        }));
      });
      if (isSubagentTask(name)) {
        const arguments_ = asRecord(call.arguments);
        const description = typeof arguments_.description === 'string' ? arguments_.description.trim() : '';
        const prompt = typeof arguments_.prompt === 'string' ? arguments_.prompt.trim() : '';
        // A continued dispatch resumes an existing fleet task: its row flips
        // back to active rather than a second row appearing for the same task.
        const continueFrom = typeof arguments_.continue === 'string' ? arguments_.continue.trim() : '';
        const taskScope = `${conversationId}:${event.runId}`;
        const resumedId = continueFrom ? taskRowByName[taskScope]?.[continueFrom] : undefined;
        const taskId = `${event.runId}:${id}`;
        if (resumedId) {
          updateConversationTasks(conversationId, (current) => current.map((task) => task.id === resumedId
            ? {...task, status: 'active', title: description || task.title, prompt: prompt || task.prompt}
            : task));
        } else {
          updateConversationTasks(conversationId, (current) => [
            ...current.filter((task) => task.id !== taskId),
            {id: taskId, callId: id, title: description || translate('activity.delegatedTask'), status: 'active', parentRunId: event.runId, prompt},
          ]);
        }
      }
    }
    if (event.type === 'tool.progress') {
      const id = typeof payload.toolCallId === 'string' ? payload.toolCallId : '';
      const label = typeof payload.message === 'string' ? payload.message.trim() : '';
      // The task tool reports its subagent's run id and nothing else, which is
      // what pairs a task row with the events its run is about to send. A
      // continued dispatch also names the fleet task it resumes: the new run
      // relinks to that task's existing row rather than this call's row.
      const data = asRecord(payload.data);
      const childRunId = typeof data.childRunId === 'string' ? String(data.childRunId) : '';
      const continueFrom = typeof data.continueFrom === 'string' ? data.continueFrom : '';
      if (id && childRunId) {
        const taskScope = `${conversationId}:${event.runId}`;
        const rowId = continueFrom ? (taskRowByName[taskScope]?.[continueFrom] ?? `${event.runId}:${id}`) : `${event.runId}:${id}`;
        linkTaskRun(conversationId, rowId, childRunId, Boolean(continueFrom && rowId !== id));
      }
      // Each progress report becomes a sub-step of its tool's activity row;
      // starting a new step settles the one before it.
      if (id && label) updateLiveAssistant(conversationId, event.runId, (message) => ({
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
      const status = event.type === 'tool.failed' || toolResultFailed(payload.result)
        ? 'failed' as const
        : 'completed' as const;
      // A successful `task` call has only *started* the work, so its row keeps
      // working until the delegated run itself ends; anything else is done
      // when its call is.
      const dispatched = isSubagentTask(name) && status === 'completed' && !toolResultFailed(payload.result);
      updateLiveAssistant(conversationId, event.runId, (message) => ({...message, activities: (message.activities ?? []).map((item) => item.id === id ? {
        ...item,
        status: dispatched ? item.status : status,
        result: detail || item.result,
        steps: item.steps?.map((step) => step.status === 'active' ? {...step, status} : step),
      } : item)}));
      // Dispatch is not completion: the `task` call returns the moment the
      // subagent starts, so the row follows the delegated *run* to its end
      // (see applySubagentEvent) and only a failed dispatch settles it here.
      if (isSubagentTask(name) && (event.type === 'tool.failed' || toolResultFailed(payload.result)))
        updateConversationTasks(conversationId, (current) => current.map((task) => task.id === `${event.runId}:${id}` ? {...task, status: 'failed'} : task));
      // The `task` result names the fleet task it dispatched. The row keeps
      // that name so a later continued dispatch can find and resume it.
      if (isSubagentTask(name) && status === 'completed') {
        const fleetName = asRecord(asRecord(payload.result).metadata).subagent;
        const taskScope = `${conversationId}:${event.runId}`;
        if (typeof fleetName === 'string' && fleetName && id && !taskRowByName[taskScope]?.[fleetName])
          taskRowByName = {...taskRowByName, [taskScope]: {...(taskRowByName[taskScope] ?? {}), [fleetName]: `${event.runId}:${id}`}};
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
      updateLiveAssistant(conversationId, event.runId, (message) => ({
        ...message,
        text: failure && !message.text ? failure : message.text || lastAgentMessage,
        sentAt: completedAt,
        completedAt,
        activities: noWork
          ? []
          : (message.activities ?? []).map((item) => ({...item, status: item.status === 'active' ? (event.type === 'run.failed' ? 'failed' : 'completed') : item.status})),
      }));
      updateConversationTasks(conversationId, (current) => current.map((task) => task.parentRunId === event.runId && task.status === 'active'
        ? {...task, status: event.type === 'run.completed' ? 'completed' : 'failed'}
        : task));
      removeConversationRun(conversationId, event.runId);
    }
    if (event.type === 'run.settled') void settleConversation(conversationId, event.runId);
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

  async function settleConversation(conversationId: string, settledRunId: string): Promise<void> {
    const stored = await api.conversations.messages(conversationId);
    const current = conversations.find((chat) => chat.id === conversationId)?.messages ?? [];
    updateConversation(conversationId, (chat) => ({...chat, messages: mergeMessages(stored, current)}));
    await persistActivities(stored, current);
    const nextLive = {...liveAssistantByRun};
    delete nextLive[settledRunId];
    liveAssistantByRun = nextLive;
    removeConversationRun(conversationId, settledRunId);
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
    const settled = visibleAssistantRows(stored).filter((message) => message.role === 'assistant' && message.runId);
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

  /** Pairs a task row with the subagent run it started, and seeds that run's
   * transcript with the instruction it was sent — the orchestrator's half of
   * the conversation, which the subagent's own events never carry. A resumed
   * task keeps its transcript: the follow-up run writes into the same one, so
   * the tab reads as the whole arc rather than two stitched halves. */
  function linkTaskRun(conversationId: string, taskId: string, runId: string, resumed = false): void {
    taskIdByRunId = {...taskIdByRunId, [runId]: taskId};
    updateConversationTasks(conversationId, (current) => current.map((task) => task.id === taskId ? {...task, runId} : task));
    const prompt = (tasksByConversation[conversationId] ?? []).find((task) => task.id === taskId && task.parentRunId)?.prompt ?? '';
    const existing = taskTranscripts[taskId];
    if (resumed && existing)
      taskTranscripts = {...taskTranscripts, [taskId]: {...existing, runId, running: true, completedAt: undefined}};
    else if (!existing)
      taskTranscripts = {...taskTranscripts, [taskId]: emptyTranscript(runId, prompt)};
  }

  function applySubagentEvent(event: RunEventDto): void {
    const taskId = taskIdByRunId[event.runId];
    // An event that arrives before the link does has nowhere to go: the tool
    // call announces the run id first, so this only guards a race.
    if (!taskId) return;
    const current = taskTranscripts[taskId] ?? emptyTranscript(event.runId);
    taskTranscripts = {...taskTranscripts, [taskId]: applyTaskEvent(current, event)};
    // The delegated run's own ending is what finishes its row, since the tool
    // call that started it returned long before.
    if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') {
      const status = event.type === 'run.completed' ? 'completed' : 'failed';
      const conversationId = event.conversationId;
      if (!conversationId) return;
      updateConversationTasks(conversationId, (tasks) => tasks.map((task) => task.id === taskId ? {...task, status} : task));
      // The task row and the parent's activity row are the same delegation
      // seen from two places, and the tool call id is what ties them: it names
      // the row here and the task there.
      const parentRunId = event.parentRunId ?? (tasksByConversation[conversationId] ?? []).find((task) => task.id === taskId)?.parentRunId;
      const callId = (tasksByConversation[conversationId] ?? []).find((task) => task.id === taskId)?.callId;
      if (parentRunId && callId)
        updateLiveAssistant(conversationId, parentRunId, (message) => ({...message, activities: (message.activities ?? []).map((item) => item.id === callId ? {...item, status} : item)}));
    }
  }

  /** Opens a task's run as its own workspace tab. Read-only by construction:
   * the tab shows what the subagent was asked and what it did, and offers no
   * way to say anything back to a run that answers to the orchestrator. */
  function openTask(task: SummaryTask): void {
    if (task.runId && !taskTranscripts[task.id]) {
      taskTranscripts = {...taskTranscripts, [task.id]: emptyTranscript(task.runId, task.prompt ?? '')};
      void replayTask(task.id, task.runId);
    }
    openTab({id: task.id, title: task.title, kind: 'subagent'});
  }

  /** Rebuilds a transcript from the run's stored events, for a task whose run
   * finished before its tab was ever opened. */
  async function replayTask(taskId: string, runId: string): Promise<void> {
    try {
      const stored = await api.runs.events(runId);
      let transcript = taskTranscripts[taskId] ?? emptyTranscript(runId);
      for (const event of stored) transcript = applyTaskEvent(transcript, event);
      taskTranscripts = {...taskTranscripts, [taskId]: transcript};
    } catch (error) {
      console.error('Could not load the task transcript:', readableError(error));
    }
  }

  function setConversationTasks(conversationId: string, next: SummaryTask[]): void {
    tasksByConversation = {...tasksByConversation, [conversationId]: next};
  }

  function updateConversationTasks(conversationId: string, mutator: (tasks: SummaryTask[]) => SummaryTask[]): void {
    setConversationTasks(conversationId, mutator(tasksByConversation[conversationId] ?? []));
  }

  function latestRun(conversationId: string): string | undefined {
    return latestConversationRun(runsByConversation, conversationId);
  }

  function addConversationRun(conversationId: string, runId: string): void {
    runsByConversation = withConversationRun(runsByConversation, conversationId, runId);
  }

  function removeConversationRun(conversationId: string, runId: string): void {
    runsByConversation = withoutConversationRun(runsByConversation, conversationId, runId);
  }

  function bindRun(conversationId: string, pendingRunId: string, runId: string): void {
    const bound = bindPendingRun(runsByConversation, liveAssistantByRun, conversationId, pendingRunId, runId);
    runsByConversation = bound.runs;
    liveAssistantByRun = bound.assistants;
  }

  function updateLiveAssistant(conversationId: string, runId: string, mutator: (message: ChatMessage) => ChatMessage): void {
    const id = liveAssistantByRun[runId];
    if (!id) return;
    updateConversation(conversationId, (chat) => ({...chat, messages: chat.messages.map((message) => message.id === id ? mutator(message) : message)}));
  }

  function failRun(conversationId: string, runId: string, reason: string): void {
    const completedAt = new Date().toISOString();
    const detail = cleanIpcError(reason);
    updateLiveAssistant(conversationId, runId, (message) => ({...message, text: translate('run.startFailed', {detail}), sentAt: completedAt, completedAt, activities: [{id: crypto.randomUUID(), kind: 'thinking', status: 'failed', label: translate('activity.startFailed')}]}));
    removeConversationRun(conversationId, runId);
    const next = {...liveAssistantByRun}; delete next[runId]; liveAssistantByRun = next;
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
  const RESTORABLE_TAB_KINDS = new Set<WorkspaceTabKind>(['new', 'media', 'browser', 'summary', 'drive', 'schedule', 'calendar', 'hub', 'subagents', 'tasks']);
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
    workspaceTabs = [...workspaceTabs.filter((tab) => tab.kind === 'new' || tab.kind === 'summary' || tab.kind === 'drive' || tab.kind === 'schedule' || tab.kind === 'calendar' || tab.kind === 'hub' || tab.kind === 'browser' || tab.kind === 'subagent' || tab.kind === 'subagents' || tab.kind === 'tasks'), ...resourceTabs];
    if (activeTabId && !workspaceTabs.some((tab) => tab.id === activeTabId)) activeTabId = workspaceTabs[0]?.id ?? null;
  }

  function openTab(tab: WorkspaceTab): void {
    if (!workspaceTabs.some((current) => current.id === tab.id)) workspaceTabs = [...workspaceTabs, tab];
    activeTabId = tab.id;
    openWorkspace();
  }

  /**
   * A choice made from NewView changes that tab in place. Singleton views keep
   * their stable ids so cross-window ownership and reopening continue to work;
   * a destination that is already open simply wins focus and removes the
   * redundant New tab.
   */
  function replaceActiveNewTab(tab: WorkspaceTab): boolean {
    const newIndex = workspaceTabs.findIndex((current) => current.id === activeTabId && current.kind === 'new');
    if (newIndex < 0) return false;
    const existingIndex = workspaceTabs.findIndex((current) => current.id === tab.id);
    if (existingIndex >= 0 && existingIndex !== newIndex)
      workspaceTabs = workspaceTabs.filter((_, index) => index !== newIndex);
    else
      workspaceTabs = workspaceTabs.map((current, index) => index === newIndex ? tab : current);
    activeTabId = tab.id;
    openWorkspace();
    return true;
  }

  /**
   * Closing the last tab leaves the panel open on its launcher rather than
   * dismissing it: the panel is a place, and closing what is inside it is not
   * the same gesture as putting it away.
   */
  function closeTab(id: string, releaseSingleton = true): void {
    const index = workspaceTabs.findIndex((tab) => tab.id === id);
    const closing = workspaceTabs[index];
    workspaceTabs = workspaceTabs.filter((tab) => tab.id !== id);
    if (activeTabId === id) activeTabId = workspaceTabs[Math.max(0, index - 1)]?.id ?? null;
    // The embedded browser's native view outlives the Svelte component, so the
    // tab closing is what actually tears it down.
    if (closing?.kind === 'browser') void api.browser.close(id);
    if (releaseSingleton && closing && isSharedWorkspaceSingleton(closing.kind))
      workspaceSingletonChannel?.postMessage({type: 'closed', kind: closing.kind, owner: workspaceWindowOwner});
  }

  function reorderWorkspaceTabs(ids: string[]): void {
    const byId = new Map(workspaceTabs.map((tab) => [tab.id, tab]));
    const reordered = ids.map((id) => byId.get(id)).filter((tab): tab is WorkspaceTab => Boolean(tab));
    if (reordered.length === workspaceTabs.length) workspaceTabs = reordered;
  }

  const singletonTitles: Partial<Record<WorkspaceTabKind, MessageKey>> = {drive: 'workspace.drive', schedule: 'workspace.schedule', calendar: 'workspace.calendar', hub: 'workspace.hub', subagents: 'workspace.subagents', tasks: 'workspace.tasks'};
  type SharedWorkspaceSingleton = 'drive' | 'schedule' | 'calendar' | 'hub' | 'tasks';
  type WorkspaceSingletonMessage =
    | {type: 'query'; owner: string}
    | {type: 'opened' | 'closed'; kind: SharedWorkspaceSingleton; owner: string};
  const workspaceWindowOwner = crypto.randomUUID();
  let remoteSingletonOwners: Partial<Record<SharedWorkspaceSingleton, string>> = {};
  const workspaceSingletonChannel = typeof BroadcastChannel === 'undefined'
    ? null
    : new BroadcastChannel('polymux-workspace-singletons');

  function isSharedWorkspaceSingleton(kind: WorkspaceTabKind): kind is SharedWorkspaceSingleton {
    return kind === 'drive' || kind === 'schedule' || kind === 'calendar' || kind === 'hub' || kind === 'tasks';
  }

  function localWorkspaceSingletons(): SharedWorkspaceSingleton[] {
    return workspaceTabs.map((tab) => tab.kind).filter(isSharedWorkspaceSingleton);
  }

  function claimWorkspaceSingleton(kind: WorkspaceTabKind): void {
    if (!isSharedWorkspaceSingleton(kind)) return;
    const {[kind]: _removed, ...remaining} = remoteSingletonOwners;
    remoteSingletonOwners = remaining;
    workspaceSingletonChannel?.postMessage({type: 'opened', kind, owner: workspaceWindowOwner});
  }

  function releaseLocalWorkspaceSingletons(): void {
    if (!workspaceSingletonChannel) return;
    for (const kind of localWorkspaceSingletons())
      workspaceSingletonChannel.postMessage({type: 'closed', kind, owner: workspaceWindowOwner});
  }

  onMount(() => {
    if (!workspaceSingletonChannel) return;
    workspaceSingletonChannel.onmessage = (event: MessageEvent<WorkspaceSingletonMessage>) => {
      const message = event.data;
      if (!message || message.owner === workspaceWindowOwner) return;
      if (message.type === 'query') {
        for (const kind of localWorkspaceSingletons())
          workspaceSingletonChannel.postMessage({type: 'opened', kind, owner: workspaceWindowOwner});
        return;
      }
      if (message.type === 'opened') {
        remoteSingletonOwners = {...remoteSingletonOwners, [message.kind]: message.owner};
        closeTab(SINGLETON_TAB_IDS[message.kind]!, false);
      } else if (remoteSingletonOwners[message.kind] === message.owner) {
        const {[message.kind]: _removed, ...remaining} = remoteSingletonOwners;
        remoteSingletonOwners = remaining;
      }
    };
    workspaceSingletonChannel.postMessage({type: 'query', owner: workspaceWindowOwner});
    for (const kind of localWorkspaceSingletons()) claimWorkspaceSingleton(kind);
    window.addEventListener('pagehide', releaseLocalWorkspaceSingletons);
    return () => {
      window.removeEventListener('pagehide', releaseLocalWorkspaceSingletons);
      releaseLocalWorkspaceSingletons();
      workspaceSingletonChannel.close();
    };
  });

  function reorderPinnedViews(views: Array<'drive' | 'schedule' | 'calendar' | 'hub' | 'tasks'>): void {
    pinnedViews = views;
    void api.general.update({pinnedViews: views}).catch(() => {});
  }

  function togglePinView(kind: 'drive' | 'schedule' | 'calendar' | 'hub' | 'tasks'): void {
    const next = pinnedViews.includes(kind)
      ? pinnedViews.filter((v) => v !== kind)
      : [...pinnedViews, kind];
    pinnedViews = next;
    void api.general.update({pinnedViews: next}).catch(() => {});
  }

  function openSeparateWorkspaceView(
    kind: 'drive' | 'schedule' | 'calendar' | 'hub' | 'tasks',
    placement?: {x: number; y: number; width?: number; height?: number},
  ): void {
    const tabId = SINGLETON_TAB_IDS[kind];
    if (tabId) closeTab(tabId);
    void api.window.openWorkspaceView(kind, activeId || undefined, placement);
  }

  function newTab(kind: WorkspaceTabKind = 'media'): void {
    if (kind === 'new') {
      openTab({id: crypto.randomUUID(), title: translate('workspace.newTab'), kind});
      return;
    }
    const singletonId = SINGLETON_TAB_IDS[kind];
    const named = singletonTitles[kind];
    claimWorkspaceSingleton(kind);
    const activeNew = workspaceTabs.find((tab) => tab.id === activeTabId && tab.kind === 'new');
    const tab = {
      id: singletonId ?? activeNew?.id ?? crypto.randomUUID(),
      title: translate(named ?? 'workspace.newTab'),
      kind,
    };
    if (!replaceActiveNewTab(tab)) openTab(tab);
  }

  /**
   * Storage, beyond this conversation's own files.
   *
   * The conversation's own files are one source among the connected providers,
   * each browsed a folder at a time.
   */
  /** This chat's own output folder, and this Mac. Both are the local provider;
   * they differ in where they are rooted. */
  const OUTPUTS_SOURCE = 'local#outputs';
  const HOME_SOURCE = 'local#home';
  const ALL_SOURCE = 'all#all';
  let driveStatus: DriveStatusDto | null = null;
  let driveSourceId = ALL_SOURCE;
  let driveLoading = false;
  let driveError = '';
  /** Folders already fetched, keyed `<source>:<path>`. Cleared when the source
   * changes, since a path only means something inside its own source. */
  let driveFolders: Record<string, DriveEntry[]> = {};
  /** The absolute path of this conversation's output folder, which is where
   * the outputs source is rooted. Empty until the main process answers. */

  onMount(() => {
    void applySchedule(Promise.resolve());
    return api.schedules.subscribe((items) => {
      scheduleItems = items;
    });
  });

  onMount(() => {
    void applyTasks(Promise.resolve());
    return api.tasks.subscribe((items) => {
      taskItems = items.filter((item) => item.chatId === activeId);
    });
  });

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
      // the source picker simply comes up empty.
    }
  }

  /**
   * Follows the open conversation to its own output folder.
   *
   * The folder is created by the main process on the way back, so the drive can
   * be opened on a chat that has not written anything yet and still show a real
   * place rather than an error.
   */
  /** Every source opens at its own root. Output used to be rooted per chat;
   * it is one Polymux folder now, which is that provider's root. */
  const driveRootPath = '';

  /**
   * The places the drive can open, in the order the switch shows them.
   *
   * Everything at once leads, then the Polymux folder the agent writes into,
   * then this Mac; then every signed
   * in cloud account. An account's address trails its provider's name because
   * two Google Drives are otherwise the same entry twice.
   *
   * Only connected sources are offered: a source in the switch is a promise
   * that opening it will show something.
   */
  $: driveSources = (driveStatus?.sources ?? [])
    .filter((source) => source.state === 'connected')
    .map((source) => {
      // The home folder is a place rather than a storage backend, so it wears a
      // house instead of the drive mark the other local source carries.
      if (source.id === HOME_SOURCE)
        return {id: source.id, name: $t('drive.home'), icon: 'home' as const};
      // The backend names a source in English; anything that describes rather
      // than brands — "All storage", "This Mac" — is put back into the
      // interface language here.
      const name =
        source.id === OUTPUTS_SOURCE
          ? $t('drive.outputs')
          : withLocale($locale, driveProviderName(source.provider, source.name));
      return {
        id: source.id,
        name: source.accountLabel ? `${name} – ${source.accountLabel}` : name,
        provider: source.provider,
        // Carried through on its own as well as folded into the name: the
        // drive's toolbar names the account by itself when a file is selected.
        accountLabel: source.accountLabel,
      };
    });

  $: driveRoot = {
    id: 'drive-root',
    name: driveSources.find((source) => source.id === driveSourceId)?.name ?? $t('workspace.drive'),
    kind: 'folder',
    // Every source but the outputs folder is rooted at the empty path, which
    // is what lets one tree builder serve all of them. `driveFolders` is named
    // here rather than only inside the builder because a reactive statement
    // tracks what it references itself, not what its callees read — without it
    // the tree would never see a folder arrive.
    children: driveBranch(driveFolders, driveSourceId, driveRootPath),
  } satisfies DriveEntry;

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
    // The cache is keyed by source as well as path, so what was fetched for
    // the source being left stays valid — and coming back to it paints from
    // that rather than fetching the same folders again.
    void loadDriveFolder('');
  }

  /** Folders being fetched right now, so a listing asked for twice before the
   * first answer arrives is not fetched twice. */
  const driveFetching = new Set<string>();

  /** The folder this drive tab has already asked for since it came to the
   * front, so the read below happens once per arrival rather than on every
   * render. Cleared when the tab is not the one on screen. */
  let driveShowing = '';

  /**
   * Opening the drive is what fetches it, and *re*opening it fetches again.
   *
   * Only an explicit open request or a completed action used to load a folder,
   * so a drive tab restored with the session — or one simply switched back
   * to — painted an empty folder over files that were really there, and the
   * only way to see them was to change something. Reading only when nothing
   * was cached fixed the empty case and left a worse one: a folder seen once
   * was never asked about again, so a file added while the app was open stayed
   * invisible however many times you left and came back. A drive is somebody
   * else's to change — the agent's, another app's, the Finder's — so arriving
   * at one is a reason to ask. The cached listing stays on screen while the
   * answer is on its way, so this costs nothing visible.
   */
  $: {
    const showing =
      workspaceTabs.some((tab) => tab.id === activeTabId && tab.kind === 'drive')
        ? `${driveSourceId}:${driveRootPath}`
        : '';
    if (showing !== driveShowing) {
      driveShowing = showing;
      if (showing) void loadDriveFolder(driveRootPath);
    }
  }

  /**
   * Fetches one folder from the active source. A folder already fetched is
   * shown while the fresh copy is on its way, so opening one that has been
   * seen is instant and only its contents change under you.
   */
  async function loadDriveFolder(path: string): Promise<void> {
    const source = driveSourceId;
    const key = `${source}:${path}`;
    if (driveFetching.has(key)) return;
    driveFetching.add(key);
    driveLoading = driveFolders[key] === undefined;
    try {
      const entries = await api.drive.list(source, path);
      driveFolders = {
        ...driveFolders,
        [`${source}:${path}`]: entries.map((entry) => ({
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
          webUrl: entry.webUrl ?? null,
        })),
      };
    } catch (cause) {
      // A folder that will not open is worth saying out loud too — otherwise
      // it just reads as an empty folder.
      driveError = readableError(cause);
    } finally {
      driveFetching.delete(key);
      driveLoading = false;
    }
  }

  /**
   * The drive's toolbar actions.
   *
   * Live on every source: this chat's folder is a real folder on disk now
   * rather than a listing of what a run produced, so there is nowhere in the
   * switch that cannot be written to.
   */
  /** Opens the selected entry where it lives. Local and network files have a
   * real place on a volume, so this is the OS file browser. */
  function revealDriveEntry(entry: DriveEntry): void {
    // The button says where the file is, so it goes to the provider's page
    // when there is one and to the file on the volume when there is not.
    if (entry.webUrl) {
      void api.browser.openExternal(entry.webUrl);
      return;
    }
    void runDriveAction(async (source) => {
      await api.drive.revealEntry(source, entry.id);
      return null;
    });
  }

  $: driveActions = {
    newFolder: (parent: DriveEntry, name: string) => void runDriveAction(async (source) => {
      await api.drive.createFolder(source, driveFolderPath(parent), name);
      return driveFolderPath(parent);
    }),
    upload: (files: File[], parent: DriveEntry, onProgress?: (fraction: number) => void) => runDriveAction(async (source) => {
      const paths = await api.files.paths(files);
      if (!paths.length) return null;
      await api.drive.upload(source, driveFolderPath(parent), paths, onProgress);
      return driveFolderPath(parent);
    }),
    // Dropped from the Finder. Only the main process can turn a dropped File
    // into somewhere on disk, so the paths are resolved here and the upload
    // is the same one the toolbar button runs.
    dropFiles: (files: File[], destination: DriveEntry, onProgress?: (fraction: number) => void) => runDriveAction(async (source) => {
      const paths = await api.files.paths(files);
      if (!paths.length) return null;
      await api.drive.upload(source, driveFolderPath(destination), paths, onProgress);
      return driveFolderPath(destination);
    }),
    rename: (entry: DriveEntry, name: string) => void runDriveAction(async (source) => {
      await api.drive.rename(source, entry.id, name);
      return driveParentPath(entry);
    }),
    move: (entries: DriveEntry[], destination: DriveEntry, onProgress?: (fraction: number) => void) => runDriveAction(async (source) => {
      const from = driveParentPath(entries[0]);
      const destinationPath = driveFolderPath(destination);
      const destinationSource = driveSources.find((candidate) =>
        destinationPath === candidate.id || destinationPath.startsWith(`${candidate.id}/`),
      )?.id ?? source;
      const crossesSources = destinationSource !== source;
      const actionSource = source === ALL_SOURCE || crossesSources ? ALL_SOURCE : source;
      const paths = actionSource === ALL_SOURCE && source !== ALL_SOURCE
        ? entries.map((entry) => `${source}/${entry.id}`)
        : entries.map((entry) => entry.id);
      const qualifiedDestination = actionSource === ALL_SOURCE && destinationSource === source && !destinationPath.startsWith(`${source}/`)
        ? `${source}/${destinationPath}`
        : destinationPath;
      await api.drive.move(actionSource, paths, qualifiedDestination, onProgress);
      // A cross-provider move still belongs in the one virtual view. Return to
      // and refresh that combined root so the row changes provider instead of
      // disappearing from whichever individual source happened to be open.
      if (crossesSources) {
        driveSourceId = ALL_SOURCE;
        await loadDriveFolder('');
        return null;
      }
      await loadDriveFolder(destinationPath);
      return from;
    }),
    duplicate: (entries: DriveEntry[]) => void runDriveAction(async (source) => {
      await api.drive.copy(source, entries.map((entry) => entry.id));
      return driveParentPath(entries[0]);
    }),
    download: (entry: DriveEntry) => void runDriveAction(async (source) => {
      await api.drive.download(source, entry.id);
      return null;
    }),
    remove: (entries: DriveEntry[]) => void runDriveAction(async (source) => {
      await api.drive.remove(source, entries.map((entry) => entry.id));
      return driveParentPath(entries[0]);
    }),
  };

  /** Runs a drive action and reloads whichever folder it changed. */
  async function runDriveAction(
    action: (source: string) => Promise<string | null>,
  ): Promise<void> {
    driveError = '';
    try {
      const reload = await action(driveSourceId);
      if (reload !== null) await loadDriveFolder(reload);
    } catch (cause) {
      // Shown rather than logged: a name already taken or a provider that has
      // stopped answering is the user's to resolve, and a console message
      // makes a failed action look like a button that does nothing.
      driveError = readableError(cause);
    }
  }

  /** The root folder answers with wherever the active source is rooted, not
   * with its synthetic id. */
  function driveFolderPath(entry: DriveEntry): string {
    return entry.id === 'drive-root' ? driveRootPath : entry.id;
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

  /**
   * Which drives hold their files on this Mac, so a path is a path.
   *
   * A cloud drive names a file that lives somewhere else: its id is the
   * provider's id, not somewhere bytes can be read from, so opening one keeps
   * the behaviour it already had — the provider's own page, which is also the
   * only thing that can show a Workspace document at all.
   */
  const ON_DISK: ReadonlySet<string> = new Set(['local', 'network']);

  /** Where a drive entry's bytes are on this Mac, if they are. `entry.id` is
   * the file's own path on the drives that hold their files here. */
  function driveEntryPath(entry: DriveEntry): string | undefined {
    return entry.uri ?? (entry.provider && ON_DISK.has(entry.provider) ? entry.id : undefined);
  }

  /** The menu opens under the pointer, on the row that was opened. */
  function openDriveEntry(entry: DriveEntry, point?: {x: number; y: number}): void {
    void showOpenMenu({kind: 'drive', entry}, point ? {point} : {point: {x: 0, y: 0}});
  }

  /**
   * Every edit goes to the main process and comes back as a fresh list: it
   * owns the clock, so it is the only side that can say when a schedule next
   * runs. Nothing here recomputes a next run for itself.
   */
  async function applySchedule(action: Promise<unknown>): Promise<void> {
    try {
      await action;
      scheduleItems = await api.schedules.list();
    } catch (error) {
      scheduleError = error instanceof Error ? error.message : String(error);
    }
  }

  function toggleSchedule(item: ScheduleItem): void {
    void applySchedule(api.schedules.update(item.id, {
      status: item.status === 'paused' ? 'active' : 'paused',
    }));
  }

  function deleteSchedule(item: ScheduleItem): void {
    void applySchedule(api.schedules.remove(item.id));
  }

  function markScheduleRead(item: ScheduleItem): void {
    void applySchedule(api.schedules.markRead(item.id));
  }

  /** Firing by hand is the same run the clock would have started, so it goes
   * through the scheduler rather than the composer: it lands in the schedule's
   * own conversation and is recorded in its history like any other run. */
  function runScheduleNow(item: ScheduleItem): void {
    void applySchedule(api.schedules.runNow(item.id));
  }

  /** Opens the conversation a run reported into. */
  function openScheduleRun(item: ScheduleItem, run?: ScheduleRun): void {
    const conversationId = run?.conversationId ?? item.history.find((entry) => entry.conversationId)?.conversationId;
    if (!conversationId) return;
    void openChat(conversationId);
  }

  /**
   * A schedule written in the view rather than asked for in the chat: the
   * sheet collects the instruction and the cadence, and this saves it. Asking
   * the agent still works — it has a tool for exactly this — but it is no
   * longer the only way to make one.
   */
  async function applyTasks(action: Promise<unknown>, conversationId = activeId): Promise<void> {
    try {
      await action;
      taskItems = conversationId ? await api.tasks.list(conversationId) : [];
    } catch (error) {
      tasksError = error instanceof Error ? error.message : String(error);
    }
  }

  function createTaskCard(title: string, detail?: string): void {
    if (!activeId) return;
    void applyTasks(api.tasks.create({chatId: activeId, title, detail}), activeId);
  }

  function updateTaskCard(id: string, patch: Partial<TaskCard>): void {
    void applyTasks(api.tasks.update(id, patch));
  }

  function deleteTaskCard(id: string): void {
    void applyTasks(api.tasks.remove(id));
  }

  function markTasksRead(id: string): void {
    void applyTasks(api.tasks.markRead(id));
  }

  function recycleTaskCard(id: string): void {
    void applyTasks(api.tasks.update(id, {status: 'todo', owner: undefined, reviewed: false}));
  }

  function openVisit(url: string, title: string): void {
    const activeNew = workspaceTabs.find((tab) => tab.id === activeTabId && tab.kind === 'new');
    const tab: WorkspaceTab = {id: activeNew?.id ?? crypto.randomUUID(), title, kind: 'browser', url};
    if (!replaceActiveNewTab(tab)) openTab(tab);
  }

  function saveSchedule(
    input: {title: string; prompt: string; frequency: ScheduleFrequency},
    id: string | null,
  ): void {
    void applySchedule(id ? api.schedules.update(id, input) : api.schedules.create(input));
  }

  /**
   * A link the agent mentioned. Pages it worked on in the user's own browser
   * belong there — that tab already holds the session and the state the work
   * depends on — and everything else opens in the in-app Browser, which is the
   * default surface. A page already open in a workspace tab is just revealed.
   */
  /** A link in a message opens in the system browser: following one is leaving
   * the conversation, not asking Polymux to work on the page — the workspace
   * browser stays for pages Polymux itself is on. */
  /** The install chip's visibility. Re-checked whenever Settings closes, since
   * that is when an install started from the Settings row would have landed. */
  let extensionStatus: BrowserExtensionDto | null = null;

  function refreshExtensionStatus(): void {
    void api.extension.status().then((value) => extensionStatus = value).catch(() => {});
  }

  function installExtension(): void {
    void api.extension.openInstall().catch(() => {});
  }

  function dismissExtension(): void {
    void api.extension.dismiss().then((value) => extensionStatus = value).catch(() => {});
  }

  /**
   * Opening something is a choice, so it is asked rather than assumed.
   *
   * A link can go to the browser the user actually browses in or to the one
   * inside this app; a file can often be shown here *and* opened by whatever
   * owns its type; a file in a cloud drive may be reachable on the web, or may
   * only be reachable by fetching it first. Picking one of those silently is
   * right about half the time, and the half it is wrong about is the half that
   * takes the user out of the app. So the ways of opening are listed, and the
   * list only ever contains ways that actually work for that thing.
   */
  type OpenTarget =
    | {kind: 'link'; url: string}
    | {kind: 'file'; path: string}
    | {kind: 'drive'; entry: DriveEntry};

  let openMenu: {anchor: OpenAnchor; choices: OpenChoice[]; target: OpenTarget} | null = null;

  /**
   * The application this Mac opens web links with. Read once and kept, so the
   * menu opens without waiting; null on a machine that cannot say, where the
   * choice is named generically instead.
   */
  let defaultApp: DefaultAppDto | null = null;
  let defaultAppAsked = false;
  async function loadDefaultApp(): Promise<void> {
    if (defaultAppAsked) return;
    defaultAppAsked = true;
    defaultApp = await api.browser.defaultApp().catch(() => null);
  }

  /** "Open in Helium" where the machine says so, "Open in browser" where it
   * cannot: a menu that names nothing is worse than one that names a category. */
  function externalChoice(): OpenChoice {
    return {
      value: 'external',
      label: defaultApp ? translate('open.inApp', {app: defaultApp.name}) : translate('open.inBrowser'),
      ...(defaultApp?.icon ? {image: defaultApp.icon} : {icon: 'external' as const}),
    };
  }

  /**
   * Which application owns a file, kept by extension.
   *
   * The answer is a property of the type rather than of the file, and the same
   * type is opened over and over, so asking once keeps the second menu instant.
   */
  const fileApps = new Map<string, DefaultAppDto | null>();
  async function appForFile(filePath: string): Promise<DefaultAppDto | null> {
    const dot = filePath.lastIndexOf('.');
    const kind = dot > 0 ? filePath.slice(dot).toLowerCase() : filePath;
    if (!fileApps.has(kind))
      fileApps.set(kind, await api.browser.defaultApp(filePath).catch(() => null));
    return fileApps.get(kind) ?? null;
  }

  /** "Open in Preview", with Preview's icon — or the generic wording on a
   * machine that cannot say which application owns the type. */
  function systemChoice(owner: DefaultAppDto | null): OpenChoice {
    return {
      value: 'system',
      label: owner ? translate('open.inApp', {app: owner.name}) : translate('open.inDefaultApp'),
      ...(owner?.icon ? {image: owner.icon} : {icon: 'external' as const}),
    };
  }

  /** In this app's own browser tab. */
  const workspacePageChoice: OpenChoice = {value: 'workspace-page', label: translate('open.inWorkspace'), icon: 'globe'};

  /**
   * What the workspace can draw or play for itself. Deliberately narrower than
   * the kinds the drive files things under: a `.mkv` is a video everywhere
   * except in a <video>, and a `.heic` is an image everywhere except in a page.
   */
  const VIEWABLE_FILE = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|mp4|webm|m4v|mov|ogv)$/i;

  /** What the browser can show. A PDF is here rather than with the documents
   * because Chromium renders one and no other application is needed. */
  const BROWSABLE_FILE = /\.(?:html?|xhtml|pdf)$/i;

  /** What a file can be shown as here, or nothing when it can only be handed over. */
  function workspaceChoiceFor(name: string): OpenChoice | null {
    if (VIEWABLE_FILE.test(name))
      return {
        value: 'workspace-media',
        label: translate('open.inWorkspace'),
        icon: /\.(?:mp4|webm|m4v|mov|ogv)$/i.test(name) ? 'video' : 'image',
      };
    if (BROWSABLE_FILE.test(name)) return workspacePageChoice;
    return null;
  }

  async function showOpenMenu(target: OpenTarget, anchor: OpenAnchor): Promise<void> {
    await loadDefaultApp();
    const choices = await openChoices(target);
    // Nothing to choose between is not a menu. One way of opening it is just
    // how it opens.
    if (choices.length < 2) {
      if (choices[0]) void runOpenChoice(target, choices[0].value);
      return;
    }
    openMenu = {anchor, choices, target};
  }

  async function openChoices(target: OpenTarget): Promise<OpenChoice[]> {
    if (target.kind === 'link') return [externalChoice(), workspacePageChoice];
    if (target.kind === 'file') {
      const here = workspaceChoiceFor(target.path);
      return [...(here ? [here] : []), systemChoice(await appForFile(target.path))];
    }
    const {entry} = target;
    const onDisk = driveEntryPath(entry);
    if (onDisk) {
      const here = workspaceChoiceFor(entry.name);
      return [...(here ? [here] : []), systemChoice(await appForFile(onDisk))];
    }
    // A cloud file has no bytes on this Mac. Where the provider keeps a page
    // for it, that page opens either place; where it does not — an S3 object —
    // fetching it is the only thing "open" can mean.
    if (entry.webUrl) return [externalChoice(), workspacePageChoice];
    return [{value: 'download', label: translate('open.downloadAndOpen'), icon: 'download'}];
  }

  async function runOpenChoice(target: OpenTarget, value: string): Promise<void> {
    const url = target.kind === 'link' ? target.url : target.kind === 'drive' ? target.entry.webUrl ?? '' : '';
    if (value === 'external') {
      void api.browser.openExternal(url);
      return;
    }
    if (value === 'workspace-page' && target.kind !== 'file' && url) {
      openTab({id: `page:${url}`, title: pageTitleFor(target), kind: 'browser', url});
      return;
    }
    const path = target.kind === 'file' ? target.path
      : target.kind === 'drive' ? driveEntryPath(target.entry) : undefined;
    if (value === 'download') {
      if (target.kind === 'drive') void api.drive.openEntry(driveSourceId, target.entry.id);
      return;
    }
    if (!path) return;
    if (value === 'system') {
      // A link to a file that has since been moved or deleted rejects here.
      // Logged rather than surfaced: a dead link is not worth interrupting the
      // conversation for.
      void api.browser.openPath(path).catch((reason: unknown) => console.warn('openPath', reason));
      return;
    }
    const src = await previewSource(path);
    // The grant is what makes the file readable by a view; without it the file
    // is handed to the system rather than dropped, since opening it elsewhere
    // beats not opening it.
    if (!src) {
      void api.browser.openPath(path).catch((reason: unknown) => console.warn('openPath', reason));
      return;
    }
    const title = target.kind === 'drive' ? target.entry.name : fileName(path);
    openTab(value === 'workspace-page'
      ? {id: `page:${path}`, title, kind: 'browser', url: src}
      : {id: `media:${path}`, title, kind: 'media', url: src});
  }

  function pageTitleFor(target: OpenTarget): string {
    if (target.kind === 'drive') return target.entry.name;
    if (target.kind === 'link') {
      try {
        return new URL(target.url).hostname;
      } catch {
        return target.url;
      }
    }
    return fileName(target.path);
  }

  function chooseOpen(value: string): void {
    const target = openMenu?.target;
    openMenu = null;
    if (target) void runOpenChoice(target, value);
  }

  function openLink(url: string, _title: string, rect?: DOMRect): void {
    // Without a box to hang the menu under — a caller that is not a link in a
    // message — the old behaviour stands: hand it straight to the browser.
    if (!rect) {
      void api.browser.openExternal(url);
      return;
    }
    void showOpenMenu({kind: 'link', url}, {rect});
  }

  /** A file the agent wrote, opened in whatever application owns it. The main
   * process checks the path exists and is a regular file before the shell
   * sees it, so a stale or bogus link surfaces as an error rather than acting. */
  /**
   * Opens a file the way it deserves to be opened: a still or a clip in the
   * workspace, anything else in its own application.
   *
   * A page cannot read the disk, so a viewable file is asked for by path and
   * comes back as a url the host has granted — see `workspace.preview`. When
   * that fails the file is handed to the system anyway rather than dropped:
   * the user asked to open something, and opening it elsewhere beats nothing.
   */
  function openFilePath(filePath: string, rect?: DOMRect): void {
    void showOpenMenu({kind: 'file', path: filePath}, rect ? {rect} : {point: {x: 0, y: 0}});
  }

  /**
   * What a view should load for a source the host named. A source that already
   * carries a scheme is loadable as it stands — a bridged `polymux-media://`
   * attachment, say — and one that does not is a path on disk, which the page
   * may only read once the host has granted it.
   */
  async function previewSource(source: string | undefined): Promise<string | undefined> {
    if (!source) return undefined;
    if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return source;
    try {
      return await api.workspace.preview(source);
    } catch (reason: unknown) {
      console.warn('preview', reason);
      return undefined;
    }
  }

  /** The last segment of a path, on either separator, for a tab's title. */
  function fileName(filePath: string): string {
    const parts = filePath.split(/[\\/]/);
    return parts[parts.length - 1] || filePath;
  }

  /** The embedded browser reports its page as it settles, which is also where
   * a visit becomes worth remembering for the launcher. */
  function updateTabState(id: string, patch: {title?: string; url?: string; favicon?: string | null}): void {
    workspaceTabs = workspaceTabs.map((tab) => tab.id === id
      ? {...tab, ...patch, title: patch.title ?? tab.title, url: patch.url ?? tab.url, favicon: patch.favicon === undefined ? tab.favicon : patch.favicon}
      : tab);
    const tab = workspaceTabs.find((entry) => entry.id === id);
    if (tab?.kind === 'browser' && tab.url) recordVisit({url: tab.url, title: tab.title, favicon: tab.favicon});
  }

  const SUMMARY_SECTION_TITLES: Record<SummarySection, MessageKey> = {
    outputs: 'summary.outputs',
    references: 'summary.references',
    tasks: 'summary.tasks',
  };

  function viewSummary(section: SummarySection): void {
    openTab({id: `summary-${section}`, title: translate(SUMMARY_SECTION_TITLES[section]), kind: 'summary', section});
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
    return {id: '', title: '', updatedAt: Date.now(), messages: []};
  }

  function fromConversation(conversation: ConversationDto): Conversation {
    return {
      id: conversation.id,
      title: conversation.title,
      updatedAt: Date.parse(conversation.updatedAt),
      messages: [],
    };
  }

  /** One assistant bubble per run: the last message that says something. A
   * stopped run's final stored message is often tool calls with no prose, and
   * hiding the paragraph before it would read as if the agent had gone quiet —
   * so the rows that carry text win, and a run with none falls back to its last
   * row so the activity group still has somewhere to hang. */
  function visibleAssistantRows(stored: MessageDto[]): MessageDto[] {
    const spokenRuns = new Set(stored.flatMap((message) =>
      message.role === 'assistant' && message.runId && contentText(message.content).trim() ? [message.runId] : [],
    ));
    return stored.filter((message, index, messages) => {
      if (message.role !== 'assistant' || !message.runId) return true;
      const spoken = spokenRuns.has(message.runId);
      if (spoken && !contentText(message.content).trim()) return false;
      return !messages.slice(index + 1).some((later) =>
        later.role === 'assistant'
        && later.runId === message.runId
        && (!spoken || contentText(later.content).trim() !== ''),
      );
    });
  }

  function mergeMessages(stored: MessageDto[], current: ChatMessage[]): ChatMessage[] {
    const visibleStored = visibleAssistantRows(stored);
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
          // A cancelled or paused turn can be stored with nothing in it, while
          // the live row still holds everything the agent had written and done.
          // Storage wins only where it has something to say — otherwise a stop
          // would wipe the very work the user stopped to read.
          text: mapped.text || previous.text,
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
    // A live assistant row has no stored time yet — it is whatever the agent is
    // writing right now, so it sorts to the foot. Falling back to when its run
    // started put it above any message steered into that same run.
    const order = (message: ChatMessage) => message.sentAt ?? '\uffff';
    return [...mapped, ...live].sort((a, b) => order(a).localeCompare(order(b)));
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
      filePaths: message.attachments.map((attachment) => attachment.path),
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
      document: 'media', slides: 'media', sheet: 'media', photo: 'media', video: 'media', other: 'media',
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
    // A reasoning block carries its chain of thought in `text`, exactly like a
    // real text block. Rendering it would put the model's private deliberation
    // ("The user asks…") in the reply body, so drop it — the thinking activity
    // is where reasoning belongs.
    if (record.type === 'reasoning' || record.type === 'thinking') return '';
    if (typeof record.text === 'string') return record.text;
    return record.content === undefined ? '' : contentText(record.content);
  }

  /** Providers commonly report failures as `<status>: {"message":"…"}`. Show the
      human sentence rather than the raw envelope. */
  function readableFailure(message: string): string {
    const start = message.indexOf('{');
    if (start < 0) return message;
    try {
      const body = asRecord(JSON.parse(message.slice(start)) as JsonValue);
      const inner = typeof body.message === 'string' ? body.message : '';
      return inner || message;
    } catch {
      return message;
    }
  }

  function runFailureMessage(payload: Record<string, JsonValue>): string {
    const result = asRecord(payload.result);
    const failure = asRecord(result.error);
    const message = typeof failure.message === 'string' ? readableFailure(failure.message) : translate('run.incomplete');
    // Checked before the credential test: a region gate is refused with a 403
    // and reads like an access denial, but no key change can lift it.
    const regionGated = /(?:regionerror|hosted in china|opt.?in|not available in your (?:region|country))/i.test(message);
    if (regionGated)
      return translate('run.failedRegion');
    const authenticationFailure = /(?:missing authentication|unauthori[sz]ed|invalid api key|\b401\b)/i.test(message);
    if (authenticationFailure)
      return translate('run.failedAuth');
    const rateLimited = /(?:rate.?limit|429|too many requests|quota|usage limit|free.?usage)/i.test(message);
    if (rateLimited)
      return translate('run.failedRateLimit');
    return translate('run.failed', {message});
  }

  function isSubagentTask(name: string): boolean {
    return name.toLowerCase() === 'subagent';
  }

  /** A short excerpt of a tool's output for the row's expandable detail —
   * enough to see what the call produced without opening the raw transcript. */
  function activityResultDetail(payload: Record<string, JsonValue>): string {
    const text = contentText(asRecord(payload.result).content ?? asRecord(payload.error).message).trim();
    return text.length > 280 ? `${text.slice(0, 280)}…` : text;
  }

</script>

<svelte:window
  bind:innerWidth={viewportWidth}
  on:resize={markWindowResizing}
  on:focus={() => windowActive = true}
  on:blur={() => windowActive = false}
/>

<main
  class:app-under-splash={startupVisible && !startupLeaving}
  class:app-entering={startupToApp && startupLeaving}
  class:has-conversation={active.messages.length > 0 || (voiceOpen && voiceInChat)}
  class:voice-in-chat={voiceOpen && voiceInChat}
  class:empty-voice-chat={voiceStartedEmpty && voiceOpen && voiceInChat}
  class:panel-open={mode !== 'none'}
  class:workspace-open={mode === 'workspace'}
  class:summary-open={mode === 'summary'}
  class:workspace-expanded={workspaceExpanded}
  class:workspace-resizing={workspaceResizing}
  class:chat-drawer-resizing={chatDrawerResizing}
  class:window-resizing={windowResizing}
  class:chat-drawer-open={chatDrawerOpen}
  class:has-queue={queueHeight > 0}
  class:agent-file-drag-active={agentFileDragActive}
  style={`--chat-drawer-column: ${chatDrawerOpen ? chatDrawerWidth : 0}px; --chat-drawer-offset: ${chatDrawerOpen ? chatDrawerWidth : 0}px; --content-right-column: ${contentRightColumn}; --content-composer-column: ${composerColumn}; --content-docked-column: ${workspaceWidth}px; --workspace-panel-width: ${workspacePanelWidth}; --workspace-expanded-tab-left: ${chatDrawerOpen ? "8px" : "calc(var(--chrome-inset) + 8px + var(--titlebar-control-size) + var(--titlebar-control-lead))"}; --chat-drawer-panel-width: ${chatDrawerWidth}px; --queue-height: ${queueHeight}px; --timeline-left: ${timelineLeft}px`}
>
  <div class="window-drag-region" aria-hidden="true"></div>
  <div class:visible={!windowActive} class="inactive-traffic-lights" aria-hidden="true">
    <i></i><i></i><i></i>
  </div>
  <div class="agent-file-drop-pane-overlay" aria-hidden="true"></div>

  {#if requestedWorkspaceView === null}<TitleBar
    title={active.title || $t('chat.untitled')}
    showTitle={active.messages.length > 0}
    showSummary={mode === 'summary' || active.messages.length > 0}
    hideNewChat={workspaceExpanded && !chatDrawerOpen}
    showChatToggle={requestedWorkspaceView === null}
    {chatDrawerOpen}
    {mode}
    onRename={rename}
    onToggleChatDrawer={() => chatDrawerOpen = !chatDrawerOpen}
    onNewChat={newChat}
    onSearchChats={() => chatSearchOpen = true}
    onTogglePanel={togglePanel}
    onOpenSettings={() => openSettings()}
    {pinnedViews}
    onOpenView={(kind) => newTab(kind)}
    onOpenViewInNewWindow={openSeparateWorkspaceView}
    onReorderPinnedViews={reorderPinnedViews}
    showExtensionPrompt={(extensionStatus?.promptToInstall ?? false) && mode !== 'workspace'}
    onInstallExtension={installExtension}
    onDismissExtension={dismissExtension}
    showUpdatePrompt={(update?.status === 'ready') && mode !== 'workspace'}
    onInstallUpdate={() => { void api.general.installUpdate(); }}
  />{/if}

  <ChatDrawer
    chats={chatEntries}
    {activeId}
    open={chatDrawerOpen}
    width={chatDrawerWidth}
    resizing={chatDrawerResizing}
    reservedWidth={mode === 'workspace' ? MIN_WORKSPACE_WIDTH : 0}
    onOpen={openChat}
    onRename={renameChatTitle}
    onDelete={deleteChat}
    onResize={(value) => { panelPriority = 'chatDrawer'; chatDrawerWidth = value; }}
    onResizeState={(value) => chatDrawerResizing = value}
  />

  {#if chatSearchOpen}<ChatSearchModal
    chats={chatEntries}
    onOpen={openChatFromSearch}
    onClose={() => chatSearchOpen = false}
  />{/if}

  {#if showTimelineRail}<TimelineRail items={timeline}/>{/if}

  <ChatPane
    messages={active.messages}
    {running}
    {queued}
    goal={active.goal ?? null}
    speechMode={voiceOpen && voiceInChat}
    {speechModeEnabled}
    {advancedMode}
    onOpenPlugins={() => openSettings('plugins')}
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
    onRemoveQueued={removeQueued}
    onEditQueued={editQueued}
    onReorderQueued={reorderQueued}
    draftKey={activeId || 'new'}
    insertion={composerInsertion}
    onInsertionApplied={() => composerInsertion = null}
    onFileDragActiveChange={(value) => agentFileDragActive = value}
    onJumpAvailability={(value) => showJumpToLatest = value}
    onOpenLink={openLink}
    onOpenFilePath={openFilePath}
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
      onOpenOutput={(output) => void previewSource(output.uri).then((url) =>
        openTab({id: output.id, title: output.name, kind: 'media', url}))}
      onOpenReference={(reference) => openTab({id: reference.id, title: reference.title, kind: reference.kind === 'web' ? 'browser' : 'media', url: reference.uri})}
      onOpenTask={openTask}
      onViewAll={viewSummary}
      onAttachReferences={attachReferences}
      onOpenSubagents={() => newTab('subagents')}
    />
  {/if}

  <WorkspaceDrawer
    tabs={workspaceTabs}
    unavailableKinds={Object.keys(remoteSingletonOwners) as SharedWorkspaceSingleton[]}
    {activeTabId}
    open={mode === 'workspace'}
    expanded={workspaceExpanded}
    standalone={requestedWorkspaceView !== null}
    resizing={workspaceResizing}
    motion={workspaceMotionWidth !== null}
    motionProgress={workspaceMotionProgress}
    dockedWidth={workspaceWidth}
    reservedWidth={chatDrawerOpen ? MIN_CHAT_DRAWER_WIDTH : 0}
    summaryData={{outputs, references, tasks}}
    {taskTranscripts}
    onOpenTask={openTask}
    onOpenLink={openLink}
    onOpenFilePath={openFilePath}
    {driveRoot}
    {driveSources}
    onDriveReveal={revealDriveEntry}
    {driveSourceId}
    {driveLoading}
    {driveError}
    onDismissDriveError={() => (driveError = '')}
    {driveActions}
    onSelectDriveSource={selectDriveSource}
    onDriveNavigate={(entry) => void loadDriveFolder(driveFolderPath(entry))}
    {scheduleItems}
    {scheduleError}
    unreadSchedules={unreadScheduleCount(scheduleItems)}
    onDismissScheduleError={() => (scheduleError = '')}
    {taskItems}
    {tasksError}
    unreadTasks={unreadTasksCount(taskItems)}
    onDismissTasksError={() => (tasksError = '')}
    onCreateTaskCard={createTaskCard}
    onUpdateTaskCard={updateTaskCard}
    onDeleteTaskCard={deleteTaskCard}
    onMarkTasksRead={markTasksRead}
    onRecycleTaskCard={recycleTaskCard}
    onOpenScheduleRun={openScheduleRun}
    onMarkScheduleRead={markScheduleRead}
    onOpenDriveEntry={openDriveEntry}
    onToggleSchedule={toggleSchedule}
    onSaveSchedule={saveSchedule}
    onDeleteSchedule={deleteSchedule}
    onRunSchedule={runScheduleNow}
    onSelect={(id) => activeTabId = id}
    onClose={closeTab}
    onNew={newTab}
    onReorderTabs={reorderWorkspaceTabs}
    onToggleExpand={() => { if (!requestedWorkspaceView) workspaceExpanded = !workspaceExpanded; }}
    onResize={(value) => { panelPriority = 'workspace'; workspaceWidth = value; }}
    onResizeState={(value) => workspaceResizing = value}
    browserObscured={settingsOpen || (voiceOpen && !voiceInChat)}
    onOpenUrl={openVisit}
    onTabState={updateTabState}
    {pinnedViews}
    onTogglePin={togglePinView}
    onOpenSeparateWindow={(kind, placement) => {
      if (kind === 'drive' || kind === 'schedule' || kind === 'calendar' || kind === 'hub' || kind === 'tasks')
        openSeparateWorkspaceView(kind, placement);
    }}
  />

  {#if settingsOpen && SettingsPage}<SettingsPage
    initialMode={settingsMode}
    currentPinnedViews={pinnedViews}
    onClose={() => { settingsOpen = false; settingsMode = ''; refreshExtensionStatus(); }}
    onGeneralChange={(settings) => {
      speechModeEnabled = settings.speechModeEnabled;
      advancedMode = settings.advancedMode;
      pinnedViews = settings.pinnedViews;
      dictationAutoStopSeconds = settings.dictationAutoStopSeconds;
      if (!speechModeEnabled) closeVoice();
    }}
  />{/if}

  <Tooltip/>

  <!-- Last in the layout so it paints over everything; it is positioned to the
       viewport rather than to any panel, because the point it was asked for is
       a viewport point. -->
  {#if openMenu}
    <OpenMenu
      anchor={openMenu.anchor}
      choices={openMenu.choices}
      onChoose={chooseOpen}
      onClose={() => (openMenu = null)}
    />
  {/if}
</main>
