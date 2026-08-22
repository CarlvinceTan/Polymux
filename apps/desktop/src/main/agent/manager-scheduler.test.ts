import assert from "node:assert/strict";
import test from "node:test";
import type {JsonValue} from "@flareai/storage";
import {ChatPool} from "./chat-pool.js";
import {
  MANAGER_CHAT_RUN_LIMIT,
  MANAGER_GLOBAL_RUN_LIMIT,
  managerClaimContextThroughSequence,
  managerContextThroughSequence,
  managerJobRequiresExclusiveRun,
  managerRunCapacity,
} from "./manager-scheduler.js";

class Preferences {
  value: JsonValue | undefined;
  getPreference(): {value: JsonValue} | null {
    return this.value === undefined ? null : {value: this.value};
  }
  setPreference(_key: string, value: JsonValue): void {
    this.value = structuredClone(value);
  }
}

function board(): ChatPool {
  return new ChatPool(new Preferences(), {
    newMessageId: (() => {
      let sequence = 0;
      return () => `message-${++sequence}`;
    })(),
  });
}

test("two independent jobs may be claimed before either run settles", () => {
  const jobs = board();
  jobs.enqueue({id: "one", chatId: "chat", text: "Find current events"});
  jobs.enqueue({id: "two", chatId: "chat", text: "Check library opening hours"});
  assert.equal(managerRunCapacity({jobs: jobs.list(), activeTopLevelRuns: [], chatId: "chat"}), 2);
  jobs.claimNext("run-one", "chat");
  assert.equal(managerRunCapacity({jobs: jobs.list(), activeTopLevelRuns: [], chatId: "chat"}), 1);
  jobs.claimNext("run-two", "chat");
  assert.equal(managerRunCapacity({jobs: jobs.list(), activeTopLevelRuns: [], chatId: "chat"}), 0);
  assert.equal(jobs.list("chat").filter((job) => job.status === "running").length, 2);
});

test("independent siblings inherit the original settled-history boundary", () => {
  const jobs = board();
  jobs.enqueue({
    id: "one",
    chatId: "chat",
    text: "Find events",
    contextThroughSequence: 12,
  });
  jobs.claimNext("run-one", "chat");
  assert.equal(managerContextThroughSequence({
    jobs: jobs.list(),
    chatId: "chat",
    job: {text: "Find opening hours", asGoal: false, dependencyIds: []},
    latestSequence: 13,
  }), 12);
  assert.equal(managerContextThroughSequence({
    jobs: jobs.list(),
    chatId: "chat",
    job: {text: "Send Dad the result", asGoal: false, dependencyIds: []},
    latestSequence: 13,
  }), 13);
});

test("natural continuations refresh context when their exclusive lane opens", () => {
  assert.equal(managerClaimContextThroughSequence({
    text: "After that, draft the message but do not send it",
    asGoal: false,
    dependencyIds: [],
  }, 21), 21);
  for (const text of [
    "Afterwards, draft the note",
    "Once that is done, summarise it",
    "When it's done, tell me the result",
  ])
    assert.equal(managerClaimContextThroughSequence({text}, 21), 21, text);
  assert.equal(managerClaimContextThroughSequence({
    text: "Find a separate official address",
    asGoal: false,
    dependencyIds: [],
  }, 21), undefined);
});

test("capacity enforces chat and global limits without double-counting started manager runs", () => {
  const jobs = board();
  for (let index = 0; index < MANAGER_GLOBAL_RUN_LIMIT; index += 1) {
    const chatId = `chat-${index}`;
    jobs.enqueue({id: `job-${index}`, chatId, text: `Research topic ${index}`});
    jobs.claimNext(`run-${index}`, chatId);
  }
  assert.equal(managerRunCapacity({
    jobs: jobs.list(),
    activeTopLevelRuns: jobs.list().map((job) => ({runId: job.runId!, conversationId: job.chatId})),
    chatId: "waiting-chat",
  }), 0);
  assert.equal(MANAGER_CHAT_RUN_LIMIT, 2);
});

test("a failed start releases its durable slot immediately", () => {
  const jobs = board();
  jobs.enqueue({id: "failed", chatId: "chat", text: "Find events"});
  jobs.enqueue({id: "waiting", chatId: "chat", text: "Find opening hours"});
  jobs.claimNext("run-failed", "chat");
  jobs.fail("failed", "provider unavailable");
  assert.equal(managerRunCapacity({jobs: jobs.list(), activeTopLevelRuns: [], chatId: "chat"}), 2);
  assert.equal(jobs.claimNext("run-waiting", "chat")?.id, "waiting");
});

test("goals, dependencies, continuations, and external commits remain exclusive", () => {
  const jobs = board();
  const goal = jobs.enqueue({id: "goal", chatId: "chat", text: "Prepare my week", asGoal: true});
  const independent = jobs.enqueue({id: "research", chatId: "chat", text: "Research NUS events"});
  const dependent = jobs.enqueue({id: "dependent", chatId: "chat", text: "Draft summary", dependencyIds: ["research"]});
  const continuation = jobs.enqueue({id: "continue", chatId: "chat", text: "Continue with the best option"});
  const commit = jobs.enqueue({id: "commit", chatId: "chat", text: "Send Dad the result"});
  assert.equal(managerJobRequiresExclusiveRun(independent), false);
  for (const job of [goal, dependent, continuation, commit])
    assert.equal(managerJobRequiresExclusiveRun(job), true, job.id);
});

test("a cancelled exclusive run keeps the lane closed until the agent settles", () => {
  const jobs = board();
  jobs.enqueue({id: "send", chatId: "chat", text: "Send Dad the result"});
  jobs.enqueue({id: "waiting", chatId: "chat", text: "Find events"});
  jobs.claimNext("run-send", "chat");
  jobs.cancel("send");
  assert.equal(managerRunCapacity({
    jobs: jobs.list(),
    activeTopLevelRuns: [{runId: "run-send", conversationId: "chat"}],
    chatId: "chat",
  }), 0);
  assert.equal(managerRunCapacity({jobs: jobs.list(), activeTopLevelRuns: [], chatId: "chat"}), 2);
});

test("manager scheduling has no candidate-store coordination surface", async () => {
  const source = await import("node:fs/promises").then(({readFile}) =>
    readFile(new URL("./manager-scheduler.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /shared_pool|candidate.store/i);
});
