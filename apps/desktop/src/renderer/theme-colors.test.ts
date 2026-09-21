import {readdirSync, readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import path from 'node:path';

const rendererRoot = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(item);
    return entry.name.endsWith('.svelte') || entry.name.endsWith('.css') ? [item] : [];
  });
}

test('every text colour uses a defined theme token or an explicit fallback', () => {
  const sources = sourceFiles(rendererRoot).map((file) => ({file, source: readFileSync(file, 'utf8')}));
  const globalSource = readFileSync(path.join(rendererRoot, 'public/style.css'), 'utf8');
  const globalDefinitions = new Set(
    [...globalSource.matchAll(/--([a-z0-9_-]+)\s*:/gi)].map((match) => match[1]!),
  );

  const unresolved: string[] = [];
  for (const {file, source} of sources) {
    const definitions = new Set([
      ...globalDefinitions,
      ...[...source.matchAll(/--([a-z0-9_-]+)\s*(?::|=)/gi)].map((match) => match[1]!),
    ]);
    const declarations = source.matchAll(/\b(?:color|caret-color|text-decoration-color)\s*:\s*([^;{}\n]+)/gi);
    for (const declaration of declarations) {
      const value = declaration[1]!;
      for (const reference of value.matchAll(/var\(--([a-z0-9_-]+)/gi)) {
        const token = reference[1]!;
        const fallback = new RegExp(`var\\(--${token}\\s*,`).test(value);
        if (!definitions.has(token) && !fallback) {
          const line = source.slice(0, declaration.index).split('\n').length;
          unresolved.push(`${path.relative(rendererRoot, file)}:${line} --${token}`);
        }
      }
    }
  }

  assert.deepEqual(unresolved, []);
});

test('global text tokens provide values for both themes', () => {
  const sources = sourceFiles(rendererRoot).map((file) => readFileSync(file, 'utf8'));
  const sheet = readFileSync(path.join(rendererRoot, 'public/style.css'), 'utf8');
  const light = themeTokens(sheet, ':root');
  const dark = themeTokens(sheet, ':root[data-theme="dark"]');
  const missingDark = new Set<string>();

  for (const source of sources) {
    for (const declaration of source.matchAll(/\b(?:color|caret-color|text-decoration-color)\s*:\s*([^;{}\n]+)/gi)) {
      for (const reference of declaration[1]!.matchAll(/var\(--([a-z0-9_-]+)/gi)) {
        const token = reference[1]!;
        if (light.has(token) && !dark.has(token)) missingDark.add(`--${token}`);
      }
    }
  }

  assert.deepEqual([...missingDark].sort(), []);
});

test('new literal text colours must be explicitly theme-safe', () => {
  const allowedWithoutFixedBackground = [
    '.calendar-check', // Provider-supplied colour behind a check glyph.
    '.hub-view-html :where(a)', // Email HTML is deliberately kept on a white reading surface.
    '.inline-file-status.error-icon', // Status glyph, not text.
    '.team-avatar-preview-theme button', // Avatar preview controls inherit a fixed light/dark preview surface.
    '.team-avatar-preview span', // Preview copy is independent of the app theme.
    '.team-avatar-preview.dark span', // Dark preview copy on its fixed dark surface.
    '.mobile-screen-waiting', // Loading copy sits inside the fixed black device screen.
    '.bank-card', // Bank-card text is on fixed dark gradients in both app themes.
    '.card-balance-label', // Copy inside the same fixed dark bank-card surface.
    '.card-bottom button', // Actions inside the same fixed dark bank-card surface.
    '.agent-card>span:not(.card-top)', // Agent card uses the same fixed dark gradient.
    '.tasks-composer-submit', // White submit glyph on the fixed blue action fill.
  ];
  const unexpected: string[] = [];

  for (const file of sourceFiles(rendererRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1]!.trim();
      const body = rule[2]!;
      const hasLiteralText = /(?:^|;)\s*color\s*:\s*(?:#[a-f0-9]{3,8}|white|black)\b/i.test(body);
      if (!hasLiteralText) continue;
      const themeSpecific = selector.includes('data-theme') || selector.includes(':root:not([data-theme])');
      const fixedBackground = /(?:^|;)\s*background(?:-color)?\s*:\s*#[a-f0-9]{3,8}\b/i.test(body);
      const documented = allowedWithoutFixedBackground.some((allowed) => selector.includes(allowed));
      if (!themeSpecific && !fixedBackground && !documented) {
        const line = source.slice(0, rule.index).split('\n').length;
        unexpected.push(`${path.relative(rendererRoot, file)}:${line} ${selector}`);
      }
    }
  }

  assert.deepEqual(unexpected, []);
});

test('the inherited page foreground follows the active theme', () => {
  const sheet = readFileSync(path.join(rendererRoot, 'public/style.css'), 'utf8');
  assert.match(sheet, /:root\s*{[\s\S]*?\bcolor:\s*var\(--on-surface\);/);
  assert.match(sheet, /:root\[data-theme="dark"\]\s*{[\s\S]*?--on-surface:\s*#f0f0f0;/);
});

function channels(hex: string): number[] {
  const value = hex.slice(1);
  const expanded = value.length === 3 ? [...value].map((part) => part + part).join('') : value;
  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255);
}

function luminance(hex: string): number {
  const linear = channels(hex).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

function themeTokens(sheet: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = sheet.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1];
  assert.ok(block, `missing ${selector} theme block`);
  return new Map([...block.matchAll(/--([a-z0-9_-]+):\s*(#[a-f0-9]{3,6})\s*;/gi)].map((item) => [item[1]!, item[2]!]));
}

test('semantic text colours remain readable on both theme backgrounds', () => {
  const sheet = readFileSync(path.join(rendererRoot, 'public/style.css'), 'utf8');
  const light = themeTokens(sheet, ':root');
  const dark = new Map([...light, ...themeTokens(sheet, ':root[data-theme="dark"]')]);
  const textTokens = [
    'on-surface',
    'danger-500',
    'danger-600',
    'disabled-text',
    'link-text',
    'warning-text',
    'status-success-text',
    'status-warning-text',
    'status-error-text',
  ];

  for (const [theme, tokens] of [['light', light], ['dark', dark]] as const) {
    const background = tokens.get('app-bg');
    assert.ok(background, `${theme} theme has no app background`);
    for (const token of textTokens) {
      const foreground = tokens.get(token);
      assert.ok(foreground, `${theme} theme has no --${token}`);
      assert.ok(contrast(foreground, background) >= 4.5, `${theme} --${token} has insufficient contrast`);
    }
    assert.ok(
      contrast(tokens.get('danger-600')!, tokens.get('danger-50')!) >= 4.5,
      `${theme} danger text has insufficient contrast on its surface`,
    );
    assert.ok(
      contrast(tokens.get('success-text')!, tokens.get('success-surface')!) >= 4.5,
      `${theme} success text has insufficient contrast on its surface`,
    );
    assert.ok(
      contrast(tokens.get('team-role-text')!, tokens.get('team-role-surface')!) >= 4.5,
      `${theme} Team role text has insufficient contrast on its surface`,
    );
    assert.ok(
      contrast(tokens.get('team-role-text-raised')!, tokens.get('team-role-surface-raised')!) >= 4.5,
      `${theme} Team role text has insufficient contrast on its highlighted-row surface`,
    );
  }
});
