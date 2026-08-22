import assert from "node:assert/strict";
import {test} from "node:test";
import {compactPromptWindows, needsFreshDesktopContext} from "./environment-context.js";

test("refreshes desktop context for implicit current-screen references", () => {
  for (const prompt of [
    "Can you explain what this is?",
    "Fill in the form I have open",
    "Put the file I have open in the right folder",
    "What was I doing before I switched to this?",
    "Read what's on my screen",
    "Use that tab",
    "Check what's open",
    "Pick up where I left off",
    "Get me ready for NUS tomorrow",
    "Prepare me for my exchange orientation",
  ]) assert.equal(needsFreshDesktopContext(prompt), true, prompt);
});

test("collapses indistinguishable windows without losing count or focus", () => {
  assert.deepEqual(compactPromptWindows([
    {app: "Finder", title: "Finder", frontmost: false},
    {app: "Finder", title: "Finder", frontmost: true},
    {app: "Mail", title: "Inbox", frontmost: false},
  ]), [
    {app: "Finder", title: "Finder (2 windows)", frontmost: true},
    {app: "Mail", title: "Inbox", frontmost: false},
  ]);
});

test("does not delay unrelated personal-assistant requests", () => {
  for (const prompt of [
    "Find the latest events from NUSync that I might be interested in",
    "Reply to Dad and say I will be there at 7",
    "Find current Singapore visa guidance",
    "Remind me to submit the form tomorrow",
    "Find events this weekend",
    "Is this semester's NUS calendar published?",
  ]) assert.equal(needsFreshDesktopContext(prompt), false, prompt);
});
