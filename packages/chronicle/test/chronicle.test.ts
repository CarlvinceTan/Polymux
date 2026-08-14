import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ChronicleManager,
  type ChronicleFrame,
  type ChronicleSystemState,
  frameSignature,
  signatureDifference,
  textSignature,
} from "../src/index.js";

function frame(signature: number[], image = "image"): ChronicleFrame {
  return {
    sourceId: "screen:1:0",
    sourceName: "Entire Screen",
    displayId: "1",
    width: 1280,
    height: 720,
    image: Buffer.from(image),
    signature: Uint8Array.from(signature),
  };
}

const active: ChronicleSystemState = {
  idleSeconds: 0,
  locked: false,
  onBattery: false,
  thermalState: "nominal",
};

test("stores only meaningful changes plus bounded heartbeats", async () => {
  let now = new Date("2026-08-13T12:00:00.000Z");
  let next = frame([10, 20, 30]);
  const manager = new ChronicleManager({
    directory: mkdtempSync(path.join(tmpdir(), "midas-chronicle-")),
    frames: { capture: async () => [next] },
    system: { current: () => active },
    clock: () => now,
  });

  assert.equal((await manager.captureOnce())[0]?.reason, "initial");
  now = new Date("2026-08-13T12:00:05.000Z");
  assert.equal((await manager.captureOnce()).length, 0);
  next = frame([100, 110, 120], "changed");
  assert.equal((await manager.captureOnce())[0]?.reason, "change");
  now = new Date("2026-08-13T12:01:06.000Z");
  assert.equal((await manager.captureOnce())[0]?.reason, "heartbeat");
  assert.equal(manager.status().storedFrames, 3);
  assert.match(readFileSync(manager.store.timelinePath, "utf8"), /· change · change 0\.353/);
});

test("does not capture while locked, idle, or thermally constrained", async () => {
  let system: ChronicleSystemState = { ...active, locked: true };
  let captures = 0;
  const manager = new ChronicleManager({
    directory: mkdtempSync(path.join(tmpdir(), "midas-chronicle-")),
    frames: { capture: async () => { captures++; return [frame([1])]; } },
    system: { current: () => system },
  });

  await manager.captureOnce();
  system = { ...active, idleSeconds: 100 };
  await manager.captureOnce();
  system = { ...active, thermalState: "serious" };
  await manager.captureOnce();
  assert.equal(captures, 0);
});

test("starts enabled and persists an explicit opt-out", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "midas-chronicle-"));
  const manager = new ChronicleManager({
    directory,
    frames: { capture: async () => [] },
    system: { current: () => active },
    schedule: () => setTimeout(() => {}, 60_000),
  });

  assert.equal(manager.status().enabled, true);
  assert.equal(manager.setEnabled(false).enabled, false);
  manager.stop();
  assert.match(readFileSync(manager.store.instructionsPath, "utf8"), /never authorization/i);
});

test("stores accessibility text snapshots as markdown with their own kind", async () => {
  const manager = new ChronicleManager({
    directory: mkdtempSync(path.join(tmpdir(), "midas-chronicle-")),
    frames: {
      capture: async () => [{
        sourceId: "ax-com.apple.finder",
        sourceName: "Finder — Documents",
        displayId: null,
        width: 0,
        height: 0,
        image: new TextEncoder().encode("# Finder — Documents\n\nReports\nInvoices\n"),
        signature: textSignature("Documents\nReports\nInvoices"),
        kind: "text",
      }],
    },
    system: { current: () => active },
  });

  const [entry] = await manager.captureOnce();
  assert.equal(entry?.kind, "text");
  assert.match(entry!.path, /\.md$/);
  assert.match(readFileSync(entry!.path, "utf8"), /Invoices/);
});

test("text signatures separate different documents but tolerate small edits", () => {
  const base = textSignature("The quarterly report covers revenue, churn, and growth targets.");
  const edited = textSignature("The quarterly report covers revenue, churn, and growth target.");
  const different = textSignature("git status\nmain.ts modified\nnpm test passed\n0 failures");
  assert.equal(signatureDifference(base, base), 0);
  assert.ok(signatureDifference(base, edited) < 0.035, "small edit should stay under the change threshold");
  assert.ok(signatureDifference(base, different) > 0.035, "different content should cross the change threshold");
});

test("computes compact grayscale signatures and normalized differences", () => {
  const signature = frameSignature(Uint8Array.from([
    0, 0, 255, 255,
    255, 255, 255, 255,
  ]));
  assert.equal(signature.length, 2);
  assert.equal(signatureDifference(signature, signature), 0);
  assert.equal(signatureDifference(Uint8Array.from([0]), Uint8Array.from([255])), 1);
});
