<script module lang="ts">
  export type ChatEntry = {
    id: string;
    title: string;
    updatedAt: number;
    running?: boolean;
  };
</script>

<script lang="ts">
  import {onDestroy, onMount, tick} from 'svelte';
  import {groupChatsByRecency, sortChatsNewestFirst, type ChatHistoryGroupLabel} from './chatSessions';
  import {
    chatFoldersStorageKey,
    createChatFolder,
    deleteChatFolder,
    folderForChat,
    loadChatFolders,
    moveChatToFolder,
    renameChatFolder,
    toggleChatFolder,
    type ChatFolder,
  } from './chatFolders';
  import {MAIN_UI_ICON_SIZE, MAIN_UI_ICON_STROKE_WIDTH} from '../../shared/layout/iconSizing';
  import {SPLIT_LAYOUT_MIN_WIDTH, clampPanelWidth, chatDrawerResizeBounds} from '../../shared/layout/layoutSizing';
  import Icon from '../../shared/components/Icon.svelte';
  import {t, type MessageKey} from '../../../i18n';

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
  let menu: {kind: 'chat' | 'folder'; id: string} | null = null;
  let menuElement: HTMLDivElement | undefined;
  let menuAnchor:
    | {kind: 'trigger'; bottom: number}
    | {kind: 'point'; x: number; y: number}
    | null = null;
  let menuLeft = 0;
  let menuTop = 0;
  let menuPlaced = false;
  let editingId: string | null = null;
  let draft = '';
  let renameInput: HTMLInputElement;
  let creatingFolder = false;
  let editingFolderId: string | null = null;
  let folderDraft = '';
  let folderInput: HTMLInputElement;
  let folders: ChatFolder[] = loadChatFolders();
  let collapsedSections = new Set<ChatHistoryGroupLabel>();
  let sectionsInitialised = false;
  let pointerResizing = false;
  let pendingResizeX: number | null = null;
  let resizeFrame = 0;

  $: folderedChatIds = new Set(folders.flatMap((folder) => folder.chatIds));
  $: folderViews = folders.map((folder) => ({
    folder,
    chats: sortChatsNewestFirst(chats.filter((chat) => folder.chatIds.includes(chat.id))),
  }));
  $: chatGroups = groupChatsByRecency(chats.filter((chat) => !folderedChatIds.has(chat.id)));
  // The drawer opens showing only the most recent group, so the newest chats
  // are readable without scrolling. This runs once per launch, as soon as the
  // chat list has loaded; from then on the sections keep whatever the user set.
  $: if (!sectionsInitialised && chatGroups.length) {
    collapsedSections = new Set(chatGroups.slice(1).map((group) => group.label));
    sectionsInitialised = true;
  }

  onMount(() => {
    const syncFolders = (event: StorageEvent) => {
      if (event.key === chatFoldersStorageKey) folders = loadChatFolders();
    };
    window.addEventListener('storage', syncFolders);
    return () => window.removeEventListener('storage', syncFolders);
  });

  function toggleSection(label: ChatHistoryGroupLabel): void {
    const next = new Set(collapsedSections);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    collapsedSections = next;
    menu = null;
  }

  function resizeFromPointer(clientX: number): void {
    onResize(clampPanelWidth(clientX, chatDrawerResizeBounds(window.innerWidth, reservedWidth)));
  }

  /** Pointer events can arrive several times between paints. Keep the newest
   * sample and perform one layout update per frame so the divider follows the
   * pointer without making the rest of the shell repeatedly reflow. */
  function latestClientX(event: PointerEvent): number {
    const samples = event.getCoalescedEvents?.();
    return samples?.length ? samples[samples.length - 1].clientX : event.clientX;
  }

  function queuePointerResize(clientX: number): void {
    pendingResizeX = clientX;
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!pointerResizing || pendingResizeX === null) return;
      const nextX = pendingResizeX;
      pendingResizeX = null;
      resizeFromPointer(nextX);
    });
  }

  function flushPointerResize(clientX: number): void {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    pendingResizeX = null;
    resizeFromPointer(clientX);
  }

  function startResize(event: PointerEvent): void {
    if (window.innerWidth < SPLIT_LAYOUT_MIN_WIDTH) return;
    pointerResizing = true;
    onResizeState(true);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    flushPointerResize(latestClientX(event));
    event.preventDefault();
  }

  function dragResize(event: PointerEvent): void {
    if (!pointerResizing) return;
    queuePointerResize(latestClientX(event));
    event.preventDefault();
  }

  function stopResize(event: PointerEvent): void {
    if (!pointerResizing) return;
    flushPointerResize(latestClientX(event));
    pointerResizing = false;
    onResizeState(false);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  onDestroy(() => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
  });

  function resizeWithKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const delta = event.key === 'ArrowRight' ? 16 : -16;
    onResize(clampPanelWidth(drawer.getBoundingClientRect().width + delta, chatDrawerResizeBounds(window.innerWidth, reservedWidth)));
    event.preventDefault();
  }

  /** Places the rendered menu from its actual content-wrapped size. Folder
   * names are user data, so estimating from an old fixed width would either
   * leave a gap or put a longer menu outside the drawer. */
  function placeRowMenu(): void {
    if (!menu || !menuElement || !menuAnchor) return;
    const drawerRect = drawer.getBoundingClientRect();
    const {width, height} = menuElement.getBoundingClientRect();
    if (menuAnchor.kind === 'trigger') {
      menuLeft = Math.max(10, drawerRect.width - width - 10);
      menuTop = Math.max(8, Math.min(
        menuAnchor.bottom - drawerRect.top + 4,
        drawerRect.height - height - 10,
      ));
      menuPlaced = true;
      return;
    }
    const pointerX = menuAnchor.x - drawerRect.left;
    const pointerY = menuAnchor.y - drawerRect.top;
    const preferredLeft = menuAnchor.x + width <= window.innerWidth - 10
      ? pointerX
      : pointerX - width;
    const preferredTop = menuAnchor.y + height <= window.innerHeight - 10
      ? pointerY
      : pointerY - height;
    const minLeft = 10 - drawerRect.left;
    const maxLeft = window.innerWidth - drawerRect.left - width - 10;
    const minTop = 8 - drawerRect.top;
    const maxTop = window.innerHeight - drawerRect.top - height - 10;
    menuLeft = Math.max(minLeft, Math.min(preferredLeft, maxLeft));
    menuTop = Math.max(minTop, Math.min(preferredTop, maxTop));
    menuPlaced = true;
  }

  function toggleMenu(event: MouseEvent, kind: 'chat' | 'folder', id: string): void {
    event.stopPropagation();
    if (menu?.kind === kind && menu.id === id) {
      menu = null;
      return;
    }
    const triggerRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menuAnchor = {kind: 'trigger', bottom: triggerRect.bottom};
    menuPlaced = false;
    menu = {kind, id};
    void tick().then(placeRowMenu);
  }

  function openContextMenu(event: MouseEvent, kind: 'chat' | 'folder', id: string): void {
    event.preventDefault();
    event.stopPropagation();
    menuAnchor = {kind: 'point', x: event.clientX, y: event.clientY};
    menuPlaced = false;
    menu = {kind, id};
    void tick().then(placeRowMenu);
  }

  async function startRename(chat: ChatEntry): Promise<void> {
    menu = null;
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
    menu = null;
    onDelete(id);
  }

  async function startCreateFolder(): Promise<void> {
    menu = null;
    editingFolderId = null;
    creatingFolder = true;
    folderDraft = '';
    await tick();
    folderInput?.focus();
  }

  async function startRenameFolder(folder: ChatFolder): Promise<void> {
    menu = null;
    creatingFolder = false;
    editingFolderId = folder.id;
    folderDraft = folder.name;
    await tick();
    folderInput?.focus();
    folderInput?.select();
  }

  function saveFolder(): void {
    if (!creatingFolder) return;
    const name = folderDraft.trim();
    creatingFolder = false;
    if (name) folders = createChatFolder(folders, crypto.randomUUID(), name);
  }

  function saveFolderRename(id: string): void {
    if (editingFolderId !== id) return;
    const name = folderDraft.trim();
    editingFolderId = null;
    if (name) folders = renameChatFolder(folders, id, name);
  }

  function folderKeydown(event: KeyboardEvent, id: string | null): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (id) saveFolderRename(id); else saveFolder();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      creatingFolder = false;
      editingFolderId = null;
    }
  }

  function moveChat(chatId: string, folderId: string | null): void {
    folders = moveChatToFolder(folders, chatId, folderId);
    menu = null;
  }

  function removeFolder(id: string): void {
    folders = deleteChatFolder(folders, id);
    menu = null;
  }

  function dismiss(event: MouseEvent | KeyboardEvent): void {
    if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
    if (event instanceof MouseEvent && (event.target as Element).closest('.chat-drawer-more,.chat-drawer-row-menu')) return;
    menu = null;
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
  <div class="chat-drawer-heading">
    <h2>{$t('titlebar.chats')}</h2>
    <button
      type="button"
      class="chat-drawer-new-folder"
      aria-label={$t('chats.newFolder')}
      data-tooltip-label={$t('chats.newFolder')}
      onclick={startCreateFolder}
    ><Icon name="folder-plus" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/></button>
  </div>

  {#if folderViews.length || chatGroups.length || creatingFolder}
    <div class="chat-drawer-groups" onscroll={() => menu = null}>
      {#if creatingFolder}
        <div class="chat-drawer-folder-edit">
          <Icon name="folder" size={17}/>
          <input
            bind:this={folderInput}
            bind:value={folderDraft}
            aria-label={$t('chats.folderName')}
            placeholder={$t('chats.folderName')}
            onkeydown={(event) => folderKeydown(event, null)}
            onblur={saveFolder}
          />
        </div>
      {/if}

      {#if folderViews.length}
        <ul class="chat-drawer-folders" aria-label={$t('chats.folders')}>
          {#each folderViews as view (view.folder.id)}
            <li class="chat-drawer-folder">
              {#if editingFolderId === view.folder.id}
                <div class="chat-drawer-folder-edit">
                  <Icon name="folder" size={17}/>
                  <input
                    bind:this={folderInput}
                    bind:value={folderDraft}
                    aria-label={$t('chats.renameFolder', {name: view.folder.name})}
                    onkeydown={(event) => folderKeydown(event, view.folder.id)}
                    onblur={() => saveFolderRename(view.folder.id)}
                  />
                </div>
              {:else}
                <div
                  class:menu-open={menu?.kind === 'folder' && menu.id === view.folder.id}
                  class="chat-drawer-folder-row"
                  role="group"
                  oncontextmenu={(event) => openContextMenu(event, 'folder', view.folder.id)}
                >
                  <button
                    class="chat-drawer-folder-toggle"
                    type="button"
                    aria-expanded={!view.folder.collapsed}
                    aria-label={$t(view.folder.collapsed ? 'chats.expandFolder' : 'chats.collapseFolder', {name: view.folder.name})}
                    onclick={() => folders = toggleChatFolder(folders, view.folder.id)}
                    ondblclick={(event) => { event.preventDefault(); event.stopPropagation(); void startRenameFolder(view.folder); }}
                  >
                    <Icon name={view.folder.collapsed ? 'folder' : 'folder-open'} size={17}/>
                    <span>{view.folder.name}</span>
                  </button>
                  <button
                    class="chat-drawer-more"
                    type="button"
                    aria-label={$t('chats.folderActions', {name: view.folder.name})}
                    data-tooltip="none"
                    aria-haspopup="menu"
                    aria-expanded={menu?.kind === 'folder' && menu.id === view.folder.id}
                    onclick={(event) => toggleMenu(event, 'folder', view.folder.id)}
                  ><Icon name="ellipsis" size={16}/></button>
                </div>
              {/if}
              {#if !view.folder.collapsed && view.chats.length}
                <ul class="chat-drawer-folder-chats" aria-label={view.folder.name}>
                  {#each view.chats as chat (chat.id)}
                    <li>{@render chatRow(chat, true)}</li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

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
                <li>{@render chatRow(chat)}</li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
    </div>
  {:else}
    <p class="chat-drawer-empty">{$t('chats.empty')}</p>
  {/if}

  {#if menu?.kind === 'chat'}
    {@const menuChat = chats.find((chat) => chat.id === menu?.id)}
    {@const menuFolder = menuChat ? folderForChat(folders, menuChat.id) : undefined}
    {#if menuChat}
      <div bind:this={menuElement} class="polymux-dropdown-menu chat-drawer-row-menu" role="menu" style:left={`${menuLeft}px`} style:top={`${menuTop}px`} style:visibility={menuPlaced ? 'visible' : 'hidden'}>
        <button class="polymux-dropdown-item" role="menuitem" onclick={() => startRename(menuChat)}><Icon name="edit" size={14}/><span>{$t('common.rename')}</span></button>
        {#if folders.some((folder) => folder.id !== menuFolder?.id)}
          <span class="chat-drawer-menu-label">{$t('chats.moveToFolder')}</span>
          {#each folders as folder (folder.id)}
            {#if folder.id !== menuFolder?.id}
              <button class="polymux-dropdown-item" role="menuitem" onclick={() => moveChat(menuChat.id, folder.id)}><Icon name="folder" size={14}/><span>{folder.name}</span></button>
            {/if}
          {/each}
        {/if}
        {#if menuFolder}
          <button class="polymux-dropdown-item" role="menuitem" onclick={() => moveChat(menuChat.id, null)}><Icon name="folder-move" size={14}/><span>{$t('chats.removeFromFolder')}</span></button>
        {/if}
        <button class="polymux-dropdown-item destructive" role="menuitem" onclick={() => deleteChat(menuChat.id)}><Icon name="trash" size={14}/><span>{$t('common.delete')}</span></button>
      </div>
    {/if}
  {:else if menu?.kind === 'folder'}
    {@const menuFolder = folders.find((folder) => folder.id === menu?.id)}
    {#if menuFolder}
      <div bind:this={menuElement} class="polymux-dropdown-menu chat-drawer-row-menu" role="menu" style:left={`${menuLeft}px`} style:top={`${menuTop}px`} style:visibility={menuPlaced ? 'visible' : 'hidden'}>
        <button class="polymux-dropdown-item" role="menuitem" onclick={() => startRenameFolder(menuFolder)}><Icon name="edit" size={14}/><span>{$t('common.rename')}</span></button>
        <button class="polymux-dropdown-item destructive" role="menuitem" onclick={() => removeFolder(menuFolder.id)}><Icon name="trash" size={14}/><span>{$t('chats.deleteFolder')}</span></button>
      </div>
    {/if}
  {/if}
</aside>

{#snippet chatRow(chat: ChatEntry, nested = false)}
  {#if editingId === chat.id}
    <div class:nested class="chat-drawer-edit">
      <input
        bind:this={renameInput}
        bind:value={draft}
        aria-label={$t('chats.rename', {title: chat.title})}
        onkeydown={(event) => renameKeydown(event, chat.id)}
        onblur={() => saveRename(chat.id)}
      />
    </div>
  {:else}
    <div
      class:active={chat.id === activeId}
      class:menu-open={menu?.kind === 'chat' && menu.id === chat.id}
      class:running={chat.running}
      class:nested
      class="chat-drawer-row"
      role="group"
      oncontextmenu={(event) => openContextMenu(event, 'chat', chat.id)}
    >
      <button
        class="chat-drawer-open-chat"
        type="button"
        aria-label={$t('chats.openChat', {title: chat.title})}
        aria-current={chat.id === activeId ? 'page' : undefined}
        onclick={() => onOpen(chat.id)}
        ondblclick={(event) => { event.preventDefault(); event.stopPropagation(); void startRename(chat); }}
      ><span>{chat.title}</span></button>
      <span class="chat-drawer-row-action">
        {#if chat.running}<i class="chat-drawer-running-ring" role="status" aria-label={$t('chats.running', {title: chat.title})}></i>{/if}
        <button
          class="chat-drawer-more"
          type="button"
          aria-label={$t('chats.moreActions', {title: chat.title})}
          data-tooltip="none"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === 'chat' && menu.id === chat.id}
          onclick={(event) => toggleMenu(event, 'chat', chat.id)}
        ><Icon name="ellipsis" size={16}/></button>
      </span>
    </div>
  {/if}
{/snippet}
