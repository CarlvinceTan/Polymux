import assert from 'node:assert/strict';
import test from 'node:test';
import {activityChains, activityPresentation, activityPreviewTabId, activityTrailSplits, collapseActivities, runThinkingActivity, settledActivities, toolResultFailed, visibleCommentaryLabel} from './activities';

test('provider scratch headings do not become user-visible activity rows', () => {
  assert.equal(visibleCommentaryLabel('**Planning message lookup implementation**'), null);
  assert.equal(visibleCommentaryLabel('## Verifying current details'), null);
  assert.equal(visibleCommentaryLabel('I found two matching events and am checking their dates.'), 'I found two matching events and am checking their dates.');
});

test('browser activity names the surface and the operation it performed', () => {
  assert.deepEqual(activityPresentation('browser', {action: 'open', url: 'https://nusync.nus.edu.sg/events'}), {
    kind: 'searching',
    label: 'Using Browser',
    icon: 'globe',
    target: 'nusync.nus.edu.sg',
  });
  assert.equal(activityPresentation('browser_tabs').target, 'Tabs');
  assert.equal(activityPresentation('browser', {action: 'snapshot'}).target, 'Snapshot');
  assert.deepEqual(activityPresentation('browser_read', {target: 'https://example.com'}, 'run-1').preview, {
    kind: 'browser',
    tabId: '',
  });
});

test('agent messages become an inline recipient activity', () => {
  assert.deepEqual(activityPresentation('agent_message', {action: 'send', to: 'Mark'}), {
    kind: 'messaging',
    label: 'Messaged Mark',
    target: 'Mark',
    display: 'inline',
  });
});

test('computer activity binds its live preview to the run that loaded the skill', () => {
  assert.deepEqual(activityPresentation('read', {path: '/skills/window-control/SKILL.md'}, 'run-1').preview, {
    kind: 'computer',
    runId: 'run-1',
  });
});

test('browser preview identity is recovered from progress or tool results', () => {
  assert.equal(activityPreviewTabId({browserTabId: 'tab-progress'}), 'tab-progress');
  assert.equal(activityPreviewTabId({content: JSON.stringify({ok: true, tabId: 'tab-result'})}), 'tab-result');
  assert.equal(activityPreviewTabId({content: JSON.stringify({pages: [{tabId: 'tab-batch'}]})}), 'tab-batch');
});

test('domain-level tool errors are failures even when the call completed', () => {
  assert.equal(toolResultFailed({isError: true}), true);
  assert.equal(toolResultFailed({metadata: {status: 'failed'}}), true);
  assert.equal(toolResultFailed({content: 'ok'}), false);
});

test('condensing never hides a changed target or a failed attempt', () => {
  const base = {kind: 'searching' as const, label: 'Using Browser'};
  const activities = collapseActivities([
    {id: '1', ...base, target: 'Search', status: 'completed'},
    {id: '2', ...base, target: 'Tabs', status: 'failed'},
    {id: '3', ...base, target: 'Tabs', status: 'completed'},
  ]);
  assert.equal(activities.length, 3);
  assert.equal(activities[1]?.status, 'failed');
});

test('one browser row keeps its operations and any failure as detail', () => {
  const browser = {kind: 'searching' as const, label: 'Using Browser', icon: 'globe' as const};
  const activities = collapseActivities([
    {id: 'open', ...browser, target: 'nusync.nus.edu.sg', status: 'completed'},
    {id: 'tabs', ...browser, target: 'Tabs', status: 'failed'},
    {id: 'read', ...browser, target: 'Read', status: 'completed'},
  ]);
  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.status, 'failed');
  assert.deepEqual(activities[0]?.steps?.map((step) => [step.label, step.status]), [
    ['nusync.nus.edu.sg', 'completed'],
    ['Tabs', 'failed'],
    ['Read', 'completed'],
  ]);
});

test('one browser row keeps the newest live tab preview', () => {
  const browser = {kind: 'searching' as const, label: 'Using Browser', icon: 'globe' as const};
  const activities = collapseActivities([
    {id: 'open', ...browser, status: 'completed' as const, preview: {kind: 'browser' as const, tabId: 'tab-1'}},
    {id: 'read', ...browser, status: 'active' as const, preview: {kind: 'browser' as const, tabId: 'tab-2'}},
  ]);
  assert.deepEqual(activities[0]?.preview, {kind: 'browser', tabId: 'tab-2'});
});

test('reasoning reuses an active optimistic row but starts a new episode after tools', () => {
  const optimistic = {id: 'optimistic', kind: 'thinking' as const, label: 'Thinking', status: 'active' as const};
  assert.equal(runThinkingActivity([optimistic], 'run-1')?.id, 'optimistic');
  assert.equal(runThinkingActivity([{...optimistic, status: 'completed'}], 'run-1'), undefined);
  assert.equal(runThinkingActivity([optimistic, {id: 'tool', kind: 'tool', label: 'Read', status: 'completed'}], 'run-1'), undefined);
});

test('a collapsed stretch of identical calls keeps its count', () => {
  const run = {kind: 'running' as const, label: 'npm test'};
  const collapsed = collapseActivities([
    {id: '1', ...run, status: 'completed'},
    {id: '2', ...run, status: 'completed'},
    {id: '3', ...run, status: 'completed'},
  ]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0]?.count, 3);
});

test('the settled trail condenses a stretch of commands to one counted row', () => {
  const commands = settledActivities([
    {id: 'a', kind: 'running' as const, label: 'git status', status: 'completed'},
    {id: 'b', kind: 'running' as const, label: 'npm test', status: 'completed'},
  ]);
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.label, 'Ran 2 commands');
  assert.deepEqual(commands[0]?.steps?.map((step) => step.label), ['git status', 'npm test']);
});

test('the settled trail keeps the finished compaction line', () => {
  const settled = settledActivities([
    {id: 'c', kind: 'compacting' as const, label: 'Compacted 100 tokens → 40 tokens', status: 'completed'},
  ]);
  assert.deepEqual(settled.map((row) => row.label), ['Compacted 100 tokens → 40 tokens']);
});

test('a failed command says it failed to run', () => {
  const commands = settledActivities([
    {id: 'a', kind: 'running' as const, label: 'python3 script.py', status: 'failed', result: 'Command timed out'},
  ]);
  assert.deepEqual(commands.map((row) => [row.label, row.status]), [
    ['Failed to run 1 command', 'failed'],
  ]);
});

test('settled commands separate successful calls from failures and label both honestly', () => {
  const commands = settledActivities([
    {id: 'a', kind: 'running' as const, label: 'git status', status: 'completed'},
    {id: 'b', kind: 'running' as const, label: 'npm test', status: 'failed', result: 'boom'},
    {id: 'c', kind: 'running' as const, label: 'npm check', status: 'failed', result: 'still broken'},
  ]);
  assert.deepEqual(commands.map((row) => [row.label, row.status]), [
    ['Ran 1 command', 'completed'],
    ['Failed to run 2 commands', 'failed'],
  ]);
  assert.deepEqual(commands[0]?.steps?.map((step) => [step.label, step.result]), [
    ['git status', undefined],
  ]);
  assert.deepEqual(commands[1]?.steps?.map((step) => [step.label, step.result]), [
    ['npm test', 'boom'],
    ['npm check', 'still broken'],
  ]);
});

test('a collapsed row still counts every call behind it', () => {
  const commands = settledActivities([{id: 'a', kind: 'running' as const, label: 'npm test', status: 'completed', count: 3}]);
  assert.equal(commands[0]?.label, 'Ran 3 commands');
});

test('reading and editing condense to file counts with the paths as steps', () => {
  const settled = settledActivities([
    {id: 'r1', kind: 'reading' as const, label: 'Reading Files', target: '/a.ts', status: 'completed'},
    {id: 'r2', kind: 'reading' as const, label: 'Reading Files', target: '/b.ts', status: 'completed'},
    {id: 'c1', kind: 'running' as const, label: 'ls -la', status: 'completed'},
    {id: 'e1', kind: 'editing' as const, label: 'Editing Files', target: '/b.ts', status: 'completed'},
  ]);
  assert.deepEqual(settled.map((row) => row.label), ['Read 2 files', 'Ran 1 command', 'Edited 1 file']);
  assert.deepEqual(settled[0]?.steps?.map((step) => step.label), ['/a.ts', '/b.ts']);
});

test('settled narration stays hidden but a failed attempt never disappears', () => {
  const settled = settledActivities([
    {id: 't', kind: 'thinking' as const, label: 'Thinking', status: 'completed'},
    {id: 'c', kind: 'commentary' as const, label: 'Let me check.', status: 'completed'},
    {id: 'f', kind: 'tool' as const, label: 'Using Weather', status: 'failed', result: 'no signal'},
  ]);
  assert.deepEqual(settled.map((row) => row.id), ['f']);
});

test('a command names the row and a read or edit names the file', () => {
  assert.equal(activityPresentation('bash', {command: 'npm test'}).label, 'npm test');
  const multi = activityPresentation('bash', {command: 'set -e\nls\nls'});
  assert.equal(multi.label, 'set -e');
  assert.equal(activityPresentation('read', {path: '/a.ts'}).target, '/a.ts');
  assert.equal(activityPresentation('edit', {path: '/b.ts'}).target, '/b.ts');
});


test('activity chains preserve prose boundaries and every individual result', () => {
  const items = [
    {id: 'a', kind: 'thinking' as const, label: 'Thought', status: 'completed' as const},
    {id: 'b', kind: 'running' as const, label: 'Run', status: 'completed' as const, result: 'first output'},
    {id: 'c', kind: 'commentary' as const, label: 'Next step', status: 'completed' as const},
    {id: 'd', kind: 'running' as const, label: 'Run', status: 'failed' as const, result: 'second output'},
  ];
  assert.deepEqual(activityChains(items).map((chain) => chain.items.map((item) => item.id)), [['a', 'b'], ['c'], ['d']]);
  const collapsed = collapseActivities([items[1], {...items[1], id: 'other', result: 'other output'}]);
  assert.deepEqual(collapsed[0].steps?.map((step) => step.result), ['first output', 'other output']);
});

test('a steer cuts the run trail around the message that interrupted it', () => {
  const row = (id: string) => ({id, kind: 'thinking' as const, label: `Step ${id}`, status: 'completed' as const});
  const splits = activityTrailSplits([
    {id: 'prompt', role: 'user', runId: 'r1', sentAt: '2026-01-01T00:00:00.000Z'},
    {id: 'steer', role: 'user', runId: 'r1', sentAt: '2026-01-01T00:00:05.000Z', activitiesBefore: 2},
    {
      id: 'answer',
      role: 'assistant',
      runId: 'r1',
      sentAt: '2026-01-01T00:00:10.000Z',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:10.000Z',
      activities: [row('a'), row('b'), row('c')],
    },
  ]);

  // What the agent had already done belongs above the steer, timed to the
  // moment the user typed it; what came after belongs with the reply.
  assert.deepEqual(splits.above.get('steer'), {
    activities: [row('a'), row('b')],
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:05.000Z',
  });
  assert.deepEqual(splits.tail.get('answer'), {
    activities: [row('c')],
    startedAt: '2026-01-01T00:00:05.000Z',
    completedAt: '2026-01-01T00:00:10.000Z',
  });
  assert.equal(splits.above.has('prompt'), false);
});

test('a second steer cuts the trail again, and an unsteered run is left whole', () => {
  const row = (id: string) => ({id, kind: 'reading' as const, label: `Read ${id}`, status: 'completed' as const});
  const splits = activityTrailSplits([
    {id: 'first', role: 'user', runId: 'r1', sentAt: '2026-01-01T00:00:02.000Z', activitiesBefore: 1},
    {id: 'second', role: 'user', runId: 'r1', sentAt: '2026-01-01T00:00:04.000Z', activitiesBefore: 3},
    {id: 'answer', role: 'assistant', runId: 'r1', sentAt: '2026-01-01T00:00:06.000Z', activities: [row('a'), row('b'), row('c'), row('d')]},
  ]);
  assert.deepEqual(splits.above.get('first')?.activities.map((item) => item.id), ['a']);
  assert.deepEqual(splits.above.get('second')?.activities.map((item) => item.id), ['b', 'c']);
  assert.deepEqual(splits.tail.get('answer')?.activities.map((item) => item.id), ['d']);
  // The window between the two steers is timed from the first to the second.
  assert.equal(splits.above.get('second')?.startedAt, '2026-01-01T00:00:02.000Z');

  const untouched = activityTrailSplits([
    {id: 'prompt', role: 'user', runId: 'r2', sentAt: '2026-01-01T00:00:00.000Z'},
    {id: 'answer', role: 'assistant', runId: 'r2', activities: [row('a')]},
  ]);
  assert.equal(untouched.above.size, 0);
  assert.equal(untouched.tail.size, 0);
});
