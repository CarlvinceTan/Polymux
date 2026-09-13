import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteStorage} from '@polymux/storage/sqlite';
import {updateDeviceMessage} from './device-message.js';
test('remote edits are bound to the conversation and persist content and feedback', () => {
  const storage = new SqliteStorage(':memory:');
  try {
    storage.createConversation({id: 'a', title: 'A'});
    storage.createConversation({id: 'b', title: 'B'});
    storage.appendMessage({id: 'message', conversationId: 'a', role: 'user', content: 'Before'});
    assert.throws(() => updateDeviceMessage(storage, 'message', {conversationId: 'b', content: 'Wrong chat'}));
    assert.equal(storage.getMessage('message')?.content, 'Before');
    updateDeviceMessage(storage, 'message', {conversationId: 'a', content: 'After', metadata: {feedback: 'up'}, attachments: ['/tmp/upload.txt', '/tmp/upload.txt']});
    assert.equal(storage.getMessage('message')?.content, 'After');
    assert.deepEqual(storage.getMessage('message')?.metadata, {feedback: 'up'});
    assert.equal(storage.listAttachments('message').length, 1);
  } finally { storage.close(); }
});
