import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AssistantBlock,
  InferenceEvent,
  InferenceModel,
  InferenceRequest,
  InferenceService,
  ModelRef,
} from "@midas/inference";
import {
  AgentRunControl,
  AgentRunner,
  type AgentRunEvent,
  type AgentTool,
} from "../src/index.js";

class FakeInference implements InferenceService {
  readonly requests: InferenceRequest[] = [];
  readonly responses: InferenceEvent[][] = [];
  listModels(): InferenceModel[] {
    return [];
  }
  getModel(_ref: ModelRef): InferenceModel | null {
    return null;
  }
  async listAvailableModels(): Promise<InferenceModel[]> {
    return [];
  }
  async *stream(request: InferenceRequest): AsyncIterable<InferenceEvent> {
    this.requests.push(request);
    for (const event of this.responses.shift() ?? []) yield event;
  }
}

const model = { provider: "test", id: "model" };
const modelInfo = {
  provider: "test",
  id: "model",
  name: "Model",
  contextWindow: 1000,
  maxOutputTokens: 100,
  reasoning: true,
  input: ["text" as const],
};
const usage = {
  inputTokens: 4,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 6,
  costUsd: 0,
};

function done(
  content: AssistantBlock[],
  reason: "stop" | "toolUse" = "stop",
): InferenceEvent {
  return {
    type: "done",
    reason,
    message: { role: "assistant", content, usage, stopReason: reason },
  };
}

async function collect(
  events: AsyncIterable<AgentRunEvent>,
): Promise<AgentRunEvent[]> {
  const collected: AgentRunEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

test("runs inference, streams ordered events, and returns final context", async () => {
  const inference = new FakeInference();
  inference.responses.push([
    { type: "start", model: modelInfo },
    { type: "textDelta", index: 0, delta: "Hello" },
    done([{ type: "text", text: "Hello" }]),
  ]);
  const persisted: number[] = [];
  const runner = new AgentRunner({
    inference,
    eventSink: {
      append: (event) => {
        persisted.push(event.sequence);
      },
    },
    clock: () => 10,
  });
  const active = runner.start({
    runId: "run-1",
    model,
    context: { messages: [{ role: "user", content: "Hi" }] },
  });
  const eventsPromise = collect(active.events);
  const result = await active.result;
  const events = await eventsPromise;

  assert.equal(result.status, "completed");
  assert.equal(result.context.messages.at(-1)?.role, "assistant");
  assert.equal(result.usage.totalTokens, 6);
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_, index) => index + 1),
  );
  assert.deepEqual(
    persisted,
    events.map((event) => event.sequence),
  );
  assert.ok(events.some((event) => event.type === "message.text.delta"));
});

test("executes a tool and continues the model loop", async () => {
  const inference = new FakeInference();
  inference.responses.push(
    [
      done(
        [
          {
            type: "toolCall",
            id: "call-1",
            name: "read",
            arguments: { path: "README.md" },
          },
        ],
        "toolUse",
      ),
    ],
    [done([{ type: "text", text: "Finished" }])],
  );
  const calls: unknown[] = [];
  const read: AgentTool = {
    name: "read",
    description: "Read a file",
    parameters: { type: "object" },
    async execute(input, context) {
      calls.push(input);
      await context.emitProgress("Reading");
      return { content: "contents" };
    },
  };
  const runner = new AgentRunner({ inference });
  const active = runner.start({
    runId: "run-2",
    model,
    context: { messages: [{ role: "user", content: "Read it" }] },
    tools: [read],
  });
  const eventsPromise = collect(active.events);
  const result = await active.result;
  const events = await eventsPromise;

  assert.equal(result.status, "completed");
  assert.equal(result.turns, 2);
  assert.deepEqual(calls, [{ path: "README.md" }]);
  assert.equal(inference.requests[1]?.messages.at(-1)?.role, "toolResult");
  assert.ok(events.some((event) => event.type === "tool.progress"));
  assert.ok(events.some((event) => event.type === "tool.completed"));
});

test("applies transformed context without mutating durable context", async () => {
  const inference = new FakeInference();
  inference.responses.push([done([{ type: "text", text: "ok" }])]);
  const runner = new AgentRunner({ inference });
  const active = runner.start({
    runId: "run-3",
    model,
    context: {
      systemPrompt: "base",
      messages: [{ role: "user", content: "Original" }],
    },
    transformContext: ({ context }) => ({
      ...context,
      messages: [{ role: "user", content: "Compacted" }],
    }),
  });
  const result = await active.result;
  assert.equal(inference.requests[0]?.messages[0]?.role, "user");
  assert.equal(
    (inference.requests[0]?.messages[0] as { content: string }).content,
    "Compacted",
  );
  assert.equal(
    (result.context.messages[0] as { content: string }).content,
    "Original",
  );
});

test("supports steering between turns and cancellation", async () => {
  const inference = new FakeInference();
  inference.responses.push(
    [
      done(
        [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }],
        "toolUse",
      ),
    ],
    [done([{ type: "text", text: "steered" }])],
  );
  const control = new AgentRunControl();
  const tool: AgentTool = {
    name: "read",
    description: "Read",
    parameters: {},
    async execute() {
      control.steer({ role: "user", content: "Also do this" });
      return { content: "ok" };
    },
  };
  const active = new AgentRunner({ inference }).start(
    { runId: "run-4", model, context: { messages: [] }, tools: [tool] },
    control,
  );
  const eventsPromise = collect(active.events);
  const result = await active.result;
  const events = await eventsPromise;
  assert.equal(result.status, "completed");
  assert.ok(events.some((event) => event.type === "steer.accepted"));
  assert.equal(
    (inference.requests[1]?.messages.at(-1) as { content: string }).content,
    "Also do this",
  );

  const cancelledControl = new AgentRunControl();
  cancelledControl.cancel();
  const cancelled = new AgentRunner({ inference }).start(
    { runId: "run-5", model, context: { messages: [] } },
    cancelledControl,
  );
  assert.equal((await cancelled.result).status, "cancelled");
});

test("bounds repeated tool turns", async () => {
  const inference = new FakeInference();
  inference.responses.push(
    [
      done(
        [{ type: "toolCall", id: "1", name: "read", arguments: {} }],
        "toolUse",
      ),
    ],
    [
      done(
        [{ type: "toolCall", id: "2", name: "read", arguments: {} }],
        "toolUse",
      ),
    ],
  );
  const tool: AgentTool = {
    name: "read",
    description: "Read",
    parameters: {},
    async execute() {
      return { content: "ok" };
    },
  };
  const active = new AgentRunner({ inference }).start({
    runId: "run-6",
    model,
    context: { messages: [] },
    tools: [tool],
    maxTurns: 2,
  });
  const result = await active.result;
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "max_turns");
});
