<script module lang="ts">
  export type ChatEntry = {
    id: string;
    title: string;
    updatedAt: number;
  };
</script>

<script lang="ts">
  import {tick} from 'svelte';
  import {groupChatsByRecency, type ChatHistoryGroupLabel} from '../../conversation/chatSessions';
  import {SPLIT_LAYOUT_MIN_WIDTH, clampPanelWidth, chatDrawerResizeBounds} from '../../layout/layoutSizing';
  import Icon from '../shared/Icon.svelte';
  import {t, type MessageKey} from '../../i18n';

  /** The group label doubles as the section's identity — which sections are
   * collapsed is keyed by it — so it stays an English constant and only the
   * wording on screen comes from the catalog. */
  const groupLabels: Record<ChatHistoryGroupLabel, MessageKey> = {
    'Today': 'chats.today',
    'Yesterday': 'chats.yesterday',
    'This week': 'chats.thisWeek',
    'Last week': 'chats.lastWeek',
    'This month': 'chats.thisMonth',
    'Last month': 'chats.lastMonth',
    'Earlier': 'chats.earlier',
  };

  export let chats: ChatEntry[] = [];
  export let activeId = '';
  export let open = false;
  export let width = 280;
  export let resizing = false;
  export let reservedWidth = 0;
  export let onOpen: (id: string) => void = () => {};
  export let onRename: (id: string, title: string) => void = () => {};
  export let onDelete: (id: string) => void = () => {};
  export let onResize: (width: number) => void = () => {};
  export let onResizeState: (resizing: boolean) => void = () => {};

  let drawer: HTMLElement;
  let menuId: string | null = null;
  let menuTop = 0;
  let editingId: string | null = null;
  let draft = '';
  let renameInput: HTMLInputElement;
  let collapsedSections = new Set<ChatHistoryGroupLabel>();
  let sectionsInitialised = false;

  $: chatGroups = groupChatsByRecency(chats);
  // The drawer opens showing only the most recent group, so the newest chats
  // are readable without scrolling. This runs once per launch, as soon as the
  // chat list has loaded; from then on the sections keep whatever the user set.
  $: if (!sectionsInitialised && chatGroups.length) {
    collapsedSections = new Set(chatGroups.slice(1).map((group) => group.label));
    sectionsInitialised = true;
  }

  function toggleSection(label: ChatHistoryGroupLabel): void {
    const next = new Set(collapsedSections);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    collapsedSections = next;
    menuId = null;
  }

  function resizeFromPointer(clientX: number): void {
    onResize(clampPanelWidth(clientX, chatDrawerResizeBounds(window.innerWidth, reservedWidth)));
  }

  function startResize(event: PointerEvent): void {
    if (window.innerWidth < SPLIT_LAYOUT_MIN_WIDTH) return;
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
    const delta = event.key === 'ArrowRight' ? 16 : -16;
    onResize(clampPanelWidth(drawer.getBoundingClientRect().width + delta, chatDrawerResizeBounds(window.innerWidth, reservedWidth)));
    event.preventDefault();
  }

  function toggleMenu(event: MouseEvent, id: string): void {
    event.stopPropagation();
    if (menuId === id) {
      menuId = null;
      return;
    }
    const trigger = event.currentTarget as HTMLElement;
    const triggerRect = trigger.getBoundingClientRect();
    const drawerRect = drawer.getBoundingClientRect();
    menuTop = triggerRect.bottom - drawerRect.top + 4;
    menuId = id;
  }

  async function startRename(chat: ChatEntry): Promise<void> {
    menuId = null;
    editingId = chat.id;
    draft = chat.title;
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }

  function saveRename(id: string): void {
    if (editingId !== id) return;
    const title = draft.trim();
    editingId = null;
    if (title) onRename(id, title);
  }

  function renameKeydown(event: KeyboardEvent, id: string): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveRename(id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      editingId = null;
    }
  }

  function deleteChat(id: string): void {
    menuId = null;
    onDelete(id);
  }

  function dismiss(event: MouseEvent | KeyboardEvent): void {
    if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
    if (event instanceof MouseEvent && (event.target as Element).closest('.chat-drawer-more,.chat-drawer-row-menu')) return;
    menuId = null;
  }
</script>

<svelte:window onclick={dismiss} onkeydown={dismiss}/>

<!-- The drawer keeps its resting width while closed and slides in as a finished
     sheet, so its contents never relayout mid-animation. `inert` while closed
     keeps it out of the tab order without needing a separate mount. -->
<aside
  bind:this={drawer}
  class:open
  class:resizing
  class="chat-drawer"
  style:--chat-drawer-panel-width={`${width}px`}
  aria-label={$t('titlebar.chats')}
  aria-hidden={!open}
  inert={!open}
>
  <button
    type="button"
    class="chat-drawer-resize-handle"
    aria-label={$t('chats.resize')}
    tabindex={open ? 0 : -1}
    data-tooltip="none"
    onpointerdown={startResize}
    onpointermove={dragResize}
    onpointerup={stopResize}
    onpointercancel={stopResize}
    onkeydown={resizeWithKeyboard}
  ></button>
  <h2>{$t('titlebar.chats')}</h2>

  {#if chatGroups.length}
    <div class="chat-drawer-groups" onscroll={() => menuId = null}>
      {#each chatGroups as group (group.label)}
        <section class="chat-drawer-group">
          <button
            class:collapsed={collapsedSections.has(group.label)}
            class="chat-drawer-group-toggle"
            type="button"
            aria-expanded={!collapsedSections.has(group.label)}
            onclick={() => toggleSection(group.label)}
          >
            <span>{$t(groupLabels[group.label])}</span>
            <Icon name="chevron" size={16}/>
          </button>
          {#if !collapsedSections.has(group.label)}
            <ul aria-label={$t(groupLabels[group.label])}>
              {#each group.chats as chat (chat.id)}
                <li>
                  {#if editingId === chat.id}
                    <div class="chat-drawer-edit">
                      <input
                        bind:this={renameInput}
                        bind:value={draft}
                        aria-label={$t('chats.rename', {title: chat.title})}
                        onkeydown={(event) => renameKeydown(event, chat.id)}
                        onblur={() => saveRename(chat.id)}
                      />
                    </div>
                  {:else}
                    <div class:active={chat.id === activeId} class:menu-open={menuId === chat.id} class="chat-drawer-row">
                      <button
                        class="chat-drawer-open-chat"
                        type="button"
                        aria-label={$t('chats.openChat', {title: chat.title})}
                        aria-current={chat.id === activeId ? 'page' : undefined}
                        title={chat.title}
                        onclick={() => onOpen(chat.id)}
                        ondblclick={(event) => { event.preventDefault(); event.stopPropagation(); void startRename(chat); }}
                      >
                        <span>{chat.title}</span>
                      </button>
                      <button
                        class="chat-drawer-more"
                        type="button"
                        aria-label={$t('chats.moreActions', {title: chat.title})}
                        data-tooltip="none"
                        aria-haspopup="menu"
                        aria-expanded={menuId === chat.id}
                        onclick={(event) => toggleMenu(event, chat.id)}
                      >
                        <Icon name="ellipsis" size={16}/>
                      </button>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
    </div>
  {:else}
    <p class="chat-drawer-empty">{$t('chats.empty')}</p>
  {/if}

  {#if menuId}
    {@const menuChat = chats.find((chat) => chat.id === menuId)}
    {#if menuChat}
      <div class="flareai-dropdown-menu chat-drawer-row-menu" role="menu" style:top={`${menuTop}px`}>
        <button class="flareai-dropdown-item" role="menuitem" onclick={() => startRename(menuChat)}><Icon name="edit" size={14}/><span>{$t('common.rename')}</span></button>
        <button class="flareai-dropdown-item destructive" role="menuitem" onclick={() => deleteChat(menuChat.id)}><Icon name="trash" size={14}/><span>{$t('common.delete')}</span></button>
      </div>
    {/if}
  {/if}
</aside>
