import test from 'node:test';
import assert from 'node:assert/strict';
import {catppuccinIconId} from './fileKind';

test('maps filenames to Catppuccin icons before extensions', () => {
  assert.equal(catppuccinIconId('package.json', 'file'), 'package-json');
  assert.equal(catppuccinIconId('package-lock.json', 'file'), 'npm-lock');
  assert.equal(catppuccinIconId('pnpm-lock.yaml', 'file'), 'pnpm-lock');
  assert.equal(catppuccinIconId('.gitignore', 'file'), 'git');
  assert.equal(catppuccinIconId('.env.local', 'file'), 'env');
  assert.equal(catppuccinIconId('LICENSE', 'file'), 'license');
  assert.equal(catppuccinIconId('README.md', 'file'), 'readme');
  assert.equal(catppuccinIconId('tsconfig.json', 'file'), 'typescript-config');
  assert.equal(catppuccinIconId('Dockerfile', 'file'), 'docker');
});

test('maps common extensions to Catppuccin icons', () => {
  assert.equal(catppuccinIconId('App.svelte', 'file'), 'svelte');
  assert.equal(catppuccinIconId('main.ts', 'file'), 'typescript');
  assert.equal(catppuccinIconId('icon.tsx', 'file'), 'typescript-react');
  assert.equal(catppuccinIconId('index.js', 'file'), 'javascript');
  assert.equal(catppuccinIconId('notes.md', 'file'), 'markdown');
  assert.equal(catppuccinIconId('main.go', 'file'), 'go');
  assert.equal(catppuccinIconId('app.py', 'file'), 'python');
  assert.equal(catppuccinIconId('lib.rs', 'file'), 'rust');
  assert.equal(catppuccinIconId('app.css', 'file'), 'css');
  assert.equal(catppuccinIconId('index.html', 'file'), 'html');
  assert.equal(catppuccinIconId('App.vue', 'file'), 'vue');
  assert.equal(catppuccinIconId('config.yaml', 'file'), 'yaml');
  assert.equal(catppuccinIconId('unknown.bin', 'file'), 'binary');
  assert.equal(catppuccinIconId('untitled', 'file'), '_file');
});

test('maps special folder names to Catppuccin folder icons', () => {
  assert.equal(catppuccinIconId('src', 'folder', false), 'folder_src');
  assert.equal(catppuccinIconId('src', 'folder', true), 'folder_src_open');
  assert.equal(catppuccinIconId('node_modules', 'folder'), 'folder_node');
  assert.equal(catppuccinIconId('packages', 'folder'), 'folder_packages');
  assert.equal(catppuccinIconId('scripts', 'folder'), 'folder_scripts');
  assert.equal(catppuccinIconId('out', 'folder'), 'folder_dist');
  assert.equal(catppuccinIconId('doc', 'folder'), 'folder_docs');
  assert.equal(catppuccinIconId('tests', 'folder'), 'folder_tests');
  assert.equal(catppuccinIconId('misc', 'folder', false), '_folder');
  assert.equal(catppuccinIconId('misc', 'folder', true), '_folder_open');
});
