<script module lang="ts">
  import type {MessageData} from './Message.svelte';
  import type {AgentActivityItem} from './AgentActivity.svelte';
  export type ChatMessage = MessageData & {activities?: AgentActivityItem[]; startedAt?: string; completedAt?: string};
</script>

<script lang="ts">
  import {tick} from 'svelte';
  import WelcomeChatPane from './WelcomeChatPane.svelte';
  import Message from './Message.svelte';
  import PromptInput from './PromptInput.svelte';
  import AgentActivity from './AgentActivity.svelte';
  import QueuedMessages, {type QueuedMessage} from './QueuedMessages.svelte';
  import TimelineRail, {type TimelineItem} from './TimelineRail.svelte';

  export let messages: ChatMessage[] = [];
  export let running = false;
  export let placeholder = 'Ask anything';
  export let queued: QueuedMessage[] = [];
  export let timeline: TimelineItem[] = [];
  export let onSend: (text: string, files: File[]) => void = () => {};
  export let onStop: () => void = () => {};
  export let onVoice: () => void = () => {};
  export let onOptions: () => void = () => {};
  export let onEdit: (id: string, text: string) => void = () => {};
  export let onFeedback: (id: string, feedback: 'up' | 'down' | null) => void = () => {};
  export let onSteerQueued: (id: string) => void = () => {};
  export let onRemoveQueued: (id: string) => void = () => {};
  export let onEditQueued: (id: string) => void = () => {};
  export let onReorderQueued: (sourceId: string, targetId: string) => void = () => {};

  let scroller: HTMLElement;
  $: if (messages.length || running) scrollToBottom(messages.length, running);

  async function scrollToBottom(_count: number, _running: boolean): Promise<void> {
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }
</script>

<section class="chat-pane" aria-label="Chat">
  {#if messages.length === 0}
    <WelcomeChatPane active={running} {placeholder} onSend={onSend} onStop={onStop} onVoice={onVoice} onOptions={onOptions}/>
  {:else}
    <div class="conversation-scroll" bind:this={scroller}>
      <div class="conversation-layout">
        {#if timeline.length}
          <TimelineRail items={timeline}/>
        {/if}
        <div class="message-list" aria-live="polite">
          {#each messages as message, index (message.id)}
            <div class="message-block">
              {#if message.role === 'assistant' && (message.activities?.length || (running && index === messages.length - 1))}
                <AgentActivity activities={message.activities ?? []} startedAt={message.startedAt} completedAt={message.completedAt} streaming={running && index === messages.length - 1}/>
              {/if}
              <Message {message} streaming={running && index === messages.length - 1} {onEdit} {onFeedback}/>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="composer-dock">
      <div class="composer-width">
        {#if queued.length}
          <QueuedMessages items={queued} onSteer={onSteerQueued} onDelete={onRemoveQueued} onEdit={onEditQueued} onReorder={onReorderQueued}/>
        {/if}
        <PromptInput active={running} {placeholder} onSend={onSend} onStop={onStop} onVoice={onVoice} onOptions={onOptions}/>
      </div>
    </div>
  {/if}
</section>

<style>
  .chat-pane { min-width: 0; min-height: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #fff; }
  .conversation-scroll { min-height: 0; flex: 1; overflow-y: auto; scrollbar-gutter: stable; }
  .conversation-layout { width: min(100%, 850px); display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 12px; margin: 0 auto; padding: 44px 30px 42px; }
  .message-list { min-width: 0; display: flex; flex-direction: column; gap: 30px; }
  .message-block { scroll-margin-top: 20px; }
  .composer-dock { flex: none; padding: 10px 24px 20px; background: linear-gradient(180deg, rgb(255 255 255 / 0%), #fff 22%); }
  .composer-width { width: min(100%, 750px); margin: 0 auto; }
  @media (max-width: 680px) { .conversation-layout { display: block; padding: 28px 18px 30px; } .conversation-layout :global(.timeline-rail) { display: none; } .composer-dock { padding: 8px 14px 14px; } }
</style>
