import assert from 'node:assert/strict';
import test from 'node:test';
import {COMMS_PLATFORMS} from '@polymux/protocol';
import type {ChatDto, ChatMessageDto} from '@polymux/protocol';
import {chatSenderLabel} from './chatSenderLabel';

function chat(platform: string, options: Partial<ChatDto> = {}): ChatDto {
  return {
    id: `!${platform}:local`,
    name: 'Real Person',
    platform,
    group: false,
    ...options,
  };
}

function message(senderName?: string, options: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: '$message',
    chatId: '!chat:local',
    sender: '@bridge_opaque:local',
    senderName,
    body: 'hello',
    sentAt: new Date(0).toISOString(),
    mine: false,
    ...options,
  };
}

test('every platform uses a direct chat contact when its sender profile is generic', () => {
  for (const platform of COMMS_PLATFORMS) {
    for (const placeholder of [
      'Unknown user',
      'Unknown contact',
      `${platform.label} user`,
      `${platform.label} contact`,
    ]) {
      assert.equal(
        chatSenderLabel(message(placeholder), chat(platform.value)),
        'Real Person',
        `${platform.label}: ${placeholder}`,
      );
    }
  }
});

test('a direct chat name also covers a completely unresolved profile', () => {
  assert.equal(chatSenderLabel(message(), chat('wechat')), 'Real Person');
  assert.equal(
    chatSenderLabel(
      message('@wechat_hash:local', {sender: '@wechat_hash:local'}),
      chat('wechat'),
    ),
    'Real Person',
  );
});

test('groups retain the individual sender instead of borrowing the room title', () => {
  assert.equal(
    chatSenderLabel(message('Alice'), chat('wechat', {name: 'Badminton', group: true})),
    'Alice',
  );
  assert.equal(
    chatSenderLabel(
      message('WeChat contact'),
      chat('wechat', {name: 'Badminton', group: true}),
    ),
    'WeChat contact',
  );
});

test('self and bridge-specific WhatsApp suffixes keep their existing treatment', () => {
  assert.equal(chatSenderLabel(message('Unknown user', {mine: true}), chat('whatsapp')), 'You');
  assert.equal(chatSenderLabel(message('Jules Tan (WA) (WA)'), chat('whatsapp')), 'Jules Tan');
});
