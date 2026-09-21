import assert from 'node:assert/strict';
import test from 'node:test';
import {applyRunEvent, createLiveRun} from './run';

test('run reducer keeps streamed text and settles active work', () => {
  let run = createLiveRun('run-1', 'conversation-1');
  run = applyRunEvent(run, {
    runId: 'run-1', conversationId: 'conversation-1', sequence: 1, timestamp: 1,
    type: 'message.text.delta', payload: {delta: 'Hello'},
  });
  run = applyRunEvent(run, {
    runId: 'run-1', conversationId: 'conversation-1', sequence: 2, timestamp: 2,
    type: 'tool.started', payload: {toolCall: {id: 'call-1', name: 'read', arguments: {path: '/tmp/a.txt'}}},
  });
  run = applyRunEvent(run, {
    runId: 'run-1', conversationId: 'conversation-1', sequence: 3, timestamp: 3,
    type: 'run.completed', payload: {result: {lastAgentMessage: 'Hello', hadWorkActivity: true}},
  });
  assert.equal(run.text, 'Hello');
  assert.equal(run.status, 'completed');
  assert.deepEqual(run.activities[0], {
    id: 'call-1', label: 'Reading file', detail: '/tmp/a.txt', status: 'completed',
  });
});

test('run reducer ignores replayed event sequences', () => {
  const started = applyRunEvent(createLiveRun('run-1', 'conversation-1'), {
    runId: 'run-1', conversationId: 'conversation-1', sequence: 2, timestamp: 2,
    type: 'message.text.delta', payload: {delta: 'Once'},
  });
  const replayed = applyRunEvent(started, {
    runId: 'run-1', conversationId: 'conversation-1', sequence: 2, timestamp: 2,
    type: 'message.text.delta', payload: {delta: ' twice'},
  });
  assert.equal(replayed.text, 'Once');
});
