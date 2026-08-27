import assert from "node:assert/strict";
import {createServer, type Server} from "node:http";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import {Homeserver} from "../src/server.js";
import {parseRegistration} from "../src/bridges.js";

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
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-hs-"));
  const bridge = await startFakeBridge();
  const hs = new Homeserver({serverName: "polymux.test", dataDirectory: directory});
  await hs.start();
  const asToken = "as-token-test";
  hs.registerAppservice({
    id: "whatsapp",
    asToken,
    hsToken: "hs-token-test",
    url: bridge.base,
    senderLocalpart: "whatsappbot",
    userNamespaces: ["@whatsapp_.*:polymux\\.test"],
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
    assert.equal(bot.body.user_id, "@whatsappbot:polymux.test");
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
    assert.equal(asBot.body.user_id, "@whatsappbot:polymux.test");
    const asGhost = await call(hs, "GET", "/_matrix/client/v3/account/whoami", {
      token: asToken,
      query: {user_id: "@whatsapp_1:polymux.test"},
    });
    assert.equal(asGhost.body.user_id, "@whatsapp_1:polymux.test");
    const outside = await call(hs, "GET", "/_matrix/client/v3/account/whoami", {
      token: asToken,
      query: {user_id: "@victim:polymux.test"},
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

test("batch sending backfills a room with each event's own timestamp", async () => {
  const {hs, asToken, cleanup} = await startHarness();
  try {
    const user = hs.createLocalUser("polymux");
    const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: asToken,
      query: {user_id: "@whatsapp_61400000000:polymux.test"},
      body: {name: "Jules Tan (WA)", is_direct: true, invite: [user.userId]},
    });
    const roomId = created.body.room_id as string;

    // Without `com.beeper.batch_sending` advertised and this endpoint behind
    // it, the bridges log that the server cannot batch send and never run
    // their backfill queue at all.
    const versions = await call(hs, "GET", "/_matrix/client/versions");
    assert.equal((versions.body.unstable_features as Record<string, boolean>)["com.beeper.batch_sending"], true);

    const batch = await call(
      hs,
      "POST",
      `/_matrix/client/unstable/com.beeper.backfill/rooms/${encodeURIComponent(roomId)}/batch_send`,
      {
        token: asToken,
        body: {
          forward: false,
          events: [
            {
              type: "m.room.message",
              sender: "@whatsapp_61400000000:polymux.test",
              origin_server_ts: 1_600_000_000_000,
              content: {msgtype: "m.text", body: "first"},
            },
            {
              type: "m.room.message",
              sender: "@whatsapp_61400000000:polymux.test",
              origin_server_ts: 1_600_000_060_000,
              content: {msgtype: "m.text", body: "second"},
            },
          ],
        },
      },
    );
    assert.equal(batch.status, 200);
    assert.equal((batch.body.event_ids as string[]).length, 2);

    const messages = await call(hs, "GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`, {
      token: user.accessToken,
      query: {dir: "f", limit: "100"},
    });
    const backfilled = (messages.body.chunk as Array<Record<string, unknown>>).filter(
      (event) => event.type === "m.room.message",
    );
    assert.deepEqual(
      backfilled.map((event) => (event.content as {body: string}).body),
      ["first", "second"],
    );
    assert.deepEqual(
      backfilled.map((event) => event.origin_server_ts),
      [1_600_000_000_000, 1_600_000_060_000],
    );
  } finally {
    await cleanup();
  }
});

test("batch sending is refused without an appservice token", async () => {
  const {hs, asToken, cleanup} = await startHarness();
  try {
    const user = hs.createLocalUser("polymux");
    const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: asToken,
      query: {user_id: "@whatsapp_61400000000:polymux.test"},
      body: {name: "Jules Tan (WA)", is_direct: true, invite: [user.userId]},
    });
    const roomId = created.body.room_id as string;
    const batch = await call(
      hs,
      "POST",
      `/_matrix/client/unstable/com.beeper.backfill/rooms/${encodeURIComponent(roomId)}/batch_send`,
      {token: user.accessToken, body: {events: []}},
    );
    assert.equal(batch.status, 403);
  } finally {
    await cleanup();
  }
});

test("an invite written as plain state still reaches the local user", async () => {
  const {hs, asToken, cleanup} = await startHarness();
  try {
    const user = hs.createLocalUser("polymux");
    const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: asToken,
      query: {user_id: "@whatsapp_61400000000:polymux.test"},
      body: {name: "Jules Tan (WA)", is_direct: true},
    });
    const roomId = created.body.room_id as string;
    // bridgev2 invites by PUTting the member event rather than calling
    // `/invite`. Taking that as a plain state write skipped the invite-to-join
    // hop, and the portal sat unanswered — a room the user was never in, which
    // `/sync` does not report and the chat list therefore cannot show.
    const invited = await call(
      hs,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(user.userId)}`,
      {
        token: asToken,
        query: {user_id: "@whatsapp_61400000000:polymux.test"},
        body: {membership: "invite", is_direct: true},
      },
    );
    assert.equal(invited.status, 200);

    const joined = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.deepEqual(joined.body.joined_rooms, [roomId]);
  } finally {
    await cleanup();
  }
});

test("a portal room reaches the local user without an autojoin daemon", async () => {
  const {hs, asToken, cleanup} = await startHarness();
  try {
    const user = hs.createLocalUser("polymux");
    const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: asToken,
      query: {user_id: "@whatsapp_61400000000:polymux.test"},
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
    const user = hs.createLocalUser("polymux");
    const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: asToken,
      query: {user_id: "@whatsapp_1:polymux.test"},
      body: {invite: [user.userId]},
    });
    const roomId = created.body.room_id as string;

    const sent = await call(
      hs,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/txn-1`,
      {
        token: asToken,
        query: {user_id: "@whatsapp_1:polymux.test", ts: "1700000000000"},
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
        query: {user_id: "@whatsapp_1:polymux.test"},
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

test("sync advances incrementally and long-polls until a new event arrives", async () => {
  const {hs, asToken, cleanup} = await startHarness();
  try {
    const user = hs.createLocalUser("polymux");
    const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: asToken,
      query: {user_id: "@whatsapp_1:polymux.test"},
      body: {invite: [user.userId], name: "Incremental chat"},
    });
    const roomId = created.body.room_id as string;

    const initial = await call(hs, "GET", "/_matrix/client/v3/sync", {
      token: user.accessToken,
    });
    assert.equal(initial.status, 200);
    assert.ok((initial.body.rooms as {join: Record<string, unknown>}).join[roomId]);
    const since = initial.body.next_batch as string;

    let settled = false;
    const waiting = call(hs, "GET", "/_matrix/client/v3/sync", {
      token: user.accessToken,
      query: {since, timeout: "1000"},
    }).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(settled, false, "an unchanged stream keeps the incremental sync open");

    const sent = await call(
      hs,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/sync-1`,
      {
        token: asToken,
        query: {user_id: "@whatsapp_1:polymux.test"},
        body: {msgtype: "m.text", body: "wake the sync"},
      },
    );
    const incremental = await waiting;
    assert.equal(incremental.status, 200);
    assert.notEqual(incremental.body.next_batch, since);
    const room = (incremental.body.rooms as {join: Record<string, {timeline: {events: unknown[]}}>})
      .join[roomId];
    assert.ok(room, "only the changed joined room is returned");
    assert.deepEqual(
      room.timeline.events.map((event) => (event as {event_id: string}).event_id),
      [sent.body.event_id],
    );

    const empty = await call(hs, "GET", "/_matrix/client/v3/sync", {
      token: user.accessToken,
      query: {since: incremental.body.next_batch as string, timeout: "1"},
    });
    assert.deepEqual(empty.body.rooms, {join: {}});

    const invalid = await call(hs, "GET", "/_matrix/client/v3/sync", {
      token: user.accessToken,
      query: {since: "not-a-token"},
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.errcode, "M_UNKNOWN_POS");
  } finally {
    await cleanup();
  }
});

test("the user's reply is pushed to the bridge as an ordered transaction", async () => {
  const {hs, bridge, asToken, cleanup} = await startHarness();
  try {
    const user = hs.createLocalUser("polymux");
    const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: asToken,
      query: {user_id: "@whatsapp_1:polymux.test"},
      body: {invite: [user.userId]},
    });
    const roomId = created.body.room_id as string;
    const before = bridge.transactions.length;

    const sent = await call(
      hs,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/user-txn`,
      {token: user.accessToken, body: {msgtype: "m.text", body: "reply from polymux"}},
    );
    assert.equal(sent.status, 200);

    await until(
      () =>
        bridge.transactions
          .slice(before)
          .some((txn) => txn.events.some((event) => (event.content as {body?: string})?.body === "reply from polymux")),
      "the reply to be pushed to the bridge",
    );
    const delivery = bridge.transactions.find((txn) =>
      txn.events.some((event) => (event.content as {body?: string})?.body === "reply from polymux"),
    )!;
    assert.equal(delivery.auth, "Bearer hs-token-test", "pushes authenticate with the hs_token");
    const event = delivery.events.find(
      (item) => (item.content as {body?: string})?.body === "reply from polymux",
    )!;
    assert.equal(event.sender, user.userId);
    assert.equal(event.room_id, roomId);
    assert.equal(event.type, "m.room.message");
  } finally {
    await cleanup();
  }
});

test("a bridge is never pushed the events it wrote itself", async () => {
  // The echo is not harmless. A message the bridge double-puppets in as the
  // user — which is every message the user ever sent, at backfill — comes
  // back indistinguishable from the user typing it here, and the bridge
  // sends it to the network again: whole conversations re-sent to the
  // people they were had with.
  const {hs, bridge, asToken, cleanup} = await startHarness();
  try {
    const user = hs.createLocalUser("polymux");
    const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: asToken,
      query: {user_id: "@whatsapp_1:polymux.test"},
      body: {invite: [user.userId]},
    });
    const roomId = created.body.room_id as string;

    // The bridge backfills the user's own side double-puppeted, and sends a
    // ghost's live message; the user answers from Polymux.
    const batch = await call(
      hs,
      "POST",
      `/_matrix/client/unstable/com.beeper.backfill/rooms/${encodeURIComponent(roomId)}/batch_send`,
      {
        token: asToken,
        body: {
          events: [
            {
              type: "m.room.message",
              sender: user.userId,
              content: {msgtype: "m.text", body: "sent on the phone, years ago"},
              origin_server_ts: 1_000,
            },
          ],
        },
      },
    );
    assert.equal(batch.status, 200);
    await call(
      hs,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/ghost-txn`,
      {
        token: asToken,
        query: {user_id: "@whatsapp_1:polymux.test"},
        body: {msgtype: "m.text", body: "from the contact"},
      },
    );
    await call(
      hs,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/user-txn`,
      {token: user.accessToken, body: {msgtype: "m.text", body: "typed in polymux"}},
    );

    // The user's own live message is the bridge's to deliver; wait for it so
    // the assertion below reads a settled stream rather than a race.
    await until(
      () =>
        bridge.transactions.some((txn) =>
          txn.events.some((event) => (event.content as {body?: string})?.body === "typed in polymux"),
        ),
      "the user's live message to be pushed to the bridge",
    );
    const delivered = bridge.transactions.flatMap((txn) =>
      txn.events.map((event) => (event.content as {body?: string})?.body),
    );
    assert.ok(!delivered.includes("sent on the phone, years ago"), "backfill is not echoed back");
    assert.ok(!delivered.includes("from the contact"), "the ghost's own send is not echoed back");
  } finally {
    await cleanup();
  }
});

test("only sends the user armed this run ever reach a bridge", async () => {
  // Handing a bridge a timeline event IS sending it on the network, so the
  // pusher is deny-by-default: the user's own send goes out, and an identical
  // event surfaced any other way — here, a replayed delivery position over
  // events from a previous run, the shape every replay bug reduces to — is
  // data about a conversation, not a command to transmit.
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-hs-"));
  const bridge = await startFakeBridge();
  const registration = {
    id: "whatsapp",
    asToken: "as-token-test",
    hsToken: "hs-token-test",
    url: bridge.base,
    senderLocalpart: "whatsappbot",
    userNamespaces: ["@whatsapp_.*:polymux\\.test"],
  };
  const first = new Homeserver({serverName: "polymux.test", dataDirectory: directory});
  await first.start();
  first.registerAppservice(registration);
  let user: {userId: string; accessToken: string};
  try {
    user = first.createLocalUser("polymux");
    const created = await call(first, "POST", "/_matrix/client/v3/createRoom", {
      token: registration.asToken,
      query: {user_id: "@whatsapp_1:polymux.test"},
      body: {invite: [user.userId]},
    });
    const roomId = created.body.room_id as string;
    await call(
      first,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/live-txn`,
      {token: user.accessToken, body: {msgtype: "m.text", body: "sent while the user was here"}},
    );
    await until(
      () =>
        bridge.transactions.some((txn) =>
          txn.events.some(
            (event) => (event.content as {body?: string})?.body === "sent while the user was here",
          ),
        ),
      "the armed send to be delivered",
    );
  } finally {
    await first.close();
  }

  // The same database, a fresh run, and the delivery position wound back to
  // the beginning — the worst replay a bug could construct. Without the gate,
  // the pusher walks the whole stream from zero and hands the bridge every
  // message ever stored.
  const rewind = new DatabaseSync(path.join(directory, "homeserver.sqlite"));
  rewind.prepare("UPDATE appservice_positions SET stream_order = 0").run();
  rewind.close();
  const second = new Homeserver({serverName: "polymux.test", dataDirectory: directory});
  await second.start();
  const replayed = bridge.transactions.length;
  second.registerAppservice(registration);
  try {
    // A new armed send proves the pusher ran and worked through the backlog,
    // so the assertion below is about the gate, not about timing.
    const rooms = await call(second, "GET", "/_matrix/client/v3/joined_rooms", {
      token: user.accessToken,
    });
    const roomId = (rooms.body.joined_rooms as string[])[0];
    await call(
      second,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/second-txn`,
      {token: user.accessToken, body: {msgtype: "m.text", body: "armed in the second run"}},
    );
    await until(
      () =>
        bridge.transactions
          .slice(replayed)
          .some((txn) =>
            txn.events.some(
              (event) => (event.content as {body?: string})?.body === "armed in the second run",
            ),
          ),
      "the second run's own send to be delivered",
    );
    const resent = bridge.transactions
      .slice(replayed)
      .flatMap((txn) => txn.events)
      .filter((event) => (event.content as {body?: string})?.body === "sent while the user was here");
    assert.equal(resent.length, 0, "the previous run's message is never transmitted again");
  } finally {
    await second.close();
    await bridge.close();
    await rm(directory, {recursive: true, force: true});
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
    assert.match(content_uri, /^mxc:\/\/polymux\.test\//);
    const mediaId = content_uri.split("/").pop()!;

    for (const endpoint of [
      `/_matrix/media/v3/download/polymux.test/${mediaId}`,
      `/_matrix/client/v1/media/download/polymux.test/${mediaId}`,
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
    const user = hs.createLocalUser("polymux");
    const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: asToken,
      query: {user_id: "@whatsapp_1:polymux.test"},
      body: {invite: [user.userId]},
    });
    const roomId = created.body.room_id as string;
    await call(hs, "PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/t1`, {
      token: asToken,
      query: {user_id: "@whatsapp_1:polymux.test"},
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
      body: {"@whatsapp_1:polymux.test": [roomId]},
    });
    assert.equal(put.status, 200);
    const got = await call(hs, "GET", `/_matrix/client/v3/user/${encodeURIComponent(user.userId)}/account_data/m.direct`, {
      token: user.accessToken,
    });
    assert.deepEqual(got.body[`@whatsapp_1:polymux.test`], [roomId]);
  } finally {
    await cleanup();
  }
});

test("the provisioning proxy forwards to the bridge listener", async () => {
  const {hs, bridge, cleanup} = await startHarness();
  try {
    hs.setProvisioningTarget("whatsapp", bridge.base);
    const response = await fetch(`${hs.baseUrl}/bridges/whatsapp/_matrix/provision/v3/whoami?user_id=@polymux:polymux.test`, {
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
      body: {type: "m.login.password", identifier: {type: "m.id.user", user: "polymux"}, password: "x"},
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
      "    - regex: ^@whatsappbot:polymux\\.test$",
      "      exclusive: true",
      "    - regex: ^@whatsapp_.*:polymux\\.test$",
      "      exclusive: true",
      "    aliases:",
      "    - regex: ^#whatsapp_.*:polymux\\.test$",
      "      exclusive: true",
    ].join("\n"),
  );
  assert.equal(parsed.asToken, "abc123");
  assert.equal(parsed.hsToken, "def456");
  assert.equal(parsed.senderLocalpart, "whatsappbot");
  assert.deepEqual(parsed.userNamespaces, [
    "@whatsappbot:polymux\\.test",
    "@whatsapp_.*:polymux\\.test",
  ]);
});

test("a fresh install creates its own data directory", async () => {
  // The exact crash from first boot: the hub directory does not exist yet and
  // SQLite will not create missing directories itself.
  const parent = await mkdtemp(path.join(tmpdir(), "polymux-fresh-"));
  const directory = path.join(parent, "does", "not", "exist", "hub");
  const hs = new Homeserver({serverName: "polymux.test", dataDirectory: directory});
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
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-reap-"));
  const pidPath = path.join(directory, "bridge.pid");
  // A stand-in orphan: long-lived, harmless, and ours to kill.
  const {spawn} = await import("node:child_process");
  const orphan = spawn("sleep", ["300"], {stdio: "ignore"});
  const {writeFile: write} = await import("node:fs/promises");
  await write(pidPath, String(orphan.pid), "utf8");
  try {
    const {reapStalePid} = await import("../src/bridges.js");
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
