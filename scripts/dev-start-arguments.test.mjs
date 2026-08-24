import assert from 'node:assert/strict';
import test from 'node:test';
import {backgroundInstanceArguments} from './dev-start-arguments.mjs';

test('named isolates receive the app-owned background switch', () => {
  assert.deepEqual(backgroundInstanceArguments([], 'review'), ['--', '--polymux-background']);
  assert.deepEqual(
    backgroundInstanceArguments(['--', '--remote-debugging-port=9341'], 'review'),
    ['--', '--polymux-background', '--remote-debugging-port=9341'],
  );
});

test('ordinary and explicitly visible launches keep their original arguments', () => {
  assert.deepEqual(backgroundInstanceArguments(['--inspect'], ''), ['--inspect']);
  assert.deepEqual(backgroundInstanceArguments(['--inspect'], 'review', true), ['--inspect']);
});

test('an existing background switch is never duplicated', () => {
  assert.deepEqual(
    backgroundInstanceArguments(['--', '--polymux-background'], 'review'),
    ['--', '--polymux-background'],
  );
});
