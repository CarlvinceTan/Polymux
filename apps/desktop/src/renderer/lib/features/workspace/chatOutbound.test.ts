import assert from 'node:assert/strict';
import test from 'node:test';
import type {ChatMessageDto} from '@polymux/protocol';
import {
  mergeFailedChatDraft,
  pendingChatMessage,
  pendingFileAttachment,
  removeChatMessage,
  replaceChatMessage,
  withoutUnconfirmedChatEchoes,
} from './chatOutbound';

test('a pending chat message is replaced in place once delivery is confirmed', () => {
  const pending = pendingChatMessage({id: 'pending:1', chatId: '!chat', body: 'hello'});
  const older = pendingChatMessage({id: '$older', chatId: '!chat', body: 'older'});
  const sent: ChatMessageDto = {...pending, id: '$sent'};

  assert.deepEqual(
    replaceChatMessage([pending, older], pending.id, sent).map((message) => message.id),
    ['$sent', '$older'],
  );
  assert.deepEqual(
    replaceChatMessage([sent, pending, older], pending.id, sent).map((message) => message.id),
    ['$sent', '$older'],
  );
  assert.deepEqual(removeChatMessage([pending, older], pending.id), [older]);
});

test('a failed send is restored ahead of text and files written while it was pending', () => {
  assert.deepEqual(
    mergeFailedChatDraft(
      {text: 'new thought', replyTo: '$new', files: ['/tmp/new.png']},
      {text: 'failed message', replyTo: '$old', files: ['/tmp/failed.mov']},
    ),
    {
      text: 'failed message\nnew thought',
      replyTo: '$new',
      files: ['/tmp/failed.mov', '/tmp/new.png'],
    },
  );
});

test('pending file bubbles preserve the native media shape', () => {
  assert.equal(pendingFileAttachment('/tmp/photo.png').kind, 'image');
  assert.equal(pendingFileAttachment('/tmp/clip.mov').kind, 'video');
  assert.equal(pendingFileAttachment('/tmp/note.wav').kind, 'audio');
  assert.equal(pendingFileAttachment('/tmp/archive.zip').kind, 'file');
});

test('a local Matrix echo stays hidden until native delivery settles', () => {
  const pending = pendingChatMessage({
    id: 'pending:1',
    chatId: '!chat',
    body: 'hello',
    sentAt: '2026-08-30T00:00:00.000Z',
  });
  const echo = {...pending, id: '$matrix', sentAt: '2026-08-30T00:00:01.000Z'};
  const incoming = {...pending, id: '$incoming', body: 'different', mine: false};

  assert.deepEqual(
    withoutUnconfirmedChatEchoes([pending], [echo, incoming], new Set([pending.id])),
    [incoming],
  );

  const voice = pendingChatMessage({
    id: 'pending:voice',
    chatId: '!chat',
    attachments: [{
      kind: 'audio',
      url: 'blob:test',
      name: 'Voice message',
      mimeType: 'audio/wav',
      size: 12,
    }],
    sentAt: '2026-08-30T00:00:00.000Z',
  });
  const voiceEcho = {...voice, id: '$voice', attachments: [{
    ...voice.attachments![0]!,
    name: 'voice-2026-08-30.wav',
  }]};
  assert.deepEqual(
    withoutUnconfirmedChatEchoes([voice], [voiceEcho], new Set([voice.id])),
    [],
  );
});
