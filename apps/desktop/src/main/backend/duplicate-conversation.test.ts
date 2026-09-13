import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteStorage} from '@polymux/storage';
import {duplicateConversation} from './duplicate-conversation';

test('duplicates all history and attachments independently without live runs', () => {
  const storage = new SqliteStorage(':memory:');
  try {
    storage.createConversation({id: 'source', title: 'Plan', metadata: {botId: 'member'}});
    storage.createRun({id: 'run', conversationId: 'source'});
    storage.transaction(() => {
      for (let i = 0; i < 2001; i++) storage.appendMessage({id: `m${i}`, conversationId: 'source',
        role: i % 2 ? 'assistant' : 'user', content: `Message ${i}`, runId: 'run'});
    });
    storage.addAttachment({id: 'a', messageId: 'm0', name: 'notes.txt', path: '/tmp/notes.txt', mimeType: 'text/plain', size: 10, sha256: null});
    const copy = duplicateConversation(storage, 'source');
    assert.equal(copy.title, 'Plan (1)');
    assert.deepEqual(copy.metadata, {});
    const first = storage.listMessages(copy.id, {limit: 2000});
    const last = storage.listMessages(copy.id, {afterSequence: 2000});
    assert.equal(first.length, 2000);
    assert.equal(last.length, 1);
    assert.equal(last[0].content, 'Message 2000');
    assert.ok(first.every(m => m.runId === null && !m.id.startsWith('m')));
    assert.equal(storage.listAttachments(first[0].id)[0].name, 'notes.txt');
    storage.deleteConversation('source');
    assert.equal(storage.listMessages(copy.id).length, 500);
    assert.equal(storage.listAttachments(first[0].id).length, 1);
    const count = storage.listConversations().length;
    assert.throws(() => duplicateConversation(storage, 'missing'), /not found/);
    assert.equal(storage.listConversations().length, count);
  } finally {storage.close();}
});


test('forks inclusively, keeps attachments, increments names and rejects foreign boundaries', () => {
  const storage = new SqliteStorage(':memory:');
  try {
    storage.createConversation({id: 'source', title: 'Plan'});
    storage.createConversation({id: 'other', title: 'Other'});
    for (let i = 0; i < 4; i++) storage.appendMessage({id: `m${i}`, conversationId: 'source', role: i % 2 ? 'assistant' : 'user', content: `Message ${i}`});
    storage.appendMessage({id: 'foreign', conversationId: 'other', role: 'assistant', content: 'Unrelated'});
    storage.addAttachment({id: 'a', messageId: 'm1', name: 'notes.txt', path: '/tmp/notes.txt', mimeType: 'text/plain', size: 10, sha256: null});
    const fork = duplicateConversation(storage, 'source', 'm1');
    assert.equal(fork.title, 'Plan (1)');
    const copied = storage.listMessages(fork.id);
    assert.deepEqual(copied.map(item => item.content), ['Message 0', 'Message 1']);
    assert.equal(storage.listAttachments(copied[1].id)[0].name, 'notes.txt');
    storage.updateConversation(fork.id, {archived: true});
    const full = duplicateConversation(storage, 'source');
    assert.equal(full.title, 'Plan (2)');
    assert.equal(storage.listMessages(full.id).length, 4);
    assert.equal(duplicateConversation(storage, full.id).title, 'Plan (3)');
    const count = storage.listConversations({includeArchived: true}).length;
    for (const boundary of ['foreign', 'missing']) assert.throws(() => duplicateConversation(storage, 'source', boundary), /Fork message not found/);
    assert.equal(storage.listConversations({includeArchived: true}).length, count);
    assert.equal(storage.listMessages('source').length, 4);
  } finally {storage.close();}
});
