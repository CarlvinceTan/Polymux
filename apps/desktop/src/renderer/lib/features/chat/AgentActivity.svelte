<script module lang="ts">
  import type {Platform} from '../../shared/components/PlatformLogo.svelte';
  import type {ActivityPreviewRequestDto} from '@polymux/protocol';

  export type AgentActivityKind =
    | 'thinking'
    | 'compacting'
    | 'reading'
    | 'searching'
    | 'running'
    | 'task'
    | 'memory'
    | 'skill'
    | 'tool'
    | 'resource'
    | 'editing'
    | 'messaging'
    | 'mail'
    | 'plugin'
    | 'commentary';
  export type AgentActivityStatus = 'pending' | 'active' | 'completed' | 'failed';

  /** One reported step inside a tool invocation (from tool.progress events),
   * shown as an indented sub-row when the activity row is opened. */
  export type AgentActivityStep = {
    id: string;
    label: string;
    status: AgentActivityStatus;
    /** The step's own outcome, shown under its label. Set when a counted row
     * ("Ran 2 commands") folds each call it stands for in as one of its steps. */
    result?: string;
    /** The operation a step stands for. Steps carry the kind of the call they
     * came from so an indented row wears the glyph of what it actually did
     * rather than reading as undifferentiated detail. */
    kind?: AgentActivityKind;
    /** The glyph this step draws, when the call it came from had one of its
     * own (a browser tab, an exact window). */
    icon?: 'globe' | 'computer';
    /** A platform's own mark for a step, when the call was one of the hub's
     * accounts. */
    logo?: Platform;
  };

  export type AgentActivityItem = {
    id: string;
    kind: AgentActivityKind;
    status: AgentActivityStatus;
    label: string;
    /** Overrides the kind's glyph when the activity has one of its own. Set
     * when the row is built, because the label it used to be inferred from is
     * translated and so is no longer a stable key. */
    icon?: 'globe' | 'computer';
    /** A platform's own mark, drawn in place of the kind's glyph. Set when the
     * row is for one of the hub's accounts, so a WhatsApp read reads as
     * WhatsApp rather than as a generic tool. */
    logo?: Platform;
    target?: string;
    result?: string;
    steps?: AgentActivityStep[];
    /** Draw this activity as a conversational event rather than in the tool trail. */
    display?: 'inline';
    /** How many calls this row stands for. A collapsed stretch of identical
     * calls stays counted so the settled trail can still say "Ran 2 commands". */
    count?: number;
    /** A passive frame for Browser or exact-window activity. */
    preview?: ActivityPreviewRequestDto;
  };
</script>

<script lang="ts">
  import {onMount} from 'svelte';
  import {fade} from 'svelte/transition';
  import {activityChainLabel, activityChains, activityDuration, collapseActivities, formatElapsedSeconds, nextDurationTickDelay} from './activities';
  import Icon from '../../shared/components/Icon.svelte';
  import LiveActivityPreview from '../../shared/components/LiveActivityPreview.svelte';
  import PlatformLogo from '../../shared/components/PlatformLogo.svelte';
  import {t} from '../../../i18n';

  export let activities: AgentActivityItem[] = [];
  export let startedAt: string | undefined = undefined;
  export let completedAt: string | undefined = undefined;
  export let streaming = false;

  // The trail sits under one ruled heading. While the run is live the work
  // stays in view — the heading and the rows are one block, the way ChatGPT's
  // trail reads as it fills — and once the run settles the block folds to its
  // heading so a finished run stops pushing the reply down the page.
  let expanded = false;
  let previousStreaming = streaming;

  /** A step the agent is on right now, so the row can carry the sweep. */
  function isWorking(activity: AgentActivityItem): boolean {
    return activity.status === 'active' || activity.status === 'pending';
  }
  let now = Date.now();
  /** Per-row disclosure, keyed by activity id: a row's own result, its steps,
   * or its live preview waits behind its own chevron. */
  let openRow: Record<string, boolean> = {};
  /** Groups ("Read 3 files") open one level out to the calls behind them. */
  let groupOpen: Record<string, boolean> = {};

  // A manual choice lasts through the run; completion folds its history.
  $: if (streaming !== previousStreaming) {
    previousStreaming = streaming;
    expanded = false;
    openRow = {};
    groupOpen = {};
  }

  $: elapsed = Math.max(1, activityDuration(startedAt, completedAt, now));
  $: collapsed = collapseActivities(activities);
  $: chains = activityChains(collapsed);
  $: failures = activities.filter((activity) => activity.status === 'failed').length;
  $: trailVisible = activities.length > 0 && (streaming || expanded);

  function toggleExpanded(): void {
    if (!activities.length || streaming) return;
    expanded = !expanded;
  }

  function toggleGroup(id: string): void {
    groupOpen = {...groupOpen, [id]: !(groupOpen[id] ?? false)};
  }

  /** One preview at a time: two live frames would double the cost and split
   * the trail's attention. Opening a second closes the first. */
  function toggleRow(activity: AgentActivityItem): void {
    const opening = !(openRow[activity.id] ?? false);
    const next: Record<string, boolean> = {...openRow};
    if (opening && activity.preview) {
      for (const [id, open] of Object.entries(next)) {
        if (open && collapsed.some((item) => item.id === id && item.preview)) delete next[id];
      }
    }
    next[activity.id] = opening;
    openRow = next;
  }

  function rowHasDetail(activity: AgentActivityItem): boolean {
    return Boolean(activity.result || activity.steps?.length || activity.preview);
  }

  /** How far through its current cycle a looping animation is, 0–1. */
  function cycleFraction(animation: Animation): number {
    const duration = Number(animation.effect?.getComputedTiming().duration) || 0;
    if (!duration) return 0;
    return ((Number(animation.currentTime) || 0) % duration) / duration;
  }

  /**
   * The glimmer sweeps at a fixed speed, so a long label takes longer to cross
   * than a short one. CSS cannot read the row's ink width, so the row reports it
   * as `--glint-ink` (unitless px) and the stylesheet derives the travel and the
   * duration from it.
   */
  function glint(node: HTMLElement, _label: string) {
    /**
     * The width feeds the cycle length, so every remeasure — the first one after
     * mount, and each label change after that — hands the running sweep a new
     * duration. The browser keeps the animation's start time across that change,
     * so the same elapsed time lands on a different fraction of the new cycle
     * and the wave snaps backwards mid-pass. Carrying the old fraction over onto
     * the new duration keeps the pass continuous through the change.
     */
    const measure = () => {
      const row = node.getBoundingClientRect();
      const label = node.querySelector('.activity-label');
      const box = label ? label.getBoundingClientRect() : row;
      const ink = String(Math.max(40, Math.round(box.right - row.left)));
      // Where the label starts within the row, so it can place the wave from the
      // row's head position rather than from its own left edge.
      node.style.setProperty('--glint-label', `${Math.round(box.left - row.left)}px`);
      if (node.style.getPropertyValue('--glint-ink') === ink) return;
      const running = node.getAnimations({subtree: true}).filter((animation) => animation.effect);
      const fractions = running.map(cycleFraction);
      node.style.setProperty('--glint-ink', ink);
      // Reading a custom property flushes the pending style recalc, so the
      // durations read below are the new ones rather than the ones being
      // replaced — without it the carried-over fraction lands on the old cycle
      // and the sweep still jumps.
      void getComputedStyle(node).getPropertyValue('--glint-cycle');
      running.forEach((animation, index) => {
        const duration = Number(animation.effect?.getComputedTiming().duration) || 0;
        if (duration) animation.currentTime = fractions[index] * duration;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return {update: measure, destroy: () => observer.disconnect()};
  }

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
      if (completedAt || !streaming) return;
      timer = window.setTimeout(tick, nextDurationTickDelay(startedAt, now) + 4);
    };
    tick();
    return () => window.clearTimeout(timer);
  });

  const activityIcons: Record<AgentActivityKind, 'brain' | 'compact' | 'book-open' | 'search' | 'terminal' | 'task' | 'sparkles' | 'wrench' | 'link' | 'edit' | 'chat' | 'archive' | 'mail'> = {
    thinking: 'brain',
    compacting: 'compact',
    reading: 'book-open',
    searching: 'search',
    running: 'terminal',
    task: 'task',
    memory: 'archive',
    skill: 'sparkles',
    tool: 'wrench',
    resource: 'link',
    editing: 'edit',
    messaging: 'chat',
    mail: 'mail',
    plugin: 'wrench',
    commentary: 'chat',
  };

  /** Rows draw a step down from the heading's own size, so a trail of dozens
   * of calls still reads as one block rather than as a second column of text.
   * Every glyph in the trail shares one size, nested steps included. */
  const ROW_GLYPH = 13;
  const ROW_CHEVRON = 12;
</script>

{#snippet glyph(kind: AgentActivityKind, icon: AgentActivityItem['icon'], logo: AgentActivityItem['logo'], size: number)}
  <span class="activity-glyph" style={`--glyph-size:${size}px`}>
    {#if logo}<PlatformLogo platform={logo} size={size}/>{:else}<Icon name={icon ?? activityIcons[kind]} size={size}/>{/if}
  </span>
{/snippet}

{#snippet rowLabel(activity: AgentActivityItem, toggle: boolean)}
  <span class="activity-text">
    <span class="activity-label">{activity.label}</span>
    {#if activity.target}<span class="activity-target">{activity.target}</span>{/if}
  </span>
  {#if toggle}<Icon name="chevron" size={ROW_CHEVRON}/>{/if}
{/snippet}

{#snippet row(activity: AgentActivityItem)}
  {@const detail = rowHasDetail(activity)}
  {@const open = openRow[activity.id] ?? false}
  {@render glyph(activity.kind, activity.icon, activity.logo, ROW_GLYPH)}
  <div class="activity-body">
    {#if detail}
      <button
        type="button"
        class="activity-row-line activity-detail-toggle"
        class:activity-preview-toggle={Boolean(activity.preview)}
        aria-label={`${activity.label}${activity.target ? ` ${activity.target}` : ''}`}
        aria-expanded={open}
        onclick={() => toggleRow(activity)}
      >
        {@render rowLabel(activity, true)}
      </button>
    {:else}
      <span class="activity-row-line">{@render rowLabel(activity, false)}</span>
    {/if}
    {#if detail && open}
      {#if activity.preview}
        <LiveActivityPreview source={activity.preview}/>
      {:else}
        {#if activity.result}
          {#if activity.kind === 'thinking'}
            <!-- Reasoning is streamed provider text, not markdown. Keep
                 whitespace and token boundaries exactly as delivered. -->
            <span class="activity-thinking">{activity.result}</span>
          {:else}<small class="activity-result">{activity.result}</small>{/if}
        {/if}
        {#if activity.steps?.length}
          <ul class="activity-steps">
            {#each activity.steps as step (step.id)}
              <li class:active={step.status === 'active'} class:failed={step.status === 'failed'}>
                <span class="activity-step-line">
                  {@render glyph(step.kind ?? activity.kind, undefined, step.logo, ROW_GLYPH)}
                  <span class="activity-label">{step.label}</span>
                </span>
                {#if step.result}<small>{step.result}</small>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    {/if}
  </div>
{/snippet}

<section class:streaming class="agent-activity" aria-label={$t('activity.title')}>
  {#if streaming}
    <p class="agent-activity-heading">
      <span>{$t('activity.workingFor', {elapsed: formatElapsedSeconds(elapsed)})}{#if failures} · {failures} failed{/if}</span>
    </p>
  {:else if activities.length}
    <button type="button" class="agent-activity-heading" aria-expanded={expanded} onclick={toggleExpanded}>
      <span>{$t('activity.workedFor', {elapsed: formatElapsedSeconds(elapsed)})}{#if failures} · {failures} failed{/if}</span>
    </button>
  {:else}
    <p class="agent-activity-heading">
      <span>{$t('activity.workedFor', {elapsed: formatElapsedSeconds(elapsed)})}</span>
    </p>
  {/if}

  {#if trailVisible}
    <ul class="agent-activity-list" aria-live="polite">
      {#each chains as chain (chain.id)}
        {#if chain.kind === 'commentary'}
          <!-- Narration is the model's own prose. It belongs in the trail where
               it was said, as wrapping text rather than as a truncated row. -->
          <li
            class="activity-commentary"
            class:live={streaming && isWorking(chain.items[0])}
            use:glint={chain.items[0].label}
            in:fade|local={{duration: 160}}
          >
            <span class="activity-label">{chain.items[0].label}</span>
          </li>
        {:else if chain.items.length === 1}
          {@const item = chain.items[0]}
          <li
            class="activity-row"
            class:live={streaming && isWorking(item)}
            class:active={isWorking(item)}
            class:failed={item.status === 'failed'}
            use:glint={item.label}
            in:fade|local={{duration: 160}}
          >
            {@render row(item)}
          </li>
        {:else}
          {@const open = groupOpen[chain.id] ?? false}
          <li
            class="activity-row activity-group"
            class:live={streaming && chain.items.some(isWorking)}
            class:failed={chain.items.some((item) => item.status === 'failed')}
            use:glint={activityChainLabel(chain.items)}
            in:fade|local={{duration: 160}}
          >
            {@render glyph(chain.items[0].kind, chain.items[0].icon, chain.items[0].logo, ROW_GLYPH)}
            <div class="activity-body">
              <button
                type="button"
                class="activity-row-line activity-group-toggle"
                aria-expanded={open}
                onclick={() => toggleGroup(chain.id)}
              >
                <span class="activity-text">
                  <span class="activity-label">{activityChainLabel(chain.items)}</span>
                </span>
                <Icon name="chevron" size={ROW_CHEVRON}/>
              </button>
              {#if open}
                <ul class="activity-children">
                  {#each chain.items as item (item.id)}
                    <li
                      class="activity-row"
                      class:live={streaming && isWorking(item)}
                      class:active={isWorking(item)}
                      class:failed={item.status === 'failed'}
                      use:glint={item.label}
                      in:fade|local={{duration: 140}}
                    >
                      {@render row(item)}
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          </li>
        {/if}
      {/each}
    </ul>
  {/if}
</section>
