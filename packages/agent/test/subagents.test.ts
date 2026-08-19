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
import {
  AGENT_PROMPT_NAMES,
  fillPrompt,
  loadAgentPrompts,
  MemoryManager,
  FlareAIAgent,
} from "../src/index.js";

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

function testAgent(inference: InferenceService, storage: SqliteStorage) {
  return new FlareAIAgent({
    inference,
    storage,
    memory: new MemoryManager({
      directory: mkdtempSync(path.join(tmpdir(), "flareai-subagent-test-")),
    }),
    tools: new ToolRegistry(),
    model,
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
          return call("call-1", "task", {
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
          call("call-1", "task", {
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
    assert.match(last, /"task":"task_1"/);
    assert.match(last, /"status":"completed"/);
    assert.match(last, /42 events found/);
  } finally {
    storage.close();
  }
});

test("wait_task says which task moved, never what it said", async () => {
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
          call("call-1", "task", {
            description: "Research",
            prompt: "child work",
          }),
      )
      .on(
        (text) => text.includes("task(") && !text.includes("wait_task("),
        () => {
          releaseChild();
          return call("call-2", "wait_task", { timeout_ms: 5_000 });
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
      toolResult(request, "wait_task").includes('"updated"'),
    );
    assert.ok(afterWait, "the wait's result must reach the model");
    const waitResult = toolResult(afterWait, "wait_task");
    assert.match(waitResult, /"updated":\["task_1"\]/);
    assert.ok(
      !waitResult.includes("the secret finding"),
      "wait_task must not repeat the result the notification already carries",
    );
    assert.match(transcript(afterWait), /the secret finding/);
  } finally {
    storage.close();
  }
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
          call("call-1", "task", {
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

/** The state of a scripted pull worker's claim loop, read off its own
 * transcript: what it has claimed but not yet updated, and whether the pool
 * has anything left for it. */
function claimedState(request: InferenceRequest): {
  pending: string[];
  lastRemaining: number;
  lastClaimedCount: number;
  hasClaimed: boolean;
} {
  const updated = new Set<string>();
  const claimed: string[] = [];
  let lastRemaining = 0;
  let lastClaimedCount = 0;
  let hasClaimed = false;
  for (const message of request.messages) {
    if (message.role === "toolResult" && message.toolName === "ledger_claim") {
      const parsed = JSON.parse(rendered(message));
      hasClaimed = true;
      lastRemaining = parsed.remaining;
      lastClaimedCount = parsed.claimed.length;
      for (const item of parsed.claimed) claimed.push(item.key);
    }
    if (message.role === "assistant" && Array.isArray(message.content))
      for (const block of message.content)
        if (block.type === "toolCall" && block.name === "ledger_update")
          updated.add(String(block.arguments.key));
  }
  return {
    pending: claimed.filter((key) => !updated.has(key)),
    lastRemaining,
    lastClaimedCount,
    hasClaimed,
  };
}

test("a ledger pipeline analyses each found event exactly once", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    const calls = multiCall();
    const inference = new ScriptedInference();
    // The pull loop every analysis worker runs: update what is claimed but
    // unfinished, claim more while the pool has any, stop when it is empty.
    const analysisReply = (request: InferenceRequest): InferenceEvent => {
      const state = claimedState(request);
      if (state.pending.length)
        return calls.one("ledger_update", {
          key: state.pending[0]!,
          status: "analyzed",
          summary: `analysis of ${state.pending[0]}`,
        });
      if (!state.hasClaimed || (state.lastClaimedCount > 0 && state.lastRemaining > 0))
        return calls.one("ledger_claim", { kind: "event", limit: 2 });
      return answer("analysis finished");
    };

    inference
      // The orchestrator: discover, search in parallel, analyse in parallel,
      // then read the whole pool back. Between phases it waits for news.
      .on(
        (text) => text.includes("Run the pipeline") && !text.includes("task("),
        () =>
          calls.many([
            {
              name: "task",
              args: {
                description: "Discover categories",
                prompt: "discovery instructions",
                ledger: true,
              },
            },
          ]),
      )
      .on(
        (text) => text.includes("discovery complete") && !text.includes('"task":"task_2"'),
        () =>
          calls.many([
            { name: "task", args: { description: "Search A", prompt: "search A instructions", ledger: true } },
            { name: "task", args: { description: "Search B", prompt: "search B instructions", ledger: true } },
          ]),
      )
      .on(
        (text) => occurrences(text, "search finished") >= 2 && !text.includes('"task":"task_4"'),
        () =>
          calls.many([
            { name: "task", args: { description: "Analyse A", prompt: "analysis A instructions", ledger: true } },
            { name: "task", args: { description: "Analyse B", prompt: "analysis B instructions", ledger: true } },
          ]),
      )
      .on(
        (text) => occurrences(text, "analysis finished") >= 2 && !text.includes("ledger_list("),
        () => calls.one("ledger_list", { kind: "event", status: "analyzed", limit: 100 }),
      )
      .on(
        (text) => text.includes("Run the pipeline") && text.includes("ledger_list("),
        () => answer("pipeline done"),
      )
      // Discovery posts the category pages.
      .on(
        (text) => text.includes("discovery instructions") && occurrences(text, "ledger_post(") === 0,
        () => calls.one("ledger_post", { key: "cat-social", kind: "category", title: "Social" }),
      )
      .on(
        (text) => text.includes("discovery instructions") && occurrences(text, "ledger_post(") === 1,
        () => calls.one("ledger_post", { key: "cat-sports", kind: "category", title: "Sports" }),
      )
      .on(
        (text) => text.includes("discovery instructions"),
        () => answer("discovery complete"),
      )
      // The search workers post events; one event is found by both.
      .on(
        (text) => text.includes("search A instructions") && occurrences(text, "ledger_post(") === 0,
        () => calls.one("ledger_post", { key: "https://nusync/e1", kind: "event", title: "Welcome Night", category: "Social", date: "Friday" }),
      )
      .on(
        (text) => text.includes("search A instructions") && occurrences(text, "ledger_post(") === 1,
        () => calls.one("ledger_post", { key: "https://nusync/e2", kind: "event", title: "Quiz Night", category: "Social" }),
      )
      .on(
        (text) => text.includes("search A instructions") && occurrences(text, "ledger_post(") === 2,
        () => calls.one("ledger_post", { key: "https://nusync/e3", kind: "event", title: "Sports Taster", category: "Sports" }),
      )
      .on(
        (text) => text.includes("search A instructions"),
        () => answer("search finished"),
      )
      .on(
        (text) => text.includes("search B instructions") && occurrences(text, "ledger_post(") === 0,
        () => calls.one("ledger_post", { key: "https://nusync/e3", kind: "event", title: "Sports Taster", category: "Sports" }),
      )
      .on(
        (text) => text.includes("search B instructions") && occurrences(text, "ledger_post(") === 1,
        () => calls.one("ledger_post", { key: "https://nusync/e4", kind: "event", title: "5K Run", category: "Sports" }),
      )
      .on(
        (text) => text.includes("search B instructions") && occurrences(text, "ledger_post(") === 2,
        () => calls.one("ledger_post", { key: "https://nusync/e5", kind: "event", title: "Climbing Social", category: "Sports" }),
      )
      .on(
        (text) => text.includes("search B instructions"),
        () => answer("search finished"),
      )
      .on(
        (text) => text.includes("analysis A instructions") || text.includes("analysis B instructions"),
        () => analysisReply(inference.requests.at(-1)!),
      )
      .on(() => true, () => calls.one("wait_task", { timeout_ms: 5_000 }));

    const result = await testAgent(inference, storage).start({
      conversationId: "conversation",
      text: "Run the pipeline",
    }).result;

    assert.equal(result.status, "completed");
    assert.equal(result.lastAgentMessage, "pipeline done");

    const finalText = transcript(inference.requests.at(-1)!);
    // The pool drained, and every event came back analysed exactly once —
    // the overlapping find never became two analyses.
    for (const key of ["e1", "e2", "e3", "e4", "e5"].map((id) => `https://nusync/${id}`))
      assert.ok(finalText.includes(`"key":"${key}"`), `${key} must be analysed and listed`);
    assert.equal(occurrences(finalText, '"status":"analyzed"'), 5);
    assert.equal(
      occurrences(finalText, '"key":"https://nusync/e3"'),
      1,
      "the shared event dedups to one row",
    );

    const updates = new Map<string, string>();
    const claims = new Map<string, string[]>();
    for (const request of inference.requests)
      for (const message of request.messages) {
        if (message.role === "assistant" && Array.isArray(message.content))
          for (const block of message.content)
            if (block.type === "toolCall" && block.name === "ledger_update")
              updates.set(block.id, String(block.arguments.key));
        if (message.role === "toolResult" && message.toolName === "ledger_claim")
          claims.set(
            message.toolCallId,
            JSON.parse(rendered(message)).claimed.map((item: { key: string }) => item.key),
          );
      }
    assert.deepEqual(
      [...updates.values()].sort(),
      ["e1", "e2", "e3", "e4", "e5"].map((id) => `https://nusync/${id}`).sort(),
      "each event is analysed exactly once",
    );
    const allClaimed = [...claims.values()].flat();
    assert.equal(
      new Set(allClaimed).size,
      allClaimed.length,
      "parallel claim batches must be disjoint",
    );

    // The re-found event merged instead of duplicating — and the worker saw it.
    const postResults = inference.requests
      .flatMap((request) => request.messages)
      .filter((message) => message.role === "toolResult" && message.toolName === "ledger_post")
      .map((message) => rendered(message));
    assert.ok(
      postResults.some((text) => text.includes('"created":false')),
      "the overlapping post must report created: false",
    );

    // Every ledger-using task settled with a compact, pointer-carrying
    // notification rather than a data dump.
    const notes = notifications(finalText);
    assert.equal(notes.length, 5);
    for (const note of notes)
      assert.ok(note.ledger, "a ledger-using task reports its counts, not its data");
    assert.ok(
      notes.some((note) => (note.ledger as { pool: number }).pool === 7),
      "the last settlement sees the whole pool",
    );
    assert.ok(
      notes.some((note) => (note.ledger as { wrote: { resolved: number } }).wrote.resolved > 0),
      "an analysis task is reported by what it resolved, not by the whole board",
    );
    assert.ok(finalText.includes("[Full data in the shared ledger"));

    // Tools follow the role: the orchestrator reads, the workers write.
    const parentTools = inference.requests[0]?.tools?.map((tool) => tool.name) ?? [];
    assert.ok(parentTools.includes("ledger_list") && parentTools.includes("ledger_stats"));
    assert.ok(!parentTools.includes("ledger_post"), "the orchestrator does not write findings");
    const worker = inference.requests.find((request) =>
      transcript(request).includes("analysis A instructions"),
    );
    const workerTools = worker?.tools?.map((tool) => tool.name) ?? [];
    for (const name of ["ledger_post", "ledger_claim", "ledger_update", "ledger_list"])
      assert.ok(workerTools.includes(name), `the worker needs ${name}`);
    assert.ok(!workerTools.includes("ledger_stats"), "stats are the orchestrator's");
    assert.ok(!workerTools.includes("task"), "subagents cannot delegate further");
  } finally {
    storage.close();
  }
});

test("a ledger-using task's notification is compact and points at the ledger", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    conversation(storage);
    const calls = multiCall();
    const longAnswer = `verdict: ${"the event is relevant and here is why. ".repeat(40)}`;
    const inference = new ScriptedInference();
    inference
      .on(
        (text) => text.includes("ledger child instructions") && !text.includes("ledger_post("),
        () => calls.one("ledger_post", { key: "https://nusync/e1", kind: "event", title: "Welcome Night", category: "Social" }),
      )
      .on(
        (text) => text.includes("ledger child instructions"),
        () => answer(longAnswer),
      )
      .on(
        (text) => text.includes("plain child instructions"),
        () => answer(longAnswer),
      )
      .on(
        (text) => text.includes("Coordinate") && !text.includes("task("),
        () =>
          calls.many([
            { name: "task", args: { description: "Ledger child", prompt: "ledger child instructions", ledger: true } },
            { name: "task", args: { description: "Plain child", prompt: "plain child instructions" } },
          ]),
      )
      .on(() => true, () => answer("wrapped up"));

    await testAgent(inference, storage).start({
      conversationId: "conversation",
      text: "Coordinate the work",
    }).result;

    const last = transcript(inference.requests.at(-1)!);
    const byName = new Map(notifications(last).map((note) => [String(note.task), note]));
    const ledgerNote = byName.get("task_1")!;
    assert.ok(ledgerNote.ledger, "the ledger task's notification carries its counts");
    // Its own writes, not the whole board — the board is the parent's to read
    // with ledger_stats, and repeating it per task would say it once each.
    assert.deepEqual(ledgerNote.ledger, {
      wrote: { posted: 1, claimed: 0, resolved: 0 },
      pool: 1,
    });
    const ledgerResult = String(ledgerNote.result);
    assert.ok(ledgerResult.length < longAnswer.length, "the closing message is capped");
    assert.ok(ledgerResult.includes("[Full data in the shared ledger"));
    const plainNote = byName.get("task_2")!;
    assert.equal(plainNote.ledger, undefined, "a non-ledger task notifies exactly as before");
    assert.equal(String(plainNote.result), longAnswer, "and its message is not capped");
  } finally {
    storage.close();
  }
});

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
            { name: "task", args: { description: "Worker", prompt: "remember the codeword zebra", retain: true } },
            { name: "task", args: { description: "Plain", prompt: "plain work" } },
          ]),
      )
      .on(
        (text) =>
          text.includes("the codeword is zebra") &&
          text.includes("plain done") &&
          !text.includes('"resumed"'),
        () =>
          calls.many([
            { name: "task", args: { description: "Worker follow-up", prompt: "what was the codeword?", continue: "task_1" } },
            { name: "task", args: { description: "Plain follow-up", prompt: "follow up on plain", continue: "task_2" } },
          ]),
      )
      .on(() => true, () => answer("wrapped up"));

    const result = await testAgent(inference, storage).start({
      conversationId: "conversation",
      text: "Coordinate things",
    }).result;
    assert.equal(result.status, "completed");

    // The continued dispatch kept task_1's identity; continuing a task that
    // was never retained fell back to a fresh task with a fresh name.
    const taskCalls = new Map<string, { task: string; resumed?: string }>();
    for (const request of inference.requests)
      for (const message of request.messages)
        if (message.role === "toolResult" && message.toolName === "task")
          taskCalls.set(message.toolCallId, JSON.parse(rendered(message)));
    const dispatched = [...taskCalls.values()];
    assert.deepEqual(
      dispatched.map((entry) => entry.task),
      ["task_1", "task_2", "task_1", "task_3"],
    );
    assert.equal(dispatched[2]!.resumed, "task_1");

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

    // Ledger participation stays opt-in per dispatch.
    const continuedTools = continued.tools?.map((tool) => tool.name) ?? [];
    assert.ok(
      !continuedTools.some((name) => name.startsWith("ledger_")),
      "a dispatch without ledger: true gets no ledger tools",
    );
    const parentTools = inference.requests[0]?.tools?.map((tool) => tool.name) ?? [];
    assert.ok(
      parentTools.includes("ledger_list") && parentTools.includes("ledger_stats"),
      "the delegating run keeps its reads either way",
    );

    // The same task settling twice posts a notification each time, and no
    // ledger block sneaks into a run that never touched the ledger.
    const notes = notifications(transcript(inference.requests.at(-1)!));
    assert.equal(notes.filter((note) => note.task === "task_1").length, 2);
    assert.deepEqual([...new Set(notes.map((note) => note.task))].sort(), ["task_1", "task_2", "task_3"]);
    assert.ok(notes.every((note) => !("ledger" in note)));
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
      ["task", "wait_task", "check_tasks", "workspace_show"].filter((name) =>
        coordinator.includes(name),
      ),
      ["task", "wait_task", "check_tasks", "workspace_show"],
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
    assert.ok(!worker.includes("task"), "subagents cannot delegate further");
  } finally {
    storage.close();
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
    assert.match(worker, /<agent_prompt name="task">/);
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
  assert.match(prompts.main ?? "", /delegate/i);
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
});
