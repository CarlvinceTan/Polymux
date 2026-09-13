import assert from 'node:assert/strict';
import test from 'node:test';
import {validatePullRequestBody} from './validate-pr-release-notes.mjs';

test('accepts a user-facing release note as the final PR section', () => {
  assert.equal(
    validatePullRequestBody('## Summary\n\nAdds chat search.\n\nRelease Notes:\n\n- Hub: Added chat search to conversations.'),
    '- Hub: Added chat search to conversations.',
  );
});

test('accepts N/A for changes without a user-facing note', () => {
  assert.equal(validatePullRequestBody('## Summary\n\nInternal change.\n\nRelease Notes:\n\n- N/A'), '- N/A');
});

test('rejects missing area and category information', () => {
  assert.throws(
    () => validatePullRequestBody('## Summary\n\nRelease Notes:\n\n- Added chat search.'),
    /<Area>/,
  );
});

test('rejects content after the release note', () => {
  assert.throws(
    () => validatePullRequestBody('Release Notes:\n\n- Hub: Added chat search.\n\nMore details.'),
    /exactly one bullet/,
  );
});
