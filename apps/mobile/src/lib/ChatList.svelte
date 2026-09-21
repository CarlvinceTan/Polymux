<script lang="ts">
  import {onMount, tick} from 'svelte';
  import type {BotDto} from '@polymux/protocol';
  import type {JsonValue} from '@polymux/protocol';
  import Icon from './Icon.svelte';
  import VaultScreen from './VaultScreen.svelte';
  import PlatformLogo, {type Platform} from './PlatformLogo.svelte';
  import PolymuxMark from './PolymuxMark.svelte';
  import TeamAvatar from './TeamAvatar.svelte';
  import NotificationsControl from './NotificationsControl.svelte';
  import type {SavedConnection} from './host';
  export let connection: SavedConnection | null = null;

  type Destination = {
    kind: 'assistant' | 'team' | 'hub';
    conversationId: string;
    title: string;
    subtitle: string;
    preview: string;
    updatedAt: string;
    unreadCount: number;
    member: BotDto | null;
    platform: string | null;
    avatarUrl: string | null;
  };

  type AppTab = 'assistant' | 'team' | 'hub' | 'vault' | 'settings';
  type HubPlatformOption = {id: string; label: string; platform: string | null};
  const platforms = new Set<Platform>([
    'whatsapp', 'telegram', 'signal', 'slack', 'messenger', 'instagram',
    'linkedin', 'googlechat', 'gmessages', 'twitter', 'bluesky', 'gvoice', 'zulip',
    'imessage', 'wechat', 'matrix', 'mail',
  ]);
  const platformLabels: Partial<Record<Platform, string>> = {
    whatsapp: 'WhatsApp', telegram: 'Telegram', signal: 'Signal',
    slack: 'Slack', messenger: 'Messenger', instagram: 'Instagram', linkedin: 'LinkedIn',
    googlechat: 'Google Chat', gmessages: 'Google Messages', twitter: 'X', bluesky: 'Bluesky',
    gvoice: 'Google Voice', zulip: 'Zulip', imessage: 'iMessage', wechat: 'WeChat',
    matrix: 'Matrix', mail: 'Mail',
  };
  // Fit each path rather than merely matching its SVG canvas. Hub is optically
  // reduced because its broad bubble top carries more visual mass.
  // The adjusted strokes all resolve to the same 1.3125px rendered weight.
  const appBarIconMetrics = {
    assistant: {viewBox: '0.25 0 24 24', strokeWidth: 1.5},
    team: {viewBox: '2 2.5 20 20', strokeWidth: 1.25},
    hub: {viewBox: '0.864954 1.864954 22.270091 22.270091', strokeWidth: 1.391881},
    vault: {viewBox: '0 0 24 24', strokeWidth: 1.5},
    settings: {viewBox: '-2.666667 -2.666667 29.333333 29.333333', strokeWidth: 1.833333},
  } as const;

  export let destinations: Destination[] = [];
  export let selected = '';
  export let connectionName = 'Polymux Host';
  export let online = false;
  export let syncing = false;
  export let onSelect: (conversationId: string) => Promise<void>;
  export let onNewChat: () => Promise<void>;
  export let onDisconnect: () => Promise<void>;
  export let vaultCall: (method: string, args?: JsonValue[]) => Promise<unknown>;

  let creating = false;
  let activeTab: AppTab = 'hub';
  let hubPlatform = 'all';
  let platformMenuOpen = false;
  let query = '';
  let searchInput: HTMLInputElement;
  let list: HTMLElement;
  let platformPicker: HTMLElement;
  let atTop = true;
  let atBottom = true;
  let brokenAvatars = new Set<string>();

  $: connectionLabel = syncing && !online ? 'Connecting' : online ? 'Connected' : 'Offline';
  $: hubPlatformOptions = buildHubPlatformOptions(destinations);
  $: if (hubPlatform !== 'all' && !hubPlatformOptions.some((option) => option.id === hubPlatform))
    hubPlatform = 'all';
  $: activeHubPlatform = hubPlatformOptions.find((option) => option.id === hubPlatform) ?? hubPlatformOptions[0];
  $: pageTitle = activeTab === 'settings'
    ? 'Settings'
    : activeTab === 'vault'
      ? 'Vault'
      : activeTab === 'assistant'
        ? 'Assistant'
        : activeTab === 'team'
          ? 'Team'
          : activeHubPlatform?.label ?? 'All Platforms';
  $: searchPlaceholder = activeTab === 'hub'
    ? hubPlatform === 'all' ? 'Search conversations' : `Search ${pageTitle}`
    : 'Search chats';
  $: tabDestinations = destinations.filter((destination) =>
    destination.kind === activeTab && (activeTab !== 'hub' || hubPlatform === 'all' || destination.platform === hubPlatform),
  );
  $: searchTerm = query.trim().toLocaleLowerCase();
  $: visibleDestinations = searchTerm
    ? tabDestinations.filter((destination) =>
        `${destination.title} ${destination.subtitle} ${destination.preview} ${destination.platform ?? ''}`
          .toLocaleLowerCase().includes(searchTerm),
      )
    : tabDestinations;

  onMount(() => {
    const observer = new ResizeObserver(measureListEdges);
    const closePlatformMenu = (event: PointerEvent) => {
      if (platformMenuOpen && platformPicker && !platformPicker.contains(event.target as Node))
        platformMenuOpen = false;
    };
    document.addEventListener('pointerdown', closePlatformMenu);
    void tick().then(() => {
      measureListEdges();
      if (list) observer.observe(list);
    });
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', closePlatformMenu);
    };
  });

  function measureListEdges(): void {
    if (!list) return;
    atTop = list.scrollTop <= 1;
    atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
  }

  async function createChat(): Promise<void> {
    if (creating || !online) return;
    creating = true;
    try {
      await onNewChat();
    } finally {
      creating = false;
    }
  }

  function selectTab(tab: AppTab): void {
    activeTab = tab;
    platformMenuOpen = false;
    query = '';
    void tick().then(measureListEdges);
  }

  function selectHubPlatform(id: string): void {
    hubPlatform = id;
    platformMenuOpen = false;
    query = '';
    void tick().then(() => {
      if (list) list.scrollTop = 0;
      measureListEdges();
    });
  }

  function buildHubPlatformOptions(items: Destination[]): HubPlatformOption[] {
    const ids = [...new Set(items
      .filter((item) => item.kind === 'hub' && item.platform)
      .map((item) => item.platform!))];
    return [
      {id: 'all', label: 'All Platforms', platform: null},
      ...ids.map((id) => ({id, label: platformLabel(id), platform: id})),
    ];
  }

  function platformLabel(value: string): string {
    return platformLabels[value as Platform]
      ?? value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
  }

  function clearSearch(): void {
    query = '';
    searchInput?.focus();
  }

  function when(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const now = new Date();
    if (date.toDateString() === now.toDateString())
      return date.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit', hour12: true});
    if (date.getFullYear() === now.getFullYear())
      return date.toLocaleDateString([], {day: 'numeric', month: 'short'});
    return date.toLocaleDateString([], {month: 'short', year: 'numeric'});
  }

  function unreadLabel(count: number): string {
    return count > 99 ? '99+' : String(count);
  }

  function memberDetail(member: BotDto): string {
    const status = member.status === 'working'
      ? 'Working'
      : member.status === 'waiting-for-device'
        ? 'Waiting for laptop access'
        : member.status === 'computer-offline'
          ? 'Computer offline'
          : member.status === 'error'
            ? member.computer.detail || 'Needs attention'
            : member.preview || member.role;
    return [member.role, member.hostName, status !== member.role ? status : ''].filter(Boolean).join(' · ');
  }

  function platform(value: string | null): Platform {
    return value && platforms.has(value as Platform) ? value as Platform : 'matrix';
  }

  function avatarInitial(name: string): string {
    return name.trim().charAt(0).toLocaleUpperCase() || '?';
  }

  function markAvatarBroken(id: string): void {
    brokenAvatars = new Set([...brokenAvatars, id]);
  }
</script>

<section class="chat-list-pane" aria-labelledby="chats-title">
  <header class="chat-list-header">
    <span class="header-spacer" aria-hidden="true"></span>
    {#if activeTab === 'hub'}
      <div class="platform-picker" bind:this={platformPicker}>
        <h1 id="chats-title">
          <button
            class:open={platformMenuOpen}
            class="platform-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded={platformMenuOpen}
            aria-controls="hub-platform-menu"
            on:click={() => platformMenuOpen = !platformMenuOpen}
          >
            <span>{pageTitle}</span><Icon name="chevron" size={15} strokeWidth={1.5} />
          </button>
        </h1>
        {#if platformMenuOpen}
          <div id="hub-platform-menu" class="platform-menu" role="menu" aria-label="Hub platform">
            {#each hubPlatformOptions as option (option.id)}
              <button
                type="button"
                class:selected={option.id === hubPlatform}
                role="menuitemradio"
                aria-checked={option.id === hubPlatform}
                on:click={() => selectHubPlatform(option.id)}
              >
                {#if option.platform}
                  <PlatformLogo platform={platform(option.platform)} size={20} />
                {:else}
                  <span class="all-platforms-mark" aria-hidden="true"><Icon name="platforms" size={18} strokeWidth={1.5} /></span>
                {/if}
                <span>{option.label}</span>
                {#if option.id === hubPlatform}<Icon name="check" size={15} strokeWidth={1.5} />{/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <h1 id="chats-title">{pageTitle}</h1>
    {/if}
    {#if activeTab === 'settings' || activeTab === 'vault'}
      <span class="header-spacer" aria-hidden="true"></span>
    {:else}
      <button class="header-button" type="button" disabled={!online || creating} on:click={createChat} aria-label="New Assistant chat">
        <Icon name="plus" size={21} strokeWidth={1.5} />
      </button>
    {/if}
  </header>

  {#if activeTab !== 'settings' && activeTab !== 'vault'}
    <div class="search-wrap">
      <div class="search-field">
        <Icon name="search" size={17} strokeWidth={1.5} />
        <input bind:this={searchInput} bind:value={query} type="search" placeholder={searchPlaceholder} aria-label={searchPlaceholder} autocomplete="off" autocapitalize="none" spellcheck="false" />
        {#if query}
          <button type="button" on:click={clearSearch} aria-label="Clear search"><Icon name="close" size={15} strokeWidth={1.5} /></button>
        {/if}
      </div>
    </div>
  {/if}

  {#if activeTab === 'vault'}
    <VaultScreen {online} call={vaultCall} />
  {:else if activeTab === 'settings'}
    <section class="settings-view" aria-label="Settings">
      <h2>Connection</h2>
      <div class="settings-row"><span>Host</span><strong>{connectionName}</strong></div>
      <div class="settings-row"><span>Status</span><strong>{connectionLabel}</strong></div>
      {#if connection}<NotificationsControl {connection} />{/if}
      <button class="disconnect-button" type="button" on:click={onDisconnect}>Disconnect this mobile</button>
    </section>
  {:else if visibleDestinations.length && activeTab === 'assistant'}
    <nav bind:this={list} class:at-top={atTop} class:at-bottom={atBottom} class="scrolling-list assistant-list" aria-label="Assistant chats" on:scroll={measureListEdges}>
      {#each visibleDestinations as destination (destination.conversationId)}
        <button type="button" class:selected={destination.conversationId === selected} class="assistant-chat-row" on:click={() => onSelect(destination.conversationId)}>
          <span>{destination.title}</span><time datetime={destination.updatedAt}>{when(destination.updatedAt)}</time>
        </button>
      {/each}
    </nav>
  {:else if visibleDestinations.length}
    <nav bind:this={list} class:at-top={atTop} class:at-bottom={atBottom} class="scrolling-list compact-chat-list" aria-label={pageTitle} on:scroll={measureListEdges}>
      {#each visibleDestinations as destination (destination.conversationId)}
        <button type="button" class:selected={destination.conversationId === selected} class:unread={destination.unreadCount > 0} class="compact-chat-row" on:click={() => onSelect(destination.conversationId)}>
          <span class="compact-avatar-wrap">
            {#if destination.member}
              <TeamAvatar avatar={destination.member.avatar} name={destination.member.name} size={40} />
              <i class:working={destination.member.status === 'working'} class:error={destination.member.status === 'error'} aria-hidden="true"></i>
            {:else}
              {#if destination.avatarUrl && !brokenAvatars.has(destination.conversationId)}
                <img src={destination.avatarUrl} alt="" loading="lazy" on:error={() => markAvatarBroken(destination.conversationId)} />
              {:else}
                <span class="hub-avatar-fallback" aria-hidden="true">{avatarInitial(destination.title)}</span>
              {/if}
              <span class="platform-badge" aria-hidden="true"><PlatformLogo platform={platform(destination.platform)} size={14} /></span>
            {/if}
          </span>
          <span class="compact-chat-copy">
            <span class="compact-chat-top"><strong>{destination.title}</strong><time datetime={destination.updatedAt}>{when(destination.updatedAt)}</time></span>
            <span class="compact-chat-bottom">
              <span>{destination.member ? memberDetail(destination.member) : destination.preview}</span>
              {#if destination.unreadCount > 0}<b aria-label={`${destination.unreadCount} unread`}>{unreadLabel(destination.unreadCount)}</b>{/if}
            </span>
          </span>
        </button>
      {/each}
    </nav>
  {:else}
    <div class="chat-list-empty">
      {#if searchTerm}
        <Icon name="search" size={42} strokeWidth={1.45} /><h2>No matches</h2>
      {:else if activeTab === 'team'}
        <Icon name="team" size={42} strokeWidth={1.45} /><h2>No bots yet</h2>
      {:else if activeTab === 'hub'}
        <Icon name="hub" size={42} strokeWidth={1.45} /><h2>No conversations</h2>
      {:else}
        <PolymuxMark size={54} /><h2>No chats yet</h2>
        <button type="button" disabled={!online || creating} on:click={createChat}>Start a chat</button>
      {/if}
    </div>
  {/if}

  <nav class="app-bar" aria-label="Primary">
    <button class:active={activeTab === 'assistant'} class="app-tab" type="button" on:click={() => selectTab('assistant')} aria-current={activeTab === 'assistant' ? 'page' : undefined}><Icon name="assistant" size={21} {...appBarIconMetrics.assistant} /><span>Assistant</span></button>
    <button class:active={activeTab === 'team'} class="app-tab" type="button" on:click={() => selectTab('team')} aria-current={activeTab === 'team' ? 'page' : undefined}><Icon name="team" size={21} {...appBarIconMetrics.team} /><span>Team</span></button>
    <button class:active={activeTab === 'hub'} class="app-tab" type="button" on:click={() => selectTab('hub')} aria-current={activeTab === 'hub' ? 'page' : undefined}><Icon name="hub" size={21} {...appBarIconMetrics.hub} /><span>Hub</span></button>
    <button class:active={activeTab === 'vault'} class="app-tab" type="button" on:click={() => selectTab('vault')} aria-current={activeTab === 'vault' ? 'page' : undefined}><Icon name="key" size={21} {...appBarIconMetrics.vault} /><span>Vault</span></button>
    <button class:active={activeTab === 'settings'} class="app-tab" type="button" on:click={() => selectTab('settings')} aria-current={activeTab === 'settings' ? 'page' : undefined}><Icon name="settings" size={21} {...appBarIconMetrics.settings} /><span>Settings</span></button>
  </nav>
</section>

<style>
  .chat-list-pane { width: 100%; height: 100dvh; min-height: 0; flex-direction: column; overflow: hidden; background: var(--surface); }
  .chat-list-header { min-height: calc(env(safe-area-inset-top) + 64px); display: grid; grid-template-columns: 52px 1fr 52px; align-items: center; padding: env(safe-area-inset-top) 10px 0; }
  .header-button, .header-spacer { width: 48px; height: 48px; display: grid; place-items: center; }
  .header-button { border: 0; background: transparent; color: var(--ink); }
  .header-button:active { color: var(--muted); }
  .header-button:disabled { color: var(--muted-soft); opacity: .55; }
  h1 { height: 48px; display: grid; place-items: center; margin: 0; text-align: center; font-size: 1.0625rem; line-height: 1.2; letter-spacing: -.018em; }
  .platform-picker { position: relative; z-index: 6; min-width: 0; max-width: calc(100% - 22px); justify-self: center; }
  .platform-trigger { position: relative; min-width: 0; max-width: 100%; min-height: 48px; display: grid; place-items: center; border: 0; padding: 0; background: transparent; color: var(--ink); font: inherit; font-weight: 700; letter-spacing: inherit; }
  .platform-trigger > span { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .platform-trigger :global(svg) { position: absolute; top: 50%; right: -18px; color: var(--muted); transform: translateY(-50%); transform-box: fill-box; transform-origin: center; }
  .platform-trigger.open :global(svg) { transform: translateY(-50%) rotate(180deg); }
  .platform-menu { position: absolute; z-index: 10; top: 46px; left: 50%; width: min(220px, calc(100vw - 36px)); max-height: min(320px, calc(100dvh - 150px)); overflow-y: auto; transform: translateX(-50%); border-radius: 14px; padding: 5px; background: var(--field); box-shadow: 0 10px 28px rgba(0, 0, 0, .2); scrollbar-width: none; }
  .platform-menu::-webkit-scrollbar { display: none; }
  .platform-menu > button { width: 100%; min-height: 44px; display: grid; grid-template-columns: 22px minmax(0, 1fr) 18px; align-items: center; gap: 8px; border: 0; border-radius: 10px; padding: 0 9px; background: transparent; color: var(--ink); text-align: left; }
  .platform-menu > button:active, .platform-menu > button.selected { background: var(--row-active); }
  .platform-menu > button > span:not(.all-platforms-mark) { overflow: hidden; font-size: .8125rem; font-weight: 580; text-overflow: ellipsis; white-space: nowrap; }
  .all-platforms-mark { width: 20px; height: 20px; display: grid; place-items: center; color: var(--muted); }
  .platform-menu > button > :global(svg:last-child) { justify-self: end; }
  .search-wrap { flex: none; padding: 2px 18px 10px; }
  .search-field { min-height: 42px; display: flex; align-items: center; gap: 8px; border: 1px solid transparent; border-radius: 12px; padding: 0 3px 0 12px; background: var(--bubble); color: var(--muted-soft); }
  .search-field:focus-within { border-color: color-mix(in srgb, var(--accent) 62%, transparent); outline: 3px solid color-mix(in srgb, var(--accent) 14%, transparent); }
  .search-field input { min-width: 0; flex: 1; border: 0; outline: 0; padding: 0; background: transparent; color: var(--ink); font: inherit; font-size: 1rem; line-height: 1.25; }
  .search-field input::placeholder { color: var(--muted-soft); opacity: 1; }
  .search-field input::-webkit-search-cancel-button { display: none; }
  .search-field button { width: 40px; height: 40px; flex: none; display: grid; place-items: center; border: 0; border-radius: 10px; padding: 0; background: transparent; color: var(--muted); }
  .search-field button:active { color: var(--ink); }
  .search-field button:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 46%, transparent); outline-offset: -4px; }
  .scrolling-list { --mask-top: transparent; --mask-bottom: transparent; min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 2px 8px 12px; scrollbar-width: none; -webkit-mask-image: linear-gradient(to bottom, var(--mask-top), #000 12px, #000 calc(100% - 12px), var(--mask-bottom)); mask-image: linear-gradient(to bottom, var(--mask-top), #000 12px, #000 calc(100% - 12px), var(--mask-bottom)); }
  .scrolling-list.at-top { --mask-top: #000; }
  .scrolling-list.at-bottom { --mask-bottom: #000; }
  .scrolling-list::-webkit-scrollbar { display: none; }
  .assistant-chat-row { position: relative; width: 100%; min-height: 48px; display: flex; align-items: center; gap: 10px; border: 0; border-radius: 10px; padding: 0 10px; background: transparent; color: var(--ink); text-align: left; }
  .assistant-chat-row::after, .compact-chat-row::after { content: ''; position: absolute; right: 10px; bottom: 0; left: 10px; height: 1px; background: var(--line); pointer-events: none; }
  .assistant-chat-row:last-child::after, .compact-chat-row:last-child::after { display: none; }
  .assistant-chat-row:active, .assistant-chat-row.selected, .compact-chat-row:active, .compact-chat-row.selected { background: var(--row-active); }
  .assistant-chat-row > span { min-width: 0; flex: 1; overflow: hidden; font-size: .875rem; font-weight: 520; text-overflow: ellipsis; white-space: nowrap; }
  time { flex: none; color: var(--muted-soft); font-size: .6875rem; font-variant-numeric: tabular-nums; }
  .compact-chat-row { position: relative; width: 100%; min-height: 64px; display: flex; align-items: center; gap: 10px; border: 0; border-radius: 10px; padding: 8px 10px; background: transparent; color: var(--ink); text-align: left; }
  .compact-avatar-wrap { position: relative; width: 42px; height: 42px; flex: 0 0 42px; display: grid; place-items: center; }
  .compact-avatar-wrap > img, .hub-avatar-fallback { width: 40px; height: 40px; display: grid; place-items: center; overflow: hidden; border-radius: 11px; background: var(--bubble); object-fit: cover; color: var(--muted); font-size: .8125rem; font-weight: 600; }
  .compact-avatar-wrap > i { position: absolute; right: 0; bottom: 0; width: 8px; height: 8px; box-sizing: border-box; border: 2px solid var(--surface); border-radius: 50%; background: var(--muted-soft); }
  .compact-avatar-wrap > i.working { background: var(--success); }
  .compact-avatar-wrap > i.error { background: var(--danger); }
  .platform-badge { position: absolute; right: -1px; bottom: -1px; width: 14px; height: 14px; display: block; border: 2px solid var(--surface); border-radius: 5px; background: var(--surface); }
  .compact-chat-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
  .compact-chat-top, .compact-chat-bottom { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .compact-chat-top strong { min-width: 0; flex: 1; overflow: hidden; font-size: .875rem; font-weight: 560; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
  .compact-chat-bottom { min-height: 17px; }
  .compact-chat-bottom > span { min-width: 0; flex: 1; overflow: hidden; color: var(--muted); font-size: .75rem; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
  .compact-chat-row.unread .compact-chat-top strong { font-weight: 650; }
  .compact-chat-bottom > b { min-width: 17px; height: 17px; display: grid; place-items: center; flex: none; border-radius: 9px; padding: 0 5px; background: var(--ink); color: var(--surface); font-size: .59375rem; font-weight: 650; line-height: 1; }
  .chat-list-empty { min-height: 0; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 28px 24px 60px; color: var(--muted-soft); text-align: center; }
  .chat-list-empty h2 { margin: 18px 0 14px; color: var(--ink); font-size: 1.125rem; letter-spacing: -.025em; }
  .chat-list-empty button { min-height: 48px; border: 0; padding: 0 12px; background: transparent; color: var(--ink); font: inherit; font-weight: 650; }
  .settings-view { min-height: 0; flex: 1; overflow-y: auto; padding: 24px 18px; scrollbar-width: none; }
  .settings-view::-webkit-scrollbar { display: none; }
  .settings-view h2 { margin: 0 0 8px; color: var(--muted); font-size: .75rem; font-weight: 650; letter-spacing: .01em; }
  .settings-row { min-height: 52px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--line); font-size: .875rem; }
  .settings-row strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .disconnect-button { min-height: 48px; margin-top: 16px; border: 0; padding: 0; background: transparent; color: var(--danger); font: inherit; font-size: .875rem; font-weight: 650; }
  .app-bar { position: relative; min-height: calc(env(safe-area-inset-bottom) + 64px); display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); padding: 5px 8px calc(env(safe-area-inset-bottom) + 3px); background: var(--surface); }
  .app-bar::before { content: ''; position: absolute; top: 0; right: 16px; left: 16px; height: 1px; background: var(--line); }
  .app-tab { position: relative; min-width: 0; min-height: 52px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; border: 0; padding: 0 4px; background: transparent; color: var(--muted-soft); }
  .app-tab:active, .app-tab.active { color: var(--ink); }
  .app-tab:focus-visible { outline: 0; }
  .app-tab:focus-visible::after { content: ''; position: absolute; top: 3px; left: 50%; width: 34px; height: 31px; transform: translateX(-50%); border: 2px solid color-mix(in srgb, var(--accent) 45%, transparent); border-radius: 10px; pointer-events: none; }
  .app-tab span { overflow: hidden; max-width: 100%; font-size: .625rem; font-weight: 550; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
  .app-tab.active span { font-weight: 700; }
  @media (min-width: 700px) { .chat-list-pane { border-right: 1px solid var(--line); } }
</style>
