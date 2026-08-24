import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverAgentMcpServers, resolveDiscoveredMcp } from "./discovery.js";

function home(): string {
  return mkdtempSync(path.join(tmpdir(), "polymux-mcp-discovery-"));
}

function write(root: string, file: string, contents: string): void {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), {recursive: true});
  writeFileSync(target, contents, "utf8");
}

test("reads servers out of another agent's json configuration", () => {
  const root = home();
  write(root, ".claude/mcp.json", JSON.stringify({
    mcpServers: {linear: {url: "https://mcp.linear.app/sse", description: "Issues."}},
  }));
  const [group] = discoverAgentMcpServers(new Set(), root);
  assert.equal(group.label, "Claude");
  assert.equal(group.path, "~/.claude/mcp.json");
  assert.deepEqual(group.servers, [{
    id: "linear",
    name: "linear",
    description: "Issues.",
    transport: "streamable-http",
    target: "https://mcp.linear.app/sse",
    source: "claude",
    path: "~/.claude/mcp.json",
    state: "available",
  }]);
});

test("reads Codex's TOML, which spells the table mcp_servers", () => {
  const root = home();
  write(root, ".codex/config.toml", '[mcp_servers.files]\ncommand = "node"\nargs = ["files.mjs"]\n');
  const [group] = discoverAgentMcpServers(new Set(), root);
  assert.equal(group.label, "Codex");
  assert.equal(group.servers[0]?.target, "node");
});

test("a server Polymux already runs reports as loaded rather than offered", () => {
  const root = home();
  write(root, ".codex/config.toml", '[mcp_servers.files]\ncommand = "node"\n');
  const [group] = discoverAgentMcpServers(new Set(["files"]), root);
  assert.equal(group.servers[0]?.state, "loaded");
});

test("a settings file that never names its servers is not read as one", () => {
  const root = home();
  write(root, ".editor/settings.json", JSON.stringify({theme: {command: "dark"}}));
  assert.deepEqual(discoverAgentMcpServers(new Set(), root), []);
});

test("unreadable and empty configurations are skipped, not thrown", () => {
  const root = home();
  write(root, ".broken/mcp.json", "{ not json");
  write(root, ".empty/mcp.json", JSON.stringify({mcpServers: {}}));
  assert.deepEqual(discoverAgentMcpServers(new Set(), root), []);
});

test("Polymux's own servers are never offered back to it", () => {
  const root = home();
  write(root, ".polymux/mcp.json", JSON.stringify({mcpServers: {files: {command: "node"}}}));
  assert.deepEqual(discoverAgentMcpServers(new Set(), root), []);
});

test("adopting re-reads the file rather than trusting the window", () => {
  const root = home();
  write(root, ".codex/config.toml", '[mcp_servers.files]\ncommand = "node"\nargs = ["files.mjs"]\n');
  const found = resolveDiscoveredMcp("codex:config.toml", "files", root);
  assert.equal(found.id, "files");
  assert.equal(found.entry.command, "node");
  assert.deepEqual(found.entry.args, ["files.mjs"]);
  assert.throws(() => resolveDiscoveredMcp("codex:config.toml", "missing", root));
});
