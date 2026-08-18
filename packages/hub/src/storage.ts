import {DatabaseSync} from "node:sqlite";
import {mkdirSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {dirname} from "node:path";

/**
 * Persistence for the embedded homeserver. Rooms here are a strictly local,
 * linear history — there is no federation and never will be, so events form a
 * single stream ordered by insertion rather than a DAG, and "state resolution"
 * is simply the latest state event of each (type, state_key) pair.
 */

export interface StoredEvent {
  eventId: string;
  roomId: string;
  sender: string;
  type: string;
  stateKey: string | null;
  content: unknown;
  originServerTs: number;
  streamOrder: number;
  /** Set when the event redacts another. */
  redacts: string | null;
  /** The redaction that struck this event, once one has been applied. */
  redactedBy: string | null;
  /** The transaction key the write carried, echoed back to its own sender. */
  txnKey: string | null;
  /**
   * The appservice whose token wrote this event, null for the user's own
   * client. Kept so the pusher can withhold a bridge's own writes from it:
   * echoed back, a double-puppeted "message from the user" is
   * indistinguishable from the user typing it here, and the bridge sends it
   * to the network again.
   */
  origin: string | null;
}

export interface AppserviceRecord {
  id: string;
  asToken: string;
  hsToken: string;
  url: string;
  senderLocalpart: string;
  /** Regexes over full user ids, from the registration's user namespaces. */
  userNamespaces: string[];
}

export interface MediaRecord {
  mediaId: string;
  contentType: string;
  fileName: string | null;
  bytes: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  displayname TEXT,
  avatar_url TEXT,
  appservice_id TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS appservices (
  id TEXT PRIMARY KEY,
  as_token TEXT NOT NULL UNIQUE,
  hs_token TEXT NOT NULL,
  url TEXT NOT NULL,
  sender_localpart TEXT NOT NULL,
  user_namespaces_json TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  creator TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS events (
  stream_order INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  type TEXT NOT NULL,
  state_key TEXT,
  content_json TEXT NOT NULL,
  origin_server_ts INTEGER NOT NULL,
  redacts TEXT,
  txn_key TEXT UNIQUE,
  origin TEXT,
  redacted_by TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS events_room_idx ON events(room_id, stream_order);
CREATE INDEX IF NOT EXISTS events_room_type_idx ON events(room_id, type, stream_order);

-- Latest state event per (room, type, state_key); the only "resolution" a
-- non-federating server needs.
CREATE TABLE IF NOT EXISTS room_state (
  room_id TEXT NOT NULL,
  type TEXT NOT NULL,
  state_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (room_id, type, state_key)
) STRICT;

CREATE TABLE IF NOT EXISTS account_data (
  user_id TEXT NOT NULL,
  room_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  content_json TEXT NOT NULL,
  PRIMARY KEY (user_id, room_id, type)
) STRICT;

CREATE TABLE IF NOT EXISTS media (
  media_id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  file_name TEXT,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS receipts (
  user_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  stream_order INTEGER NOT NULL,
  PRIMARY KEY (user_id, room_id)
) STRICT;

-- How far each appservice's transaction stream has been delivered, so pushes
-- resume after a restart instead of replaying history.
CREATE TABLE IF NOT EXISTS appservice_positions (
  appservice_id TEXT PRIMARY KEY,
  stream_order INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS room_aliases (
  alias TEXT PRIMARY KEY,
  room_id TEXT NOT NULL
) STRICT;
`;

export class HomeserverStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    // SQLite creates a missing file but not a missing directory, and on a
    // fresh install the hub directory does not exist yet.
    mkdirSync(dirname(path), {recursive: true});
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode = WAL;");
    this.#db.exec(SCHEMA);
    // `CREATE TABLE IF NOT EXISTS` never revisits a table that already
    // exists, so a database from before the column was in the schema has to
    // be brought up by hand. Old rows read back null — "not an appservice's
    // write" — which for the pusher's purposes is the safe reading: at worst
    // an old event is delivered the way every event used to be.
    const columns = this.#db.prepare("SELECT name FROM pragma_table_info('events')").all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "origin"))
      this.#db.exec("ALTER TABLE events ADD COLUMN origin TEXT;");
    if (!columns.some((column) => column.name === "redacted_by"))
      this.#db.exec("ALTER TABLE events ADD COLUMN redacted_by TEXT;");
  }

  close(): void {
    this.#db.close();
  }

  // --- users & tokens ---

  ensureUser(userId: string, appserviceId?: string): void {
    this.#db
      .prepare(
        "INSERT INTO users (user_id, appservice_id, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING",
      )
      .run(userId, appserviceId ?? null, new Date().toISOString());
  }

  /** Every account on this server, for sweeps that are not about one user. */
  userIds(): string[] {
    return (this.#db.prepare("SELECT user_id FROM users").all() as Array<{user_id: string}>).map(
      (row) => row.user_id,
    );
  }

  userExists(userId: string): boolean {
    return !!this.#db.prepare("SELECT 1 FROM users WHERE user_id = ?").get(userId);
  }

  setProfile(userId: string, field: "displayname" | "avatar_url", value: string | null): void {
    this.ensureUser(userId);
    this.#db.prepare(`UPDATE users SET ${field} = ? WHERE user_id = ?`).run(value, userId);
  }

  profile(userId: string): {displayname: string | null; avatarUrl: string | null} | null {
    const row = this.#db
      .prepare("SELECT displayname, avatar_url FROM users WHERE user_id = ?")
      .get(userId) as {displayname: string | null; avatar_url: string | null} | undefined;
    return row ? {displayname: row.displayname, avatarUrl: row.avatar_url} : null;
  }

  createToken(userId: string, deviceId?: string): string {
    const token = `mds_${randomBytes(24).toString("base64url")}`;
    this.#db
      .prepare("INSERT INTO tokens (token, user_id, device_id, created_at) VALUES (?, ?, ?, ?)")
      .run(token, userId, deviceId ?? null, new Date().toISOString());
    return token;
  }

  userForToken(token: string): string | null {
    const row = this.#db.prepare("SELECT user_id FROM tokens WHERE token = ?").get(token) as
      | {user_id: string}
      | undefined;
    return row?.user_id ?? null;
  }

  deleteToken(token: string): void {
    this.#db.prepare("DELETE FROM tokens WHERE token = ?").run(token);
  }

  /** Every token the account holds, which is what logging out everywhere means. */
  deleteTokensFor(userId: string): void {
    this.#db.prepare("DELETE FROM tokens WHERE user_id = ?").run(userId);
  }

  // --- appservices ---

  registerAppservice(record: AppserviceRecord): void {
    // Pin the delivery position to "now" exactly once. Recomputing a default
    // on each read would silently skip any event appended between registration
    // and the first successful delivery.
    this.#db
      .prepare(
        "INSERT INTO appservice_positions (appservice_id, stream_order) VALUES (?, ?) ON CONFLICT(appservice_id) DO NOTHING",
      )
      .run(record.id, this.maxStreamOrder());
    this.#db
      .prepare(
        `INSERT INTO appservices (id, as_token, hs_token, url, sender_localpart, user_namespaces_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET as_token = excluded.as_token, hs_token = excluded.hs_token,
           url = excluded.url, sender_localpart = excluded.sender_localpart,
           user_namespaces_json = excluded.user_namespaces_json`,
      )
      .run(
        record.id,
        record.asToken,
        record.hsToken,
        record.url,
        record.senderLocalpart,
        JSON.stringify(record.userNamespaces),
      );
  }

  appservices(): AppserviceRecord[] {
    return (this.#db.prepare("SELECT * FROM appservices").all() as Array<Record<string, string>>).map(
      (row) => ({
        id: row.id,
        asToken: row.as_token,
        hsToken: row.hs_token,
        url: row.url,
        senderLocalpart: row.sender_localpart,
        userNamespaces: JSON.parse(row.user_namespaces_json) as string[],
      }),
    );
  }

  appserviceByToken(asToken: string): AppserviceRecord | null {
    const row = this.#db.prepare("SELECT * FROM appservices WHERE as_token = ?").get(asToken) as
      | Record<string, string>
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      asToken: row.as_token,
      hsToken: row.hs_token,
      url: row.url,
      senderLocalpart: row.sender_localpart,
      userNamespaces: JSON.parse(row.user_namespaces_json) as string[],
    };
  }

  appservicePosition(id: string): number {
    const row = this.#db
      .prepare("SELECT stream_order FROM appservice_positions WHERE appservice_id = ?")
      .get(id) as {stream_order: number} | undefined;
    return row?.stream_order ?? 0;
  }

  setAppservicePosition(id: string, streamOrder: number): void {
    this.#db
      .prepare(
        `INSERT INTO appservice_positions (appservice_id, stream_order) VALUES (?, ?)
         ON CONFLICT(appservice_id) DO UPDATE SET stream_order = excluded.stream_order`,
      )
      .run(id, streamOrder);
  }

  // --- rooms & events ---

  createRoom(roomId: string, creator: string): void {
    this.#db
      .prepare("INSERT INTO rooms (room_id, creator, created_at) VALUES (?, ?, ?)")
      .run(roomId, creator, new Date().toISOString());
  }

  roomExists(roomId: string): boolean {
    return !!this.#db.prepare("SELECT 1 FROM rooms WHERE room_id = ?").get(roomId);
  }

  /**
   * Appends an event, updating current state when it is a state event.
   * `txnKey` deduplicates client retries: replays return the original event.
   */
  appendEvent(event: {
    eventId: string;
    roomId: string;
    sender: string;
    type: string;
    stateKey: string | null;
    content: unknown;
    originServerTs: number;
    redacts?: string | null;
    txnKey?: string | null;
    origin?: string | null;
  }): StoredEvent {
    if (event.txnKey) {
      const existing = this.#db
        .prepare("SELECT * FROM events WHERE txn_key = ?")
        .get(event.txnKey) as Record<string, unknown> | undefined;
      if (existing) return rowToEvent(existing);
    }
    /**
     * A state write that changes nothing returns the event already there.
     * Bridges re-assert a portal's name, topic and avatar on every startup and
     * every remote-side resync, and #healInvites re-joins every portal; each
     * one appended a fresh event, so a room accumulated hundreds of identical
     * membership and name events and every restart pushed each of them to every
     * bridge as a change.
     */
    if (event.stateKey !== null) {
      const current = this.stateEvent(event.roomId, event.type, event.stateKey);
      if (current && JSON.stringify(current.content) === JSON.stringify(event.content ?? {}))
        return current;
    }
    this.#db
      .prepare(
        `INSERT INTO events (event_id, room_id, sender, type, state_key, content_json, origin_server_ts, redacts, txn_key, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        event.roomId,
        event.sender,
        event.type,
        event.stateKey,
        JSON.stringify(event.content ?? {}),
        event.originServerTs,
        event.redacts ?? null,
        event.txnKey ?? null,
        event.origin ?? null,
      );
    if (event.stateKey !== null)
      this.#db
        .prepare(
          `INSERT INTO room_state (room_id, type, state_key, event_id) VALUES (?, ?, ?, ?)
           ON CONFLICT(room_id, type, state_key) DO UPDATE SET event_id = excluded.event_id`,
        )
        .run(event.roomId, event.type, event.stateKey, event.eventId);
    const row = this.#db.prepare("SELECT * FROM events WHERE event_id = ?").get(event.eventId) as Record<
      string,
      unknown
    >;
    return rowToEvent(row);
  }

  event(eventId: string): StoredEvent | null {
    const row = this.#db.prepare("SELECT * FROM events WHERE event_id = ?").get(eventId) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToEvent(row) : null;
  }

  /**
   * Applies a redaction to the event it names: the event stays in the timeline
   * and keeps its place, and loses everything the redaction algorithm does not
   * preserve. Recording the redaction without applying it — which is what this
   * server did — means a message deleted here is still readable everywhere it
   * is read from, which is not a deletion at all.
   */
  redactEvent(targetId: string, redactionId: string): void {
    const target = this.event(targetId);
    if (!target) return;
    const content = (target.content ?? {}) as Record<string, unknown>;
    // A room's shape must survive its own history being cleared, so the keys
    // that decide membership and permissions are kept; m.room.create is kept
    // whole, which is what room version 11 says.
    const keeps = REDACTION_KEEPS[target.type];
    const kept =
      target.type === "m.room.create"
        ? content
        : Object.fromEntries(Object.entries(content).filter(([key]) => keeps?.includes(key)));
    this.#db
      .prepare("UPDATE events SET content_json = ?, redacted_by = ? WHERE event_id = ?")
      .run(JSON.stringify(kept), redactionId, targetId);
  }

  /**
   * The state event this one replaced, which is how a reader tells a rename
   * from a join without fetching the room's whole state again.
   */
  previousState(
    roomId: string,
    type: string,
    stateKey: string,
    before: number,
  ): StoredEvent | null {
    const row = this.#db
      .prepare(
        `SELECT * FROM events WHERE room_id = ? AND type = ? AND state_key = ? AND stream_order < ?
         ORDER BY stream_order DESC LIMIT 1`,
      )
      .get(roomId, type, stateKey, before) as Record<string, unknown> | undefined;
    return row ? rowToEvent(row) : null;
  }

  /** The redaction that struck an event, which is how a reader learns why. */
  redactionOf(eventId: string): StoredEvent | null {
    const row = this.#db
      .prepare("SELECT * FROM events WHERE redacts = ? ORDER BY stream_order ASC LIMIT 1")
      .get(eventId) as Record<string, unknown> | undefined;
    return row ? rowToEvent(row) : null;
  }

  stateEvent(roomId: string, type: string, stateKey: string): StoredEvent | null {
    const pointer = this.#db
      .prepare("SELECT event_id FROM room_state WHERE room_id = ? AND type = ? AND state_key = ?")
      .get(roomId, type, stateKey) as {event_id: string} | undefined;
    return pointer ? this.event(pointer.event_id) : null;
  }

  fullState(roomId: string): StoredEvent[] {
    const rows = this.#db
      .prepare(
        `SELECT e.* FROM room_state s JOIN events e ON e.event_id = s.event_id WHERE s.room_id = ? ORDER BY e.stream_order`,
      )
      .all(roomId) as Array<Record<string, unknown>>;
    return rows.map(rowToEvent);
  }

  members(roomId: string, membership?: string): StoredEvent[] {
    return this.fullState(roomId).filter((event) => {
      if (event.type !== "m.room.member") return false;
      if (!membership) return true;
      return (event.content as {membership?: string}).membership === membership;
    });
  }

  roomsForUser(userId: string, membership = "join"): string[] {
    const rows = this.#db
      .prepare(
        `SELECT s.room_id, e.content_json FROM room_state s JOIN events e ON e.event_id = s.event_id
         WHERE s.type = 'm.room.member' AND s.state_key = ?`,
      )
      .all(userId) as Array<{room_id: string; content_json: string}>;
    return rows
      .filter((row) => (JSON.parse(row.content_json) as {membership?: string}).membership === membership)
      .map((row) => row.room_id);
  }

  /** Timeline slice, newest-first when backwards, keyed by stream order. */
  /**
   * A page of a room's timeline, and where the next page would start.
   *
   * `end` is null when the page reached the end of the room, which is the only
   * way a reader can stop: a token on every page means "there is more" forever,
   * so a client walking back through history never learns it has arrived at the
   * beginning and asks again for a page it has already seen.
   *
   * `to` bounds the walk, which is how a caller pages between two known points
   * rather than from one to the end.
   */
  messages(
    roomId: string,
    options: {dir: "b" | "f"; from?: number; to?: number; limit: number},
  ): {events: StoredEvent[]; start: number; end: number | null} {
    const backwards = options.dir === "b";
    const edge = this.maxStreamOrder();
    const from = options.from ?? (backwards ? edge + 1 : 0);
    // One more row than asked for: whether it exists is the answer to "is there
    // another page", and it is dropped before the events are returned.
    const bound =
      options.to === undefined
        ? backwards
          ? -1
          : Number.MAX_SAFE_INTEGER
        : options.to;
    const rows = this.#db
      .prepare(
        backwards
          ? `SELECT * FROM events WHERE room_id = ? AND stream_order < ? AND stream_order > ?
             ORDER BY stream_order DESC LIMIT ?`
          : `SELECT * FROM events WHERE room_id = ? AND stream_order > ? AND stream_order < ?
             ORDER BY stream_order ASC LIMIT ?`,
      )
      .all(roomId, from, bound, options.limit + 1) as Array<Record<string, unknown>>;
    const more = rows.length > options.limit;
    const events = rows.slice(0, options.limit).map(rowToEvent);
    const last = events[events.length - 1];
    return {
      events,
      // Where this page actually begins, rather than a token meaning "the
      // beginning of time" — for a backwards page with no `from`, that is the
      // live edge the reader started from.
      start: options.from ?? (backwards ? edge + 1 : 0),
      end: more && last ? last.streamOrder : null,
    };
  }

  eventsAfter(streamOrder: number, limit: number): StoredEvent[] {
    const rows = this.#db
      .prepare("SELECT * FROM events WHERE stream_order > ? ORDER BY stream_order ASC LIMIT ?")
      .all(streamOrder, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToEvent);
  }

  maxStreamOrder(): number {
    const row = this.#db.prepare("SELECT MAX(stream_order) AS max FROM events").get() as {
      max: number | null;
    };
    return row.max ?? 0;
  }

  /**
   * LIKE over the serialized content is crude but right-sized: rooms here are
   * one user's chats, not a public server's history. `rooms` narrows the search
   * the way a filter asks — without it a search for one conversation answered
   * with every conversation — and the count is of every match, not of the page,
   * because a client shows it as "N results".
   */
  searchMessages(
    userId: string,
    term: string,
    limit: number,
    rooms?: string[],
    from?: number,
  ): {events: StoredEvent[]; count: number} {
    const mine = this.roomsForUser(userId);
    const scope = rooms?.length ? mine.filter((room) => rooms.includes(room)) : mine;
    if (scope.length === 0) return {events: [], count: 0};
    const placeholders = scope.map(() => "?").join(",");
    const pattern = `%${term.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
    // Results run newest first, so continuing an earlier page means everything
    // older than the last row that page handed out.
    const after = from === undefined ? "" : " AND stream_order < ?";
    const paged = from === undefined ? [] : [from];
    const where = `room_id IN (${placeholders}) AND type = 'm.room.message'
         AND content_json LIKE ? ESCAPE '\\'${after}`;
    const rows = this.#db
      .prepare(`SELECT * FROM events WHERE ${where} ORDER BY stream_order DESC LIMIT ?`)
      .all(...scope, pattern, ...paged, limit) as Array<Record<string, unknown>>;
    const counted = this.#db
      .prepare(`SELECT COUNT(*) AS total FROM events WHERE ${where}`)
      .get(...scope, pattern, ...paged) as {total: number};
    return {events: rows.map(rowToEvent), count: counted.total};
  }

  // --- receipts & unread ---

  setReceipt(userId: string, roomId: string, streamOrder: number): void {
    this.#db
      .prepare(
        `INSERT INTO receipts (user_id, room_id, stream_order) VALUES (?, ?, ?)
         ON CONFLICT(user_id, room_id) DO UPDATE SET stream_order = MAX(stream_order, excluded.stream_order)`,
      )
      .run(userId, roomId, streamOrder);
  }

  /** Message events in the user's rooms past their read receipt, oldest first. */
  unread(userId: string, from: number, limit: number): StoredEvent[] {
    const rooms = this.roomsForUser(userId);
    if (rooms.length === 0) return [];
    const placeholders = rooms.map(() => "?").join(",");
    const rows = this.#db
      .prepare(
        `SELECT e.* FROM events e
         LEFT JOIN receipts r ON r.user_id = ? AND r.room_id = e.room_id
         WHERE e.room_id IN (${placeholders}) AND e.type IN ('m.room.message', 'm.sticker') AND e.sender != ?
           AND e.stream_order > COALESCE(r.stream_order, 0) AND e.stream_order > ?
         ORDER BY e.stream_order ASC LIMIT ?`,
      )
      .all(userId, ...rooms, userId, from, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToEvent);
  }

  /** How many unread messages each of the user's rooms holds, by room. */
  unreadCounts(userId: string): Map<string, number> {
    const rooms = this.roomsForUser(userId);
    if (rooms.length === 0) return new Map();
    const placeholders = rooms.map(() => "?").join(",");
    const rows = this.#db
      .prepare(
        `SELECT e.room_id AS room_id, COUNT(*) AS unread FROM events e
         LEFT JOIN receipts r ON r.user_id = ? AND r.room_id = e.room_id
         WHERE e.room_id IN (${placeholders}) AND e.type IN ('m.room.message', 'm.sticker') AND e.sender != ?
           AND e.stream_order > COALESCE(r.stream_order, 0)
         GROUP BY e.room_id`,
      )
      .all(userId, ...rooms, userId) as Array<{room_id: string; unread: number}>;
    return new Map(rows.map((row) => [row.room_id, Number(row.unread)]));
  }

  // --- account data, media, aliases ---

  setAccountData(userId: string, roomId: string | null, type: string, content: unknown): void {
    this.#db
      .prepare(
        `INSERT INTO account_data (user_id, room_id, type, content_json) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, room_id, type) DO UPDATE SET content_json = excluded.content_json`,
      )
      .run(userId, roomId ?? "", type, JSON.stringify(content ?? {}));
  }

  accountData(userId: string, roomId: string | null, type: string): unknown {
    const row = this.#db
      .prepare("SELECT content_json FROM account_data WHERE user_id = ? AND room_id = ? AND type = ?")
      .get(userId, roomId ?? "", type) as {content_json: string} | undefined;
    return row ? JSON.parse(row.content_json) : null;
  }

  recordMedia(record: MediaRecord): void {
    this.#db
      .prepare(
        "INSERT INTO media (media_id, content_type, file_name, bytes, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(record.mediaId, record.contentType, record.fileName, record.bytes, new Date().toISOString());
  }

  media(mediaId: string): MediaRecord | null {
    const row = this.#db.prepare("SELECT * FROM media WHERE media_id = ?").get(mediaId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      mediaId: row.media_id as string,
      contentType: row.content_type as string,
      fileName: (row.file_name as string | null) ?? null,
      bytes: row.bytes as number,
    };
  }

  deleteAlias(alias: string): void {
    this.#db.prepare("DELETE FROM room_aliases WHERE alias = ?").run(alias);
  }

  setAlias(alias: string, roomId: string): void {
    this.#db
      .prepare(
        "INSERT INTO room_aliases (alias, room_id) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET room_id = excluded.room_id",
      )
      .run(alias, roomId);
  }

  roomForAlias(alias: string): string | null {
    const row = this.#db.prepare("SELECT room_id FROM room_aliases WHERE alias = ?").get(alias) as
      | {room_id: string}
      | undefined;
    return row?.room_id ?? null;
  }
}

/**
 * Content keys a redaction preserves, by event type. Everything else goes.
 * Without these a redacted join would stop counting as a join and eject the
 * member, which is why the algorithm exists rather than simply emptying content.
 */
const REDACTION_KEEPS: Record<string, string[]> = {
  "m.room.member": ["membership", "join_authorised_via_users_server"],
  "m.room.join_rules": ["join_rule", "allow"],
  "m.room.power_levels": [
    "ban",
    "events",
    "events_default",
    "invite",
    "kick",
    "redact",
    "state_default",
    "users",
    "users_default",
  ],
  "m.room.history_visibility": ["history_visibility"],
  // Room version 11 keeps a redaction's target in its content.
  "m.room.redaction": ["redacts"],
};

function rowToEvent(row: Record<string, unknown>): StoredEvent {
  return {
    eventId: row.event_id as string,
    roomId: row.room_id as string,
    sender: row.sender as string,
    type: row.type as string,
    stateKey: (row.state_key as string | null) ?? null,
    content: JSON.parse(row.content_json as string),
    originServerTs: row.origin_server_ts as number,
    streamOrder: row.stream_order as number,
    redacts: (row.redacts as string | null) ?? null,
    origin: (row.origin as string | null) ?? null,
    redactedBy: (row.redacted_by as string | null) ?? null,
    txnKey: (row.txn_key as string | null) ?? null,
  };
}
