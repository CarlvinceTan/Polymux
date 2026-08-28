<script module lang="ts">
  export type BrowserDownload = {id: string; title: string; kind?: 'document' | 'image' | 'pdf' | 'spreadsheet' | 'file'; completedAt?: string};
</script>

<script lang="ts">
  import {onDestroy, onMount, tick} from 'svelte';
  import Icon from '../../shared/components/Icon.svelte';
  import {polymuxApi} from '../../api/polymux';
  import {t, type MessageKey} from '../../../i18n';
  import type {BrowserHistoryEntryDto, BrowserPermissionDto, BrowserPermissionPromptDto} from '@polymux/protocol';

  type AddressRow = {
    id: string;
    kind: 'history' | 'search';
    title: string;
    detail: string;
    value: string;
  };

  export let tabId = '';
  export let title = '';
  export let url: string | undefined = '';
  /** True while another surface (a modal, the speech orb) covers the drawer.
   * The embedded view floats above every DOM element, so it must yield. */
  export let obscured = false;
  export let onState: (patch: {title?: string; url?: string; favicon?: string | null}) => void = () => {};

  const api = polymuxApi();

  const PERMISSION_LABELS: Record<BrowserPermissionDto, MessageKey> = {
    geolocation: 'browser.permissionGeolocation',
    media: 'browser.permissionMedia',
    notifications: 'browser.permissionNotifications',
    'clipboard-read': 'browser.permissionClipboardRead',
    pointerLock: 'browser.permissionPointerLock',
    fullscreen: 'browser.permissionFullscreen',
    openExternal: 'browser.permissionOpenExternal',
  };

  function promptText(prompt: BrowserPermissionPromptDto): string {
    let site = prompt.origin;
    try {
      site = new URL(prompt.origin).host;
    } catch {
      // An origin that will not parse is shown as it came, which is still more
      // use than saying nothing about who is asking.
    }
    return $t('browser.permissionPrompt', {
      site,
      permission: $t(PERMISSION_LABELS[prompt.permission]).toLowerCase(),
    });
  }

  function answerPermission(decision: 'allow' | 'deny'): void {
    if (!permissionPrompt) return;
    void api.browser.respondToPermission(permissionPrompt.id, decision, rememberPermission);
    permissionPrompt = null;
    rememberPermission = false;
  }
  // The embedded browser is real Chromium hosted by the main process. Without
  // it (browser demo, tests) the old iframe rendering stands in, with its
  // framing-header limitations.
  const embedded = api.browser.embedded && Boolean(tabId);

  let permissionPrompt: BrowserPermissionPromptDto | null = null;
  let rememberPermission = false;
  let draft = url ?? '';
  let currentUrl = url ?? '';
  // A tab that arrives with a url already has a page behind the view — the
  // agent's tabs do — so the empty state must not paint over it while the
  // first state event is still on its way.
  let pageLoaded = Boolean(url);
  let canGoBack = false;
  let canGoForward = false;
  let refreshing = false;
  let downloadsOpen = false;
  let moreOpen = false;
  let addressSuggestionsOpen = false;
  let addressRows: AddressRow[] = [];
  let selectedAddressRow = -1;
  let addressLookupRevision = 0;
  let addressLookupTimer: ReturnType<typeof setTimeout> | undefined;
  /** The native page must hide while a renderer menu sits above it. Its last
   * frame stays here for that short handoff so the browser never turns blank. */
  let pagePreview: string | null = null;
  let popoverRevision = 0;
  let visibilityRevision = 0;
  let visibilityChange: Promise<void> = Promise.resolve();
  let findOpen = false;
  let findQuery = '';
  let findMatches: {matches: number; activeMatch: number} | null = null;
  let addressForm: HTMLElement;
  let addressInput: HTMLInputElement;
  let addressList: HTMLElement;
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
  // the same way it does for surfaces that cover the whole drawer. A captured
  // frame remains in the DOM beneath a popover while the native view is away.
  $: if (embedded) updatePageVisibility(!obscured && !downloadsOpen && !moreOpen && !addressSuggestionsOpen);

  function updatePageVisibility(visible: boolean): void {
    const revision = ++visibilityRevision;
    visibilityChange = api.browser.setVisible(tabId, visible).catch(() => {});
    void visibilityChange.then(() => {
      if (visible && revision === visibilityRevision) pagePreview = null;
    });
  }

  async function togglePopover(target: 'downloads' | 'more'): Promise<void> {
    const alreadyOpen = target === 'downloads' ? downloadsOpen : moreOpen;
    if (alreadyOpen) {
      popoverRevision += 1;
      if (target === 'downloads') downloadsOpen = false;
      else moreOpen = false;
      return;
    }

    const revision = ++popoverRevision;
    downloadsOpen = false;
    moreOpen = false;
    let preview = pagePreview;
    if (!preview && embedded && pageLoaded) {
      try {
        preview = await api.browser.preview(tabId);
      } catch {
        preview = null;
      }
    }
    if (revision !== popoverRevision) return;
    pagePreview = preview;
    if (target === 'downloads') downloadsOpen = true;
    else moreOpen = true;
  }

  function addressRowId(index: number): string {
    return `browser-address-option-${tabId || 'preview'}-${index}`;
  }

  function displayUrl(value: string): string {
    try {
      const parsed = new URL(value);
      return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
    } catch {
      return value;
    }
  }

  function historyRows(history: BrowserHistoryEntryDto[]): AddressRow[] {
    return history.slice(0, 5).map((entry, index) => ({
      id: `history-${index}-${entry.url}`,
      kind: 'history',
      title: entry.title || displayUrl(entry.url),
      detail: displayUrl(entry.url),
      value: entry.url,
    }));
  }

  function searchRows(query: string, suggestions: string[]): AddressRow[] {
    if (!query || looksLikeAddress(query)) return [];
    const seen = new Set<string>();
    return [query, ...suggestions].flatMap((suggestion) => {
      const value = suggestion.trim();
      const key = value.toLocaleLowerCase();
      if (!value || seen.has(key)) return [];
      seen.add(key);
      return [{
        id: `search-${key}`,
        kind: 'search' as const,
        title: value,
        detail: $t('browser.searchWithGoogle'),
        value,
      }];
    }).slice(0, 6);
  }

  function looksLikeAddress(value: string): boolean {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return true;
    return !/\s/.test(value) && /^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(value);
  }

  async function showAddressRows(rows: AddressRow[], revision: number): Promise<void> {
    if (revision !== addressLookupRevision || document.activeElement !== addressInput) return;
    const selectedId = selectedAddressRow >= 0 ? addressRows[selectedAddressRow]?.id : null;
    addressRows = rows;
    selectedAddressRow = selectedId ? rows.findIndex((row) => row.id === selectedId) : -1;
    if (!rows.length) {
      addressSuggestionsOpen = false;
      return;
    }
    if (!addressSuggestionsOpen) {
      let preview = pagePreview;
      if (!preview && embedded && pageLoaded) {
        try {
          preview = await api.browser.preview(tabId);
        } catch {
          preview = null;
        }
      }
      if (revision !== addressLookupRevision || document.activeElement !== addressInput) return;
      pagePreview = preview;
      addressSuggestionsOpen = true;
    }
  }

  async function loadAddressRows(query: string, revision: number): Promise<void> {
    const text = query.trim().slice(0, 200);
    const history = await api.browser.browsingHistory({query: text || undefined, limit: 5}).catch(() => []);
    if (revision !== addressLookupRevision) return;

    const local = historyRows(history);
    const immediate = text ? [...local, ...searchRows(text, [])] : local;
    await showAddressRows(immediate, revision);
    if (!text || looksLikeAddress(text)) return;

    const suggestions = await api.browser.suggestions(text).catch(() => []);
    if (revision !== addressLookupRevision) return;
    await showAddressRows([...local, ...searchRows(text, suggestions)], revision);
  }

  function scheduleAddressRows(query: string, delay = 140): void {
    clearTimeout(addressLookupTimer);
    const revision = ++addressLookupRevision;
    addressLookupTimer = setTimeout(() => void loadAddressRows(query, revision), delay);
  }

  function closeAddressSuggestions(): void {
    clearTimeout(addressLookupTimer);
    addressLookupRevision += 1;
    addressSuggestionsOpen = false;
    addressRows = [];
    selectedAddressRow = -1;
  }

  function focusAddress(): void {
    watchDocumentFocus();
    addressInput.select();
    scheduleAddressRows('', 0);
  }

  function inputAddress(): void {
    addressDirty = true;
    scheduleAddressRows(draft);
  }

  function blurAddress(): void {
    stopWatchingFocus();
    closeAddressSuggestions();
  }

  function chooseAddressRow(row: AddressRow): void {
    const value = row.kind === 'history' ? row.value : resolveInput(row.value);
    draft = value;
    navigateAddress(value);
  }

  function handleAddressKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && addressSuggestionsOpen) {
      event.preventDefault();
      closeAddressSuggestions();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      if (event.key === 'Enter' && addressSuggestionsOpen && selectedAddressRow >= 0) {
        event.preventDefault();
        const row = addressRows[selectedAddressRow];
        if (row) chooseAddressRow(row);
      }
      return;
    }
    if (!addressRows.length) return;
    event.preventDefault();
    addressSuggestionsOpen = true;
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    selectedAddressRow = selectedAddressRow < 0
      ? (direction > 0 ? 0 : addressRows.length - 1)
      : (selectedAddressRow + direction + addressRows.length) % addressRows.length;
    void tick().then(() => {
      const row = document.getElementById(addressRowId(selectedAddressRow));
      if (!row || !addressList) return;
      const top = row.offsetTop;
      const bottom = top + row.offsetHeight;
      if (top < addressList.scrollTop) addressList.scrollTop = top;
      else if (bottom > addressList.scrollTop + addressList.clientHeight)
        addressList.scrollTop = bottom - addressList.clientHeight;
    });
  }

  /** "Search or enter address" semantics: URLs load, anything else searches. */
  function resolveInput(value: string): string {
    const text = value.trim();
    if (/^https?:\/\//i.test(text)) return text;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(text)) return `https://${text}`;
    return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
  }

  function navigateAddress(target: string): void {
    closeAddressSuggestions();
    addressDirty = false;
    addressInput?.blur();
    if (embedded) void api.browser.navigate(tabId, target);
    else if (url = target) onState({url});
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    navigateAddress(resolveInput(next));
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
    // Closing the menu is what un-hides the page. Wait for both the reactive
    // flush and the native visibility handoff, or the shot is of a hidden view.
    await tick();
    await visibilityChange;
    const entry = await api.browser.screenshot(tabId);
    if (entry) downloads = [entry, ...downloads.filter((existing) => existing.id !== entry.id)];
  }

  /** One popover at a time, and a click anywhere else closes them both. */
  function dismiss(event: MouseEvent): void {
    const target = event.target as Node;
    let closed = false;
    if (downloadsOpen && !downloadsWrapper?.contains(target)) {
      downloadsOpen = false;
      closed = true;
    }
    if (moreOpen && !moreWrapper?.contains(target)) {
      moreOpen = false;
      closed = true;
    }
    if (addressSuggestionsOpen && !addressForm?.contains(target)) closeAddressSuggestions();
    if (closed) popoverRevision += 1;
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
    // A tab with nothing loaded swallows every click without reporting one,
    // which used to leave the address bar holding the caret. Keeping the view
    // out of the way until a page exists hands those clicks to the DOM.
    const rect = pageLoaded ? box : {x: box.x, y: box.y, width: 0, height: 0};
    const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (key === lastBounds) return;
    lastBounds = key;
    void api.browser.setBounds(tabId, {x: rect.x, y: rect.y, width: rect.width, height: rect.height});
  }

  onMount(() => {
    if (!embedded) return;
    // The answer is the tab's live page. A tab the agent opened finished
    // loading before this pane existed, so its state events are already spent:
    // asking is the only way to learn there is a page behind the view, and
    // without it the empty state sits over a loaded page for good.
    const initialSurface = surface.getBoundingClientRect();
    void api.browser.open(tabId, url || undefined, {
      width: initialSurface.width,
      height: initialSurface.height,
    }).then((page) => {
      if (!page.url) return;
      pageLoaded = true;
      currentUrl = page.url;
      if (!addressDirty && document.activeElement !== addressInput) draft = page.url;
      onState({title: page.title || undefined, url: page.url});
    });
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
      } else if (event.type === 'permission' && event.prompt.tabId === tabId) {
        permissionPrompt = event.prompt;
        rememberPermission = false;
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
    popoverRevision += 1;
    visibilityRevision += 1;
    addressLookupRevision += 1;
    clearTimeout(addressLookupTimer);
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
    <button type="button" aria-label={$t('browser.back')} disabled={!canGoBack} onclick={() => goHistory(-1)}><Icon name="back" size={16}/></button>
    <button type="button" aria-label={$t('browser.forward')} disabled={!canGoForward} onclick={() => goHistory(1)}><Icon name="forward" size={16}/></button>
    <button type="button" class:refreshing class="refresh-button" aria-label={$t('browser.refresh')} aria-busy={refreshing} onclick={reload}><Icon name="reload" size={16}/></button>
  </div>

  <form bind:this={addressForm} class="address-form" onsubmit={submit}>
    <input
      bind:this={addressInput}
      bind:value={draft}
      oninput={inputAddress}
      onfocus={focusAddress}
      onblur={blurAddress}
      onkeydown={handleAddressKey}
      role="combobox"
      aria-autocomplete="list"
      aria-controls={addressSuggestionsOpen ? `browser-address-suggestions-${tabId || 'preview'}` : undefined}
      aria-expanded={addressSuggestionsOpen}
      aria-activedescendant={selectedAddressRow >= 0 ? addressRowId(selectedAddressRow) : undefined}
      aria-label={$t('browser.address')}
      placeholder={$t('browser.addressPlaceholder')}
      spellcheck="false"
      autocomplete="off"
    />
    <button type="submit" class="address-submit" aria-label={$t('browser.navigate')} data-tooltip="none"><Icon name="send" size={16}/></button>
    {#if addressSuggestionsOpen}
      <div
        bind:this={addressList}
        id={`browser-address-suggestions-${tabId || 'preview'}`}
        class="address-suggestions"
        role="listbox"
        aria-label={$t('browser.addressSuggestions')}
      >
        {#each addressRows as row, index (row.id)}
          {#if index === 0 || addressRows[index - 1]?.kind !== row.kind}
            <div class="address-suggestions-label">
              {$t(row.kind === 'history' ? 'browser.recentlyVisited' : 'browser.searchSuggestions')}
            </div>
          {/if}
          <button
            id={addressRowId(index)}
            type="button"
            class="address-suggestion"
            class:selected={selectedAddressRow === index}
            role="option"
            aria-selected={selectedAddressRow === index}
            onmousedown={(event) => event.preventDefault()}
            onmousemove={() => selectedAddressRow = index}
            onclick={() => chooseAddressRow(row)}
          >
            <span class="address-suggestion-icon"><Icon name={row.kind === 'history' ? 'history' : 'search'} size={15}/></span>
            <span class="address-suggestion-copy">
              <strong>{row.title}</strong>
              <small>{row.detail}</small>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </form>

  <div class="browser-actions browser-page-actions">
    <div bind:this={downloadsWrapper} class="workspace-downloads-wrap">
      <button type="button" class:active={downloadsOpen} aria-label={$t('browser.downloads')} aria-haspopup="dialog" aria-expanded={downloadsOpen} onclick={() => void togglePopover('downloads')}><Icon name="download" size={16}/></button>
      {#if downloadsOpen}
        <div class="downloads-popover" role="dialog" aria-labelledby="downloads-title">
          <header>
            <h2 id="downloads-title">{$t('browser.downloads')}</h2>
            <button type="button" aria-label={$t('browser.showDownloads')} disabled={!embedded} onclick={() => void api.browser.openDownloadsFolder()}><Icon name="folder" size={17}/></button>
          </header>
          <div class="download-rows">
            {#each downloads as entry (entry.id)}
              <button type="button" class="download-row" onclick={() => void api.browser.openDownload(entry.id)}>
                <span class="download-mark"><Icon name={downloadIcon(entry)} size={16}/></span>
                <span class="download-copy"><strong>{entry.title}</strong><small>{$t('browser.downloaded')}{entry.completedAt ? ` · ${entry.completedAt}` : ''}</small></span>
              </button>
            {:else}
              <p class="downloads-empty">{$t('browser.downloadsEmpty')}</p>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div bind:this={moreWrapper} class="workspace-more-wrap">
      <button type="button" aria-label={$t('browser.more')} data-tooltip-align="end" aria-haspopup="menu" aria-expanded={moreOpen} onclick={() => void togglePopover('more')}><Icon name="more" size={16}/></button>
      {#if moreOpen}
        <div class="polymux-dropdown-menu workspace-more-menu" role="menu">
          <button type="button" class="polymux-dropdown-item" role="menuitem" disabled={!embedded || !pageLoaded} onclick={openFind}><span>{$t('browser.findInPage')}</span></button>
          <button type="button" class="polymux-dropdown-item" role="menuitem" disabled={!embedded || !pageLoaded} onclick={() => { moreOpen = false; void api.browser.print(tabId); }}><span>{$t('browser.print')}</span></button>
          <button type="button" class="polymux-dropdown-item" role="menuitem" disabled={!embedded || !pageLoaded} onclick={() => void takeScreenshot()}><span>{$t('browser.screenshot')}</span></button>
          <div class="workspace-menu-divider"></div>
          <button type="button" class="polymux-dropdown-item" role="menuitem" disabled={!currentUrl && !url} onclick={() => { moreOpen = false; void api.browser.openExternal(currentUrl || url || ''); }}><span>{$t('browser.openExternal')}</span></button>
        </div>
      {/if}
    </div>
  </div>
</div>

{#if permissionPrompt}
  <!-- In the chrome rather than over the page: the page is a WebContentsView
       the compositor puts above the renderer's DOM, so an overlay on the
       surface would be behind it. -->
  <div class="browser-permission" role="alertdialog" aria-label={promptText(permissionPrompt)}>
    <Icon name="info" size={14}/>
    <span class="browser-permission-text">{promptText(permissionPrompt)}</span>
    <label class="browser-permission-remember">
      <input type="checkbox" bind:checked={rememberPermission}/>
      <span>{$t('browser.rememberDecision')}</span>
    </label>
    <button type="button" onclick={() => answerPermission('deny')}>{$t('browser.deny')}</button>
    <button type="button" class="primary" onclick={() => answerPermission('allow')}>
      {$t('browser.allow')}
    </button>
  </div>
{/if}

{#if findOpen}
  <form class="browser-find" onsubmit={submitFind}>
    <input bind:value={findQuery} aria-label={$t('browser.findInPage')} placeholder={$t('browser.findInPage')} spellcheck="false"/>
    {#if findMatches}<span class="browser-find-count">{findMatches.matches ? `${findMatches.activeMatch}/${findMatches.matches}` : $t('browser.noMatches')}</span>{/if}
    <button type="submit" disabled={!findQuery.trim()} aria-label={$t('browser.findNext')}><Icon name="forward" size={14}/></button>
    <button type="button" aria-label={$t('browser.closeFind')} onclick={closeFind}><Icon name="close" size={14}/></button>
  </form>
{/if}

{#if embedded}
  <!-- The page renders in a WebContentsView the main process pins to this
       surface's rectangle. Nothing is drawn here: a tab with no page yet shows
       the pane's own background, never a card over the page. -->
  <div bind:this={surface} class="browser-frame browser-surface">
    {#if pagePreview}<img class="browser-page-preview" src={pagePreview} alt="" aria-hidden="true" draggable="false"/>{/if}
  </div>
{:else if url}
  <iframe class="browser-frame" src={url} title={title || $t('browser.title')} sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
{:else}
  <div class="browser-frame"></div>
{/if}
