import assert from 'node:assert/strict';
import test from 'node:test';
import type {ChatDto} from '@polymux/protocol';
import {dedupeContactChats, dedupePortalChats} from './chatContacts';

function chat(id: string, options: Partial<ChatDto> = {}): ChatDto {
  return {
    id,
    name: '·W·',
    platform: 'wechat',
    group: false,
    ...options,
  };
}

test('duplicate Matrix portals become one contact and keep the current writable room', () => {
  const rows = dedupeContactChats([
    chat('!old:local', {
      remoteId: '8f53f833f8a8e7a08946b1ec',
      lastActivity: '2026-08-28T01:36:00+08:00',
    }),
    chat('!current:local', {
      remoteId: '8F53F833F8A8E7A08946B1EC',
      currentPortal: true,
      lastActivity: '2026-08-27T01:36:00+08:00',
    }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['!current:local'],
  );
});

test('the same display name without a shared remote identity stays distinct', () => {
  const rows = dedupeContactChats([
    chat('!one:local', {remoteId: 'person-one'}),
    chat('!two:local', {remoteId: 'person-two'}),
  ]);
  assert.equal(rows.length, 2);
});

test('remote identities are scoped to their platform', () => {
  const rows = dedupeContactChats([
    chat('!wechat:local', {remoteId: 'person'}),
    chat('!whatsapp:local', {platform: 'whatsapp', remoteId: 'person'}),
  ]);
  assert.equal(rows.length, 2);
});

test('legacy rooms without a remote identity never merge by name alone', () => {
  const rows = dedupeContactChats([chat('!one:local'), chat('!two:local')]);
  assert.equal(rows.length, 2);
});

test('duplicate group portals collapse in the conversation rail', () => {
  const rows = dedupePortalChats([
    chat('!old:local', {
      group: true,
      remoteId: 'group-one',
      lastActivity: '2026-08-29T01:00:00+08:00',
      preview: 'newest history',
      unread: 2,
    }),
    chat('!current:local', {
      group: true,
      remoteId: 'GROUP-ONE',
      currentPortal: true,
      lastActivity: '2026-08-28T01:00:00+08:00',
      preview: 'older current-room history',
      unread: 0,
    }),
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    ...chat('!current:local', {
      group: true,
      remoteId: 'GROUP-ONE',
      currentPortal: true,
      lastActivity: '2026-08-29T01:00:00+08:00',
      preview: 'newest history',
      unread: 2,
    }),
  });
});

test('spaces and unattested rooms are never collapsed', () => {
  const rows = dedupePortalChats([
    chat('!space-one:local', {space: true, remoteId: 'shared'}),
    chat('!space-two:local', {space: true, remoteId: 'shared'}),
    chat('!legacy-one:local'),
    chat('!legacy-two:local'),
  ]);
  assert.equal(rows.length, 4);
});
