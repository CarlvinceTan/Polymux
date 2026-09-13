import type {UsageDayDto} from '@polymux/protocol';
import {heatmapLevel} from './usageFormat';

export type HeatmapMode = 'daily' | 'weekly' | 'cumulative';

export type HeatmapCell = {
  key: string;
  week: number;
  weekday: number;
  level: 0 | 1 | 2 | 3 | 4;
  day: UsageDayDto | null;
};

export type HeatmapMonth = {key: string; label: string; column: number; span: number};

export function buildHeatmap(days: UsageDayDto[], mode: HeatmapMode): {
  weeks: number;
  cells: HeatmapCell[];
  months: HeatmapMonth[];
} {
  if (!days.length) return {weeks: 53, cells: [], months: []};
  const values = dayValues(days, mode);
  const max = Math.max(0, ...values);
  const first = parseDay(days[0].date);
  const weekday0 = first.getDay();
  const weeks = Math.ceil((weekday0 + days.length) / 7);
  const cells: HeatmapCell[] = [];
  for (let index = 0; index < weekday0; index += 1) {
    cells.push({
      key: `pad-${index}`,
      week: 1,
      weekday: index + 1,
      level: 0,
      day: null,
    });
  }
  days.forEach((day, index) => {
    const offset = weekday0 + index;
    cells.push({
      key: day.date,
      week: Math.floor(offset / 7) + 1,
      weekday: (offset % 7) + 1,
      level: heatmapLevel(values[index] ?? 0, max),
      day,
    });
  });
  return {weeks, cells, months: monthLabels(days, weekday0)};
}

const HEATMAP_GAP = 3;
const HEATMAP_GUTTER = 22;
const HEATMAP_MONTHS = 20;
const MIN_CELL = 5;
const MAX_CELL = 10;

/** Keep activity squares compact; wider slots show more history, not larger blocks. */
export function fitHeatmapSlot(
  width: number,
  height: number,
  maxWeeks = 53,
  fill: "window" | "all" = "window",
): {weeks: number; cell: number} {
  const usableW = Math.max(MIN_CELL, width - HEATMAP_GUTTER);
  const usableH = Math.max(MIN_CELL, height - HEATMAP_MONTHS);
  const cellFromHeight = (usableH - 6 * HEATMAP_GAP) / 7;
  const target = Number.isFinite(cellFromHeight) ? Math.min(MAX_CELL, Math.max(MIN_CELL, cellFromHeight)) : MIN_CELL;
  if (fill === "all") {
    const weeks = Math.max(1, maxWeeks);
    const cellFromWidth = (usableW - (weeks - 1) * HEATMAP_GAP) / weeks;
    return {weeks, cell: Math.max(1, Math.min(target, cellFromWidth))};
  }
  const weeksFit = Math.floor((usableW + HEATMAP_GAP) / (target + HEATMAP_GAP));
  const weeks = Math.max(1, Math.min(maxWeeks, Math.max(1, weeksFit)));
  const cellFromWidth = (usableW - (weeks - 1) * HEATMAP_GAP) / weeks;
  return {weeks, cell: Math.max(MIN_CELL, Math.min(target, cellFromWidth))};
}

/** Keep the trailing Sunday-aligned window used on the Usage home heatmap. */
export function recentHeatmapDays(days: UsageDayDto[], weeks: number): UsageDayDto[] {
  if (!days.length || weeks <= 0) return days;
  const lastWeekDays = parseDay(days[days.length - 1].date).getDay() + 1;
  const keep = Math.min(days.length, (Math.max(1, weeks) - 1) * 7 + lastWeekDays);
  return days.slice(-keep);
}

export function formatHeatmapDate(date: string, tag: string): string {
  return parseDay(date).toLocaleDateString(tag, {month: 'short', day: 'numeric', year: 'numeric'});
}

function dayValues(days: UsageDayDto[], mode: HeatmapMode): number[] {
  if (mode === 'daily') return days.map((day) => day.tokens);
  if (mode === 'cumulative') {
    let total = 0;
    return days.map((day) => {
      total += day.tokens;
      return total;
    });
  }
  const weeks = new Map<string, number>();
  for (const day of days) {
    const week = weekKey(day.date);
    weeks.set(week, (weeks.get(week) ?? 0) + day.tokens);
  }
  return days.map((day) => weeks.get(weekKey(day.date)) ?? 0);
}

function weekKey(date: string): string {
  const value = parseDay(date);
  value.setDate(value.getDate() - value.getDay());
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}

function monthLabels(days: UsageDayDto[], weekday0: number): HeatmapMonth[] {
  const labels: HeatmapMonth[] = [];
  let current = '';
  for (let index = 0; index < days.length; index += 1) {
    const month = days[index].date.slice(0, 7);
    if (month === current) continue;
    current = month;
    const column = Math.floor((weekday0 + index) / 7) + 1;
    const date = parseDay(days[index].date);
    labels.push({
      key: month,
      label: date.toLocaleString(undefined, {month: 'short'}),
      column,
      span: 1,
    });
  }
  for (let index = 0; index < labels.length; index += 1) {
    const next = labels[index + 1];
    const end = next ? next.column : Math.floor((weekday0 + days.length - 1) / 7) + 2;
    labels[index].span = Math.max(1, end - labels[index].column);
  }
  return labels;
}

function parseDay(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}
