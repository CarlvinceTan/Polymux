<script module lang="ts">
  export type AgentActivityKind = 'thinking' | 'reading' | 'searching' | 'running' | 'editing' | 'plugin';
  export type AgentActivityStatus = 'pending' | 'active' | 'completed' | 'failed';

  export type AgentActivityItem = {
    id: string;
    kind: AgentActivityKind;
    status: AgentActivityStatus;
    label: string;
    target?: string;
    result?: string;
  };
</script>

<script lang="ts">
  import {onMount} from 'svelte';
  import {activityDuration, activitySummary, nextDurationTickDelay} from '../../conversation/activities';
  import Icon from '../shared/Icon.svelte';

  export let activities: AgentActivityItem[] = [];
  export let startedAt: string | undefined = undefined;
  export let completedAt: string | undefined = undefined;
  export let streaming = false;

  let expanded = false;
  let now = Date.now();

  $: elapsed = Math.max(1, activityDuration(startedAt, completedAt, now));
  $: summary = activitySummary(activities);
  $: latest = activities.at(-1);
  $: onlyThinking = activities.length > 0 && activities.every((activity) => activity.kind === 'thinking');
  $: visibleActivities = expanded ? activities : streaming && latest ? [latest] : [];

  /**
   * A fixed 1s interval drifts and gets coalesced whenever the main thread is
   * busy, which makes the counter stall and then jump. Each tick is instead
   * scheduled to land just after the next true elapsed-second boundary, so the
   * displayed value advances once per second regardless of interval jitter.
   */
  onMount(() => {
    let timer = 0;
    const tick = () => {
      now = Date.now();
      if (completedAt) return;
      timer = window.setTimeout(tick, nextDurationTickDelay(startedAt, now) + 4);
    };
    tick();
    return () => window.clearTimeout(timer);
  });

  const activityIcons: Record<AgentActivityKind, 'bolt' | 'book-open' | 'search' | 'terminal' | 'edit' | 'link'> = {
    thinking: 'bolt',
    reading: 'book-open',
    searching: 'search',
    running: 'terminal',
    editing: 'edit',
    plugin: 'link',
  };
</script>

<section class:streaming class:expanded class="agent-activity" aria-label="Agent activity">
  <button
    type="button"
    class="agent-activity-heading"
    aria-expanded={expanded}
    onclick={() => activities.length && (expanded = !expanded)}
  >
    <span>{streaming ? 'Working' : 'Worked'} for {elapsed}s</span>
    {#if activities.length}<Icon name="chevron" size={14}/>{/if}
  </button>

  {#if !streaming && !expanded && summary && !onlyThinking}
    <button type="button" class="agent-activity-summary" aria-label={`Show agent activity: ${summary}`} onclick={() => expanded = true}>
      <Icon name="wrench" size={17}/><span>{summary}</span><Icon name="chevron" size={14}/>
    </button>
  {:else if visibleActivities.length}
    <ul class="agent-activity-list" aria-live="polite">
      {#each visibleActivities as activity (activity.id)}
        <li class:active={activity.status === 'active'} class:live={streaming && activity.status === 'active'} class:failed={activity.status === 'failed'}>
          <Icon name={activityIcons[activity.kind]} size={17}/>
          <span class="activity-copy">
            <span>{activity.label}{#if activity.target} <span class="activity-target">{activity.target}</span>{/if}</span>
            {#if expanded && activity.result}<small>{activity.result}</small>{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
