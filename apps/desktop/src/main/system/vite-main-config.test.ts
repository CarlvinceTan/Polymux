import {strict as assert} from 'node:assert';
import {existsSync} from 'node:fs';
import {test} from 'node:test';
import {nodeBuiltins, workspacePackageAliases} from '../../../vite.main.config.js';

test('the main bundle leaves Node SQLite for Electron to resolve', () => {
  assert.ok(nodeBuiltins.includes('node:sqlite'));
});

test('workspace packages resolve to source so Forge watch builds can finish', () => {
  const vault = workspacePackageAliases().find((alias) => (
    alias.find instanceof RegExp && alias.find.test('@polymux/vault')
  ));
  assert.ok(vault);
  assert.equal(typeof vault.replacement, 'string');
  assert.ok(existsSync(vault.replacement));
  assert.equal(
    workspacePackageAliases().some((alias) => (
      alias.find instanceof RegExp && alias.find.test('@polymux/browser/src/cursor-motion.js')
    )),
    false,
  );
});
