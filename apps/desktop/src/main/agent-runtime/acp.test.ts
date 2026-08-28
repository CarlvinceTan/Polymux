import assert from "node:assert/strict";
import {test} from "node:test";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SqliteStorage} from "@polymux/storage/sqlite";
import {AcpAgentRuntime} from "./acp.js";

const CLIENT_VERSION = "9.8.7";

test("ACP runtime negotiates, streams, and persists a completed turn", async () => {
  const storage = new SqliteStorage(":memory:");
  storage.createConversation({id: "chat-1", title: "ACP"});
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-acp-agent.mjs");
  const runtime = new AcpAgentRuntime({
    kind: "acp",
    name: "Fake ACP Agent",
    command: process.execPath,
    args: [fixture, `--expect-client-version=${CLIENT_VERSION}`],
  }, storage, CLIENT_VERSION);

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

test("ACP runtime discovers, updates, and reapplies advertised session options", async () => {
  const storage = new SqliteStorage(":memory:");
  storage.createConversation({id: "chat-1", title: "ACP"});
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-acp-agent.mjs");
  const runtime = new AcpAgentRuntime({
    kind: "acp",
    name: "Fake ACP Agent",
    command: process.execPath,
    args: [fixture],
    config: {model: "capable", brave: true},
  }, storage, CLIENT_VERSION);

  try {
    const settings = await runtime.settings();
    assert.equal(settings.supportsProviders, false);
    assert.deepEqual(settings.configOptions.map((option) => [option.id, option.currentValue]), [
      ["model", "capable"],
      ["brave", true],
    ]);

    const updated = await runtime.setConfigOption("model", "fast");
    assert.equal(updated.configOptions[0]?.currentValue, "fast");
    await runtime.setConfigOption("model", "capable");

    const active = runtime.start({conversationId: "chat-1", runId: "run-1", text: "Hello"});
    for await (const _event of active.events) void _event;
    assert.equal((await active.result).lastAgentMessage, "Hello from capable ACP");
  } finally {
    await runtime.close();
    storage.close();
  }
});

test("ACP runtime exposes agent-managed authentication before session settings", async () => {
  const storage = new SqliteStorage(":memory:");
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-acp-agent.mjs");
  const runtime = new AcpAgentRuntime({
    kind: "acp",
    name: "Authenticated ACP Agent",
    command: process.execPath,
    args: [fixture, "--require-auth"],
  }, storage, CLIENT_VERSION);

  try {
    const required = await runtime.settings();
    assert.equal(required.authRequired, true);
    assert.equal(required.supportsLogout, true);
    assert.deepEqual(required.authMethods, [{
      id: "account",
      name: "Agent account",
      description: "Sign in through the agent",
      type: "agent",
      available: true,
    }]);
    assert.deepEqual(required.configOptions, []);

    const authenticated = await runtime.authenticate("account");
    assert.equal(authenticated.authRequired, false);
    assert.deepEqual(authenticated.configOptions.map((option) => option.id), ["model", "brave"]);

    const loggedOut = await runtime.logout();
    assert.equal(loggedOut.authRequired, true);
    assert.deepEqual(loggedOut.configOptions, []);
  } finally {
    await runtime.close();
    storage.close();
  }
});

test("ACP runtime cancellation does not wait for a hung initialization", async () => {
  const storage = new SqliteStorage(":memory:");
  storage.createConversation({id: "chat-1", title: "ACP"});
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-acp-agent.mjs");
  const config = {
    kind: "acp" as const,
    name: "Hung ACP Agent",
    command: process.execPath,
    args: [fixture, "--hang-initialize"],
  };
  const runtime = new AcpAgentRuntime(config, storage, CLIENT_VERSION);

  try {
    const active = runtime.start({conversationId: "chat-1", runId: "run-1", text: "Hello"});
    active.control.cancel();
    const result = await deadline(active.result, 1_000);
    assert.equal(result.status, "cancelled");
    assert.equal(storage.getRun("run-1")?.status, "cancelled");
    // A fresh caller must not inherit the cancelled run's hung connection.
    config.args = [fixture];
    assert.equal((await deadline(runtime.settings(), 1_000)).authRequired, false);
  } finally {
    await deadline(runtime.close(), 1_000);
    storage.close();
  }
});

async function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out waiting for ACP runtime")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
