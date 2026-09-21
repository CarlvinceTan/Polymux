<script lang="ts">
  import type {AgentMessageOriginDto, MessageDto} from '@polymux/protocol';
  import {contentText} from './run';
  import {renderMarkdown} from './markdown';
  import Icon from './Icon.svelte';
  import TeamAvatar from './TeamAvatar.svelte';
  import type {BotDto} from '@polymux/protocol';

  export let message: MessageDto;
  export let variant: 'assistant' | 'team' = 'assistant';
  export let member: BotDto | null = null;

  $: text = contentText(message.content);
  $: html = message.role === 'assistant' ? renderMarkdown(text) : '';
  $: origin = agentOrigin(message.metadata);
  $: outgoing = message.role === 'user' || Boolean(origin);

  function agentOrigin(value: unknown): AgentMessageOriginDto | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const relay = (value as Record<string, unknown>).agentRelay;
    if (!relay || typeof relay !== 'object' || Array.isArray(relay)) return null;
    const source = (relay as Record<string, unknown>).source;
    return source && typeof source === 'object' && !Array.isArray(source)
      ? source as AgentMessageOriginDto
      : null;
  }
</script>

<article class:outgoing class:assistant={!outgoing} class:team={variant === 'team'} class="message-row">
  {#if variant === 'team' && !outgoing && member}
    <span class="team-message-avatar"><TeamAvatar avatar={member.avatar} name={member.name} size={28} /></span>
  {/if}
  <div class="message-stack">
    {#if origin}<div class="origin-label">From {origin.name}{origin.role ? ` · ${origin.role}` : ''}</div>{/if}
    <div class="message-content">
      {#if message.role === 'assistant'}
        <div class="markdown">{@html html}</div>
      {:else}
        <p>{text}</p>
      {/if}
      {#if message.attachments.length}
        <div class="message-files">
          {#each message.attachments as attachment}
            <span><Icon name="file" size={16} /> {attachment.name}</span>
          {/each}
        </div>
      {/if}
    </div>
    <time datetime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit', hour12: true})}</time>
  </div>
</article>

<style>
  .message-row { width: 100%; display: flex; align-items: flex-end; }
  .message-row.outgoing { justify-content: flex-end; }
  .message-stack { min-width: 0; width: 100%; display: flex; flex-direction: column; align-items: flex-start; }
  .outgoing .message-stack { align-items: flex-end; }
  .message-content { max-width: min(88%, 680px); color: var(--ink); font-size: 1rem; line-height: 1.52; overflow-wrap: anywhere; }
  .outgoing .message-content { padding: 10px 14px; border-radius: 18px 18px 5px 18px; background: var(--bubble); }
  .team { gap: 7px; }
  .team .message-stack { width: auto; max-width: 76%; }
  .team .message-content { max-width: 100%; border-radius: 13px; padding: 8px 11px; background: var(--bubble); font-size: .875rem; line-height: 1.48; }
  .team.outgoing .message-content { background: var(--ink); color: var(--surface); }
  .team-message-avatar { width: 28px; height: 28px; flex: 0 0 28px; display: grid; place-items: center; }
  p { margin: 0; white-space: pre-wrap; }
  .origin-label { max-width: 88%; margin: 0 6px 5px; color: var(--muted); font-size: .75rem; font-weight: 600; }
  time { margin-top: 4px; color: var(--muted-soft); font-size: .6875rem; font-variant-numeric: tabular-nums; }
  .assistant time { margin-left: 1px; }
  .outgoing time { margin-right: 6px; }
  .team time { margin-inline: 2px; font-size: .625rem; }
  .message-files { display: grid; gap: 6px; margin-top: 9px; }
  .message-files span { display: flex; align-items: center; gap: 7px; min-width: 0; color: var(--muted); font-size: .8125rem; }
  :global(.markdown > :first-child) { margin-top: 0; }
  :global(.markdown > :last-child) { margin-bottom: 0; }
  :global(.markdown p), :global(.markdown ul), :global(.markdown ol), :global(.markdown blockquote) { margin: 0 0 12px; }
  :global(.markdown ul), :global(.markdown ol) { padding-left: 22px; }
  :global(.markdown li + li) { margin-top: 5px; }
  :global(.markdown a) { color: var(--ink); text-decoration-color: var(--line-strong); text-underline-offset: 3px; }
  :global(.markdown pre) { max-width: 100%; overflow-x: auto; padding: 13px; border-radius: 12px; background: var(--code); font-size: .8125rem; }
  :global(.markdown code) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .88em; }
  :global(.markdown :not(pre) > code) { padding: 2px 5px; border-radius: 5px; background: var(--code); }
  :global(.markdown table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; font-size: .875rem; }
  :global(.markdown th), :global(.markdown td) { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; }
</style>
