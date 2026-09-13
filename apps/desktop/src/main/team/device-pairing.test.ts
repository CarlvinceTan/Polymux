import test from 'node:test';
import assert from 'node:assert/strict';
import {DevicePairingSessions} from './device-pairing.js';
const peer = {deviceId: 'a', deviceName: 'Laptop'};
test('confirmation is bound to a secret session; credentials are never released before local approval', async () => {
  const sessions = new DevicePairingSessions();
  const challenge = sessions.create(peer);
  assert.deepEqual(sessions.poll(challenge.id, challenge.token), {status: 'pending'});
  assert.throws(() => sessions.poll(challenge.id, 'wrong'), /invalid/);
  const choices = sessions.approvals()[0]!.choices;
  assert.equal(choices.length, 3); assert.equal(new Set(choices).size, 3); assert.ok(choices.includes(challenge.number));
  let grants = 0;
  await sessions.approve(challenge.id, challenge.number, async received => { assert.deepEqual(received, peer); grants++; return {secret: 'granted'}; });
  assert.equal(sessions.poll(challenge.id, challenge.token).credentials?.secret, 'granted');
  assert.equal(sessions.poll(challenge.id, challenge.token).credentials?.secret, 'granted');
  await assert.rejects(sessions.approve(challenge.id, challenge.number, async () => { grants++; return {}; }));
  sessions.acknowledge(challenge.id, challenge.token);
  assert.throws(() => sessions.poll(challenge.id, challenge.token), /invalid/); assert.equal(grants, 1);
});
test('a wrong number rejects the request and cannot be retried against the same challenge', async () => {
  const sessions = new DevicePairingSessions(); const challenge = sessions.create(peer);
  const grant = async () => { throw new Error('must not grant'); };
  await sessions.approve(challenge.id, 'wrong', grant);
  assert.equal(sessions.poll(challenge.id, challenge.token).status, 'rejected');
  await assert.rejects(sessions.approve(challenge.id, challenge.number, grant));
});
test('expiry, cancellation and reset revoke pending requests', async () => {
  let now = 100; const sessions = new DevicePairingSessions(20, () => now);
  const first = sessions.create(peer); now += 21;
  await assert.rejects(sessions.approve(first.id, first.number, async () => ({})));
  const second = sessions.create(peer); sessions.cancel(second.id, second.token);
  assert.throws(() => sessions.poll(second.id, second.token));
  const third = sessions.create(peer); sessions.reset(); assert.throws(() => sessions.poll(third.id, third.token));
});
test('installation invitations are high entropy, expire and are consumed once', () => {
  let now = 0; const sessions = new DevicePairingSessions(100, () => now);
  const invitation = sessions.invitation(); assert.match(invitation.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sessions.consumeInvitation('bad'), false);
  assert.equal(sessions.consumeInvitation(invitation.token), true);
  assert.equal(sessions.consumeInvitation(invitation.token), false);
  const next = sessions.invitation(); now += 300001; assert.equal(sessions.consumeInvitation(next.token), false);
});
test('request flooding cannot create unlimited approval prompts', () => {
  const sessions = new DevicePairingSessions();
  for (let i = 0; i < 5; i++) sessions.create({...peer, deviceId: String(i)});
  assert.throws(() => sessions.create({...peer, deviceId: 'six'}), /Too many/);
});

test('cancelling or resetting during approval prevents the grant from being committed', async () => {
  for (const reset of [false, true]) {
    const sessions = new DevicePairingSessions(); const challenge = sessions.create(peer);
    let release!: () => void; const waiting = new Promise<void>(resolve => release = resolve);
    let committed = false;
    const approval = sessions.approve(challenge.id, challenge.number, async (_peer, assertActive) => {
      await waiting; assertActive(); committed = true; return {secret: 'grant'};
    });
    if (reset) sessions.reset(); else sessions.cancel(challenge.id, challenge.token);
    release(); await assert.rejects(approval, /cancelled/); assert.equal(committed, false);
  }
});
