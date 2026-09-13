import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildHeatmap, fitHeatmapSlot, recentHeatmapDays} from './usageHeatmap';

test('heatmap slot keeps square cells and drops older weeks on the home window', () => {
  const fitted = fitHeatmapSlot(640, 140, 53, 'window');
  assert.ok(fitted.weeks <= 53);
  assert.ok(fitted.weeks >= 1);
  assert.ok(fitted.cell >= 5);
  const width = 22 + fitted.weeks * fitted.cell + (fitted.weeks - 1) * 3;
  assert.ok(width <= 640 + 0.5);
  const height = 20 + 7 * fitted.cell + 6 * 3;
  assert.ok(height <= 140 + 0.5);
});

test('depth heatmap keeps every week and still uses squares', () => {
  const fitted = fitHeatmapSlot(400, 200, 53, 'all');
  assert.equal(fitted.weeks, 53);
  const width = 22 + fitted.weeks * fitted.cell + (fitted.weeks - 1) * 3;
  assert.ok(width <= 400 + 0.5);
});

test('recent heatmap days keep the trailing window', () => {
  const days = Array.from({length: 21}, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    tokens: 1,
    costUsd: 0,
    runs: 1,
  }));
  const recent = recentHeatmapDays(days, 1);
  assert.equal(recent.length, 4);
  assert.equal(recent[0]?.date, '2026-01-18');
  assert.equal(buildHeatmap(recent, 'daily').weeks, 1);
});

test('tall panes never enlarge activity blocks and wider panes show more weeks', () => {
  const narrow = fitHeatmapSlot(400, 900);
  const wide = fitHeatmapSlot(1200, 900);
  assert.ok(narrow.cell <= 10);
  assert.ok(wide.cell <= 10);
  assert.ok(wide.weeks > narrow.weeks);
  assert.ok(fitHeatmapSlot(2000, 900, 53, 'all').cell <= 10);
});

test('recent windows fit their requested columns on every ending weekday', () => {
  const days = Array.from({length: 70}, (_, index) => {
    const date = new Date(2026, 0, 1 + index);
    return {date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, tokens: 1, costUsd: 0, runs: 1};
  });
  for (let offset = 0; offset < 7; offset += 1) {
    const source = days.slice(0, days.length - offset);
    const recent = recentHeatmapDays(source, 3);
    assert.equal(buildHeatmap(recent, 'daily').weeks, 3);
    assert.equal(recent.at(-1)?.date, source.at(-1)?.date);
  }
});
