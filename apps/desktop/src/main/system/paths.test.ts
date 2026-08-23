import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { polymuxDirectoryName, polymuxHome, polymuxPath } from "./paths.js";

const original = process.env.POLYMUX_DEV_INSTANCE;
afterEach(() => {
  if (original === undefined) delete process.env.POLYMUX_DEV_INSTANCE;
  else process.env.POLYMUX_DEV_INSTANCE = original;
});

test("the ordinary run owns ~/.polymux", () => {
  delete process.env.POLYMUX_DEV_INSTANCE;
  assert.equal(polymuxDirectoryName(), ".polymux");
  assert.equal(polymuxHome("/home/u"), "/home/u/.polymux");
  assert.equal(polymuxPath("skills"), path.join(homedir(), ".polymux", "skills"));
});

test("a side instance keeps its configuration out of the user's", () => {
  process.env.POLYMUX_DEV_INSTANCE = "review";
  assert.equal(polymuxHome("/home/u"), "/home/u/.polymux-review");
  assert.equal(polymuxPath("mcp.json"), path.join(homedir(), ".polymux-review", "mcp.json"));
});

test("an empty or whitespace instance name is not an instance", () => {
  process.env.POLYMUX_DEV_INSTANCE = "  ";
  assert.equal(polymuxHome("/home/u"), "/home/u/.polymux");
});
