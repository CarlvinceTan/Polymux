<script module lang="ts">
  export type BrowserDownload = {id: string; title: string; kind?: 'document' | 'image' | 'pdf' | 'spreadsheet' | 'file'; completedAt?: string};
</script>

<script lang="ts">
  import Icon from '../shared/Icon.svelte';

  export let title = 'Browser';
  export let url: string | undefined = '';
  export let canGoBack = false;
  export let canGoForward = false;
  export let onNavigate: (url: string) => void = () => {};
  export let onHistory: (delta: -1 | 1) => void = () => {};
  export let onReload: () => void = () => {};
  export let downloads: BrowserDownload[] = [];
  /** Left undefined where the host cannot perform the action, which disables
   * the menu item rather than offering something that would silently do
   * nothing — the same way flareAI greys these out without a live session. */
  export let onOpenDownloadsFolder: (() => void) | undefined = undefined;
  export let onOpenDownload: ((id: string) => void) | undefined = undefined;
  export let onOpenExternal: ((url: string) => void) | undefined = undefined;
  export let onFindInPage: (() => void) | undefined = undefined;
  export let onPrint: (() => void) | undefined = undefined;
  export let onScreenshot: (() => void) | undefined = undefined;

  let draft = url ?? '';
  let refreshing = false;
  let downloadsOpen = false;
  let moreOpen = false;
  let downloadsWrapper: HTMLElement;
  let moreWrapper: HTMLElement;

  $: draft = url ?? '';

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const next = draft.trim();
    if (next) onNavigate(next);
  }

  function reload(): void {
    refreshing = true;
    onReload();
    setTimeout(() => refreshing = false, 420);
  }

  function downloadIcon(entry: BrowserDownload): 'document' | 'image' | 'pdf' | 'spreadsheet' | 'file' {
    return entry.kind ?? 'file';
  }

  /** One popover at a time, and a click anywhere else closes them both. */
  function dismiss(event: MouseEvent): void {
    const target = event.target as Node;
    if (downloadsOpen && !downloadsWrapper?.contains(target)) downloadsOpen = false;
    if (moreOpen && !moreWrapper?.contains(target)) moreOpen = false;
  }
</script>

<svelte:window onclick={dismiss}/>

<div class="browser-bar">
  <div class="browser-actions browser-nav-actions">
    <button type="button" aria-label="Back" disabled={!canGoBack} onclick={() => onHistory(-1)}><Icon name="back" size={16}/></button>
    <button type="button" aria-label="Forward" disabled={!canGoForward} onclick={() => onHistory(1)}><Icon name="forward" size={16}/></button>
    <button type="button" class:refreshing class="refresh-button" aria-label="Refresh" aria-busy={refreshing} onclick={reload}><Icon name="reload" size={16}/></button>
  </div>

  <form class="address-form" onsubmit={submit}>
    <input bind:value={draft} aria-label="Address" placeholder="Search or enter address" spellcheck="false" autocomplete="off"/>
    <button type="submit" class="address-submit" aria-label="Navigate" data-tooltip="none"><Icon name="send" size={16}/></button>
  </form>

  <div class="browser-actions browser-page-actions">
    <div bind:this={downloadsWrapper} class="workspace-downloads-wrap">
      <button type="button" class:active={downloadsOpen} aria-label="Downloads" aria-haspopup="dialog" aria-expanded={downloadsOpen} onclick={() => { moreOpen = false; downloadsOpen = !downloadsOpen; }}><Icon name="download" size={16}/></button>
      {#if downloadsOpen}
        <div class="downloads-popover" role="dialog" aria-labelledby="downloads-title">
          <header>
            <h2 id="downloads-title">Downloads</h2>
            <button type="button" aria-label="Show Downloads in file manager" disabled={!onOpenDownloadsFolder} onclick={() => onOpenDownloadsFolder?.()}><Icon name="folder" size={17}/></button>
          </header>
          <div class="download-rows">
            {#each downloads as entry (entry.id)}
              <button type="button" class="download-row" onclick={() => onOpenDownload?.(entry.id)}>
                <span class="download-mark"><Icon name={downloadIcon(entry)} size={16}/></span>
                <span class="download-copy"><strong>{entry.title}</strong><small>Downloaded{entry.completedAt ? ` · ${entry.completedAt}` : ''}</small></span>
              </button>
            {:else}
              <p class="downloads-empty">Downloads from this workspace appear here.</p>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div bind:this={moreWrapper} class="workspace-more-wrap">
      <button type="button" aria-label="More" data-tooltip-align="end" aria-haspopup="menu" aria-expanded={moreOpen} onclick={() => { downloadsOpen = false; moreOpen = !moreOpen; }}><Icon name="more" size={16}/></button>
      {#if moreOpen}
        <div class="polymux-dropdown-menu workspace-more-menu" role="menu">
          <button type="button" class="polymux-dropdown-item" role="menuitem" disabled={!onFindInPage} onclick={() => { moreOpen = false; onFindInPage?.(); }}><span>Find in page</span></button>
          <button type="button" class="polymux-dropdown-item" role="menuitem" disabled={!onPrint} onclick={() => { moreOpen = false; onPrint?.(); }}><span>Print</span></button>
          <button type="button" class="polymux-dropdown-item" role="menuitem" disabled={!onScreenshot} onclick={() => { moreOpen = false; onScreenshot?.(); }}><span>Take a screenshot</span></button>
          <div class="workspace-menu-divider"></div>
          <button type="button" class="polymux-dropdown-item" role="menuitem" disabled={!url || !onOpenExternal} onclick={() => { moreOpen = false; if (url) onOpenExternal?.(url); }}><span>Open in browser</span></button>
        </div>
      {/if}
    </div>
  </div>
</div>

{#if url}
  <iframe class="browser-frame" src={url} {title} sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
{:else}
  <div class="new-tab-empty">
    <Icon name="globe" size={30}/>
    <h2>{title}</h2>
    <p>Enter an address to start browsing.</p>
  </div>
{/if}
