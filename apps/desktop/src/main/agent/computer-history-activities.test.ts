import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, test} from "node:test";
import {ComputerHistoryStore, textSignature} from "@polymux/computer";
import type {InferenceService} from "@polymux/inference";
import {ComputerHistoryActivities, buildActivities} from "./computer-history-activities.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true});
});

function directory(): string {
  const value = mkdtempSync(path.join(tmpdir(), "polymux-activities-"));
  directories.push(value);
  return value;
}

function save(store: ComputerHistoryStore, at: string, app: string, title: string) {
  const text = `# ${app} — ${title}\n\nVisible work about ${title}`;
  return store.save({
    sourceId: `ax-${app}`,
    sourceName: `${app} — ${title}`,
    displayId: null,
    width: 0,
    height: 0,
    image: new TextEncoder().encode(text),
    signature: textSignature(text),
    kind: "text",
    app,
  }, new Date(at), 1, "initial");
}

test("groups captures and interactions into ten-minute activity windows", () => {
  const store = new ComputerHistoryStore(directory());
  const first = save(store, "2026-08-27T12:01:00.000Z", "ChatGPT", "Polymux UI review");
  const second = save(store, "2026-08-27T12:09:00.000Z", "Zed", "SettingsPage.svelte");
  const third = save(store, "2026-08-27T12:11:00.000Z", "Mail", "Signatures");
  const activities = buildActivities([third, second, first], [{
    at: "2026-08-27T12:08:00.000Z",
    kind: "click",
    app: "ChatGPT",
    target: "Composer",
  }]);
  assert.equal(activities.length, 2);
  assert.deepEqual(activities[1]?.entries.map((entry) => entry.id), [first.id, second.id]);
  assert.deepEqual(activities[1]?.apps, ["ChatGPT", "Zed"]);
  assert.equal(activities[1]?.interactions.length, 1);
});

test("stores model-written activity summaries and returns raw captures only as evidence ids", async () => {
  const store = new ComputerHistoryStore(directory());
  const entry = save(store, "2026-08-27T12:01:00.000Z", "ChatGPT", "Polymux UI review");
  const inference: InferenceService = {
    listModels: () => [],
    getModel: () => undefined,
    listAvailableModels: async () => [],
    async *stream() {
      yield {
        type: "done",
        reason: "stop",
        message: {
          role: "assistant",
          content: [{
            type: "text",
            text: '[{"id":"2026-08-27T12:00:00.000Z","title":"Polymux history redesign","summary":"You compared Polymux history with a semantic activity timeline and refined the presentation."}]',
          }],
          usage: {inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2, costUsd: 0},
          stopReason: "stop",
        },
      };
    },
  };
  const activities = new ComputerHistoryActivities({
    store,
    inference,
    clock: () => new Date("2026-08-27T12:20:00.000Z"),
  });
  const result = await activities.list({model: {provider: "test", id: "test"}});
  assert.equal(result[0]?.title, "Polymux history redesign");
  assert.equal(result[0]?.summarized, true);
  assert.deepEqual(result[0]?.entryIds, [entry.id]);
  assert.doesNotMatch(JSON.stringify(result[0]), /0×0|Visible work/);
  assert.match(readFileSync(path.join(store.directory, "activities.json"), "utf8"), /Polymux history redesign/);
});

test("falls back to a readable activity when inference is unavailable", async () => {
  const store = new ComputerHistoryStore(directory());
  save(store, "2026-08-27T12:01:00.000Z", "Mail", "Signatures");
  const inference: InferenceService = {
    listModels: () => [],
    getModel: () => undefined,
    listAvailableModels: async () => [],
    async *stream() {
      yield {type: "error", error: {code: "auth", message: "No key", retryable: false}};
    },
  };
  const activities = new ComputerHistoryActivities({
    store,
    inference,
    clock: () => new Date("2026-08-27T12:20:00.000Z"),
  });
  const result = await activities.list({model: {provider: "test", id: "test"}});
  assert.equal(result[0]?.title, "Signatures");
  assert.equal(result[0]?.summary, "Your activity centred on Signatures across Mail.");
  assert.equal(result[0]?.summarized, false);
});

test("fallback summaries identify topics across apps without repeating app activity", async () => {
  const store = new ComputerHistoryStore(directory());
  save(store, "2026-08-27T12:01:00.000Z", "ChatGPT", "Computer History comparison");
  save(store, "2026-08-27T12:04:00.000Z", "Polymux", "Memory settings");
  save(store, "2026-08-27T12:07:00.000Z", "Zed", "SettingsPage.svelte");
  const inference: InferenceService = {
    listModels: () => [],
    getModel: () => undefined,
    listAvailableModels: async () => [],
    async *stream() {
      yield {type: "error", error: {code: "auth", message: "No key", retryable: false}};
    },
  };
  const activities = new ComputerHistoryActivities({
    store,
    inference,
    clock: () => new Date("2026-08-27T12:20:00.000Z"),
  });
  const result = await activities.list({model: {provider: "test", id: "test"}});
  assert.equal(
    result[0]?.summary,
    "Your activity centred on Computer History comparison, Memory settings, and SettingsPage.svelte across ChatGPT, Polymux, and Zed.",
  );
  assert.doesNotMatch(result[0]?.summary ?? "", /worked in|working on/i);
});

test("does not repeat an app name as both the topic and app context", async () => {
  const store = new ComputerHistoryStore(directory());
  save(store, "2026-08-27T12:01:00.000Z", "ChatGPT", "ChatGPT");
  const inference: InferenceService = {
    listModels: () => [],
    getModel: () => undefined,
    listAvailableModels: async () => [],
    async *stream() {
      yield {type: "error", error: {code: "auth", message: "No key", retryable: false}};
    },
  };
  const activities = new ComputerHistoryActivities({
    store,
    inference,
    clock: () => new Date("2026-08-27T12:20:00.000Z"),
  });
  const result = await activities.list({model: {provider: "test", id: "test"}});
  assert.equal(result[0]?.summary, "You used ChatGPT during this period.");
});
