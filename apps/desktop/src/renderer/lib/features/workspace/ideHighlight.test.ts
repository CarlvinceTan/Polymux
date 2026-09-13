import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {ensureSyntaxTree} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {languageForName} from '../../../../main/ide/language';
import {languageDescriptionFor, languageExtension} from './ideHighlight';

test('JavaScript and TypeScript variants select grammars that parse their syntax', async () => {
  for (const [name, doc, grammar] of [
    ['index.js', 'export const answer = 42;', 'JavaScript'],
    ['index.mjs', 'export const answer = 42;', 'JavaScript'],
    ['index.cjs', 'module.exports = {answer: 42};', 'JavaScript'],
    ['index.ts', 'export const answer: number = 42;', 'TypeScript'],
    ['index.mts', 'export const answer: number = 42;', 'TypeScript'],
    ['index.cts', 'export const answer: number = 42;', 'TypeScript'],
    ['index.d.ts', 'export declare const answer: number;', 'TypeScript'],
    ['index.d.mts', 'export declare const answer: number;', 'TypeScript'],
    ['index.d.cts', 'export declare const answer: number;', 'TypeScript'],
    ['view.JSX', 'export const view = <Widget value={42} />;', 'JSX'],
    ['view.TSX', 'export const view: JSX.Element = <Widget value={42} />;', 'TSX'],
  ] as const) {
    const detected = languageForName(name);
    assert.equal(languageDescriptionFor(detected, name)?.name, grammar, name);
    const state = EditorState.create({doc, extensions: await languageExtension(detected, name)});
    const tree = ensureSyntaxTree(state, doc.length, 1000);
    assert.ok(tree, name);
    const errors: number[] = [];
    tree.iterate({enter(node) { if (node.type.isError) errors.push(node.from); }});
    assert.deepEqual(errors, [], name);
    if (/\.[jt]sx$/i.test(name)) assert.match(tree.toString(), /JSXElement/, name);
  }
});

test('dotenv files use the Shell grammar', () => {
  for (const name of ['.env', '.env.local', '.env.example', 'secrets.env']) {
    assert.equal(languageDescriptionFor(languageForName(name), name)?.name, 'Shell');
  }
});

test('the registry supplies dedicated parsers instead of generic substitutes', () => {
  for (const [name, grammar] of [
    ['main.rs', 'Rust'], ['main.go', 'Go'], ['main.java', 'Java'],
    ['view.vue', 'Vue'], ['index.php', 'PHP'], ['styles.scss', 'SCSS'],
    ['styles.less', 'LESS'], ['source.scala', 'Scala'], ['source.dart', 'Dart'],
    ['src/logo.svg', 'XML'], ['templates/main.jinja', 'Jinja'], ['CMakeLists.txt', 'CMake'],
    ['App.svelte', 'HTML'], ['main.py', 'Python'], ['src/foo.pyi', 'Python'], ['tsconfig.json', 'JSON'],
  ]) assert.equal(languageDescriptionFor(languageForName(name), name)?.name, grammar, name);
});

test('unknown or unsupported grammars stay editable as plain text', async () => {
  for (const name of ['notes.unknown-future-extension', 'main.zig', 'Makefile']) {
    assert.equal(languageDescriptionFor(languageForName(name), name), undefined, name);
    assert.deepEqual(await languageExtension(languageForName(name), name), [], name);
  }
  assert.equal(languageDescriptionFor('Binary', 'image.png'), undefined);
  assert.equal(languageDescriptionFor('Binary', 'binary.mts'), undefined);
});

test('all registered grammar loaders are available', async () => {
  for (const description of languages) {
    const support = await description.load();
    assert.ok(support.extension, description.name);
  }
});
