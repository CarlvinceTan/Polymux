import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCatppuccinSvg} from './catppuccinSvgMarkup';

test('extracts viewBox and inner paths from a Catppuccin SVG', () => {
  const mark = parseCatppuccinSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
	<path fill="none" stroke="var(--vscode-ctp-text)" d="M4.5 4.5H12" />
</svg>`);
  assert.equal(mark.viewBox, '0 0 16 16');
  assert.match(mark.inner, /<path /);
  assert.doesNotMatch(mark.inner, /<svg/i);
  assert.doesNotMatch(mark.inner, /width="16"/);
});

test('drops unsafe markup', () => {
  const mark = parseCatppuccinSvg(`<svg viewBox="0 0 16 16"><script>alert(1)</script></svg>`);
  assert.equal(mark.inner, '');
});
