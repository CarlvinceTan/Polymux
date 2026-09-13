import {parse as parseYaml} from 'yaml';
import {renderSafeMarkdown} from './markdown.js';
import {
  ALL_PLATFORMS,
  filterReleaseChangelog as filterSections,
  groupReleaseChangelog as groupSections,
  releaseChangelog as changelogFor,
  releasePlatforms as platformsFor,
  resolveReleasePlatform as resolvePlatform,
} from './release-changelog.js';

export type ReleaseEntry = {
  version: string;
  title: string;
  date: string;
  summary: string;
  downloadable: boolean;
  body: string;
  html: string;
};

export type ReleaseChangelogSection = {
  category: string;
  area: string;
  items: string[];
};

export type ReleaseChangelogGroup = {
  category: string;
  sections: ReleaseChangelogSection[];
};

export {ALL_PLATFORMS};

/** The ordered category/area sections of a release body. */
export function releaseChangelog(entry: Pick<ReleaseEntry, 'body'>): ReleaseChangelogSection[] {
  return changelogFor(entry);
}

/** The platform/area names a release mentions, in first-appearance order. */
export function releasePlatforms(entry: Pick<ReleaseEntry, 'body'>): string[] {
  return platformsFor(entry);
}

/** Keep only the requested platform's sections; ALL_PLATFORMS keeps everything. */
export function filterReleaseChangelog(
  sections: ReleaseChangelogSection[],
  platform: string = ALL_PLATFORMS,
): ReleaseChangelogSection[] {
  return filterSections(sections, platform);
}

/** Group sections by category, preserving the order categories first appear. */
export function groupReleaseChangelog(sections: ReleaseChangelogSection[]): ReleaseChangelogGroup[] {
  return groupSections(sections);
}

/** Resolve a requested filter to a platform the release has, defaulting to All. */
export function resolveReleasePlatform(platforms: string[], requested?: string): string {
  return resolvePlatform(platforms, requested);
}

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
  const downloadable = metadata.downloadable !== false;
  const body = match[2].trim();

  if (!version || !title || !date || !summary) {
    throw new Error(`Release ${path} requires version, title, date, and summary fields.`);
  }

  return {version, title, date, summary, downloadable, body, html: renderSafeMarkdown(body)};
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
