import {expect, test, type Page} from '@playwright/test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {IdeFileDto} from '@polymux/protocol';
import {IdeService} from '../../main/ide/service';

const workspaceDrawer = (page: Page) => page.locator('aside.workspace-drawer');

async function openIde(page: Page, files: IdeFileDto[] = []): Promise<void> {
  await page.goto('/?coldStart=0');
  await page.waitForFunction(() =>
    typeof (window as unknown as {polymuxDemoReveal?: unknown}).polymuxDemoReveal === 'function');
  if (files.length) await page.evaluate(files => {
    (window as unknown as {polymuxDemoAddIdeFiles: (files: IdeFileDto[]) => void}).polymuxDemoAddIdeFiles(files);
  }, files);
  await page.evaluate(() => {
    (window as unknown as {polymuxDemoReveal: (request: unknown) => void}).polymuxDemoReveal({surface: 'ide'});
  });
  const drawer = workspaceDrawer(page);
  await expect(drawer).toHaveClass(/open/);
  await expect(drawer.locator('.tab.active')).toContainText('IDE');
  await page.getByRole('button', {name: 'Open project'}).click();
  await expect(page.locator('.ide-tree-row', {hasText: 'README.md'})).toBeVisible();
}

test('opens and edits a large JavaScript bundle returned by the real file reader', async ({page}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'polymux-ide-ui-large-'));
  try {
    const content = 'export const answer = 42;\n'
      + '// Generated source keeps its text classification.\n'.repeat(260_000);
    await writeFile(path.join(root, 'bundle.mjs'), content);
    const file = await new IdeService().read(root, 'bundle.mjs');
    expect(file.binary).toBe(false);
    expect(file.content).toBe(content);
    await openIde(page, [file]);
    await page.locator('.ide-tree-row', {hasText: 'bundle.mjs'}).click();
    const editor = page.getByRole('textbox', {name: 'bundle.mjs', exact: true});
    await expect(editor).toBeVisible();
    await expect(page.locator('.ide-status-meta', {hasText: 'JavaScript'})).toBeVisible();
    await expect(editor.locator('.ide-tok-keyword').first()).toBeVisible();
    await expect(editor.locator('.cm-line').first()).toHaveText('export const answer = 42;');
    await editor.focus();
    await page.keyboard.type('// ', {delay: 30});
    await expect(editor.locator('.cm-line').first()).toHaveText('// export const answer = 42;');
    await expect(editor).toBeFocused();
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.locator('.ide-tab.active .ide-tab-dirty')).not.toHaveClass(/on/);
    await page.getByRole('button', {name: 'Close bundle.mjs', exact: true}).click();
    await page.locator('.ide-tree-row', {hasText: 'bundle.mjs'}).click();
    await expect(editor.locator('.cm-line').first()).toHaveText('// export const answer = 42;');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('opens JavaScript and TypeScript module variants with the correct highlighting', async ({page}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'polymux-ide-ui-modules-'));
  const variants = [
    ['index.js', 'JavaScript'], ['index.mjs', 'JavaScript'], ['index.cjs', 'JavaScript'],
    ['index.ts', 'TypeScript'], ['index.mts', 'TypeScript'], ['index.cts', 'TypeScript'],
    ['index.d.ts', 'TypeScript'], ['index.d.mts', 'TypeScript'], ['index.d.cts', 'TypeScript'],
    ['view.jsx', 'JavaScript'], ['view.tsx', 'TypeScript'],
  ];
  try {
    const service = new IdeService();
    const files: IdeFileDto[] = [];
    for (const [name, language] of variants) {
      const content = name.includes('.d.') ? 'export declare const answer: number;'
        : name.endsWith('sx') ? 'export const view = <Widget value={42} />;'
        : language === 'TypeScript' ? 'export const answer: number = 42;'
        : 'export const answer = 42;';
      await writeFile(path.join(root, name), content);
      files.push(await service.read(root, name));
    }
    await openIde(page, files);
    for (const [name, language] of variants) {
      await page.locator('.ide-tree-row').filter({has: page.getByText(name, {exact: true})}).click();
      const editor = page.getByRole('textbox', {name, exact: true});
      await expect(editor).toBeVisible();
      await expect(page.locator('.ide-status-meta', {hasText: language})).toBeVisible();
      await expect(editor.locator('.ide-tok-keyword').first()).toBeVisible();
      if (name.endsWith('sx')) await expect(editor.locator('.ide-tok-tag').first()).toBeVisible();
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('loads maintained grammars and edits unknown file formats', async ({page}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'polymux-ide-ui-registry-'));
  const variants = [
    ['script', '#!/usr/bin/env python3\nprint(42)\n', 'Python', '.ide-tok-number'],
    ['main.cs', 'public class Demo {}', 'C#', '.ide-tok-keyword'],
    ['main.rs', 'pub fn main() {}', 'Rust', '.ide-tok-keyword'],
    ['main.lua', 'local answer = 42', 'Lua', '.ide-tok-keyword'],
    ['index.php', '<?php echo "hello";', 'PHP', '.ide-tok-keyword'],
    ['theme.scss', '$tone: red; .note { color: $tone; }', 'SCSS', '.ide-tok-property'],
    ['view.vue', '<template><h1>Hello</h1></template>', 'Vue', '.ide-tok-tag'],
    ['future.unknown-extension', 'Editable plain text', 'Text', ''],
  ];
  try {
    const service = new IdeService();
    const files: IdeFileDto[] = [];
    for (const [name, content] of variants) {
      await writeFile(path.join(root, name), content);
      files.push(await service.read(root, name));
    }
    await openIde(page, files);
    for (const [name, , language, token] of variants) {
      await page.locator('.ide-tree-row').filter({has: page.getByText(name, {exact: true})}).click();
      const editor = page.getByRole('textbox', {name, exact: true});
      await expect(editor).toBeVisible();
      await expect(page.locator('.ide-status-meta', {hasText: language})).toBeVisible();
      if (token) await expect(editor.locator(token).first()).toBeVisible();
    }
    const editor = page.getByRole('textbox', {name: 'future.unknown-extension', exact: true});
    await editor.focus();
    await page.keyboard.type('More ', {delay: 20});
    await expect(editor).toHaveText('More Editable plain text');
    await expect(editor).toBeFocused();
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('keeps focus and editor history through continuous typing and backspacing', async ({page}) => {
  await openIde(page);
  await page.getByRole('button', {name: 'New file'}).click();
  const editor = page.getByRole('textbox', {name: 'untitled', exact: true});
  await editor.focus();
  const original = await editor.elementHandle();
  // Page keyboard input deliberately does not refocus the editor between keys.
  await page.keyboard.type('hello world', {delay: 30});
  await expect(editor).toHaveText('hello world');
  await expect(editor).toBeFocused();
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);

  // CodeMirror groups adjacent edits within 500ms into one undo event.
  await page.waitForTimeout(600);
  for (let remaining = 10; remaining >= 5; remaining--) {
    await page.keyboard.press('Backspace');
    await expect(editor).toHaveText('hello world'.slice(0, remaining));
    await expect(editor).toBeFocused();
  }
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).toHaveText('hello world');
  await expect(editor).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('!', {delay: 30});
  await expect(editor).toHaveText('hello worl!d');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.ide-tab.active .ide-tab-dirty')).not.toHaveClass(/on/);
  await expect(editor).toBeFocused();
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
});

test('keeps focus while repeatedly deleting from an existing file', async ({page}) => {
  await openIde(page);
  await page.locator('.ide-tree-row', {hasText: 'README.md'}).click();
  const editor = page.getByRole('textbox', {name: 'README.md', exact: true});
  await editor.focus();
  const original = await editor.elementHandle();
  const firstLine = editor.locator('.cm-line').first();
  const initial = await firstLine.innerText();
  for (let removed = 1; removed <= 4; removed++) {
    await page.keyboard.press('Delete');
    await expect.poll(() => firstLine.textContent()).toBe(initial.slice(removed));
    await expect(editor).toBeFocused();
  }
  await page.keyboard.type('Edited ', {delay: 30});
  await expect(firstLine).toHaveText(`Edited ${initial.slice(4)}`);
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
});

test('opens several file tabs, marks unsaved edits, and creates a file', async ({page}) => {
  await openIde(page);
  await page.locator('.ide-tree-row', {hasText: 'README.md'}).click();
  await page.locator('.ide-tree-row', {hasText: 'package.json'}).click();
  const tabs = page.getByRole('tablist', {name: 'Editor'});
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(tabs.getByRole('tab', {name: 'README.md'})).toBeVisible();
  await expect(tabs.getByRole('tab', {name: 'package.json'})).toBeVisible();

  await tabs.getByRole('tab', {name: 'README.md'}).click();
  const editor = page.getByRole('textbox', {name: 'README.md'});
  await expect(editor).toBeVisible();
  await editor.focus();
  await editor.press('End');
  await editor.type(' edited');
  await expect(page.locator('.ide-tab.active .ide-tab-dirty')).toHaveClass(/on/);

  await page.getByRole('button', {name: 'New file'}).click();
  await expect(tabs.getByRole('tab', {name: 'untitled'})).toBeVisible();
  await expect(page.locator('.ide-tab.active .ide-tab-dirty')).toHaveClass(/on/);
  await expect(page.locator('.ide-tree-row', {hasText: 'untitled'})).toHaveCount(0);
  const draft = page.getByRole('textbox', {name: 'untitled', exact: true});
  await draft.fill('A new file');
  await tabs.getByRole('tab', {name: 'README.md'}).click();
  await tabs.getByRole('tab', {name: 'untitled'}).click();
  await expect(draft).toHaveText('A new file');
  await draft.press('ControlOrMeta+s');
  await expect(page.locator('.ide-tab.active .ide-tab-dirty')).not.toHaveClass(/on/);
  await expect(page.locator('.ide-tree-row', {hasText: 'untitled'})).toBeVisible();
  await page.getByRole('button', {name: 'Close untitled', exact: true}).click();
  await page.locator('.ide-tree-row', {hasText: 'untitled'}).click();
  await expect(draft).toHaveText('A new file');
});

test('highlights source tokens and treats dotenv files as Shell Script', async ({page}) => {
  await openIde(page);
  await page.locator('.ide-tree-row', {hasText: 'src'}).click();
  await page.locator('.ide-tree-row', {hasText: 'App.svelte'}).click();
  await expect(page.getByRole('textbox', {name: 'App.svelte'})).toBeVisible();
  await expect(page.locator('.ide-tok-keyword, .ide-tok-string, .ide-tok-tag').first()).toBeVisible();
  await expect(page.locator('.ide-status-meta', {hasText: 'Svelte'})).toBeVisible();

  await page.getByRole('button', {name: 'New file'}).click();
  const tabs = page.getByRole('tablist', {name: 'Editor'});
  await tabs.getByRole('tab', {name: 'untitled'}).dblclick();
  const rename = page.getByLabel('Rename untitled');
  await rename.fill('.env.local');
  await rename.press('Enter');
  await expect(tabs.getByRole('tab', {name: '.env.local'})).toBeVisible();
  await expect(page.locator('.ide-status-meta', {hasText: 'Shell Script'})).toBeVisible();
  await expect(page.locator('.ide-status-meta', {hasText: 'LOCAL'})).toHaveCount(0);

  const editor = page.getByRole('textbox', {name: '.env.local'});
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press('ControlOrMeta+A');
  await editor.pressSequentially('# secret\nAPI_KEY="demo"\n', {delay: 15});
  await expect(page.locator('.ide-tok-comment, .ide-tok-string').first()).toBeVisible();
});

test('opens a binary image as Binary, not as text', async ({page}) => {
  await openIde(page);
  await page.locator('.ide-tree-row', {hasText: 'src'}).click();
  const image = page.locator('.ide-tree-row', {hasText: 'icon.png'});
  await expect(image).toBeVisible();
  await image.click();
  await expect(page.locator('.ide-empty-pane', {hasText: 'Not a text file'})).toBeVisible();
  await expect(page.locator('.ide-status-meta', {hasText: 'Binary'})).toBeVisible();
  await expect(page.locator('.ide-status-meta', {hasText: 'PNG'})).toHaveCount(0);
  await expect(page.getByRole('textbox', {name: 'icon.png'})).toHaveCount(0);
});

test('renames a file from its tab and moves it into a folder', async ({page}) => {
  await openIde(page);
  await page.getByRole('button', {name: 'New file'}).click();
  const tabs = page.getByRole('tablist', {name: 'Editor'});
  const untitled = tabs.getByRole('tab', {name: 'untitled'});
  await untitled.dblclick();
  const rename = page.getByLabel('Rename untitled');
  await expect(rename).toBeFocused();
  await rename.fill('notes.txt');
  await rename.press('Enter');
  await expect(tabs.getByRole('tab', {name: 'notes.txt'})).toBeVisible();
  await expect(page.locator('.ide-tree-row', {hasText: 'notes.txt'})).toHaveCount(0);
  await expect(page.locator('.ide-tab.active .ide-tab-dirty')).toHaveClass(/on/);
  await page.getByRole('textbox', {name: 'notes.txt'}).press('ControlOrMeta+s');
  await expect(page.locator('.ide-tree-row', {hasText: 'notes.txt'})).toBeVisible();

  await page.locator('.ide-tree-row', {hasText: 'notes.txt'}).dragTo(page.locator('.ide-tree-row', {hasText: 'src'}));
  await expect(page.locator('.ide-tree-row', {hasText: 'notes.txt'})).toHaveAttribute('style', /--depth:\s*1/);
  await page.locator('.ide-tree-row', {hasText: 'notes.txt'}).dragTo(page.locator('.ide-tree-root'));
  await expect(page.locator('.ide-tree-row', {hasText: 'notes.txt'})).toHaveAttribute('style', /--depth:\s*0/);
  await expect(tabs.getByRole('tab', {name: 'notes.txt'})).toBeVisible();
});

test('keeps blank drafts unsaved and gives each new file a unique name', async ({page}) => {
  await openIde(page);
  const add = page.getByRole('button', {name: 'New file'});
  await add.click();
  await add.click();
  const tabs = page.getByRole('tablist', {name: 'Editor'});
  await expect(tabs.getByRole('tab', {name: 'untitled', exact: true})).toBeVisible();
  await expect(tabs.getByRole('tab', {name: 'untitled 1', exact: true})).toBeVisible();
  await expect(page.locator('.ide-tab-dirty.on')).toHaveCount(2);
  await expect(page.locator('.ide-tree-row', {hasText: 'untitled'})).toHaveCount(0);

  const editor = page.getByRole('textbox', {name: 'untitled 1', exact: true});
  await editor.fill('temporary');
  await editor.fill('');
  await expect(page.locator('.ide-tab.active .ide-tab-dirty')).toHaveClass(/on/);
  await editor.press('ControlOrMeta+s');
  await expect(page.locator('.ide-tab.active .ide-tab-dirty')).not.toHaveClass(/on/);
  await expect(page.locator('.ide-tree-row', {hasText: 'untitled 1'})).toBeVisible();
  await page.getByRole('button', {name: 'Close untitled', exact: true}).click();
  await expect(page.locator('.ide-tree-name').getByText('untitled', {exact: true})).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`aligns line numbers and has no extra focus outline in ${theme}`, async ({page}, info) => {
    await openIde(page);
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.getByRole('button', {name: 'New file'}).click();
    const editor = page.getByRole('textbox', {name: 'untitled', exact: true});
    await editor.focus();
    await expect(editor).toHaveCSS('outline-style', 'none');
    await expect(page.locator('.cm-editor')).toHaveCSS('outline-style', 'none');

    const alignment = () => page.locator('.ide-editor-host').evaluate(host => {
      const lines = [...host.querySelectorAll('.cm-line')];
      const numbers = [...host.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
        .filter(number => (number as HTMLElement).style.visibility !== 'hidden');
      return lines.map((line, index) => Math.abs(
        line.getBoundingClientRect().top - numbers[index].getBoundingClientRect().top,
      ));
    });
    await expect.poll(alignment).toEqual([0]);
    await page.locator('.ide-editor').screenshot({path: info.outputPath(`empty-editor-${theme}.png`)});
    await editor.fill('first line\nsecond line\nthird line\nfourth line\n');
    await expect.poll(alignment).toEqual([0, 0, 0, 0, 0]);
    await page.locator('.ide-editor').screenshot({path: info.outputPath(`multiline-editor-${theme}.png`)});
    await page.getByRole('tab', {name: 'untitled', exact: true}).click();
    await editor.focus();
    await expect(editor).toHaveCSS('outline-style', 'none');
    await expect.poll(alignment).toEqual([0, 0, 0, 0, 0]);
  });
}
