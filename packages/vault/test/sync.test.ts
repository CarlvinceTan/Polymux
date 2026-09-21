import assert from "node:assert/strict";
import {test} from "node:test";
import {planSync} from "../src/sync.js";

const local = {
  revision: 2,
  updatedAt: "2026-09-07T10:00:00.000Z",
  checksum: "aaa",
  dirty: false,
  lastSyncedAt: "2026-09-07T09:00:00.000Z",
};

test("an empty pair does nothing", () => {
  assert.equal(planSync(null, null).action, "noop");
});

test("a local-only vault uploads", () => {
  assert.equal(planSync({...local, lastSyncedAt: null}, null).action, "push");
});

test("a cloud-only vault downloads", () => {
  assert.equal(planSync(null, local).action, "pull");
});

test("first account link prefers the cloud vault", () => {
  const plan = planSync({...local, lastSyncedAt: null, dirty: true, revision: 1}, {
    ...local,
    revision: 8,
    checksum: "cloud",
  });
  assert.equal(plan.action, "pull");
  assert.equal(plan.reason, "first-link");
});

test("a newer remote revision downloads when local is clean", () => {
  assert.equal(planSync(local, {...local, revision: 5, checksum: "bbb"}).action, "pull");
});

test("a newer local revision uploads", () => {
  assert.equal(planSync({...local, revision: 4, dirty: true}, local).action, "push");
});

test("matching checksums stay put", () => {
  assert.equal(planSync(local, local).action, "noop");
});

test("a dirty same-revision vault uploads", () => {
  assert.equal(
    planSync({...local, dirty: true, checksum: "local"}, {...local, checksum: "cloud"}).action,
    "push",
  );
});
