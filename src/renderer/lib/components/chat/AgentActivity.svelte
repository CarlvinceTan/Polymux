<script module lang="ts">
  export type AgentActivityKind =
    | 'thinking'
    | 'compacting'
    | 'reading'
    | 'searching'
    | 'running'
    | 'task'
    | 'skill'
    | 'tool'
    | 'resource'
    | 'editing'
    | 'plugin'
    | 'commentary';
  export type AgentActivityStatus = 'pending' | 'active' | 'completed' | 'failed';

  /** One reported step inside a tool invocation (from tool.progress events),
   * shown as an indented sub-row when the activity row is opened. */
  export type AgentActivityStep = {
    id: string;
    label: string;
    status: AgentActivityStatus;
  };

  export type AgentActivityItem = {
    id: string;
    kind: AgentActivityKind;
    status: AgentActivityStatus;
    label: string;
    /** Overrides the kind's glyph when the activity has one of its own. Set
     * when the row is built, because the label it used to be inferred from is
     * translated and so is no longer a stable key. */
    icon?: 'globe';
    target?: string;
    result?: string;
    steps?: AgentActivityStep[];
  };
</script>

<script lang="ts">
  import {onMount} from 'svelte';
  import {fade, fly} from 'svelte/transition';
  import {cubicOut} from 'svelte/easing';
  import {activityDuration, collapseActivities, formatElapsedSeconds, nextDurationTickDelay} from '../../conversation/activities';
  import Icon from '../shared/Icon.svelte';
  import {t} from '../../i18n';

  export let activities: AgentActivityItem[] = [];
  export let startedAt: string | undefined = undefined;
  export let completedAt: string | undefined = undefined;
  export let streaming = false;

  let expanded = false;
  let now = Date.now();
  /** Per-row detail disclosure, keyed by activity id. Mirrors ChatGPT's
   * trail, where a row's extra detail stays hidden until that row is opened. */
  let detailOpen: Record<string, boolean> = {};

  $: elapsed = Math.max(1, activityDuration(startedAt, completedAt, now));
  $: collapsed = collapseActivities(activities);
  $: latest = collapsed.at(-1);
  // Collapsed and settled shows the heading alone — the whole trail waits
  // behind the dropdown. While streaming, the latest activity doubles as the
  // live status line.
  $: visibleActivities = expanded ? collapsed : streaming && latest ? [latest] : [];
  // Collapsed streaming shows exactly one row, so a swap is a handoff: the
  // outgoing row fades out, then the incoming one slides up into its place.
  // Rows are stacked in a single grid cell so the two never push each other.
  $: solo = !expanded && streaming;
  const OUT_MS = 140;
  const IN_MS = 240;

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

  /**
   * The glimmer sweeps at a fixed speed, so a long label takes longer to cross
   * than a short one. CSS cannot read the row's ink width, so the row reports it
   * as `--glint-ink` (unitless px) and the stylesheet derives the travel and the
   * duration from it.
   */
  function glint(node: HTMLElement, _label: string) {
    const measure = () => {
      const row = node.getBoundingClientRect();
      const label = node.querySelector('.activity-copy > span, .activity-copy .activity-row-line > span');
      const right = label ? label.getBoundingClientRect().right : row.right;
      node.style.setProperty('--glint-ink', String(Math.max(40, Math.round(right - row.left))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return {update: measure, destroy: () => observer.disconnect()};
  }

  const activityIcons: Record<AgentActivityKind, 'brain' | 'compact' | 'book-open' | 'search' | 'terminal' | 'task' | 'sparkles' | 'wrench' | 'link' | 'edit' | 'chat'> = {
    thinking: 'brain',
    compacting: 'compact',
    reading: 'book-open',
    searching: 'search',
    running: 'terminal',
    task: 'task',
    skill: 'sparkles',
    tool: 'wrench',
    resource: 'link',
    editing: 'edit',
    plugin: 'wrench',
    commentary: 'chat',
  };
</script>

<section class:streaming class:expanded class="agent-activity" aria-label={$t('activity.title')}>
  <button
    type="button"
    class="agent-activity-heading"
    aria-expanded={expanded}
    onclick={() => activities.length && (expanded = !expanded)}
  >
    <span>{streaming ? $t('activity.workingFor', {elapsed: formatElapsedSeconds(elapsed)}) : $t('activity.workedFor', {elapsed: formatElapsedSeconds(elapsed)})}</span>
    {#if activities.length}<Icon name="chevron" size={14}/>{/if}
  </button>

  {#if visibleActivities.length}
    <ul class="agent-activity-list" class:solo aria-live="polite">
      {#each visibleActivities as activity (activity.id)}
        <li
          in:fly|local={{y: solo ? 9 : 0, duration: solo ? IN_MS : 0, delay: solo ? OUT_MS : 0, easing: cubicOut}}
          out:fade|local={{duration: solo ? OUT_MS : 0, easing: cubicOut}}
          use:glint={activity.label} class:active={activity.status === 'active'} class:live={streaming && activity.status === 'active'} class:failed={activity.status === 'failed'} class:commentary={activity.kind === 'commentary'}>
          <Icon name={activity.icon ?? activityIcons[activity.kind]} size={17}/>
          {#if expanded && (activity.result || activity.steps?.length)}
            <button
              type="button"
              class="activity-copy activity-detail-toggle"
              aria-expanded={Boolean(detailOpen[activity.id])}
              onclick={() => detailOpen = {...detailOpen, [activity.id]: !detailOpen[activity.id]}}
            >
              <span class="activity-row-line">
                <span>{activity.label}{#if activity.target} <span class="activity-target">{activity.target}</span>{/if}</span>
                <Icon name="chevron" size={13}/>
              </span>
              {#if detailOpen[activity.id]}
                {#if activity.steps?.length}
                  <ul class="activity-steps">
                    {#each activity.steps as step (step.id)}
                      <li class:active={step.status === 'active'} class:failed={step.status === 'failed'}>{step.label}</li>
                    {/each}
                  </ul>
                {/if}
                {#if activity.result}<small>{activity.result}</small>{/if}
              {/if}
            </button>
          {:else}
            <span class="activity-copy">
              <span>{activity.label}{#if activity.target} <span class="activity-target">{activity.target}</span>{/if}</span>
              {#if streaming && activity.status === 'active' && activity.steps?.length}
                <small class="activity-live-step">{activity.steps.at(-1)?.label}</small>
              {/if}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
