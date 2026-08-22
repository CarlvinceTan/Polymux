import assert from 'node:assert/strict';
import test from 'node:test';
import type {RunEventDto} from '@flareai/protocol';
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
