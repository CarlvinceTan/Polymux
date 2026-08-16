<script module lang="ts">
  export type WorkspaceTabKind = 'document' | 'slides' | 'sheet' | 'photo' | 'video' | 'browser' | 'side-chat' | 'summary' | 'drive' | 'schedule' | 'hub';
  export type WorkspaceTab = {id: string; title: string; kind: WorkspaceTabKind; url?: string; favicon?: string | null; section?: 'outputs' | 'references' | 'tasks'};

  /**
   * Favicons this session has already tried to decode, and the ones that
   * worked. Both live outside the component so a new chat — which mounts a
   * fresh drawer — does not have to re-learn what it already knows, and so no
   * icon is ever put on screen before it is known to render.
   */
  const faviconProbes = new Map<string, Promise<boolean>>();
  const faviconReady = new Set<string>();

  /** Resolves true only when the bytes actually decode to an image. */
  function probeFavicon(url: string): Promise<boolean> {
    // The CSP (`img-src 'self' data: blob:`) blocks a remote icon before it is
    // ever fetched, so probing one buys a console violation and nothing else.
    // Icons reach the renderer as bytes; anything else never had a chance.
    if (!/^(data|blob):/i.test(url)) return Promise.resolve(false);
    const known = faviconProbes.get(url);
    if (known) return known;
    const probe = new Promise<boolean>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth > 0);
      image.onerror = () => resolve(false);
      image.src = url;
    }).then((ok) => {
      if (ok) faviconReady.add(url);
      return ok;
    });
    faviconProbes.set(url, probe);
    return probe;
  }

  /** Drive, schedule and the side chat are places rather than documents: there
   * is only ever one of each, so they carry a fixed id and reopening one
   * surfaces the tab that already exists. */
  export const SINGLETON_TAB_IDS: Partial<Record<WorkspaceTabKind, string>> = {
    drive: 'workspace-drive',
    schedule: 'workspace-schedule',
    'side-chat': 'workspace-side-chat',
    hub: 'workspace-hub',
  };
</script>

<script lang="ts">
  import {onDestroy} from 'svelte';
  import Icon from '../shared/Icon.svelte';
  import {leasedUrls, isLeased} from '../../browser/agentSurfaceLeases';
  import {visitHistory, HISTORY_SUGGESTION_LIMIT, HISTORY_SUGGESTION_MINIMUM} from '../../browser/visitHistory';
  import {MAIN_UI_ICON_SIZE, MAIN_UI_ICON_STROKE_WIDTH} from '../../layout/iconSizing';
  import {SPLIT_LAYOUT_MIN_WIDTH, clampPanelWidth, workspaceResizeBounds} from '../../layout/layoutSizing';
  import DocumentView from './DocumentView.svelte';
  import SlideView from './SlideView.svelte';
  import SheetView from './SheetView.svelte';
  import PhotoView from './PhotoView.svelte';
  import VideoView from './VideoView.svelte';
  import BrowserView from './BrowserView.svelte';
  import SideChatView from './SideChatView.svelte';
  import HubView from './HubView.svelte';
  import SummaryView, {type SummaryViewData} from './SummaryView.svelte';
  import DriveView, {type DriveEntry, type DriveSource} from './DriveView.svelte';
  import ScheduleView, {type ScheduleItem, type ScheduleFrequency} from './ScheduleView.svelte';
  import {t, translate} from '../../i18n';

  export let tabs: WorkspaceTab[] = [];
  export let activeTabId: string | null = null;
  export let open = false;
  export let expanded = false;
  export let resizing = false;
  /** True while App drives the expand/minimise width frame by frame. */
  export let motion = false;
  export let reservedWidth = 0;
  export let summaryData: SummaryViewData = {outputs: [], references: [], tasks: []};
  export let driveRoot: DriveEntry = {id: 'drive-root', name: translate('workspace.drive'), kind: 'folder', children: []};
  /** Storage backends the drive can be switched between. */
  export let driveSources: DriveSource[] = [];
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
    rename: (entry: DriveEntry, name: string) => void;
    move: (entries: DriveEntry[], destination: DriveEntry) => void;
    duplicate: (entries: DriveEntry[]) => void;
    download: (entry: DriveEntry) => void;
    remove: (entries: DriveEntry[]) => void;
  } | null = null;
  export let scheduleItems: ScheduleItem[] = [];
  export let onOpenDriveEntry: (entry: DriveEntry) => void = () => {};
  export let onToggleSchedule: (item: ScheduleItem) => void = () => {};
  export let onCreateSchedule: () => void = () => {};
  export let onDeleteSchedule: (item: ScheduleItem) => void = () => {};
  export let onRunSchedule: (item: ScheduleItem) => void = () => {};
  export let onScheduleFrequency: (item: ScheduleItem, frequency: ScheduleFrequency) => void = () => {};
  export let onSelect: (id: string) => void = () => {};
  export let onClose: (id: string) => void = () => {};
  export let onNew: (kind: WorkspaceTabKind) => void = () => {};
  /** Suggestions are asks for the agent, not files the launcher makes itself:
   * they send the chat a message rather than opening a blank view. */
  export let onSuggest: (prompt: string) => void = () => {};
  /** Opens a previously visited page in a browser tab. */
  export let onOpenUrl: (url: string, title: string) => void = () => {};
  export let onToggleExpand: () => void = () => {};
  export let onResize: (width: number) => void = () => {};
  export let onResizeState: (resizing: boolean) => void = () => {};
  /** True while another surface covers the drawer; the embedded browser's
   * native view must hide under it. */
  export let browserObscured = false;
  export let onTabState: (id: string, patch: {title?: string; url?: string; favicon?: string | null}) => void = () => {};

  let panel: HTMLElement;
  let newTabWrapper: HTMLDivElement;
  let addOpen = false;

  $: activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  /** The one-of-a-kind views drop out of the menus once they are open: there is
   * nothing left to create, only a tab to click. */
  $: openKinds = new Set(tabs.map((tab) => tab.kind));
  /** Once the user has browsed enough for the list to be meaningful, picking
   * up where they left off beats the generic create-something prompts. */
  $: historySuggestions = $visitHistory.slice(0, HISTORY_SUGGESTION_LIMIT);
  $: showHistory = $visitHistory.length >= HISTORY_SUGGESTION_MINIMUM;

  const tabIcons: Record<WorkspaceTabKind, 'document' | 'presentation' | 'spreadsheet' | 'image' | 'video' | 'globe' | 'chat' | 'summary' | 'drive' | 'clock'> = {
    document: 'document',
    slides: 'presentation',
    sheet: 'spreadsheet',
    photo: 'image',
    video: 'video',
    browser: 'globe',
    'side-chat': 'chat',
    summary: 'summary',
    drive: 'drive',
    schedule: 'clock',
    hub: 'chat',
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

  $: void testFavicons([
    ...tabs.map((tab) => tab.favicon),
    ...historySuggestions.map((visit) => visit.favicon),
  ]);

  function testFavicons(candidates: Array<string | null | undefined>): void {
    for (const favicon of candidates) {
      if (!favicon || faviconReady.has(favicon) || faviconProbes.has(favicon)) continue;
      void probeFavicon(favicon).then(() => {
        // Nudges the template: the sets themselves live outside the component.
        faviconsSettled += 1;
      });
    }
  }

  /** The second argument is the redraw signal, not a value this reads. */
  function usableFavicon(favicon?: string | null, _settled = 0): string | null {
    return favicon && faviconReady.has(favicon) ? favicon : null;
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
      if (event.key === 'Escape') addOpen = false;
      return;
    }
    if (newTabWrapper?.contains(event.target as Node)) return;
    addOpen = false;
  }
</script>

<svelte:window onclick={dismissMenus} onkeydown={dismissMenus}/>

<!-- Always mounted so closing is a slide rather than an unmount. `inert` while
     closed keeps its controls out of the tab order. -->
<aside
  bind:this={panel}
  class:open
  class:expanded
  class:resizing
  class:motion
  class="workspace-drawer"
  aria-label={$t('titlebar.workspace')}
  aria-hidden={!open}
  inert={!open}
>
  <button
    type="button"
    class="workspace-resize-handle"
    aria-label={$t('workspace.resize')}
    tabindex={open && !expanded ? 0 : -1}
    data-tooltip="none"
    onpointerdown={startResize}
    onpointermove={dragResize}
    onpointerup={stopResize}
    onpointercancel={stopResize}
    onkeydown={resizeWithKeyboard}
  ></button>

  <div class="tab-strip">
    <div class="tabs">
      {#each tabs as tab (tab.id)}
        <div class:active={tab.id === activeTab?.id} class="tab">
          <button type="button" class="tab-main" onclick={() => onSelect(tab.id)}>
            {#if tab.kind === 'browser'}
              <span class="tab-favicon" class:controlled={isLeased($leasedUrls, tab.url)}>
                {#if usableFavicon(tab.favicon, faviconsSettled)}<img src={tab.favicon} alt="" draggable="false"/>{:else}<Icon name="globe" size={16}/>{/if}
                {#if isLeased($leasedUrls, tab.url)}
                  <svg class="tab-cursor-badge" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.04536 4.45259C2.7582 3.60299 3.60299 2.7582 4.45259 3.04536L14.1828 6.33403C15.1637 6.66558 15.0872 8.08006 14.0715 8.39045L10.2994 9.54319C9.93919 9.65327 9.65327 9.93919 9.54319 10.2994L8.39046 14.0715C8.08007 15.0872 6.66558 15.1637 6.33404 14.1828L3.04536 4.45259Z" fill="black" stroke="white" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke fill"/></svg>
                {/if}
              </span>
            {:else}
              <Icon name={tabIcons[tab.kind]} size={16}/>
            {/if}
            <span>{tab.title}</span></button>
          <button type="button" class="tab-close" aria-label={$t('workspace.closeTab', {title: tab.title})} data-tooltip="none" onclick={() => onClose(tab.id)}><Icon name="close" size={14}/></button>
        </div>
      {/each}
    </div>
    <!-- With nothing open the launcher below already offers these, so the
         header would only repeat them. -->
    {#if tabs.length}
      <div bind:this={newTabWrapper} class="new-tab-wrap">
        <button type="button" class="title-bar-icon-button workspace-header-action" aria-label={$t('workspace.newTab')} data-tooltip-align="end" aria-haspopup="menu" aria-expanded={addOpen} onclick={() => addOpen = !addOpen}><Icon name="plus" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
        {#if addOpen}
          <div class="flareai-dropdown-menu new-tab-menu" role="menu">
            <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => { addOpen = false; onNew('browser'); }}><Icon name="globe" size={14}/><span>{$t('workspace.openBrowser')}</span></button>
            <!-- Drive and Schedule leave the title bar while the drawer is
                 open, so this menu is where they live instead. -->
            {#if !openKinds.has('drive')}
              <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => { addOpen = false; onNew('drive'); }}><Icon name="drive" size={14}/><span>{$t('workspace.drive')}</span></button>
            {/if}
            {#if !openKinds.has('schedule')}
              <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => { addOpen = false; onNew('schedule'); }}><Icon name="clock" size={14}/><span>{$t('workspace.schedule')}</span></button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
    <button
      type="button"
      class="title-bar-icon-button workspace-header-action expand-workspace-action"
      aria-label={expanded ? $t('workspace.minimise') : $t('workspace.expand')}
      data-tooltip-label={expanded ? $t('common.minimise') : $t('common.expand')}
      data-tooltip-align="end"
      aria-pressed={expanded}
      onclick={onToggleExpand}
    ><Icon name={expanded ? 'collapse' : 'expand'} size={14} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
  </div>

  <div class="workspace-content">
    {#if !activeTab}
      <div class="workspace-launcher">
        <button type="button" class="workspace-launcher-row" onclick={() => onNew('browser')}><Icon name="globe" size={16}/><span>{$t('workspace.openBrowser')}</span></button>
        {#if !openKinds.has('drive')}
          <button type="button" class="workspace-launcher-row" onclick={() => onNew('drive')}><Icon name="drive" size={16}/><span>{$t('workspace.drive')}</span></button>
        {/if}
        {#if !openKinds.has('schedule')}
          <button type="button" class="workspace-launcher-row" onclick={() => onNew('schedule')}><Icon name="clock" size={16}/><span>{$t('workspace.schedule')}</span></button>
        {/if}
        <button type="button" class="workspace-launcher-row" onclick={() => onNew('hub')}><Icon name="chat" size={16}/><span>{$t('workspace.hub')}</span></button>
        <p class="workspace-launcher-heading">{showHistory ? $t('workspace.recent') : $t('workspace.suggestions')}</p>
        <div class="workspace-launcher-suggestions">
          {#if showHistory}
            {#each historySuggestions as visit (visit.url)}
              <button type="button" class="workspace-launcher-suggestion" onclick={() => onOpenUrl(visit.url, visit.title)}>
                <span class="tab-favicon">
                  {#if usableFavicon(visit.favicon, faviconsSettled)}<img src={visit.favicon} alt="" draggable="false"/>{:else}<Icon name="globe" size={16}/>{/if}
                </span>
                <span>{visit.title}</span>
              </button>
            {/each}
          {:else}
            <button type="button" class="workspace-launcher-suggestion" onclick={() => onSuggest($t('workspace.suggestDocumentPrompt'))}><Icon name="document" size={16}/><span>{$t('workspace.suggestDocument')}</span></button>
            <button type="button" class="workspace-launcher-suggestion" onclick={() => onSuggest($t('workspace.suggestPresentationPrompt'))}><Icon name="presentation" size={16}/><span>{$t('workspace.suggestPresentation')}</span></button>
            <button type="button" class="workspace-launcher-suggestion" onclick={() => onSuggest($t('workspace.suggestSpreadsheetPrompt'))}><Icon name="spreadsheet" size={16}/><span>{$t('workspace.suggestSpreadsheet')}</span></button>
          {/if}
        </div>
      </div>
    {:else if activeTab.kind === 'document'}<DocumentView title={activeTab.title}/>
    {:else if activeTab.kind === 'slides'}<SlideView title={activeTab.title}/>
    {:else if activeTab.kind === 'sheet'}<SheetView title={activeTab.title}/>
    {:else if activeTab.kind === 'photo'}<PhotoView title={activeTab.title}/>
    {:else if activeTab.kind === 'video'}<VideoView title={activeTab.title}/>
    <!-- Keyed by tab: switching between two browser tabs must destroy the old
         BrowserView (which hides its native page) and mount the new one, not
         retarget one instance and leave the old page painted on screen. -->
    <!-- addOpen: the page is a native view that paints above all DOM, so while
         the new-tab menu hangs over it the page steps aside instead of
         covering the menu. -->
    {:else if activeTab.kind === 'browser'}{#key activeTab.id}<BrowserView tabId={activeTab.id} title={activeTab.title} url={activeTab.url} obscured={browserObscured || browserHidden || addOpen} onState={(patch) => onTabState(activeTab.id, patch)}/>{/key}
    {:else if activeTab.kind === 'side-chat'}<SideChatView title={activeTab.title}/>
    {:else if activeTab.kind === 'hub'}<HubView/>
    {:else if activeTab.kind === 'drive'}<DriveView
      title={activeTab.title}
      root={driveRoot}
      sources={driveSources}
      activeSourceId={driveSourceId}
      loading={driveLoading}
      error={driveError}
      onDismissError={onDismissDriveError}
      onSelectSource={onSelectDriveSource}
      onNavigate={onDriveNavigate}
      onOpenEntry={onOpenDriveEntry}
      onNewFolder={driveActions?.newFolder ?? null}
      onUpload={driveActions?.upload ?? null}
      onRename={driveActions?.rename ?? null}
      onMove={driveActions?.move ?? null}
      onDuplicate={driveActions?.duplicate ?? null}
      onDownload={driveActions?.download ?? null}
      onDelete={driveActions?.remove ?? null}
    />
    {:else if activeTab.kind === 'schedule'}<ScheduleView title={activeTab.title} items={scheduleItems} onToggleItem={onToggleSchedule} onCreate={onCreateSchedule} onDeleteItem={onDeleteSchedule} onRunItem={onRunSchedule} onChangeFrequency={onScheduleFrequency}/>
    {:else}<SummaryView section={activeTab.section ?? 'outputs'} data={summaryData}/>
    {/if}
  </div>
</aside>
