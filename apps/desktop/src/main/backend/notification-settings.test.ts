import assert from "node:assert/strict";
import {test} from "node:test";
import {
  DEFAULT_NOTIFICATION_SWITCHES,
  notificationSwitches,
  notificationSwitchesUpdate,
} from "./notification-settings.js";

test("every kind starts switched on", () => {
  assert.deepEqual(notificationSwitches(undefined), DEFAULT_NOTIFICATION_SWITCHES);
  assert.deepEqual(notificationSwitches(null), DEFAULT_NOTIFICATION_SWITCHES);
  assert.deepEqual(notificationSwitches([]), DEFAULT_NOTIFICATION_SWITCHES);
});

test("a stored choice is read back, and a kind added since is defaulted on", () => {
  const stored = notificationSwitches({"schedule-failed": false, "message-received": false});
  assert.equal(stored["schedule-failed"], false);
  assert.equal(stored["message-received"], false);
  assert.equal(stored["agent-completed"], true);
});

test("unknown keys and non-booleans are dropped rather than stored", () => {
  const stored = notificationSwitches({nonsense: false, "agent-completed": "no"});
  assert.deepEqual(stored, DEFAULT_NOTIFICATION_SWITCHES);
});

test("an update patches the map rather than replacing it", () => {
  const current = notificationSwitches(undefined);
  const next = notificationSwitchesUpdate({"agent-attention": false}, current);
  assert.equal(next["agent-attention"], false);
  assert.equal(next["agent-completed"], true);
  assert.equal(current["agent-attention"], true, "the current map is not mutated");
});

test("an absent update leaves the map as it stands", () => {
  const current = notificationSwitches({"schedule-failed": false});
  assert.deepEqual(notificationSwitchesUpdate(undefined, current), current);
});

test("a bad key or value is named rather than ignored", () => {
  const current = notificationSwitches(undefined);
  assert.throws(() => notificationSwitchesUpdate({nonsense: true}, current), /notification kinds/);
  assert.throws(() => notificationSwitchesUpdate({"agent-completed": "yes"}, current), /notification kinds/);
  assert.throws(() => notificationSwitchesUpdate("off", current), /notification kinds/);
});
