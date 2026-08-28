import assert from 'node:assert/strict';
import test from 'node:test';
import {loadPublishedDocs} from '../scripts/docs-content.mjs';

test('documentation has ordered, unique pages and an introduction', () => {
  const pages = loadPublishedDocs();
  assert.ok(pages.length >= 10);
  assert.equal(pages[0]?.slug, 'introduction');
  assert.equal(new Set(pages.map((page) => page.slug)).size, pages.length);
  for (let index = 1; index < pages.length; index += 1) {
    const previous = pages[index - 1];
    const current = pages[index];
    assert.ok(
      current.sectionOrder > previous.sectionOrder
        || (current.sectionOrder === previous.sectionOrder && current.order >= previous.order),
    );
  }
});
