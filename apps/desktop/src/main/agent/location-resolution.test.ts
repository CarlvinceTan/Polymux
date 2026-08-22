import assert from "node:assert/strict";
import test from "node:test";
import {createCurrentLocationResolutionTool} from "./location-resolution.js";

test("location resolution prefers schema guidance without requiring provider constrained sampling", () => {
  const tool = createCurrentLocationResolutionTool({
    current: () => ({enabled: false, location: null}),
    resolve: async () => ({locality: "unused", source: "unused"}),
  });
  assert.equal(tool.strict, "prefer");
});

const now = Date.parse("2026-08-21T02:05:00.000Z");
const precise = {latitude: 1.2966, longitude: 103.7764, accuracy: 50, updatedAt: "2026-08-21T02:00:00.000Z"};
const context = {runId: "run", turn: 1, callId: "call", signal: new AbortController().signal, async emitProgress() {}};

test("resolves a fresh precise fix without exposing coordinates", async () => {
  let calls = 0;
  const tool = createCurrentLocationResolutionTool({
    current: () => ({enabled: true, location: precise}),
    now: () => now,
    resolve: async () => (calls++, {locality: "Kent Ridge", region: "Singapore", country: "Singapore", source: "test resolver"}),
  });
  const first = JSON.parse(String((await tool.execute({}, context)).content));
  const second = JSON.parse(String((await tool.execute({}, context)).content));
  assert.equal(first.status, "resolved");
  assert.equal(first.locality, "Kent Ridge");
  assert.equal(JSON.stringify(first).includes("1.2966"), false);
  assert.equal(calls, 1, "the same captured fix is resolved once");
  assert.deepEqual(second, first);
});

test("refuses disabled, stale, future, and coarse fixes before external resolution", async () => {
  let calls = 0;
  const execute = async (enabled: boolean, location: typeof precise | null) => {
    const tool = createCurrentLocationResolutionTool({
      current: () => ({enabled, location}),
      now: () => now,
      resolve: async () => (calls++, {locality: "wrong", source: "test"}),
    });
    return JSON.parse(String((await tool.execute({}, context)).content));
  };
  assert.equal((await execute(false, precise)).status, "disabled");
  assert.equal((await execute(true, null)).status, "unavailable");
  assert.equal((await execute(true, {...precise, updatedAt: "2026-08-21T01:00:00.000Z"})).status, "stale");
  assert.equal((await execute(true, {...precise, updatedAt: "2026-08-21T02:07:00.000Z"})).status, "stale");
  assert.equal((await execute(true, {...precise, accuracy: 25_000})).status, "too_coarse");
  assert.equal(calls, 0);
});

test("resolver failure degrades to explicit unavailable state", async () => {
  const tool = createCurrentLocationResolutionTool({
    current: () => ({enabled: true, location: precise}),
    now: () => now,
    resolve: async () => { throw new Error("offline"); },
  });
  const result = JSON.parse(String((await tool.execute({}, context)).content));
  assert.equal(result.status, "unavailable");
  assert.match(result.guidance, /do not guess/i);
});
