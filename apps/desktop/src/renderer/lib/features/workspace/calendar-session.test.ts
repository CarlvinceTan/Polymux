import assert from 'node:assert/strict';
import test from 'node:test';
import type {CalendarEventDto, CalendarSnapshotDto} from '@polymux/protocol';

let invalidated: () => void = () => undefined;
let snapshot: (start: string, end: string) => Promise<CalendarSnapshotDto>;

(globalThis as unknown as {window: unknown}).window = {
  polymux: {
    calendar: {
      subscribe(listener: () => void) {
        invalidated = listener;
        return () => undefined;
      },
      snapshot(start: string, end: string) {
        return snapshot(start, end);
      },
    },
  },
};

const session = await import('./calendar-session.js');

function range(day: number) {
  return {
    start: new Date(Date.UTC(2026, 7, day)),
    end: new Date(Date.UTC(2026, 7, day + 1)),
  };
}

function event(id: string, title: string, day: number): CalendarEventDto {
  return {
    id,
    calendarId: 'calendar',
    title,
    start: new Date(Date.UTC(2026, 7, day, 9)).toISOString(),
    end: new Date(Date.UTC(2026, 7, day, 10)).toISOString(),
    allDay: false,
    availability: 'busy',
    attendees: [],
    editable: true,
  };
}

function result(events: CalendarEventDto[]): CalendarSnapshotDto {
  return {calendars: [], events, fetchedAt: new Date().toISOString()};
}

test('calendar invalidation retries are bounded', async () => {
  let calls = 0;
  snapshot = async () => {
    calls += 1;
    invalidated();
    return result([]);
  };
  const target = range(1);
  await session.refreshCalendarRange(target);
  assert.equal(calls, 3);
  assert.equal(session.calendarRangeIsFresh(target), false);
});

test('local calendar edits do not mark an invalidated range fresh', async () => {
  const target = range(2);
  snapshot = async () => result([event('one', 'Old', 2)]);
  await session.refreshCalendarRange(target);
  invalidated();
  session.cacheCalendarEvent(event('one', 'Edited', 2));
  assert.equal(session.calendarRangeIsFresh(target), false);
  assert.equal(session.cachedCalendarRange(target)?.events[0]?.title, 'Edited');
});

test('an in-flight snapshot retries instead of overwriting a local edit', async () => {
  const target = range(3);
  snapshot = async () => result([event('one', 'Old', 3)]);
  await session.refreshCalendarRange(target);

  let resolveFirst!: (value: CalendarSnapshotDto) => void;
  let calls = 0;
  snapshot = async () => {
    calls += 1;
    if (calls === 1)
      return await new Promise<CalendarSnapshotDto>((resolve) => {
        resolveFirst = resolve;
      });
    return result([event('one', 'Edited', 3)]);
  };
  const refreshing = session.refreshCalendarRange(target);
  await new Promise((resolve) => setImmediate(resolve));
  session.cacheCalendarEvent(event('one', 'Edited', 3));
  resolveFirst(result([event('one', 'Old', 3)]));
  const refreshed = await refreshing;
  assert.equal(calls, 2);
  assert.equal(refreshed.events[0]?.title, 'Edited');
});
