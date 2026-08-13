<script module lang="ts">
  export type SummarySection = 'outputs' | 'references' | 'tasks';
  export type OutputItem = {id: string; name: string};
  export type ReferenceItem = {id: string; title: string; kind?: 'web' | 'file' | 'other'};
  export type TaskItem = {id: string; title: string; status: 'pending' | 'active' | 'completed' | 'failed'};
</script>

<script lang="ts">
  export let outputs: OutputItem[] = [];
  export let references: ReferenceItem[] = [];
  export let tasks: TaskItem[] = [];
  export let onOpenOutput: (output: OutputItem) => void = () => {};
  export let onOpenReference: (reference: ReferenceItem) => void = () => {};
  export let onViewAll: (section: SummarySection) => void = () => {};
  export let onCreateOutput: (kind: 'document' | 'presentation' | 'spreadsheet') => void = () => {};
  export let onAttachReferences: (files: File[]) => void = () => {};

  const previewLimit = 4;
  let outputMenuOpen = false;
  let fileInput: HTMLInputElement;

  function selectedFiles(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length) onAttachReferences(files);
    input.value = '';
  }

  function createOutput(kind: 'document' | 'presentation' | 'spreadsheet'): void {
    outputMenuOpen = false;
    onCreateOutput(kind);
  }
</script>

<aside class="summary-panel" aria-label="Summary">
  <input bind:this={fileInput} class="visually-hidden" type="file" multiple onchange={selectedFiles}/>

  <section>
    <header>
      <h2>Outputs</h2>
      <div class="menu-wrap">
        <button type="button" aria-label="Add output" aria-haspopup="menu" aria-expanded={outputMenuOpen} onclick={() => outputMenuOpen = !outputMenuOpen}>+</button>
        {#if outputMenuOpen}
          <div class="action-menu" role="menu">
            <button role="menuitem" onclick={() => createOutput('document')}>Create document</button>
            <button role="menuitem" onclick={() => createOutput('presentation')}>Create presentation</button>
            <button role="menuitem" onclick={() => createOutput('spreadsheet')}>Create spreadsheet</button>
          </div>
        {/if}
      </div>
    </header>
    {#if outputs.length}
      {#each outputs.slice(0, previewLimit) as output (output.id)}
        <button class="summary-row" type="button" onclick={() => onOpenOutput(output)}><span class="item-mark">◇</span><span>{output.name}</span></button>
      {/each}
      {#if outputs.length > previewLimit}<button class="view-all" type="button" onclick={() => onViewAll('outputs')}><span>View all</span><span>→</span></button>{/if}
    {:else}<p class="empty-row">Files created by Midas appear here.</p>{/if}
  </section>

  <section>
    <header><h2>References</h2><button type="button" aria-label="Add references" onclick={() => fileInput.click()}>+</button></header>
    {#if references.length}
      {#each references.slice(0, previewLimit) as reference (reference.id)}
        <button class="summary-row muted" type="button" onclick={() => onOpenReference(reference)}><span class="item-mark">{reference.kind === 'web' ? '◎' : '◇'}</span><span>{reference.title}</span></button>
      {/each}
      {#if references.length > previewLimit}<button class="view-all" type="button" onclick={() => onViewAll('references')}><span>View all</span><span>→</span></button>{/if}
    {:else}<p class="empty-row">Sources used by the agent appear here.</p>{/if}
  </section>

  <section>
    <header><h2>Tasks</h2></header>
    {#if tasks.length}
      {#each tasks.slice(0, previewLimit) as task (task.id)}
        <div class="task-row"><span class={`status-dot ${task.status}`} title={task.status}></span><strong>{task.title}</strong></div>
      {/each}
      {#if tasks.length > previewLimit}<button class="view-all" type="button" onclick={() => onViewAll('tasks')}><span>View all</span><span>→</span></button>{/if}
    {:else}<p class="empty-row">Agent work appears here.</p>{/if}
  </section>
</aside>

<style>
  .summary-panel { position: fixed; z-index: 25; top: calc(var(--app-topbar-height, 48px) + 16px); right: 16px; width: min(301px, calc(100vw - 32px)); max-height: calc(100vh - var(--app-topbar-height, 48px) - 32px); overflow-y: auto; border: 1px solid var(--neutral-200, #e5e5e5); border-radius: 20px; padding: 15px; background: var(--neutral-50, #fafafa); }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  section { padding: 14px 0 15px; border-bottom: 1px solid var(--neutral-200, #e5e5e5); }
  section:first-of-type { padding-top: 0; }
  section:last-of-type { padding-bottom: 0; border-bottom: 0; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  h2 { margin: 0; color: var(--neutral-800, #262626); font-size: 13px; font-weight: 560; }
  header > button, .menu-wrap > button { width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 7px; padding: 0; background: transparent; color: var(--neutral-500, #737373); cursor: pointer; font-size: 18px; }
  header button:hover { background: var(--neutral-200, #e5e5e5); color: var(--neutral-900, #171717); }
  .menu-wrap { position: relative; }
  .action-menu { position: absolute; z-index: 90; top: calc(100% + 4px); right: 0; width: 190px; padding: 4px; border-radius: 11px; background: #fff; box-shadow: 0 5px 18px rgb(0 0 0 / 10%); }
  .action-menu button { width: 100%; border: 0; border-radius: 8px; padding: 8px; background: transparent; color: var(--neutral-800, #262626); cursor: pointer; text-align: left; }
  .action-menu button:hover { background: var(--neutral-100, #f5f5f5); }
  .summary-row { width: 100%; min-width: 0; display: flex; align-items: center; gap: 9px; border: 0; border-radius: 10px; padding: 5px; background: transparent; color: var(--neutral-900, #171717); cursor: pointer; font-size: 12.5px; text-align: left; }
  .summary-row:hover, .summary-row:focus-visible { outline: none; background: var(--neutral-200, #e5e5e5); }
  .summary-row span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .summary-row.muted { color: var(--neutral-700, #404040); }
  .item-mark { width: 24px; height: 24px; display: grid; flex: none; place-items: center; border: 1px solid var(--neutral-200, #e5e5e5); border-radius: 6px; background: #fff; color: var(--neutral-600, #525252); }
  .view-all { width: 100%; display: flex; align-items: center; justify-content: space-between; margin-top: 2px; border: 0; border-radius: 10px; padding: 5px; background: transparent; color: var(--neutral-600, #525252); cursor: pointer; font-size: 11.5px; }
  .view-all:hover { color: var(--neutral-900, #171717); background: var(--neutral-200, #e5e5e5); }
  .task-row { display: flex; align-items: center; gap: 9px; padding: 7px 5px; color: var(--neutral-900, #171717); font-size: 12.5px; }
  .task-row strong { overflow: hidden; font-weight: 520; text-overflow: ellipsis; white-space: nowrap; }
  .status-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--neutral-400, #a3a3a3); }
  .status-dot.active { background: #d58b1f; }
  .status-dot.completed { background: #2f8f57; }
  .status-dot.failed { background: #b42318; }
  .empty-row { margin: 7px 5px; color: var(--neutral-500, #737373); font-size: 11.5px; line-height: 1.45; }

  @media (max-width: 640px) { .summary-panel { top: 64px; right: 12px; width: calc(100vw - 24px); border-radius: 18px; } }
</style>
