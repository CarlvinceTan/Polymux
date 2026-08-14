<script module lang="ts">
  export type WorkspaceTabKind = 'document' | 'slides' | 'sheet' | 'photo' | 'video' | 'browser' | 'side-chat' | 'summary';
  export type WorkspaceTab = {id: string; title: string; kind: WorkspaceTabKind; url?: string; section?: 'outputs' | 'references' | 'tasks'};
</script>

<script lang="ts">
  import Icon from '../shared/Icon.svelte';
  import {MAIN_UI_ICON_SIZE, MAIN_UI_ICON_STROKE_WIDTH} from '../../layout/iconSizing';
  import {SPLIT_LAYOUT_MIN_WIDTH, clampPanelWidth, workspaceResizeBounds} from '../../layout/layoutSizing';
  import DocumentView from './DocumentView.svelte';
  import SlideView from './SlideView.svelte';
  import SheetView from './SheetView.svelte';
  import PhotoView from './PhotoView.svelte';
  import VideoView from './VideoView.svelte';
  import BrowserView from './BrowserView.svelte';
  import SideChatView from './SideChatView.svelte';
  import SummaryView, {type SummaryViewData} from './SummaryView.svelte';

  export let tabs: WorkspaceTab[] = [];
  export let activeTabId: string | null = null;
  export let open = false;
  export let expanded = false;
  export let resizing = false;
  export let reservedWidth = 0;
  export let summaryData: SummaryViewData = {outputs: [], references: [], tasks: []};
  export let onSelect: (id: string) => void = () => {};
  export let onClose: (id: string) => void = () => {};
  export let onNew: (kind: WorkspaceTabKind) => void = () => {};
  export let onToggleExpand: () => void = () => {};
  export let onResize: (width: number) => void = () => {};
  export let onResizeState: (resizing: boolean) => void = () => {};
  /** True while another surface covers the drawer; the embedded browser's
   * native view must hide under it. */
  export let browserObscured = false;
  export let onTabState: (id: string, patch: {title?: string; url?: string}) => void = () => {};

  let panel: HTMLElement;
  let newTabWrapper: HTMLDivElement;
  let addOpen = false;

  $: activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  const tabIcons: Record<WorkspaceTabKind, 'document' | 'presentation' | 'spreadsheet' | 'image' | 'video' | 'globe' | 'chat' | 'summary'> = {
    document: 'document',
    slides: 'presentation',
    sheet: 'spreadsheet',
    photo: 'image',
    video: 'video',
    browser: 'globe',
    'side-chat': 'chat',
    summary: 'summary',
  };

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
  class="workspace-drawer"
  aria-label="Workspace"
  aria-hidden={!open}
  inert={!open}
>
  <button
    type="button"
    class="workspace-resize-handle"
    aria-label="Resize Workspace"
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
          <button type="button" class="tab-main" onclick={() => onSelect(tab.id)}><Icon name={tabIcons[tab.kind]} size={16}/><span>{tab.title}</span></button>
          <button type="button" class="tab-close" aria-label={`Close ${tab.title}`} data-tooltip="none" onclick={() => onClose(tab.id)}><Icon name="close" size={14}/></button>
        </div>
      {/each}
    </div>
    <!-- With nothing open the launcher below already offers these, so the
         header would only repeat them. -->
    {#if tabs.length}
      <div bind:this={newTabWrapper} class="new-tab-wrap">
        <button type="button" class="title-bar-icon-button workspace-header-action" aria-label="New tab" data-tooltip-align="end" aria-haspopup="menu" aria-expanded={addOpen} onclick={() => addOpen = !addOpen}><Icon name="plus" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
        {#if addOpen}
          <div class="polymux-dropdown-menu new-tab-menu" role="menu">
            <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => { addOpen = false; onNew('browser'); }}><Icon name="globe" size={14}/><span>Open browser</span></button>
            <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => { addOpen = false; onNew('document'); }}><Icon name="file" size={14}/><span>Open file</span></button>
          </div>
        {/if}
      </div>
    {/if}
    <button
      type="button"
      class="title-bar-icon-button workspace-header-action expand-workspace-action"
      aria-label={expanded ? 'Minimise Workspace' : 'Expand Workspace'}
      data-tooltip-label={expanded ? 'Minimise' : 'Expand'}
      data-tooltip-align="end"
      aria-pressed={expanded}
      onclick={onToggleExpand}
    ><Icon name={expanded ? 'collapse' : 'expand'} size={14} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
  </div>

  <div class="workspace-content">
    {#if !activeTab}
      <div class="workspace-launcher">
        <button type="button" class="workspace-launcher-row" onclick={() => onNew('browser')}><Icon name="globe" size={16}/><span>Open browser</span></button>
        <button type="button" class="workspace-launcher-row" onclick={() => onNew('document')}><Icon name="file" size={16}/><span>Open file</span></button>
        <p class="workspace-launcher-heading">Suggestions</p>
        <div class="workspace-launcher-suggestions">
          <button type="button" class="workspace-launcher-suggestion" onclick={() => onNew('document')}><Icon name="document" size={16}/><span>Create a document</span></button>
          <button type="button" class="workspace-launcher-suggestion" onclick={() => onNew('slides')}><Icon name="presentation" size={16}/><span>Create a presentation</span></button>
          <button type="button" class="workspace-launcher-suggestion" onclick={() => onNew('sheet')}><Icon name="spreadsheet" size={16}/><span>Create a spreadsheet</span></button>
        </div>
      </div>
    {:else if activeTab.kind === 'document'}<DocumentView title={activeTab.title}/>
    {:else if activeTab.kind === 'slides'}<SlideView title={activeTab.title}/>
    {:else if activeTab.kind === 'sheet'}<SheetView title={activeTab.title}/>
    {:else if activeTab.kind === 'photo'}<PhotoView title={activeTab.title}/>
    {:else if activeTab.kind === 'video'}<VideoView title={activeTab.title}/>
    {:else if activeTab.kind === 'browser'}<BrowserView tabId={activeTab.id} title={activeTab.title} url={activeTab.url} obscured={browserObscured || !open} onState={(patch) => onTabState(activeTab.id, patch)}/>
    {:else if activeTab.kind === 'side-chat'}<SideChatView title={activeTab.title}/>
    {:else}<SummaryView section={activeTab.section ?? 'outputs'} data={summaryData}/>
    {/if}
  </div>
</aside>
