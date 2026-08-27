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

test("computer_state waits for a fresh desktop snapshot before reading it", async () => {
  let windows: Array<{app: string; title: string; frontmost: boolean}> = [];
  const computer = new Computer(() => ({windows}));
  const tool = createComputerTools(computer, {
    refreshState: async () => {
      await Promise.resolve();
      windows = [{app: "Finder", title: "Downloads", frontmost: true}];
    },
  }).find((candidate) => candidate.name === "computer_state")!;

  const output = await tool.execute({surfaces: ["apps", "windows"]}, context);
  const parsed = JSON.parse(output.content as string);

  assert.equal(parsed.user.app, "Finder");
  assert.equal(parsed.counts.apps, 1);
  assert.equal(parsed.counts.windows, 1);
  assert.equal(parsed.surfaces.some((surface: {title?: string}) => surface.title === "Downloads"), true);
});
