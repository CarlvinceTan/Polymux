<script module lang="ts">
  import type {ScheduleDto, ScheduleFrequencyDto, ScheduleRunDto, ScheduleStatusDto, ScheduleWeekday} from '@flareai/protocol';
  import {activeLocale, plural, translate, type MessageKey} from '../../../i18n';
  import MESSAGE_KEYS from '../../../i18n/locales/en';

  /**
   * The wire shapes are the view's own: the main process owns the clock, the
   * run history and the next-run arithmetic, so a second definition here could
   * only ever disagree with the thing actually doing the running.
   */
  export type ScheduleStatus = ScheduleStatusDto;
  export type Weekday = ScheduleWeekday;
  export type ScheduleFrequency = ScheduleFrequencyDto;
  export type ScheduleItem = ScheduleDto;
  export type ScheduleRun = ScheduleRunDto;

  export type ScheduleSortKey = 'title' | 'next' | 'last';

  const STATUS_LABELS: Record<ScheduleStatus, MessageKey> = {
    active: 'schedule.status.active',
    paused: 'schedule.status.paused',
    running: 'schedule.status.running',
    failed: 'schedule.status.failed',
    done: 'schedule.status.done',
  };

  export function scheduleStatusLabel(status: ScheduleStatus): string {
    return translate(STATUS_LABELS[status]);
  }

  /** How many schedules are holding a result the user has not opened. Drives
   * the dot on the workspace tab as well as the one on each row. */
  export function unreadScheduleCount(items: ScheduleItem[]): number {
    return items.filter((item) => item.unread).length;
  }

  /**
   * A row nobody is waiting on any more: a one-off that has fired, or a paused
   * schedule with nothing on the clock. Drawn greyed out, and sorted last.
   */
  export function isFinished(item: ScheduleItem): boolean {
    return item.status !== 'running' && item.nextRunAt === undefined;
  }

  /**
   * The default order is by what the user still has to deal with rather than
   * by any one column: results they have not read yet first, then whatever is
   * coming up, then the rows that are finished with. Clicking a column header
   * abandons the grouping and sorts by that column alone.
   */
  function groupRank(item: ScheduleItem): number {
    if (item.unread) return 0;
    return isFinished(item) ? 2 : 1;
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

  /** The chosen days as the trigger reads them: "Mo and Th", or the language's
   * own way of joining a short list. */
  export function daysSummary(days: Weekday[]): string {
    const sorted = [...days].sort((a, b) => a - b);
    if (!sorted.length) return '';
    if (sorted.length === 7) return translate('schedule.everyDay');
    if (sorted.length === 5 && WEEKDAYS.every((day) => sorted.includes(day)))
      return translate('schedule.weekdays');
    return joinList(sorted.map((day) => weekdayName(day, 'short')));
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
    return frequency.kind === 'once' || frequency.kind === 'cron' ? undefined : frequency.interval;
  }

  /** The two shapes that repeat on no count of anything are left alone. */
  function withInterval(frequency: ScheduleFrequency, interval: number): ScheduleFrequency {
    return frequency.kind === 'once' || frequency.kind === 'cron'
      ? frequency
      : {...frequency, interval};
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
      case 'cron':
        // The expression itself is the description. Anyone reaching for cron
        // reads cron, and a prose paraphrase of an arbitrary expression is
        // more likely to mislead than to help.
        return translate('schedule.cadenceCron', {expression: frequency.expression, zone});
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
  import Icon from '../../shared/components/Icon.svelte';
  import Menu from '../../shared/components/Menu.svelte';
  import {locale, t, withLocale} from '../../../i18n';
  import {cronError, nextCronRun} from '@flareai/protocol';

  const UNIT_NOUNS = {
    cron: 'schedule.days',
    hourly: 'schedule.hours',
    daily: 'schedule.days',
    weekly: 'schedule.weeks',
    monthly: 'schedule.months',
    yearly: 'schedule.years',
    once: 'schedule.days',
  } as const;

  export let title = '';
  export let items: ScheduleItem[] = [];
  /** Opens the conversation a run happened in, from the detail panel. */
  export let onOpenItem: (item: ScheduleItem, run?: ScheduleRun) => void = () => {};
  /** Clears the unread mark once the user has actually read the result. */
  export let onMarkRead: (item: ScheduleItem) => void = () => {};
  export let onToggleItem: (item: ScheduleItem) => void = () => {};
  /** Opening the composer is the view's own business; saving is the caller's. */
  export let onSave: (
    input: {title: string; prompt: string; frequency: ScheduleFrequency},
    id: string | null,
  ) => void = () => {};
  /** A rejected edit or a run the scheduler refused to start. */
  export let error = '';
  export let onDismissError: () => void = () => {};
  export let onDeleteItem: (item: ScheduleItem) => void = () => {};
  export let onRunItem: (item: ScheduleItem) => void = () => {};

  let query = '';
  /** The search starts as its icon, the way Drive's does, so the heading and
   * the create action keep their room until a search is actually being run. */
  let searchExpanded = false;
  let searchFocused = false;
  let searchInput: HTMLInputElement;
  let searchWrapper: HTMLDivElement;
  /** null is the default grouping rather than any one column. */
  let sortKey: ScheduleSortKey | null = null;
  let sortAscending = true;
  let detailId: string | null = null;
  let detailTop = 0;
  /**
   * The new-or-edit sheet. A schedule is a written instruction and a cadence,
   * so both are written here rather than dictated to the agent in the chat and
   * hoped for: the frequency rows below are the same ones the quick cadence
   * editor uses, with the title and the prompt above them.
   */
  let composing: {id: string | null; title: string; prompt: string} | null = null;
  let menuId: string | null = null;
  let menuTop = 0;
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
  $: DAY_OPTIONS = withLocale($locale, WEEK.map((day) => ({value: String(day), label: weekdayName(day, 'long')})));
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
  function sortItems(list: ScheduleItem[], key: ScheduleSortKey | null, ascending: boolean): ScheduleItem[] {
    if (key === null) return groupItems(list);
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

  /**
   * Unread results first, newest at the top of them; then what is coming up,
   * soonest first; then the finished rows, most recently finished first. A
   * third click on the sorted column goes back to this.
   */
  function groupItems(list: ScheduleItem[]): ScheduleItem[] {
    return [...list].sort((a, b) => {
      const rank = groupRank(a) - groupRank(b);
      if (rank !== 0) return rank;
      if (groupRank(a) === 1) return (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity);
      return (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0);
    });
  }

  function sortBy(key: ScheduleSortKey): void {
    if (sortKey !== key) {
      sortKey = key;
      sortAscending = key !== 'last';
      return;
    }
    // Ascending, descending, then back to the default grouping.
    if (sortAscending === (key !== 'last')) sortAscending = !sortAscending;
    else sortKey = null;
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

  /**
   * The row opens what the run actually did. Reading it is what clears the
   * unread mark — the dot means "there is a result you have not seen", so it
   * survives until the result is on screen.
   */
  function openDetail(event: MouseEvent, item: ScheduleItem): void {
    const row = (event.currentTarget as HTMLElement).closest('.schedule-row') as HTMLElement | null;
    if (detailId === item.id) {
      detailId = null;
      return;
    }
    detailTop = row ? offsetWithin(row, 6) : 0;
    detailId = item.id;
    menuId = null;
    if (item.unread) onMarkRead(item);
  }

  function outcomeLabel(run: ScheduleRun): string {
    if (run.outcome === 'running') return translate('schedule.outcome.running');
    return translate(run.outcome === 'succeeded' ? 'schedule.outcome.succeeded' : 'schedule.outcome.failed');
  }

  /** A frequency the presets can express opens on that preset; anything else —
   * an interval above one, an hourly cadence — opens on Custom, where the
   * rows that describe it are visible. */
  function presetFor(frequency: ScheduleFrequency): typeof repeatMode {
    // Cron has no preset to land on; the expression field replaces the rows
    // entirely, so this only matters for the way back out of it.
    if (frequency.kind === 'cron') return 'daily';
    if (frequency.kind === 'hourly') return 'custom';
    if ((frequencyInterval(frequency) ?? 1) > 1) return 'custom';
    return frequency.kind;
  }

  /** Cadence edits live in the draft until the sheet is saved. */
  function commit(next: ScheduleFrequency): void {
    draft = next;
  }

  const DEFAULT_FREQUENCY: ScheduleFrequency = {kind: 'daily', interval: 1, time: '09:00'};

  /** Whether the cadence is being written as cron rather than picked. */
  $: advancedCadence = draft?.kind === 'cron';
  $: cronProblem = draft?.kind === 'cron' ? cronError(draft.expression) : null;
  /**
   * The next few firings, from the same function the scheduler uses. A cron
   * expression is easy to get subtly wrong, and the only convincing check is
   * seeing when it would actually run.
   */
  $: cronPreview = draft?.kind === 'cron' && !cronProblem
    ? nextCronRuns(draft.expression, draft.timeZone ?? localTimeZone(), 3)
    : [];

  function nextCronRuns(expression: string, zone: string, count: number): number[] {
    const runs: number[] = [];
    let cursor = Date.now();
    for (let index = 0; index < count; index += 1) {
      const next = nextCronRun(expression, cursor, zone);
      if (next === null) break;
      runs.push(next);
      cursor = next;
    }
    return runs;
  }

  /**
   * Turning the gear on carries the picked cadence across as its cron
   * equivalent, so the expression starts from what was already chosen rather
   * than from a blank field. Turning it off goes back to the pickers, since a
   * general expression has no picker to land on.
   */
  function toggleAdvancedCadence(): void {
    if (!draft) return;
    if (draft.kind === 'cron') {
      commit({...DEFAULT_FREQUENCY, timeZone: draft.timeZone});
      repeatMode = 'daily';
      return;
    }
    commit({kind: 'cron', expression: cronFor(draft), timeZone: draft.timeZone});
  }

  function setCron(expression: string): void {
    if (!draft || draft.kind !== 'cron') return;
    commit({...draft, expression});
  }

  /** The picked cadence as the expression that means the same thing. Hourly
   * and one-off have no faithful translation, so they seed a plain daily. */
  function cronFor(frequency: ScheduleFrequency): string {
    switch (frequency.kind) {
      case 'daily':
        return `${minuteOf(frequency.time)} ${hourOf(frequency.time)} * * *`;
      case 'weekly':
        return `${minuteOf(frequency.time)} ${hourOf(frequency.time)} * * ${[...frequency.days].sort((a, b) => a - b).join(',') || '*'}`;
      case 'monthly':
        return `${minuteOf(frequency.time)} ${hourOf(frequency.time)} ${frequency.dayOfMonth} * *`;
      case 'yearly':
        return `${minuteOf(frequency.time)} ${hourOf(frequency.time)} ${frequency.dayOfMonth} ${frequency.month + 1} *`;
      case 'hourly':
        return `${Math.min(59, Math.max(0, Math.round(frequency.minute ?? 0)))} * * * *`;
      default:
        return '0 9 * * *';
    }
  }

  function hourOf(time: string): number {
    const value = Number(time.split(':')[0]);
    return Number.isFinite(value) ? value : 9;
  }

  function minuteOf(time: string): number {
    const value = Number(time.split(':')[1]);
    return Number.isFinite(value) ? value : 0;
  }

  function openComposer(item?: ScheduleItem): void {
    menuId = null;
    detailId = null;
    composing = {
      id: item?.id ?? null,
      title: item?.title ?? '',
      prompt: item?.prompt ?? '',
    };
    draft = item ? {...item.frequency} : {...DEFAULT_FREQUENCY};
    repeatMode = presetFor(draft);
  }

  function closeComposer(): void {
    composing = null;
    draft = null;
  }

  function saveComposer(): void {
    if (!composing || !draft) return;
    const title = composing.title.trim();
    const prompt = composing.prompt.trim();
    if (!title || !prompt) return;
    onSave({title, prompt, frequency: draft}, composing.id);
    closeComposer();
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
      // Cron is not reachable from the unit menu — the gear is its only way
      // in — so the pickers keep whatever they were showing.
      default: return current;
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
    if (!draft || draft.kind === 'once' || draft.kind === 'hourly' || draft.kind === 'cron') return;
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
    if (composing) {
      event.stopPropagation();
      closeComposer();
    } else if (detailId) {
      event.stopPropagation();
      detailId = null;
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
    if (detailId && !target.closest('.schedule-detail') && !target.closest('.schedule-row-main')) detailId = null;
    // A search still holding a query stays open; an empty one has nothing to
    // keep the toolbar space for.
    if (searchExpanded && !query && !searchWrapper?.contains(target)) searchExpanded = false;
  }
</script>

<svelte:window onkeydown={keydown} onclick={dismiss}/>

<!-- The cadence rows, shared by the quick editor on a row and the sheet that
     writes a whole schedule: one definition, so the two cannot drift. -->
{#snippet frequencyRows(draft: ScheduleFrequency)}
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
          <Menu
            options={DAY_OPTIONS}
            values={draft.days.map(String)}
            summary={daysSummary(draft.days)}
            label={$t('schedule.daysOfWeek')}
            onToggle={(value) => toggleDay(Number(value) as Weekday)}
          />
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

      {#if draft.kind !== 'once' && draft.kind !== 'hourly' && draft.kind !== 'cron'}
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
{/snippet}



<div class="schedule-view">
  <!-- The list and the composer are the two halves of one view: writing a
       schedule replaces the table rather than covering it, and the back
       button returns to it untouched. -->
  {#if !composing}
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
      <button type="button" class="fb-action schedule-create-icon" aria-label={$t('schedule.new')} data-tooltip-label={$t('schedule.new')} onclick={() => openComposer()}>
        <Icon name="plus" size={15}/>
      </button>
    </div>

    {#if error}
      <div class="fb-error" role="alert">
        <span>{error}</span>
        <button type="button" aria-label={$t('common.dismissError')} onclick={onDismissError}><Icon name="close" size={13}/></button>
      </div>
    {/if}

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
      <div class="list-rows" role="list" onscroll={() => (menuId = null)}>
        {#each visible as item (item.id)}
          <div
            class="list-row schedule-row"
            class:menu-open={menuId === item.id || detailId === item.id}
            class:finished={isFinished(item)}
            role="listitem"
          >
            <button
              type="button"
              class="list-row-name schedule-row-main"
              aria-expanded={detailId === item.id}
              onclick={(event) => openDetail(event, item)}
            >
              <span class={`list-row-icon schedule ${item.status}`}><Icon name="clock" size={16}/></span>
              <span class="list-row-label">{item.title}</span>
              {#if item.unread}<span class="schedule-unread" aria-label={$t('schedule.unread')}></span>{/if}
            </button>
            <button
              type="button"
              class="list-row-meta cadence schedule-cadence"
              aria-label={$t('schedule.editNamed', {title: item.title})}
              data-tooltip-label={$t('common.edit')}
              onclick={() => openComposer(item)}
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
        {#if !query}<button type="button" class="schedule-create" onclick={() => openComposer()}><Icon name="plus" size={14}/><span>{$t('schedule.new')}</span></button>{/if}
      </div>
    {/if}
  {/if}

  {#if menuId}
    {@const menuItem = items.find((entry) => entry.id === menuId)}
    {#if menuItem}
      <div class="flareai-dropdown-menu schedule-row-menu" role="menu" style:top={`${menuTop}px`}>
        <button class="flareai-dropdown-item" role="menuitem" onclick={() => act(menuItem, onRunItem)}><Icon name="play" size={14}/><span>{$t('schedule.runNow')}</span></button>
        <button class="flareai-dropdown-item" role="menuitem" onclick={() => openComposer(menuItem)}><Icon name="edit" size={14}/><span>{$t('common.edit')}</span></button>
        <button class="flareai-dropdown-item" role="menuitem" onclick={() => act(menuItem, onToggleItem)}>
          <Icon name={menuItem.status === 'paused' ? 'play' : 'pause'} size={14}/><span>{menuItem.status === 'paused' ? $t('common.resume') : $t('common.pause')}</span>
        </button>
        <button class="flareai-dropdown-item destructive" role="menuitem" onclick={() => act(menuItem, onDeleteItem)}><Icon name="trash" size={14}/><span>{$t('common.delete')}</span></button>
      </div>
    {/if}
  {/if}

  {#if detailId}
    {@const detailItem = items.find((entry) => entry.id === detailId)}
    {#if detailItem}
      {@const latest = detailItem.history[0]}
      <div class="schedule-detail" style:top={`${detailTop}px`}>
        <div class="schedule-detail-head">
          <span>{detailItem.title}</span>
          <button type="button" class="schedule-frequency-close" aria-label={$t('schedule.closeDetail')} onclick={() => detailId = null}><Icon name="close" size={14}/></button>
        </div>
        <p class="schedule-detail-cadence">{describeFrequency(detailItem.frequency)}</p>
        {#if detailItem.prompt}
          <div class="schedule-detail-section">
            <h4>{$t('schedule.instruction')}</h4>
            <p class="schedule-detail-prompt">{detailItem.prompt}</p>
          </div>
        {/if}
        <div class="schedule-detail-section">
          <h4>{$t('schedule.lastResult')}</h4>
          {#if !latest}
            <p class="schedule-detail-empty">{$t('schedule.noRuns')}</p>
          {:else}
            <p class={`schedule-outcome ${latest.outcome}`}>
              <span class="schedule-outcome-dot"></span>
              <span>{outcomeLabel(latest)}</span>
              <em>{formatScheduleTime(latest.startedAt)}</em>
            </p>
            {#if latest.summary}<p class="schedule-detail-summary">{latest.summary}</p>{/if}
            {#if latest.error}<p class="schedule-detail-error">{latest.error}</p>{/if}
            {#if latest.conversationId}
              <button type="button" class="schedule-detail-open" onclick={() => { onOpenItem(detailItem, latest); detailId = null; }}>
                <Icon name="chat" size={13}/><span>{$t('schedule.openThread')}</span>
              </button>
            {/if}
          {/if}
        </div>
        {#if detailItem.history.length > 1}
          <div class="schedule-detail-section">
            <h4>{$t('schedule.earlierRuns')}</h4>
            <ul class="schedule-detail-history">
              {#each detailItem.history.slice(1) as run (run.id)}
                <li>
                  <span class={`schedule-outcome-dot ${run.outcome}`}></span>
                  <span class="schedule-detail-history-time">{formatScheduleTime(run.startedAt)}</span>
                  <span class="schedule-detail-history-text">{run.summary ?? run.error ?? outcomeLabel(run)}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  {/if}

  {#if composing && draft}
    <!-- The whole schedule, in place of the list rather than over it: writing
         one is its own task, not an aside to reading the table. The list is
         still there behind the back button, exactly as it was. -->
    <div class="schedule-composer">
      <div class="schedule-composer-bar">
        <button type="button" class="fb-action" aria-label={$t('common.back')} data-tooltip-label={$t('common.back')} onclick={closeComposer}>
          <Icon name="back" size={15}/>
        </button>
        <h3>{composing.id ? $t('schedule.editTitle') : $t('schedule.new')}</h3>
        <button
          type="button"
          class="schedule-composer-save"
          disabled={!composing.title.trim() || !composing.prompt.trim() || Boolean(cronProblem)}
          onclick={saveComposer}
        >{$t('common.save')}</button>
      </div>

      <div class="schedule-composer-body">
        <label class="schedule-composer-field">
          <span>{$t('schedule.titleLabel')}</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="text"
            autofocus
            placeholder={$t('schedule.titlePlaceholder')}
            bind:value={composing.title}
          />
        </label>

        <label class="schedule-composer-field">
          <span>{$t('schedule.instruction')}</span>
          <textarea
            rows="6"
            placeholder={$t('schedule.promptPlaceholder')}
            bind:value={composing.prompt}
          ></textarea>
          <!-- Nobody is watching when this runs, so a prompt that asks a
               question would simply stall. -->
          <em>{$t('schedule.promptHint')}</em>
        </label>

        <div class="schedule-composer-heading">
          <h4>{$t('schedule.frequency')}</h4>
          <!-- The pickers cover what people ask for; the gear is where the
               rest lives, for the cadences no picker can say. -->
          <button
            type="button"
            class="fb-action"
            class:quiet={advancedCadence}
            aria-label={$t('schedule.advanced')}
            aria-pressed={advancedCadence}
            data-tooltip-label={$t('schedule.advanced')}
            onclick={toggleAdvancedCadence}
          ><Icon name="settings" size={15}/></button>
        </div>

        {#if draft.kind === 'cron'}
          <div class="schedule-cron">
            <input
              type="text"
              class="schedule-cron-input"
              class:invalid={Boolean(cronProblem)}
              spellcheck="false"
              autocapitalize="off"
              autocorrect="off"
              aria-label={$t('schedule.cronExpression')}
              aria-invalid={Boolean(cronProblem)}
              value={draft.expression}
              oninput={(event) => setCron(event.currentTarget.value)}
            />
            <p class="schedule-cron-legend">{$t('schedule.cronFields')}</p>
            {#if cronProblem}
              <p class="schedule-cron-error">{cronProblem}</p>
            {:else}
              <!-- The next few firings, computed by the same code the
                   scheduler runs, so what is previewed is what will happen. -->
              <p class="schedule-cron-next">
                <span>{$t('schedule.nextRuns')}</span>
                {#each cronPreview as run (run)}<em>{formatScheduleTime(run)}</em>{/each}
                {#if cronPreview.length === 0}<em>{$t('schedule.cronNeverRuns')}</em>{/if}
              </p>
            {/if}
          </div>
        {:else}
          {@render frequencyRows(draft)}
          <p class="schedule-frequency-summary">{describeFrequency(draft)}</p>
        {/if}
      </div>
    </div>
  {/if}

</div>
