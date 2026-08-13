<script module lang="ts">
  export type HistoryChat = {
    id: string;
    title: string;
    updatedAt?: string | number | Date;
  };

  export type HistoryGroupLabel = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Previous 30 days' | 'Older';
</script>

<script lang="ts">
  import {tick} from 'svelte';

  export let chats: HistoryChat[] = [];
  export let activeId = '';
  export let open = false;
  export let width = 280;
  export let minWidth = 220;
  export let maxWidth = 420;
  export let onOpen: (id: string) => void = () => {};
  export let onRename: (id: string, title: string) => void = () => {};
  export let onDelete: (id: string) => void = () => {};
  export let onResize: (width: number) => void = () => {};
  export let onResizeState: (resizing: boolean) => void = () => {};
  export let onToggle: () => void = () => {};
  export let onNewChat: () => void = () => {};

  let drawer: HTMLElement;
  let menuId: string | null = null;
  let menuTop = 0;
  let editingId: string | null = null;
  let draft = '';
  let renameInput: HTMLInputElement;
  let resizing = false;
  let collapsedSections = new Set<HistoryGroupLabel>();

  $: historyGroups = groupChatsByRecency(chats);

  function chatDate(chat: HistoryChat): Date {
    const date = chat.updatedAt ? new Date(chat.updatedAt) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function startOfDay(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function labelFor(chat: HistoryChat): HistoryGroupLabel {
    const ageDays = Math.floor((startOfDay(new Date()) - startOfDay(chatDate(chat))) / 86_400_000);
    if (ageDays <= 0) return 'Today';
    if (ageDays === 1) return 'Yesterday';
    if (ageDays <= 7) return 'Previous 7 days';
    if (ageDays <= 30) return 'Previous 30 days';
    return 'Older';
  }

  function groupChatsByRecency(source: HistoryChat[]) {
    const labels: HistoryGroupLabel[] = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'];
    const sorted = [...source].sort((a, b) => chatDate(b).getTime() - chatDate(a).getTime());
    return labels.flatMap((label) => {
      const groupedChats = sorted.filter((chat) => labelFor(chat) === label);
      return groupedChats.length ? [{label, chats: groupedChats}] : [];
    });
  }

  function toggleSection(label: HistoryGroupLabel): void {
    const next = new Set(collapsedSections);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    collapsedSections = next;
    menuId = null;
  }

  function clampWidth(next: number): number {
    return Math.min(maxWidth, Math.max(minWidth, next));
  }

  function resizeFromPointer(clientX: number): void {
    onResize(clampWidth(clientX));
  }

  function startResize(event: PointerEvent): void {
    if (window.innerWidth < 700) return;
    resizing = true;
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
    resizing = false;
    onResizeState(false);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  function resizeWithKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const delta = event.key === 'ArrowRight' ? 16 : -16;
    onResize(clampWidth(drawer.getBoundingClientRect().width + delta));
    event.preventDefault();
  }

  function toggleMenu(event: MouseEvent, id: string): void {
    event.stopPropagation();
    if (menuId === id) {
      menuId = null;
      return;
    }
    const triggerRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const drawerRect = drawer.getBoundingClientRect();
    menuTop = triggerRect.bottom - drawerRect.top + 4;
    menuId = id;
  }

  async function startRename(chat: HistoryChat): Promise<void> {
    menuId = null;
    editingId = chat.id;
    draft = chat.title;
    await tick();
    renameInput.focus();
    renameInput.select();
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
    if (event instanceof MouseEvent && (event.target as Element).closest('.history-more,.history-row-menu')) return;
    menuId = null;
  }
</script>

<svelte:window onclick={dismiss} onkeydown={dismiss}/>

<aside
  bind:this={drawer}
  class:open
  class:resizing
  class="history-drawer"
  style:--history-drawer-width={`${width}px`}
  aria-label="History"
  aria-hidden={!open}
  inert={!open}
>
  <button
    type="button"
    class="history-resize-handle"
    aria-label="Resize History"
    tabindex={open ? 0 : -1}
    onpointerdown={startResize}
    onpointermove={dragResize}
    onpointerup={stopResize}
    onpointercancel={stopResize}
    onkeydown={resizeWithKeyboard}
  ></button>

  {#if open}
    <div class="history-titlebar">
      <div class="history-titlebar-actions">
        <button type="button" aria-label="Hide History" onclick={onToggle}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M7 4v12"/></svg>
        </button>
        <button type="button" aria-label="New chat" onclick={onNewChat}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4 3v-3.5A2.5 2.5 0 0 1 4 11.5z"/><path d="M10 6v5M7.5 8.5h5"/></svg>
        </button>
      </div>
    </div>
  {/if}

  <h2>History</h2>

  {#if historyGroups.length}
    <div class="history-groups" onscroll={() => menuId = null}>
      {#each historyGroups as group (group.label)}
        <section class="history-group">
          <button
            class:collapsed={collapsedSections.has(group.label)}
            class="history-group-toggle"
            type="button"
            aria-expanded={!collapsedSections.has(group.label)}
            onclick={() => toggleSection(group.label)}
          >
            <span>{group.label}</span>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>
          </button>

          {#if !collapsedSections.has(group.label)}
            <ul aria-label={group.label}>
              {#each group.chats as chat (chat.id)}
                <li>
                  {#if editingId === chat.id}
                    <div class="history-edit">
                      <input
                        bind:this={renameInput}
                        bind:value={draft}
                        aria-label={`Rename ${chat.title}`}
                        onkeydown={(event) => renameKeydown(event, chat.id)}
                        onblur={() => saveRename(chat.id)}
                      />
                    </div>
                  {:else}
                    <div class:active={chat.id === activeId} class:menu-open={menuId === chat.id} class="history-row">
                      <button
                        class="history-open"
                        type="button"
                        aria-label={`Open chat: ${chat.title}`}
                        aria-current={chat.id === activeId ? 'page' : undefined}
                        onclick={() => onOpen(chat.id)}
                        ondblclick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void startRename(chat);
                        }}
                        title={chat.title}
                      ><span>{chat.title}</span></button>
                      <button
                        class="history-more"
                        type="button"
                        aria-label={`More actions: ${chat.title}`}
                        aria-haspopup="menu"
                        aria-expanded={menuId === chat.id}
                        onclick={(event) => toggleMenu(event, chat.id)}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="5" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="15" cy="10" r="1"/></svg>
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
    <p class="history-empty">History will appear here.</p>
  {/if}

  {#if menuId}
    {@const menuChat = chats.find((chat) => chat.id === menuId)}
    {#if menuChat}
      <div class="history-row-menu" role="menu" style:top={`${menuTop}px`}>
        <button role="menuitem" onclick={() => startRename(menuChat)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5 3 3-8 8H4.5v-3z"/><path d="m11 6 3 3"/></svg><span>Rename</span>
        </button>
        <button class="destructive" role="menuitem" onclick={() => deleteChat(menuChat.id)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10M8 6V4h4v2m-6 0 1 11h6l1-11M9 9v5m2-5v5"/></svg><span>Delete</span>
        </button>
      </div>
    {/if}
  {/if}
</aside>

<style>
  .history-drawer {
    position: fixed;
    z-index: 105;
    inset: 0 auto 0 0;
    width: var(--history-drawer-width, 280px);
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: visible;
    padding: 0 10px 14px;
    background: var(--neutral-50, #fafafa);
    pointer-events: none;
    transform: translateX(-100%);
    visibility: hidden;
    will-change: transform;
    transition: transform 220ms ease, visibility 0s linear 220ms;
  }

  .history-drawer.open {
    pointer-events: auto;
    transform: translateX(0);
    visibility: visible;
    transition-delay: 0s;
  }

  .history-resize-handle {
    position: absolute;
    z-index: 80;
    inset: 0 -8px 0 auto;
    width: 17px;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: col-resize;
    touch-action: none;
  }

  .history-resize-handle::after {
    content: '';
    position: absolute;
    inset: 0 8px 0 auto;
    width: 1px;
    background: var(--neutral-200, #e5e5e5);
    transition: background-color 160ms ease, box-shadow 200ms ease;
  }

  .history-resize-handle:hover::after,
  .history-resize-handle:focus-visible::after,
  .resizing .history-resize-handle::after {
    background: var(--neutral-400, #a3a3a3);
    box-shadow: -4px 0 10px rgb(26 28 28 / 11%);
  }

  .history-resize-handle:focus-visible { outline: none; }

  .history-titlebar {
    height: 50px;
    flex: none;
    margin: 0 -10px 0;
    display: flex;
    align-items: center;
    border-bottom: 1px solid rgb(0 0 0 / 9%);
    padding: 0 10px 0 88px;
    -webkit-app-region: drag;
  }

  .history-titlebar-actions { display: flex; align-items: center; gap: 4px; -webkit-app-region: no-drag; }
  .history-titlebar-actions button { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 9px; padding: 0; background: transparent; color: var(--neutral-500, #737373); cursor: pointer; }
  .history-titlebar-actions button:hover,
  .history-titlebar-actions button:focus-visible { outline: none; background: var(--neutral-100, #f5f5f5); color: var(--neutral-900, #171717); }
  .history-titlebar-actions svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }

  h2 {
    align-self: flex-start;
    margin: 18px 10px 11px;
    color: var(--neutral-950, #0a0a0a);
    font-size: 15px;
    font-weight: 600;
  }

  .history-groups { min-height: 0; flex: 1; overflow-y: auto; scrollbar-width: none; }
  .history-groups::-webkit-scrollbar { display: none; }
  .history-group + .history-group { margin-top: 8px; }

  .history-group-toggle {
    width: 100%;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border: 0;
    padding: 0 8px;
    background: transparent;
    color: var(--neutral-500, #737373);
    cursor: pointer;
    font: inherit;
    font-size: 12.5px;
    font-weight: 580;
    text-align: left;
  }

  .history-group-toggle:hover,
  .history-group-toggle:focus-visible { outline: none; color: var(--neutral-900, #171717); }
  .history-group-toggle svg { transition: transform 150ms ease; }
  .history-group-toggle.collapsed svg { transform: rotate(-90deg); }

  ul { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
  li { margin: 0; padding: 0; }

  .history-row,
  .history-edit {
    width: 100%;
    min-height: 34px;
    display: flex;
    align-items: center;
    border-radius: 10px;
    background: transparent;
    color: var(--neutral-950, #0a0a0a);
    transition: background-color 150ms ease;
  }

  .history-row:hover,
  .history-row:has(:focus-visible) { background: rgb(217 217 217 / 60%); }
  .history-row.active { background: var(--neutral-300, #d4d4d4); }

  .history-open {
    min-width: 0;
    min-height: 34px;
    display: flex;
    flex: 1;
    align-items: center;
    border: 0;
    padding: 7px 0 7px 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .history-open:focus-visible { outline: none; }
  .history-open > span { min-width: 0; flex: 1; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }

  .history-more {
    width: 0;
    height: 20px;
    display: grid;
    flex: none;
    place-items: center;
    overflow: hidden;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--neutral-400, #a3a3a3);
    opacity: 0;
    cursor: pointer;
    transition: width 140ms ease, margin 140ms ease, opacity 120ms ease;
  }

  .history-row:hover .history-more,
  .history-row:has(:focus-visible) .history-more,
  .history-row.menu-open .history-more { width: 20px; margin: 0 7px 0 6px; opacity: 1; }
  .history-more:hover, .history-more:focus-visible { outline: none; color: var(--neutral-950, #0a0a0a); }

  .history-edit { padding: 7px 10px; }
  .history-edit input { width: 100%; min-width: 0; border: 0; padding: 0; outline: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; }

  .history-row-menu {
    position: absolute;
    z-index: 90;
    right: 10px;
    width: 144px;
    padding: 4px;
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 4px 12px rgb(0 0 0 / 8%);
    outline: 1px solid rgb(236 236 236 / 80%);
  }

  .history-row-menu button {
    width: 100%;
    min-height: 30px;
    display: flex;
    align-items: center;
    gap: 7px;
    border: 0;
    border-radius: 8px;
    padding: 7px 8px;
    background: transparent;
    color: var(--neutral-700, #404040);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }

  .history-row-menu button:hover { background: var(--neutral-50, #fafafa); color: var(--neutral-950, #0a0a0a); }
  .history-row-menu .destructive { color: #b42318; }
  .history-row-menu .destructive:hover { background: #fff1f0; color: #8f1d15; }
  .history-empty { margin: 8px 10px; color: var(--neutral-400, #a3a3a3); font-size: 12px; line-height: 1.5; }

  svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .history-more svg circle { fill: currentColor; stroke: none; }

  @media (max-width: 699px) {
    .history-drawer { width: min(320px, calc(100vw - 42px)); box-shadow: 14px 0 34px rgb(26 28 28 / 10%); }
    .history-resize-handle { display: none; }
  }
</style>
