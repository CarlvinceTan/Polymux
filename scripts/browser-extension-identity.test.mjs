import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Run the real resolver against a synthetic inventory; never attach a browser.
const source = readFileSync(new URL("../apps/extension/background.js", import.meta.url), "utf8");
const resolver = source.slice(source.indexOf("function normalizedUrl("), source.indexOf("async function sessionFor("));
const tabs = [
  {id: 1, url: "https://example.com/", title: "First"},
  {id: 2, url: "https://example.com/", title: "Second"},
];
const resolve = (inventory, target) => vm.runInNewContext(`${resolver}\nfindTab(target)`, {
  URL, target, chrome: {tabs: {query: async () => inventory}},
});

test("external tab binding rejects ambiguous names and stale exact identities", async () => {
  assert.equal(await resolve(tabs, {url: "https://example.com/"}), null);
  assert.equal((await resolve(tabs, {url: "https://example.com/", title: "Second"})).id, 2);
  assert.equal(await resolve([...tabs, {...tabs[1], id: 3}], {title: "Second"}), null);
  assert.equal((await resolve(tabs, {tabId: 1})).id, 1);
  assert.equal(await resolve(tabs, {tabId: 1, title: "Second"}), null);
  assert.equal(await resolve(tabs, {tabId: 1, url: "https://different.example/"}), null);
  assert.equal(await resolve(tabs, {tabId: 999, url: "https://example.com/"}), null);
});
