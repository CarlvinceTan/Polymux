import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {parse as parseYaml} from 'yaml';
import {siteRoot} from './blog-content.mjs';

export const docsContentRoot = resolve(siteRoot, 'src/content/docs');

export function loadPublishedDocs() {
  const filenames = readdirSync(docsContentRoot).filter((name) => name.endsWith('.md')).sort();
  const slugs = new Set();

  return filenames.flatMap((filename) => {
    const source = readFileSync(resolve(docsContentRoot, filename), 'utf8');
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error(`${filename} is missing YAML front matter.`);

    const metadata = parseYaml(match[1]);
    if (!metadata || typeof metadata !== 'object') throw new Error(`${filename} has invalid YAML front matter.`);
    if (metadata.published === false) return [];

    const page = {
      title: String(metadata.title ?? '').trim(),
      slug: String(metadata.slug ?? filename.replace(/\.md$/, '')).trim(),
      description: String(metadata.description ?? '').trim(),
      section: String(metadata.section ?? '').trim(),
      sectionOrder: Number(metadata.sectionOrder),
      order: Number(metadata.order),
    };

    if (!page.title || !page.slug || !page.description || !page.section || !Number.isFinite(page.sectionOrder) || !Number.isFinite(page.order)) {
      throw new Error(`${filename} has incomplete documentation front matter.`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug)) {
      throw new Error(`${filename} has an invalid slug: ${page.slug}`);
    }
    if (slugs.has(page.slug)) throw new Error(`Duplicate documentation slug: ${page.slug}`);
    slugs.add(page.slug);
    return [page];
  }).sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order || a.title.localeCompare(b.title));
}
