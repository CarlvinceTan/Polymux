import assert from "node:assert/strict";
import test from "node:test";
import {parseAcpRegistry} from "./registry.js";

test("ACP registry distributions become launch presets", () => {
  assert.deepEqual(parseAcpRegistry({agents: [
    {id: "codex-acp", name: "Codex", version: "1.2.3", description: "Adapter", icon: "https://example.test/codex.svg", distribution: {npx: {package: "@acp/codex@1.2.3", args: ["--quiet"]}}},
    {id: "python", name: "Python agent", distribution: {uvx: {package: "python-agent", args: ["serve"]}}},
    {id: "junie", name: "Junie", version: "3032.2.0", distribution: {binary: {"darwin-aarch64": {cmd: "./Applications/junie.app/Contents/MacOS/junie", args: ["--acp=true"]}}}},
    {id: "poolside", name: "Poolside", distribution: {binary: {"darwin-aarch64": {cmd: "./pool-darwin-arm64", args: ["acp"]}}}},
  ]}, (command, packageSpec) => (command === "npx" && packageSpec === "@acp/codex@1.2.3") || command === "junie", "darwin-aarch64"), [
    {id: "codex-acp", name: "Codex", version: "1.2.3", description: "Adapter", icon: "https://example.test/codex.svg", installed: true, command: "npx", args: ["-y", "@acp/codex@1.2.3", "--quiet"]},
    {id: "python", name: "Python agent", version: "", description: "", icon: "", installed: false, command: "uvx", args: ["python-agent", "serve"]},
    {id: "junie", name: "Junie", version: "3032.2.0", description: "", icon: "", installed: true, command: "junie", args: ["--acp=true"]},
    {id: "poolside", name: "Poolside", version: "", description: "", icon: "", installed: false, command: "pool", args: ["acp"]},
  ]);
});

test("ACP registry ignores binaries for a different platform", () => {
  assert.deepEqual(parseAcpRegistry({agents: [{
    id: "linux-only",
    name: "Linux only",
    distribution: {binary: {"linux-x86_64": {cmd: "./agent", args: ["acp"]}}},
  }]}, () => false, "darwin-aarch64"), [{
    id: "linux-only",
    name: "Linux only",
    version: "",
    description: "",
    icon: "",
    installed: false,
    command: "",
    args: [],
  }]);
});
