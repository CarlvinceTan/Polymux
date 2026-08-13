import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SqliteStorage } from "../src/sqlite/sqlite-storage.js";

function fixture() {
  let tick = 0;
  const storage = new SqliteStorage(":memory:", {
    clock: () => `2026-08-13T00:00:${String(tick++).padStart(2, "0")}.000Z`,
  });
  return storage;
}

test("persists user configuration after the database is reopened", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "midas-preferences-"));
  const databasePath = path.join(directory, "midas.sqlite");
  try {
    const firstSession = new SqliteStorage(databasePath);
    firstSession.setPreference("general-access", {
      theme: "dark",
      timeEnabled: false,
      locationEnabled: false,
      location: null,
    });
    firstSession.close();

    const nextSession = new SqliteStorage(databasePath);
    try {
      assert.deepEqual(nextSession.getPreference("general-access")?.value, {
        theme: "dark",
        timeEnabled: false,
        locationEnabled: false,
        location: null,
      });
    } finally {
      nextSession.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stores conversations, ordered messages, attachments and archive state", () => {
  const storage = fixture();
  try {
    const created = storage.createConversation({
      id: "conversation-1",
      title: "New chat",
      metadata: { source: "test" },
    });
    assert.equal(created.title, "New chat");
    assert.deepEqual(created.metadata, { source: "test" });

    const first = storage.appendMessage({
      id: "message-1",
      conversationId: created.id,
      role: "user",
      content: { text: "Hello" },
    });
    const second = storage.appendMessage({
      id: "message-2",
      conversationId: created.id,
      role: "assistant",
      content: [{ type: "text", text: "Hi" }],
    });
    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.deepEqual(
      storage
        .listMessages(created.id, { afterSequence: 1 })
        .map((item) => item.id),
      ["message-2"],
    );
    assert.equal(storage.getMessage(first.id)?.id, first.id);
    assert.deepEqual(
      storage.updateMessage(first.id, {
        content: "Hello again",
        metadata: { feedback: "up" },
      }),
      {...first, content: "Hello again", metadata: { feedback: "up" }},
    );

    storage.addAttachment({
      id: "attachment-1",
      messageId: first.id,
      name: "brief.pdf",
      path: "/managed/brief.pdf",
      mimeType: "application/pdf",
      size: 120,
      sha256: null,
    });
    assert.equal(storage.listAttachments(first.id)[0]?.name, "brief.pdf");

    storage.updateConversation(created.id, {
      title: "Greeting",
      archived: true,
    });
    assert.equal(storage.listConversations().length, 0);
    assert.equal(
      storage.listConversations({ includeArchived: true })[0]?.title,
      "Greeting",
    );
  } finally {
    storage.close();
  }
});

test("persists replayable run events and lifecycle state", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "conversation-1", title: "Run" });
    storage.createRun({
      id: "run-1",
      conversationId: "conversation-1",
      model: "provider/model",
    });
    const running = storage.updateRun("run-1", { status: "running" });
    assert.ok(running?.startedAt);

    storage.appendRunEvent("run-1", "run.started", { model: "provider/model" });
    storage.appendRunEvent("run-1", "message.delta", { text: "hello" });
    storage.appendRunEvent("run-1", "run.completed", { stopReason: "end" });
    assert.deepEqual(
      storage
        .listRunEvents("run-1", 1)
        .map((item) => [item.sequence, item.type]),
      [
        [2, "message.delta"],
        [3, "run.completed"],
      ],
    );

    const completed = storage.updateRun("run-1", {
      status: "completed",
      usage: { input: 10, output: 3 },
    });
    assert.ok(completed?.finishedAt);
    assert.deepEqual(completed?.usage, { input: 10, output: 3 });
  } finally {
    storage.close();
  }
});

test("keeps compaction, durable memory and preferences distinct", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "conversation-1", title: "Memory" });
    storage.saveCompaction({
      id: "compact-1",
      conversationId: "conversation-1",
      throughMessageSequence: 8,
      summary: "Earlier context",
      tokenCount: 80,
    });
    storage.saveCompaction({
      id: "compact-2",
      conversationId: "conversation-1",
      throughMessageSequence: 14,
      summary: "Later context",
      tokenCount: 120,
    });
    assert.equal(
      storage.getLatestCompaction("conversation-1")?.id,
      "compact-2",
    );

    storage.upsertMemory({
      id: "memory-1",
      scope: "user",
      kind: "preference",
      content: "Keep responses concise",
    });
    storage.upsertMemory({
      id: "memory-2",
      scope: "conversation",
      scopeId: "conversation-1",
      kind: "decision",
      content: "Use SQLite",
      confidence: 0.9,
    });
    assert.deepEqual(
      storage
        .listMemories({ scope: "conversation", scopeId: "conversation-1" })
        .map((item) => item.id),
      ["memory-2"],
    );
    assert.equal(storage.deleteMemory("memory-2"), true);
    assert.equal(
      storage.listMemories({ scope: "conversation", scopeId: "conversation-1" })
        .length,
      0,
    );
    assert.equal(
      storage.listMemories({
        scope: "conversation",
        scopeId: "conversation-1",
        includeDeleted: true,
      }).length,
      1,
    );

    storage.setPreference("system.responseStyle", { verbosity: "concise" });
    assert.deepEqual(storage.getPreference("system.responseStyle")?.value, {
      verbosity: "concise",
    });
  } finally {
    storage.close();
  }
});

test("stores artifacts and references without putting file contents in SQLite", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "conversation-1", title: "Resources" });
    storage.createRun({ id: "run-1", conversationId: "conversation-1" });
    storage.createArtifact({
      id: "artifact-1",
      conversationId: "conversation-1",
      runId: "run-1",
      kind: "document",
      name: "Plan.docx",
      path: "/managed/Plan.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 400,
    });
    storage.createReference({
      id: "reference-1",
      conversationId: "conversation-1",
      runId: "run-1",
      kind: "web",
      title: "Polymux",
      uri: "https://polymux.com",
    });
    assert.equal(
      storage.listArtifacts("conversation-1")[0]?.path,
      "/managed/Plan.docx",
    );
    assert.equal(
      storage.listReferences("conversation-1")[0]?.uri,
      "https://polymux.com",
    );
  } finally {
    storage.close();
  }
});

test("transactions roll back atomically and deleting a conversation cascades", () => {
  const storage = fixture();
  try {
    assert.throws(
      () =>
        storage.transaction(() => {
          storage.createConversation({ id: "rolled-back", title: "Temporary" });
          throw new Error("abort");
        }),
      /abort/,
    );
    assert.equal(storage.getConversation("rolled-back"), null);

    storage.createConversation({ id: "conversation-1", title: "Cascade" });
    storage.createRun({ id: "run-1", conversationId: "conversation-1" });
    storage.appendRunEvent("run-1", "run.started", {});
    storage.appendMessage({
      id: "message-1",
      conversationId: "conversation-1",
      runId: "run-1",
      role: "user",
      content: { text: "Delete me" },
    });
    assert.equal(storage.deleteConversation("conversation-1"), true);
    assert.equal(storage.getRun("run-1"), null);
    assert.deepEqual(storage.listRunEvents("run-1"), []);
  } finally {
    storage.close();
  }
});

test("prevents resources from crossing conversation boundaries", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "conversation-1", title: "One" });
    storage.createConversation({ id: "conversation-2", title: "Two" });
    storage.createRun({ id: "run-1", conversationId: "conversation-1" });
    assert.throws(
      () =>
        storage.appendMessage({
          id: "message-1",
          conversationId: "conversation-2",
          runId: "run-1",
          role: "assistant",
          content: { text: "wrong thread" },
        }),
      /another conversation/,
    );
    assert.throws(
      () =>
        storage.createReference({
          id: "reference-1",
          conversationId: "conversation-2",
          runId: "run-1",
          kind: "web",
          title: "Wrong",
          uri: "https://example.com",
        }),
      /another conversation/,
    );
  } finally {
    storage.close();
  }
});
