<script lang="ts">
  import {afterUpdate, beforeUpdate, tick} from 'svelte';
  import Icon from '../shared/Icon.svelte';
  import {MAIN_UI_ICON_SIZE, MAIN_UI_ICON_STROKE_WIDTH} from '../../layout/iconSizing';
  import type {PanelMode} from '../../state/panels';

  export let title = 'New chat';
  export let showTitle = false;
  export let showSummary = false;
  export let hideNewChat = false;
  export let historyOpen = false;
  export let mode: PanelMode = 'none';
  export let onRename: (title: string) => void = () => {};
  export let onToggleHistory: () => void = () => {};
  export let onNewChat: () => void = () => {};
  export let onTogglePanel: (mode: 'summary' | 'workspace') => void = () => {};

  let editing = false;
  let draft = '';
  let input: HTMLInputElement;
  let titleButton: HTMLButtonElement;
  let titleControl: HTMLElement;
  let previousCenter: number | null = null;
  let renderedPosition = `${historyOpen}:${mode}`;
  let positionChanged = false;
  $: titleControl = editing ? input : titleButton;
  $: titleInputSize = Math.max(8, Math.min(48, draft.length + 2));

  beforeUpdate(() => {
    const position = `${historyOpen}:${mode}`;
    positionChanged = position !== renderedPosition;
    previousCenter = positionChanged && titleControl
      ? titleControl.getBoundingClientRect().left + titleControl.getBoundingClientRect().width / 2
      : null;
  });

  afterUpdate(() => {
    if (!positionChanged || previousCenter === null || !titleControl) return;
    const rect = titleControl.getBoundingClientRect();
    const delta = previousCenter - (rect.left + rect.width / 2);
    renderedPosition = `${historyOpen}:${mode}`;
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
</script>

<!-- The shell controls and title stay as separate fixed boxes. The title is
     centred against the full window rather than the chat grid, so opening a
     drawer never shifts the conversation name. -->
<div class="left-controls" aria-label="Chat controls">
  <button
    type="button"
    class="title-bar-icon-button"
    aria-label="Toggle chat history"
    aria-pressed={historyOpen}
    data-tooltip-label="History"
    data-tooltip-align="start"
    onclick={onToggleHistory}
  >
    <Icon name="history" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
  </button>
  {#if !hideNewChat}
    <button
      type="button"
      class="title-bar-icon-button new-chat-button"
      aria-label="New Chat"
      data-tooltip-label="New Chat"
      data-tooltip-align="start"
      onclick={onNewChat}
    >
      <Icon name="new-chat" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
    </button>
  {/if}
</div>

<div class="top-controls" aria-label="Panels">
  {#if showSummary && mode !== 'workspace'}
    <button
      type="button"
      class="title-bar-icon-button"
      class:active={mode === 'summary'}
      aria-label="Toggle Summary"
      aria-pressed={mode === 'summary'}
      data-tooltip-label="Summary"
      data-tooltip-align="end"
      onclick={() => onTogglePanel('summary')}
    >
      <Icon name="summary" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
    </button>
  {/if}
  <button
    type="button"
    class="title-bar-icon-button"
    class:active={mode === 'workspace'}
    aria-label="Toggle Workspace"
    aria-pressed={mode === 'workspace'}
    data-tooltip-label="Workspace"
    data-tooltip-align="end"
    onclick={() => onTogglePanel('workspace')}
  >
    <Icon name="panel" size={MAIN_UI_ICON_SIZE} strokeWidth={MAIN_UI_ICON_STROKE_WIDTH}/>
  </button>
</div>

{#if showTitle}
  <header class="conversation-title-bar" aria-label="Conversation title">
    {#if editing}
      <input bind:this={input} bind:value={draft} size={titleInputSize} aria-label="Rename conversation" onkeydown={keydown} onblur={save}/>
    {:else}
      <button bind:this={titleButton} type="button" title={title} aria-label={`Rename conversation: ${title}`} data-tooltip="none" onclick={startEditing}>{title}</button>
    {/if}
  </header>
{/if}
