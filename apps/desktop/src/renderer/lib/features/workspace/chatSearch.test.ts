import assert from 'node:assert/strict';
import test from 'node:test';
import type {ChatMessageDto} from '@polymux/protocol';
import {searchChatMessages} from './chatSearch';

function message(overrides: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: '$message',
    chatId: '!chat:local',
    sender: '@alice:local',
    senderName: 'Alice',
    body: 'Project update',
    sentAt: new Date(0).toISOString(),
    mine: false,
    ...overrides,
  };
}

test('searches authored messages and excludes conversation notices', () => {
  const results = searchChatMessages(
    [
      message({id: '$notice', body: 'Alice joined', notice: true}),
      message({id: '$authored', body: 'Quarterly project update'}),
    ],
    'quarterly',
    'messages',
  );

  assert.deepEqual(
    results.map((result) => result.key),
    ['$authored:message'],
  );
});

test('separates playable media from ordinary files', () => {
  const shared = message({
    attachments: [
      {
        kind: 'image',
        url: 'https://example.test/photo',
        name: 'launch.png',
        mimeType: 'image/png',
        size: 10,
      },
      {
        kind: 'file',
        url: 'https://example.test/video',
        name: 'demo.mp4',
        mimeType: 'video/mp4',
        size: 20,
      },
      {
        kind: 'file',
        url: 'https://example.test/doc',
        name: 'brief.pdf',
        mimeType: 'application/pdf',
        size: 30,
      },
    ],
  });

  assert.deepEqual(
    searchChatMessages([shared], '', 'media').map((result) => result.title),
    ['launch.png', 'demo.mp4'],
  );
  assert.deepEqual(
    searchChatMessages([shared], '', 'files').map((result) => result.title),
    ['brief.pdf'],
  );
});

test('lists body and preview links once with sentence punctuation removed', () => {
  const results = searchChatMessages(
    [
      message({
        body: 'See https://example.test/guide).',
        linkPreview: {
          title: 'Example guide',
          description: 'Reference',
          url: 'https://example.test/guide',
          source: 'Example',
        },
      }),
    ],
    '',
    'links',
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.title, 'Example guide');
  assert.equal(results[0]?.url, 'https://example.test/guide');
});

test('matches media and links by their metadata or sender', () => {
  const shared = message({
    senderName: 'Bernice',
    body: '',
    attachments: [
      {
        kind: 'file',
        url: null,
        name: 'Roadmap.pdf',
        mimeType: 'application/pdf',
        size: null,
      },
    ],
    linkPreview: {
      title: 'Design reference',
      description: null,
      url: 'https://design.example.test',
      source: null,
    },
  });

  assert.equal(searchChatMessages([shared], 'roadmap', 'files').length, 1);
  assert.equal(searchChatMessages([shared], 'bernice', 'links').length, 1);
});
