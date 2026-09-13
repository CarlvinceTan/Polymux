import assert from 'node:assert/strict';
import test from 'node:test';
import type {RunEventDto} from '@polymux/protocol';
import {applyTaskEvent, emptyTranscript} from './taskTranscript';

function event(type: RunEventDto['type'], payload: unknown, sequence: number): RunEventDto {
  return {
    runId: 'task-run',
    conversationId: 'conversation',
    parentRunId: 'parent-run',
    sequence,
    timestamp: sequence,
    type,
    payload,
  } as RunEventDto;
}

test('keeps streamed task reasoning when the first tool starts', () => {
  const reasoning = applyTaskEvent(
    emptyTranscript('task-run'),
    event('message.reasoning.delta', {delta: 'Checking the source'}, 1),
  );
  const withTool = applyTaskEvent(
    reasoning,
    event('tool.started', {toolCall: {id: 'read-1', name: 'read', arguments: {path: '/source.ts'}}}, 2),
  );

  const thinking = withTool.activities.find((item) => item.kind === 'thinking');
  assert.deepEqual(thinking && {status: thinking.status, result: thinking.result}, {
    status: 'completed',
    result: 'Checking the source',
  });
});

test('a rejected task draft is removed before the repair streams', () => {
  const streamed = applyTaskEvent(
    emptyTranscript('task-run'),
    event('message.text.delta', {delta: 'Internal scratch'}, 1),
  );
  assert.equal(streamed.text, 'Internal scratch');
  const rejected = applyTaskEvent(
    streamed,
    event('message.final_rejected', {turn: 1, repairMessageCount: 1}, 2),
  );
  assert.equal(rejected.text, '');
  const repaired = applyTaskEvent(
    rejected,
    event('message.text.delta', {delta: 'Verified result'}, 3),
  );
  assert.equal(repaired.text, 'Verified result');
});
