import assert from 'node:assert/strict';
import test from 'node:test';
import type {ChatMemberDto, ChatMessageDto} from '@polymux/protocol';
import {
  activeComposerToken,
  memberHandle,
  mentionSuggestions,
  mentionsInDraft,
  replaceComposerToken,
  telegramCommandSuggestions,
} from './composerAutocomplete';

const members: ChatMemberDto[] = [
  {userId: '@telegram_pranav:local', name: 'Pranav Kumar', avatarUrl: null},
  {userId: '@telegram_amelie:local', name: 'Amélie', avatarUrl: null},
  {userId: '@wechat_reader:local', name: '我爱读书', avatarUrl: null},
];

test('finds the mention touching the caret', () => {
  assert.deepEqual(activeComposerToken('hello @pr', 9, 'whatsapp'), {
    kind: 'mention', start: 6, end: 9, query: 'pr',
  });
  assert.equal(activeComposerToken('email foo@pr', 12, 'whatsapp'), null);
});

test('offers command completion only in Telegram chats', () => {
  assert.deepEqual(activeComposerToken('/he', 3, 'telegram'), {
    kind: 'command', start: 0, end: 3, query: 'he',
  });
  assert.equal(activeComposerToken('/he', 3, 'wechat'), null);
});

test('replaces only the active token and keeps the caret after it', () => {
  const token = activeComposerToken('Ask @pr tomorrow', 7, 'telegram');
  assert(token);
  assert.deepEqual(replaceComposerToken('Ask @pr tomorrow', token, '@pranav_kumar'), {
    text: 'Ask @pranav_kumar tomorrow',
    caret: 17,
  });
});

test('uses readable handles while retaining the real mention identities', () => {
  assert.equal(memberHandle(members[1]), '@amelie');
  assert.equal(memberHandle(members[2]), '@我爱读书');
  const suggestions = mentionSuggestions(activeComposerToken('@p', 2, 'telegram'), members, true);
  assert.equal(suggestions[0]?.value, '@pranav_kumar');
  assert.deepEqual(mentionsInDraft('Hi @pranav_kumar and @everyone', members, true), {
    users: [{userId: '@telegram_pranav:local', label: '@pranav_kumar'}],
    everyone: true,
  });
  assert.equal(mentionsInDraft('Hi @pranav_kumarish', members, true), undefined);
});

test('discovers bot commands from history and fills common Telegram commands', () => {
  const messages = [{
    id: '$command',
    chatId: '!bot:local',
    sender: '@telegram_weatherbot:local',
    body: '/weather — Current forecast',
    sentAt: new Date(0).toISOString(),
    mine: false,
  }] satisfies ChatMessageDto[];
  const all = telegramCommandSuggestions(activeComposerToken('/', 1, 'telegram'), messages);
  assert.deepEqual(all[0], {
    id: 'command:/weather',
    kind: 'command',
    label: '/weather',
    value: '/weather',
    detail: 'Current forecast',
    avatarUrl: null,
    userId: null,
  });
  assert(all.some((suggestion) => suggestion.value === '/start'));
  assert.deepEqual(
    telegramCommandSuggestions(activeComposerToken('/we', 3, 'telegram'), messages).map((item) => item.value),
    ['/weather'],
  );
});
