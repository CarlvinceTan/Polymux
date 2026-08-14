<script module lang="ts">
  import type {MessageData} from './Message.svelte';
  import type {AgentActivityItem} from './AgentActivity.svelte';
  export type ChatMessage = MessageData & {activities?: AgentActivityItem[]; startedAt?: string; completedAt?: string};

  export const JUMP_TO_LATEST_THRESHOLD = 160;
  export const STICK_TO_LATEST_THRESHOLD = 20;

  export interface ScrollMetrics {
    scrollHeight: number;
    scrollTop: number;
    clientHeight: number;
  }

  export function distanceFromBottom({scrollHeight, scrollTop, clientHeight}: ScrollMetrics): number {
    return Math.max(0, scrollHeight - scrollTop - clientHeight);
  }

  export function conversationScrollState(metrics: ScrollMetrics) {
    const distance = distanceFromBottom(metrics);
    return {
      distance,
      stickToLatest: distance <= STICK_TO_LATEST_THRESHOLD,
      showJumpToLatest: metrics.scrollHeight > metrics.clientHeight + 4 && distance > JUMP_TO_LATEST_THRESHOLD,
    };
  }
</script>

<script lang="ts">
  import {onMount, tick} from 'svelte';
  import Icon from '../shared/Icon.svelte';
  import WelcomeChatPane from './WelcomeChatPane.svelte';
  import Message from './Message.svelte';
  import PromptInput from './PromptInput.svelte';
  import AgentActivity from './AgentActivity.svelte';
  import QueuedMessages, {type QueuedMessage} from './QueuedMessages.svelte';
  import GoalBar, {type ActiveGoal} from './GoalBar.svelte';

  export let messages: ChatMessage[] = [];
  export let running = false;
  export let placeholder = 'Ask anything';
  export let queued: QueuedMessage[] = [];
  export let goal: ActiveGoal | null = null;
  export let speechMode = false;
  export let speechModeEnabled = true;
  export let showJumpToLatest = false;
  export let onSend: (text: string, files: File[], asGoal: boolean) => void = () => {};
  export let onStop: () => void = () => {};
  export let onVoice: () => void = () => {};
  export let onOptions: () => void = () => {};
  export let onEdit: (id: string, text: string, files: File[]) => void = () => {};
  export let onFeedback: (id: string, feedback: 'up' | 'down' | null) => void = () => {};
  export let onQueueHeight: (height: number) => void = () => {};
  export let onJumpAvailability: (show: boolean) => void = () => {};
  export let onSteerQueued: (id: string) => void = () => {};
  export let onRemoveQueued: (id: string) => void = () => {};
  export let onEditQueued: (id: string) => void = () => {};
  export let onReorderQueued: (sourceId: string, targetId: string) => void = () => {};
  export let onEditGoal: (text: string) => void = () => {};
  export let onToggleGoalPaused: () => void = () => {};
  export let onDeleteGoal: () => void = () => {};

  let column: HTMLDivElement;
  let stickToLatest = true;

  $: onQueueHeight((queued.length ? Math.min(queued.length, 4) * 40 + 24 : 0) + (goal ? 50 : 0));
  $: if (messages.length || running) void followLatest(messages.length, running);

  async function followLatest(_count: number, _running: boolean): Promise<void> {
    await tick();
    if (column && stickToLatest) column.scrollTop = column.scrollHeight;
    measure();
  }

  function measure(): void {
    if (!column) return;
    const state = conversationScrollState(column);
    stickToLatest = state.stickToLatest;
    onJumpAvailability(state.showJumpToLatest);
  }

  function scrollToLatest(): void {
    if (!column) return;
    column.scrollTo({top: column.scrollHeight, behavior: 'auto'});
  }

  onMount(() => {
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (column) observer?.observe(column);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  });
</script>

<!-- Only this column scrolls. It is never transformed, filtered or contained:
     the composer is fixed inside it, and any of those would make this element
     its containing block and collapse it to the column's width. -->
<div class="conversation-column" bind:this={column} onscroll={measure}>
  {#if messages.length === 0}
    <div class:voice-welcome={speechMode} class="empty-state">
      <WelcomeChatPane
        showComposer={!speechMode}
        active={running}
        {speechModeEnabled}
        {placeholder}
        {onSend}
        {onStop}
        {onVoice}
        {onOptions}
      />
    </div>
  {:else}
    <div class="message-list" aria-live="polite">
      {#each messages as message, index (message.id)}
        {#if message.role === 'assistant' && (message.activities?.length || (running && index === messages.length - 1))}
          <AgentActivity
            activities={message.activities ?? []}
            startedAt={message.startedAt}
            completedAt={message.completedAt}
            streaming={running && index === messages.length - 1}
          />
        {/if}
        <Message {message} streaming={running && index === messages.length - 1} {onEdit} {onFeedback}/>
      {/each}
    </div>

    {#if showJumpToLatest}
      <button type="button" class="scroll-to-latest" aria-label="Scroll to latest" onclick={scrollToLatest}>
        <Icon name="arrow-down" size={18}/>
      </button>
    {/if}

    <div class="sticky-composer">
      <div class="composer-column-content">
        {#if goal}
          <GoalBar {goal} onEdit={onEditGoal} onTogglePaused={onToggleGoalPaused} onDelete={onDeleteGoal}/>
        {/if}
        {#if queued.length}
          <QueuedMessages
            items={queued}
            onSteer={onSteerQueued}
            onEdit={onEditQueued}
            onDelete={onRemoveQueued}
            onReorder={onReorderQueued}
          />
        {/if}
        {#if !speechMode}
          <PromptInput active={running} {speechModeEnabled} {placeholder} {onSend} {onStop} {onVoice} {onOptions}/>
        {/if}
      </div>
    </div>
  {/if}
</div>
