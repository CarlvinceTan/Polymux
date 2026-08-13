import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGoalCommand, validateStartRun } from "../src/index.js";

test("validates renderer run requests at the Electron boundary", () => {
  assert.deepEqual(validateStartRun({ conversationId: "one", text: "hello" }), {
    conversationId: "one",
    text: "hello",
    messageId: undefined,
    attachments: undefined,
    asGoal: undefined,
  });
  assert.equal(
    validateStartRun({ conversationId: "one", text: "ship it", asGoal: true })
      .asGoal,
    true,
  );
  assert.throws(
    () => validateStartRun({ conversationId: "", text: "hello" }),
    /conversationId/,
  );
});

test("requires an objective when creating or updating a goal", () => {
  assert.equal(
    validateGoalCommand({ conversationId: "one", action: "pause" }).action,
    "pause",
  );
  assert.throws(
    () => validateGoalCommand({ conversationId: "one", action: "create" }),
    /objective/,
  );
  assert.throws(
    () => validateGoalCommand({ conversationId: "one", action: "update" }),
    /objective/,
  );
});
