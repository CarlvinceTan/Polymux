<script lang="ts">
  import ChatVideo from './ChatVideo.svelte';
  import {onMount} from 'svelte';
  import {fade} from 'svelte/transition';
  import Icon from '../../shared/components/Icon.svelte';
  import {t} from '../../../i18n';
  export let src: string;
  export let name: string;
  export let kind: 'image' | 'video' = 'image';
  export let initialPosition = 0;
  export let resume = false;
  export let onContextMenu: (event: MouseEvent) => void = () => {};
  export let onError: (event: Event) => void = () => {};
  export let onClose: () => void;
  export let onExpand: () => void;
  let dialog: HTMLDivElement;
  let expand: HTMLButtonElement;
  let ratio = 1;
  let imageWidth = 0;
  onMount(() => { expand.focus(); });
  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const buttons = [...dialog.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]), input:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();
    buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  }
</script>

<div class="hub-media-preview" role="dialog" aria-modal="true" aria-label={name} tabindex="-1"
  bind:this={dialog} onkeydown={keydown} transition:fade={{duration: 150}}>
  <button class="backdrop" type="button" tabindex="-1" aria-label={$t('hub.closeMediaPreview')} onclick={onClose}></button>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="photo" style:--photo-ratio={ratio} style:--preview-width={kind === 'image' && imageWidth > 0 && imageWidth <= 210 ? `${imageWidth}px` : '100cqw'} oncontextmenu={onContextMenu}>
    {#if kind === 'video'}
      <ChatVideo {src} {name} expanded {initialPosition} {resume} {onError}
        onOpen={() => onExpand()} onDimensions={(value) => ratio = value}/>
    {:else}
    <img {src} alt={name} onerror={onError} onload={(event) => { const image = event.currentTarget as HTMLImageElement; imageWidth = image.naturalWidth; ratio = image.naturalWidth / image.naturalHeight || 1; }}/>
    {/if}
    <button class="open-media" bind:this={expand} type="button" onclick={onExpand}>{$t('hub.openInMedia')}</button>
  </div>
  <button class="preview-close" type="button" aria-label={$t('hub.closeMediaPreview')} onclick={onClose}><Icon name="close" size={18}/></button>
</div>

<style>
  .hub-media-preview { --media-overlay-foreground: #ccc; --media-overlay-foreground-strong: #fff; position: absolute; inset: 0; z-index: 120; display: grid; place-items: center; padding: 48px 24px 24px; min-width: 0; min-height: 0; box-sizing: border-box; container-type: size; }
  button { border: 0; padding: 0; cursor: pointer; }
  .backdrop { position: absolute; inset: 0; width: 100%; height: 100%; background: rgb(0 0 0 / 78%); }
  img { position: relative; display: block; width: 100%; height: auto; max-width: 100cqw; max-height: 100cqh; min-width: 0; min-height: 0; object-fit: contain; border-radius: 8px; }
  .photo { position: relative; width: min(var(--preview-width), 100cqw, calc(100cqh * var(--photo-ratio))); max-width: 100%; max-height: 100%; }
  .open-media { position: absolute; bottom: calc(100% + 8px); right: 0; white-space: nowrap; background: transparent; color: var(--media-overlay-foreground); font: inherit; font-size: 12.5px; transition: color 120ms ease; }
  .open-media:hover, .open-media:focus-visible { color: var(--media-overlay-foreground-strong); }
  .preview-close { position: absolute; top: 16px; right: 16px; display: grid; place-items: center; background: transparent; color: var(--media-overlay-foreground); }
  .preview-close:hover { color: var(--media-overlay-foreground-strong); }
</style>
