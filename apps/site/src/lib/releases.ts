import {parse as parseYaml} from 'yaml';
import {renderSafeMarkdown} from './markdown.js';

export type ReleaseEntry = {
  version: string;
  title: string;
  date: string;
  summary: string;
  body: string;
  html: string;
};

const sources = import.meta.glob<string>('../content/releases/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
});

function readDocument(path: string, source: string): ReleaseEntry | null {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Release ${path} is missing YAML front matter.`);

  const metadata = parseYaml(match[1]) as Record<string, unknown>;
  if (metadata.published === false) return null;

  const version = String(metadata.version ?? '').trim();
  const title = String(metadata.title ?? '').trim();
  const date = String(metadata.date ?? '').trim();
  const summary = String(metadata.summary ?? '').trim();
  const body = match[2].trim();

  if (!version || !title || !date || !summary) {
    throw new Error(`Release ${path} requires version, title, date, and summary fields.`);
  }

  return {version, title, date, summary, body, html: renderSafeMarkdown(body)};
}

export const releases = Object.entries(sources)
  .map(([path, source]) => readDocument(path, source))
  .filter((entry): entry is ReleaseEntry => entry !== null)
  .sort((a, b) => b.date.localeCompare(a.date) || b.version.localeCompare(a.version, undefined, {numeric: true}));

export function getRelease(version: string): ReleaseEntry | undefined {
  return releases.find((entry) => entry.version === version);
}

export function releasePath(version: string): string {
  return `/releases/${encodeURIComponent(version)}/`;
}

export function formatReleaseDate(date: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function formatReleaseMonth(date: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}
