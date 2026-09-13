<script lang="ts">
  import {onMount} from 'svelte';
  import {invoke} from '@tauri-apps/api/core';
  import {rpc, type SavedConnection} from './host';
  import {isApplePhone} from './account';
  export let connection: SavedConnection;
  let enabled = false;
  let busy = false;
  let error = '';
  onMount(() => {
    if (!isApplePhone()) return;
    void (async () => {
      const status = await rpc<{enabled: boolean; available: boolean}>(connection, 'notifications.status');
      enabled = status.enabled;
      if (enabled && status.available) {
        const subscription = await invoke<{token: string; environment: string}>('plugin:polymux-apple|registerPush');
        await rpc(connection, 'notifications.register', [subscription]);
      }
    })().catch(cause => { error = cause instanceof Error ? cause.message : String(cause); });
  });
  async function toggle() {
    busy = true; error = '';
    try {
      if (enabled) await rpc(connection, 'notifications.unregister');
      else {
        const status = await rpc<{available: boolean}>(connection, 'notifications.status');
        if (!status.available) throw new Error('Notifications need to be configured on your desktop.');
        const subscription = await invoke<{token: string; environment: string}>('plugin:polymux-apple|registerPush');
        await rpc(connection, 'notifications.register', [subscription]);
      }
      enabled = !enabled;
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }
</script>
{#if isApplePhone()}
  <div class="notifications"><button disabled={busy} onclick={() => void toggle()}>{enabled ? 'Notifications on' : 'Enable notifications'}</button>{#if error}<p role="alert">{error}</p>{/if}</div>
{/if}
<style>
  .notifications { padding: 8px 16px; }
  button { border: 0; padding: 0; background: none; color: var(--muted); font: inherit; }
  button:hover { color: var(--ink); }
  p { font-size: 13px; color: var(--danger, #b42318); }
</style>
