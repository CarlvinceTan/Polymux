import assert from "node:assert/strict";
import { test } from "node:test";
import en from "./locales/en.ts";

test("ships no Polymux account copy", () => {
  const keys = Object.keys(en).filter((key) => key.startsWith("account."));
  assert.deepEqual(keys, []);
});

test("ships no storage blurb for a removed sign-in provider", () => {
  for (const key of ["drive.about.onedrive", "drive.about.googleDrive", "drive.about.dropbox"])
    assert.equal(key in en, false, key);
});
