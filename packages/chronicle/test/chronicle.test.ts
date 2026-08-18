import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ChronicleManager,
  type ChronicleFrame,
  type ChronicleSettings,
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
    directory: mkdtempSync(path.join(tmpdir(), "flareai-chronicle-")),
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
    directory: mkdtempSync(path.join(tmpdir(), "flareai-chronicle-")),
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
  const directory = mkdtempSync(path.join(tmpdir(), "flareai-chronicle-"));
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
    directory: mkdtempSync(path.join(tmpdir(), "flareai-chronicle-")),
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

function windowFrame(
  overrides: Partial<ChronicleFrame> & { sourceId: string },
): ChronicleFrame {
  return {
    sourceName: overrides.sourceId,
    displayId: null,
    width: 0,
    height: 0,
    image: Buffer.from(`# ${overrides.sourceId}\n\nbody text`),
    signature: textSignature(overrides.sourceId),
    kind: "text",
    ...overrides,
  };
}

function policyManager(frames: ChronicleFrame[]): ChronicleManager {
  return new ChronicleManager({
    directory: mkdtempSync(path.join(tmpdir(), "flareai-chronicle-")),
    frames: { capture: async () => frames },
    system: { current: () => active },
  });
}

test("records every app and site until the user narrows it", async () => {
  const frames = () => [
    windowFrame({ sourceId: "mail", app: "Mail", bundleId: "com.apple.mail" }),
    windowFrame({
      sourceId: "bank",
      app: "Safari",
      bundleId: "com.apple.Safari",
      url: "https://secure.bank.example/accounts",
    }),
  ];
  const captured = async (patch?: Partial<ChronicleSettings>) => {
    // A manager each: change detection would suppress the second reading of an
    // unchanged window, and it is the policy under test here, not the diff.
    const manager = policyManager(frames());
    if (patch) manager.update(patch);
    return (await manager.captureOnce()).map((entry) => entry.app);
  };

  assert.equal(policyManager([]).settings().capturePolicy, "all");
  assert.deepEqual(await captured(), ["Mail", "Safari"]);
  // A listed site matches its subdomains, so one entry covers the whole bank.
  assert.deepEqual(
    await captured({ capturePolicy: "except", sites: ["bank.example"] }),
    ["Mail"],
  );
  // "only" is the inverse reading of the same list, so switching modes keeps it.
  assert.deepEqual(
    await captured({ capturePolicy: "only", apps: ["com.apple.mail"] }),
    ["Mail"],
  );
});

test("private browsing is recorded until the switch says otherwise", async () => {
  const manager = policyManager([
    windowFrame({
      sourceId: "incognito",
      app: "Google Chrome",
      privateBrowsing: true,
    }),
  ]);
  assert.equal(manager.settings().recordPrivateBrowsing, true);
  assert.equal((await manager.captureOnce()).length, 1);
  manager.update({ recordPrivateBrowsing: false });
  assert.equal((await manager.captureOnce()).length, 0);
});

test("interaction events are searchable and obey the same policy", () => {
  // Chronicle is on by default, so no start() here: starting the manager would
  // schedule captures this test never wants and never stop.
  const manager = policyManager([]);
  manager.record({
    at: "2026-08-13T12:00:00.000Z",
    kind: "shortcut",
    app: "Xcode",
    chord: "cmd+s",
    title: "Widget.swift",
  });
  manager.record({
    at: "2026-08-13T12:00:01.000Z",
    kind: "type",
    app: "Safari",
    url: "https://bank.example/transfer",
    count: 12,
  });
  manager.flushEvents();
  assert.equal(manager.status().storedEvents, 2);
  assert.equal(manager.store.search("cmd+s")[0]?.text, "pressed cmd+s in Xcode — Widget.swift");
  // The timeline follows the events, not only the frames: a still screen would
  // otherwise leave it reading "no interactions retained" indefinitely.
  assert.match(readFileSync(manager.store.timelinePath, "utf8"), /pressed cmd\+s in Xcode/);

  // A blocked site's events are dropped at the door, like its frames.
  manager.update({ capturePolicy: "except", sites: ["bank.example"] });
  manager.record({
    at: "2026-08-13T12:00:02.000Z",
    kind: "click",
    app: "Safari",
    url: "https://bank.example/transfer",
  });
  manager.flushEvents();
  assert.equal(manager.status().storedEvents, 2);
});

test("forgetting a range takes both streams and nothing outside it", async () => {
  let now = new Date("2026-08-13T12:00:00.000Z");
  let next = windowFrame({ sourceId: "notes", app: "Notes" });
  const manager = new ChronicleManager({
    directory: mkdtempSync(path.join(tmpdir(), "flareai-chronicle-")),
    frames: { capture: async () => [next] },
    system: { current: () => active },
    clock: () => now,
  });
  await manager.captureOnce();
  manager.record({ at: now.toISOString(), kind: "click", app: "Notes" });
  now = new Date("2026-08-13T14:00:00.000Z");
  next = windowFrame({ sourceId: "notes", app: "Notes", image: Buffer.from("later") });
  await manager.captureOnce();
  manager.record({ at: now.toISOString(), kind: "click", app: "Notes" });
  manager.flushEvents();
  assert.equal(manager.status().storedFrames, 2);

  const status = manager.forget(
    new Date("2026-08-13T11:00:00.000Z"),
    new Date("2026-08-13T13:00:00.000Z"),
  );
  assert.equal(status.storedFrames, 1);
  assert.equal(status.storedEvents, 1);
  assert.equal(manager.store.entries()[0]?.capturedAt, "2026-08-13T14:00:00.000Z");
});

test("search finds window text and reports where to read it", async () => {
  const manager = policyManager([
    {
      ...windowFrame({ sourceId: "editor", app: "Zed" }),
      image: Buffer.from("# Zed\n\nfixing the retry policy in http.ts"),
    },
  ]);
  await manager.captureOnce();
  const hits = manager.store.search("retry policy");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.source, "frame");
  assert.match(hits[0]?.text ?? "", /retry policy in http\.ts/);
  assert.ok(hits[0]?.path);
  assert.equal(manager.store.search("retry policy", { app: "Xcode" }).length, 0);
});
