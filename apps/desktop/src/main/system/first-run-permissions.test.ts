import assert from "node:assert/strict";
import test from "node:test";
import type {SystemPermissionKind, SystemPermissionStatus} from "@polymux/protocol";
import {FirstRunPermissions, type PermissionPreferenceStore} from "./first-run-permissions.js";

test("immediately requests every enabled built-in permission in sequence", async () => {
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
    enabled: () => true,
    status: (permission) => statuses.get(permission)!,
    request: async (permission) => {
      events.push(permission);
      statuses.set(permission, "granted");
      return "granted";
    },
    onReady: () => events.push("ready"),
  });

  const first = await manager.ensure();
  assert.deepEqual(events, [
    "microphone",
    "screen-recording",
    "accessibility",
    "full-disk-access",
    "saved",
    "ready",
  ]);
  assert.deepEqual(first, {
    firstRun: true,
    microphone: "granted",
    screenRecording: "granted",
  });

  events.length = 0;
  const later = await manager.ensure();
  assert.deepEqual(events, ["ready"]);
  assert.equal(later.firstRun, false);
});

test("reports what is granted rather than what it just asked for", async () => {
  const store: PermissionPreferenceStore = {
    getPreference: () => ({value: true}),
    setPreference: () => undefined,
  };
  const manager = new FirstRunPermissions({
    store,
    enabled: () => true,
    status: (permission) => permission === "microphone" ? "granted" : "denied",
    request: async () => {
      throw new Error("a completed first run must not ask again");
    },
    onReady: () => undefined,
  });

  const result = await manager.ensure();
  assert.equal(result.microphone, "granted");
  assert.equal(result.screenRecording, "denied");
});

test("does not request a built-in capability switched off in Polymux", async () => {
  const requested: SystemPermissionKind[] = [];
  const manager = new FirstRunPermissions({
    store: {
      getPreference: () => null,
      setPreference: () => undefined,
    },
    enabled: (permission) => permission !== "screen-recording",
    status: () => "denied",
    request: async (permission) => {
      requested.push(permission);
      return "denied";
    },
    onReady: () => undefined,
  });

  await manager.ensure();
  assert.deepEqual(requested, [
    "microphone",
    "accessibility",
    "full-disk-access",
  ]);
});
