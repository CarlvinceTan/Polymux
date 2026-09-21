<script lang="ts">
  let {onOpenSettings}: {onOpenSettings?: () => void} = $props();
  import AppSettingsButton from './AppSettingsButton.svelte';
  import {onMount} from 'svelte';
  import type {AcpRegistryEntryDto, UsageAgentDto, UsageDayDto, UsageNamedCountDto, UsageScope, UsageStatsDto} from '@polymux/protocol';
  import {polymuxApi} from '../../api/polymux';
  import {readableError} from '../../shared/errors';
  import Icon from '../../shared/components/Icon.svelte';
  import {t, locale} from '../../../i18n';
  import {scrollFade, scrollFadeX} from '../../shared/scrollFade';
  import claudeIcon from '@lobehub/icons-static-svg/icons/claude.svg?url';
  import codexIcon from '@lobehub/icons-static-svg/icons/codex.svg?url';
  import opencodeIcon from '@lobehub/icons-static-svg/icons/opencode.svg?url';
  import {usageRowLimits} from './usageLayout';
  import {
    compactNumber,
    formatDuration,
    formatUsd,
    pluginHue,
  } from './usageFormat';
  import {
    buildHeatmap,
    fitHeatmapSlot,
    formatHeatmapDate,
    recentHeatmapDays,
    type HeatmapMode,
  } from './usageHeatmap';

  type UsagePanel = 'heatmap' | 'insights' | 'plugins' | 'connections' | 'models';

  const api = polymuxApi();
  const WEEKDAYS = ['', 'M', '', 'W', '', 'F', ''];

  let stats = $state<UsageStatsDto | null>(null);
  let loading = $state(true);
  let error = $state('');
  let mode = $state<HeatmapMode>('daily');
  let hover = $state<UsageDayDto | null>(null);
  let agentId = $state<string | null>(null);
  let scope = $state<UsageScope>('all');
  let agentRegistry = $state<AcpRegistryEntryDto[]>([]);
  let panel = $state<UsagePanel | null>(null);
  let plotWeeks = $state(26);
  let plotCell = $state(8);
  let agentRail = $state<HTMLElement>();
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);
  let agentScrollLeft = 0;
  let request = 0;
  let refreshedAt = 0;
  let pending = $state(0);
  let detailsWidth = $state(0);
  let detailsHeight = $state(0);

  const allTotals = $derived.by(() => {
    const agents = stats?.agents ?? [];
    return {
      tokens: agents.reduce((sum, agent) => sum + agent.tokens, 0),
      costUsd: agents.reduce((sum, agent) => sum + agent.costUsd, 0),
      runs: agents.reduce((sum, agent) => sum + agent.runs, 0),
    };
  });

  const metrics = $derived.by(() => {
    if (!stats) return [];
    return [
      {label: $t('usage.lifetimeTokens'), value: compactNumber(stats.lifetimeTokens)},
      {label: $t('usage.peakTokens'), value: compactNumber(stats.peakTokens)},
      {label: $t('usage.apiSpend'), value: formatUsd(stats.costUsd)},
      {label: $t('usage.longestChat'), value: stats.longestChatMs ? formatDuration(stats.longestChatMs) : '—'},
      {label: $t('usage.currentStreak'), value: $t('usage.days', {count: stats.currentStreakDays})},
      {label: $t('usage.longestStreak'), value: $t('usage.days', {count: stats.longestStreakDays})},
    ];
  });

  const reasoningLabel = $derived.by(() => {
    if (!stats || stats.reasoningPercent == null) return '—';
    const on = (stats.reasoningPercent ?? 0) >= (stats.fastModePercent ?? 0);
    return on
      ? $t('usage.reasoningOn', {percent: stats.reasoningPercent})
      : $t('usage.reasoningOff', {percent: stats.fastModePercent ?? 0});
  });

  const insights = $derived.by(() => {
    if (!stats) return [];
    return [
      {label: $t('usage.fastMode'), value: stats.fastModePercent == null ? '—' : `${stats.fastModePercent}%`},
      {label: $t('usage.mostUsedReasoning'), value: reasoningLabel},
      {label: $t('usage.skillsExplored'), value: compactNumber(stats.skillsExplored)},
      {label: $t('usage.skillsUsed'), value: compactNumber(stats.skillsUsed)},
      {label: $t('usage.totalChats'), value: compactNumber(stats.totalChats)},
    ];
  });
  const detailLengths = $derived([
    insights.length + (stats?.spendIncomplete ? 1 : 0),
    Math.max(1, stats?.plugins.length ?? 0),
    Math.max(1, stats?.connections.length ?? 0),
    ...(stats?.models.length ? [stats.models.length] : []),
  ]);
  const rowLimits = $derived(usageRowLimits(detailsWidth, detailsHeight, detailLengths));
  const homePlugins = $derived((stats?.plugins ?? []).slice(0, rowLimits[1]));
  const homeConnections = $derived((stats?.connections ?? []).slice(0, rowLimits[2]));
  const homeModels = $derived((stats?.models ?? []).slice(0, rowLimits[3] ?? 0));

  const homeInsights = $derived(insights.slice(0, rowLimits[0]));

  const heatmapDays = $derived.by(() => {
    const days = stats?.days ?? [];
    return panel === 'heatmap' ? days : recentHeatmapDays(days, plotWeeks);
  });
  const heatmap = $derived.by(() => buildHeatmap(heatmapDays, mode));
  const hoverLabel = $derived.by(() => {
    if (!hover) return '';
    const date = formatHeatmapDate(hover.date, $locale);
    if (!hover.tokens && !hover.runs) return $t('usage.noActivityOn', {date});
    return $t('usage.activityOn', {tokens: compactNumber(hover.tokens), date});
  });
  const busyDays = $derived.by(() =>
    [...(stats?.days ?? [])]
      .filter((day) => day.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens || b.date.localeCompare(a.date))
      .slice(0, 40),
  );
  const panelTitle = $derived.by(() => {
    if (panel === 'heatmap') return $t('usage.tokenActivity');
    if (panel === 'insights') return $t('usage.insights');
    if (panel === 'plugins') return $t('usage.mostUsedPlugins');
    if (panel === 'connections') return $t('usage.mostUsedConnections');
    if (panel === 'models') return $t('usage.models');
    return $t('workspace.usage');
  });

  onMount(() => {
    void load(null);
    // Registry icons enhance the carousel without delaying local usage.
    void api.agentRuntime.registry().then(entries => agentRegistry = entries).catch(() => {});
    const timer = setInterval(() => {
      if (!pending && !error && (stats?.discovery?.status === 'scanning' || Date.now() - refreshedAt > 60_000)) void load(agentId);
    }, 2_000);
    return () => { clearInterval(timer); request++; };
  });

  async function load(next: string | null, nextScope: UsageScope = scope, refresh = false): Promise<void> {
    const id = ++request;
    pending++;
    const first = !stats;
    if (first) loading = true;
    error = '';
    try {
      const nextStats = await api.usage.get({scope: nextScope, agentId: next, refresh});
      if (id !== request) return;
      refreshedAt = Date.now();
      stats = nextStats;
      agentId = nextStats.agentId;
      scope = nextStats.scope;
    } catch (reason) {
      if (id !== request) return;
      error = readableError(reason);
    } finally {
      pending--;
      if (id === request) loading = false;
    }
  }

  function selectAgent(id: string | null): void {
    if (id === agentId) return;
    agentId = id;
    hover = null;
    void load(id);
  }

  function selectScope(next: UsageScope): void {
    if (scope === next) return;
    scope = next;
    agentId = null;
    hover = null;
    agentScrollLeft = 0;
    agentRail?.scrollTo({left: 0, behavior: 'instant'});
    void load(null, next);
  }

  function scopeKeydown(event: KeyboardEvent): void {
    const tabs: UsageScope[] = ['all', 'polymux', 'assistant', 'team'];
    const index = tabs.indexOf(scope);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    selectScope(tabs[next]);
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  function agentIcon(agent: UsageAgentDto): string | null {
    const bundled: Record<string, string> = {'acp:claude': claudeIcon, 'acp:codex': codexIcon, 'acp:opencode': opencodeIcon};
    if (agent.kind === 'external') return bundled[agent.id.replace('external:', 'acp:')] || null;
    return agentRegistry.find(entry => `acp:${entry.id.replace(/-(?:agent-)?acp$/, '')}` === agent.id
      || entry.name.toLowerCase() === agent.name.toLowerCase())?.icon || bundled[agent.id.replace('external:', 'acp:')] || null;
  }

  function measureAgents(): void {
    if (!agentRail) return;
    agentScrollLeft = agentRail.scrollLeft;
    canScrollLeft = agentScrollLeft > 1;
    canScrollRight = agentScrollLeft < agentRail.scrollWidth - agentRail.clientWidth - 1;
  }

  function observeAgents(node: HTMLElement): () => void {
    node.scrollLeft = agentScrollLeft;
    const resize = new ResizeObserver(measureAgents);
    resize.observe(node);
    // The same rail survives refreshed usage and changes to its agent roster.
    const changes = new MutationObserver(measureAgents);
    changes.observe(node, {childList: true});
    measureAgents();
    return () => { resize.disconnect(); changes.disconnect(); };
  }

  function scrollAgents(direction: -1 | 1): void {
    if (!agentRail) return;
    const maximum = agentRail.scrollWidth - agentRail.clientWidth;
    agentRail.scrollTo({
      left: Math.max(0, Math.min(maximum, agentRail.scrollLeft + direction * agentRail.clientWidth)),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }

  function agentKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !agentRail) return;
    event.preventDefault();
    const buttons = [...agentRail.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)));
    buttons[next]?.focus({preventScroll: true});
    buttons[next]?.scrollIntoView({block: 'nearest', inline: 'nearest'});
    buttons[next]?.click();
  }

  function agentName(agent: UsageAgentDto): string {
    if (scope === 'all' && agent.kind === 'acp') return `${agent.name} (Polymux)`;
    return agent.id === 'polymux' ? $t('usage.polymuxAgent') : agent.name;
  }

  function observeDetails(node: HTMLElement): () => void {
    const measure = () => {
      detailsWidth = node.clientWidth;
      detailsHeight = node.clientHeight;
    };
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    measure();
    return () => resize.disconnect();
  }

  function observeHeatmap(fill: 'window' | 'all') {
    return (node: HTMLElement) => {
      const measure = () => {
        const fitted = fitHeatmapSlot(node.clientWidth, node.clientHeight, buildHeatmap(stats?.days ?? [], mode).weeks, fill);
        plotWeeks = fitted.weeks;
        plotCell = fitted.cell;
      };
      const resize = new ResizeObserver(measure);
      resize.observe(node);
      measure();
      return () => resize.disconnect();
    };
  }
</script>

{#snippet agentMark(agent: UsageAgentDto | null, all: boolean)}
  <span class="usage-agent-mark">
    {#if all}
      <Icon name="chart" size={16}/>
    {:else if agent?.id === 'polymux'}
      <img class="usage-polymux-logo" src="polymux.svg" alt=""/>
    {:else if agent && agentIcon(agent)}
      <img class="usage-runtime-logo" src={agentIcon(agent)!} alt=""/>
    {:else}
      <span aria-hidden="true">{agent?.name.slice(0, 1) ?? '?'}</span>
    {/if}
  </span>
{/snippet}

{#snippet moreButton(target: UsagePanel, title: string)}
  <button
    type="button"
    class="usage-more"
    aria-label={`${$t('usage.more')}: ${title}`}
    onclick={() => panel = target}
  >{$t('usage.more')}</button>
{/snippet}

{#snippet sectionHead(title: string, more: UsagePanel | null, modes: boolean)}
  <div class="usage-section-head">
    <h2>{title}</h2>
    {#if more || modes}<div class="usage-section-actions">
    {#if modes}
      <div class="usage-modes" role="tablist" aria-label={title}>
        {#each (['daily', 'weekly', 'cumulative'] as const) as item (item)}
          <button
            type="button"
            class={['usage-mode', mode === item && 'active']}
            role="tab"
            aria-selected={mode === item}
            onclick={() => mode = item}
          >{item === 'daily' ? $t('usage.daily') : item === 'weekly' ? $t('usage.weekly') : $t('usage.cumulative')}</button>
        {/each}
      </div>
    {/if}
    {#if more}{@render moreButton(more, title)}{/if}
    </div>{/if}
  </div>
{/snippet}

{#snippet agentRow(agent: UsageAgentDto | null, all: boolean)}
  {@const id = all ? null : agent?.id ?? null}
  {@const checked = all ? agentId == null : agentId === id}
  {@const tokens = all ? allTotals.tokens : agent?.tokens ?? 0}
  {@const spend = all ? allTotals.costUsd : agent?.costUsd ?? 0}
  {@const runs = all ? allTotals.runs : agent?.runs ?? 0}
  <button
    type="button"
    class="usage-agent"
    role="radio"
    aria-checked={checked}
    tabindex={checked ? 0 : -1}
    data-tooltip-overflow
    data-tooltip-delay="1500"
    aria-label={all ? $t('usage.allAgents') : agent ? agentName(agent) : $t('usage.allAgents')}
    onclick={() => selectAgent(id)}
  >
    <span class="usage-agent-heading">
      {@render agentMark(agent, all)}
      <span class="usage-name" data-tooltip-overflow-text>{all ? $t('usage.allAgents') : agent ? agentName(agent) : $t('usage.allAgents')}</span>
    </span>
    <span class="usage-agent-summary">
      <strong>{$t('usage.tokens', {count: compactNumber(tokens)})}</strong>
      <span>{$t('usage.runs', {count: runs})} · {formatUsd(spend)}</span>
    </span>
  </button>
{/snippet}

{#snippet namedRows(rows: UsageNamedCountDto[], empty: string)}
  {#if rows.length}
    <ul>
      {#each rows as row (row.name)}
        <li>
          <span class="usage-swatch" style:background={`hsl(${pluginHue(row.name)} 62% 58%)`}></span>
          <span class="usage-name">{row.name}</span>
          <span class="usage-count">{$t('usage.runs', {count: row.count})}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="usage-muted">{empty}</p>
  {/if}
{/snippet}

{#snippet heatmapPlot()}
  <div
    class="usage-heatmap-body"
    style:--weeks={heatmap.weeks}
    style:--heatmap-cell={`${plotCell}px`}
    role="group"
    aria-label={$t('usage.tokenActivity')}
    {@attach observeHeatmap(panel === 'heatmap' ? 'all' : 'window')}
    onmouseleave={() => hover = null}
  >
    <div class="usage-months" aria-hidden="true">
      {#each heatmap.months as month (month.key)}
        <span class="usage-month-slot" style:grid-column={`${month.column} / span ${month.span}`}><span>{month.label}</span></span>
      {/each}
    </div>
    <div class="usage-plot">
      <div class="usage-weekdays" aria-hidden="true">
        {#each WEEKDAYS as label, index (index)}
          <span>{label}</span>
        {/each}
      </div>
      <div class="usage-grid">
        {#each heatmap.cells as cell (cell.key)}
          {#if cell.day}
            <button
              type="button"
              class="usage-cell"
              data-level={cell.level}
              style:grid-column={cell.week}
              style:grid-row={cell.weekday}
              aria-label={formatHeatmapDate(cell.day.date, $locale)}
              onmouseenter={() => hover = cell.day}
              onfocus={() => hover = cell.day}
            ></button>
          {:else}
            <span
              class="usage-cell empty"
              style:grid-column={cell.week}
              style:grid-row={cell.weekday}
              aria-hidden="true"
            ></span>
          {/if}
        {/each}
      </div>
    </div>
  </div>
{/snippet}

<div class="usage" role="application" aria-label={$t('workspace.usage')} aria-busy={loading || !!stats && (stats.agentId !== agentId || stats.scope !== scope)}>
  {#if (loading || error || !stats) && onOpenSettings}<div class="app-context-row"><span>Usage</span><AppSettingsButton name="Usage" onclick={onOpenSettings}/></div>{/if}
  {#if loading}
    <div class="usage-empty" role="status">{$t('common.loading')}</div>
  {:else if error}
    <div class="usage-empty usage-error" role="alert"><span>{error}</span><button class="usage-mode" type="button" onclick={() => void load(agentId)}>{$t('usage.refresh')}</button></div>
  {:else if stats && panel}
    <div class="usage-depth">
      <header class="usage-depth-head">
        <button type="button" class="usage-back" aria-label={$t('common.back')} onclick={() => panel = null}>
          <Icon name="back" size={16}/>
        </button>
        <h1>{panelTitle}</h1>
        <AppSettingsButton name="Usage" onclick={onOpenSettings}/>
      </header>
      <div class="usage-depth-body" use:scrollFade={panel}>
        {#if panel === 'heatmap'}
          {@render sectionHead($t('usage.tokenActivity'), null, true)}
          <div class="usage-depth-heatmap">
            {@render heatmapPlot()}
            <p class="usage-heatmap-status">{hoverLabel}</p>
          </div>
          <h2>{$t('usage.recentDays')}</h2>
          <ul class="usage-day-list">
            {#each busyDays as day (day.date)}
              <li>
                <span class="usage-name">{formatHeatmapDate(day.date, $locale)}</span>
                <span class="usage-agent-metric">{compactNumber(day.tokens)}</span>
                <span class="usage-agent-metric">{formatUsd(day.costUsd)}</span>
              </li>
            {/each}
          </ul>
        {:else if panel === 'insights'}
          {#each insights as row (row.label)}
            <div class="usage-insight">
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          {/each}
          {#if stats.spendIncomplete}
            <p class="usage-muted">{$t('usage.spendIncomplete')}</p>
          {/if}
          {#if stats.models.length}
            <h2>{$t('usage.models')}</h2>
            <ul>
              {#each stats.models as model (model.model)}
                <li>
                  <span class="usage-name">{model.model}</span>
                  <span class="usage-agent-metric">{compactNumber(model.tokens)}</span>
                  <span class="usage-agent-metric">{formatUsd(model.costUsd)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        {:else if panel === 'plugins'}
          {@render namedRows(stats.plugins, $t('usage.noPlugins'))}
        {:else if panel === 'connections'}
          {@render namedRows(stats.connections, $t('usage.noConnections'))}
        {:else if panel === 'models'}
          {#if stats.models.length}
            <ul>
              {#each stats.models as model (model.model)}
                <li>
                  <span class="usage-name">{model.model}</span>
                  <span class="usage-agent-metric">{compactNumber(model.tokens)}</span>
                  <span class="usage-agent-metric">{formatUsd(model.costUsd)}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="usage-muted">{$t('usage.noModels')}</p>
          {/if}
        {/if}
      </div>
    </div>
  {:else if stats}
    <div class="usage-home">
      <header class="usage-head">
        <h1>{$t('workspace.usage')}</h1>
        <AppSettingsButton name="Usage" onclick={onOpenSettings}/>
        <div class="usage-head-end">
          <div class="usage-scopes" role="tablist" tabindex="-1" aria-label={$t('usage.scope')} onkeydown={scopeKeydown}>
            {#each (['all', 'polymux', 'assistant', 'team'] as const) as item (item)}
              <button type="button" class="usage-mode" class:active={scope === item} role="tab" aria-selected={scope === item} tabindex={scope === item ? 0 : -1}
                onclick={() => selectScope(item)}>{item === 'all' ? $t('usage.allUsage') : item === 'polymux' ? $t('usage.polymuxAgent') : item === 'assistant' ? $t('usage.assistant') : $t('usage.team')}</button>
            {/each}
          </div>
          {#if scope === 'all'}
            <button type="button" class="usage-refresh" aria-label={$t('usage.refresh')} data-tooltip-label={$t('usage.refresh')}
              aria-busy={stats.discovery?.status === 'scanning'} disabled={pending > 0}
              onclick={() => void load(agentId, scope, true)}><Icon name="reload" size={16}/></button>
          {/if}
        </div>
      </header>

        <section class="usage-agents-block" aria-label={$t('usage.agents')}>
          <div class="usage-section-head">
            <h2>{$t('usage.agents')}</h2>
            {#if canScrollLeft || canScrollRight}
              <div class="usage-agent-arrows">
                <button type="button" class="usage-arrow" data-tooltip="none" aria-label={$t('usage.previousAgents')} disabled={!canScrollLeft} onclick={() => scrollAgents(-1)}><Icon name="back" size={16}/></button>
                <button type="button" class="usage-arrow" data-tooltip="none" aria-label={$t('usage.nextAgents')} disabled={!canScrollRight} onclick={() => scrollAgents(1)}><Icon name="forward" size={16}/></button>
              </div>
            {/if}
          </div>
          <div bind:this={agentRail} class="usage-agents" use:scrollFadeX
            role="radiogroup" tabindex="-1" aria-label={$t('usage.agents')} {@attach observeAgents} onscroll={measureAgents} onkeydown={agentKeydown}>
            {@render agentRow(null, true)}
            {#each stats.agents as agent (agent.id)}
              {@render agentRow(agent, false)}
            {/each}
          </div>
        </section>

      <div class="usage-metrics">
        {#each metrics as metric (metric.label)}
          <div class="usage-metric">
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </div>
        {/each}
      </div>

      <section class="usage-heatmap" aria-label={$t('usage.tokenActivity')}>
        {@render sectionHead($t('usage.tokenActivity'), heatmapDays.length < stats.days.length ? 'heatmap' : null, true)}
        {@render heatmapPlot()}
        <p class="usage-heatmap-status">{hoverLabel}</p>
      </section>

      <div class="usage-columns" style:grid-template-columns={`repeat(${detailsWidth > 640 ? 3 : detailsWidth > 480 ? 2 : 1}, minmax(0, 1fr))`} {@attach observeDetails} use:scrollFade={rowLimits}>
        <section class="usage-insights" aria-label={$t('usage.insights')}>
          {@render sectionHead($t('usage.insights'), rowLimits[0] < detailLengths[0] ? 'insights' : null, false)}
          {#each homeInsights as row (row.label)}
            <div class="usage-insight">
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          {/each}
          {#if stats.spendIncomplete && rowLimits[0] > insights.length}
            <p class="usage-muted">{$t('usage.spendIncomplete')}</p>
          {/if}
        </section>
        <section class="usage-list" aria-label={$t('usage.mostUsedPlugins')}>
          {@render sectionHead($t('usage.mostUsedPlugins'), homePlugins.length < stats.plugins.length ? 'plugins' : null, false)}
          {#if rowLimits[1]}{@render namedRows(homePlugins, $t('usage.noPlugins'))}{/if}
        </section>
        <section class="usage-list" aria-label={$t('usage.mostUsedConnections')}>
          {@render sectionHead($t('usage.mostUsedConnections'), homeConnections.length < stats.connections.length ? 'connections' : null, false)}
          {#if rowLimits[2]}{@render namedRows(homeConnections, $t('usage.noConnections'))}{/if}
        </section>
        {#if stats.models.length}
          <section class="usage-list" aria-label={$t('usage.models')}>
            {@render sectionHead($t('usage.models'), homeModels.length < stats.models.length ? 'models' : null, false)}
            <ul>
              {#each homeModels as model (model.model)}
                <li>
                  <span class="usage-name">{model.model}</span>
                  <span class="usage-agent-metric">{compactNumber(model.tokens)}</span>
                  <span class="usage-agent-metric">{formatUsd(model.costUsd)}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .usage {
    container-type: size;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--main-panel-background);
  }
  .usage-empty {
    min-height: 100%;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--neutral-500);
    font-size: 13px;
  }
  .usage[aria-busy='true'] :is(.usage-metrics, .usage-heatmap, .usage-columns) { opacity: .45; }
  .usage-home, .usage-depth {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 18px 22px 16px;
  }
  .usage-head, .usage-agents-block, .usage-metrics, .usage-heatmap, .usage-columns {
    min-width: 0;
  }
  .usage-error { flex-direction: column; gap: 12px; padding: 24px; text-align: center; }
  .usage-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 10px 16px;
  }
  .usage-scopes { display: flex; align-items: center; gap: 14px; max-width: 100%; flex-wrap: wrap; }
  .usage-head-end { grid-column: 3; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
  .usage-head :global(.app-settings-button) { grid-column: 2; justify-self: center; }
  .usage-refresh {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    flex: none;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--neutral-500);
    cursor: pointer;
  }
  .usage-refresh:hover:not(:disabled) { color: var(--neutral-950); }
  .usage-refresh:disabled { opacity: .5; cursor: default; }
  .usage-refresh:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: 6px; }
  .usage-refresh[aria-busy='true'] :global(svg) { animation: usage-refresh-spin .9s linear infinite; }
  .usage-scopes .usage-mode { white-space: nowrap; }
  .usage-scopes .usage-mode:focus-visible { outline: 1px solid var(--neutral-500); outline-offset: 3px; border-radius: 2px; }
  @keyframes usage-refresh-spin { to { transform: rotate(360deg); } }
  @container (max-width: 620px) {
    .usage-head-end { grid-column: 1 / -1; justify-content: space-between; }
  }
  @media (prefers-reduced-motion: reduce) {
    .usage-refresh[aria-busy='true'] :global(svg) { animation: none; }
  }
  .usage-head h1, .usage-depth-head h1 {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 18px;
    font-weight: 560;
    letter-spacing: -.02em;
  }
  .usage-section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
    min-height: 18px;
    flex-wrap: wrap;
  }
  .usage-section-actions {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
    margin-left: auto;
  }
  .usage-section-head h2, .usage-depth-body > h2 {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 560;
  }
  .usage-modes {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex: none;
  }
  .usage-more, .usage-mode {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--neutral-500);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  .usage-more {
    flex: none;
  }
  .usage-more:hover, .usage-mode:hover { color: var(--neutral-800); }
  .usage-mode.active { color: var(--neutral-950); }
  .usage-agents-block { flex: none; margin-top: 10px; }
  .usage-agents {
    display: flex;
    gap: 12px;
    margin-top: 8px;
    overflow-x: auto;
    scrollbar-width: none;
    overscroll-behavior-x: contain;
  }
  .usage-agents::-webkit-scrollbar { display: none; }
  .usage-agent-arrows { display: flex; gap: 8px; align-items: center; }
  .usage-arrow {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--neutral-500);
    cursor: pointer;
    transition: color .16s ease, opacity .16s ease;
  }
  .usage-arrow:hover:not(:disabled) { color: var(--neutral-950); }
  .usage-arrow:disabled { opacity: .3; cursor: default; }
  .usage-arrow:focus-visible { outline: 1px solid var(--neutral-500); outline-offset: 2px; }
  .usage-agent {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    flex: 0 0 144px;
    min-width: 0;
    border: 0;
    border-radius: 8px;
    padding: 8px;
    background: transparent;
    color: var(--neutral-900);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color .16s ease;
  }
  .usage-agent:hover, .usage-agent:focus-visible {
    outline: none;
    background: color-mix(in srgb, var(--neutral-100) 60%, transparent);
  }
  .usage-agent[aria-checked='true'] { background: var(--neutral-100); }
  .usage-agent:focus-visible { outline: 1px solid var(--neutral-500); outline-offset: -1px; }
  .usage-agent[aria-checked='true'] .usage-name { font-weight: 560; }
  .usage-agent-heading { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .usage-agent-summary { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .usage-agent-summary strong { font-size: 12px; font-weight: 550; }
  .usage-agent-summary span { color: var(--neutral-500); font-size: 11px; }
  .usage-agent-summary > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .usage-agent-mark {
    width: 16px;
    height: 16px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--neutral-600);
    font-size: 13px;
  }
  .usage-runtime-logo { width: 14px; height: 14px; flex: none; object-fit: contain; }
  /* The mark occupies 60% of this SVG's height: 24px gives 14.4px of ink,
     matching the tightly cropped ACP logos beside the 13px agent names. */
  .usage-polymux-logo { width: 24px; height: 24px; flex: none; object-fit: contain; }
  :global(:root[data-theme='dark']) :is(.usage-polymux-logo, .usage-runtime-logo) { filter: brightness(0) invert(1); }
  .usage-agent-metric {
    flex: none;
    min-width: 44px;
    color: var(--neutral-500);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .usage-metrics {
    display: flex;
    flex-wrap: nowrap;
    gap: 0;
    margin-top: 12px;
    overflow: hidden;
  }
  .usage-metric {
    min-width: 0;
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 0 12px;
    border-left: 1px solid var(--neutral-200);
  }
  .usage-metric:first-child { border-left: 0; padding-left: 0; }
  .usage-metric:last-child { padding-right: 0; }
  .usage-metric strong {
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -.03em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .usage-metric span {
    color: var(--neutral-500);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .usage-heatmap {
    flex: 0 1 158px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    margin-top: 14px;
  }
  .usage-heatmap-body {
    container-type: size;
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    margin-top: 8px;
    max-height: 108px;
  }
  .usage-months {
    display: grid;
    grid-template-columns: repeat(var(--weeks, 53), var(--heatmap-cell));
    column-gap: 3px;
    margin-bottom: 4px;
    padding-left: 22px;
    height: 16px;
    color: var(--neutral-500);
    font-size: 10px;
  }
  .usage-month-slot {
    container: usage-month / inline-size;
    grid-row: 1;
    min-width: 0;
    height: 16px;
    line-height: 16px;
    white-space: nowrap;
  }
  @container usage-month (max-width: 28px) {
    .usage-month-slot > span { visibility: hidden; }
  }
  .usage-plot {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
  }
  .usage-weekdays, .usage-grid {
    display: grid;
    grid-template-rows: repeat(7, var(--heatmap-cell));
    gap: 3px;
  }
  .usage-weekdays {
    color: var(--neutral-500);
    font-size: 9px;
  }
  .usage-weekdays span {
    display: flex;
    align-items: center;
    line-height: 1;
  }
  .usage-grid {
    grid-template-columns: repeat(var(--weeks, 53), var(--heatmap-cell));
  }
  .usage-cell {
    width: var(--heatmap-cell);
    height: var(--heatmap-cell);
    border: 0;
    padding: 0;
    border-radius: 2px;
    background: var(--neutral-200);
    aspect-ratio: 1 / 1;
  }
  .usage-grid button.usage-cell { cursor: default; }
  .usage-cell.empty { visibility: hidden; }
  .usage-cell[data-level='1'] { background: color-mix(in srgb, var(--link-text) 28%, var(--neutral-200)); }
  .usage-cell[data-level='2'] { background: color-mix(in srgb, var(--link-text) 48%, var(--neutral-200)); }
  .usage-cell[data-level='3'] { background: color-mix(in srgb, var(--link-text) 72%, var(--neutral-100)); }
  .usage-cell[data-level='4'] { background: var(--link-text); }
  .usage-heatmap-status {
    flex: none;
    min-height: 14px;
    margin: 6px 0 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--neutral-500);
    font-size: 11px;
  }
  .usage-columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px 22px;
    margin-top: 10px;
    flex: 1 1 0;
    min-height: 0;
    align-content: start;
    overflow: auto;
    scrollbar-width: none;
  }
  .usage-columns::-webkit-scrollbar { display: none; }
  .usage-columns > section { min-width: 0; }
  .usage-columns .usage-muted { margin: 0; min-height: 24px; line-height: 24px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .usage-insight, .usage-list li, .usage-day-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 24px;
  }
  .usage-insight span, .usage-count, .usage-muted {
    color: var(--neutral-500);
    font-size: 13px;
  }
  .usage-insight strong, .usage-name, .usage-list li, .usage-day-list li {
    font-size: 13px;
    font-weight: 500;
  }
  .usage-list ul, .usage-insights, .usage-day-list, .usage-depth-body ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .usage-list li { justify-content: flex-start; }
  .usage-swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    flex: none;
  }
  .usage-name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .usage-count { flex: none; font-variant-numeric: tabular-nums; }
  .usage-depth-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    margin-bottom: 12px;
  }
  .usage-back {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--neutral-500);
    cursor: pointer;
  }
  .usage-back:hover, .usage-back:focus-visible {
    outline: none;
    color: var(--neutral-900);
  }
  .usage-depth-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scrollbar-width: none;
  }
  .usage-depth-body::-webkit-scrollbar { display: none; }
  .usage-depth-heatmap {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 136px;
    flex: none;
    margin: 8px 0 18px;
  }
  .usage-depth-body > h2 { margin: 16px 0 8px; }
  .usage-depth-body .usage-muted { margin-top: 10px; }

  @container (max-width: 640px) {
    .usage-metric:nth-child(n+5) { display: none; }
    .usage-home, .usage-depth { padding: 14px 14px 12px; }
  }
  @container (max-width: 480px) {
    .usage-metric:nth-child(n+4) { display: none; }
  }
  @container (max-height: 620px) {
    .usage-metric span { display: none; }
    .usage-heatmap-status { display: none; }
  }
  @container (max-height: 520px) {
    .usage-metric:nth-child(n+4) { display: none; }
  }
</style>
