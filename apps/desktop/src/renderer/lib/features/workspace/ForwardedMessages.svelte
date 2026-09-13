<script lang="ts">
  import type {ChatForwardedBundleDto, ChatForwardedMessageDto} from '@polymux/protocol';
  import {t, type MessageKey} from '../../../i18n';
  import Icon from '../../shared/components/Icon.svelte';
  import ForwardedMessages from './ForwardedMessages.svelte';

  export let bundle: ChatForwardedBundleDto;

  const labels: Record<ChatForwardedMessageDto['kind'], MessageKey> = {
    text: 'hub.message', image: 'hub.forwardedImage', audio: 'hub.forwardedVoice',
    video: 'hub.forwardedVideo', file: 'hub.attachment', link: 'hub.forwardedLink',
    location: 'hub.forwardedLocation', record: 'hub.messages', unknown: 'hub.attachment',
  };

  /** A truncated sender enters the keyboard order only while its full name
   * needs the shared tooltip. Summary rows already have native focus. */
  function senderOverflow(node: HTMLElement) {
    const measure = () => {
      if (node.scrollWidth > node.clientWidth + 1) node.tabIndex = 0;
      else node.removeAttribute('tabindex');
    };
    const resize = new ResizeObserver(measure);
    const content = new MutationObserver(measure);
    resize.observe(node);
    content.observe(node, {childList: true, characterData: true, subtree: true});
    measure();
    return {destroy: () => {resize.disconnect(); content.disconnect();}};
  }
</script>

<details class="forwarded-messages">
  <summary data-tooltip-overflow data-tooltip-delay="1500" data-tooltip-wide>
    <span class="forwarded-chevron"><Icon name="chevron" size={13} /></span>
    <span class="forwarded-title" data-tooltip-overflow-text>{bundle.title || $t('hub.messages')}</span>
    <span class="forwarded-count">{bundle.messages.length}</span>
  </summary>
  <ol>
    {#each bundle.messages as message}
      <li>
        <div class="forwarded-author">
          <strong use:senderOverflow data-tooltip-overflow data-tooltip-delay="1500" data-tooltip-wide>{message.senderName || $t('hub.unknownSender')}</strong>
          {#if message.sentAt}<span>{message.sentAt}</span>{/if}
        </div>
        {#if message.forwarded}
          <ForwardedMessages bundle={message.forwarded} />
        {:else}
          {#if message.kind !== 'text' && !(message.kind === 'unknown' && message.body)}
            <span class="forwarded-kind">{$t(labels[message.kind])}</span>
          {/if}
          {#if message.body}<p>{message.body}</p>{/if}
        {/if}
      </li>
    {/each}
  </ol>
  {#if bundle.truncated}<span class="forwarded-overflow">{$t('hub.forwardedMoreInSource')}</span>{/if}
</details>

<style>
  .forwarded-messages { min-width: 0; width: min(360px, 100%); color: inherit; }
  summary { display: flex; align-items: center; gap: 8px; min-height: 28px; cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; border-radius: 3px; }
  .forwarded-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 560; }
  .forwarded-count { font-size: 11px; font-variant-numeric: tabular-nums; }
  .forwarded-chevron { display: flex; flex: none; transform: rotate(-90deg); transition: transform 140ms ease-out; }
  details[open] > summary .forwarded-chevron { transform: rotate(0); }
  ol { display: grid; gap: 14px; list-style: none; margin: 8px 0 4px; padding: 0; }
  li { min-width: 0; }
  .forwarded-author { display: flex; align-items: baseline; flex-wrap: wrap; column-gap: 8px; row-gap: 2px; margin-bottom: 3px; }
  .forwarded-author strong { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 590; }
  .forwarded-author strong:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; border-radius: 3px; }
  .forwarded-author > span { font-size: 10px; font-variant-numeric: tabular-nums; }
  .forwarded-kind, .forwarded-overflow { display: block; margin-block: 3px; font-size: 11px; }
  p { margin: 0; font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  @media (prefers-reduced-motion: reduce) { .forwarded-chevron { transition: none; } }
</style>
