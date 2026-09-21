<script lang="ts">
  import {onMount} from 'svelte';
  import Message from '../../desktop/src/renderer/lib/features/chat/Message.svelte';
  import AgentActivity from '../../desktop/src/renderer/lib/features/chat/AgentActivity.svelte';
  import type {ChatMessage} from '../../desktop/src/renderer/lib/features/chat/ChatPane.svelte';
  import Icon from '../../desktop/src/renderer/lib/shared/components/Icon.svelte';
  import {activityTrailSplits} from '../../desktop/src/renderer/lib/features/chat/activities';
  import {scrollFade} from '../../desktop/src/renderer/lib/shared/scrollFade';
  let snapshot: {title: string; messages: ChatMessage[]; expiresAt: number} | null = null;
  // A steered run's work is cut around the steer, exactly as the app draws it.
  $: trail = activityTrailSplits(snapshot?.messages ?? []);
  let state = 'Loading conversation…';
  let column: HTMLDivElement;
  let jump = false;
  onMount(() => {
    const controller = new AbortController();
    const checkExpiry = () => {
      if (snapshot && snapshot.expiresAt <= Date.now()) { snapshot = null; state = 'Conversation can’t be found or has expired.'; }
    };
    window.addEventListener('pageshow', checkExpiry);
    document.addEventListener('visibilitychange', checkExpiry);
    let expiry: ReturnType<typeof setTimeout>;
    const id = location.pathname.split('/').filter(Boolean)[1] ?? '';
    async function load() {
      try {
        if (!/^[A-Za-z0-9_-]{32}$/.test(id)) { state = 'Conversation can’t be found or has expired.'; return; }
        const response = await fetch(`/api/shares?id=${encodeURIComponent(id)}`, {cache: 'no-store', signal: controller.signal});
        if (response.status === 404) { state = 'Conversation can’t be found or has expired.'; return; }
        if (!response.ok) throw new Error('unavailable');
        const data = await response.json();
        if (data.expiresAt <= Date.now()) { state = 'Conversation can’t be found or has expired.'; return; }
        snapshot = data;
        document.title = `${data.title} · Polymux`;
        expiry = setTimeout(() => { snapshot = null; state = 'Conversation can’t be found or has expired.'; }, Math.max(0, data.expiresAt - Date.now()));
      } catch { if (!controller.signal.aborted) state = 'Conversation could not be loaded. Please try again.'; }
    }
    void load();
    return () => { controller.abort(); clearTimeout(expiry); window.removeEventListener('pageshow', checkExpiry); document.removeEventListener('visibilitychange', checkExpiry); };
  });
</script>
<svelte:head><meta name="robots" content="noindex,nofollow,noarchive"/></svelte:head>
{#if snapshot}
  <header class="share-heading"><span>{snapshot.title}</span><a href="/">Polymux</a></header>
  <div class="conversation-column shared-column" bind:this={column} use:scrollFade onscroll={() => jump = column.scrollHeight - column.scrollTop - column.clientHeight > 160}>
    <div class="message-list">
      {#each snapshot.messages as message (message.id)}
        {@const earlier = trail.above.get(message.id)}
        {@const later = trail.tail.get(message.id)}
        {@const activities = later?.activities ?? message.activities ?? []}
        {@const activityVisible = message.role === 'assistant' && Boolean(activities.length)}
        {#if earlier?.activities.length}<AgentActivity activities={earlier.activities} startedAt={earlier.startedAt} completedAt={earlier.completedAt ?? earlier.startedAt}/>{/if}
        {#if activityVisible}<AgentActivity activities={activities} startedAt={later?.startedAt ?? message.startedAt} completedAt={message.completedAt ?? message.startedAt}/>{/if}
        <Message {message} {activityVisible} readOnly publicView/>
      {/each}
    </div>
  </div>
  {#if jump}<button class="scroll-to-latest" type="button" aria-label="Scroll to bottom" onclick={() => column.scrollTo({top: column.scrollHeight, behavior: 'smooth'})}><Icon name="arrow-down" size={18}/></button>{/if}
{:else}
  <div class="shared-empty" role="status">{state}</div>
{/if}
<style>
  .share-heading { position: fixed; top: 0; inset-inline: 0; height: var(--app-topbar-height); display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 0 24px; background: var(--app-bg); z-index: 1; }
  .share-heading span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 14px; }
  .share-heading a { color: var(--secondary); text-decoration: none; font-size: 13px; }
  .shared-column { width: min(792px, calc(100vw - 8px)); height: calc(100dvh - var(--app-topbar-height)); margin-top: var(--app-topbar-height); }
  .message-list { padding-top: 36px; padding-bottom: 36px; }
  .shared-empty { display: grid; place-items: center; min-height: 100dvh; padding: 24px; text-align: center; color: var(--secondary); }
  .scroll-to-latest { bottom: 24px; }
</style>
