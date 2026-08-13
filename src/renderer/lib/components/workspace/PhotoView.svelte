<script lang="ts">
  import Icon from '../shared/Icon.svelte';

  export let title = 'Photo';
  export let src = '';
  export let fitted = true;
</script>

{#if src}
  <div class="media-preview image-preview">
    <img class:fitted class="workspace-image" {src} alt={title}/>
  </div>
{:else}
  <div class="new-tab-empty">
    <Icon name="image" size={30}/>
    <h2>{title}</h2>
    <p>The image will appear here once it is available.</p>
  </div>
{/if}
