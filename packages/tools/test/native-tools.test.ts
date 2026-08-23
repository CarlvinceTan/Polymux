import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createNativeTools, ToolRegistry } from "../src/index.js";

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "polymux-tools-"));
  const registry = new ToolRegistry(createNativeTools({ cwd }));
  const context = {
    runId: "run",
    turn: 1,
    callId: "call",
    signal: new AbortController().signal,
    emitProgress: async () => {},
  };
  return { cwd, registry, context };
}

test("default registry contains only the four lean native tools", async () => {
  const item = await fixture();
  try {
    assert.deepEqual(
      item.registry.list().map((tool) => tool.name),
      ["read", "bash", "edit", "write"],
    );
  } finally {
    await rm(item.cwd, { recursive: true, force: true });
  }
});

test("write, read and edit preserve exact file semantics", async () => {
  const item = await fixture();
  try {
    await item.registry
      .get("write")!
      .execute({ path: "note.txt", content: "one\ntwo\n" }, item.context);
    const read = await item.registry
      .get("read")!
      .execute({ path: "note.txt" }, item.context);
    assert.match(String(read.content), /1: one/);
    await item.registry
      .get("edit")!
      .execute(
        { path: "note.txt", edits: [{ oldText: "two", newText: "three" }] },
        item.context,
      );
    assert.equal(
      await readFile(join(item.cwd, "note.txt"), "utf8"),
      "one\nthree\n",
    );
  } finally {
    await rm(item.cwd, { recursive: true, force: true });
  }
});

test("edit rejects ambiguous replacements without changing the file", async () => {
  const item = await fixture();
  try {
    const path = join(item.cwd, "duplicate.txt");
    await writeFile(path, "same same");
    await assert.rejects(
      item.registry
        .get("edit")!
        .execute(
          { path, edits: [{ oldText: "same", newText: "new" }] },
          item.context,
        ),
      /not unique/,
    );
    assert.equal(await readFile(path, "utf8"), "same same");
  } finally {
    await rm(item.cwd, { recursive: true, force: true });
  }
});

test("bash returns output and failure state without an approval layer", async () => {
  const item = await fixture();
  try {
    const success = await item.registry
      .get("bash")!
      .execute(
        { command: process.platform === "win32" ? "Write-Output hello" : "printf hello" },
        item.context,
      );
    assert.match(String(success.content), /hello/);
    const failure = await item.registry
      .get("bash")!
      .execute({ command: "exit 7" }, item.context);
    assert.equal(failure.isError, true);
    assert.deepEqual(failure.metadata, {
      exitCode: 7,
      timedOut: false,
      truncated: false,
      logPath: null,
    });
  } finally {
    await rm(item.cwd, { recursive: true, force: true });
  }
});
