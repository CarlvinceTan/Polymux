import {createHash} from 'node:crypto';
import type {UsageSource, UsageRunRow} from '@polymux/storage';
import type {ProjectSummary} from './codeburn/types.js';
import {billableOutputTokens, getModelCosts} from './codeburn/models.js';
import {providerDisplayName} from './codeburn/providers/index.js';

/** Strip transcript content at the worker boundary. Keep only usage buckets. */
export function aggregateLocalUsage(projects: ProjectSummary[]): {source: UsageSource; estimated: boolean} {
  const source: UsageSource = {runs: [], conversations: [], toolCounts: [], skillTurns: []};
  const buckets = new Map<string, UsageRunRow>();
  const conversations = new Set<string>();
  const tools = new Map<string, UsageSource["toolCounts"][number]>();
  const skills = new Map<string, UsageSource["skillTurns"][number]>();
  const seen = new Set<string>();
  let estimated = false;
  for (const project of projects) for (const session of project.sessions) {
    for (const turn of session.turns) for (const call of turn.assistantCalls) {
      const dedup = `${call.provider}:${call.deduplicationKey}`;
      if (call.deduplicationKey && seen.has(dedup)) continue;
      if (call.deduplicationKey) seen.add(dedup);
      const at = new Date(call.timestamp);
      if (!Number.isFinite(at.getTime())) continue;
      const conversationId = `external:${createHash('sha256').update(`${call.provider}:${session.sessionId}`).digest('hex')}`;
      conversations.add(conversationId);
      const date = `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;
      const reasoning = call.usage.reasoningTokens > 0;
      const hasCost = call.costUSD > 0 || call.isLocalSavings || getModelCosts(call.model) !== null;
      const key = `${conversationId}:${date}:${call.model}:${reasoning}:${hasCost}`;
      let row = buckets.get(key);
      if (!row) {
        row = {id: `external:${buckets.size}`, conversationId, model: call.model,
          startedAt: at.toISOString(), finishedAt: at.toISOString(), createdAt: at.toISOString(),
          parentRunId: null, runCount: 0,
          agent: {id: `external:${call.provider}`, name: providerDisplayName(call.provider), kind: 'external'},
          usage: {totalTokens: 0, reasoningTokens: 0, ...(hasCost ? {costUsd: 0} : {})}};
        buckets.set(key, row);
      }
      const usage = row.usage as {totalTokens: number; reasoningTokens: number; costUsd?: number};
      const u = call.usage;
      // cachedInputTokens aliases cacheReadInputTokens; reasoning is included in
      // output by some providers. Never add either twice.
      usage.totalTokens += u.inputTokens + billableOutputTokens(call.provider, u.outputTokens, u.reasoningTokens)
        + u.cacheReadInputTokens + u.cacheCreationInputTokens;
      usage.reasoningTokens += u.reasoningTokens;
      if (hasCost) usage.costUsd = (usage.costUsd ?? 0) + call.costUSD;
      row.runCount! += call.supplementaryAccounting ? 0 : 1;
      if (at.toISOString() < row.startedAt!) row.startedAt = at.toISOString();
      if (at.toISOString() > row.finishedAt!) row.finishedAt = at.toISOString();
      if (!call.supplementaryAccounting) {
        for (const tool of call.tools) {
          const name = tool.replace(/^mcp__/, '');
          const toolKey = `${row.id}:${name}`;
          const entry = tools.get(toolKey) ?? {runId: row.id, conversationId, name, count: 0};
          entry.count++;
          tools.set(toolKey, entry);
        }
        if (call.skills.length) {
          const entry = skills.get(row.id) ?? {runId: row.id, conversationId, names: []};
          entry.names.push(...call.skills);
          skills.set(row.id, entry);
        }
      }
      estimated ||= !!call.isEstimated;
    }
  }
  source.runs = [...buckets.values()];
  source.toolCounts = [...tools.values()];
  source.skillTurns = [...skills.values()];
  source.conversations = [...conversations].map(id => ({id, metadata: {usageOrigin: 'external'}}));
  return {source, estimated};
}
