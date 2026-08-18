import assert from "node:assert/strict";
import test from "node:test";
import {call, createRoom, sendMessage, startHarness, until, type Response} from "./test-harness.js";
import type {Homeserver} from "../src/server.js";

/**
 * Conformance for the timeline half of the client-server API: sending and its
 * transaction idempotency, redaction, `/messages` pagination and its tokens,
 * `/event` lookup, ordering, and appservice timestamp massaging.
 *
 * Every assertion is re-derived from the specification and aimed at what a
 * mautrix bridge or the hub client actually does with the answer, because a
 * divergence only matters here if some caller on this machine can be misled by
 * it. Where this server is deliberately unlike a standard homeserver — one
 * append-only stream instead of a DAG, one human who owns every token — the
 * test pins the intended behaviour and says why.
 */

const GHOST = "@whatsapp_1:flareai.test";

function roomPath(roomId: string, suffix: string): string {
  return `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/${suffix}`;
}

function pageMessages(
  hs: Homeserver,
  token: string,
  roomId: string,
  query: Record<string, string>,
): Promise<Response> {
  return call(hs, "GET", roomPath(roomId, "messages"), {token, query});
}

function chunkOf(response: Response): Array<Record<string, unknown>> {
  return (response.body.chunk ?? []) as Array<Record<string, unknown>>;
}

function bodiesOf(events: Array<Record<string, unknown>>): string[] {
  return events
    .filter((event) => event.type === "m.room.message")
    .map((event) => (event.content as {body?: string}).body ?? "");
}

/** Every event in a room, oldest first — the yardstick most assertions need. */
async function wholeTimeline(
  hs: Homeserver,
  token: string,
  roomId: string,
): Promise<Array<Record<string, unknown>>> {
  return chunkOf(await pageMessages(hs, token, roomId, {dir: "f", limit: "1000"}));
}

/** A raw request, for the bodies and content types `call` cannot express. */
async function rawSend(
  hs: Homeserver,
  endpoint: string,
  token: string,
  contentType: string,
  body: string,
): Promise<Response> {
  const response = await fetch(`${hs.baseUrl}${endpoint}`, {
    method: "PUT",
    headers: {Authorization: `Bearer ${token}`, "Content-Type": contentType},
    body,
  });
  const text = await response.text();
  return {status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {}};
}

/** A portal room the bridge is in: a ghost creates it and invites the user. */
async function portalRoom(hs: Homeserver, asToken: string, userId: string): Promise<string> {
  return createRoom(hs, asToken, {invite: [userId], is_direct: true}, {user_id: GHOST});
}

// --- transactions ---

test("the same transaction id in another room is a different message", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomA = await createRoom(hs, user.accessToken);
    const roomB = await createRoom(hs, user.accessToken);
    const first = await call(hs, "PUT", roomPath(roomA, "send/m.room.message/abc"), {
      token: user.accessToken,
      body: {msgtype: "m.text", body: "in room A"},
    });
    const second = await call(hs, "PUT", roomPath(roomB, "send/m.room.message/abc"), {
      token: user.accessToken,
      body: {msgtype: "m.text", body: "in room B"},
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.notEqual(
      second.body.event_id,
      first.body.event_id,
      "a transaction id is scoped to the path it was used on, and the room id is part of that path",
    );
    assert.deepEqual(bodiesOf(await wholeTimeline(hs, user.accessToken, roomA)), ["in room A"]);
    assert.deepEqual(bodiesOf(await wholeTimeline(hs, user.accessToken, roomB)), ["in room B"]);
  } finally {
    await cleanup();
  }
});

test("a redaction reusing an earlier send's transaction id still retracts", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    const sent = await call(hs, "PUT", roomPath(roomId, "send/m.room.message/t1"), {
      token: user.accessToken,
      body: {msgtype: "m.text", body: "said too much"},
    });
    const target = String(sent.body.event_id);
    const redaction = await call(
      hs,
      "PUT",
      roomPath(roomId, `redact/${encodeURIComponent(target)}/t1`),
      {token: user.accessToken, body: {}},
    );
    assert.equal(redaction.status, 200);
    assert.notEqual(
      redaction.body.event_id,
      target,
      "/send and /redact are separate endpoints, so one transaction id cannot collide across them",
    );
    const timeline = await wholeTimeline(hs, user.accessToken, roomId);
    assert.ok(
      timeline.some((event) => event.type === "m.room.redaction"),
      "the retraction reaches the timeline rather than reporting success and doing nothing",
    );
  } finally {
    await cleanup();
  }
});

test("a replayed transaction keeps the first body it was given", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    const first = await call(hs, "PUT", roomPath(roomId, "send/m.room.message/t2"), {
      token: user.accessToken,
      body: {msgtype: "m.text", body: "the message that was sent"},
    });
    // Identity is the transaction id, never the content: a server that keyed on
    // a content hash would duplicate on the network instead of losing the
    // second body, which is the trade the specification deliberately makes.
    const replay = await call(hs, "PUT", roomPath(roomId, "send/m.room.message/t2"), {
      token: user.accessToken,
      body: {msgtype: "m.text", body: "a different body under the same id"},
    });
    assert.equal(replay.body.event_id, first.body.event_id);
    const stored = await call(hs, "GET", roomPath(roomId, `event/${encodeURIComponent(String(first.body.event_id))}`), {
      token: user.accessToken,
    });
    assert.equal((stored.body.content as {body: string}).body, "the message that was sent");
    assert.deepEqual(bodiesOf(await wholeTimeline(hs, user.accessToken, roomId)), [
      "the message that was sent",
    ]);
  } finally {
    await cleanup();
  }
});

test("two tokens for the one account share a transaction scope", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    // Idempotency belongs to a device in the specification. Keying it on the
    // user is coarser, and correct here: every token this server ever issues
    // belongs to the one human on this machine, so collapsing them can only
    // prevent a duplicate send, never swallow somebody else's message.
    const refreshed = hs.createLocalUser("flareai");
    assert.equal(refreshed.userId, user.userId);
    assert.notEqual(refreshed.accessToken, user.accessToken);
    const roomId = await createRoom(hs, user.accessToken);
    const first = await call(hs, "PUT", roomPath(roomId, "send/m.room.message/t3"), {
      token: user.accessToken,
      body: {msgtype: "m.text", body: "sent before the token was refreshed"},
    });
    const afterRefresh = await call(hs, "PUT", roomPath(roomId, "send/m.room.message/t3"), {
      token: refreshed.accessToken,
      body: {msgtype: "m.text", body: "sent before the token was refreshed"},
    });
    assert.equal(afterRefresh.body.event_id, first.body.event_id);
    assert.deepEqual(bodiesOf(await wholeTimeline(hs, user.accessToken, roomId)), [
      "sent before the token was refreshed",
    ]);
  } finally {
    await cleanup();
  }
});

test("a sent event comes back carrying the transaction id that made it", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    const sent = await call(hs, "PUT", roomPath(roomId, "send/m.room.message/t4"), {
      token: user.accessToken,
      body: {msgtype: "m.text", body: "typed in flareai"},
    });
    const eventId = String(sent.body.event_id);
    // The only way a client reconciles its optimistic local echo with the
    // server's copy; without it the hub draws every message it sends twice.
    const fetched = await call(hs, "GET", roomPath(roomId, `event/${encodeURIComponent(eventId)}`), {
      token: user.accessToken,
    });
    assert.equal((fetched.body.unsigned as {transaction_id?: string} | undefined)?.transaction_id, "t4");
    const timeline = await wholeTimeline(hs, user.accessToken, roomId);
    const echoed = timeline.find((event) => event.event_id === eventId)!;
    assert.equal((echoed.unsigned as {transaction_id?: string} | undefined)?.transaction_id, "t4");
  } finally {
    await cleanup();
  }
});

// --- redaction ---

test("a redacted message keeps its event but loses its body", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    const eventId = await sendMessage(hs, user.accessToken, roomId, {
      msgtype: "m.text",
      body: "please forget this",
    });
    const before = await call(hs, "GET", roomPath(roomId, `event/${encodeURIComponent(eventId)}`), {
      token: user.accessToken,
    });
    await call(hs, "PUT", roomPath(roomId, `redact/${encodeURIComponent(eventId)}/r1`), {
      token: user.accessToken,
      body: {},
    });

    const after = await call(hs, "GET", roomPath(roomId, `event/${encodeURIComponent(eventId)}`), {
      token: user.accessToken,
    });
    assert.deepEqual(after.body.content, {}, "a redacted event is stripped of its content");
    assert.equal(after.body.event_id, before.body.event_id);
    assert.equal(after.body.type, before.body.type);
    assert.equal(after.body.sender, before.body.sender);
    assert.equal(after.body.origin_server_ts, before.body.origin_server_ts);
    const timeline = await wholeTimeline(hs, user.accessToken, roomId);
    const paged = timeline.find((event) => event.event_id === eventId)!;
    assert.deepEqual(paged.content, {}, "the timeline serves the stripped copy too");
  } finally {
    await cleanup();
  }
});

test("a redaction names its target inside its content", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    const target = await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "spammy"});
    const redaction = await call(hs, "PUT", roomPath(roomId, `redact/${encodeURIComponent(target)}/r2`), {
      token: user.accessToken,
      body: {reason: "spam"},
    });
    const fetched = await call(
      hs,
      "GET",
      roomPath(roomId, `event/${encodeURIComponent(String(redaction.body.event_id))}`),
      {token: user.accessToken},
    );
    const content = fetched.body.content as {redacts?: string; reason?: string};
    // Room version 11 moved the target into the content, and bridgev2 reads it
    // there for a v11 room; a redaction with no target it can see is dropped.
    assert.equal(content.redacts, target, "room version 11 carries the target in content.redacts");
    assert.equal(fetched.body.redacts, target, "the pre-v11 top-level target stays for older readers");
    assert.equal(content.reason, "spam", "the reason the user gave survives");
  } finally {
    await cleanup();
  }
});

test("a redacted event says what redacted it", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    const target = await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "regretted"});
    const redaction = await call(hs, "PUT", roomPath(roomId, `redact/${encodeURIComponent(target)}/r3`), {
      token: user.accessToken,
      body: {reason: "sent by mistake"},
    });
    const fetched = await call(hs, "GET", roomPath(roomId, `event/${encodeURIComponent(target)}`), {
      token: user.accessToken,
    });
    // Without this a reader cannot tell a redacted event from one that
    // genuinely had empty content, and the reason never reaches the UI.
    const because = (fetched.body.unsigned as {redacted_because?: Record<string, unknown>} | undefined)
      ?.redacted_because;
    assert.ok(because, "unsigned.redacted_because holds the redaction");
    assert.equal(because.event_id, redaction.body.event_id);
    assert.equal(because.type, "m.room.redaction");
    assert.equal((because.content as {reason?: string}).reason, "sent by mistake");
  } finally {
    await cleanup();
  }
});

test("a redaction sent as an ordinary message event still retracts", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    const target = await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "to be pulled"});
    // Clients may redact through the ordinary send endpoint in every room
    // version, so a server that only understands /redact is inert on this path.
    const redaction = await call(hs, "PUT", roomPath(roomId, "send/m.room.redaction/r4"), {
      token: user.accessToken,
      body: {redacts: target},
    });
    assert.equal(redaction.status, 200);
    const redacted = await call(hs, "GET", roomPath(roomId, `event/${encodeURIComponent(target)}`), {
      token: user.accessToken,
    });
    assert.deepEqual(redacted.body.content, {}, "the target is stripped however the redaction arrived");
    const served = await call(
      hs,
      "GET",
      roomPath(roomId, `event/${encodeURIComponent(String(redaction.body.event_id))}`),
      {token: user.accessToken},
    );
    assert.equal(served.body.redacts, target, "the target is recorded at the top level");
    assert.equal((served.body.content as {redacts?: string}).redacts, target);
  } finally {
    await cleanup();
  }
});

test("redacting a membership does not eject the member", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portalRoom(hs, asToken, user.userId);
    const ghostMember = await call(
      hs,
      "GET",
      roomPath(roomId, `state/m.room.member/${encodeURIComponent(GHOST)}`),
      {token: user.accessToken, query: {format: "event"}},
    );
    const memberEventId = String(ghostMember.body.event_id);
    await call(hs, "PUT", roomPath(roomId, `redact/${encodeURIComponent(memberEventId)}/r5`), {
      token: user.accessToken,
      body: {},
    });

    // Version 11 keeps `membership` through a redaction. Whoever implements
    // stripping must not write the naive "empty the content" version, which
    // would eject every member the moment anyone redacted a member event.
    const membership = await call(
      hs,
      "GET",
      roomPath(roomId, `state/m.room.member/${encodeURIComponent(GHOST)}`),
      {token: user.accessToken},
    );
    assert.equal((membership.body as {membership?: string}).membership, "join");
    const joined = await call(hs, "GET", roomPath(roomId, "joined_members"), {token: user.accessToken});
    assert.ok(Object.keys(joined.body.joined as Record<string, unknown>).includes(GHOST));
  } finally {
    await cleanup();
  }
});

// --- pagination ---

test("paging back to the start of a room yields every event exactly once", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    for (let index = 0; index < 25; index += 1)
      await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: `message ${index}`});
    const forward = (await wholeTimeline(hs, user.accessToken, roomId)).map((event) => event.event_id);

    // Exactly the loop the hub's conversation view walks. An off-by-one between
    // `<` and `<=` in the token comparison drops or duplicates one event per
    // page, which over a long chat is dozens of wrong messages.
    const walked: unknown[] = [];
    let from: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const response = await pageMessages(hs, user.accessToken, roomId, {
        dir: "b",
        limit: "10",
        ...(from ? {from} : {}),
      });
      const events = chunkOf(response);
      if (events.length === 0) break;
      walked.push(...events.map((event) => event.event_id));
      const end = response.body.end;
      if (typeof end !== "string") break;
      from = end;
    }
    assert.deepEqual(walked, [...forward].reverse(), "the walk is strictly reverse stream order");
    assert.equal(new Set(walked).size, walked.length, "no page boundary repeats an event");
    assert.equal(walked.length, forward.length, "and none is skipped");
  } finally {
    await cleanup();
  }
});

test("the last page back stops advertising more to come", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    for (let index = 0; index < 3; index += 1)
      await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: `message ${index}`});

    let from: string | undefined;
    let final: Response | undefined;
    for (let page = 0; page < 10; page += 1) {
      const response = await pageMessages(hs, user.accessToken, roomId, {
        dir: "b",
        limit: "3",
        ...(from ? {from} : {}),
      });
      const events = chunkOf(response);
      if (events.some((event) => event.type === "m.room.create")) {
        final = response;
        break;
      }
      const end = response.body.end;
      assert.equal(typeof end, "string", "a page with more behind it advertises a token");
      from = end as string;
    }
    assert.ok(final, "the walk reached the page holding m.room.create");
    // `end` is the only loop-termination signal a paginating client has, so a
    // token for a position with nothing before it makes the conversation view
    // offer to load older messages forever.
    assert.equal(final.body.end, undefined, "the page that reaches the start of the room omits end");
  } finally {
    await cleanup();
  }
});

test("the token a backwards page starts at is the live edge, not the beginning of the room", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    for (let index = 0; index < 8; index += 1)
      await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: `message ${index}`});

    const first = await pageMessages(hs, user.accessToken, roomId, {dir: "b", limit: "5"});
    const start = first.body.start;
    assert.equal(typeof start, "string", "start is a required field");
    // A client catching up forward from `start` must not be handed the room's
    // whole history to re-render, which is what a literal "t0" produces.
    const forward = await pageMessages(hs, user.accessToken, roomId, {
      dir: "f",
      from: start as string,
      limit: "100",
    });
    assert.deepEqual(
      chunkOf(forward).map((event) => event.event_id),
      [],
      "nothing is newer than the position a backwards page started at",
    );
  } finally {
    await cleanup();
  }
});

test("a pagination token that is not a token is refused", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "history worth keeping"});
    const response = await pageMessages(hs, user.accessToken, roomId, {dir: "b", from: "abc"});
    // An empty chunk with no `end` is indistinguishable from "you have reached
    // the end of the timeline", so a bridge with a corrupted token silently
    // truncates its backfill instead of reporting the bad token.
    assert.equal(response.status, 400);
    assert.equal(response.body.errcode, "M_INVALID_PARAM");
  } finally {
    await cleanup();
  }
});

test("paging stops at the `to` token it was given", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    for (let index = 0; index < 10; index += 1)
      await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: `message ${index}`});

    // Two real tokens naming positions inside the room, taken the only way a
    // client can take them: off the `end` of a page.
    const head = await pageMessages(hs, user.accessToken, roomId, {dir: "f", limit: "4"});
    const tA = String(head.body.end);
    const middle = await pageMessages(hs, user.accessToken, roomId, {dir: "f", from: tA, limit: "5"});
    const tB = String(middle.body.end);
    const reached = bodiesOf(chunkOf(middle));

    const gap = await pageMessages(hs, user.accessToken, roomId, {
      dir: "f",
      from: tA,
      to: tB,
      limit: "100",
    });
    const filled = bodiesOf(chunkOf(gap));
    assert.ok(filled.length > 0, "the gap between the two positions is served");
    for (const body of filled)
      assert.ok(
        reached.includes(body),
        `the chunk stops at the \`to\` token rather than running past it: ${body}`,
      );
  } finally {
    await cleanup();
  }
});

test("a direction that is neither back nor forward is refused", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    await sendMessage(hs, user.accessToken, roomId, {msgtype: "m.text", body: "only one message"});
    // Coercing anything that is not `f` to `b` hands a bridge backfilling with
    // a typo'd direction its history in the opposite order, with nothing in the
    // response to notice. The hub only ever sends `dir=b`, so refusing is free.
    const sideways = await pageMessages(hs, user.accessToken, roomId, {dir: "sideways"});
    assert.equal(sideways.status, 400, "an unknown direction is a bad request");
    const shouty = await pageMessages(hs, user.accessToken, roomId, {dir: "F"});
    assert.equal(shouty.status, 400, "the direction is case-sensitive: only b and f");
  } finally {
    await cleanup();
  }
});

// --- /event lookup, shaping and ordering ---

test("an event id from another room is not found", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomA = await createRoom(hs, user.accessToken);
    const roomB = await createRoom(hs, user.accessToken);
    const eventId = await sendMessage(hs, user.accessToken, roomA, {
      msgtype: "m.text",
      body: "only in room A",
    });

    // mautrix fetches events by id when resolving replies and edits; an id that
    // resolved across rooms would let a bridge read a portal it is not in.
    const crossRoom = await call(hs, "GET", roomPath(roomB, `event/${encodeURIComponent(eventId)}`), {
      token: user.accessToken,
    });
    assert.equal(crossRoom.status, 404);
    assert.equal(crossRoom.body.errcode, "M_NOT_FOUND");
    const missing = await call(hs, "GET", roomPath(roomA, "event/$never-issued"), {
      token: user.accessToken,
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.errcode, "M_NOT_FOUND");

    const found = await call(hs, "GET", roomPath(roomA, `event/${encodeURIComponent(eventId)}`), {
      token: user.accessToken,
    });
    assert.equal(found.status, 200);
    assert.equal(found.body.event_id, eventId);
    assert.equal(found.body.room_id, roomA);
    assert.equal(found.body.sender, user.userId);
    assert.equal(found.body.type, "m.room.message");
    assert.equal(typeof found.body.origin_server_ts, "number");
    assert.equal((found.body.content as {body: string}).body, "only in room A");
  } finally {
    await cleanup();
  }
});

test("a message event carries no state key at all", async () => {
  const {hs, bridge, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portalRoom(hs, asToken, user.userId);
    const eventId = await sendMessage(hs, user.accessToken, roomId, {
      msgtype: "m.text",
      body: "reply from flareai",
    });
    await call(hs, "PUT", roomPath(roomId, "state/m.room.topic"), {
      token: asToken,
      query: {user_id: GHOST},
      body: {topic: "a portal"},
    });

    const timeline = await wholeTimeline(hs, user.accessToken, roomId);
    const message = timeline.find((event) => event.event_id === eventId)!;
    // The appservice specification names the presence of `state_key` as the
    // discriminator bridges use to tell state from messages, so an empty string
    // on a message makes a bridge treat it as bookkeeping and never send it.
    assert.ok(!("state_key" in message), "a message event has no state_key property");
    const member = timeline.find((event) => event.type === "m.room.member")!;
    assert.ok("state_key" in member, "a member event in the same chunk has one");
    assert.equal(typeof member.state_key, "string");
    const topic = timeline.find((event) => event.type === "m.room.topic")!;
    assert.equal(topic.state_key, "", "state written with no state key reports an empty one");

    await until(
      () => bridge.transactions.some((txn) => txn.events.some((event) => event.event_id === eventId)),
      "the user's send to be pushed to the bridge",
    );
    const pushed = bridge.transactions
      .flatMap((txn) => txn.events)
      .find((event) => event.event_id === eventId)!;
    assert.ok(!("state_key" in pushed), "and the pushed copy has none either");
  } finally {
    await cleanup();
  }
});

test("the timeline reads in the order events arrived, not by timestamp", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portalRoom(hs, asToken, user.userId);
    // There is no DAG here, only one append-only stream, so insertion order is
    // the timeline and a batch reads back exactly as it was handed over.
    // Sorting reads by origin_server_ts would reorder every backfilled chat.
    const batch = await call(
      hs,
      "POST",
      `/_matrix/client/unstable/com.beeper.backfill/rooms/${encodeURIComponent(roomId)}/batch_send`,
      {
        token: asToken,
        body: {
          events: [
            {type: "m.room.message", sender: GHOST, origin_server_ts: 3_000, content: {msgtype: "m.text", body: "newest"}},
            {type: "m.room.message", sender: GHOST, origin_server_ts: 2_000, content: {msgtype: "m.text", body: "middle"}},
            {type: "m.room.message", sender: GHOST, origin_server_ts: 1_000, content: {msgtype: "m.text", body: "oldest"}},
          ],
        },
      },
    );
    assert.equal(batch.status, 200);
    const timeline = await wholeTimeline(hs, user.accessToken, roomId);
    const backfilled = timeline.filter((event) => event.type === "m.room.message");
    assert.deepEqual(bodiesOf(backfilled), ["newest", "middle", "oldest"]);
    assert.deepEqual(
      backfilled.map((event) => event.origin_server_ts),
      [3_000, 2_000, 1_000],
      "each event keeps the timestamp it was submitted with",
    );
  } finally {
    await cleanup();
  }
});

// --- timestamp massaging ---

test("an appservice's timestamp massaging is refused to the user's own client", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    // If a client token could set its own times the hub could write a message
    // into the past, and read state keyed on stream position would stop
    // agreeing with the order the user sees.
    const mine = await sendMessage(
      hs,
      user.accessToken,
      roomId,
      {msgtype: "m.text", body: "typed just now"},
      {ts: "1000"},
    );
    const stored = await call(hs, "GET", roomPath(roomId, `event/${encodeURIComponent(mine)}`), {
      token: user.accessToken,
    });
    const ts = stored.body.origin_server_ts as number;
    assert.notEqual(ts, 1000, "a client token cannot backdate its own send");
    assert.ok(Math.abs(Date.now() - ts) < 60_000, `the server stamped it with now, got ${ts}`);

    const bridged = await sendMessage(
      hs,
      asToken,
      roomId,
      {msgtype: "m.text", body: "imported from history"},
      {user_id: GHOST, ts: "1000"},
    );
    const backfilled = await call(hs, "GET", roomPath(roomId, `event/${encodeURIComponent(bridged)}`), {
      token: user.accessToken,
    });
    assert.equal(backfilled.body.origin_server_ts, 1000, "backfill needs the privilege, so it keeps it");
  } finally {
    await cleanup();
  }
});

test("a timestamp that is not a timestamp is refused rather than replaced with now", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portalRoom(hs, asToken, user.userId);
    const before = (await wholeTimeline(hs, user.accessToken, roomId)).length;
    // Falling back to Date.now() lets a bridge with a malformed ts stamp a year
    // of imported history with today's date — and answer 200 to say it worked.
    for (const ts of ["notanumber", "-5"]) {
      const sent = await call(hs, "PUT", roomPath(roomId, `send/m.room.message/bad-${ts}`), {
        token: asToken,
        query: {user_id: GHOST, ts},
        body: {msgtype: "m.text", body: `stamped with ${ts}`},
      });
      assert.equal(sent.status, 400, `ts=${ts} is not a timestamp`);
    }
    assert.equal(
      (await wholeTimeline(hs, user.accessToken, roomId)).length,
      before,
      "a refused send appends nothing",
    );
  } finally {
    await cleanup();
  }
});

test("a portal's creation state may be stamped with the chat's own start time", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    // A deliberate extension: the specification allows `ts` only on /send and
    // /state, but a portal built from years-old history whose creation events
    // are stamped today sorts above every live chat. Nothing federates here for
    // the stamp to mislead, and only bridges the user installed can set it.
    const roomId = await createRoom(
      hs,
      asToken,
      {invite: [user.userId], is_direct: true},
      {user_id: GHOST, ts: "1600000000000"},
    );
    const create = await call(hs, "GET", roomPath(roomId, "state/m.room.create"), {
      token: user.accessToken,
      query: {format: "event"},
    });
    assert.equal(create.body.origin_server_ts, 1_600_000_000_000);
    const creatorJoin = await call(
      hs,
      "GET",
      roomPath(roomId, `state/m.room.member/${encodeURIComponent(GHOST)}`),
      {token: user.accessToken, query: {format: "event"}},
    );
    assert.equal(creatorJoin.body.origin_server_ts, 1_600_000_000_000);
  } finally {
    await cleanup();
  }
});

// --- request validation ---

test("a send whose body is not JSON is refused rather than stored blank", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    const before = (await wholeTimeline(hs, user.accessToken, roomId)).length;
    // Substituting {} for a body that would not parse is the worst outcome
    // available: the caller is told 200 and a bodyless message lands in the
    // user's timeline, where a 400 would have been a bug the bridge can log.
    const malformed = await rawSend(
      hs,
      roomPath(roomId, "send/m.room.message/bad-json"),
      user.accessToken,
      "application/json",
      "{not json",
    );
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.errcode, "M_NOT_JSON");
    const plainText = await rawSend(
      hs,
      roomPath(roomId, "send/m.room.message/plain-text"),
      user.accessToken,
      "text/plain",
      "hello",
    );
    assert.equal(plainText.status, 400, "a body that is not JSON at all is refused too");
    assert.equal(
      (await wholeTimeline(hs, user.accessToken, roomId)).length,
      before,
      "neither request appends an event",
    );
  } finally {
    await cleanup();
  }
});

test("an event larger than the wire limit is refused", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    // Bridges paste long remote messages verbatim, and mautrix's own size
    // checks are calibrated to the 413. Storing a 70KB event gives the bridge
    // no signal to truncate and produces something no other server would take.
    const oversized = {msgtype: "m.text", body: "x".repeat(70_000)};
    const sent = await call(hs, "PUT", roomPath(roomId, "send/m.room.message/too-big"), {
      token: user.accessToken,
      body: oversized,
    });
    assert.equal(sent.status, 413, "an event over 65536 bytes is too large");
    const state = await call(hs, "PUT", roomPath(roomId, "state/m.room.topic"), {
      token: user.accessToken,
      body: {topic: "y".repeat(70_000)},
    });
    assert.equal(state.status, 413, "and so is oversized state");
  } finally {
    await cleanup();
  }
});
