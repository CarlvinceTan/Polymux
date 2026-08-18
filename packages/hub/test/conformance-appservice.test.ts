import assert from "node:assert/strict";
import {createServer, type Server, type ServerResponse} from "node:http";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {Homeserver} from "../src/server.js";
import {
  call,
  createRoom,
  sendMessage,
  startFakeBridge,
  startHarness,
  until,
  type FakeBridge,
} from "./test-harness.js";

/**
 * The appservice half of the contract: namespaces, masquerading, transaction
 * delivery, MSC2659 ping, batch sending, and the two extensions this server
 * adds on purpose — the invite-to-join hop and the armed-send gate.
 *
 * Everything here is asserted through the HTTP surface, because that is all a
 * mautrix binary ever sees. What a bridge is handed it transmits, so most of
 * these are boundary tests: the cost of getting one wrong is a message on the
 * wrong network, to the wrong person, or the same conversation sent twice.
 */

const SERVER = "flareai.test";
const GHOST = `@whatsapp_1:${SERVER}`;
const SECOND_GHOST = `@whatsapp_2:${SERVER}`;
const ZULIP_GHOST = `@zulip_1:${SERVER}`;
const WHATSAPP_NAMESPACE = "@whatsapp_.*:flareai\\.test";

// --- helpers ---

/** Message bodies carried by a run of transactions, in delivery order. */
function deliveredBodies(transactions: Array<{events: Array<Record<string, unknown>>}>): string[] {
  return transactions
    .flatMap((transaction) => transaction.events)
    .map((event) => (event.content as {body?: string} | undefined)?.body)
    .filter((body): body is string => typeof body === "string");
}

/** Everything in a room's timeline, oldest first, read the way a client would. */
async function timeline(
  hs: Homeserver,
  token: string,
  roomId: string,
): Promise<Array<Record<string, unknown>>> {
  const messages = await call(hs, "GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`, {
    token,
    query: {dir: "f", limit: "500"},
  });
  return messages.body.chunk as Array<Record<string, unknown>>;
}

async function roomBodies(hs: Homeserver, token: string, roomId: string): Promise<string[]> {
  return (await timeline(hs, token, roomId))
    .filter((event) => event.type === "m.room.message")
    .map((event) => (event.content as {body?: string}).body ?? "");
}

/**
 * Holds a condition for a short window. `until` can only prove that something
 * arrived; proving that nothing did needs a bounded wait, so a regression fails
 * the assertion instead of the suite hanging.
 */
async function stays(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    assert.ok(check(), label);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Adds a second bridge to a harness; a cross-bridge boundary needs two. */
async function addBridge(
  hs: Homeserver,
  id: string,
  prefix: string,
): Promise<{bridge: FakeBridge; asToken: string}> {
  const bridge = await startFakeBridge();
  const asToken = `as-token-${id}`;
  hs.registerAppservice({
    id,
    asToken,
    hsToken: `hs-token-${id}`,
    url: bridge.base,
    senderLocalpart: `${id}bot`,
    userNamespaces: [`@${prefix}_.*:flareai\\.test`],
  });
  return {bridge, asToken};
}

interface Attempt {
  txnId: string;
  auth: string | null;
  /** The exact bytes pushed, so a retry is compared rather than re-serialised. */
  raw: string;
  events: Array<Record<string, unknown>>;
}

interface ScriptedBridge {
  base: string;
  /** Every transaction PUT that arrived, including ones answered with an error. */
  attempts: Attempt[];
  pings: Array<Record<string, unknown>>;
  /**
   * Knobs the test turns: `answers` queues a status per upcoming transaction,
   * `pingStatus` sets what /ping returns, `stall` holds transaction responses
   * open so the homeserver's push stays in flight.
   */
  control: {answers: number[]; pingStatus: number; stall: boolean};
  release: () => void;
  close: () => Promise<void>;
}

/**
 * The shared harness's bridge always answers 200, and answers at once. Failure
 * and back-pressure behaviour is only observable against a listener whose
 * responses the test scripts, so this is that listener and nothing more.
 */
async function startScriptedBridge(): Promise<ScriptedBridge> {
  const attempts: Attempt[] = [];
  const pings: Array<Record<string, unknown>> = [];
  const control = {answers: [] as number[], pingStatus: 200, stall: false};
  const held: ServerResponse[] = [];
  const answer = (response: ServerResponse, status: number): void => {
    response.writeHead(status, {"Content-Type": "application/json"});
    response.end("{}");
  };
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const raw = Buffer.concat(chunks).toString("utf8");
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const txnMatch = url.pathname.match(/^\/_matrix\/app\/v1\/transactions\/(.+)$/);
      if (txnMatch) {
        // Recorded before the answer, so a stalled push is still observable.
        attempts.push({
          txnId: decodeURIComponent(txnMatch[1]),
          auth: request.headers.authorization ?? null,
          raw,
          events: (parsed.events ?? []) as Array<Record<string, unknown>>,
        });
        if (control.stall) held.push(response);
        else answer(response, control.answers.shift() ?? 200);
        return;
      }
      if (/\/ping$/.test(url.pathname)) {
        pings.push(parsed);
        answer(response, control.pingStatus);
        return;
      }
      answer(response, 404);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as {port: number}).port;
  const flush = (): void => {
    control.stall = false;
    while (held.length > 0) answer(held.shift()!, control.answers.shift() ?? 200);
  };
  return {
    base: `http://127.0.0.1:${port}`,
    attempts,
    pings,
    control,
    release: flush,
    close: async () => {
      flush();
      server.closeIdleConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

interface ScriptedHarness {
  hs: Homeserver;
  bridge: ScriptedBridge;
  asToken: string;
  user: {userId: string; accessToken: string};
  cleanup: () => Promise<void>;
}

/** The shared harness's shape, with the scripted listener in place of the bridge. */
async function startScriptedHarness(): Promise<ScriptedHarness> {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-hs-"));
  const bridge = await startScriptedBridge();
  const hs = new Homeserver({serverName: SERVER, dataDirectory: directory});
  await hs.start();
  const asToken = "as-token-test";
  hs.registerAppservice({
    id: "whatsapp",
    asToken,
    hsToken: "hs-token-test",
    url: bridge.base,
    senderLocalpart: "whatsappbot",
    userNamespaces: [WHATSAPP_NAMESPACE],
  });
  return {
    hs,
    bridge,
    asToken,
    user: hs.createLocalUser("flareai"),
    cleanup: async () => {
      // Released first: `close` awaits every pusher, and a pusher parked on a
      // held response would hold the whole suite there with it.
      bridge.release();
      await hs.close();
      await bridge.close();
      await rm(directory, {recursive: true, force: true});
    },
  };
}

/** A portal the bridge owns: the ghost's room, with the human joined into it. */
async function portal(
  hs: Homeserver,
  asToken: string,
  user: {userId: string},
  ghost = GHOST,
): Promise<string> {
  return createRoom(hs, asToken, {invite: [user.userId], is_direct: true}, {user_id: ghost});
}

// --- namespaces and masquerading ---

test("a namespace pattern matches a whole user id, so a lookalike localpart is outside it", async () => {
  // Registration files carry unanchored regexes and the reference servers read
  // them unanchored, which would make @evil_whatsapp_1 a member of the
  // @whatsapp_.* namespace. The anchoring here is the only boundary between one
  // bridge's ghosts and another's, so it is pinned as intended rather than left
  // to be "fixed" back towards upstream.
  const {hs, asToken, cleanup} = await startHarness();
  try {
    const lookalike = await call(hs, "GET", "/_matrix/client/v3/account/whoami", {
      token: asToken,
      query: {user_id: `@evil_whatsapp_1:${SERVER}`},
    });
    assert.equal(lookalike.status, 401, "a prefixed lookalike is outside the namespace");

    const real = await call(hs, "GET", "/_matrix/client/v3/account/whoami", {
      token: asToken,
      query: {user_id: GHOST},
    });
    assert.equal(real.status, 200);
    assert.equal(real.body.user_id, GHOST);

    const claimed = await call(hs, "POST", "/_matrix/client/v3/register", {
      token: asToken,
      body: {type: "m.login.application_service", username: "evil_whatsapp_1", inhibit_login: true},
    });
    assert.equal(claimed.status, 400);
    assert.equal(claimed.body.errcode, "M_EXCLUSIVE");

    const allowed = await call(hs, "POST", "/_matrix/client/v3/register", {
      token: asToken,
      body: {type: "m.login.application_service", username: "whatsapp_1", inhibit_login: true},
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.user_id, GHOST);
  } finally {
    await cleanup();
  }
});

test("a namespace regex that does not compile matches nobody", async () => {
  // A typo in a registration file has to fail closed: a broken pattern must
  // grant nothing rather than becoming a wildcard a bridge writes as anyone
  // through.
  const {hs, bridge, cleanup} = await startHarness();
  try {
    const brokenToken = "as-token-broken";
    hs.registerAppservice({
      id: "broken",
      asToken: brokenToken,
      hsToken: "hs-token-broken",
      url: bridge.base,
      senderLocalpart: "brokenbot",
      userNamespaces: [`@broken_[:${SERVER}`],
    });

    const bot = await call(hs, "GET", "/_matrix/client/v3/account/whoami", {token: brokenToken});
    assert.equal(bot.body.user_id, `@brokenbot:${SERVER}`, "the bot itself is unaffected");

    const ghost = await call(hs, "GET", "/_matrix/client/v3/account/whoami", {
      token: brokenToken,
      query: {user_id: `@broken_1:${SERVER}`},
    });
    assert.equal(ghost.status, 401, "an uncompilable pattern grants no masquerade");

    const registered = await call(hs, "POST", "/_matrix/client/v3/register", {
      token: brokenToken,
      body: {type: "m.login.application_service", username: "broken_1", inhibit_login: true},
    });
    assert.equal(registered.status, 400);
    assert.equal(registered.body.errcode, "M_EXCLUSIVE");
  } finally {
    await cleanup();
  }
});

test("a bridge may write as the account it bridges for, but only one that exists", async () => {
  // The deliberate divergence: everywhere else double puppeting needs the
  // user's own token, but here the appservice and the account are the same
  // person on one machine. Without it a message the user sent in WhatsApp
  // itself has to arrive attributed to the person they were talking to. The
  // account having to exist is the whole guard, so both directions are pinned.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const whoami = await call(hs, "GET", "/_matrix/client/v3/account/whoami", {
      token: asToken,
      query: {user_id: user.userId},
    });
    assert.equal(whoami.status, 200);
    assert.equal(whoami.body.user_id, user.userId);

    const roomId = await portal(hs, asToken, user);
    const eventId = await sendMessage(
      hs,
      asToken,
      roomId,
      {msgtype: "m.text", body: "sent from the phone"},
      {user_id: user.userId},
    );
    const stored = await call(
      hs,
      "GET",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
      {token: user.accessToken},
    );
    assert.equal(stored.body.sender, user.userId, "the user's own side is attributed to them");

    const absent = await call(hs, "GET", "/_matrix/client/v3/account/whoami", {
      token: asToken,
      query: {user_id: `@nobody:${SERVER}`},
    });
    assert.equal(absent.status, 401, "an account that does not exist is not puppetable");

    const foreign = await call(hs, "GET", "/_matrix/client/v3/account/whoami", {
      token: asToken,
      query: {user_id: "@flareai:elsewhere.test"},
    });
    assert.equal(foreign.status, 401, "a human on another domain is not ours to write as");
  } finally {
    await cleanup();
  }
});

test("one bridge cannot speak as another bridge's ghost", async () => {
  // With no exclusivity check between registrations, namespace matching is the
  // only thing stopping the WhatsApp bridge writing as a Zulip ghost — and a
  // message written as the wrong ghost goes out on the wrong network.
  const {hs, asToken, user, cleanup} = await startHarness();
  const zulip = await addBridge(hs, "zulip", "zulip");
  try {
    const whoami = await call(hs, "GET", "/_matrix/client/v3/account/whoami", {
      token: zulip.asToken,
      query: {user_id: GHOST},
    });
    assert.equal(whoami.status, 401, "another bridge's ghost is not a masquerade zulip may make");

    const roomId = await portal(hs, asToken, user);
    const sent = await call(
      hs,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/cross-bridge`,
      {token: zulip.asToken, query: {user_id: GHOST}, body: {msgtype: "m.text", body: "wrong network"}},
    );
    assert.equal(sent.status, 401);
    assert.ok(
      !(await roomBodies(hs, user.accessToken, roomId)).includes("wrong network"),
      "a refused masquerade writes nothing",
    );
  } finally {
    // The homeserver first: a pusher mid-retry against a listener that has
    // already gone would hold its close for the length of the retry ladder.
    await cleanup();
    await zulip.bridge.close();
  }
});

test("one bridge cannot rename another bridge's ghost", async () => {
  // The cheapest cross-bridge boundary to violate: one bridge rewriting
  // another's contact names, or a bridge renaming the human.
  const {hs, asToken, cleanup} = await startHarness();
  const zulip = await addBridge(hs, "zulip", "zulip");
  try {
    await call(hs, "PUT", `/_matrix/client/v3/profile/${encodeURIComponent(GHOST)}/displayname`, {
      token: asToken,
      query: {user_id: GHOST},
      body: {displayname: "Jules Tan"},
    });

    const renamed = await call(
      hs,
      "PUT",
      `/_matrix/client/v3/profile/${encodeURIComponent(GHOST)}/displayname`,
      {token: zulip.asToken, query: {user_id: ZULIP_GHOST}, body: {displayname: "not their contact"}},
    );
    assert.equal(renamed.status, 403, "a profile write outside the caller's namespace is refused");

    const profile = await call(hs, "GET", `/_matrix/client/v3/profile/${encodeURIComponent(GHOST)}/displayname`, {
      token: asToken,
    });
    assert.equal(profile.body.displayname, "Jules Tan", "the other bridge's ghost keeps its name");
  } finally {
    // The homeserver first: a pusher mid-retry against a listener that has
    // already gone would hold its close for the length of the retry ladder.
    await cleanup();
    await zulip.bridge.close();
  }
});

// --- the armed-send gate ---

test("a message a bridge writes as the user is recorded and never handed to a bridge", async () => {
  // The armed gate is what makes double puppeting safe: writing as the user
  // records what they said elsewhere, but only the user's own client asking to
  // send arms an outbound delivery. Without it the bridge receives its own
  // double-puppeted history back and re-sends every message the user ever sent.
  const {hs, bridge, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portal(hs, asToken, user);
    await sendMessage(
      hs,
      asToken,
      roomId,
      {msgtype: "m.text", body: "double puppeted history"},
      {user_id: user.userId},
    );
    assert.ok(
      (await roomBodies(hs, user.accessToken, roomId)).includes("double puppeted history"),
      "the masqueraded message is readable history",
    );

    // A marker the user genuinely armed, so the assertion below reads a stream
    // the pusher has already worked past rather than racing it.
    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "armed marker"});
    await until(() => bridge.delivered().includes("armed marker"), "the armed send to be delivered");

    assert.ok(
      !deliveredBodies(bridge.transactions).includes("double puppeted history"),
      "a masqueraded write is data about a conversation, never a command to transmit",
    );
  } finally {
    await cleanup();
  }
});

test("a second bridge in the same room is not handed the first bridge's messages", async () => {
  // Origin suppression only withholds a bridge's own writes. It is the armed
  // gate that keeps a ghost's inbound message from being handed to a second
  // bridge, which would put a WhatsApp message onto Zulip.
  const {hs, bridge, asToken, user, cleanup} = await startHarness();
  const zulip = await addBridge(hs, "zulip", "zulip");
  try {
    const roomId = await portal(hs, asToken, user);
    await call(hs, "POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
      token: asToken,
      query: {user_id: GHOST},
      body: {user_id: ZULIP_GHOST},
    });
    const joined = await call(hs, "POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`, {
      token: zulip.asToken,
      query: {user_id: ZULIP_GHOST},
      body: {},
    });
    assert.equal(joined.status, 200);

    await sendMessage(hs, asToken, roomId, {msgtype: "m.text", body: "from whatsapp"}, {user_id: GHOST});
    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "armed marker"});
    await until(() => bridge.delivered().includes("armed marker"), "whatsapp to receive the marker");
    await until(() => zulip.bridge.delivered().includes("armed marker"), "zulip to receive the marker");

    assert.ok(
      !deliveredBodies(zulip.bridge.transactions).includes("from whatsapp"),
      "there is no bridge-to-bridge relay",
    );
  } finally {
    // The homeserver first: a pusher mid-retry against a listener that has
    // already gone would hold its close for the length of the retry ladder.
    await cleanup();
    await zulip.bridge.close();
  }
});

test("a bridge hears about a room only while one of its users is in it", async () => {
  // Interest is read off current membership at delivery time, so a room with no
  // ghost in it is invisible to the bridge — and a portal whose ghost has not
  // joined yet is silently one-way, the exact shape of "this chat sends but
  // never receives".
  const {hs, bridge, asToken, user, cleanup} = await startHarness();
  try {
    const own = await createRoom(hs, user.accessToken, {name: "notes to self"});
    await sendMessage(hs, user.accessToken, own, {msgtype: "m.text", body: "nobody bridges this"});

    // The marker lands in the bridge's own portal, so interest over the private
    // room is judged after the delivery position has moved past its message.
    const roomId = await portal(hs, asToken, user);
    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "in the portal"});
    await until(() => bridge.delivered().includes("in the portal"), "the portal delivery");
    assert.ok(
      !deliveredBodies(bridge.transactions).includes("nobody bridges this"),
      "a room with no ghost in it is not the bridge's business",
    );

    await call(hs, "POST", `/_matrix/client/v3/rooms/${encodeURIComponent(own)}/invite`, {
      token: user.accessToken,
      body: {user_id: SECOND_GHOST},
    });
    await call(hs, "POST", `/_matrix/client/v3/rooms/${encodeURIComponent(own)}/join`, {
      token: asToken,
      query: {user_id: SECOND_GHOST},
      body: {},
    });
    await sendMessage(hs, user.accessToken, own, {msgtype: "m.text", body: "now it is bridged"});
    await until(
      () => bridge.delivered().includes("now it is bridged"),
      "a send after the ghost joined to be delivered",
    );
  } finally {
    await cleanup();
  }
});

// --- transaction delivery ---

test("a transaction retried after a failure carries the same id and the same events", async () => {
  // A stable transaction id across retries is what lets a bridge deduplicate.
  // An id that changed per attempt makes it re-send every message in the batch
  // onto the remote network after any transient failure.
  const {hs, bridge, asToken, user, cleanup} = await startScriptedHarness();
  try {
    const roomId = await portal(hs, asToken, user);
    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "warmup"});
    await until(() => deliveredBodies(bridge.attempts).includes("warmup"), "the warmup delivery");

    bridge.control.answers.push(500);
    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "retried"});
    const carrying = (): Attempt[] =>
      bridge.attempts.filter((attempt) => deliveredBodies([attempt]).includes("retried"));
    await until(() => carrying().length >= 2, "the failed transaction to be retried");

    const [first, second] = carrying();
    assert.equal(second.txnId, first.txnId, "a retry reuses the transaction id");
    assert.equal(second.raw, first.raw, "a retry carries byte-identical events");

    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "after the retry"});
    await until(
      () => deliveredBodies(bridge.attempts).includes("after the retry"),
      "the stream to move past the retried batch",
    );
    assert.equal(carrying().length, 2, "a delivered batch is not pushed a third time");
  } finally {
    await cleanup();
  }
});

test("nothing new is pushed while a transaction is unacknowledged", async () => {
  // One transaction in flight per appservice, with everything produced
  // meanwhile coalescing into the next batch, is the model the pusher and the
  // flareai-{streamOrder} id both presume. A second concurrent loop would
  // duplicate or skip deliveries.
  const {hs, bridge, asToken, user, cleanup} = await startScriptedHarness();
  try {
    const roomId = await portal(hs, asToken, user);
    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "warmup"});
    await until(() => deliveredBodies(bridge.attempts).includes("warmup"), "the warmup delivery");

    const baseline = bridge.attempts.length;
    bridge.control.stall = true;
    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "held"});
    await until(() => bridge.attempts.length === baseline + 1, "the transaction to be in flight");

    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "third"});
    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "fourth"});
    await stays(
      () => bridge.attempts.length === baseline + 1,
      "no second transaction while the first is unacknowledged",
    );

    bridge.release();
    await until(() => deliveredBodies(bridge.attempts).includes("fourth"), "the coalesced batch");
    assert.equal(bridge.attempts.length, baseline + 2, "the backlog goes out as one transaction");
    assert.deepEqual(
      deliveredBodies([bridge.attempts[baseline + 1]]),
      ["third", "fourth"],
      "coalesced events keep send order",
    );
  } finally {
    await cleanup();
  }
});

test("one hung bridge does not hold up another's transactions", async () => {
  // FlareAI runs several bridges against one loopback homeserver. A shared push
  // loop would let one hung bridge stall every other bridge's messages, which
  // reaches the user as "Zulip is broken".
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-hs-"));
  const hung = await startScriptedBridge();
  const healthy = await startScriptedBridge();
  const hs = new Homeserver({serverName: SERVER, dataDirectory: directory});
  await hs.start();
  hs.registerAppservice({
    id: "whatsapp",
    asToken: "as-token-whatsapp",
    hsToken: "hs-token-whatsapp",
    url: hung.base,
    senderLocalpart: "whatsappbot",
    userNamespaces: [WHATSAPP_NAMESPACE],
  });
  hs.registerAppservice({
    id: "zulip",
    asToken: "as-token-zulip",
    hsToken: "hs-token-zulip",
    url: healthy.base,
    senderLocalpart: "zulipbot",
    userNamespaces: ["@zulip_.*:flareai\\.test"],
  });
  const user = hs.createLocalUser("flareai");
  try {
    const whatsappRoom = await portal(hs, "as-token-whatsapp", user);
    const zulipRoom = await portal(hs, "as-token-zulip", user, ZULIP_GHOST);

    // Drained first, so the stall below catches a pusher that was parked and
    // idle rather than one that may already have been answered mid-flight.
    await sendMessage(hs, user.accessToken, whatsappRoom, {msgtype: "m.text", body: "warmup"});
    await until(() => deliveredBodies(hung.attempts).includes("warmup"), "the first bridge's warmup");
    const baseline = hung.attempts.length;

    hung.control.stall = true;
    await sendMessage(hs, user.accessToken, whatsappRoom, {msgtype: "m.text", body: "into the hung bridge"});
    await until(() => hung.attempts.length === baseline + 1, "the first bridge to be mid-push");

    await sendMessage(hs, user.accessToken, zulipRoom, {msgtype: "m.text", body: "into the healthy bridge"});
    await until(
      () => deliveredBodies(healthy.attempts).includes("into the healthy bridge"),
      "the second bridge's own portal to be delivered while the first hangs",
    );
    assert.equal(hung.attempts.length, baseline + 1, "the first bridge really is still unanswered");
    assert.ok(
      !deliveredBodies(hung.attempts).includes("into the healthy bridge"),
      "each bridge is pushed only its own rooms",
    );
  } finally {
    hung.release();
    await hs.close();
    await hung.close();
    await healthy.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("a burst of sends reaches the bridge exactly once each, in the order they were sent", async () => {
  // Exactly once plus global ordering across batch boundaries is what a
  // bridge's own dedup relies on; a duplicate at a batch seam is the same
  // message twice on the remote network.
  const {hs, bridge, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portal(hs, asToken, user);
    const expected: string[] = [];
    for (let index = 1; index <= 20; index += 1) {
      const body = `burst-${String(index).padStart(2, "0")}`;
      expected.push(body);
      await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body});
    }
    await until(() => bridge.delivered().includes("burst-20"), "the last of the burst to be delivered");

    const seen = deliveredBodies(bridge.transactions).filter((body) => body.startsWith("burst-"));
    assert.deepEqual(seen, expected, "every send arrives once, in send order");
    const txnIds = bridge.transactions.map((transaction) => transaction.txnId);
    assert.equal(new Set(txnIds).size, txnIds.length, "a transaction id is never reused");
  } finally {
    await cleanup();
  }
});

// --- MSC2659 ping ---

test("a ping with a user's token is not a ping for that bridge", async () => {
  // The ping reports whether the homeserver can reach a bridge back, so only
  // that bridge may ask; a user token that could ping would let the hub
  // misreport a bridge as healthy.
  const {hs, bridge, user, cleanup} = await startHarness();
  try {
    const pinged = await call(hs, "POST", "/_matrix/client/v1/appservice/whatsapp/ping", {
      token: user.accessToken,
      body: {transaction_id: "ping-user"},
    });
    assert.equal(pinged.status, 403);
    assert.equal(pinged.body.errcode, "M_FORBIDDEN");
    assert.equal(bridge.pings.length, 0, "no outbound ping is made on a user's behalf");
  } finally {
    await cleanup();
  }
});

test("a ping for someone else's appservice is refused", async () => {
  const {hs, asToken, cleanup} = await startHarness();
  const zulip = await addBridge(hs, "zulip", "zulip");
  try {
    const pinged = await call(hs, "POST", "/_matrix/client/v1/appservice/zulip/ping", {
      token: asToken,
      body: {transaction_id: "ping-cross"},
    });
    assert.equal(pinged.status, 403);
    assert.equal(zulip.bridge.pings.length, 0, "one bridge cannot make another's outbound request");
  } finally {
    // The homeserver first: a pusher mid-retry against a listener that has
    // already gone would hold its close for the length of the retry ladder.
    await cleanup();
    await zulip.bridge.close();
  }
});

test("a bridge that answers a ping with an error is reported as a bad status", async () => {
  // A bridgev2 binary branches on the errcode to tell "the homeserver cannot
  // reach me" from "I answered badly", and refuses to run when the shape is
  // wrong — the error shapes are the load-bearing half of MSC2659.
  const {hs, bridge, asToken, cleanup} = await startScriptedHarness();
  try {
    bridge.control.pingStatus = 500;
    const pinged = await call(hs, "POST", "/_matrix/client/v1/appservice/whatsapp/ping", {
      token: asToken,
      body: {transaction_id: "ping-bad"},
    });
    assert.equal(pinged.status, 502);
    assert.equal(pinged.body.errcode, "FI.MAU.MSC2659_BAD_STATUS");
    assert.equal(pinged.body.status, 500, "the bridge's own status is echoed back");
    assert.equal(bridge.pings.length, 1, "the ping did reach the listener");
  } finally {
    await cleanup();
  }
});

test("a bridge that cannot be reached is reported as a failed connection", async () => {
  // What a bridge gets while it is still starting up. It has to be
  // distinguishable from a bad status so the bridge retries rather than
  // reporting itself broken.
  const {hs, cleanup} = await startHarness();
  try {
    // A port that was bound and released, so nothing can be listening on it.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
    const deadPort = (probe.address() as {port: number}).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    hs.registerAppservice({
      id: "absent",
      asToken: "as-token-absent",
      hsToken: "hs-token-absent",
      url: `http://127.0.0.1:${deadPort}`,
      senderLocalpart: "absentbot",
      userNamespaces: [`@absent_.*:flareai\\.test`],
    });
    const pinged = await call(hs, "POST", "/_matrix/client/v1/appservice/absent/ping", {
      token: "as-token-absent",
      body: {transaction_id: "ping-dead"},
    });
    assert.equal(pinged.status, 502);
    assert.equal(pinged.body.errcode, "FI.MAU.MSC2659_CONNECTION_FAILED");
  } finally {
    await cleanup();
  }
});

test("a receive-only bridge with no listener is told its url is unset", async () => {
  // Modern mautrix double puppeting registers a second, deliberately url-less
  // appservice that only holds a token — mautrix's own docs say non-compliant
  // servers need a fake URL there. Surfacing the absence as a connection
  // failure instead is what sends the pusher through its whole retry ladder
  // against a listener that was never meant to exist.
  const {hs, cleanup} = await startHarness();
  try {
    hs.registerAppservice({
      id: "doublepuppet",
      asToken: "as-token-doublepuppet",
      hsToken: "hs-token-doublepuppet",
      url: "",
      senderLocalpart: "doublepuppetbot",
      userNamespaces: [`@doublepuppet_.*:flareai\\.test`],
    });
    const pinged = await call(hs, "POST", "/_matrix/client/v1/appservice/doublepuppet/ping", {
      token: "as-token-doublepuppet",
      body: {transaction_id: "ping-urlless"},
    });
    assert.equal(pinged.status, 400);
    assert.equal(pinged.body.errcode, "M_URL_NOT_SET");
  } finally {
    await cleanup();
  }
});

// --- invites and the auto-join hop ---

test("an invite through /invite is answered like one written as state", async () => {
  // Three code paths reach the invite hop and only two are covered elsewhere.
  // POST /invite is what a non-bridgev2 bridge uses, and an unanswered invite
  // is a portal full of the user's conversations that /sync cannot report.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, asToken, {name: "Jules Tan (WA)"}, {user_id: GHOST});
    const invited = await call(hs, "POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
      token: asToken,
      query: {user_id: GHOST},
      body: {user_id: user.userId, is_direct: true},
    });
    assert.equal(invited.status, 200);

    const joined = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.deepEqual(joined.body.joined_rooms, [roomId]);
  } finally {
    await cleanup();
  }
});

test("with auto-join off, an invited portal stays an invitation", async () => {
  // The hop is an extension standing in for an autojoin daemon, and the option
  // is the switch that turns it off; pinning both sides keeps it from becoming
  // unconditional by accident.
  const {hs, asToken, user, cleanup} = await startHarness({autoJoin: false});
  try {
    const roomId = await portal(hs, asToken, user);
    const membership = await call(
      hs,
      "GET",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(user.userId)}`,
      {token: asToken, query: {user_id: GHOST}},
    );
    assert.equal(membership.body.membership, "invite");

    const joined = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.deepEqual(joined.body.joined_rooms, []);

    const joins = (await timeline(hs, user.accessToken, roomId)).filter(
      (event) =>
        event.type === "m.room.member" &&
        event.state_key === user.userId &&
        (event.content as {membership?: string}).membership === "join",
    );
    assert.equal(joins.length, 0, "nothing joins on the user's behalf");
  } finally {
    await cleanup();
  }
});

test("invitations left unanswered while the app was down are answered at startup", async () => {
  // The startup sweep is the only recovery for portals invited before the hop
  // covered every path, or while the app was not running: /sync reports only
  // joined rooms, so an unanswered invite is a conversation that is nowhere.
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-hs-"));
  const bridge = await startFakeBridge();
  const registration = {
    id: "whatsapp",
    asToken: "as-token-test",
    hsToken: "hs-token-test",
    url: bridge.base,
    senderLocalpart: "whatsappbot",
    userNamespaces: [WHATSAPP_NAMESPACE],
  };
  const first = new Homeserver({serverName: SERVER, dataDirectory: directory, autoJoin: false});
  await first.start();
  first.registerAppservice(registration);
  const user = first.createLocalUser("flareai");
  const stranger = first.createLocalUser("stranger");
  let portalRoom = "";
  let strangerRoom = "";
  try {
    portalRoom = await portal(first, registration.asToken, user);
    strangerRoom = await createRoom(first, stranger.accessToken, {invite: [user.userId]});
    const joined = await call(first, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.deepEqual(joined.body.joined_rooms, [], "both invitations start unanswered");
  } finally {
    await first.close();
  }

  const second = new Homeserver({serverName: SERVER, dataDirectory: directory});
  try {
    await second.start();
    const joined = await call(second, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.deepEqual(joined.body.joined_rooms, [portalRoom], "only the bridge's portal is healed");
    assert.ok(
      !(joined.body.joined_rooms as string[]).includes(strangerRoom),
      "an invite nobody's bridge offered is left alone",
    );
  } finally {
    await second.close();
    await bridge.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("a portal invited inside a backfill batch reaches the user", async () => {
  // A bridge that backfills before it invites builds a whole chat as one batch,
  // so a member entry inside it has to become a visible room the same way a
  // state PUT does.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, asToken, {name: "Jules Tan (WA)"}, {user_id: GHOST});
    const batch = await call(
      hs,
      "POST",
      `/_matrix/client/unstable/com.beeper.backfill/rooms/${encodeURIComponent(roomId)}/batch_send`,
      {
        token: asToken,
        body: {
          events: [
            {
              type: "m.room.member",
              sender: GHOST,
              state_key: user.userId,
              origin_server_ts: 1_600_000_000_000,
              content: {membership: "invite", is_direct: true},
            },
            {
              type: "m.room.message",
              sender: GHOST,
              origin_server_ts: 1_600_000_001_000,
              content: {msgtype: "m.text", body: "backfilled first"},
            },
            {
              type: "m.room.message",
              sender: GHOST,
              origin_server_ts: 1_600_000_002_000,
              content: {msgtype: "m.text", body: "backfilled second"},
            },
          ],
        },
      },
    );
    assert.equal(batch.status, 200);

    const joined = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.deepEqual(joined.body.joined_rooms, [roomId]);
    assert.deepEqual(await roomBodies(hs, user.accessToken, roomId), [
      "backfilled first",
      "backfilled second",
    ]);
  } finally {
    await cleanup();
  }
});

test("a state write that invites reports the event it wrote, not the join that followed", async () => {
  // A bridgev2 bridge stores the returned id as its invite event; handed the
  // auto-join's id instead, any later correlation or redaction targets the
  // wrong event.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, asToken, {name: "Jules Tan (WA)"}, {user_id: GHOST});
    const written = await call(
      hs,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(user.userId)}`,
      {token: asToken, query: {user_id: GHOST}, body: {membership: "invite", is_direct: true}},
    );
    assert.equal(written.status, 200);

    const memberships = (await timeline(hs, user.accessToken, roomId)).filter(
      (event) => event.type === "m.room.member" && event.state_key === user.userId,
    );
    const invite = memberships.find(
      (event) => (event.content as {membership?: string}).membership === "invite",
    );
    const joinedEvent = memberships.find(
      (event) => (event.content as {membership?: string}).membership === "join",
    );
    assert.ok(invite && joinedEvent, "the hop wrote a join after the invite");
    assert.notEqual(invite.event_id, joinedEvent.event_id);
    assert.equal(written.body.event_id, invite.event_id, "the caller is told the id it created");
  } finally {
    await cleanup();
  }
});

// --- batch sending ---

test("a batch that is not a list of events is refused", async () => {
  // These branches are all that stands between a bridge's malformed backfill
  // and a room of typeless events. The partial case matters most: an entry
  // rejected midway must not leave the batch's earlier entries in the room,
  // because the bridge is told the batch failed and will send it again.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portal(hs, asToken, user);
    const batchSend = async (events: unknown): ReturnType<typeof call> =>
      call(
        hs,
        "POST",
        `/_matrix/client/unstable/com.beeper.backfill/rooms/${encodeURIComponent(roomId)}/batch_send`,
        {token: asToken, body: {events}},
      );
    const message = (body: string): Record<string, unknown> => ({
      type: "m.room.message",
      sender: GHOST,
      origin_server_ts: 1_600_000_000_000,
      content: {msgtype: "m.text", body},
    });

    const notAList = await batchSend({0: message("never-a-list")});
    assert.equal(notAList.status, 400);
    assert.equal(notAList.body.errcode, "M_BAD_JSON");

    const nullEntry = await batchSend([message("before-a-null"), null]);
    assert.equal(nullEntry.status, 400);
    assert.equal(nullEntry.body.errcode, "M_BAD_JSON");

    const senderless = await batchSend([
      message("before-a-senderless"),
      {type: "m.room.message", content: {msgtype: "m.text", body: "senderless"}},
    ]);
    assert.equal(senderless.status, 400);
    assert.equal(senderless.body.errcode, "M_BAD_JSON");

    const stored = await roomBodies(hs, user.accessToken, roomId);
    assert.deepEqual(
      stored.filter((body) => body.startsWith("before-a-") || body === "never-a-list"),
      [],
      "a refused batch appends nothing at all",
    );
  } finally {
    await cleanup();
  }
});

// --- re-registration ---

test("a bridge re-registered against a new listener is not replayed what the old one took", async () => {
  // Re-registration happens on every app start and whenever a bridge's port
  // changes. A replay here is not noise: it is every message sent again on the
  // remote network.
  const {hs, bridge, asToken, user, cleanup} = await startHarness();
  const replacement = await startFakeBridge();
  try {
    const roomId = await portal(hs, asToken, user);
    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "taken by the first listener"});
    await until(
      () => bridge.delivered().includes("taken by the first listener"),
      "the first listener's delivery",
    );

    hs.registerAppservice({
      id: "whatsapp",
      asToken,
      hsToken: "hs-token-test",
      url: replacement.base,
      senderLocalpart: "whatsappbot",
      userNamespaces: [WHATSAPP_NAMESPACE],
    });
    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "after the port moved"});
    await until(
      () => replacement.delivered().includes("after the port moved"),
      "the new listener's delivery",
    );
    assert.ok(
      !deliveredBodies(replacement.transactions).includes("taken by the first listener"),
      "the delivered backlog is not replayed to the new listener",
    );
  } finally {
    await cleanup();
    await replacement.close();
  }
});

test("a bridge registered today is not pushed yesterday's conversations", async () => {
  // The delivery position is pinned once, at registration. An overlapping
  // namespace is what makes the guarantee observable — and shows there is no
  // exclusivity check between registrations either.
  const {hs, bridge, asToken, user, cleanup} = await startHarness();
  const latecomer = await startFakeBridge();
  try {
    const roomId = await portal(hs, asToken, user);
    await sendMessage(hs, asToken, roomId, {msgtype: "m.text", body: "yesterday, inbound"}, {user_id: GHOST});
    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "yesterday, outbound"});
    await until(() => bridge.delivered().includes("yesterday, outbound"), "the existing bridge's delivery");

    hs.registerAppservice({
      id: "latecomer",
      asToken: "as-token-latecomer",
      hsToken: "hs-token-latecomer",
      url: latecomer.base,
      // Deliberately overlapping: a fresh bridge with its own namespace would
      // be uninterested for the trivial reason, which proves nothing.
      userNamespaces: [WHATSAPP_NAMESPACE],
      senderLocalpart: "latecomerbot",
    });
    const topicWritten = await call(
      hs,
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.topic`,
      {token: asToken, query: {user_id: GHOST}, body: {topic: "after the latecomer arrived"}},
    );
    assert.equal(topicWritten.status, 200);
    await until(
      () =>
        latecomer.transactions.some((transaction) =>
          transaction.events.some((event) => event.type === "m.room.topic"),
        ),
      "the latecomer to receive an event from after its registration",
    );
    assert.deepEqual(
      deliveredBodies(latecomer.transactions).filter((body) => body.startsWith("yesterday")),
      [],
      "history that predates a registration is never pushed to it",
    );
  } finally {
    await cleanup();
    await latecomer.close();
  }
});
