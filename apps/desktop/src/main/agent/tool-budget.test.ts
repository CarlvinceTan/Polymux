import assert from "node:assert/strict";
import test from "node:test";
import type {AgentTool, AgentToolContext} from "@flareai/core";
import {createPerRunCallLimit, withPerRunCallLimit} from "./tool-budget.js";

function context(runId: string, subagent = true, budgetScope?: string): AgentToolContext {
  return {
    runId,
    budgetScope,
    turn: 1,
    callId: crypto.randomUUID(),
    signal: new AbortController().signal,
    subagent,
    async emitProgress() {},
  };
}

test("bounds only delegated calls and keeps runs independent", async () => {
  let executions = 0;
  const original: AgentTool = {
    name: "research",
    description: "research",
    parameters: {type: "object"},
    async execute() {
      executions += 1;
      return {content: "evidence"};
    },
  };
  const tool = withPerRunCallLimit(original, 2, "Synthesize from current evidence.");
  assert.match(tool.description, /hard budget of 2 calls[\s\S]*including parallel calls/);

  assert.equal((await tool.execute({}, context("worker-a"))).content, "evidence");
  assert.equal((await tool.execute({}, context("worker-a"))).content, "evidence");
  const bounded = await tool.execute({}, context("worker-a"));
  assert.equal(bounded.content, "Synthesize from current evidence.");
  assert.deepEqual(bounded.metadata, {budgetReached: true, maximum: 2, attempted: 3});
  assert.equal((await tool.execute({}, context("worker-b"))).content, "evidence");
  assert.equal((await tool.execute({}, context("main", false))).content, "evidence");
  assert.equal(executions, 4);
});

test("one delegated research budget is shared across different tools", async () => {
  const wrap = createPerRunCallLimit(2, "stop");
  const first = wrap({name: "read", description: "read", parameters: {type: "object"}, async execute() { return {content: "read"}; }});
  const second = wrap({name: "browse", description: "browse", parameters: {type: "object"}, async execute() { return {content: "browse"}; }});
  assert.equal((await first.execute({}, context("worker"))).content, "read");
  assert.equal((await second.execute({}, context("worker"))).content, "browse");
  assert.equal((await first.execute({}, context("worker"))).content, "stop");
});

test("a continued worker keeps the logical research budget across run ids", async () => {
  const wrap = createPerRunCallLimit(2, "stop");
  const tool = wrap({name: "read", description: "read", parameters: {type: "object"}, async execute() { return {content: "read"}; }});
  assert.equal((await tool.execute({}, context("run-1", true, "parent:task_1"))).content, "read");
  assert.equal((await tool.execute({}, context("run-2", true, "parent:task_1"))).content, "read");
  assert.equal((await tool.execute({}, context("run-2", true, "parent:task_1"))).content, "stop");
  assert.equal((await tool.execute({}, context("run-2", true, "parent:task_2"))).content, "read");
});

test("exempt workflow actions do not consume the shared research budget", async () => {
  const wrap = createPerRunCallLimit(1, "stop");
  const browser = wrap(
    {name: "browser", description: "browser", parameters: {type: "object"}, async execute(input) { return {content: String((input as {action?: string}).action)}; }},
    (input) => (input as {action?: string}).action === "open",
  );
  const research = wrap({name: "research", description: "research", parameters: {type: "object"}, async execute() { return {content: "evidence"}; }});

  assert.equal((await browser.execute({action: "fill"}, context("worker"))).content, "fill");
  assert.equal((await browser.execute({action: "get"}, context("worker"))).content, "get");
  assert.equal((await research.execute({}, context("worker"))).content, "evidence");
  assert.equal((await browser.execute({action: "fill"}, context("worker"))).content, "fill");
  assert.equal((await browser.execute({action: "open"}, context("worker"))).content, "stop");
});
