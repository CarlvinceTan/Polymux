import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldBoundGoalContinuation,
  shouldResumePausedGoal,
  shouldUseGoalProgressContext,
} from "./goal-intent.js";

const objective = "Get exchange-ready over the next week and track remaining preparation tasks";

test("resumes a paused goal when continuation names its subject", () => {
  assert.equal(shouldResumePausedGoal("Continue the exchange preparation", objective), true);
  assert.equal(shouldResumePausedGoal("Resume the goal", objective), true);
  assert.equal(shouldResumePausedGoal("Carry on where we left off", objective), true);
});

test("subject-aware resume generalises across unrelated personal-assistant work", () => {
  const cases = [
    ["Continue the application shortlist", "Shortlist graduate software applications in Singapore"],
    ["Resume planning the Kyoto itinerary", "Plan a Kyoto itinerary and track bookings"],
    ["Keep going with the invoice reconciliation", "Reconcile supplier invoices and record discrepancies"],
    ["Carry on with the accessibility audit", "Audit desktop accessibility and repair confirmed issues"],
  ];
  for (const [text, goal] of cases)
    assert.equal(shouldResumePausedGoal(text, goal), true, text);
});

test("does not resume for a different continuation or incidental overlap", () => {
  assert.equal(shouldResumePausedGoal("Continue editing the video", objective), false);
  assert.equal(shouldResumePausedGoal("Continue the job application", objective), false);
  assert.equal(shouldResumePausedGoal("Resume downloading the file", objective), false);
  assert.equal(shouldResumePausedGoal("What remains for exchange?", objective), false);
  assert.equal(shouldResumePausedGoal("For now, just handle the urgent item", objective), false);
});

test("bounds broad goal continuation but respects an explicit finish-all request", () => {
  const objective = "Prepare for exchange and track every remaining item";
  assert.equal(shouldBoundGoalContinuation("Continue the exchange preparation", objective), true);
  assert.equal(shouldBoundGoalContinuation("Resume the goal", objective), true);
  assert.equal(shouldBoundGoalContinuation("Continue until it is finished", objective), false);
  assert.equal(shouldBoundGoalContinuation("Finish the whole exchange goal", objective), false);
  assert.equal(shouldBoundGoalContinuation("Complete all remaining exchange items", objective), false);
});

test("goal progress context follows subject overlap and deictic manager instructions", () => {
  const objective = "Get ready for NUS exchange and complete the urgent prerequisites";
  assert.equal(shouldUseGoalProgressContext("Continue the exchange preparation", objective), true);
  assert.equal(shouldUseGoalProgressContext("For now, just handle the most urgent item", objective), true);
  assert.equal(shouldUseGoalProgressContext("Handle the urgent supplier email", objective), false);
  assert.equal(shouldUseGoalProgressContext("What is two plus two?", objective), false);
});
