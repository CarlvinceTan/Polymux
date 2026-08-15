import assert from "node:assert/strict";
import test from "node:test";
import type {JsonObject} from "@midas/inference";
import {createInAppBrowserTool, type InAppBrowser} from "../in-app-browser-tools.js";

function fakeBrowser(overrides: Partial<InAppBrowser> = {}): InAppBrowser & {calls: string[]} {
  const calls: string[] = [];
  const tabs = [{tabId: "tab-1", url: "https://example.com/", title: "Example"}];
  return {
    calls,
    tabs: () => tabs,
    reveal: (tabId) => { calls.push(`show ${tabId}`); },
    openAgentTab: async (url, show) => {
      calls.push(`open ${url}${show ? " show" : ""}`);
      const tab = {tabId: "tab-2", url, title: "Opened"};
      tabs.push(tab);
      return tab;
    },
    navigate: (tabId, url) => { calls.push(`navigate ${tabId} ${url}`); },
    settle: async (tabId) => tabs.find((tab) => tab.tabId === tabId)!,
    pageInfo: (tabId) => tabs.find((tab) => tab.tabId === tabId)!,
    readPage: async (tabId, maxChars) => { calls.push(`read ${tabId} ${maxChars}`); return "page text"; },
    click: async (tabId, selector) => { calls.push(`click ${selector}`); return true; },
    type: async (tabId, selector, text, submit) => { calls.push(`type ${selector} ${text} ${submit}`); return true; },
    scroll: async () => true,
    close: (tabId) => { calls.push(`close ${tabId}`); },
    ...overrides,
  };
}

async function run(browser: InAppBrowser, input: JsonObject): Promise<{content: string; isError?: boolean}> {
  const result = await createInAppBrowserTool(browser).execute(input, {} as never);
  return result as {content: string; isError?: boolean};
}

test("open loads a url and reports the tab it landed in", async () => {
  const browser = fakeBrowser();
  const result = await run(browser, {action: "open", url: "https://midas.test/docs"});
  assert.deepEqual(JSON.parse(result.content), {
    ok: true,
    tabId: "tab-2",
    pageUrl: "https://midas.test/docs",
    pageTitle: "Opened",
  });
  assert.deepEqual(browser.calls, ["open https://midas.test/docs"]);
});

test("show brings an open tab to the front for the user", async () => {
  const browser = fakeBrowser();
  const result = await run(browser, {action: "show", tabId: "tab-1"});
  assert.equal(JSON.parse(result.content).pageUrl, "https://example.com/");
  assert.deepEqual(browser.calls, ["show tab-1"]);
});

test("open can reveal the page when the user asked to see it", async () => {
  const browser = fakeBrowser();
  await run(browser, {action: "open", url: "https://midas.test/docs", show: true});
  assert.deepEqual(browser.calls, ["open https://midas.test/docs show"]);
});

test("read returns the page text alongside the page it came from", async () => {
  const browser = fakeBrowser();
  const result = await run(browser, {action: "read", tabId: "tab-1", maxChars: 500});
  const payload = JSON.parse(result.content);
  assert.equal(payload.content, "page text");
  assert.equal(payload.pageUrl, "https://example.com/");
  assert.deepEqual(browser.calls, ["read tab-1 500"]);
});

test("typing with submit reports where the tab ended up", async () => {
  const browser = fakeBrowser();
  const result = await run(browser, {action: "type", tabId: "tab-1", selector: "#q", text: "midas", submit: true});
  assert.equal(JSON.parse(result.content).ok, true);
  assert.deepEqual(browser.calls, ["type #q midas true"]);
});

test("a selector that matches nothing is an error, not a silent success", async () => {
  const browser = fakeBrowser({click: async () => false});
  const result = await run(browser, {action: "click", tabId: "tab-1", selector: ".missing"});
  assert.equal(result.isError, true);
  assert.match(result.content, /matches \.missing/);
});

test("rejects unknown tabs and non-http urls", async () => {
  const browser = fakeBrowser();
  const unknownTab = await run(browser, {action: "read", tabId: "tab-9"});
  assert.equal(unknownTab.isError, true);
  const badUrl = await run(browser, {action: "open", url: "file:///etc/passwd"});
  assert.equal(badUrl.isError, true);
  const noTab = await run(browser, {action: "read"});
  assert.equal(noTab.isError, true);
  assert.deepEqual(browser.calls, []);
});

test("tabs lists what is already open", async () => {
  const browser = fakeBrowser();
  const result = await run(browser, {action: "tabs"});
  assert.deepEqual(JSON.parse(result.content), {
    tabs: [{tabId: "tab-1", url: "https://example.com/", title: "Example"}],
  });
});
