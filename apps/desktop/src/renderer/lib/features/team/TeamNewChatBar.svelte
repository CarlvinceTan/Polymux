{#snippet Shortcut(props: {commandKey: string; shortcut: number})}
  <span class="team-new-chat-shortcut" aria-hidden="true">
    <span class="team-new-chat-command">{props.commandKey}</span>
    <kbd>{props.shortcut}</kbd>
  </span>
{/snippet}

<svelte:window on:pointerdown={onWindowPointerDown} on:keydown={onWindowKeydown}/>

<header bind:this={bar} class="conversation-title-bar team-new-chat-bar">
  <div class="team-new-chat-field">
    <span class="team-new-chat-to">{$t('team.to')}</span>
    {#each selected as member (member.id)}
      <span class="team-new-chat-chip">
        <TeamAvatar avatar={member.avatar} expression="neutral" activity="idle" size={18} animated={false} centerSilhouette paper="var(--app-surface)" label={avatarLabel(member)}/>
        <span class="team-new-chat-chip-name">{member.name}</span>
        <button type="button" aria-label={`${$t('team.remove')} ${member.name}`} data-tooltip="none" onclick={() => removeMember(member.id)}><Icon name="close" size={11} strokeWidth={2}/></button>
      </span>
    {/each}
    <input
      bind:this={input}
      bind:value={query}
      class="team-new-chat-input"
      type="text"
      placeholder={$t('team.searchOrCreate')}
      aria-label={groupMode ? $t('team.searchOrCreateGroup') : $t('team.searchOrCreate')}
      autocomplete="off"
      spellcheck="false"
      oninput={clearActive}
    />
  </div>
  <span class="team-new-chat-exit-wrap">
    <button type="button" class="team-new-chat-exit" aria-label={$t('team.close')} data-tooltip="none" onclick={onClose}><Icon name="close" size={16}/></button>
  </span>

  <div class="team-new-chat-menu" role="group" aria-label={groupMode ? $t('team.chooseMembers') : $t('team.newChat')} onmouseleave={clearActive}>
    <div bind:this={menuList} class="team-new-chat-list" use:scrollFade>
      {#each rows as row, index (rowKey(row))}
        {@const shortcut = shortcutFor(index)}
        {#if row.kind === 'new-bot'}
          <button type="button" class="team-new-chat-row" data-active={activeIndex === index} aria-label={$t('team.createNewBot')} aria-keyshortcuts={shortcut ? `${commandKey}+${shortcut}` : undefined} onclick={() => onCreateBot('')}>
            <span class="team-new-chat-mark"><Icon name="plus" size={17}/></span>
            <span class="team-new-chat-name">{$t('team.createNewBot')}</span>
            {#if shortcut}{@render Shortcut({commandKey, shortcut})}{/if}
          </button>
        {:else if row.kind === 'new-group'}
          <button type="button" class="team-new-chat-row" data-active={activeIndex === index} aria-label={$t('team.createGroupChat')} aria-keyshortcuts={shortcut ? `${commandKey}+${shortcut}` : undefined} onclick={startGroup}>
            <span class="team-new-chat-mark"><Icon name="users" size={17}/></span>
            <span class="team-new-chat-name">{$t('team.createGroupChat')}</span>
            {#if shortcut}{@render Shortcut({commandKey, shortcut})}{/if}
          </button>
        {:else if row.kind === 'create-named'}
          <button type="button" class="team-new-chat-row" data-active={activeIndex === index} aria-label={$t('team.createBotNamed', {name: row.name})} onclick={() => onCreateBot(row.name)}>
            <span class="team-new-chat-mark"><Icon name="user-plus" size={17}/></span>
            <span class="team-new-chat-name">{$t('team.createBotNamed', {name: row.name})}</span>
            {#if shortcut}{@render Shortcut({commandKey, shortcut})}{/if}
          </button>
        {:else}
          <button
            type="button"
            class="team-new-chat-row"
            data-active={activeIndex === index}
            aria-label={groupMode ? `${$t('team.add')} ${row.bot.name}` : `${$t('team.open')} ${row.bot.name}`}
            aria-keyshortcuts={shortcut ? `${commandKey}+${shortcut}` : undefined}
            onclick={() => choose(row)}
          >
            <TeamAvatar avatar={row.bot.avatar} expression={bloubExpressionForTeamStatus(row.bot.status, row.bot.preview)} activity={bloubActivityForTeamStatus(row.bot.status)} size={30} animated={false} paper="var(--app-surface)" label={avatarLabel(row.bot)}/>
            <span class="team-new-chat-name">{row.bot.name}</span>
            {#if shortcut}{@render Shortcut({commandKey, shortcut})}{/if}
          </button>
        {/if}
      {/each}

      {#if !rows.some((row) => row.kind === 'bot')}
        <p class="team-new-chat-empty" role="status">
          {#if bots.length === 0}{$t('team.noBotsYet')}{:else}{$t('team.noBotsFound')}{/if}
        </p>
      {/if}
      {#if groupMode && selectedIds.length === 1}
        <p class="team-new-chat-hint" role="status">{$t('team.chooseAtLeastTwo')}</p>
      {/if}
    </div>
  </div>
</header>

<script lang="ts">
  import type {BotDto} from '@polymux/protocol';
  import {onMount, tick} from 'svelte';
  import {scrollFade} from '../../shared/scrollFade';
  import Icon from '../../shared/components/Icon.svelte';
  import {t} from '../../../i18n';
  import TeamAvatar from './TeamAvatar.svelte';
  import {bloubActivityForTeamStatus, bloubExpressionForTeamStatus} from './bloub/expression';

  /** The drawer's + opens this instead of a dialog: a To: bar in the same chrome
   * the conversation title uses, with the bot chooser hanging under it. */
  export let bots: BotDto[] = [];
  export let onOpenBot: (id: string) => void = () => {};
  /** A bot named for the query, or the placeholder name when there is none. */
  export let onCreateBot: (name: string) => void = () => {};
  export let onCreateGroup: (memberIds: string[]) => void = () => {};
  export let onClose: () => void = () => {};

  type Row =
    | {kind: 'new-bot'}
    | {kind: 'new-group'}
    | {kind: 'bot'; bot: BotDto}
    | {kind: 'create-named'; name: string};

  let bar: HTMLElement;
  let input: HTMLInputElement;
  let menuList: HTMLElement;
  let query = '';
  let groupMode = false;
  let selectedIds: string[] = [];
  let activeIndex: number | null = null;
  /** Focus goes back to the control that opened the bar, but only when the band
   * was dismissed rather than used to go somewhere. */
  let opener: HTMLElement | null = null;
  let restoreFocus = true;
  const commandKey = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';

  $: needle = query.trim().toLowerCase();
  $: matched = (needle
    ? bots.filter((member) => member.name.toLowerCase().includes(needle))
    : bots
  ).slice().sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  $: selected = selectedIds.flatMap((id) => bots.find((member) => member.id === id) ?? []);
  $: available = groupMode ? matched.filter((member) => !selectedIds.includes(member.id)) : matched;
  $: exactMatch = needle ? bots.find((member) => member.name.toLowerCase() === needle) : undefined;
  $: showCreateNamed = !groupMode && Boolean(query.trim()) && !exactMatch;
  // Stated inline rather than in a helper: the rows have to recompute from the
  // query, the mode and the selection, and a `$:` call to a function sees none
  // of those.
  $: rows = groupMode
    ? available.map((bot): Row => ({kind: 'bot', bot}))
    : [
      {kind: 'new-bot'} as Row,
      {kind: 'new-group'} as Row,
      ...matched.map((bot): Row => ({kind: 'bot', bot})),
      ...(showCreateNamed ? [{kind: 'create-named', name: query.trim()} as Row] : []),
    ];
  $: if (activeIndex !== null && activeIndex >= rows.length) activeIndex = null;

  function rowKey(row: Row): string {
    if (row.kind === 'bot') return `bot:${row.bot.id}`;
    if (row.kind === 'create-named') return `named:${row.name}`;
    return row.kind;
  }

  function shortcutFor(index: number): number | null {
    return index < 9 ? index + 1 : null;
  }

  onMount(() => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => input?.focus());
    return () => { if (restoreFocus) opener?.focus(); };
  });

  function addMember(id: string): void {
    if (!selectedIds.includes(id)) selectedIds = [...selectedIds, id];
    query = '';
    clearActive();
    void tick().then(() => {
      input?.focus();
      if (menuList) menuList.scrollTop = 0;
    });
  }

  function removeMember(id: string): void {
    selectedIds = selectedIds.filter((memberId) => memberId !== id);
  }

  function choose(row: Row): void {
    restoreFocus = false;
    if (row.kind === 'new-bot') onCreateBot('');
    else if (row.kind === 'new-group') startGroup();
    else if (row.kind === 'create-named') onCreateBot(row.name);
    else if (groupMode) addMember(row.bot.id);
    else onOpenBot(row.bot.id);
  }

  function startGroup(): void {
    groupMode = true;
    query = '';
    clearActive();
    void tick().then(() => input?.focus());
  }

  function leaveGroup(): void {
    groupMode = false;
    selectedIds = [];
    clearActive();
    void tick().then(() => input?.focus());
  }

  /** Enter commits the field: in group mode that is the new group once two bots
   * are picked; otherwise it opens an exact match or creates one named for the
   * query. */
  function primaryAction(): void {
    if (groupMode) {
      if (selectedIds.length >= 2) {
        restoreFocus = false;
        onCreateGroup(selectedIds);
      }
      return;
    }
    if (!needle) return;
    restoreFocus = false;
    if (exactMatch) onOpenBot(exactMatch.id);
    else onCreateBot(query.trim());
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (event.target instanceof Node && bar?.contains(event.target)) return;
    restoreFocus = false;
    onClose();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (groupMode) leaveGroup();
      else onClose();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && /^[1-9]$/.test(event.key)) {
      const row = rows[Number(event.key) - 1];
      if (row) {
        event.preventDefault();
        choose(row);
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!rows.length) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = activeIndex === null
        ? (step > 0 ? 0 : rows.length - 1)
        : (activeIndex + step + rows.length) % rows.length;
      void tick().then(() => menuList?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({block: 'nearest'}));
      return;
    }
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      if (activeIndex !== null) {
        const row = rows[activeIndex];
        clearActive();
        if (row) choose(row);
        return;
      }
      primaryAction();
    }
  }

  function clearActive(): void {
    activeIndex = null;
  }

  function avatarLabel(member: BotDto): string {
    return `${member.name} avatar`;
  }
</script>

<style>
  /* Same fixed chrome as the conversation title: it stands in for that bar
     while the chooser is open, so the field and the exit sit exactly where the
     conversation identity does. */
  .team-new-chat-bar{display:flex;align-items:center;gap:8px;box-sizing:border-box;padding:0 10px 0 16px;overflow:visible;pointer-events:auto;-webkit-app-region:drag}
  :global(main:not(.chat-drawer-open)) .team-new-chat-bar{padding-left:calc(var(--chrome-inset) + 88px)}
  .team-new-chat-field{min-width:0;display:flex;align-items:center;flex:1;gap:6px;overflow-x:auto;scrollbar-width:none}
  .team-new-chat-field::-webkit-scrollbar{display:none}
  .team-new-chat-to{flex:none;color:var(--neutral-500);font-size:13px;font-weight:450;-webkit-app-region:no-drag}
  .team-new-chat-input{min-width:120px;flex:1;border:0;padding:0;background:transparent;color:var(--neutral-950);font:inherit;font-size:13px;outline:0;-webkit-app-region:no-drag}
  .team-new-chat-input::placeholder{color:var(--neutral-400)}
  .team-new-chat-chip{min-width:0;max-width:220px;height:26px;display:flex;align-items:center;gap:5px;flex:none;border:1px solid var(--neutral-200);border-radius:13px;padding:0 3px 0 4px;background:var(--app-surface);color:var(--neutral-800);font-size:12px;-webkit-app-region:no-drag}
  .team-new-chat-chip-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .team-new-chat-chip button{width:20px;height:20px;display:grid;place-items:center;flex:none;border:0;border-radius:50%;padding:0;background:transparent;color:var(--neutral-500);cursor:pointer}
  .team-new-chat-chip button:hover{color:var(--neutral-900)}
  .team-new-chat-exit-wrap{flex:none;display:flex;-webkit-app-region:no-drag}
  .team-new-chat-exit{width:30px;height:30px;display:grid;place-items:center;border:0;border-radius:8px;padding:0;background:transparent;color:var(--neutral-600);cursor:pointer}
  .team-new-chat-exit:hover{color:var(--neutral-950)}
  .team-new-chat-bar :global(button:focus-visible){outline:2px solid var(--focus-ring);outline-offset:-2px}
  /* The field reads as bare text with a caret, the way the search fields do;
     a ring around the whole remaining width would read as a box in the bar. */
  .team-new-chat-bar :global(input:focus-visible){outline:none}

  /* Hung off the bar rather than the window, so it starts at the bar's left
     edge and never leaves the content column. */
  .team-new-chat-menu{position:absolute;top:100%;left:0;width:min(1120px,100%);max-height:min(568px,calc(100vh - var(--app-topbar-height) - 16px));box-sizing:border-box;display:flex;flex-direction:column;margin-top:2px;overflow:hidden;border:1px solid var(--neutral-200);border-radius:16px;background:var(--app-surface);box-shadow:0 20px 60px rgba(0,0,0,.26);pointer-events:auto;-webkit-app-region:no-drag}
  .team-new-chat-list{min-height:0;flex:1;overflow-y:auto;padding:6px;scrollbar-width:none}
  .team-new-chat-list::-webkit-scrollbar{display:none}
  .team-new-chat-row{width:100%;min-height:44px;display:flex;align-items:center;gap:12px;border:0;border-radius:11px;padding:6px 12px;background:transparent;color:var(--neutral-900);font:inherit;cursor:pointer;text-align:left}
  .team-new-chat-row:hover,.team-new-chat-row[data-active="true"]{background:var(--neutral-100)}
  .team-new-chat-mark{width:30px;height:30px;display:grid;place-items:center;flex:none;border-radius:50%;background:var(--neutral-100);color:var(--neutral-700)}
  .team-new-chat-row:hover .team-new-chat-mark,.team-new-chat-row[data-active="true"] .team-new-chat-mark{background:var(--neutral-200)}
  .team-new-chat-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--neutral-950);font-size:13.5px;font-weight:500}
  .team-new-chat-shortcut{display:flex;align-items:center;gap:5px;flex:none;color:var(--neutral-500)}
  .team-new-chat-command{font-size:12.5px;line-height:1}
  .team-new-chat-shortcut kbd{min-width:20px;height:20px;display:grid;place-items:center;box-sizing:border-box;border-radius:6px;background:var(--neutral-100);color:var(--neutral-600);font-family:inherit;font-size:11px;font-weight:500}
  .team-new-chat-row:hover .team-new-chat-shortcut kbd,.team-new-chat-row[data-active="true"] .team-new-chat-shortcut kbd{background:var(--neutral-200)}
  .team-new-chat-empty{margin:0;padding:22px 12px;text-align:center;color:var(--neutral-400);font-size:12px}
  .team-new-chat-hint{margin:0;padding:8px 12px 4px;color:var(--neutral-500);font-size:11px}
  @media (max-width:640px){.team-new-chat-menu{width:100%}}
  /* At this width the drawer is a slide-over that is wider than the width the
     layout reports, so the bar re-anchors to the window and clears the drawer
     rather than starting under it. */
  @media (max-width:972px){
    :global(main.chat-drawer-open) .team-new-chat-bar{left:0;padding-left:calc(min(320px,100vw - 42px) + 16px)}
    :global(main.chat-drawer-open) .team-new-chat-menu{left:min(320px,100vw - 42px);width:calc(100% - min(320px,100vw - 42px))}
    /* Summary is an overlay at this width rather than a column, so the band
       keeps the whole window instead of half of it. */
    :global(main.panel-open) .team-new-chat-bar{right:0}
  }
</style>
