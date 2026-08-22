import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import {
  ComputerHistoryRecorder,
  RECORDING_LIMIT_MS,
  digestRecording,
  readRecording,
  type RecordingLine,
} from "../src/recording.js";
import type { InteractionEvent } from "../src/types.js";

const roots: string[] = [];

function recorder(options: { now?: () => Date } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "flareai-recording-"));
  roots.push(root);
  let ticks: Array<{ callback: () => void; delayMs: number }> = [];
  const instance = new ComputerHistoryRecorder({
    directory: root,
    ...(options.now ? { clock: options.now } : {}),
    schedule: (callback, delayMs) => {
      ticks.push({ callback, delayMs });
      return ticks.length as unknown as ReturnType<typeof setTimeout>;
    },
    cancelSchedule: () => {
      ticks = [];
    },
  });
  return { instance, root, fire: () => ticks.forEach((tick) => tick.callback()), ticks: () => ticks };
}

function lines(file: string): RecordingLine[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RecordingLine);
}

const click = { at: "2026-08-18T10:00:00.000Z", kind: "click", app: "Notes" } as const;

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("ComputerHistoryRecorder", () => {
  let harness: ReturnType<typeof recorder>;
  beforeEach(() => {
    harness = recorder();
  });

  it("writes events and windows into one interleaved stream", () => {
    const session = harness.instance.start({ label: "File expense" });
    harness.instance.record(click);
    harness.instance.window({ app: "Notes", title: "Expenses", text: "Total" });
    harness.instance.record({ ...click, kind: "scroll", count: 3 });

    const written = lines(session.eventsPath);
    assert.deepEqual(
      written.map((line) => line.type),
      ["event", "window", "event"],
    );
    assert.equal(harness.instance.active()?.events, 2);
    assert.equal(harness.instance.active()?.windows, 1);
  });

  it("keeps no typed characters — a type event carries only its count", () => {
    const session = harness.instance.start();
    harness.instance.record({ ...click, kind: "type", count: 11 });
    const written = lines(session.eventsPath)[0] as unknown as Record<string, unknown>;
    assert.equal(written.count, 11);
    assert.ok(!("text" in written) && !("chars" in written));
  });

  it("refuses a second recording rather than interleaving two workflows", () => {
    harness.instance.start();
    assert.throws(() => harness.instance.start(), /already running/i);
  });

  it("drops events once stopped", () => {
    const session = harness.instance.start();
    harness.instance.record(click);
    harness.instance.stop();
    harness.instance.record(click);
    assert.equal(lines(session.eventsPath).length, 1);
    assert.equal(harness.instance.active(), null);
  });

  it("finalises session.json with an end reason", () => {
    const started = harness.instance.start({ label: "Book parking" });
    const stopped = harness.instance.stop();
    assert.equal(stopped?.endReason, "stopped");
    const saved = JSON.parse(readFileSync(started.metadataPath, "utf8")) as Record<string, unknown>;
    assert.equal(saved.endReason, "stopped");
    assert.equal(saved.label, "Book parking");
    assert.ok(saved.endedAt);
  });

  it("discards the capture when cancelled", () => {
    const session = harness.instance.start();
    harness.instance.record(click);
    const cancelled = harness.instance.stop("cancelled");
    assert.equal(cancelled?.endReason, "cancelled");
    assert.equal(existsSync(session.directory), false);
    assert.deepEqual(harness.instance.list(), []);
  });

  it("ends itself at the limit", () => {
    harness.instance.start();
    assert.equal(harness.ticks()[0]?.delayMs, RECORDING_LIMIT_MS);
    harness.fire();
    assert.equal(harness.instance.active(), null);
    assert.equal(harness.instance.list()[0]?.endReason, "limit_reached");
  });

  it("caps a caller's limit at thirty minutes and floors it at one", () => {
    const long = harness.instance.start({ limitMs: 5 * 60 * 60 * 1000 });
    assert.equal(long.limitMs, RECORDING_LIMIT_MS);
    harness.instance.stop();
    const short = harness.instance.start({ limitMs: 5 });
    assert.equal(short.limitMs, 60_000);
  });

  it("does not write the same window twice in a row", () => {
    const session = harness.instance.start();
    harness.instance.window({ app: "Notes", title: "Expenses", text: "Total" });
    harness.instance.window({ app: "Notes", title: "Expenses", text: "Total" });
    harness.instance.window({ app: "Notes", title: "Expenses", text: "Total 42" });
    assert.equal(lines(session.eventsPath).length, 2);
  });

  it("lists finished recordings newest first", () => {
    let now = Date.parse("2026-08-18T09:00:00.000Z");
    const dated = recorder({ now: () => new Date(now) });
    dated.instance.start({ label: "first" });
    dated.instance.stop();
    now += 60_000;
    dated.instance.start({ label: "second" });
    dated.instance.stop();
    assert.deepEqual(
      dated.instance.list().map((session) => session.label),
      ["second", "first"],
    );
  });
});

describe("digestRecording", () => {
  function build(lines: RecordingLine[]) {
    const harness = recorder();
    const session = harness.instance.start({ label: "Book parking" });
    for (const line of lines)
      if (line.type === "window") {
        const { type, at, ...window } = line;
        harness.instance.window(window);
      } else {
        const { type, ...event } = line;
        harness.instance.record(event);
      }
    const stopped = harness.instance.stop();
    assert.ok(stopped);
    return digestRecording(stopped, readRecording(stopped.eventsPath));
  }

  const event = (kind: InteractionEvent["kind"], app: string, extra: Partial<InteractionEvent> = {}) =>
    ({ type: "event", at: "2026-08-18T10:00:00.000Z", kind, app, ...extra }) as RecordingLine;

  it("trims arriving and leaving, keeping the core of the workflow", () => {
    const digest = build([
      event("app", "Finder"),
      event("scroll", "Finder", { count: 2 }),
      event("click", "Safari", { target: "Book a bay" }),
      event("type", "Safari", { count: 6 }),
      event("app", "Finder"),
      event("scroll", "Finder", { count: 9 }),
    ]);
    assert.equal(digest.trimmedLead, 2);
    assert.equal(digest.trimmedTail, 2);
    assert.deepEqual(
      digest.steps.map((step) => `${step.kind}:${step.app}`),
      ["click:Safari", "type:Safari"],
    );
  });

  it("separates the apps worked in from the ones passed through", () => {
    const digest = build([
      event("click", "Safari", { target: "Book" }),
      event("app", "Finder"),
      event("scroll", "Finder", { count: 3 }),
      event("click", "Safari", { target: "Confirm" }),
    ]);
    assert.deepEqual(digest.apps.map((entry) => entry.app), ["Safari"]);
    assert.equal(digest.apps[0]?.actions, 2);
    assert.deepEqual(digest.passedThrough, ["Finder"]);
  });

  it("carries the window an action landed in onto the step", () => {
    const harness = recorder();
    const session = harness.instance.start();
    harness.instance.window({ app: "Safari", title: "Parking", url: "https://parking.example" });
    harness.instance.record({ at: "2026-08-18T10:00:01.000Z", kind: "click", app: "Safari", target: "Book" });
    const stopped = harness.instance.stop();
    assert.ok(stopped);
    const digest = digestRecording(stopped, readRecording(stopped.eventsPath));
    assert.equal(digest.steps[0]?.url, "https://parking.example");
    assert.equal(digest.steps[0]?.title, "Parking");
  });

  it("reports an empty workflow rather than inventing one from switches", () => {
    const digest = build([event("app", "Finder"), event("scroll", "Finder", { count: 4 })]);
    assert.deepEqual(digest.steps, []);
    assert.deepEqual(digest.apps, []);
    assert.equal(digest.trimmedLead, 2);
  });
});
