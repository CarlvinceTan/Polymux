import {test} from 'node:test';
import assert from 'node:assert/strict';
import {usageRowLimits} from './usageLayout';

test('sections show all rows when the pane has room', () => {
  for (const width of [400, 600, 900]) {
    assert.deepEqual(usageRowLimits(width, 800, [5, 5, 3, 2]), [5, 5, 3, 2]);
  }
});

test('compact panes share whole rows and redistribute space from shorter sections', () => {
  assert.deepEqual(usageRowLimits(400, 222, [5, 5, 3, 2]), [2, 1, 1, 1]);
  assert.deepEqual(usageRowLimits(600, 166, [5, 5, 3, 2]), [3, 3, 2, 2]);
  assert.deepEqual(usageRowLimits(900, 214, [5, 5, 3, 2]), [5, 5, 3, 2]);
});

test('no available row space preserves headings without rendering partial rows', () => {
  assert.deepEqual(usageRowLimits(400, 110, [5, 5, 3, 2]), [0, 0, 0, 0]);
  assert.deepEqual(usageRowLimits(900, 0, [5, 5, 3, 2]), [0, 0, 0, 0]);
  assert.deepEqual(usageRowLimits(400, 800, []), []);
});
