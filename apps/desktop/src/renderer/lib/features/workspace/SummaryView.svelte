<script module lang="ts">
  export type SummaryViewSection = 'outputs' | 'references' | 'tasks';
  export type SummaryOutput = {id: string; name: string};
  export type SummaryReference = {id: string; title: string; kind?: 'web' | 'file' | 'other'};
  export type SummaryTask = {id: string; title: string; status: 'pending' | 'active' | 'completed' | 'failed'; runId?: string; prompt?: string};

  export type SummaryViewData = {
    outputs: SummaryOutput[];
    references: SummaryReference[];
    tasks: SummaryTask[];
  };
</script>

<script lang="ts">
  import {taskStatusLabel} from './taskStatus';
  import TaskGlyph from '../../shared/components/TaskGlyph.svelte';
  import Icon from '../../shared/components/Icon.svelte';
  import {t, type MessageKey} from '../../../i18n';

  const sectionTitles: Record<SummaryViewSection, MessageKey> = {
    outputs: 'summary.outputs',
    references: 'summary.references',
    tasks: 'summary.tasks',
  };

  export let section: SummaryViewSection;
  export let data: SummaryViewData;
  export let onOpenOutput: (output: SummaryOutput) => void = () => {};
  export let onOpenReference: (reference: SummaryReference) => void = () => {};
  export let onOpenTask: (task: SummaryTask) => void = () => {};

  $: title = $t(sectionTitles[section]);
</script>

<div class="summary-view">
  <header><h1>{title}</h1></header>
  <div class="summary-view-rows">
    {#if section === 'outputs'}
      {#each data.outputs as output (output.id)}
        <button type="button" class="summary-page-row" onclick={() => onOpenOutput(output)}>
          <span class="summary-page-icon"><Icon name="file" size={17}/></span><span>{output.name}</span>
        </button>
      {/each}
    {:else if section === 'references'}
      {#each data.references as reference (reference.id)}
        <button type="button" class="summary-page-row" onclick={() => onOpenReference(reference)}>
          <span class="summary-page-icon"><Icon name={reference.kind === 'web' ? 'globe' : 'task'} size={17}/></span><span>{reference.title}</span>
        </button>
      {/each}
    {:else}
      {#each data.tasks as task (task.id)}
        <button type="button" class="summary-page-row task" onclick={() => onOpenTask(task)}>
          <TaskGlyph id={task.id} status={task.status} size={17} label={taskStatusLabel(task.status)}/><strong>{task.title}</strong>
        </button>
      {/each}
    {/if}
  </div>
</div>
