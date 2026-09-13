// @ts-check

/**
 * Release notes use a machine-validated shape: `## <category>`, `### <area>`,
 * then `- <item>` bullets. This module turns that Markdown into ordered,
 * filterable sections without touching the published content files.
 */

/** @typedef {{category: string, area: string, items: string[]}} ReleaseChangelogSection */
/** @typedef {{category: string, sections: ReleaseChangelogSection[]}} ReleaseChangelogGroup */

/** The synthetic filter value that keeps every platform visible. */
export const ALL_PLATFORMS = 'all';

/**
 * Parse a release body into ordered category/area sections.
 * @param {string} body
 * @returns {ReleaseChangelogSection[]}
 */
export function parseReleaseChangelog(body) {
  /** @type {ReleaseChangelogSection[]} */
  const sections = [];
  let category = '';
  let area = '';
  /** @type {ReleaseChangelogSection | null} */
  let section = null;

  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      category = line.slice(3).trim();
      area = '';
      section = null;
      continue;
    }

    if (line.startsWith('### ')) {
      area = line.slice(4).trim();
      section = null;
      continue;
    }

    const item = line.match(/^- (.*)$/);
    if (!item || !category || !area) continue;

    if (!section) {
      section = {category, area, items: []};
      sections.push(section);
    }
    section.items.push(item[1].trim());
  }

  return sections;
}

/**
 * The sections of a release entry, in document order.
 * @param {{body: string}} entry
 * @returns {ReleaseChangelogSection[]}
 */
export function releaseChangelog(entry) {
  return parseReleaseChangelog(entry.body);
}

/**
 * The platform/area names a release mentions, in first-appearance order.
 * @param {{body: string}} entry
 * @returns {string[]}
 */
export function releasePlatforms(entry) {
  /** @type {string[]} */
  const platforms = [];
  for (const section of releaseChangelog(entry)) {
    if (!platforms.includes(section.area)) platforms.push(section.area);
  }
  return platforms;
}

/**
 * Keep only the requested platform. `ALL_PLATFORMS` keeps everything.
 * @param {ReleaseChangelogSection[]} sections
 * @param {string} [platform]
 * @returns {ReleaseChangelogSection[]}
 */
export function filterReleaseChangelog(sections, platform = ALL_PLATFORMS) {
  if (!platform || platform === ALL_PLATFORMS) return sections;
  return sections.filter((section) => section.area === platform);
}

/**
 * Resolve a requested filter to a platform the release actually has, defaulting to All.
 * @param {string[]} platforms
 * @param {string} [requested]
 * @returns {string}
 */
export function resolveReleasePlatform(platforms, requested) {
  if (requested === ALL_PLATFORMS) return ALL_PLATFORMS;
  if (requested && platforms.includes(requested)) return requested;
  return ALL_PLATFORMS;
}

/**
 * Group filtered sections by category, preserving the order categories first appear.
 * @param {ReleaseChangelogSection[]} sections
 * @returns {ReleaseChangelogGroup[]}
 */
export function groupReleaseChangelog(sections) {
  /** @type {ReleaseChangelogGroup[]} */
  const groups = [];
  for (const section of sections) {
    let group = groups.find((candidate) => candidate.category === section.category);
    if (!group) {
      group = {category: section.category, sections: []};
      groups.push(group);
    }
    group.sections.push(section);
  }
  return groups;
}
