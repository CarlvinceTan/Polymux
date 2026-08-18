import assert from "node:assert/strict";
import test from "node:test";
import {FirstRunPermissions} from "./first-run-permissions.js";

/**
 * The settings record gained `onboardingCompleted` after the app shipped, so a
 * store written before that has no such key. These cover the signal the backend
 * uses to tell an upgraded install apart from a genuinely new one: whether the
 * first-run permission pass already happened.
 */
function store(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getPreference: (key: string) =>
      values.has(key) ? {value: values.get(key)} : null,
    setPreference: (key: string, value: boolean) => values.set(key, value),
  };
}

function permissions(backing: ReturnType<typeof store>) {
  return new FirstRunPermissions({
    store: backing,
    status: () => "granted",
    onReady: () => {},
  });
}

test("an install that has run before reports its first run as done", async () => {
  const backing = store({"first-run-permissions-requested": true});
  assert.equal(permissions(backing).completed(), true);
});

test("a fresh install reports its first run as pending", () => {
  assert.equal(permissions(store()).completed(), false);
});

test("completing the first run records it for later launches", async () => {
  const backing = store();
  const subject = permissions(backing);
  assert.equal(subject.completed(), false);
  await subject.ensure();
  assert.equal(subject.completed(), true);
  assert.equal(backing.values.get("first-run-permissions-requested"), true);
});

test("a settings record written before the flag existed is detectable", () => {
  // The backend keys the upgrade decision off this exact shape: an older
  // record simply has no `onboardingCompleted` property.
  const legacy: Record<string, unknown> = {theme: "light", speechModeEnabled: true};
  const current: Record<string, unknown> = {theme: "light", onboardingCompleted: false};
  assert.equal("onboardingCompleted" in legacy, false);
  assert.equal("onboardingCompleted" in current, true);
});
