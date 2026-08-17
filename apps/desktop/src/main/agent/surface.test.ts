import assert from "node:assert/strict";
import test from "node:test";
import {AgentSurfaceServer} from "./surface.js";

async function withServer(run: (server: AgentSurfaceServer, base: string) => Promise<void>): Promise<void> {
  const port = 47_700 + Math.floor(Math.random() * 200);
  const server = new AgentSurfaceServer({port});
  await server.start();
  try {
    await run(server, `http://127.0.0.1:${port}`);
  } finally {
    await server.close();
  }
}

test("snapshot exposes leases and revisions move on changes", async () => {
  await withServer(async (server, base) => {
    const empty = await (await fetch(`${base}/v1/snapshot`)).json();
    assert.deepEqual(empty.leases, []);
    const lease = server.createLease({url: "https://example.com/", title: "Example"});
    const snapshot = await (await fetch(`${base}/v1/snapshot`)).json();
    assert.equal(snapshot.leases.length, 1);
    assert.equal(snapshot.leases[0].id, lease.id);
    assert.equal(snapshot.leases[0].tab.url, "https://example.com/");
    assert.ok(snapshot.revision > empty.revision);
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
