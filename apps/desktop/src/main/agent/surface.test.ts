import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {request as httpRequest} from "node:http";
import {LOCKER_SURFACE_PATHS} from "@polymux/protocol";
import {loadLockerCapability} from "./locker-capability.js";
import {extensionProtocolHeaders} from "@polymux/browser";
import {AgentSurfaceServer} from "./surface.js";

async function withServer(run: (server: AgentSurfaceServer, base: string, authorizedFetch: typeof fetch) => Promise<void>): Promise<void> {
  const port = 47_700 + Math.floor(Math.random() * 200);
  const directory = mkdtempSync(join(tmpdir(), "polymux-surface-"));
  const lockerCapabilityPath = join(directory, "capability");
  const token = loadLockerCapability(lockerCapabilityPath);
  const authorizedFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Origin", `chrome-extension://${"a".repeat(32)}`);
    return fetch(input, {...init, headers});
  };
  const server = new AgentSurfaceServer({port, lockerCapabilityPath});
  await server.start();
  try {
    await run(server, `http://127.0.0.1:${port}`, authorizedFetch);
  } finally {
    await server.close();
    rmSync(directory, {recursive: true, force: true});
  }
}

test("snapshot exposes leases and revisions move on changes", async () => {
  await withServer(async (server, base) => {
    const empty = await (await fetch(`${base}/v1/snapshot`)).json();
    assert.deepEqual(empty.leases, []);
    assert.equal(empty.surface.compatible, true);
    assert.equal(empty.surface.negotiatedVersion, 1);
    const lease = server.createLease({url: "https://example.com/", title: "Example"});
    const snapshot = await (await fetch(`${base}/v1/snapshot`)).json();
    assert.equal(snapshot.leases.length, 1);
    assert.equal(snapshot.leases[0].id, lease.id);
    assert.equal(snapshot.leases[0].tab.url, "https://example.com/");
    assert.ok(snapshot.revision > empty.revision);
  });
});

test("explicit extension negotiation reports the independent extension version", async () => {
  await withServer(async (_server, base) => {
    const response = await fetch(`${base}/v1/snapshot`, {
      headers: extensionProtocolHeaders("7.4.2"),
    });
    assert.equal(response.ok, true);
    const snapshot = await response.json();
    assert.equal(snapshot.surface.extensionVersion, "7.4.2");
    assert.equal(snapshot.surface.negotiatedVersion, 1);
    assert.deepEqual(snapshot.surface.capabilities, ["surface-feed-v1", "locker-fill-v1"]);
  });
});

test("an incompatible request cannot poison later extension commands", async () => {
  await withServer(async (server, base) => {
    const lease = server.createLease({url: "https://example.com/", title: ""});
    const response = await fetch(`${base}/v1/snapshot`, {
      headers: {
        "X-Polymux-Surface-Protocol-Min": "9",
        "X-Polymux-Surface-Protocol-Max": "9",
        "X-Polymux-Surface-Capabilities": "surface-commands-v1",
      },
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.surface.compatible, false);
    assert.match(body.surface.reason, /do not overlap/);
    const pending = server.runCommand(lease.id, {kind: "read"});
    const compatible = await (await fetch(`${base}/v1/snapshot`, {
      headers: extensionProtocolHeaders("7.4.2"),
    })).json();
    const command = compatible.leases[0].command;
    const posted = await fetch(`${base}/v1/results`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        leaseId: lease.id,
        commandId: command.id,
        ok: true,
        content: "safe",
      }),
    });
    assert.equal(posted.ok, true);
    assert.equal((await pending).ok, true);
  });
});

test("long-poll resolves when the revision moves", async () => {
  await withServer(async (server, base) => {
    const {revision} = server.snapshot();
    const poll = fetch(`${base}/v1/snapshot?after=${revision}&waitMs=5000`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    server.createLease({url: "https://example.com/", title: ""});
    const result = await (await poll).json();
    assert.equal(result.leases.length, 1);
    assert.ok(result.revision > revision);
  });
});

test("a command round-trips through the results endpoint", async () => {
  await withServer(async (server, base) => {
    const lease = server.createLease({url: "https://example.com/", title: ""});
    const pending = server.runCommand(lease.id, {kind: "read", maxChars: 100});
    // The extension long-polls, sees the command, executes, posts the result.
    const snapshot = await (await fetch(`${base}/v1/snapshot`)).json();
    const command = snapshot.leases[0].command;
    assert.equal(command.kind, "read");
    const post = await fetch(`${base}/v1/results`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        leaseId: lease.id,
        commandId: command.id,
        ok: true,
        pageUrl: "https://example.com/",
        pageTitle: "Example",
        content: "Hello",
      }),
    });
    assert.equal(post.ok, true);
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(result.content, "Hello");
    assert.equal(server.getLease(lease.id)?.command, null);
  });
});

test("an unanswered command times out with a helpful error", async () => {
  await withServer(async (server) => {
    const lease = server.createLease({url: "https://example.com/", title: ""});
    const result = await server.runCommand(lease.id, {kind: "read"}, 200);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /extension did not respond/);
    // The stale command is cleared so the lease is usable again.
    assert.equal(server.getLease(lease.id)?.command, null);
  });
});

test("cursor moves bump the move sequence and revision", async () => {
  await withServer(async (server) => {
    const lease = server.createLease({url: "https://example.com/", title: ""});
    assert.equal(server.moveCursor(lease.id, 10, 20), true);
    assert.equal(server.moveCursor(lease.id, 30, 40), true);
    const current = server.getLease(lease.id);
    assert.equal(current?.cursor?.moveSequence, 2);
    assert.equal(current?.cursor?.x, 30);
    assert.equal(server.moveCursor("missing", 0, 0), false);
  });
});

test("locker fill stays on the loopback until the user asks", async () => {
  await withServer(async (server, base, authorizedFetch) => {
    const missing = await authorizedFetch(`${base}/v1/locker/status`);
    assert.equal(missing.status, 503);
    let unlocked = false;
    const items = [{id: "gh", title: "GitHub", username: "ada", url: "https://github.com", notes: "", groupId: "g", groupName: "Locker", hasPassword: true, hasTotp: true, hasRecoveryCodes: false, hasPasskey: false, updatedAt: null as string | null}];
    server.attachLocker({
      status: () => ({
        exists: true,
        unlocked,
        itemCount: items.length,
        idleLockSeconds: 300,
        sync: {signedIn: false, available: false, state: "offline", storage: "account", revision: 1, lastSyncedAt: null},
      }),
      unlock: async (password) => {
        if (password !== "secret-password") throw new Error("Wrong master password");
        unlocked = true;
        return {
          exists: true,
          unlocked: true,
          itemCount: 1,
          idleLockSeconds: 300,
          sync: {signedIn: false, available: false, state: "offline", storage: "account", revision: 1, lastSyncedAt: null},
        };
      },
      lock: () => {
        unlocked = false;
        return {
          exists: true,
          unlocked: false,
          itemCount: 1,
          idleLockSeconds: 300,
          sync: {signedIn: false, available: false, state: "offline", storage: "account", revision: 1, lastSyncedAt: null},
        };
      },
      matches: (url) => unlocked && url.includes("github.com") ? items : [],
      fill: (id) => {
        if (!unlocked) throw new Error("Locker is locked");
        if (id !== "gh") throw new Error("That item is not in the locker");
        return {username: "ada", password: "s3cret", totp: "123456"};
      },
      save: async (item) => ({...items[0], title: item.title, username: item.username ?? "", url: item.url ?? ""}),
      totp: (id) => id === "gh" && unlocked ? {code: "123456", next: "654321", period: 30, remaining: 12, issuer: "GitHub", account: "ada"} : null,
      export: () => unlocked ? {bytes: "ZmFrZQ==", meta: {revision: 1, updatedAt: "2026-09-07T00:00:00.000Z", checksum: "abc", dirty: false, lastSyncedAt: null, storage: "account"}} : {bytes: "ZmFrZQ==", meta: {revision: 1, updatedAt: "2026-09-07T00:00:00.000Z", checksum: "abc", dirty: false, lastSyncedAt: null, storage: "account"}},
    });
    // Even a syntactically valid extension origin needs the native capability.
    for (const path of Object.values(LOCKER_SURFACE_PATHS)) {
      for (const origin of [undefined, "null", "https://attacker.example", `chrome-extension://${"a".repeat(32)}`]) {
        const response = await fetch(`${base}${path}`, {
          method: "POST",
          headers: {...(origin ? {Origin: origin} : {}), "X-Polymux-Surface-Protocol-Min": "999"},
          body: "invalid json must not be parsed before authentication",
        });
        assert.equal(response.status, 403, `${path} ${origin}`);
        assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
      }
    }
    const locked = await (await authorizedFetch(`${base}/v1/locker/status`)).json();
    assert.equal(locked.unlocked, false);
    assert.deepEqual((await (await authorizedFetch(`${base}/v1/locker/matches?url=https://github.com/login`)).json()).items, []);
    const unlockedStatus = await authorizedFetch(`${base}/v1/locker/unlock`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({password: "secret-password"}),
    });
    assert.equal(unlockedStatus.ok, true);
    const matches = await (await authorizedFetch(`${base}/v1/locker/matches?url=https://github.com/login`)).json();
    assert.equal(matches.items[0].id, "gh");
    const fill = await (await authorizedFetch(`${base}/v1/locker/fill`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({id: "gh"}),
    })).json();
    assert.deepEqual(fill, {username: "ada", password: "s3cret", totp: "123456"});
    const exported = await (await authorizedFetch(`${base}/v1/locker/export`)).json();
    assert.equal(exported.bytes, "ZmFrZQ==");
    assert.equal(exported.meta.storage, "account");
  });
});

test("released and expired leases disappear from snapshots", async () => {
  let now = 1_000_000;
  const port = 47_900 + Math.floor(Math.random() * 90);
  const server = new AgentSurfaceServer({port, clock: () => now});
  await server.start();
  try {
    const kept = server.createLease({url: "https://a.example/", title: ""});
    const dropped = server.createLease({url: "https://b.example/", title: ""});
    server.releaseLease(dropped.id);
    assert.equal(server.snapshot().leases.length, 1);
    now += 500_000; // Past the lease TTL.
    assert.equal(server.snapshot().leases.length, 0);
    assert.equal(server.getLease(kept.id), undefined);
  } finally {
    await server.close();
  }
});


test("Locker capability does not authorize website origins, spoofed hosts or public preflights", async () => {
  const directory = mkdtempSync(join(tmpdir(), "polymux-locker-auth-"));
  const lockerCapabilityPath = join(directory, "capability");
  const token = loadLockerCapability(lockerCapabilityPath);
  const port = 48_100 + Math.floor(Math.random() * 200);
  const server = new AgentSurfaceServer({port, lockerCapabilityPath});
  await server.start();
  try {
    for (const headers of [
      {Authorization: `Bearer ${token}`, Origin: "https://attacker.example"},
      {Authorization: `Bearer ${token}`, Origin: "null"},
      {Authorization: `Bearer ${"b".repeat(64)}`},
    ] as Record<string, string>[]) {
      const response = await fetch(`http://127.0.0.1:${port}/v1/locker/status`, {headers});
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    }
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(`http://127.0.0.1:${port}/v1/locker/status`, {
        headers: {Authorization: `Bearer ${token}`, Host: "attacker.example"},
      }, (response) => {
        response.resume();
        try {
          assert.equal(response.statusCode, 403);
          assert.equal(response.headers["access-control-allow-origin"], undefined);
          resolve();
        } catch (error) { reject(error); }
      });
      request.on("error", reject);
      request.end();
    });
    const preflight = await fetch(`http://127.0.0.1:${port}/v1/locker/fill`, {
      method: "OPTIONS", headers: {Origin: "https://attacker.example", "Access-Control-Request-Headers": "authorization"},
    });
    assert.equal(preflight.status, 403);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), null);
    const noOrigin = await fetch(`http://127.0.0.1:${port}/v1/locker/status`, {headers: {Authorization: `Bearer ${token}`}});
    assert.equal(noOrigin.status, 503); // Authenticated; no Locker attached in this fixture.
    assert.equal(noOrigin.headers.get("Access-Control-Allow-Origin"), null);
    const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;
    const approved = await fetch(`http://127.0.0.1:${port}/v1/locker/status`, {headers: {Authorization: `Bearer ${token}`, Origin: extensionOrigin}});
    assert.equal(approved.status, 503);
    assert.equal(approved.headers.get("Access-Control-Allow-Origin"), extensionOrigin);
    const firefoxOrigin = "moz-extension://12345678-1234-1234-1234-123456789abc";
    const firefox = await fetch(`http://127.0.0.1:${port}/v1/locker/status`, {headers: {Authorization: `Bearer ${token}`, Origin: firefoxOrigin}});
    assert.equal(firefox.status, 503);
    assert.equal(firefox.headers.get("Access-Control-Allow-Origin"), firefoxOrigin);
    const unapprovedFirefox = await fetch(`http://127.0.0.1:${port}/v1/locker/status`, {headers: {Origin: firefoxOrigin}});
    assert.equal(unapprovedFirefox.status, 403);
  } finally {
    await server.close();
    rmSync(directory, {recursive: true, force: true});
  }
});
