import DOMPurify from 'dompurify';
import {marked} from 'marked';

marked.setOptions({breaks: true, gfm: true});

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, {async: false}) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4',
      'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th',
      'thead', 'tr', 'ul',
    ],
    ALLOWED_ATTR: ['href', 'rel', 'target'],
  }).replace(/<a /g, '<a target="_blank" rel="noreferrer" ');
}
