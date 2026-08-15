import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTool, AgentToolResult } from "@midas/core";
import { SqliteStorage } from "@midas/storage/sqlite";
import { createHistoryTools } from "../src/index.js";

function call(
  tools: AgentTool[],
  name: string,
  input = {},
): Promise<AgentToolResult> {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `tool ${name} is not registered`);
  return tool.execute(input, {
    runId: "run",
    turn: 1,
    callId: "call",
    signal: new AbortController().signal,
    emitProgress: async () => {},
  });
}

function payload(result: AgentToolResult): unknown {
  return JSON.parse(typeof result.content === "string" ? result.content : "null");
}

function history(): SqliteStorage {
  const storage = new SqliteStorage(":memory:");
  storage.createConversation({ id: "past", title: "Lightrig planning" });
  storage.createConversation({ id: "current", title: "Today" });
  storage.appendMessage({
    id: "m1",
    conversationId: "past",
    role: "user",
    content: "We settled on a Rust and TypeScript monorepo for lightrig",
  });
  storage.appendMessage({
    id: "m2",
    conversationId: "past",
    role: "assistant",
    content: "Noted, with the hardware testbench kept separate.",
  });
  return storage;
}

test("the agent can find an earlier decision and read around it", async () => {
  const storage = history();
  try {
    const tools = createHistoryTools(storage, "current");

    const hits = payload(
      await call(tools, "search_history", { query: "monorepo" }),
    ) as Array<{ conversationId: string; conversation: string; text: string }>;
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.conversationId, "past");
    assert.equal(hits[0]?.conversation, "Lightrig planning");

    // The hit carries the id needed to read the surrounding turns.
    const turns = payload(
      await call(tools, "read_conversation", {
        conversationId: hits[0]?.conversationId,
      }),
    ) as Array<{ role: string; text: string }>;
    assert.equal(turns.length, 2);
    assert.match(turns[1]?.text ?? "", /hardware testbench/);
  } finally {
    storage.close();
  }
});

test("searching refuses an empty query and reading refuses an unknown id", async () => {
  const storage = history();
  try {
    const tools = createHistoryTools(storage, "current");

    const blank = await call(tools, "search_history", { query: "  " });
    assert.equal(blank.isError, true);

    const missing = await call(tools, "read_conversation", {
      conversationId: "nope",
    });
    assert.equal(missing.isError, true);
  } finally {
    storage.close();
  }
});

test("reading the conversation already in view is rejected as pointless", async () => {
  const storage = history();
  try {
    const tools = createHistoryTools(storage, "past");
    const same = await call(tools, "read_conversation", {
      conversationId: "past",
    });

    assert.equal(same.isError, true);
    assert.match(String(same.content), /already see/);
  } finally {
    storage.close();
  }
});

test("a search that matches nothing is an empty result, not an error", async () => {
  const storage = history();
  try {
    const tools = createHistoryTools(storage, "current");
    const result = await call(tools, "search_history", { query: "kubernetes" });

    assert.notEqual(result.isError, true);
    assert.deepEqual(payload(result), []);
  } finally {
    storage.close();
  }
});
