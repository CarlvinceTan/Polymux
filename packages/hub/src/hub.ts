import {readFile} from "node:fs/promises";
import {createHmac} from "node:crypto";
import path from "node:path";
import WebSocket from "ws";
import {mediaUrl} from "./media-url.js";
import {visibleWeChatText} from "./wechat-emoji.js";
import {COMMS_PLATFORMS} from "@polymux/protocol";
import type {
  CommsBridgeAccountDto,
  CommsBridgeDto,
  CommsLoginCookieFieldDto,
  CommsLoginFieldDto,
  CommsLoginFlowDto,
  CommsLoginStepDto,
  CommsPlatform,
} from "@polymux/protocol";

/** Provisioning route prefix every bridgev2 bridge serves its login API under. */
const BRIDGEV2_PREFIX = "_matrix/provision/v3";
/** mautrix-discord predates the step API and still serves the v1 routes. */
const LEGACY_PREFIX = "_matrix/provision/v1";

/**
 * A `display_and_wait` submit blocks server-side until the remote user acts on
 * the QR or code, so it gets a long ceiling. Everything else should be quick.
 */
const WAIT_TIMEOUT_MS = 180_000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface HubAuth {
  /** Matrix access token, when the app is signed in to the homeserver. */
  matrixToken: string | null;
  userId: string | null;
}

export interface MatrixHubOptions {
  /** Local proxy fronting the homeserver and the bridge provisioning routes. */
  baseUrl: string;
  /**
   * The homeserver itself. The proxy deliberately does not forward the admin
   * API, so account provisioning has to talk to the server directly.
   */
  homeserverUrl: string;
  /** Deployment root, used to recover per-bridge shared secrets. */
  directory: string | null;
  auth: () => HubAuth;
  fetch?: typeof globalThis.fetch;
}

export interface HubProbe {
  reachable: boolean;
  homeserverName: string | null;
  error: string | null;
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
}

export interface MatrixSyncActivity {
  roomId: string;
  sender: string;
}

export interface MatrixSyncDelta {
  nextBatch: string;
  activities: MatrixSyncActivity[];
}

export class ProvisioningError extends Error {
  readonly status: number;
  readonly errcode: string | null;

  constructor(message: string, status: number, errcode: string | null) {
    super(message);
    this.name = "ProvisioningError";
    this.status = status;
    this.errcode = errcode;
  }
}

type LegacyQrMessage = {code?: string; success?: boolean; error?: string};

/** Small queue around mautrix-discord's streaming QR provisioning socket. */
class LegacyQrSession {
  readonly #socket: WebSocket;
  readonly #messages: LegacyQrMessage[] = [];
  readonly #waiters: Array<{
    resolve: (message: LegacyQrMessage) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (data) => {
      try {
        this.#push(JSON.parse(data.toString()) as LegacyQrMessage);
      } catch {
        this.#fail(new Error("Discord returned an unreadable QR response."));
      }
    });
    socket.on("error", (error) => this.#fail(error));
    socket.on("close", () => this.#fail(new Error("Discord QR sign-in closed before approval.")));
  }

  next(): Promise<LegacyQrMessage> {
    const ready = this.#messages.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve, reject) => this.#waiters.push({resolve, reject}));
  }

  close(): void {
    this.#socket.close();
  }

  #push(message: LegacyQrMessage): void {
    const waiter = this.#waiters.shift();
    if (waiter) waiter.resolve(message);
    else this.#messages.push(message);
  }

  #fail(error: Error): void {
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
  }
}

/**
 * Talks to the local Matrix homeserver and to each bridge's provisioning API.
 *
 * Bridges are only reachable through the hub's loopback proxy, and they accept
 * either the user's own Matrix access token (when `allow_matrix_auth` is on) or
 * the per-bridge shared secret from their config. The token is preferred: it
 * needs no filesystem access and identifies the user without a query
 * parameter, so a misread config cannot silently act as the wrong account.
 */
export class MatrixHub {
  readonly #baseUrl: string;
  readonly #homeserverUrl: string;
  readonly #directory: string | null;
  readonly #auth: () => HubAuth;
  readonly #fetch: typeof globalThis.fetch;
  readonly #secrets = new Map<string, string | null>();
  readonly #roomNames = new Map<string, string>();
  readonly #roomPlatforms = new Map<string, string>();
  /** Sender display names and avatars, keyed by Matrix id. */
  readonly #profiles = new Map<string, {name: string; avatarUrl: string | null}>();
  readonly #legacyQrSessions = new Map<string, LegacyQrSession>();
  #registrationSecretCache: string | null | undefined;

  constructor(options: MatrixHubOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#homeserverUrl = options.homeserverUrl.replace(/\/+$/, "");
    this.#directory = options.directory;
    this.#auth = options.auth;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  /**
   * Whether the app can create its own account on this homeserver, which is
   * what lets messaging work without the user configuring anything.
   */
  async canProvision(): Promise<boolean> {
    return (await this.#registrationSecret()) !== null;
  }

  /**
   * Creates a dedicated local account for the app and returns its access token.
   *
   * The password is generated, used once, and never shown: the user is not
   * meant to know this account exists. Synapse's admin registration endpoint
   * works from the shared secret in the homeserver's own config, so this needs
   * no credentials from the user and no open registration on the server.
   */
  async provision(username: string, password: string): Promise<{userId: string; accessToken: string}> {
    const secret = await this.#registrationSecret();
    if (!secret)
      throw new Error(
        "Could not read the homeserver's registration secret, so Polymux cannot create its own account. Sign in with an existing account instead.",
      );
    const {nonce} = await this.#json<{nonce: string}>(
      `${this.#homeserverUrl}/_synapse/admin/v1/register`,
    );
    // Synapse checks an HMAC over the registration fields joined by NUL bytes,
    // which proves the caller holds the shared secret without sending it. The
    // separator is exact: a space here is rejected as a bad MAC.
    const mac = createHmac("sha1", secret)
      .update([nonce, username, password, "notadmin"].join("\u0000"))
      .digest("hex");
    const result = await this.#json<{user_id: string; access_token: string}>(
      `${this.#homeserverUrl}/_synapse/admin/v1/register`,
      {
        method: "POST",
        body: {
          nonce,
          username,
          password,
          admin: false,
          mac,
          initial_device_display_name: "Polymux",
        },
      },
    );
    return {userId: result.user_id, accessToken: result.access_token};
  }

  /**
   * The homeserver's registration secret, read from its own config. Only
   * reachable for a hub deployed on this machine, which is the only kind the
   * app provisions into.
   */
  async #registrationSecret(): Promise<string | null> {
    if (this.#registrationSecretCache !== undefined) return this.#registrationSecretCache;
    let secret: string | null = null;
    if (this.#directory) {
      const source = await readFile(
        path.join(this.#directory, "synapse", "homeserver.yaml"),
        "utf8",
      ).catch((): string => "");
      const value = source.match(
        /^registration_shared_secret:[ \t]*(?:"([^"]*)"|'([^']*)'|(\S+))/m,
      );
      const found = value?.[1] ?? value?.[2] ?? value?.[3] ?? null;
      if (found && found !== "null") secret = found;
    }
    this.#registrationSecretCache = secret;
    return secret;
  }

  /**
   * Whether a bridge bot exists on *this* homeserver — which is what proves an
   * appservice is registered here and its traffic can actually arrive.
   *
   * A relay can be perfectly healthy and still be delivering somewhere else
   * entirely; asking the relay how it is does not answer whether Polymux can
   * see anything it carries. Only the hub can answer that.
   */
  async hasBridgeBot(localpart: string): Promise<boolean> {
    const server = this.#auth().userId?.split(":")[1];
    if (!server) return false;
    const profile = await this.#client(
      `/_matrix/client/v3/profile/${encodeURIComponent(`@${localpart}:${server}`)}`,
    ).catch((): null => null);
    return profile !== null;
  }

  /** Confirms the homeserver answers and reports the server name it claims. */
  async probe(): Promise<HubProbe> {
    const response = await this.#json<{versions?: string[]}>(
      `${this.#homeserverUrl}/_matrix/client/versions`,
      {timeoutMs: 5_000},
    ).catch((error: unknown) => error as Error);
    if (response instanceof Error)
      return {
        reachable: false,
        homeserverName: null,
        error: `The Matrix hub at ${this.#baseUrl} is not responding. ${response.message}`,
      };
    const userId = this.#auth().userId;
    return {
      reachable: true,
      homeserverName: userId?.split(":")[1] ?? null,
      error: null,
    };
  }

  /** Exchanges a password for an access token. */
  async signIn(userId: string, password: string): Promise<{userId: string; accessToken: string}> {
    const localpart = userId.startsWith("@") ? userId.slice(1).split(":")[0] : userId;
    const result = await this.#json<{user_id: string; access_token: string}>(
      `${this.#homeserverUrl}/_matrix/client/v3/login`,
      {
        method: "POST",
        body: {
          type: "m.login.password",
          identifier: {type: "m.id.user", user: localpart},
          password,
          initial_device_display_name: "Polymux",
        },
      },
    );
    return {userId: result.user_id, accessToken: result.access_token};
  }

  async signOut(): Promise<void> {
    const {matrixToken} = this.#auth();
    if (!matrixToken) return;
    await this.#json(`${this.#homeserverUrl}/_matrix/client/v3/logout`, {
      method: "POST",
      body: {},
    }).catch((): undefined => undefined);
  }

  /**
   * Every joined room, newest first, with what a chat list needs to draw a row:
   * name, avatar, unread count, and a line of the last message.
   *
   * Built from one `/sync` rather than a call per room. With a couple of
   * hundred bridged rooms the old shape — joined_rooms, then a name and a
   * member list each — was four hundred round trips before the list could
   * paint, and still came back with no ordering and no unread counts.
   */
  async rooms(): Promise<MatrixRoom[]> {
    const filter = encodeURIComponent(
      JSON.stringify({
        room: {
          // Lazy loading keeps a 500-member group from shipping 500 member
          // events; the senders in the timeline still come through.
          state: {lazy_load_members: true},
          // Not 1. The newest event in a room is often not a message — a
          // reaction, a read marker's redaction, someone joining — and a
          // single-event timeline then holds no message at all, so the row
          // draws with no preview line and no time, and sorts to the bottom
          // as if the conversation were dead. A short window nearly always
          // contains one, and costs a few kilobytes per room.
          timeline: {limit: 20},
        },
      }),
    );
    let sync = await this.#client<SyncResponse>(
      `/_matrix/client/v3/sync?filter=${filter}&timeout=0`,
    );
    // A bridge creates a portal by inviting us to it, and `/sync` only reports
    // rooms we have joined — so an unanswered invite is a conversation that
    // exists on the homeserver and appears nowhere. These are portals our own
    // bridge fleet made on our own homeserver at our own request, so they are
    // accepted rather than queued for someone to accept by hand.
    if (await this.#acceptInvites(sync)) {
      sync = await this.#client<SyncResponse>(
        `/_matrix/client/v3/sync?filter=${filter}&timeout=0`,
      );
    }
    const joined = Object.entries(sync.rooms?.join ?? {});
    const userId = this.#auth().userId;
    const rooms = joined.map(([roomId, room]) => {
      const state = [...(room.state?.events ?? []), ...(room.timeline?.events ?? [])];
      const named = lastStateEvent(state, "m.room.name")?.content?.name;
      const avatar = lastStateEvent(state, "m.room.avatar")?.content?.url;
      const members = state.filter((event) => event.type === "m.room.member");
      const timeline = room.timeline?.events ?? [];
      const last = timeline.filter(isMessage).at(-1);
      // Ordering falls back to whatever did happen last, so a room whose
      // window holds no message still sits where its activity puts it.
      const activityTs = last?.origin_server_ts ?? timeline.at(-1)?.origin_server_ts;
      /**
       * A direct chat is a room with one other human in it. The bridges name
       * those rooms after the contact and leave groups with their own title,
       * so the fallback for an unnamed room is that contact's name.
       */
      const others = members
        .map((event) => event.state_key ?? "")
        .filter((member) => member && member !== userId && !isBridgeBot(member));
      const counterpart = members.find((event) => event.state_key === others[0]);
      /**
       * The bridge's own account of the room, and the answer worth trusting.
       * Sniffing the member list only works when the puppets happen to have
       * been loaded, and under lazy loading a quiet room ships none — which
       * filed three quarters of the WhatsApp chats here under "matrix" and
       * left them out of the list their platform was selected for.
       */
      const bridged = lastStateEvent(state, "m.bridge")?.content?.protocol?.id;
      const roomType = lastStateEvent(state, "m.bridge")?.content?.["com.beeper.room_type"];
      return {
        roomId,
        name: named ?? counterpart?.content?.displayname ?? others[0] ?? roomId,
        platform:
          platformOfProtocol(bridged) ??
          platformOfRoom(members.map((event) => event.state_key ?? "")),
        avatarUrl: mediaUrl(avatar ?? counterpart?.content?.avatar_url),
        unread: room.unread_notifications?.notification_count ?? 0,
        lastActivity: activityTs ? new Date(activityTs).toISOString() : null,
        preview: last ? previewOf(last) : null,
        /**
         * mautrix marks direct chats outright, and that answer is taken when
         * it is there. Otherwise the member count decides: a bridged direct
         * chat is the two people plus the bridge bot and puppet — three or
         * four — while a group is larger. Small groups on bridges that write
         * no room type are the blind spot, and they read as direct chats.
         */
        group: roomType
          ? roomType !== "dm"
          : (room.summary?.["m.joined_member_count"] ?? 0) > 4,
        // A bridge's own admin room is a control surface, not a conversation.
        management: !bridged && others.length === 0 && members.some(
          (event) => event.state_key && isBridgeBot(event.state_key),
        ),
      };
    });
    return (
      rooms
        .filter((room) => !room.management)
        .map(({management: _management, ...room}) => room)
        // Recency, with the never-used rooms after everything that has traffic.
        .sort((a, b) => Date.parse(b.lastActivity ?? "0") - Date.parse(a.lastActivity ?? "0"))
    );
  }

  /**
   * Follows Matrix's incremental sync stream. The first call establishes a
   * position without replaying the snapshot as live activity; later calls
   * long-poll and report each changed room once.
   */
  async sync(since: string | null, signal?: AbortSignal): Promise<MatrixSyncDelta> {
    const params = new URLSearchParams({timeout: since ? "30000" : "0"});
    if (since) params.set("since", since);
    const result = await this.#client<SyncResponse>(`/_matrix/client/v3/sync?${params}`, {
      timeoutMs: since ? 35_000 : REQUEST_TIMEOUT_MS,
      signal,
    });
    const nextBatch = result.next_batch;
    if (typeof nextBatch !== "string") throw new Error("The Matrix sync response has no next_batch token.");
    if (!since) return {nextBatch, activities: []};

    const activities: MatrixSyncActivity[] = [];
    for (const [roomId, room] of Object.entries(result.rooms?.join ?? {})) {
      const newest = room.timeline?.events?.at(-1);
      activities.push({roomId, sender: newest?.sender ?? ""});
    }
    return {nextBatch, activities};
  }

  async messages(
    roomId: string,
    limit: number,
    before?: string,
  ): Promise<{nextBefore: string | null; messages: MatrixMessage[]}> {
    const params = new URLSearchParams({dir: "b", limit: String(limit)});
    if (before) params.set("from", before);
    const result = await this.#client<{end?: string; chunk?: RawEvent[]; state?: RawEvent[]}>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?${params}`,
    );
    const chunk = withEdits(result.chunk ?? []);
    const messages = withReactions(chunk.filter(isMessage).map(toMessage), chunk, this.#auth().userId);
    return {
      nextBefore: result.end ?? null,
      // A bridged sender is `@whatsapp_614…:server`, which is unreadable in a
      // group. Their profile carries the name the contact actually goes by.
      messages: await this.#withSenders(messages, result.state ?? []),
    };
  }

  /**
   * Fills in display names and avatars for the senders of a page of messages.
   * The member events `/messages` returns alongside the chunk answer this
   * without a request; anyone missing from them is looked up once and cached,
   * because the same handful of people send most of a conversation.
   */
  async #withSenders(
    messages: MatrixMessage[],
    state: RawEvent[],
  ): Promise<MatrixMessage[]> {
    for (const event of state) {
      if (event.type !== "m.room.member" || !event.state_key) continue;
      this.#profiles.set(event.state_key, {
        name: event.content?.displayname ?? event.state_key,
        avatarUrl: mediaUrl(event.content?.avatar_url),
      });
    }
    const unknown = [...new Set(messages.map((message) => message.sender))].filter(
      (sender) => sender && !this.#profiles.has(sender),
    );
    await Promise.all(
      unknown.map(async (sender) => {
        const profile = await this.#client<{displayname?: string; avatar_url?: string}>(
          `/_matrix/client/v3/profile/${encodeURIComponent(sender)}`,
        ).catch((): {displayname?: string; avatar_url?: string} => ({}));
        this.#profiles.set(sender, {
          name: profile.displayname ?? sender,
          avatarUrl: mediaUrl(profile.avatar_url),
        });
      }),
    );
    return messages.map((message) => ({
      ...message,
      senderName: this.#profiles.get(message.sender)?.name ?? message.sender,
      senderAvatarUrl: this.#profiles.get(message.sender)?.avatarUrl ?? null,
    }));
  }

  async search(
    query: string,
    limit: number,
    roomIds?: string[],
  ): Promise<{nextBatch: string | null; messages: MatrixMessage[]}> {
    const result = await this.#client<{
      search_categories?: {
        room_events?: {next_batch?: string; results?: Array<{result?: RawEvent}>};
      };
    }>("/_matrix/client/v3/search", {
      method: "POST",
      body: {
        search_categories: {
          room_events: {
            search_term: query,
            order_by: "recent",
            filter: {limit, ...(roomIds?.length ? {rooms: roomIds} : {})},
          },
        },
      },
    });
    const events = result.search_categories?.room_events;
    return {
      nextBatch: events?.next_batch ?? null,
      messages: (events?.results ?? [])
        .map((item) => item.result)
        .filter((event): event is RawEvent => isMessage(event))
        .map(toMessage),
    };
  }

  /** Unread messages across every joined room, without marking them read. */
  async unread(limit: number, platform?: string): Promise<MatrixMessage[]> {
    const messages: MatrixMessage[] = [];
    const seen = new Set<string>();
    let from: string | undefined;
    const userId = this.#auth().userId;
    // The notifications endpoint pages back through history, so keep pulling
    // until enough unread events accumulate or the pages run out.
    for (let page = 0; page < 20 && messages.length < limit; page += 1) {
      const params = new URLSearchParams({
        limit: String(Math.min(100, Math.max(1, limit - messages.length))),
      });
      if (from) params.set("from", from);
      const result = await this.#client<{
        next_token?: string;
        notifications?: Array<{read?: boolean; room_id?: string; event?: RawEvent}>;
      }>(`/_matrix/client/v3/notifications?${params}`);
      for (const notification of result.notifications ?? []) {
        const event = notification.event;
        if (
          notification.read !== false ||
          !isMessage(event) ||
          event.sender === userId ||
          !event.event_id ||
          seen.has(event.event_id)
        )
          continue;
        seen.add(event.event_id);
        const roomId = notification.room_id ?? "";
        const source = await this.#roomPlatform(roomId);
        if (platform && source !== platform) continue;
        messages.push({
          ...toMessage(event),
          roomId,
          roomName: await this.#roomName(roomId),
          platform: source,
        });
        if (messages.length >= limit) break;
      }
      if (!result.next_token) break;
      from = result.next_token;
    }
    return messages;
  }

  /**
   * Marks a room read up to an event. A read receipt is the homeserver's own
   * record, so clearing it here clears it on the phone the messages also
   * landed on — which is the behaviour anyone who has used two clients expects.
   */
  async markRead(roomId: string, eventId: string): Promise<void> {
    await this.#client(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
      {method: "POST", body: {}},
    );
  }

  async send(roomId: string, body: string, replyTo?: string): Promise<string> {
    const result = await this.#client<{event_id?: string}>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${this.#txnId()}`,
      {
        method: "PUT",
        body: {
          msgtype: "m.text",
          body,
          ...(replyTo
            ? {"m.relates_to": {"m.in_reply_to": {event_id: replyTo}}}
            : {}),
        },
      },
    );
    return result.event_id ?? "";
  }

  /**
   * Sends already-uploaded media. The upload is separate because a file has to
   * reach the server before an event can point at it.
   */
  async sendMedia(
    roomId: string,
    file: {url: string; name: string; msgtype: string; mimetype: string; size: number},
  ): Promise<string> {
    const result = await this.#client<{event_id?: string}>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${this.#txnId()}`,
      {
        method: "PUT",
        body: {
          msgtype: file.msgtype,
          body: file.name,
          url: file.url,
          info: {mimetype: file.mimetype, size: file.size},
        },
      },
    );
    return result.event_id ?? "";
  }

  /** Uploads bytes to the media repository and returns their `mxc://` id. */
  async upload(name: string, mimetype: string, bytes: Uint8Array): Promise<string> {
    const {matrixToken} = this.#auth();
    const response = await fetch(
      `${this.#homeserverUrl}/_matrix/media/v3/upload?filename=${encodeURIComponent(name)}`,
      {
        method: "POST",
        headers: {"Content-Type": mimetype, Authorization: `Bearer ${matrixToken}`},
        body: bytes as unknown as BodyInit,
      },
    );
    if (!response.ok) throw new Error(`upload failed: ${response.status}`);
    const result = (await response.json()) as {content_uri?: string};
    if (!result.content_uri) throw new Error("upload returned no media id");
    return result.content_uri;
  }

  /** Puts an emoji on a message, and returns the reaction's own event id. */
  async react(roomId: string, eventId: string, key: string): Promise<string> {
    const result = await this.#client<{event_id?: string}>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.reaction/${this.#txnId()}`,
      {
        method: "PUT",
        body: {"m.relates_to": {rel_type: "m.annotation", event_id: eventId, key}},
      },
    );
    return result.event_id ?? "";
  }

  /** Takes an event back: how a reaction is removed and a message deleted. */
  async redact(roomId: string, eventId: string): Promise<void> {
    await this.#client(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${this.#txnId()}`,
      {method: "PUT", body: {}},
    );
  }

  /** A transaction id makes a send idempotent if the request is retried. */
  #txnId(): string {
    return `polymux-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Joins every room we have been invited to, and answers whether any join
   * landed — the caller re-syncs when one did, so the list drawn afterwards
   * includes them. One that fails is skipped rather than failing the list: the
   * rooms already joined are still worth showing.
   */
  async #acceptInvites(sync: SyncResponse): Promise<boolean> {
    const invited = Object.keys(sync.rooms?.invite ?? {});
    if (invited.length === 0) return false;
    const joined = await Promise.all(
      invited.map((roomId) =>
        this.#client(`/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {
          method: "POST",
          body: {},
        })
          .then(() => true)
          .catch(() => false),
      ),
    );
    return joined.some(Boolean);
  }

  async #roomName(roomId: string): Promise<string> {
    const cached = this.#roomNames.get(roomId);
    if (cached !== undefined) return cached;
    const state = await this.#client<{name?: string}>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name`,
    ).catch((): {name?: string} => ({}));
    const name = state.name ?? roomId;
    this.#roomNames.set(roomId, name);
    return name;
  }

  /**
   * Which network a room belongs to, inferred from the bridge ghost namespace
   * of whoever is in it. Bridged rooms are full of `@<platform>_…` puppets.
   */
  async #roomPlatform(roomId: string): Promise<string> {
    const cached = this.#roomPlatforms.get(roomId);
    if (cached !== undefined) return cached;
    const members = await this.#client<{joined?: Record<string, unknown>}>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`,
    ).catch((): {joined?: Record<string, unknown>} => ({}));
    let platform = "matrix";
    for (const member of Object.keys(members.joined ?? {})) {
      const found = platformFromSender(member);
      if (found) {
        platform = found;
        break;
      }
    }
    this.#roomPlatforms.set(roomId, platform);
    return platform;
  }

  async #client<T>(
    endpoint: string,
    options: {
      method?: "GET" | "POST" | "PUT";
      body?: unknown;
      timeoutMs?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const {matrixToken} = this.#auth();
    if (!matrixToken)
      throw new Error(
        "Polymux is not signed in to the Matrix hub. Open Settings → Communications to connect it.",
      );
    return this.#json<T>(`${this.#homeserverUrl}${endpoint}`, {
      method: options.method,
      body: options.body,
      headers: {Authorization: `Bearer ${matrixToken}`},
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
  }

  /**
   * Reports what a bridge can do and whether it already has an account linked.
   * Every failure degrades to a state on the returned row rather than throwing,
   * because one unreachable bridge must not blank the whole tab.
   */
  async bridge(
    platform: CommsPlatform,
    name: string,
    route: string | null,
  ): Promise<CommsBridgeDto> {
    const base: CommsBridgeDto = {
      platform,
      name,
      api: route ? "bridgev2" : "none",
      state: "unknown",
      accounts: [],
      flows: [],
      setup: null,
      managementRoomHint: null,
      error: null,
    };
    if (!route)
      return {
        ...base,
        state: "unavailable",
        // Reached only by a platform with no route and no relay handler of its
        // own — WeChat's row is built from its relay before this is asked.
        error:
          "Polymux has no way to bring this platform in yet, so there is nothing to link here.",
      };

    const whoami = await this.#provision<WhoamiResponse>(route, "whoami", {}).catch(
      (error: unknown) => error as Error,
    );
    if (whoami instanceof ProvisioningError && whoami.status === 404) {
      // No v3 routes: a legacy bridge. Only its ping tells us anything.
      const legacy = await this.#legacyPing(route).catch((error: unknown) => error as Error);
      if (legacy instanceof Error)
        return {...base, api: "legacy", state: "unreachable", error: legacy.message};
      return {
        ...base,
        api: "legacy",
        state: legacy.loggedIn ? (legacy.connected ? "connected" : "connecting") : "logged-out",
        accounts: legacy.loggedIn
          ? [
              {
                id: legacy.id ?? platform,
                name: legacy.id ?? name,
                state: legacy.connected ? "connected" : "connecting",
                error: null,
              },
            ]
          : [],
        flows: legacy.loggedIn
          ? []
          : [
              {
                id: "qr",
                name: "QR code",
                description: "Recommended · Scan with the Discord mobile app; CAPTCHAs are not supported",
              },
              {
                id: "user-token",
                name: "User token",
                description: "Full personal account access · Manual and sensitive; may carry account risk",
              },
              {
                id: "bot-token",
                name: "Bot token",
                description: "Servers only · The bot sees only channels and permissions granted to it",
              },
              {
                id: "oauth-token",
                name: "OAuth token",
                description: "Limited scopes · Standard Discord OAuth cannot provide all personal messages",
              },
            ],
        managementRoomHint: legacy.managementRoom,
        error: null,
      };
    }
    if (whoami instanceof Error)
      return {...base, state: "unreachable", error: whoami.message};

    const logins = whoami.logins ?? [];
    // WhatsApp keeps a user_login row after the phone removes this linked
    // device. whoami then still lists the old number, but its state says there
    // is no usable device. Treating that row as an account makes the Hub claim
    // it is merely broken and offer Unlink; in reality it is already unlinked
    // and the useful action is Connect.
    const unlinked = logins.filter(isUnlinkedLogin);
    const accounts = logins.filter((login) => !isUnlinkedLogin(login)).map(toAccount);
    // whoami already carries the flows, so no second round-trip is needed.
    return {
      ...base,
      state: bridgeState(accounts),
      accounts,
      flows: (whoami.login_flows ?? []).map((flow) => toFlow(platform, flow)),
      managementRoomHint: whoami.management_room || null,
      error:
        accounts.find((account) => account.error)?.error ??
        unlinked.find((login) => login.state?.message)?.state?.message ??
        null,
    };
  }

  async loginStart(route: string, flowId: string): Promise<CommsLoginStepDto> {
    const step = await this.#provision<RawLoginStep>(
      route,
      `login/start/${encodeURIComponent(flowId)}`,
      {method: "POST", body: {}},
    );
    // Only the start response carries the login id; every later step has to be
    // addressed with it, so losing it here strands the flow.
    if (!step.login_id)
      throw new Error("The bridge started a login without returning a login id.");
    return toStep(step, step.login_id);
  }

  async loginSubmit(
    route: string,
    loginId: string,
    stepId: string,
    stepType: "user_input" | "cookies",
    values: Record<string, string>,
  ): Promise<CommsLoginStepDto> {
    const step = await this.#provision<RawLoginStep>(
      route,
      `login/step/${encodeURIComponent(loginId)}/${encodeURIComponent(stepId)}/${stepType}`,
      {method: "POST", body: values},
    );
    return toStep(step, loginId);
  }

  /** Blocks until the remote side acts on a displayed QR or code. */
  async loginWait(route: string, loginId: string, stepId: string): Promise<CommsLoginStepDto> {
    const step = await this.#provision<RawLoginStep>(
      route,
      `login/step/${encodeURIComponent(loginId)}/${encodeURIComponent(stepId)}/display_and_wait`,
      {method: "POST", body: {}, timeoutMs: WAIT_TIMEOUT_MS},
    );
    return toStep(step, loginId);
  }

  async loginCancel(route: string, loginId: string): Promise<void> {
    await this.#provision(route, `login/cancel/${encodeURIComponent(loginId)}`, {
      method: "POST",
    }).catch((): undefined => undefined);
  }

  async logout(route: string, accountId: string, api: "bridgev2" | "legacy"): Promise<void> {
    if (api === "legacy") {
      await this.#legacy(route, "logout", {method: "POST"});
      return;
    }
    await this.#provision(route, `logout/${encodeURIComponent(accountId)}`, {
      method: "POST",
    });
  }

  /** Links a legacy bridge from a pasted account token. */
  async legacyTokenLogin(route: string, token: string): Promise<void> {
    await this.#legacy(route, "login/token", {method: "POST", body: {token}});
  }

  /** Starts mautrix-discord's websocket QR login and returns its first code. */
  async legacyQrLoginStart(route: string, loginId: string): Promise<string> {
    this.legacyQrLoginCancel(loginId);
    const secret = await this.#sharedSecret(route);
    if (!secret)
      throw new ProvisioningError(
        `Could not read ${route}'s provisioning secret from the hub, so its QR login cannot be driven from here.`,
        0,
        null,
      );
    const url = new URL(`${this.#baseUrl}/bridges/${route}/${LEGACY_PREFIX}/login/qr`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const userId = this.#auth().userId;
    if (userId) url.searchParams.set("user_id", userId);
    const session = new LegacyQrSession(
      new WebSocket(url, {headers: {Authorization: `Bearer ${secret}`}}),
    );
    this.#legacyQrSessions.set(loginId, session);
    try {
      const message = await session.next();
      if (message.code) return message.code;
      throw new Error(message.error || "Discord did not return a QR code.");
    } catch (error) {
      this.legacyQrLoginCancel(loginId);
      throw error;
    }
  }

  /** Waits for approval, or hands a refreshed QR code back to the renderer. */
  async legacyQrLoginWait(loginId: string): Promise<{code: string | null; complete: boolean}> {
    const session = this.#legacyQrSessions.get(loginId);
    if (!session) throw new Error("This Discord QR sign-in expired. Start it again.");
    const message = await session.next();
    if (message.success) {
      this.#legacyQrSessions.delete(loginId);
      return {code: null, complete: true};
    }
    if (message.code) return {code: message.code, complete: false};
    this.legacyQrLoginCancel(loginId);
    throw new Error(message.error || "Discord QR sign-in failed.");
  }

  legacyQrLoginCancel(loginId: string): void {
    this.#legacyQrSessions.get(loginId)?.close();
    this.#legacyQrSessions.delete(loginId);
  }

  async #legacyPing(route: string): Promise<{
    loggedIn: boolean;
    connected: boolean;
    id: string | null;
    managementRoom: string | null;
  }> {
    // mautrix-discord serializes this object with Go's default field name, so
    // the key really is capitalised.
    const result = await this.#legacy<{
      Discord?: {id?: string; logged_in?: boolean; connected?: boolean};
      management_room?: string;
    }>(route, "ping", {});
    return {
      loggedIn: result.Discord?.logged_in === true,
      connected: result.Discord?.connected === true,
      id: result.Discord?.id ?? null,
      managementRoom: result.management_room || null,
    };
  }

  async #legacy<T>(
    route: string,
    endpoint: string,
    options: {method?: "GET" | "POST"; body?: unknown},
  ): Promise<T> {
    const url = new URL(`${this.#baseUrl}/bridges/${route}/${LEGACY_PREFIX}/${endpoint}`);
    const auth = this.#auth();
    // The legacy API has no Matrix-token mode; it only accepts the shared
    // secret, and it identifies the user by query parameter.
    const secret = await this.#sharedSecret(route);
    if (!secret)
      throw new ProvisioningError(
        `Could not read ${route}'s provisioning secret from the hub, so its login cannot be driven from here.`,
        0,
        null,
      );
    if (auth.userId) url.searchParams.set("user_id", auth.userId);
    return this.#json<T>(url.toString(), {
      method: options.method,
      body: options.body,
      headers: {Authorization: `Bearer ${secret}`},
    });
  }

  async #provision<T>(route: string, endpoint: string, options: RequestOptions): Promise<T> {
    const url = new URL(`${this.#baseUrl}/bridges/${route}/${BRIDGEV2_PREFIX}/${endpoint}`);
    const auth = this.#auth();
    // Both auth modes need the target user in the query string: the shared
    // secret carries no identity, and a Matrix token is validated *against*
    // this user rather than decoded to find them.
    if (!auth.userId)
      throw new ProvisioningError(
        "Sign in to the Matrix hub to manage this bridge.",
        0,
        null,
      );
    url.searchParams.set("user_id", auth.userId);
    let headers: Record<string, string>;
    if (auth.matrixToken) headers = {Authorization: `Bearer ${auth.matrixToken}`};
    else {
      const secret = await this.#sharedSecret(route);
      if (!secret)
        throw new ProvisioningError(
          `Could not read ${route}'s provisioning secret from the hub, and Polymux holds no Matrix token for this bridge.`,
          0,
          null,
        );
      headers = {Authorization: `Bearer ${secret}`};
    }
    return this.#json<T>(url.toString(), {
      method: options.method,
      body: options.body,
      headers,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * Recovers a bridge's provisioning secret from its own config file. Only
   * needed when the app holds no Matrix token, or for legacy bridges that
   * accept nothing else.
   */
  async #sharedSecret(route: string): Promise<string | null> {
    if (this.#secrets.has(route)) return this.#secrets.get(route) ?? null;
    let secret: string | null = null;
    if (this.#directory) {
      const source = await readFile(
        path.join(this.#directory, "bridges", route, "config.yaml"),
        "utf8",
      ).catch((): string => "");
      const found = provisioningSecret(source);
      if (found && found !== "disable" && found !== "generate" && found !== "null")
        secret = found;
    }
    this.#secrets.set(route, secret);
    return secret;
  }

  async #json<T>(
    url: string,
    options: {
      method?: "GET" | "POST" | "PUT";
      body?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const auth = this.#auth();
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options.headers,
    };
    // Homeserver calls authenticate with the app's own token; provisioning
    // calls pass their own Authorization and must not be overridden.
    if (!headers.Authorization && auth.matrixToken && url.includes("/_matrix/client/"))
      headers.Authorization = `Bearer ${auth.matrixToken}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await this.#fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      const error = parsed as {error?: string; errcode?: string};
      throw new ProvisioningError(
        error.error ?? `Request failed with status ${response.status}`,
        response.status,
        error.errcode ?? null,
      );
    }
    return parsed as T;
  }
}

export interface MatrixRoom {
  roomId: string;
  name: string;
  platform: string;
  avatarUrl: string | null;
  unread: number;
  lastActivity: string | null;
  preview: string | null;
  group: boolean;
}

export interface MatrixAttachment {
  kind: "image" | "audio" | "video" | "file";
  /** Null when a bridge can describe the media but cannot retrieve its bytes. */
  url: string | null;
  name: string;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  /**
   * A sticker rather than a picture someone took. It is carried as an image
   * because that is what it is made of, but it is shown at a sticker's size —
   * blown up to the width of the thread it reads as a photo, which is not how
   * any messenger displays one.
   */
  sticker?: boolean;
}

export interface MatrixMessage {
  eventId: string;
  roomId: string;
  roomName: string;
  platform: string;
  sender: string;
  senderName: string;
  senderAvatarUrl: string | null;
  body: string;
  /** A conversation event, such as a group membership change, not authored text. */
  notice: boolean;
  sentAt: string;
  attachments: MatrixAttachment[];
  linkPreview: {title: string; description: string | null; url: string | null; source: string | null} | null;
  /** Where to go to see media that could not be carried across. */
  viewIn: {app: string; url: string} | null;
  /** One entry per distinct emoji on this message. */
  reactions: MatrixReaction[];
  /** The event this message answers, when it is a reply. */
  replyTo: string | null;
}

export interface MatrixReaction {
  key: string;
  count: number;
  /** The signed-in account's own reaction event, so it can be taken back. */
  mineEventId: string | null;
}

interface RawEvent {
  event_id?: string;
  room_id?: string;
  sender?: string;
  type?: string;
  state_key?: string;
  origin_server_ts?: number;
  content?: {
    body?: string;
    msgtype?: string;
    url?: string;
    filename?: string;
    /** Set on a room name, avatar, or member event rather than a message. */
    name?: string;
    displayname?: string;
    avatar_url?: string;
    /** Written by a bridge onto media it could not fetch; see `viewIn`. */
    "co.polymux.view_in"?: {app?: string; url?: string};
    /** Structured preview emitted by any bridge that can describe a rich item. */
    "co.polymux.link_preview"?: {title?: string; description?: string; url?: string; source?: string};
    /** Set by the WeChat bridge on a sticker, which it sends as a picture. */
    "co.polymux.sticker"?: boolean;
    /** Set on content imported by the WeChat bridge. */
    "co.polymux.wechat.remote"?: boolean;
    /** A bridge-originated conversation event rather than authored text. */
    "co.polymux.notice"?: boolean;
    /** Set on `m.bridge`: which network the room is a portal for. */
    protocol?: {id?: string};
    /** mautrix marks direct chats "dm" here; groups carry their own type. */
    "com.beeper.room_type"?: string;
    /**
     * How one event points at another: a reaction annotates the message it is
     * on, a reply quotes the one it answers. Both are read here.
     */
    "m.relates_to"?: {
      rel_type?: string;
      event_id?: string;
      key?: string;
      "m.in_reply_to"?: {event_id?: string};
    };
    /**
     * On an `m.replace` edit: the message as it now reads. The `body`
     * alongside it is a `* `-prefixed fallback for clients that do not know
     * the relation — showing that as a message of its own is how an edit
     * appears twice, starred.
     */
    "m.new_content"?: RawEvent["content"];
    info?: {
      mimetype?: string;
      size?: number;
      w?: number;
      h?: number;
      /** Milliseconds, as Matrix writes it. */
      duration?: number;
    };
  };
}

interface SyncResponse {
  next_batch?: string;
  rooms?: {
    /** Rooms a bridge has invited us to but that we have not joined yet. */
    invite?: Record<string, unknown>;
    join?: Record<
      string,
      {
        state?: {events?: RawEvent[]};
        timeline?: {events?: RawEvent[]};
        unread_notifications?: {notification_count?: number};
        /** Present on every room, and the only member count lazy loading
         * does not hide. */
        summary?: {"m.joined_member_count"?: number};
      }
    >;
  };
}

/**
 * Folds the page's `m.reaction` events onto the messages they annotate. Only
 * the reactions in the same page can be seen, which is what a page of history
 * carries: a reaction added long after the message is on a later page and
 * shows up when that part of the room is read.
 */
function withReactions(
  messages: MatrixMessage[],
  chunk: RawEvent[],
  userId: string | undefined,
): MatrixMessage[] {
  const byTarget = new Map<string, MatrixReaction[]>();
  for (const event of chunk) {
    if (event.type !== "m.reaction") continue;
    const relation = event.content?.["m.relates_to"];
    const target = relation?.event_id;
    const key = relation?.key;
    if (!target || !key) continue;
    const list = byTarget.get(target) ?? [];
    const existing = list.find((item) => item.key === key);
    const mine = Boolean(userId) && event.sender === userId ? (event.event_id ?? null) : null;
    if (existing) {
      existing.count += 1;
      existing.mineEventId = existing.mineEventId ?? mine;
    } else {
      list.push({key, count: 1, mineEventId: mine});
    }
    byTarget.set(target, list);
  }
  if (byTarget.size === 0) return messages;
  return messages.map((message) => ({
    ...message,
    reactions: byTarget.get(message.eventId) ?? [],
  }));
}

/**
 * Whether an event belongs in a conversation. Stickers are their own event
 * type rather than a kind of message, and leaving them out did not render them
 * plainly — it dropped them: a sticker sent on WhatsApp or Telegram simply was
 * not in the thread, with nothing to say one had been sent.
 */
function isMessage(event: RawEvent | undefined): event is RawEvent {
  if (event?.type === "m.sticker") return true;
  return event?.type === "m.room.message" && typeof event.content?.body === "string";
}

/** The newest event of a state type, since `/sync` gives them in order. */
function lastStateEvent(events: RawEvent[], type: string): RawEvent | undefined {
  return events.filter((event) => event.type === type).at(-1);
}

/** Bridge bots sit in every room they serve and are not people. */
function isBridgeBot(userId: string): boolean {
  return /^@[a-z]+bot:/.test(userId);
}

/**
 * Bridges name their own protocol in `m.bridge`, but not always the name the
 * rest of the app uses: mautrix's Go bridges append the language, and Meta's
 * one calls Messenger "facebook". Anything unlisted passes through, so a
 * bridge added later is filed under its own id rather than lost.
 */
/**
 * Names a bridge uses for itself that are not the name the app files it under.
 * Only the genuine renames belong here: Meta's bridge calls Messenger
 * "facebook", and its ghosts are prefixed to match.
 */
const BRIDGE_ALIASES: Record<string, string> = {
  facebook: "messenger",
  fb: "messenger",
  ig: "instagram",
};

/** Every platform the rail can file a room under. */
const KNOWN_PLATFORMS = new Set(COMMS_PLATFORMS.map((entry) => entry.value as string));

/**
 * Which platform a bridge's own id means. mautrix's Go bridges append the
 * language to their protocol id — `discordgo`, `gmessagesgo` — so the suffix
 * is taken off and the result checked against the platforms the app knows,
 * rather than each bridge being listed by hand: a hand-written list is a list
 * that is missing whichever bridge nobody has linked yet, and a room filed
 * under a platform that does not exist appears in no tab at all.
 */
function platformOfProtocol(id: string | undefined): string | null {
  if (!id) return null;
  return normalisePlatform(id) ?? id;
}

function normalisePlatform(value: string): string | null {
  const name = value.toLowerCase();
  if (BRIDGE_ALIASES[name]) return BRIDGE_ALIASES[name];
  if (KNOWN_PLATFORMS.has(name)) return name;
  const trimmed = name.replace(/go$/, "");
  if (BRIDGE_ALIASES[trimmed]) return BRIDGE_ALIASES[trimmed];
  return KNOWN_PLATFORMS.has(trimmed) ? trimmed : null;
}

function platformOfRoom(members: string[]): string {
  for (const member of members) {
    const found = platformFromSender(member);
    if (found) return found;
  }
  return "matrix";
}

/**
 * What an event says now: for an `m.replace` edit, the replacement content the
 * edit carries; for everything else, the content as sent. mautrix leans on
 * edits — a media message whose bytes turn out to be gone is edited into the
 * notice that says so — and reading `content` raw shows the fallback body,
 * `* `-prefixed, next to a blank original.
 */
function contentOf(event: RawEvent): RawEvent["content"] {
  const relation = event.content?.["m.relates_to"];
  const replacement = event.content?.["m.new_content"];
  if (relation?.rel_type === "m.replace" && replacement) return replacement;
  return event.content;
}

/**
 * Folds `m.replace` edits onto the events they edit. The target shows the
 * edited content under its own id and timestamp, and the edit event itself is
 * dropped — an edit whose target is outside this page survives, and is shown
 * from its replacement content by {@link contentOf}. Later edits win, whatever
 * order the page carries them in.
 */
function withEdits(chunk: RawEvent[]): RawEvent[] {
  const edits = new Map<string, RawEvent>();
  for (const event of chunk) {
    const relation = event.content?.["m.relates_to"];
    if (
      event.type !== "m.room.message" ||
      relation?.rel_type !== "m.replace" ||
      !relation.event_id ||
      !event.content?.["m.new_content"]
    )
      continue;
    const existing = edits.get(relation.event_id);
    if (!existing || (event.origin_server_ts ?? 0) >= (existing.origin_server_ts ?? 0))
      edits.set(relation.event_id, event);
  }
  if (edits.size === 0) return chunk;
  const targets = new Set(chunk.map((event) => event.event_id));
  return chunk
    .filter((event) => {
      const relation = event.content?.["m.relates_to"];
      const folded =
        relation?.rel_type === "m.replace" && relation.event_id && targets.has(relation.event_id);
      return !folded;
    })
    .map((event) => {
      const edit = event.event_id ? edits.get(event.event_id) : undefined;
      if (!edit) return event;
      // The replacement is the whole new content, but what the original was
      // a reply to is not the edit's to carry — it stays.
      return {
        ...event,
        content: {...contentOf(edit), "m.relates_to": event.content?.["m.relates_to"]},
      };
    });
}

/**
 * One line for the chat list. A media message's body is its filename, which
 * reads as noise in a list, so it is named by what it is instead.
 */
function previewOf(event: RawEvent): string {
  // Either shape of sticker: its own event type, or a picture a bridge marked
  // as one because it sends stickers as images.
  if (event.type === "m.sticker" || event.content?.["co.polymux.sticker"]) return "Sticker";
  switch (contentOf(event)?.msgtype) {
    case "m.image":
      return "Photo";
    case "m.audio":
      return "Voice message";
    case "m.video":
      return "Video";
    case "m.file":
      return `File · ${contentOf(event)?.filename ?? contentOf(event)?.body ?? ""}`.trim();
    default:
      return contentOf(event)?.body ?? "";
  }
}

const ATTACHMENT_KINDS: Record<string, MatrixAttachment["kind"]> = {
  "m.image": "image",
  "m.audio": "audio",
  "m.video": "video",
  "m.file": "file",
};

function attachmentsOf(event: RawEvent): MatrixAttachment[] {
  // A sticker carries no msgtype; the event type is what says it is a picture.
  const sticker = event.type === "m.sticker" || Boolean(event.content?.["co.polymux.sticker"]);
  const kind = sticker ? "image" : ATTACHMENT_KINDS[event.content?.msgtype ?? ""];
  const url = mediaUrl(event.content?.url);
  if (!kind) return [];
  // Ordinary Matrix media must have an MXC url. A bridge may deliberately
  // announce remote-only media, in which case `viewIn` is its usable route.
  if (!url && !event.content?.["co.polymux.view_in"]?.url) return [];
  const info = event.content?.info ?? {};
  return [
    {
      kind,
      url,
      name: event.content?.filename ?? event.content?.body ?? kind,
      mimeType: info.mimetype ?? null,
      size: info.size ?? null,
      width: info.w ?? null,
      height: info.h ?? null,
      // Matrix counts in milliseconds; seconds is what a player wants.
      duration: info.duration ? info.duration / 1000 : null,
      ...(sticker ? {sticker: true} : {}),
    },
  ];
}

function toMessage(raw: RawEvent): MatrixMessage {
  // An edit that reaches here unfolded — its target on another page — is
  // shown as what the message now says, not as its `* `-prefixed fallback.
  const event = {...raw, content: contentOf(raw)};
  const attachments = attachmentsOf(event);
  const preview = event.content?.["co.polymux.link_preview"];
  const linkPreview = preview?.title
    ? {
        title: preview.title,
        description: preview.description ?? null,
        url: /^https?:\/\//i.test(preview.url ?? "") ? preview.url! : null,
        source: preview.source ?? null,
      }
    : null;
  return {
    eventId: event.event_id ?? "",
    roomId: event.room_id ?? "",
    roomName: "",
    platform: "",
    sender: event.sender ?? "",
    senderName: "",
    senderAvatarUrl: null,
    // A media message's body is its filename; the attachment carries that
    // already, so repeating it above the image is just clutter.
    body: attachments.length > 0 || linkPreview ? "" : visibleMessageBody(event),
    notice: isNotice(event),
    sentAt: new Date(event.origin_server_ts ?? 0).toISOString(),
    attachments,
    linkPreview,
    reactions: [],
    replyTo: event.content?.["m.relates_to"]?.["m.in_reply_to"]?.event_id ?? null,
    viewIn: event.content?.["co.polymux.view_in"]?.url
      ? {
          app: event.content["co.polymux.view_in"].app ?? "the app",
          url: event.content["co.polymux.view_in"].url,
        }
      : null,
  };
}

/** Older imported WeChat rows predate bridge-side emoji normalization. */
function visibleMessageBody(event: RawEvent): string {
  const body = event.content?.body ?? "";
  if (!event.content?.["co.polymux.wechat.remote"]) return body;
  return visibleWeChatText(body);
}

/**
 * New bridge events carry an explicit marker. The text fallback is only for
 * older WeChat events already stored before that marker existed; scoping it to
 * bridged WeChat content avoids reclassifying somebody's ordinary sentence.
 */
function isNotice(event: RawEvent): boolean {
  if (event.content?.["co.polymux.notice"]) return true;
  if (!event.content?.["co.polymux.wechat.remote"]) return false;
  const body = event.content?.body?.trim() ?? "";
  return /\b(?:invited .+ to the group chat|removed .+ from the group chat|joined the group chat|left the group chat|changed the group name to)\b/i.test(body);
}

/**
 * Bridge ghosts are named `@<platform>_<remote id>:<server>`, which is the only
 * reliable signal of which network a room's traffic came from.
 */
function platformFromSender(sender: string): string | null {
  const localpart = sender.startsWith("@") ? sender.slice(1) : sender;
  const prefix = localpart.split("_")[0]?.toLowerCase();
  // Measured against the platform list rather than a copy of it: Slack,
  // Google Messages, X, Bluesky and Google Voice were all absent from the
  // copy, so their rooms fell through to "matrix" and were missing from the
  // tab their own ghosts named.
  return prefix ? normalisePlatform(prefix) : null;
}

interface RawFlow {
  id?: string;
  name?: string;
  description?: string;
}

interface WhoamiResponse {
  network?: {displayname?: string};
  login_flows?: RawFlow[];
  management_room?: string;
  logins?: RawLogin[];
}

interface RawLogin {
  id?: string;
  name?: string;
  profile?: {name?: string; username?: string; phone?: string; email?: string};
  /** Superseded by `state`, but still sent by older bridge builds. */
  state_event?: string;
  state?: {
    state_event?: string;
    error?: string;
    message?: string;
  };
}

interface RawLoginStep {
  type?: string;
  /** Present on a login-start response, which is where the flow is named. */
  login_id?: string;
  step_id?: string;
  instructions?: string;
  display_and_wait?: {type?: string; data?: string; image_url?: string};
  cookies?: {
    url?: string;
    user_agent?: string;
    wait_for_url_pattern?: string;
    fields?: Array<{
      id?: string;
      required?: boolean;
      sources?: Array<{type?: string; name?: string}>;
    }>;
  };
  user_input?: {
    fields?: Array<{
      type?: string;
      id?: string;
      name?: string;
      description?: string;
      pattern?: string;
    }>;
  };
  complete?: {user_login_id?: string; user_login_name?: string};
}

function toFlow(platform: CommsPlatform, flow: RawFlow): CommsLoginFlowDto {
  const id = flow.id ?? "";
  const limitation = LOGIN_FLOW_LIMITATIONS[`${platform}:${id}`];
  return {
    id,
    name: flow.name ?? flow.id ?? "Sign in",
    description: limitation ?? flow.description ?? "",
  };
}

/** Brief caveats the upstream flow descriptions omit. Unlisted flows need none. */
const LOGIN_FLOW_LIMITATIONS: Readonly<Record<string, string>> = {
  "telegram:bot": "Bots only · Uses a token from BotFather and does not act as your personal account",
  "telegram:manual": "Advanced · Existing session credentials; the bridge recommends not using this method",
  "slack:token": "Personal account · Browser tokens require the matching cookie",
  "slack:app": "Workspace app · Limited to channels and permissions granted to the app",
};

function toAccount(login: RawLogin): CommsBridgeAccountDto {
  const event = login.state?.state_event ?? login.state_event ?? null;
  return {
    id: login.id ?? "",
    name:
      login.profile?.name ??
      login.profile?.username ??
      login.profile?.phone ??
      login.profile?.email ??
      login.name ??
      login.id ??
      "Linked account",
    state: accountState(event),
    // `message` is written for a human; the error code is a fallback.
    error: login.state?.message ?? login.state?.error ?? null,
  };
}

/** A remote unlink can leave bridge metadata behind after its device is gone. */
function isUnlinkedLogin(login: RawLogin): boolean {
  const event = login.state?.state_event ?? login.state_event ?? null;
  const error = login.state?.error?.toLowerCase() ?? "";
  return event === "LOGGED_OUT" || event === "UNCONFIGURED" || error === "wa-not-logged-in";
}

/**
 * Bridge state events are richer than a settings row needs; collapse them to
 * the outcomes the UI draws differently. A logged-out or credential failure is
 * the user's problem to fix, while a transient disconnect resolves itself.
 */
function accountState(event: string | null): CommsBridgeAccountDto["state"] {
  switch (event) {
    case "CONNECTED":
    case "RUNNING":
      return "connected";
    case "CONNECTING":
    case "BACKFILLING":
    case "STARTING":
    case "TRANSIENT_DISCONNECT":
      return "connecting";
    case "BAD_CREDENTIALS":
      return "bad-credentials";
    case "UNKNOWN_ERROR":
    case "BRIDGE_UNREACHABLE":
      return "error";
    default:
      // Absence of evidence is not evidence of a live connection. Old and
      // future bridge builds both reach this path, so fail closed as unknown.
      return "unknown";
  }
}

function bridgeState(accounts: CommsBridgeAccountDto[]): CommsBridgeDto["state"] {
  if (accounts.length === 0) return "logged-out";
  if (accounts.some((account) => account.state === "connected")) return "connected";
  if (accounts.some((account) => account.state === "connecting")) return "connecting";
  if (accounts.some((account) => account.state === "bad-credentials" || account.state === "error"))
    return "error";
  return "unknown";
}

function toStep(step: RawLoginStep, loginId: string): CommsLoginStepDto {
  const stepId = step.step_id ?? "";
  const instructions = step.instructions?.trim() || null;
  switch (step.type) {
    case "user_input":
      return {
        type: "user_input",
        loginId,
        stepId,
        instructions,
        fields: (step.user_input?.fields ?? []).map(toField),
      };
    case "cookies":
      return {
        type: "cookies",
        loginId,
        stepId,
        instructions,
        url: step.cookies?.url ?? "",
        waitForUrl: step.cookies?.wait_for_url_pattern ?? null,
        userAgent: step.cookies?.user_agent ?? null,
        fields: (step.cookies?.fields ?? []).flatMap(toCookieFields),
      };
    case "display_and_wait":
      return {
        type: "display_and_wait",
        loginId,
        stepId,
        instructions,
        display: displayKind(step.display_and_wait?.type),
        data: step.display_and_wait?.data ?? null,
        imageUrl: step.display_and_wait?.image_url ?? null,
      };
    case "complete":
      return {
        type: "complete",
        loginId,
        accountId: step.complete?.user_login_id ?? null,
        accountName: step.complete?.user_login_name ?? null,
      };
    default:
      throw new Error(`The bridge asked for an unsupported login step (${step.type ?? "unknown"})`);
  }
}

function displayKind(value: string | undefined): "qr" | "code" | "emoji" | "nothing" {
  return value === "qr" || value === "code" || value === "emoji" ? value : "nothing";
}

const FIELD_TYPES = [
  "username",
  "phone_number",
  "email",
  "password",
  "2fa_code",
  "token",
  "url",
] as const;

function toField(field: {
  type?: string;
  id?: string;
  name?: string;
  description?: string;
  pattern?: string;
}): CommsLoginFieldDto {
  return {
    id: field.id ?? "",
    type: (FIELD_TYPES as readonly string[]).includes(field.type ?? "")
      ? (field.type as CommsLoginFieldDto["type"])
      : "unknown",
    name: field.name ?? field.id ?? "Value",
    description: field.description?.trim() || null,
    pattern: field.pattern ?? null,
  };
}

const COOKIE_SOURCES = [
  "cookie",
  "local_storage",
  "request_header",
  "request_body",
  "special",
] as const;

/**
 * A field may be satisfiable from more than one place; the first source is the
 * one a browser session can actually supply, so that is what gets collected.
 */
function toCookieFields(field: {
  id?: string;
  required?: boolean;
  sources?: Array<{type?: string; name?: string}>;
}): CommsLoginCookieFieldDto[] {
  const source = field.sources?.[0];
  const type = (COOKIE_SOURCES as readonly string[]).includes(source?.type ?? "")
    ? (source?.type as CommsLoginCookieFieldDto["source"])
    : "cookie";
  return [
    {
      source: type,
      id: source?.name ?? field.id ?? "",
      required: field.required !== false,
    },
  ];
}

/**
 * A bridge's provisioning shared secret, read out of its config.
 *
 * Deliberately a narrow read rather than a YAML parse, but it has to know both
 * layouts: megabridge binaries keep `provisioning:` at the top level, while
 * pre-megabridge ones nest it under `bridge:`. Looking only at the top level
 * meant Discord — the one legacy bridge in the fleet — reported that its login
 * could not be driven from here, with the secret sitting in the file all along.
 *
 * So the block is found at whatever indent it sits on, and the search stops at
 * the first line that is no longer inside it.
 */
export function provisioningSecret(source: string): string | null {
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index].match(/^([ \t]*)provisioning:[ \t]*$/);
    if (!header) continue;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      const line = lines[scan];
      if (line.trim() === "") continue;
      if (line.length - line.trimStart().length <= header[1].length) break;
      const value = line.match(/^[ \t]*shared_secret:[ \t]*(?:"([^"]*)"|'([^']*)'|(\S+))/);
      if (value) return value[1] ?? value[2] ?? value[3] ?? null;
    }
  }
  return null;
}
