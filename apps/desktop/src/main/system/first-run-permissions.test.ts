import assert from "node:assert/strict";
import test from "node:test";
import type {SystemPermissionKind, SystemPermissionStatus} from "@flareai/protocol";
import {FirstRunPermissions, type PermissionPreferenceStore} from "./first-run-permissions.js";

test("marks first run done, starts what waits on it, and asks macOS for nothing", async () => {
  const preferences = new Map<string, unknown>();
  const events: string[] = [];
  const store: PermissionPreferenceStore = {
    getPreference: (key) => preferences.has(key) ? {value: preferences.get(key)} : null,
    setPreference: (key, value) => { preferences.set(key, value); events.push("saved"); },
  };
  const statuses = new Map<SystemPermissionKind, SystemPermissionStatus>([
    ["microphone", "not-determined"],
    ["screen-recording", "not-determined"],
  ]);
  const manager = new FirstRunPermissions({
    store,
    status: (permission) => statuses.get(permission)!,
    onReady: () => events.push("ready"),
  });

  const first = await manager.ensure();
  // No permission name among the events: this runs at launch, and a consent
  // dialog raised here is one the user did nothing to invite.
  assert.deepEqual(events, ["saved", "ready"]);
  assert.deepEqual(first, {
    firstRun: true,
    microphone: "not-determined",
    screenRecording: "not-determined",
  });

  events.length = 0;
  const later = await manager.ensure();
  assert.deepEqual(events, ["ready"]);
  assert.equal(later.firstRun, false);
});

test("reports what is granted rather than what it just asked for", async () => {
  const store: PermissionPreferenceStore = {
    getPreference: () => null,
    setPreference: () => undefined,
  };
  const manager = new FirstRunPermissions({
    store,
    status: (permission) => permission === "microphone" ? "granted" : "denied",
    onReady: () => undefined,
  });

  const result = await manager.ensure();
  assert.equal(result.microphone, "granted");
  assert.equal(result.screenRecording, "denied");
});
