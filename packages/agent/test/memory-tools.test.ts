import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentTool, AgentToolResult } from "@polymux/core";
import { createMemoryTools, MemoryManager } from "../src/index.js";

function vault(): MemoryManager {
  return new MemoryManager({
    directory: mkdtempSync(path.join(tmpdir(), "polymux-memory-tools-")),
  });
}

function call(tools: AgentTool[], name: string, input = {}): Promise<AgentToolResult> {
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

test("the agent can remember, list, and forget through its tools", async () => {
  const memory = vault();
  const tools = createMemoryTools(memory, "conversation");

  const saved = payload(
    await call(tools, "remember", {
      content: "Prefers Melbourne or Sydney for startup roles",
      kind: "preference",
    }),
  ) as { id: string; scope: string; kind: string };
  assert.equal(saved.scope, "user");
  assert.equal(saved.kind, "preference");

  const listed = payload(await call(tools, "recall")) as Array<{
    id: string;
    content: string;
  }>;
  assert.equal(listed.length, 1);
  assert.match(listed[0]?.content ?? "", /Melbourne or Sydney/);

  await call(tools, "forget", { id: saved.id });
  assert.equal(memory.list("conversation").length, 0);
  // Forgetting archives the note rather than destroying it.
  assert.equal(readdirSync(memory.archiveDirectory).length, 1);
});

test("recall narrows to the memories matching every query word", async () => {
  const memory = vault();
  const tools = createMemoryTools(memory, "conversation");
  await call(tools, "remember", { content: "Studies at the University of Melbourne" });
  await call(tools, "remember", { content: "Prefers Melbourne or Sydney for startup roles" });
  await call(tools, "remember", { content: "Runs the Polymux desktop agent locally" });

  const matches = payload(await call(tools, "recall", { query: "melbourne startup" })) as Array<{
    content: string;
  }>;
  assert.equal(matches.length, 1);
  assert.match(matches[0]?.content ?? "", /startup roles/);

  // Nothing on the subject is an answer, not a failure.
  const empty = await call(tools, "recall", { query: "sailing" });
  assert.notEqual(empty.isError, true);
  assert.deepEqual(payload(empty), []);
});

test("conversation-scoped memory stays out of the user scope", async () => {
  const memory = vault();
  const tools = createMemoryTools(memory, "conversation");

  await call(tools, "remember", {
    content: "The attached spreadsheet is the source of truth",
    scope: "conversation",
  });

  assert.equal(memory.list().length, 0);
  assert.equal(memory.list("conversation").length, 1);
  assert.equal(memory.userMemories().length, 0);
});

test("the remember tool refuses empty and oversized content", async () => {
  const memory = vault();
  const tools = createMemoryTools(memory, "conversation");

  const empty = await call(tools, "remember", { content: "   " });
  assert.equal(empty.isError, true);

  const huge = await call(tools, "remember", { content: "x".repeat(4_001) });
  assert.equal(huge.isError, true);
  assert.match(String(huge.content), /at most 4,?000 characters/);

  assert.equal(memory.list("conversation").length, 0);
});

test("forgetting an unknown id is an error, not a silent success", async () => {
  const tools = createMemoryTools(vault(), "conversation");
  const missing = await call(tools, "forget", { id: "does-not-exist" });

  assert.equal(missing.isError, true);
  assert.match(String(missing.content), /recall/);
});

test("disabled memory offers the agent no memory tools at all", () => {
  const memory = vault();
  memory.setEnabled(false);

  assert.deepEqual(createMemoryTools(memory, "conversation"), []);
});
