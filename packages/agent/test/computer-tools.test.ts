import assert from "node:assert/strict";
import test from "node:test";
import {Computer} from "@polymux/computer";
import {createComputerTools} from "../src/computer/tools.js";

const context = {runId: "run-1"} as never;

test("computer_state returns all requested tabs plus the current user surface", async () => {
  const computer = new Computer(() => ({
    windows: [{app: "Zed", title: "Polymux", frontmost: true}],
    externalBrowserTabs: [
      {tabId: 1, windowId: 2, title: "Old tab", url: "https://example.com/old", active: false},
      {tabId: 2, windowId: 2, title: "Current tab", url: "https://example.com/current", active: true},
    ],
  }));
  const tool = createComputerTools(computer).find((candidate) => candidate.name === "computer_state")!;
  const output = await tool.execute({surfaces: ["tabs"]}, context);
  const parsed = JSON.parse(output.content as string);
  assert.equal(parsed.user.app, "Zed");
  assert.equal(parsed.surfaces.length, 2);
  assert.equal(parsed.counts.tabs, 2);
});
