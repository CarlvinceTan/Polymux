import assert from "node:assert/strict";
import { test } from "node:test";
import { preferredModel } from "./model-selection.js";

test("preferredModel keeps the last selected model when it is available", () => {
  const models = [
    { provider: "openai", id: "new" },
    { provider: "anthropic", id: "last" },
  ];
  assert.deepEqual(
    preferredModel(models, { provider: "anthropic", id: "last" }),
    models[1],
  );
});

test("preferredModel falls back to the first model when the selection is stale", () => {
  const models = [
    { provider: "openai", id: "first" },
    { provider: "openai", id: "second" },
  ];
  assert.deepEqual(
    preferredModel(models, { provider: "anthropic", id: "missing" }),
    models[0],
  );
  assert.equal(
    preferredModel([], { provider: "openai", id: "missing" }),
    undefined,
  );
});
