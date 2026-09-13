import assert from "node:assert/strict";
import test from "node:test";
import {titleFromHtml} from "./page-title.js";

test("prefers og:title over the document title", () => {
  assert.equal(
    titleFromHtml(`<!doctype html><html><head>
      <title>Polymux — Personal AI</title>
      <meta property="og:title" content="Polymux">
    </head></html>`),
    "Polymux",
  );
});

test("reads a title when content is written before property", () => {
  assert.equal(
    titleFromHtml(`<meta content="Upcoming events" property="og:title">`),
    "Upcoming events",
  );
});

test("decodes entities in a document title", () => {
  assert.equal(
    titleFromHtml("<title>AI &amp; Events &#8212; 2026</title>"),
    "AI & Events — 2026",
  );
});

test("ignores interstitial and url titles", () => {
  assert.equal(titleFromHtml("<title>Just a moment...</title>"), null);
  assert.equal(titleFromHtml("<title>https://example.com/</title>"), null);
  assert.equal(titleFromHtml("<title>   </title>"), null);
});
