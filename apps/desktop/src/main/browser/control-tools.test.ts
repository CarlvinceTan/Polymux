import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { SurfaceCommand, SurfaceCommandResult } from "../agent/surface.js";
import type { AgentSurfaceServer } from "../agent/surface.js";
import type { ControlSession } from "./embedded.js";
import type { InAppBrowser } from "./embedded-tools.js";
import { createBrowserControlTools } from "./control-tools.js";
import {Computer} from "@polymux/computer";

/**
 * A surface that records what it was asked to run, so the tests can assert on
 * the command the tool built rather than on a live browser.
 */
function fakeSurface(
  result: SurfaceCommandResult = { ok: true, content: "done" },
): {
  surface: AgentSurfaceServer;
  commands: Array<{ leaseId: string; command: Omit<SurfaceCommand, "id">; timeoutMs?: number }>;
  released: string[];
  leasedTabs: Array<{ tabId?: number; url: string; title: string }>;
} {
  const commands: Array<{
    leaseId: string;
    command: Omit<SurfaceCommand, "id">;
    timeoutMs?: number;
  }> = [];
  const released: string[] = [];
  const leasedTabs: Array<{ tabId?: number; url: string; title: string }> = [];
  let next = 0;
  const surface = {
    createLease: (tab: { tabId?: number; url: string; title: string }) => {
      leasedTabs.push(tab);
      return { id: `lease-${(next += 1)}` };
    },
    releaseLease: (id: string) => {
      released.push(id);
      return true;
    },
    runCommand: async (
      leaseId: string,
      command: Omit<SurfaceCommand, "id">,
      timeoutMs?: number,
    ) => {
      commands.push({ leaseId, command, timeoutMs });
      return result;
    },
  } as unknown as AgentSurfaceServer;
  return { surface, commands, released, leasedTabs };
}

function controlTool(surface: AgentSurfaceServer) {
  const tool = createBrowserControlTools(surface).find(
    (candidate) => candidate.name === "browser_control",
  );
  assert.ok(tool);
  return tool;
}

const context = {} as Parameters<ReturnType<typeof controlTool>["execute"]>[1];

async function currentReadFixture(payload: object, result?: SurfaceCommandResult) {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-current-tab-"));
  const snapshotPath = path.join(directory, "tabs.json");
  await writeFile(snapshotPath, JSON.stringify(payload));
  const fake = fakeSurface(result);
  const tool = createBrowserControlTools(fake.surface, {
    snapshotPath,
    now: () => Date.parse("2026-08-21T12:00:00.000Z"),
    currentRead: true,
  }).find((candidate) => candidate.name === "browser_current_read");
  assert.ok(tool);
  return { ...fake, tool };
}

function visibleEmbeddedBrowser(titles: string[]): InAppBrowser {
  const tabs = titles.map((title, index) => ({
    tabId: `embedded-${index}`,
    url: `https://embedded.example/${index}`,
    title,
  }));
  const session: ControlSession = {
    send: async (method) => method === "Accessibility.getFullAXTree"
      ? { nodes: [{ nodeId: "1", ignored: false, role: { value: "document" }, name: { value: "live embedded state" } }] }
      : {},
    refs: new Map(),
    observers: { dialog: null },
    cursor: null,
    paced: () => 0,
    moveCursor: async () => {},
  };
  return {
    tabs: () => tabs,
    visibleTabs: () => tabs,
    openAgentTab: async () => { throw new Error("must not open"); },
    reveal: () => {},
    navigate: () => {},
    settle: async (tabId) => tabs.find((tab) => tab.tabId === tabId)!,
    pageInfo: (tabId) => tabs.find((tab) => tab.tabId === tabId)!,
    session: async () => session,
    close: () => {},
  };
}

test("current read binds the exact active tab in the focused window and only snapshots", async () => {
  const fixture = await currentReadFixture({
    captured_at: "2026-08-21T11:59:30.000Z",
    focused_window_id: 2,
    tabs: [
      { id: 10, window_id: 1, active: true, url: "https://wrong.example", title: "Wrong" },
      { id: 20, window_id: 2, active: true, url: "https://right.example/app", title: "Signed in" },
    ],
  }, { ok: true, pageUrl: "https://right.example/app", pageTitle: "Signed in", content: "private live state" });

  const result = await fixture.tool.execute({ expectedTitle: "Signed in" }, context);
  assert.deepEqual(fixture.leasedTabs, [{ tabId: 20, url: "https://right.example/app", title: "Signed in" }]);
  assert.equal(fixture.commands.length, 1);
  assert.equal(fixture.commands[0]?.command.kind, "snapshot");
  assert.deepEqual(fixture.released, ["lease-1"]);
  assert.match(result.content as string, /private live state/);
});

test("current read fails closed for stale, legacy, and ambiguous focus snapshots", async () => {
  const cases = [
    { captured_at: "2026-08-21T11:50:00.000Z", focused_window_id: 1, tabs: [] },
    { captured_at: "2026-08-21T11:59:30.000Z", tabs: [{ id: 1, window_id: 1, active: true, url: "https://example.com" }] },
    { captured_at: "2026-08-21T11:59:30.000Z", focused_window_id: 1, tabs: [
      { id: 1, window_id: 1, active: true, url: "https://a.example" },
      { id: 2, window_id: 1, active: true, url: "https://b.example" },
    ] },
  ];
  for (const payload of cases) {
    const fixture = await currentReadFixture(payload);
    const result = await fixture.tool.execute({ expectedTitle: "Expected" }, context);
    assert.equal(result.isError, true);
    assert.equal(fixture.commands.length, 0);
    assert.equal(fixture.leasedTabs.length, 0);
  }
});

test("current read refuses a focused browser tab that is not the current window", async () => {
  const fixture = await currentReadFixture({
    captured_at: "2026-08-21T11:59:30.000Z",
    focused_window_id: 2,
    tabs: [{ id: 20, window_id: 2, active: true, url: "https://mail.example", title: "Old browser" }],
  });
  const result = await fixture.tool.execute({ expectedTitle: "Current document" }, context);
  assert.equal(result.isError, true);
  assert.equal(fixture.commands.length, 0);
  assert.equal(fixture.leasedTabs.length, 0);
});

test("current read uses the visible Polymux page without consulting external browser state", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-current-embedded-"));
  const snapshotPath = path.join(directory, "missing.json");
  const fake = fakeSurface();
  const tool = createBrowserControlTools(fake.surface, {
    currentRead: true,
    snapshotPath,
    embeddedBrowser: visibleEmbeddedBrowser(["Visible app"]),
  }).find((candidate) => candidate.name === "browser_current_read");
  assert.ok(tool);
  const result = await tool.execute({ expectedTitle: "Visible app" }, context);
  assert.match(result.content as string, /live embedded state/);
  assert.equal(fake.commands.length, 0);
  assert.equal(fake.leasedTabs.length, 0);
});

test("current read refuses duplicate visible Polymux pages instead of falling through", async () => {
  const fake = fakeSurface();
  const tool = createBrowserControlTools(fake.surface, {
    currentRead: true,
    embeddedBrowser: visibleEmbeddedBrowser(["Same", "Same"]),
  }).find((candidate) => candidate.name === "browser_current_read");
  assert.ok(tool);
  const result = await tool.execute({ expectedTitle: "Same" }, context);
  assert.equal(result.isError, true);
  assert.equal(fake.commands.length, 0);
});

test("focus probes the tab before handing back a lease", async () => {
  const { surface, commands } = fakeSurface({
    ok: true,
    pageUrl: "https://example.com/",
    pageTitle: "Example",
  });
  const result = await controlTool(surface).execute(
    { action: "focus", url: "https://example.com/" },
    context,
  );
  assert.equal(commands[0].command.kind, "read");
  assert.deepEqual(JSON.parse(result.content as string), {
    leaseId: "lease-1",
    pageUrl: "https://example.com/",
    pageTitle: "Example",
  });
});

test("browser mutations require the exact Computer.Arbiter capability", async () => {
  const fake = fakeSurface({ok: true, pageUrl: "https://example.com/", pageTitle: "Example"});
  const computer = new Computer(() => ({
    externalBrowserTabs: [{tabId: 7, windowId: 2, title: "Example", url: "https://example.com/", active: false}],
  }));
  const tool = createBrowserControlTools(fake.surface, {computer}).find((candidate) => candidate.name === "browser_control")!;
  const focused = await tool.execute({action: "focus", url: "https://example.com/"}, context);
  const lease = JSON.parse(focused.content as string);
  assert.equal(lease.surfaceId, "tab:external:7");

  const denied = await tool.execute({action: "click", leaseId: lease.leaseId, ref: "e1"}, context);
  assert.equal(denied.isError, true);
  assert.match(denied.content as string, /Computer\.Arbiter/);

  const grant = computer.Arbiter.request({ownerId: "run-1", surfaceId: lease.surfaceId, operation: "press", scope: "tab"});
  const allowed = await tool.execute({action: "click", leaseId: lease.leaseId, ref: "e1", computerToken: grant.token}, context);
  assert.equal(allowed.isError, undefined);
});

test("a tab that never answers releases the lease instead of leaking it", async () => {
  const { surface, released } = fakeSurface({ ok: false, error: "no matching tab" });
  const result = await controlTool(surface).execute(
    { action: "focus", title: "Nowhere" },
    context,
  );
  assert.equal(result.isError, true);
  assert.match(result.content as string, /no matching tab/);
  assert.deepEqual(released, ["lease-1"]);
});

test("focus needs something to identify the tab by", async () => {
  const { surface, commands } = fakeSurface();
  const result = await controlTool(surface).execute({ action: "focus" }, context);
  assert.equal(result.isError, true);
  assert.equal(commands.length, 0);
});

test("every bound action refuses to run without a leaseId", async () => {
  const { surface, commands } = fakeSurface();
  for (const action of ["click", "snapshot", "read", "screenshot", "scroll"]) {
    const result = await controlTool(surface).execute({ action, ref: "e1" }, context);
    assert.equal(result.isError, true, action);
    assert.match(result.content as string, /leaseId/, action);
  }
  assert.equal(commands.length, 0);
});

test("snapshot forwards only its own filters", async () => {
  const { surface, commands } = fakeSurface();
  await controlTool(surface).execute(
    {
      action: "snapshot",
      leaseId: "L",
      interactive: true,
      depth: 4,
      // Not a snapshot argument: it must not ride along and mean something else.
      text: "ignored",
    },
    context,
  );
  assert.deepEqual(commands[0].command, {
    kind: "snapshot",
    interactive: true,
    compact: undefined,
    urls: undefined,
    depth: 4,
    frames: undefined,
  });
});

test("a target action carries ref, selector and point through unchanged", async () => {
  const { surface, commands } = fakeSurface();
  await controlTool(surface).execute(
    { action: "click", leaseId: "L", ref: "e7", pace: "fast" },
    context,
  );
  assert.equal(commands[0].command.kind, "click");
  assert.equal(commands[0].command.pace, "fast");
  assert.equal(commands[0].command.ref, "e7");
  assert.equal(commands[0].command.selector, undefined);
});

test("a semantic locator reaches the page as one", async () => {
  const { surface, commands } = fakeSurface();
  await controlTool(surface).execute(
    { action: "click", leaseId: "L", role: "button", name: "Save", exact: true },
    context,
  );
  assert.equal(commands[0].command.role, "button");
  assert.equal(commands[0].command.name, "Save");
  assert.equal(commands[0].command.exact, true);
});

test("text names the element for click but is the content for type", async () => {
  const { surface, commands } = fakeSurface();
  await controlTool(surface).execute(
    { action: "click", leaseId: "L", text: "Sign in" },
    context,
  );
  assert.equal(commands[0].command.locatorText, "Sign in", "click targets by text");
  assert.equal(commands[0].command.text, undefined, "click must not carry it as content");

  await controlTool(surface).execute(
    { action: "type", leaseId: "L", ref: "e2", text: "hello" },
    context,
  );
  assert.equal(commands[1].command.text, "hello", "type enters the text");
  assert.equal(commands[1].command.ref, "e2");
});

test("fill accepts value as a content alias instead of silently clearing the field", async () => {
  const { surface, commands } = fakeSurface();
  await controlTool(surface).execute(
    { action: "fill", leaseId: "L", ref: "e2", value: "Alex Example" },
    context,
  );
  assert.equal(commands[0].command.text, "Alex Example");
  assert.equal(commands[0].command.ref, "e2");

  const missing = await controlTool(surface).execute(
    {action: "fill", leaseId: "L", ref: "e2"},
    context,
  );
  assert.equal(missing.isError, true);
  assert.match(missing.content as string, /requires text or value/);
});

test("targeting actions demand a target, except click at a point", async () => {
  const { surface, commands } = fakeSurface();
  for (const action of ["click", "fill", "select", "check", "get", "upload"]) {
    const result = await controlTool(surface).execute({ action, leaseId: "L" }, context);
    assert.equal(result.isError, true, action);
    assert.match(result.content as string, /requires (a target|value|files)/, action);
  }
  assert.equal(commands.length, 0);

  const ok = await controlTool(surface).execute(
    { action: "click", leaseId: "L", x: 10, y: 20 },
    context,
  );
  assert.notEqual(ok.isError, true);
  assert.equal(commands.length, 1);
});

test("actions with required arguments say which one is missing", async () => {
  const { surface } = fakeSurface();
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ action: "navigate" }, /url/],
    [{ action: "eval" }, /expression/],
    [{ action: "press" }, /key/],
    [{ action: "select", ref: "e1" }, /value/],
    [{ action: "upload", ref: "e1" }, /files/],
    [{ action: "drag", ref: "e1" }, /toRef/],
    [{ action: "wait" }, /ms, selector, text, or fn/],
    [{ action: "tabClose" }, /tabId/],
  ];
  for (const [input, expected] of cases) {
    const result = await controlTool(surface).execute(
      { ...input, leaseId: "L" },
      context,
    );
    assert.equal(result.isError, true, JSON.stringify(input));
    assert.match(result.content as string, expected, JSON.stringify(input));
  }
});

test("tab actions run without a lease and clean up the one they borrow", async () => {
  const { surface, commands, released } = fakeSurface({ ok: true, content: "1 * Tab — url" });
  const result = await controlTool(surface).execute({ action: "tabs" }, context);
  assert.equal(result.content, "1 * Tab — url");
  assert.equal(commands[0].command.kind, "tabs");
  assert.deepEqual(released, ["lease-1"]);
});

test("page output comes back as text, not wrapped in JSON", async () => {
  const { surface } = fakeSurface({ ok: true, content: '- button "Buy" [ref=e1]' });
  const result = await controlTool(surface).execute(
    { action: "snapshot", leaseId: "L" },
    context,
  );
  assert.equal(result.content, '- button "Buy" [ref=e1]');
});

test("a screenshot comes back as an image block the model can see", async () => {
  const { surface } = fakeSurface({
    ok: true,
    content: "captured viewport png",
    image: { data: "AAAA", mimeType: "image/png" },
  });
  const result = await controlTool(surface).execute(
    { action: "screenshot", leaseId: "L", fullPage: true },
    context,
  );
  assert.deepEqual(result.content, [
    { type: "text", text: "captured viewport png" },
    { type: "image", data: "AAAA", mimeType: "image/png" },
  ]);
});

test("slow actions get a longer timeout than ordinary ones", async () => {
  const { surface, commands } = fakeSurface();
  await controlTool(surface).execute(
    { action: "navigate", leaseId: "L", url: "https://example.com" },
    context,
  );
  await controlTool(surface).execute({ action: "hover", leaseId: "L", ref: "e1" }, context);
  assert.equal(commands[0].timeoutMs, 60_000);
  assert.equal(commands[1].timeoutMs, 20_000);
});

test("a failed command surfaces the extension's reason", async () => {
  const { surface } = fakeSurface({
    ok: false,
    error: "Target is covered by div.cookie-banner at that point",
  });
  const result = await controlTool(surface).execute(
    { action: "click", leaseId: "L", ref: "e1" },
    context,
  );
  assert.equal(result.isError, true);
  assert.match(result.content as string, /covered by div\.cookie-banner/);
});

test("release ends the lease without touching the browser", async () => {
  const { surface, commands, released } = fakeSurface();
  const result = await controlTool(surface).execute(
    { action: "release", leaseId: "lease-x" },
    context,
  );
  assert.equal(result.content, "released");
  assert.deepEqual(released, ["lease-x"]);
  assert.equal(commands.length, 0);
});
