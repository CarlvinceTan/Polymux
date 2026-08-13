<script lang="ts">
  export let title = 'New chat';
  export let historyOpen = false;
  export let panel: 'none' | 'summary' | 'workspace' = 'none';
  export let onRename: (title: string) => void = () => {};
  export let onToggleHistory: () => void = () => {};
  export let onNewChat: () => void = () => {};
  export let onToggleSummary: () => void = () => {};
  export let onToggleWorkspace: () => void = () => {};

  let editing = false;
  let draft = '';
  let input: HTMLInputElement;

  async function startRename(): Promise<void> {
    draft = title;
    editing = true;
    await Promise.resolve();
    input?.focus();
    input?.select();
  }

  function save(): void {
    const next = draft.trim();
    editing = false;
    if (next && next !== title) onRename(next);
  }
</script>

<header class="title-bar">
  <div class="controls left-controls">
    {#if !historyOpen}
      <button type="button" aria-label="Show History" onclick={onToggleHistory}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M7 4v12"/></svg>
      </button>
      <button type="button" aria-label="New chat" onclick={onNewChat}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4 3v-3.5A2.5 2.5 0 0 1 4 11.5z"/><path d="M10 6v5M7.5 8.5h5"/></svg>
      </button>
    {/if}
  </div>

  <div class="title-slot">
    {#if editing}
      <input bind:this={input} bind:value={draft} aria-label="Conversation title" onblur={save} onkeydown={(event) => {
        if (event.key === 'Enter') save();
        if (event.key === 'Escape') editing = false;
      }}/>
    {:else}
      <button class="title-button" type="button" title="Rename conversation" onclick={startRename}>{title}</button>
    {/if}
  </div>

  <div class="controls right-controls">
    <button type="button" class:active={panel === 'summary'} aria-label={panel === 'summary' ? 'Hide Summary' : 'Show Summary'} onclick={onToggleSummary}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5h10v13H5z"/><path d="M8 7h4M8 10h5M8 13h3"/></svg>
    </button>
    <button type="button" class:active={panel === 'workspace'} aria-label={panel === 'workspace' ? 'Hide Workspace' : 'Show Workspace'} onclick={onToggleWorkspace}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M12.5 4v12"/></svg>
    </button>
  </div>
</header>

<style>
  .title-bar { position: relative; z-index: 100; height: 50px; display: grid; grid-template-columns: 1fr minmax(120px, 520px) 1fr; align-items: center; flex: none; border-bottom: 1px solid rgb(0 0 0 / 9%); padding: 0 12px; background: rgb(255 255 255 / 88%); backdrop-filter: blur(18px); -webkit-app-region: drag; }
  .controls { display: flex; align-items: center; gap: 4px; -webkit-app-region: no-drag; }
  .left-controls { min-height: 32px; padding-left: 76px; }
  .right-controls { justify-content: flex-end; }
  button { border: 0; font: inherit; }
  .controls button { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 9px; padding: 0; background: transparent; color: #737373; cursor: pointer; }
  .controls button:hover, .controls button:focus-visible, .controls button.active { outline: none; background: #f1f1f1; color: #171717; }
  svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .title-slot { min-width: 0; display: flex; justify-content: center; -webkit-app-region: no-drag; }
  .title-button, input { max-width: 100%; overflow: hidden; border: 1px solid transparent; border-radius: 8px; padding: 5px 9px; background: transparent; color: #262626; font-size: 13px; font-weight: 560; text-overflow: ellipsis; white-space: nowrap; }
  .title-button { cursor: text; }
  .title-button:hover { background: #f5f5f5; }
  input { width: min(100%, 420px); border-color: #d4d4d4; outline: none; background: white; text-align: center; }
  @media (max-width: 560px) { .title-bar { grid-template-columns: auto 1fr auto; padding: 0 7px; } .left-controls { padding-left: 76px; } .controls { gap: 1px; } }
</style>
