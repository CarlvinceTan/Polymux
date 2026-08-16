import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { InferenceEvent, InferenceRequest } from "../src/types.js";
import { PiInference } from "../src/pi/pi-inference.js";

async function collect(
  iterable: AsyncIterable<InferenceEvent>,
): Promise<InferenceEvent[]> {
  const events: InferenceEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function fixture() {
  const faux = fauxProvider({
    provider: "test-provider",
    models: [{ id: "test-model", name: "Test Model", reasoning: true }],
    tokensPerSecond: 100_000,
  });
  const models = createModels();
  models.setProvider(faux.provider);
  return {
    faux,
    inference: new PiInference(models, { clock: () => 1_700_000_000_000 }),
  };
}

test("lists normalized model metadata", async () => {
  const { inference } = fixture();
  assert.deepEqual(
    inference
      .listModels()
      .map(({ provider, id, name, reasoning }) => ({
        provider,
        id,
        name,
        reasoning,
      })),
    [
      {
        provider: "test-provider",
        id: "test-model",
        name: "Test Model",
        reasoning: true,
      },
    ],
  );
  assert.equal(
    inference.getModel({ provider: "test-provider", id: "missing" }),
    null,
  );
  assert.equal((await inference.listAvailableModels()).length, 1);
});

test("normalizes text, reasoning, tool-call and final-message events", async () => {
  const { faux, inference } = fixture();
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxThinking("Inspect the request"),
        fauxText("I need a tool."),
        fauxToolCall("read_file", { path: "README.md" }, { id: "call-1" }),
      ],
      { stopReason: "toolUse", responseId: "response-1" },
    ),
  ]);

  const events = await collect(
    inference.stream({
      model: { provider: "test-provider", id: "test-model" },
      systemPrompt: "You are FlareAI.",
      messages: [{ role: "user", content: "Inspect it" }],
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          strict: "require",
        },
      ],
      reasoning: "medium",
    }),
  );

  assert.equal(events[0]?.type, "start");
  assert.ok(events.some((event) => event.type === "reasoningDelta"));
  assert.ok(events.some((event) => event.type === "textDelta"));
  const tool = events.find((event) => event.type === "toolCallEnd");
  assert.deepEqual(tool && "toolCall" in tool ? tool.toolCall : null, {
    type: "toolCall",
    id: "call-1",
    name: "read_file",
    arguments: { path: "README.md" },
    providerData: undefined,
  });
  const done = events.at(-1);
  assert.equal(done?.type, "done");
  if (done?.type === "done") {
    assert.equal(done.reason, "toolUse");
    assert.equal(done.message.responseId, "response-1");
    assert.equal(done.message.content[0]?.type, "reasoning");
  }
});

test("round-trips FlareAI context without exposing its types to the provider", async () => {
  const { faux, inference } = fixture();
  faux.setResponses([
    (context, options) => {
      assert.equal(context.systemPrompt, "Base prompt");
      assert.equal(context.messages[0]?.role, "assistant");
      assert.equal(context.messages[1]?.role, "toolResult");
      assert.equal(context.tools?.[0]?.name, "search");
      assert.equal(options?.temperature, 0.2);
      assert.equal(options?.maxTokens, 2048);
      return fauxAssistantMessage("continued");
    },
  ]);

  const request: InferenceRequest = {
    model: { provider: "test-provider", id: "test-model" },
    systemPrompt: "Base prompt",
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Earlier thought",
            providerData: { signature: "opaque-reasoning" },
          },
          {
            type: "toolCall",
            id: "call-1",
            name: "search",
            arguments: { query: "FlareAI" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "search",
        content: [{ type: "text", text: "result" }],
        isError: false,
      },
    ],
    tools: [
      { name: "search", description: "Search", parameters: { type: "object" } },
    ],
    temperature: 0.2,
    maxOutputTokens: 2048,
  };

  const events = await collect(inference.stream(request));
  assert.equal(events.at(-1)?.type, "done");
});

test("returns typed errors for unknown models and provider failures", async () => {
  const { faux, inference } = fixture();
  const missing = await collect(
    inference.stream({ model: { provider: "none", id: "none" }, messages: [] }),
  );
  assert.deepEqual(missing, [
    {
      type: "error",
      error: {
        code: "model_not_found",
        message: "Model not found: none/none",
        retryable: false,
        provider: "none",
        model: "none",
      },
    },
  ]);

  faux.setResponses([
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "429 rate limit exceeded",
    }),
  ]);
  const failed = await collect(
    inference.stream({
      model: { provider: "test-provider", id: "test-model" },
      messages: [],
    }),
  );
  const final = failed.at(-1);
  assert.equal(final?.type, "error");
  if (final?.type === "error") {
    assert.equal(final.error.code, "rate_limit");
    assert.equal(final.error.retryable, true);
  }
});

test("propagates cancellation as an aborted inference error", async () => {
  const { faux, inference } = fixture();
  faux.setResponses([
    fauxAssistantMessage("This response should be cancelled before it starts."),
  ]);
  const controller = new AbortController();
  controller.abort();
  const events = await collect(
    inference.stream({
      model: { provider: "test-provider", id: "test-model" },
      messages: [],
      signal: controller.signal,
    }),
  );
  const final = events.at(-1);
  assert.equal(final?.type, "error");
  if (final?.type === "error") assert.equal(final.error.code, "aborted");
});
