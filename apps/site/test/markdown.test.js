import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {renderSafeMarkdown} from '../src/lib/markdown.js';

test('renders Markdown while removing executable HTML and unsafe URLs', () => {
  const browserWindow = /** @type {import('dompurify').WindowLike} */ (new JSDOM('').window);
  const html = renderSafeMarkdown(`
# Safe heading

[Documentation](/docs/) [Unsafe](javascript:alert('x'))

<img src="https://example.com/image.png" alt="Preview" onerror="alert('x')">
<script>alert('x')</script>
<form action="https://example.com"><input name="password"></form>
<p style="position: fixed; inset: 0">Visible text</p>
  `, browserWindow);

  assert.match(html, /<h1>Safe heading<\/h1>/);
  assert.match(html, /href="\/docs\/"/);
  assert.match(html, /<a>Unsafe<\/a>/);
  assert.match(html, /src="https:\/\/example\.com\/image\.png"/);
  assert.doesNotMatch(html, /javascript:|onerror|<script|alert\('x'\)/i);
  assert.doesNotMatch(html, /<form|<input|style=/i);
  assert.match(html, /<p>Visible text<\/p>/);
});
