import {readFile} from "node:fs/promises";
import {createHmac} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
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
  ChatMemberDto,
  ChatMentionsDto,
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
/** A linked bridge ghost is still the signed-in person. Once ownership is
 * resolved, no consumer should leak that ghost's incomplete remote profile. */
const SELF_SENDER_NAME = "You";
/**
 * Bridge v2 seeds portal read markers while its first WhatsApp backfill is
 * still landing. They are bookkeeping, not evidence that the phone cleared
 * the unread count carried by that history sync. Subsequent synchronized
 * markers are real read state.
 */
const WHATSAPP_INITIAL_READ_GRACE_MS = 10 * 60 * 1_000;
/**
 * Bridges populate a new portal by joining every puppet they need for
 * transport. Those first few minutes are room construction, not evidence
 * that dozens of people just joined the remote conversation.
 */
const PORTAL_SETUP_WINDOW_MS = 5 * 60 * 1_000;

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
  /** Whether this client is reading Polymux's embedded homeserver database. */
  embedded?: boolean;
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
  readonly #embedded: boolean;
  readonly #auth: () => HubAuth;
  readonly #fetch: typeof globalThis.fetch;
  readonly #secrets = new Map<string, string | null>();
  readonly #roomNames = new Map<string, string>();
  readonly #roomPlatforms = new Map<string, string>();
  /** Sender display names and avatars, keyed by Matrix id. */
  readonly #profiles = new Map<string, {name: string; avatarUrl: string | null}>();
  /** Homeserver URL previews are stable for the life of one Hub session. */
  readonly #linkPreviews = new Map<string, Promise<MatrixLinkPreview | null>>();
  /**
   * Older bridge databases can retain the Matrix id a remote message had
   * before its history was copied into Polymux's embedded homeserver. Keep the
   * lossless old-id aliases beside each current local event once resolved, so
   * later reaction refreshes do not repeat the bridge-database join.
   */
  readonly #reactionTargetAliases = new Map<string, Map<string, string[]>>();
  readonly #legacyQrSessions = new Map<string, LegacyQrSession>();
  #registrationSecretCache: string | null | undefined;

  constructor(options: MatrixHubOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#homeserverUrl = options.homeserverUrl.replace(/\/+$/, "");
    this.#directory = options.directory;
    this.#embedded = options.embedded ?? false;
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
    const currentPortalRooms = await currentWeChatPortalRooms(this.#directory);
    // A Space relationship can be advertised from either side. Some bridges
    // write `m.space.parent` into each child, while others only write
    // `m.space.child` into the Space. Turn the latter into the same parent
    // lookup before the room rows are assembled.
    const childParents = new Map<string, Set<string>>();
    for (const [parentId, room] of joined) {
      const state = [...(room.state?.events ?? []), ...(room.timeline?.events ?? [])];
      for (const event of latestStateEvents(state, "m.space.child")) {
        if (
          !event.state_key ||
          !Array.isArray(event.content?.via) ||
          event.content.via.length === 0
        ) continue;
        const parents = childParents.get(event.state_key) ?? new Set<string>();
        parents.add(parentId);
        childParents.set(event.state_key, parents);
      }
    }
    // A backfill is appended to Matrix's sync stream when it arrives, even
    // though its authored time belongs in the past. The embedded reader owns
    // the event store, so use its chronological head for the row just as the
    // open conversation does. Otherwise an imported 2025 batch can replace a
    // 2026 message's preview, timestamp and sort position in the chat list.
    const userId = this.#auth().userId;
    const localLatest = this.#localLatestMessages(joined.map(([roomId]) => roomId));
    const rooms = joined.map(([roomId, room]) => {
      const state = [...(room.state?.events ?? []), ...(room.timeline?.events ?? [])];
      const named = lastStateEvent(state, "m.room.name")?.content?.name;
      const avatar = lastStateEvent(state, "m.room.avatar")?.content?.url;
      const members = state.filter((event) => event.type === "m.room.member");
      const timeline = room.timeline?.events ?? [];
      const last = localLatest.get(roomId) ?? timeline
        .filter((event): event is RawEvent => isTimelineItem(event, userId))
        .at(-1);
      // Ordering falls back to whatever did happen last, so a room whose
      // window holds no message still sits where its activity puts it. The
      // signed-in account joining is local bookkeeping, not chat activity.
      const latestNonSelfEvent = timeline
        .filter((event) => event.type !== "m.room.member" || event.state_key !== userId)
        .at(-1);
      const activityTs = last?.origin_server_ts ?? latestNonSelfEvent?.origin_server_ts;
      /**
       * A direct chat is a room with one other human in it. The bridges name
       * those rooms after the contact and leave groups with their own title,
       * so the fallback for an unnamed room is that contact's name.
       */
      const others = members
        .map((event) => event.state_key ?? "")
        .filter((member) => member && member !== userId && !isBridgeBot(member));
      // A bridged DM may contain two remote-looking members: the contact and
      // the linked account's own ghost. Prefer the member whose display name
      // names the room. If lazy state did not include that contact, show no
      // portrait rather than borrowing the signed-in account's.
      const counterpart = named
        ? members.find(
            (event) =>
              Boolean(event.state_key) &&
              others.includes(event.state_key!) &&
              event.content?.displayname === named,
          )
        : others.length === 1
          ? members.find((event) => event.state_key === others[0])
          : undefined;
      /**
       * The bridge's own account of the room, and the answer worth trusting.
       * Sniffing the member list only works when the puppets happen to have
       * been loaded, and under lazy loading a quiet room ships none — which
       * filed three quarters of the WhatsApp chats here under "matrix" and
       * left them out of the list their platform was selected for.
       */
      const bridged = lastStateEvent(state, "m.bridge")?.content?.protocol?.id;
      const bridgeContent = lastStateEvent(state, "m.bridge")?.content;
      const remoteId = bridgeContent?.channel?.id?.trim();
      // Bridge v2 distinguishes the account-wide filtering container from a
      // real remote community. Older bridges used the unsuffixed key.
      const roomType =
        bridgeContent?.["com.beeper.room_type.v2"] ?? bridgeContent?.["com.beeper.room_type"];
      const space =
        roomType === "space" ||
        roomType === "personal_filtering_space" ||
        lastStateEvent(state, "m.room.create")?.content?.type === "m.space";
      const defaultSpace = roomType === "personal_filtering_space";
      // A removed Space link remains as empty current state. Only a parent
      // carrying `via` is still connected, and Matrix permits more than one.
      const parentIds = [...new Set([
        ...latestStateEvents(state, "m.space.parent")
          .filter(
            (event) =>
              Boolean(event.state_key) &&
              Array.isArray(event.content?.via) &&
              event.content.via.length > 0,
          )
          .map((event) => event.state_key!),
        ...(childParents.get(roomId) ?? []),
      ])];
      const platform =
        platformOfProtocol(bridged) ??
        platformOfRoom(members.map((event) => event.state_key ?? ""));
      this.#roomPlatforms.set(roomId, platform);
      const group = roomType
        ? roomType !== "dm"
        : (room.summary?.["m.joined_member_count"] ?? 0) > 4;
      const rawName = named ?? counterpart?.content?.displayname ?? others[0] ?? roomId;
      // Only the embedded homeserver is bridge-attested. A remote Matrix room
      // can write these state keys itself, so it must not gain an official
      // badge from untrusted room state.
      const official = this.#embedded &&
        officialAccountFromState(state, counterpart?.state_key);
      return {
        roomId,
        name: contactDisplayName(rawName, platform, group),
        platform,
        space,
        defaultSpace,
        parentIds,
        ...(remoteId ? {remoteId} : {}),
        ...(currentPortalRooms.has(roomId) ? {currentPortal: true} : {}),
        avatarUrl: mediaUrl(avatar ?? (!group ? counterpart?.content?.avatar_url : undefined)),
        unread: room.unread_notifications?.notification_count ?? 0,
        lastActivity: activityTs ? new Date(activityTs).toISOString() : null,
        preview: last ? previewOf(last, userId) : null,
        /**
         * mautrix marks direct chats outright, and that answer is taken when
         * it is there. Otherwise the member count decides: a bridged direct
         * chat is the two people plus the bridge bot and puppet — three or
         * four — while a group is larger. Small groups on bridges that write
         * no room type are the blind spot, and they read as direct chats.
         */
        group,
        ...(official ? {official: true} : {}),
        // A bridge's own admin room is a control surface, not a conversation.
        management: !space && !bridged && others.length === 0 && members.some(
          (event) => event.state_key && isBridgeBot(event.state_key),
        ),
      };
    });
    // A bridge-created Space may not carry `m.bridge` itself even though all
    // of its children do. File that container under the children's one shared
    // platform so it appears in the same rail rather than under Matrix.
    for (const space of rooms.filter((room) => room.space && room.platform === "matrix")) {
      const platforms = new Set(
        rooms
          .filter((room) => room.parentIds.includes(space.roomId) && room.platform !== "matrix")
          .map((room) => room.platform),
      );
      if (platforms.size !== 1) continue;
      space.platform = [...platforms][0]!;
      this.#roomPlatforms.set(space.roomId, space.platform);
    }
    const bridgeState = this.#roomBridgeState(rooms, this.#localReadThrough());
    const enriched = rooms
        .filter((room) => !room.management)
        .map(({management: _management, ...room}) => {
          const state = bridgeState.get(room.roomId);
          const unreadByAccount = state?.unreadByAccount.size
            ? Object.fromEntries(state.unreadByAccount)
            : undefined;
          return {
            ...room,
            // Bridge v2's portal row identifies the remote conversation. A
            // DM's Matrix membership also contains the linked account's ghost,
            // and lazy state can leave that self member looking like the only
            // counterpart. Prefer the portal avatar so a contact row never
            // borrows the signed-in account's portrait.
            avatarUrl: mediaUrl(state?.avatarMxc ?? undefined) ?? room.avatarUrl,
            ...(state?.remoteId ? {remoteId: state.remoteId, currentPortal: true} : {}),
            ...(state?.accountIds.size ? {accountIds: [...state.accountIds]} : {}),
            ...(unreadByAccount ? {unreadByAccount} : {}),
            // Remote bridge state knows which imported messages were already
            // read. Matrix remains the fallback for bridges without it.
            unread: unreadByAccount
              ? Math.max(0, ...Object.values(unreadByAccount))
              : room.unread,
          };
        });
    // Account-filtered rails also need their Space container. The Space is not
    // a bridge portal, so inherit only the account membership of its children;
    // unread totals remain a renderer summary of those same rows.
    for (const space of enriched.filter((room) => room.space)) {
      const accountIds = new Set(
        enriched
          .filter((room) => room.parentIds.includes(space.roomId))
          .flatMap((room) => room.accountIds ?? []),
      );
      if (accountIds.size) space.accountIds = [...accountIds];
    }
    return enriched
        // Recency, with the never-used rooms after everything that has traffic.
        .sort((a, b) => Date.parse(b.lastActivity ?? "0") - Date.parse(a.lastActivity ?? "0"));
  }

  /**
   * Bridge v2 keeps the account-to-portal relation in its own database rather
   * than in Matrix's `m.bridge` state. Reading that relation is what lets two
   * accounts on the same network have separate conversation lists.
   */
  /**
   * The embedded receipt is the common landing point for reads made in
   * Polymux and `MarkChatAsRead` events bridged back from WhatsApp. Its target
   * timestamp survives history arriving later in Matrix stream order.
   */
  #localReadThrough(): Map<string, number> {
    const userId = this.#auth().userId;
    if (!this.#directory || !userId) return new Map();
    let database: DatabaseSync;
    try {
      database = new DatabaseSync(path.join(this.#directory, "homeserver.sqlite"), {readOnly: true});
    } catch {
      return new Map();
    }
    try {
      const rows = database.prepare(`
        SELECT r.room_id, e.origin_server_ts AS read_ts
        FROM receipts r
        JOIN events e ON e.stream_order = r.stream_order
        WHERE r.user_id = ?
      `).all(userId) as Array<{room_id: string; read_ts: number}>;
      return new Map(rows.map((row) => [row.room_id, Number(row.read_ts)]));
    } catch {
      // External homeservers and older embedded stores retain Matrix's count.
      return new Map();
    } finally {
      database.close();
    }
  }

  #roomBridgeState(
    rooms: Array<{roomId: string; platform: string}>,
    localReadThrough: Map<string, number>,
  ): Map<
    string,
    {
      accountIds: Set<string>;
      unreadByAccount: Map<string, number>;
      avatarMxc: string | null;
      remoteId: string | null;
    }
  > {
    const found = new Map<
      string,
      {
        accountIds: Set<string>;
        unreadByAccount: Map<string, number>;
        avatarMxc: string | null;
        remoteId: string | null;
      }
    >();
    if (!this.#directory) return new Map();
    for (const platform of new Set(rooms.map((room) => room.platform))) {
      let database: DatabaseSync;
      try {
        database = new DatabaseSync(
          path.join(this.#directory, "bridges", platform, "bridge.db"),
          {readOnly: true},
        );
      } catch {
        continue;
      }
      try {
        const rows = database.prepare(`
          SELECT p.mxid AS room_id, p.receiver AS account_id, p.id AS remote_id
          FROM portal p
          WHERE p.mxid IS NOT NULL AND p.receiver <> ''
          UNION
          SELECT p.mxid AS room_id, up.login_id AS account_id, p.id AS remote_id
          FROM portal p
          JOIN user_portal up
            ON up.bridge_id = p.bridge_id
           AND up.portal_id = p.id
           AND up.portal_receiver = p.receiver
          WHERE p.mxid IS NOT NULL AND up.login_id <> ''
        `).all() as Array<{room_id: string; account_id: string; remote_id: string}>;
        for (const row of rows) {
          if (!row.room_id || !row.account_id) continue;
          const state = found.get(row.room_id) ?? {
            accountIds: new Set<string>(),
            unreadByAccount: new Map<string, number>(),
            avatarMxc: null,
            remoteId: null,
          };
          state.accountIds.add(row.account_id);
          state.remoteId ??= row.remote_id || null;
          found.set(row.room_id, state);
        }
      } catch {
        // Legacy bridges do not share Bridge v2's portal schema.
      }
      try {
        const avatars = database.prepare(`
          SELECT mxid AS room_id, avatar_mxc
          FROM portal
          WHERE mxid IS NOT NULL AND avatar_mxc IS NOT NULL AND avatar_mxc <> ''
        `).all() as Array<{room_id: string; avatar_mxc: string}>;
        for (const row of avatars) {
          if (!row.room_id || !row.avatar_mxc) continue;
          const state = found.get(row.room_id) ?? {
            accountIds: new Set<string>(),
            unreadByAccount: new Map<string, number>(),
            avatarMxc: null,
            remoteId: null,
          };
          state.avatarMxc = row.avatar_mxc;
          found.set(row.room_id, state);
        }
      } catch {
        // Older portal schemas retain Matrix's room/member avatar fallback.
      }
      if (platform !== "whatsapp") {
        try {
          const roomIds = new Set(
            rooms.filter((room) => room.platform === platform).map((room) => room.roomId),
          );
          const localReads = [...localReadThrough].filter(([roomId]) => roomIds.has(roomId));
          const localReadRows = localReads.length
            ? `VALUES ${localReads.map(() => "(?, ?)").join(", ")}`
            : "SELECT NULL, 0 WHERE 0";
          const unread = database.prepare(`
            WITH matrix_read(room_id, read_ts) AS (${localReadRows}), portal_state AS (
              SELECT
                p.mxid AS room_id,
                p.bridge_id,
                p.id AS portal_id,
                p.receiver AS portal_receiver,
                up.login_id AS account_id,
                up.last_read AS bridge_read,
                COALESCE(mr.read_ts * 1000000, 0) AS matrix_read
              FROM portal p
              JOIN user_portal up
                ON up.bridge_id = p.bridge_id
               AND up.portal_id = p.id
               AND up.portal_receiver = p.receiver
              LEFT JOIN matrix_read mr ON mr.room_id = p.mxid
              WHERE p.mxid IS NOT NULL AND up.login_id <> ''
            )
            SELECT
              room_id,
              account_id,
              CASE
                -- No bridge watermark means this bridge has not exposed
                -- remote read state for the portal. Keep Matrix's answer
                -- unless Polymux itself has established a local marker.
                WHEN bridge_read IS NULL AND matrix_read = 0 THEN NULL
                -- A reply from the linked account proves it saw everything
                -- before the reply even if the bridge's receipt is delayed.
                WHEN (
                  SELECT m.sender_id
                  FROM message m
                  WHERE m.bridge_id = portal_state.bridge_id
                    AND m.room_id = portal_state.portal_id
                    AND m.room_receiver = portal_state.portal_receiver
                  ORDER BY m.timestamp DESC
                  LIMIT 1
                ) = account_id THEN 0
                ELSE (
                  SELECT COUNT(DISTINCT m.id)
                  FROM message m
                  WHERE m.bridge_id = portal_state.bridge_id
                    AND m.room_id = portal_state.portal_id
                    AND m.room_receiver = portal_state.portal_receiver
                    -- Once a bridge has a remote watermark it is the
                    -- authority: it can move forward after a read elsewhere,
                    -- or back when the native app marks the chat unread.
                    AND m.timestamp > COALESCE(bridge_read, matrix_read)
                    AND m.sender_id <> portal_state.account_id
                )
              END AS unread
            FROM portal_state
          `).all(...localReads.flatMap(([roomId, readTs]) => [roomId, readTs])) as Array<{
            room_id: string;
            account_id: string;
            unread: number | null;
          }>;
          for (const row of unread) {
            if (!row.room_id || !row.account_id || row.unread === null) continue;
            const state = found.get(row.room_id) ?? {
              accountIds: new Set<string>(),
              unreadByAccount: new Map<string, number>(),
              avatarMxc: null,
              remoteId: null,
            };
            state.accountIds.add(row.account_id);
            state.unreadByAccount.set(row.account_id, Math.max(0, Number(row.unread)));
            found.set(row.room_id, state);
          }
        } catch {
          // Legacy bridges without Bridge v2 read markers retain Matrix's count.
        }
      }
      if (platform === "whatsapp") {
        try {
          const roomIds = new Set(
            rooms.filter((room) => room.platform === platform).map((room) => room.roomId),
          );
          const localReads = [...localReadThrough].filter(([roomId]) => roomIds.has(roomId));
          const localReadRows = localReads.length
            ? `VALUES ${localReads.map(() => "(?, ?)").join(", ")}`
            : "SELECT NULL, 0 WHERE 0";
          const unread = database.prepare(`
            WITH matrix_read(room_id, read_ts) AS (${localReadRows}), device AS (
              SELECT
                CASE
                  WHEN instr(jid, ':') > 0 THEN substr(jid, 1, instr(jid, ':') - 1)
                  ELSE substr(jid, 1, instr(jid, '@') - 1)
                END AS account_id,
                'lid-' || CASE
                  WHEN instr(lid, ':') > 0 THEN substr(lid, 1, instr(lid, ':') - 1)
                  ELSE substr(lid, 1, instr(lid, '@') - 1)
                END AS lid_sender
              FROM whatsmeow_device
            ), portal_state AS (
              SELECT
                p.mxid AS room_id,
                p.bridge_id,
                p.id AS portal_id,
                p.receiver AS portal_receiver,
                up.login_id AS account_id,
                COALESCE(CAST(up.last_read / 1000000 AS INTEGER), 0) AS bridge_read_ts,
                COALESCE(mr.read_ts, 0) AS matrix_read_ts,
                h.chat_jid IS NOT NULL AS has_history,
                COALESCE(h.last_message_timestamp * 1000, 0) AS history_ts,
                COALESCE(h.synced_login_ts * 1000, 0) AS sync_ts,
                MAX(COALESCE(h.unread_count, 0), COALESCE(h.marked_as_unread, 0)) AS history_unread,
                d.lid_sender
              FROM portal p
              JOIN user_portal up
                ON up.bridge_id = p.bridge_id
               AND up.portal_id = p.id
               AND up.portal_receiver = p.receiver
              LEFT JOIN whatsapp_history_sync_conversation h
                ON h.bridge_id = up.bridge_id
               AND h.user_login_id = up.login_id
               AND h.chat_jid = p.id
              LEFT JOIN device d ON d.account_id = up.login_id
              LEFT JOIN matrix_read mr ON mr.room_id = p.mxid
              WHERE p.mxid IS NOT NULL AND up.login_id <> ''
            ), calculated AS (
              SELECT
                *,
                MAX(
                  matrix_read_ts,
                  CASE
                    WHEN bridge_read_ts > sync_ts + ${WHATSAPP_INITIAL_READ_GRACE_MS}
                      THEN bridge_read_ts
                    ELSE 0
                  END
                ) AS trusted_read_ts,
                (
                  SELECT m.sender_id
                  FROM message m
                  WHERE m.bridge_id = portal_state.bridge_id
                    AND m.room_id = portal_state.portal_id
                    AND m.room_receiver = portal_state.portal_receiver
                  ORDER BY m.timestamp DESC
                  LIMIT 1
                ) AS latest_sender
              FROM portal_state
            ), unread_state AS (
              SELECT
                *,
                CASE
                  WHEN trusted_read_ts > 0 AND trusted_read_ts >= history_ts
                    THEN trusted_read_ts
                  ELSE history_ts
                END AS read_through,
                CASE
                  WHEN trusted_read_ts > 0 AND trusted_read_ts >= history_ts
                    THEN 0
                  ELSE history_unread
                END AS baseline_unread
              FROM calculated
            )
            SELECT
              room_id,
              account_id,
              CASE
                -- Sending a reply from either linked phone necessarily means
                -- the conversation was read through that reply.
                WHEN latest_sender = account_id OR latest_sender = lid_sender THEN 0
                -- With no remote watermark at all, retain Matrix's answer.
                WHEN bridge_read_ts = 0 AND matrix_read_ts = 0 AND has_history = 0 THEN NULL
                ELSE baseline_unread + (
                  SELECT COUNT(DISTINCT m.id)
                  FROM message m
                  WHERE m.bridge_id = unread_state.bridge_id
                    AND m.room_id = unread_state.portal_id
                    AND m.room_receiver = unread_state.portal_receiver
                    AND CAST(m.timestamp / 1000000 AS INTEGER) > unread_state.read_through
                    AND m.sender_id <> unread_state.account_id
                    AND (unread_state.lid_sender IS NULL OR m.sender_id <> unread_state.lid_sender)
                )
              END AS unread
            FROM unread_state
          `).all(...localReads.flatMap(([roomId, readTs]) => [roomId, readTs])) as Array<{
            room_id: string;
            account_id: string;
            unread: number | null;
          }>;
          for (const row of unread) {
            if (!row.room_id || !row.account_id || row.unread === null) continue;
            const state = found.get(row.room_id) ?? {
              accountIds: new Set<string>(),
              unreadByAccount: new Map<string, number>(),
              avatarMxc: null,
              remoteId: null,
            };
            state.accountIds.add(row.account_id);
            state.unreadByAccount.set(row.account_id, Math.max(0, Number(row.unread)));
            found.set(row.room_id, state);
          }
        } catch {
          // Older WhatsApp schemas still get Matrix's unread count.
        }
      }
      database.close();
    }
    return found;
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
    const local = this.#localTimeline(roomId, limit, before);
    const result = local ?? await this.#matrixTimeline(roomId, limit, before);
    const chunk = withEdits(result.chunk ?? []);
    const userId = this.#auth().userId;
    const plain = chunk
      .filter((event): event is RawEvent => isTimelineItem(event, userId))
      .map((event) => toMessage(event, userId));
    // A reaction may be written hours after its target and therefore live on
    // a completely different history page. The embedded store can resolve
    // every active annotation for the messages actually being returned.
    const reactionEvents = this.#localReactionEvents(
      roomId,
      plain.map((message) => message.eventId),
    ) ?? chunk;
    const messages = withReactions(
      plain,
      reactionEvents,
      userId,
    );
    const owned = this.#withBridgeOwnership(roomId, messages);
    const named = await this.#withSenders(owned, result.state ?? [], roomId);
    return {
      nextBefore: result.end ?? null,
      // A bridged sender is `@whatsapp_614…:server`, which is unreadable in a
      // group. Their profile carries the name the contact actually goes by.
      messages: await this.#withLinkPreviews(named),
    };
  }

  /**
   * Whether a Matrix sender is one of the signed-in person's identities.
   * Bridge v2 may use a remote-account ghost for imported outgoing history,
   * so the Matrix user id alone is not enough for quotes, notifications, or
   * any other surface outside a fully decorated message page.
   */
  senderIsMine(roomId: string, sender: string): boolean {
    const userId = this.#auth().userId;
    if (Boolean(userId) && sender === userId) return true;
    if (!roomId || !sender) return false;
    const [owned] = this.#withBridgeOwnership(roomId, [
      {
        eventId: "",
        roomId,
        roomName: "",
        platform: "",
        sender,
        senderName: "",
        senderAvatarUrl: null,
        mine: false,
        body: "",
        notice: false,
        sentAt: new Date(0).toISOString(),
        attachments: [],
        linkPreview: null,
        reactions: [],
        replyTo: null,
        viewIn: null,
      },
    ]);
    return owned?.mine ?? false;
  }

  /** Network fallback for external homeservers, which own their timeline order. */
  async #matrixTimeline(
    roomId: string,
    limit: number,
    before?: string,
  ): Promise<{end?: string; chunk?: RawEvent[]; state?: RawEvent[]}> {
    const params = new URLSearchParams({dir: "b", limit: String(limit)});
    if (before) params.set("from", before);
    // A room can carry dozens of setup/state events beside a handful of
    // visible items. Ask Matrix for the event families the thread can use so
    // those invisible rows do not consume the whole page first.
    params.set("filter", JSON.stringify({
      types: ["m.room.message", "m.sticker", "m.reaction", "m.room.member"],
    }));
    return this.#client(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?${params}`,
    );
  }

  /**
   * Chronological message heads for the embedded room list.
   *
   * Sync is intentionally ordered by insertion: bridges rely on that edge to
   * deliver newly imported events. A person's chat list is ordered by authored
   * time instead. Fetch every joined room's head in one database pass so a
   * large backfill does not turn listing rooms into one query per room.
   */
  #localLatestMessages(roomIds: string[]): Map<string, RawEvent> {
    if (!this.#embedded || !this.#directory || roomIds.length === 0) return new Map();
    let database: DatabaseSync;
    try {
      database = new DatabaseSync(path.join(this.#directory, "homeserver.sqlite"), {readOnly: true});
    } catch {
      return new Map();
    }
    try {
      const placeholders = roomIds.map(() => "?").join(", ");
      const rows = database.prepare(`
        WITH ranked AS (
          SELECT event_id, room_id, sender, type, state_key, content_json,
                 origin_server_ts, redacts, redacted_by, stream_order,
                 ROW_NUMBER() OVER (
                   PARTITION BY room_id
                   ORDER BY origin_server_ts DESC, stream_order DESC
                 ) AS chronological_rank
          FROM events e
          WHERE e.room_id IN (${placeholders})
            AND e.redacted_by IS NULL
            AND (
              e.type = 'm.sticker' OR
              (e.type = 'm.room.message' AND json_type(e.content_json, '$.body') = 'text') OR
              (
                e.type = 'm.room.member' AND
                e.state_key NOT GLOB '@*bot:*' AND
                e.state_key != ? AND
                json_type(e.content_json, '$.displayname') = 'text' AND
                json_extract(e.content_json, '$.membership') IN ('invite', 'join', 'leave', 'ban') AND
                COALESCE(json_extract(e.content_json, '$."com.beeper.exclude_from_timeline"'), 0) != 1 AND
                COALESCE(json_extract(e.content_json, '$."fi.mau.will_auto_accept"'), 0) != 1 AND
                NOT (
                  json_extract(e.content_json, '$.membership') = 'join' AND
                  COALESCE((
                    SELECT CASE
                      WHEN json_extract(previous.content_json, '$.membership') = 'invite' AND (
                        COALESCE(json_extract(previous.content_json, '$."com.beeper.exclude_from_timeline"'), 0) = 1 OR
                        COALESCE(json_extract(previous.content_json, '$."fi.mau.will_auto_accept"'), 0) = 1
                      ) THEN 1 ELSE 0 END
                    FROM events previous
                    WHERE previous.room_id = e.room_id
                      AND previous.type = 'm.room.member'
                      AND previous.state_key = e.state_key
                      AND previous.stream_order < e.stream_order
                      AND previous.redacted_by IS NULL
                    ORDER BY previous.stream_order DESC
                    LIMIT 1
                  ), 0) = 1
                ) AND
                COALESCE((
                  SELECT json_extract(previous.content_json, '$.membership')
                  FROM events previous
                  WHERE previous.room_id = e.room_id
                    AND previous.type = 'm.room.member'
                    AND previous.state_key = e.state_key
                    AND previous.stream_order < e.stream_order
                    AND previous.redacted_by IS NULL
                  ORDER BY previous.stream_order DESC
                  LIMIT 1
                ), '') != json_extract(e.content_json, '$.membership') AND
                e.origin_server_ts >= COALESCE((
                  SELECT MIN(created.origin_server_ts) + ${PORTAL_SETUP_WINDOW_MS}
                  FROM events created
                  WHERE created.room_id = e.room_id AND created.type = 'm.room.create'
                ), 0)
              )
            )
        )
        SELECT event_id, room_id, sender, type, state_key, content_json,
               origin_server_ts, redacts, redacted_by, stream_order
        FROM ranked
        WHERE chronological_rank = 1
      `).all(...roomIds, this.#auth().userId ?? "") as Array<Record<string, unknown>>;
      return new Map(
        rows.map((row) => [String(row.room_id), rawEventFromDatabase(row)]),
      );
    } catch {
      // External deployments and older disposable stores keep using sync.
      return new Map();
    } finally {
      database.close();
    }
  }

  /**
   * The embedded homeserver keeps one append-only stream for sync. Backfill
   * batches therefore arrive at its live edge even though their timestamps
   * belong months in the past. Matrix pagination by that stream makes an old
   * batch look newer than a message sent today.
   *
   * For the local reader only, page by the event's authored time with stream
   * order as a deterministic tie-breaker. Sync, receipts and bridge delivery
   * retain their append-only ordering; this changes only how a conversation is
   * read. An opaque local cursor keeps pagination stable while more history is
   * imported behind it.
   */
  #localTimeline(
    roomId: string,
    limit: number,
    before?: string,
  ): {end: string | null; chunk: RawEvent[]; state: RawEvent[]} | null {
    if (!this.#embedded || !this.#directory) return null;
    const cursor = before ? localTimelineCursor(before) : null;
    // A non-local token belongs to an external/older Matrix page and must be
    // handled by the endpoint that issued it.
    if (before && !cursor) return null;

    let database: DatabaseSync;
    try {
      database = new DatabaseSync(path.join(this.#directory, "homeserver.sqlite"), {readOnly: true});
    } catch {
      return null;
    }
    try {
      const pageSize = Math.max(1, Math.min(1_000, Math.trunc(limit)));
      const rows = database.prepare(`
        WITH member_history AS (
          SELECT event_id, room_id, sender, type, state_key, content_json,
                 origin_server_ts, redacts, redacted_by, stream_order,
                 LAG(content_json) OVER (
                   PARTITION BY room_id, state_key
                   ORDER BY stream_order
                 ) AS prev_content_json
          FROM events
          WHERE room_id = ? AND type = 'm.room.member' AND redacted_by IS NULL
        ), visible AS (
          SELECT event_id, room_id, sender, type, state_key, content_json,
                 origin_server_ts, redacts, redacted_by, stream_order,
                 NULL AS prev_content_json
          FROM events
          WHERE room_id = ?
            AND redacted_by IS NULL
            -- An annotation is state *about* a message, not another row in
            -- the conversation. Counting it as a page slot could return a
            -- short or even empty page when an old message got many reactions.
            AND type IN ('m.room.message', 'm.sticker')
          UNION ALL
          SELECT event_id, room_id, sender, type, state_key, content_json,
                 origin_server_ts, redacts, redacted_by, stream_order,
                 prev_content_json
          FROM member_history member
          WHERE member.state_key NOT GLOB '@*bot:*'
            AND member.state_key != ?
            AND json_type(member.content_json, '$.displayname') = 'text'
            AND json_extract(member.content_json, '$.membership') IN ('invite', 'join', 'leave', 'ban')
            AND COALESCE(json_extract(member.content_json, '$."com.beeper.exclude_from_timeline"'), 0) != 1
            AND COALESCE(json_extract(member.content_json, '$."fi.mau.will_auto_accept"'), 0) != 1
            AND NOT (
              json_extract(member.content_json, '$.membership') = 'join' AND
              COALESCE(json_extract(member.prev_content_json, '$.membership'), '') = 'invite' AND
              (
                COALESCE(json_extract(member.prev_content_json, '$."com.beeper.exclude_from_timeline"'), 0) = 1 OR
                COALESCE(json_extract(member.prev_content_json, '$."fi.mau.will_auto_accept"'), 0) = 1
              )
            )
            AND (
              member.prev_content_json IS NULL OR
              json_extract(member.prev_content_json, '$.membership') IS NOT
                json_extract(member.content_json, '$.membership')
            )
            AND member.origin_server_ts >= COALESCE((
              SELECT MIN(created.origin_server_ts) + ${PORTAL_SETUP_WINDOW_MS}
              FROM events created
              WHERE created.room_id = ? AND created.type = 'm.room.create'
            ), 0)
        )
        SELECT event_id, room_id, sender, type, state_key, content_json,
               origin_server_ts, redacts, redacted_by, stream_order,
               prev_content_json
        FROM visible
        ${cursor ? `WHERE (
          origin_server_ts < ? OR
          (origin_server_ts = ? AND stream_order < ?)
        )` : ""}
        ORDER BY origin_server_ts DESC, stream_order DESC
        LIMIT ?
      `).all(
        roomId,
        roomId,
        this.#auth().userId ?? "",
        roomId,
        ...(cursor ? [cursor.timestamp, cursor.timestamp, cursor.streamOrder] : []),
        pageSize + 1,
      ) as Array<Record<string, unknown>>;
      const more = rows.length > pageSize;
      const page = rows.slice(0, pageSize);
      const last = page.at(-1);
      const state = this.#localRoomState(database, roomId);
      return {
        chunk: page.map(rawEventFromDatabase),
        state,
        end: more && last
          ? localTimelineToken(Number(last.origin_server_ts), Number(last.stream_order))
          : null,
      };
    } catch {
      // External deployments and older disposable stores keep using Matrix.
      return null;
    } finally {
      database.close();
    }
  }

  /**
   * Every active reaction for the local message ids on one history page.
   *
   * Some bridge databases predate the embedded homeserver and still point at
   * the event id from the previous Matrix server. Their remote message row and
   * the local copy retain the same room, sender and millisecond timestamp. A
   * unique match is exact; multipart rows with the same timestamp are paired
   * by the bridge's insertion order and the homeserver's stream order, which
   * are the two sides of the same backfill batch.
   */
  #localReactionEvents(roomId: string, messageIds: string[]): RawEvent[] | null {
    if (!this.#embedded || !this.#directory) return null;
    if (messageIds.length === 0) return [];
    let database: DatabaseSync;
    try {
      database = new DatabaseSync(path.join(this.#directory, "homeserver.sqlite"), {readOnly: true});
    } catch {
      return null;
    }
    try {
      const aliases = this.#bridgeReactionAliases(database, roomId, messageIds);
      const targets = [...new Set([
        ...messageIds,
        ...messageIds.flatMap((eventId) => aliases.get(eventId) ?? []),
      ])];
      const placeholders = targets.map(() => "?").join(", ");
      const rows = database.prepare(`
        SELECT event_id, room_id, sender, type, state_key, content_json,
               origin_server_ts, redacts, redacted_by, stream_order
        FROM events
        WHERE room_id = ?
          AND type = 'm.reaction'
          AND redacted_by IS NULL
          AND json_extract(content_json, '$."m.relates_to".event_id') IN (${placeholders})
          AND json_type(content_json, '$."m.relates_to".key') = 'text'
        ORDER BY origin_server_ts ASC, stream_order ASC
      `).all(roomId, ...targets) as Array<Record<string, unknown>>;
      const currentByAlias = new Map<string, string>();
      for (const [current, previous] of aliases)
        for (const oldId of previous) currentByAlias.set(oldId, current);
      return rows.map((row) => {
        const event = rawEventFromDatabase(row);
        const relation = event.content?.["m.relates_to"];
        const current = relation?.event_id ? currentByAlias.get(relation.event_id) : undefined;
        if (!current || !event.content || !relation) return event;
        return {
          ...event,
          content: {
            ...event.content,
            "m.relates_to": {...relation, event_id: current},
          },
        };
      });
    } catch {
      // A disposable store with an older schema keeps the page-local fallback.
      return null;
    } finally {
      database.close();
    }
  }

  /** Current local event id -> historical Matrix ids retained by a bridge. */
  #bridgeReactionAliases(
    database: DatabaseSync,
    roomId: string,
    messageIds: string[],
  ): Map<string, string[]> {
    const roomCache = this.#reactionTargetAliases.get(roomId) ?? new Map<string, string[]>();
    this.#reactionTargetAliases.set(roomId, roomCache);
    const missing = messageIds.filter((eventId) => !roomCache.has(eventId));
    if (missing.length === 0 || !this.#directory) return roomCache;

    const placeholders = missing.map(() => "?").join(", ");
    const selected = database.prepare(`
      SELECT event_id, sender, origin_server_ts
      FROM events
      WHERE room_id = ?
        AND event_id IN (${placeholders})
        AND type IN ('m.room.message', 'm.sticker')
        AND redacted_by IS NULL
    `).all(roomId, ...missing) as Array<{
      event_id: string;
      sender: string;
      origin_server_ts: number;
    }>;
    const groups = new Map<string, {sender: string; timestamp: number}>();
    for (const event of selected) {
      const key = `${event.sender}\u0000${event.origin_server_ts}`;
      groups.set(key, {sender: event.sender, timestamp: event.origin_server_ts});
    }

    const cachedPlatform = this.#roomPlatforms.get(roomId);
    const platforms = COMMS_PLATFORMS.map((entry) => entry.value).filter(
      (platform) => platform !== "matrix" && platform !== "wechat",
    );
    const candidates = cachedPlatform && platforms.includes(cachedPlatform as typeof platforms[number])
      ? [cachedPlatform, ...platforms.filter((platform) => platform !== cachedPlatform)]
      : platforms;

    for (const platform of candidates) {
      let bridge: DatabaseSync;
      try {
        bridge = new DatabaseSync(
          path.join(this.#directory, "bridges", platform, "bridge.db"),
          {readOnly: true},
        );
      } catch {
        continue;
      }
      try {
        if (!bridge.prepare("SELECT 1 FROM portal WHERE mxid = ? LIMIT 1").get(roomId)) continue;
        const localGroup = database.prepare(`
          SELECT event_id, stream_order
          FROM events
          WHERE room_id = ?
            AND sender = ?
            AND origin_server_ts = ?
            AND type IN ('m.room.message', 'm.sticker')
            AND redacted_by IS NULL
          ORDER BY stream_order ASC
        `);
        // Bridge v2 stores nanoseconds. The other branches keep this reader
        // safe for older millisecond- or second-based schemas.
        const bridgeGroup = bridge.prepare(`
          SELECT m.mxid
          FROM message m
          JOIN portal p
            ON p.bridge_id = m.bridge_id
           AND p.id = m.room_id
           AND p.receiver = m.room_receiver
          WHERE p.mxid = ?
            AND m.sender_mxid = ?
            AND CASE
              WHEN m.timestamp > 1000000000000000 THEN CAST(m.timestamp / 1000000 AS INTEGER)
              WHEN m.timestamp > 1000000000000 THEN CAST(m.timestamp AS INTEGER)
              ELSE CAST(m.timestamp * 1000 AS INTEGER)
            END = ?
          ORDER BY m.rowid ASC
        `);
        for (const {sender, timestamp} of groups.values()) {
          const local = localGroup.all(roomId, sender, timestamp) as Array<{
            event_id: string;
            stream_order: number;
          }>;
          const previous = bridgeGroup.all(roomId, sender, timestamp) as Array<{mxid: string}>;
          if (local.length === 0 || local.length !== previous.length) continue;
          for (let index = 0; index < local.length; index += 1) {
            const currentId = local[index]?.event_id;
            const oldId = previous[index]?.mxid;
            if (!currentId || !oldId || currentId === oldId) continue;
            const known = roomCache.get(currentId) ?? [];
            if (!known.includes(oldId)) roomCache.set(currentId, [...known, oldId]);
          }
        }
        break;
      } catch {
        // Bridge schemas that do not carry the lossless message relation are
        // simply not eligible for alias recovery.
      } finally {
        bridge.close();
      }
    }
    for (const eventId of missing)
      if (!roomCache.has(eventId)) roomCache.set(eventId, []);
    return roomCache;
  }

  /** Current member state gives the local page names and avatars without HTTP. */
  #localRoomState(database: DatabaseSync, roomId: string): RawEvent[] {
    try {
      const rows = database.prepare(`
        SELECT e.event_id, e.room_id, e.sender, e.type, e.state_key,
               e.content_json, e.origin_server_ts, e.redacts, e.redacted_by,
               e.stream_order
        FROM room_state s
        JOIN events e ON e.event_id = s.event_id
        WHERE s.room_id = ? AND s.type = 'm.room.member'
      `).all(roomId) as Array<Record<string, unknown>>;
      return rows.map(rawEventFromDatabase);
    } catch {
      return [];
    }
  }

  /**
   * Imported outgoing history is not always double-puppeted onto Polymux's
   * Matrix account. Bridge v2 may instead write it as the remote account's
   * ghost — Instagram's `@meta_<account>` is one example — so comparing only
   * Matrix ids puts the user's own messages on the incoming side.
   *
   * The bridge database retains the lossless relation: a message's remote
   * sender id, the portal it belongs to, and the login that owns that portal.
   * Use that relation rather than platform-specific Matrix-id prefixes. The
   * WhatsApp LID is its one additional self identity and is resolved through
   * the bridge's device record.
   */
  #withBridgeOwnership(roomId: string, messages: MatrixMessage[]): MatrixMessage[] {
    const ownEvents = new Set(
      messages.filter((message) => message.mine).map((message) => message.eventId),
    );
    const ownSenders = new Set(
      messages.filter((message) => message.mine).map((message) => message.sender),
    );
    const pending = messages.filter((message) => !message.mine);
    if (!this.#directory || pending.length === 0) return messages;

    const cachedPlatform = this.#roomPlatforms.get(roomId);
    const bridgePlatforms = COMMS_PLATFORMS.map((entry) => entry.value).filter(
      (platform) => platform !== "matrix" && platform !== "wechat",
    );
    const candidates =
      cachedPlatform && cachedPlatform !== "matrix"
        ? [cachedPlatform, ...bridgePlatforms.filter((platform) => platform !== cachedPlatform)]
        : bridgePlatforms;
    const eventIds = pending.map((message) => message.eventId).filter(Boolean);
    const placeholders = eventIds.map(() => "?").join(", ");
    const senders = [...new Set(pending.map((message) => message.sender).filter(Boolean))];
    const senderPlaceholders = senders.map(() => "?").join(", ");

    for (const platform of candidates) {
      let database: DatabaseSync;
      try {
        database = new DatabaseSync(
          path.join(this.#directory, "bridges", platform, "bridge.db"),
          {readOnly: true},
        );
      } catch {
        continue;
      }
      let ownsRoom = false;
      try {
        ownsRoom = Boolean(
          database.prepare("SELECT 1 FROM portal WHERE mxid = ? LIMIT 1").get(roomId),
        );
        if (!ownsRoom) continue;
        if (!cachedPlatform || cachedPlatform === "matrix")
          this.#roomPlatforms.set(roomId, platform);

        if (eventIds.length > 0) {
          const rows = database.prepare(`
            SELECT DISTINCT m.mxid
            FROM message m
            JOIN portal p
              ON p.bridge_id = m.bridge_id
             AND p.id = m.room_id
             AND p.receiver = m.room_receiver
            JOIN user_portal up
              ON up.bridge_id = p.bridge_id
             AND up.portal_id = p.id
             AND up.portal_receiver = p.receiver
            WHERE p.mxid = ?
              AND m.mxid IN (${placeholders})
              AND m.sender_id = up.login_id
          `).all(roomId, ...eventIds) as Array<{mxid: string}>;
          for (const row of rows) ownEvents.add(row.mxid);
        }

        // Backfill transports may replace the bridge's event id while keeping
        // its sender ghost. The bridge still records which sender identity is
        // the linked login, so use that exact relation for imported history.
        if (senders.length > 0) {
          try {
            const senderRows = database.prepare(`
              SELECT DISTINCT m.sender_mxid
              FROM message m
              JOIN portal p
                ON p.bridge_id = m.bridge_id
               AND p.id = m.room_id
               AND p.receiver = m.room_receiver
              JOIN user_portal up
                ON up.bridge_id = p.bridge_id
               AND up.portal_id = p.id
               AND up.portal_receiver = p.receiver
              WHERE p.mxid = ?
                AND m.sender_mxid IN (${senderPlaceholders})
                AND m.sender_id = up.login_id
            `).all(roomId, ...senders) as Array<{sender_mxid: string}>;
            for (const row of senderRows) ownSenders.add(row.sender_mxid);
          } catch {
            // Some legacy bridge schemas predate the sender_mxid column.
          }
        }

        if (platform === "whatsapp" && (eventIds.length > 0 || senders.length > 0)) {
          const identityClauses: string[] = [];
          const identityValues: string[] = [];
          if (eventIds.length > 0) {
            identityClauses.push(`m.mxid IN (${placeholders})`);
            identityValues.push(...eventIds);
          }
          if (senders.length > 0) {
            identityClauses.push(`m.sender_mxid IN (${senderPlaceholders})`);
            identityValues.push(...senders);
          }
          const lidRows = database.prepare(`
            SELECT DISTINCT m.mxid, m.sender_mxid
            FROM message m
            JOIN portal p
              ON p.bridge_id = m.bridge_id
             AND p.id = m.room_id
             AND p.receiver = m.room_receiver
            JOIN user_portal up
              ON up.bridge_id = p.bridge_id
             AND up.portal_id = p.id
             AND up.portal_receiver = p.receiver
            JOIN whatsmeow_device d
              ON up.login_id = CASE
                WHEN instr(d.jid, ':') > 0 THEN substr(d.jid, 1, instr(d.jid, ':') - 1)
                WHEN instr(d.jid, '@') > 0 THEN substr(d.jid, 1, instr(d.jid, '@') - 1)
                ELSE d.jid
              END
            WHERE p.mxid = ?
              AND (${identityClauses.join(" OR ")})
              AND m.sender_id = 'lid-' || CASE
                WHEN instr(d.lid, ':') > 0 THEN substr(d.lid, 1, instr(d.lid, ':') - 1)
                WHEN instr(d.lid, '@') > 0 THEN substr(d.lid, 1, instr(d.lid, '@') - 1)
                ELSE d.lid
              END
          `).all(roomId, ...identityValues) as Array<{
            mxid: string;
            sender_mxid: string | null;
          }>;
          for (const row of lidRows) {
            ownEvents.add(row.mxid);
            if (row.sender_mxid) ownSenders.add(row.sender_mxid);
          }
        }
      } catch {
        // Legacy bridges have different tables and keep Matrix-id ownership.
      } finally {
        database.close();
      }
      // A Matrix room belongs to one bridge. Once its portal is found, another
      // bridge cannot supply a more authoritative answer for the same event.
      if (ownsRoom) break;
    }

    if (ownEvents.size === 0 && ownSenders.size === 0) return messages;
    return messages.map((message) =>
      ownEvents.has(message.eventId) || ownSenders.has(message.sender)
        ? {...message, mine: true}
        : message,
    );
  }

  /** Resolves ownership and profiles for results that may span many rooms,
   * while preserving the caller's original ordering. */
  async #withMessageIdentities(messages: MatrixMessage[]): Promise<MatrixMessage[]> {
    const decorated = [...messages];
    const rooms = new Map<string, Array<{index: number; message: MatrixMessage}>>();
    for (const [index, message] of messages.entries()) {
      const rows = rooms.get(message.roomId) ?? [];
      rows.push({index, message});
      rooms.set(message.roomId, rows);
    }
    await Promise.all(
      [...rooms].map(async ([roomId, rows]) => {
        const owned = this.#withBridgeOwnership(
          roomId,
          rows.map((row) => row.message),
        );
        const named = await this.#withSenders(owned, [], roomId);
        rows.forEach((row, index) => {
          const message = named[index];
          if (message) decorated[row.index] = message;
        });
      }),
    );
    return decorated;
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
    roomId: string,
  ): Promise<MatrixMessage[]> {
    for (const event of state) {
      if (event.type !== "m.room.member" || !event.state_key) continue;
      this.#profiles.set(event.state_key, {
        name: event.content?.displayname ?? event.state_key,
        avatarUrl: mediaUrl(event.content?.avatar_url),
      });
    }
    const unknown = [...new Set(messages.flatMap((message) => [
      message.sender,
      ...message.reactions.flatMap((reaction) => reaction.reactors.map((reactor) => reactor.id)),
    ]))].filter(
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
    const platform =
      messages.find((message) => message.platform)?.platform ||
      this.#roomPlatforms.get(roomId) ||
      messages.map((message) => platformFromSender(message.sender)).find(Boolean) ||
      "matrix";
    const userId = this.#auth().userId;
    return messages.map((message) => ({
      ...message,
      senderName: message.mine
        ? SELF_SENDER_NAME
        : bridgeDisplayName(this.#profiles.get(message.sender)?.name ?? message.sender, platform),
      senderAvatarUrl: this.#profiles.get(message.sender)?.avatarUrl ?? null,
      reactions: message.reactions.map((reaction) => ({
        ...reaction,
        reactors: reaction.reactors.map((reactor) => ({
          id: reactor.id,
          name: reactor.id === userId
            ? SELF_SENDER_NAME
            : bridgeDisplayName(this.#profiles.get(reactor.id)?.name ?? reactor.id, platform),
          avatarUrl: this.#profiles.get(reactor.id)?.avatarUrl ?? null,
          mine: reactor.mine,
        })),
      })),
    }));
  }

  /**
   * Bridges normally bundle previews in the message. An external homeserver
   * can also generate one for an ordinary URL, which keeps the shared renderer
   * useful for a platform whose bridge did not attach OpenGraph metadata.
   * The embedded server deliberately does not fetch arbitrary message URLs;
   * its bridges supply the bundle without leaking a read to the destination.
   */
  async #withLinkPreviews(messages: MatrixMessage[]): Promise<MatrixMessage[]> {
    if (this.#embedded) return messages;
    return Promise.all(messages.map(async (message) => {
      if (message.linkPreview || message.linkPreviewSuppressed) return message;
      const url = firstHttpUrl(message.body);
      if (!url) return message;
      const preview = await this.#homeserverLinkPreview(url, Date.parse(message.sentAt));
      return preview ? {...message, linkPreview: preview} : message;
    }));
  }

  #homeserverLinkPreview(url: string, timestamp: number): Promise<MatrixLinkPreview | null> {
    const known = this.#linkPreviews.get(url);
    if (known) return known;
    const load = (async (): Promise<MatrixLinkPreview | null> => {
      const query = new URLSearchParams({url, ts: String(Number.isFinite(timestamp) ? timestamp : Date.now())});
      let response: RawLinkPreview | null = null;
      try {
        response = await this.#client<RawLinkPreview>(`/_matrix/client/v1/media/preview_url?${query}`);
      } catch (error) {
        if (!(error instanceof ProvisioningError) || error.status !== 404) return null;
        response = await this.#client<RawLinkPreview>(`/_matrix/media/v3/preview_url?${query}`)
          .catch((): null => null);
      }
      return response ? matrixLinkPreview(response, url) : null;
    })();
    this.#linkPreviews.set(url, load);
    return load;
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
    const messages = (events?.results ?? [])
      .map((item) => item.result)
      .filter((event): event is RawEvent => isMessage(event))
      .map((event) => toMessage(event, this.#auth().userId));
    return {
      nextBatch: events?.next_batch ?? null,
      messages: await this.#withMessageIdentities(messages),
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
      const candidates: MatrixMessage[] = [];
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
        candidates.push({
          ...toMessage(event, userId),
          roomId,
          roomName: await this.#roomName(roomId),
          platform: source,
        });
      }
      for (const message of await this.#withMessageIdentities(candidates)) {
        if (message.mine) continue;
        messages.push(message);
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

  async send(
    roomId: string,
    body: string,
    replyTo?: string,
    mentions?: ChatMentionsDto,
  ): Promise<string> {
    const presentMentions = (mentions?.users ?? []).filter(
      (mention) =>
        mention.userId.startsWith("@") &&
        mention.label.startsWith("@") &&
        mentionOccurrences(body, mention.label).length > 0,
    );
    const userIds = [...new Set(presentMentions.map((mention) => mention.userId))];
    const everyone = mentions?.everyone === true &&
      mentionOccurrences(body, "@everyone").length > 0;
    const mentionContent = userIds.length > 0 || everyone
      ? {
          format: "org.matrix.custom.html",
          formatted_body: mentionHtml(body, presentMentions),
          "m.mentions": {
            ...(userIds.length > 0 ? {user_ids: userIds} : {}),
            ...(everyone ? {room: true} : {}),
          },
        }
      : {};
    const result = await this.#client<{event_id?: string}>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${this.#txnId()}`,
      {
        method: "PUT",
        body: {
          msgtype: "m.text",
          body,
          ...mentionContent,
          ...(replyTo
            ? {"m.relates_to": {"m.in_reply_to": {event_id: replyTo}}}
            : {}),
        },
      },
    );
    return result.event_id ?? "";
  }

  /** Current joined members are the authoritative mention targets. Profile
   * text is presentation only; the Matrix id is what lets each bridge create
   * a real native mention instead of painted `@name` text. */
  async members(roomId: string): Promise<ChatMemberDto[]> {
    const result = await this.#client<{
      joined?: Record<string, {display_name?: string; avatar_url?: string}>;
    }>(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`);
    const joined = result.joined ?? {};
    const platform = this.#roomPlatforms.get(roomId) ??
      Object.keys(joined).map(platformFromSender).find(Boolean) ??
      "matrix";
    this.#roomPlatforms.set(roomId, platform);
    return Object.entries(joined)
      .filter(([userId]) => !isBridgeBot(userId) && !this.senderIsMine(roomId, userId))
      .map(([userId, profile]) => ({
        userId,
        name: bridgeDisplayName(profile.display_name?.trim() || userId, platform),
        avatarUrl: mediaUrl(profile.avatar_url),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
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

  /** Lists people the remote account can start a conversation with. Bridges
   * that do not expose a directory answer 501; callers retain existing DMs as
   * their fallback list. */
  async contacts(route: string, accountId: string): Promise<MatrixContact[]> {
    const result = await this.#provision<{contacts?: RawResolvedIdentifier[]}>(
      route,
      `contacts?login_id=${encodeURIComponent(accountId)}`,
      {},
    );
    return (result.contacts ?? [])
      .filter((contact) => typeof contact.id === "string" && contact.id.length > 0)
      .map((contact) => ({
        id: contact.id,
        name: contact.name?.trim() || contact.identifiers?.[0] || contact.id,
        avatarUrl: mediaUrl(contact.avatar_url),
        identifiers: Array.isArray(contact.identifiers)
          ? contact.identifiers.filter((entry): entry is string => typeof entry === "string")
          : [],
        chatId: contact.dm_room_mxid || null,
      }));
  }

  /** Opens one remote DM or creates one remote group through the bridge's
   * start-new-chat API, returning the Matrix portal room it created. */
  async createChat(
    route: string,
    accountId: string,
    participantIds: string[],
    name?: string,
  ): Promise<string> {
    if (participantIds.length === 1) {
      const contact = encodeURIComponent(participantIds[0]!);
      const result = await this.#provision<RawResolvedIdentifier>(
        route,
        `create_dm/${contact}?login_id=${encodeURIComponent(accountId)}`,
        {method: "POST", body: {}},
      );
      if (!result.dm_room_mxid)
        throw new Error("The bridge opened the conversation without returning its room.");
      return result.dm_room_mxid;
    }
    const title = name?.trim();
    if (!title) throw new Error("A group chat needs a name.");
    const result = await this.#provision<{mxid?: string}>(
      route,
      `create_group/group?login_id=${encodeURIComponent(accountId)}`,
      {
        method: "POST",
        body: {participants: participantIds, name: {name: title}},
      },
    );
    if (!result.mxid)
      throw new Error("The bridge created the group without returning its room.");
    return result.mxid;
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
  /** A non-conversational Matrix Space containing child rooms. */
  space?: boolean;
  /** Bridge v2's account-wide personal filtering Space. */
  defaultSpace?: boolean;
  /** Current `m.space.parent` links for this room. */
  parentIds?: string[];
  /** Remote portal id, used to match an existing DM to a directory contact. */
  remoteId?: string;
  /** This is the portal the bridge currently routes outbound traffic through. */
  currentPortal?: boolean;
  accountIds?: string[];
  /** Remote unread counts, kept separate when one portal belongs to two logins. */
  unreadByAccount?: Record<string, number>;
  avatarUrl: string | null;
  unread: number;
  lastActivity: string | null;
  preview: string | null;
  group: boolean;
  /** True only when bridge-provided remote metadata attests that the account
   * is official or verified. A missing signal is never inferred from a name. */
  official?: boolean;
}

export interface MatrixContact {
  id: string;
  name: string;
  avatarUrl: string | null;
  identifiers: string[];
  chatId: string | null;
}

interface RawResolvedIdentifier {
  id: string;
  name?: string;
  avatar_url?: string;
  identifiers?: string[];
  mxid?: string;
  dm_room_mxid?: string;
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
  /** True when either the Matrix account or its linked bridge login sent it. */
  mine: boolean;
  body: string;
  /** A conversation event, such as a group membership change, not authored text. */
  notice: boolean;
  sentAt: string;
  attachments: MatrixAttachment[];
  linkPreview: MatrixLinkPreview | null;
  /** An explicit empty preview bundle means the sender opted out. */
  linkPreviewSuppressed?: boolean;
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
  reactors: MatrixReactionActor[];
  /** The signed-in account's own reaction event, so it can be taken back. */
  mineEventId: string | null;
}

export interface MatrixReactionActor {
  id: string;
  name: string;
  avatarUrl: string | null;
  mine: boolean;
}

interface RawEvent {
  event_id?: string;
  room_id?: string;
  sender?: string;
  type?: string;
  state_key?: string;
  redacts?: string;
  origin_server_ts?: number;
  unsigned?: {prev_content?: RawEvent["content"]};
  content?: {
    body?: string;
    msgtype?: string;
    url?: string;
    /** The source post for rich Instagram media, whether or not its bytes were fetched. */
    external_url?: string;
    filename?: string;
    /** Set on a room name, avatar, or member event rather than a message. */
    name?: string;
    /** Set on `m.room.create`; `m.space` distinguishes a Space from a chat. */
    type?: string;
    /** Active `m.space.parent` and `m.space.child` links carry server routes. */
    via?: string[];
    displayname?: string;
    avatar_url?: string;
    membership?: string;
    /** Bridge-owned setup or profile-sync state, intentionally absent from chat timelines. */
    "com.beeper.exclude_from_timeline"?: boolean;
    /** mautrix portal setup invite; its immediate join is transport bookkeeping too. */
    "fi.mau.will_auto_accept"?: boolean;
    /** MSC4095 preview bundles emitted by the mautrix bridge family. */
    "com.beeper.linkpreviews"?: RawLinkPreview[];
    /** Written by a bridge onto media it could not fetch; see `viewIn`. */
    "co.polymux.view_in"?: {app?: string; url?: string};
    /** Structured preview emitted by any bridge that can describe a rich item. */
    "co.polymux.link_preview"?: {title?: string; description?: string; url?: string; source?: string};
    /** Set by the WeChat bridge on a sticker, which it sends as a picture. */
    "co.polymux.sticker"?: boolean;
    /** Set on content imported by the WeChat bridge. */
    "co.polymux.wechat.remote"?: boolean;
    /** Trust metadata forwarded by current or future bridge connectors. */
    "co.polymux.official"?: boolean;
    "com.beeper.is_verified"?: boolean;
    "com.beeper.verified"?: boolean;
    "com.beeper.official"?: boolean;
    "fi.mau.is_verified"?: boolean;
    verified?: boolean;
    official?: boolean;
    is_verified?: boolean;
    is_official?: boolean;
    /** A bridge-originated conversation event rather than authored text. */
    "co.polymux.notice"?: boolean;
    /** Set on `m.bridge`: which network the room is a portal for. */
    protocol?: {id?: string};
    /** A bridge-safe remote conversation identity, not the raw contact id. */
    channel?: {id?: string};
    /** mautrix marks direct chats "dm" here; groups carry their own type. */
    "com.beeper.room_type"?: string;
    /** Bridge v2 also identifies account-wide personal filtering Spaces. */
    "com.beeper.room_type.v2"?: string;
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

export interface MatrixLinkPreview {
  title: string;
  description: string | null;
  url: string | null;
  source: string | null;
  imageUrl: string | null;
  imageMimeType: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

interface RawLinkPreview {
  matched_url?: string;
  "og:title"?: string;
  "og:description"?: string;
  "og:url"?: string;
  "og:site_name"?: string;
  "og:image"?: string;
  "og:image:type"?: string;
  "og:image:width"?: string | number;
  "og:image:height"?: string | number;
  "matrix:image:size"?: string | number;
}

function localTimelineToken(timestamp: number, streamOrder: number): string {
  return `local:${timestamp}:${streamOrder}`;
}

function localTimelineCursor(value: string): {timestamp: number; streamOrder: number} | null {
  const match = /^local:(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  return {timestamp: Number(match[1]), streamOrder: Number(match[2])};
}

/** The client-facing event shape stored by the embedded homeserver. */
function rawEventFromDatabase(row: Record<string, unknown>): RawEvent {
  let content: RawEvent["content"] = {};
  let previous: RawEvent["content"] | undefined;
  if (!row.redacted_by) {
    try {
      content = JSON.parse(String(row.content_json ?? "{}")) as RawEvent["content"];
    } catch {
      content = {};
    }
    if (row.prev_content_json !== null && row.prev_content_json !== undefined) {
      try {
        previous = JSON.parse(String(row.prev_content_json)) as RawEvent["content"];
      } catch {
        previous = undefined;
      }
    }
  }
  return {
    event_id: String(row.event_id ?? ""),
    room_id: String(row.room_id ?? ""),
    sender: String(row.sender ?? ""),
    type: String(row.type ?? ""),
    ...(row.state_key === null || row.state_key === undefined
      ? {}
      : {state_key: String(row.state_key)}),
    ...(row.redacts ? {redacts: String(row.redacts)} : {}),
    origin_server_ts: Number(row.origin_server_ts ?? 0),
    ...(previous ? {unsigned: {prev_content: previous}} : {}),
    content,
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

/** Folds the resolved active `m.reaction` events onto their target messages. */
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
    const reactor: MatrixReactionActor | null = event.sender
      ? {id: event.sender, name: event.sender, avatarUrl: null, mine: event.sender === userId}
      : null;
    if (existing) {
      // A reaction represents a person, even if a misbehaving bridge wrote
      // the same annotation twice. Keep its most recent event id for undo but
      // do not draw the same profile twice or inflate the visible total.
      if (!reactor || !existing.reactors.some((item) => item.id === reactor.id)) {
        existing.count += 1;
        if (reactor) existing.reactors.push(reactor);
      }
      existing.mineEventId = existing.mineEventId ?? mine;
    } else {
      list.push({key, count: 1, reactors: reactor ? [reactor] : [], mineEventId: mine});
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

/** Authored messages plus the state changes a person sees inside the thread. */
function isTimelineItem(
  event: RawEvent | undefined,
  userId: string | null,
): event is RawEvent {
  if (!event) return false;
  if (event.type === "m.sticker") return true;
  if (event.type === "m.room.message" && typeof event.content?.body === "string") return true;
  return event.type === "m.room.member" && Boolean(membershipNotice(event, userId));
}

/** The newest event of a state type, since `/sync` gives them in order. */
function lastStateEvent(events: RawEvent[], type: string): RawEvent | undefined {
  return events.filter((event) => event.type === type).at(-1);
}

/** Current state for every key of one type. A timeline may contain both the
 * old link and the empty event that removed it, so the last key wins. */
function latestStateEvents(events: RawEvent[], type: string): RawEvent[] {
  const current = new Map<string, RawEvent>();
  for (const event of events)
    if (event.type === type) current.set(event.state_key ?? "", event);
  return [...current.values()];
}

/** Bridge bots sit in every room they serve and are not people. */
function isBridgeBot(userId: string): boolean {
  return /^@[a-z]+bot:/.test(userId);
}

/** Finds visible, standalone uses of one mention label. A substring inside an
 * email address or a longer handle is not a mention and must not notify. */
function mentionOccurrences(body: string, label: string): number[] {
  if (!label) return [];
  const found: number[] = [];
  let from = 0;
  while (from < body.length) {
    const start = body.indexOf(label, from);
    if (start < 0) break;
    if (mentionBoundary(body, start, label.length)) found.push(start);
    from = start + label.length;
  }
  return found;
}

function mentionBoundary(body: string, start: number, length: number): boolean {
  if (start < 0) return false;
  const before = body[start - 1] ?? "";
  const after = body[start + length] ?? "";
  const mentionCharacter = /[\p{L}\p{N}_.-]/u;
  return (!before || !mentionCharacter.test(before)) &&
    (!after || !mentionCharacter.test(after));
}

/** Produces Matrix's safe rich-text representation, linking only the labels
 * whose identities accompanied this send. All authored HTML stays text. */
function mentionHtml(body: string, mentions: ChatMentionsDto["users"]): string {
  const occurrences = mentions
    .flatMap((mention) => mentionOccurrences(body, mention.label).map((start) => ({
      start,
      end: start + mention.label.length,
      mention,
    })))
    .sort((left, right) => left.start - right.start || right.end - left.end);
  let cursor = 0;
  let html = "";
  for (const occurrence of occurrences) {
    if (occurrence.start < cursor) continue;
    html += textAsHtml(body.slice(cursor, occurrence.start));
    const href = `https://matrix.to/#/${escapeHtml(occurrence.mention.userId)}`;
    html += `<a href="${href}">${escapeHtml(occurrence.mention.label)}</a>`;
    cursor = occurrence.end;
  }
  return `${html}${textAsHtml(body.slice(cursor))}`;
}

function textAsHtml(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Accepts trust only from the bridge room descriptor or the direct-chat
 * counterpart's membership. This intentionally does not scan arbitrary
 * message bodies or infer status from business names: an official badge is a
 * trust claim, so silence from a connector stays silence in the UI. */
function officialAccountFromState(state: RawEvent[], counterpartId?: string): boolean {
  return state.some((event) => {
    if (event.type !== "m.bridge" &&
        !(event.type === "m.room.member" && counterpartId && event.state_key === counterpartId))
      return false;
    const content = event.content;
    return content?.["co.polymux.official"] === true ||
      content?.["com.beeper.is_verified"] === true ||
      content?.["com.beeper.verified"] === true ||
      content?.["com.beeper.official"] === true ||
      content?.["fi.mau.is_verified"] === true ||
      content?.verified === true ||
      content?.official === true ||
      content?.is_verified === true ||
      content?.is_official === true;
  });
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

/** The custom WeChat relay keeps the one writable portal per remote chat in
 * its own state file. Older rooms stay joined so their history remains
 * readable, but a Contacts row must prefer the current room when both carry
 * the same stable `m.bridge` channel id. */
async function currentWeChatPortalRooms(directory: string | null): Promise<Set<string>> {
  if (!directory) return new Set();
  try {
    const source = await readFile(
      path.join(directory, "bridges", "wechat", "state.json"),
      "utf8",
    );
    const stored = JSON.parse(source) as {rooms?: Record<string, {roomId?: unknown}>};
    return new Set(
      Object.values(stored.rooms ?? {})
        .map((room) => room?.roomId)
        .filter((roomId): roomId is string => typeof roomId === "string" && roomId.length > 0),
    );
  } catch {
    return new Set();
  }
}

function platformOfRoom(members: string[]): string {
  for (const member of members) {
    const found = platformFromSender(member);
    if (found) return found;
  }
  return "matrix";
}

/**
 * mautrix-whatsapp appends `(WA)` to its Matrix ghost names so a generic
 * Matrix client can distinguish them from native users. Polymux already shows
 * the platform separately, so carrying that bridge-only suffix into a contact
 * title is redundant. When no profile name has arrived, the room can instead
 * be named after the ghost itself (`@whatsapp_614…:server`); expose its E.164
 * number rather than leaking that internal Matrix id into the UI.
 */
function contactDisplayName(name: string, platform: string, group: boolean): string {
  const cleaned = bridgeDisplayName(name, platform);
  if (platform !== "whatsapp" || group) return cleaned;
  const ghostNumber = /^@whatsapp_(\d{7,15}):.+$/.exec(cleaned)?.[1];
  return ghostNumber ? `+${ghostNumber}` : cleaned;
}

/** Bridge metadata belongs to Matrix compatibility, not a person's name. */
export function bridgeDisplayName(name: string, platform: string): string {
  return platform === "whatsapp" ? name.replace(/(?:\s*\(WA\))+$/i, "").trimEnd() : name;
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
function previewOf(event: RawEvent, userId: string | null): string {
  const membership = membershipNotice(event, userId);
  if (membership) return membership;
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

function toMessage(raw: RawEvent, userId?: string | null): MatrixMessage {
  // An edit that reaches here unfolded — its target on another page — is
  // shown as what the message now says, not as its `* `-prefixed fallback.
  const event = {...raw, content: contentOf(raw)};
  const attachments = attachmentsOf(event);
  const linkPreview = linkPreviewOf(event);
  const visibleBody = visibleMessageBody(event, userId ?? null);
  const viewIn = viewInOf(event);
  return {
    eventId: event.event_id ?? "",
    roomId: event.room_id ?? "",
    roomName: "",
    platform: "",
    sender: event.sender ?? "",
    senderName: "",
    senderAvatarUrl: null,
    mine: Boolean(userId) && event.sender === userId,
    // A media message's body is its filename; the attachment carries that
    // already, so repeating it above the image is just clutter.
    body: attachments.length > 0
      ? ""
      : linkPreview
        ? firstHttpUrl(visibleBody) ?? visibleBody
        : visibleBody,
    notice: isNotice(event),
    sentAt: new Date(event.origin_server_ts ?? 0).toISOString(),
    attachments,
    linkPreview,
    ...(Array.isArray(event.content?.["com.beeper.linkpreviews"]) &&
    event.content["com.beeper.linkpreviews"].length === 0
      ? {linkPreviewSuppressed: true}
      : {}),
    reactions: [],
    replyTo: event.content?.["m.relates_to"]?.["m.in_reply_to"]?.event_id ?? null,
    viewIn,
  };
}

/**
 * The mautrix Instagram bridge keeps the post URL on rich media even when it
 * only managed to carry the preview image. Preserve that route: old skipped
 * reels cannot be made playable retroactively, but they should not become a
 * dead image once their usable source URL is already in the event.
 */
function viewInOf(event: RawEvent): MatrixMessage["viewIn"] {
  const explicit = event.content?.["co.polymux.view_in"];
  // `view_in` may deliberately target a native app rather than the web.
  // Keep that bridge-authored WeChat route while continuing to reject
  // arbitrary schemes from ordinary message content.
  const explicitUrl = httpUrl(explicit?.url) ?? weChatUrl(explicit?.url);
  if (explicitUrl) return {app: explicit?.app ?? "the app", url: explicitUrl};

  const externalUrl = httpUrl(event.content?.external_url);
  if (!externalUrl) return null;
  const hostname = hostnameOf(externalUrl);
  if (hostname === "instagram.com" || hostname?.endsWith(".instagram.com"))
    return {app: "Instagram", url: externalUrl};
  return null;
}

function weChatUrl(value?: string): string | null {
  return /^weixin:\/\//i.test(value ?? "") ? value! : null;
}

/** Older imported WeChat rows predate bridge-side emoji normalization. */
function visibleMessageBody(event: RawEvent, userId: string | null): string {
  const membership = membershipNotice(event, userId);
  if (membership) return membership;
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
  if (event.type === "m.room.member" || event.content?.msgtype === "m.notice") return true;
  if (event.content?.["co.polymux.notice"]) return true;
  if (!event.content?.["co.polymux.wechat.remote"]) return false;
  const body = event.content?.body?.trim() ?? "";
  return /\b(?:invited .+ to the group chat|removed .+ from the group chat|joined the group chat|left the group chat|changed the group name to)\b/i.test(body);
}

function membershipNotice(event: RawEvent, userId: string | null): string | null {
  const previous = event.unsigned?.prev_content;
  const setupJoin =
    event.content?.membership === "join" &&
    previous?.membership === "invite" &&
    invisibleBridgeMembership(previous);
  if (
    event.type !== "m.room.member" ||
    invisibleBridgeMembership(event.content) ||
    setupJoin ||
    !event.state_key ||
    event.state_key === userId ||
    isBridgeBot(event.state_key)
  ) return null;
  const platform = platformFromSender(event.state_key) ?? "";
  const rawName = event.content?.displayname?.trim() || previous?.displayname?.trim();
  if (!rawName) return null;
  const name = bridgeDisplayName(rawName, platform);
  const membership = event.content?.membership;
  // Bridges republish member state when they learn a contact's real name or
  // avatar. That keeps sender identity current, but it is connection/profile
  // bookkeeping rather than an event the native conversation would show.
  if (previous?.membership === membership) return null;
  if (membership === "join") {
    return `${name} joined the group`;
  }
  if (membership === "invite") return `${name} was invited to the group`;
  if (membership === "ban") return `${name} was banned from the group`;
  if (membership === "leave")
    return event.sender === event.state_key
      ? `${name} left the group`
      : `${name} was removed from the group`;
  return null;
}

/** A Matrix membership used to assemble a bridge portal, not remote activity. */
function invisibleBridgeMembership(content: RawEvent["content"] | undefined): boolean {
  return content?.["com.beeper.exclude_from_timeline"] === true ||
    content?.["fi.mau.will_auto_accept"] === true;
}

function linkPreviewOf(event: RawEvent): MatrixLinkPreview | null {
  const custom = event.content?.["co.polymux.link_preview"];
  if (custom?.title) {
    const url = httpUrl(custom.url);
    return {
      title: custom.title,
      description: custom.description ?? null,
      url,
      source: custom.source ?? hostnameOf(url),
      imageUrl: null,
      imageMimeType: null,
      imageWidth: null,
      imageHeight: null,
    };
  }
  const bundled = event.content?.["com.beeper.linkpreviews"]?.find(
    (preview) => typeof preview?.["og:title"] === "string" || typeof preview?.["og:image"] === "string",
  );
  if (!bundled) return null;
  return matrixLinkPreview(bundled, bundled.matched_url ?? bundled["og:url"] ?? "");
}

function matrixLinkPreview(preview: RawLinkPreview, fallbackUrl: string): MatrixLinkPreview | null {
  const url = httpUrl(preview.matched_url) ?? httpUrl(preview["og:url"]) ?? httpUrl(fallbackUrl);
  const title = preview["og:title"]?.trim() || preview["og:description"]?.trim();
  const imageUrl = mediaUrl(preview["og:image"]);
  if (!title && !imageUrl) return null;
  return {
    title: title || hostnameOf(url) || url || "Link",
    description: title === preview["og:description"]?.trim()
      ? null
      : preview["og:description"]?.trim() || null,
    url,
    source: preview["og:site_name"]?.trim() || hostnameOf(url),
    imageUrl,
    imageMimeType: preview["og:image:type"] ?? null,
    imageWidth: numberOf(preview["og:image:width"]),
    imageHeight: numberOf(preview["og:image:height"]),
  };
}

function numberOf(value: string | number | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function httpUrl(value: string | undefined): string | null {
  if (!value || !/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function hostnameOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

function firstHttpUrl(body: string): string | null {
  const match = /https?:\/\/[^\s<>]+/i.exec(body);
  if (!match) return null;
  let value = match[0];
  while (/[.,!?;:]$/.test(value)) value = value.slice(0, -1);
  if (value.endsWith(")") && (value.match(/\(/g)?.length ?? 0) < (value.match(/\)/g)?.length ?? 0))
    value = value.slice(0, -1);
  return httpUrl(value);
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
  profile?: {
    name?: string;
    username?: string;
    phone?: string;
    email?: string;
    /** Bridge v2 calls this `avatar`; tolerate the older url-shaped spelling
     * used by a few connectors as well. */
    avatar?: string;
    avatar_url?: string;
  };
  /** Superseded by `state`, but still sent by older bridge builds. */
  state_event?: string;
  state?: {
    state_event?: string;
    error?: string;
    message?: string;
    info?: {is_bot?: boolean};
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
    avatarUrl: mediaUrl(login.profile?.avatar ?? login.profile?.avatar_url),
    state: accountState(event),
    // `message` is written for a human; the error code is a fallback.
    error: login.state?.message ?? login.state?.error ?? null,
    ...(login.state?.info?.is_bot === true ? {kind: "bot" as const} : {}),
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
