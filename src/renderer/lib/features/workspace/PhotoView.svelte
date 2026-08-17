<script lang="ts">
  import Icon from '../../shared/components/Icon.svelte';
  import {t} from '../../../i18n';

  export let title = '';

  $: name = title || $t('view.photo');
  export let src = '';
  export let fitted = true;
</script>

{#if src}
  <div class="media-preview image-preview">
    <img class:fitted class="workspace-image" {src} alt={name}/>
  </div>
{:else}
  <div class="new-tab-empty">
    <Icon name="image" size={30}/>
    <h2>{name}</h2>
    <p>{$t('view.imagePending')}</p>
  </div>
{/if}
