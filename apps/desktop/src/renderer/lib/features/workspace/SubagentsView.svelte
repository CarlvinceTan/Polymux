<script lang="ts">
  import TaskGlyph from '../../shared/components/TaskGlyph.svelte';
  import Icon from '../../shared/components/Icon.svelte';
  import {scrollFade} from '../../shared/scrollFade';
  import {taskStatusLabel} from './taskStatus';
  import type {SummaryViewData} from './SummaryView.svelte';
  import {t} from '../../../i18n';

  type Subagent = SummaryViewData['tasks'][number];

  let {
    subagents = [],
    onOpenSubagent = () => {},
  }: {
    subagents?: Subagent[];
    onOpenSubagent?: (subagent: Subagent) => void;
  } = $props();
</script>

<section class="subagents-view" aria-label={$t('workspace.subagents')}>
  {#if subagents.length}
    <div class="subagents-list" use:scrollFade={subagents.length}>
      {#each subagents as subagent (subagent.id)}
        <button type="button" class="subagent-row" onclick={() => onOpenSubagent(subagent)}>
          <TaskGlyph id={subagent.id} status={subagent.status} size={17}/>
          <span class="subagent-copy">
            <strong>{subagent.title}</strong>
            <small>{taskStatusLabel(subagent.status)}</small>
          </span>
          <Icon name="forward" size={13}/>
        </button>
      {/each}
    </div>
  {:else}
    <p class="subagents-empty">{$t('summary.tasksEmpty')}</p>
  {/if}
</section>

<style>
  .subagents-view{height:100%;min-height:0;display:flex;flex-direction:column}.subagents-list{min-height:0;flex:1;overflow-y:auto;padding:8px 10px;scrollbar-width:none}.subagents-list::-webkit-scrollbar{display:none}.subagent-row{width:100%;min-width:0;display:flex;align-items:flex-start;gap:8px;border:0;border-radius:8px;padding:9px 8px;background:none;color:var(--neutral-900);cursor:pointer;text-align:left;font-family:inherit}.subagent-row:hover,.subagent-row:focus-visible{outline:0;background:var(--neutral-100)}.subagent-row>:global(svg:first-child){flex:none;margin-top:1px}.subagent-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}.subagent-copy strong,.subagent-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.subagent-copy strong{font-size:12px;font-weight:570}.subagent-copy small{color:var(--neutral-500);font-size:10.5px}.subagent-row>:global(svg:last-child){flex:none;align-self:center;color:var(--neutral-400)}.subagents-empty{min-height:100%;display:flex;align-items:center;justify-content:center;margin:0;padding:24px;color:var(--neutral-400);font-size:11px;text-align:center}
</style>
