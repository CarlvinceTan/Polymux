import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth, stripTerminalSequences } from "@earendil-works/pi-tui";
import type { RunEventDto } from "@polymux/protocol";
import { Transcript, toolLabel } from "../src/tui/transcript.js";
import {
  RowView,
  SubagentGroup,
  align,
  middle,
  location,
  modelLabel,
  thinkingLabel,
  spinner,
} from "../src/tui/view.js";
import { ChatSession, type HostClient } from "../src/tui/session.js";

function event(
  sequence: number,
  type: string,
  payload: object = {},
): RunEventDto {
  return {
    runId: "run",
    conversationId: "chat",
    sequence,
    timestamp: sequence * 1000,
    type,
    payload: { turn: 1, ...payload } as RunEventDto["payload"],
  };
}

test("updated personal presentation keeps readable model, MCP results and narrow file paths", () => {
  assert.equal(modelLabel("gpt-5.6-sol"), "Gpt 5.6 Sol");
  assert.equal(thinkingLabel("xhigh"), "Xhigh");
  assert.equal(spinner(80, 120), spinner(0, 120));
  assert.notEqual(spinner(80), spinner(0));
  assert.equal(
    toolLabel("mcp__context7__resolveLibraryId", { query: "private query" }),
    "Context7: Resolve Library Id",
  );
  const transcript = new Transcript();
  transcript.begin("run");
  transcript.apply(
    event(1, "tool.started", {
      toolCall: {
        id: "m",
        name: "context7__query_docs",
        arguments: { query: "private input" },
      },
    }),
  );
  transcript.apply(
    event(2, "tool.completed", {
      toolCall: { id: "m" },
      result: { content: "No documentation found", isError: true },
    }),
  );
  const mcp = transcript.rows[0];
  const view = new RowView(mcp, () => {});
  const compact = view.render(80).map(stripTerminalSequences);
  assert.equal(compact.length, 1);
  assert.match(compact[0], /✗ Context7: Query Docs → No documentation found/);
  mcp.expanded = true;
  assert.ok(view.render(80).length > 1);
  transcript.apply(
    event(3, "tool.started", {
      toolCall: {
        id: "r",
        name: "read",
        arguments: { path: "/very/long/项目/path/to/source/file.ts" },
      },
    }),
  );
  const narrow = new RowView(transcript.rows[1], () => {})
    .render(24)
    .map(stripTerminalSequences);
  assert.equal(narrow.length, 2);
  assert.match(narrow[0], /Reading/);
  assert.match(narrow[1], /file.ts$/);
  const user = new RowView(
    { id: "u", kind: "user", text: "unshaded prompt" },
    () => {},
  ).render(80);
  assert.ok(user.every((line) => !line.includes("[48;")));
});

test("thinking and tools settle in place and duplicate or child events do not alter replay", () => {
  const transcript = new Transcript();
  transcript.begin("run");
  transcript.apply(
    event(1, "message.reasoning.delta", { delta: "First thought" }),
  );
  const thought = transcript.rows[0];
  assert.equal(thought.status, "running");
  transcript.apply(
    event(2, "tool.started", {
      toolCall: {
        id: "tool",
        name: "bash",
        arguments: { command: "npm test" },
      },
    }),
  );
  assert.equal(thought.status, "completed");
  transcript.apply(
    event(3, "tool.completed", {
      toolCall: { id: "tool" },
      result: { content: "failure", isError: true },
    }),
  );
  assert.equal(transcript.rows[1].status, "failed");
  transcript.apply(event(3, "tool.completed", { toolCall: { id: "tool" } }));
  transcript.apply({ ...event(4, "run.completed"), parentRunId: "parent" });
  assert.equal(transcript.status, "running");
  transcript.apply(
    event(4, "message.reasoning.delta", { delta: "Second thought" }),
  );
  transcript.draft({ turn: 1, text: "Partial", timestamp: 4500 });
  transcript.apply(
    event(5, "message.completed", {
      message: {
        content: [{ type: "text", text: "Final answer" }],
        usage: { inputTokens: 100, outputTokens: 20 },
      },
    }),
  );
  transcript.apply(event(6, "run.completed"));
  assert.equal(
    transcript.rows.filter((row) => row.kind === "thought").length,
    2,
  );
  assert.equal(
    transcript.rows.filter((row) => row.kind === "assistant").length,
    1,
  );
  assert.equal(transcript.rows.at(-1)?.text, "Final answer");
  transcript.draft({ turn: 1, text: "Stale snapshot", timestamp: 7000 });
  assert.equal(transcript.rows.at(-1)?.text, "Final answer");
  assert.equal(transcript.status, "completed");
});

test("cancelled runs settle pending tool rows and stop their animation", () => {
  const transcript = new Transcript();
  transcript.begin("run");
  transcript.apply(
    event(1, "tool.started", { toolCall: { id: "tool", name: "read" } }),
  );
  transcript.apply(event(2, "run.cancelled"));
  assert.equal(transcript.rows[0].status, "cancelled");
  assert.equal(transcript.rows[0].endedAt, 2000);
});

test("subagent dispatch stays active until the child reports its real terminal result", async () => {
  const session = new ChatSession(
    {
      async call<T>(method: string, args: any[] = []): Promise<T> {
        assert.equal(method, "runs.updates");
        return {
          events:
            args[0] === "child"
              ? [
                  {
                    ...event(1, "message.completed", {
                      message: { content: "Checked the implementation" },
                    }),
                    runId: "child",
                    parentRunId: "run",
                  },
                  {
                    ...event(2, "run.completed"),
                    runId: "child",
                    parentRunId: "run",
                  },
                ]
              : [],
          draft: null,
        } as T;
      },
    },
    () => {},
  );
  const transcript = session.transcript;
  transcript.begin("run");
  transcript.apply(
    event(1, "tool.started", {
      toolCall: {
        id: "dispatch",
        name: "subagent",
        arguments: { description: "Review terminal behavior" },
      },
    }),
  );
  transcript.apply(
    event(2, "tool.progress", {
      toolCallId: "dispatch",
      message: "",
      data: { childRunId: "child" },
    }),
  );
  transcript.apply(
    event(3, "tool.completed", {
      toolCall: { id: "dispatch" },
      result: {
        content: "Dispatched",
        metadata: { subagent: "subagent_1", status: "running" },
      },
    }),
  );
  const row = transcript.rows[0];
  assert.equal(row.status, "running");
  assert.equal(row.endedAt, undefined);
  transcript.apply(event(4, "run.completed"));
  assert.equal(
    row.status,
    "running",
    "parent completion does not certify child completion",
  );
  await session.poll();
  assert.equal(row.status, "completed");
  assert.equal(row.endedAt, 2000);
  assert.equal(row.detail, "Checked the implementation");
  assert.equal(row.childSettled, true);
  const line = new RowView(row, () => {})
    .render(80)
    .map(stripTerminalSequences)[0];
  assert.match(line, /✓ Subagent 1: Review terminal behavior/);
  transcript.apply(
    event(5, "tool.completed", {
      toolCall: { id: "dispatch" },
      result: {
        content: "Dispatched",
        metadata: { subagent: "subagent_1", status: "running" },
      },
    }),
  );
  assert.equal(
    row.status,
    "completed",
    "a late dispatch receipt cannot restart the finished worker",
  );
  assert.equal(row.detail, "Checked the implementation");
  const group = new SubagentGroup([], () => 1);
  group.addTask(new RowView(row, () => {}));
  group.addTask(
    new RowView(
      { ...row, id: "failed", status: "failed", detail: "Worker failed" },
      () => {},
    ),
  );
  assert.match(
    stripTerminalSequences(group.render(80)[0]),
    /✗ Subagents \(2 tasks\):/,
  );
  for (const rendered of group.render(8))
    assert.ok(visibleWidth(rendered) <= 8);
});

test("rows and footer respect narrow widths, Unicode and terminal escape safety", () => {
  for (const width of [1, 2, 8, 20, 40, 80, 120]) {
    assert.ok(
      visibleWidth(
        align("~/very/long/项目/path (main)", "model • xhigh", width),
      ) <= width,
    );
    assert.ok(visibleWidth(middle("~/very/long/项目/path", width)) <= width);
    for (const kind of ["user", "assistant", "thought", "tool"] as const) {
      const row = new RowView(
        {
          id: kind,
          kind,
          text: "项目\x1b]52;c;c2VjcmV0\x07 with a long line of words to wrap",
          status: "running",
          startedAt: 0,
        },
        () => {},
        () => 2000,
      );
      for (const line of row.render(width)) {
        assert.ok(
          visibleWidth(line) <= width,
          `${kind} width ${width}: ${visibleWidth(line)}`,
        );
        assert.ok(!line.includes("52;c;"));
      }
    }
  }
  assert.equal(location("/Users/a/project", "/Users/a"), "~/project");
  assert.equal(location("/Users/a", "/Users/a"), "/Users/a/");
  assert.equal(location("/", "/"), "/");
  assert.equal(
    location("/Users/another/project", "/Users/a"),
    "/Users/another/project",
  );
  assert.match(
    stripTerminalSequences(
      new RowView(
        {
          id: "x",
          kind: "thought",
          text: "reasoning",
          status: "running",
          startedAt: 0,
        },
        () => {},
        () => 2000,
      ).render(80)[0],
    ),
    /Thinking for 2s/,
  );
});

test("session queues once, replays completion and retains follow-ups when the next start fails", async () => {
  const calls: string[] = [];
  let starts = 0;
  const client: HostClient = {
    async call<T>(method: string): Promise<T> {
      calls.push(method);
      if (method === "runs.start") {
        if (++starts > 1) throw new Error("offline");
        return { runId: "run" } as T;
      }
      if (method === "runs.configuration")
        return {
          model: "test/model",
          reasoning: "medium",
          contextWindow: 1000,
          skills: [],
          mcps: [],
        } as T;
      if (method === "runs.updates")
        return { events: [event(1, "run.completed")], draft: null } as T;
      return [] as T;
    },
  };
  const session = new ChatSession(client, () => {});
  await session.open({ id: "chat", title: "Test" });
  await session.submit("First");
  await session.submit("Second");
  assert.equal(starts, 1);
  assert.deepEqual(session.queue, ["Second"]);
  await assert.rejects(session.poll(), /offline/);
  assert.deepEqual(session.queue, ["Second"]);
  assert.equal(starts, 2);
  await session.poll();
  assert.equal(starts, 2, "failed request is not automatically replayed");
  assert.equal(calls.filter((method) => method === "runs.start").length, 2);
});

test("resuming restores durable thinking/tools once and attaches to the active run", async () => {
  const client: HostClient = {
    async call<T>(method: string): Promise<T> {
      const data: Record<string, unknown> = {
        "conversations.messages": [
          { id: "u", role: "user", content: "hello", runId: "run" },
          {
            id: "a",
            role: "assistant",
            content: [{ type: "text", text: "reply" }],
            runId: "run",
          },
          { id: "b", role: "assistant", content: "later", runId: "run" },
        ],
        "runs.events": [
          event(1, "message.reasoning.delta", { delta: "Thinking" }),
          event(2, "message.completed", {
            message: { content: [{ type: "text", text: "reply" }] },
          }),
        ],
        "runs.active": [{ runId: "run", conversationId: "chat" }],
        "runs.configuration": {
          model: "test/model",
          reasoning: "high",
          contextWindow: 1000,
          skills: [],
          mcps: [],
        },
      };
      return data[method] as T;
    },
  };
  const session = new ChatSession(client, () => {});
  await session.open({ id: "chat", title: "Test" });
  assert.equal(
    session.transcript.rows.filter((row) => row.kind === "assistant").length,
    1,
  );
  assert.equal(
    session.transcript.rows.filter((row) => row.kind === "thought").length,
    1,
  );
  assert.equal(session.transcript.sequence, 2);
  assert.equal(session.transcript.status, "running");
});

test("Working is transient across request latency, streaming, tool turns, and termination", () => {
  const transcript = new Transcript();
  transcript.begin("run");
  assert.equal(transcript.working, true);
  transcript.apply(
    event(1, "model.started", { model: { provider: "test", id: "model" } }),
  );
  transcript.apply(event(2, "message.reasoning.delta", { delta: "Thinking" }));
  assert.equal(transcript.working, false);
  transcript.apply(event(3, "model.started"));
  assert.equal(transcript.working, true);
  transcript.draft({ turn: 2, text: "Answer", timestamp: 4000 });
  assert.equal(transcript.working, false);
  transcript.apply(event(5, "model.started"));
  transcript.apply(
    event(6, "tool.started", { toolCall: { id: "tool", name: "read" } }),
  );
  assert.equal(transcript.working, false);
  transcript.apply(event(7, "model.started"));
  transcript.apply(event(8, "run.cancelled"));
  assert.equal(transcript.working, false);
  assert.ok(transcript.rows.every((row) => row.text !== "Working"));
});

test("manual shell cards remain bounded and copyable", () => {
  const row = {
    id: "shell",
    kind: "tool" as const,
    manualShell: true,
    text: "! pwd",
    detail: "  /tmp/project",
    status: "completed" as const,
  };
  for (const width of [1, 2, 8, 80]) {
    const lines = new RowView(row, () => {}).render(width);
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
  }
  const rendered = new RowView(row, () => {})
    .render(80)
    .map(stripTerminalSequences)
    .join("\n");
  assert.match(rendered, /╭─/);
  assert.match(rendered, /✓ ! pwd/);
  assert.match(rendered, /  \/tmp\/project/);
});

test("long shell output keeps its command heading in the collapsed card", () => {
  const lines = new RowView(
    {
      id: "shell",
      kind: "tool",
      manualShell: true,
      text: "! command",
      detail: Array.from({ length: 50 }, (_, i) => `output ${i}`).join("\n"),
      status: "completed",
    },
    () => {},
  )
    .render(80)
    .map(stripTerminalSequences);
  assert.match(lines[1], /✓ ! command/);
  assert.ok(lines.some((line) => line.includes("output 49")));
  assert.ok(lines.length <= 23);
});

test("polled draft growth estimates speed without counting repeated snapshots", () => {
  const transcript = new Transcript();
  transcript.begin("run");
  transcript.apply(
    event(1, "model.started", { model: { provider: "test", id: "model" } }),
  );
  for (let i = 0; i < 10; i++)
    transcript.draft({
      turn: 1,
      text: "x".repeat((i + 1) * 38),
      timestamp: 10000 + i * 100,
    });
  assert.equal(Math.round(transcript.rate!), 100);
  const before = transcript.rate;
  transcript.draft({ turn: 1, text: "x".repeat(380), timestamp: 10900 });
  assert.equal(transcript.rate, before);
});

test('bot setup cues stay hidden while user messages and bot replies remain visible', async () => {
  const messages = [
    {id: 'setup', role: 'user', content: 'Internal setup', metadata: {setupCue: true}, createdAt: '2026-09-16T00:00:00Z'},
    {id: 'user', role: 'user', content: 'My instructions', metadata: null, createdAt: '2026-09-16T00:00:01Z'},
    {id: 'reply', role: 'assistant', content: 'Ready', metadata: null, createdAt: '2026-09-16T00:00:02Z'},
  ];
  const session = new ChatSession({async call<T>(method: string) {
    return (method === 'conversations.messages' ? messages : method === 'runs.configuration'
      ? {model: null, reasoning: 'medium', contextWindow: 0, skills: [], mcps: []} : []) as T;
  }}, () => {});
  await session.open({id: 'chat', title: 'Bot'});
  assert.deepEqual(session.transcript.rows.map(row => row.text), ['My instructions', 'Ready']);
});
