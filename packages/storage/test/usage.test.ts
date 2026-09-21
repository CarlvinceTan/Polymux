import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_USAGE_AGENT_ID,
  classifyUsageLists,
  encodeMcpToken,
  summarizeUsage,
  type UsageSource,
} from "../src/usage.js";

function day(offset: number, origin = new Date("2026-09-07T12:00:00")): string {
  const date = new Date(origin);
  date.setDate(date.getDate() + offset);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

function usage(totalTokens: number, costUsd = 0, reasoningTokens = 0) {
  return {inputTokens: totalTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens, totalTokens, costUsd};
}

function source(partial: Omit<Partial<UsageSource>, "runs" | "toolCounts" | "skillTurns"> & {
  runs: Array<Omit<UsageSource["runs"][number], "id"> & {id?: string}>;
  toolCounts?: Array<Omit<UsageSource["toolCounts"][number], "runId"> & {runId?: string}>;
  skillTurns?: Array<Omit<UsageSource["skillTurns"][number], "runId"> & {runId?: string}>;
}): UsageSource {
  const runs = partial.runs.map((run, index) => ({...run, id: run.id ?? `run-${index}`}));
  const conversationIds = [...new Set(runs.map(run => run.conversationId))];
  const runId = (conversationId: string) => runs.find(run => run.conversationId === conversationId)?.id ?? "";
  return {
    conversations: partial.conversations ?? conversationIds.map(id => ({id, metadata: {}})),
    toolCounts: (partial.toolCounts ?? []).map(row => ({...row, runId: row.runId ?? runId(row.conversationId)})),
    skillTurns: (partial.skillTurns ?? []).map(row => ({...row, runId: row.runId ?? runId(row.conversationId)})),
    runs,
  };
}

test("sums tokens, spend, streaks and the longest chat from stored runs", () => {
  const summary = summarizeUsage(
    source({
      conversations: [
        {id: "a", metadata: {}},
        {id: "b", metadata: {}},
        {id: "c", metadata: {}},
        {id: "d", metadata: {}},
      ],
      toolCounts: [{conversationId: "a", name: "Read", count: 12}, {conversationId: "b", name: "Shell", count: 5}],
      skillTurns: [
        {conversationId: "a", names: ["review"]},
        {conversationId: "a", names: ["review", "commit"]},
        {conversationId: "b", names: ["search"]},
      ],
      runs: [
        {
          conversationId: "a",
          model: "anthropic/claude",
          startedAt: day(-2),
          finishedAt: day(-2 + 0),
          createdAt: day(-2),
          usage: usage(1000, 1.5, 20),
          parentRunId: null,
        },
        {
          conversationId: "a",
          model: "anthropic/claude",
          startedAt: day(-1),
          finishedAt: new Date(Date.parse(day(-1)) + 90 * 60 * 1000).toISOString(),
          createdAt: day(-1),
          usage: usage(4000, 2.5, 0),
          parentRunId: null,
        },
        {
          conversationId: "b",
          model: "openai/gpt",
          startedAt: day(0),
          finishedAt: day(0),
          createdAt: day(0),
          usage: usage(500, 0.2, 0),
          parentRunId: null,
        },
        {
          conversationId: "b",
          model: "openai/gpt",
          startedAt: day(0),
          finishedAt: day(0),
          createdAt: day(0),
          usage: usage(100, 0.05, 0),
          parentRunId: "parent",
        },
      ],
    }),
    new Date("2026-09-07T18:00:00"),
  );
  assert.equal(summary.lifetimeTokens, 5600);
  assert.equal(summary.totalChats, 4);
  assert.equal(summary.costUsd, 4.25);
  assert.equal(summary.currentStreakDays, 3);
  assert.equal(summary.longestStreakDays, 3);
  assert.equal(summary.fastModePercent, 67);
  assert.equal(summary.reasoningPercent, 33);
  assert.equal(summary.skillsExplored, 3);
  assert.equal(summary.skillsUsed, 4);
  assert.deepEqual(summary.plugins, []);
  assert.deepEqual(summary.connections, []);
  assert.ok(summary.longestChatMs >= 90 * 60 * 1000);
  const today = summary.days.find((entry) => entry.date === "2026-09-07");
  assert.equal(today?.tokens, 600);
  assert.equal(summary.peakTokens, 4000);
  assert.equal(summary.models[0]?.model, "anthropic/claude");
  assert.equal(summary.agentId, null);
  assert.equal(summary.agents.length, 1);
  assert.equal(summary.agents[0]?.id, DEFAULT_USAGE_AGENT_ID);
  assert.equal(summary.agents[0]?.runs, 4);
  assert.equal(summary.spendIncomplete, false);
});

test("an empty store is zeros rather than invented activity", () => {
  const summary = summarizeUsage(
    {runs: [], conversations: [], toolCounts: [], skillTurns: []},
    new Date("2026-09-07T12:00:00"),
  );
  assert.equal(summary.lifetimeTokens, 0);
  assert.equal(summary.costUsd, 0);
  assert.equal(summary.currentStreakDays, 0);
  assert.equal(summary.fastModePercent, null);
  assert.equal(summary.agents.length, 0);
  assert.ok(summary.days.length >= 52 * 7);
});

test("parent and child runs each count once, including cancelled rows with usage", () => {
  const summary = summarizeUsage(
    source({
      runs: [
        {
          conversationId: "a",
          model: "anthropic/claude",
          startedAt: day(0),
          finishedAt: day(0),
          createdAt: day(0),
          usage: usage(200, 1, 0),
          parentRunId: null,
        },
        {
          conversationId: "a",
          model: "anthropic/claude",
          startedAt: day(0),
          finishedAt: day(0),
          createdAt: day(0),
          usage: usage(50, 0.2, 0),
          parentRunId: "parent",
        },
      ],
    }),
    new Date("2026-09-07T18:00:00"),
  );
  assert.equal(summary.lifetimeTokens, 250);
  assert.equal(summary.costUsd, 1.2);
  assert.equal(summary.fastModePercent, 100);
});

test("peak tokens is the busiest day in the whole store, not only the heatmap window", () => {
  const summary = summarizeUsage(
    source({
      runs: [
        {
          conversationId: "a",
          model: "anthropic/claude",
          startedAt: "2024-01-15T09:00:00.000Z",
          finishedAt: "2024-01-15T10:00:00.000Z",
          createdAt: "2024-01-15T09:00:00.000Z",
          usage: usage(90_000, 9, 0),
          parentRunId: null,
        },
        {
          conversationId: "a",
          model: "anthropic/claude",
          startedAt: day(0),
          finishedAt: day(0),
          createdAt: day(0),
          usage: usage(10, 0.01, 0),
          parentRunId: null,
        },
      ],
    }),
    new Date("2026-09-07T18:00:00"),
  );
  assert.equal(summary.lifetimeTokens, 90_010);
  assert.equal(summary.peakTokens, 90_000);
  const heatmapPeak = Math.max(...summary.days.map((entry) => entry.tokens));
  assert.equal(heatmapPeak, 10);
});

test("Team scope filters totals independently of member names", () => {
  const input = source({
    conversations: [
      {id: "user", metadata: {}},
      {id: "bot-chat", metadata: {bot: {id: "reviewer", name: "Reviewer"}}},
    ],
    toolCounts: [
      {conversationId: "user", name: "Read", count: 4},
      {conversationId: "bot-chat", name: "Shell", count: 9},
    ],
    skillTurns: [{conversationId: "bot-chat", names: ["review"]}],
    runs: [
      {
        conversationId: "user",
        model: "anthropic/claude",
        startedAt: day(0),
        finishedAt: day(0),
        createdAt: day(0),
        usage: usage(100, 1, 0),
        parentRunId: null,
      },
      {
        conversationId: "bot-chat",
        model: "anthropic/claude",
        startedAt: day(0),
        finishedAt: day(0),
        createdAt: day(0),
        usage: usage(400, 4, 10),
        parentRunId: null,
      },
    ],
  });
  const global = summarizeUsage(input, new Date("2026-09-07T18:00:00"));
  assert.equal(global.lifetimeTokens, 500);
  assert.equal(global.agents.length, 1);
  assert.deepEqual(
    global.agents.map((agent) => agent.id).sort(),
    ["polymux"],
  );

  const scoped = summarizeUsage(input, new Date("2026-09-07T18:00:00"), {scope: "team"});
  assert.equal(scoped.agentId, null);
  assert.equal(scoped.scope, "team");
  assert.equal(scoped.lifetimeTokens, 400);
  assert.equal(scoped.costUsd, 4);
  assert.equal(scoped.totalChats, 1);
  assert.deepEqual(scoped.plugins, []);
  assert.equal(scoped.skillsExplored, 1);
  assert.equal(scoped.agents.length, 1);
});

test("tokens without stored cost still count and mark spend incomplete", () => {
  const summary = summarizeUsage(
    source({
      runs: [
        {
          conversationId: "a",
          model: "anthropic/claude",
          startedAt: day(0),
          finishedAt: day(0),
          createdAt: day(0),
          usage: {totalTokens: 80, reasoningTokens: 0},
          parentRunId: null,
        },
      ],
    }),
    new Date("2026-09-07T18:00:00"),
  );
  assert.equal(summary.lifetimeTokens, 80);
  assert.equal(summary.costUsd, 0);
  assert.equal(summary.spendIncomplete, true);
});

test("plugin and connection lists ignore built-in tools and official skills", () => {
  const pluginId = "market/gui";
  const pluginPrefix = encodeMcpToken(`plugin:${pluginId}:gui`);
  const githubPrefix = encodeMcpToken("github");
  const classified = classifyUsageLists(
    [
      {name: "browser", count: 40},
      {name: "subagent", count: 12},
      {name: `${pluginPrefix}__screenshot`, count: 9},
      {name: `${githubPrefix}__list_issues`, count: 5},
    ],
    [
      {name: "review", count: 3},
      {name: "commit", count: 8},
    ],
    {
      plugins: [
        {
          id: pluginId,
          name: "background-gui",
          skills: ["review"],
          mcpServerIds: ["gui"],
        },
      ],
      connections: [{id: "github", name: "GitHub"}],
    },
  );
  assert.deepEqual(classified.plugins, [{name: "background-gui", count: 12}]);
  assert.deepEqual(classified.connections, [{name: "GitHub", count: 5}]);

  const summary = summarizeUsage(
    source({
      conversations: [{id: "a", metadata: {bot: {id: "reviewer", name: "Reviewer", avatar: {shape: "pebble", color: "#4455aa"}}}}],
      toolCounts: [
        {conversationId: "a", name: "browser", count: 7},
        {conversationId: "a", name: `${pluginPrefix}__click`, count: 2},
        {conversationId: "a", name: `${githubPrefix}__search`, count: 4},
      ],
      skillTurns: [{conversationId: "a", names: ["review", "commit"]}],
      runs: [
        {
          conversationId: "a",
          model: "anthropic/claude",
          startedAt: day(0),
          finishedAt: day(0),
          createdAt: day(0),
          usage: usage(10, 0.01, 0),
          parentRunId: null,
        },
      ],
    }),
    new Date("2026-09-07T18:00:00"),
    {},
    {
      plugins: [{id: pluginId, name: "background-gui", skills: ["review"], mcpServerIds: ["gui"]}],
      connections: [{id: "github", name: "GitHub"}],
    },
  );
  assert.deepEqual(summary.plugins, [{name: "background-gui", count: 3}]);
  assert.deepEqual(summary.connections, [{name: "GitHub", count: 4}]);
  assert.equal(summary.agents[0]?.kind, "polymux");
  assert.equal(summary.agents[0]?.name, "Polymux");
});

test("Assistant and Team split runtime usage, including runtime changes in one chat", () => {
  const input = source({
    conversations: [
      {id: "assistant", metadata: {}},
      {id: "team", metadata: {bot: {id: "reviewer", name: "Reviewer", profileId: "changed-since-run"}}},
      {id: "group", metadata: {teamGroup: {id: "group-1", name: "Engineers"}}},
    ],
    runs: [
      {id: "builtin", conversationId: "assistant", model: "openai/gpt", agent: null, tokens: 100},
      {id: "assistant-claude", conversationId: "assistant", model: "acp:npx", agent: {kind: "acp" as const, id: "claude", name: "Claude Code"}, tokens: 200},
      {id: "team-claude", conversationId: "team", model: "acp:npx", agent: {kind: "acp" as const, id: "claude", name: "Claude Code"}, tokens: 300},
      {id: "team-codex", conversationId: "team", model: "acp:npx", agent: {kind: "acp" as const, id: "codex", name: "Codex"}, tokens: 400},
      {id: "group-claude", conversationId: "group", model: "acp:npx", agent: {kind: "acp" as const, id: "claude", name: "Claude Code"}, tokens: 50},
    ].map(run => ({...run, startedAt: day(0), finishedAt: day(0), createdAt: day(0), parentRunId: null as string | null, usage: usage(run.tokens, run.tokens / 100)})),
    toolCounts: [
      {runId: "team-claude", conversationId: "team", name: "github__read", count: 3},
      {runId: "team-codex", conversationId: "team", name: "linear__read", count: 7},
    ],
    skillTurns: [
      {runId: "team-claude", conversationId: "team", names: ["review"]},
      {runId: "team-codex", conversationId: "team", names: ["plan", "build"]},
    ],
  });
  const at = new Date("2026-09-07T18:00:00");
  const all = summarizeUsage(input, at);
  const assistant = summarizeUsage(input, at, {scope: "assistant"});
  const team = summarizeUsage(input, at, {scope: "team"});
  assert.equal(all.lifetimeTokens, 1050);
  assert.equal(assistant.lifetimeTokens, 300);
  assert.equal(team.lifetimeTokens, 750);
  assert.equal(all.costUsd, assistant.costUsd + team.costUsd);
  assert.deepEqual(assistant.agents.map(agent => agent.name), ["Claude Code", "Polymux"]);
  assert.deepEqual(team.agents.map(agent => agent.name), ["Codex", "Claude Code"]);
  const claude = summarizeUsage(input, at, {scope: "team", agentId: "acp:claude"});
  assert.equal(claude.lifetimeTokens, 350);
  assert.equal(claude.costUsd, 3.5);
  assert.equal(claude.days.find(day => day.date === "2026-09-07")?.tokens, 350);
  assert.equal(claude.totalChats, 2);
  assert.equal(claude.skillsUsed, 1);
  assert.deepEqual(claude.connections, [{name: "github", count: 3}]);
  assert.equal(claude.agents.length, 2);
  assert.equal(summarizeUsage(input, at, {scope: "assistant", agentId: "acp:codex"}).lifetimeTokens, 0);
});

test("unidentified ACP history never becomes bundled assistant usage", () => {
  const summary = summarizeUsage(source({runs: [{conversationId: "a", model: "acp:npx", createdAt: day(0), startedAt: day(0), finishedAt: day(0), parentRunId: null, usage: usage(10)}]}));
  assert.equal(summary.agents[0]?.id, "acp:unknown");
  assert.equal(summary.agents[0]?.kind, "acp");
  const team = summarizeUsage(source({runs: []}), undefined, {scope: "team"});
  assert.equal(team.lifetimeTokens, 0);
  assert.equal(team.agents.length, 0);
});

test('global usage includes external history while app scopes partition only Polymux', () => {
  const at = day(0);
  const data = source({
    conversations: [{id: 'a', metadata: {}}, {id: 't', metadata: {bot: 'bot'}}, {id: 'outside', metadata: {usageOrigin: 'external'}}],
    runs: [
      {conversationId: 'a', createdAt: at, startedAt: at, finishedAt: at, parentRunId: null, model: 'gpt', usage: usage(100)},
      {conversationId: 't', createdAt: at, startedAt: at, finishedAt: at, parentRunId: null, model: 'gpt', usage: usage(200), agent: {id: 'codex', name: 'Codex', kind: 'acp'}},
      {conversationId: 'outside', createdAt: at, startedAt: at, finishedAt: at, parentRunId: null, model: 'gpt', usage: usage(600, 1, 50), runCount: 3, agent: {id: 'external:codex', name: 'Codex', kind: 'external'}},
    ],
  });
  const all = summarizeUsage(data, new Date(at));
  const app = summarizeUsage(data, new Date(at), {scope: 'polymux'});
  const assistant = summarizeUsage(data, new Date(at), {scope: 'assistant'});
  const team = summarizeUsage(data, new Date(at), {scope: 'team'});
  assert.equal(all.lifetimeTokens, 900);
  assert.equal(app.lifetimeTokens, 300);
  assert.equal(app.lifetimeTokens, assistant.lifetimeTokens + team.lifetimeTokens);
  assert.equal(app.totalChats, 2);
  assert.equal(all.totalChats, 3);
  assert.equal(all.agents.find(agent => agent.kind === 'external')?.runs, 3);
  assert.equal(all.reasoningPercent, 60);
  assert.deepEqual(app.agents.map(agent => agent.kind).sort(), ['acp', 'polymux']);
  assert.equal(summarizeUsage(data, new Date(at), {scope: 'assistant', agentId: 'external:codex'}).lifetimeTokens, 0);
});
