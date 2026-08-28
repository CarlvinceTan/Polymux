import assert from 'node:assert/strict';
import test from 'node:test';
import type {ChatMessageDto} from '@polymux/protocol';
import {chatClipboardContent} from './chatClipboard.js';

const message = (patch: Partial<ChatMessageDto>): ChatMessageDto => ({
  id: 'message', chatId: 'chat', sender: 'sender', body: '', sentAt: new Date(0).toISOString(), mine: false,
  ...patch,
});

test('copies message text and link previews as text', () => {
  assert.deepEqual(chatClipboardContent(message({body: 'Read https://example.test'})), {
    kind: 'text', text: 'Read https://example.test',
  });
  assert.deepEqual(chatClipboardContent(message({linkPreview: {title: 'Example', description: null, url: 'https://example.test', source: null}})), {
    kind: 'text', text: 'https://example.test', title: 'Example',
  });
});

test('copies actual image pixels and file attachments instead of their labels', () => {
  assert.deepEqual(chatClipboardContent(message({body: 'photo.png', attachments: [{kind: 'image', url: 'polymux-media://local/photo', name: 'photo.png', mimeType: 'image/png', size: 12}]})), {
    kind: 'attachment', url: 'polymux-media://local/photo', name: 'photo.png', mimeType: 'image/png', copyAs: 'image',
  });
  assert.deepEqual(chatClipboardContent(message({body: 'Please review', attachments: [{kind: 'file', url: 'polymux-media://local/report', name: 'report.pdf', mimeType: 'application/pdf', size: 24}]})), {
    kind: 'attachment', url: 'polymux-media://local/report', name: 'report.pdf', mimeType: 'application/pdf', copyAs: 'file',
  });
});

test('falls back to an unavailable attachment name without claiming bytes exist', () => {
  assert.deepEqual(chatClipboardContent(message({attachments: [{kind: 'file', url: null, name: 'remote.pdf', mimeType: null, size: null}]})), {
    kind: 'text', text: 'remote.pdf',
  });
});
