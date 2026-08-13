import assert from "node:assert/strict";
import { test } from "node:test";
import { importMcpServers } from "../src/mcp/index.js";

test("imports conventional stdio and remote MCP configuration", () => {
  const configs = importMcpServers({
    mcpServers: {
      local: { command: "node", args: ["server.js"], env: { TOKEN: "value" } },
      remote: {
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer x" },
      },
    },
  });
  assert.equal(configs[0]?.transport, "stdio");
  assert.equal(configs[1]?.transport, "streamable-http");
});

test("imports the snake-case MCP table used by Codex", () => {
  const configs = importMcpServers({
    mcp_servers: {
      personal: {command: "node", args: ["server.mjs"], enabled: true},
      disabled: {url: "https://example.com/mcp", enabled: false},
    },
  });
  assert.equal(configs[0]?.id, "personal");
  assert.equal(configs[0]?.enabled, true);
  assert.equal(configs[1]?.enabled, false);
});
