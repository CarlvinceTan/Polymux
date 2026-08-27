import assert from "node:assert/strict";
import test from "node:test";
import { DEV_BUNDLE_ID, devIconResourceName } from "./dev-bundle-identity.mjs";

test("the development bundle has an identity distinct from stock Electron", () => {
  assert.equal(DEV_BUNDLE_ID, "com.flarehq.polymux.dev");
  assert.notEqual(DEV_BUNDLE_ID, "com.github.Electron");
});

test("the development icon resource name changes with its contents", () => {
  const first = devIconResourceName(Buffer.from("first icon"));
  const second = devIconResourceName(Buffer.from("second icon"));

  assert.match(first, /^polymux-[0-9a-f]{12}\.icns$/);
  assert.notEqual(first, second);
  assert.equal(first, devIconResourceName(Buffer.from("first icon")));
});
