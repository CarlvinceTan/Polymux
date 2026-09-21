import assert from 'node:assert/strict';
import test from 'node:test';
import type {CalendarEventDto} from '@polymux/protocol';
import {
  BLOCK_INSET,
  MAX_NEST_DEPTH,
  eventBlock,
  eventHeight,
  eventTop,
  soloBlock,
  timedLayout,
} from './calendar-layout.js';

const DAY = new Date(2026, 8, 18);

/** An event on `day` from `startHour` to `endHour`; minutes are optional. */
function event(id: string, startHour: number, endHour: number, day = DAY, startMinute = 0, endMinute = 0): CalendarEventDto {
  const start = new Date(day);
  start.setHours(startHour, startMinute, 0, 0);
  const end = new Date(day);
  end.setHours(endHour, endMinute, 0, 0);
  return {
    id,
    calendarId: 'cal-1',
    title: id,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: false,
    availability: 'busy',
    attendees: [],
    editable: true,
  };
}

test('a lone event takes the whole column', () => {
  const lone = event('a', 9, 10);
  const block = timedLayout([lone], DAY).get('a')!;
  assert.equal(block.depth, 0);
  assert.equal(block.left, soloBlock(lone, DAY).left);
  assert.equal(block.width, soloBlock(lone, DAY).width);
});

test('the same time slot appears side by side, not nested', () => {
  const layout = timedLayout([event('one', 14, 15), event('two', 14, 15)], DAY);
  const one = layout.get('one')!;
  const two = layout.get('two')!;
  assert.equal(one.depth, 0);
  assert.equal(two.depth, 0);
  assert.equal(one.top, two.top);
  assert.equal(one.height, two.height);
  // Same band split in two, so neither covers the other.
  assert.notEqual(one.left, two.left);
  assert.equal(one.width, two.width);
});

test('overlapping times that contain neither event appear side by side', () => {
  const layout = timedLayout([event('early', 12, 14), event('late', 13, 15)], DAY);
  assert.equal(layout.get('early')?.depth, 0);
  assert.equal(layout.get('late')?.depth, 0);
  assert.notEqual(layout.get('early')?.left, layout.get('late')?.left);
});

test('an event inside another nests and is drawn on top', () => {
  const layout = timedLayout([event('long', 12, 15), event('short', 13, 14)], DAY);
  const long = layout.get('long')!;
  const short = layout.get('short')!;
  assert.equal(long.depth, 0);
  assert.equal(short.depth, 1);
  assert.ok(short.zIndex > long.zIndex, 'the contained block must paint above its container');
  assert.notEqual(short.left, long.left);
  assert.notEqual(short.width, long.width);
  assert.match(short.left, /^calc\(/);
});

test('a chain of containment nests a level at a time and then stops', () => {
  const layout = timedLayout(
    [event('a', 9, 17), event('b', 10, 16), event('c', 11, 15), event('d', 12, 14), event('e', 13, 14)],
    DAY,
  );
  assert.equal(layout.get('a')?.depth, 0);
  assert.equal(layout.get('b')?.depth, 1);
  assert.equal(layout.get('c')?.depth, 2);
  assert.equal(layout.get('d')?.depth, 3);
  assert.equal(layout.get('e')?.depth, 4);
  // Past the cap the block stops stepping in rather than collapsing to a sliver.
  assert.equal(layout.get('e')?.left, layout.get('d')?.left);
  assert.ok((layout.get('e')?.zIndex ?? 0) > (layout.get('a')?.zIndex ?? 0));
  assert.equal(MAX_NEST_DEPTH, 3);
});

test('two events sharing a slot inside a container share that container band', () => {
  const layout = timedLayout([event('host', 12, 15), event('one', 13, 14), event('two', 13, 14)], DAY);
  assert.equal(layout.get('one')?.depth, 1);
  assert.equal(layout.get('two')?.depth, 1);
  assert.notEqual(layout.get('one')?.left, layout.get('two')?.left);
  assert.equal(layout.get('one')?.width, layout.get('two')?.width);
});

test('blocks clear the hour lines above and below them', () => {
  const block = eventBlock(event('hour', 13, 14), DAY);
  // 1-2pm sits inside the hour instead of covering the 1 and 2 o'clock rules.
  assert.equal(block.top, 13 * 52 + BLOCK_INSET);
  assert.equal(block.height, 52 - BLOCK_INSET * 2);
  assert.equal(block.top + block.height, 14 * 52 - BLOCK_INSET);
});

test('a short block keeps its minimum height and drops its time line', () => {
  const quarter = event('quarter', 13, 13, DAY, 0, 15);
  assert.equal(eventBlock(quarter, DAY).height, 22);
  assert.equal(eventBlock(quarter, DAY).compact, true);
  const hour = eventBlock(event('hour', 13, 14), DAY);
  assert.equal(hour.compact, false);
  assert.equal(timedLayout([quarter], DAY).get('quarter')?.compact, true);
});

test('an event spanning midnight is clamped to the day it is drawn in', () => {
  const overnight: CalendarEventDto = {
    ...event('overnight', 23, 24),
    end: new Date(2026, 8, 19, 1, 0, 0, 0).toISOString(),
  };
  const layout = timedLayout([overnight], DAY);
  // Clamped to midnight, not the full three hours, and inset from the day's edges.
  assert.equal(layout.get('overnight')?.top, 23 * 52 + BLOCK_INSET);
  assert.equal(layout.get('overnight')?.height, 52 - BLOCK_INSET * 2);
  assert.equal(eventTop(overnight, DAY), 23 * 52);
  assert.equal(eventHeight(overnight, DAY), 52);
});

test('unparsable events are left out of the timed layout', () => {
  const empty = timedLayout([{...event('bad', 9, 10), start: 'not-a-date'}], DAY);
  assert.equal(empty.size, 0);
});
