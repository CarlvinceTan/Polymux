// @ts-check

import createDOMPurify from 'dompurify';
import {marked} from 'marked';

const MARKDOWN_TAGS = [
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'img', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th',
  'thead', 'tr', 'ul',
];
const MARKDOWN_ATTRIBUTES = ['align', 'alt', 'class', 'href', 'src', 'start', 'title'];

/**
 * Render repository and CMS Markdown without carrying executable HTML into Svelte.
 * @param {string} body
 * @param {import('dompurify').WindowLike} [windowLike]
 */
export function renderSafeMarkdown(body, windowLike = globalThis.window) {
  if (!windowLike) {
    throw new Error('Markdown rendering requires a browser-compatible window.');
  }
  const rendered = /** @type {string} */ (marked.parse(body, {gfm: true}));
  return createDOMPurify(windowLike).sanitize(rendered, {
    ALLOWED_ATTR: MARKDOWN_ATTRIBUTES,
    ALLOWED_TAGS: MARKDOWN_TAGS,
  });
}
