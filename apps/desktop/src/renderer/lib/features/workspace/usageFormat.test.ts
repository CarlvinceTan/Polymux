import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compactNumber, formatDuration, formatUsd, heatmapLevel} from './usageFormat';

test('compacts token totals the way the Usage metrics bar reads them', () => {
  assert.equal(compactNumber(0), '0');
  assert.equal(compactNumber(1280), '1.3k');
  assert.equal(compactNumber(2_600_000_000), '2.6bn');
});

test('formats chat length and API-equivalent spend', () => {
  assert.equal(formatDuration(7 * 3_600_000 + 26 * 60_000), '7h 26m');
  assert.equal(formatUsd(12.4), '$12.40');
});

test('heatmap levels stay empty until there is activity', () => {
  assert.equal(heatmapLevel(0, 100), 0);
  assert.equal(heatmapLevel(10, 100), 1);
  assert.equal(heatmapLevel(80, 100), 4);
});
