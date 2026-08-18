import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { flareaiDirectoryName, flareaiHome, flareaiPath } from "./paths.js";

const original = process.env.FLAREAI_DEV_INSTANCE;
afterEach(() => {
  if (original === undefined) delete process.env.FLAREAI_DEV_INSTANCE;
  else process.env.FLAREAI_DEV_INSTANCE = original;
});

test("the ordinary run owns ~/.flareai", () => {
  delete process.env.FLAREAI_DEV_INSTANCE;
  assert.equal(flareaiDirectoryName(), ".flareai");
  assert.equal(flareaiHome("/home/u"), "/home/u/.flareai");
  assert.equal(flareaiPath("skills"), path.join(homedir(), ".flareai", "skills"));
});

test("a side instance keeps its configuration out of the user's", () => {
  process.env.FLAREAI_DEV_INSTANCE = "review";
  assert.equal(flareaiHome("/home/u"), "/home/u/.flareai-review");
  assert.equal(flareaiPath("mcp.json"), path.join(homedir(), ".flareai-review", "mcp.json"));
});

test("an empty or whitespace instance name is not an instance", () => {
  process.env.FLAREAI_DEV_INSTANCE = "  ";
  assert.equal(flareaiHome("/home/u"), "/home/u/.flareai");
});
