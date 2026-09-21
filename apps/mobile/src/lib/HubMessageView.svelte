<script lang="ts">
  import type {ChatMessageDto} from '@polymux/protocol';
  import Icon from './Icon.svelte';

  export let message: ChatMessageDto;

  $: senderInitial = (message.senderName || message.sender || '?').trim().charAt(0).toUpperCase();
  $: time = new Date(message.sentAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit', hour12: true});
</script>

{#if message.notice}
  <p class="hub-notice">{message.body}</p>
{:else}
  <article class:mine={message.mine} class="hub-message-row">
    {#if !message.mine}
      <span class="hub-message-avatar" aria-hidden="true">
        {#if message.senderAvatarUrl}<img src={message.senderAvatarUrl} alt="" />{:else}{senderInitial}{/if}
      </span>
    {/if}
    <div class="hub-message-stack">
      {#if !message.mine}<strong>{message.senderName || message.sender}</strong>{/if}
      <div class="hub-message-bubble">
        <p>{message.body}</p>
        {#if message.attachments?.length}
          <div class="hub-message-files">
            {#each message.attachments as attachment}
              <span><Icon name="file" size={14} /><b>{attachment.name}</b></span>
            {/each}
          </div>
        {/if}
      </div>
      <time datetime={message.sentAt}>{time}</time>
    </div>
  </article>
{/if}

<style>
  .hub-notice { max-width: 76%; align-self: center; margin: 5px auto; color: var(--muted); text-align: center; font-size: .75rem; line-height: 1.45; }
  .hub-message-row { width: 100%; display: flex; align-items: flex-end; gap: 8px; }
  .hub-message-row.mine { justify-content: flex-end; }
  .hub-message-avatar { width: 28px; height: 28px; flex: 0 0 28px; display: grid; place-items: center; overflow: hidden; border-radius: 8px; background: var(--bubble); color: var(--muted); font-size: .6875rem; font-weight: 650; }
  .hub-message-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .hub-message-stack { min-width: 0; max-width: 76%; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
  .mine .hub-message-stack { align-items: flex-end; }
  .hub-message-stack > strong { max-width: 100%; overflow: hidden; color: var(--muted); font-size: .6875rem; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .hub-message-bubble { width: fit-content; max-width: 100%; border-radius: 13px; padding: 8px 11px; background: var(--bubble); color: var(--ink); overflow-wrap: anywhere; }
  .mine .hub-message-bubble { background: var(--ink); color: var(--surface); }
  .hub-message-bubble p { margin: 0; white-space: pre-wrap; font-size: .875rem; line-height: 1.48; }
  .hub-message-stack time { color: var(--muted-soft); font-size: .625rem; font-variant-numeric: tabular-nums; }
  .hub-message-files { display: grid; gap: 5px; margin-top: 7px; }
  .hub-message-files span { min-width: 0; display: flex; align-items: center; gap: 5px; }
  .hub-message-files b { min-width: 0; overflow: hidden; font-size: .6875rem; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
</style>
