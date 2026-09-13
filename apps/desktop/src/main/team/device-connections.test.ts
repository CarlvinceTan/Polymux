import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SqliteStorage} from '@polymux/storage/sqlite';
import {ProfileManager} from '../profiles.js';
import {TeamComputerManager} from './computers.js';
import {TeamService} from './service.js';
import {TeamHostServer, TeamHostClient} from './host-server.js';
import {DeviceConnections} from './device-connections.js';

test('two computers pair as peers only after number matching, without changing execution defaults', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'polymux-devices-'));
  const make = (name: string) => {
    const storage = new SqliteStorage(':memory:');
    const secrets = new Map<string,string>();
    const team = new TeamService({storage, profiles: new ProfileManager(storage, path.join(root, name)), computers: new TeamComputerManager(), writeHostSecret: async (id, secret) => { if (secret) secrets.set(id, secret); else secrets.delete(id); }});
    const server = new TeamHostServer({storage, call: async method => method === 'team.list' ? [name] : null, onPeerApproved: async peer => { await team.savePeerConnection(peer.endpoint!, {hostId: peer.hostId, deviceName: peer.deviceName, secret: peer.secret}); }});
    team.setLocalHostInfo(() => server.snapshot());
    return {storage, secrets, team, server, connections: new DeviceConnections(server, team)};
  };
  const a = make('a'); const b = make('b');
  try {
    await a.server.start(); await b.server.start();
    const invitation = b.server.beginPairing();
    const pending = await a.connections.request({action: 'start', endpoint: invitation.endpoint!, code: invitation.pairingCode!});
    assert.ok(pending.outgoing);
    assert.equal(a.team.hosts().length, 1); assert.equal(b.team.hosts().length, 1);
    await assert.rejects(new TeamHostClient(invitation.endpoint!, 'guessed').call('team.list'));
    const approval = b.server.snapshot().approvals[0]!;
    await b.connections.request({action: 'approve', id: approval.id, number: pending.outgoing!.number});
    const completed = await a.connections.request({action: 'state'});
    assert.equal(completed.connected, true);
    const aId = a.team.localHost().hostId, bId = b.team.localHost().hostId;
    assert.equal(a.team.host().hostId, aId); assert.equal(b.team.host().hostId, bId);
    assert.deepEqual(await new TeamHostClient(b.server.snapshot().endpoint!, a.secrets.get(bId)!).call('team.list'), ['b']);
    assert.deepEqual(await new TeamHostClient(a.server.snapshot().endpoint!, b.secrets.get(aId)!).call('team.list'), ['a']);
    // A copied installation invitation starts the same confirmation flow and cannot be replayed.
    const install = b.server.pairing.invitation();
    const request = {action: 'start' as const, endpoint: b.server.snapshot().endpoint!, invitation: install.token};
    const installing = await a.connections.request(request);
    assert.ok(installing.outgoing);
    await a.connections.request({action: 'cancel'});
    await assert.rejects(a.connections.request(request));
    assert.equal(b.server.snapshot().approvals.length, 0);
    const previousSecret = a.secrets.get(bId);
    const backgroundInvitation = b.server.pairing.invitation();
    const background = await a.connections.request({action: 'start', endpoint: b.server.snapshot().endpoint!, invitation: backgroundInvitation.token});
    await b.server.approvePairing(background.outgoing!.id, background.outgoing!.number);
    const deadline = Date.now() + 5000;
    while (a.secrets.get(bId) === previousSecret && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.notEqual(a.secrets.get(bId), previousSecret, 'pairing completes with the panel closed');
    // A phone can be approved without displacing the connected computer.
    const phoneCode = b.server.beginPairing();
    const response = await fetch(`${phoneCode.endpoint}/polymux-host/v1/pair`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({code: phoneCode.pairingCode, desktopId: 'phone', deviceName: 'Phone'})});
    assert.equal(response.status, 202);
    const phone = await response.json() as {id:string; token:string; number:string};
    await b.server.approvePairing(phone.id, phone.number);
    assert.equal(b.server.snapshot().connectedDevices.length, 2);
    const credentials = b.server.pairing.poll(phone.id, phone.token).credentials!;
    b.server.revokePeer('phone');
    await assert.rejects(new TeamHostClient(phoneCode.endpoint!, credentials.secret!).call('team.list'));
    assert.deepEqual(await new TeamHostClient(b.server.snapshot().endpoint!, a.secrets.get(bId)!).call('team.list'), ['b']);
  } finally { a.connections.close(); b.connections.close(); await a.server.close(); await b.server.close(); a.storage.close(); b.storage.close(); await rm(root, {recursive:true,force:true}); }
});
