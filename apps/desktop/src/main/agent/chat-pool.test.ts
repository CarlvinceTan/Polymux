import assert from "node:assert/strict";
import test from "node:test";
import type {JsonValue} from "@flareai/storage";
import {ChatPool} from "./chat-pool.js";

class Preferences {
  readonly values = new Map<string, JsonValue>();
  getPreference(key: string) {
    const value = this.values.get(key);
    return value === undefined ? null : {value};
  }
  setPreference(key: string, value: JsonValue) {
    this.values.set(key, structuredClone(value));
  }
}

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 21, 8, 0, tick++));
}

test("attention work preempts queued normal work without losing FIFO order", () => {
  const board = new ChatPool(new Preferences(), {clock: clock()});
  board.enqueue({id: "normal-1", chatId: "chat", text: "Research travel changes"});
  board.enqueue({id: "normal-2", chatId: "chat", text: "Find events"});
  board.enqueue({id: "urgent", chatId: "chat", text: "Check NUS replies", priority: "attention"});
  assert.equal(board.claimNext("run-1")?.id, "urgent");
  board.complete("urgent");
  assert.equal(board.claimNext("run-2")?.id, "normal-1");
  board.complete("normal-1");
  assert.equal(board.claimNext("run-3")?.id, "normal-2");
});

test("dependent work waits for its prerequisite and blocks if it fails", () => {
  const board = new ChatPool(new Preferences(), {clock: clock()});
  board.enqueue({id: "research", chatId: "chat", text: "Find what I need"});
  board.enqueue({id: "draft", chatId: "chat", text: "Draft replies", dependencyIds: ["research"]});
  assert.equal(board.claimNext("run-research")?.id, "research");
  assert.equal(board.claimNext("run-none"), null);
  board.fail("research", "mail unavailable");
  assert.equal(board.list().find((job) => job.id === "draft")?.status, "blocked");
});

test("restart requeues interrupted work without duplicating or leaking chats", () => {
  const preferences = new Preferences();
  const first = new ChatPool(preferences, {clock: clock(), newMessageId: () => "message-a"});
  first.enqueue({id: "a", chatId: "chat-a", text: "Dad message"});
  first.enqueue({id: "b", chatId: "chat-b", text: "Study spot"});
  first.claimNext("run-a", "chat-a");
  const restored = new ChatPool(preferences, {clock: clock()});
  assert.deepEqual(restored.list("chat-a").map((job) => [job.id, job.messageId, job.status, job.runId]), [["a", "message-a", "queued", null]]);
  assert.deepEqual(restored.list("chat-b").map((job) => job.id), ["b"]);
  assert.equal(restored.claimNext("run-b", "chat-b")?.id, "b");
  assert.equal(restored.list("chat-a")[0]?.status, "queued");
});

test("saved conversation ids migrate once to chat ids", () => {
  const preferences = new Preferences();
  const first = new ChatPool(preferences, {clock: clock()});
  first.enqueue({id: "legacy", chatId: "chat", text: "Keep this task"});
  const key = "orchestration-manager-jobs-v1";
  const stored = structuredClone(preferences.values.get(key)) as Array<Record<string, JsonValue>>;
  stored[0]!.conversationId = stored[0]!.chatId!;
  delete stored[0]!.chatId;
  preferences.values.set(key, stored);

  const migrated = new ChatPool(preferences, {clock: clock()});
  assert.equal(migrated.list("chat")[0]?.chatId, "chat");
  const rewritten = preferences.values.get(key) as Array<Record<string, JsonValue>>;
  assert.equal(rewritten[0]?.chatId, "chat");
  assert.equal("conversationId" in rewritten[0]!, false);
});

test("scheduler jobs durably freeze context and reply ownership", () => {
  const preferences = new Preferences();
  const first = new ChatPool(preferences, {clock: clock()});
  const queued = first.enqueue({
    id: "isolated-job",
    chatId: "chat",
    text: "Find current events",
    contextThroughSequence: 17,
    executionScopeId: "scope-isolated-job",
    replyToMessageId: "user-row-isolated-job",
  });
  assert.deepEqual(
    [queued.contextThroughSequence, queued.executionScopeId, queued.replyToMessageId],
    [17, "scope-isolated-job", "user-row-isolated-job"],
  );

  const restored = new ChatPool(preferences, {clock: clock()});
  const job = restored.list("chat")[0]!;
  assert.deepEqual(
    [job.contextThroughSequence, job.executionScopeId, job.replyToMessageId],
    [17, "scope-isolated-job", "user-row-isolated-job"],
  );
});

test("a dependency refreshes its context boundary only when it is claimed", () => {
  const preferences = new Preferences();
  const board = new ChatPool(preferences, {clock: clock()});
  board.enqueue({id: "research", chatId: "chat", text: "Find the hours", contextThroughSequence: 4});
  board.enqueue({
    id: "draft",
    chatId: "chat",
    text: "Based on that result, draft a note",
    dependencyIds: ["research"],
    contextThroughSequence: 4,
  });
  board.claimNext("run-research", "chat");
  board.complete("research");
  const claimed = board.claimNext("run-draft", "chat", {contextThroughSequence: 9});
  assert.equal(claimed?.contextThroughSequence, 9);
  assert.equal(new ChatPool(preferences).list("chat").find((job) => job.id === "draft")?.contextThroughSequence, 9);
});

test("cancellation is exact and does not disturb useful sibling jobs", () => {
  const board = new ChatPool(new Preferences(), {clock: clock()});
  board.enqueue({id: "events", chatId: "chat", text: "Find events"});
  board.enqueue({id: "messages", chatId: "chat", text: "Check replies"});
  board.cancel("events");
  assert.equal(board.list().find((job) => job.id === "events")?.status, "cancelled");
  assert.equal(board.claimNext("run-messages")?.id, "messages");
});

test("only queued work can be reprioritized", () => {
  const board = new ChatPool(new Preferences(), {clock: clock()});
  board.enqueue({id: "job", chatId: "chat", text: "Work"});
  assert.equal(board.reprioritize("job", "urgent").priority, "urgent");
  board.claimNext("run");
  assert.throws(() => board.reprioritize("job", "normal"), /Only queued/);
});

test("ready and run lookups expose stable identities without mutating order", () => {
  const board = new ChatPool(new Preferences(), {clock: clock()});
  board.enqueue({id: "normal", chatId: "chat", text: "Normal"});
  board.enqueue({id: "urgent", chatId: "chat", text: "Urgent", priority: "urgent"});
  assert.equal(board.nextReady("chat")?.id, "urgent");
  assert.equal(board.nextReady("chat")?.id, "urgent");
  assert.equal(board.claimNext("run-urgent", "chat")?.id, "urgent");
  assert.equal(board.forRun("run-urgent")?.id, "urgent");
  assert.equal(board.forRun("missing"), null);
});

test("chat cleanup removes only that chat's durable tasks", () => {
  const board = new ChatPool(new Preferences(), {clock: clock()});
  board.enqueue({id: "a-1", chatId: "chat-a", text: "First"});
  board.enqueue({id: "a-2", chatId: "chat-a", text: "Second"});
  board.enqueue({id: "b-1", chatId: "chat-b", text: "Keep me"});
  assert.equal(board.removeChat("chat-a"), 2);
  assert.deepEqual(board.list().map((job) => job.id), ["b-1"]);
  assert.equal(board.removeChat("missing"), 0);
});

test("Tasks projects only the selected chat's tasks", () => {
  const board = new ChatPool(new Preferences(), {clock: clock()});
  board.createCard({chatId: "chat-a", title: "First chat task"});
  board.createCard({chatId: "chat-b", title: "Second chat task"});
  assert.deepEqual(board.cards("chat-a").map((card) => [card.chatId, card.title]), [
    ["chat-a", "First chat task"],
  ]);
  assert.deepEqual(board.cards("chat-b").map((card) => card.title), ["Second chat task"]);
});

test("manual reorder is durable within one priority lane", () => {
  const preferences = new Preferences();
  const board = new ChatPool(preferences, {clock: clock()});
  board.enqueue({id: "first", chatId: "chat", text: "First"});
  board.enqueue({id: "second", chatId: "chat", text: "Second"});
  board.enqueue({id: "third", chatId: "chat", text: "Third"});
  board.reorder("third", "first");
  assert.equal(board.claimNext("run-third")?.id, "third");
  board.complete("third");
  const restored = new ChatPool(preferences, {clock: clock()});
  assert.equal(restored.claimNext("run-first")?.id, "first");
});

test("manual reorder refuses cross-chat and cross-priority moves", () => {
  const board = new ChatPool(new Preferences(), {clock: clock()});
  board.enqueue({id: "normal", chatId: "chat", text: "Normal"});
  board.enqueue({id: "urgent", chatId: "chat", text: "Urgent", priority: "urgent"});
  board.enqueue({id: "other", chatId: "other", text: "Other"});
  assert.throws(() => board.reorder("normal", "urgent"), /different priorities/);
  assert.throws(() => board.reorder("normal", "other"), /one chat/);
});

test("terminal history is bounded per chat without pruning active dependencies", () => {
  const board = new ChatPool(new Preferences(), {clock: clock(), terminalHistoryLimit: 2});
  for (const id of ["old", "middle", "newest"]) {
    board.enqueue({id, chatId: "chat", text: id});
    board.claimNext(`run-${id}`, "chat");
    board.complete(id);
  }
  assert.deepEqual(board.list("chat").map((job) => job.id), ["middle", "newest"]);

  board.enqueue({id: "dependency", chatId: "chat", text: "dependency"});
  board.claimNext("run-dependency", "chat");
  board.complete("dependency");
  board.enqueue({id: "waiting", chatId: "chat", text: "waiting", dependencyIds: ["dependency"]});
  board.enqueue({id: "new-terminal", chatId: "other", text: "other"});
  board.claimNext("run-new-terminal", "other");
  board.complete("new-terminal");
  assert.ok(board.list("chat").some((job) => job.id === "dependency"));
});
