import assert from "node:assert/strict";
import test from "node:test";
import type {JsonObject} from "@flareai/inference";
import type {ControlSession} from "./embedded.js";
import {createInAppBrowserBatchTool, createInAppBrowserReadTool, createInAppBrowserTool, defaultResearchMaxChars, readOnlySectionControls, type InAppBrowser} from "./embedded-tools.js";

/**
 * The page half of the tool now runs the shared @flareai/browser
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

async function run(
  browser: InAppBrowser,
  input: JsonObject,
): Promise<{content: string; isError?: boolean}> {
  const result = await createInAppBrowserTool(browser).execute(input, {} as never);
  return result as {content: string; isError?: boolean};
}

async function runBatch(browser: InAppBrowser, input: JsonObject): Promise<{content: string; isError?: boolean}> {
  return createInAppBrowserBatchTool(browser).execute(input, {} as never) as Promise<{content: string; isError?: boolean}>;
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
  await run(browser, {action: "open", url: "site:mom.gov.sg student pass work"});
  await run(browser, {action: "open", url: "flareai.test/docs"});
  await run(browser, {action: "navigate", tabId: "tab-1", url: "who won the toss"});
  assert.deepEqual(browser.calls, [
    "open https://www.google.com/search?q=flareai%20release%20notes",
    "open https://www.google.com/search?q=site%3Amom.gov.sg%20student%20pass%20work",
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

test("ordinary browser calls never carry batch placeholder ids", () => {
  const tool = createInAppBrowserTool(fakeBrowser());
  const properties = tool.parameters.properties as Record<string, unknown>;
  const action = properties.action as {enum: string[]};
  assert.ok(!action.enum.includes("snapshotMany"));
  assert.ok(!("tabIds" in properties));
});

test("browser_snapshot_many reads known tabs concurrently in one tool result", async () => {
  const browser = fakeBrowser({}, (method) => {
    if (method === "Accessibility.getFullAXTree")
      return {
        nodes: [{
          nodeId: "1",
          ignored: false,
          role: {value: "heading"},
          name: {value: "Event details"},
          backendDOMNodeId: 7,
        }],
      };
    return {};
  });
  await run(browser, {action: "open", url: "https://example.com/two"});
  const result = await runBatch(browser, {
    tabIds: ["tab-1", "tab-2"],
    compact: true,
    maxChars: 2000,
  });
  const payload = JSON.parse(result.content);
  assert.equal(payload.pages.length, 2);
  assert.deepEqual(payload.pages.map((page: {tabId: string}) => page.tabId), ["tab-1", "tab-2"]);
  assert.ok(payload.pages.every((page: {content: string}) => page.content.includes("Event details")));
  assert.deepEqual(browser.calls, [
    "open https://example.com/two",
    "session tab-1",
    "session tab-2",
  ]);
});

test("browser_snapshot_many accepts one validated tab without a tool failure", async () => {
  const browser = fakeBrowser({}, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "One page"}}]}
      : {},
  );
  const result = await runBatch(browser, {tabIds: ["tab-1"]});
  const payload = JSON.parse(result.content);
  assert.equal(payload.pages.length, 1);
  assert.match(payload.pages[0].content, /One page/);
});

test("browser_snapshot_many isolates stale ids without discarding valid pages", async () => {
  const browser = fakeBrowser({}, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Valid page"}}]}
      : {},
  );
  const result = await runBatch(browser, {
    tabIds: ["tab-1", "gone"],
  });
  assert.equal(result.isError, undefined);
  const payload = JSON.parse(result.content);
  assert.equal(payload.pages[0].ok, true);
  assert.match(payload.pages[0].content, /Valid page/);
  assert.deepEqual(payload.pages[1], {
    ok: false,
    tabId: "gone",
    error: "No such browser tab. Call browser action 'tabs' to refresh exact ids.",
  });
  assert.deepEqual(browser.calls, ["session tab-1"]);
});

test("browser_read opens and snapshots a search in one call", async () => {
  const browser = fakeBrowser({}, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: [{nodeId: "1", ignored: false, role: {value: "link"}, name: {value: "Official result"}}]}
      : {},
  );
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "site:mom.gov.sg student pass work",
    maxChars: 2000,
  }, {} as never);
  const payload = JSON.parse(result.content as string);
  assert.equal(payload.tabId, "tab-2");
  assert.match(payload.content, /Official result/);
  assert.deepEqual(browser.calls, [
    "open https://search.brave.com/search?q=site%3Amom.gov.sg%20student%20pass%20work",
    "session tab-2",
    "close tab-2",
    "open https://www.google.com/search?q=site%3Amom.gov.sg%20student%20pass%20work",
    "session tab-2",
  ]);
});

test("browser_read compacts search routing evidence before it enters model context", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("result-title-a"))
      return {result: {value: {
        body: "Search results",
        results: [{title: "Official event", url: "https://nus.edu.sg/event", snippet: "22 August"}],
      }}};
    if (method === "Accessibility.getFullAXTree")
      throw new Error("a compact search must not request the full accessibility tree");
    return {};
  });
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "NUS events this weekend",
  }, {} as never);
  const payload = JSON.parse(result.content as string);
  assert.deepEqual(payload.results, [{
    title: "Official event",
    url: "https://nus.edu.sg/event",
    snippet: "22 August",
  }]);
  assert.match(payload.note, /discovery leads, not verified evidence/i);
  assert.ok(!browser.sent.includes("Accessibility.getFullAXTree"));
});

test("browser_read extracts Google h3 result links instead of returning its raw page tree", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    const expression = String(params.expression ?? "");
    if (method === "Runtime.evaluate" && expression.includes("#search a[href]"))
      return {result: {value: {
        body: "Google results",
        results: [{title: "Official library", url: "https://library.example/hours", snippet: "Open 24 hours"}],
      }}};
    if (method === "Accessibility.getFullAXTree")
      throw new Error("a structured Google result page must not fall back to its accessibility tree");
    return {};
  });
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "quiet study space nearby",
  }, {} as never);
  const payload = JSON.parse(result.content as string);
  assert.deepEqual(payload.results, [{
    title: "Official library",
    url: "https://library.example/hours",
    snippet: "Open 24 hours",
  }]);
});

test("a site-scoped single-answer query verifies its top same-domain result in one call", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    const expression = String(params.expression ?? "");
    if (method === "Runtime.evaluate" && expression.includes("result-title-a"))
      return {result: {value: {
        body: "Search results",
        results: [
          {title: "Official study spaces", url: "https://nus.edu.sg/nuslibraries/spaces", snippet: "24 hours"},
          {title: "Unrelated", url: "https://example.com/list"},
        ],
      }}};
    if (method === "Accessibility.getFullAXTree")
      return {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Official detail evidence"}}]};
    return {};
  });
  const tool = createInAppBrowserReadTool(browser);
  const result = await tool.execute({
    target: "site:nus.edu.sg study spaces open tomorrow",
    verifyTopResult: true,
  }, {runId: "scoped-one", subagent: true} as never);
  const payload = JSON.parse(result.content as string);
  assert.match(payload.content, /Official detail evidence/);
  assert.equal(payload.discovery.selectedUrl, "https://nus.edu.sg/nuslibraries/spaces");
  assert.match(payload.discovery.policy, /nus\.edu\.sg/);
  assert.deepEqual(browser.calls.filter((call) => call.startsWith("open ")), [
    "open https://search.brave.com/search?q=site%3Anus.edu.sg%20study%20spaces%20open%20tomorrow",
    "open https://nus.edu.sg/nuslibraries/spaces",
  ]);
});

test("site-scoped verification does not depend on the model supplying an optional flag", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("result-title-a"))
      return {result: {value: {body: "Search results", results: [
        {title: "Official detail", url: "https://official.example/detail"},
      ]}}};
    if (method === "Accessibility.getFullAXTree")
      return {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Verified official content"}}]};
    return {};
  });
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "site:official.example current opening hours",
  }, {runId: "automatic-scoped", subagent: true} as never);
  const payload = JSON.parse(result.content as string);
  assert.equal(payload.discovery.selectedUrl, "https://official.example/detail");
  assert.match(payload.content, /Verified official content/);
  assert.equal(browser.calls.filter((call) => call.startsWith("open ")).length, 2);
});

test("a site-scoped candidate-set query automatically verifies three results", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("result-title-a"))
      return {result: {value: {body: "Search results", results: [
        {title: "Event A", url: "https://official.example/events/a"},
        {title: "Event B", url: "https://official.example/events/b"},
        {title: "Event C", url: "https://official.example/events/c"},
        {title: "Event D", url: "https://official.example/events/d"},
      ]}}};
    if (method === "Accessibility.getFullAXTree")
      return {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Verified detail"}}]};
    return {};
  });
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "site:official.example latest upcoming events",
  }, {runId: "automatic-candidate-set", subagent: false} as never);
  const payload = JSON.parse(result.content as string);
  assert.equal(payload.verifiedPages.length, 3);
  assert.deepEqual(payload.verifiedPages.map((page: {selectedUrl: string}) => page.selectedUrl), [
    "https://official.example/events/a",
    "https://official.example/events/b",
    "https://official.example/events/c",
  ]);
  assert.equal(browser.calls.filter((call) => call.startsWith("open ")).length, 4);
});

test("a site-scoped comparison verifies up to three official results concurrently", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("result-title-a"))
      return {result: {value: {
        body: "Search results",
        results: [
          {title: "Library A", url: "https://nus.edu.sg/a"},
          {title: "Library B", url: "https://www.nus.edu.sg/b"},
          {title: "Wrong domain", url: "https://example.com/c"},
          {title: "Library D", url: "https://lib.nus.edu.sg/d"},
        ],
      }}};
    if (method === "Accessibility.getFullAXTree")
      return {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Official evidence"}}]};
    return {};
  });
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "site:nus.edu.sg compare libraries",
    verifyTopResults: 3,
  }, {runId: "scoped-three", subagent: true} as never);
  const payload = JSON.parse(result.content as string);
  assert.equal(payload.verifiedPages.length, 3);
  assert.deepEqual(payload.verifiedPages.map((page: {selectedUrl: string}) => page.selectedUrl), [
    "https://nus.edu.sg/a",
    "https://www.nus.edu.sg/b",
    "https://lib.nus.edu.sg/d",
  ]);
  assert.match(payload.nextAction, /Do not reopen/i);
  assert.equal(browser.calls.filter((call) => call.startsWith("open ")).length, 4);
});

test("top-result verification refuses unscoped and cross-domain results", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("result-title-a"))
      return {result: {value: {
        body: "Search results",
        results: [{title: "Wrong domain", url: "https://example.com/study"}],
      }}};
    return {};
  });
  const tool = createInAppBrowserReadTool(browser);
  const scoped = JSON.parse((await tool.execute({
    target: "site:nus.edu.sg study spaces",
    verifyTopResult: true,
  }, {runId: "scoped-refusal", subagent: true} as never)).content as string);
  const unscoped = JSON.parse((await tool.execute({
    target: "NUS study spaces",
    verifyTopResult: true,
  }, {} as never)).content as string);
  assert.equal(scoped.results[0].url, "https://example.com/study");
  assert.equal(unscoped.results[0].url, "https://example.com/study");
  assert.equal(browser.calls.some((call) => call === "open https://example.com/study"), false);
});

test("a delegated research run gets one broad discovery query but unlimited direct evidence", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("result-title-a"))
      return {result: {value: {body: "Search results", results: [{
        title: "Official source",
        url: "https://www.mom.gov.sg/source",
        snippet: "Official evidence",
      }]}}};
    if (method === "Accessibility.getFullAXTree")
      return {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Direct evidence"}}]};
    return {};
  });
  const tool = createInAppBrowserReadTool(browser);
  const delegated = {runId: "worker-one", subagent: true} as never;
  const first = await tool.execute({target: "Singapore policy changes"}, delegated);
  const second = await tool.execute({target: "another search variant"}, delegated);
  const direct = await tool.execute({target: "https://www.mom.gov.sg/source"}, delegated);
  assert.equal(JSON.parse(first.content as string).ok, true);
  assert.match(second.content as string, /already used its one broad discovery query/i);
  assert.equal(JSON.parse(direct.content as string).ok, true);
  assert.equal(browser.calls.filter((call) => call.startsWith("open ")).length, 2);
});

test("a main run gets one discovery per scope while retaining distinct official domains", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("result-title-a"))
      return {result: {value: {body: "Search results", results: [
        {title: "One", url: "https://one.example/page"},
        {title: "Two", url: "https://two.example/page"},
        {title: "Three", url: "https://three.example/page"},
      ]}}};
    if (method === "Accessibility.getFullAXTree")
      return {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Verified evidence"}}]};
    return {};
  });
  const tool = createInAppBrowserReadTool(browser);
  const main = {runId: "main-scopes", subagent: false} as never;
  const first = await tool.execute({target: "site:one.example upcoming events"}, main);
  const retry = await tool.execute({target: "site:one.example latest activities"}, main);
  const distinct = await tool.execute({target: "site:two.example upcoming events"}, main);
  const broad = await tool.execute({target: "nearby public events"}, main);
  const broadRetry = await tool.execute({target: "local events near me"}, main);
  const pathScoped = await tool.execute({target: "site:three.example/events relevant activities"}, main);
  const pathScopedRetry = await tool.execute({target: "site:three.example/jobs relevant roles"}, main);
  const budgetReached = (result: {metadata?: unknown}) =>
    (result.metadata as {discoveryBudgetReached?: boolean} | undefined)?.discoveryBudgetReached === true;
  assert.equal(budgetReached(first), false);
  assert.equal(budgetReached(retry), true);
  assert.equal(budgetReached(distinct), false);
  assert.equal(budgetReached(broad), false);
  assert.equal(budgetReached(broadRetry), true);
  assert.equal(budgetReached(pathScoped), false);
  assert.equal(budgetReached(pathScopedRetry), true);
  // Four permitted searches plus one auto-verified page for each of the three
  // scoped domains; rejected repeats open no additional tab.
  assert.equal(browser.calls.filter((call) => call.startsWith("open ")).length, 7);
});

test("discovery scope budgets reset when a run is cleaned up", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("result-title-a"))
      return {result: {value: {body: "Search results", results: [
        {title: "Official", url: "https://official.example/page"},
      ]}}};
    if (method === "Accessibility.getFullAXTree")
      return {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Verified evidence"}}]};
    return {};
  });
  const tool = createInAppBrowserReadTool(browser);
  const context = {runId: "scope-cleanup", subagent: false} as never;
  await tool.execute({target: "site:official.example first lookup"}, context);
  const blocked = await tool.execute({target: "site:official.example retry lookup"}, context);
  tool.cleanupRun("scope-cleanup");
  const afterCleanup = await tool.execute({target: "site:official.example fresh lookup"}, context);
  const budgetReached = (result: {metadata?: unknown}) =>
    (result.metadata as {discoveryBudgetReached?: boolean} | undefined)?.discoveryBudgetReached === true;
  assert.equal(budgetReached(blocked), true);
  assert.equal(budgetReached(afterCleanup), false);
});

test("a stale 404 discovery result releases the scope for one different recovery query", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("result-title-a"))
      return {result: {value: {body: "Search results", results: [
        {title: "Stale library page", url: "https://nus.edu.sg/nuslibraries/stale"},
      ]}}};
    if (method === "Accessibility.getFullAXTree")
      return {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "404 Page not found"}}]};
    return {};
  });
  const tool = createInAppBrowserReadTool(browser);
  const context = {runId: "404-recovery", subagent: false} as never;
  const first = await tool.execute({target: "site:nus.edu.sg/nuslibraries 24-hour study spaces"}, context);
  const recovery = await tool.execute({target: "site:nus.edu.sg/nuslibraries Medicine Science Library"}, context);
  const repeated = await tool.execute({target: "site:nus.edu.sg/nuslibraries 24-hour study spaces"}, context);
  const budgetReached = (result: {metadata?: unknown}) =>
    (result.metadata as {discoveryBudgetReached?: boolean} | undefined)?.discoveryBudgetReached === true;
  assert.match(first.content as string, /404 Page not found/);
  assert.equal(budgetReached(recovery), false, "a distinct recovery query remains available");
  assert.equal(budgetReached(repeated), true, "the same failed query cannot loop");
});

test("empty discovery releases its scope but suppresses the identical retry", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("result-title-a"))
      return {result: {value: {body: "", results: []}}};
    return {};
  });
  const tool = createInAppBrowserReadTool(browser);
  const context = {runId: "empty-recovery", subagent: false} as never;
  await tool.execute({target: "site:official.example old wording"}, context);
  const same = await tool.execute({target: "site:official.example old wording"}, context);
  const refined = await tool.execute({target: "site:official.example corrected wording"}, context);
  assert.equal((same.metadata as {discoveryBudgetReached?: boolean}).discoveryBudgetReached, true);
  assert.notEqual((refined.metadata as {discoveryBudgetReached?: boolean} | undefined)?.discoveryBudgetReached, true);
});

test("browser_read falls back once from an empty Brave page to compact Google results", async () => {
  let compactReads = 0;
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("result-title-a")) {
      compactReads += 1;
      return {result: {value: compactReads === 1
        ? {body: "", results: []}
        : {body: "Search results", results: [{
            title: "NUSync",
            url: "https://nusync.nus.edu.sg/",
            snippet: "Upcoming NUS events",
          }]}}};
    }
    if (method === "Accessibility.getFullAXTree")
      throw new Error("successful fallback search must remain compact");
    return {};
  });
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "NUSync latest events NUS",
  }, {runId: "research-1"} as never);
  const payload = JSON.parse(result.content as string);
  assert.equal(payload.results[0].url, "https://nusync.nus.edu.sg/");
  assert.deepEqual(browser.calls.filter((call) => call.startsWith("open ")), [
    "open https://search.brave.com/search?q=NUSync%20latest%20events%20NUS",
    "open https://www.google.com/search?q=NUSync%20latest%20events%20NUS",
  ]);
  assert.ok(browser.calls.includes("close tab-2"));
  assert.equal(compactReads, 2);
});

test("browser_read lets a direct page hydrate before taking its snapshot", async () => {
  const browser = fakeBrowser({}, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Late event details"}}]}
      : {},
  );
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "https://events.example/details",
  }, {} as never);
  assert.match(JSON.parse(result.content as string).content, /Late event details/);
  assert.ok(
    browser.sent.indexOf("Runtime.evaluate") < browser.sent.indexOf("Accessibility.getFullAXTree"),
    "hydration must finish before the accessibility snapshot",
  );
});

test("browser_read briefly polls a dynamic listing until its cards hydrate", async () => {
  let listingReads = 0;
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("querySelectorAll")) {
      listingReads += 1;
      return {result: {value: listingReads < 2 ? [] : [
        {title: "Event A", url: "https://events.example/event/a"},
        {title: "Event B", url: "https://events.example/event/b"},
        {title: "Event C", url: "https://events.example/event/c"},
      ]}};
    }
    return {};
  });
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "https://events.example/events",
  }, {runId: "late-listing"} as never);
  const payload = JSON.parse(result.content as string);
  assert.equal(payload.records.length, 3);
  assert.equal(listingReads, 2);
});

test("browser_read suppresses an unchanged repeat inside one run", async () => {
  const browser = fakeBrowser({}, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Official evidence"}}]}
      : {},
  );
  const tool = createInAppBrowserReadTool(browser);
  const context = {runId: "research-repeat"} as never;
  const first = await tool.execute({target: "https://official.example/place", urls: true}, context);
  const repeated = await tool.execute({urls: true, target: "https://official.example/place"}, context);
  assert.equal(browser.calls.filter((call) => call.startsWith("open ")).length, 1);
  assert.equal((repeated.metadata as {repeatSuppressed?: boolean})?.repeatSuppressed, true);
  assert.equal(JSON.parse(repeated.content as string).repeatSuppressed, true);
  assert.equal(JSON.parse(first.content as string).repeatSuppressed, undefined);
});

test("browser_read repeat cache is isolated by run and cleared on cleanup", async () => {
  const browser = fakeBrowser({}, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Evidence"}}]}
      : {},
  );
  const tool = createInAppBrowserReadTool(browser);
  const input = {target: "https://official.example/place"};
  await tool.execute(input, {runId: "run-a"} as never);
  await tool.execute(input, {runId: "run-b"} as never);
  tool.cleanupRun("run-a");
  await tool.execute(input, {runId: "run-a"} as never);
  assert.equal(browser.calls.filter((call) => call.startsWith("open ")).length, 3);
});

test("browser_read compacts repeated list cards with exact first-party detail URLs", async () => {
  let listingExpression = "";
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("rsvp_boot")) {
      listingExpression = String(params.expression);
      return {result: {value: [
        {title: "Friday Hacks", url: "https://events.example/rsvp_boot?id=1", summary: "Friday 7 PM"},
        {title: "Welcome Tea", url: "https://events.example/rsvp_boot?id=2", summary: "Friday 6 PM"},
        {title: "Orientation", url: "https://events.example/rsvp_boot?id=3", summary: "Saturday 9 AM"},
      ]}};
    }
    if (method === "Accessibility.getFullAXTree")
      throw new Error("a compact listing must not request the full accessibility tree");
    return {};
  });
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "https://events.example/events",
    compact: true,
  }, {} as never);
  const payload = JSON.parse(result.content as string);
  assert.equal(payload.records.length, 3);
  assert.equal(payload.records[0].url, "https://events.example/rsvp_boot?id=1");
  assert.equal(payload.records[0].verification, "candidate");
  assert.match(payload.requiredNextAction, /open.*exact first-party detail URL/i);
  assert.match(payload.note, /discovery evidence only/i);
  assert.match(listingExpression, /searchParams\.delete\('rel'\)/);
  assert.ok(!browser.sent.includes("Accessibility.getFullAXTree"));
});

test("browser_read enforces its snapshot character budget", async () => {
  const browser = fakeBrowser({}, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: Array.from({length: 20}, (_, index) => ({
          nodeId: String(index + 1),
          ignored: false,
          role: {value: "text"},
          name: {value: `row-${index}-${"x".repeat(100)}`},
        }))}
      : {},
  );
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "https://events.example/details",
    maxChars: 300,
  }, {} as never);
  const content = JSON.parse(result.content as string).content as string;
  assert.ok(content.length < 340);
  assert.match(content, /…\[truncated\]$/);
});

test("browser_read exposes exact safe section-navigation follow-ups", async () => {
  const browser = fakeBrowser({}, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: [{nodeId: "1", ignored: false, role: {value: "button"}, name: {value: "scroll to Location section"}, backendDOMNodeId: 7}]}
      : {},
  );
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "https://events.example/details",
    interactive: true,
  }, {} as never);
  const payload = JSON.parse(result.content as string);
  assert.deepEqual(payload.availableSectionControls, [{label: "scroll to Location section", ref: "e1"}]);
  assert.match(payload.followUp, /browser action 'click'/);
});

test("interactive direct research also returns bounded non-interactive page text", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Accessibility.getFullAXTree")
      return {nodes: [{nodeId: "1", ignored: false, role: {value: "button"}, name: {value: "Register"}, backendDOMNodeId: 7}]};
    if (method === "Runtime.evaluate" && String(params.expression).includes("document.body.innerText"))
      return {result: {value: "Location\nCOM3-01-21\nRequirements\nBring photo ID"}};
    return {};
  });
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "https://events.example/details",
    interactive: true,
    maxChars: 1000,
  }, {} as never);
  const payload = JSON.parse(result.content as string);
  assert.match(payload.content, /Register/);
  assert.match(payload.pageText, /COM3-01-21/);
});

test("browser_read rebinds once when navigation replaces the inspected renderer", async () => {
  let snapshots = 0;
  const browser = fakeBrowser({}, (method) => {
    if (method === "Accessibility.getFullAXTree") {
      snapshots += 1;
      if (snapshots === 1) throw new Error("Inspected target navigated or closed");
      return {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Recovered page"}}]};
    }
    return {};
  });
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "https://events.example/details",
  }, {} as never);
  assert.equal(result.isError, undefined);
  assert.match(JSON.parse(result.content as string).content, /Recovered page/);
  assert.equal(snapshots, 2);
});

test("browser_read falls back to a fresh hidden tab across a multi-redirect renderer race", async () => {
  let snapshots = 0;
  const browser = fakeBrowser({}, (method) => {
    if (method === "Accessibility.getFullAXTree") {
      snapshots += 1;
      if (snapshots < 3) throw new Error("Inspected target navigated or closed");
      return {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Stable detail"}}]};
    }
    return {};
  });
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "https://events.example/details",
  }, {runId: "worker-1"} as never);
  assert.equal(result.isError, undefined);
  assert.match(JSON.parse(result.content as string).content, /Stable detail/);
  assert.equal(snapshots, 3);
  assert.ok(browser.calls.includes("close tab-2"));
  assert.equal(browser.calls.filter((call) => call === "open https://events.example/details").length, 2);
});

test("browser_read rebinds the fresh tab across one final canonical redirect", async () => {
  let snapshots = 0;
  const browser = fakeBrowser({}, (method) => {
    if (method === "Accessibility.getFullAXTree") {
      snapshots += 1;
      if (snapshots < 4) throw new Error("Inspected target navigated or closed");
      return {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Canonical page"}}]};
    }
    return {};
  });
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "https://events.example/events",
  }, {runId: "worker-1"} as never);
  assert.equal(result.isError, undefined);
  assert.match(JSON.parse(result.content as string).content, /Canonical page/);
  assert.equal(snapshots, 4);
});

test("browser_read degrades an exhausted accessibility navigation race to bounded page text", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Accessibility.getFullAXTree")
      throw new Error("Inspected target navigated or closed");
    if (method === "Runtime.evaluate" && String(params.expression).includes("document.body.innerText"))
      return {result: {value: "Stable canonical page text"}};
    return {};
  });
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "https://events.example/events",
  }, {runId: "worker-1"} as never);
  assert.equal(result.isError, undefined);
  const payload = JSON.parse(result.content as string);
  assert.equal(payload.ok, true);
  assert.match(payload.content, /Stable canonical page text/);
});

test("section follow-ups exclude ordinary and mutating controls", () => {
  assert.deepEqual(readOnlySectionControls([
    '- button "scroll to Requirements section" [ref=e2]',
    '- button "Register" [ref=e3]',
    '- button "Submit" [ref=e4]',
  ].join("\n")), [{label: "scroll to Requirements section", ref: "e2"}]);
});

test("browser_read reuses one worker's idle same-origin tab for direct details", async () => {
  const browser = fakeBrowser({}, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Event"}}]}
      : {},
  );
  const tool = createInAppBrowserReadTool(browser);
  const context = {runId: "worker-1"} as never;
  await tool.execute({target: "https://events.example/list"}, context);
  await tool.execute({target: "https://events.example/detail/7"}, context);
  assert.deepEqual(browser.calls, [
    "open https://events.example/list",
    "session tab-2",
    "session tab-2",
    "navigate tab-2 https://events.example/detail/7",
    "session tab-2",
  ]);
});

test("parallel same-origin reads reserve the reused tab before awaiting it", async () => {
  const browser = fakeBrowser({}, (method) => method === "Accessibility.getFullAXTree"
    ? {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Event"}}]}
    : {});
  const tool = createInAppBrowserReadTool(browser);
  const context = {runId: "parallel-worker"} as never;
  await tool.execute({target: "https://events.example/list"}, context);
  await Promise.all([
    tool.execute({target: "https://events.example/detail/a"}, context),
    tool.execute({target: "https://events.example/detail/b"}, context),
    tool.execute({target: "https://events.example/detail/c"}, context),
  ]);
  assert.equal(browser.calls.filter((call) => call.startsWith("open ")).length, 3);
});

test("browser_read activates an exact same-origin result link before falling back to navigation", async () => {
  const browser = fakeBrowser({}, (method, params) => {
    if (method === "Runtime.evaluate" && String(params.expression).includes("querySelectorAll"))
      return {result: {value: true}};
    if (method === "Accessibility.getFullAXTree")
      return {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Event detail"}}]};
    return {};
  });
  const tool = createInAppBrowserReadTool(browser);
  const context = {runId: "worker-1"} as never;
  await tool.execute({target: "https://events.example/list"}, context);
  await tool.execute({target: "https://events.example/detail/7"}, context);
  assert.ok(!browser.calls.some((call) => call.startsWith("navigate ")));
});

test("browser_read gives redirect-heavy RSVP details a fresh hidden tab", async () => {
  const browser = fakeBrowser({}, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Event detail"}}]}
      : {},
  );
  const tool = createInAppBrowserReadTool(browser);
  const context = {runId: "worker-1"} as never;
  await tool.execute({target: "https://events.example/list"}, context);
  const result = await tool.execute({target: "https://events.example/rsvp_boot?id=7"}, context);
  assert.equal(browser.calls.filter((call) => call.startsWith("open ")).length, 2);
  assert.ok(!browser.calls.some((call) => call.startsWith("navigate ")));
  const payload = JSON.parse(result.content as string);
  assert.match(payload.evidencePolicy.attendeeRequirements, /does not prove a confirmation QR/i);
  assert.match(payload.evidencePolicy.attendeeRequirements, /label any practical ideas optional/i);
  assert.match(payload.evidencePolicy.answerFormat, /Officially required.*Optional suggestions/i);
});

test("browser_read closes its hidden research tabs when the run settles", async () => {
  const browser = fakeBrowser({}, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Event"}}]}
      : {},
  );
  const tool = createInAppBrowserReadTool(browser);
  await tool.execute({target: "https://events.example/list"}, {runId: "worker-1"} as never);
  tool.cleanupRun("worker-1");
  assert.ok(browser.calls.includes("close tab-2"));
});

test("browser_read leaves a research tab open when the user is viewing it", async () => {
  const browser = fakeBrowser({
    visibleTabs: () => [{tabId: "tab-2", url: "https://events.example/list", title: "Opened"}],
  }, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Event"}}]}
      : {},
  );
  const tool = createInAppBrowserReadTool(browser);
  await tool.execute({target: "https://events.example/list"}, {runId: "worker-1"} as never);
  tool.cleanupRun("worker-1");
  assert.ok(!browser.calls.includes("close tab-2"));
});

test("browser_read reports bot verification as an error and closes the junk tab", async () => {
  const browser = fakeBrowser({
    settle: async () => ({
      tabId: "tab-2",
      url: "https://www.google.com/sorry/index?continue=search",
      title: "Before you continue",
    }),
  }, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "Our systems have detected unusual traffic from your computer network. reCAPTCHA"}}]}
      : {},
  );
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "site:mom.gov.sg employment pass 2027",
  }, {} as never);
  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content as string);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /reCAPTCHA|bot-verification|unusual-traffic/i);
  assert.match(payload.recovery, /Do not retry/);
  assert.ok(browser.calls.includes("close tab-2"));
});

test("browser_read recognises a Bing challenge page as blocked evidence", async () => {
  const browser = fakeBrowser({
    settle: async () => ({
      tabId: "tab-2",
      url: "https://www.bing.com/search?q=nus+events",
      title: "NUS events - Search",
    }),
  }, (method) =>
    method === "Accessibility.getFullAXTree"
      ? {nodes: [{nodeId: "1", ignored: false, role: {value: "text"}, name: {value: "One last step Please solve the challenge below to continue"}}]}
      : {},
  );
  const result = await createInAppBrowserReadTool(browser).execute({
    target: "https://www.bing.com/search?q=nus+events",
  }, {} as never);
  assert.equal(result.isError, true);
  assert.match(JSON.parse(result.content as string).error, /Bing challenge/i);
  assert.ok(browser.calls.includes("close tab-2"));
});

test("research reads reserve more context for direct evidence than search routing", () => {
  assert.equal(defaultResearchMaxChars("site:mom.gov.sg student pass work"), 6_000);
  assert.equal(defaultResearchMaxChars("https://www.mom.gov.sg/passes"), 10_000);
  assert.equal(defaultResearchMaxChars("mom.gov.sg/passes"), 10_000);
});
