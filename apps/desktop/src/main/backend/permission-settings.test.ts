import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PERMISSION_SWITCHES,
  permissionSwitches,
  permissionSwitchesUpdate,
} from "./permission-settings.js";

test("a stored switch is kept and every other permission starts on", () => {
  const stored = permissionSwitches({accessibility: false, telepathy: true});
  assert.deepEqual(stored, {...DEFAULT_PERMISSION_SWITCHES, accessibility: false});
});

test("settings written before a permission existed still switch it on", () => {
  assert.deepEqual(permissionSwitches({}), DEFAULT_PERMISSION_SWITCHES);
  assert.deepEqual(permissionSwitches(undefined), DEFAULT_PERMISSION_SWITCHES);
});

test("an update moves one switch and leaves the others alone", () => {
  const next = permissionSwitchesUpdate({microphone: false}, DEFAULT_PERMISSION_SWITCHES);
  assert.deepEqual(next, {...DEFAULT_PERMISSION_SWITCHES, microphone: false});
  assert.deepEqual(permissionSwitchesUpdate(undefined, next), next);
});

test("an unknown kind or a non-boolean is refused rather than stored", () => {
  assert.throws(
    () => permissionSwitchesUpdate({telepathy: true}, DEFAULT_PERMISSION_SWITCHES),
    /permission kinds/,
  );
  assert.throws(
    () => permissionSwitchesUpdate({microphone: "yes"}, DEFAULT_PERMISSION_SWITCHES),
    /permission kinds/,
  );
});
