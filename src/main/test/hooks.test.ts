import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {HookEngine, matchesTool, parseHookConfig} from "../hooks.js";

const call = (name: string, args: Record<string, string> = {}) => ({
  type: "toolCall" as const,
  id: "call-1",
  name,
  arguments: args,
});

async function withConfig(
  value: unknown,
  run: (engine: HookEngine, configPath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "midas-hooks-"));
  const configPath = path.join(dir, "hooks.json");
  try {
    if (value !== undefined)
      await writeFile(configPath, JSON.stringify(value), "utf8");
    await run(new HookEngine(configPath), configPath);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

test("no config file means every tool is allowed", async () => {
  await withConfig(undefined, async (engine) => {
    const decision = await engine.beforeTool(call("write"));
    assert.equal(decision.allow, true);
  });
});

test("a passing pre-tool hook allows the call", async () => {
  await withConfig(
    {hooks: [{event: "pre-tool", tools: ["write"], command: "exit 0"}]},
    async (engine) => {
      assert.equal((await engine.beforeTool(call("write"))).allow, true);
    },
  );
});

test("a failing pre-tool hook blocks with its stderr as the message", async () => {
  await withConfig(
    {hooks: [{event: "pre-tool", tools: ["write"], command: "echo denied by policy >&2; exit 2"}]},
    async (engine) => {
      const decision = await engine.beforeTool(call("write"));
      assert.equal(decision.allow, false);
      assert.match(decision.message ?? "", /denied by policy/);
    },
  );
});

test("hooks only run for matching tools", async () => {
  await withConfig(
    {hooks: [{event: "pre-tool", tools: ["write", "edit"], command: "exit 1"}]},
    async (engine) => {
      assert.equal((await engine.beforeTool(call("read"))).allow, true);
      assert.equal((await engine.beforeTool(call("edit"))).allow, false);
    },
  );
});

test("the hook receives the call payload on stdin", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "midas-hooks-out-"));
  const out = path.join(dir, "payload.json");
  try {
    await withConfig(
      {hooks: [{event: "pre-tool", command: `cat > ${JSON.stringify(out)}`}]},
      async (engine) => {
        await engine.beforeTool(call("bash", {command: "ls"}));
        const {readFile} = await import("node:fs/promises");
        const payload = JSON.parse(await readFile(out, "utf8"));
        assert.equal(payload.event, "pre-tool");
        assert.equal(payload.tool, "bash");
        assert.deepEqual(payload.arguments, {command: "ls"});
      },
    );
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test("a hung pre-tool hook fails closed on timeout", async () => {
  await withConfig(
    {hooks: [{event: "pre-tool", command: "sleep 30", timeoutMs: 300}]},
    async (engine) => {
      const decision = await engine.beforeTool(call("write"));
      assert.equal(decision.allow, false);
      assert.match(decision.message ?? "", /timed out/);
    },
  );
});

test("post-tool hooks observe results and never throw", async () => {
  await withConfig(
    {hooks: [{event: "post-tool", command: "exit 7"}]},
    async (engine) => {
      await engine.afterTool(call("write"), {content: "done"});
    },
  );
});

test("a malformed config disables hooks and reports the parse error", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "midas-hooks-bad-"));
  const configPath = path.join(dir, "hooks.json");
  try {
    await writeFile(configPath, "{not json", "utf8");
    const engine = new HookEngine(configPath);
    assert.equal((await engine.beforeTool(call("write"))).allow, true);
    assert.ok(engine.loadError);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test("config edits apply without restarting", async () => {
  await withConfig({hooks: []}, async (engine, configPath) => {
    assert.equal((await engine.beforeTool(call("write"))).allow, true);
    // Ensure the mtime moves even on coarse-grained filesystems.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(
      configPath,
      JSON.stringify({hooks: [{event: "pre-tool", command: "exit 1"}]}),
      "utf8",
    );
    assert.equal((await engine.beforeTool(call("write"))).allow, false);
  });
});

test("parseHookConfig validates entries", () => {
  assert.deepEqual(parseHookConfig({}), []);
  assert.throws(() => parseHookConfig({hooks: [{event: "sometimes", command: "x"}]}));
  assert.throws(() => parseHookConfig({hooks: [{event: "pre-tool", command: ""}]}));
  assert.throws(() => parseHookConfig({hooks: [{event: "pre-tool", command: "x", tools: 4}]}));
  const [rule] = parseHookConfig({hooks: [{event: "pre-tool", command: "x", timeoutMs: 999_999}]});
  assert.equal(rule.timeoutMs, 60_000);
});

test("matchesTool supports lists, regex, and wildcards", () => {
  assert.equal(matchesTool(undefined, "anything"), true);
  assert.equal(matchesTool("*", "anything"), true);
  assert.equal(matchesTool(["write", "edit"], "edit"), true);
  assert.equal(matchesTool(["write"], "read"), false);
  assert.equal(matchesTool("write|edit", "edit"), true);
  assert.equal(matchesTool("wri.*", "write"), true);
  assert.equal(matchesTool("wri.*", "read"), false);
});
