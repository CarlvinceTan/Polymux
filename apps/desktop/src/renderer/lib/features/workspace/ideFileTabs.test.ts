import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fileName,
  isFileDirty,
  joinPath,
  moveDestination,
  nextUntitledName,
  parentPath,
  validFileName,
} from './ideFileTabs';

test('parentPath and joinPath split and rebuild a relative path', () => {
  assert.equal(parentPath('README.md'), '');
  assert.equal(parentPath('src/main.go'), 'src');
  assert.equal(parentPath('src/app/main.ts'), 'src/app');
  assert.equal(joinPath('', 'README.md'), 'README.md');
  assert.equal(joinPath('src', 'main.go'), 'src/main.go');
});

test('fileName is the last segment', () => {
  assert.equal(fileName('README.md'), 'README.md');
  assert.equal(fileName('src/main.go'), 'main.go');
});

test('validFileName refuses empty names, dots, and separators', () => {
  assert.equal(validFileName('notes.md'), true);
  assert.equal(validFileName('  notes.md  '), true);
  assert.equal(validFileName(''), false);
  assert.equal(validFileName('.'), false);
  assert.equal(validFileName('..'), false);
  assert.equal(validFileName('src/notes.md'), false);
  assert.equal(validFileName('notes\\md'), false);
});

test('nextUntitledName steps past names already in the folder', () => {
  assert.equal(nextUntitledName([]), 'untitled');
  assert.equal(nextUntitledName(['README.md']), 'untitled');
  assert.equal(nextUntitledName(['untitled']), 'untitled 1');
  assert.equal(nextUntitledName(['untitled', 'untitled 1']), 'untitled 2');
  assert.equal(nextUntitledName(['Untitled'], 'untitled'), 'untitled 1');
});

test('moveDestination is a no-op when the file is already in that folder', () => {
  assert.equal(moveDestination('README.md', ''), null);
  assert.equal(moveDestination('src/main.go', 'src'), null);
  assert.equal(moveDestination('src/main.go', ''), 'main.go');
  assert.equal(moveDestination('main.go', 'src'), 'src/main.go');
});

test('isFileDirty ignores binary tabs and unmodified text', () => {
  assert.equal(isFileDirty({binary: false, content: 'a', savedContent: 'b'}), true);
  assert.equal(isFileDirty({binary: false, content: 'a', savedContent: 'a'}), false);
  assert.equal(isFileDirty({binary: true, content: '', savedContent: ''}), false);
});

test('a new draft is dirty even before typing or after clearing its contents', () => {
  assert.equal(isFileDirty({binary: false, content: '', savedContent: null}), true);
  assert.equal(isFileDirty({binary: false, content: 'draft', savedContent: null}), true);
  assert.equal(isFileDirty({binary: false, content: '', savedContent: ''}), false);
});
