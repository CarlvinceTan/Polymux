import assert from "node:assert/strict";
import {createServer, type Server} from "node:http";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {Homeserver} from "../homeserver/server.js";
import {parseRegistration} from "../homeserver/bridges.js";

/**
 * A stand-in for a mautrix bridge's appservice listener: it records the
 * transactions and pings the homeserver delivers, which is the half of the
 * contract a bridge cannot function without.
 */
interface FakeBridge {
  base: string;
  transactions: Array<{txnId: string; auth: string | null; events: Array<Record<string, unknown>>}>;
  pings: Array<{auth: string | null; transactionId: string}>;
  close: () => Promise<void>;
}

async function startFakeBridge(): Promise<FakeBridge> {
  const state: Pick<FakeBridge, "transactions" | "pings"> = {transactions: [], pings: []};
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const auth = request.headers.authorization ?? null;
      const txnMatch = url.pathname.match(/^\/_matrix\/app\/v1\/transactions\/(.+)$/);
      if (request.method === "PUT" && txnMatch) {
        state.transactions.push({
          txnId: decodeURIComponent(txnMatch[1]),
          auth,
          events: (body as {events: Array<Record<string, unknown>>}).events,
        });
        response.writeHead(200, {"Content-Type": "application/json"});
        response.end("{}");
        return;
      }
      if (request.method === "POST" && url.pathname === "/_matrix/app/v1/ping") {
        state.pings.push({auth, transactionId: (body as {transaction_id: string}).transaction_id});
        response.writeHead(200, {"Content-Type": "application/json"});
        response.end("{}");
        return;
      }
      // The provisioning namespace lives on the same listener in real bridges.
      if (url.pathname.startsWith("/_matrix/provision/")) {
        response.writeHead(200, {"Content-Type": "application/json"});
        response.end(JSON.stringify({path: url.pathname, auth}));
        return;
      }
      response.writeHead(404);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as {port: number}).port;
  return {
    base: `http://127.0.0.1:${port}`,
    ...state,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

interface Harness {
  hs: Homeserver;
  bridge: FakeBridge;
  asToken: string;
  cleanup: () => Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-hs-"));
  const bridge = await startFakeBridge();
  const hs = new Homeserver({serverName: "flareai.test", dataDirectory: directory});
  await hs.start();
  const asToken = "as-token-test";
  hs.registerAppservice({
    id: "whatsapp",
    asToken,
    hsToken: "hs-token-test",
    url: bridge.base,
    senderLocalpart: "whatsappbot",
    userNamespaces: ["@whatsapp_.*:flareai\\.test"],
  });
  return {
    hs,
    bridge,
    asToken,
    cleanup: async () => {
      await hs.close();
      await bridge.close();
      await rm(directory, {recursive: true, force: true});
    },
  };
}

async function call(
  hs: Homeserver,
  method: string,
  endpoint: string,
  options: {token?: string; body?: unknown; query?: Record<string, string>} = {},
): Promise<{status: number; body: Record<string, unknown>}> {
  const url = new URL(`${hs.baseUrl}${endpoint}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: {
      ...(options.token ? {Authorization: `Bearer ${options.token}`} : {}),
      ...(options.body === undefined ? {} : {"Content-Type": "application/json"}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return {status: response.status, body: (await response.json()) as Record<string, unknown>};
}

async function until(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("advertises modern spec versions and the appservice ping feature", async () => {
  const {hs, cleanup} = await startHarness();
  try {
    const versions = await call(hs, "GET", "/_matrix/client/versions");
    assert.ok((versions.body.versions as string[]).includes("v1.11"));
    const unstable = versions.body.unstable_features as Record<string, boolean>;
    assert.equal(unstable["fi.mau.msc2659.stable"], true);
  } finally {
    await cleanup();
  }
});

test("registers the bridge bot and ghosts through appservice registration", async () => {
  const {hs, asToken, cleanup} = await startHarness();
  try {
    const bot = await call(hs, "POST", "/_matrix/client/v3/register", {
      token: asToken,
      body: {type: "m.login.application_service", username: "whatsappbot", inhibit_login: true},
    });
    assert.equal(bot.status, 200);
    assert.equal(bot.body.user_id, "@whatsappbot:flareai.test");
    assert.equal(bot.body.access_token, undefined, "inhibit_login must not mint a token");

    const ghost = await call(hs, "POST", "/_matrix/client/v3/register", {
      token: asToken,
      body: {type: "m.login.application_service", username: "whatsapp_61400000000", inhibit_login: true},
    });
    assert.equal(ghost.status, 200);

    const outside = await call(hs, "POST", "/_matrix/client/v3/register", {
      token: asToken,
      body: {type: "m.login.application_service", username: "someone-else"},
    });
    assert.equal(outside.status, 400);
    assert.equal(outside.body.errcode, "M_EXCLUSIVE");

    const duplicate = await call(hs, "POST", "/_matrix/client/v3/register", {
      token: asToken,
      body: {type: "m.login.application_service", username: "whatsappbot"},
    });
    assert.equal(duplicate.body.errcode, "M_USER_IN_USE");
  } finally {
    await cleanup();
  }
});

test("whoami reflects appservice masquerading", async () => {
  const {hs, asToken, cleanup} = await startHarness();
  try {
    const asBot = await call(hs, "GET", "/_matrix/client/v3/account/whoami", {token: asToken});
    assert.equal(asBot.body.user_id, "@whatsappbot:flareai.test");
    const asGhost = await call(hs, "GET", "/_matrix/client/v3/account/whoami", {
      token: asToken,
      query: {user_id: "@whatsapp_1:flareai.test"},
    });
    assert.equal(asGhost.body.user_id, "@whatsapp_1:flareai.test");
    const outside = await call(hs, "GET", "/_matrix/client/v3/account/whoami", {
      token: asToken,
      query: {user_id: "@victim:flareai.test"},
    });
    assert.equal(outside.status, 401, "masquerading outside the namespace must be refused");
  } finally {
    await cleanup();
  }
});

test("round-trips the MSC2659 appservice ping", async () => {
  const {hs, bridge, asToken, cleanup} = await startHarness();
  try {
    const result = await call(hs, "POST", "/_matrix/client/v1/appservice/whatsapp/ping", {
      token: asToken,
      body: {transaction_id: "ping-1"},
    });
    assert.equal(result.status, 200);
    assert.equal(typeof result.body.duration_ms, "number");
    assert.equal(bridge.pings.length, 1);
    assert.equal(bridge.pings[0].transactionId, "ping-1");
    assert.equal(bridge.pings[0].auth, "Bearer hs-token-test");
  } finally {
    await cleanup();
  }
});

test("a portal room reaches the local user without an autojoin daemon", async () => {
  const {hs, asToken, cleanup} = await startHarness();
  try {
    const user = hs.createLocalUser("flareai");
    const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: asToken,
      query: {user_id: "@whatsapp_61400000000:flareai.test"},
      body: {
        name: "Jules Tan (WA)",
        invite: [user.userId],
        is_direct: true,
        initial_state: [{type: "m.bridge", state_key: "wa", content: {protocol: {id: "whatsapp"}}}],
      },
    });
    assert.equal(created.status, 200);
    const roomId = created.body.room_id as string;

    // The invite from a namespaced user became a join with no external help.
    const joined = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.deepEqual(joined.body.joined_rooms, [roomId]);

    const name = await call(hs, "GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name`, {
      token: user.accessToken,
    });
    assert.equal((name.body as {name: string}).name, "Jules Tan (WA)");
  } finally {
    await cleanup();
  }
});

test("bridged messages flow to the user with massaged timestamps and land in unread", async () => {
  const {hs, asToken, cleanup} = await startHarness();
  try {
    const user = hs.createLocalUser("flareai");
    const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: asToken,
      query: {user_id: "@whatsapp_1:flareai.test"},
      body: {invite: [user.userId]},
    });
    const roomId = created.body.room_id as string;

    const sent = await call(
      hs,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/txn-1`,
      {
        token: asToken,
        query: {user_id: "@whatsapp_1:flareai.test", ts: "1700000000000"},
        body: {msgtype: "m.text", body: "hello from whatsapp"},
      },
    );
    assert.equal(sent.status, 200);

    // Retrying the same transaction id returns the same event, never a duplicate.
    const retried = await call(
      hs,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/txn-1`,
      {
        token: asToken,
        query: {user_id: "@whatsapp_1:flareai.test"},
        body: {msgtype: "m.text", body: "hello from whatsapp"},
      },
    );
    assert.equal(retried.body.event_id, sent.body.event_id);

    const messages = await call(
      hs,
      "GET",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`,
      {token: user.accessToken, query: {dir: "b", limit: "10"}},
    );
    const chunk = messages.body.chunk as Array<Record<string, unknown>>;
    const message = chunk.find((event) => event.type === "m.room.message");
    assert.ok(message, "the user can page back to the bridged message");
    assert.equal(message.origin_server_ts, 1_700_000_000_000, "MSC3316 timestamp massaging applies");

    const unread = await call(hs, "GET", "/_matrix/client/v3/notifications", {token: user.accessToken});
    const notifications = unread.body.notifications as Array<Record<string, unknown>>;
    assert.equal(notifications.length, 1);
    assert.equal((notifications[0].event as {content: {body: string}}).content.body, "hello from whatsapp");

    // Reading up to the event clears it.
    await call(
      hs,
      "POST",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(String(sent.body.event_id))}`,
      {token: user.accessToken, body: {}},
    );
    const after = await call(hs, "GET", "/_matrix/client/v3/notifications", {token: user.accessToken});
    assert.equal((after.body.notifications as unknown[]).length, 0);
  } finally {
    await cleanup();
  }
});

test("the user's reply is pushed to the bridge as an ordered transaction", async () => {
  const {hs, bridge, asToken, cleanup} = await startHarness();
  try {
    const user = hs.createLocalUser("flareai");
    const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: asToken,
      query: {user_id: "@whatsapp_1:flareai.test"},
      body: {invite: [user.userId]},
    });
    const roomId = created.body.room_id as string;
    await until(() => bridge.transactions.length > 0, "portal creation to reach the bridge");
    const before = bridge.transactions.length;

    const sent = await call(
      hs,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/user-txn`,
      {token: user.accessToken, body: {msgtype: "m.text", body: "reply from flareai"}},
    );
    assert.equal(sent.status, 200);

    await until(
      () =>
        bridge.transactions
          .slice(before)
          .some((txn) => txn.events.some((event) => (event.content as {body?: string})?.body === "reply from flareai")),
      "the reply to be pushed to the bridge",
    );
    const delivery = bridge.transactions.find((txn) =>
      txn.events.some((event) => (event.content as {body?: string})?.body === "reply from flareai"),
    )!;
    assert.equal(delivery.auth, "Bearer hs-token-test", "pushes authenticate with the hs_token");
    const event = delivery.events.find(
      (item) => (item.content as {body?: string})?.body === "reply from flareai",
    )!;
    assert.equal(event.sender, user.userId);
    assert.equal(event.room_id, roomId);
    assert.equal(event.type, "m.room.message");
  } finally {
    await cleanup();
  }
});

test("media round-trips through upload and both download endpoints", async () => {
  const {hs, asToken, cleanup} = await startHarness();
  try {
    const payload = Buffer.from("fake-image-bytes");
    const upload = await fetch(`${hs.baseUrl}/_matrix/media/v3/upload?filename=photo.jpg`, {
      method: "POST",
      headers: {Authorization: `Bearer ${asToken}`, "Content-Type": "image/jpeg"},
      body: payload,
    });
    const {content_uri} = (await upload.json()) as {content_uri: string};
    assert.match(content_uri, /^mxc:\/\/flareai\.test\//);
    const mediaId = content_uri.split("/").pop()!;

    for (const endpoint of [
      `/_matrix/media/v3/download/flareai.test/${mediaId}`,
      `/_matrix/client/v1/media/download/flareai.test/${mediaId}`,
    ]) {
      const download = await fetch(`${hs.baseUrl}${endpoint}`, {
        headers: {Authorization: `Bearer ${asToken}`},
      });
      assert.equal(download.status, 200, endpoint);
      assert.equal(download.headers.get("content-type"), "image/jpeg");
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), payload);
    }
  } finally {
    await cleanup();
  }
});

test("search and account data cover the client surface the hub uses", async () => {
  const {hs, asToken, cleanup} = await startHarness();
  try {
    const user = hs.createLocalUser("flareai");
    const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: asToken,
      query: {user_id: "@whatsapp_1:flareai.test"},
      body: {invite: [user.userId]},
    });
    const roomId = created.body.room_id as string;
    await call(hs, "PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/t1`, {
      token: asToken,
      query: {user_id: "@whatsapp_1:flareai.test"},
      body: {msgtype: "m.text", body: "the quarterly numbers are ready"},
    });

    const search = await call(hs, "POST", "/_matrix/client/v3/search", {
      token: user.accessToken,
      body: {search_categories: {room_events: {search_term: "quarterly", filter: {limit: 10}}}},
    });
    const results = (search.body.search_categories as {room_events: {results: unknown[]}}).room_events.results;
    assert.equal(results.length, 1);

    // m.direct is what bridges write to mark DMs.
    const put = await call(hs, "PUT", `/_matrix/client/v3/user/${encodeURIComponent(user.userId)}/account_data/m.direct`, {
      token: user.accessToken,
      body: {"@whatsapp_1:flareai.test": [roomId]},
    });
    assert.equal(put.status, 200);
    const got = await call(hs, "GET", `/_matrix/client/v3/user/${encodeURIComponent(user.userId)}/account_data/m.direct`, {
      token: user.accessToken,
    });
    assert.deepEqual(got.body[`@whatsapp_1:flareai.test`], [roomId]);
  } finally {
    await cleanup();
  }
});

test("the provisioning proxy forwards to the bridge listener", async () => {
  const {hs, bridge, cleanup} = await startHarness();
  try {
    hs.setProvisioningTarget("whatsapp", bridge.base);
    const response = await fetch(`${hs.baseUrl}/bridges/whatsapp/_matrix/provision/v3/whoami?user_id=@flareai:flareai.test`, {
      headers: {Authorization: "Bearer some-user-token"},
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {path: string; auth: string};
    assert.equal(body.path, "/_matrix/provision/v3/whoami");
    assert.equal(body.auth, "Bearer some-user-token", "the caller's token passes through untouched");
  } finally {
    await cleanup();
  }
});

test("password login is refused and foreign tokens are rejected", async () => {
  const {hs, cleanup} = await startHarness();
  try {
    const login = await call(hs, "POST", "/_matrix/client/v3/login", {
      body: {type: "m.login.password", identifier: {type: "m.id.user", user: "flareai"}, password: "x"},
    });
    assert.equal(login.status, 403);
    const stranger = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: "not-a-token"});
    assert.equal(stranger.status, 401);
  } finally {
    await cleanup();
  }
});

test("parseRegistration extracts tokens and user namespaces", () => {
  const parsed = parseRegistration(
    [
      "id: whatsapp",
      "url: http://localhost:29318",
      "as_token: abc123",
      "hs_token: def456",
      "sender_localpart: whatsappbot",
      "rate_limited: false",
      "namespaces:",
      "    users:",
      "    - regex: ^@whatsappbot:flareai\\.test$",
      "      exclusive: true",
      "    - regex: ^@whatsapp_.*:flareai\\.test$",
      "      exclusive: true",
      "    aliases:",
      "    - regex: ^#whatsapp_.*:flareai\\.test$",
      "      exclusive: true",
    ].join("\n"),
  );
  assert.equal(parsed.asToken, "abc123");
  assert.equal(parsed.hsToken, "def456");
  assert.equal(parsed.senderLocalpart, "whatsappbot");
  assert.deepEqual(parsed.userNamespaces, [
    "@whatsappbot:flareai\\.test",
    "@whatsapp_.*:flareai\\.test",
  ]);
});

test("a fresh install creates its own data directory", async () => {
  // The exact crash from first boot: the hub directory does not exist yet and
  // SQLite will not create missing directories itself.
  const parent = await mkdtemp(path.join(tmpdir(), "flareai-fresh-"));
  const directory = path.join(parent, "does", "not", "exist", "hub");
  const hs = new Homeserver({serverName: "flareai.test", dataDirectory: directory});
  try {
    await hs.start();
    const versions = await fetch(`${hs.baseUrl}/_matrix/client/versions`);
    assert.equal(versions.status, 200);
  } finally {
    await hs.close();
    await rm(parent, {recursive: true, force: true});
  }
});

test("reapStalePid terminates an orphan from a crashed run", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-reap-"));
  const pidPath = path.join(directory, "bridge.pid");
  // A stand-in orphan: long-lived, harmless, and ours to kill.
  const {spawn} = await import("node:child_process");
  const orphan = spawn("sleep", ["300"], {stdio: "ignore"});
  const {writeFile: write} = await import("node:fs/promises");
  await write(pidPath, String(orphan.pid), "utf8");
  try {
    const {reapStalePid} = await import("../homeserver/bridges.js");
    await reapStalePid(pidPath);
    // Signal 0 probes liveness without sending anything.
    assert.throws(() => process.kill(orphan.pid!, 0), "the orphan must be gone");
    const {readFile: read} = await import("node:fs/promises");
    await assert.rejects(read(pidPath), "the pid file must be cleared");
  } finally {
    try {
      orphan.kill("SIGKILL");
    } catch {
      // Already reaped, which is the point.
    }
    await rm(directory, {recursive: true, force: true});
  }
});
