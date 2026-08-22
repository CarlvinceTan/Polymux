import assert from "node:assert/strict";
import {test} from "node:test";
import type {InferenceMessage} from "@flareai/inference";
import {SqliteStorage} from "@flareai/storage/sqlite";
import {
  goalProgressPrompt,
  readGoalProgress,
  recordGoalProgress,
} from "../src/goals/progress-receipts.js";

function trace(query: string): InferenceMessage[] {
  return [{
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "mail",
        name: "email_list",
        arguments: {
          account: "personal",
          query,
          password: "must-not-survive",
          token: "must-not-survive",
        },
      },
      {
        type: "toolCall",
        id: "browser",
        name: "browser_open",
        arguments: {url: "https://example.test/status", cookie: "private"},
      },
      {type: "toolCall", id: "wait", name: "wait_subagent", arguments: {}},
    ],
  }];
}

test("goal receipts preserve useful evidence scope without credentials", () => {
  const storage = new SqliteStorage(":memory:");
  recordGoalProgress(
    storage,
    "goal-1",
    "Check the urgent application",
    "The application remains blocked on a user-only login.",
    trace("subject:application newer:7d"),
    "2026-08-22T04:00:00.000Z",
  );

  const receipts = readGoalProgress(storage, "goal-1");
  assert.equal(receipts.length, 1);
  assert.deepEqual(receipts[0].evidence, [
    'browser_open(url="https://example.test/status")',
    'email_list(account="personal", query="subject:application newer:7d")',
  ]);
  const rendered = goalProgressPrompt(receipts);
  assert.match(rendered, /unresolved delta/);
  assert.match(rendered, /subject:application/);
  assert.doesNotMatch(rendered, /must-not-survive|password|token|cookie/);
  storage.close();
});

test("goal receipts are bounded per goal and isolated from ordinary work", () => {
  const storage = new SqliteStorage(":memory:");
  for (let index = 0; index < 10; index++)
    recordGoalProgress(
      storage,
      "goal-a",
      `Task ${index}`,
      `Result ${index}`,
      trace(`query-${index}`),
      `2026-08-22T04:00:${String(index).padStart(2, "0")}.000Z`,
    );

  const kept = readGoalProgress(storage, "goal-a");
  assert.equal(kept.length, 8);
  assert.equal(kept[0].description, "Task 2");
  assert.equal(kept.at(-1)?.description, "Task 9");
  assert.deepEqual(readGoalProgress(storage, "goal-b"), []);
  assert.equal(goalProgressPrompt([]), "");
  storage.close();
});

test("repeating the same evidence route refreshes instead of filling the receipt window", () => {
  const storage = new SqliteStorage(":memory:");
  recordGoalProgress(storage, "goal", "Check status", "Old", trace("status"), "2026-08-21T00:00:00.000Z");
  recordGoalProgress(storage, "goal", "Check status", "New", trace("status"), "2026-08-22T00:00:00.000Z");
  const receipts = readGoalProgress(storage, "goal");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].result, "New");
  assert.equal(receipts[0].completedAt, "2026-08-22T00:00:00.000Z");
  storage.close();
});
