import assert from "node:assert/strict";
import test from "node:test";
import {parseAcpRegistry} from "./registry.js";

test("ACP registry package distributions become launch presets", () => {
  assert.deepEqual(parseAcpRegistry({agents: [
    {id: "codex-acp", name: "Codex", version: "1.2.3", description: "Adapter", icon: "https://example.test/codex.svg", distribution: {npx: {package: "@acp/codex@1.2.3", args: ["--quiet"]}}},
    {id: "python", name: "Python agent", distribution: {uvx: {package: "python-agent", args: ["serve"]}}},
    {id: "binary", name: "Binary only", distribution: {binary: {"darwin-aarch64": {cmd: "./agent"}}}},
  ]}, (command, packageSpec) => command === "npx" && packageSpec === "@acp/codex@1.2.3"), [
    {id: "codex-acp", name: "Codex", version: "1.2.3", description: "Adapter", icon: "https://example.test/codex.svg", installed: true, command: "npx", args: ["-y", "@acp/codex@1.2.3", "--quiet"]},
    {id: "python", name: "Python agent", version: "", description: "", icon: "", installed: false, command: "uvx", args: ["python-agent", "serve"]},
    {id: "binary", name: "Binary only", version: "", description: "", icon: "", installed: false, command: "", args: []},
  ]);
});
