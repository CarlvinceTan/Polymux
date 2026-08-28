import assert from "node:assert/strict";
import test from "node:test";
import {browserViewportMode, mobileBrowserUserAgent} from "./viewport.js";

test("uses mobile mode only for a narrow portrait viewport", () => {
  assert.equal(browserViewportMode({width: 420, height: 900}), "mobile");
  assert.equal(browserViewportMode({width: 700, height: 900}), "desktop");
  assert.equal(browserViewportMode({width: 560, height: 420}), "desktop");
  assert.equal(browserViewportMode({width: 0, height: 900}, "mobile"), "mobile");
});

test("keeps mobile mode through a small resize buffer", () => {
  assert.equal(browserViewportMode({width: 650, height: 900}, "desktop"), "desktop");
  assert.equal(browserViewportMode({width: 650, height: 900}, "mobile"), "mobile");
  assert.equal(browserViewportMode({width: 681, height: 900}, "mobile"), "desktop");
});

test("builds a mobile Chrome user agent without Electron desktop markers", () => {
  const userAgent = mobileBrowserUserAgent("142.0.7444.175");
  assert.match(userAgent, /Android 15/);
  assert.match(userAgent, /Chrome\/142\.0\.7444\.175/);
  assert.match(userAgent, /Mobile Safari/);
  assert.doesNotMatch(userAgent, /Electron|Macintosh/);
});
