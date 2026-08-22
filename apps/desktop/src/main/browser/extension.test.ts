import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SNAPSHOT_STALE_AFTER_MS,
  PROMPT_SNAPSHOT_MAX_AGE_MS,
  readExtensionStatus,
  readExternalPromptSnapshot,
  readExternalPromptTabs,
  tabSnapshotPath,
} from "./extension.js";
import { createBrowserControlTools } from "./control-tools.js";

function snapshot(ageMs: number): string {
  const directory = mkdtempSync(path.join(tmpdir(), "flareai-ext-"));
  const file = path.join(directory, "tabs.json");
  writeFileSync(file, "{}");
  const seconds = (Date.now() - ageMs) / 1000;
  utimesSync(file, seconds, seconds);
  return file;
}

test("a missing snapshot means the extension has never reported", () => {
  const status = readExtensionStatus(Date.now(), "/nonexistent/tabs.json");
  assert.deepEqual(status, { installed: false, lastReportedAt: null });
});

test("a recent snapshot counts as installed", () => {
  const status = readExtensionStatus(Date.now(), snapshot(60_000));
  assert.equal(status.installed, true);
  assert.ok(status.lastReportedAt);
});

test("a snapshot older than the window counts as gone", () => {
  const status = readExtensionStatus(
    Date.now(),
    snapshot(SNAPSHOT_STALE_AFTER_MS + 60_000),
  );
  // The uninstall leaves the file behind, so staleness is the only signal.
  assert.equal(status.installed, false);
  assert.ok(status.lastReportedAt, "it still reports when it was last seen");
});

test("prompt context reads only fresh valid external tabs and stays bounded", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "flareai-prompt-tabs-"));
  const file = path.join(directory, "tabs.json");
  const now = Date.now();
  writeFileSync(file, JSON.stringify({
    captured_at: new Date(now - 1_000).toISOString(),
    tabs: [
      {id: 1, window_id: 4, title: "NUS Canvas", url: "https://canvas.nus.edu.sg", active: true},
      {id: "bad", title: "Malformed", url: "https://bad.example"},
      {id: 2, title: "Mail", url: "https://mail.example", active: false},
    ],
  }));
  assert.deepEqual(readExternalPromptTabs(now, file, 1), [{
    tabId: 1,
    windowId: 4,
    title: "NUS Canvas",
    url: "https://canvas.nus.edu.sg",
    active: true,
  }]);
  assert.deepEqual(readExternalPromptSnapshot(now, file, 1), {
    capturedAt: new Date(now - 1_000).toISOString(),
    tabs: [{
      tabId: 1,
      windowId: 4,
      title: "NUS Canvas",
      url: "https://canvas.nus.edu.sg",
      active: true,
    }],
  });
  writeFileSync(file, JSON.stringify({
    captured_at: new Date(now - PROMPT_SNAPSHOT_MAX_AGE_MS - 1).toISOString(),
    tabs: [{id: 1, title: "Old", url: "https://old.example"}],
  }));
  assert.deepEqual(readExternalPromptTabs(now, file), []);
  assert.deepEqual(readExternalPromptSnapshot(now, file), {tabs: []});
  assert.deepEqual(readExternalPromptTabs(now, "/missing/tabs.json"), []);
});

test("the snapshot path is the one browser_tabs reads", () => {
  assert.equal(
    tabSnapshotPath("/home/u"),
    "/home/u/Library/Application Support/flareai-tab-context/tabs.json",
  );
});

test("external browser tools stay with the conversational agent", () => {
  const surface = {} as Parameters<typeof createBrowserControlTools>[0];
  const tools = createBrowserControlTools(surface);
  assert.deepEqual(tools.map((tool) => [tool.name, tool.mainAgentOnly]), [
    ["browser_tabs", true],
    ["browser_control", true],
  ]);
  assert.deepEqual(
    createBrowserControlTools(surface, { currentRead: true }).map((tool) => [tool.name, tool.mainAgentOnly]),
    [
      ["browser_tabs", true],
      ["browser_current_read", true],
      ["browser_control", true],
    ],
  );
});
