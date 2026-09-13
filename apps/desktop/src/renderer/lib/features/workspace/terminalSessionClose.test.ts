import test from 'node:test';
import assert from 'node:assert/strict';
import {afterSessionClosed, isWorkspaceTerminalSession} from './terminalSessionClose';

test('closing one session leaves the others and activates the previous neighbor', () => {
  const tabs = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
  assert.deepEqual(afterSessionClosed(tabs, 'b', 'b'), {
    items: [{id: 'a'}, {id: 'c'}],
    activeId: 'a',
  });
});

test('closing the first active session activates the new first neighbor', () => {
  const tabs = [{id: 'a'}, {id: 'b'}];
  assert.deepEqual(afterSessionClosed(tabs, 'a', 'a'), {
    items: [{id: 'b'}],
    activeId: 'b',
  });
});

test('closing an inactive session keeps the current active tab', () => {
  const tabs = [{id: 'a'}, {id: 'b'}];
  assert.deepEqual(afterSessionClosed(tabs, 'a', 'b'), {
    items: [{id: 'a'}],
    activeId: 'a',
  });
});

test('closing the last session empties the strip', () => {
  assert.deepEqual(afterSessionClosed([{id: 'only'}], 'only', 'only'), {
    items: [],
    activeId: null,
  });
});

test('a second close of the same session is a no-op', () => {
  const remaining = [{id: 'kept'}];
  assert.equal(afterSessionClosed(remaining, 'kept', 'gone'), null);
});

test('workspace tabs only match terminal sessions by id', () => {
  assert.equal(isWorkspaceTerminalSession({id: 'term-1', kind: 'terminal'}, 'term-1'), true);
  assert.equal(isWorkspaceTerminalSession({id: 'term-1', kind: 'ide'}, 'term-1'), false);
  assert.equal(isWorkspaceTerminalSession({id: 'other', kind: 'terminal'}, 'term-1'), false);
});
