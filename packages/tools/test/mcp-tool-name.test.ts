import assert from "node:assert/strict";
import test from "node:test";
import {exposedMcpToolName} from "../src/mcp/client.js";

test("MCP tool names satisfy OpenAI-compatible provider constraints", () => {
  const name = exposedMcpToolName("computer.use", "window/read:active");
  assert.match(name, /^[a-zA-Z0-9_-]+$/);
  assert.equal(name, "computer_2e_use__window_2f_read_3a_active");
});

test("escaping keeps otherwise-colliding MCP names distinct", () => {
  assert.notEqual(
    exposedMcpToolName("server", "read.file"),
    exposedMcpToolName("server", "read_file"),
  );
});
