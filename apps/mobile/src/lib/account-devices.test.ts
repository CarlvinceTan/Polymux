import {test} from 'node:test';
import assert from 'node:assert/strict';
import {availableAccountHosts} from './account-devices';
import {hostRelayPublicEndpoint} from '@polymux/protocol';

test('account discovery rejects foreign, stale, malformed, and redirected hosts', () => {
  const now = Date.now();
  const host = {user_id: 'owner', device_id: 'desktop', device_name: 'Mac', host_id: 'host', pairing_secret: 'a'.repeat(43), public_endpoint: hostRelayPublicEndpoint('https://connect.polymux.com', 'host'), last_heartbeat: new Date(now).toISOString()};
  assert.deepEqual(availableAccountHosts([host], 'owner', now), [host]);
  for (const changes of [
    {user_id: 'other'}, {public_endpoint: 'https://attacker.example'},
    {last_heartbeat: 'invalid'}, {last_heartbeat: new Date(now - 46_000).toISOString()},
    {last_heartbeat: new Date(now + 60_000).toISOString()}, {pairing_secret: ''}, {host_id: '../other'},
  ]) assert.deepEqual(availableAccountHosts([{...host, ...changes}], 'owner', now), []);
});
