import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { FileReloadWatcher } from "../file-reload-watcher.js";

test("debounces changes and observes atomic configuration replacement", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "flareai-reload-"));
  const target = path.join(directory, "mcp.json");
  writeFileSync(target, "{}\n");
  let changes = 0;
  const watcher = new FileReloadWatcher(target, () => changes++, {
    debounceMs: 20,
  });
  watcher.start();
  try {
    writeFileSync(target, '{"mcpServers":{}}\n');
    writeFileSync(path.join(directory, "unrelated.json"), "{}\n");
    writeFileSync(target, "{}\n");
    await until(() => changes === 1);
    assert.equal(changes, 1);
  } finally {
    watcher.stop();
  }
});

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for file change");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
