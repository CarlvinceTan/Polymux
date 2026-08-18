import assert from "node:assert/strict";
import test from "node:test";
import type {JsonObject} from "@flareai/inference";
import type {ControlSession} from "./embedded.js";
import {createInAppBrowserTool, type InAppBrowser} from "./embedded-tools.js";

/**
 * The page half of the tool now runs the shared @flareai/browser-use
 * handlers, which talk CDP. The fake answers CDP directly, so these tests
 * cover the tool's own job — workspace tabs, argument shaping, reporting —
 * against the real handlers rather than against stand-ins for them.
 */
function fakeBrowser(
  overrides: Partial<InAppBrowser> = {},
  cdp: (method: string, params: Record<string, unknown>) => unknown = () => ({}),
): InAppBrowser & {calls: string[]; sent: string[]} {
  const calls: string[] = [];
  const sent: string[] = [];
  const tabs = [{tabId: "tab-1", url: "https://example.com/", title: "Example"}];
  const session: ControlSession = {
    send: async (method, params = {}) => {
      sent.push(method);
      return (cdp(method, params as Record<string, unknown>) ?? {}) as Record<string, unknown>;
    },
    refs: new Map(),
    observers: {dialog: null},
    cursor: null,
    paced: () => 0,
    moveCursor: async () => {},
  };
  return {
    calls,
    sent,
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
    session: async (tabId) => { calls.push(`session ${tabId}`); return session; },
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
  const result = await run(browser, {action: "open", url: "https://flareai.test/docs"});
  assert.deepEqual(JSON.parse(result.content), {
    ok: true,
    tabId: "tab-2",
    pageUrl: "https://flareai.test/docs",
    pageTitle: "Opened",
  });
  assert.deepEqual(browser.calls, ["open https://flareai.test/docs"]);
});

test("show brings an open tab to the front for the user", async () => {
  const browser = fakeBrowser();
  const result = await run(browser, {action: "show", tabId: "tab-1"});
  assert.equal(JSON.parse(result.content).pageUrl, "https://example.com/");
  assert.deepEqual(browser.calls, ["show tab-1"]);
});

test("open can reveal the page when the user asked to see it", async () => {
  const browser = fakeBrowser();
  await run(browser, {action: "open", url: "https://flareai.test/docs", show: true});
  assert.deepEqual(browser.calls, ["open https://flareai.test/docs show"]);
});

test("read returns the page text alongside the page it came from", async () => {
  const browser = fakeBrowser({}, (method) =>
    method === "Runtime.evaluate" ? {result: {value: "page text"}} : {},
  );
  const result = await run(browser, {action: "read", tabId: "tab-1", maxChars: 500});
  const payload = JSON.parse(result.content);
  assert.equal(payload.content, "page text");
  assert.equal(payload.pageUrl, "https://example.com/");
  assert.deepEqual(browser.calls, ["session tab-1"]);
});

test("the in-app browser answers the same page actions as the extension", async () => {
  const browser = fakeBrowser({}, (method) => {
    if (method === "Accessibility.getFullAXTree")
      return {
        nodes: [
          {
            nodeId: "1",
            ignored: false,
            role: {value: "button"},
            name: {value: "Buy"},
            backendDOMNodeId: 7,
          },
        ],
      };
    return {};
  });
  const result = await run(browser, {action: "snapshot", tabId: "tab-1", interactive: true});
  assert.match(JSON.parse(result.content).content, /- button "Buy" \[ref=e1\]/);
  assert.ok(browser.sent.includes("Accessibility.getFullAXTree"));
});

test("a screenshot comes back as an image block", async () => {
  const browser = fakeBrowser({}, (method) =>
    method === "Page.captureScreenshot" ? {data: "AAAA"} : {},
  );
  const result = (await createInAppBrowserTool(browser).execute(
    {action: "screenshot", tabId: "tab-1"},
    {} as never,
  )) as {content: Array<Record<string, unknown>>};
  assert.equal(result.content[1].type, "image");
  assert.equal(result.content[1].data, "AAAA");
});

test("an action with no target is refused before it reaches the page", async () => {
  const browser = fakeBrowser();
  const result = await run(browser, {action: "click", tabId: "tab-1"});
  assert.equal(result.isError, true);
  assert.match(result.content, /requires a target/);
  assert.deepEqual(browser.sent, []);
});

test("a blocking dialog is reported instead of letting the command hang", async () => {
  const browser = fakeBrowser();
  const session = await browser.session("tab-1");
  session.observers.dialog = {type: "confirm", message: "Leave site?"};
  const result = await run(browser, {action: "read", tabId: "tab-1"});
  assert.equal(result.isError, true);
  assert.match(result.content, /confirm dialog is blocking/);
});

test("plain terms search Google, a bare host just gains a scheme", async () => {
  const browser = fakeBrowser();
  await run(browser, {action: "open", url: "flareai release notes"});
  await run(browser, {action: "open", url: "flareai.test/docs"});
  await run(browser, {action: "navigate", tabId: "tab-1", url: "who won the toss"});
  assert.deepEqual(browser.calls, [
    "open https://www.google.com/search?q=flareai%20release%20notes",
    "open https://flareai.test/docs",
    "navigate tab-1 https://www.google.com/search?q=who%20won%20the%20toss",
  ]);
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
