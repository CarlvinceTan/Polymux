<script module lang="ts">
  export type SideChatMessage = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
  };
</script>

<script lang="ts">
  import Icon from '../../shared/components/Icon.svelte';
  import {t} from '../../../i18n';

  export let title = '';
  export let messages: SideChatMessage[] = [];
  export let running = false;
  export let placeholder = '';
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

<!-- No title bar of its own: the tab already names the view, and every other
     workspace view fills the content area edge to edge. -->
<section class="side-chat-view" aria-label={title || $t('view.sideChat')}>
  <div class="side-chat-messages" aria-live="polite">
    {#if messages.length}
      {#each messages as message (message.id)}
        <article class:assistant={message.role === 'assistant'} class="message message-group">
          <div class="message-content">
            {#if message.role === 'assistant'}<div class="markdown-body"><p>{message.text}</p></div>{:else}<p>{message.text}</p>{/if}
          </div>
        </article>
      {/each}
    {:else}
      <p class="side-chat-empty">{$t('view.sideChatEmpty')}</p>
    {/if}
  </div>

  <div class="side-chat-composer">
    <div class="flareai-prompt">
      <div class:raised={draft.length > 0} class="flareai-prompt-shell">
        <div class="flareai-editor-slot">
          <textarea
            bind:value={draft}
            class="side-chat-input"
            rows="1"
            aria-label={placeholder || $t('view.sideChatPlaceholder')}
            placeholder={placeholder || $t('view.sideChatPlaceholder')}
            onkeydown={keydown}
          ></textarea>
        </div>
        <button
          type="button"
          class="flareai-primary"
          aria-label={running ? $t('composer.stopAgent') : $t('composer.sendMessage')}
          onclick={() => running ? onStop() : submit()}
        ><Icon name={running ? 'stop' : 'send'} size={running ? 22 : 18}/></button>
      </div>
    </div>
  </div>
</section>
