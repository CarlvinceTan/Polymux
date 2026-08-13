<script module lang="ts">
  export type SideChatMessage = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
  };
</script>

<script lang="ts">
  export let title = 'Side chat';
  export let messages: SideChatMessage[] = [];
  export let running = false;
  export let placeholder = 'Ask about this workspace';
  export let onSend: (text: string) => void = () => {};
  export let onStop: () => void = () => {};

  let draft = '';

  function submit(): void {
    const text = draft.trim();
    if (!text || running) return;
    onSend(text);
    draft = '';
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }
</script>

<section class="side-chat-view" aria-label={title}>
  <header>
    <h2>{title}</h2>
  </header>

  <div class="messages" aria-live="polite">
    {#if messages.length}
      {#each messages as message (message.id)}
        <article class:assistant={message.role === 'assistant'}>
          <span>{message.role === 'assistant' ? 'Assistant' : 'You'}</span>
          <p>{message.text}</p>
        </article>
      {/each}
    {:else}
      <div class="empty-state">
        <p>Start a focused conversation about this workspace.</p>
      </div>
    {/if}
  </div>

  <div class="composer">
    <textarea bind:value={draft} rows="1" aria-label={placeholder} {placeholder} disabled={running} onkeydown={keydown}></textarea>
    {#if running}
      <button type="button" aria-label="Stop response" onclick={onStop}><span class="stop-icon"></span></button>
    {:else}
      <button type="button" aria-label="Send message" disabled={!draft.trim()} onclick={submit}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5m0 0L6 9m4-4 4 4"/></svg>
      </button>
    {/if}
  </div>
</section>

<style>
  .side-chat-view {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--main-panel-background, #fff);
    color: var(--neutral-900, #171717);
  }

  header {
    height: 48px;
    display: flex;
    flex: none;
    align-items: center;
    border-bottom: 1px solid var(--neutral-200, #e5e5e5);
    padding: 0 18px;
  }

  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 580;
  }

  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 22px 18px;
  }

  article {
    max-width: 88%;
    margin: 0 0 20px auto;
  }

  article.assistant {
    margin-right: auto;
    margin-left: 0;
  }

  article > span {
    display: block;
    margin-bottom: 5px;
    color: var(--neutral-500, #737373);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  article p {
    margin: 0;
    border-radius: 16px;
    padding: 9px 12px;
    background: var(--neutral-100, #f5f5f5);
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  article.assistant p {
    padding: 0;
    background: transparent;
  }

  .empty-state {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--neutral-500, #737373);
    font-size: 13px;
    text-align: center;
  }

  .composer {
    min-height: 54px;
    display: flex;
    flex: none;
    align-items: flex-end;
    gap: 8px;
    margin: 0 14px 14px;
    border: 1px solid var(--neutral-200, #e5e5e5);
    border-radius: 16px;
    padding: 9px 9px 9px 13px;
    background: #fff;
  }

  textarea {
    min-width: 0;
    flex: 1;
    resize: none;
    border: 0;
    padding: 7px 0;
    outline: none;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 13px;
    line-height: 1.4;
  }

  .composer button {
    width: 32px;
    height: 32px;
    display: grid;
    flex: none;
    place-items: center;
    border: 0;
    border-radius: 50%;
    padding: 0;
    background: var(--neutral-950, #0a0a0a);
    color: #fff;
    cursor: pointer;
  }

  .composer button:disabled {
    background: var(--neutral-200, #e5e5e5);
    color: var(--neutral-400, #a3a3a3);
    cursor: default;
  }

  svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .stop-icon {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    background: currentColor;
  }
</style>
