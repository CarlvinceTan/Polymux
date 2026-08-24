import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { RecordingEndReason, RecordingSession } from "@polymux/computer";
import { ComputerHistoryRecorder, elapsedLabel } from "@polymux/computer";
import type { RecordingCapture } from "./capture.js";
import { createRecordingTool } from "./tools.js";

/**
 * The tool against a real recorder but no tap and no tray — everything the
 * tool actually reasons about is on disk.
 */
function harness() {
  const root = mkdtempSync(path.join(tmpdir(), "polymux-record-tool-"));
  // The real 30-minute limit timer would hold the test process open long
  // after the assertions finish, so the schedule is a stub here.
  const recorder = new ComputerHistoryRecorder({
    directory: root,
    schedule: () => 0 as unknown as ReturnType<typeof setTimeout>,
    cancelSchedule: () => {},
  });
  const capture = {
    recorder,
    active: () => recorder.active(),
    list: () => recorder.list(),
    lastEnded: () => recorder.lastEnded(),
    read: (id: string) => recorder.read(id),
    start: async (options: { label?: string | null } = {}) => recorder.start(options),
    stop: (reason: RecordingEndReason = "stopped") => recorder.stop(reason),
  } as unknown as RecordingCapture;
  const tool = createRecordingTool(capture);
  const call = async (input: Record<string, string | number>) =>
    JSON.parse((await tool.execute(input, {} as never)).content as string);
  return { recorder, call, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function demonstrate(recorder: ComputerHistoryRecorder): RecordingSession {
  const session = recorder.start({ label: "Book parking" });
  recorder.window({ app: "Safari", title: "Parking", url: "https://parking.example" });
  recorder.record({ at: "2026-08-18T10:00:01.000Z", kind: "click", app: "Safari", target: "Book" });
  return session;
}

test("stop summarises the workflow rather than handing back the stream", async () => {
  const { recorder, call, cleanup } = harness();
  try {
    demonstrate(recorder);
    const result = await call({ action: "stop" });
    assert.equal(result.stopped, true);
    assert.deepEqual(result.digest.apps.map((entry: { app: string }) => entry.app), ["Safari"]);
    assert.equal(result.digest.steps.length, 1);
    assert.match(result.note, /ask whether to build/i);
  } finally {
    cleanup();
  }
});

test("a recording with no actions is reported, not turned into a workflow", async () => {
  const { recorder, call, cleanup } = harness();
  try {
    recorder.start();
    recorder.record({ at: "2026-08-18T10:00:00.000Z", kind: "app", app: "Finder" });
    const result = await call({ action: "stop" });
    assert.deepEqual(result.digest.steps, []);
    assert.match(result.note, /do not invent/i);
  } finally {
    cleanup();
  }
});

test("saying done after stopping from the menu bar still returns that recording", async () => {
  const { recorder, call, cleanup } = harness();
  try {
    demonstrate(recorder);
    // The user pressed Stop Recording in the menu bar, then walked back.
    recorder.stop("controls_stopped");
    const result = await call({ action: "stop" });
    assert.equal(result.endReason, "controls_stopped");
    assert.equal(result.digest.steps.length, 1);
  } finally {
    cleanup();
  }
});

test("saying done after cancelling from the menu bar builds nothing", async () => {
  const { recorder, call, cleanup } = harness();
  try {
    demonstrate(recorder);
    recorder.stop("controls_cancelled");
    const result = await call({ action: "stop" });
    assert.match(result.note, /do not build a skill/i);
    assert.equal(result.digest, undefined);
  } finally {
    cleanup();
  }
});

test("with nothing running and nothing recent, stop refuses", async () => {
  const { call, cleanup } = harness();
  try {
    const result = await call({ action: "stop" });
    assert.match(result.error, /no recording is running/i);
  } finally {
    cleanup();
  }
});

test("a second start is refused rather than replacing the first", async () => {
  const { recorder, call, cleanup } = harness();
  try {
    recorder.start({ label: "first" });
    const result = await call({ action: "start" });
    assert.match(result.error, /already running/i);
  } finally {
    cleanup();
  }
});

test("the menu bar reads elapsed time, zero-padded", () => {
  const started = "2026-08-18T10:00:00.000Z";
  assert.equal(elapsedLabel(started, Date.parse(started)), "0:00");
  assert.equal(elapsedLabel(started, Date.parse(started) + 9_000), "0:09");
  assert.equal(elapsedLabel(started, Date.parse(started) + 605_000), "10:05");
  // A clock that moved backwards must not render a negative time.
  assert.equal(elapsedLabel(started, Date.parse(started) - 5_000), "0:00");
});
