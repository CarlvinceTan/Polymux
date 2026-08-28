import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {loadPublishedReleases, validateReleaseBody} from '../scripts/releases-content.mjs';
import {publishedReleaseVersions} from '../lib/published-release-versions.js';

const currentVersion = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
).version;

test('loads every published Polymux release in newest-first order', () => {
  const releases = loadPublishedReleases();
  const versions = releases.map(({version}) => version);
  assert.equal(versions[0], currentVersion);
  assert.deepEqual(
    versions,
    [...versions].sort((left, right) => right.localeCompare(left, undefined, {numeric: true})),
  );
  assert.equal(new Set(releases.map(({version}) => version)).size, releases.length);
  assert.match(releases[0]?.summary ?? '', /release/i);
  assert.equal(releases.find(({version}) => version === '0.2.0')?.downloadable, false);
  assert.equal(releases.find(({version}) => version === '0.1.0')?.downloadable, false);
  assert.deepEqual([...publishedReleaseVersions].sort(), [...versions].sort());
});

test('requires category and product-area sections for release notes', () => {
  assert.throws(
    () => validateReleaseBody('0.3.0.md', '## Features\n\n- Added something.'),
    /category and area/,
  );
  assert.doesNotThrow(() => validateReleaseBody('0.3.0.md', '## Features\n\n### Hub\n\n- Added something.'));
});
