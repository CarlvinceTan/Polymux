<script module lang="ts">
  export type SummarySection = 'outputs' | 'references' | 'tasks';
  export type OutputItem = {id: string; name: string};
  export type ReferenceItem = {id: string; title: string; kind?: 'web' | 'file' | 'other'; uri?: string};
  export type TaskItem = {id: string; title: string; status: 'pending' | 'active' | 'completed' | 'failed'};
</script>

<script lang="ts">
  import {taskStatusLabel, taskStatusTone} from '../../conversation/taskStatus';
  import Icon from '../shared/Icon.svelte';
  import {t} from '../../i18n';

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

<aside class="summary-panel" aria-label={$t('titlebar.summary')}>
  <input bind:this={fileInput} class="visually-hidden" type="file" multiple onchange={selectedFiles}/>
  <input bind:this={folderInput} class="visually-hidden" type="file" multiple webkitdirectory={true} onchange={selectedFiles}/>

  <section>
    <header>
      <!-- Outputs are what FlareAI produced, so there is nothing to add by hand:
           an empty editor here would be a file that does not exist yet. -->
      <h2>{$t('summary.outputs')}</h2>
    </header>
    {#if outputs.length}
      {#each outputs.slice(0, previewLimit) as output (output.id)}
        <button type="button" class="summary-row" onclick={() => onOpenOutput(output)}><span class="mini-file"><Icon name="file" size={14}/></span><span>{output.name}</span></button>
      {/each}
      {#if outputs.length > previewLimit}<button type="button" class="summary-view-all" onclick={() => onViewAll('outputs')}><span>{$t('summary.viewAll')}</span><Icon name="forward" size={12}/></button>{/if}
    {:else}<p class="empty-row">{$t('summary.outputsEmpty')}</p>{/if}
  </section>

  <section>
    <header>
      <h2>{$t('summary.references')}</h2>
      <div bind:this={referenceMenuWrapper} class="summary-menu-wrap">
        <button type="button" aria-label={$t('summary.addReference')} data-tooltip-align="end" aria-haspopup="menu" aria-expanded={referenceMenuOpen} onclick={toggleReferenceMenu}><Icon name="plus" size={18}/></button>
        {#if referenceMenuOpen}
          <div class="flareai-dropdown-menu summary-action-menu reference-action-menu" role="menu">
            <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => fileInput.click()}><Icon name="file" size={15}/><span>{$t('summary.chooseFiles')}</span></button>
            <button type="button" class="flareai-dropdown-item" role="menuitem" onclick={() => folderInput.click()}><Icon name="folder" size={15}/><span>{$t('summary.chooseFolder')}</span></button>
          </div>
        {/if}
      </div>
    </header>
    {#if references.length}
      {#each references.slice(0, previewLimit) as reference (reference.id)}
        <!-- Boxed like the output rows above: a bare glyph here rendered smaller
             than the framed file icon and sat at a different left edge. -->
        <button type="button" class="summary-row muted" onclick={() => onOpenReference(reference)}><span class="mini-file"><Icon name={reference.kind === 'web' ? 'globe' : 'task'} size={14}/></span><span>{reference.title}</span></button>
      {/each}
      {#if references.length > previewLimit}<button type="button" class="summary-view-all" onclick={() => onViewAll('references')}><span>{$t('summary.viewAll')}</span><Icon name="forward" size={12}/></button>{/if}
    {:else}<p class="empty-row">{$t('summary.referencesEmpty')}</p>{/if}
  </section>

  <section>
    <header><h2>{$t('summary.tasks')}</h2></header>
    {#if tasks.length}
      {#each tasks.slice(0, previewLimit) as task (task.id)}
        <div class="task-row"><span class={`status-dot ${taskStatusTone(task.status)}`} title={taskStatusLabel(task.status)}></span><strong>{task.title}</strong></div>
      {/each}
      {#if tasks.length > previewLimit}<button type="button" class="summary-view-all" onclick={() => onViewAll('tasks')}><span>{$t('summary.viewAll')}</span><Icon name="forward" size={12}/></button>{/if}
    {:else}<p class="empty-row">{$t('summary.tasksEmpty')}</p>{/if}
  </section>
</aside>
