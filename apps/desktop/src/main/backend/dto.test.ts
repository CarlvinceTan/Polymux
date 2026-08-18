import assert from "node:assert/strict";
import {test} from "node:test";
import {assistantText} from "./dto.js";

test("a plain string message is its own text", () => {
  assert.equal(assistantText("  Done.  "), "Done.");
});

test("only text blocks survive — reasoning and tool traffic are dropped", () => {
  const content = [
    {type: "reasoning", text: "The user said \"done\". Looking at the current state…"},
    {type: "tool_use", name: "read", input: {path: "a.ts"}},
    {type: "text", text: "Your reminders are all linked."},
  ];
  assert.equal(assistantText(content), "Your reminders are all linked.");
});

test("several text blocks read as paragraphs", () => {
  const content = [
    {type: "text", text: "First."},
    {type: "reasoning", text: "hidden"},
    {type: "text", text: "Second."},
  ];
  assert.equal(assistantText(content), "First.\n\nSecond.");
});

test("a block list with no prose in it yields nothing to say", () => {
  assert.equal(assistantText([{type: "reasoning", text: "thinking"}]), "");
  assert.equal(assistantText([{type: "tool_use", name: "bash"}]), "");
});

test("an untyped block with text is taken as text", () => {
  assert.equal(assistantText([{text: "Hello."}]), "Hello.");
  assert.equal(assistantText({text: "Hello."}), "Hello.");
});

test("shapes that carry no text at all are empty, not stringified", () => {
  for (const value of [null, undefined, 42, {}, [], {type: "text"}])
    assert.equal(assistantText(value), "");
});
