import {parse as parseYaml} from 'yaml';
import {renderSafeMarkdown} from './markdown.js';

export type DocsTocItem = {
  id: string;
  text: string;
  level: 2 | 3;
};

export type DocsPage = {
  title: string;
  slug: string;
  description: string;
  section: string;
  sectionOrder: number;
  order: number;
  body: string;
  html: string;
  toc: DocsTocItem[];
};

export type DocsSection = {
  title: string;
  order: number;
  pages: DocsPage[];
};

const sources = import.meta.glob<string>('../content/docs/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&(?:amp|quot|apos|lt|gt);/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function renderMarkdown(body: string): {html: string; toc: DocsTocItem[]} {
  const rendered = renderSafeMarkdown(body);
  const toc: DocsTocItem[] = [];
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

function readDocument(sourcePath: string, source: string): DocsPage | null {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Documentation page ${sourcePath} is missing YAML front matter.`);

  const metadata = parseYaml(match[1]) as Record<string, unknown>;
  if (metadata.published === false) return null;

  const pathParts = sourcePath.split('/');
  const filename = pathParts[pathParts.length - 1]?.replace(/\.md$/, '') ?? '';
  const title = String(metadata.title ?? '').trim();
  const slug = String(metadata.slug ?? filename).trim();
  const description = String(metadata.description ?? '').trim();
  const section = String(metadata.section ?? 'Guides').trim();
  const sectionOrder = Number(metadata.sectionOrder ?? 99);
  const order = Number(metadata.order ?? 99);
  const body = match[2].trim();

  if (!title || !slug || !description || !section || !Number.isFinite(sectionOrder) || !Number.isFinite(order)) {
    throw new Error(`Documentation page ${sourcePath} has incomplete front matter.`);
  }

  return {title, slug, description, section, sectionOrder, order, body, ...renderMarkdown(body)};
}

export const docsPages = Object.entries(sources)
  .map(([sourcePath, source]) => readDocument(sourcePath, source))
  .filter((page): page is DocsPage => page !== null)
  .sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order || a.title.localeCompare(b.title));

export const docsSections: DocsSection[] = Array.from(
  docsPages.reduce((sections, page) => {
    const current = sections.get(page.section) ?? {title: page.section, order: page.sectionOrder, pages: []};
    current.pages.push(page);
    sections.set(page.section, current);
    return sections;
  }, new Map<string, DocsSection>()).values(),
).sort((a, b) => a.order - b.order);

export function getDocsPage(slug: string): DocsPage | undefined {
  return docsPages.find((page) => page.slug === slug);
}

export function docsPath(slug: string): string {
  return slug === 'introduction' ? '/docs/' : `/docs/${slug}/`;
}

export function docsNeighbours(slug: string): {previous?: DocsPage; next?: DocsPage} {
  const index = docsPages.findIndex((page) => page.slug === slug);
  if (index < 0) return {};
  return {previous: docsPages[index - 1], next: docsPages[index + 1]};
}
