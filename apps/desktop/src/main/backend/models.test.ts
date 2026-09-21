import assert from "node:assert/strict";
import { test } from "node:test";
import { preferredModel } from "./model-selection.js";
import { customProviderPreference, isReasoningModelId } from "./models.js";

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

test("isReasoningModelId recognizes reasoning model conventions", () => {
  assert.equal(isReasoningModelId("deepseek-r1"), true);
  assert.equal(isReasoningModelId("deepseek-r1:8b"), true);
  assert.equal(isReasoningModelId("deepseek-ai/DeepSeek-R1"), true);
  assert.equal(isReasoningModelId("qwq-32b"), true);
  assert.equal(isReasoningModelId("o1"), true);
  assert.equal(isReasoningModelId("o1-mini"), true);
  assert.equal(isReasoningModelId("o3-mini"), true);
  assert.equal(isReasoningModelId("o4-mini"), true);
  assert.equal(isReasoningModelId("local-reasoner"), true);
  assert.equal(isReasoningModelId("model-with-thinking"), true);

  assert.equal(isReasoningModelId("gpt-4o"), false);
  assert.equal(isReasoningModelId("llama-3.3-70b"), false);
  assert.equal(isReasoningModelId("qwen2.5-coder"), false);
});

test("customProviderPreference parses and preserves reasoning flag", () => {
  const configs = customProviderPreference([
    {
      id: "custom-test",
      name: "Custom Test",
      baseUrl: "https://api.test.com/v1",
      models: [
        {
          id: "deepseek/deepseek-v4.1-flash",
          name: "DeepSeek V4.1 Flash",
          reasoning: true,
        },
        { id: "gpt-4o", name: "GPT 4o", reasoning: false },
        { id: "deepseek-r1", name: "DeepSeek R1" },
      ],
    },
  ]);
  assert.equal(configs.length, 1);
  assert.equal(configs[0]?.models[0]?.reasoning, true);
  assert.equal(configs[0]?.models[1]?.reasoning, false);
  assert.equal(configs[0]?.models[2]?.reasoning, undefined);
});
