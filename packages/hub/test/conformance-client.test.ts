import assert from "node:assert/strict";
import test from "node:test";
import {call, createRoom, sendMessage, startHarness, type Response} from "./test-harness.js";
import type {Homeserver} from "../src/server.js";

/**
 * Conformance for the client half of the client-server API: the token and
 * session endpoints, the version and capability handshake every mautrix binary
 * opens with, profiles, account data, media, search, notifications, and the
 * `/sync` snapshot the hub's whole chat list is drawn from.
 *
 * Every assertion is re-derived from the specification and pointed at what a
 * bridge or the hub actually does with the answer, because on a loopback,
 * single-user, non-federating server a divergence only matters if some caller
 * on this machine can be misled by it. Where the divergence is deliberate —
 * profiles behind the one auth gate, a `/sync` that is a snapshot rather than a
 * stream, a thumbnail that is the original — the test pins the intended
 * behaviour and says what it costs.
 */

const GHOST = "@whatsapp_1:polymux.test";
const SECOND_GHOST = "@whatsapp_2:polymux.test";

function roomPath(roomId: string, suffix: string): string {
  return `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/${suffix}`;
}

function profilePath(userId: string, field?: string): string {
  return `/_matrix/client/v3/profile/${encodeURIComponent(userId)}${field ? `/${field}` : ""}`;
}

function accountDataPath(userId: string, type: string, roomId?: string): string {
  const scope = roomId ? `/rooms/${encodeURIComponent(roomId)}` : "";
  return `/_matrix/client/v3/user/${encodeURIComponent(userId)}${scope}/account_data/${type}`;
}

/** A portal room the bridge owns: a ghost creates it and invites the user. */
function portalRoom(hs: Homeserver, asToken: string, userId: string, name?: string): Promise<string> {
  return createRoom(hs, asToken, {invite: [userId], is_direct: true, ...(name ? {name} : {})}, {user_id: GHOST});
}

/** Sends as a ghost, which is what every inbound bridged message looks like. */
function ghostSays(hs: Homeserver, asToken: string, roomId: string, body: string): Promise<string> {
  return sendMessage(hs, asToken, roomId, {msgtype: "m.text", body}, {user_id: GHOST});
}

interface SyncRoom {
  state: {events: Array<Record<string, unknown>>};
  timeline: {events: Array<Record<string, unknown>>};
  unread_notifications: {notification_count: number};
  summary: Record<string, number>;
}

function syncJoin(sync: Response): Record<string, SyncRoom> {
  return ((sync.body.rooms ?? {}) as {join?: Record<string, SyncRoom>}).join ?? {};
}

function bodiesOf(events: Array<Record<string, unknown>>): string[] {
  return events
    .filter((event) => event.type === "m.room.message")
    .map((event) => (event.content as {body?: string}).body ?? "");
}

/** Media needs the raw response: headers and bytes are the whole assertion. */
async function fetchMedia(
  hs: Homeserver,
  endpoint: string,
  token?: string,
): Promise<{status: number; headers: Headers; bytes: Buffer}> {
  const response = await fetch(`${hs.baseUrl}${endpoint}`, {
    headers: token ? {Authorization: `Bearer ${token}`} : {},
  });
  return {
    status: response.status,
    headers: response.headers,
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

/**
 * Uploads bytes and reports whether an answer came back at all. The deadline is
 * not politeness: one of the upload paths below leaves the request unanswered
 * forever, and a suite that waits on it stops being a suite.
 */
async function uploadMedia(
  hs: Homeserver,
  endpoint: string,
  token: string,
  payload: Buffer<ArrayBuffer>,
  contentType?: string,
): Promise<{status: number; mediaId: string; answered: boolean}> {
  try {
    const response = await fetch(`${hs.baseUrl}${endpoint}`, {
      method: "POST",
      // A raw buffer body carries no implicit content type, which is exactly
      // the shape a bridge uploading an opaque attachment produces.
      headers: {Authorization: `Bearer ${token}`, ...(contentType ? {"Content-Type": contentType} : {})},
      body: payload,
      signal: AbortSignal.timeout(3_000),
    });
    const body = (await response.json()) as {content_uri?: string};
    return {
      status: response.status,
      mediaId: (body.content_uri ?? "").split("/").pop() ?? "",
      answered: true,
    };
  } catch {
    return {status: 0, mediaId: "", answered: false};
  }
}

// --- auth and tokens ---

test("a token the server does not know is unknown, not missing", async () => {
  // Clients branch on these two errcodes: unknown means re-authenticate,
  // missing means the request was malformed. Collapsing both into
  // M_MISSING_TOKEN leaves a bridge whose token was revoked retrying the same
  // dead credential forever instead of registering a new one.
  const {hs, cleanup} = await startHarness();
  try {
    const anonymous = await call(hs, "GET", "/_matrix/client/v3/joined_rooms");
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.errcode, "M_MISSING_TOKEN");

    const stranger = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: "not-a-token"});
    assert.equal(stranger.status, 401);
    assert.equal(
      stranger.body.errcode,
      "M_UNKNOWN_TOKEN",
      "a token that was presented but is not ours is unknown, not missing",
    );
  } finally {
    await cleanup();
  }
});

test("an unknown endpoint answers the same whether or not a token comes with it", async () => {
  // mautrix probes for unstable endpoints and reads 404/M_UNRECOGNIZED as "use
  // the fallback". An ambiguous 401 from the blanket auth gate can make it
  // disable a feature this server does in fact support.
  const {hs, user, cleanup} = await startHarness();
  try {
    const authenticated = await call(hs, "GET", "/_matrix/client/v3/no_such_thing", {
      token: user.accessToken,
    });
    assert.equal(authenticated.status, 404);
    assert.equal(authenticated.body.errcode, "M_UNRECOGNIZED");

    const anonymous = await call(hs, "GET", "/_matrix/client/v3/no_such_thing");
    assert.equal(
      anonymous.status,
      404,
      "an endpoint that does not exist is absent before it is protected",
    );
    assert.equal(anonymous.body.errcode, "M_UNRECOGNIZED");
  } finally {
    await cleanup();
  }
});

test("logging out kills the token it was called with", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const before = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.equal(before.status, 200);

    const logout = await call(hs, "POST", "/_matrix/client/v3/logout", {token: user.accessToken});
    assert.equal(logout.status, 200);

    const after = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.equal(after.status, 401, "a token that outlives its logout cannot be revoked any other way");
  } finally {
    await cleanup();
  }
});

test("logging out everywhere kills every token the account has", async () => {
  // createLocalUser mints a fresh token on every call and never deduplicates,
  // so the tokens it leaves behind are exactly what /logout/all exists to clear.
  const {hs, user, cleanup} = await startHarness();
  try {
    const second = hs.createLocalUser("polymux");
    assert.equal(second.userId, user.userId, "both tokens belong to the one human account");

    const logout = await call(hs, "POST", "/_matrix/client/v3/logout/all", {token: user.accessToken});
    assert.equal(logout.status, 200);

    const first = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.equal(first.status, 401);
    const other = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: second.accessToken});
    assert.equal(other.status, 401, "logging out everywhere leaves no session behind");
  } finally {
    await cleanup();
  }
});

// --- versions and capabilities ---

test("every advertised version is a version and every unstable flag is a boolean", async () => {
  // This is the first request every mautrix binary makes, and it feature-gates
  // batch sending and timestamp massaging off exactly these strings and flags.
  // A flag that ever became a string or a number silently disables backfill,
  // which surfaces as chats with no history and no error anywhere.
  const {hs, cleanup} = await startHarness();
  try {
    const versions = await call(hs, "GET", "/_matrix/client/versions");
    assert.equal(versions.status, 200, "the handshake predates any token");
    const advertised = versions.body.versions as string[];
    assert.ok(Array.isArray(advertised) && advertised.length > 0);
    for (const version of advertised)
      assert.match(version, /^(r0\.\d+\.\d+|v\d+\.\d+)$/, `${version} is not a spec version string`);

    const unstable = versions.body.unstable_features as Record<string, unknown>;
    for (const [flag, value] of Object.entries(unstable))
      assert.equal(typeof value, "boolean", `${flag} must be strictly a boolean`);
  } finally {
    await cleanup();
  }
});

test("capabilities need a token and offer one room version", async () => {
  const {hs, user, cleanup} = await startHarness();
  try {
    const anonymous = await call(hs, "GET", "/_matrix/client/v3/capabilities");
    assert.equal(anonymous.status, 401);

    const capabilities = (
      await call(hs, "GET", "/_matrix/client/v3/capabilities", {token: user.accessToken})
    ).body.capabilities as Record<string, Record<string, unknown>>;
    const versions = capabilities["m.room_versions"];
    assert.equal(versions.default, "11", "a bridge creating a portal without naming a version gets this");
    assert.ok((versions.available as Record<string, string>)["11"]);
    // Omitting m.change_password is right rather than incomplete: password
    // login is refused outright here, so advertising a password-change
    // capability would describe a ceremony that does not exist.
    assert.equal(capabilities["m.change_password"], undefined);
  } finally {
    await cleanup();
  }
});

// --- profiles ---

test("reading a profile still needs a token", async () => {
  // A deliberate divergence: the spec makes profiles public, but this server
  // binds to loopback for one human and has no anonymous callers to serve, so
  // routing profiles behind the one auth gate is a smaller surface rather than
  // a missing feature.
  const {hs, user, cleanup} = await startHarness();
  try {
    const anonymous = await call(hs, "GET", profilePath(user.userId, "displayname"));
    assert.equal(anonymous.status, 401);
    const authenticated = await call(hs, "GET", profilePath(user.userId, "displayname"), {
      token: user.accessToken,
    });
    assert.equal(authenticated.status, 200);
  } finally {
    await cleanup();
  }
});

test("a ghost with no profile yet reads as an empty profile, not a missing one", async () => {
  // mautrix reads a ghost's profile before it has ever set one and treats a
  // failed GET as an error rather than as empty, so 200-with-nothing is the
  // intended answer. The cost is that the hub's hasBridgeBot() consequently
  // answers true for any localpart at all — a fix that belongs in the hub,
  // since a bridge needs this shape.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const unheardOf = await call(hs, "GET", profilePath("@whatsapp_neverseen:polymux.test"), {
      token: user.accessToken,
    });
    assert.equal(unheardOf.status, 200);
    assert.deepEqual(unheardOf.body, {});

    const registered = await call(hs, "POST", "/_matrix/client/v3/register", {
      token: asToken,
      body: {type: "m.login.application_service", username: "whatsapp_5", inhibit_login: true},
    });
    assert.equal(registered.status, 200);
    const named = await call(hs, "GET", profilePath("@whatsapp_5:polymux.test", "displayname"), {
      token: user.accessToken,
    });
    assert.equal(named.status, 200);
    assert.equal(named.body.displayname, undefined, "an unset field is absent, not null and not a 404");
  } finally {
    await cleanup();
  }
});

test("renaming a ghost reaches the rooms it is already in", async () => {
  // Profiles are copied into member events at write time only, so a contact
  // renamed after they joined keeps the old name in every room they are in:
  // /members and /joined_members then disagree about one person, and the chat
  // list and the message list show different names for the same sender.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portalRoom(hs, asToken, user.userId);
    await call(hs, "PUT", profilePath(SECOND_GHOST, "displayname"), {
      token: asToken,
      body: {displayname: "Jules"},
    });
    await call(hs, "POST", roomPath(roomId, "join"), {token: asToken, query: {user_id: SECOND_GHOST}});

    const renamed = await call(hs, "PUT", profilePath(SECOND_GHOST, "displayname"), {
      token: asToken,
      body: {displayname: "Jules Tan"},
    });
    assert.equal(renamed.status, 200);

    const joined = (
      await call(hs, "GET", roomPath(roomId, "joined_members"), {token: user.accessToken})
    ).body.joined as Record<string, {display_name: string | null}>;
    assert.equal(joined[SECOND_GHOST].display_name, "Jules Tan");

    const members = (await call(hs, "GET", roomPath(roomId, "members"), {token: user.accessToken}))
      .body.chunk as Array<Record<string, unknown>>;
    const member = members.find((event) => event.state_key === SECOND_GHOST);
    assert.ok(member, "the ghost is a member of the portal");
    assert.equal(
      (member.content as {displayname?: string}).displayname,
      "Jules Tan",
      "the member event carries the current name, so both member views agree",
    );
  } finally {
    await cleanup();
  }
});

// --- account data ---

test("room-scoped account data round-trips and replaces rather than merges", async () => {
  // mautrix keeps its portal-to-chat mapping and its is-this-a-DM bookkeeping
  // in room account data. A merge instead of a replace leaves stale keys that
  // mis-route messages to the wrong conversation.
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    const scoped = accountDataPath(user.userId, "com.polymux.test", roomId);

    assert.equal(
      (await call(hs, "PUT", scoped, {token: user.accessToken, body: {a: 1}})).status,
      200,
    );
    const first = await call(hs, "GET", scoped, {token: user.accessToken});
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, {a: 1});

    await call(hs, "PUT", scoped, {token: user.accessToken, body: {b: 2}});
    const second = await call(hs, "GET", scoped, {token: user.accessToken});
    assert.deepEqual(second.body, {b: 2}, "a write replaces the value rather than merging into it");

    const missing = await call(
      hs,
      "GET",
      accountDataPath(user.userId, "com.polymux.never_set", roomId),
      {token: user.accessToken},
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.body.errcode, "M_NOT_FOUND");

    // The same type globally is a different value; a bridge writes both.
    await call(hs, "PUT", accountDataPath(user.userId, "com.polymux.test"), {
      token: user.accessToken,
      body: {global: true},
    });
    assert.deepEqual((await call(hs, "GET", scoped, {token: user.accessToken})).body, {b: 2});
    assert.deepEqual(
      (await call(hs, "GET", accountDataPath(user.userId, "com.polymux.test"), {token: user.accessToken}))
        .body,
      {global: true},
    );
  } finally {
    await cleanup();
  }
});

test("account data written for another account is refused rather than filed under the caller", async () => {
  // The user id in the path is ignored in favour of the token's own, so a
  // bridge marking a DM on the user's behalf without masquerading writes to
  // its bot account instead: the m.direct the hub reads is never set, and the
  // write reports success.
  const {hs, user, cleanup} = await startHarness();
  try {
    const written = await call(hs, "PUT", accountDataPath(GHOST, "m.direct"), {
      token: user.accessToken,
      body: {[GHOST]: ["!somewhere:polymux.test"]},
    });
    assert.equal(written.status, 403, "one account may not write another's account data");

    const mine = await call(hs, "GET", accountDataPath(user.userId, "m.direct"), {
      token: user.accessToken,
    });
    assert.equal(mine.status, 404, "the refused write did not land under the caller either");
  } finally {
    await cleanup();
  }
});

// --- receipts and notifications ---

test("a read marker is readable back as fully-read account data", async () => {
  // The fully-read marker draws the unread divider and is what a bridge
  // forwards as read state to the remote network. Folding it into the receipt
  // row and storing no account data means it cannot be read back at all.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portalRoom(hs, asToken, user.userId);
    const eventId = await ghostSays(hs, asToken, roomId, "did you see this");

    const marked = await call(hs, "POST", roomPath(roomId, "read_markers"), {
      token: user.accessToken,
      body: {"m.fully_read": eventId, "m.read": eventId},
    });
    assert.equal(marked.status, 200);

    const unread = await call(hs, "GET", "/_matrix/client/v3/notifications", {token: user.accessToken});
    assert.equal(
      (unread.body.notifications as unknown[]).length,
      0,
      "the read receipt moved with the marker",
    );

    const marker = await call(hs, "GET", accountDataPath(user.userId, "m.fully_read", roomId), {
      token: user.accessToken,
    });
    assert.equal(marker.status, 200, "the marker is readable back as room account data");
    assert.equal(marker.body.event_id, eventId);
  } finally {
    await cleanup();
  }
});

test("a read receipt never moves backwards", async () => {
  // A receipt that could regress re-marks a read chat unread — on every
  // restart, or whenever a bridge replays an older read position.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portalRoom(hs, asToken, user.userId);
    const first = await ghostSays(hs, asToken, roomId, "one");
    await ghostSays(hs, asToken, roomId, "two");
    const third = await ghostSays(hs, asToken, roomId, "three");

    const receipt = (eventId: string): Promise<Response> =>
      call(hs, "POST", roomPath(roomId, `receipt/m.read/${encodeURIComponent(eventId)}`), {
        token: user.accessToken,
        body: {},
      });
    assert.equal((await receipt(third)).status, 200);
    assert.equal((await receipt(first)).status, 200);

    const unread = await call(hs, "GET", "/_matrix/client/v3/notifications", {token: user.accessToken});
    assert.equal((unread.body.notifications as unknown[]).length, 0, "an older receipt cannot regress");
    const sync = await call(hs, "GET", "/_matrix/client/v3/sync", {token: user.accessToken});
    assert.equal(syncJoin(sync)[roomId].unread_notifications.notification_count, 0);
  } finally {
    await cleanup();
  }
});

test("unread pages forward without handing back an event twice", async () => {
  // The hub pages this up to twenty times to build its unread list, so a token
  // that repeated or skipped would either loop or lose messages. next_token is
  // emitted only on a page that came back exactly limit-long, which is the
  // subtle part worth pinning.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portalRoom(hs, asToken, user.userId);
    const sent: string[] = [];
    for (let index = 1; index <= 5; index += 1)
      sent.push(await ghostSays(hs, asToken, roomId, `unread ${index}`));

    const seen: string[] = [];
    let from: string | undefined;
    const pages: Array<Record<string, unknown>> = [];
    for (let page = 0; page < 3; page += 1) {
      const response = await call(hs, "GET", "/_matrix/client/v3/notifications", {
        token: user.accessToken,
        query: {limit: "2", ...(from ? {from} : {})},
      });
      assert.equal(response.status, 200);
      pages.push(response.body);
      for (const item of response.body.notifications as Array<{event: {event_id: string}}>)
        seen.push(item.event.event_id);
      from = response.body.next_token as string | undefined;
      if (page < 2) assert.ok(from, `page ${page + 1} of a full page hands back a token to continue from`);
    }

    assert.deepEqual(seen, sent, "the pages are disjoint, complete and oldest-first");
    assert.equal(
      pages[2].next_token,
      undefined,
      "a short final page is the end of the list, not another token",
    );
  } finally {
    await cleanup();
  }
});

test("a sticker from a contact counts as unread", async () => {
  // Unread matches only m.room.message, so a sticker never notifies — while
  // onActivity does fire for stickers, so the app pops the message and shows
  // no badge for it. On the networks these bridges serve a sticker is
  // frequently the whole reply.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portalRoom(hs, asToken, user.userId);
    const sent = await call(hs, "PUT", roomPath(roomId, "send/m.sticker/sticker-1"), {
      token: asToken,
      query: {user_id: GHOST},
      body: {body: "thumbs up", url: "mxc://polymux.test/sticker", info: {}},
    });
    assert.equal(sent.status, 200);

    const unread = await call(hs, "GET", "/_matrix/client/v3/notifications", {token: user.accessToken});
    const notifications = unread.body.notifications as Array<{event: {event_id: string}}>;
    assert.equal(notifications.length, 1, "a sticker is a message the user has not read");
    assert.equal(notifications[0].event.event_id, sent.body.event_id);

    const sync = await call(hs, "GET", "/_matrix/client/v3/sync", {token: user.accessToken});
    assert.equal(syncJoin(sync)[roomId].unread_notifications.notification_count, 1);
  } finally {
    await cleanup();
  }
});

// --- search ---

test("search counts every match, not just the page it returned", async () => {
  // count is what draws "20 results"; setting it to the page length makes the
  // UI claim there are only ten while the rest are unreachable. The hub reads
  // next_batch, so its search pagination is dead code until one is emitted.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portalRoom(hs, asToken, user.userId);
    for (let index = 1; index <= 20; index += 1)
      await ghostSays(hs, asToken, roomId, `kumquat report ${index}`);

    const search = (nextBatch?: string): Promise<Response> =>
      call(hs, "POST", "/_matrix/client/v3/search", {
        token: user.accessToken,
        body: {search_categories: {room_events: {search_term: "kumquat", filter: {limit: 10}}}},
        ...(nextBatch ? {query: {next_batch: nextBatch}} : {}),
      });

    const first = await search();
    const page = (first.body.search_categories as {
      room_events: {count: number; results: unknown[]; next_batch?: string};
    }).room_events;
    assert.equal(page.results.length, 10, "the page is the length the filter asked for");
    assert.equal(page.count, 20, "count is how many matched, not how many were returned");
    assert.ok(page.next_batch, "a truncated result set hands back a token to continue from");

    const second = (await search(page.next_batch)).body.search_categories as {
      room_events: {results: unknown[]; next_batch?: string};
    };
    assert.equal(second.room_events.results.length, 10);
    assert.equal(second.room_events.next_batch, undefined, "the second page exhausts the matches");
  } finally {
    await cleanup();
  }
});

test("a search scoped to one room does not answer with another's messages", async () => {
  // The hub sends filter.rooms whenever it scopes a search to a conversation.
  // Dropped, searching within one chat silently returns hits from every chat
  // the user has, and the wrong message opens the wrong conversation.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const wanted = await portalRoom(hs, asToken, user.userId, "Jules");
    const other = await portalRoom(hs, asToken, user.userId, "Sam");
    await ghostSays(hs, asToken, wanted, "the kumquat delivery is here");
    await ghostSays(hs, asToken, other, "kumquat season already?");

    const search = await call(hs, "POST", "/_matrix/client/v3/search", {
      token: user.accessToken,
      body: {
        search_categories: {room_events: {search_term: "kumquat", filter: {limit: 10, rooms: [wanted]}}},
      },
    });
    const results = (search.body.search_categories as {
      room_events: {results: Array<{result: {room_id: string}}>};
    }).room_events.results;
    assert.deepEqual(
      [...new Set(results.map((entry) => entry.result.room_id))],
      [wanted],
      "a room-scoped search answers only from that room",
    );
  } finally {
    await cleanup();
  }
});

test("a redacted message is no longer findable", async () => {
  // Search runs a LIKE over stored content with no redaction awareness, so a
  // deleted message stays findable and reopenable — the deletion is cosmetic,
  // which is the one thing a delete must not be.
  const {hs, user, cleanup} = await startHarness();
  try {
    const roomId = await createRoom(hs, user.accessToken);
    const eventId = await sendMessage(hs, user.accessToken, roomId, {
      msgtype: "m.text",
      body: "the kumquat password is hunter2",
    });

    const search = (): Promise<Response> =>
      call(hs, "POST", "/_matrix/client/v3/search", {
        token: user.accessToken,
        body: {search_categories: {room_events: {search_term: "kumquat", filter: {limit: 10}}}},
      });
    const before = (await search()).body.search_categories as {room_events: {results: unknown[]}};
    assert.equal(before.room_events.results.length, 1);

    const redacted = await call(
      hs,
      "PUT",
      roomPath(roomId, `redact/${encodeURIComponent(eventId)}/redact-1`),
      {token: user.accessToken, body: {reason: "shared by mistake"}},
    );
    assert.equal(redacted.status, 200);

    const after = (await search()).body.search_categories as {room_events: {results: unknown[]}};
    assert.equal(after.room_events.results.length, 0, "a redacted message is gone, not merely hidden");
  } finally {
    await cleanup();
  }
});

// --- media ---

test("an upload with no content type keeps its bytes", async () => {
  // The authenticated media path runs after the JSON body reader, which treats
  // an absent content type as "maybe JSON" and drains the stream. The upload
  // handler then waits on a stream event that has already fired, so the request
  // is never answered at all: a newer mautrix build that prefers this namespace
  // does not lose the attachment quietly, it wedges on it.
  const {hs, user, cleanup} = await startHarness();
  try {
    const payload = Buffer.from("attachment-bytes-that-must-survive");

    const legacy = await uploadMedia(hs, "/_matrix/media/v3/upload", user.accessToken, payload);
    assert.equal(legacy.status, 200);
    const fromLegacy = await fetchMedia(
      hs,
      `/_matrix/media/v3/download/polymux.test/${legacy.mediaId}`,
      user.accessToken,
    );
    assert.deepEqual(fromLegacy.bytes, payload, "the legacy namespace keeps the bytes");

    const typed = await uploadMedia(
      hs,
      "/_matrix/client/v1/media/upload",
      user.accessToken,
      payload,
      "application/octet-stream",
    );
    const fromTyped = await fetchMedia(
      hs,
      `/_matrix/client/v1/media/download/polymux.test/${typed.mediaId}`,
      user.accessToken,
    );
    assert.deepEqual(fromTyped.bytes, payload, "a declared content type survives the round trip");

    const untyped = await uploadMedia(hs, "/_matrix/client/v1/media/upload", user.accessToken, payload);
    assert.ok(untyped.answered, "an upload with no content type is answered rather than left hanging");
    assert.equal(untyped.status, 200);
    const fromUntyped = await fetchMedia(
      hs,
      `/_matrix/client/v1/media/download/polymux.test/${untyped.mediaId}`,
      user.accessToken,
    );
    assert.deepEqual(
      fromUntyped.bytes,
      payload,
      "an upload with no content type is bytes, not a drained JSON body",
    );
  } finally {
    await cleanup();
  }
});

test("a download offers the file name it was uploaded with", async () => {
  // A bridged file arrives with the sender's original name or it arrives as an
  // opaque blob. The name is stored at upload and then never served, and the
  // filename path segment is ignored, so every bridged attachment loses its
  // name on the way to the user.
  const {hs, user, cleanup} = await startHarness();
  try {
    const payload = Buffer.from("jpeg-bytes");
    const upload = async (fileName: string): Promise<string> => {
      const result = await uploadMedia(
        hs,
        `/_matrix/media/v3/upload?filename=${encodeURIComponent(fileName)}`,
        user.accessToken,
        payload,
        "image/jpeg",
      );
      assert.equal(result.status, 200);
      return result.mediaId;
    };

    const ascii = await upload("holiday photo;1.jpg");
    const served = await fetchMedia(
      hs,
      `/_matrix/media/v3/download/polymux.test/${ascii}`,
      user.accessToken,
    );
    const disposition = served.headers.get("content-disposition");
    assert.ok(disposition, "a download names the file it is serving");
    assert.match(disposition, /^(inline|attachment)/);
    assert.ok(
      disposition.includes("holiday photo;1.jpg") || disposition.includes(encodeURIComponent("holiday photo;1.jpg")),
      `the stored name is carried in ${disposition}`,
    );

    const unicode = await upload("写真.jpg");
    const unicodeServed = await fetchMedia(
      hs,
      `/_matrix/media/v3/download/polymux.test/${unicode}`,
      user.accessToken,
    );
    const unicodeDisposition = unicodeServed.headers.get("content-disposition") ?? "";
    assert.ok(
      unicodeDisposition.includes("写真.jpg") || unicodeDisposition.includes(encodeURIComponent("写真.jpg")),
      `a non-ASCII name survives as filename* in ${unicodeDisposition}`,
    );

    // The spec also lets the client name the file in the last path segment,
    // which is how a browser preview asks for a sensible download name.
    const named = await fetchMedia(
      hs,
      `/_matrix/media/v3/download/polymux.test/${ascii}/renamed.jpg`,
      user.accessToken,
    );
    assert.equal(named.status, 200);
    assert.ok(
      (named.headers.get("content-disposition") ?? "").includes("renamed.jpg"),
      "a filename in the path wins over the stored one",
    );
  } finally {
    await cleanup();
  }
});

test("a thumbnail request answers with the original image rather than nothing", async () => {
  // A deliberate omission rather than a promise: there is no image processing
  // in an embedded server, and mautrix and the renderer both treat a missing
  // thumbnail endpoint as an error, so serving the original is the correct
  // answer. The cost is honest — a full-size photo per chat-list avatar.
  const {hs, user, cleanup} = await startHarness();
  try {
    const payload = Buffer.from("png-bytes-of-a-large-photo");
    const uploaded = await uploadMedia(
      hs,
      "/_matrix/media/v3/upload?filename=avatar.png",
      user.accessToken,
      payload,
      "image/png",
    );
    assert.equal(uploaded.status, 200);

    const thumbnail = await fetchMedia(
      hs,
      `/_matrix/media/v3/thumbnail/polymux.test/${uploaded.mediaId}?width=64&height=64&method=crop`,
      user.accessToken,
    );
    assert.equal(thumbnail.status, 200);
    assert.equal(thumbnail.headers.get("content-type"), "image/png");
    assert.deepEqual(thumbnail.bytes, payload, "the original stands in for the thumbnail");

    const missing = await fetchMedia(
      hs,
      "/_matrix/media/v3/thumbnail/polymux.test/never-uploaded?width=64&height=64",
      user.accessToken,
    );
    assert.equal(missing.status, 404);
    assert.equal(JSON.parse(missing.bytes.toString("utf8")).errcode, "M_NOT_FOUND");
  } finally {
    await cleanup();
  }
});

// --- the sync snapshot ---

test("a sync snapshot carries every joined room's state, newest messages oldest-first and unread count", async () => {
  // The hub's entire chat list is built from this one response. The
  // oldest-first ordering is the load-bearing part: the reader takes the last
  // message as the preview, so a reversal would show every chat's oldest
  // message and sort the list wrong.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const jules = await portalRoom(hs, asToken, user.userId, "Jules Tan (WA)");
    const sam = await portalRoom(hs, asToken, user.userId, "Sam");
    for (const body of ["morning", "are you there", "call me"]) await ghostSays(hs, asToken, jules, body);
    await ghostSays(hs, asToken, sam, "sent you the file");
    await sendMessage(hs, user.accessToken, sam, {msgtype: "m.text", body: "got it, thanks"});

    const sync = await call(hs, "GET", "/_matrix/client/v3/sync", {token: user.accessToken});
    assert.equal(sync.status, 200);
    assert.match(String(sync.body.next_batch), /^\d+$/, "the batch token is a stream position");

    const rooms = syncJoin(sync);
    assert.deepEqual(Object.keys(rooms).sort(), [jules, sam].sort());

    for (const [roomId, room] of Object.entries(rooms)) {
      const state = room.state.events;
      assert.ok(
        state.every((event) => typeof event.state_key === "string"),
        "state carries only state events",
      );
      for (const type of ["m.room.create", "m.room.name", "m.room.member"])
        assert.ok(state.some((event) => event.type === type), `${type} is part of the current state`);

      const joined = (await call(hs, "GET", roomPath(roomId, "joined_members"), {token: user.accessToken}))
        .body.joined as Record<string, unknown>;
      assert.equal(room.summary["m.joined_member_count"], Object.keys(joined).length);
    }

    assert.deepEqual(bodiesOf(rooms[jules].timeline.events), ["morning", "are you there", "call me"]);
    assert.deepEqual(bodiesOf(rooms[sam].timeline.events), ["sent you the file", "got it, thanks"]);
    assert.equal(rooms[jules].unread_notifications.notification_count, 3);
    assert.equal(
      rooms[sam].unread_notifications.notification_count,
      1,
      "the user's own reply is not unread to them",
    );
  } finally {
    await cleanup();
  }
});

test("a sync token buys nothing: the next sync is the same full snapshot", async () => {
  // Pins the snapshot model as intended: bridges are pushed transactions and
  // never call /sync, so this exists only to spare the hub four hundred round
  // trips for a couple of hundred rooms. A client that assumed incremental
  // semantics would drop everything it already had, so the omission is stated
  // rather than left to be discovered.
  const {hs, asToken, user, cleanup} = await startHarness();
  try {
    const roomId = await portalRoom(hs, asToken, user.userId, "Jules");
    await ghostSays(hs, asToken, roomId, "still here");

    const first = await call(hs, "GET", "/_matrix/client/v3/sync", {token: user.accessToken});
    const since = String(first.body.next_batch);
    const second = await call(hs, "GET", "/_matrix/client/v3/sync", {
      token: user.accessToken,
      query: {since, timeout: "0"},
    });

    assert.equal(second.status, 200);
    assert.deepEqual(second.body.rooms, first.body.rooms, "a since token is ignored, not honoured");
    assert.ok(bodiesOf(syncJoin(second)[roomId].timeline.events).includes("still here"));
  } finally {
    await cleanup();
  }
});

test("a room the user was only invited to is not in the snapshot", async () => {
  // The invite-to-join hop exists precisely because /sync reports only joined
  // rooms. Pinning the absence makes clear why the hub's own invite-accepting
  // path can never fire against this server, so nobody adds an invite section
  // on the assumption something is waiting for it.
  const {hs, asToken, user, cleanup} = await startHarness({autoJoin: false});
  try {
    const roomId = await portalRoom(hs, asToken, user.userId, "Jules");

    const sync = await call(hs, "GET", "/_matrix/client/v3/sync", {token: user.accessToken});
    assert.equal(sync.status, 200);
    assert.equal((sync.body.rooms as Record<string, unknown>).invite, undefined);
    assert.equal(syncJoin(sync)[roomId], undefined, "an unanswered invite is not a room the user has");

    const joined = await call(hs, "GET", "/_matrix/client/v3/joined_rooms", {token: user.accessToken});
    assert.deepEqual(joined.body.joined_rooms, []);
  } finally {
    await cleanup();
  }
});
