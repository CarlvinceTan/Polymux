import type {
  CalendarEventDto,
  CalendarListDto,
  CalendarSnapshotDto,
} from '@polymux/protocol';
import {polymuxApi} from '../../api/polymux';

export type CalendarRange = {start: Date; end: Date};

type CachedRange = CalendarSnapshotDto & {
  start: string;
  end: string;
  fetchedAtMs: number;
  generation: number;
};

const api = polymuxApi();
const ranges = new Map<string, CachedRange>();
const pending = new Map<string, Promise<CachedRange>>();
const invalidationListeners = new Set<() => void>();
let cachedCalendars: CalendarListDto[] = [];
let generation = 0;
let mutationSequence = 0;
const MAX_REFRESH_ATTEMPTS = 3;

// Subscribe once for the renderer session, including while the Calendar view is
// unmounted. EventKit only reports that something changed, so visible ranges
// are marked stale and reread on demand.
api.calendar.subscribe(() => {
  generation += 1;
  for (const listener of invalidationListeners) listener();
});

export function cachedCalendarRange(range: CalendarRange): CachedRange | undefined {
  return ranges.get(rangeKey(range));
}

export function calendarRangeIsFresh(range: CalendarRange, maxAgeMs = 5 * 60_000): boolean {
  const cached = cachedCalendarRange(range);
  return Boolean(
    cached &&
    cached.generation === generation &&
    Date.now() - cached.fetchedAtMs <= maxAgeMs,
  );
}

export function calendarLists(): CalendarListDto[] {
  return cachedCalendars;
}

export async function refreshCalendarRange(range: CalendarRange): Promise<CachedRange> {
  const key = rangeKey(range);
  const existing = pending.get(key);
  if (existing) return existing;

  const request = (async () => {
    // If EventKit changes while the snapshot is being read, take one more
    // coherent snapshot rather than publishing an already-stale result.
    let snapshot!: CalendarSnapshotDto;
    let requestedGeneration = generation;
    let requestedMutationSequence = mutationSequence;
    for (let attempt = 0; attempt < MAX_REFRESH_ATTEMPTS; attempt += 1) {
      requestedGeneration = generation;
      requestedMutationSequence = mutationSequence;
      snapshot = await api.calendar.snapshot(range.start.toISOString(), range.end.toISOString());
      if (
        requestedGeneration === generation &&
        requestedMutationSequence === mutationSequence
      ) break;
      // A local save/delete during the final read must not be overwritten by
      // an older EventKit snapshot. Keep the edited cache stale so the next
      // ordinary refresh can reconcile it.
      if (
        attempt === MAX_REFRESH_ATTEMPTS - 1 &&
        requestedMutationSequence !== mutationSequence
      ) {
        const current = ranges.get(key);
        if (current) return current;
      }
    }

    cachedCalendars = snapshot.calendars;
    const cached: CachedRange = {
      ...snapshot,
      events: sortEvents(snapshot.events),
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      fetchedAtMs: Date.parse(snapshot.fetchedAt) || Date.now(),
      generation: requestedGeneration,
    };
    ranges.set(key, cached);
    return cached;
  })().finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
}

export function warmCurrentCalendar(): Promise<CalendarSnapshotDto> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  monthStart.setDate(monthStart.getDate() - mondayOffset);
  monthStart.setHours(0, 0, 0, 0);
  const end = new Date(monthStart);
  end.setDate(end.getDate() + 42);
  const range = {start: monthStart, end};
  const cached = cachedCalendarRange(range);
  return cached && calendarRangeIsFresh(range)
    ? Promise.resolve(cached)
    : refreshCalendarRange(range);
}

export function subscribeCalendarInvalidations(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

export function cacheCalendarEvent(event: CalendarEventDto): void {
  mutationSequence += 1;
  for (const [key, cached] of ranges) {
    const events = cached.events.filter((candidate) => candidate.id !== event.id);
    if (overlaps(event, cached.start, cached.end)) events.push(event);
    ranges.set(key, {
      ...cached,
      events: sortEvents(events),
    });
  }
}

export function removeCachedCalendarEvent(id: string): void {
  mutationSequence += 1;
  for (const [key, cached] of ranges) {
    if (!cached.events.some((event) => event.id === id)) continue;
    ranges.set(key, {
      ...cached,
      events: cached.events.filter((event) => event.id !== id),
    });
  }
}

function rangeKey(range: CalendarRange): string {
  return `${range.start.toISOString()}\0${range.end.toISOString()}`;
}

function overlaps(event: CalendarEventDto, start: string, end: string): boolean {
  return Date.parse(event.start) < Date.parse(end) && Date.parse(event.end) > Date.parse(start);
}

function sortEvents(events: CalendarEventDto[]): CalendarEventDto[] {
  return [...events].sort((left, right) =>
    Date.parse(left.start) - Date.parse(right.start) || left.title.localeCompare(right.title),
  );
}
