import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {parse as parseYaml} from 'yaml';

export const siteRoot = resolve(import.meta.dirname, '..');
export const contentRoot = resolve(siteRoot, 'src/content/blog');

export function loadPublishedPosts() {
  const filenames = readdirSync(contentRoot).filter((name) => name.endsWith('.md')).sort();
  const slugs = new Set();

  return filenames.flatMap((filename) => {
    const source = readFileSync(resolve(contentRoot, filename), 'utf8');
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error(`${filename} is missing YAML front matter.`);

    const metadata = parseYaml(match[1]);
    if (!metadata || typeof metadata !== 'object') throw new Error(`${filename} has invalid YAML front matter.`);
    if (metadata.published === false) return [];

    const post = {
      title: String(metadata.title ?? '').trim(),
      slug: String(metadata.slug ?? filename.replace(/\.md$/, '')).trim(),
      date: String(metadata.date ?? '').trim(),
      author: String(metadata.author ?? 'Polymux').trim(),
      excerpt: String(metadata.excerpt ?? '').trim(),
    };

    if (!post.title || !post.slug || !post.date || !post.excerpt) {
      throw new Error(`${filename} requires title, slug, date, and excerpt fields.`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)) {
      throw new Error(`${filename} has an invalid slug: ${post.slug}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date)) {
      throw new Error(`${filename} has an invalid date: ${post.date}`);
    }
    if (slugs.has(post.slug)) throw new Error(`Duplicate blog slug: ${post.slug}`);
    slugs.add(post.slug);
    return [post];
  }).sort((a, b) => b.date.localeCompare(a.date));
}
