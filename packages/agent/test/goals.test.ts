import assert from "node:assert/strict";
import { test } from "node:test";
import { SqliteStorage } from "@polymux/storage/sqlite";
import { GoalManager } from "../src/index.js";

test("persists one unfinished goal and supports pause, resume, completion, and replacement", () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Goal" });
    const manager = new GoalManager(storage);
    const created = manager.execute("conversation", {
      action: "create",
      objective: "Ship it",
    });
    assert.equal(created?.status, "active");
    assert.throws(
      () =>
        manager.execute("conversation", {
          action: "create",
          objective: "Replace it",
        }),
      /unfinished/,
    );
    assert.equal(
      manager.execute("conversation", { action: "pause" })?.status,
      "paused",
    );
    assert.equal(
      manager.execute("conversation", { action: "resume" })?.status,
      "active",
    );
    storage.updateGoal("conversation", { status: "completed" });
    assert.equal(
      manager.execute("conversation", { action: "create", objective: "Next" })
        ?.objective,
      "Next",
    );
  } finally {
    storage.close();
  }
});
