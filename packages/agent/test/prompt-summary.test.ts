import assert from "node:assert/strict";
import test from "node:test";
import {memorySummaryBlockCount, memorySummaryForPrompt, memorySummarySelectionForPrompt, selectRelevantMemorySummary} from "../src/memory/prompt-summary.js";

const summary = `v1

## User Profile

Carlvince studies computing and is planning an NUS exchange.

## User preferences

- For Singapore searches, verify work authorisation and official job dates.
- When teaching Go, explain runtime flow.
- Never submit a form or guess missing personal data.
- Keep email replies concise and draft by default.
- Interests include AI, entrepreneurship, hiking, and social sport.

## What's in Memory

- NUS exchange and Singapore housing timeline.
- Chess engine debugging notes.`;

test("selects relevant durable context while retaining identity", () => {
  const selected = selectRelevantMemorySummary(summary, "Has anything changed that affects my Singapore plans?");
  assert.match(selected, /Carlvince studies computing/);
  assert.match(selected, /Singapore searches/);
  assert.match(selected, /NUS exchange and Singapore housing/);
  assert.doesNotMatch(selected, /Never submit a form/);
  assert.doesNotMatch(selected, /teaching Go|Chess engine/);
});

test("topic aliases retain communication preferences for natural requests", () => {
  const selected = selectRelevantMemorySummary(summary, "Reply to Dad and say I will arrive at 7");
  assert.match(selected, /email replies concise/);
  assert.doesNotMatch(selected, /Never submit a form/);
  assert.doesNotMatch(selected, /teaching Go/);
});

test("realistic NUSync requests retain personal event and exchange context", () => {
  const selected = selectRelevantMemorySummary(summary, "Find the latest events from NUSync that I might be interested in");
  assert.match(selected, /Carlvince studies computing/);
  assert.match(selected, /NUS exchange and Singapore housing/);
  assert.match(selected, /AI, entrepreneurship, hiking/);
  assert.doesNotMatch(selected, /teaching Go|Chess engine/);
});

test("personal recommendation wording retains explicit interests but not unrelated rules", () => {
  const selected = selectRelevantMemorySummary(summary, "Which Friday event would you pick for me?");
  assert.match(selected, /AI, entrepreneurship, hiking/);
  assert.doesNotMatch(selected, /teaching Go|Never submit a form|email replies concise/);
});

test("generic action wording does not mistake for me for recommendation intent", () => {
  const selected = selectRelevantMemorySummary(summary, "Fill this in for me and stop before submitting");
  assert.match(selected, /Never submit a form/);
  assert.doesNotMatch(selected, /AI, entrepreneurship, hiking/);
});

test("request-route selection prefers multi-concept client context over another service on the same host", () => {
  const setup = `## User Profile

Carlvince uses a remote Aorus system.

## What's in Memory

- Aorus hosts an OpenCode model client and inference endpoint for Qwen.
- Aorus also hosts a Windows VM with an n8n scheduled task on port 5678.
- An unrelated workstation note.`;
  const selected = selectRelevantMemorySummary(setup, "Is Aorus ready for me to send it a request?");
  assert.match(selected, /OpenCode model client/);
  assert.doesNotMatch(selected, /n8n scheduled task|unrelated workstation/);
});

test("relevance selection is experimental and delegated runs still carry no summary", () => {
  assert.equal(memorySummaryForPrompt({
    summary,
    prompt: "Singapore plans",
    orchestrationExperiment: false,
    subagent: false,
  }), summary);
  assert.doesNotMatch(memorySummaryForPrompt({
    summary,
    prompt: "Singapore plans",
    orchestrationExperiment: true,
    subagent: false,
  })!, /teaching Go/);
  assert.equal(memorySummaryForPrompt({
    summary,
    prompt: "Singapore plans",
    orchestrationExperiment: true,
    subagent: true,
  }), undefined);
});

test("a vague deictic prompt keeps identity without leaking unrelated topics", () => {
  const selected = selectRelevantMemorySummary(summary, "Can you explain what this is?");
  assert.match(selected, /## User Profile/);
  assert.doesNotMatch(selected, /Singapore searches|teaching Go|Chess engine|email replies/);
});

test("ordinary temporal before wording does not request previous-history memory", () => {
  const selected = selectRelevantMemorySummary(
    summary,
    "I've got two hours before my next thing. Find a quiet place nearby for my laptop.",
  );
  assert.match(selected, /## User Profile/);
  assert.doesNotMatch(selected, /Singapore searches|Chess engine|email replies|Never submit/);
});

test("counts selected memory blocks without exposing their contents", () => {
  assert.equal(memorySummaryBlockCount(undefined), 0);
  assert.equal(memorySummaryBlockCount("one plain note"), 1);
  const selected = selectRelevantMemorySummary(summary, "Find NUSync events I might like");
  assert.equal(memorySummaryBlockCount(selected), 4);
  assert.deepEqual(memorySummarySelectionForPrompt({
    summary,
    prompt: "Find NUSync events I might like",
    orchestrationExperiment: true,
    subagent: false,
  }), {summary: selected, candidateBlocks: 8, retainedBlocks: 4});
  assert.deepEqual(memorySummarySelectionForPrompt({
    summary,
    prompt: "Find NUSync events I might like",
    orchestrationExperiment: false,
    subagent: false,
  }), {summary, candidateBlocks: 8, retainedBlocks: 8});
});
