<script lang="ts">
  import {tick} from 'svelte';
  import type {ChatEntry} from './ChatDrawer.svelte';
  import Icon from '../shared/Icon.svelte';

  export let chats: ChatEntry[] = [];
  export let onOpen: (id: string) => void = () => {};
  export let onClose: () => void = () => {};

  let query = '';
  let cursor = 0;
  let list: HTMLElement;
  let atTop = true;
  let atBottom = true;

  $: results = filter(chats, query);
  // Re-measure whenever the result set changes under the scroller.
  $: if (list && results) void tick().then(measureEdges);
  // Keep the highlight inside the result set as it shrinks under typing.
  $: if (cursor > results.length - 1) cursor = Math.max(0, results.length - 1);

  function filter(entries: ChatEntry[], text: string): ChatEntry[] {
    const needle = text.trim().toLowerCase();
    const matched = needle ? entries.filter((chat) => chat.title.toLowerCase().includes(needle)) : entries.slice();
    return matched.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
  }

  function measureEdges(): void {
    if (!list) return;
    atTop = list.scrollTop <= 1;
    atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= 1;
  }

  function focusInput(node: HTMLInputElement): void {
    void tick().then(() => node.focus());
  }

  function move(delta: number): void {
    if (!results.length) return;
    cursor = (cursor + delta + results.length) % results.length;
    void tick().then(() => {
      list?.querySelector('[aria-selected="true"]')?.scrollIntoView({block: 'nearest'});
      measureEdges();
    });
  }

  function choose(id: string): void {
    onOpen(id);
    onClose();
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter' && results[cursor]) {
      event.preventDefault();
      choose(results[cursor].id);
    }
  }
</script>

<svelte:window onkeydown={keydown}/>

<div
  class="chat-search-backdrop"
  role="presentation"
  onclick={(event) => { if (event.target === event.currentTarget) onClose(); }}
>
  <div class="chat-search" role="dialog" aria-modal="true" aria-label="Search chats">
    <div class="chat-search-field">
      <Icon name="search" size={16}/>
      <input
        bind:value={query}
        use:focusInput
        type="text"
        placeholder="Search chats"
        aria-label="Search chats"
        aria-controls="chat-search-results"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    {#if results.length}
      <ul
        bind:this={list}
        class:at-top={atTop}
        class:at-bottom={atBottom}
        id="chat-search-results"
        role="listbox"
        aria-label="Results"
        onscroll={measureEdges}
      >
        {#each results as chat, index (chat.id)}
          <li role="option" aria-selected={index === cursor}>
            <button type="button" data-tooltip="none" onmouseenter={() => cursor = index} onclick={() => choose(chat.id)}>
              <span>{chat.title}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="chat-search-empty">
        {query.trim() ? `No chats match “${query.trim()}”.` : 'No chats yet.'}
      </p>
    {/if}
  </div>
</div>

<style>
  .chat-search-backdrop{position:fixed;z-index:1000;inset:0;display:grid;justify-items:center;align-items:center;padding:24px;background:rgba(20,20,20,.24);backdrop-filter:blur(5px);animation:chat-search-backdrop-in .16s ease-out}
  .chat-search{width:min(520px,100%);height:min(348px,68vh);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--neutral-200);border-radius:16px;background:var(--app-bg);box-shadow:0 24px 80px rgba(0,0,0,.3);animation:chat-search-in .2s cubic-bezier(.22,1,.36,1)}
  .chat-search-field{flex:none;display:flex;align-items:center;gap:9px;padding:13px 16px;border-bottom:1px solid var(--neutral-200);color:var(--neutral-500)}
  .chat-search-field input{min-width:0;flex:1;border:0;padding:0;background:transparent;color:var(--neutral-950);font-family:inherit;font-size:14px}
  .chat-search-field input:focus{outline:0}
  .chat-search-field input::placeholder{color:var(--neutral-400)}
  .chat-search ul{--mask-top:transparent;--mask-bottom:transparent;min-height:0;flex:1;overflow-y:auto;margin:0;padding:6px;list-style:none;-webkit-mask-image:linear-gradient(to bottom,var(--mask-top),#000 18px,#000 calc(100% - 18px),var(--mask-bottom));mask-image:linear-gradient(to bottom,var(--mask-top),#000 18px,#000 calc(100% - 18px),var(--mask-bottom))}
  .chat-search ul.at-top{--mask-top:#000}
  .chat-search ul.at-bottom{--mask-bottom:#000}
  .chat-search li button{width:100%;display:flex;align-items:center;min-height:34px;border:0;border-radius:9px;padding:0 10px;background:transparent;color:var(--neutral-800);cursor:pointer;text-align:left;font-family:inherit;font-size:13px}
  .chat-search li button>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .chat-search li[aria-selected="true"] button,.chat-search li button:focus-visible{outline:0;background:var(--neutral-100);color:var(--neutral-950)}
  .chat-search-empty{min-height:0;flex:1;display:flex;align-items:center;justify-content:center;margin:0;padding:26px 16px;color:var(--neutral-400);text-align:center;font-size:12.5px}
  @keyframes chat-search-backdrop-in{from{opacity:0}}
  @keyframes chat-search-in{from{opacity:0;transform:translateY(-8px) scale(.99)}}
</style>
