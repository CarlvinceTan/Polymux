<script lang="ts">
  import Icon from '../shared/Icon.svelte';

  export let title = 'Video';
  export let src = '';
</script>

{#if src}
  <div class="media-preview">
    <!-- svelte-ignore a11y_media_has_caption -->
    <video {src} controls aria-label={title}></video>
  </div>
{:else}
  <div class="new-tab-empty">
    <Icon name="video" size={30}/>
    <h2>{title}</h2>
    <p>The video will appear here once it is available.</p>
  </div>
{/if}
