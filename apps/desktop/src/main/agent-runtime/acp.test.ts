import assert from "node:assert/strict";
import {test} from "node:test";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SqliteStorage} from "@polymux/storage/sqlite";
import {AcpAgentRuntime} from "./acp.js";
import {rewindConversation} from "../backend/rewind-conversation.js";

const CLIENT_VERSION = "9.8.7";

test("cancelled streaming ACP sessions cannot leak late output into the next turn", async () => {
  const storage = new SqliteStorage(":memory:");
  storage.createConversation({id: "chat", title: "Cancel"});
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-acp-agent.mjs");
  const runtime = new AcpAgentRuntime({kind: "acp", name: "Fixture", command: process.execPath, args: [fixture, "--late-cancel"]}, storage, CLIENT_VERSION);
  try {
    const first = runtime.start({conversationId: "chat", runId: "first", text: "Old request"});
    for await (const event of first.events) if (event.type === "message.text.delta") first.control.cancel();
    assert.equal((await first.result).status, "cancelled");
    const second = runtime.start({conversationId: "chat", runId: "second", text: "New request"});
    for await (const _event of second.events) void _event;
    assert.equal((await second.result).lastAgentMessage, "NEW ANSWER");
  } finally { await runtime.close(); storage.close(); }
});

test("rewinding an ACP conversation reseeds only retained history", async () => {
  const storage = new SqliteStorage(":memory:");
  storage.createConversation({id: "chat", title: "Rewind"});
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-acp-agent.mjs");
  const runtime = new AcpAgentRuntime({kind: "acp", name: "Fixture", command: process.execPath, args: [fixture, "--report-history"]}, storage, CLIENT_VERSION);
  try {
    for (const [index, text] of ["KEEP", "ORIGINAL", "DELETED"].entries()) {
      const active = runtime.start({conversationId: "chat", runId: `run-${index}`, userMessageId: `user-${index}`, text});
      for await (const _event of active.events) void _event;
      assert.equal((await active.result).status, "completed");
    }
    rewindConversation(storage, {conversationId: "chat", messageId: "user-1", content: "REVISED"});
    await runtime.resetHistory("chat");
    const revised = runtime.start({conversationId: "chat", runId: "revised", userMessageId: "user-1", text: "REVISED", reuseUserMessage: true});
    for await (const _event of revised.events) void _event;
    const output = (await revised.result).lastAgentMessage!;
    assert.match(output, /KEEP/);
    assert.match(output, /REVISED/);
    assert.doesNotMatch(output, /ORIGINAL|DELETED/);
    assert.equal(JSON.parse(output).history.length, 1, "history is context, not replayed prompts");
  } finally { await runtime.close(); storage.close(); }
});

test("ACP runtime negotiates, streams, and persists a completed turn", async () => {
  const storage = new SqliteStorage(":memory:");
  storage.createConversation({id: "chat-1", title: "ACP"});
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-acp-agent.mjs");
  const runtime = new AcpAgentRuntime({
    kind: "acp",
    name: "Fake ACP Agent",
    agentId: "fake-agent",
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
    assert.deepEqual(storage.loadUsageSource().runs[0]?.agent, {kind: "acp", id: "fake-agent", name: "Fake ACP Agent"});
    assert.deepEqual(storage.listMessages("chat-1").map((message) => message.role), ["user", "assistant"]);
  } finally {
    await runtime.close();
    storage.close();
  }
});

test("ACP sessions receive the host app MCP servers for their conversation", async () => {
  const storage = new SqliteStorage(":memory:");
  storage.createConversation({id: "chat-1", title: "ACP"});
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-acp-agent.mjs");
  const requested: string[] = [];
  const runtime = new AcpAgentRuntime({
    kind: "acp",
    name: "Fake ACP Agent",
    command: process.execPath,
    args: [fixture, "--expect-mcp-server=Polymux Workspace"],
  }, storage, CLIENT_VERSION, undefined, async (conversationId) => {
    requested.push(conversationId);
    return [{
      type: "http",
      name: "Polymux Workspace",
      url: "http://127.0.0.1:43210/mcp",
      headers: [{name: "Authorization", value: "Bearer scoped"}],
    }];
  });

  try {
    const active = runtime.start({conversationId: "chat-1", runId: "run-1", text: "Hello"});
    for await (const _event of active.events) void _event;
    await active.result;
    assert.deepEqual(requested, ["chat-1"]);
  } finally {
    await runtime.close();
    storage.close();
  }
});

test("ACP runtime uses the host-computed environment without merging process secrets", async () => {
  const storage = new SqliteStorage(":memory:");
  storage.createConversation({id: "chat-1", title: "Isolated ACP"});
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-acp-agent.mjs");
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "host-secret";
  const runtime = new AcpAgentRuntime({
    kind: "acp",
    name: "Fake ACP Agent",
    command: process.execPath,
    args: [fixture, "--report-environment"],
    environment: {
      PATH: process.env.PATH,
      HOME: "/profile/home",
      XDG_CONFIG_HOME: "/profile/home/.config",
    },
  }, storage, CLIENT_VERSION);

  try {
    const active = runtime.start({conversationId: "chat-1", runId: "run-1", text: "Hello"});
    for await (const _event of active.events) void _event;
    assert.deepEqual(JSON.parse((await active.result).lastAgentMessage), {
      home: "/profile/home",
      xdg: "/profile/home/.config",
    });
  } finally {
    await runtime.close();
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
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

test("ACP runtime routes Claude status notices outside assistant prose", async () => {
  const storage = new SqliteStorage(":memory:");
  storage.createConversation({id: "chat-1", title: "Claude"});
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-acp-agent.mjs");
  const runtime = new AcpAgentRuntime({
    kind: "acp",
    name: "Claude Agent",
    command: process.execPath,
    args: [fixture, "--emit-notices", "--expect-session-failures", "claude-agent-acp"],
  }, storage, CLIENT_VERSION);

  try {
    const active = runtime.start({conversationId: "chat-1", runId: "run-1", text: "Hello"});
    const events = [];
    for await (const event of active.events) events.push(event);
    const result = await active.result;

    assert.equal(result.lastAgentMessage, "Hello from ACP");
    assert.deepEqual(
      events.filter((event) => event.type === "agent.notice").map((event) => ({
        severity: event.severity,
        message: event.message,
      })),
      [
        {severity: "warning", message: "Fast mode turned off: requires extra usage to be enabled for this account."},
        {severity: "error", message: "Claude is temporarily unavailable."},
      ],
    );
    const assistant = storage.listMessages("chat-1").find((message) => message.role === "assistant");
    assert.doesNotMatch(JSON.stringify(assistant?.content), /Fast mode|temporarily unavailable/);
    assert.equal(storage.listRunEvents("run-1").some((event) => event.type === "agent.notice"), false);
  } finally {
    await runtime.close();
    storage.close();
  }
});

test("ACP runtime routes generic adapter warnings and errors outside assistant prose", async () => {
  const storage = new SqliteStorage(":memory:");
  storage.createConversation({id: "chat-1", title: "Generic ACP"});
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-acp-agent.mjs");
  const runtime = new AcpAgentRuntime({
    kind: "acp",
    name: "Generic ACP Agent",
    command: process.execPath,
    args: [fixture, "--emit-generic-notices"],
  }, storage, CLIENT_VERSION);

  try {
    const active = runtime.start({conversationId: "chat-1", runId: "run-1", text: "Hello"});
    const events = [];
    for await (const event of active.events) events.push(event);
    const result = await active.result;

    assert.equal(result.lastAgentMessage, "Hello from ACP");
    assert.deepEqual(
      events.filter((event) => event.type === "agent.notice").map((event) => ({
        severity: event.severity,
        message: event.message,
      })),
      [
        {severity: "warning", message: "Warning: Connection is degraded."},
        {severity: "error", message: "Error: External agent transport failed."},
      ],
    );
    const assistant = storage.listMessages("chat-1").find((message) => message.role === "assistant");
    assert.doesNotMatch(JSON.stringify(assistant?.content), /Connection is degraded|transport failed/);
  } finally {
    await runtime.close();
    storage.close();
  }
});

test("ACP runtime reports connection failures as notices instead of assistant content", async () => {
  const storage = new SqliteStorage(":memory:");
  storage.createConversation({id: "chat-1", title: "Failing ACP"});
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-acp-agent.mjs");
  const runtime = new AcpAgentRuntime({
    kind: "acp",
    name: "Failing ACP Agent",
    command: process.execPath,
    args: [fixture, "--fail-prompt"],
  }, storage, CLIENT_VERSION);

  try {
    const active = runtime.start({conversationId: "chat-1", runId: "run-1", text: "Hello"});
    const events = [];
    for await (const event of active.events) events.push(event);
    const result = await active.result;

    assert.equal(result.status, "failed");
    assert.equal(result.error?.reportedAsNotice, true);
    assert.deepEqual(
      events.filter((event) => event.type === "agent.notice").map((event) => ({
        severity: event.severity,
        message: event.message,
      })),
      [{severity: "error", message: "External agent connection lost"}],
    );
    assert.deepEqual(storage.listMessages("chat-1").map((message) => message.role), ["user"]);
    assert.equal(storage.listRunEvents("run-1").some((event) => event.type === "agent.notice"), false);
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
