import test from 'node:test';
import assert from 'node:assert/strict';
import {compareConversationActivity, matchesConversationFilter} from './chatListFilters';

test('filters conversation rows by read state', () => {
  assert.equal(matchesConversationFilter(3, 'all'), true);
  assert.equal(matchesConversationFilter(3, 'unread'), true);
  assert.equal(matchesConversationFilter(0, 'unread'), false);
  assert.equal(matchesConversationFilter(0, 'read'), true);
  assert.equal(matchesConversationFilter(1, 'read'), false);
});

test('sorts activity in either direction and leaves empty rooms last', () => {
  const latest = '2026-08-28T02:00:00.000Z';
  const earliest = '2026-08-27T02:00:00.000Z';

  assert.ok(compareConversationActivity(latest, earliest, 'latest') < 0);
  assert.ok(compareConversationActivity(latest, earliest, 'earliest') > 0);
  assert.ok(compareConversationActivity(null, earliest, 'earliest') > 0);
  assert.ok(compareConversationActivity('not-a-date', latest, 'latest') > 0);
});
