import {renderSafeMarkdown} from './markdown.js';

export type TocItem = {
  id: string;
  text: string;
  level: 2 | 3;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&(?:amp|quot|apos|lt|gt);/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** Render Markdown and give every heading a stable id so a page can offer an outline. */
export function renderMarkdownWithToc(body: string): {html: string; toc: TocItem[]} {
  const rendered = renderSafeMarkdown(body);
  const toc: TocItem[] = [];
  const usedIds = new Set<string>();
  const html = rendered.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_match, levelValue: string, inner: string) => {
    const level = Number(levelValue) as 2 | 3;
    const text = inner.replace(/<[^>]*>/g, '').trim();
    const baseId = slugify(text) || 'section';
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    toc.push({id, text, level});
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  return {html, toc};
}
