import assert from "node:assert/strict";
import test from "node:test";
import type { SurfaceCommand, SurfaceCommandResult } from "../agent/surface.js";
import type { AgentSurfaceServer } from "../agent/surface.js";
import { createBrowserControlTools } from "./control-tools.js";

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
} {
  const commands: Array<{
    leaseId: string;
    command: Omit<SurfaceCommand, "id">;
    timeoutMs?: number;
  }> = [];
  const released: string[] = [];
  let next = 0;
  const surface = {
    createLease: () => ({ id: `lease-${(next += 1)}` }),
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
  return { surface, commands, released };
}

function controlTool(surface: AgentSurfaceServer) {
  const tool = createBrowserControlTools(surface).find(
    (candidate) => candidate.name === "browser_control",
  );
  assert.ok(tool);
  return tool;
}

const context = {} as Parameters<ReturnType<typeof controlTool>["execute"]>[1];

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
