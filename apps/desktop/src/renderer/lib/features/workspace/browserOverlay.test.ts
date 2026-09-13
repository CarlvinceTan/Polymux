import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMBEDDED_BROWSER_OVERLAY_SELECTOR,
  onEmbeddedBrowserYield,
  overlayObscuresEmbeddedBrowser,
  yieldEmbeddedBrowsers,
} from './browserOverlay';

function root(modal: boolean): ParentNode {
  return {
    querySelector(selector: string) {
      if (selector !== EMBEDDED_BROWSER_OVERLAY_SELECTOR) return null;
      return modal ? {} : null;
    },
  } as ParentNode;
}

test('a window-modal dialog covers the embedded browser', () => {
  assert.equal(overlayObscuresEmbeddedBrowser(root(true)), true);
});

test('a page with no modal leaves the embedded browser visible', () => {
  assert.equal(overlayObscuresEmbeddedBrowser(root(false)), false);
});

test('yieldEmbeddedBrowsers runs registered handlers and drops them on stop', async () => {
  let calls = 0;
  const stop = onEmbeddedBrowserYield(async () => {
    calls += 1;
  });
  await yieldEmbeddedBrowsers();
  assert.equal(calls, 1);
  stop();
  await yieldEmbeddedBrowsers();
  assert.equal(calls, 1);
});
