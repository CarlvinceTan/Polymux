import assert from "node:assert/strict";
import test from "node:test";
import {selectPromptTabs} from "./tab-context.js";

test("prompt tabs prefer visible state and then newest background pages", () => {
  const tabs = ["old", "visible", "newer", "newest"].map((tabId) => ({
    tabId,
    title: tabId,
    url: `https://${tabId}.example`,
  }));
  assert.deepEqual(
    selectPromptTabs(tabs, new Set(["visible"]), 3).map((tab) => tab.tabId),
    ["visible", "newest", "newer"],
  );
  assert.deepEqual(selectPromptTabs(tabs, new Set(), 0), []);
});
