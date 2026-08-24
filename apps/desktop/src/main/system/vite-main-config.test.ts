import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {nodeBuiltins} from '../../../vite.main.config.js';

test('the main bundle leaves Node SQLite for Electron to resolve', () => {
  assert.ok(nodeBuiltins.includes('node:sqlite'));
});
