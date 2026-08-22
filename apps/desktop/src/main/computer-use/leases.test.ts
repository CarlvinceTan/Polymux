import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { appNameFor, readWindowControlLeases } from "./leases.js";
import { WindowControlMonitor } from "./monitor.js";

const NOW = Date.parse("2026-08-18T10:00:00.000Z");
/** The registry keeps seconds; everything in the app keeps milliseconds. */
const seconds = (ms: number) => ms / 1000;

function registry(leases: Record<string, unknown>): string {
  const root = mkdtempSync(path.join(tmpdir(), "flareai-leases-"));
  const file = path.join(root, "window-control-leases.json");
  writeFileSync(file, JSON.stringify({ version: 1, leases }));
  return file;
}

const lease = (appId: string, expiresAtMs: number, extra: Record<string, unknown> = {}) => ({
  app_id: appId,
  window_id: "win-1",
  scope: "window",
  owner: "run-1",
  controller: "flareai",
  acquired_at: seconds(NOW),
  expires_at: seconds(expiresAtMs),
  token_hash: "abc",
  ...extra,
});

test("an active lease is reported and an expired one is not", () => {
  const file = registry({
    a: lease("com.apple.calculator", NOW + 60_000),
    b: lease("com.apple.Dictionary", NOW - 1_000),
  });
  const active = readWindowControlLeases(file, NOW);
  assert.deepEqual(active.map((entry) => entry.appId), ["com.apple.calculator"]);
});

test("the token hash never leaves the registry", () => {
  const file = registry({ a: lease("com.apple.calculator", NOW + 60_000) });
  const [found] = readWindowControlLeases(file, NOW);
  assert.ok(found);
  assert.ok(!("token_hash" in found) && !("tokenHash" in found));
});

test("a missing or malformed registry reads as nothing being driven", () => {
  assert.deepEqual(readWindowControlLeases("/nowhere/leases.json", NOW), []);
  const root = mkdtempSync(path.join(tmpdir(), "flareai-leases-"));
  const torn = path.join(root, "leases.json");
  writeFileSync(torn, '{"version":1,"leases":{"a":');
  assert.deepEqual(readWindowControlLeases(torn, NOW), []);
  rmSync(root, { recursive: true, force: true });
});

test("a lease missing its identity is dropped rather than shown as blank", () => {
  const file = registry({
    a: { window_id: "w", owner: "run-1", expires_at: seconds(NOW + 60_000) },
    b: lease("com.apple.calculator", NOW + 60_000),
  });
  assert.deepEqual(
    readWindowControlLeases(file, NOW).map((entry) => entry.appId),
    ["com.apple.calculator"],
  );
});

test("a bundle id becomes a readable name, from a window when there is one", () => {
  assert.equal(
    appNameFor("com.apple.calculator", [{ app: "Calculator", bundleId: "com.apple.calculator" }]),
    "Calculator",
  );
  // No window listing: the identifier's tail still beats the whole string.
  assert.equal(appNameFor("com.apple.Dictionary"), "Dictionary");
  assert.equal(appNameFor("com.example.myapp"), "Myapp");
});

test("the pill drops an app the moment its lease expires, with no file change", () => {
  const file = registry({ a: lease("com.apple.calculator", NOW + 2_000) });
  const published: Array<Array<{ name: string }>> = [];
  let now = NOW;
  const monitor = new WindowControlMonitor({
    registryPath: file,
    windows: () => [{ app: "Calculator", bundleId: "com.apple.calculator" }],
    onChange: (apps) => published.push(apps),
    clock: () => now,
    schedule: () => 0 as unknown as ReturnType<typeof setInterval>,
    cancelSchedule: () => {},
  });

  monitor.refresh();
  assert.deepEqual(published.at(-1)?.map((app) => app.name), ["Calculator"]);
  // Unchanged readings are not republished.
  monitor.refresh();
  assert.equal(published.length, 1);

  now = NOW + 3_000;
  monitor.refresh();
  assert.deepEqual(published.at(-1), []);
  monitor.stop();
});

test("two windows of one app are one entry, not two", () => {
  const file = registry({
    a: lease("com.apple.Safari", NOW + 60_000),
    b: lease("com.apple.Safari", NOW + 60_000, { window_id: "win-2" }),
  });
  const published: Array<Array<{ appId: string }>> = [];
  const monitor = new WindowControlMonitor({
    registryPath: file,
    windows: () => [{ app: "Safari", bundleId: "com.apple.Safari" }],
    onChange: (apps) => published.push(apps),
    clock: () => NOW,
    schedule: () => 0 as unknown as ReturnType<typeof setInterval>,
    cancelSchedule: () => {},
  });
  monitor.refresh();
  assert.deepEqual(published.at(-1)?.map((app) => app.appId), ["com.apple.Safari"]);
  monitor.stop();
});
