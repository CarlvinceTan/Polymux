import assert from "node:assert/strict";
import test from "node:test";
import {speechModeAfterRoleChange} from "./speech-mode.js";

test("assigning and clearing the speech model supply automatic speech-mode values", () => {
  assert.equal(speechModeAfterRoleChange("speech", true, false), true);
  assert.equal(speechModeAfterRoleChange("speech", false, true), false);
});

test("other model roles preserve the user's speech-mode choice", () => {
  assert.equal(speechModeAfterRoleChange("subagent", true, false), false);
  assert.equal(speechModeAfterRoleChange("image", false, true), true);
});
