import assert from "node:assert/strict";
import test from "node:test";
import {FirstRunPermissions} from "./first-run-permissions.js";

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
