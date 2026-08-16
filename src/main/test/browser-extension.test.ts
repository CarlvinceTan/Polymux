import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SNAPSHOT_STALE_AFTER_MS,
  readExtensionStatus,
  tabSnapshotPath,
} from "../browser-extension.js";

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

test("the snapshot path is the one browser_tabs reads", () => {
  assert.equal(
    tabSnapshotPath("/home/u"),
    "/home/u/Library/Application Support/flareai-tab-context/tabs.json",
  );
});
