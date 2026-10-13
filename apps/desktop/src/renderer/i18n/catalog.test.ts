import assert from "node:assert/strict";
import { test } from "node:test";
import en from "./locales/en.ts";

test("ships no Polymux account copy", () => {
  const keys = Object.keys(en).filter((key) => key.startsWith("account."));
  assert.deepEqual(keys, []);
});

test("ships no OneDrive storage blurb", () => {
  assert.equal("drive.about.onedrive" in en, false);
});
