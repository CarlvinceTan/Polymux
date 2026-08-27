<script lang="ts">
  import {afterUpdate, beforeUpdate, tick, type ComponentProps} from 'svelte';
  import {fade} from 'svelte/transition';
  import Icon from '../../shared/components/Icon.svelte';
  import OpenMenu, {type OpenAnchor, type OpenChoice} from '../../shared/components/OpenMenu.svelte';
  import {MAIN_UI_ICON_SIZE, MAIN_UI_ICON_STROKE_WIDTH, SETTINGS_ICON_SIZE, SETTINGS_ICON_STROKE_WIDTH} from '../../shared/layout/iconSizing';
  import type {PanelMode} from '../../shared/state/panels';
  import {t, type MessageKey} from '../../../i18n';

  type PinnedView = 'drive' | 'schedule' | 'hub' | 'tasks';
  type IconName = ComponentProps<typeof Icon>['name'];

  export let title = '';
  export let showTitle = false;
  export let showSummary = false;
  export let hideNewChat = false;
  export let showChatToggle = true;
  export let chatDrawerOpen = false;
  export let mode: PanelMode = 'none';
  export let onRename: (title: string) => void = () => {};
  export let onToggleChatDrawer: () => void = () => {};
  export let onNewChat: () => void = () => {};
  export let onSearchChats: () => void = () => {};
  export let onTogglePanel: (mode: 'summary' | 'workspace') => void = () => {};
  export let onOpenSettings: () => void = () => {};
  export let pinnedViews: Array<'drive' | 'schedule' | 'hub' | 'tasks'> = [];
  export let onOpenView: (kind: 'drive' | 'schedule' | 'hub' | 'tasks') => void = () => {};
  export let onOpenViewInNewWindow: (kind: 'drive' | 'schedule' | 'hub' | 'tasks') => void = () => {};
  export let onReorderPinnedViews: (views: Array<'drive' | 'schedule' | 'hub' | 'tasks'>) => void = () => {};
  export let showExtensionPrompt = false;
  export let onInstallExtension: () => void = () => {};
  export let onDismissExtension: () => void = () => {};
  export let showUpdatePrompt = false;
  export let onInstallUpdate: () => void = () => {};

  /** Icons that come and go with the drawer or the panel mode fade rather than
   * blink: short enough not to lag the click that caused it, long enough that
   * the row does not look like it is snapping between states. */
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const iconFade = {duration: reducedMotion ? 0 : 120};
  /** Search belongs to the drawer, so it waits for the drawer's edge to travel
   * out past it before appearing — at the narrowest width that edge is still
   * left of the icon for most of the 440ms slide. Leaving is the reverse and
   * already reads right, so only the entrance is held back. */
  const searchFadeIn = {duration: reducedMotion ? 0 : 140, delay: reducedMotion ? 0 : 260};

  let editing = false;
  let draft = '';
  let input: HTMLInputElement;
  let titleButton: HTMLButtonElement;
  let titleControl: HTMLElement;
  let previousCenter: number | null = null;
  let renderedPosition = `${chatDrawerOpen}:${mode}`;
  let positionChanged = false;
  $: titleControl = editing ? input : titleButton;
  $: titleInputSize = Math.max(8, Math.min(48, draft.length + 2));

  beforeUpdate(() => {
    const position = `${chatDrawerOpen}:${mode}`;
    positionChanged = position !== renderedPosition;
    previousCenter = positionChanged && titleControl
      ? titleControl.getBoundingClientRect().left + titleControl.getBoundingClientRect().width / 2
      : null;
  });

  afterUpdate(() => {
    if (!positionChanged || previousCenter === null || !titleControl) return;
    const rect = titleControl.getBoundingClientRect();
    const delta = previousCenter - (rect.left + rect.width / 2);
    renderedPosition = `${chatDrawerOpen}:${mode}`;
    positionChanged = false;
    if (Math.abs(delta) < .5) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    titleControl.animate(
      [{transform: `translateX(${delta}px)`}, {transform: 'translateX(0)'}],
      {duration: reducedMotion ? 1 : 440, easing: 'cubic-bezier(.45,0,.55,1)'},
    );
  });

  async function startEditing(): Promise<void> {
    draft = title;
    editing = true;
    await tick();
    input?.focus();
    input?.select();
  }

  function save(): void {
    if (!editing) return;
    const next = draft.trim();
    editing = false;
    if (next && next !== title) onRename(next);
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      editing = false;
    }
  }

  const pinnedViewIcons: Record<PinnedView, IconName> = {drive: 'drive', schedule: 'clock', hub: 'chat', tasks: 'tasks'};
  const pinnedViewLabels: Record<PinnedView, MessageKey> = {drive: 'workspace.drive', schedule: 'workspace.schedule', hub: 'workspace.hub', tasks: 'workspace.tasks'};
  let pinnedMenu: {view: 'drive' | 'schedule' | 'hub' | 'tasks'; anchor: OpenAnchor} | null = null;
  let pinnedMenuChoices: OpenChoice[];
  $: pinnedMenuChoices = [
    {value: 'unpin', label: $t('titlebar.unpinView'), icon: 'pin-off'},
    {value: 'new-window', label: $t('titlebar.openSeparateWindow'), icon: 'send'},
  ];

  function openPinnedMenu(event: MouseEvent, view: 'drive' | 'schedule' | 'hub' | 'tasks'): void {
    event.preventDefault();
    event.stopPropagation();
    pinnedMenu = {view, anchor: {rect: (event.currentTarget as HTMLElement).getBoundingClientRect()}};
  }

  function choosePinnedMenu(value: string): void {
    const view = pinnedMenu?.view;
    pinnedMenu = null;
    if (!view) return;
    if (value === 'unpin') onReorderPinnedViews(pinnedViews.filter((item) => item !== view));
    else if (value === 'new-window') onOpenViewInNewWindow(view);
  }

  let dragIndex: number | null = null;
  let dragOverIndex: number | null = null;

  function onDragStart(event: DragEvent, index: number): void {
    dragIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  function onDragOver(event: DragEvent, index: number): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOverIndex = index;
  }

  function onDrop(event: DragEvent, index: number): void {
    event.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      const reordered = [...pinnedViews];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(index, 0, moved);
      onReorderPinnedViews(reordered);
    }
    dragIndex = null;
    dragOverIndex = null;
  }

  function onDragEnd(): void {
    dragIndex = null;
    dragOverIndex = null;
  }
</script>

<!-- The shell controls and title stay as separate fixed boxes. The title is
     centred against the full window rather than the chat grid, so opening a
     drawer never shifts the conversation name. -->
<div class="left-controls" aria-label={$t('titlebar.chatControls')}>
  {#if showChatToggle}
    <button
      type="button"
      class="title-bar-icon-button"
      aria-label={$t('titlebar.toggleChats')}
      aria-pressed={chatDrawerOpen}
      data-tooltip-label={$t('titlebar.chats')}
      data-tooltip-align="start"
      onclick={onToggleChatDrawer}
    >
      <Icon name="panel-left" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
    </button>
  {/if}
  {#if !hideNewChat}
    <button
      type="button"
      class="title-bar-icon-button new-chat-button"
      transition:fade={iconFade}
      aria-label={$t('titlebar.newChat')}
      data-tooltip-label={$t('titlebar.newChat')}
      data-tooltip-align="start"
      onclick={onNewChat}
    >
      <Icon name="new-chat" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
    </button>
    <!-- Searching past chats only makes sense while their list is on screen,
         so this rides the drawer rather than living in the resting chrome. -->
    {#if chatDrawerOpen}
      <button
        type="button"
        class="title-bar-icon-button"
        aria-label={$t('titlebar.searchChats')}
        in:fade={searchFadeIn}
        out:fade={iconFade}
        data-tooltip-label={$t('titlebar.searchChats')}
        data-tooltip-align="start"
        onclick={onSearchChats}
      >
        <Icon name="search" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
      </button>
    {/if}
  {/if}
</div>

<div class="top-controls" aria-label={$t('titlebar.panels')}>
  <!-- Sits ahead of the panel icons so it reads as a notice about the app
       rather than another panel toggle. It is a link with its own dismiss,
       not a toggle, so the two actions are separate controls. -->
  {#if showUpdatePrompt}
    <span class="extension-chip update-chip" transition:fade={iconFade}>
      <button
        type="button"
        class="extension-chip-install"
        aria-label="Restart to Update"
        onclick={onInstallUpdate}
      >
        <Icon name="download" size={14}/>
        Restart to Update
      </button>
    </span>
  {:else if showExtensionPrompt}
    <span class="extension-chip" transition:fade={iconFade}>
      <button
        type="button"
        class="extension-chip-install"
        onclick={onInstallExtension}
      >
        <Icon name="download" size={14}/>
        {$t('extension.install')}
      </button>
      <!-- No tooltip and no hover state: the divider and the glyph already say
           what it does, and a second tooltip next to the chip's own reads as
           two competing labels. Opting out by name is what the search fields'
           × does — dropping the label alone is not enough, since an icon-only
           button falls back to its aria-label. The aria-label stays, so a
           screen reader still names it. -->
      <button
        type="button"
        class="extension-chip-dismiss"
        aria-label={$t('extension.dismiss')}
        data-tooltip="none"
        onclick={onDismissExtension}
      >
        <Icon name="close" size={14}/>
      </button>
    </span>
  {/if}
  {#if mode !== 'workspace'}
    {#each pinnedViews as view, i (view)}
      <button
        type="button"
        class="title-bar-icon-button"
        class:drag-over={dragOverIndex === i && dragIndex !== i}
        draggable={true}
        in:fade={searchFadeIn}
        out:fade={iconFade}
        aria-label={$t(pinnedViewLabels[view])}
        data-tooltip-label={pinnedMenu?.view === view ? undefined : $t(pinnedViewLabels[view])}
        data-tooltip-align="end"
        ondragstart={(e: DragEvent) => onDragStart(e, i)}
        ondragover={(e: DragEvent) => onDragOver(e, i)}
        ondrop={(e: DragEvent) => onDrop(e, i)}
        ondragend={onDragEnd}
        oncontextmenu={(event) => openPinnedMenu(event, view)}
        onclick={() => onOpenView(view)}
      >
        <Icon name={pinnedViewIcons[view]} size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
      </button>
    {/each}
  {/if}
  {#if showSummary && mode !== 'workspace'}
    <button
      type="button"
      class="title-bar-icon-button"
      class:active={mode === 'summary'}
      aria-label={$t('titlebar.toggleSummary')}
      transition:fade={iconFade}
      aria-pressed={mode === 'summary'}
      data-tooltip-label={$t('titlebar.summary')}
      data-tooltip-align="end"
      onclick={() => onTogglePanel('summary')}
    >
      <Icon name="summary" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
    </button>
  {/if}
  <button
    type="button"
    class="title-bar-icon-button"
    aria-label={$t('titlebar.settings')}
    data-tooltip-label={$t('titlebar.settings')}
    data-tooltip-align="end"
    onclick={onOpenSettings}
  >
    <Icon name="settings" size={SETTINGS_ICON_SIZE} strokeWidth={SETTINGS_ICON_STROKE_WIDTH}/>
  </button>
  <button
    type="button"
    class="title-bar-icon-button"
    class:active={mode === 'workspace'}
    aria-label={$t('titlebar.toggleWorkspace')}
    aria-pressed={mode === 'workspace'}
    data-tooltip-label={$t('titlebar.workspace')}
    data-tooltip-align="end"
    onclick={() => onTogglePanel('workspace')}
  >
    <Icon name="panel" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
  </button>
</div>

<OpenMenu
  choices={pinnedMenuChoices}
  anchor={pinnedMenu?.anchor ?? null}
  onChoose={choosePinnedMenu}
  onClose={() => pinnedMenu = null}
/>

{#if showTitle}
  <header class="conversation-title-bar" aria-label={$t('titlebar.conversationTitle')}>
    {#if editing}
      <input bind:this={input} bind:value={draft} size={titleInputSize} aria-label={$t('titlebar.renameConversation')} onkeydown={keydown} onblur={save}/>
    {:else}
      <button bind:this={titleButton} type="button" title={title} aria-label={$t('titlebar.renameConversationNamed', {title})} data-tooltip="none" onclick={startEditing}>{title}</button>
    {/if}
  </header>
{/if}
