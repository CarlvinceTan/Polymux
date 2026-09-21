import assert from 'node:assert/strict';
import test from 'node:test';
import {SqliteStorage} from '@polymux/storage/sqlite';
import {ChatPool} from '../agent/chat-pool.js';
import {taskOverview} from './overview.js';

test('task overview preserves outcomes and reads results beyond normal chat pagination', () => {
  const storage = new SqliteStorage(':memory:');
  try {
    storage.createConversation({id: 'chat', title: 'Research'});
    for (let i = 0; i < 501; i++) storage.appendMessage({id: `old-${i}`, conversationId: 'chat', role: 'user', content: 'Older message'});
    storage.createRun({id: 'failed', conversationId: 'chat'});
    storage.updateRun('failed', {status: 'failed', error: {message: 'Provider unavailable'}});
    storage.appendMessage({id: 'prompt', conversationId: 'chat', runId: 'failed', role: 'user', content: 'Check sources\nMore context'});
    storage.appendMessage({id: 'answer', conversationId: 'chat', runId: 'failed', role: 'assistant', content: [{type: 'text', text: 'Partial result'}]});
    storage.createRun({id: 'cancelled', conversationId: 'chat', parentRunId: 'failed'});
    storage.updateRun('cancelled', {status: 'cancelled'});
    const rows = taskOverview(storage);
    assert.equal(rows.find(r => r.id === 'failed')?.title, 'Check sources');
    assert.equal(rows.find(r => r.id === 'failed')?.result, 'Partial result');
    assert.equal(rows.find(r => r.id === 'failed')?.error, 'Provider unavailable');
    assert.equal(rows.find(r => r.id === 'failed')?.status, 'failed');
    assert.equal(rows.find(r => r.id === 'cancelled')?.status, 'cancelled');
    assert.equal(rows.find(r => r.id === 'cancelled')?.parentRunId, 'failed');
  } finally {storage.close();}
});

test('active runs survive the history limit and queued work has no duplicate linked run', () => {
  let tick = 0;
  const storage = new SqliteStorage(':memory:', {clock: () => new Date(1_700_000_000_000 + tick++ * 1000).toISOString()});
  try {
    storage.createConversation({id: 'chat', title: 'Research'});
    storage.createRun({id: 'active', conversationId: 'chat'});
    storage.updateRun('active', {status: 'running'});
    for (let i = 0; i < 210; i++) {
      storage.createRun({id: `done-${i}`, conversationId: 'chat'});
      storage.updateRun(`done-${i}`, {status: 'completed'});
    }
    const pool = new ChatPool(storage);
    pool.enqueue({id: 'queued', chatId: 'chat', text: 'Next task'});
    pool.enqueue({id: 'linked', chatId: 'chat', text: 'Working task', priority: 'urgent'});
    pool.claimNext('active', 'chat');
    const rows = taskOverview(storage, pool.list());
    assert.equal(rows.filter(r => r.runId === 'active').length, 1);
    assert.equal(rows.find(r => r.id === 'active')?.jobId, 'linked');
    assert.equal(rows.find(r => r.id === 'job:queued')?.status, 'queued');
    assert.equal(rows.length, 202);
  } finally {storage.close();}
});
