import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { groupTranscript, TranscriptRunView } from "../src/tui/run-view.js";
import { ChatSession, type HostClient } from "../src/tui/session.js";
import type { TranscriptRow } from "../src/tui/transcript.js";
const rows: TranscriptRow[] = [
  { id: "u", kind: "user", text: "Question", startedAt: 1000 },
  {
    id: "t",
    kind: "thought",
    text: "Private reasoning",
    startedAt: 1000,
    endedAt: 2000,
    status: "completed",
  },
  {
    id: "r",
    kind: "tool",
    toolName: "read",
    text: "Read a.ts",
    detail: "file contents",
    status: "completed",
    endedAt: 3000,
  },
  {
    id: "a",
    kind: "assistant",
    text: "Intermediate prose",
    status: "completed",
  },
  {
    id: "r2",
    kind: "tool",
    toolName: "bash",
    text: "Run tests",
    detail: "All passed",
    status: "completed",
    endedAt: 5000,
  },
  { id: "f", kind: "assistant", text: "Final answer", status: "completed" },
];
const text = (view: TranscriptRunView, width = 80) =>
  view.render(width).map(stripTerminalSequences).join("\n");
test("completed work folds intermediate prose and tool chains, preserving final answer and every detail", () => {
  const view = new TranscriptRunView(
    () => {},
    () => 1,
    () => false,
    () => false,
  );
  view.rows = structuredClone(rows);
  assert.match(text(view), /Worked for 4s/);
  assert.match(text(view), /Final answer/);
  assert.doesNotMatch(text(view), /Intermediate prose|file contents/);
  view.expanded = true;
  assert.match(text(view), /Intermediate prose/);
  assert.match(text(view), /Read 1 file/);
  const lines = view.render(80).map(stripTerminalSequences);
  view.handleMouse({
    type: "click",
    button: "left",
    y: lines.findIndex((line) => line.includes("Read 1 file")),
    x: 1,
    width: 80,
    height: 20,
  } as any);
  assert.match(text(view), /Read a.ts/);
  for (const width of [1, 10, 40, 80])
    for (const line of view.render(width))
      assert.ok(visibleWidth(line) <= width);
});
test("steering does not retire the in-flight run and parallel active tools remain visible", () => {
  const data = structuredClone(rows.slice(0, 3));
  data.push({ id: "steer:1", kind: "user", text: "Correction" });
  assert.equal(groupTranscript(data).length, 1);
  const view = new TranscriptRunView(
    () => {},
    () => 1,
    () => false,
    () => false,
  );
  view.active = true;
  view.rows = [
    { id: "one", kind: "tool", text: "Run first", status: "running" },
    { id: "two", kind: "tool", text: "Run second", status: "running" },
  ];
  assert.match(text(view), /Running first/);
  assert.match(text(view), /Running second/);
});
test("cancel holds follow-ups even if completion wins the race, explicit steering dequeues just one", async () => {
  const calls: string[] = [];
  const client = {
    async call(method: string) {
      calls.push(method);
      if (method === "runs.updates")
        return {
          events: [
            {
              runId: "run",
              sequence: 1,
              type: "run.completed",
              timestamp: 5000,
              payload: {},
            },
          ],
          draft: null as null,
        };
      if (method === "runs.start") return { runId: "next" };
      return null;
    },
  } as HostClient;
  const session = new ChatSession(client, () => {});
  session.conversation = { id: "chat", title: "Test" };
  session.transcript.begin("run");
  session.queue = ["one", "two"];
  await session.cancel();
  await session.poll();
  assert.deepEqual(session.queue, ["one", "two"]);
  assert.ok(!calls.includes("runs.start"));
  await session.steer();
  assert.deepEqual(session.queue, ["two"]);
  assert.equal(session.transcript.runId, "next");
});
test("failed steering keeps queued input and never inserts a sent prompt", async () => {
  const session = new ChatSession(
    {
      call: async () => {
        throw Error("offline");
      },
    },
    () => {},
  );
  session.transcript.begin("run");
  session.queue = ["one"];
  await assert.rejects(session.steer(), /offline/);
  assert.deepEqual(session.queue, ["one"]);
  assert.equal(session.transcript.rows.length, 0);
});
