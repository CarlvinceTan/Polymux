import type { JsonValue } from "./types.js";

/** The bundled runtime; Assistant and Team can both use it. */
export const DEFAULT_USAGE_AGENT_ID = "polymux";
export type UsageScope = "all" | "assistant" | "team";
export interface UsageFilter {scope?: UsageScope; agentId?: string | null}
export interface UsageAgentRef {id: string; name: string; kind: "polymux" | "acp"}

export interface UsageRunRow {
  id: string;
  conversationId: string;
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  usage: JsonValue | null;
  parentRunId: string | null;
  agent?: UsageAgentRef | null;
}

export interface UsageConversationRow {
  id: string;
  metadata: JsonValue;
}

export interface UsageNamedCount {
  name: string;
  count: number;
}

export interface UsageToolCount {
  runId: string;
  conversationId: string;
  name: string;
  count: number;
}

export interface UsageSkillTurn {
  runId: string;
  conversationId: string;
  names: string[];
}

export interface UsageSource {
  runs: UsageRunRow[];
  conversations: UsageConversationRow[];
  toolCounts: UsageToolCount[];
  /** Skill names offered on each `turn.started`, in turn order. */
  skillTurns: UsageSkillTurn[];
}

export interface UsageDay {
  date: string;
  tokens: number;
  costUsd: number;
  runs: number;
}

export interface UsageModelSpend {
  model: string;
  tokens: number;
  costUsd: number;
  runs: number;
}

export interface UsageAgent extends UsageAgentRef {
  tokens: number;
  costUsd: number;
  runs: number;
  chats: number;
}

export interface UsageSummary {
  lifetimeTokens: number;
  peakTokens: number;
  costUsd: number;
  longestChatMs: number;
  currentStreakDays: number;
  longestStreakDays: number;
  days: UsageDay[];
  /** Share of parent runs that spent no reasoning tokens, 0–100. */
  fastModePercent: number | null;
  /** Share of parent runs that produced reasoning tokens, 0–100. */
  reasoningPercent: number | null;
  skillsExplored: number;
  skillsUsed: number;
  totalChats: number;
  plugins: UsageNamedCount[];
  connections: UsageNamedCount[];
  models: UsageModelSpend[];
  agents: UsageAgent[];
  agentId: string | null;
  scope: UsageScope;
  /** True when some runs have tokens but no stored API-equivalent cost. */
  spendIncomplete: boolean;
}

export interface UsagePluginCatalog {
  id: string;
  name: string;
  skills: string[];
  mcpServerIds: string[];
}

export interface UsageConnectionCatalog {
  id: string;
  name: string;
}

export interface UsageCatalog {
  plugins: UsagePluginCatalog[];
  connections: UsageConnectionCatalog[];
}

interface ParsedUsage {
  totalTokens: number;
  costUsd: number;
  reasoningTokens: number;
  hasCost: boolean;
}

const HEATMAP_WEEKS = 53;

export function summarizeUsage(
  source: UsageSource,
  now: Date = new Date(),
  filter: UsageFilter = {},
  catalog: UsageCatalog = {plugins: [], connections: []},
): UsageSummary {
  const origin = startOfDay(now);
  const heatmapStart = startOfHeatmap(origin);
  const scope = filter.scope ?? "all";
  const agentId = filter.agentId ?? null;
  const scopeByConversation = new Map<string, UsageScope>();
  for (const conversation of source.conversations) {
    scopeByConversation.set(conversation.id, usageScopeFromMetadata(conversation.metadata));
  }
  const scopeRuns = source.runs.filter(run => scope === "all" || (scopeByConversation.get(run.conversationId) ?? "assistant") === scope);
  const scoped = scopeRuns.filter(run => !agentId || usageAgentForRun(run).id === agentId);
  const scopedRunIds = new Set(scoped.map(run => run.id));

  const byDay = new Map<string, UsageDay>();
  for (
    const cursor = new Date(heatmapStart);
    cursor.getTime() <= origin.getTime();
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const date = dayKey(cursor);
    byDay.set(date, {date, tokens: 0, costUsd: 0, runs: 0});
  }

  const conversationSpan = new Map<string, {start: number; end: number}>();
  const models = new Map<string, UsageModelSpend>();
  const peakByDay = new Map<string, number>();
  const activeDays = new Set<string>();
  let lifetimeTokens = 0;
  let costUsd = 0;
  let parentRuns = 0;
  let fastParents = 0;
  let reasoningParents = 0;
  let spendIncomplete = false;

  for (const run of scoped) {
    const usage = parseUsage(run.usage);
    const tokens = usage?.totalTokens ?? 0;
    const spend = usage?.costUsd ?? 0;
    if (tokens > 0 && !usage?.hasCost) spendIncomplete = true;
    lifetimeTokens += tokens;
    costUsd += spend;

    const at = Date.parse(run.startedAt ?? run.createdAt);
    const finished = Date.parse(run.finishedAt ?? run.startedAt ?? run.createdAt);
    const start = Number.isFinite(at) ? at : Date.parse(run.createdAt);
    const end = Number.isFinite(finished) ? finished : start;
    const span = conversationSpan.get(run.conversationId);
    if (!span) conversationSpan.set(run.conversationId, {start, end});
    else {
      if (start < span.start) span.start = start;
      if (end > span.end) span.end = end;
    }

    const date = dayKey(new Date(Number.isFinite(start) ? start : origin.getTime()));
    peakByDay.set(date, (peakByDay.get(date) ?? 0) + tokens);
    activeDays.add(date);
    const day = byDay.get(date);
    if (day) {
      day.tokens += tokens;
      day.costUsd += spend;
      day.runs += 1;
    }

    const model = run.model?.trim() || "Unknown";
    const row = models.get(model) ?? {model, tokens: 0, costUsd: 0, runs: 0};
    row.tokens += tokens;
    row.costUsd += spend;
    row.runs += 1;
    models.set(model, row);

    if (run.parentRunId) continue;
    parentRuns += 1;
    if (!usage) continue;
    if (usage.reasoningTokens > 0) reasoningParents += 1;
    else fastParents += 1;
  }

  const days = [...byDay.values()];
  let peakTokens = 0;
  for (const tokens of peakByDay.values()) if (tokens > peakTokens) peakTokens = tokens;

  let longestChatMs = 0;
  for (const span of conversationSpan.values()) {
    const duration = Math.max(0, span.end - span.start);
    if (duration > longestChatMs) longestChatMs = duration;
  }

  const {currentStreakDays, longestStreakDays} = streaks(activeDays, origin);

  const scopedConversationIds = agentId
    ? new Set(scoped.map(run => run.conversationId))
    : new Set(source.conversations.filter(conversation => scope === "all" || scopeByConversation.get(conversation.id) === scope).map(conversation => conversation.id));

  const skillCounts = new Map<string, number>();
  for (const turn of source.skillTurns) {
    if (!scopedRunIds.has(turn.runId)) continue;
    for (const name of turn.names) {
      const key = name.trim();
      if (!key) continue;
      skillCounts.set(key, (skillCounts.get(key) ?? 0) + 1);
    }
  }
  const toolCounts = source.toolCounts.filter(
    (row) => scopedRunIds.has(row.runId),
  );
  const tools = mergeNamed(toolCounts.map((row) => ({name: row.name, count: row.count})));
  const skills = [...skillCounts.entries()].map(([name, count]) => ({name, count}));
  const classified = classifyUsageLists(tools, skills, catalog);

  const totalChats = scopedConversationIds.size;

  return {
    lifetimeTokens,
    peakTokens,
    costUsd,
    longestChatMs,
    currentStreakDays,
    longestStreakDays,
    days,
    fastModePercent: parentRuns ? Math.round((fastParents / parentRuns) * 100) : null,
    reasoningPercent: parentRuns ? Math.round((reasoningParents / parentRuns) * 100) : null,
    skillsExplored: skillCounts.size,
    skillsUsed: [...skillCounts.values()].reduce((total, count) => total + count, 0),
    totalChats,
    plugins: classified.plugins.slice(0, 40),
    connections: classified.connections.slice(0, 40),
    models: [...models.values()].sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens),
    agents: agentBreakdown(scopeRuns),
    agentId,
    scope,
    spendIncomplete,
  };
}

export function usageScopeFromMetadata(metadata: JsonValue): "assistant" | "team" {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "assistant";
  return metadata.bot || metadata.teamGroup ? "team" : "assistant";
}

/** Runtime identity belongs to the run, never to the current profile or bot. */
export function usageAgentForRun(run: UsageRunRow): UsageAgentRef {
  if (run.agent?.kind === "acp") {
    const id = run.agent.id.trim() || run.agent.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown";
    return {kind: "acp", id: `acp:${id}`, name: run.agent.name.trim() || "ACP Agent"};
  }
  // Older ACP runs still carry their declared name in run.started.model.
  // A row without that event stays explicitly unknown, never Polymux.
  if (run.model?.startsWith("acp:")) return {kind: "acp", id: "acp:unknown", name: "ACP Agent"};
  return {kind: "polymux", id: DEFAULT_USAGE_AGENT_ID, name: "Polymux"};
}

function agentBreakdown(runs: UsageRunRow[]): UsageAgent[] {
  const chats = new Map<string, Set<string>>();
  const rows = new Map<string, UsageAgent>();
  for (const run of runs) {
    const agent = usageAgentForRun(run);
    const usage = parseUsage(run.usage);
    const row = rows.get(agent.id) ?? {...agent, tokens: 0, costUsd: 0, runs: 0, chats: 0};
    row.tokens += usage?.totalTokens ?? 0;
    row.costUsd += usage?.costUsd ?? 0;
    row.runs += 1;
    rows.set(agent.id, row);
    const set = chats.get(agent.id) ?? new Set<string>();
    set.add(run.conversationId);
    chats.set(agent.id, set);
  }
  for (const [id, row] of rows) row.chats = chats.get(id)?.size ?? 0;
  return [...rows.values()].sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
}

function parseUsage(value: JsonValue | null): ParsedUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const totalTokens = number(record.totalTokens);
  const cost = number(record.costUsd);
  const reasoning = number(record.reasoningTokens);
  if (totalTokens == null && cost == null && reasoning == null) return null;
  return {
    totalTokens: totalTokens ?? 0,
    costUsd: cost ?? 0,
    reasoningTokens: reasoning ?? 0,
    hasCost: cost != null,
  };
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfHeatmap(origin: Date): Date {
  const start = new Date(origin);
  start.setDate(start.getDate() - (HEATMAP_WEEKS - 1) * 7);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function streaks(
  activeDays: Set<string>,
  origin: Date,
): {currentStreakDays: number; longestStreakDays: number} {
  const today = dayKey(origin);
  const yesterdayDate = new Date(origin);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = dayKey(yesterdayDate);
  const cursor = new Date(activeDays.has(today) ? origin : yesterdayDate);
  let current = 0;
  if (activeDays.has(today) || activeDays.has(yesterday)) {
    while (activeDays.has(dayKey(cursor))) {
      current += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  const sorted = [...activeDays].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of sorted) {
    if (previous && consecutive(previous, date)) run += 1;
    else run = 1;
    if (run > longest) longest = run;
    previous = date;
  }
  return {currentStreakDays: current, longestStreakDays: longest};
}

function consecutive(earlier: string, later: string): boolean {
  const [year, month, day] = earlier.split("-").map(Number);
  const next = new Date(year, month - 1, day);
  next.setDate(next.getDate() + 1);
  return dayKey(next) === later;
}

export function mcpServerPrefix(toolName: string): string | null {
  const index = toolName.indexOf("__");
  return index > 0 ? toolName.slice(0, index) : null;
}

export function encodeMcpToken(value: string): string {
  return [...value]
    .map((character) =>
      /^[a-zA-Z0-9_-]$/.test(character)
        ? character
        : `_${character.codePointAt(0)!.toString(16)}_`,
    )
    .join("");
}

export function classifyUsageLists(
  tools: UsageNamedCount[],
  skills: UsageNamedCount[],
  catalog: UsageCatalog,
): {plugins: UsageNamedCount[]; connections: UsageNamedCount[]} {
  const pluginCounts = new Map<string, {name: string; count: number}>();
  const connectionCounts = new Map<string, {name: string; count: number}>();
  const pluginBySkill = new Map<string, UsagePluginCatalog>();
  const pluginByPrefix = new Map<string, UsagePluginCatalog>();
  for (const plugin of catalog.plugins) {
    for (const skill of plugin.skills) pluginBySkill.set(skill, plugin);
    for (const serverId of plugin.mcpServerIds) {
      pluginByPrefix.set(encodeMcpToken(`plugin:${plugin.id}:${serverId}`), plugin);
      pluginByPrefix.set(encodeMcpToken(serverId), plugin);
    }
  }
  const connectionByPrefix = new Map<string, UsageConnectionCatalog>();
  for (const connection of catalog.connections) {
    connectionByPrefix.set(encodeMcpToken(connection.id), connection);
  }

  const add = (
    into: Map<string, {name: string; count: number}>,
    id: string,
    name: string,
    count: number,
  ) => {
    const row = into.get(id) ?? {name, count: 0};
    row.name = name;
    row.count += count;
    into.set(id, row);
  };

  for (const skill of skills) {
    const plugin = pluginBySkill.get(skill.name);
    if (plugin) add(pluginCounts, plugin.id, plugin.name, skill.count);
  }
  for (const tool of tools) {
    const prefix = mcpServerPrefix(tool.name);
    if (!prefix) continue;
    const plugin = pluginByPrefix.get(prefix);
    if (plugin) {
      add(pluginCounts, plugin.id, plugin.name, tool.count);
      continue;
    }
    const connection = connectionByPrefix.get(prefix);
    add(
      connectionCounts,
      connection?.id ?? prefix,
      connection?.name ?? prefix,
      tool.count,
    );
  }

  const rank = (rows: Map<string, {name: string; count: number}>) =>
    [...rows.entries()]
      .map(([id, row]) => ({name: row.name || id, count: row.count}))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {plugins: rank(pluginCounts), connections: rank(connectionCounts)};
}

function mergeNamed(rows: UsageNamedCount[]): UsageNamedCount[] {
  const merged = new Map<string, number>();
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    merged.set(name, (merged.get(name) ?? 0) + row.count);
  }
  return [...merged.entries()].map(([name, count]) => ({name, count}));
}
