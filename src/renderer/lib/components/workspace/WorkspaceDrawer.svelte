<script module lang="ts">
  export type WorkspaceTabKind = 'document' | 'slides' | 'sheet' | 'photo' | 'video' | 'browser' | 'side-chat' | 'summary';
  export type WorkspaceTab = {id: string; title: string; kind: WorkspaceTabKind; url?: string; section?: 'outputs' | 'references' | 'tasks'};
</script>

<script lang="ts">
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
  export let width = 540;
  export let minWidth = 360;
  export let maxWidth = 900;
  export let expanded = false;
  export let summaryData: SummaryViewData = {outputs: [], references: [], tasks: []};
  export let onSelect: (id: string) => void = () => {};
  export let onClose: (id: string) => void = () => {};
  export let onDismiss: () => void = () => {};
  export let onToggleExpand: () => void = () => {};
  export let onResize: (width: number) => void = () => {};

  let resizing = false;
  $: activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  function resize(event: PointerEvent): void {
    if (!resizing || expanded) return;
    onResize(Math.min(maxWidth, Math.max(minWidth, window.innerWidth - event.clientX)));
  }
</script>

<aside class:open class:expanded class="workspace-drawer" style:--drawer-width={`${width}px`} aria-label="Workspace" aria-hidden={!open} inert={!open}>
  <button class="resize-handle" type="button" aria-label="Resize Workspace" onpointerdown={(event) => { resizing = true; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }} onpointermove={resize} onpointerup={() => resizing = false} onpointercancel={() => resizing = false}></button>
  <header>
    <div class="tabs" role="tablist" aria-label="Workspace tabs">
      {#each tabs as tab (tab.id)}
        <div class:active={tab.id === activeTab?.id} class="tab">
          <button type="button" role="tab" aria-selected={tab.id === activeTab?.id} onclick={() => onSelect(tab.id)}><span>{tab.title}</span></button>
          <button type="button" class="close-tab" aria-label={`Close ${tab.title}`} onclick={() => onClose(tab.id)}>×</button>
        </div>
      {/each}
    </div>
    <button type="button" class="header-action" aria-label={expanded ? 'Restore Workspace' : 'Expand Workspace'} onclick={onToggleExpand}>{expanded ? '↙' : '↗'}</button>
    <button type="button" class="header-action" aria-label="Close Workspace" onclick={onDismiss}>×</button>
  </header>

  <div class="workspace-content">
    {#if !activeTab}
      <div class="empty">Open an output, reference, or browser tab.</div>
    {:else if activeTab.kind === 'document'}<DocumentView title={activeTab.title}/>
    {:else if activeTab.kind === 'slides'}<SlideView title={activeTab.title}/>
    {:else if activeTab.kind === 'sheet'}<SheetView title={activeTab.title}/>
    {:else if activeTab.kind === 'photo'}<PhotoView title={activeTab.title}/>
    {:else if activeTab.kind === 'video'}<VideoView title={activeTab.title}/>
    {:else if activeTab.kind === 'browser'}<BrowserView title={activeTab.title}/>
    {:else if activeTab.kind === 'side-chat'}<SideChatView title={activeTab.title}/>
    {:else}<SummaryView section={activeTab.section ?? 'outputs'} data={summaryData}/>
    {/if}
  </div>
</aside>

<style>
  .workspace-drawer { position: fixed; z-index: 70; top: 50px; right: 0; bottom: 0; width: min(var(--drawer-width), calc(100vw - 18px)); display: flex; flex-direction: column; border-left: 1px solid #e5e5e5; background: #fff; box-shadow: -18px 0 45px rgb(0 0 0 / 8%); transform: translateX(calc(100% + 20px)); visibility: hidden; transition: transform 440ms cubic-bezier(.45,0,.55,1), visibility 0s linear 440ms; }
  .workspace-drawer.open { transform: translateX(0); visibility: visible; transition: transform 440ms cubic-bezier(.45,0,.55,1), visibility 0s; }
  .workspace-drawer.expanded { width: 100vw; }
  header { height: 48px; display: flex; align-items: center; gap: 4px; flex: none; border-bottom: 1px solid #e5e5e5; padding: 0 10px; }
  .tabs { min-width: 0; flex: 1; display: flex; gap: 3px; overflow-x: auto; }
  .tab { min-width: 90px; max-width: 180px; height: 33px; display: flex; align-items: center; border-radius: 9px; color: #737373; }
  .tab.active { background: #f1f1f1; color: #171717; }
  .tab > button:first-child { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { border: 0; padding: 7px 8px; background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 12px; }
  .close-tab { padding-inline: 5px; font-size: 16px; }
  .header-action { width: 30px; height: 30px; padding: 0; border-radius: 8px; font-size: 17px; }
  .header-action:hover { background: #f1f1f1; }
  .workspace-content { min-height: 0; flex: 1; overflow: hidden; }
  .empty { height: 100%; display: grid; place-items: center; color: #737373; font-size: 13px; }
  .resize-handle { position: absolute; z-index: 4; top: 0; bottom: 0; left: -5px; width: 10px; padding: 0; cursor: ew-resize; touch-action: none; }
  .expanded .resize-handle { display: none; }
  @media (max-width: 700px) { .workspace-drawer { top: 50px; width: 100vw; } .resize-handle { display: none; } }
  @media (prefers-reduced-motion: reduce) { .workspace-drawer { transition-duration: 1ms; } }
</style>
