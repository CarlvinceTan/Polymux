import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SqliteStorage } from "@midas/storage/sqlite";
import { MemoryManager } from "../src/index.js";

function temporaryVault(): string {
  return mkdtempSync(path.join(tmpdir(), "midas-memory-vault-"));
}

test("creates a Codex-style local memory vault and migrates SQLite memory once", () => {
  const storage = new SqliteStorage(":memory:");
  storage.upsertMemory({
    id: "legacy-memory",
    scope: "user",
    kind: "preference",
    content: "Prefer clear explanations",
  });
  const directory = temporaryVault();

  const memory = new MemoryManager({ directory, legacyStorage: storage });

  assert.equal(memory.list()[0]?.content, "Prefer clear explanations");
  assert.ok(existsSync(path.join(directory, "MEMORY.md")));
  assert.ok(existsSync(path.join(directory, "memory_summary.md")));
  assert.ok(existsSync(path.join(directory, "rollout_summaries")));
  assert.match(readFileSync(memory.registryPath, "utf8"), /Prefer clear explanations/);
  assert.match(readFileSync(memory.summaryPath, "utf8"), /Prefer clear explanations/);
  assert.ok(existsSync(path.join(directory, ".sqlite-memory-migrated-v1")));
  assert.deepEqual(memory.status(), {
    enabled: true,
    directory,
    storedBytes: memory.status().storedBytes,
    registryPath: path.join(directory, "MEMORY.md"),
    summaryPath: path.join(directory, "memory_summary.md"),
    memories: 1,
    userMemories: 1,
    conversationMemories: 0,
    rolloutSummaries: 0,
    latestMemoryAt: memory.list()[0]!.updatedAt,
    latestRolloutAt: null,
  });
  assert.ok(memory.status().storedBytes > 0);
  assert.equal(memory.setEnabled(false).enabled, false);
  assert.equal(memory.promptContext().enabled, false);
  assert.equal(memory.promptContext().summary, "");
  assert.equal(memory.recordRollout({conversationId: "off", runId: "off", userText: "off", assistantText: "off"}), "");
  assert.equal(memory.setEnabled(true).enabled, true);
  storage.close();
});

test("keeps conversation memory scoped and archives forgotten notes", () => {
  const memory = new MemoryManager({ directory: temporaryVault() });
  const userMemory = memory.remember("Use simple explanations");
  const chatMemory = memory.remember("The attachment is the source of truth", {
    conversationId: "chat-1",
  });

  assert.deepEqual(
    memory.list("chat-1").map((item) => item.id).sort(),
    [chatMemory.id, userMemory.id].sort(),
  );
  assert.equal(memory.promptContext("chat-2").conversationMemories.length, 0);
  assert.equal(memory.promptContext("chat-1").conversationMemories[0]?.id, chatMemory.id);
  assert.equal(memory.forget(userMemory.id), true);
  assert.equal(memory.list().length, 0);
  assert.equal(readdirSync(memory.archiveDirectory).length, 1);
});

test("records completed top-level turns as searchable rollout summaries", () => {
  const memory = new MemoryManager({
    directory: temporaryVault(),
    clock: () => new Date("2026-08-13T12:00:00.000Z"),
  });

  const file = memory.recordRollout({
    conversationId: "chat-1",
    runId: "run-1",
    userText: "What did we decide?",
    assistantText: "Use local Markdown memory.",
  });

  assert.match(readFileSync(file, "utf8"), /What did we decide\?/);
  assert.match(readFileSync(file, "utf8"), /Use local Markdown memory\./);
});
