import assert from 'node:assert/strict';
import test from 'node:test';
import type {BotDto} from '@polymux/protocol';
import {teamGroupMembers, teamGroupName} from './groupName';

const bot = (id: string, name: string): BotDto => ({
  id,
  conversationId: `conversation-${id}`,
  name,
  role: '',
  profileId: 'default',
  profileName: 'Default Profile',
  hostId: 'host',
  hostName: 'This Mac',
  avatar: {shape: 'circle', color: '#0a0a0c'},
  laptopAccess: 'allow',
  deviceAccess: {},
  status: 'idle',
  preview: '',
  updatedAt: '2026-01-01T00:00:00.000Z',
  unread: false,
  computer: {provider: 'docker', state: 'stopped', detail: null, persistent: true, network: 'none'},
});

test('a group without a name of its own reads as its members', () => {
  const bots = [bot('maya', 'Maya'), bot('linus', 'Linus'), bot('sol', 'Sol')];
  assert.equal(teamGroupName({name: '', memberIds: ['maya', 'sol']}, bots), 'Maya, Sol');
  assert.equal(teamGroupName({name: '   ', memberIds: ['linus']}, bots), 'Linus');
});

test('a renamed group keeps its own name', () => {
  const bots = [bot('maya', 'Maya')];
  assert.equal(teamGroupName({name: 'Launch room', memberIds: ['maya']}, bots), 'Launch room');
});

test('members follow the group order and skip ones that no longer exist', () => {
  const bots = [bot('maya', 'Maya'), bot('sol', 'Sol')];
  assert.deepEqual(teamGroupMembers({memberIds: ['sol', 'gone', 'maya']}, bots).map((member) => member.name), ['Sol', 'Maya']);
  assert.equal(teamGroupName({name: '', memberIds: ['gone']}, bots), '');
});
