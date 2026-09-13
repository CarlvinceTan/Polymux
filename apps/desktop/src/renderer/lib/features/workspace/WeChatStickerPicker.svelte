<script lang="ts">
  import {onMount, tick} from 'svelte';
  import type {ChatStickerDto} from '@polymux/protocol';
  import {t} from '../../../i18n';
  import {pickerReveal} from '../../shared/motion/pickerReveal';

  export let stickers: ChatStickerDto[] = [];
  export let loading = false;
  export let onpick: (sticker: ChatStickerDto) => void = () => {};
  export let ariaLabel = '';

  /** Enough reserved cells to read as a gallery while the catalog loads. */
  const SKELETON_CELLS = 6;

  let grid: HTMLDivElement;
  let atTop = true;
  let atBottom = true;

  /** Hidden scrollbars mean the edge fades are the only cue that the gallery
   * continues, so they follow the emoji picker's measured treatment. */
  function measureEdges(): void {
    if (!grid) return;
    atTop = grid.scrollTop <= 1;
    atBottom = grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 1;
  }

  $: if (stickers || loading) void tick().then(() => {
    measureEdges();
    if (!loading) grid?.querySelector<HTMLButtonElement>('button')?.focus();
  });

  onMount(measureEdges);
</script>

<div
  class="hub-view-sticker-picker"
  role="group"
  aria-label={ariaLabel || $t('hub.sendSticker')}
  transition:pickerReveal
>
  <div class="hub-view-sticker-picker-content">
    <div
      class="hub-view-sticker-grid"
      class:at-top={atTop}
      class:at-bottom={atBottom}
      class:empty={!loading && stickers.length === 0}
      bind:this={grid}
      role="grid"
      aria-busy={loading}
      onscroll={measureEdges}
    >
      {#if loading}
        {#each Array(SKELETON_CELLS) as _, index (index)}
          <span class="hub-view-sticker-skeleton" role="gridcell" aria-hidden="true"></span>
        {/each}
      {:else}
        {#each stickers as sticker, index (sticker.id)}
          <button
            type="button"
            role="gridcell"
            aria-label={`${$t('hub.sendSticker')} ${index + 1}`}
            onclick={() => onpick(sticker)}
          >
            <img
              src={sticker.url}
              alt=""
              loading="lazy"
              draggable="false"
              style:aspect-ratio={sticker.width && sticker.height
                ? `${sticker.width} / ${sticker.height}` : undefined}
            />
          </button>
        {:else}
          <span class="hub-view-sticker-state">{$t('hub.noNativeStickers')}</span>
        {/each}
      {/if}
    </div>
  </div>
</div>
