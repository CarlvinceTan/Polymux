import assert from 'node:assert/strict';
import test from 'node:test';
import {displayUrl, referenceCopy} from './referenceDisplay';

test('shows a page title over the url', () => {
  assert.deepEqual(
    referenceCopy({title: 'Polymux', kind: 'web', uri: 'https://www.polymux.ai/'}),
    {title: 'Polymux', detail: 'polymux.ai'},
  );
});

test('does not repeat a hostname that is standing in for a title', () => {
  assert.deepEqual(
    referenceCopy({title: 'polymux.ai', kind: 'web', uri: 'https://www.polymux.ai/'}),
    {title: 'polymux.ai', detail: null},
  );
});

test('cleans markdown junk out of a displayed url', () => {
  assert.equal(displayUrl('https://www.polymux.ai/%60'), 'polymux.ai');
  assert.equal(displayUrl('https://polymux.ai/%60**'), 'polymux.ai');
});

test('file references stay a single name', () => {
  assert.deepEqual(
    referenceCopy({title: 'notes.md', kind: 'file', uri: '/tmp/notes.md'}),
    {title: 'notes.md', detail: null},
  );
});
