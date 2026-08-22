<script module lang="ts">
  export type WorkspaceTabKind = 'media' | 'browser' | 'summary' | 'drive' | 'schedule' | 'hub' | 'subagent' | 'subagents' | 'tasks';
  export type WorkspaceTab = {id: string; title: string; kind: WorkspaceTabKind; url?: string; favicon?: string | null; section?: 'outputs' | 'references' | 'tasks'};

  /**
   * Favicons this session has already tried to decode, and the ones that
   * worked. Both live outside the component so a new chat — which mounts a
   * fresh drawer — does not have to re-learn what it already knows, and so no
   * icon is ever put on screen before it is known to render.
   *
   * Keyed by theme as well as by url: the verdict is partly about the chrome
   * the icon is drawn on, so it does not survive a light/dark flip.
   */
  const faviconProbes = new Map<string, Promise<boolean>>();
  const faviconReady = new Set<string>();

  /** Always 'light' or 'dark' — `theme.ts` resolves 'system' before writing. */
  function chromeTheme(): 'light' | 'dark' {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function probeKey(url: string): string {
    return `${chromeTheme()}\n${url}`;
  }

  /**
   * Resolves true only when the bytes decode to an image *and* that image would
   * be visible on the tab strip.
   *
   * A site gets one favicon and picks a side: Luma's is a white mark, meant for
   * the dark chrome its own page has. Sites that ship both declare them with a
   * `media` attribute, which is what the main process ranks on — but that only
   * covers icons resolved by reading the page, and Chromium ignores `media`
   * entirely when it reports a tab's icon. So a white-on-transparent mark
   * reaches a light tab strip regularly, and paints as nothing at all: a tab
   * with no visible icon and no globe either, which reads as a rendering bug.
   *
   * Measuring the pixels catches every route into that state at once, without
   * caring which of them delivered the icon. An icon that cannot be seen is
   * treated the same as an icon that failed to decode — the globe holds the
   * slot, which is at least a mark the user can find the tab by.
   */
  function probeFavicon(url: string): Promise<boolean> {
    // The CSP (`img-src 'self' data: blob:`) blocks a remote icon before it is
    // ever fetched, so probing one buys a console violation and nothing else.
    // Icons reach the renderer as bytes; anything else never had a chance.
    if (!/^(data|blob):/i.test(url)) return Promise.resolve(false);
    const key = probeKey(url);
    const known = faviconProbes.get(key);
    if (known) return known;
    const probe = new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth > 0 ? image : null);
      image.onerror = () => resolve(null);
      image.src = url;
    }).then((image) => {
      const ok = !!image && visibleOnChrome(image);
      if (ok) faviconReady.add(key);
      return ok;
    });
    faviconProbes.set(key, probe);
    return probe;
  }

  /** The size the tab draws an icon at; measuring it at any other size only
   * invents detail the user will never see. */
  const PROBE_SIZE = 16;
  /** How far a pixel has to sit from the chrome behind it to count as one the
   * user can make out. Well under the difference between a real mark and its
   * background, well over the fringe an anti-aliased edge leaves behind. */
  const MIN_PIXEL_CONTRAST = 0.14;
  /** And how much of the icon has to clear that bar. A white mark with a few
   * stray dark pixels is still a white mark; a tenth of the square carrying
   * real contrast is a shape. */
  const MIN_VISIBLE_FRACTION = 0.04;

  function visibleOnChrome(image: HTMLImageElement): boolean {
    const canvas = document.createElement('canvas');
    canvas.width = PROBE_SIZE;
    canvas.height = PROBE_SIZE;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    // Every icon arrives as a `data:` url from the main process, so readback is
    // same-origin and does not taint. If a canvas is unavailable anyway, an
    // unmeasured icon is shown rather than hidden — failing towards the site's
    // own mark is the smaller error.
    if (!context) return true;
    let pixels: Uint8ClampedArray;
    try {
      context.drawImage(image, 0, 0, PROBE_SIZE, PROBE_SIZE);
      pixels = context.getImageData(0, 0, PROBE_SIZE, PROBE_SIZE).data;
    } catch {
      return true;
    }
    const background = chromeLuminance();
    let visible = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      const alpha = pixels[at + 3] / 255;
      if (!alpha) continue;
      const luminance = (0.2126 * pixels[at] + 0.7152 * pixels[at + 1] + 0.0722 * pixels[at + 2]) / 255;
      // What the user actually sees is the pixel composited over the chrome, so
      // a translucent mark is measured at the strength it is drawn with.
      if (Math.abs(luminance - background) * alpha >= MIN_PIXEL_CONTRAST) visible += 1;
    }
    return visible >= pixels.length / 4 * MIN_VISIBLE_FRACTION;
  }

  /** The tab's own background, so the test is against the surface the icon
   * lands on rather than against an assumption about the theme. */
  function chromeLuminance(): number {
    const token = getComputedStyle(document.documentElement).getPropertyValue('--neutral-100').trim();
    const parsed = parseLuminance(token);
    if (parsed !== null) return parsed;
    return chromeTheme() === 'dark' ? 0.16 : 0.95;
  }

  function parseLuminance(colour: string): number | null {
    let red: number;
    let green: number;
    let blue: number;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour);
    const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(colour);
    if (hex) {
      const digits = hex[1].length === 3 ? hex[1].replace(/./g, (d) => d + d) : hex[1];
      red = parseInt(digits.slice(0, 2), 16);
      green = parseInt(digits.slice(2, 4), 16);
      blue = parseInt(digits.slice(4, 6), 16);
    } else if (rgb) {
      red = Number(rgb[1]);
      green = Number(rgb[2]);
      blue = Number(rgb[3]);
    } else {
      return null;
    }
    return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  }

  /** The hub, the drive and the schedule are places rather than documents:
   * there is only ever one of each, so they carry a fixed id and reopening one
   * surfaces the tab that already exists. */
  export const SINGLETON_TAB_IDS: Partial<Record<WorkspaceTabKind, string>> = {
    drive: 'workspace-drive',
    schedule: 'workspace-schedule',
    hub: 'workspace-hub',
    subagents: 'workspace-subagents',
    tasks: 'workspace-tasks',
  };
</script>

<script lang="ts">
  import {onDestroy} from 'svelte';
  import Icon from '../../shared/components/Icon.svelte';
  import {leasedUrls, isLeased} from './agentSurfaceLeases';
  import {
    visitHistory,
    resolveVisitFavicons,
    forgetVisitFavicons,
    HISTORY_SUGGESTION_LIMIT,
  } from './visitHistory';
  import {scrollFadeX} from '../../shared/scrollFade';
  import {onThemeChange} from '../../shared/theme';
  import {MAIN_UI_ICON_SIZE, MAIN_UI_ICON_STROKE_WIDTH} from '../../shared/layout/iconSizing';
  import {SPLIT_LAYOUT_MIN_WIDTH, clampPanelWidth, workspaceResizeBounds} from '../../shared/layout/layoutSizing';
  import MediaView from './MediaView.svelte';
  import BrowserView from './BrowserView.svelte';
  import SubagentView from './SubagentView.svelte';
  import SubagentsView from './SubagentsView.svelte';
  import TaskGlyph from '../../shared/components/TaskGlyph.svelte';
  import type {TaskTranscript} from './taskTranscript';
  import type {TaskStatus} from './taskStatus';
  import HubView from './HubView.svelte';
  import SummaryView, {type SummaryViewData} from './SummaryView.svelte';
  import DriveView, {type DriveEntry, type DriveSource} from './DriveView.svelte';
  import ScheduleView, {type ScheduleItem, type ScheduleFrequency, type ScheduleRun} from './ScheduleView.svelte';
  import TasksView, {type TaskCard} from './TasksView.svelte';
  import {t, translate, type MessageKey} from '../../../i18n';

  export let tabs: WorkspaceTab[] = [];
  export let unavailableKinds: WorkspaceTabKind[] = [];
  export let activeTabId: string | null = null;
  export let open = false;
  export let expanded = false;
  export let standalone = false;
  export let resizing = false;
  /** True while App drives the expand/minimise width frame by frame. */
  export let motion = false;
  export let reservedWidth = 0;
  export let summaryData: SummaryViewData = {outputs: [], references: [], tasks: []};
  /** Subagent transcripts, keyed by the task id the tab carries. */
  export let taskTranscripts: Record<string, TaskTranscript> = {};
  export let onOpenLink: (url: string, title: string) => void = () => {};
  export let onOpenTask: (task: SummaryViewData['tasks'][number]) => void = () => {};
  export let onOpenFilePath: (path: string, anchor?: DOMRect) => void = () => {};
  export let driveRoot: DriveEntry = {id: 'drive-root', name: translate('workspace.drive'), kind: 'folder', children: []};
  /** Storage backends the drive can be switched between. */
  export let driveSources: DriveSource[] = [];
  export let onDriveReveal: (entry: DriveEntry) => void = () => {};
  export let driveSourceId = '';
  export let driveLoading = false;
  export let driveError = '';
  export let onDismissDriveError: () => void = () => {};
  export let onSelectDriveSource: (id: string) => void = () => {};
  export let onDriveNavigate: (entry: DriveEntry) => void = () => {};
  /**
   * The drive's write actions, or null when the active source is not something
   * that can be written to. Null is what greys the toolbar out, so the drive
   * never offers a button that could only fail.
   */
  export let driveActions: {
    newFolder: (parent: DriveEntry, name: string) => void;
    upload: (parent: DriveEntry) => void;
    dropFiles: (files: File[], destination: DriveEntry) => void;
    rename: (entry: DriveEntry, name: string) => void;
    move: (entries: DriveEntry[], destination: DriveEntry) => void;
    duplicate: (entries: DriveEntry[]) => void;
    download: (entry: DriveEntry) => void;
    remove: (entries: DriveEntry[]) => void;
  } | null = null;
  export let scheduleItems: ScheduleItem[] = [];
  export let scheduleError = '';
  /** Counted by the caller, which owns the list. */
  export let unreadSchedules = 0;
  export let onDismissScheduleError: () => void = () => {};
  export let onOpenScheduleRun: (item: ScheduleItem, run?: ScheduleRun) => void = () => {};
  export let onMarkScheduleRead: (item: ScheduleItem) => void = () => {};
  export let onOpenDriveEntry: (entry: DriveEntry, point?: {x: number; y: number}) => void = () => {};
  export let onToggleSchedule: (item: ScheduleItem) => void = () => {};
  export let onSaveSchedule: (
    input: {title: string; prompt: string; frequency: ScheduleFrequency},
    id: string | null,
  ) => void = () => {};
  export let onDeleteSchedule: (item: ScheduleItem) => void = () => {};
  export let onRunSchedule: (item: ScheduleItem) => void = () => {};
  export let taskItems: TaskCard[] = [];
  export let tasksError = '';
  export let unreadTasks = 0;
  export let onDismissTasksError: () => void = () => {};
  export let onCreateTaskCard: (title: string, detail?: string) => void = () => {};
  export let onUpdateTaskCard: (id: string, patch: Partial<TaskCard>) => void = () => {};
  export let onDeleteTaskCard: (id: string) => void = () => {};
  export let onMarkTasksRead: (id: string) => void = () => {};
  export let onRecycleTaskCard: (id: string) => void = () => {};
  export let onSelect: (id: string) => void = () => {};
  export let onClose: (id: string) => void = () => {};
  export let onNew: (kind: WorkspaceTabKind) => void = () => {};
  export let onReorderTabs: (ids: string[]) => void = () => {};
  /** Opens a previously visited page in a browser tab. */
  export let onOpenUrl: (url: string, title: string) => void = () => {};
  export let onToggleExpand: () => void = () => {};
  export let onResize: (width: number) => void = () => {};
  export let onResizeState: (resizing: boolean) => void = () => {};
  /** True while another surface covers the drawer; the embedded browser's
   * native view must hide under it. */
  export let browserObscured = false;
  export let onTabState: (id: string, patch: {title?: string; url?: string; favicon?: string | null}) => void = () => {};
  export let pinnedViews: Array<'drive' | 'schedule' | 'hub' | 'tasks'> = [];
  export let onTogglePin: (kind: 'drive' | 'schedule' | 'hub' | 'tasks') => void = () => {};
  export let onOpenSeparateWindow: (
    kind: WorkspaceTabKind,
    placement?: {x: number; y: number; width?: number; height?: number},
  ) => void = () => {};

  let panel: HTMLElement;
  let newTabWrapper: HTMLDivElement;
  let addOpen = false;

  let contextMenu: {x: number; y: number; tab: WorkspaceTab} | null = null;
  let draggedTabId: string | null = null;
  let dragOverTabId: string | null = null;
  let dragDropped = false;

  function dragTabStart(event: DragEvent, tab: WorkspaceTab): void {
    draggedTabId = tab.id;
    dragOverTabId = null;
    dragDropped = false;
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', tab.id);
  }

  function dragTabOver(event: DragEvent, tab: WorkspaceTab): void {
    if (!draggedTabId || draggedTabId === tab.id) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOverTabId = tab.id;
  }

  function dropTab(event: DragEvent, target: WorkspaceTab): void {
    event.preventDefault();
    const sourceIndex = tabs.findIndex((tab) => tab.id === draggedTabId);
    const targetIndex = tabs.findIndex((tab) => tab.id === target.id);
    if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex !== targetIndex) {
      const reordered = [...tabs];
      const [moved] = reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, moved);
      onReorderTabs(reordered.map((tab) => tab.id));
    }
    dragDropped = true;
    dragOverTabId = null;
  }

  function dragTabEnd(event: DragEvent, tab: WorkspaceTab): void {
    const outsideWindow = event.screenX < window.screenX
      || event.screenX > window.screenX + window.outerWidth
      || event.screenY < window.screenY
      || event.screenY > window.screenY + window.outerHeight;
    if (!dragDropped && outsideWindow)
      onOpenSeparateWindow(tab.kind, {x: event.screenX - 160, y: event.screenY - 20});
    draggedTabId = null;
    dragOverTabId = null;
    dragDropped = false;
  }

  function openContextMenu(event: MouseEvent, tab: WorkspaceTab): void {
    event.preventDefault();
    contextMenu = {x: event.clientX, y: event.clientY, tab};
  }

  function closeContextMenu(): void {
    contextMenu = null;
  }

  function openTabInSeparateWindow(tab: WorkspaceTab): void {
    const bounds = panel.getBoundingClientRect();
    closeContextMenu();
    onOpenSeparateWindow(tab.kind, {
      x: window.screenX + bounds.left + 24,
      y: window.screenY + bounds.top + 24,
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
  }

  $: isSingletonKind = (kind: WorkspaceTabKind): kind is 'drive' | 'schedule' | 'hub' | 'tasks' =>
    kind === 'drive' || kind === 'schedule' || kind === 'hub' || kind === 'tasks';

  $: activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  /** A task tab is named by its row in Summary and takes its status from it, so
   * the tab and the row can never disagree. */
  $: activeTask = summaryData.tasks.find((task) => task.id === activeTab?.id);
  /** The one-of-a-kind views drop out of the menus once they are open: there is
   * nothing left to create, only a tab to click. */
  $: openKinds = new Set([...tabs.map((tab) => tab.kind), ...unavailableKinds]);
  /** The pages the launcher offers to pick up again. */
  $: historySuggestions = $visitHistory.slice(0, HISTORY_SUGGESTION_LIMIT);

  /** Titles of the built-in singleton tabs are named, not typed by anyone, so
   * they are resolved at render time rather than read from the stored title:
   * a tab opened before a language switch would otherwise keep the old wording. */
  const singletonTitles: Partial<Record<WorkspaceTabKind, MessageKey>> = {
    drive: 'workspace.drive',
    schedule: 'workspace.schedule',
    hub: 'workspace.hub',
    subagents: 'workspace.subagents',
    tasks: 'workspace.tasks',
  };
  $: tabTitle = (tab: WorkspaceTab): string => {
    const key = SINGLETON_TAB_IDS[tab.kind] === tab.id ? singletonTitles[tab.kind] : undefined;
    if (key) return $t(key);
    // A delegated run is named after what it was asked to do, which on its own
    // reads like any other tab. Saying it is a task is what tells them apart.
    if (tab.kind === 'subagent') return $t('view.taskTitle', {title: tab.title || $t('activity.delegatedTask')});
    return tab.title;
  };

  /** A task tab wears the task's own flare, working animation included, rather
   * than one static mark shared by every delegated run. */
  $: taskTabStatus = (tab: WorkspaceTab): TaskStatus =>
    summaryData.tasks.find((task) => task.id === tab.id)?.status ?? 'active';

  const tabIcons: Record<WorkspaceTabKind, 'image' | 'globe' | 'chat' | 'summary' | 'drive' | 'clock' | 'send' | 'task' | 'tasks'> = {
    media: 'image',
    browser: 'globe',
    summary: 'summary',
    drive: 'drive',
    schedule: 'clock',
    hub: 'chat',
    subagent: 'task',
    subagents: 'send',
    tasks: 'tasks',
  };

  /** Hides the embedded page only once the closing slide has finished. While
   * the drawer is sliding away the page's bounds follow its surface offscreen,
   * so the site visibly leaves with the panel; hiding it the moment the close
   * starts would blink it out while the drawer is still mid-flight. Reopening
   * unhides immediately so the page rides the slide back in. */
  let browserHidden = !open;
  let browserHideTimer: ReturnType<typeof setTimeout> | undefined;
  $: scheduleBrowserHide(open);

  function scheduleBrowserHide(openNow: boolean): void {
    clearTimeout(browserHideTimer);
    if (openNow) browserHidden = false;
    else browserHideTimer = setTimeout(() => browserHidden = true, drawerMotionMs());
  }

  /** Reads the shared motion token so this timer cannot drift from the stylesheet. */
  function drawerMotionMs(): number {
    if (typeof getComputedStyle !== 'function') return 440;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--drawer-motion-duration').trim();
    const value = raw.endsWith('ms') ? Number.parseFloat(raw) : Number.parseFloat(raw) * 1000;
    return Number.isFinite(value) && value >= 0 ? value : 440;
  }

  onDestroy(() => clearTimeout(browserHideTimer));

  /**
   * A favicon is tested off-screen and only shown once it decodes. The main
   * process validates the bytes before sending them, but svg and ico pass
   * through undecoded, and a tab restored from a snapshot can carry an icon
   * that no longer resolves — putting either straight in an <img> paints the
   * browser's broken-image placeholder for as long as the failure takes to
   * arrive. Waiting means the globe holds the slot and is replaced, never
   * flashed over.
   */
  let faviconsSettled = 0;

  /**
   * Bumped when the theme changes, which retests every icon on screen: a mark
   * that was invisible on light chrome is usually the visible one on dark, and
   * the verdict is keyed per theme precisely so it can be revisited. Nothing
   * else in the drawer changes on a theme flip, so without this the strip would
   * hold the previous theme's answer until a tab happened to open or close.
   */
  let themeRevision = 0;

  onDestroy(onThemeChange(() => {
    // History icons are resolved per scheme rather than stored, so the ones
    // held for the theme just left are dropped and asked for again below.
    forgetVisitFavicons();
    themeRevision += 1;
  }));

  // A visit carries a url, not an icon; the icon for it is fetched when the row
  // is on screen, and again after a theme change.
  $: resolveVisitFavicons(historySuggestions, themeRevision);

  $: void testFavicons([
    ...tabs.map((tab) => tab.favicon),
    ...historySuggestions.map((visit) => visit.favicon),
  ], themeRevision);

  /** The trailing argument is a reactivity trigger, not a value this reads. */
  function testFavicons(candidates: Array<string | null | undefined>, _revision = 0): void {
    for (const favicon of candidates) {
      const key = probeKey(favicon ?? '');
      if (!favicon || faviconReady.has(key) || faviconProbes.has(key)) continue;
      void probeFavicon(favicon).then(() => {
        // Nudges the template: the sets themselves live outside the component.
        faviconsSettled += 1;
      });
    }
  }

  /** The second argument is the redraw signal, not a value this reads. */
  function usableFavicon(favicon?: string | null, _settled = 0): string | null {
    return favicon && faviconReady.has(probeKey(favicon)) ? favicon : null;
  }

  function resizeFromPointer(clientX: number): void {
    onResize(clampPanelWidth(window.innerWidth - clientX, workspaceResizeBounds(window.innerWidth, reservedWidth)));
  }

  function startResize(event: PointerEvent): void {
    if (expanded || window.innerWidth < SPLIT_LAYOUT_MIN_WIDTH) return;
    onResizeState(true);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    resizeFromPointer(event.clientX);
    event.preventDefault();
  }

  function dragResize(event: PointerEvent): void {
    if (resizing) resizeFromPointer(event.clientX);
  }

  function stopResize(event: PointerEvent): void {
    if (!resizing) return;
    onResizeState(false);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const delta = event.key === 'ArrowLeft' ? 16 : -16;
    onResize(clampPanelWidth(panel.getBoundingClientRect().width + delta, workspaceResizeBounds(window.innerWidth, reservedWidth)));
    event.preventDefault();
  }

  function dismissMenus(event: MouseEvent | KeyboardEvent): void {
    if (event instanceof KeyboardEvent) {
      if (event.key === 'Escape') { addOpen = false; contextMenu = null; }
      return;
    }
    contextMenu = null;
    if (newTabWrapper?.contains(event.target as Node)) return;
    addOpen = false;
  }
</script>

<svelte:window onclick={dismissMenus} onkeydown={dismissMenus}/>

<!-- The handle is a sibling of the drawer rather than a child of it: the
     drawer clips its own overflow, and an embedded page is a native view laid
     over the DOM inside it, so a strip living in there is both clipped and
     covered. Out here it keeps its full width against the conversation. -->
<button
  type="button"
  class="workspace-resize-handle"
  class:open={open && !expanded}
  class:resizing
  aria-label={$t('workspace.resize')}
  tabindex={open && !expanded ? 0 : -1}
  data-tooltip="none"
  onpointerdown={startResize}
  onpointermove={dragResize}
  onpointerup={stopResize}
  onpointercancel={stopResize}
  onkeydown={resizeWithKeyboard}
></button>

<!-- Always mounted so closing is a slide rather than an unmount. `inert` while
     closed keeps its controls out of the tab order. -->
<aside
  bind:this={panel}
  class:open
  class:expanded
  class:standalone
  class:resizing
  class:motion
  class="workspace-drawer"
  aria-label={$t('titlebar.workspace')}
  aria-hidden={!open}
  inert={!open}
>
  <div class="tab-strip">
    <div class="tabs" use:scrollFadeX={`${tabs.length}:${activeTab?.id ?? ''}`}>
      {#each tabs as tab, index (tab.id)}
        {#if index > 0}<span class="tab-divider" aria-hidden="true"></span>{/if}
        <div
          class:active={tab.id === activeTab?.id}
          class:dragging={draggedTabId === tab.id}
          class:drag-over={dragOverTabId === tab.id}
          class="tab"
          draggable="true"
          role="group"
          ondragstart={(event) => dragTabStart(event, tab)}
          ondragover={(event) => dragTabOver(event, tab)}
          ondrop={(event) => dropTab(event, tab)}
          ondragend={(event) => dragTabEnd(event, tab)}
          oncontextmenu={(e) => { if (!standalone) openContextMenu(e, tab); }}
        >
          <button type="button" class="tab-main" onclick={() => onSelect(tab.id)}>
            {#if tab.kind === 'browser'}
              <span class="tab-favicon" class:controlled={isLeased($leasedUrls, tab.url)}>
                {#if usableFavicon(tab.favicon, faviconsSettled + themeRevision)}<img src={tab.favicon} alt="" draggable="false"/>{:else}<Icon name="globe" size={16}/>{/if}
                {#if isLeased($leasedUrls, tab.url)}
                  <svg class="tab-cursor-badge" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.04536 4.45259C2.7582 3.60299 3.60299 2.7582 4.45259 3.04536L14.1828 6.33403C15.1637 6.66558 15.0872 8.08006 14.0715 8.39045L10.2994 9.54319C9.93919 9.65327 9.65327 9.93919 9.54319 10.2994L8.39046 14.0715C8.08007 15.0872 6.66558 15.1637 6.33404 14.1828L3.04536 4.45259Z" fill="black" stroke="white" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke fill"/></svg>
                {/if}
              </span>
            {:else}
              <span class="tab-icon">
                {#if tab.kind === 'subagent'}
                  <TaskGlyph id={tab.id} status={taskTabStatus(tab)} size={16}/>
                {:else}
                  <Icon name={tabIcons[tab.kind]} size={16}/>
                {/if}
                <!-- Results the user has not opened yet are worth seeing from
                     outside the view, so the tab carries the same dot the row
                     does. -->
                {#if tab.kind === 'schedule' && unreadSchedules > 0}
                  <span class="tab-unread" aria-label={$t('schedule.unread')}></span>
                {/if}
                {#if tab.kind === 'tasks' && unreadTasks > 0}
                  <span class="tab-unread" aria-label={$t('tasks.unread')}></span>
                {/if}
              </span>
            {/if}
            <span>{tabTitle(tab)}</span></button>
          {#if !standalone}<button type="button" class="tab-close" aria-label={$t('workspace.closeTab', {title: tabTitle(tab)})} data-tooltip="none" onclick={() => onClose(tab.id)}><Icon name="close" size={14}/></button>{/if}
        </div>
      {/each}
    </div>
    <!-- With nothing open the launcher below already offers these, so the
         header would only repeat them. -->
    {#if tabs.length || standalone}
      <div bind:this={newTabWrapper} class="new-tab-wrap">
        <button type="button" class="title-bar-icon-button workspace-header-action" aria-label={$t('workspace.newTab')} data-tooltip-align="end" aria-haspopup="menu" aria-expanded={addOpen} onclick={() => addOpen = !addOpen}><Icon name="plus" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
        {#if addOpen}
          <div class="flareai-dropdown-menu new-tab-menu" role="menu">
            <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => { addOpen = false; onNew('browser'); }}><Icon name="globe" size={14}/><span>{$t('workspace.browser')}</span></button>
            <!-- Drive and Schedule leave the title bar while the drawer is
                 open, so this menu is where they live instead. -->
            {#if !openKinds.has('drive')}
              <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => { addOpen = false; onNew('drive'); }}><Icon name="drive" size={14}/><span>{$t('workspace.drive')}</span></button>
            {/if}
            {#if !openKinds.has('hub')}
              <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => { addOpen = false; onNew('hub'); }}><Icon name="chat" size={14}/><span>{$t('workspace.hub')}</span></button>
            {/if}
            {#if !openKinds.has('tasks')}
              <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => { addOpen = false; onNew('tasks'); }}><Icon name="tasks" size={14}/><span>{$t('workspace.tasks')}</span></button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
    {#if !standalone}<button
      type="button"
      class="title-bar-icon-button workspace-header-action expand-workspace-action"
      class:active={expanded}
      aria-label={expanded ? $t('workspace.minimise') : $t('workspace.expand')}
      data-tooltip-label={expanded ? $t('common.minimise') : $t('common.expand')}
      data-tooltip-align="end"
      aria-pressed={expanded}
      onclick={onToggleExpand}
    ><Icon name={expanded ? 'collapse' : 'expand'} size={14} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>{/if}
  </div>

  <div class="workspace-content">
    {#if !activeTab}
      <div class="workspace-launcher">
        <p class="workspace-launcher-heading">{$t('workspace.open')}</p>
        <div class="workspace-launcher-rows">
          <button type="button" class="workspace-launcher-row" onclick={() => onNew('browser')}><Icon name="globe" size={16}/><span>{$t('workspace.browser')}</span></button>
          {#if !openKinds.has('drive')}
            <button type="button" class="workspace-launcher-row" onclick={() => onNew('drive')}><Icon name="drive" size={16}/><span>{$t('workspace.drive')}</span></button>
          {/if}
          <button type="button" class="workspace-launcher-row" onclick={() => onNew('hub')}><Icon name="chat" size={16}/><span>{$t('workspace.hub')}</span></button>
          {#if !openKinds.has('tasks')}
            <button type="button" class="workspace-launcher-row" onclick={() => onNew('tasks')}><Icon name="tasks" size={16}/><span>{$t('workspace.tasks')}</span></button>
          {/if}
        </div>
        {#if historySuggestions.length}
          <p class="workspace-launcher-heading">{$t('workspace.recent')}</p>
          <div class="workspace-launcher-rows">
            {#each historySuggestions as visit (visit.url)}
              <button type="button" class="workspace-launcher-row" onclick={() => onOpenUrl(visit.url, visit.title)}>
                <span class="tab-favicon">
                  {#if usableFavicon(visit.favicon, faviconsSettled + themeRevision)}<img src={visit.favicon} alt="" draggable="false"/>{:else}<Icon name="globe" size={16}/>{/if}
                </span>
                <span>{visit.title}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else if activeTab.kind === 'media'}<MediaView title={activeTab.title} src={activeTab.url ?? ''}/>
    <!-- Keyed by tab: switching between two browser tabs must destroy the old
         BrowserView (which hides its native page) and mount the new one, not
         retarget one instance and leave the old page painted on screen. -->
    <!-- addOpen: the page is a native view that paints above all DOM, so while
         the new-tab menu hangs over it the page steps aside instead of
         covering the menu. -->
    {:else if activeTab.kind === 'browser'}{#key activeTab.id}<BrowserView tabId={activeTab.id} title={activeTab.title} url={activeTab.url} obscured={browserObscured || browserHidden || addOpen} onState={(patch) => onTabState(activeTab.id, patch)}/>{/key}
    {:else if activeTab.kind === 'subagent'}<SubagentView
      title={activeTab.title}
      taskId={activeTab.id}
      status={activeTask?.status ?? 'active'}
      transcript={taskTranscripts[activeTab.id] ?? null}
      {onOpenLink}
      {onOpenFilePath}
    />
    {:else if activeTab.kind === 'subagents'}<SubagentsView subagents={summaryData.tasks} onOpenSubagent={onOpenTask}/>
    {:else if activeTab.kind === 'hub'}<HubView {onOpenFilePath}/>
    {:else if activeTab.kind === 'drive'}<DriveView
      title={activeTab.title}
      root={driveRoot}
      sources={driveSources}
      onReveal={onDriveReveal}
      activeSourceId={driveSourceId}
      loading={driveLoading}
      error={driveError}
      onDismissError={onDismissDriveError}
      onSelectSource={onSelectDriveSource}
      onNavigate={onDriveNavigate}
      onOpenEntry={onOpenDriveEntry}
      onNewFolder={driveActions?.newFolder ?? null}
      onUpload={driveActions?.upload ?? null}
      onDropFiles={driveActions?.dropFiles ?? null}
      onRename={driveActions?.rename ?? null}
      onMove={driveActions?.move ?? null}
      onDuplicate={driveActions?.duplicate ?? null}
      onDownload={driveActions?.download ?? null}
      onDelete={driveActions?.remove ?? null}
    />
    {:else if activeTab.kind === 'schedule' || activeTab.kind === 'tasks'}<TasksView items={taskItems} error={tasksError} onDismissError={onDismissTasksError} onCreateCard={onCreateTaskCard} onUpdateCard={onUpdateTaskCard} onDeleteCard={onDeleteTaskCard} onMarkRead={onMarkTasksRead} onRecycleCard={onRecycleTaskCard} schedules={scheduleItems} scheduleError={scheduleError} onDismissScheduleError={onDismissScheduleError} onOpenScheduleRun={onOpenScheduleRun} onMarkScheduleRead={onMarkScheduleRead} onToggleSchedule={onToggleSchedule} onSaveSchedule={onSaveSchedule} onDeleteSchedule={onDeleteSchedule} onRunSchedule={onRunSchedule}/>
    {:else}<SummaryView section={activeTab.section ?? 'outputs'} data={summaryData} {onOpenTask}/>
    {/if}
  </div>
</aside>

{#if contextMenu}
  <div class="flareai-dropdown-menu tab-context-menu" role="menu" style="position: fixed; left: {contextMenu.x}px; top: {contextMenu.y}px; z-index: 200;">
    {#if isSingletonKind(contextMenu.tab.kind)}
      <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => { const kind = contextMenu?.tab.kind as 'drive' | 'schedule' | 'hub' | 'tasks'; closeContextMenu(); onTogglePin(kind); }}>
        <Icon name={pinnedViews.includes(contextMenu.tab.kind as 'drive' | 'schedule' | 'hub' | 'tasks') ? 'pin-off' : 'pin'} size={14}/>
        <span>{pinnedViews.includes(contextMenu.tab.kind as 'drive' | 'schedule' | 'hub' | 'tasks') ? $t('titlebar.unpinView') : $t('titlebar.pinView')}</span>
      </button>
      <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => { if (contextMenu) openTabInSeparateWindow(contextMenu.tab); }}>
        <Icon name="send" size={14}/>
        <span>{$t('titlebar.openSeparateWindow')}</span>
      </button>
    {/if}
  </div>
{/if}
