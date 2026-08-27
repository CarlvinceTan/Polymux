import assert from 'node:assert/strict';
import test from 'node:test';
import type {ChatDto} from '@polymux/protocol';
import {chatsInSpace, spaceRootChats} from './chatSpaces';

const chat = (value: Partial<ChatDto> & Pick<ChatDto, 'id' | 'name'>): ChatDto => ({
  platform: 'whatsapp',
  group: true,
  ...value,
});

test('Space children are represented once behind an activity-aware stack', () => {
  const rows = spaceRootChats([
    chat({id: '!space', name: 'NUS exchange', space: true}),
    chat({
      id: '!social',
      name: 'Social',
      parentIds: ['!space'],
      lastActivity: '2026-08-27T12:00:00.000Z',
      unread: 2,
      unreadByAccount: {wa: 2},
    }),
    chat({
      id: '!running',
      name: 'Running',
      parentIds: ['!space'],
      lastActivity: '2026-08-26T12:00:00.000Z',
      unread: 1,
      accountIds: ['wa'],
    }),
    chat({id: '!family', name: 'Family', lastActivity: '2026-08-25T12:00:00.000Z'}),
  ]);

  assert.deepEqual(rows.map((row) => row.id), ['!space', '!family']);
  assert.equal(rows[0]?.preview, 'Social, Running');
  assert.equal(rows[0]?.unread, 3);
  assert.deepEqual(rows[0]?.unreadByAccount, {wa: 3});
  assert.equal(rows[0]?.lastActivity, '2026-08-27T12:00:00.000Z');
});

test('searching for a child retains its Space and a focused Space lists only its chats', () => {
  const chats = [
    chat({id: '!space', name: 'NUS exchange', space: true}),
    chat({id: '!soc', name: 'School of Computing', parentIds: ['!space']}),
    chat({id: '!run', name: 'Running', parentIds: ['!space']}),
    chat({id: '!family', name: 'Family'}),
  ];

  assert.deepEqual(spaceRootChats(chats, 'school').map((row) => row.id), ['!space']);
  assert.deepEqual(chatsInSpace(chats, '!space', 'run').map((row) => row.id), ['!run']);
});

test('a child stays at the root when its parent Space is unavailable', () => {
  const rows = spaceRootChats([
    chat({id: '!orphan', name: 'Linked group', parentIds: ['!missing']}),
  ]);
  assert.deepEqual(rows.map((row) => row.id), ['!orphan']);
});

test('an account-wide default Space is transparent on every platform', () => {
  for (const platform of ['whatsapp', 'telegram', 'instagram']) {
    const rows = spaceRootChats([
      chat({id: `!default-${platform}`, name: `${platform} (account)`, platform, space: true, defaultSpace: true}),
      chat({
        id: `!direct-${platform}`,
        name: 'Direct chat',
        platform,
        parentIds: [`!default-${platform}`],
      }),
      chat({
        id: `!community-${platform}`,
        name: 'Real community',
        platform,
        space: true,
        parentIds: [`!default-${platform}`],
      }),
      chat({
        id: `!group-${platform}`,
        name: 'Community group',
        platform,
        parentIds: [`!default-${platform}`, `!community-${platform}`],
      }),
    ]);

    assert.deepEqual(
      rows.map((row) => row.id).sort(),
      [`!community-${platform}`, `!direct-${platform}`].sort(),
    );
  }
});
