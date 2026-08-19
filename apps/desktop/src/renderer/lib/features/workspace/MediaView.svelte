<script module lang="ts">
  /** Extensions a page can actually play, as opposed to ones the drive merely
   * files under video: a `.mkv` is a video everywhere except in a <video>. */
  const PLAYABLE = new Set(['mp4', 'webm', 'm4v', 'mov', 'ogv']);

  /** What a source is, read from its name rather than from the tab that opened
   * it — a preview url carries the file's name for exactly this. */
  export function mediaKind(src: string): 'video' | 'image' {
    const name = src.split(/[?#]/)[0] ?? '';
    const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    return PLAYABLE.has(extension) ? 'video' : 'image';
  }
</script>

<script lang="ts">
  import Icon from '../../shared/components/Icon.svelte';
  import {t} from '../../../i18n';

  /** Empty falls back to the catalog, so the view follows the language. */
  export let title = '';
  export let src = '';
  /** Images fit the pane by default; a clip is always sized by the player. */
  export let fitted = true;

  $: kind = mediaKind(src);
  $: name = title || (kind === 'video' ? $t('view.video') : $t('view.photo'));
</script>

{#if src && kind === 'video'}
  <div class="media-preview">
    <!-- svelte-ignore a11y_media_has_caption -->
    <video {src} controls aria-label={name}></video>
  </div>
{:else if src}
  <div class="media-preview image-preview">
    <img class:fitted class="workspace-image" {src} alt={name}/>
  </div>
{:else}
  <div class="new-tab-empty">
    <Icon name={kind === 'video' ? 'video' : 'image'} size={30}/>
    <h2>{name}</h2>
    <p>{kind === 'video' ? $t('view.videoPending') : $t('view.imagePending')}</p>
  </div>
{/if}
