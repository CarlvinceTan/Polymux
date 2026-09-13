<script lang="ts">
  import {onMount} from 'svelte';
  import {polymuxApi} from '../../api/polymux';
  export let attention: {title: string; detail: string; installUrl?: string; retry?: boolean};
  export let onRefresh: () => Promise<void>;
  let opening = false;
  let retrying = false;
  let error = '';

  async function retry(): Promise<void> {
    if (retrying) return;
    retrying = true;
    error = '';
    try {
      await onRefresh();
    } catch {
      error = 'Still couldn’t reach WeChat. Try again in a moment.';
    } finally { retrying = false; }
  }

  async function openDesktop(): Promise<void> {
    if (opening) return;
    opening = true;
    error = '';
    try {
      await polymuxApi().comms.weChatOpen();
      await onRefresh();
    } catch {
      error = 'Couldn’t open WeChat. Open it from Applications.';
    } finally { opening = false; }
  }

  onMount(() => {
    let disposed = false;
    let pending = false;
    const poll = async () => {
      if (disposed || pending || document.hidden) return;
      pending = true;
      try { await onRefresh(); } catch { /* Keep the last useful guidance and retry. */ }
      finally { pending = false; }
    };
    const visible = () => { if (!document.hidden) void poll(); };
    void poll();
    const timer = setInterval(() => void poll(), 2_000);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  });
</script>

<div class="hub-view-empty hub-view-attention" role="status" aria-live="polite">
  <div>
    <strong>{attention.title}</strong>
    <p>{error || attention.detail}</p>
    {#if attention.installUrl}
      <button type="button" onclick={() => void polymuxApi().browser.openExternal(attention.installUrl!)}>Download WeChat</button>
    {:else if attention.retry}
      <!-- A sync or connection problem the user can re-check without leaving
           Hub; signing in and scanning belong to Desktop. -->
      <button type="button" onclick={() => void retry()} disabled={retrying}>{retrying ? 'Trying again…' : 'Try again'}</button>
    {:else if attention.title !== 'Your Mac is locked'}
      <button type="button" onclick={() => void openDesktop()} disabled={opening}>{opening ? 'Opening WeChat…' : 'Open WeChat'}</button>
    {/if}
  </div>
</div>

<style>
  .hub-view-attention strong { color: var(--neutral-950); }
  .hub-view-attention p { color: var(--neutral-600); opacity: 1; }
  button { border: 0; background: none; padding: 0; margin-top: 12px; color: var(--neutral-600); font: inherit; cursor: pointer; transition: color 120ms ease; }
  button:hover { color: var(--neutral-950); }
  button:disabled { cursor: default; opacity: .65; }
</style>
