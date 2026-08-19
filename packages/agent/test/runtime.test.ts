import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type {
  InferenceEvent,
  InferenceModel,
  InferenceRequest,
  InferenceService,
  ModelRef,
} from "@flareai/inference";
import { SqliteStorage } from "@flareai/storage/sqlite";
import { ToolRegistry } from "@flareai/tools";
import {
  CompactionManager,
  createTaskTool,
  MemoryManager,
  FlareAIAgent,
} from "../src/index.js";

const model = { provider: "test", id: "model" };
const modelInfo: InferenceModel = {
  provider: "test",
  id: "model",
  name: "Model",
  contextWindow: 100,
  maxOutputTokens: 20,
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

class FakeInference implements InferenceService {
  readonly requests: InferenceRequest[] = [];
  readonly responses: InferenceEvent[][] = [];
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
    for (const event of this.responses.shift() ?? []) yield event;
  }
}

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

function testMemory(): MemoryManager {
  return new MemoryManager({
    directory: mkdtempSync(path.join(tmpdir(), "flareai-memory-test-")),
  });
}

test("treats slash-prefixed text as an ordinary chat message", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    inference.responses.push([answer("ordinary response")]);
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: false },
    });

    await agent.start({
      conversationId: "conversation",
      text: "/goal this is just text",
      includeSubagents: false,
    }).result;

    assert.equal(
      (inference.requests[0]?.messages[0] as { content: string }).content,
      "/goal this is just text",
    );
    assert.equal(storage.getGoal("conversation"), null);
  } finally {
    storage.close();
  }
});

test("persists assistant messages tagged with their run phase", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    inference.responses.push(
      [
        {
          type: "done",
          reason: "toolUse",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Let me check that." },
              { type: "toolCall", id: "call-1", name: "probe", arguments: {} },
            ],
            usage,
            stopReason: "toolUse",
          },
        },
      ],
      [answer("Here is the answer.")],
    );
    const tools = new ToolRegistry();
    tools.register({
      name: "probe",
      description: "Probe",
      parameters: { type: "object" },
      async execute() {
        return { content: "ok" };
      },
    });
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools,
      model,
      compaction: { enabled: false },
    });

    await agent.start({
      conversationId: "conversation",
      text: "check something",
      includeSubagents: false,
    }).result;

    const assistants = storage
      .listMessages("conversation")
      .filter((message) => message.role === "assistant");
    assert.equal(assistants.length, 2);
    assert.deepEqual(assistants[0]?.metadata, { phase: "commentary" });
    assert.deepEqual(assistants[1]?.metadata, { phase: "final" });
  } finally {
    storage.close();
  }
});

test("creates a durable goal only from structured run metadata", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    inference.responses.push([answer("working")]);
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: false },
      goalLoop: { enabled: false },
    });

    await agent.start({
      conversationId: "conversation",
      text: "Research a mechatronics project",
      asGoal: true,
      includeSubagents: false,
    }).result;
    await agent.settleGoalWork();

    assert.equal(
      storage.getGoal("conversation")?.objective,
      "Research a mechatronics project",
    );
    assert.deepEqual(storage.listMessages("conversation")[0]?.metadata, {
      asGoal: true,
    });
  } finally {
    storage.close();
  }
});

test("subagent context modes isolate prior conversation messages", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    storage.appendMessage({
      id: "old",
      conversationId: "conversation",
      role: "user",
      content: "private prior context",
    });
    storage.createRun({
      id: "parent",
      conversationId: "conversation",
      status: "running",
    });
    const inference = new FakeInference();
    inference.responses.push([answer("child result")]);
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: false },
    });
    const result = await agent.start({
      conversationId: "conversation",
      text: "bounded child task",
      parentRunId: "parent",
      includeSubagents: false,
      contextMode: "none",
    }).result;

    assert.equal(result.status, "completed");
    assert.deepEqual(inference.requests[0]?.messages, [
      { role: "user", content: "bounded child task" },
    ]);
  } finally {
    storage.close();
  }
});

test("persists attachments and restores their paths into later context", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    inference.responses.push([answer("received")], [answer("remembered")]);
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: false },
    });
    await agent.start({
      conversationId: "conversation",
      text: "Review this",
      attachments: ["/tmp/report.pdf"],
      includeSubagents: false,
    }).result;
    await agent.start({
      conversationId: "conversation",
      text: "What was attached?",
      includeSubagents: false,
    }).result;

    assert.equal(
      storage.listAttachments(storage.listMessages("conversation")[0]!.id)[0]
        ?.name,
      "report.pdf",
    );
    assert.match(
      (inference.requests[1]?.messages[0] as { content: string }).content,
      /\/tmp\/report\.pdf/,
    );
  } finally {
    storage.close();
  }
});

test("compaction reuses its summary while the compacted context still fits", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    inference.responses.push([answer("durable summary")]);
    const manager = new CompactionManager(inference, storage, {
      reserveTokens: 20,
      keepRecentTokens: 10,
    });
    const messages = [
      { role: "user" as const, content: "a".repeat(400) },
      { role: "user" as const, content: "recent" },
    ];
    let compactionReports = 0;
    const first = await manager.transform(
      "conversation",
      model,
      { messages },
      new AbortController().signal,
      async () => { compactionReports += 1; },
    );
    const second = await manager.transform(
      "conversation",
      model,
      { messages: [...messages, { role: "user", content: "new" }] },
      new AbortController().signal,
    );

    assert.equal(inference.requests.length, 1);
    assert.equal(compactionReports, 1);
    assert.match(first.systemPrompt ?? "", /durable summary/);
    assert.match(second.systemPrompt ?? "", /durable summary/);
    // The summary is prior context, never a turn attributed to the user.
    assert.ok(
      !JSON.stringify(first.messages).includes("durable summary"),
      "summary must not be injected as a message",
    );
    assert.equal(
      storage.getLatestCompaction("conversation")?.summary,
      "durable summary",
    );
  } finally {
    storage.close();
  }
});

test("a long conversation is compacted before the model ever sees it", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    for (let index = 0; index < 4; index += 1)
      storage.appendMessage({
        id: `old-${index}`,
        conversationId: "conversation",
        role: "user",
        content: `earlier turn ${index} ${"detail ".repeat(60)}`,
      });
    const inference = new FakeInference();
    inference.responses.push([answer("compacted earlier context")]);
    inference.responses.push([answer("answer")]);
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: true, reserveTokens: 20, keepRecentTokens: 40 },
      goalLoop: { enabled: false },
      memoryConsolidation: { enabled: false },
    });

    await agent.start({
      conversationId: "conversation",
      text: "next question",
      includeSubagents: false,
    }).result;
    await agent.settleGoalWork();

    // First request is the compaction pass, second is the turn itself.
    assert.equal(inference.requests.length, 2);
    const turn = inference.requests[1];
    assert.match(turn?.systemPrompt ?? "", /## Earlier conversation/);
    assert.match(turn?.systemPrompt ?? "", /compacted earlier context/);
    assert.ok(
      !JSON.stringify(turn?.messages).includes("earlier turn 0"),
      "compacted turns must not still be in the message list",
    );
    assert.equal(
      storage.getLatestCompaction("conversation")?.summary,
      "compacted earlier context",
    );
  } finally {
    storage.close();
  }
});

test("the compaction watermark marks the real boundary in stored history", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    // A row that never becomes an inference message, so stored positions and
    // context positions no longer line up. Indexing one list with the other's
    // offset lands on the wrong row, which is what this pins down.
    storage.appendMessage({
      id: "system-note",
      conversationId: "conversation",
      role: "system",
      content: "session note",
    });
    for (let index = 0; index < 4; index += 1)
      storage.appendMessage({
        id: `old-${index}`,
        conversationId: "conversation",
        role: "user",
        content: `earlier turn ${index} ${"detail ".repeat(60)}`,
      });
    const inference = new FakeInference();
    inference.responses.push([answer("compacted earlier context")]);
    inference.responses.push([answer("answer")]);
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: true, reserveTokens: 20, keepRecentTokens: 40 },
      goalLoop: { enabled: false },
      memoryConsolidation: { enabled: false },
    });

    await agent.start({
      conversationId: "conversation",
      text: "next question",
      includeSubagents: false,
    }).result;
    await agent.settleGoalWork();

    const watermark =
      storage.getLatestCompaction("conversation")?.throughMessageSequence ?? 0;
    assert.ok(watermark > 0, "a compaction must record how far it reached");
    // The watermark is a boundary: everything at or below it was summarized
    // away, everything above it is still in the turn the model was given.
    const turn = JSON.stringify(inference.requests[1]?.messages);
    for (const message of storage
      .listMessages("conversation")
      .filter((item) => item.role === "user")) {
      const inContext = turn.includes(String(message.content));
      assert.equal(
        inContext,
        message.sequence > watermark,
        `message ${message.sequence} sits on the wrong side of watermark ${watermark}`,
      );
    }
  } finally {
    storage.close();
  }
});

test("a saved summary is reused after a restart instead of being rebuilt", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const older = storage.appendMessage({
      id: "older",
      conversationId: "conversation",
      role: "user",
      content: "a".repeat(400),
    });
    const recent = storage.appendMessage({
      id: "recent",
      conversationId: "conversation",
      role: "user",
      content: "recent",
    });
    const messages = [
      { role: "user" as const, content: "a".repeat(400) },
      { role: "user" as const, content: "recent" },
    ];
    const sequences = [older.sequence, recent.sequence];
    const settings = { reserveTokens: 20, keepRecentTokens: 10 };
    const signal = new AbortController().signal;

    const before = new FakeInference();
    before.responses.push([answer("durable summary")]);
    const compacted = await new CompactionManager(
      before,
      storage,
      settings,
    ).transform("conversation", model, { messages }, signal, undefined, sequences);
    assert.match(compacted.systemPrompt ?? "", /durable summary/);
    assert.equal(before.requests.length, 1);

    // A manager built fresh over the same storage is what the next launch is:
    // no in-memory cache, only what was written to disk. Its queue is empty, so
    // any attempt to summarize again fails loudly rather than passing quietly.
    const after = new FakeInference();
    const resumed = await new CompactionManager(
      after,
      storage,
      settings,
    ).transform("conversation", model, { messages }, signal, undefined, sequences);

    assert.match(resumed.systemPrompt ?? "", /durable summary/);
    assert.equal(after.requests.length, 0, "the saved summary must be reused");
    assert.ok(
      !JSON.stringify(resumed.messages).includes("a".repeat(400)),
      "the summarized turn must stay out of the reloaded context",
    );
  } finally {
    storage.close();
  }
});

test("the compaction role writes the summary while the run model sets the threshold", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const older = storage.appendMessage({
      id: "older",
      conversationId: "conversation",
      role: "user",
      content: "a".repeat(400),
    });
    const recent = storage.appendMessage({
      id: "recent",
      conversationId: "conversation",
      role: "user",
      content: "recent",
    });
    const messages = [
      { role: "user" as const, content: "a".repeat(400) },
      { role: "user" as const, content: "recent" },
    ];
    const inference = new FakeInference();
    inference.responses.push([answer("summary from the compaction model")]);

    const compacted = await new CompactionManager(inference, storage, {
      reserveTokens: 20,
      keepRecentTokens: 10,
    }).transform(
      "conversation",
      model,
      { messages },
      new AbortController().signal,
      undefined,
      [older.sequence, recent.sequence],
      { model: { provider: "test", id: "summarizer" }, reasoning: "low" },
    );

    assert.match(compacted.systemPrompt ?? "", /summary from the compaction model/);
    assert.deepEqual(inference.requests[0]?.model, {
      provider: "test",
      id: "summarizer",
    });
    assert.equal(inference.requests[0]?.reasoning, "low");
  } finally {
    storage.close();
  }
});

test("a saved summary is discarded when the turns it described have changed", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const older = storage.appendMessage({
      id: "older",
      conversationId: "conversation",
      role: "user",
      content: "a".repeat(400),
    });
    const recent = storage.appendMessage({
      id: "recent",
      conversationId: "conversation",
      role: "user",
      content: "recent",
    });
    const sequences = [older.sequence, recent.sequence];
    const settings = { reserveTokens: 20, keepRecentTokens: 10 };
    const signal = new AbortController().signal;

    const before = new FakeInference();
    before.responses.push([answer("first summary")]);
    await new CompactionManager(before, storage, settings).transform(
      "conversation",
      model,
      {
        messages: [
          { role: "user", content: "a".repeat(400) },
          { role: "user", content: "recent" },
        ],
      },
      signal,
      undefined,
      sequences,
    );

    // Restart, but the compacted turn has been edited since it was summarized.
    const after = new FakeInference();
    after.responses.push([answer("rebuilt summary")]);
    const resumed = await new CompactionManager(
      after,
      storage,
      settings,
    ).transform(
      "conversation",
      model,
      {
        messages: [
          { role: "user", content: "b".repeat(800) },
          { role: "user", content: "recent" },
        ],
      },
      signal,
      undefined,
      sequences,
    );

    assert.equal(after.requests.length, 1, "changed history must re-summarize");
    assert.match(resumed.systemPrompt ?? "", /rebuilt summary/);
    assert.doesNotMatch(resumed.systemPrompt ?? "", /first summary/);
  } finally {
    storage.close();
  }
});

/** A model roomy enough that a summary plus the recent tail fits under the
 * threshold, which is what makes reuse observable rather than theoretical. */
const wideModel: InferenceModel = { ...modelInfo, contextWindow: 20_000 };
class WideInference extends FakeInference {
  listModels(): InferenceModel[] {
    return [wideModel];
  }
  getModel(): InferenceModel {
    return wideModel;
  }
}

test("reopening the app continues a compacted conversation without re-summarizing", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    for (let index = 0; index < 8; index += 1)
      storage.appendMessage({
        id: `old-${index}`,
        conversationId: "conversation",
        role: "user",
        content: `earlier turn ${index} ${"detail ".repeat(1_715)}`,
      });
    const options = {
      storage,
      memory: testMemory(),
      tools: new ToolRegistry(),
      model,
      compaction: {
        enabled: true,
        reserveTokens: 2_000,
        keepRecentTokens: 4_000,
      },
      goalLoop: { enabled: false },
      memoryConsolidation: { enabled: false },
    };

    const before = new WideInference();
    before.responses.push([answer("what came earlier")]);
    before.responses.push([answer("first answer")]);
    const first = new FlareAIAgent({ ...options, inference: before });
    await first.start({
      conversationId: "conversation",
      text: "next question",
      includeSubagents: false,
    }).result;
    await first.settleGoalWork();
    // The compaction pass, then the turn itself.
    assert.equal(before.requests.length, 2);

    // A second agent over the same storage is the app started again: whatever
    // it knows about the earlier turns has to have come off disk.
    const after = new WideInference();
    after.responses.push([answer("second answer")]);
    const second = new FlareAIAgent({ ...options, inference: after });
    await second.start({
      conversationId: "conversation",
      text: "and after that?",
      includeSubagents: false,
    }).result;
    await second.settleGoalWork();

    assert.equal(
      after.requests.length,
      1,
      "the reopened conversation must not pay to summarize again",
    );
    const turn = after.requests[0];
    assert.match(turn?.systemPrompt ?? "", /## Earlier conversation/);
    assert.match(turn?.systemPrompt ?? "", /what came earlier/);
    assert.ok(
      !JSON.stringify(turn?.messages).includes("earlier turn 0"),
      "summarized turns must stay out of the reopened context",
    );
  } finally {
    storage.close();
  }
});

test("the agent is given memory tools and its writes land in the vault", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const memory = testMemory();
    const inference = new FakeInference();
    inference.responses.push(
      [
        {
          type: "done",
          reason: "toolUse",
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "call-1",
                name: "remember",
                arguments: {
                  content: "Ships Rust and TypeScript in one monorepo",
                  kind: "profile",
                },
              },
            ],
            usage,
            stopReason: "toolUse",
          },
        },
      ],
      [answer("Saved.")],
    );
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory,
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: false },
      goalLoop: { enabled: false },
      memoryConsolidation: { enabled: false },
    });

    await agent.start({
      conversationId: "conversation",
      text: "remember that for me",
      includeSubagents: false,
    }).result;
    await agent.settleGoalWork();

    // The tool has to be offered before it can be called.
    const offered = inference.requests[0]?.tools?.map((tool) => tool.name) ?? [];
    for (const expected of ["remember", "forget", "search_history", "read_conversation"])
      assert.ok(offered.includes(expected), `${expected} must be offered to the model`);
    const saved = memory.userMemories();
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.kind, "profile");
    assert.match(saved[0]?.content ?? "", /Rust and TypeScript/);
  } finally {
    storage.close();
  }
});

test("a completed run drives memory consolidation through the runtime", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const memory = testMemory();
    for (let index = 0; index < 4; index += 1)
      memory.remember(`Durable preference ${index}`, { kind: "preference" });
    const inference = new FakeInference();
    inference.responses.push([answer("answer")]);
    inference.responses.push([
      answer("## User Profile\n\nConsolidated briefing."),
    ]);
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory,
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: false },
      goalLoop: { enabled: false },
      memoryConsolidation: { minimumPending: 3 },
    });

    await agent.start({
      conversationId: "conversation",
      text: "hello",
      includeSubagents: false,
    }).result;
    await agent.settleGoalWork();

    assert.match(
      readFileSync(memory.summaryPath, "utf8"),
      /Consolidated briefing/,
    );
    assert.equal(memory.pendingMemories().length, 0);
    assert.equal(memory.status().consolidationError, null);
    assert.ok(memory.status().consolidatedAt);
  } finally {
    storage.close();
  }
});

test("compaction re-summarizes when the compacted history changed underneath it", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    inference.responses.push([answer("first summary")]);
    inference.responses.push([answer("second summary")]);
    const manager = new CompactionManager(inference, storage, {
      reserveTokens: 20,
      keepRecentTokens: 10,
    });
    const signal = new AbortController().signal;

    await manager.transform(
      "conversation",
      model,
      {
        messages: [
          { role: "user", content: "a".repeat(400) },
          { role: "user", content: "recent" },
        ],
      },
      signal,
    );
    // Same message count, different content in the compacted prefix.
    const edited = await manager.transform(
      "conversation",
      model,
      {
        messages: [
          { role: "user", content: "b".repeat(800) },
          { role: "user", content: "recent" },
          { role: "user", content: "newer" },
        ],
      },
      signal,
    );

    assert.equal(inference.requests.length, 2, "edited history must re-summarize");
    assert.match(edited.systemPrompt ?? "", /second summary/);
    assert.doesNotMatch(edited.systemPrompt ?? "", /first summary/);
  } finally {
    storage.close();
  }
});

test("compaction renders images as placeholders instead of inlining base64", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    inference.responses.push([answer("summary")]);
    const manager = new CompactionManager(inference, storage, {
      reserveTokens: 20,
      keepRecentTokens: 10,
    });
    const payload = "A".repeat(50_000);

    await manager.transform(
      "conversation",
      model,
      {
        messages: [
          {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "screenshot",
            content: [{ type: "image", data: payload, mimeType: "image/png" }],
            isError: false,
          },
          { role: "user", content: "recent" },
        ],
      },
      new AbortController().signal,
    );

    const sent = inference.requests[0]?.messages[0];
    const rendered = typeof sent?.content === "string" ? sent.content : "";
    assert.ok(!rendered.includes(payload), "base64 must never be inlined");
    assert.match(rendered, /\[image omitted: image\/png\]/);
    assert.match(rendered, /## Tool result: screenshot/);
    assert.ok(
      rendered.length < 500,
      `transcript should stay small, got ${rendered.length} characters`,
    );
  } finally {
    storage.close();
  }
});

test("the task tool reaches the model with its delegation guidance", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    inference.responses.push([answer("done")]);
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: false },
    });

    await agent.start({
      conversationId: "conversation",
      text: "Draft a launch plan and research the competitors",
    }).result;

    const task = inference.requests[0]?.tools?.find(
      (item) => item.name === "task",
    );
    assert.ok(task, "the task tool must be offered on a top-level run");
    // The description carries the delegation policy, so a model that never
    // reads the orchestration skill still knows when to reach for it.
    assert.match(task.description, /## When to use/);
    assert.match(task.description, /run in parallel/);
    assert.match(task.description, /Do the work yourself only/);
    // The policy itself is not in the system prompt: it is `agents/main.md`,
    // loaded into the run, so a delegated run never carries the instructions
    // for a job it cannot do.
    const system = inference.requests[0]?.systemPrompt ?? "";
    assert.doesNotMatch(system, /## Delegation/);
    assert.doesNotMatch(system, /## Keeping the user posted/);
    // Every parameter is documented: a bare schema left the model guessing
    // that the subagent cannot see the conversation.
    const properties = task.parameters.properties as Record<
      string,
      { description?: string }
    >;
    for (const key of ["description", "prompt", "context"])
      assert.ok(
        properties[key]?.description,
        `${key} must describe itself to the model`,
      );
    assert.match(properties.prompt.description ?? "", /standalone/);
  } finally {
    storage.close();
  }
});

test("a subagent is neither given the task tool nor told to delegate", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    inference.responses.push([answer("done")]);
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: false },
    });

    await agent.start({
      conversationId: "conversation",
      text: "Research something",
      includeSubagents: false,
    }).result;

    const request = inference.requests[0];
    assert.ok(
      !request?.tools?.some((item) => item.name === "task"),
      "a subagent must not be able to delegate further",
    );
    // Telling a model to call a tool it does not have is an instruction it can
    // only fail: the policy has to travel with the tool.
    assert.doesNotMatch(request?.systemPrompt ?? "", /## Delegation/);
  } finally {
    storage.close();
  }
});

test("task tool adds no internal concurrency cap", async () => {
  let active = 0;
  let maximum = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tool = createTaskTool(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await gate;
    active -= 1;
    return { name: "task_1" };
  });
  const context = {
    runId: "run",
    turn: 1,
    signal: new AbortController().signal,
    emitProgress: async (): Promise<void> => undefined,
  };
  const calls = Array.from({ length: 12 }, (_, index) =>
    tool.execute(
      { description: `task ${index}`, prompt: "work" },
      { ...context, callId: String(index) },
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximum, 12);
  release();
  await Promise.all(calls);
});

test("goal loop keeps running until the judge calls the objective done", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    // Run, judge, continuation run, judge.
    inference.responses.push(
      [answer("started the research")],
      [answer('{"verdict":"continue","reason":"No findings reported yet."}')],
      [answer("here are the findings, goal met")],
      [answer('{"verdict":"done","reason":"Findings delivered."}')],
    );
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: false },
    });

    await agent.start({
      conversationId: "conversation",
      text: "Research a mechatronics project",
      asGoal: true,
      includeSubagents: false,
    }).result;
    await agent.settleGoalWork();

    const goal = storage.getGoal("conversation");
    assert.equal(goal?.status, "completed");
    assert.equal(agent.goalLoop.turnsUsed("conversation"), 0);
    // Two model turns plus one judge call each.
    assert.equal(inference.requests.length, 4);
    const continuation = storage
      .listMessages("conversation")
      .find((message) => (message.metadata as Record<string, unknown>).goalContinuation === true);
    assert.match(
      String(continuation?.content),
      /No findings reported yet/,
    );
  } finally {
    storage.close();
  }
});

test("goal loop pauses itself once the turn budget is spent", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    for (let index = 0; index < 8; index += 1)
      inference.responses.push(
        [answer("still working")],
        [answer('{"verdict":"continue","reason":"Not done."}')],
      );
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: false },
      goalLoop: { maxTurns: 2 },
    });

    await agent.start({
      conversationId: "conversation",
      text: "Keep going forever",
      asGoal: true,
      includeSubagents: false,
    }).result;
    await agent.settleGoalWork();

    assert.equal(storage.getGoal("conversation")?.status, "paused");
    // Three model turns: the initial one and two continuations. Only the first
    // two are judged — the third hits the spent budget and pauses without
    // spending a judge call.
    assert.equal(inference.requests.length, 5);
  } finally {
    storage.close();
  }
});

test("an unreadable verdict pauses the goal instead of looping blindly", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    inference.responses.push(
      [answer("did some work")],
      [answer("I think it is probably fine?")],
    );
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: false },
    });

    await agent.start({
      conversationId: "conversation",
      text: "Do the thing",
      asGoal: true,
      includeSubagents: false,
    }).result;
    await agent.settleGoalWork();

    assert.equal(storage.getGoal("conversation")?.status, "paused");
    assert.equal(inference.requests.length, 2);
  } finally {
    storage.close();
  }
});

test("a paused goal is not driven and a user turn resets the budget", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    inference.responses.push([answer("acknowledged")]);
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools: new ToolRegistry(),
      model,
      compaction: { enabled: false },
    });
    storage.createGoal({
      id: "goal",
      conversationId: "conversation",
      objective: "Paused work",
      status: "paused",
    });

    await agent.start({
      conversationId: "conversation",
      text: "Just a question",
      includeSubagents: false,
    }).result;
    await agent.settleGoalWork();

    assert.equal(storage.getGoal("conversation")?.status, "paused");
    // No judge call: a paused goal does not drive the loop.
    assert.equal(inference.requests.length, 1);
    assert.equal(agent.goalLoop.turnsUsed("conversation"), 0);
  } finally {
    storage.close();
  }
});

test("what is on screen belongs to the run the user is talking to", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    storage.createRun({ id: "parent", conversationId: "conversation", status: "running" });
    const inference = new FakeInference();
    inference.responses.push([answer("top-level")], [answer("delegated")]);
    const tools = new ToolRegistry();
    const stub = {
      description: "",
      parameters: { type: "object", properties: {} },
      async execute() {
        return { content: "" };
      },
    };
    tools.register({ ...stub, name: "workspace_show", mainAgentOnly: true });
    tools.register({ ...stub, name: "hub_draft" });
    const agent = new FlareAIAgent({
      inference,
      storage,
      memory: testMemory(),
      tools,
      model,
      compaction: { enabled: false },
    });

    await agent.start({ conversationId: "conversation", text: "show me the hub" }).result;
    const own = inference.requests[0]?.tools?.map((tool) => tool.name) ?? [];
    // The run the user is talking to owns the view — and only the view. The
    // draft is work, and a run that can delegate sends work out.
    assert.ok(own.includes("workspace_show"));
    assert.ok(!own.includes("hub_draft"));

    await agent.start({
      conversationId: "conversation",
      text: "write the reply",
      parentRunId: "parent",
      includeSubagents: false,
    }).result;
    const delegated = inference.requests[1]?.tools?.map((tool) => tool.name) ?? [];
    // The delegated run may still do the work — it just cannot decide what the
    // user is looking at while several of them finish at once.
    assert.ok(!delegated.includes("workspace_show"));
    assert.ok(delegated.includes("hub_draft"));
  } finally {
    storage.close();
  }
});
