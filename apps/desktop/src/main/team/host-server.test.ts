import assert from "node:assert/strict";
import {once} from "node:events";
import {connect} from "node:net";
import test from "node:test";
import {SqliteStorage} from "@polymux/storage/sqlite";
import {HOST_PAIRING_CODE} from "@polymux/protocol";
import {personalHostListenAddress, TeamHostClient, TeamHostServer} from "./host-server.js";

test('account management requires the local admin secret and is never exposed through peer RPC', async () => {
  const storage = new SqliteStorage(':memory:');
  const calls: string[] = [];
  const server = new TeamHostServer({storage, adminSecret: 'admin-secret', call: async method => {calls.push(method); return {signedIn: false}; }});
  try {
    const state = await server.start();
    server.authorizePeer('peer', 'Peer', 'peer-secret');
    const request = (secret: string) => fetch(`${state.localEndpoint}/polymux-host/v1/admin/account`, {method: 'POST', headers: {authorization: `Bearer ${secret}`, 'content-type': 'application/json'}, body: JSON.stringify({action: 'status'})});
    assert.equal((await request('peer-secret')).status, 401);
    assert.equal((await request('')).status, 401);
    assert.equal((await request('admin-secret')).status, 200);
    await assert.rejects(new TeamHostClient(state.localEndpoint!, 'peer-secret').call('account.request', [{action: 'logout'}]), /not available/);
    assert.deepEqual(calls, ['account.request']);
  } finally { await server.close(); storage.close(); }
});

test("Device pairing requires approval and RPC requires its bearer secret", async () => {
  const storage = new SqliteStorage(":memory:");
  const server = new TeamHostServer({
    storage,
    call: async (method) => method === "team.list"
      ? [{id: "maya"}]
      : method === "team.profiles"
        ? [{id: "default", name: "Default Profile"}]
        : method === "conversations.list"
          ? [{id: "assistant-main", title: "Assistant"}]
          : null,
  });
  try {
    await server.start();
    const snapshot = server.beginPairing();
    assert.equal(snapshot.state, "listening");
    assert.ok(snapshot.endpoint);
    assert.match(snapshot.pairingCode ?? "", HOST_PAIRING_CODE);
    assert.match(snapshot.pairingCode ?? "", /[A-Z]/);
    assert.match(snapshot.pairingCode ?? "", /\d/);
    assert.ok(Date.parse(snapshot.pairingExpiresAt ?? "") > Date.now());

    const first = await approvedPair(server, `${snapshot.endpoint}/polymux-host/v1/pair`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({code: snapshot.pairingCode, desktopId: "desktop-a", deviceName: "Laptop"}),
    });
    assert.equal(first.status, 200);
    const credentials = await first.json() as {secret: string};
    const client = new TeamHostClient(snapshot.endpoint!, credentials.secret);
    assert.deepEqual(await client.call("team.list"), [{id: "maya"}]);
    assert.deepEqual(await client.call("team.profiles"), [{id: "default", name: "Default Profile"}]);
    assert.deepEqual(await client.call("conversations.list"), [{id: "assistant-main", title: "Assistant"}]);
    await assert.rejects(client.call("profiles.list"), /not available/i);

    const health = await fetch(`${snapshot.endpoint}/polymux-host/v1/health`, {
      headers: {origin: "http://localhost:1420"},
    });
    assert.equal(health.headers.get("access-control-allow-origin"), "http://localhost:1420");
    assert.deepEqual((await health.json() as {capabilities: string[]}).capabilities, [
      "assistant", "team", "hub", "runs", "uploads", "vault",
    ]);

    const rejected = await fetch(`${snapshot.endpoint}/polymux-host/v1/pair`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({code: "000000", desktopId: "desktop-b", deviceName: "Other"}),
    });
    assert.equal(rejected.status, 403);
    assert.equal(server.snapshot().pairedDesktopName, "Laptop");
  } finally {
    await server.close();
    storage.close();
  }
});

test("Host RPC allows vault vault methods", async () => {
  const storage = new SqliteStorage(":memory:");
  const methods: string[] = [];
  const server = new TeamHostServer({
    storage,
    call: async (method) => {
      methods.push(method);
      if (method === "vault.status")
        return {exists: true, unlocked: false, itemCount: 0, idleLockSeconds: 300};
      if (method === "vault.export")
        return {bytes: "ZmFrZQ==", meta: {storage: "account"}};
      return null;
    },
  });
  try {
    const snapshot = await server.start();
    server.authorizePeer("mobile", "Mobile", "mobile-secret", "mobile");
    const client = new TeamHostClient(snapshot.endpoint!, "mobile-secret");
    assert.equal((await client.call("vault.status") as {exists: boolean}).exists, true);
    assert.equal((await client.call("vault.export") as {bytes: string}).bytes, "ZmFrZQ==");
    assert.deepEqual(methods, ["vault.status", "vault.export"]);
  } finally {
    await server.close();
    storage.close();
  }
});

test("Host keeps its private listener on loopback", () => {
  assert.equal(personalHostListenAddress(), "127.0.0.1");
});

test("Host pairing stays closed until the user opens a bounded session", async () => {
  const storage = new SqliteStorage(":memory:");
  const server = new TeamHostServer({storage, call: async () => null, pairingSessionMs: 20});
  try {
    const snapshot = await server.start();
    assert.equal(snapshot.pairingCode, null);
    assert.match(server.beginPairing().pairingCode ?? "", HOST_PAIRING_CODE);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(server.snapshot().pairingCode, null);
  } finally {
    await server.close();
    storage.close();
  }
});

test("Host CLI token can administer RPC and open pairing without becoming the Desktop", async () => {
  const storage = new SqliteStorage(":memory:");
  const server = new TeamHostServer({
    storage,
    adminSecret: "local-cli-secret",
    call: async (method) => method === "team.list" ? [{id: "maya"}] : null,
  });
  try {
    const snapshot = await server.start();
    const client = new TeamHostClient(snapshot.endpoint!, "local-cli-secret");
    assert.deepEqual(await client.call("team.list"), [{id: "maya"}]);
    assert.match((await client.beginPairing()).pairingCode ?? "", HOST_PAIRING_CODE);
    assert.equal(server.paired(), false);
  } finally {
    await server.close();
    storage.close();
  }
});

test("Host pairing locks after repeated guesses", async () => {
  const storage = new SqliteStorage(":memory:");
  const server = new TeamHostServer({storage, call: async () => null, pairingLockoutMs: 60_000});
  try {
    await server.start();
    let snapshot = server.beginPairing();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt === 4) snapshot = server.beginPairing(true);
      const invalidCode = snapshot.pairingCode === "000000000" ? "000000001" : "000000000";
      const response = await fetch(`${snapshot.endpoint}/polymux-host/v1/pair`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({code: invalidCode, desktopId: `desktop-${attempt}`, deviceName: "Laptop"}),
      });
      assert.equal(response.status, attempt === 4 ? 429 : 401);
    }
    assert.equal(server.snapshot().pairingCode, null);
  } finally {
    await server.close();
    storage.close();
  }
});

test("Host brokers a device action to the paired Desktop", async () => {
  const storage = new SqliteStorage(":memory:");
  const server = new TeamHostServer({storage, call: async () => null});
  try {
    await server.start();
    const snapshot = server.beginPairing();
    const paired = await approvedPair(server, `${snapshot.endpoint}/polymux-host/v1/pair`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({code: snapshot.pairingCode, desktopId: "desktop-a", deviceName: "Laptop"}),
    });
    const {secret} = await paired.json() as {secret: string};
    const client = new TeamHostClient(snapshot.endpoint!, secret);
    const pending = server.requestDevice({
      memberId: "maya", memberName: "Maya", capability: "browser", tool: "browser",
      input: {action: "tabs"}, requiresApproval: true,
    });
    const request = await client.nextDeviceRequest();
    assert.equal(request?.memberName, "Maya");
    assert.equal(request?.requiresApproval, true);
    await client.resolveDeviceRequest(request!.id, true, {content: "two tabs"}, true);
    assert.deepEqual(await pending, {hostId: "desktop-a", approved: true, result: {content: "two tabs"}});
  } finally {
    await server.close();
    storage.close();
  }
});

test("A timed-out device request is removed from the Desktop queue", async () => {
  const storage = new SqliteStorage(":memory:");
  const server = new TeamHostServer({storage, call: async () => null, deviceRequestTimeoutMs: 20, devicePollWaitMs: 10});
  try {
    await server.start();
    const snapshot = server.beginPairing();
    const paired = await approvedPair(server, `${snapshot.endpoint}/polymux-host/v1/pair`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({code: snapshot.pairingCode, desktopId: "desktop-a", deviceName: "Laptop"}),
    });
    const {secret} = await paired.json() as {secret: string};
    const client = new TeamHostClient(snapshot.endpoint!, secret);
    const pending = server.requestDevice({
      memberId: "maya", memberName: "Maya", capability: "browser", tool: "browser",
      input: {action: "tabs"}, requiresApproval: true,
    });
    await assert.rejects(pending, /in time/i);
    assert.equal(await client.nextDeviceRequest(), null);
  } finally {
    await server.close();
    storage.close();
  }
});

test("Host shutdown closes an incomplete client request", async () => {
  const storage = new SqliteStorage(":memory:");
  const server = new TeamHostServer({storage, call: async () => null, host: "127.0.0.1"});
  let socket: ReturnType<typeof connect> | undefined;
  try {
    const snapshot = await server.start();
    const endpoint = new URL(snapshot.endpoint!);
    socket = connect(Number(endpoint.port), endpoint.hostname);
    await once(socket, "connect");
    socket.write(
      "POST /polymux-host/v1/pair HTTP/1.1\r\n" +
      `Host: ${endpoint.host}\r\n` +
      "Content-Type: application/json\r\n" +
      "Content-Length: 100\r\n\r\n{",
    );
    await Promise.race([
      server.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Host close timed out")), 500)),
    ]);
  } finally {
    socket?.destroy();
    await server.close();
    storage.close();
  }
});

async function approvedPair(server: TeamHostServer, url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  assert.equal(response.status, 202);
  const challenge = await response.json() as {id: string; token: string; number: string};
  await assert.rejects(new TeamHostClient(server.snapshot().endpoint!, challenge.token).call('team.list'), /authorised/);
  await server.approvePairing(challenge.id, challenge.number);
  const result = await fetch(`${server.snapshot().endpoint}/polymux-host/v1/pair/status`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(challenge)});
  const value = await result.json() as {credentials: object};
  return Response.json(value.credentials);
}

test('cancelling an approved but unacknowledged request revokes only that request’s grant', async () => {
  const storage = new SqliteStorage(':memory:');
  const server = new TeamHostServer({storage, call: async () => []});
  try {
    await server.start();
    for (const replaced of [false, true]) {
      const snapshot = server.beginPairing();
      const response = await fetch(`${snapshot.endpoint}/polymux-host/v1/pair`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({code: snapshot.pairingCode, desktopId: 'cancel-device', deviceName: 'Cancel test'})});
      const pending = await response.json() as {id: string; token: string; number: string};
      assert.equal(response.status, 202);
      await server.approvePairing(pending.id, pending.number);
      const credential = server.pairing.poll(pending.id, pending.token).credentials!.secret!;
      if (replaced) server.authorizePeer('cancel-device', 'Reconnected device', 'newer-grant');
      await fetch(`${snapshot.endpoint}/polymux-host/v1/pair/cancel`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: pending.id, token: pending.token})});
      await assert.rejects(new TeamHostClient(snapshot.endpoint!, credential).call('team.list'));
      if (replaced) assert.deepEqual(await new TeamHostClient(snapshot.endpoint!, 'newer-grant').call('team.list'), []);
    }
  } finally { await server.close(); storage.close(); }
});

test('multiple connected devices cannot inherit each other’s control approval or answer each other’s request', async () => {
  const storage = new SqliteStorage(':memory:');
  const server = new TeamHostServer({storage, call: async () => null});
  try {
    const snapshot = await server.start();
    server.authorizePeer('a', 'A', 'secret-a'); server.authorizePeer('b', 'B', 'secret-b');
    const a = new TeamHostClient(snapshot.endpoint!, 'secret-a'); const b = new TeamHostClient(snapshot.endpoint!, 'secret-b');
    const pending = server.requestDevice({memberId: 'bot', memberName: 'Bot', capability: 'browser', tool: 'browser_tabs', input: {}, requiresApproval: false});
    const request = await a.nextDeviceRequest(); assert.ok(request); assert.equal(request.requiresApproval, true);
    await assert.rejects(b.resolveDeviceRequest(request.id, true, {content: 'wrong device'}), /another device/);
    await a.resolveDeviceRequest(request.id, false, {content: 'declined'});
    assert.equal((await pending)?.approved, false);
  } finally { await server.close(); storage.close(); }
});

test('device metadata and online status follow authenticated activity', async t => {
  t.mock.timers.enable({apis: ['Date'], now: 100000});
  const storage = new SqliteStorage(':memory:');
  const server = new TeamHostServer({storage, deviceType: 'server', call: async () => []});
  try {
    const snapshot = await server.start();
    server.authorizePeer('tablet', 'Tablet', 'tablet-secret', 'tablet');
    assert.equal(server.snapshot().connectedDevices[0]?.deviceType, 'tablet');
    assert.equal(server.snapshot().connectedDevices[0]?.online, true);
    t.mock.timers.tick(61000);
    assert.equal(server.snapshot().connectedDevices[0]?.online, false);
    assert.deepEqual(await new TeamHostClient(snapshot.endpoint!, 'tablet-secret').call('devices.info'), {deviceType: 'server'});
    assert.equal(server.snapshot().connectedDevices[0]?.online, true);
  } finally { await server.close(); storage.close(); }
});

test('mobile notification subscriptions are scoped to authenticated peers and removed on revocation', async () => {
  const names = ['POLYMUX_APNS_KEY_PATH', 'POLYMUX_APNS_KEY_ID', 'POLYMUX_APNS_TEAM_ID'] as const;
  const previous = names.map(name => process.env[name]);
  names.forEach(name => process.env[name] = 'test-only');
  const storage = new SqliteStorage(':memory:');
  const server = new TeamHostServer({storage, adminSecret: 'admin', call: async () => null});
  try {
    const state = await server.start();
    server.authorizePeer('mobile-a', 'Mobile A', 'secret-a', 'mobile');
    server.authorizePeer('mobile-b', 'Mobile B', 'secret-b', 'mobile');
    const a = new TeamHostClient(state.endpoint!, 'secret-a');
    const b = new TeamHostClient(state.endpoint!, 'secret-b');
    await assert.rejects(new TeamHostClient(state.endpoint!, 'invalid').call('notifications.register', [{token: 'a'.repeat(64), environment: 'sandbox'}]), /authorised/);
    await assert.rejects(new TeamHostClient(state.endpoint!, 'admin').call('notifications.register', [{token: 'a'.repeat(64), environment: 'sandbox'}]), /Pair this phone/);
    await assert.rejects(a.call('notifications.register', [{token: 'invalid', environment: 'sandbox'}]), /not configured/);
    assert.deepEqual(await a.call('notifications.register', [{token: 'a'.repeat(64), environment: 'sandbox'}]), {enabled: true});
    assert.deepEqual(await a.call('notifications.status'), {available: true, enabled: true});
    assert.deepEqual(await b.call('notifications.status'), {available: true, enabled: false});
    await b.call('notifications.unregister');
    assert.deepEqual(await a.call('notifications.status'), {available: true, enabled: true});
    await a.call('notifications.unregister');
    assert.deepEqual(await a.call('notifications.status'), {available: true, enabled: false});
    server.revokePeer('mobile-a');
    await assert.rejects(a.call('notifications.status'), /authorised/);
  } finally {
    await server.close(); storage.close();
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  }
});


test("actual destination policy controls delivery and automatic access with several paired devices", async () => {
  const storage = new SqliteStorage(":memory:");
  const server = new TeamHostServer({storage, call: async () => null, devicePollWaitMs: 100});
  try {
    const snapshot = await server.start();
    server.authorizePeer("device-a", "A", "secret-a");
    server.authorizePeer("device-b", "B", "secret-b");
    const a = new TeamHostClient(snapshot.endpoint!, "secret-a");
    const b = new TeamHostClient(snapshot.endpoint!, "secret-b");
    const input = {memberId: "bot", memberName: "Bot", capability: "files" as const, tool: "read_file", input: {}, requiresApproval: true};
    const policy = (hostId: string) => ({allowed: hostId === "device-b", requiresApproval: false});
    const pending = server.requestDevice(input, {accessForDevice: policy});
    assert.equal(await a.nextDeviceRequest(), null);
    const request = await b.nextDeviceRequest();
    assert.ok(request);
    assert.equal(request.requiresApproval, false);
    await assert.rejects(a.resolveDeviceRequest(request.id, true, {content: "wrong"}), /another device/);
    await b.resolveDeviceRequest(request.id, true, {content: "B"});
    assert.deepEqual(await pending, {hostId: "device-b", approved: false, result: {content: "B"}});

    // The same policy applies when a Desktop is already waiting for work.
    const pollingA = a.nextDeviceRequest();
    const pollingB = b.nextDeviceRequest();
    await new Promise((resolve) => setTimeout(resolve, 15));
    const queued = server.requestDevice(input, {accessForDevice: policy});
    assert.equal(await pollingA, null);
    const next = await pollingB;
    assert.ok(next);
    assert.equal(next.requiresApproval, false);
    await b.resolveDeviceRequest(next.id, true, {content: "B again"});
    assert.equal((await queued)?.hostId, "device-b");
    assert.equal(await server.requestDevice(input, {accessForDevice: () => ({allowed: false, requiresApproval: false})}), null);
  } finally { await server.close(); storage.close(); }
});


test("a delivered request rechecks tightened access and never treats automatic success as user approval", async () => {
  const storage = new SqliteStorage(":memory:");
  const server = new TeamHostServer({storage, call: async () => null});
  try {
    const snapshot = await server.start();
    server.authorizePeer("device-a", "A", "secret-a");
    server.authorizePeer("device-b", "B", "secret-b");
    const a = new TeamHostClient(snapshot.endpoint!, "secret-a");
    const b = new TeamHostClient(snapshot.endpoint!, "secret-b");
    const input = {memberId: "bot", memberName: "Bot", capability: "files" as const, tool: "write_file", input: {}, requiresApproval: false};
    let policy = {allowed: true, requiresApproval: false};
    const pending = server.requestDevice(input, {accessForDevice: () => policy});
    const request = (await a.nextDeviceRequest())!;
    assert.equal(request.requiresApproval, false);
    await assert.rejects(b.deviceRequestAccess(request.id), /another device/);
    policy = {allowed: true, requiresApproval: true};
    assert.deepEqual(await a.deviceRequestAccess(request.id), policy);
    await a.resolveDeviceRequest(request.id, true, {content: "automatic response"});
    const denied = await pending;
    assert.equal(denied?.approved, false);
    assert.equal(denied?.result.isError, true);

    const asking = server.requestDevice(input, {accessForDevice: () => policy});
    const asked = (await a.nextDeviceRequest())!;
    assert.equal(asked.requiresApproval, true);
    policy = {allowed: false, requiresApproval: false};
    assert.deepEqual(await a.deviceRequestAccess(asked.id), policy);
    await a.resolveDeviceRequest(asked.id, true, {content: "stale approval"}, true);
    const blocked = await asking;
    assert.equal(blocked?.approved, false);
    assert.equal(blocked?.result.isError, true);
    assert.match(String(blocked?.result.content), /blocked/);
  } finally { await server.close(); storage.close(); }
});
