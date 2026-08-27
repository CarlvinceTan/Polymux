import assert from 'node:assert/strict';
import test from 'node:test';
import {activityPresentation, collapseActivities, runThinkingActivity, settledActivities, toolResultFailed, visibleCommentaryLabel} from './activities';

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

test('reasoning reuses the optimistic thinking row for the whole run', () => {
  const optimistic = {id: 'optimistic', kind: 'thinking' as const, label: 'Thinking', status: 'completed' as const};
  assert.equal(runThinkingActivity([optimistic], 'run-1')?.id, 'optimistic');
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

test('a counted row keeps each call\u2019s result and a failure stays red', () => {
  const commands = settledActivities([
    {id: 'a', kind: 'running' as const, label: 'git status', status: 'completed'},
    {id: 'b', kind: 'running' as const, label: 'npm test', status: 'failed', result: 'boom'},
  ]);
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.status, 'failed');
  assert.deepEqual(commands[0]?.steps?.map((step) => [step.label, step.result]), [
    ['git status', undefined],
    ['npm test', 'boom'],
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
