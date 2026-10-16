import assert from 'node:assert/strict';
import {test} from 'node:test';
import {polymuxApi} from '../src/lib/api/polymux.ts';

test('public transcripts reject local actions even when a desktop bridge exists', () => {
  const previous = globalThis.window;
  globalThis.window = {polymux: {}};
  try {
    assert.throws(polymuxApi, /Desktop actions are unavailable/);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
