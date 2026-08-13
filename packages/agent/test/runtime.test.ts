import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type {
  InferenceEvent,
  InferenceModel,
  InferenceRequest,
  InferenceService,
  ModelRef,
} from "@midas/inference";
import { SqliteStorage } from "@midas/storage/sqlite";
import { ToolRegistry } from "@midas/tools";
import {
  CompactionManager,
  createTaskTool,
  MemoryManager,
  MidasAgent,
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
    directory: mkdtempSync(path.join(tmpdir(), "midas-memory-test-")),
  });
}

test("treats slash-prefixed text as an ordinary chat message", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    inference.responses.push([answer("ordinary response")]);
    const agent = new MidasAgent({
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

test("creates a durable goal only from structured run metadata", async () => {
  const storage = new SqliteStorage(":memory:");
  try {
    storage.createConversation({ id: "conversation", title: "Chat" });
    const inference = new FakeInference();
    inference.responses.push([answer("working")]);
    const agent = new MidasAgent({
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
    const agent = new MidasAgent({
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
    const agent = new MidasAgent({
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
    const first = await manager.transform(
      "conversation",
      model,
      { messages },
      new AbortController().signal,
    );
    const second = await manager.transform(
      "conversation",
      model,
      { messages: [...messages, { role: "user", content: "new" }] },
      new AbortController().signal,
    );

    assert.equal(inference.requests.length, 1);
    assert.match(
      (first.messages[0] as { content: string }).content,
      /durable summary/,
    );
    assert.match(
      (second.messages[0] as { content: string }).content,
      /durable summary/,
    );
    assert.equal(
      storage.getLatestCompaction("conversation")?.summary,
      "durable summary",
    );
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
    return { runId: crypto.randomUUID(), result: "ok", status: "completed" };
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
