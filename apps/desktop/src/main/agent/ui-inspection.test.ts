import assert from "node:assert/strict";
import test from "node:test";
import {createPolymuxUiInspectionTool} from "./ui-inspection.js";

test("UI inspection prefers schema guidance without requiring provider constrained sampling", () => {
  const tool = createPolymuxUiInspectionTool({
    openSettings: async () => {},
    snapshot: async () => ({
      image: {data: "", mimeType: "image/png"},
      text: "",
      images: [],
    }),
  });
  assert.equal(tool.strict, "prefer");
});

const context = {
  runId: "run", turn: 1, callId: "call", signal: new AbortController().signal,
  async emitProgress() {},
};

test("inspects the rendered Memory view without a general navigation surface", async () => {
  const opened: string[] = [];
  const tool = createPolymuxUiInspectionTool({
    async openSettings(mode) { opened.push(mode); },
    async snapshot() {
      return {
        image: {data: "AAAA", mimeType: "image/png" as const},
        text: "Memory Apps excluded from memory",
        images: [{alt: "Zed", source: "data:image/png;base64,AAAA", loaded: true, width: 32, height: 32}],
      };
    },
  });
  const result = await tool.execute({view: "memory"}, context);
  assert.deepEqual(opened, ["memory"]);
  assert.match(JSON.stringify(result.content), /Memory Apps excluded from memory/);
  assert.match(JSON.stringify(result.content), /loaded\\\":true/);
});

test("refuses any UI view outside the bounded contract", async () => {
  const tool = createPolymuxUiInspectionTool({
    async openSettings() { throw new Error("must not run"); },
    async snapshot() { throw new Error("must not run"); },
  });
  const result = await tool.execute({view: "general"}, context);
  assert.equal(result.isError, true);
});
