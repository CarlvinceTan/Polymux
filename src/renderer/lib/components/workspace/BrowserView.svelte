<script module lang="ts">
  export type BrowserDownload = {id: string; title: string; kind?: 'document' | 'image' | 'pdf' | 'spreadsheet' | 'file'; completedAt?: string};
</script>

<script lang="ts">
  import {onDestroy, onMount, tick} from 'svelte';
  import Icon from '../shared/Icon.svelte';
  import {flareaiApi} from '../../api/flareai';

  export let tabId = '';
  export let title = 'Browser';
  export let url: string | undefined = '';
  /** True while another surface (a modal, the speech orb) covers the drawer.
   * The embedded view floats above every DOM element, so it must yield. */
  export let obscured = false;
  export let onState: (patch: {title?: string; url?: string; favicon?: string | null}) => void = () => {};

  const api = flareaiApi();
  // The embedded browser is real Chromium hosted by the main process. Without
  // it (browser demo, tests) the old iframe rendering stands in, with its
  // framing-header limitations.
  const embedded = api.browser.embedded && Boolean(tabId);

  let draft = url ?? '';
  let currentUrl = url ?? '';
  let pageLoaded = false;
  let canGoBack = false;
  let canGoForward = false;
  let refreshing = false;
  let downloadsOpen = false;
  let moreOpen = false;
  let findOpen = false;
  let findQuery = '';
  let findMatches: {matches: number; activeMatch: number} | null = null;
  let addressForm: HTMLElement;
  let addressInput: HTMLInputElement;
  /** Set once the user edits the address by hand: their text outlives both the
   * blur and any page-state update, and is only dropped once they navigate. */
  let addressDirty = false;
  let focusWatch: number | undefined;
  let downloadsWrapper: HTMLElement;
  let moreWrapper: HTMLElement;
  let surface: HTMLElement;
  let unsubscribe: (() => void) | undefined;
  let boundsFrame: number | undefined;
  let lastBounds = '';
  let downloads: BrowserDownload[] = [];

  $: if (!embedded) draft = url ?? '';
  // The bar's own popovers hang over the page too, so it steps aside for them
  // the same way it does for surfaces that cover the whole drawer.
  $: if (embedded) void api.browser.setVisible(tabId, !obscured && !downloadsOpen && !moreOpen);

  /** "Search or enter address" semantics: URLs load, anything else searches. */
  function resolveInput(value: string): string {
    const text = value.trim();
    if (/^https?:\/\//i.test(text)) return text;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(text)) return `https://${text}`;
    return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    addressDirty = false;
    addressInput?.blur();
    if (embedded) void api.browser.navigate(tabId, resolveInput(next));
    else if (url = resolveInput(next)) onState({url});
  }

  function goHistory(delta: -1 | 1): void {
    if (embedded) void api.browser.history(tabId, delta);
  }

  let refreshingTimer: ReturnType<typeof setTimeout> | undefined;

  function reload(): void {
    refreshing = true;
    if (embedded) void api.browser.reload(tabId);
    clearTimeout(refreshingTimer);
    refreshingTimer = setTimeout(() => refreshing = false, 420);
  }

  function downloadIcon(entry: BrowserDownload): 'document' | 'image' | 'pdf' | 'spreadsheet' | 'file' {
    return entry.kind ?? 'file';
  }

  function openFind(): void {
    moreOpen = false;
    findOpen = true;
    findMatches = null;
  }

  function submitFind(event: SubmitEvent): void {
    event.preventDefault();
    if (findQuery.trim()) void api.browser.find(tabId, findQuery.trim(), true);
  }

  function closeFind(): void {
    findOpen = false;
    findMatches = null;
    findQuery = '';
    if (embedded) void api.browser.stopFind(tabId);
  }

  async function takeScreenshot(): Promise<void> {
    moreOpen = false;
    // Closing the menu is what un-hides the page, and that ride runs through a
    // reactive flush; capture only after it, or the shot is of a hidden view.
    await tick();
    const entry = await api.browser.screenshot(tabId);
    if (entry) downloads = [entry, ...downloads.filter((existing) => existing.id !== entry.id)];
  }

  /** One popover at a time, and a click anywhere else closes them both. */
  function dismiss(event: MouseEvent): void {
    const target = event.target as Node;
    if (downloadsOpen && !downloadsWrapper?.contains(target)) downloadsOpen = false;
    if (moreOpen && !moreWrapper?.contains(target)) moreOpen = false;
  }

  /** Clicking the embedded page moves OS focus to the web contents without
   * sending a click to this window, so the address field would otherwise keep
   * its caret and keystrokes. The typed text stays — only navigating replaces
   * it. */
  function releaseAddress(): void {
    addressInput?.blur();
  }

  /** The page is a separate web contents pinned over this pane, and the ways
   * it can take focus are not all observable from here: the DOM `blur` is not
   * guaranteed, and a view with nothing loaded may report no focus event of
   * its own. So while the caret is in the address bar, this asks the one
   * question that holds in every case — does this document still have focus? */
  function watchDocumentFocus(): void {
    clearInterval(focusWatch);
    focusWatch = setInterval(() => {
      if (document.activeElement !== addressInput) {
        clearInterval(focusWatch);
        focusWatch = undefined;
      } else if (!document.hasFocus()) {
        releaseAddress();
      }
    }, 150) as unknown as number;
  }

  function stopWatchingFocus(): void {
    clearInterval(focusWatch);
    focusWatch = undefined;
  }

  /** A click anywhere in this window but the address bar takes the caret out
   * of it too — a plain surface swallowing the click would otherwise leave it
   * blinking. */
  function releaseOnOutsideClick(event: MouseEvent): void {
    if (!addressForm?.contains(event.target as Node)) releaseAddress();
  }

  /** The main process positions the web contents under this component's
   * surface, so its rectangle is reported whenever it can have moved. Layout
   * animations (drawer slides, resizes) have no end event that covers every
   * case, so this is sampled every frame instead: the drawer slide moves the
   * surface continuously, and anything coarser repositions the web contents in
   * visible steps that read as the page lagging behind its own pane. The
   * rectangle is compared first, so a still layout costs one `getBoundingClientRect`
   * per frame and sends nothing. */
  function reportBounds(): void {
    if (!surface) return;
    const box = surface.getBoundingClientRect();
    // A tab with nothing loaded has no document behind the view, so it shows
    // the empty state through it — and swallows every click without reporting
    // one, which used to leave the address bar holding the caret. Keeping the
    // view out of the way until a page exists hands those clicks to the DOM.
    const rect = pageLoaded ? box : {x: box.x, y: box.y, width: 0, height: 0};
    const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (key === lastBounds) return;
    lastBounds = key;
    void api.browser.setBounds(tabId, {x: rect.x, y: rect.y, width: rect.width, height: rect.height});
  }

  onMount(() => {
    if (!embedded) return;
    void api.browser.open(tabId, url || undefined);
    unsubscribe = api.browser.subscribe((event) => {
      if (event.type === 'state' && event.state.tabId === tabId) {
        currentUrl = event.state.url;
        pageLoaded = Boolean(event.state.url);
        canGoBack = event.state.canGoBack;
        canGoForward = event.state.canGoForward;
        if (!addressDirty && document.activeElement !== addressInput) draft = event.state.url;
        onState({
          title: event.state.title || undefined,
          url: event.state.url || undefined,
          favicon: event.state.faviconUrl,
        });
      } else if (event.type === 'focus' && event.tabId === tabId) {
        releaseAddress();
      } else if (event.type === 'downloads') {
        downloads = event.downloads;
      } else if (event.type === 'found' && event.found.tabId === tabId) {
        findMatches = {matches: event.found.matches, activeMatch: event.found.activeMatch};
      }
    });
    void api.browser.downloads().then((value) => downloads = value);
    const observer = new ResizeObserver(reportBounds);
    observer.observe(surface);
    window.addEventListener('resize', reportBounds);
    const trackBounds = (): void => {
      reportBounds();
      boundsFrame = requestAnimationFrame(trackBounds);
    };
    trackBounds();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', reportBounds);
    };
  });

  onDestroy(() => {
    stopWatchingFocus();
    clearTimeout(refreshingTimer);
    if (boundsFrame !== undefined) cancelAnimationFrame(boundsFrame);
    unsubscribe?.();
    // Switching tabs unmounts this component while the tab stays open, so the
    // view hides rather than closes; the drawer closes it with the tab.
    if (embedded) void api.browser.setVisible(tabId, false);
  });
</script>

<svelte:window onclick={dismiss} onmousedown={releaseOnOutsideClick} onblur={releaseAddress}/>

<div class="browser-bar">
  <div class="browser-actions browser-nav-actions">
    <button type="button" aria-label="Back" disabled={!canGoBack} onclick={() => goHistory(-1)}><Icon name="back" size={16}/></button>
    <button type="button" aria-label="Forward" disabled={!canGoForward} onclick={() => goHistory(1)}><Icon name="forward" size={16}/></button>
    <button type="button" class:refreshing class="refresh-button" aria-label="Refresh" aria-busy={refreshing} onclick={reload}><Icon name="reload" size={16}/></button>
  </div>

  <form bind:this={addressForm} class="address-form" onsubmit={submit}>
    <input bind:this={addressInput} bind:value={draft} oninput={() => addressDirty = true} onfocus={watchDocumentFocus} onblur={stopWatchingFocus} aria-label="Address" placeholder="Search or enter address" spellcheck="false" autocomplete="off"/>
    <button type="submit" class="address-submit" aria-label="Navigate" data-tooltip="none"><Icon name="send" size={16}/></button>
  </form>

  <div class="browser-actions browser-page-actions">
    <div bind:this={downloadsWrapper} class="workspace-downloads-wrap">
      <button type="button" class:active={downloadsOpen} aria-label="Downloads" aria-haspopup="dialog" aria-expanded={downloadsOpen} onclick={() => { moreOpen = false; downloadsOpen = !downloadsOpen; }}><Icon name="download" size={16}/></button>
      {#if downloadsOpen}
        <div class="downloads-popover" role="dialog" aria-labelledby="downloads-title">
          <header>
            <h2 id="downloads-title">Downloads</h2>
            <button type="button" aria-label="Show Downloads in file manager" disabled={!embedded} onclick={() => void api.browser.openDownloadsFolder()}><Icon name="folder" size={17}/></button>
          </header>
          <div class="download-rows">
            {#each downloads as entry (entry.id)}
              <button type="button" class="download-row" onclick={() => void api.browser.openDownload(entry.id)}>
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
        <div class="flareai-dropdown-menu workspace-more-menu" role="menu">
          <button type="button" class="flareai-dropdown-item" role="menuitem" disabled={!embedded || !pageLoaded} onclick={openFind}><span>Find in page</span></button>
          <button type="button" class="flareai-dropdown-item" role="menuitem" disabled={!embedded || !pageLoaded} onclick={() => { moreOpen = false; void api.browser.print(tabId); }}><span>Print</span></button>
          <button type="button" class="flareai-dropdown-item" role="menuitem" disabled={!embedded || !pageLoaded} onclick={() => void takeScreenshot()}><span>Take a screenshot</span></button>
          <div class="workspace-menu-divider"></div>
          <button type="button" class="flareai-dropdown-item" role="menuitem" disabled={!currentUrl && !url} onclick={() => { moreOpen = false; void api.browser.openExternal(currentUrl || url || ''); }}><span>Open in browser</span></button>
        </div>
      {/if}
    </div>
  </div>
</div>

{#if findOpen}
  <form class="browser-find" onsubmit={submitFind}>
    <input bind:value={findQuery} aria-label="Find in page" placeholder="Find in page" spellcheck="false"/>
    {#if findMatches}<span class="browser-find-count">{findMatches.matches ? `${findMatches.activeMatch}/${findMatches.matches}` : 'No matches'}</span>{/if}
    <button type="submit" disabled={!findQuery.trim()} aria-label="Find next"><Icon name="forward" size={14}/></button>
    <button type="button" aria-label="Close find" onclick={closeFind}><Icon name="close" size={14}/></button>
  </form>
{/if}

{#if embedded}
  <!-- The page renders in a WebContentsView the main process pins to this
       surface's rectangle; the empty state shows through until a page loads. -->
  <div bind:this={surface} class="browser-frame browser-surface">
    {#if !pageLoaded}
      <div class="new-tab-empty">
        <Icon name="globe" size={30}/>
        <h2>{title}</h2>
        <p>Enter an address to start browsing.</p>
      </div>
    {/if}
  </div>
{:else if url}
  <iframe class="browser-frame" src={url} {title} sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
{:else}
  <div class="new-tab-empty">
    <Icon name="globe" size={30}/>
    <h2>{title}</h2>
    <p>Enter an address to start browsing.</p>
  </div>
{/if}
