import assert from "node:assert/strict";
import { test } from "node:test";
import { channels } from "../src/index.js";

test("publishes no Polymux account get, sign-out, or change channel", () => {
  const names = Object.keys(channels);
  assert.equal(names.includes("accountGet"), false);
  assert.equal(names.includes("accountSignOut"), false);
  assert.equal(names.includes("accountChanged"), false);
  const values = Object.values(channels);
  assert.equal(values.includes("polymux:account:get"), false);
  assert.equal(values.includes("polymux:account:sign-out"), false);
  assert.equal(values.includes("polymux:account:changed"), false);
});
