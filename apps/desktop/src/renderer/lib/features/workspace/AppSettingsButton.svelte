<script lang="ts">
  import Icon from '../../shared/components/Icon.svelte';
  let {name, onclick, size = 15}: {name: string; onclick?: () => void; size?: number} = $props();
</script>

{#if onclick}
  <button type="button" class="app-settings-button" aria-label={`${name} settings`} data-app-settings-button data-tooltip-label="Settings" {onclick}><Icon name="settings" size={size}/></button>
{/if}

<style>
  .app-settings-button { width:28px; height:28px; display:grid; place-items:center; flex:none; border:0; padding:0; background:transparent; color:var(--neutral-500); cursor:pointer; }
  .app-settings-button:hover { color:var(--neutral-950); }
  .app-settings-button:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; border-radius:6px; }
</style>
