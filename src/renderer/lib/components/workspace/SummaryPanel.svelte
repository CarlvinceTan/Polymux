<script module lang="ts">
  export type SummarySection = 'outputs' | 'references' | 'tasks';
  export type OutputItem = {id: string; name: string};
  export type ReferenceItem = {id: string; title: string; kind?: 'web' | 'file' | 'other'; uri?: string};
  export type TaskItem = {id: string; title: string; status: 'pending' | 'active' | 'completed' | 'failed'};
</script>

<script lang="ts">
  import {taskStatusLabel, taskStatusTone} from '../../conversation/taskStatus';
  import Icon from '../shared/Icon.svelte';

  export let outputs: OutputItem[] = [];
  export let references: ReferenceItem[] = [];
  export let tasks: TaskItem[] = [];
  export let onOpenOutput: (output: OutputItem) => void = () => {};
  export let onOpenReference: (reference: ReferenceItem) => void = () => {};
  export let onViewAll: (section: SummarySection) => void = () => {};
  export let onAttachReferences: (files: File[]) => void = () => {};

  /** Four rows per section; anything beyond that is behind View all. */
  const previewLimit = 4;

  let referenceMenuOpen = false;
  let referenceMenuWrapper: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let folderInput: HTMLInputElement;

  function closeMenus(): void {
    referenceMenuOpen = false;
  }

  function toggleReferenceMenu(): void {
    referenceMenuOpen = !referenceMenuOpen;
  }

  function selectedFiles(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length) onAttachReferences(files);
    input.value = '';
    closeMenus();
  }

  function dismissMenus(event: MouseEvent | KeyboardEvent): void {
    if (event instanceof KeyboardEvent) {
      if (event.key === 'Escape') closeMenus();
      return;
    }
    const target = event.target as Node;
    if (referenceMenuWrapper?.contains(target)) return;
    closeMenus();
  }
</script>

<svelte:window onclick={dismissMenus} onkeydown={dismissMenus}/>

<aside class="summary-panel" aria-label="Summary">
  <input bind:this={fileInput} class="visually-hidden" type="file" multiple onchange={selectedFiles}/>
  <input bind:this={folderInput} class="visually-hidden" type="file" multiple webkitdirectory={true} onchange={selectedFiles}/>

  <section>
    <header>
      <!-- Outputs are what Midas produced, so there is nothing to add by hand:
           an empty editor here would be a file that does not exist yet. -->
      <h2>Outputs</h2>
    </header>
    {#if outputs.length}
      {#each outputs.slice(0, previewLimit) as output (output.id)}
        <button type="button" class="summary-row" onclick={() => onOpenOutput(output)}><span class="mini-file"><Icon name="file" size={14}/></span><span>{output.name}</span></button>
      {/each}
      {#if outputs.length > previewLimit}<button type="button" class="summary-view-all" onclick={() => onViewAll('outputs')}><span>View all</span><Icon name="forward" size={12}/></button>{/if}
    {:else}<p class="empty-row">Files created by Midas appear here.</p>{/if}
  </section>

  <section>
    <header>
      <h2>References</h2>
      <div bind:this={referenceMenuWrapper} class="summary-menu-wrap">
        <button type="button" aria-label="Add reference" data-tooltip-align="end" aria-haspopup="menu" aria-expanded={referenceMenuOpen} onclick={toggleReferenceMenu}><Icon name="plus" size={18}/></button>
        {#if referenceMenuOpen}
          <div class="polymux-dropdown-menu summary-action-menu reference-action-menu" role="menu">
            <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => fileInput.click()}><Icon name="file" size={15}/><span>Choose files</span></button>
            <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => folderInput.click()}><Icon name="folder" size={15}/><span>Choose folder</span></button>
          </div>
        {/if}
      </div>
    </header>
    {#if references.length}
      {#each references.slice(0, previewLimit) as reference (reference.id)}
        <button type="button" class="summary-row muted" onclick={() => onOpenReference(reference)}><Icon name={reference.kind === 'web' ? 'globe' : 'task'} size={16}/><span>{reference.title}</span></button>
      {/each}
      {#if references.length > previewLimit}<button type="button" class="summary-view-all" onclick={() => onViewAll('references')}><span>View all</span><Icon name="forward" size={12}/></button>{/if}
    {:else}<p class="empty-row">Sources used by the agent appear here.</p>{/if}
  </section>

  <section>
    <header><h2>Tasks</h2></header>
    {#if tasks.length}
      {#each tasks.slice(0, previewLimit) as task (task.id)}
        <div class="task-row"><span class={`status-dot ${taskStatusTone(task.status)}`} title={taskStatusLabel(task.status)}></span><strong>{task.title}</strong></div>
      {/each}
      {#if tasks.length > previewLimit}<button type="button" class="summary-view-all" onclick={() => onViewAll('tasks')}><span>View all</span><Icon name="forward" size={12}/></button>{/if}
    {:else}<p class="empty-row">Delegated work appears here.</p>{/if}
  </section>
</aside>
