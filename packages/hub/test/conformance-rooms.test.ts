import assert from "node:assert/strict";
import test from "node:test";
import {call, createRoom, startHarness} from "./test-harness.js";

/**
 * Room creation, state, membership, aliases and the member-list endpoints, as
 * a bridge sees them over HTTP. Everything here is asserted through `call`
 * rather than through the store, because a mautrix binary only ever gets to
 * look at the wire: a room's state array, a status code and an errcode are the
 * whole of what it can branch on.
 */

const GHOST = "@whatsapp_61400000000:polymux.test";
const SECOND_GHOST = "@whatsapp_61400000001:polymux.test";

/** Room endpoints all hang off an encoded room id; spelling it out once. */
function room(roomId: string, suffix = ""): string {
  return `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}${suffix}`;
}

function memberPath(roomId: string, userId: string): string {
  return room(roomId, `/state/m.room.member/${encodeURIComponent(userId)}`);
}

function aliasPath(alias: string): string {
  return `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`;
}

interface ClientEvent {
  event_id?: string;
  room_id?: string;
  sender?: string;
  type?: string;
  state_key?: string;
  content?: Record<string, unknown>;
  unsigned?: {prev_content?: Record<string, unknown>; replaces_state?: string};
}

/** The whole-state array form, which is served as a bare JSON array. */
function asEvents(body: Record<string, unknown>): ClientEvent[] {
  return body as unknown as ClientEvent[];
}

function chunkOf(body: Record<string, unknown>): ClientEvent[] {
  return (body.chunk ?? []) as ClientEvent[];
}

test("a fresh room's state carries its creation, the creator's join, power levels and join rules", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {
      name: "Jules Tan (WA)",
      topic: "Bridged from WhatsApp",
    });
    const state = await call(hs, "GET", room(roomId, "/state"), {token: user.accessToken});
    assert.equal(state.status, 200);
    const events = asEvents(state.body);
    // A bridge reads this array to decide whether it still has to set the
    // portal's name and topic itself, so a missing entry makes it overwrite
    // what is already there.
    for (const type of [
      "m.room.create",
      "m.room.member",
      "m.room.power_levels",
      "m.room.join_rules",
      "m.room.name",
      "m.room.topic",
    ])
      assert.equal(
        events.filter((event) => event.type === type).length,
        1,
        `exactly one ${type} in the room's state, got ${JSON.stringify(events.map((e) => e.type))}`,
      );
    assert.equal(events[0]?.type, "m.room.create", "m.room.create is the room's first state event");
    const member = events.find((event) => event.type === "m.room.member");
    assert.equal(member?.state_key, user.userId, "the creator's own membership is in state");
    assert.equal(member?.content?.membership, "join");
  } finally {
    await cleanup();
  }
});

test("the room name in the request wins over one set through initial_state", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {
      initial_state: [{type: "m.room.name", state_key: "", content: {name: "from initial state"}}],
      name: "from name",
    });
    const name = await call(hs, "GET", room(roomId, "/state/m.room.name"), {token: user.accessToken});
    assert.equal(name.status, 200);
    assert.equal(name.body.name, "from name", "name overrides initial_state, per the creation order");

    // Both writes happened; only the ordering decides which one is current.
    const messages = await call(hs, "GET", room(roomId, "/messages"), {
      token: user.accessToken,
      query: {dir: "f", limit: "100"},
    });
    assert.deepEqual(
      chunkOf(messages.body)
        .filter((event) => event.type === "m.room.name")
        .map((event) => event.content?.name),
      ["from initial state", "from name"],
    );
  } finally {
    await cleanup();
  }
});

test("creation content survives but cannot forge the room version", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {
      creation_content: {test: "azerty", room_version: "99"},
    });
    const create = await call(hs, "GET", room(roomId, "/state/m.room.create"), {
      token: user.accessToken,
    });
    assert.equal(create.status, 200);
    assert.equal(create.body.test, "azerty", "arbitrary creation content is preserved");
    // A forged room version would make every reader mis-apply the redaction
    // algorithm and the redacts-location rule for this room.
    assert.equal(create.body.room_version, "11", "the server's own room version is not overridable");
  } finally {
    await cleanup();
  }
});

test("a room requested at an unsupported version is refused rather than quietly created at 11", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const unsupported = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: user.accessToken,
      body: {room_version: "1.4"},
    });
    assert.equal(unsupported.status, 400, "an unknown room version is refused");
    assert.equal(unsupported.body.errcode, "M_UNSUPPORTED_ROOM_VERSION");

    const malformed = await call(hs, "POST", "/_matrix/client/v3/createRoom", {
      token: user.accessToken,
      body: {room_version: 11},
    });
    assert.equal(malformed.status, 400, "a non-string room version is malformed JSON");
    assert.equal(malformed.body.errcode, "M_BAD_JSON");

    const joined = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.deepEqual(joined.body.joined_rooms, [], "a refused creation leaves no room behind");
  } finally {
    await cleanup();
  }
});

test("a public room says its history is shared", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {preset: "public_chat"});
    // Shared history is the precondition for backfill being readable by a
    // member who joined later, which is the case every portal is in.
    const visibility = await call(hs, "GET", room(roomId, "/state/m.room.history_visibility"), {
      token: user.accessToken,
    });
    assert.equal(visibility.status, 200, "a created room has an m.room.history_visibility");
    assert.equal(visibility.body.history_visibility, "shared");
  } finally {
    await cleanup();
  }
});

test("the default power levels say who may kick, ban, redact and invite", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    const levels = await call(hs, "GET", room(roomId, "/state/m.room.power_levels"), {
      token: user.accessToken,
    });
    assert.equal(levels.status, 200);
    // The values are decoration here — nothing enforces them — but a bridge
    // reads the event locally to decide whether it may rename or invite, and
    // an absent key reads as 0 or as "unknown" depending on the library.
    for (const key of [
      "ban",
      "kick",
      "redact",
      "invite",
      "events",
      "events_default",
      "state_default",
      "users",
      "users_default",
    ])
      assert.ok(key in levels.body, `m.room.power_levels carries ${key}`);
  } finally {
    await cleanup();
  }
});

test("a room created at version 11 names its creator only in the event's sender", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    const create = await call(hs, "GET", room(roomId, "/state/m.room.create"), {
      token: user.accessToken,
      query: {format: "event"},
    });
    assert.equal(create.status, 200);
    const event = create.body as ClientEvent;
    assert.equal(event.sender, user.userId, "the sender is the creator");
    // v11 removed content.creator; declaring "11" and still writing it leaves
    // a reader that trusts the declared version looking at a field we keep
    // stale, and one that does not looking at two sources of truth.
    assert.ok(
      !(event.content && "creator" in event.content),
      "m.room.create at v11 carries no content.creator",
    );
  } finally {
    await cleanup();
  }
});

test("a room id is opaque, sigilled and safe to put in a path", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    assert.ok(roomId.startsWith("!"), "room ids carry the ! sigil");
    assert.ok(Buffer.byteLength(roomId, "utf8") <= 255, "room ids fit in 255 bytes");
    assert.ok(roomId.endsWith(":polymux.test"), "room ids are scoped to this server");
    // Every later request puts this in a path segment, so a separator in the
    // localpart would route the request to the wrong handler entirely.
    const localpart = roomId.slice(1, roomId.lastIndexOf(":"));
    assert.ok(localpart.length > 0, "the localpart is not empty");
    assert.ok(!/[/:\0]/.test(localpart), `the localpart holds no separator: ${localpart}`);
  } finally {
    await cleanup();
  }
});

test("setting the same state twice returns the same event", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    const content = {name: "Jules Tan (WA)"};
    const first = await call(hs, "PUT", room(roomId, "/state/m.room.name"), {
      token: user.accessToken,
      body: content,
    });
    const second = await call(hs, "PUT", room(roomId, "/state/m.room.name"), {
      token: user.accessToken,
      body: content,
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    // Bridges re-assert a portal's name on every startup and every remote-side
    // resync; a fresh event each time is a "room renamed" transaction pushed to
    // every other bridge on each restart.
    assert.equal(second.body.event_id, first.body.event_id, "a no-op state write is deduplicated");

    const state = await call(hs, "GET", room(roomId, "/state"), {token: user.accessToken});
    assert.equal(asEvents(state.body).filter((event) => event.type === "m.room.name").length, 1);

    const messages = await call(hs, "GET", room(roomId, "/messages"), {
      token: user.accessToken,
      query: {dir: "f", limit: "100"},
    });
    assert.equal(
      chunkOf(messages.body).filter((event) => event.type === "m.room.name").length,
      1,
      "the timeline holds one m.room.name, not a duplicate per re-assertion",
    );
  } finally {
    await cleanup();
  }
});

test("a second state write replaces the first in current state and keeps both in the timeline", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    for (const topic of ["first topic", "second topic"])
      await call(hs, "PUT", room(roomId, "/state/m.room.topic"), {
        token: user.accessToken,
        body: {topic},
      });

    const state = await call(hs, "GET", room(roomId, "/state"), {token: user.accessToken});
    const topics = asEvents(state.body).filter((event) => event.type === "m.room.topic");
    assert.equal(topics.length, 1, "current state holds one topic");
    assert.equal(topics[0]?.content?.topic, "second topic", "the later write wins");

    const messages = await call(hs, "GET", room(roomId, "/messages"), {
      token: user.accessToken,
      query: {dir: "f", limit: "100"},
    });
    assert.deepEqual(
      chunkOf(messages.body)
        .filter((event) => event.type === "m.room.topic")
        .map((event) => event.content?.topic),
      ["first topic", "second topic"],
      "the timeline keeps the history the state map collapsed",
    );
  } finally {
    await cleanup();
  }
});

test("state read with format=event says who set it", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    const written = await call(hs, "PUT", room(roomId, "/state/m.room.name"), {
      token: asToken,
      query: {user_id: GHOST},
      body: {name: "Jules Tan (WA)"},
    });
    assert.equal(written.status, 200);

    // mautrix's FullStateEvent asks this way to learn who set a piece of
    // state; without a sender it cannot tell its own writes from the user's.
    const full = await call(hs, "GET", room(roomId, "/state/m.room.name"), {
      token: user.accessToken,
      query: {format: "event"},
    });
    assert.equal(full.status, 200);
    const event = full.body as ClientEvent;
    assert.equal(event.sender, GHOST, "the ghost that set the name is named");
    assert.equal(event.event_id, written.body.event_id);
    assert.equal(event.room_id, roomId);
    assert.equal(event.type, "m.room.name");
    assert.equal(event.content?.name, "Jules Tan (WA)");

    const bare = await call(hs, "GET", room(roomId, "/state/m.room.name"), {token: user.accessToken});
    assert.deepEqual(bare.body, {name: "Jules Tan (WA)"}, "without the parameter it is bare content");
  } finally {
    await cleanup();
  }
});

test("state that was never set is missing, not forbidden", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    // mautrix probes for optional state and must read this as "not set yet"
    // rather than as a failure, or it stops instead of creating it.
    const avatar = await call(hs, "GET", room(roomId, "/state/m.room.avatar"), {
      token: user.accessToken,
    });
    assert.equal(avatar.status, 404);
    assert.equal(avatar.body.errcode, "M_NOT_FOUND");
  } finally {
    await cleanup();
  }
});

test("a membership change carries the membership it replaced", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, asToken, {invite: [user.userId]}, {user_id: GHOST});
    const messages = await call(hs, "GET", room(roomId, "/messages"), {
      token: user.accessToken,
      query: {dir: "f", limit: "100"},
    });
    const changes = chunkOf(messages.body).filter(
      (event) => event.type === "m.room.member" && event.state_key === user.userId,
    );
    assert.equal(changes.length, 2, "the invite and the auto-join are both in the timeline");
    const [invite, join] = changes;
    assert.equal(invite.content?.membership, "invite");
    assert.equal(join.content?.membership, "join");
    // This is how a bridge tells a display-name change from an actual join
    // without a second state fetch.
    assert.ok(join.unsigned, "a membership event carries unsigned");
    assert.equal(join.unsigned?.prev_content?.membership, "invite");
    assert.equal(join.unsigned?.replaces_state, invite.event_id);
  } finally {
    await cleanup();
  }
});

test("joining a room twice leaves the membership event alone", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, asToken, {}, {user_id: GHOST});
    await call(hs, "POST", room(roomId, "/join"), {token: user.accessToken, body: {}});
    const first = await call(hs, "GET", memberPath(roomId, user.userId), {
      token: user.accessToken,
      query: {format: "event"},
    });
    await call(hs, "POST", room(roomId, "/join"), {token: user.accessToken, body: {}});
    const second = await call(hs, "GET", memberPath(roomId, user.userId), {
      token: user.accessToken,
      query: {format: "event"},
    });
    // A re-join per portal per restart is a state change every bridge is told
    // about, and a bridge may forward it to the remote network.
    assert.equal(
      (second.body as ClientEvent).event_id,
      (first.body as ClientEvent).event_id,
      "re-joining does not write a new membership event",
    );

    const messages = await call(hs, "GET", room(roomId, "/messages"), {
      token: user.accessToken,
      query: {dir: "f", limit: "100"},
    });
    assert.equal(
      chunkOf(messages.body).filter(
        (event) => event.type === "m.room.member" && event.state_key === user.userId,
      ).length,
      1,
      "the timeline holds one join",
    );
  } finally {
    await cleanup();
  }
});

test("banning a user records a ban, not a departure", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    for (const ghost of [GHOST, SECOND_GHOST])
      await call(hs, "POST", room(roomId, "/join"), {token: asToken, query: {user_id: ghost}, body: {}});

    const banned = await call(hs, "POST", room(roomId, "/ban"), {
      token: user.accessToken,
      body: {user_id: GHOST, reason: "spam"},
    });
    assert.equal(banned.status, 200);
    const kicked = await call(hs, "POST", room(roomId, "/kick"), {
      token: user.accessToken,
      body: {user_id: SECOND_GHOST},
    });
    assert.equal(kicked.status, 200);

    const banState = await call(hs, "GET", memberPath(roomId, GHOST), {token: user.accessToken});
    const kickState = await call(hs, "GET", memberPath(roomId, SECOND_GHOST), {token: user.accessToken});
    assert.equal(kickState.body.membership, "leave", "a kick records a departure");
    // Recording leave for both erases the ban, so re-inviting the ghost
    // succeeds where it should not — and there is no /unban to undo state
    // that was never written.
    assert.equal(banState.body.membership, "ban", "a ban is distinct from a kick");
  } finally {
    await cleanup();
  }
});

test("kicking someone who was never in the room is refused", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    const stranger = "@whatsapp_neverjoined:polymux.test";
    const kicked = await call(hs, "POST", room(roomId, "/kick"), {
      token: user.accessToken,
      body: {user_id: stranger},
    });
    assert.equal(kicked.status, 403, "a membership transition is validated against current state");

    const membership = await call(hs, "GET", memberPath(roomId, stranger), {token: user.accessToken});
    assert.equal(membership.status, 404, "no spurious leave is written for a non-member");

    // Minting the account as a side effect is the other half: the id came
    // straight off an untrusted body, and afterwards the bridge's own
    // registration of that ghost fails as M_USER_IN_USE.
    const registered = await call(hs, "POST", "/_matrix/client/v3/register", {
      token: asToken,
      body: {type: "m.login.application_service", username: "whatsapp_neverjoined", inhibit_login: true},
    });
    assert.equal(registered.status, 200, "the refused kick created no account");
  } finally {
    await cleanup();
  }
});

test("inviting a member who is already joined is refused rather than demoting them", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    await call(hs, "POST", room(roomId, "/join"), {token: asToken, query: {user_id: GHOST}, body: {}});

    const invited = await call(hs, "POST", room(roomId, "/invite"), {
      token: user.accessToken,
      body: {user_id: GHOST},
    });
    assert.equal(invited.status, 403, "a joined member cannot be invited");

    // #interested reads joined membership at delivery time, so a demoted
    // ghost quietly makes the portal one-way.
    const members = await call(hs, "GET", room(roomId, "/joined_members"), {token: user.accessToken});
    assert.ok(
      Object.keys(members.body.joined as Record<string, unknown>).includes(GHOST),
      "the ghost is still a joined member",
    );
  } finally {
    await cleanup();
  }
});

test("a user cannot invite themselves into a room they are in", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    const invited = await call(hs, "POST", room(roomId, "/invite"), {
      token: user.accessToken,
      body: {user_id: user.userId},
    });
    assert.equal(invited.status, 403, "self-invite is refused");

    // The damage would be unrecoverable: the human's join becomes an invite,
    // the room leaves /joined_rooms, and neither the invite hop nor
    // #healInvites repairs an invite the human sent themselves.
    const joined = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.deepEqual(joined.body.joined_rooms, [roomId], "the user is still in their own room");
  } finally {
    await cleanup();
  }
});

test("forgetting a room the user is still in is refused", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    // Forget is only legal from leave; answering 200 tells a client a
    // still-joined portal is gone while every message in it keeps arriving.
    const forgotten = await call(hs, "POST", room(roomId, "/forget"), {
      token: user.accessToken,
      body: {},
    });
    assert.equal(forgotten.status, 400);
    assert.equal(forgotten.body.errcode, "M_UNKNOWN");
  } finally {
    await cleanup();
  }
});

test("an alias with no room behind it is refused rather than stored", async () => {
  const {hs, asToken, cleanup} = await startHarness();
  try {
    const empty = "#whatsapp_empty:polymux.test";
    const dangling = "#whatsapp_dangling:polymux.test";

    const withoutRoom = await call(hs, "PUT", aliasPath(empty), {token: asToken, body: {}});
    assert.equal(withoutRoom.status, 400, "an alias mapping needs a room_id");

    const toNowhere = await call(hs, "PUT", aliasPath(dangling), {
      token: asToken,
      body: {room_id: "!nosuchroom:polymux.test"},
    });
    assert.ok(toNowhere.status >= 400, `an alias for a room that does not exist is refused, got ${toNowhere.status}`);

    // A silent success is worse than a refusal: the bridge believes the portal
    // is addressable and later joins whatever the mapping holds.
    for (const alias of [empty, dangling]) {
      const lookup = await call(hs, "GET", aliasPath(alias), {token: asToken});
      assert.equal(lookup.status, 404, `${alias} is left unmapped`);
    }
  } finally {
    await cleanup();
  }
});

test("deleting an alias releases it", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    const alias = "#whatsapp_portal:polymux.test";
    const mapped = await call(hs, "PUT", aliasPath(alias), {token: asToken, body: {room_id: roomId}});
    assert.equal(mapped.status, 200);

    await call(hs, "DELETE", aliasPath(alias), {token: asToken});
    // A bridge tearing a portal down cannot release its alias otherwise, and
    // re-creating that portal collides with a mapping onto a dead room.
    const lookup = await call(hs, "GET", aliasPath(alias), {token: asToken});
    assert.equal(lookup.status, 404, "the alias is released");
    assert.equal(lookup.body.errcode, "M_NOT_FOUND");

    const never = await call(hs, "DELETE", aliasPath("#whatsapp_nothing:polymux.test"), {token: asToken});
    assert.equal(never.status, 404, "deleting an alias that never existed is a miss");
  } finally {
    await cleanup();
  }
});

test("the member list narrows to the membership asked for", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken, {});
    for (const ghost of [GHOST, SECOND_GHOST])
      await call(hs, "POST", room(roomId, "/join"), {token: asToken, query: {user_id: ghost}, body: {}});
    await call(hs, "POST", room(roomId, "/leave"), {
      token: asToken,
      query: {user_id: SECOND_GHOST},
      body: {},
    });

    // A bridge reconciling a large portal's membership fetches it filtered;
    // handing back every ghost that ever left makes it re-invite all of them.
    const joined = await call(hs, "GET", room(roomId, "/members"), {
      token: user.accessToken,
      query: {membership: "join"},
    });
    const joinedKeys = chunkOf(joined.body).map((event) => event.state_key);
    assert.ok(joinedKeys.includes(GHOST), "the joined ghost is listed");
    assert.ok(!joinedKeys.includes(SECOND_GHOST), "the departed ghost is not listed as joined");

    const remaining = await call(hs, "GET", room(roomId, "/members"), {
      token: user.accessToken,
      query: {not_membership: "leave"},
    });
    const remainingKeys = chunkOf(remaining.body).map((event) => event.state_key);
    assert.ok(remainingKeys.includes(user.userId), "not_membership keeps everyone else");
    assert.ok(!remainingKeys.includes(SECOND_GHOST), "not_membership excludes the departed ghost");
  } finally {
    await cleanup();
  }
});

test("a request for a room that does not exist is forbidden rather than missing", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    // mautrix branches on the status: 403 means "not in the room, drop the
    // portal", while 404 and friends read as transient and are retried
    // forever for a portal that will never exist.
    const unknown = "!nosuchroom:polymux.test";
    const messages = await call(hs, "GET", room(unknown, "/messages"), {
      token: user.accessToken,
      query: {dir: "b"},
    });
    assert.equal(messages.status, 403);
    assert.equal(messages.body.errcode, "M_FORBIDDEN");

    const state = await call(hs, "GET", room(unknown, "/state"), {token: user.accessToken});
    assert.equal(state.status, 403);
    assert.equal(state.body.errcode, "M_FORBIDDEN");
  } finally {
    await cleanup();
  }
});

test("any token on this server may read a room it never joined", async () => {
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, asToken, {invite: [user.userId]}, {user_id: GHOST});
    const left = await call(hs, "POST", room(roomId, "/leave"), {token: user.accessToken, body: {}});
    assert.equal(left.status, 200);
    const joined = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.deepEqual(joined.body.joined_rooms, [], "the user really is out of the room");

    /**
     * A real homeserver answers 403 here. This one deliberately does not:
     * there is exactly one human, no federation and no second account to
     * protect the room from, so a membership gate could only ever lock the
     * owner out of their own history — which is precisely what a bridge
     * writing a stray leave would cause. The divergence is a decision, and
     * this pins it as one.
     */
    const messages = await call(hs, "GET", room(roomId, "/messages"), {
      token: user.accessToken,
      query: {dir: "b", limit: "100"},
    });
    assert.equal(messages.status, 200);
    assert.ok(chunkOf(messages.body).length > 0, "the room's history is still readable");

    const members = await call(hs, "GET", room(roomId, "/joined_members"), {token: user.accessToken});
    assert.equal(members.status, 200);
    assert.ok(
      Object.keys(members.body.joined as Record<string, unknown>).includes(GHOST),
      "the member list is still readable",
    );
  } finally {
    await cleanup();
  }
});
