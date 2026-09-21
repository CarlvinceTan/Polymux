import assert from 'node:assert/strict';
import {test} from 'node:test';
import {aggregateLocalUsage} from './aggregate.js';
import type {ParsedApiCall, ProjectSummary} from './codeburn/types.js';
import {summarizeUsage} from '@polymux/storage';

function call(patch: Partial<ParsedApiCall> = {}): ParsedApiCall {
  return {provider: 'codex', model: 'gpt-5', usage: {inputTokens: 100, outputTokens: 30,
    reasoningTokens: 20, cacheReadInputTokens: 50, cachedInputTokens: 50, cacheCreationInputTokens: 10, webSearchRequests: 0},
    costUSD: .001, tools: [], mcpTools: [], skills: [], subagentTypes: [], hasAgentSpawn: false,
    hasPlanMode: false, speed: 'standard', timestamp: '2026-09-15T12:00:00Z', bashCommands: [], deduplicationKey: 'request-1', ...patch};
}
function projects(calls: ParsedApiCall[]): ProjectSummary[] {
  return [{name: '/private/project', sessions: [{sessionId: 'private-session', turns: [{userMessage: 'Private prompt never leaves worker', assistantCalls: calls}]}]}] as unknown as ProjectSummary[];
}

test('deduplicates requests and avoids counting cached/reasoning tokens twice', () => {
  const result = aggregateLocalUsage(projects([call({tools: ['mcp__github__search'], skills: ['review']}), call(), call({deduplicationKey: 'request-2', supplementaryAccounting: true})]));
  const stats = summarizeUsage(result.source, new Date('2026-09-15T13:00:00Z'));
  assert.equal(stats.lifetimeTokens, 380);
  assert.equal(stats.agents[0].runs, 1);
  assert.equal(stats.costUsd, .002);
  assert.equal(stats.totalChats, 1);
  assert.equal(stats.reasoningPercent, 100);
  assert.equal(stats.skillsUsed, 1);
  assert.deepEqual(stats.connections, [{name: 'github', count: 1}]);
  assert.equal(JSON.stringify(result).includes('Private prompt'), false);
  assert.equal(JSON.stringify(result).includes('private-session'), false);
  assert.equal(JSON.stringify(result).includes('/private/project'), false);
});

test('separates days/models and marks estimated or unpriced history', () => {
  const result = aggregateLocalUsage(projects([call(), call({provider: 'gemini', model: 'not-a-real-model', deduplicationKey: 'other', timestamp: '2026-09-14T12:00:00Z', isEstimated: true, costUSD: 0})]));
  const stats = summarizeUsage(result.source, new Date('2026-09-15T13:00:00Z'));
  assert.equal(stats.lifetimeTokens, 400); // Gemini reports reasoning separately.
  assert.equal(stats.spendIncomplete, true);
  assert.equal(result.estimated, true);
  assert.equal(stats.models.length, 2);
  assert.equal(stats.days.filter(day => day.tokens > 0).length, 2);
});
