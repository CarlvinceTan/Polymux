import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type {
  InferenceEvent,
  JsonObject,
  InferenceMessage,
  InferenceModel,
  InferenceRequest,
  InferenceService,
  ModelRef,
} from "@flareai/inference";
import { SqliteStorage } from "@flareai/storage/sqlite";
import { ToolRegistry } from "@flareai/tools";
import { AgentRunControl } from "@flareai/core";
import {
  AGENT_PROMPT_NAMES,
  createWaitAllTasksTool,
  fillPrompt,
  loadAgentPrompts,
  MemoryManager,
  FlareAIAgent,
} from "../src/index.js";
import {readGoalProgress, recordGoalProgress} from "../src/goals/progress-receipts.js";
import { freshRetainedEntries, selectRetainedForPrompt, SubagentFleet } from "../src/subagents/fleet.js";
import {createCancelTasksTool, createTaskTool} from "../src/subagents/task-tool.js";

const model = { provider: "test", id: "model" };
const modelInfo: InferenceModel = {
  provider: "test",
  id: "model",
  name: "Model",
  contextWindow: 100_000,
  maxOutputTokens: 1_000,
  reasoning: false,
  input: ["text"],
};
const usage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 2,
  costUsd: 0,
};

function answer(text: string): InferenceEvent {
  return {
    type: "done",
    reason: "stop",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage,
      stopReason: "stop",
    },
  };
}

function call(
  id: string,
  name: string,
  args: JsonObject,
): InferenceEvent {
  return {
    type: "done",
    reason: "toolUse",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id, name, arguments: args }],
      usage,
      stopReason: "toolUse",
    },
  };
}

function transcript(request: InferenceRequest): string {
  return request.messages.map(rendered).join("\n");
}

/** Only a real notification carries the closing marker — the `task` tool's own
 * result mentions the opening one while explaining where results arrive. */
function reported(text: string): boolean {
  return text.includes("</subagent_notification>");
}

/** What one tool's result said, on its own: the transcript around it holds the
 * post the result deliberately does not repeat. */
function toolResult(request: InferenceRequest, name: string): string {
  const message = request.messages.find(
    (item) => item.role === "toolResult" && item.toolName === name,
  );
  return message ? rendered(message) : "";
}

function rendered(message: InferenceMessage): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "toolCall") return `${block.name}(…)`;
      return "";
    })
    .join(" ");
}

/**
 * Answers by looking at what it is being asked, rather than in a fixed order.
 *
 * Dispatch no longer blocks, so a parent turn and a delegated run are in
 * flight at the same time and a queue would hand one of them the other's
 * script. Matching on the transcript is what keeps a concurrent test readable.
 */
class ScriptedInference implements InferenceService {
  readonly requests: InferenceRequest[] = [];
  readonly rules: Array<{
    when: (request: InferenceRequest) => boolean;
    reply: () => Promise<InferenceEvent> | InferenceEvent;
  }> = [];

  on(
    when: (transcriptText: string, request: InferenceRequest) => boolean,
    reply: () => Promise<InferenceEvent> | InferenceEvent,
  ): this {
    this.rules.push({
      when: (request) => when(transcript(request), request),
      reply,
    });
    return this;
  }

  listModels(): InferenceModel[] {
    return [modelInfo];
  }
  getModel(_ref: ModelRef): InferenceModel {
    return modelInfo;
  }
  async listAvailableModels(): Promise<InferenceModel[]> {
    return [modelInfo];
  }
  async *stream(request: InferenceRequest): AsyncIterable<InferenceEvent> {
    this.requests.push(request);
    const rule = this.rules.find((item) => item.when(request));
    if (!rule) throw new Error(`No scripted reply for:\n${transcript(request)}`);
    yield await rule.reply();
  }
}

function testAgent(
  inference: InferenceService,
  storage: SqliteStorage,
  options: { orchestrationExperiment?: boolean } = {},
) {
  return new FlareAIAgent({
    inference,
    storage,
    memory: new MemoryManager({
      directory: mkdtempSync(path.join(tmpdir(), "flareai-subagent-test-")),
    }),
    tools: new ToolRegistry(),
    model,
    orchestrationExperiment: options.orchestrationExperiment,
    compaction: { enabled: false },
  });
}

function conversation(storage: SqliteStorage): void {
  storage.createConversation({ id: "conversation", title: "Chat" });
}

/** A parent run for tests that start a delegated run directly. */
function parentRun(storage: SqliteStorage): void {
  storage.createRun({
    id: "parent",
    conversationId: "conversation",
    status: "running",
  });
}

test("retained workers are visible to natural follow-ups but absent from unrelated work", () => {
  const retained: import("../src/subagents/fleet.js").RetainedSubagentEntry[] = [{
    name: "subagent_1",
    description: "Inspect NUS climbing event",
    runId: "child",
    status: "completed",
    result: "Friday evening; bring climbing shoes",
    retained: [{role: "assistant", content: [{type: "text", text: "details"}]}],
    retainedAt: 100,
  }];
  assert.deepEqual(selectRetainedForPrompt([...retained], "Which one would you pick, and what should I bring?"), retained);
  assert.deepEqual(selectRetainedForPrompt([...retained], "Check whether my Singapore visa rules changed"), []);
  assert.deepEqual(selectRetainedForPrompt([...retained], "Tell me more about the climbing event"), retained);
});

test("weak singular follow-ups inject only the newest relevant retained worker", () => {
  const older = {
    name: "subagent_1", description: "Inspect NUS event", runId: "one",
    status: "completed" as const, result: "Friday climbing", retained: [{role: "assistant" as const, content: [{type: "text" as const, text: "event"}]}],
    retainedAt: 100,
  };
  const newer = {
    name: "subagent_2", description: "Inspect exchange form", runId: "two",
    status: "completed" as const, result: "Missing signature", retained: [{role: "assistant" as const, content: [{type: "text" as const, text: "form"}]}],
    retainedAt: 200,
  };
  assert.deepEqual(selectRetainedForPrompt([older, newer], "Fix it"), [newer]);
  assert.deepEqual(selectRetainedForPrompt([older, newer], "Fix the event issue"), [older]);
  assert.deepEqual(selectRetainedForPrompt([older, newer], "What should I do next?"), [newer, older]);
});

test("cross-turn retention expires after thirty minutes and keeps only four recent workers", () => {
  const now = 2_000_000;
  const entries = Array.from({length: 6}, (_, index) => ({
    name: `subagent_${index + 1}`,
    description: `Worker ${index + 1}`,
    runId: `run-${index + 1}`,
    status: "completed" as const,
    retained: [{role: "assistant" as const, content: [{type: "text" as const, text: "details"}]}],
    retainedAt: index === 0 ? now - 30 * 60_000 - 1 : now - index,
  }));
  assert.deepEqual(
    freshRetainedEntries(entries, now).map((entry) => entry.name),
    ["subagent_2", "subagent_3", "subagent_4", "subagent_5"],
  );
});

test("dispatching a task hands the turn straight back", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    let releaseChild!: () => void;
    const childHeld = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });
    let dispatchedAt = 0;
    let secondTurnAt = 0;

    const inference = new ScriptedInference();
    inference
      .on((text) => text.includes("child work"), async () => {
        await childHeld;
        return answer("the child's finding");
      })
      .on(
        (text) => text.includes("Do the research") && !text.includes("task("),
        () => {
          dispatchedAt += 1;
          return call("call-1", "subagent", {
            description: "Research",
            prompt: "child work",
          });
        },
      )
      .on(
        (text) => text.includes("task(") && !reported(text),
        () => {
          // The parent got its turn back while the child is still held.
          secondTurnAt += 1;
          releaseChild();
          return answer("dispatched, still working");
        },
      )
      .on(reported, () => answer("here is what the task found"));

    const result = await testAgent(inference, storage).start({
      conversationId: "conversation",
      text: "Do the research",
    }).result;

    assert.equal(dispatchedAt, 1);
    assert.equal(
      secondTurnAt,
      1,
      "the parent must take another turn before the subagent answers",
    );
    assert.equal(result.status, "completed");
    assert.equal(result.lastAgentMessage, "here is what the task found");
  } finally {
    storage.close();
  }
});

test("a user-created structured goal records its completed worker", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    const inference = new ScriptedInference();
    inference
      .on((text) => text.includes("receipt child work"), () => answer("Verified the application status."))
      .on(
        (text) => text.includes("Begin durable goal") && !text.includes("task(…)"),
        () => call("dispatch", "subagent", {
          description: "Check application status",
          prompt: "receipt child work",
          coordination: "independent",
          tool_groups: ["all"],
        }),
      )
      .on(
        (text) => text.includes("Begin durable goal") && !reported(text),
        () => call("wait", "wait_subagent", {timeout_ms: 5_000}),
      )
      .on((text) => text.includes("Begin durable goal"), () => answer("Recorded the verified status."))
      .on(() => true, () => answer('{"verdict":"wait","reason":"User input is needed."}'));
    const agent = testAgent(inference, storage, {orchestrationExperiment: true});

    await agent.start({
      conversationId: "conversation",
      text: "Begin durable goal",
      asGoal: true,
    }).result;
    await agent.settleGoalWork();

    const goal = storage.getGoal("conversation");
    assert.ok(goal);
    const receipts = readGoalProgress(storage, goal.id);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].description, "Check application status");
    assert.match(receipts[0].result, /Verified the application status/);
  } finally {
    storage.close();
  }
});

test("a goal worker receives prior progress receipts even when its dispatch is concise", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    storage.createGoal({
      id: "goal",
      conversationId: "conversation",
      objective: "Track application readiness",
    });
    recordGoalProgress(
      storage,
      "goal",
      "Check inbox",
      "No approval email was found.",
      [],
      "2026-08-22T04:00:00.000Z",
    );
    const inference = new ScriptedInference();
    inference
      .on((text) => text.includes("follow-up child"), () => answer("Checked a distinct source."))
      .on(
        (text) => text.includes("Advance the goal") && !text.includes("task(…)"),
        () => call("dispatch", "subagent", {
          description: "Check the next source",
          prompt: "follow-up child",
          coordination: "independent",
          tool_groups: ["all"],
        }),
      )
      .on(
        (text) => text.includes("Advance the goal") && !reported(text),
        () => call("wait", "wait_subagent", {timeout_ms: 5_000}),
      )
      .on((text) => text.includes("Advance the goal"), () => answer("Advanced."))
      .on(() => true, () => answer('{"verdict":"wait","reason":"Enough for now."}'));
    const agent = testAgent(inference, storage, {orchestrationExperiment: true});

    await agent.start({
      conversationId: "conversation",
      text: "Advance the goal",
      goalProgressContext: true,
    }).result;
    await agent.settleGoalWork();

    const worker = inference.requests.find((request) => transcript(request).includes("follow-up child"));
    assert.ok(worker);
    assert.match(transcript(worker), /<goal_progress>/);
    assert.match(transcript(worker), /No approval email was found/);
  } finally {
    storage.close();
  }
});

test("a finished task reaches the parent as a notification it can read", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    const inference = new ScriptedInference();
    inference
      .on((text) => text.includes("child work"), () => answer("42 events found"))
      .on(
        (text) => text.includes("Do the research") && !text.includes("task("),
        () =>
          call("call-1", "subagent", {
            description: "Research",
            prompt: "child work",
          }),
      )
      .on(reported, () => answer("done"))
      // The parent answers while the task is still out: the run must not end
      // there, because nobody would be left to read the result.
      .on(() => true, () => answer("I'll get back to you"));

    await testAgent(inference, storage).start({
      conversationId: "conversation",
      text: "Do the research",
    }).result;

    const last = transcript(inference.requests.at(-1)!);
    assert.match(last, /<subagent_notification>/);
    assert.match(last, /"subagent":"subagent_1"/);
    assert.match(last, /"status":"completed"/);
    assert.match(last, /42 events found/);
  } finally {
    storage.close();
  }
});

test("wait_subagent says which task moved, never what it said", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    let releaseChild!: () => void;
    const childHeld = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });
    const inference = new ScriptedInference();
    inference
      .on((text) => text.includes("child work"), async () => {
        await childHeld;
        return answer("the secret finding");
      })
      .on(
        (text) => text.includes("Do the research") && !text.includes("task("),
        () =>
          call("call-1", "subagent", {
            description: "Research",
            prompt: "child work",
          }),
      )
      .on(
        (text) => text.includes("task(") && !text.includes("wait_subagent("),
        () => {
          releaseChild();
          return call("call-2", "wait_subagent", { timeout_ms: 5_000 });
        },
      )
      .on(() => true, () => answer("done"));

    await testAgent(inference, storage).start({
      conversationId: "conversation",
      text: "Do the research",
    }).result;

    // The turn that follows the wait carries its result. It names the task and
    // stays silent about the answer, which arrives beside it as post.
    const afterWait = inference.requests.find((request) =>
      toolResult(request, "wait_subagent").includes('"updated"'),
    );
    assert.ok(afterWait, "the wait's result must reach the model");
    const waitResult = toolResult(afterWait, "wait_subagent");
    assert.match(waitResult, /"updated":\["subagent_1"\]/);
    assert.ok(
      !waitResult.includes("the secret finding"),
      "wait_subagent must not repeat the result the notification already carries",
    );
    assert.match(transcript(afterWait), /the secret finding/);
  } finally {
    storage.close();
  }
});

test("experimental fan-out waits for every task without an extra polling inference", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    const calls = multiCall();
    const inference = new ScriptedInference();
    inference
      .on((text) => text.includes("first child"), () => answer("first result"))
      .on((text) => text.includes("second child"), () => answer("second result"))
      .on(
        (text) => text.includes("Compare both") && !text.includes("task(…)"),
        () =>
          calls.many([
            { name: "subagent", args: { description: "First", prompt: "first child" } },
            { name: "subagent", args: { description: "Second", prompt: "second child" } },
            { name: "wait_all_subagents", args: { timeout_ms: 5_000 } },
          ]),
      )
      .on(
        (text) => text.includes("first result") && text.includes("second result"),
        () => answer("First and second combined"),
      );

    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: new MemoryManager({
        directory: mkdtempSync(path.join(tmpdir(), "flareai-fan-in-test-")),
      }),
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: false },
      orchestrationExperiment: true,
    });
    const result = await agent.start({
      conversationId: "conversation",
      text: "Compare both",
    }).result;

    assert.equal(result.lastAgentMessage, "First and second combined");
    const parentRequests = inference.requests.filter((request) =>
      transcript(request).includes("Compare both"),
    );
    assert.equal(parentRequests.length, 2, "dispatch/barrier then synthesis only");
    const synthesis = parentRequests[1]!;
    assert.match(transcript(synthesis), /first result/);
    assert.match(transcript(synthesis), /second result/);
    assert.match(toolResult(synthesis, "wait_all_subagents"), /"running":\[\]/);
    assert.ok(
      !toolResult(synthesis, "wait_all_subagents").includes("first result"),
      "the barrier must not duplicate task contents",
    );
  } finally {
    storage.close();
  }
});

test("the fan-in barrier covers ordinary long workers without explicit polling", async () => {
  let running = true;
  let receivedTimeout = 0;
  const fleet = {
    outstanding: () => running ? [{ name: "subagent_1" }] : [],
    roster: () => [{ name: "subagent_1", status: running ? "running" : "completed" }],
    waitForNews: async (timeout: number) => {
      receivedTimeout = timeout;
      running = false;
      return { updated: ["subagent_1"], timedOut: false };
    },
  };
  const tool = createWaitAllTasksTool(fleet as never);
  const result = await tool.execute({}, {
    runId: "run",
    turn: 1,
    callId: "wait",
    signal: new AbortController().signal,
    emitProgress: async (): Promise<void> => {},
  });
  assert.ok(receivedTimeout >= 119_000 && receivedTimeout <= 120_000);
  assert.match(result.content as string, /"running":\[\]/);
});

test("a bounded goal continuation cannot open a second delegation wave", async () => {
  const started: string[] = [];
  const tool = createTaskTool(async (request) => {
    started.push(request.description);
    return {name: `subagent_${started.length}`};
  }, {maxDispatches: 2});
  const context = {
    runId: "goal-run",
    turn: 1,
    callId: "dispatch",
    signal: new AbortController().signal,
    emitProgress: async (): Promise<void> => {},
  };
  const dispatch = (description: string) => tool.execute({description, prompt: description}, context);
  await Promise.all([dispatch("first"), dispatch("second")]);
  const refused = await dispatch("second wave");
  assert.deepEqual(started, ["first", "second"]);
  assert.match(String(refused.content), /already dispatched 2 tasks/i);
  assert.match(JSON.stringify(refused.metadata), /goal_continuation_batch_complete/);

  const unlimited: string[] = [];
  const ordinary = createTaskTool(async (request) => {
    unlimited.push(request.description);
    return {name: `subagent_${unlimited.length}`};
  });
  await Promise.all([
    ordinary.execute({description: "one", prompt: "one"}, context),
    ordinary.execute({description: "two", prompt: "two"}, context),
    ordinary.execute({description: "three", prompt: "three"}, context),
  ]);
  assert.equal(unlimited.length, 3, "ordinary multi-task work remains uncapped");
});

test("user steering wakes the fan-in barrier without consuming the message", async () => {
  const fleet = new SubagentFleet();
  const control = new AgentRunControl();
  fleet.attach(control);
  fleet.spawn("held worker", "child-run");
  const tool = createWaitAllTasksTool(fleet);
  const started = Date.now();
  const pending = tool.execute({ timeout_ms: 120_000 }, {
    runId: "run",
    turn: 1,
    callId: "wait",
    signal: control.signal,
    emitProgress: async () => undefined,
  });
  control.steer({ role: "user", content: "Change direction" });
  const result = await pending;
  assert.ok(Date.now() - started < 1_000, "steering should not wait for the worker");
  assert.match(result.content as string, /"steered":true/);
  assert.match(result.content as string, /"running":\["subagent_1"\]/);
  assert.deepEqual(control.drainSteering(), [
    { role: "user", content: "Change direction" },
  ]);
});

test("user steering also wakes the premature-completion backstop", async () => {
  const fleet = new SubagentFleet();
  const control = new AgentRunControl();
  fleet.attach(control);
  fleet.spawn("held worker", "child-run");
  const pending = fleet.settleOutstandingOrSteered(control.signal);
  control.steer({ role: "user", content: "Do this instead" });
  await Promise.race([
    pending,
    new Promise((_, reject) => setTimeout(() => reject(new Error("backstop did not yield")), 1_000)),
  ]);
  assert.deepEqual(fleet.takePost(), [
    { role: "user", content: "Do this instead" },
  ]);
  assert.deepEqual(fleet.outstanding().map((entry) => entry.name), ["subagent_1"]);
});

test("the experimental cancellation tool stops only exact obsolete workers", async () => {
  const fleet = new SubagentFleet();
  const control = new AgentRunControl();
  fleet.attach(control);
  fleet.spawn("obsolete", "child-1");
  fleet.spawn("still useful", "child-2");
  let cancelOne = 0;
  let cancelTwo = 0;
  const never = new Promise<{status: string; text: string}>(() => {});
  fleet.track("subagent_1", never, () => { cancelOne += 1; });
  fleet.track("subagent_2", never, () => { cancelTwo += 1; });
  const tool = createCancelTasksTool(fleet);
  const refused = await tool.execute({tasks: ["subagent_1"]}, {
    runId: "run", turn: 1, callId: "premature-cancel",
    signal: new AbortController().signal,
    emitProgress: async () => undefined,
  });
  assert.equal((refused.metadata as {cancellationRefused?: boolean}).cancellationRefused, true);
  assert.equal(cancelOne, 0);
  control.steer({role: "user", content: "Also summarise the latest file"});
  const additive = await tool.execute({tasks: ["subagent_1"]}, {
    runId: "run", turn: 1, callId: "additive-steering",
    signal: new AbortController().signal,
    emitProgress: async () => undefined,
  });
  assert.equal((additive.metadata as {cancellationRefused?: boolean}).cancellationRefused, true);
  assert.equal(cancelOne, 0);
  control.steer({role: "user", content: "Drop that task"});
  const result = await tool.execute({tasks: ["subagent_1", "subagent_missing", "subagent_1"]}, {
    runId: "run", turn: 1, callId: "cancel",
    signal: new AbortController().signal,
    emitProgress: async () => undefined,
  });
  assert.deepEqual(JSON.parse(result.content as string), {
    cancelled: ["subagent_1"],
    unavailable: ["subagent_missing"],
  });
  assert.equal(cancelOne, 1);
  assert.equal(cancelTwo, 0);
  const reused = await tool.execute({tasks: ["subagent_2"]}, {
    runId: "run", turn: 1, callId: "reused-steering",
    signal: new AbortController().signal,
    emitProgress: async () => undefined,
  });
  assert.equal((reused.metadata as {cancellationRefused?: boolean}).cancellationRefused, true);
  assert.equal(cancelTwo, 0);
});

test("completion coverage identifies only delegated outcomes omitted from the answer", () => {
  const fleet = new SubagentFleet();
  fleet.spawn("NUS study spot", "study-run");
  fleet.spawn("Exchange form requirements", "exchange-run");
  fleet.spawn("Latest file summary", "file-run");
  fleet.settle("subagent_1", "completed", "Central Library is open.");
  fleet.settle("subagent_2", "completed", "No pending form step found.");
  fleet.settle("subagent_3", "completed", "No exact file path found.");
  assert.deepEqual(
    fleet.missingOutcomes("The NUS study spot is Central Library. Latest file: unavailable.")
      .map((entry) => entry.description),
    ["Exchange form requirements"],
  );
});

test("a failed task is reported as failed rather than lost", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    const inference = new ScriptedInference();
    inference
      .on((text) => text.includes("child work"), () => {
        throw new Error("provider exploded");
      })
      .on(
        (text) => text.includes("Do the research") && !text.includes("task("),
        () =>
          call("call-1", "subagent", {
            description: "Research",
            prompt: "child work",
          }),
      )
      .on(() => true, () => answer("done"));

    await testAgent(inference, storage).start({
      conversationId: "conversation",
      text: "Do the research",
    }).result;

    const last = transcript(inference.requests.at(-1)!);
    assert.match(last, /"status":"failed"/);
    assert.match(last, /provider exploded/);
  } finally {
    storage.close();
  }
});

/** A turn carrying several tool calls at once — how a real orchestrator
 * dispatches a fleet in parallel. Ids are unique across the whole test so a
 * call can be told apart from its echo in later request snapshots. */
function multiCall() {
  let counter = 0;
  return {
    one(name: string, args: JsonObject): InferenceEvent {
      return call(`${name}-${++counter}`, name, args);
    },
    many(list: Array<{ name: string; args: JsonObject }>): InferenceEvent {
      return {
        type: "done",
        reason: "toolUse",
        message: {
          role: "assistant",
          content: list.map(({ name, args }) => ({
            type: "toolCall",
            id: `${name}-${++counter}`,
            name,
            arguments: args,
          })),
          usage,
          stopReason: "toolUse",
        },
      };
    },
  };
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Every notification a transcript carries, parsed. */
function notifications(text: string): Array<Record<string, unknown>> {
  return [
    ...text.matchAll(/<subagent_notification>\n([\s\S]*?)\n<\/subagent_notification>/g),
  ].map((match) => JSON.parse(match[1]!));
}

test("a continued task resumes with its retained context under the same name", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    const calls = multiCall();
    const inference = new ScriptedInference();
    inference
      .on(
        (text) => text.includes("what was the codeword?"),
        () => answer("it was zebra"),
      )
      .on(
        (text) => text.includes("follow up on plain"),
        () => answer("fresh follow-up done"),
      )
      .on(
        (text) => text.includes("remember the codeword zebra"),
        () => answer("the codeword is zebra"),
      )
      .on(
        (text) => text.includes("plain work"),
        () => answer("plain done"),
      )
      .on(
        (text) => text.includes("Coordinate") && !text.includes("task("),
        () =>
          calls.many([
            { name: "subagent", args: { description: "Worker", prompt: "remember the codeword zebra", retain: true } },
            { name: "subagent", args: { description: "Plain", prompt: "plain work" } },
          ]),
      )
      .on(
        (text) =>
          text.includes("the codeword is zebra") &&
          text.includes("plain done") &&
          !text.includes('"resumed"'),
        () =>
          calls.many([
            { name: "subagent", args: { description: "Worker follow-up", prompt: "what was the codeword?", continue: "subagent_1" } },
            { name: "subagent", args: { description: "Plain follow-up", prompt: "follow up on plain", continue: "subagent_2" } },
          ]),
      )
      .on(() => true, () => answer("wrapped up"));

    const result = await testAgent(inference, storage).start({
      conversationId: "conversation",
      text: "Coordinate things",
    }).result;
    assert.equal(result.status, "completed");

    // The continued dispatch kept subagent_1's identity; continuing a task that
    // was never retained fell back to a fresh task with a fresh name.
    const taskCalls = new Map<string, { task: string; resumed?: string }>();
    for (const request of inference.requests)
      for (const message of request.messages)
        if (message.role === "toolResult" && message.toolName === "subagent")
          taskCalls.set(message.toolCallId, JSON.parse(rendered(message)));
    const dispatched = [...taskCalls.values()];
    assert.deepEqual(
      dispatched.map((entry) => entry.task),
      ["subagent_1", "subagent_2", "subagent_1", "subagent_3"],
    );
    assert.equal(dispatched[2]!.resumed, "subagent_1");

    // The continued run is seeded with everything the first run gathered:
    // its instruction and answer sit ahead of the new instruction.
    const continued = inference.requests.find((request) =>
      transcript(request).includes("what was the codeword?"),
    )!;
    const continuedText = transcript(continued);
    assert.ok(continuedText.includes("the codeword is zebra"), "the retained context is seeded");
    assert.ok(
      continuedText.indexOf("remember the codeword zebra") <
        continuedText.indexOf("what was the codeword?"),
      "the seeded context precedes the new instruction",
    );
    // Without retain, continue is a no-op: the fresh run starts from nothing.
    const fresh = inference.requests.find((request) =>
      transcript(request).includes("follow up on plain"),
    )!;
    assert.ok(!transcript(fresh).includes("plain done"), "no retained context, no seed");

    // The same task settling twice posts a notification each time.
    const notes = notifications(transcript(inference.requests.at(-1)!));
    assert.equal(notes.filter((note) => note.task === "subagent_1").length, 2);
    assert.deepEqual([...new Set(notes.map((note) => note.task))].sort(), ["subagent_1", "subagent_2", "subagent_3"]);
  } finally {
    storage.close();
  }
});

test("an experimental follow-up can resume retained worker context from the prior user turn", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    const inference = new ScriptedInference();
    const currentUser = (request: InferenceRequest) =>
      [...request.messages].reverse().find((message) =>
        message.role === "user" && !rendered(message).startsWith("<agent_prompt"),
      );
    inference
      .on((text) => text.includes("inspect the event page"), () => answer("The organiser says to bring climbing shoes."))
      .on((text) => text.includes("check what to bring") && text.includes("climbing shoes"), () => answer("Bring climbing shoes; that comes from the retained event page context."))
      .on((_text, request) => rendered(currentUser(request)!).includes("Find the event") && !reported(transcript(request)), () =>
        call("first-task", "subagent", {
          description: "Inspect climbing event",
          prompt: "inspect the event page",
          coordination: "independent",
          retain: true,
          tool_groups: ["browser"],
          skill_names: ["browser-use"],
        }))
      .on((_text, request) => rendered(currentUser(request)!).includes("Find the event") && reported(transcript(request)), () => answer("I found the event."))
      .on((text, request) =>
        rendered(currentUser(request)!).includes("What do I need to bring?") &&
        text.includes("<retained_tasks>") && !text.includes('"resumed"'),
      () => call("followup-task", "subagent", {
        description: "Check event requirements",
        prompt: "check what to bring",
        coordination: "independent",
        continue: "subagent_1",
        tool_groups: ["browser"],
        skill_names: ["browser-use"],
      }))
      .on((_text, request) => rendered(currentUser(request)!).includes("What do I need to bring?") && reported(transcript(request)), () => answer("Bring climbing shoes."));

    const agent = testAgent(inference, storage, { orchestrationExperiment: true });
    await agent.start({conversationId: "conversation", text: "Find the event"}).result;
    await agent.settleGoalWork();
    await agent.start({conversationId: "conversation", text: "What do I need to bring?"}).result;

    const followupWorker = inference.requests.find((request) =>
      transcript(request).includes("check what to bring"),
    )!;
    assert.ok(transcript(followupWorker).includes("climbing shoes"));
    const followupParent = inference.requests.find((request) =>
      rendered(currentUser(request)!).includes("What do I need to bring?") &&
      request.messages.some((message) => message.role === "toolResult" && message.toolName === "subagent"),
    )!;
    assert.match(toolResult(followupParent, "subagent"), /"resumed":"subagent_1"/);
  } finally {
    storage.close();
  }
});

/** A tool registry holding one screen tool and one work tool. */
function workAndScreenTools(): ToolRegistry {
  const registry = new ToolRegistry();
  const stub = {
    description: "",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: "" };
    },
  };
  registry.register({ ...stub, name: "workspace_show", mainAgentOnly: true });
  registry.register({ ...stub, name: "browser" });
  return registry;
}

test("a run that can delegate keeps the screen and gives away the work", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    parentRun(storage);
    const inference = new ScriptedInference();
    inference.on(() => true, () => answer("done"));
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: new MemoryManager({
        directory: mkdtempSync(path.join(tmpdir(), "flareai-orchestrator-test-")),
      }),
      tools: workAndScreenTools(),
      model,
      compaction: { enabled: false },
    });

    await agent.start({ conversationId: "conversation", text: "find me events" })
      .result;
    const coordinator = inference.requests[0]?.tools?.map((tool) => tool.name) ?? [];
    // It can dispatch, wait, take stock, and put things on screen. It cannot
    // browse: holding the work tool is what made it do the work itself.
    assert.deepEqual(
      ["subagent", "wait_subagent", "check_subagents", "workspace_show"].filter((name) =>
        coordinator.includes(name),
      ),
      ["subagent", "wait_subagent", "check_subagents", "workspace_show"],
    );
    assert.ok(
      !coordinator.includes("wait_all_subagents"),
      "the baseline tool surface must stay unchanged",
    );
    assert.ok(!coordinator.includes("browser"), "the coordinator must not browse");

    await agent.start({
      conversationId: "conversation",
      text: "browse it",
      parentRunId: "parent",
      includeSubagents: false,
    }).result;
    const worker = inference.requests[1]?.tools?.map((tool) => tool.name) ?? [];
    assert.ok(worker.includes("browser"), "the run doing the work needs the tool");
    assert.ok(!worker.includes("workspace_show"));
    assert.ok(!worker.includes("subagent"), "subagents cannot delegate further");
  } finally {
    storage.close();
  }
});

test("the experiment gives simple single-domain actions a direct tool fast path", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    const inference = new ScriptedInference();
    inference.on(() => true, () => answer("done"));
    const tools = new ToolRegistry();
    tools.register({
      name: "reminders_list",
      description: "List reminders",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: "[]" }; },
    });
    tools.register({
      name: "browser_read",
      description: "Read a browser page",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: "page" }; },
    });
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: new MemoryManager({
        directory: mkdtempSync(path.join(tmpdir(), "flareai-fast-path-test-")),
      }),
      tools,
      model,
      computerHistory: {
        promptContext: () => ({
          directory: "/computer-history",
          instructionsPath: "/computerHistory/README.md",
          enabled: true,
        }),
      },
      drive: {
        promptContext: () => ({
          defaultSource: "local",
          order: ["local"],
          connected: [],
          reach: [],
        }),
      },
      compaction: { enabled: false },
      orchestrationExperiment: true,
      prompts: {direct: "DIRECT FAST-PATH POLICY"},
    });

    await agent.start({ conversationId: "conversation", text: "List my reminders" }).result;
    const direct = inference.requests[0]?.tools?.map((tool) => tool.name) ?? [];
    assert.ok(direct.includes("reminders_list"));
    assert.ok(!direct.includes("browser_read"), "irrelevant host schemas stay out");
    assert.ok(direct.includes("recall"), "personal context remains available");
    assert.ok(direct.includes("search_history"), "conversation evidence remains available");
    assert.ok(!direct.includes("get_goal"), "unrelated goal controls stay out");
    assert.ok(!direct.includes("subagent"));
    assert.match(transcript(inference.requests[0]!), /<agent_prompt name="direct">[\s\S]*DIRECT FAST-PATH POLICY/);
    assert.doesNotMatch(transcript(inference.requests[0]!), /<agent_prompt name="main">/);
    assert.doesNotMatch(inference.requests[0]?.systemPrompt ?? "", /## ComputerHistory|## Where work is saved/);

    await agent.start({
      conversationId: "conversation",
      text: "Research and compare my reminder systems",
    }).result;
    const orchestrated = inference.requests[1]?.tools?.map((tool) => tool.name) ?? [];
    assert.ok(orchestrated.includes("subagent"));
    assert.ok(!orchestrated.includes("reminders_list"));

    await agent.start({
      conversationId: "conversation",
      text: "List my reminders",
      includeSubagents: false,
    }).result;
    const unbounded = inference.requests[2]?.tools?.map((tool) => tool.name) ?? [];
    assert.ok(unbounded.includes("browser_read"));
    assert.ok(
      JSON.stringify(inference.requests[0]?.tools).length <
      JSON.stringify(inference.requests[2]?.tools).length,
      "direct routing must reduce the offered tool schema",
    );
  } finally {
    storage.close();
  }
});

test("single-site discovery and its immediate follow-up keep browser work on the main agent", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    const inference = new ScriptedInference();
    inference.on(() => true, () => answer("done"));
    const tools = new ToolRegistry();
    for (const name of ["browser", "browser_read", "browser_snapshot_many", "browser_tabs", "browser_control", "email_read"]) {
      tools.register({
        name,
        description: name,
        parameters: { type: "object", properties: {} },
        async execute() { return { content: "ok" }; },
      });
    }
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: new MemoryManager({
        directory: mkdtempSync(path.join(tmpdir(), "flareai-discovery-fast-path-test-")),
      }),
      tools,
      model,
      compaction: { enabled: false },
      orchestrationExperiment: true,
    });

    await agent.start({
      conversationId: "conversation",
      text: "Find the latest events from NUSync that I might be interested in",
    }).result;
    const discovery = inference.requests[0]?.tools?.map((tool) => tool.name) ?? [];
    assert.ok(discovery.includes("browser_read"));
    assert.ok(discovery.includes("browser_snapshot_many"));
    assert.ok(!discovery.includes("browser_tabs"));
    assert.ok(!discovery.includes("browser_control"));
    assert.ok(discovery.includes("recall"));
    assert.ok(!discovery.includes("email_read"));
    assert.ok(!discovery.includes("subagent"));

    await agent.start({
      conversationId: "conversation",
      text: "Which one would you pick for me if I can only go on Friday evening, and what would I need to bring?",
    }).result;
    const followUp = inference.requests[1]?.tools?.map((tool) => tool.name) ?? [];
    assert.ok(followUp.includes("browser_read"));
    assert.ok(!followUp.includes("subagent"));

    await agent.start({
      conversationId: "conversation",
      text: "Compare NUSync with Eventbrite and check my messages",
    }).result;
    const multiSource = inference.requests[2]?.tools?.map((tool) => tool.name) ?? [];
    assert.ok(multiSource.includes("subagent"));
    assert.ok(!multiSource.includes("browser_read"));
  } finally {
    storage.close();
  }
});

test("the direct action fast path removes the dispatch and relay inferences", async () => {
  const makeAgent = (storage: SqliteStorage, inference: ScriptedInference) => {
    const tools = new ToolRegistry();
    tools.register({
      name: "reminders_list",
      description: "List reminders",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: "Buy milk" }; },
    });
    return new FlareAIAgent({
      inference,
      storage,
      memory: new MemoryManager({
        directory: mkdtempSync(path.join(tmpdir(), "flareai-fast-turns-test-")),
      }),
      tools,
      model,
      compaction: { enabled: false },
      orchestrationExperiment: true,
    });
  };
  const rules = (inference: ScriptedInference) => {
    const calls = multiCall();
    return inference
    .on((text, request) => !text.includes("task(…)") && Boolean(request.tools?.some((tool) => tool.name === "subagent")), () =>
      calls.many([
        { name: "subagent", args: { description: "List reminders", prompt: "List my reminders" } },
        { name: "wait_all_subagents", args: { timeout_ms: 5_000 } },
      ]))
    .on((text, request) => !text.includes("Buy milk") && Boolean(request.tools?.some((tool) => tool.name === "reminders_list")), () =>
      call("list", "reminders_list", {}))
    .on((text) => text.includes("Buy milk"), () => answer("Buy milk"))
    .on((text) => reported(text), () => answer("Buy milk"));
  };

  const directStorage = new SqliteStorage(":memory:");
  const delegatedStorage = new SqliteStorage(":memory:");
  try {
    conversation(directStorage);
    conversation(delegatedStorage);
    const directInference = rules(new ScriptedInference());
    await makeAgent(directStorage, directInference).start({
      conversationId: "conversation",
      text: "List my reminders",
    }).result;
    assert.equal(directInference.requests.length, 2, "tool call then final answer");

    const delegatedInference = rules(new ScriptedInference());
    await makeAgent(delegatedStorage, delegatedInference).start({
      conversationId: "conversation",
      text: "List my reminders",
      includeSubagents: true,
    }).result;
    assert.equal(
      delegatedInference.requests.length,
      4,
      "dispatch, worker tool, worker result, coordinator relay",
    );
  } finally {
    directStorage.close();
    delegatedStorage.close();
  }
});

test("each run is given the brief for the job it is doing", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    parentRun(storage);
    // A conversation with history, so the placement below is meaningful.
    storage.appendMessage({
      id: "asked",
      conversationId: "conversation",
      role: "user",
      content: "find me events",
    });
    const inference = new ScriptedInference();
    inference.on(() => true, () => answer("done"));
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: new MemoryManager({
        directory: mkdtempSync(path.join(tmpdir(), "flareai-orch-mem-")),
      }),
      tools: new ToolRegistry(),
      model,
      prompts: {
        main: "Delegate the work, not the relationship.",
        task: "Your closing message is the deliverable.",
      },
      compaction: { enabled: false },
    });

    await agent.start({ conversationId: "conversation", text: "find me events" })
      .result;
    const coordinator = transcript(inference.requests[0]!);
    // Loaded into the run, not built into the system prompt: the coordinator
    // has the policy in front of it without having to choose to open it, and
    // no subagent pays for it.
    assert.match(coordinator, /<agent_prompt name="main">/);
    assert.match(coordinator, /Delegate the work, not the relationship\./);
    assert.doesNotMatch(
      inference.requests[0]?.systemPrompt ?? "",
      /Delegate the work, not the relationship\./,
    );

    await agent.start({
      conversationId: "conversation",
      text: "do the piece",
      parentRunId: "parent",
      includeSubagents: false,
    }).result;
    // The worker gets its own brief, never the coordinator's: it has no one to
    // delegate to and no one to ask.
    const worker = transcript(inference.requests[1]!);
    assert.match(worker, /<agent_prompt name="subagent">/);
    assert.match(worker, /Your closing message is the deliverable\./);
    assert.doesNotMatch(worker, /Delegate the work, not the relationship\./);
    assert.doesNotMatch(coordinator, /Your closing message is the deliverable\./);

    // It sits with the turn it governs, not at the head of the conversation:
    // a message with no stored row at index 0 stops compaction reusing any
    // summary it has already paid for.
    const first = inference.requests[0]!;
    assert.ok(
      !rendered(first.messages[0]!).includes("agent_prompt"),
      "the prompt must not displace the conversation's first message",
    );
    // Immediately before the turn it governs: the last thing read before the
    // model acts, and the user's own message still last.
    assert.match(rendered(first.messages.at(-2)!), /agent_prompt/);
    assert.equal(rendered(first.messages.at(-1)!), "find me events");
  } finally {
    storage.close();
  }
});

test("the shipped agent prompts are the ones the internal agents run on", async () => {
  const directory = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../resources/prompts",
  );
  const prompts = loadAgentPrompts(directory);
  // Every name the loader knows has a file: a prompt that silently falls back
  // to the code is a prompt nobody can edit where they were told to edit it.
  for (const name of AGENT_PROMPT_NAMES)
    assert.ok(prompts[name], `resources/prompts/${name}.md must exist`);
  assert.match(prompts.base ?? "", /You are Flare/);
  assert.match(prompts.direct ?? "", /bounded request/i);
  assert.match(prompts.main ?? "", /delegate/i);
  assert.match(
    prompts.main ?? "",
    /resumes an unfinished multi-step goal[\s\S]*at most two independent tasks[\s\S]*Do not[\s\S]*second wave[\s\S]*keep the unfinished goal active/i,
  );
  // How to reply to the user belongs to the agent that talks to them: a
  // delegated run writes for the coordinator, and is told so in its own brief.
  assert.match(prompts.main ?? "", /## How you reply/);
  assert.doesNotMatch(prompts.task ?? "", /## How you reply/);
  assert.match(prompts.task ?? "", /closing message/i);
  // The two that state a number carry it as a placeholder, not as prose that
  // has drifted from whatever the code actually passes.
  assert.match(prompts.consolidation ?? "", /\{budget\}/);
  assert.match(prompts.distillation ?? "", /\{limit\}/);
  assert.equal(fillPrompt("under {budget} characters", { budget: "46,000" }), "under 46,000 characters");
  assert.equal(fillPrompt("keep {unknown}", {}), "keep {unknown}");

  const experiment = loadAgentPrompts(
    directory,
    path.join(directory, "experiments", "orchestration"),
  );
  assert.doesNotMatch(prompts.main ?? "", /Experimental context routing/);
  assert.match(experiment.main ?? "", /Experimental context routing/);
  assert.match(experiment.direct ?? "", /at most one general web search/i);
  assert.match(experiment.direct ?? "", /verified candidate set[\s\S]*Do not reopen every candidate[\s\S]*choose first[\s\S]*at most that chosen item/i);
  assert.match(experiment.direct ?? "", /contextual communication follow-up[\s\S]*Do not call[\s\S]*discovery again[\s\S]*no reply-shaped candidate[\s\S]*create nothing/i);
  assert.match(experiment.direct ?? "", /Officially required[\s\S]*Optional suggestions/i);
  assert.match(experiment.direct ?? "", /`Upcoming` means its[\s\S]*start is still in the future[\s\S]*registration deadline[\s\S]*closed/i);
  assert.match(experiment.direct ?? "", /continue what I was doing before I switched[\s\S]*read_previous_screen_work[\s\S]*do not load skills/i);
  assert.match(experiment.direct ?? "", /exact next command[\s\S]*run that command directly/i);
  assert.match(experiment.direct ?? "", /Final answer gate[\s\S]*Remove internal deliberation[\s\S]*rank future actionable options before every ongoing item/i);
  assert.match(experiment.main ?? "", /dispatch two tasks at\s+once/i);
  assert.match(experiment.main ?? "", /relative mail windows[\s\S]*exact local ISO cutoff[\s\S]*90 calendar days[\s\S]*never substitute today's date[\s\S]*email-triage[\s\S]*skill_names: \[\]/i);
  assert.match(experiment.main ?? "", /get me ready for\s+tomorrow/i);
  assert.match(experiment.main ?? "", /current open\/live state[\s\S]*personal commitments[\s\S]*recent\s+communications/i);
  assert.match(experiment.main ?? "", /no relevant page\/window[\s\S]*dispatch no current-state worker/i);
  assert.match(experiment.main ?? "", /external-window URL[\s\S]*browser-research[\s\S]*never route an `http\(s\)` URL to the file `read` tool/i);
  assert.match(experiment.main ?? "", /readiness brief[\s\S]*exactly one worker combining[\s\S]*`email-triage` and `messages-read`[\s\S]*together in its first turn/i);
  assert.match(experiment.main ?? "", /membership\/recruitment[\s\S]*independent unless the source explicitly links them[\s\S]*must not become advice to miss or delay/i);
  assert.match(experiment.main ?? "", /memory summary directly[\s\S]*never dispatch a worker solely/i);
  assert.match(experiment.main ?? "", /communication triage request[\s\S]*one tightly bounded communication[\s\S]*both email and chat read routes[\s\S]*together in its first turn/i);
  assert.match(experiment.main ?? "", /communication triage request[\s\S]*exact local ISO date[\s\S]*email-triage[\s\S]*messages-read/i);
  assert.match(experiment.main ?? "", /draft replies to the ones[\s\S]*Do not delegate or repeat[\s\S]*preserve the no-send boundary/i);
  assert.match(experiment.main ?? "", /ComputerHistory is a\s+fallback only/i);
  assert.match(experiment.main ?? "", /continue or finish what they were doing[\s\S]*exactly one sequential worker/i);
  assert.match(experiment.main ?? "", /resolve the immediately previous workflow with ComputerHistory first[\s\S]*continue authorises ordinary reversible work/i);
  assert.match(experiment.main ?? "", /latest file I was editing[\s\S]*exactly one[\s\S]*computerHistory[\s\S]*do not give it[\s\S]*Drive[\s\S]*return that source as unavailable/i);
  assert.match(experiment.main ?? "", /Pass `skill_names: \[\]` when the native[\s\S]*name a skill only when its workflow/i);
  assert.match(experiment.main ?? "", /most detailed[\s\S]*memory[\s\S]*application protocol[\s\S]*current\s+client/i);
  assert.match(experiment.main ?? "", /learning request[\s\S]*lecture material[\s\S]*one bounded context worker[\s\S]*organising framework/i);
  assert.match(experiment.main ?? "", /unnamed target[\s\S]*independent of the target[\s\S]*dependency review[\s\S]*exact\s+resolved absolute path/i);
  assert.match(experiment.main ?? "", /Do not draft, send, move,\s+create/i);
  assert.match(experiment.main ?? "", /Do not repeat the\s+initial discovery search/i);
  assert.match(experiment.main ?? "", /separate items the official source explicitly requires[\s\S]*Never invent customary food/i);
  assert.match(experiment.main ?? "", /Officially required:[\s\S]*Optional suggestions/i);
  assert.match(experiment.main ?? "", /one named website[\s\S]*at most one general web\s+search/i);
  assert.match(experiment.main ?? "", /exact direct\s+first-party detail URL/i);
  assert.match(experiment.main ?? "", /`Upcoming` means it has not started[\s\S]*ongoing[\s\S]*passed signup or application deadline[\s\S]*closed/i);
  assert.match(experiment.main ?? "", /venue and place recommendations[\s\S]*exact address[\s\S]*requested-day opening hours[\s\S]*Never\s+infer a campus/i);
  assert.match(experiment.main ?? "", /one independent discovery worker per[\s\S]*source family/i);
  assert.match(experiment.main ?? "", /merge candidates by canonical URL or verified identity/i);
  assert.match(experiment.main ?? "", /short shortlist[\s\S]*at most three[\s\S]*stop once that quota is filled/i);
  assert.match(experiment.main ?? "", /Cancel only the exact now-obsolete workers[\s\S]*cancel_subagents/i);
  assert.match(experiment.main ?? "", /cancel_subagents[\s\S]*wait_all_subagents[\s\S]*same response/i);
  assert.match(experiment.main ?? "", /wait_all_subagents/);
  assert.match(experiment.task ?? "", /Experimental tool efficiency/);
  assert.match(experiment.task ?? "", /multi-purpose[\s\S]*intended current client[\s\S]*remembered services as candidates/i);
  assert.match(experiment.task ?? "", /unnamed target[\s\S]*target-independent audit work[\s\S]*dependency edges[\s\S]*Never recursively search the home directory[\s\S]*deterministic read-only audit[\s\S]*first and only tool call[\s\S]*resolved absolute `SKILL\.md` directory/i);
  assert.match(experiment.task ?? "", /context-discovery task[\s\S]*read_previous_screen_work[\s\S]*at most one distinctive[\s\S]*subject-level framework/i);
  assert.match(experiment.task ?? "", /contributes candidates to a larger comparison[\s\S]*canonical[\s\S]*coordinator owns cross-worker deduplication/i);
  assert.match(experiment.task ?? "", /one broad discovery query[\s\S]*hard six-call budget[\s\S]*never submit a seventh/i);
  assert.match(experiment.task ?? "", /scoped shortcut consumes[\s\S]*Never issue a\s+second `site:` query[\s\S]*do not\s+reopen/i);
  assert.match(experiment.task ?? "", /source-coverage gap only when it is material[\s\S]*email account timeout does not make a live\s+messaging platform unavailable/i);
  assert.match(experiment.main ?? "", /Relay worker findings at their exact evidential strength[\s\S]*Never add an app's\s+purpose[\s\S]*preserve[\s\S]*uncertainty/i);
  assert.match(experiment.main ?? "", /Every assistant text block is visible[\s\S]*Never expose internal\s+deliberation[\s\S]*call it directly/i);
  assert.match(experiment.task ?? "", /verified candidates[\s\S]*unresolved leads/i);
  assert.match(experiment.task ?? "", /at most six combined[\s\S]*one discovery read[\s\S]*up to three/i);
  assert.match(experiment.task ?? "", /current place or venue recommendation[\s\S]*exact first-party detail page[\s\S]*Do not infer location/i);
  assert.match(experiment.task ?? "", /hard acceptance constraints[\s\S]*not a[\s\S]*recommendation merely because[\s\S]*caveat/i);
  assert.match(experiment.main ?? "", /Do not resume a completed research worker merely to reset its tool budget/i);
  assert.match(experiment.task ?? "", /`Upcoming` starts in the future[\s\S]*exclude[\s\S]*ended[\s\S]*passed registration deadline[\s\S]*closed/i);
  assert.match(experiment.task ?? "", /read_previous_screen_work[\s\S]*Do not load ComputerHistory reference files[\s\S]*Resolve[\s\S]*before using any action tool/i);
  assert.match(experiment.task ?? "", /previous\.frame[\s\S]*already resolved[\s\S]*do not call `read_screen_history`/i);
  assert.match(experiment.task ?? "", /never preserve the clock digits while changing their timezone offset/i);
  assert.match(experiment.task ?? "", /latest file the user was editing[\s\S]*read_previous_screen_work[\s\S]*do not use[\s\S]*`bash`[\s\S]*`drive_list`/i);
  assert.match(experiment.task ?? "", /query bounded to today[\s\S]*since YYYY-MM-DD[\s\S]*undated or vague/i);
  assert.match(experiment.task ?? "", /email_search_all[\s\S]*complete bounded discovery attempt[\s\S]*do not enumerate folders/i);
  assert.match(experiment.task ?? "", /named person or personal alias in chat[\s\S]*`message_chats`[\s\S]*ambiguous[\s\S]*organisation or words[\s\S]*`message_search`[\s\S]*at\s+most two targeted refinements/i);
  assert.match(experiment.main ?? "", /dynamic index page is not evidence[\s\S]*NUSync event detail or RSVP pages[\s\S]*verify up to\s+three official results/i);
  assert.match(experiment.main ?? "", /direct question about one named person or personal alias[\s\S]*`message_chats`[\s\S]*coverage is disconnected or unavailable[\s\S]*never phrase the miss as proof/i);
  assert.match(experiment.task ?? "", /tomorrow-readiness commitment recovery[\s\S]*at most one `recall`, two[\s\S]*`search_history`/i);
  assert.match(experiment.task ?? "", /independent deadlines and actions[\s\S]*does not invalidate a separately stated club[\s\S]*signup deadline/i);
  assert.match(experiment.task ?? "", /location-only query does not cover job status[\s\S]*assessment, interview, application, offer, and rejection/i);
  assert.match(experiment.task ?? "", /do not call `email_search_all`\s+again/i);
  assert.match(experiment.task ?? "", /switch immediately to `browser`/);
  assert.match(experiment.task ?? "", /follow its exact ref in that same tab/);
  assert.match(experiment.task ?? "", /semantic control whose label names a requested missing field/);
  assert.match(experiment.task ?? "", /before reporting the field\s+as unavailable/);
  assert.match(experiment.task ?? "", /announced future change/i);
  assert.match(experiment.task ?? "", /Close each one.*changed/s);
  assert.match(experiment.task ?? "", /geographic login\/security alert[\s\S]*not a travel[\s\S]*Exclude it/i);
});
