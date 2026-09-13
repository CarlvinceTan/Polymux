import assert from "node:assert/strict";
import test from "node:test";
import {leasedPreviewSource} from "./preview.js";
import type {WindowControlLease} from "./leases.js";

const lease = (owner: string, windowId: string, acquiredAt = 1): WindowControlLease => ({
  appId: "com.example.app",
  windowId,
  scope: "window",
  owner,
  acquiredAt,
  expiresAt: Date.now() / 1_000 + 60,
});

test("matches only the exact native window leased by the requested run", () => {
  const sources = [{id: "window:19:0"}, {id: "window:42:0"}];
  assert.equal(leasedPreviewSource([
    lease("other-run", "cg-19:Other"),
    lease("run-1", "cg-42:Target"),
  ], sources, "run-1")?.id, "window:42:0");
});

test("does not fall back to another run or a malformed window identity", () => {
  const sources = [{id: "window:19:0"}];
  assert.equal(leasedPreviewSource([lease("other-run", "cg-19")], sources, "run-1"), null);
  assert.equal(leasedPreviewSource([lease("run-1", "window-19")], sources, "run-1"), null);
});
