import type {CalendarEventDto} from '@polymux/protocol';

/** How tall one hour is in the time grid. */
export const HOUR_HEIGHT = 52;
/** How far each nesting level insets a block from the block containing it. */
export const NEST_INDENT = 8;
/** The deepest nesting that still indents; past it blocks stop stepping in. */
export const MAX_NEST_DEPTH = 3;
/**
 * The gap between a block and the grid lines around it, and between two blocks
 * sharing a column. It applies on every side, so a block that starts exactly on
 * the hour clears that line the same way it clears the day column beside it.
 */
export const BLOCK_INSET = 3;
/**
 * Below this height there is no room for the time line under the title, so a
 * short block draws the title alone rather than clipping half a glyph.
 */
export const COMPACT_BLOCK_HEIGHT = 30;

export interface EventBlock {
  top: number;
  height: number;
  /** True when only the title fits. */
  compact: boolean;
}

export interface TimedLayout extends EventBlock {
  /** CSS length expression for the block's left edge. */
  left: string;
  /** CSS length expression for the block's width. */
  width: string;
  /** How many events contain this one, which is how deeply it nests. */
  depth: number;
  zIndex: number;
}

/** An event clamped to the day being drawn. */
interface Span {
  id: string;
  start: number;
  end: number;
}

/** A horizontal slice of the day column that one block may occupy. */
interface Band {
  /** Length expressions, unwrapped: `calc(...)` is added when they are emitted. */
  left: string;
  width: string;
}

const COLUMN_BAND: Band = {left: `${BLOCK_INSET}px`, width: `100% - ${BLOCK_INSET * 2}px`};

export function eventTop(event: CalendarEventDto, day: Date): number {
  const dayStart = startOfDay(day).getTime();
  const start = Math.max(Date.parse(event.start), dayStart);
  return Math.max(0, (start - dayStart) / 3_600_000 * HOUR_HEIGHT);
}

export function eventHeight(event: CalendarEventDto, day: Date): number {
  const dayStart = startOfDay(day).getTime();
  const start = Math.max(Date.parse(event.start), dayStart);
  const end = Math.min(Date.parse(event.end), dayStart + 86_400_000);
  return Math.max(22, (end - start) / 3_600_000 * HOUR_HEIGHT);
}

/**
 * One block's vertical box, already inset from the grid lines. An event running
 * 1-2pm sits inside its hour rather than covering the 1 and 2 o'clock rules.
 */
export function eventBlock(event: CalendarEventDto, day: Date): EventBlock {
  const top = eventTop(event, day);
  const height = eventHeight(event, day);
  // Short blocks keep their previous minimum rather than shrinking further.
  const inset = Math.max(22, height - BLOCK_INSET * 2);
  return {top: top + BLOCK_INSET, height: inset, compact: inset < COMPACT_BLOCK_HEIGHT};
}

/** A lone block: the whole column, no neighbours and no nesting. */
export function soloBlock(event: CalendarEventDto, day: Date): TimedLayout {
  return {
    ...eventBlock(event, day),
    left: `calc(${COLUMN_BAND.left})`,
    width: `calc(${COLUMN_BAND.width})`,
    depth: 0,
    zIndex: 2,
  };
}

/**
 * Place one day's timed events.
 *
 * Two events that merely share the column — the same time slot, or times that
 * overlap without either containing the other — go side by side, each taking
 * half the width. Only when one event sits strictly inside another does the
 * inner one nest: drawn on top and inset past the bar it would otherwise hide,
 * so the block underneath keeps its own accent bar in view.
 */
export function timedLayout(items: CalendarEventDto[], day: Date): Map<string, TimedLayout> {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + 86_400_000;
  const spans: Span[] = [];
  const events = new Map<string, CalendarEventDto>();
  for (const event of items) {
    const start = Math.max(Date.parse(event.start), dayStart);
    const end = Math.min(Date.parse(event.end), dayEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    spans.push({id: event.id, start, end});
    events.set(event.id, event);
  }

  // Containment is a total order among the events holding one block, so the
  // last entry is the innermost container: latest start, and among equal starts
  // the one that ends soonest.
  const containers = new Map<string, Span[]>(spans.map((span) => [span.id, []]));
  for (const outer of spans)
    for (const inner of spans)
      if (contains(outer, inner)) containers.get(inner.id)!.push(outer);
  for (const list of containers.values())
    list.sort((left, right) => left.start - right.start || right.end - left.end);

  // Events nest inside their innermost container; events sharing a container
  // (or sharing no container at all) are siblings competing for one band.
  const siblings = new Map<string, Span[]>();
  for (const span of spans) {
    const key = containers.get(span.id)!.at(-1)?.id ?? '';
    siblings.set(key, [...(siblings.get(key) ?? []), span]);
  }
  const placement = new Map<string, {column: number; columns: number}>();
  for (const group of siblings.values())
    for (const [id, spot] of columnize(group)) placement.set(id, spot);

  const bands = new Map<string, Band>();
  const bandOf = (span: Span): Band => {
    const cached = bands.get(span.id);
    if (cached) return cached;
    // A block nesting inside another takes that block's band as its floor; any
    // other block starts from the whole column.
    const innermost = containers.get(span.id)!.at(-1);
    const floor = innermost
      ? containers.get(span.id)!.length <= MAX_NEST_DEPTH
        ? indentBand(bandOf(innermost))
        : bandOf(innermost)
      : COLUMN_BAND;
    const spot = placement.get(span.id)!;
    const band = divideBand(floor, spot.column, spot.columns);
    bands.set(span.id, band);
    return band;
  };

  const layout = new Map<string, TimedLayout>();
  for (const span of spans) {
    const depth = containers.get(span.id)!.length;
    const band = bandOf(span);
    layout.set(span.id, {
      ...eventBlock(events.get(span.id)!, day),
      left: `calc(${band.left})`,
      width: `calc(${band.width})`,
      depth,
      zIndex: 2 + Math.min(depth, 24),
    });
  }
  return layout;
}

/** True when `inner` sits strictly inside `outer`, the same slot aside. */
function contains(outer: Span, inner: Span): boolean {
  return (
    outer.id !== inner.id &&
    outer.start <= inner.start &&
    inner.end <= outer.end &&
    (outer.start < inner.start || inner.end < outer.end)
  );
}

/**
 * Split each run of overlapping siblings into columns, the fewest that can hold
 * them all. A group that never overlaps anything keeps one column and the
 * whole band.
 */
function columnize(spans: Span[]): Map<string, {column: number; columns: number}> {
  const result = new Map<string, {column: number; columns: number}>();
  const ordered = [...spans].sort((left, right) => left.start - right.start || right.end - left.end);
  let group: Span[] = [];
  let groupEnd = Number.NEGATIVE_INFINITY;
  const flush = () => {
    if (!group.length) return;
    const ends: number[] = [];
    const columns = new Map<string, number>();
    for (const span of group) {
      // Touching blocks (`end <= start`) may share a column.
      let column = ends.findIndex((end) => end <= span.start);
      if (column < 0) column = ends.push(span.end) - 1;
      else ends[column] = span.end;
      columns.set(span.id, column);
    }
    for (const span of group)
      result.set(span.id, {column: columns.get(span.id)!, columns: ends.length});
    group = [];
    groupEnd = Number.NEGATIVE_INFINITY;
  };
  for (const span of ordered) {
    if (group.length && span.start >= groupEnd) flush();
    group.push(span);
    groupEnd = Math.max(groupEnd, span.end);
  }
  flush();
  return result;
}

/** Carve one column out of a band, leaving a gap on either side of it. */
function divideBand(band: Band, index: number, count: number): Band {
  // One column is the whole band; splitting it would only add arithmetic.
  if (count <= 1) return band;
  const usable = `(${band.width}) - ${(count - 1) * BLOCK_INSET}px`;
  return {
    left: `(${band.left}) + (${usable}) * ${ratio(index, count)} + ${index * BLOCK_INSET}px`,
    width: `(${usable}) / ${count}`,
  };
}

function indentBand(band: Band): Band {
  return {
    left: `(${band.left}) + ${NEST_INDENT}px`,
    width: `(${band.width}) - ${NEST_INDENT}px`,
  };
}

function ratio(index: number, count: number): string {
  return String(Math.round((index / count) * 1e6) / 1e6);
}

function startOfDay(day: Date): Date {
  const result = new Date(day);
  result.setHours(0, 0, 0, 0);
  return result;
}
