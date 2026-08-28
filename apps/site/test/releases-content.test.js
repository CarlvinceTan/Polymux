import assert from 'node:assert/strict';
import test from 'node:test';
import {loadPublishedReleases} from '../scripts/releases-content.mjs';

test('loads unique published release notes for the current desktop version', () => {
  const releases = loadPublishedReleases();
  assert.ok(releases.some(({version}) => version === '0.2.3'));
  assert.equal(new Set(releases.map(({version}) => version)).size, releases.length);
  assert.match(releases[0]?.summary ?? '', /release/i);
});
