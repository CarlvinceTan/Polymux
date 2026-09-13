<script module lang="ts">
  import type {ActivityPreviewRequestDto} from '@polymux/protocol';

  export type SummarySection = 'outputs' | 'references' | 'tasks';
  /** `uri` is where the produced file can be read from, when the host has
   * granted one. Absent for an output that is only named. */
  export type OutputItem = {id: string; name: string; uri?: string};
  export type ReferenceItem = {id: string; title: string; kind?: 'web' | 'file' | 'other'; uri?: string};
  export type TaskItem = {id: string; title: string; status: 'pending' | 'active' | 'completed' | 'failed'; runId?: string; prompt?: string};
  type PreviewRow = {id: string; label: string; source: ActivityPreviewRequestDto};
</script>

<script lang="ts">
  import type {AgentActivityItem} from '../chat/AgentActivity.svelte';
  import {taskStatusLabel} from './taskStatus';
  import LiveActivityPreview from '../../shared/components/LiveActivityPreview.svelte';
  import TaskGlyph from '../../shared/components/TaskGlyph.svelte';
  import Icon from '../../shared/components/Icon.svelte';
  import {t} from '../../../i18n';
  import {referenceCopy} from './referenceDisplay';

  export let outputs: OutputItem[] = [];
  export let references: ReferenceItem[] = [];
  export let tasks: TaskItem[] = [];
  export let activities: AgentActivityItem[] = [];
  export let onOpenOutput: (output: OutputItem) => void = () => {};
  export let onOpenReference: (reference: ReferenceItem) => void = () => {};
  export let onOpenTask: (task: TaskItem) => void = () => {};
  export let onViewAll: (section: SummarySection) => void = () => {};
  export let onAttachReferences: (files: File[]) => void = () => {};
  export let onOpenSubagents: () => void = () => {};

  /** Four rows per section; anything beyond that is behind View all. */
  const previewLimit = 4;

  let referenceMenuOpen = false;
  let openPreviewId: string | null = null;
  let referenceMenuWrapper: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let folderInput: HTMLInputElement;

  $: computerPreviews = previewRows(activities, 'computer');
  $: browserPreviews = previewRows(activities, 'browser');
  $: availablePreviewIds = new Set([...computerPreviews, ...browserPreviews].map((row) => row.id));
  $: if (openPreviewId && !availablePreviewIds.has(openPreviewId)) openPreviewId = null;

  function previewRows(sourceActivities: AgentActivityItem[], kind: ActivityPreviewRequestDto['kind']): PreviewRow[] {
    const rows = new Map<string, PreviewRow>();
    for (const activity of sourceActivities) {
      if (activity.preview?.kind !== kind) continue;
      const sourceId = activity.preview.kind === 'browser' ? activity.preview.tabId : activity.preview.runId;
      if (!sourceId) continue;
      const id = `${kind}:${sourceId}`;
      rows.delete(id);
      rows.set(id, {
        id,
        label: activity.target || activity.label,
        source: activity.preview,
      });
    }
    return [...rows.values()].slice(-previewLimit).reverse();
  }

  function togglePreview(id: string): void {
    openPreviewId = openPreviewId === id ? null : id;
  }

  function previewElementId(id: string): string {
    return `summary-preview-${id.replace(/[^a-z0-9_-]/gi, '-')}`;
  }

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
      <!-- Outputs are what Polymux produced, so there is nothing to add by hand:
           an empty editor here would be a file that does not exist yet. -->
      <h2>{$t('summary.outputs')}</h2>
    </header>
    {#if outputs.length}
      {#each outputs.slice(0, previewLimit) as output (output.id)}
        <button type="button" class="summary-row" onclick={() => onOpenOutput(output)}><span class="mini-file"><Icon name="file" size={15}/></span><span>{output.name}</span></button>
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
          <div class="polymux-dropdown-menu summary-action-menu reference-action-menu" role="menu">
            <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => fileInput.click()}><Icon name="file" size={15}/><span>{$t('summary.chooseFiles')}</span></button>
            <button type="button" class="polymux-dropdown-item" role="menuitem" onclick={() => folderInput.click()}><Icon name="folder" size={15}/><span>{$t('summary.chooseFolder')}</span></button>
          </div>
        {/if}
      </div>
    </header>
    {#if references.length}
      {#each references.slice(0, previewLimit) as reference (reference.id)}
        {@const copy = referenceCopy(reference)}
        <button
          type="button"
          class="summary-row"
          class:stacked={Boolean(copy.detail)}
          aria-label={copy.detail ? `${copy.title} ${copy.detail}` : copy.title}
          onclick={() => onOpenReference(reference)}
        >
          <span class="mini-file"><Icon name={reference.kind === 'web' ? 'globe' : 'task'} size={15}/></span>
          {#if copy.detail}
            <span class="summary-row-copy">
              <strong>{copy.title}</strong>
              <small>{copy.detail}</small>
            </span>
          {:else}
            <span>{copy.title}</span>
          {/if}
        </button>
      {/each}
      {#if references.length > previewLimit}<button type="button" class="summary-view-all" onclick={() => onViewAll('references')}><span>{$t('summary.viewAll')}</span><Icon name="forward" size={12}/></button>{/if}
    {:else}<p class="empty-row">{$t('summary.referencesEmpty')}</p>{/if}
  </section>

  {#if computerPreviews.length}
    <section class="summary-preview-section">
      <header><h2>{$t('summary.computerUse')}</h2></header>
      {#each computerPreviews as preview (preview.id)}
        <button
          type="button"
          class="summary-row summary-preview-row"
          aria-label={preview.label}
          aria-expanded={openPreviewId === preview.id}
          aria-controls={previewElementId(preview.id)}
          onclick={() => togglePreview(preview.id)}
        >
          <span class="summary-preview-heading">
            <span class="mini-file"><Icon name="computer" size={15}/></span>
            <span class="summary-preview-label">{preview.label}</span>
          </span>
          {#if openPreviewId === preview.id}
            <span id={previewElementId(preview.id)} class="summary-preview-body">
              <LiveActivityPreview source={preview.source}/>
            </span>
          {/if}
        </button>
      {/each}
    </section>
  {/if}

  {#if browserPreviews.length}
    <section class="summary-preview-section">
      <header><h2>{$t('summary.browserUse')}</h2></header>
      {#each browserPreviews as preview (preview.id)}
        <button
          type="button"
          class="summary-row summary-preview-row"
          aria-label={preview.label}
          aria-expanded={openPreviewId === preview.id}
          aria-controls={previewElementId(preview.id)}
          onclick={() => togglePreview(preview.id)}
        >
          <span class="summary-preview-heading">
            <span class="mini-file"><Icon name="globe" size={15}/></span>
            <span class="summary-preview-label">{preview.label}</span>
          </span>
          {#if openPreviewId === preview.id}
            <span id={previewElementId(preview.id)} class="summary-preview-body">
              <LiveActivityPreview source={preview.source}/>
            </span>
          {/if}
        </button>
      {/each}
    </section>
  {/if}

  <section>
    <header>
      <h2>{$t('summary.tasks')}</h2>
      <button type="button" aria-label={$t('workspace.subagents')} data-tooltip-align="end" onclick={onOpenSubagents}><Icon name="send" size={18}/></button>
    </header>
    {#if tasks.length}
      {#each tasks.slice(0, previewLimit) as task (task.id)}
        <!-- A task row opens its own workspace tab, where the subagent's run
             can be read; the dot alone said it was working and nothing else. -->
        <button type="button" class="task-row" onclick={() => onOpenTask(task)}><TaskGlyph id={task.id} status={task.status} label={taskStatusLabel(task.status)}/><strong>{task.title}</strong></button>
      {/each}
      {#if tasks.length > previewLimit}<button type="button" class="summary-view-all" onclick={() => onViewAll('tasks')}><span>{$t('summary.viewAll')}</span><Icon name="forward" size={12}/></button>{/if}
    {:else}<p class="empty-row">{$t('summary.tasksEmpty')}</p>{/if}
  </section>
</aside>
