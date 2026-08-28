import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {parse as parseYaml} from 'yaml';
import {siteRoot} from './blog-content.mjs';

export const releasesContentRoot = resolve(siteRoot, 'src/content/releases');
const releaseCategories = new Set(['Features', 'Bug Fixes', 'Improvements']);

export function validateReleaseBody(filename, body) {
  let category = '';
  let area = '';
  let noteCount = 0;

  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      category = line.slice(3).trim();
      area = '';
      if (!releaseCategories.has(category)) {
        throw new Error(`${filename} has unsupported release category: ${category}`);
      }
      continue;
    }

    if (line.startsWith('### ')) {
      if (!category) throw new Error(`${filename} has an area outside a release category.`);
      area = line.slice(4).trim();
      if (!area) throw new Error(`${filename} has an empty release-note area.`);
      continue;
    }

    if (line.startsWith('- ')) {
      if (!category || !area) {
        throw new Error(`${filename} must group every release-note bullet by category and area.`);
      }
      noteCount += 1;
    }
  }

  if (!noteCount) throw new Error(`${filename} must contain at least one release-note bullet.`);
}

export function loadPublishedReleases() {
  const filenames = readdirSync(releasesContentRoot).filter((name) => name.endsWith('.md')).sort();
  const versions = new Set();

  return filenames.flatMap((filename) => {
    const source = readFileSync(resolve(releasesContentRoot, filename), 'utf8');
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error(`${filename} is missing YAML front matter.`);

    const metadata = parseYaml(match[1]);
    if (!metadata || typeof metadata !== 'object') throw new Error(`${filename} has invalid YAML front matter.`);
    if (metadata.published === false) return [];

    const release = {
      version: String(metadata.version ?? '').trim(),
      title: String(metadata.title ?? '').trim(),
      date: String(metadata.date ?? '').trim(),
      summary: String(metadata.summary ?? '').trim(),
      downloadable: metadata.downloadable !== false,
    };

    if (!release.version || !release.title || !release.date || !release.summary) {
      throw new Error(`${filename} requires version, title, date, and summary fields.`);
    }
    if (!/^\d+(?:\.\d+)+(?:-[0-9A-Za-z.-]+)?$/.test(release.version)) {
      throw new Error(`${filename} has an invalid version: ${release.version}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(release.date)) {
      throw new Error(`${filename} has an invalid date: ${release.date}`);
    }
    if (versions.has(release.version)) throw new Error(`Duplicate release version: ${release.version}`);
    validateReleaseBody(filename, match[2].trim());
    versions.add(release.version);
    return [release];
  }).sort((a, b) => b.date.localeCompare(a.date) || b.version.localeCompare(a.version, undefined, {numeric: true}));
}
