<script lang="ts">
  import Icon from '../shared/Icon.svelte';
  import {t} from '../../i18n';

  export let title = '';

  $: name = title || $t('view.video');
  export let src = '';
</script>

{#if src}
  <div class="media-preview">
    <!-- svelte-ignore a11y_media_has_caption -->
    <video {src} controls aria-label={name}></video>
  </div>
{:else}
  <div class="new-tab-empty">
    <Icon name="video" size={30}/>
    <h2>{name}</h2>
    <p>{$t('view.videoPending')}</p>
  </div>
{/if}
