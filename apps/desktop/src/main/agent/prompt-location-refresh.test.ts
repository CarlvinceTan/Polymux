import assert from "node:assert/strict";
import test from "node:test";
import {refreshLocationForPrompt} from "./prompt-location-refresh.js";

const now = Date.parse("2026-08-21T02:30:00.000Z");
const fresh = {latitude: 1.2966, longitude: 103.7764, accuracy: 20, updatedAt: "2026-08-21T02:29:00.000Z"};
const stale = {...fresh, updatedAt: "2026-08-21T01:00:00.000Z"};

function fixture(overrides: Partial<Parameters<typeof refreshLocationForPrompt>[1]> = {}) {
  let permissionCalls = 0;
  let positionCalls = 0;
  const persisted: typeof fresh[] = [];
  return {
    persisted,
    calls: () => ({permissionCalls, positionCalls}),
    options: {
      current: () => ({enabled: true, location: stale}),
      permission: async () => (permissionCalls++, "granted" as const),
      position: async () => (positionCalls++, fresh),
      persist: (location: typeof fresh) => { persisted.push(location); },
      now: () => now,
      ...overrides,
    },
  };
}

test("unrelated, disabled, and already-fresh prompts never ask the platform", async () => {
  for (const [prompt, current, expected] of [
    ["Summarise this file", () => ({enabled: true, location: stale}), "unrelated"],
    ["Find somewhere nearby", () => ({enabled: false, location: stale}), "disabled"],
    ["Find somewhere nearby", () => ({enabled: true, location: fresh}), "fresh"],
  ] as const) {
    const f = fixture({current});
    assert.equal(await refreshLocationForPrompt(prompt, f.options), expected);
    assert.deepEqual(f.calls(), {permissionCalls: 0, positionCalls: 0});
  }
});

test("a stale proximity fix refreshes once when permission is already granted", async () => {
  const f = fixture();
  assert.equal(await refreshLocationForPrompt("Find the closest quiet place", f.options), "refreshed");
  assert.deepEqual(f.calls(), {permissionCalls: 1, positionCalls: 1});
  assert.deepEqual(f.persisted, [fresh]);
});

test("prompt, denied, unsupported, and permission errors never request a position", async () => {
  for (const permission of ["prompt", "denied", "unsupported"] as const) {
    const f = fixture({permission: async () => permission});
    assert.equal(await refreshLocationForPrompt("Find somewhere nearby", f.options), "permission-unavailable");
    assert.equal(f.calls().positionCalls, 0);
  }
  const f = fixture({permission: async () => { throw new Error("unavailable"); }});
  assert.equal(await refreshLocationForPrompt("Find somewhere nearby", f.options), "permission-unavailable");
});

test("missing and city-scale prior fixes never risk opening a new platform permission prompt", async () => {
  for (const location of [null, {...stale, accuracy: 25_000}]) {
    const f = fixture({current: () => ({enabled: true, location})});
    assert.equal(await refreshLocationForPrompt("Find somewhere nearby", f.options), "permission-unavailable");
    assert.deepEqual(f.calls(), {permissionCalls: 0, positionCalls: 0});
  }
});

test("timeout, provider failure, and invalid positions degrade without persisting", async () => {
  const timeout = fixture({
    timeoutMs: 250,
    position: async (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
  });
  assert.equal(await refreshLocationForPrompt("Find somewhere nearby", timeout.options), "failed");
  assert.deepEqual(timeout.persisted, []);

  const invalid = fixture({position: async () => ({...fresh, latitude: 200})});
  assert.equal(await refreshLocationForPrompt("Find somewhere nearby", invalid.options), "failed");
  assert.deepEqual(invalid.persisted, []);
});
