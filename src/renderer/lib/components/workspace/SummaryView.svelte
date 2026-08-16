<script module lang="ts">
  export type SummaryViewSection = 'outputs' | 'references' | 'tasks';
  export type SummaryOutput = {id: string; name: string};
  export type SummaryReference = {id: string; title: string; kind?: 'web' | 'file' | 'other'};
  export type SummaryTask = {id: string; title: string; status: 'pending' | 'active' | 'completed' | 'failed'};

  export type SummaryViewData = {
    outputs: SummaryOutput[];
    references: SummaryReference[];
    tasks: SummaryTask[];
  };
</script>

<script lang="ts">
  import {taskStatusLabel, taskStatusTone} from '../../conversation/taskStatus';
  import Icon from '../shared/Icon.svelte';
  import {t, type MessageKey} from '../../i18n';

  const sectionTitles: Record<SummaryViewSection, MessageKey> = {
    outputs: 'summary.outputs',
    references: 'summary.references',
    tasks: 'summary.tasks',
  };

  export let section: SummaryViewSection;
  export let data: SummaryViewData;
  export let onOpenOutput: (output: SummaryOutput) => void = () => {};
  export let onOpenReference: (reference: SummaryReference) => void = () => {};

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
        <div class="summary-page-row task">
          <span class={`status-dot ${taskStatusTone(task.status)}`} title={taskStatusLabel(task.status)}></span><strong>{task.title}</strong>
        </div>
      {/each}
    {/if}
  </div>
</div>
