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

  export let activities: AgentActivityItem[] = [];
  export let startedAt: string | undefined = undefined;
  export let completedAt: string | undefined = undefined;
  export let streaming = false;

  let expanded = false;
  let now = Date.now();

  const condensedLabels: Record<AgentActivityKind, string> = {
    thinking: 'Thought',
    reading: 'Read files',
    searching: 'Searched',
    running: 'Ran commands',
    editing: 'Edited files',
    plugin: 'Used plugins',
  };

  $: elapsed = Math.max(1, activityDuration(startedAt, completedAt, now));
  $: summary = activitySummary(activities);
  $: latest = activities.at(-1);
  $: onlyThinking = activities.length > 0 && activities.every((activity) => activity.kind === 'thinking');
  $: visibleActivities = expanded ? activities : (streaming && latest ? [latest] : []);

  function activitySummary(items: AgentActivityItem[]): string {
    const kinds = [...new Set(items.map((activity) => activity.kind))];
    return kinds.map((kind) => condensedLabels[kind]).join(', ');
  }

  function activityDuration(start?: string, completed?: string, current = Date.now()): number {
    if (!start) return 0;
    const startTime = Date.parse(start);
    const endTime = completed ? Date.parse(completed) : current;
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;
    return Math.max(0, Math.round((endTime - startTime) / 1000));
  }

  function nextDurationTickDelay(start?: string, current = Date.now()): number {
    const startTime = Date.parse(start ?? '');
    if (!Number.isFinite(startTime)) return 1000;
    const sinceLastChange = (((current - startTime - 500) % 1000) + 1000) % 1000;
    return 1000 - sinceLastChange;
  }

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
</script>

<section class:streaming class:expanded class="agent-activity" aria-label="Agent activity">
  <button
    type="button"
    class="activity-heading"
    aria-expanded={expanded}
    onclick={() => activities.length && (expanded = !expanded)}
  >
    <span>{streaming ? 'Working' : 'Worked'} for {elapsed}s</span>
    {#if activities.length}
      <svg class="chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>
    {/if}
  </button>

  {#if !streaming && !expanded && summary && !onlyThinking}
    <button
      type="button"
      class="activity-summary"
      aria-label={`Show agent activity: ${summary}`}
      onclick={() => expanded = true}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 4 4 4-2.5 2.5-1.7-1.7-6.3 6.3-1.6-1.6 6.3-6.3L8.5 5.5z"/></svg>
      <span>{summary}</span>
      <svg class="chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>
    </button>
  {:else if visibleActivities.length}
    <ul class="activity-list" aria-live="polite">
      {#each visibleActivities as activity (activity.id)}
        <li
          class:active={activity.status === 'active'}
          class:live={streaming && activity.status === 'active'}
          class:failed={activity.status === 'failed'}
        >
          {#if activity.kind === 'thinking'}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m11 2-6 9h5l-1 7 6-9h-5z"/></svg>
          {:else if activity.kind === 'reading'}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4.5c3-1 5-.2 7 1.5v11c-2-1.7-4-2.5-7-1.5zm14 0c-3-1-5-.2-7 1.5v11c2-1.7 4-2.5 7-1.5z"/></svg>
          {:else if activity.kind === 'searching'}
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="4.5"/><path d="m12 12 4 4"/></svg>
          {:else if activity.kind === 'running'}
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2"/><path d="m6 8 2 2-2 2m4 0h4"/></svg>
          {:else if activity.kind === 'editing'}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5 3 3-8 8H4.5v-3z"/><path d="m11 6 3 3"/></svg>
          {:else}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 12 6.5 13.5a3 3 0 1 1-4-4L6 6a3 3 0 0 1 4 0M12 8l1.5-1.5a3 3 0 1 1 4 4L14 14a3 3 0 0 1-4 0"/><path d="m7.5 12.5 5-5"/></svg>
          {/if}

          <span class="activity-copy">
            <span>
              {activity.label}{#if activity.target} <span class="activity-target">{activity.target}</span>{/if}
            </span>
            {#if expanded && activity.result}<small>{activity.result}</small>{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .agent-activity {
    margin: 0 0 18px;
    color: var(--neutral-500, #737373);
  }

  .activity-heading {
    width: 100%;
    height: 35px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 5px;
    border: 0;
    border-bottom: 1px solid var(--neutral-200, #e5e5e5);
    padding: 0 2px 10px;
    background: transparent;
    color: var(--neutral-500, #737373);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    line-height: 1;
    text-align: left;
  }

  .activity-heading:hover { color: var(--neutral-700, #404040); }
  .activity-heading .chevron { transition: transform 160ms ease; }
  .expanded .activity-heading .chevron { transform: rotate(180deg); }

  .activity-summary {
    max-width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    border: 0;
    padding: 14px 2px 0;
    background: transparent;
    color: var(--neutral-500, #737373);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    text-align: left;
  }

  .activity-summary > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-summary:hover { color: var(--neutral-700, #404040); }

  .activity-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 14px 2px 0;
    list-style: none;
  }

  .activity-list li {
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 9px;
    color: var(--neutral-500, #737373);
    font-size: 13px;
    line-height: 1.4;
  }

  .activity-list li > svg {
    flex: none;
    margin-top: 1px;
  }

  .activity-list li.active { color: var(--neutral-700, #404040); }
  .activity-list li.failed { color: #a92914; }

  .activity-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .activity-copy small {
    color: var(--neutral-400, #a3a3a3);
    font-size: 11px;
  }

  .activity-target {
    color: inherit;
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }

  svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  .activity-list li.live > svg {
    animation: activity-icon-sweep 3.2s ease-in-out infinite;
  }

  .activity-list li.live .activity-copy > span:first-child {
    color: transparent;
    background: linear-gradient(90deg, var(--neutral-500, #737373) 0%, var(--neutral-500, #737373) 34%, var(--neutral-950, #0a0a0a) 48%, var(--neutral-600, #525252) 62%, var(--neutral-500, #737373) 100%);
    background-size: 230% 100%;
    background-position: 130% 0;
    background-clip: text;
    -webkit-background-clip: text;
    animation: activity-gradient-sweep 3.2s cubic-bezier(.4, 0, .2, 1) infinite;
  }

  @keyframes activity-gradient-sweep {
    0%, 18% { background-position: 130% 0; }
    68%, 100% { background-position: -130% 0; }
  }

  @keyframes activity-icon-sweep {
    0%, 18%, 100% { color: var(--neutral-500, #737373); opacity: 0.72; }
    45% { color: var(--neutral-950, #0a0a0a); opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .activity-list li.live > svg,
    .activity-list li.live .activity-copy > span:first-child {
      animation: none;
    }

    .activity-list li.live .activity-copy > span:first-child {
      color: var(--neutral-700, #404040);
      background: none;
    }
  }
</style>
