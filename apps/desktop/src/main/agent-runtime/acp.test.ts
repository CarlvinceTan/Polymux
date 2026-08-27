import assert from "node:assert/strict";
import {test} from "node:test";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SqliteStorage} from "@polymux/storage/sqlite";
import {AcpAgentRuntime} from "./acp.js";

test("ACP runtime negotiates, streams, and persists a completed turn", async () => {
  const storage = new SqliteStorage(":memory:");
  storage.createConversation({id: "chat-1", title: "ACP"});
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-acp-agent.mjs");
  const runtime = new AcpAgentRuntime({
    kind: "acp",
    name: "Fake ACP Agent",
    command: process.execPath,
    args: [fixture],
  }, storage);

  try {
    const active = runtime.start({conversationId: "chat-1", runId: "run-1", text: "Hello"});
    const events = [];
    for await (const event of active.events) events.push(event);
    const result = await active.result;

    assert.equal(result.status, "completed");
    assert.equal(result.lastAgentMessage, "Hello from ACP");
    assert.ok(events.some((event) => event.type === "message.reasoning.delta"));
    assert.ok(events.some((event) => event.type === "message.completed"));
    assert.equal(storage.getRun("run-1")?.model, `acp:${process.execPath}`);
    assert.equal(storage.getRun("run-1")?.status, "completed");
    assert.deepEqual(storage.listMessages("chat-1").map((message) => message.role), ["user", "assistant"]);
  } finally {
    await runtime.close();
    storage.close();
  }
});
