import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AssistantBlock,
  InferenceEvent,
  InferenceModel,
  InferenceRequest,
  InferenceService,
  ModelRef,
} from "@flareai/inference";
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
    context: {
      systemPrompt: [
        "## Current environment",
        "Selected durable context: 3 blocks.",
        "Durable context candidates: 8 blocks.",
        "Desktop window snapshot captured: 2026-08-21T02:00:00.000Z",
        "### Open in the FlareAI browser",
        "Captured: 2026-08-21T02:00:01.000Z",
        "- One",
        "### Open in the connected external browser",
        "Captured: 2026-08-21T02:00:00.500Z",
        "- Two",
        "- Three",
        "### Open windows",
        "- Four",
        '<active_skill name="browser-use" location="/official/browser-use/SKILL.md">',
        "Instructions",
        "</active_skill>",
        "<available_skills>",
        "<skill><name>private-one</name></skill>",
        "<skill><name>private-two</name></skill>",
        "</available_skills>",
      ].join("\n"),
      messages: [{ role: "user", content: "Hi" }],
    },
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
  const started = events.find((event) => event.type === "turn.started");
  assert.ok(started && started.type === "turn.started");
  assert.equal(started.footprint.toolCount, 0);
  assert.deepEqual(started.footprint.toolNames, []);
  assert.deepEqual(started.footprint.systemSections, ["Current environment"]);
  assert.deepEqual(started.footprint.activeSkillNames, ["browser-use"]);
  assert.equal(started.footprint.availableSkillCount, 2);
  assert.deepEqual(started.footprint.ambientContextCounts, {
    memoryBlocks: 3,
    memoryCandidateBlocks: 8,
    flareBrowserTabs: 1,
    externalBrowserTabs: 2,
    openWindows: 1,
  });
  assert.deepEqual(started.footprint.ambientContextCapturedAt, {
    windows: "2026-08-21T02:00:00.000Z",
    flareBrowser: "2026-08-21T02:00:01.000Z",
    externalBrowser: "2026-08-21T02:00:00.500Z",
  });
  assert.ok(started.footprint.messageBytes > 0);
  assert.equal(
    started.footprint.totalBytes,
    started.footprint.systemPromptBytes +
      started.footprint.messageBytes +
      started.footprint.toolSchemaBytes,
  );
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

test("a bounded evidence phase guarantees a tool-free synthesis turn beyond maxTurns", async () => {
  const inference = new FakeInference();
  const toolCall = (id: string) => done([{
    type: "toolCall" as const, id, name: "read", arguments: {},
  }], "toolUse");
  inference.responses.push(
    [toolCall("call-1")], [toolCall("call-2")],
    [done([{type: "text", text: "Synthesized"}])],
  );
  let executed = 0;
  const read: AgentTool = {
    name: "read", description: "Read", parameters: {type: "object"},
    execute: async () => { executed += 1; return {content: "evidence"}; },
  };
  const result = await new AgentRunner({inference}).start({
    runId: "run-bounded-synthesis", model, maxTurns: 2,
    context: {messages: [{role: "user", content: "Research"}]}, tools: [read],
    toolTurnBudget: {maximum: 2, synthesisPrompt: "Synthesize now"},
  }).result;
  assert.equal(result.status, "completed");
  assert.equal(result.turns, 3);
  assert.equal(executed, 2);
  assert.equal(inference.requests[2]?.tools.length, 0);
  assert.equal((inference.requests[2]?.messages.at(-1) as {content: string}).content, "Synthesize now");
});

test("parallel calls count as one bounded tool turn", async () => {
  const inference = new FakeInference();
  inference.responses.push(
    [done([
      {type: "toolCall", id: "call-1", name: "read", arguments: {}},
      {type: "toolCall", id: "call-2", name: "read", arguments: {}},
    ], "toolUse")],
    [done([{type: "text", text: "Done"}])],
  );
  let executed = 0;
  const read: AgentTool = {
    name: "read", description: "Read", parameters: {type: "object"},
    execute: async () => { executed += 1; return {content: "evidence"}; },
  };
  const result = await new AgentRunner({inference}).start({
    runId: "run-bounded-parallel", model, maxTurns: 1,
    context: {messages: [{role: "user", content: "Research"}]},
    tools: [read], toolExecution: "parallel",
    toolTurnBudget: {maximum: 1, synthesisPrompt: "Synthesize now"},
  }).result;
  assert.equal(result.status, "completed");
  assert.equal(executed, 2);
  assert.equal(inference.requests[1]?.tools.length, 0);
});

test("a tool call attempted during bounded synthesis is never executed", async () => {
  const inference = new FakeInference();
  inference.responses.push(
    [done([{type: "toolCall", id: "call-1", name: "read", arguments: {}}], "toolUse")],
    [done([{type: "toolCall", id: "call-2", name: "read", arguments: {}}], "toolUse")],
    [done([{type: "text", text: "Recovered synthesis"}])],
  );
  let executed = 0;
  const read: AgentTool = {
    name: "read", description: "Read", parameters: {type: "object"},
    execute: async () => { executed += 1; return {content: "evidence"}; },
  };
  const result = await new AgentRunner({inference}).start({
    runId: "run-bounded-forbidden-call", model, maxTurns: 1,
    context: {messages: [{role: "user", content: "Research"}]}, tools: [read],
    toolTurnBudget: {maximum: 1, synthesisPrompt: "Synthesize now"},
  }).result;
  assert.equal(result.status, "completed");
  assert.equal(executed, 1);
  assert.equal(inference.requests[1]?.tools.length, 0);
  assert.equal(inference.requests[2]?.tools.length, 0);
});

test("phases messages and reports work activity for a tool-using run", async () => {
  const inference = new FakeInference();
  inference.responses.push(
    [
      done(
        [
          { type: "text", text: "Checking the file first." },
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
    [done([{ type: "text", text: "All done." }])],
  );
  const read: AgentTool = {
    name: "read",
    description: "Read a file",
    parameters: { type: "object" },
    async execute() {
      return { content: "contents" };
    },
  };
  let now = 0;
  const runner = new AgentRunner({ inference, clock: () => (now += 10) });
  const active = runner.start({
    runId: "run-phase",
    model,
    context: { messages: [{ role: "user", content: "Read it" }] },
    tools: [read],
  });
  const eventsPromise = collect(active.events);
  const result = await active.result;
  const events = await eventsPromise;

  const phases = events.flatMap((event) =>
    event.type === "message.completed" ? [event.phase] : [],
  );
  assert.deepEqual(phases, ["commentary", "final"]);
  assert.equal(result.hadWorkActivity, true);
  assert.equal(result.lastAgentMessage, "All done.");
  assert.ok(result.durationMs > 0);
});

test("a plain reply reports no work activity", async () => {
  const inference = new FakeInference();
  inference.responses.push([done([{ type: "text", text: "Just an answer." }])]);
  const runner = new AgentRunner({ inference });
  const active = runner.start({
    runId: "run-no-work",
    model,
    context: { messages: [{ role: "user", content: "Hi" }] },
  });
  const eventsPromise = collect(active.events);
  const result = await active.result;
  const events = await eventsPromise;

  const phases = events.flatMap((event) =>
    event.type === "message.completed" ? [event.phase] : [],
  );
  assert.deepEqual(phases, ["final"]);
  assert.equal(result.hadWorkActivity, false);
  assert.equal(result.lastAgentMessage, "Just an answer.");
});

test("a rejected final draft receives one corrective turn before it is accepted", async () => {
  const inference = new FakeInference();
  inference.responses.push(
    [done([{type: "text", text: "scratch draft"}])],
    [done([{type: "text", text: "clean result"}])],
  );
  let reviewed = 0;
  const active = new AgentRunner({inference}).start({
    runId: "run-reviewed-final",
    model,
    context: {messages: [{role: "user", content: "Answer"}]},
    reviewFinal: async ({text}) => {
      reviewed += 1;
      return text === "scratch draft"
        ? [{role: "user", content: "Rewrite without scratch work"}]
        : [];
    },
  });
  const eventsPromise = collect(active.events);
  const result = await active.result;
  const events = await eventsPromise;
  assert.equal(reviewed, 2);
  assert.equal(result.turns, 2);
  assert.equal(result.lastAgentMessage, "clean result");
  assert.equal(
    (inference.requests[1]?.messages.at(-1) as {content: string}).content,
    "Rewrite without scratch work",
  );
  assert.deepEqual(
    events.flatMap((event) => event.type === "message.completed" ? [event.message.content] : []),
    [[{type: "text", text: "clean result"}]],
  );
  assert.equal(events.filter((event) => event.type === "message.final_rejected").length, 1);
});

test("an empty terminal response is repaired instead of exposing earlier commentary as the answer", async () => {
  const inference = new FakeInference();
  inference.responses.push(
    [done([{type: "text", text: "Checking the source"}, {
      type: "toolCall",
      id: "call-1",
      name: "read",
      arguments: {},
    }], "toolUse")],
    [done([])],
    [done([{type: "text", text: "Verified result"}])],
  );
  const read: AgentTool = {
    name: "read",
    description: "read",
    parameters: {type: "object", properties: {}},
    execute: async () => ({content: "evidence"}),
  };
  const active = new AgentRunner({inference}).start({
    runId: "run-empty-final-repair",
    model,
    context: {messages: [{role: "user", content: "Check it"}]},
    tools: [read],
  });
  const eventsPromise = collect(active.events);
  const result = await active.result;
  const events = await eventsPromise;
  assert.equal(result.status, "completed");
  assert.equal(result.lastAgentMessage, "Verified result");
  assert.equal(events.filter((event) => event.type === "message.final_rejected").length, 1);
  assert.deepEqual(
    events.flatMap((event) => event.type === "message.completed" && event.phase === "final"
      ? [event.message.content]
      : []),
    [[{type: "text", text: "Verified result"}]],
  );
});

test("a final repair gets one bounded turn beyond the ordinary max-turn budget", async () => {
  const inference = new FakeInference();
  inference.responses.push(
    [done([{type: "text", text: "invalid"}])],
    [done([{type: "text", text: "repaired"}])],
  );
  const active = new AgentRunner({inference}).start({
    runId: "run-final-budget-repair",
    model,
    maxTurns: 1,
    context: {messages: [{role: "user", content: "Answer"}]},
    reviewFinal: async ({text}) => text === "invalid"
      ? [{role: "user", content: "Repair it"}]
      : [],
  });
  const result = await active.result;
  assert.equal(result.status, "completed");
  assert.equal(result.turns, 2);
  assert.equal(result.lastAgentMessage, "repaired");
});

test("a pre-tool hook can veto a call and the model sees the block", async () => {
  const inference = new FakeInference();
  inference.responses.push(
    [
      done(
        [
          {
            type: "toolCall",
            id: "call-1",
            name: "write",
            arguments: { path: "a.txt" },
          },
        ],
        "toolUse",
      ),
    ],
    [done([{ type: "text", text: "Understood" }])],
  );
  let executed = 0;
  const write: AgentTool = {
    name: "write",
    description: "Write a file",
    parameters: { type: "object" },
    async execute() {
      executed += 1;
      return { content: "written" };
    },
  };
  const observed: string[] = [];
  const runner = new AgentRunner({
    inference,
    hooks: {
      beforeTool: async (call) => ({
        allow: false,
        message: `write to ${String((call.arguments as { path?: string }).path)} denied`,
      }),
      afterTool: async (call) => {
        observed.push(call.name);
      },
    },
  });
  const active = runner.start({
    runId: "run-hook",
    model,
    context: { messages: [{ role: "user", content: "Write it" }] },
    tools: [write],
  });
  const eventsPromise = collect(active.events);
  const result = await active.result;
  const events = await eventsPromise;

  assert.equal(result.status, "completed");
  assert.equal(executed, 0);
  assert.deepEqual(observed, []);
  const failed = events.find((event) => event.type === "tool.failed");
  assert.ok(failed && "error" in failed);
  assert.equal(failed.error.code, "tool_blocked_by_hook");
  const toolResult = inference.requests[1]?.messages.at(-1);
  assert.equal(toolResult?.role, "toolResult");
  assert.match(JSON.stringify(toolResult), /denied/);
});

test("post-tool hooks observe completed calls", async () => {
  const inference = new FakeInference();
  inference.responses.push(
    [
      done(
        [
          {
            type: "toolCall",
            id: "call-1",
            name: "read",
            arguments: {},
          },
        ],
        "toolUse",
      ),
    ],
    [done([{ type: "text", text: "ok" }])],
  );
  const read: AgentTool = {
    name: "read",
    description: "Read",
    parameters: { type: "object" },
    async execute() {
      return { content: "contents" };
    },
  };
  const observed: string[] = [];
  const runner = new AgentRunner({
    inference,
    hooks: {
      afterTool: async (call, result) => {
        observed.push(`${call.name}:${String(result.content)}`);
        throw new Error("observer failures never break the run");
      },
    },
  });
  const active = runner.start({
    runId: "run-hook-post",
    model,
    context: { messages: [{ role: "user", content: "Read" }] },
    tools: [read],
  });
  void collect(active.events);
  const result = await active.result;
  assert.equal(result.status, "completed");
  assert.deepEqual(observed, ["read:contents"]);
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

test("steering accepted while completion waits always receives another turn", async () => {
  const inference = new FakeInference();
  inference.responses.push(
    [done([{ type: "text", text: "first" }])],
    [done([{ type: "text", text: "after steer" }])],
  );
  const control = new AgentRunControl();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const inCompletion = new Promise<void>((resolve) => { entered = resolve; });
  let checks = 0;
  const active = new AgentRunner({ inference }).start({
    runId: "completion-steer",
    model,
    context: { messages: [] },
    beforeComplete: async () => {
      checks += 1;
      if (checks === 1) {
        entered();
        await waiting;
      }
      return [];
    },
  }, control);
  await inCompletion;
  control.steer({role: "user", content: "Do not drop this"});
  release();
  const result = await active.result;
  assert.equal(result.status, "completed");
  assert.equal(inference.requests.length, 2);
  assert.equal((inference.requests[1]?.messages.at(-1) as {content: string}).content, "Do not drop this");
  assert.throws(() => control.steer({role: "user", content: "too late"}), /no longer accepts/);
});

test("retries a transient rate limit with backoff before failing", async () => {
  const inference = new FakeInference();
  inference.responses.push(
    [
      {
        type: "error",
        error: {
          code: "rate_limit",
          message: "429 Rate limit exceeded",
          retryable: true,
        },
      },
    ],
    [
      {
        type: "error",
        error: {
          code: "rate_limit",
          message: "429 Rate limit exceeded",
          retryable: true,
        },
      },
    ],
    [done([{ type: "text", text: "Recovered" }])],
  );
  const active = new AgentRunner({ inference }).start({
    runId: "run-retry",
    model,
    context: { messages: [{ role: "user", content: "Hi" }] },
  });
  const result = await active.result;

  assert.equal(result.status, "completed");
  assert.equal(inference.requests.length, 3);
  const last = result.context.messages.at(-1) as { content: Array<{type: string; text?: string}> };
  assert.equal(last.content[0]?.text, "Recovered");
});

test("fails when retries are exhausted without any response content", async () => {
  const inference = new FakeInference();
  for (let index = 0; index < 3; index += 1)
    inference.responses.push([
      {
        type: "error",
        error: {
          code: "rate_limit",
          message: "429 Rate limit exceeded",
          retryable: true,
        },
      },
    ]);
  const active = new AgentRunner({ inference }).start({
    runId: "run-out",
    model,
    context: { messages: [{ role: "user", content: "Hi" }] },
  });
  const result = await active.result;

  assert.equal(result.status, "failed");
  assert.equal(result.error?.retryable, true);
  assert.equal(inference.requests.length, 3);
});

test("does not retry a long-lived provider quota", async () => {
  const inference = new FakeInference();
  inference.responses.push([
    {
      type: "error",
      error: {
        code: "rate_limit",
        message: "Weekly usage limit reached. Resets in 3 days.",
        retryable: false,
      },
    },
  ]);
  const result = await new AgentRunner({inference}).start({
    runId: "run-weekly-quota",
    model,
    context: {messages: [{role: "user", content: "Hi"}]},
  }).result;
  assert.equal(result.status, "failed");
  assert.equal(result.error?.retryable, false);
  assert.equal(inference.requests.length, 1);
});

test("does not retry a failure that already emitted content", async () => {
  const inference = new FakeInference();
  inference.responses.push([
    { type: "start", model: modelInfo },
    { type: "textDelta", index: 0, delta: "Partial" },
    {
      type: "error",
      error: {
        code: "rate_limit",
        message: "429 Rate limit exceeded",
        retryable: true,
      },
    },
  ]);
  const active = new AgentRunner({ inference }).start({
    runId: "run-partial",
    model,
    context: { messages: [{ role: "user", content: "Hi" }] },
  });
  const result = await active.result;

  assert.equal(result.status, "failed");
  assert.equal(inference.requests.length, 1);
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
