import assert from "node:assert/strict";
import test from "node:test";
import {parseMcpRegistry} from "./registry.js";

test("parses latest remote MCP registry entries and required configuration", () => {
  const entries = parseMcpRegistry({servers: [{server: {
    name: "io.example/files",
    title: "Files",
    description: "Browse files",
    version: "1.0.0",
    remotes: [{type: "streamable-http", url: "https://example.com/mcp", headers: [{name: "Authorization", isRequired: true}]}],
  }}]});
  assert.deepEqual(entries, [{
    id: "io.example/files",
    name: "Files",
    description: "Browse files",
    url: "https://example.com/mcp",
    repository: undefined,
    requiredHeaders: ["Authorization"],
  }]);
});

test("omits package-only registry entries", () => {
  assert.deepEqual(parseMcpRegistry({servers: [{server: {name: "io.example/local", packages: [{registryType: "npm", identifier: "example"}]}}]}), []);
});
