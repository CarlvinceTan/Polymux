<script lang="ts">
  import {onMount} from 'svelte';
  import type {
    CalendarAvailability,
    CalendarEventDto,
    CalendarEventInput,
    CalendarListDto,
    CalendarRecurrenceFrequency,
  } from '@polymux/protocol';
  import Icon from '../../shared/components/Icon.svelte';
  import Menu from '../../shared/components/Menu.svelte';
  import {polymuxApi} from '../../api/polymux';
  import {activeLocale} from '../../../i18n';

  type CalendarViewMode = 'day' | 'week' | 'month' | 'year';
  type EditorState = {
    id: string | null;
    title: string;
    calendarId: string;
    allDay: boolean;
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
    location: string;
    notes: string;
    url: string;
    recurrence: '' | CalendarRecurrenceFrequency;
    alarm: string;
    availability: CalendarAvailability;
    editable: boolean;
  };

  const api = polymuxApi();
  const HOUR_HEIGHT = 52;
  const HOURS = Array.from({length: 24}, (_, hour) => hour);
  const WEEKDAY_REFERENCE = new Date(2021, 0, 4);

  let calendars: CalendarListDto[] = [];
  let events: CalendarEventDto[] = [];
  let hiddenCalendarIds: string[] = [];
  let cursor = startOfDay(new Date());
  let mode: CalendarViewMode = storedMode();
  let loading = true;
  let saving = false;
  let error = '';
  let search = '';
  let searchOpen = false;
  let sidebarOpen = true;
  let editor: EditorState | null = null;
  let notice = '';
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let timeScroll: HTMLDivElement;

  $: shownEvents = events.filter((event) => {
    if (hiddenCalendarIds.includes(event.calendarId)) return false;
    const query = search.trim().toLocaleLowerCase();
    return !query || [event.title, event.location, event.notes]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(query));
  });
  $: sources = groupedCalendars(calendars);
  $: visibleCalendarIds = calendars.filter((calendar) => !hiddenCalendarIds.includes(calendar.id)).map((calendar) => calendar.id);
  $: compactCalendarOptions = calendars.map((calendar) => ({value: calendar.id, label: `${calendar.source.title} · ${calendar.title}`}));
  $: weekDays = daysFrom(startOfWeek(cursor), 7);
  $: monthDays = daysFrom(startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1)), 42);
  $: miniDays = daysFrom(startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1)), 42);
  $: range = rangeFor(cursor, mode);
  $: heading = headingFor(cursor, mode);

  onMount(() => {
    try {
      hiddenCalendarIds = JSON.parse(localStorage.getItem('polymux-calendar-hidden') ?? '[]');
      if (!Array.isArray(hiddenCalendarIds)) hiddenCalendarIds = [];
    } catch {
      hiddenCalendarIds = [];
    }
    void refresh(true);
    const timer = setInterval(() => void loadEvents(false), 60_000);
    return () => {
      clearInterval(timer);
      clearTimeout(noticeTimer);
    };
  });

  async function refresh(initial = false): Promise<void> {
    if (initial) loading = true;
    error = '';
    try {
      calendars = await api.calendar.calendars();
      await loadEvents(false);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function loadEvents(showSpinner = true): Promise<void> {
    if (showSpinner) loading = true;
    error = '';
    const requested = rangeFor(cursor, mode);
    try {
      events = await api.calendar.events(requested.start.toISOString(), requested.end.toISOString());
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
      queueMicrotask(scrollToWorkingDay);
    }
  }

  function scrollToWorkingDay(): void {
    if ((mode === 'day' || mode === 'week') && timeScroll && timeScroll.scrollTop < 10)
      timeScroll.scrollTop = Math.max(0, 7.5 * HOUR_HEIGHT);
  }

  function chooseMode(next: CalendarViewMode): void {
    if (mode === next) return;
    mode = next;
    localStorage.setItem('polymux-calendar-view', next);
    void loadEvents();
  }

  function move(amount: number): void {
    const next = new Date(cursor);
    if (mode === 'day') next.setDate(next.getDate() + amount);
    else if (mode === 'week') next.setDate(next.getDate() + amount * 7);
    else if (mode === 'month') next.setMonth(next.getMonth() + amount, 1);
    else next.setFullYear(next.getFullYear() + amount, 0, 1);
    cursor = next;
    void loadEvents();
  }

  function goToday(): void {
    cursor = startOfDay(new Date());
    void loadEvents();
  }

  function selectDate(day: Date, view: CalendarViewMode = mode): void {
    cursor = startOfDay(day);
    if (view !== mode) {
      mode = view;
      localStorage.setItem('polymux-calendar-view', view);
    }
    void loadEvents();
  }

  function toggleCalendar(id: string): void {
    hiddenCalendarIds = hiddenCalendarIds.includes(id)
      ? hiddenCalendarIds.filter((item) => item !== id)
      : [...hiddenCalendarIds, id];
    localStorage.setItem('polymux-calendar-hidden', JSON.stringify(hiddenCalendarIds));
  }

  function openCreate(day = cursor, hour = 9): void {
    const writable = calendars.find((calendar) => calendar.editable && !hiddenCalendarIds.includes(calendar.id))
      ?? calendars.find((calendar) => calendar.editable);
    if (!writable) {
      showNotice('Connect or enable a writable calendar first.');
      return;
    }
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + 3_600_000);
    editor = {
      id: null,
      title: '',
      calendarId: writable.id,
      allDay: false,
      startDate: dateInput(start),
      startTime: timeInput(start),
      endDate: dateInput(end),
      endTime: timeInput(end),
      location: '',
      notes: '',
      url: '',
      recurrence: '',
      alarm: '15',
      availability: 'busy',
      editable: true,
    };
  }

  function openEvent(event: CalendarEventDto): void {
    const start = new Date(event.start);
    const end = new Date(event.end);
    editor = {
      id: event.id,
      title: event.title,
      calendarId: event.calendarId,
      allDay: event.allDay,
      startDate: dateInput(start),
      startTime: timeInput(start),
      endDate: dateInput(end),
      endTime: timeInput(end),
      location: event.location ?? '',
      notes: event.notes ?? '',
      url: event.url ?? '',
      recurrence: event.recurrence?.frequency ?? '',
      alarm: event.alarmMinutes === undefined ? '' : String(event.alarmMinutes),
      availability: event.availability,
      editable: event.editable,
    };
  }

  function allDayChanged(): void {
    if (!editor) return;
    if (editor.allDay && editor.endDate <= editor.startDate)
      editor = {...editor, endDate: dateInput(addDays(localDate(editor.startDate), 1))};
  }

  async function saveEvent(): Promise<void> {
    if (!editor || !editor.editable || saving) return;
    const title = editor.title.trim();
    if (!title) {
      showNotice('Add an event title.');
      return;
    }
    const start = editor.allDay
      ? localDate(editor.startDate)
      : localDateTime(editor.startDate, editor.startTime);
    const end = editor.allDay
      ? localDate(editor.endDate)
      : localDateTime(editor.endDate, editor.endTime);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      showNotice('The event must end after it starts.');
      return;
    }
    const input: CalendarEventInput = {
      calendarId: editor.calendarId,
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: editor.allDay,
      location: editor.location.trim() || undefined,
      notes: editor.notes.trim() || undefined,
      url: editor.url.trim() || undefined,
      recurrence: editor.recurrence ? {frequency: editor.recurrence, interval: 1} : null,
      alarmMinutes: editor.alarm === '' ? null : Number(editor.alarm),
      availability: editor.availability,
    };
    saving = true;
    try {
      if (editor.id) await api.calendar.update(editor.id, {
        ...input,
        location: editor.location.trim() || null,
        notes: editor.notes.trim() || null,
        url: editor.url.trim() || null,
      });
      else await api.calendar.create(input);
      editor = null;
      await loadEvents(false);
      showNotice('Event saved.');
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saving = false;
    }
  }

  async function deleteEvent(): Promise<void> {
    if (!editor?.id || !editor.editable || saving) return;
    saving = true;
    try {
      await api.calendar.remove(editor.id);
      editor = null;
      await loadEvents(false);
      showNotice('Event deleted.');
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saving = false;
    }
  }

  async function importCalendar(): Promise<void> {
    const writable = calendars.find((calendar) => calendar.editable && !hiddenCalendarIds.includes(calendar.id))
      ?? calendars.find((calendar) => calendar.editable);
    if (!writable) return showNotice('Connect or enable a writable calendar first.');
    try {
      const result = await api.calendar.importFile(writable.id);
      if (!result.fileName) return;
      await loadEvents(false);
      showNotice(`Imported ${result.imported} event${result.imported === 1 ? '' : 's'}${result.skipped ? ` · ${result.skipped} skipped` : ''}.`);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function exportCalendar(): Promise<void> {
    try {
      const visibleIds = calendars.filter((calendar) => !hiddenCalendarIds.includes(calendar.id)).map((calendar) => calendar.id);
      const file = await api.calendar.exportFile({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        calendarIds: visibleIds,
      });
      if (file) showNotice('Calendar exported.');
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function showNotice(message: string): void {
    notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice = '', 4200);
  }

  function calendarColor(id: string): string {
    return calendars.find((calendar) => calendar.id === id)?.color ?? '#6f7e91';
  }

  function eventsOnDay(day: Date, allDay: boolean | undefined, items: CalendarEventDto[]): CalendarEventDto[] {
    const start = startOfDay(day).getTime();
    const end = addDays(startOfDay(day), 1).getTime();
    return items.filter((event) => {
      if (allDay !== undefined && event.allDay !== allDay) return false;
      return Date.parse(event.start) < end && Date.parse(event.end) > start;
    });
  }

  function eventTop(event: CalendarEventDto, day: Date): number {
    const start = Math.max(Date.parse(event.start), startOfDay(day).getTime());
    return Math.max(0, (start - startOfDay(day).getTime()) / 3_600_000 * HOUR_HEIGHT);
  }

  function eventHeight(event: CalendarEventDto, day: Date): number {
    const dayStart = startOfDay(day).getTime();
    const start = Math.max(Date.parse(event.start), dayStart);
    const end = Math.min(Date.parse(event.end), dayStart + 86_400_000);
    return Math.max(22, (end - start) / 3_600_000 * HOUR_HEIGHT);
  }

  function timeLabel(event: CalendarEventDto): string {
    if (event.allDay) return 'all-day';
    return new Date(event.start).toLocaleTimeString(activeLocale(), {hour: 'numeric', minute: '2-digit'});
  }

  function moreCount(day: Date, items: CalendarEventDto[]): number {
    return Math.max(0, eventsOnDay(day, undefined, items).length - 4);
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      editor = null;
      searchOpen = false;
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      openCreate();
    }
  }

  function storedMode(): CalendarViewMode {
    const value = typeof localStorage === 'undefined' ? null : localStorage.getItem('polymux-calendar-view');
    return value === 'day' || value === 'week' || value === 'year' ? value : 'month';
  }

  function groupedCalendars(items: CalendarListDto[]): Array<{id: string; title: string; calendars: CalendarListDto[]}> {
    const groups = new Map<string, {id: string; title: string; calendars: CalendarListDto[]}>();
    for (const calendar of items) {
      const group = groups.get(calendar.source.id) ?? {id: calendar.source.id, title: calendar.source.title, calendars: []};
      group.calendars.push(calendar);
      groups.set(calendar.source.id, group);
    }
    return [...groups.values()];
  }

  function rangeFor(day: Date, view: CalendarViewMode): {start: Date; end: Date} {
    if (view === 'day') return {start: startOfDay(day), end: addDays(startOfDay(day), 1)};
    if (view === 'week') {
      const start = startOfWeek(day);
      return {start, end: addDays(start, 7)};
    }
    if (view === 'month') {
      const start = startOfWeek(new Date(day.getFullYear(), day.getMonth(), 1));
      return {start, end: addDays(start, 42)};
    }
    return {start: new Date(day.getFullYear(), 0, 1), end: new Date(day.getFullYear() + 1, 0, 1)};
  }

  function headingFor(day: Date, view: CalendarViewMode): string {
    if (view === 'day') return day.toLocaleDateString(activeLocale(), {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'});
    if (view === 'week') {
      const start = startOfWeek(day);
      const end = addDays(start, 6);
      if (start.getMonth() === end.getMonth()) return `${start.toLocaleDateString(activeLocale(), {month: 'long'})} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
      return `${start.toLocaleDateString(activeLocale(), {month: 'short', day: 'numeric'})} – ${end.toLocaleDateString(activeLocale(), {month: 'short', day: 'numeric', year: 'numeric'})}`;
    }
    if (view === 'month') return day.toLocaleDateString(activeLocale(), {month: 'long', year: 'numeric'});
    return String(day.getFullYear());
  }

  function startOfDay(day: Date): Date {
    const result = new Date(day);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  function startOfWeek(day: Date): Date {
    const result = startOfDay(day);
    const mondayOffset = (result.getDay() + 6) % 7;
    result.setDate(result.getDate() - mondayOffset);
    return result;
  }

  function addDays(day: Date, amount: number): Date {
    const result = new Date(day);
    result.setDate(result.getDate() + amount);
    return result;
  }

  function daysFrom(start: Date, count: number): Date[] {
    return Array.from({length: count}, (_, index) => addDays(start, index));
  }

  function sameDay(left: Date, right: Date): boolean {
    return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  }

  function dateInput(day: Date): string {
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  }

  function timeInput(day: Date): string {
    return `${String(day.getHours()).padStart(2, '0')}:${String(day.getMinutes()).padStart(2, '0')}`;
  }

  function localDate(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function localDateTime(date: string, time: string): Date {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute);
  }

  function hourLabel(hour: number): string {
    return new Date(2020, 0, 1, hour).toLocaleTimeString(activeLocale(), {hour: 'numeric'});
  }

  function weekdayName(index: number, width: 'short' | 'narrow' = 'short'): string {
    return addDays(WEEKDAY_REFERENCE, index).toLocaleDateString(activeLocale(), {weekday: width});
  }

  function monthName(index: number): string {
    return new Date(2020, index, 1).toLocaleDateString(activeLocale(), {month: 'long'});
  }
</script>

<svelte:window onkeydown={keydown}/>

<section class="calendar-view" aria-label="Calendar">
  {#if sidebarOpen}
    <aside class="calendar-sidebar">
      <div class="mini-heading">
        <strong>{cursor.toLocaleDateString(activeLocale(), {month: 'long', year: 'numeric'})}</strong>
        <div>
          <button type="button" aria-label="Previous month" onclick={() => { const next = new Date(cursor); next.setMonth(next.getMonth() - 1, 1); cursor = next; void loadEvents(); }}><Icon name="back" size={13}/></button>
          <button type="button" aria-label="Next month" onclick={() => { const next = new Date(cursor); next.setMonth(next.getMonth() + 1, 1); cursor = next; void loadEvents(); }}><Icon name="forward" size={13}/></button>
        </div>
      </div>
      <div class="mini-weekdays" aria-hidden="true">{#each HOURS.slice(0, 7) as index}<span>{weekdayName(index, 'narrow')}</span>{/each}</div>
      <div class="mini-grid">
        {#each miniDays as day}
          <button type="button" class:outside={day.getMonth() !== cursor.getMonth()} class:today={sameDay(day, new Date())} class:selected={sameDay(day, cursor)} onclick={() => selectDate(day)}>{day.getDate()}</button>
        {/each}
      </div>

      <div class="calendar-list-heading"><span>Calendars</span><button type="button" aria-label="Refresh calendars" onclick={() => void refresh()}><Icon name="reload" size={13}/></button></div>
      <div class="calendar-source-list">
        {#each sources as source (source.id)}
          <div class="calendar-source">
            <p>{source.title}</p>
            {#each source.calendars as calendar (calendar.id)}
              <button type="button" class="calendar-row" class:disabled={hiddenCalendarIds.includes(calendar.id)} aria-pressed={!hiddenCalendarIds.includes(calendar.id)} onclick={() => toggleCalendar(calendar.id)}>
                <span class="calendar-check" style:--calendar-color={calendar.color}>{#if !hiddenCalendarIds.includes(calendar.id)}<Icon name="check" size={10} strokeWidth={2.3}/>{/if}</span>
                <span>{calendar.title}</span>
                {#if calendar.subscribed}<small>read-only</small>{/if}
              </button>
            {/each}
          </div>
        {/each}
      </div>
      <button type="button" class="accounts-button" onclick={() => void api.calendar.openAccounts()}><Icon name="settings" size={14}/><span>Calendar Accounts…</span></button>
    </aside>
  {/if}

  <div class="calendar-main">
    <header class="calendar-toolbar">
      <div class="calendar-toolbar-leading">
        <button type="button" class="bare-icon wide-calendar-toggle" aria-label={sidebarOpen ? 'Hide calendars' : 'Show calendars'} onclick={() => sidebarOpen = !sidebarOpen}><Icon name="panel-left" size={16}/></button>
        <div class="compact-calendar-menu">
          <Menu options={compactCalendarOptions} values={visibleCalendarIds} summary="Calendars" label="Calendars" icon="calendar" plain onToggle={toggleCalendar}/>
        </div>
        <button type="button" class="today-button" onclick={goToday}>Today</button>
        <span class="nav-buttons">
          <button type="button" aria-label="Previous" onclick={() => move(-1)}><Icon name="back" size={14}/></button>
          <button type="button" aria-label="Next" onclick={() => move(1)}><Icon name="forward" size={14}/></button>
        </span>
        <h2>{heading}</h2>
      </div>
      <div class="view-switcher" role="group" aria-label="Calendar view">
        {#each ['day', 'week', 'month', 'year'] as view}
          <button type="button" class:active={mode === view} aria-pressed={mode === view} onclick={() => chooseMode(view as CalendarViewMode)}>{view[0].toUpperCase() + view.slice(1)}</button>
        {/each}
      </div>
      <div class="calendar-toolbar-actions">
        {#if searchOpen}<div class="calendar-search"><Icon name="search" size={14}/><input bind:value={search} placeholder="Search events" aria-label="Search events"/><button type="button" aria-label="Close search" onclick={() => { search = ''; searchOpen = false; }}><Icon name="close" size={12}/></button></div>{:else}<button type="button" class="bare-icon" aria-label="Search" onclick={() => searchOpen = true}><Icon name="search" size={15}/></button>{/if}
        <button type="button" class="bare-icon" aria-label="Import calendar" onclick={() => void importCalendar()}><Icon name="import" size={15}/></button>
        <button type="button" class="bare-icon" aria-label="Export visible calendar" onclick={() => void exportCalendar()}><Icon name="download" size={15}/></button>
        <button type="button" class="add-event" aria-label="New event" onclick={() => openCreate()}><Icon name="plus" size={15}/></button>
      </div>
    </header>

    {#if loading && !events.length}
      <div class="calendar-empty"><span class="calendar-spinner"></span><span>Loading calendars…</span></div>
    {:else if error}
      <div class="calendar-empty error-state"><Icon name="calendar-error" size={28}/><strong>Calendar is unavailable</strong><span>{error}</span><button type="button" onclick={() => void refresh(true)}>Try Again</button></div>
    {:else if mode === 'month'}
      <div class="month-view">
        <div class="month-weekdays">{#each HOURS.slice(0, 7) as index}<span>{weekdayName(index)}</span>{/each}</div>
        <div class="month-grid">
          {#each monthDays as day}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="month-day" class:outside={day.getMonth() !== cursor.getMonth()} class:today={sameDay(day, new Date())} ondblclick={() => openCreate(day)}>
              <button type="button" class="month-date" onclick={() => selectDate(day, 'day')}>{day.getDate()}</button>
              <div class="month-events">
                {#each eventsOnDay(day, undefined, shownEvents).slice(0, 4) as item (item.id)}
                  <button type="button" class="month-event" class:all-day={item.allDay} style:--event-color={calendarColor(item.calendarId)} onclick={() => openEvent(item)} ondblclick={(event) => event.stopPropagation()}>
                    <span class="event-dot"></span>{#if !item.allDay}<time>{timeLabel(item)}</time>{/if}<strong>{item.title}</strong>
                  </button>
                {/each}
                {#if moreCount(day, shownEvents)}<button type="button" class="more-events" onclick={() => selectDate(day, 'day')}>+{moreCount(day, shownEvents)} more</button>{/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {:else if mode === 'year'}
      <div class="year-view">
        {#each HOURS.slice(0, 12) as month}
          {@const first = new Date(cursor.getFullYear(), month, 1)}
          {@const days = daysFrom(startOfWeek(first), 42)}
          <section class="year-month">
            <button type="button" class="year-month-title" onclick={() => selectDate(first, 'month')}>{monthName(month)}</button>
            <div class="year-weekdays">{#each HOURS.slice(0, 7) as index}<span>{weekdayName(index, 'narrow')}</span>{/each}</div>
            <div class="year-days">
              {#each days as day}
                <button type="button" class:outside={day.getMonth() !== month} class:today={sameDay(day, new Date())} class:has-events={eventsOnDay(day, undefined, shownEvents).length > 0} style:--day-color={eventsOnDay(day, undefined, shownEvents)[0] ? calendarColor(eventsOnDay(day, undefined, shownEvents)[0].calendarId) : '#6f7e91'} onclick={() => selectDate(day, 'day')}>{day.getDate()}</button>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {:else}
      <div class="time-view" class:single={mode === 'day'}>
        <div class="time-header">
          <div class="time-gutter"></div>
          {#each mode === 'day' ? [cursor] : weekDays as day}
            <button type="button" class="time-day-heading" class:today={sameDay(day, new Date())} onclick={() => mode === 'week' && selectDate(day, 'day')}>
              <span>{day.toLocaleDateString(activeLocale(), {weekday: 'short'})}</span><strong>{day.getDate()}</strong>
            </button>
          {/each}
        </div>
        <div class="all-day-row">
          <span class="all-day-label">all-day</span>
          {#each mode === 'day' ? [cursor] : weekDays as day}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="all-day-cell" ondblclick={() => openCreate(day, 0)}>
              {#each eventsOnDay(day, true, shownEvents) as item (item.id)}
                <button type="button" style:--event-color={calendarColor(item.calendarId)} onclick={() => openEvent(item)}>{item.title}</button>
              {/each}
            </div>
          {/each}
        </div>
        <div class="time-scroll" bind:this={timeScroll}>
          <div class="time-grid" style:--day-count={mode === 'day' ? 1 : 7} style:--hour-height={`${HOUR_HEIGHT}px`}>
            <div class="time-labels">{#each HOURS as hour}<span style:top={`${hour * HOUR_HEIGHT}px`}>{hourLabel(hour)}</span>{/each}</div>
            {#each mode === 'day' ? [cursor] : weekDays as day}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="time-day-column" ondblclick={(event) => { const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect(); openCreate(day, Math.max(0, Math.min(23, Math.floor((event.clientY - bounds.top) / HOUR_HEIGHT)))); }}>
                {#each eventsOnDay(day, false, shownEvents) as item (item.id)}
                  <button type="button" class="time-event" style:--event-color={calendarColor(item.calendarId)} style:top={`${eventTop(item, day)}px`} style:height={`${eventHeight(item, day)}px`} onclick={() => openEvent(item)} ondblclick={(event) => event.stopPropagation()}>
                    <strong>{item.title}</strong><span>{timeLabel(item)}{item.location ? ` · ${item.location}` : ''}</span>
                  </button>
                {/each}
                {#if sameDay(day, new Date())}<span class="now-line" style:top={`${(new Date().getHours() + new Date().getMinutes() / 60) * HOUR_HEIGHT}px`}><i></i></span>{/if}
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>

  {#if editor}
    <div class="event-editor-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) editor = null; }}>
      <div class="event-editor" role="dialog" aria-modal="true" aria-label={editor.id ? 'Event details' : 'New event'}>
        <header><span class="event-calendar-dot" style:--event-color={calendarColor(editor.calendarId)}></span><h3>{editor.id ? 'Event' : 'New Event'}</h3><button type="button" aria-label="Close" onclick={() => editor = null}><Icon name="close" size={14}/></button></header>
        <div class="event-editor-body">
          <input class="event-title-input" bind:value={editor.title} placeholder="Event title" disabled={!editor.editable}/>
          <label><span>Calendar</span>{#if editor.editable}<Menu options={calendars.filter((calendar) => calendar.editable || calendar.id === editor?.calendarId).map((calendar) => ({value: calendar.id, label: `${calendar.source.title} · ${calendar.title}`}))} value={editor.calendarId} label="Calendar" wide onChange={(calendarId) => { if (editor) editor = {...editor, calendarId}; }}/>{:else}<span class="event-editor-static">{calendars.find((calendar) => calendar.id === editor?.calendarId)?.title ?? 'Calendar'}</span>{/if}</label>
          <label class="checkbox-row"><span>All day</span><input type="checkbox" bind:checked={editor.allDay} disabled={!editor.editable} onchange={allDayChanged}/></label>
          <label><span>Starts</span><div class="date-time-fields"><input type="date" bind:value={editor.startDate} disabled={!editor.editable}/>{#if !editor.allDay}<input type="time" bind:value={editor.startTime} disabled={!editor.editable}/>{/if}</div></label>
          <label><span>Ends</span><div class="date-time-fields"><input type="date" bind:value={editor.endDate} disabled={!editor.editable}/>{#if !editor.allDay}<input type="time" bind:value={editor.endTime} disabled={!editor.editable}/>{/if}</div></label>
          <label><span>Repeat</span><select bind:value={editor.recurrence} disabled={!editor.editable}><option value="">Never</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option><option value="yearly">Every year</option></select></label>
          <label><span>Alert</span><select bind:value={editor.alarm} disabled={!editor.editable}><option value="">None</option><option value="0">At time of event</option><option value="5">5 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></label>
          <label><span>Show as</span><select bind:value={editor.availability} disabled={!editor.editable}><option value="busy">Busy</option><option value="free">Free</option><option value="tentative">Tentative</option><option value="unavailable">Unavailable</option></select></label>
          <label><span>Location</span><input bind:value={editor.location} placeholder="Add location" disabled={!editor.editable}/></label>
          <label><span>URL</span><input type="url" bind:value={editor.url} placeholder="Add link" disabled={!editor.editable}/></label>
          <label class="notes-field"><span>Notes</span><textarea bind:value={editor.notes} placeholder="Add notes" rows="3" disabled={!editor.editable}></textarea></label>
        </div>
        <footer>
          {#if editor.id && editor.editable}<button type="button" class="delete-event" onclick={() => void deleteEvent()} disabled={saving}><Icon name="trash" size={13}/>Delete</button>{:else}<span></span>{/if}
          <div><button type="button" onclick={() => editor = null}>Cancel</button>{#if editor.editable}<button type="button" class="save-event" onclick={() => void saveEvent()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>{/if}</div>
        </footer>
      </div>
    </div>
  {/if}

  {#if notice}<div class="calendar-notice" role="status">{notice}</div>{/if}
</section>

<style>
  .calendar-view { position: relative; height: 100%; min-width: 0; display: flex; overflow: hidden; background: var(--main-panel-background); color: var(--neutral-950); container-type: inline-size; }
  button, input, select, textarea { font: inherit; }
  button { color: inherit; }
  .calendar-sidebar { width: 188px; min-width: 188px; display: flex; flex-direction: column; box-sizing: border-box; padding: 12px 10px 9px; overflow: hidden; border-right: 1px solid var(--neutral-200); background: var(--neutral-50); transition: width .18s cubic-bezier(.4,0,.2,1), min-width .18s cubic-bezier(.4,0,.2,1), padding .18s cubic-bezier(.4,0,.2,1), opacity .12s ease, border-color .12s ease; }
  .mini-heading, .calendar-list-heading { display: flex; align-items: center; justify-content: space-between; padding: 0 5px; }
  .mini-heading strong { font-size: 12px; font-weight: 620; }
  .mini-heading div, .nav-buttons { display: flex; align-items: center; }
  .mini-heading button, .calendar-list-heading button, .nav-buttons button, .bare-icon, .event-editor header button { width: 25px; height: 25px; display: grid; place-items: center; border: 0; padding: 0; background: transparent; color: var(--neutral-500); cursor: pointer; transition: color .15s ease; }
  .mini-heading button:hover, .calendar-list-heading button:hover, .nav-buttons button:hover, .bare-icon:hover, .event-editor header button:hover { color: var(--neutral-950); }
  .mini-weekdays, .mini-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
  .mini-weekdays { margin-top: 9px; color: var(--neutral-400); font-size: 9px; text-align: center; }
  .mini-grid { margin-top: 3px; }
  .mini-grid button { aspect-ratio: 1; border: 0; border-radius: 50%; padding: 0; background: transparent; font-size: 10px; cursor: pointer; }
  .mini-grid button:hover { color: var(--accent-600, #3d72c8); }
  .mini-grid button.outside { color: var(--neutral-300); }
  .mini-grid button.today { color: #fff; background: #df554b; }
  .mini-grid button.selected:not(.today) { background: var(--neutral-200); }
  .calendar-list-heading { margin-top: 17px; color: var(--neutral-500); font-size: 10.5px; font-weight: 620; text-transform: uppercase; letter-spacing: .045em; }
  .calendar-source-list { min-height: 0; flex: 1; margin-top: 4px; overflow-y: auto; scrollbar-width: none; }
  .calendar-source-list::-webkit-scrollbar { display: none; }
  .calendar-source p { margin: 10px 6px 3px; overflow: hidden; color: var(--neutral-400); font-size: 10px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .calendar-row { width: 100%; height: 28px; display: flex; align-items: center; gap: 7px; border: 0; border-radius: 7px; padding: 0 6px; background: transparent; cursor: pointer; text-align: left; }
  .calendar-row:hover { background: var(--neutral-100); }
  .calendar-row > span:nth-child(2) { min-width: 0; flex: 1; overflow: hidden; font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
  .calendar-row small { color: var(--neutral-400); font-size: 8.5px; }
  .calendar-row.disabled { color: var(--neutral-400); }
  .calendar-check { width: 13px; height: 13px; display: grid; flex: none; place-items: center; border: 1.5px solid var(--calendar-color); border-radius: 4px; background: var(--calendar-color); color: white; }
  .calendar-row.disabled .calendar-check { background: transparent; }
  .accounts-button { height: 30px; display: flex; align-items: center; gap: 8px; border: 0; border-top: 1px solid var(--neutral-200); padding: 8px 5px 0; background: transparent; color: var(--neutral-500); cursor: pointer; font-size: 11px; }
  .accounts-button:hover { color: var(--neutral-950); }
  .calendar-main { min-width: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .calendar-toolbar { height: 48px; min-height: 48px; display: grid; grid-template-columns: minmax(200px,1fr) auto minmax(165px,1fr); align-items: center; gap: 10px; padding: 0 12px; border-bottom: 1px solid var(--neutral-200); }
  .calendar-toolbar-leading, .calendar-toolbar-actions { min-width: 0; display: flex; align-items: center; gap: 5px; }
  .compact-calendar-menu { display: none; }
  .compact-calendar-menu :global(.select-menu-trigger.plain) { width: 25px; height: 25px; justify-content: center; border-radius: 0; padding: 0; background: transparent; color: var(--neutral-500); }
  .compact-calendar-menu :global(.select-menu-trigger.plain:hover), .compact-calendar-menu :global(.select-menu-trigger.plain[aria-expanded='true']) { background: transparent; color: var(--neutral-950); }
  .compact-calendar-menu :global(.select-menu-trigger > span:not(.select-menu-icon)) { display: none; }
  .compact-calendar-menu :global(.select-menu-list) { right: auto; left: 0; min-width: 190px; max-width: min(260px,calc(100vw - 16px)); }
  .calendar-toolbar-leading h2 { min-width: 0; margin: 0 0 0 5px; overflow: hidden; font-size: 14px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }
  .today-button { height: 26px; border: 1px solid var(--neutral-250, var(--neutral-200)); border-radius: 7px; padding: 0 9px; background: transparent; cursor: pointer; font-size: 11px; }
  .today-button:hover { border-color: var(--neutral-400); }
  .view-switcher { height: 27px; display: flex; padding: 2px; border-radius: 8px; background: var(--neutral-100); }
  .view-switcher button { min-width: 48px; border: 0; border-radius: 6px; padding: 0 8px; background: transparent; color: var(--neutral-500); cursor: pointer; font-size: 10.5px; text-transform: capitalize; }
  .view-switcher button.active { background: var(--main-panel-background); color: var(--neutral-950); box-shadow: 0 1px 3px rgba(0,0,0,.09); }
  .calendar-toolbar-actions { justify-content: flex-end; }
  .add-event { width: 27px; height: 27px; display: grid; place-items: center; border: 0; border-radius: 8px; padding: 0; background: #df554b; color: white; cursor: pointer; }
  .add-event:hover { background: #c94b43; }
  .calendar-search { width: min(180px,24vw); height: 27px; display: flex; align-items: center; gap: 6px; box-sizing: border-box; padding: 0 6px 0 8px; border: 1px solid var(--neutral-200); border-radius: 8px; background: var(--neutral-50); color: var(--neutral-400); }
  .calendar-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--neutral-950); font-size: 11px; }
  .calendar-search button { width: 18px; height: 18px; display: grid; place-items: center; border: 0; padding: 0; background: transparent; color: var(--neutral-400); cursor: pointer; }
  .calendar-empty { min-height: 100%; display: flex; flex: 1; align-items: center; justify-content: center; gap: 9px; color: var(--neutral-400); font-size: 12px; }
  .calendar-spinner { width: 14px; height: 14px; box-sizing: border-box; border: 2px solid var(--neutral-250, var(--neutral-200)); border-top-color: var(--neutral-600); border-radius: 50%; animation: calendar-spin .7s linear infinite; }
  @keyframes calendar-spin { to { transform: rotate(360deg); } }
  .error-state { flex-direction: column; text-align: center; }
  .error-state strong { color: var(--neutral-800); font-size: 13px; }
  .error-state span { max-width: 360px; line-height: 1.5; }
  .error-state button { border: 0; padding: 0; background: transparent; color: #4b75ad; cursor: pointer; }
  .month-view { min-height: 0; flex: 1; display: flex; flex-direction: column; }
  .month-weekdays, .month-grid { grid-template-columns: repeat(7,minmax(0,1fr)); }
  .month-weekdays { height: 25px; display: grid; align-items: center; border-bottom: 1px solid var(--neutral-200); color: var(--neutral-400); font-size: 9.5px; font-weight: 600; text-align: left; text-transform: uppercase; }
  .month-weekdays span { box-sizing: border-box; padding-left: 4px; }
  .month-grid { min-height: 0; flex: 1; display: grid; grid-template-rows: repeat(6,minmax(60px,1fr)); overflow-x: hidden; overflow-y: auto; scrollbar-width: none; }
  .month-grid::-webkit-scrollbar { display: none; }
  .month-day { min-width: 0; min-height: 0; overflow: hidden; border-right: 1px solid var(--neutral-200); border-bottom: 1px solid var(--neutral-200); padding: 4px; }
  .month-day:nth-child(7n) { border-right: 0; }
  .month-day.outside { background: color-mix(in srgb,var(--neutral-50) 55%,transparent); }
  .month-date { width: 21px; height: 21px; display: grid; place-items: center; margin-left: auto; border: 0; border-radius: 50%; padding: 0; background: transparent; color: var(--neutral-700); cursor: pointer; font-size: 10.5px; }
  .month-day.outside .month-date { color: var(--neutral-300); }
  .month-day.today .month-date { background: #df554b; color: white; }
  .month-events { min-width: 0; display: flex; flex-direction: column; gap: 1px; margin-top: 2px; }
  .month-event { width: 100%; height: 18px; min-width: 0; display: flex; align-items: center; gap: 4px; overflow: hidden; border: 0; border-radius: 4px; padding: 0 3px; background: transparent; cursor: pointer; text-align: left; }
  .month-event:hover { background: var(--neutral-100); }
  .month-event.all-day { padding: 0 5px; background: color-mix(in srgb,var(--event-color) 18%,transparent); color: color-mix(in srgb,var(--event-color) 72%,var(--neutral-950)); }
  .event-dot { width: 5px; height: 5px; flex: none; border-radius: 50%; background: var(--event-color); }
  .month-event.all-day .event-dot { display: none; }
  .month-event time { flex: none; color: var(--neutral-400); font-size: 8.5px; }
  .month-event strong { min-width: 0; overflow: hidden; font-size: 9.5px; font-weight: 560; text-overflow: ellipsis; white-space: nowrap; }
  .more-events { height: 15px; border: 0; padding: 0 4px; background: transparent; color: var(--neutral-400); cursor: pointer; font-size: 9px; text-align: left; }
  .year-view { min-height: 0; flex: 1; display: grid; grid-template-columns: repeat(4,minmax(150px,1fr)); gap: 22px 28px; overflow: auto; padding: 22px 28px 32px; scrollbar-width: none; }
  .year-view::-webkit-scrollbar { display: none; }
  .year-month { min-width: 0; }
  .year-month-title { border: 0; padding: 0; background: transparent; cursor: pointer; font-size: 13px; font-weight: 620; }
  .year-month-title:hover { color: #c94b43; }
  .year-weekdays, .year-days { display: grid; grid-template-columns: repeat(7,1fr); text-align: center; }
  .year-weekdays { margin-top: 8px; color: var(--neutral-400); font-size: 8px; }
  .year-days { margin-top: 3px; row-gap: 2px; }
  .year-days button { position: relative; aspect-ratio: 1; border: 0; border-radius: 50%; padding: 0; background: transparent; cursor: pointer; font-size: 9px; }
  .year-days button:hover { background: var(--neutral-100); }
  .year-days button.outside { visibility: hidden; }
  .year-days button.today { background: #df554b; color: white; }
  .year-days button.has-events:not(.today)::after { content: ''; position: absolute; left: 50%; bottom: 0; width: 3px; height: 3px; border-radius: 50%; background: var(--day-color); transform: translateX(-50%); }
  .time-view { min-height: 0; flex: 1; display: flex; flex-direction: column; }
  .time-header, .all-day-row { display: grid; grid-template-columns: 48px repeat(7,minmax(70px,1fr)); }
  .time-view.single .time-header, .time-view.single .all-day-row { grid-template-columns: 48px minmax(0,1fr); }
  .time-header { min-height: 42px; border-bottom: 1px solid var(--neutral-200); }
  .time-day-heading { min-width: 0; display: flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-left: 1px solid var(--neutral-200); padding: 0 5px; background: transparent; cursor: pointer; }
  .time-day-heading span { color: var(--neutral-400); font-size: 9px; font-weight: 600; text-transform: uppercase; }
  .time-day-heading strong { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; font-size: 11px; font-weight: 580; }
  .time-day-heading.today strong { background: #df554b; color: white; }
  .all-day-row { min-height: 29px; border-bottom: 1px solid var(--neutral-200); }
  .all-day-label { display: flex; align-items: flex-start; justify-content: flex-end; padding: 6px 6px 0 0; color: var(--neutral-400); font-size: 8.5px; }
  .all-day-cell { min-width: 0; padding: 3px; border-left: 1px solid var(--neutral-200); }
  .all-day-cell button { width: 100%; height: 20px; overflow: hidden; border: 0; border-radius: 4px; padding: 0 5px; background: color-mix(in srgb,var(--event-color) 19%,transparent); color: color-mix(in srgb,var(--event-color) 72%,var(--neutral-950)); cursor: pointer; font-size: 9.5px; font-weight: 560; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
  .time-scroll { min-height: 0; flex: 1; overflow: auto; scrollbar-width: none; }
  .time-scroll::-webkit-scrollbar { display: none; }
  .time-grid { position: relative; min-width: calc(var(--day-count) * 70px + 48px); height: calc(24 * var(--hour-height)); display: grid; grid-template-columns: 48px repeat(var(--day-count),minmax(70px,1fr)); }
  .time-labels { position: relative; }
  .time-labels span { position: absolute; right: 6px; color: var(--neutral-400); font-size: 8.5px; transform: translateY(-50%); }
  .time-day-column { position: relative; border-left: 1px solid var(--neutral-200); background-image: repeating-linear-gradient(to bottom,transparent 0,transparent calc(var(--hour-height) - 1px),var(--neutral-150, var(--neutral-100)) calc(var(--hour-height) - 1px),var(--neutral-150, var(--neutral-100)) var(--hour-height)); }
  .time-event { position: absolute; z-index: 2; left: 3px; right: 3px; min-height: 22px; display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box; border: 0; border-left: 3px solid var(--event-color); border-radius: 4px; padding: 3px 5px; background: color-mix(in srgb,var(--event-color) 17%,var(--main-panel-background)); color: var(--neutral-900); cursor: pointer; text-align: left; }
  .time-event:hover { background: color-mix(in srgb,var(--event-color) 24%,var(--main-panel-background)); }
  .time-event strong, .time-event span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .time-event strong { font-size: 9.5px; font-weight: 620; }
  .time-event span { margin-top: 1px; color: var(--neutral-500); font-size: 8.5px; }
  .now-line { position: absolute; z-index: 4; left: -4px; right: 0; height: 1px; background: #df554b; pointer-events: none; }
  .now-line i { position: absolute; left: -3px; top: -3px; width: 7px; height: 7px; border-radius: 50%; background: #df554b; }
  .event-editor-backdrop { position: absolute; z-index: 120; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.16); animation: calendar-fade .14s ease; }
  @keyframes calendar-fade { from { opacity: 0; } }
  .event-editor { width: min(450px,calc(100% - 32px)); max-height: calc(100% - 32px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--neutral-250, var(--neutral-200)); border-radius: 14px; background: var(--main-panel-background); box-shadow: 0 18px 50px rgba(0,0,0,.2); }
  .event-editor header { height: 42px; display: flex; align-items: center; gap: 8px; padding: 0 11px 0 14px; border-bottom: 1px solid var(--neutral-200); }
  .event-editor header h3 { flex: 1; margin: 0; font-size: 12px; font-weight: 620; }
  .event-calendar-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--event-color); }
  .event-editor-body { min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding: 15px 18px; scrollbar-width: none; }
  .event-editor-body::-webkit-scrollbar { display: none; }
  .event-title-input { border: 0 !important; border-bottom: 1px solid var(--neutral-200) !important; border-radius: 0 !important; padding: 2px 8px 10px !important; font-size: 18px !important; font-weight: 540; }
  .event-editor-body label { min-height: 28px; display: grid; grid-template-columns: 72px minmax(0,1fr); align-items: center; gap: 10px; }
  .event-editor-body label > span { color: var(--neutral-500); font-size: 10.5px; }
  .event-editor input, .event-editor select, .event-editor textarea { min-width: 0; box-sizing: border-box; border: 1px solid var(--neutral-200); border-radius: 7px; outline: 0; padding: 6px 8px; background: var(--neutral-50); color: var(--neutral-950); font-size: 11px; }
  .event-editor input:focus, .event-editor select:focus, .event-editor textarea:focus { border-color: var(--neutral-400); }
  .event-editor input:disabled, .event-editor select:disabled, .event-editor textarea:disabled { opacity: .75; }
  .event-editor :global(.select-menu) { width: 100%; min-width: 0; }
  .event-editor :global(.select-menu-trigger) { height: 30px; min-width: 0; border-radius: 7px; padding: 0 8px; background: var(--neutral-50); font-size: 11px; }
  .event-editor :global(.select-menu-list) { right: auto; left: 0; width: 100%; max-width: none; }
  .event-editor-static { min-width: 0; overflow: hidden; padding: 0 8px; color: var(--neutral-700) !important; font-size: 11px !important; text-overflow: ellipsis; white-space: nowrap; }
  .checkbox-row input { justify-self: start; }
  .date-time-fields { display: grid; grid-template-columns: minmax(0,1fr) 92px; gap: 6px; }
  .date-time-fields input:only-child { grid-column: 1 / -1; }
  .notes-field { align-items: start !important; }
  .notes-field > span { padding-top: 7px; }
  .event-editor textarea { resize: vertical; line-height: 1.45; }
  .event-editor footer { min-height: 47px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; border-top: 1px solid var(--neutral-200); }
  .event-editor footer div { display: flex; gap: 7px; }
  .event-editor footer button { min-height: 28px; border: 0; border-radius: 7px; padding: 0 10px; background: transparent; cursor: pointer; font-size: 10.5px; }
  .event-editor footer button:hover { background: var(--neutral-100); }
  .event-editor footer .save-event { background: #df554b; color: white; }
  .event-editor footer .save-event:hover { background: #c94b43; }
  .event-editor footer .delete-event { display: flex; align-items: center; gap: 6px; padding-left: 0; color: #c14c46; }
  .event-editor footer .delete-event:hover { background: transparent; color: #a63e39; }
  .calendar-notice { position: absolute; z-index: 150; left: 50%; bottom: 17px; max-width: calc(100% - 40px); padding: 8px 12px; border: 1px solid var(--neutral-250, var(--neutral-200)); border-radius: 9px; background: var(--neutral-900); color: var(--neutral-50); box-shadow: 0 8px 24px rgba(0,0,0,.18); font-size: 10.5px; transform: translateX(-50%); animation: calendar-fade .15s ease; }
  @container (max-width: 900px) { .calendar-sidebar { visibility: hidden; width: 0; min-width: 0; padding-right: 0; padding-left: 0; border-right-color: transparent; opacity: 0; pointer-events: none; } .wide-calendar-toggle { display: none; } .compact-calendar-menu { display: block; } }
  @container (max-width: 760px) { .calendar-toolbar { grid-template-columns: minmax(160px,1fr) auto auto; } .calendar-toolbar-actions .bare-icon, .calendar-toolbar-actions .calendar-search { display: none; } .view-switcher button { min-width: 40px; padding: 0 5px; } .year-view { grid-template-columns: repeat(3,minmax(130px,1fr)); } }
  @container (max-width: 590px) { .calendar-toolbar-leading h2 { display: none; } .calendar-toolbar { grid-template-columns: 1fr auto auto; } .year-view { grid-template-columns: repeat(2,minmax(130px,1fr)); } }
  @media (prefers-reduced-motion: reduce) { .calendar-sidebar { transition: none; } .calendar-spinner { animation: none; } .event-editor-backdrop, .calendar-notice { animation: none; } }
</style>
