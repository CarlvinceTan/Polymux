import assert from 'node:assert/strict';
import test from 'node:test';
import {activityPresentation, collapseActivities, runThinkingActivity, toolResultFailed, visibleCommentaryLabel} from './activities';

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
