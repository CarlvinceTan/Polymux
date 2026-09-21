import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseMobilePush} from './mobile-push.js';
test('APNs subscriptions only accept device tokens and known Apple environments', () => {
  assert.deepEqual(parseMobilePush({token: 'AB'.repeat(32), environment: 'sandbox'}), {token: 'ab'.repeat(32), environment: 'sandbox'});
  for (const row of [null, {}, {token: '../other', environment: 'sandbox'}, {token: 'a'.repeat(64), environment: 'https://evil.example'}]) assert.equal(parseMobilePush(row), null);
});
