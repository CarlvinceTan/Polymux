import assert from 'node:assert/strict';
import test from 'node:test';
import type {ChatMessageDto} from '@polymux/protocol';
import {mergeChatPage} from './chatMessagePages';

function message(id: string, reactions: ChatMessageDto['reactions'] = []): ChatMessageDto {
  return {
    id,
    chatId: '!chat:local',
    sender: '@person:local',
    body: id,
    sentAt: new Date(0).toISOString(),
    mine: false,
    reactions,
  };
}

test('a refreshed reaction replaces an existing past message without moving it', () => {
  const known = [message('$newest'), message('$middle'), message('$old')];
  const reacted = message('$old', [{
    key: '🔥',
    count: 1,
    reactors: [{id: '@reactor:local', name: 'Reactor', avatarUrl: null}],
  }]);

  const merged = mergeChatPage(known, [message('$incoming'), message('$newest'), reacted]);

  assert.deepEqual(merged.map((item) => item.id), ['$incoming', '$newest', '$middle', '$old']);
  assert.deepEqual(merged.at(-1)?.reactions, reacted.reactions);
});
