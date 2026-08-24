import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { KeyedMutex, writeFileAtomicSync } from "../src/index.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("work on one key runs in the order it was asked for", async () => {
  const locks = new KeyedMutex();
  const order: string[] = [];
  const first = deferred();
  const a = locks.run("k", async () => {
    order.push("a:start");
    await first.promise;
    order.push("a:end");
  });
  const b = locks.run("k", () => {
    order.push("b");
  });
  // b must not have started while a is still inside its await.
  await Promise.resolve();
  assert.deepEqual(order, ["a:start"]);
  first.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(order, ["a:start", "a:end", "b"]);
});

// The point of keying by path rather than by account: two chats saving two
// different drafts are two deliverables, not a conflict, and must not queue.
test("different keys never wait on each other", async () => {
  const locks = new KeyedMutex();
  const started: string[] = [];
  const held = deferred();
  const slow = locks.run("draft-a", async () => {
    started.push("a");
    await held.promise;
  });
  await locks.run("draft-b", () => {
    started.push("b");
  });
  assert.deepEqual(started, ["a", "b"]);
  held.resolve();
  await slow;
});

test("a failed holder releases the key instead of wedging it", async () => {
  const locks = new KeyedMutex();
  await assert.rejects(
    locks.run("k", () => Promise.reject(new Error("upload failed"))),
    /upload failed/,
  );
  assert.equal(await locks.run("k", () => "next caller ran"), "next caller ran");
});

test("a key with nothing waiting on it is forgotten", async () => {
  const locks = new KeyedMutex();
  await locks.run("k", (): undefined => undefined);
  await Promise.resolve();
  assert.equal(locks.held("k"), false);
});

test("an atomic write replaces the file and leaves no temporary behind", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "polymux-atomic-"));
  const file = path.join(directory, "registry.md");
  writeFileSync(file, "old");
  writeFileAtomicSync(file, "new");
  assert.equal(readFileSync(file, "utf8"), "new");
  assert.deepEqual(readdirSync(directory), ["registry.md"]);
});

test("a failed atomic write leaves the original in place", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "polymux-atomic-"));
  const file = path.join(directory, "registry.md");
  writeFileSync(file, "old");
  assert.throws(() =>
    writeFileAtomicSync(path.join(directory, "missing", "registry.md"), "new"),
  );
  assert.equal(readFileSync(file, "utf8"), "old");
  assert.deepEqual(readdirSync(directory), ["registry.md"]);
});
