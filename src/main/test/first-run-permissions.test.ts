import assert from "node:assert/strict";
import test from "node:test";
import type {SystemPermissionKind, SystemPermissionStatus} from "@midas/protocol";
import {FirstRunPermissions, type PermissionPreferenceStore} from "../first-run-permissions.js";

test("requests enabled OS permissions once and in sequence", async () => {
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
    microphoneEnabled: () => true,
    screenRecordingEnabled: () => true,
    status: (permission) => statuses.get(permission)!,
    request: async (permission) => {
      events.push(permission);
      statuses.set(permission, "granted");
      return "granted";
    },
    onReady: () => events.push("ready"),
  });

  const first = await manager.ensure();
  assert.deepEqual(events, ["microphone", "screen-recording", "saved", "ready"]);
  assert.deepEqual(first, {firstRun: true, microphone: "granted", screenRecording: "granted"});

  events.length = 0;
  const later = await manager.ensure();
  assert.deepEqual(events, ["ready"]);
  assert.equal(later.firstRun, false);
});

test("skips permission prompts for disabled first-run features", async () => {
  const requested: SystemPermissionKind[] = [];
  const store: PermissionPreferenceStore = {
    getPreference: () => null,
    setPreference: () => undefined,
  };
  const manager = new FirstRunPermissions({
    store,
    microphoneEnabled: () => false,
    screenRecordingEnabled: () => false,
    status: () => "not-determined",
    request: async (permission) => { requested.push(permission); return "granted"; },
    onReady: () => undefined,
  });

  await manager.ensure();
  assert.deepEqual(requested, []);
});
