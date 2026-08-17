import assert from "node:assert/strict";
import test from "node:test";
import {sessionScopedSnapshot} from "./snapshot.js";

/**
 * The drawer-openness rule: a workspace snapshot restores its tabs always,
 * but `open` only survives within the app run that saved it. Reopening an
 * archived chat after a relaunch must not fling the drawer open.
 */

const snapshot = {
  tabs: [{id: "t1", title: "Hub", kind: "hub"}],
  activeTabId: "t1",
  open: true,
};

test("the same run restores the drawer exactly as left", () => {
  const restored = sessionScopedSnapshot({...snapshot, bootId: "run-1"}, "run-1");
  assert.equal(restored?.open, true);
  assert.deepEqual(restored?.tabs, snapshot.tabs);
  assert.equal(restored?.activeTabId, "t1");
});

test("a later run keeps the tabs but starts with the drawer closed", () => {
  const restored = sessionScopedSnapshot({...snapshot, bootId: "run-1"}, "run-2");
  assert.equal(restored?.open, false, "drawer openness must not survive a quit");
  assert.deepEqual(restored?.tabs, snapshot.tabs, "the layout itself must survive");
  assert.equal(restored?.activeTabId, "t1");
});

test("snapshots from before the boot id existed behave like a previous run", () => {
  const restored = sessionScopedSnapshot(snapshot, "run-2");
  assert.equal(restored?.open, false);
  assert.deepEqual(restored?.tabs, snapshot.tabs);
});

test("garbage in storage restores nothing rather than throwing", () => {
  assert.equal(sessionScopedSnapshot(null, "run-1"), null);
  assert.equal(sessionScopedSnapshot("not-an-object", "run-1"), null);
  assert.equal(sessionScopedSnapshot([1, 2], "run-1"), null);
});
