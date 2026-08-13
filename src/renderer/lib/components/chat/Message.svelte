<script module lang="ts">
  export type MessageRole = 'user' | 'assistant';
  export type MessageFeedback = 'up' | 'down' | null;

  export type MessageData = {
    id: string;
    role: MessageRole;
    text: string;
    feedback?: MessageFeedback;
    files?: string[];
  };
</script>

<script lang="ts">
  import {onDestroy, tick} from 'svelte';
  import MessageAction from './MessageAction.svelte';
  import FileAttachment from './FileAttachment.svelte';

  export let message: MessageData;
  export let streaming = false;
  export let onEdit: (id: string, text: string) => void = () => {};
  export let onFeedback: (id: string, feedback: MessageFeedback) => void = () => {};

  let editing = false;
  let draft = '';
  let copied = false;
  let editArea: HTMLTextAreaElement;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(() => {
    if (copyTimer) clearTimeout(copyTimer);
  });

  async function startEdit(): Promise<void> {
    draft = message.text;
    editing = true;
    await tick();
    editArea.focus();
    editArea.select();
  }

  function submitEdit(): void {
    const text = draft.trim();
    if (!text) return;
    editing = false;
    onEdit(message.id, text);
  }

  function editKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') editing = false;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitEdit();
    }
  }

  async function copyMessage(): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.text);
    } catch {
      return;
    }

    copied = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => copied = false, 1400);
  }

  function toggleFeedback(value: Exclude<MessageFeedback, null>): void {
    onFeedback(message.id, message.feedback === value ? null : value);
  }
</script>

<article
  id={`message-${message.id}`}
  class:assistant={message.role === 'assistant'}
  class:editing
  class="message message-group"
>
  {#if editing}
    <div class="message-edit-shell">
      <textarea
        bind:this={editArea}
        bind:value={draft}
        aria-label="Edit message"
        rows="3"
        onkeydown={editKeydown}
      ></textarea>
      <div class="message-edit-controls">
        <button type="button" onclick={() => editing = false}>Cancel</button>
        <button type="button" class="save" onclick={submitEdit}>Send</button>
      </div>
    </div>
  {:else}
    <div class="message-content">
      {#if message.files?.length}
        <div class="message-files">
          {#each message.files as file (file)}
            <FileAttachment name={file} removable={false}/>
          {/each}
        </div>
      {/if}
      {#if message.text}
        <p>{message.text}</p>
      {:else if message.role === 'assistant'}
        <span class="thinking" aria-label="Assistant is responding" role="status">
          <i></i><i></i><i></i>
        </span>
      {/if}
    </div>

    {#if message.role === 'user' || (message.text && !streaming)}
      <div class="message-actions" aria-label={`${message.role === 'user' ? 'User' : 'Assistant'} message actions`}>
        {#if message.role === 'user'}
          <MessageAction icon="edit" label="Edit" onAction={startEdit}/>
        {/if}
        <MessageAction icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy'} onAction={copyMessage}/>
        {#if message.role === 'assistant'}
          <MessageAction
            icon="thumb-up"
            label="Good response"
            active={message.feedback === 'up'}
            onAction={() => toggleFeedback('up')}
          />
          <MessageAction
            icon="thumb-down"
            label="Bad response"
            active={message.feedback === 'down'}
            onAction={() => toggleFeedback('down')}
          />
        {/if}
      </div>
    {/if}
  {/if}
</article>

<style>
  .message {
    color: var(--neutral-800, #262626);
    font-size: 14px;
    line-height: 1.55;
  }

  .message:not(.assistant) {
    width: fit-content;
    max-width: 85%;
    margin-left: auto;
  }

  .message-content p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .message-files { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; margin-bottom: 6px; }
  .assistant .message-files { justify-content: flex-start; }

  .message:not(.assistant) .message-content {
    width: fit-content;
    max-width: 100%;
    margin-left: auto;
    border-radius: 20px;
    padding: 8px 12px;
    background: #e8e8e8;
  }

  .assistant .message-content {
    width: 100%;
  }

  .message-actions {
    height: 24px;
    display: flex;
    align-items: center;
    gap: 2px;
    margin-top: 3px;
    opacity: 0;
    transition: opacity 150ms ease;
  }

  .message:not(.assistant) .message-actions {
    justify-content: flex-end;
  }

  .message-group:hover .message-actions,
  .message-group:focus-within .message-actions {
    opacity: 1;
  }

  .message-edit-shell {
    width: min(100%, 560px);
    border: 1px solid var(--neutral-300, #d4d4d4);
    border-radius: 20px;
    padding: 8px 12px;
    background: #fff;
  }

  .message.editing {
    width: min(100%, 560px);
  }

  .message-edit-shell textarea {
    width: 100%;
    min-height: 72px;
    resize: vertical;
    border: 0;
    padding: 2px 0;
    outline: none;
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: 1.55;
  }

  .message-edit-controls {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 7px;
  }

  .message-edit-controls button {
    border: 0;
    border-radius: 7px;
    padding: 5px 10px;
    background: transparent;
    color: var(--neutral-500, #737373);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 550;
  }

  .message-edit-controls button:hover {
    background: var(--neutral-100, #f5f5f5);
    color: var(--neutral-800, #262626);
  }

  .message-edit-controls button.save {
    background: var(--neutral-900, #171717);
    color: #fff;
  }

  .thinking {
    display: inline-flex;
    gap: 4px;
    padding: 7px 0;
  }

  .thinking i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--neutral-500, #737373);
    animation: pulse 1.2s infinite;
  }

  .thinking i:nth-child(2) { animation-delay: 150ms; }
  .thinking i:nth-child(3) { animation-delay: 300ms; }

  @media (hover: none) {
    .message-actions { opacity: 1; }
  }

  @keyframes pulse {
    0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
    30% { opacity: 1; transform: translateY(-3px); }
  }
</style>
