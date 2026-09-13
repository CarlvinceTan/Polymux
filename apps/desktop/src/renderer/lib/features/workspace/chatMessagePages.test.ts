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

test('an older photo discovered during sync stays before newer text in the conversation', () => {
  const photo = {...message('$photo'), sentAt: '2026-09-07T16:34:06Z'};
  const gn = {...message('$gn'), sentAt: '2026-09-08T16:36:41Z'};
  const older = {...message('$older'), sentAt: '2026-09-06T16:00:00Z'};
  const merged = mergeChatPage([gn, older], [gn, photo]);
  assert.deepEqual(merged.map(item => item.id), ['$gn', '$photo', '$older']);
  assert.deepEqual(mergeChatPage(merged, [photo, gn]), merged);
});

test('refresh repairs an already misordered cached page and keeps recovered media', () => {
  const photo = {...message('$photo'), sentAt: '2026-09-07T16:34:06Z'};
  const gn = {...message('$gn'), sentAt: '2026-09-08T16:36:41Z'};
  const recovered = {...photo, body: 'recovered photo'};
  const merged = mergeChatPage([photo, gn], [gn, recovered]);
  assert.deepEqual(merged.map(item => item.id), ['$gn', '$photo']);
  assert.equal(merged[1]?.body, 'recovered photo');
});
