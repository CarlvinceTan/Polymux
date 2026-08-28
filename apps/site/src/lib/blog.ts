import {parse as parseYaml} from 'yaml';
import {renderMarkdownWithToc, type TocItem} from './toc';

export type BlogPost = {
  title: string;
  slug: string;
  date: string;
  excerpt: string;
  author: string;
  tags: string[];
  coverImage: string | null;
  readingMinutes: number;
  body: string;
  html: string;
  toc: TocItem[];
};

const sources = import.meta.glob<string>('../content/blog/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
});

function readDocument(path: string, source: string): BlogPost | null {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Blog post ${path} is missing YAML front matter.`);

  const metadata = parseYaml(match[1]) as Record<string, unknown>;
  if (metadata.published === false) return null;

  const pathParts = path.split('/');
  const filename = pathParts[pathParts.length - 1]?.replace(/\.md$/, '') ?? '';
  const title = String(metadata.title ?? '').trim();
  const slug = String(metadata.slug ?? filename).trim();
  const date = String(metadata.date ?? '').trim();
  const excerpt = String(metadata.excerpt ?? '').trim();
  const author = String(metadata.author ?? 'Polymux').trim();
  const tags = Array.isArray(metadata.tags) ? metadata.tags.map(String) : [];
  const coverImage = metadata.coverImage ? String(metadata.coverImage) : null;
  const body = match[2].trim();

  if (!title || !slug || !date || !excerpt) {
    throw new Error(`Blog post ${path} requires title, slug, date, and excerpt fields.`);
  }

  const wordCount = body.replace(/[`*_>#\[\]()|~-]/g, ' ').trim().split(/\s+/).filter(Boolean).length;

  return {
    title,
    slug,
    date,
    excerpt,
    author,
    tags,
    coverImage,
    readingMinutes: Math.max(1, Math.ceil(wordCount / 220)),
    body,
    ...renderMarkdownWithToc(body),
  };
}

export const blogPosts = Object.entries(sources)
  .map(([path, source]) => readDocument(path, source))
  .filter((post): post is BlogPost => post !== null)
  .sort((a, b) => b.date.localeCompare(a.date));

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((post) => post.slug === slug);
}

export function nextPosts(slug: string, count = 2): BlogPost[] {
  const index = blogPosts.findIndex((post) => post.slug === slug);
  if (index === -1) return blogPosts.slice(0, count);
  return [...blogPosts.slice(index + 1), ...blogPosts.slice(0, index)].slice(0, count);
}

export function formatBlogDate(date: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}
