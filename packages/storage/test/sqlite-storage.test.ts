import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  const directory = mkdtempSync(path.join(tmpdir(), "flareai-preferences-"));
  const databasePath = path.join(directory, "flareai.sqlite");
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

test("a store written before summaries were fingerprinted still opens", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "flareai-compaction-"));
  const databasePath = path.join(directory, "flareai.sqlite");
  try {
    const before = new SqliteStorage(databasePath);
    before.createConversation({ id: "conversation-1", title: "Chat" });
    before.close();

    // Wind the store back to how the previous version wrote it: a compaction
    // row with no fingerprint recorded against it.
    const old = new DatabaseSync(databasePath);
    old.exec("ALTER TABLE compactions DROP COLUMN prefix_fingerprint");
    old
      .prepare(
        "INSERT INTO compactions (id,conversation_id,through_message_sequence,summary,token_count,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run("compact-old", "conversation-1", 8, "summary from before", 80, "2026-01-01T00:00:00.000Z");
    old.exec("PRAGMA user_version = 4");
    old.close();

    const after = new SqliteStorage(databasePath);
    try {
      const saved = after.getLatestCompaction("conversation-1");
      assert.equal(saved?.summary, "summary from before");
      // Empty reads as "cannot be checked", which is what keeps an unverifiable
      // summary from being reused rather than trusted blindly.
      assert.equal(saved?.prefixFingerprint, "");
    } finally {
      after.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recompacting the same prefix replaces its summary", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "conversation-1", title: "Memory" });
    storage.saveCompaction({
      id: "compact-1",
      conversationId: "conversation-1",
      throughMessageSequence: 8,
      summary: "stale summary",
      tokenCount: 80,
      prefixFingerprint: "user:12",
    });
    const replaced = storage.saveCompaction({
      id: "compact-2",
      conversationId: "conversation-1",
      throughMessageSequence: 8,
      summary: "fresh summary",
      tokenCount: 90,
      prefixFingerprint: "user:14",
    });

    assert.equal(replaced.summary, "fresh summary");
    assert.equal(storage.getLatestCompaction("conversation-1")?.id, "compact-2");
    assert.equal(
      storage.getLatestCompaction("conversation-1")?.summary,
      "fresh summary",
    );
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
      prefixFingerprint: "user:12",
    });
    storage.saveCompaction({
      id: "compact-2",
      conversationId: "conversation-1",
      throughMessageSequence: 14,
      summary: "Later context",
      tokenCount: 120,
      prefixFingerprint: "user:20",
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
      title: "FlareAI",
      uri: "https://flarehq.co",
    });
    assert.equal(
      storage.listArtifacts("conversation-1")[0]?.path,
      "/managed/Plan.docx",
    );
    assert.equal(
      storage.listReferences("conversation-1")[0]?.uri,
      "https://flarehq.co",
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

test("searches message history newest first, ignoring tool noise", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "older", title: "Rust questions" });
    storage.createConversation({ id: "newer", title: "Deployment" });
    storage.appendMessage({
      id: "a",
      conversationId: "older",
      role: "user",
      content: "I prefer Rust for the API layer",
    });
    storage.appendMessage({
      id: "b",
      conversationId: "newer",
      role: "assistant",
      content: [{ type: "text", text: "Rust it is, then." }],
    });
    storage.appendMessage({
      id: "c",
      conversationId: "newer",
      role: "tool",
      content: "Rust appears in this tool output too",
    });

    const hits = storage.searchMessages("Rust");

    // Tool output is excluded by default; newest match comes first.
    assert.deepEqual(
      hits.map((hit) => hit.messageId),
      ["b", "a"],
    );
    assert.equal(hits[0]?.conversationTitle, "Deployment");
    // Block content is rendered to plain text rather than returned as JSON.
    assert.equal(hits[0]?.text, "Rust it is, then.");
    assert.equal(storage.searchMessages("Rust", { roles: ["tool"] }).length, 1);
    assert.equal(storage.searchMessages("   ").length, 0);
    assert.equal(storage.searchMessages("Rust", { conversationId: "older" }).length, 1);
  } finally {
    storage.close();
  }
});

test("a literal wildcard in a search is not treated as a pattern", () => {
  const storage = fixture();
  try {
    storage.createConversation({ id: "c", title: "Chat" });
    storage.appendMessage({
      id: "a",
      conversationId: "c",
      role: "user",
      content: "discount is 50% off",
    });
    storage.appendMessage({
      id: "b",
      conversationId: "c",
      role: "user",
      content: "nothing relevant here",
    });

    assert.equal(storage.searchMessages("50% off").length, 1);
    // Would match everything if % leaked through as a wildcard.
    assert.equal(storage.searchMessages("%%%").length, 0);
  } finally {
    storage.close();
  }
});

test("drops web references the reply never cited when upgrading an old store", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "flareai-refs-"));
  const databasePath = path.join(directory, "flareai.sqlite");
  try {
    const before = new SqliteStorage(databasePath);
    before.createConversation({ id: "conversation-1", title: "Research" });
    before.createRun({ id: "run-1", conversationId: "conversation-1" });
    before.appendMessage({
      id: "message-1",
      conversationId: "conversation-1",
      runId: "run-1",
      role: "assistant",
      content: [
        { type: "toolCall", id: "call-1", name: "browser_control", arguments: { url: "https://search.example/?q=ai" } },
        { type: "text", text: "The one worth your time is [AI Summit](https://one.example/summit)." },
      ],
    });
    // Cited in the reply, a page only opened along the way, and a file the
    // user attached by hand.
    for (const [id, uri] of [
      ["kept", "https://one.example/summit"],
      ["opened", "https://search.example/?q=ai"],
    ] as const)
      before.createReference({ id, conversationId: "conversation-1", runId: "run-1", kind: "web", title: id, uri });
    before.createReference({
      id: "attached",
      conversationId: "conversation-1",
      kind: "file",
      title: "notes.md",
      uri: "/home/me/notes.md",
    });
    before.close();

    // Reopen as a store written by the previous version.
    const rollback = new DatabaseSync(databasePath);
    rollback.exec("PRAGMA user_version = 3");
    rollback.close();

    const after = new SqliteStorage(databasePath);
    try {
      assert.deepEqual(
        after.listReferences("conversation-1").map((item) => item.id).sort(),
        ["attached", "kept"],
      );
    } finally {
      after.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
