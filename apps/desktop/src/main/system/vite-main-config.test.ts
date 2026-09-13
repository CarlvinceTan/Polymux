import {strict as assert} from 'node:assert';
import {existsSync} from 'node:fs';
import {test} from 'node:test';
import {nodeBuiltins, workspacePackageAliases} from '../../../vite.main.config.js';

test('the main bundle leaves Node SQLite for Electron to resolve', () => {
  assert.ok(nodeBuiltins.includes('node:sqlite'));
});

test('workspace packages resolve to source so Forge watch builds can finish', () => {
  const locker = workspacePackageAliases().find((alias) => (
    alias.find instanceof RegExp && alias.find.test('@polymux/locker')
  ));
  assert.ok(locker);
  assert.equal(typeof locker.replacement, 'string');
  assert.ok(existsSync(locker.replacement));
  assert.equal(
    workspacePackageAliases().some((alias) => (
      alias.find instanceof RegExp && alias.find.test('@polymux/browser/src/cursor-motion.js')
    )),
    false,
  );
});
