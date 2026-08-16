<script module lang="ts">
  import {activeLocale, plural, translate, type MessageKey} from '../../i18n';
  import MESSAGE_KEYS from '../../i18n/messages/en';

  export type ScheduleStatus = 'active' | 'paused' | 'running' | 'failed';

  /** 0 is Sunday, matching `Date#getDay`. */
  export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

  /**
   * How often a schedule fires, as data rather than prose: the agent sets these
   * fields, and the view is the only place that turns them into the sentence
   * the row shows. A hand-written cadence string would drift from whatever the
   * backend actually runs the moment either side is edited.
   *
   * `time` is 24-hour "HH:MM" local to `timeZone`.
   */
  export type ScheduleFrequency =
    | {kind: 'once'; at: number; timeZone?: string}
    | {kind: 'hourly'; interval?: number; minute?: number; timeZone?: string}
    | {kind: 'daily'; interval?: number; time: string; timeZone?: string}
    | {kind: 'weekly'; interval?: number; days: Weekday[]; time: string; timeZone?: string}
    | {kind: 'monthly'; interval?: number; dayOfMonth: number; time: string; timeZone?: string}
    | {kind: 'yearly'; interval?: number; month: number; dayOfMonth: number; time: string; timeZone?: string};

  export type ScheduleItem = {
    id: string;
    title: string;
    frequency: ScheduleFrequency;
    status: ScheduleStatus;
    /** The instruction the agent runs each time. */
    prompt?: string;
    /** Epoch milliseconds. */
    nextRunAt?: number;
    lastRunAt?: number;
  };

  export type ScheduleSortKey = 'title' | 'next' | 'last';

  const STATUS_LABELS: Record<ScheduleStatus, MessageKey> = {
    active: 'schedule.status.active',
    paused: 'schedule.status.paused',
    running: 'schedule.status.running',
    failed: 'schedule.status.failed',
  };

  export function scheduleStatusLabel(status: ScheduleStatus): string {
    return translate(STATUS_LABELS[status]);
  }

  /**
   * Dates and times are formatted in the interface language, not the host's
   * regional setting: someone reading FlareAI in Japanese expects Japanese
   * month names here, whatever their machine is set to.
   */
  export function formatScheduleTime(epochMs: number): string {
    const date = new Date(epochMs);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const clock = date.toLocaleTimeString(activeLocale(), {hour: 'numeric', minute: '2-digit'});
    if (sameDay) return translate('schedule.todayAt', {time: clock});
    return date.toLocaleString(activeLocale(), {
      month: 'short',
      day: 'numeric',
      ...(date.getFullYear() === now.getFullYear() ? {} : {year: 'numeric'}),
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  /** 4 January 2021 was a Sunday, so this week is the reference for naming
   * weekdays — the names themselves come from the platform's own data rather
   * than a table this file would have to carry in nineteen languages. */
  const WEEKDAY_REFERENCE = Date.UTC(2021, 0, 3);

  function weekdayName(day: number, width: 'long' | 'short'): string {
    return new Intl.DateTimeFormat(activeLocale(), {weekday: width, timeZone: 'UTC'})
      .format(new Date(WEEKDAY_REFERENCE + day * 86_400_000));
  }

  function monthName(month: number): string {
    return new Intl.DateTimeFormat(activeLocale(), {month: 'long', timeZone: 'UTC'})
      .format(new Date(Date.UTC(2021, month, 1)));
  }

  const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];
  /** The whole week, in the order the day buttons are drawn. Typed, so the
   * picker hands `toggleDay` a Weekday rather than a bare loop index. */
  const WEEK: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

  export function localTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  /** "08:00" in whatever shape the interface language writes a clock time. */
  export function formatTimeOfDay(time: string): string {
    const [hour, minute] = time.split(':').map(Number);
    const date = new Date(2000, 0, 1, Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0);
    return date.toLocaleTimeString(activeLocale(), {hour: 'numeric', minute: '2-digit'});
  }

  function joinList(parts: string[]): string {
    return new Intl.ListFormat(activeLocale(), {style: 'long', type: 'conjunction'}).format(parts);
  }

  /** "3rd" in English, and whatever the language does instead — most write the
   * bare number, which is what their catalogs say. */
  function ordinal(day: number): string {
    const category = new Intl.PluralRules(activeLocale(), {type: 'ordinal'}).select(day);
    const key = `ordinal.${category}` as MessageKey;
    return translate(key in MESSAGE_KEYS ? key : 'ordinal.other', {day});
  }

  /** Which unit a cadence counts in, as the family name its plural forms live
   * under. */
  const UNIT_KEYS = {
    hour: 'schedule.everyHours',
    day: 'schedule.everyDays',
    week: 'schedule.everyWeeks',
    month: 'schedule.everyMonths',
    year: 'schedule.everyYears',
  } as const;

  type CadenceUnit = keyof typeof UNIT_KEYS;

  /** "Every 3 days" — or "Every day" at one, where the count reads as noise. */
  function everyPhrase(interval: number, unit: CadenceUnit): string {
    return plural(UNIT_KEYS[unit], interval);
  }

  /**
   * A one-off has nothing to repeat, so `once` is the one shape carrying no
   * interval. These two keep that asymmetry in one place rather than making
   * every reader and writer of the field narrow the union for itself.
   */
  export function frequencyInterval(frequency: ScheduleFrequency): number | undefined {
    return frequency.kind === 'once' ? undefined : frequency.interval;
  }

  function withInterval(frequency: ScheduleFrequency, interval: number): ScheduleFrequency {
    return frequency.kind === 'once' ? frequency : {...frequency, interval};
  }

  /**
   * The row's cadence sentence. A zone only earns a mention when it is not the
   * one the reader's clock is already in — "at 8:00 (Asia/Singapore)" is
   * information; the same line naming their own zone back at them is not.
   *
   * Each shape is one catalog sentence with its parts filled in, rather than
   * fragments glued together here: word order around a time or a day name is
   * not the same in every language, and only a whole sentence can move it.
   */
  export function describeFrequency(frequency: ScheduleFrequency): string {
    const zone = frequency.timeZone && frequency.timeZone !== localTimeZone()
      ? translate('schedule.inZone', {zone: frequency.timeZone})
      : '';
    const interval = Math.max(1, Math.round(frequencyInterval(frequency) ?? 1));
    switch (frequency.kind) {
      case 'once':
        return translate('schedule.cadenceOnce', {time: formatScheduleTime(frequency.at), zone});
      case 'hourly': {
        const cadence = everyPhrase(interval, 'hour');
        if (interval > 1 || !frequency.minute) return `${cadence}${zone}`;
        return translate('schedule.cadenceAtMinute', {
          cadence,
          minute: String(frequency.minute).padStart(2, '0'),
          zone,
        });
      }
      case 'daily':
        return translate('schedule.cadenceAt', {cadence: everyPhrase(interval, 'day'), time: formatTimeOfDay(frequency.time), zone});
      case 'weekly': {
        const days = [...frequency.days].sort((a, b) => a - b);
        const isEveryWeekday = days.length === 5 && WEEKDAYS.every((day) => days.includes(day));
        const time = formatTimeOfDay(frequency.time);
        if (interval > 1)
          return translate('schedule.cadenceOnDays', {
            cadence: everyPhrase(interval, 'week'),
            days: isEveryWeekday ? translate('schedule.weekdays') : joinList(days.map((day) => weekdayName(day, 'long'))),
            time,
            zone,
          });
        if (isEveryWeekday) return translate('schedule.everyWeekdayAt', {time, zone});
        if (!days.length) return translate('schedule.weeklyAt', {time, zone});
        return translate('schedule.everyDayNameAt', {
          days: joinList(days.map((day) => weekdayName(day, 'long'))),
          time,
          zone,
        });
      }
      case 'monthly':
        return translate('schedule.cadenceOnDayOfMonth', {
          cadence: everyPhrase(interval, 'month'),
          day: ordinal(frequency.dayOfMonth),
          time: formatTimeOfDay(frequency.time),
          zone,
        });
      case 'yearly':
        return translate('schedule.cadenceOnDate', {
          cadence: everyPhrase(interval, 'year'),
          month: monthName(frequency.month),
          day: frequency.dayOfMonth,
          time: formatTimeOfDay(frequency.time),
          zone,
        });
    }
  }

  /** Every half hour: the granularity the picker offers, as ChatGPT's does. */
  function timeOptions(): Array<{value: string; label: string}> {
    const options: Array<{value: string; label: string}> = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
      const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      options.push({value, label: formatTimeOfDay(value)});
    }
    return options;
  }

</script>

<script lang="ts">
  import {tick} from 'svelte';
  import Icon from '../shared/Icon.svelte';
  import Menu from '../shared/Menu.svelte';
  import {locale, t, withLocale} from '../../i18n';

  const UNIT_NOUNS = {
    hourly: 'schedule.hours',
    daily: 'schedule.days',
    weekly: 'schedule.weeks',
    monthly: 'schedule.months',
    yearly: 'schedule.years',
    once: 'schedule.days',
  } as const;

  export let title = '';
  export let items: ScheduleItem[] = [];
  export let onOpenItem: (item: ScheduleItem) => void = () => {};
  export let onToggleItem: (item: ScheduleItem) => void = () => {};
  export let onCreate: () => void = () => {};
  export let onDeleteItem: (item: ScheduleItem) => void = () => {};
  export let onRunItem: (item: ScheduleItem) => void = () => {};
  export let onChangeFrequency: (item: ScheduleItem, frequency: ScheduleFrequency) => void = () => {};

  let query = '';
  /** The search starts as its icon, the way Drive's does, so the heading and
   * the create action keep their room until a search is actually being run. */
  let searchExpanded = false;
  let searchFocused = false;
  let searchInput: HTMLInputElement;
  let searchWrapper: HTMLDivElement;
  let sortKey: ScheduleSortKey = 'next';
  let sortAscending = true;
  let menuId: string | null = null;
  let menuTop = 0;
  let editingId: string | null = null;
  let editorTop = 0;
  let draft: ScheduleFrequency | null = null;
  /** Custom exposes the unit and interval rows; the presets imply both. */
  let repeatMode: 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' = 'daily';

  /** `key` empty means the column is not sortable; `cell` is what the grid
   * drops at narrow panel widths. Everything below is derived rather than
   * fixed: each one carries wording or a formatted time, so all of it has to
   * be rebuilt when the language changes. */
  $: columns = [
    {key: 'title' as const, label: $t('schedule.columnTask'), cell: 'task'},
    {key: '' as const, label: $t('schedule.columnFrequency'), cell: 'cadence'},
    {key: 'next' as const, label: $t('schedule.columnNextRun'), cell: 'next'},
    {key: 'last' as const, label: $t('schedule.columnLastRun'), cell: 'last'},
    {key: '' as const, label: $t('schedule.columnStatus'), cell: 'status'},
  ];

  $: REPEAT_OPTIONS = [
    {value: 'once', label: $t('schedule.doesNotRepeat')},
    {value: 'daily', label: $t('schedule.daily')},
    {value: 'weekly', label: $t('schedule.weekly')},
    {value: 'monthly', label: $t('schedule.monthly')},
    {value: 'yearly', label: $t('schedule.yearly')},
    {value: 'custom', label: $t('schedule.custom')},
  ];

  $: UNIT_OPTIONS = [
    {value: 'hourly', label: $t('schedule.hourly')},
    {value: 'daily', label: $t('schedule.daily')},
    {value: 'weekly', label: $t('schedule.weekly')},
    {value: 'monthly', label: $t('schedule.monthly')},
    {value: 'yearly', label: $t('schedule.yearly')},
  ];

  $: MONTH_OPTIONS = Array.from({length: 12}, (_, index) => ({value: String(index), label: monthName(index)}));
  $: TIME_OPTIONS = withLocale($locale, timeOptions());

  $: visible = withLocale($locale, sortItems(filterItems(items, query), sortKey, sortAscending));
  /** The unit noun beside the interval field, already in the plural form the
   * current count calls for — "day" at one, "days" at three, and whatever the
   * language does at two, four or eleven. */
  $: unitNoun = withLocale($locale, plural(
    UNIT_NOUNS[draft?.kind ?? 'daily'],
    draft ? frequencyInterval(draft) ?? 1 : 1,
  ));

  async function toggleSearch(): Promise<void> {
    searchExpanded = !searchExpanded;
    if (searchExpanded) {
      await tick();
      searchInput?.focus();
    } else {
      query = '';
    }
  }

  function filterItems(list: ScheduleItem[], text: string): ScheduleItem[] {
    const needle = text.trim().toLowerCase();
    return needle
      ? list.filter((item) => item.title.toLowerCase().includes(needle) || describeFrequency(item.frequency).toLowerCase().includes(needle))
      : list;
  }

  /** A schedule without a next run is not due at all, so it sorts after
   * everything that is, whichever direction the column runs. */
  function sortItems(list: ScheduleItem[], key: ScheduleSortKey, ascending: boolean): ScheduleItem[] {
    const direction = ascending ? 1 : -1;
    return [...list].sort((a, b) => {
      if (key === 'title') return a.title.localeCompare(b.title, undefined, {numeric: true, sensitivity: 'base'}) * direction;
      const field = key === 'next' ? 'nextRunAt' : 'lastRunAt';
      const left = a[field];
      const right = b[field];
      if (left === undefined || right === undefined) {
        if (left === right) return 0;
        return left === undefined ? 1 : -1;
      }
      return (left - right) * direction;
    });
  }

  function sortBy(key: ScheduleSortKey): void {
    if (sortKey === key) sortAscending = !sortAscending;
    else {
      sortKey = key;
      sortAscending = key !== 'last';
    }
  }

  /** Both popovers hang off the view, so they need the row's own offset. */
  function offsetWithin(target: HTMLElement, gap: number): number {
    const view = target.closest('.schedule-view');
    if (!view) return 0;
    return target.getBoundingClientRect().bottom - view.getBoundingClientRect().top + gap;
  }

  function toggleMenu(event: MouseEvent, item: ScheduleItem): void {
    event.stopPropagation();
    if (menuId === item.id) {
      menuId = null;
      return;
    }
    menuTop = offsetWithin(event.currentTarget as HTMLElement, 4);
    menuId = item.id;
    editingId = null;
  }

  /**
   * Closing the menu is what the row's action does last, not first: the item
   * the menu is about is looked up from `menuId`, so clearing that id before
   * the action runs would hand the action nothing.
   */
  function act(item: ScheduleItem, action: (item: ScheduleItem) => void): void {
    action(item);
    menuId = null;
  }

  function startEditing(event: MouseEvent | null, item: ScheduleItem): void {
    const row = (event?.currentTarget as HTMLElement | undefined)?.closest('.schedule-row') as HTMLElement | null;
    editorTop = row ? offsetWithin(row, 6) : menuTop;
    menuId = null;
    editingId = item.id;
    draft = {...item.frequency};
    repeatMode = presetFor(draft);
  }

  /** A frequency the presets can express opens on that preset; anything else —
   * an interval above one, an hourly cadence — opens on Custom, where the
   * rows that describe it are visible. */
  function presetFor(frequency: ScheduleFrequency): typeof repeatMode {
    if (frequency.kind === 'hourly') return 'custom';
    if ((frequencyInterval(frequency) ?? 1) > 1) return 'custom';
    return frequency.kind;
  }

  function closeEditor(): void {
    editingId = null;
    draft = null;
  }

  function commit(next: ScheduleFrequency): void {
    draft = next;
    const item = items.find((entry) => entry.id === editingId);
    if (item) onChangeFrequency(item, next);
  }

  /** Switching kind keeps whatever the other shape shares — the time of day,
   * the zone — so changing Weekly to Monthly does not reset the clock. */
  function withKind(current: ScheduleFrequency, kind: ScheduleFrequency['kind']): ScheduleFrequency {
    // Read per call: the view is long-lived, so a date captured at mount would
    // seed yesterday's weekday after midnight.
    const now = new Date();
    const time = 'time' in current ? current.time : '09:00';
    const timeZone = current.timeZone;
    const interval = frequencyInterval(current);
    switch (kind) {
      case 'once': return {kind: 'once', at: Date.now() + 86_400_000, timeZone};
      case 'hourly': return {kind: 'hourly', interval, minute: 0, timeZone};
      case 'daily': return {kind: 'daily', interval, time, timeZone};
      case 'weekly': return {kind: 'weekly', interval, days: current.kind === 'weekly' ? current.days : [now.getDay() as Weekday], time, timeZone};
      case 'monthly': return {kind: 'monthly', interval, dayOfMonth: current.kind === 'monthly' ? current.dayOfMonth : now.getDate(), time, timeZone};
      case 'yearly': return {kind: 'yearly', interval, month: current.kind === 'yearly' ? current.month : now.getMonth(), dayOfMonth: current.kind === 'yearly' ? current.dayOfMonth : now.getDate(), time, timeZone};
    }
  }

  function chooseRepeat(value: string): void {
    if (!draft) return;
    repeatMode = value as typeof repeatMode;
    if (value === 'custom') {
      // Custom is a cadence that repeats, which a one-off cannot be. It
      // becomes the daily the unit menu already shows in its place, so the
      // rows underneath describe the schedule that is actually being edited.
      const base = draft.kind === 'once' ? withKind(draft, 'daily') : draft;
      commit(withInterval(base, frequencyInterval(base) ?? 1));
      return;
    }
    commit(withInterval(withKind(draft, value as ScheduleFrequency['kind']), 1));
  }

  /** The unit the Custom rows repeat on — days, weeks, months, years. */
  function chooseUnit(value: string): void {
    if (!draft) return;
    commit(withKind(draft, value as ScheduleFrequency['kind']));
  }

  function setEvery(value: string): void {
    if (!draft) return;
    const parsed = Math.max(1, Math.min(99, Math.round(Number(value) || 1)));
    commit(withInterval(draft, parsed));
  }

  function setTime(value: string): void {
    if (!draft || draft.kind === 'once' || draft.kind === 'hourly') return;
    commit({...draft, time: value});
  }

  /** The last selected day cannot be cleared: a weekly schedule with no day
   * would never run, and a row that silently stops is worse than a stiff one. */
  function toggleDay(day: Weekday): void {
    if (!draft || draft.kind !== 'weekly') return;
    const has = draft.days.includes(day);
    if (has && draft.days.length === 1) return;
    commit({...draft, days: has ? draft.days.filter((entry) => entry !== day) : [...draft.days, day].sort((a, b) => a - b)});
  }

  function setDayOfMonth(value: string): void {
    if (!draft || (draft.kind !== 'monthly' && draft.kind !== 'yearly')) return;
    commit({...draft, dayOfMonth: Math.max(1, Math.min(31, Math.round(Number(value) || 1)))});
  }

  function setMonth(value: string): void {
    if (!draft || draft.kind !== 'yearly') return;
    commit({...draft, month: Number(value)});
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (editingId) {
      event.stopPropagation();
      closeEditor();
    } else if (menuId) {
      event.stopPropagation();
      menuId = null;
    } else if (searchExpanded) {
      event.stopPropagation();
      void toggleSearch();
    }
  }

  function dismiss(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (menuId && !target.closest('.schedule-row-menu') && !target.closest('.schedule-more')) menuId = null;
    if (editingId && !target.closest('.schedule-frequency-editor') && !target.closest('.flareai-dropdown-menu')) closeEditor();
    // A search still holding a query stays open; an empty one has nothing to
    // keep the toolbar space for.
    if (searchExpanded && !query && !searchWrapper?.contains(target)) searchExpanded = false;
  }
</script>

<svelte:window onkeydown={keydown} onclick={dismiss}/>

<div class="schedule-view">
  <div class="list-toolbar">
    <span class="schedule-heading"><Icon name="clock" size={15}/><span>{title || $t('workspace.schedule')}</span></span>
    <div class="fb-search" class:expanded={searchExpanded}>
      <div bind:this={searchWrapper} class="fb-search-field" class:expanded={searchExpanded} class:focused={searchFocused}>
        <button
          type="button"
          class="fb-action"
          class:quiet={searchExpanded}
          aria-label={$t('schedule.search')}
          aria-expanded={searchExpanded}
          data-tooltip-label={searchExpanded ? undefined : $t('common.search')}
          onclick={toggleSearch}
        ><Icon name="search" size={15}/></button>
        <div class="fb-search-slot">
          <input
            bind:this={searchInput}
            bind:value={query}
            type="text"
            placeholder={$t('schedule.search')}
            aria-label={$t('schedule.search')}
            tabindex={searchExpanded ? 0 : -1}
            onfocus={() => searchFocused = true}
            onblur={() => searchFocused = false}
            onkeydown={(event) => { if (event.key === 'Escape') toggleSearch(); }}
          />
          {#if query}
            <button
              type="button"
              class="fb-search-clear"
              aria-label={$t('common.clearSearch')}
              data-tooltip="none"
              onclick={() => { query = ''; searchInput?.focus(); }}
            ><Icon name="close" size={12}/></button>
          {/if}
        </div>
      </div>
    </div>
    <button type="button" class="fb-action schedule-create-icon" aria-label={$t('schedule.new')} data-tooltip-label={$t('schedule.new')} onclick={onCreate}>
      <Icon name="plus" size={15}/>
    </button>
  </div>

  <div class="list-columns schedule-columns" role="row">
    {#each columns as column (column.cell)}
      <span
        class={`list-column-cell ${column.cell}`}
        class:end={column.cell === 'status'}
        role="columnheader"
        aria-sort={column.key && sortKey === column.key ? (sortAscending ? 'ascending' : 'descending') : 'none'}
      >
        {#if column.key}
          <button
            type="button"
            class="list-column"
            class:sorted={sortKey === column.key}
            class:descending={sortKey === column.key && !sortAscending}
            onclick={() => sortBy(column.key as ScheduleSortKey)}
          >
            <span>{column.label}</span>{#if sortKey === column.key}<Icon name="chevron" size={12}/>{/if}
          </button>
        {:else}
          <span class="list-column static">{column.label}</span>
        {/if}
      </span>
    {/each}
  </div>

  {#if visible.length}
    <div class="list-rows" role="list" onscroll={() => { menuId = null; closeEditor(); }}>
      {#each visible as item (item.id)}
        <div class="list-row schedule-row" class:menu-open={menuId === item.id || editingId === item.id} role="listitem">
          <button type="button" class="list-row-name schedule-row-main" onclick={() => onOpenItem(item)}>
            <span class={`list-row-icon schedule ${item.status}`}><Icon name="clock" size={16}/></span>
            <span class="list-row-label">{item.title}</span>
          </button>
          <button
            type="button"
            class="list-row-meta cadence schedule-cadence"
            aria-label={$t('schedule.editFrequencyNamed', {title: item.title})}
            data-tooltip-label={$t('schedule.editFrequency')}
            onclick={(event) => startEditing(event, item)}
          >{describeFrequency(item.frequency)}</button>
          <span class="list-row-meta next">{item.nextRunAt === undefined ? '—' : formatScheduleTime(item.nextRunAt)}</span>
          <span class="list-row-meta last">{item.lastRunAt === undefined ? $t('schedule.never') : formatScheduleTime(item.lastRunAt)}</span>
          <span class="schedule-row-end">
            <button
              type="button"
              class={`schedule-status ${item.status}`}
              aria-label={item.status === 'paused' ? $t('schedule.resumeNamed', {title: item.title}) : $t('schedule.pauseNamed', {title: item.title})}
              data-tooltip-label={item.status === 'paused' ? $t('common.resume') : $t('common.pause')}
              data-tooltip-align="end"
              onclick={() => onToggleItem(item)}
            >{scheduleStatusLabel(item.status)}</button>
            <button
              type="button"
              class="schedule-more"
              aria-label={$t('chats.moreActions', {title: item.title})}
              aria-haspopup="menu"
              aria-expanded={menuId === item.id}
              data-tooltip="none"
              onclick={(event) => toggleMenu(event, item)}
            ><Icon name="ellipsis" size={16}/></button>
          </span>
        </div>
      {/each}
    </div>
  {:else}
    <div class="new-tab-empty">
      <Icon name={query ? 'search' : 'clock'} size={30}/>
      <h2>{query ? $t('common.noMatches') : $t('schedule.emptyTitle')}</h2>
      <p>{query ? $t('schedule.noMatchesBody', {query}) : $t('schedule.emptyBody')}</p>
      {#if !query}<button type="button" class="schedule-create" onclick={onCreate}><Icon name="plus" size={14}/><span>{$t('schedule.new')}</span></button>{/if}
    </div>
  {/if}

  {#if menuId}
    {@const menuItem = items.find((entry) => entry.id === menuId)}
    {#if menuItem}
      <div class="flareai-dropdown-menu schedule-row-menu" role="menu" style:top={`${menuTop}px`}>
        <button class="flareai-dropdown-item" role="menuitem" onclick={() => act(menuItem, onRunItem)}><Icon name="play" size={14}/><span>{$t('schedule.runNow')}</span></button>
        <button class="flareai-dropdown-item" role="menuitem" onclick={(event) => startEditing(event, menuItem)}><Icon name="clock" size={14}/><span>{$t('schedule.editFrequency')}</span></button>
        <button class="flareai-dropdown-item" role="menuitem" onclick={() => act(menuItem, onToggleItem)}>
          <Icon name={menuItem.status === 'paused' ? 'play' : 'pause'} size={14}/><span>{menuItem.status === 'paused' ? $t('common.resume') : $t('common.pause')}</span>
        </button>
        <button class="flareai-dropdown-item destructive" role="menuitem" onclick={() => act(menuItem, onDeleteItem)}><Icon name="trash" size={14}/><span>{$t('common.delete')}</span></button>
      </div>
    {/if}
  {/if}

  {#if editingId && draft}
    <div class="schedule-frequency-editor" style:top={`${editorTop}px`}>
      <div class="schedule-frequency-head">
        <span>{$t('schedule.frequency')}</span>
        <button type="button" class="schedule-frequency-close" aria-label={$t('schedule.closeEditor')} onclick={closeEditor}><Icon name="close" size={14}/></button>
      </div>
      <div class="schedule-frequency-rows">
        <div class="schedule-frequency-row">
          <span>{$t('schedule.repeat')}</span>
          <Menu options={REPEAT_OPTIONS} value={repeatMode} label={$t('schedule.repeat')} onChange={chooseRepeat}/>
        </div>

        {#if repeatMode === 'custom'}
          <div class="schedule-frequency-row">
            <span>{$t('schedule.repeats')}</span>
            <Menu options={UNIT_OPTIONS} value={draft.kind === 'once' ? 'daily' : draft.kind} label={$t('schedule.repeats')} onChange={chooseUnit}/>
          </div>
          <div class="schedule-frequency-row">
            <span>{$t('schedule.every')}</span>
            <span class="schedule-frequency-value">
              <input
                type="number"
                min="1"
                max="99"
                aria-label={$t('schedule.everyHowMany', {unit: unitNoun})}
                value={frequencyInterval(draft) ?? 1}
                oninput={(event) => setEvery(event.currentTarget.value)}
              />
              <em>{unitNoun}</em>
            </span>
          </div>
        {/if}

        {#if draft.kind === 'weekly'}
          <div class="schedule-frequency-row">
            <span>{$t('schedule.on')}</span>
            <span class="schedule-frequency-days" role="group" aria-label={$t('schedule.daysOfWeek')}>
              {#each WEEK as day}
                <button
                  type="button"
                  class="schedule-day"
                  class:on={draft.days.includes(day)}
                  aria-pressed={draft.days.includes(day)}
                  aria-label={weekdayName(day, 'long')}
                  onclick={() => toggleDay(day)}
                >{weekdayName(day, 'short')}</button>
              {/each}
            </span>
          </div>
        {/if}

        {#if draft.kind === 'yearly'}
          <div class="schedule-frequency-row">
            <span>{$t('schedule.in')}</span>
            <Menu options={MONTH_OPTIONS} value={String(draft.month)} label={$t('schedule.month')} onChange={setMonth}/>
          </div>
        {/if}

        {#if draft.kind === 'monthly' || draft.kind === 'yearly'}
          <div class="schedule-frequency-row">
            <span>{$t('schedule.onDay')}</span>
            <span class="schedule-frequency-value">
              <input type="number" min="1" max="31" aria-label={$t('schedule.dayOfMonth')} value={draft.dayOfMonth} oninput={(event) => setDayOfMonth(event.currentTarget.value)}/>
            </span>
          </div>
        {/if}

        {#if draft.kind !== 'once' && draft.kind !== 'hourly'}
          <div class="schedule-frequency-row">
            <span>{$t('schedule.at')}</span>
            <Menu options={TIME_OPTIONS} value={draft.time} label={$t('schedule.timeOfDay')} onChange={setTime}/>
          </div>
        {/if}

        {#if draft.kind === 'once'}
          <div class="schedule-frequency-row">
            <span>{$t('schedule.when')}</span>
            <span class="schedule-frequency-static">{formatScheduleTime(draft.at)}</span>
          </div>
        {/if}

        <div class="schedule-frequency-row">
          <span>{$t('schedule.timeZone')}</span>
          <span class="schedule-frequency-static">{draft.timeZone ?? localTimeZone()}</span>
        </div>
      </div>
      <p class="schedule-frequency-summary">{describeFrequency(draft)}</p>
    </div>
  {/if}
</div>
