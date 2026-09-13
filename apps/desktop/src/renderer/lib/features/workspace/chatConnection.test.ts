import assert from 'node:assert/strict';
import test from 'node:test';
import type {ChatDto, CommsBridgeDto} from '@polymux/protocol';
import {
  filterConnectedChats,
  isChatConnected,
  isPlatformConnected,
  type ChatConnectionStatus,
} from './chatConnection';

function chat(id: string, platform: string): ChatDto {
  return {id, name: id, platform};
}

function status(
  ...bridges: Array<[CommsBridgeDto['platform'], CommsBridgeDto['state']]>
): ChatConnectionStatus {
  return {bridges: bridges.map(([platform, state]) => ({platform, state}))};
}

test('only chats backed by a currently connected platform are visible', () => {
  const current = status(['whatsapp', 'connected'], ['wechat', 'connecting']);
  assert.deepEqual(
    filterConnectedChats([chat('WhatsApp', 'whatsapp'), chat('WeChat', 'wechat')], current)
      .map((item) => item.id),
    ['WhatsApp'],
  );
});

test('every non-connected bridge state hides its cached chats', () => {
  const offlineStates: CommsBridgeDto['state'][] = [
    'unknown',
    'unavailable',
    'unreachable',
    'dormant',
    'logged-out',
    'connecting',
    'error',
  ];
  for (const state of offlineStates) {
    const current = status(['wechat', state]);
    assert.equal(isPlatformConnected('wechat', current), false, state);
    assert.equal(isChatConnected(chat('WeChat', 'wechat'), current), false, state);
  }
});

test('missing live status fails closed instead of exposing cached chats', () => {
  assert.deepEqual(filterConnectedChats([chat('Cached', 'wechat')], null), []);
});
