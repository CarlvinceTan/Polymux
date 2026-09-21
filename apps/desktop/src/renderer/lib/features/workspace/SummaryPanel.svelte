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
  import type {BotDto, ScheduleDto} from '@polymux/protocol';
  import {describeFrequency, formatScheduleTime, scheduleStatusLabel} from './ScheduleView.svelte';
  import type {AgentActivityItem} from '../chat/AgentActivity.svelte';
  import {taskStatusLabel} from './taskStatus';
  import LiveActivityPreview from '../../shared/components/LiveActivityPreview.svelte';
  import TaskGlyph from '../../shared/components/TaskGlyph.svelte';
  import {scrollFade} from '../../shared/scrollFade';
  import OpenMenu, {type OpenAnchor} from '../../shared/components/OpenMenu.svelte';
  import Icon from '../../shared/components/Icon.svelte';
  import {t} from '../../../i18n';
  import {referenceCopy} from './referenceDisplay';

  export let bot: BotDto | null = null;
  export let schedules: ScheduleDto[] = [];
  export let onEditBot: () => void = () => {};
  export let onOpenSchedules: () => void = () => {};
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
  let referenceAnchor: OpenAnchor | null = null;
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
    referenceAnchor = null;
  }

  function toggleReferenceMenu(event: MouseEvent): void {
    referenceMenuOpen = !referenceMenuOpen;
    referenceAnchor = referenceMenuOpen ? {rect: (event.currentTarget as HTMLElement).getBoundingClientRect()} : null;
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

  <div class="summary-panel-content" use:scrollFade>
  {#if bot}
    <section>
      <header><h2>{bot.name}</h2><button type="button" aria-label={`Edit ${bot.name} settings`} data-tooltip-label="Settings" onclick={onEditBot}><Icon name="settings" size={18}/></button></header>
      <button type="button" class="summary-row stacked" onclick={onEditBot} aria-label={`Computer and access for ${bot.name}`}>
        <span class="mini-file"><Icon name="computer" size={15}/></span>
        <span class="summary-row-copy"><strong>{bot.hostName}</strong><small>{bot.role}</small></span>
      </button>
      <p class="empty-row">{bot.status === 'working' ? 'Working' : bot.status === 'idle' ? 'Ready' : bot.status === 'waiting-for-device' ? 'Waiting for device access' : bot.status === 'computer-offline' ? 'Computer offline' : 'Needs attention'}</p>
    </section>
    <section>
      <header><h2>Schedule</h2><button type="button" aria-label={`Open ${bot.name} schedule`} data-tooltip-label="Schedule" onclick={onOpenSchedules}><Icon name="calendar" size={18}/></button></header>
      {#each schedules.slice(0, previewLimit) as item (item.id)}
        <button type="button" class="summary-row stacked" onclick={onOpenSchedules}>
          <span class="mini-file"><Icon name="clock" size={15}/></span>
          <span class="summary-row-copy"><strong>{item.title}</strong><small>{item.status === 'active' && item.nextRunAt ? formatScheduleTime(item.nextRunAt) : scheduleStatusLabel(item.status)} · {describeFrequency(item.frequency)}</small></span>
        </button>
      {:else}<p class="empty-row">No schedules yet</p>{/each}
      <button type="button" class="summary-view-all" onclick={onOpenSchedules}><span>{schedules.length ? 'Manage schedule' : 'Add a schedule'}</span><Icon name="forward" size={12}/></button>
    </section>
  {/if}

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
    {:else}<p class="empty-row">{bot ? `Files created by ${bot.name} appear here.` : $t('summary.outputsEmpty')}</p>{/if}
  </section>

  <section>
    <header>
      <h2>{$t('summary.references')}</h2>
      <div bind:this={referenceMenuWrapper} class="summary-menu-wrap">
        <button type="button" aria-label={$t('summary.addReference')} data-tooltip-align="end" aria-haspopup="menu" aria-expanded={referenceMenuOpen} onclick={toggleReferenceMenu}><Icon name="plus" size={18}/></button>

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
    {:else}<p class="empty-row">{bot ? `Sources used by ${bot.name} appear here.` : $t('summary.referencesEmpty')}</p>{/if}
  </section>

  {#if bot || computerPreviews.length}
    <section class="summary-preview-section">
      <header><h2>{$t('summary.computerUse')}</h2></header>
      {#if !computerPreviews.length}<p class="empty-row">No computer activity yet</p>{/if}
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

  {#if bot || browserPreviews.length}
    <section class="summary-preview-section">
      <header><h2>{$t('summary.browserUse')}</h2></header>
      {#if !browserPreviews.length}<p class="empty-row">No browser activity yet</p>{/if}
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

  {#if !bot}
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
  {/if}
  </div>
</aside>

<OpenMenu choices={[{value: 'files', label: $t('summary.chooseFiles'), icon: 'file'}, {value: 'folder', label: $t('summary.chooseFolder'), icon: 'folder'}]}
  anchor={referenceAnchor} ariaLabel={$t('summary.addReference')}
  onChoose={(value) => { if (value === 'files') fileInput.click(); else folderInput.click(); closeMenus(); }} onClose={closeMenus}/>
