import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MemoryManager } from "../src/index.js";

function temporaryVault(): string {
  return mkdtempSync(path.join(tmpdir(), "polymux-memory-vault-"));
}

test("creates a Codex-style local memory vault", () => {
  const directory = temporaryVault();
  const memory = new MemoryManager({ directory, id: () => "preference" });
  memory.remember("Prefer clear explanations", {kind: "preference"});

  assert.equal(memory.list()[0]?.content, "Prefer clear explanations");
  assert.ok(existsSync(path.join(directory, "MEMORY.md")));
  assert.ok(existsSync(path.join(directory, "memory_summary.md")));
  assert.match(readFileSync(memory.registryPath, "utf8"), /Prefer clear explanations/);
  assert.match(readFileSync(memory.summaryPath, "utf8"), /Prefer clear explanations/);
  assert.deepEqual(memory.status(), {
    enabled: true,
    directory,
    storedBytes: memory.status().storedBytes,
    registryPath: path.join(directory, "MEMORY.md"),
    summaryPath: path.join(directory, "memory_summary.md"),
    memories: 1,
    userMemories: 1,
    conversationMemories: 0,
    latestMemoryAt: memory.list()[0]!.updatedAt,
    consolidatedAt: null,
    consolidationError: null,
    consolidationRetryAfter: null,
    pendingMemories: 1,
  });
  assert.ok(memory.status().storedBytes > 0);
  assert.equal(memory.setEnabled(false).enabled, false);
  assert.equal(memory.promptContext().enabled, false);
  assert.equal(memory.promptContext().summary, "");
  assert.equal(memory.setEnabled(true).enabled, true);
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
