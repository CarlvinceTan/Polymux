import assert from 'node:assert/strict';
import test from 'node:test';
import type {ChatDto, ContactLinkDto} from '@polymux/protocol';
import {contactIdentityRows, memberForChat} from './contactLinks';

function chat(id: string, platform: 'whatsapp' | 'telegram', options: Partial<ChatDto> = {}): ChatDto {
  return {id, name: 'Pranav', platform, remoteId: id, group: false, ...options};
}

function link(chats: ChatDto[]): ContactLinkDto {
  return {
    id: 'contact-pranav',
    name: 'Pranav',
    members: chats.map(memberForChat),
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  };
}

test('explicit links make one contact row with each platform retained', () => {
  const whatsapp = chat('wa-1', 'whatsapp');
  const telegram = chat('tg-1', 'telegram', {official: true, lastActivity: '2026-08-28T01:00:00Z'});
  const rows = contactIdentityRows([whatsapp, telegram], [link([whatsapp, telegram])]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.platforms, ['telegram', 'whatsapp']);
  assert.equal(rows[0]?.primary.id, 'tg-1');
  assert.equal(rows[0]?.official, true);
});

test('same names stay separate without an explicit link', () => {
  const rows = contactIdentityRows([
    chat('wa-1', 'whatsapp'),
    chat('tg-1', 'telegram'),
  ], []);
  assert.equal(rows.length, 2);
});

test('a remote identity keeps a link attached after its Matrix portal changes', () => {
  const oldTelegram = chat('tg-old', 'telegram', {remoteId: 'remote-42'});
  const whatsapp = chat('wa-1', 'whatsapp');
  const currentTelegram = chat('tg-current', 'telegram', {remoteId: 'remote-42'});
  const rows = contactIdentityRows([whatsapp, currentTelegram], [link([whatsapp, oldTelegram])]);
  assert.deepEqual(rows[0]?.chats.map((item) => item.id), ['wa-1', 'tg-current']);
});
