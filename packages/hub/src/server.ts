import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import path from "node:path";
import {HomeserverStore, type AppserviceRecord, type StoredEvent} from "./storage.js";

/**
 * The embedded Matrix homeserver: enough of the client-server and appservice
 * APIs for mautrix bridges (with end-to-bridge encryption off) and for FlareAI's
 * own hub client, and nothing more. It binds to loopback only, never
 * federates, and trusts its callers to the extent that a single-user local
 * server can: every token it has ever issued belongs to this machine.
 *
 * What is deliberately absent: /sync (bridges receive events as pushed
 * appservice transactions, and FlareAI reads over the paginated endpoints),
 * end-to-end encryption and all device/key endpoints, federation, and
 * power-level enforcement (the only writers are the user and bridges the user
 * installed).
 */

export interface HomeserverOptions {
  /** Domain in user and room ids, e.g. "flareai.local". Never resolved. */
  serverName: string;
  /** Where the database and uploaded media live. */
  dataDirectory: string;
  /** 0 lets the OS pick, which tests use. */
  port?: number;
  /**
   * Joins a local human user into rooms they are invited to by bridge users,
   * which is how portal rooms become readable without a separate autojoin
   * daemon. Bridge ghosts handle their own membership.
   */
  autoJoin?: boolean;
  /**
   * Called as a message lands, whoever wrote it. This server is where every
   * bridge delivers, so it is the one place that knows a conversation has
   * moved — which is what lets the app show a message as it arrives rather
   * than whenever it next thinks to ask.
   */
  onActivity?: (activity: {
    roomId: string;
    sender: string;
    /** The name that sender goes by, so the app never has to show a bridged
     * `@wechat_e106…:flareai.local` to a person. Null when nobody has set one. */
    senderName: string | null;
    type: string;
    /** When the event says it happened. History a bridge backfills on connect
     * lands here exactly like a live message, and only this tells them apart. */
    ts: number;
  }) => void;
  fetch?: typeof globalThis.fetch;
}

interface AuthContext {
  userId: string;
  appservice: AppserviceRecord | null;
}

/**
 * Returned by #body when the request carried JSON that does not parse, so the
 * route can answer M_NOT_JSON. A sentinel rather than a throw because the body
 * is read before dispatch, and a malformed body on a route that ignores bodies
 * is not worth failing.
 */
const MALFORMED_BODY = Symbol("malformed-json");

/**
 * A `?ts=` that is not a timestamp. Every caller must check for it rather than
 * pass it on: this project compiles without strictNullChecks, so nothing but
 * these guards stops a null stamp being written as an event's time.
 */
const BAD_TIMESTAMP = {
  errcode: "M_INVALID_PARAM",
  error: "ts must be a Unix timestamp in milliseconds",
};

const MAX_BODY_BYTES = 64 * 1024 * 1024;
const TRANSACTION_BATCH = 100;
/** How many recent events each room carries in `/sync`; see `#sync`. */
const SYNC_TIMELINE_LIMIT = 20;
/** Retry schedule for pushing transactions to a bridge that is down. */
const PUSH_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export class Homeserver {
  readonly #options: Required<Pick<HomeserverOptions, "serverName" | "dataDirectory" | "autoJoin">> &
    HomeserverOptions;
  readonly #store: HomeserverStore;
  readonly #server: Server;
  readonly #fetch: typeof globalThis.fetch;
  readonly #mediaDir: string;
  /** Bridge provisioning targets for the /bridges/{name}/* proxy. */
  readonly #provisioningTargets = new Map<string, string>();
  readonly #pushers = new Map<string, Promise<void>>();
  readonly #pushWakers = new Map<string, () => void>();
  readonly #pushersActive = new Set<string>();
  /** Wakes that arrived while a pusher was mid-delivery, so none are lost. */
  readonly #pendingWakes = new Set<string>();
  /**
   * Timeline events the user's own client wrote this run — the only events a
   * bridge is ever handed to transmit. Delivery to a bridge is what makes it
   * send on the network, so the pusher is default-deny: state flows freely,
   * but a message, reaction or redaction goes out only if the send handler
   * behind the user's own token armed it here. Everything else that produces
   * timeline events — bridge writes, backfill batches, database migrations, a
   * reset delivery position replaying history — is data about conversations,
   * never a command to transmit, whatever bug produced it.
   *
   * Deliberately in memory: a restart empties it, so no event can ever come
   * back later as a send. The cost is honest — a send the bridge did not take
   * before the app quit is dropped rather than transmitted at some surprising
   * later time.
   */
  readonly #outboundArmed = new Set<string>();
  #port = 0;
  #closed = false;

  constructor(options: HomeserverOptions) {
    this.#options = {autoJoin: true, ...options};
    this.#store = new HomeserverStore(path.join(options.dataDirectory, "homeserver.sqlite"));
    this.#mediaDir = path.join(options.dataDirectory, "media");
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#server = createServer((request, response) => {
      void this.#route(request, response).catch((error: unknown) => {
        if (!response.headersSent)
          this.#json(response, 500, {
            errcode: "M_UNKNOWN",
            error: error instanceof Error ? error.message : String(error),
          });
      });
    });
  }

  get serverName(): string {
    return this.#options.serverName;
  }

  get port(): number {
    return this.#port;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.#port}`;
  }

  async start(): Promise<void> {
    await mkdir(this.#mediaDir, {recursive: true});
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(this.#options.port ?? 0, "127.0.0.1", () => {
        const address = this.#server.address();
        this.#port = typeof address === "object" && address ? address.port : 0;
        resolve();
      });
    });
    for (const appservice of this.#store.appservices()) this.#wakePusher(appservice.id);
    this.#healInvites();
  }

  /**
   * Accepts invitations that were never answered. The invite-to-join hop only
   * fires as an invite arrives, so portals invited before it covered every code
   * path — or while the app was not running — sit unanswered: rooms the user
   * owns, full of their conversations, that `/sync` cannot report because it
   * only reports rooms one has joined. Left alone they never recover, so the
   * backlog is cleared once at startup.
   */
  #healInvites(): void {
    if (!this.#options.autoJoin) return;
    for (const userId of this.#store.userIds()) {
      if (!this.#isLocalHuman(userId)) continue;
      for (const roomId of this.#store.roomsForUser(userId, "invite")) {
        const invite = this.#store.stateEvent(roomId, "m.room.member", userId);
        // Only invitations from our own bridges, which is what the hop covers.
        if (!invite || !this.#isAppserviceUser(invite.sender)) continue;
        this.#append({
          roomId,
          sender: userId,
          type: "m.room.member",
          stateKey: userId,
          content: {membership: "join"},
          ts: Date.now(),
        });
      }
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const wake of this.#pushWakers.values()) wake();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
    await Promise.allSettled(this.#pushers.values());
    this.#store.close();
  }

  /**
   * Registers a bridge from its registration data and starts its pusher. The
   * bot user is NOT created here: the bridge registers it itself and expects
   * a fresh server to answer 200, not M_USER_IN_USE.
   */
  registerAppservice(record: AppserviceRecord): void {
    this.#store.registerAppservice(record);
    if (this.#port) this.#wakePusher(record.id);
  }

  /** Routes /bridges/{name}/* to a bridge's own provisioning listener. */
  setProvisioningTarget(name: string, baseUrl: string): void {
    this.#provisioningTargets.set(name, baseUrl.replace(/\/+$/, ""));
  }

  /**
   * Mints a local account and token without any password ceremony. This is the
   * embedded replacement for Synapse's admin registration API: both sides live
   * in one process, so the secret handshake would be theatre.
   */
  createLocalUser(localpart: string): {userId: string; accessToken: string} {
    const userId = this.#fullUserId(localpart);
    this.#store.ensureUser(userId);
    return {userId, accessToken: this.#store.createToken(userId, "flareai")};
  }

  // --- HTTP plumbing ---

  async #route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.baseUrl);
    const method = request.method ?? "GET";
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (parts[0] === "bridges") return this.#proxyProvisioning(request, response, url, parts);
    if (parts[0] === "_matrix" && parts[1] === "media")
      return this.#media(request, response, url, method, parts.slice(2));
    if (parts[0] !== "_matrix" || parts[1] !== "client")
      return this.#json(response, 404, {errcode: "M_UNRECOGNIZED", error: "Unknown endpoint"});

    const rest = parts.slice(2);
    if (method === "GET" && rest[0] === "versions")
      return this.#json(response, 200, {
        versions: ["v1.1", "v1.2", "v1.3", "v1.4", "v1.5", "v1.6", "v1.7", "v1.8", "v1.9", "v1.10", "v1.11"],
        unstable_features: {
          // MSC2659 appservice ping: mautrix bridges probe for it at startup.
          "fi.mau.msc2659.stable": true,
          "fi.mau.msc2659": true,
          // MSC3316 timestamp massaging, used for backfill.
          "org.matrix.msc3316": true,
          // Beeper batch sending. Without it a bridgev2 binary logs "Backfill
          // queue is enabled in config, but Matrix server doesn't support
          // batch sending" and never runs the queue, so a chat only ever gets
          // the history that fits in its first portal fill.
          "com.beeper.batch_sending": true,
        },
      });

    // Media reads its own raw stream, so its body must not be consumed here.
    const body = await this.#body(request, rest[0] === "v1" && rest[1] === "media");
    const query = url.searchParams;
    if (body === MALFORMED_BODY)
      return this.#json(response, 400, {
        errcode: "M_NOT_JSON",
        error: "Request body is not valid JSON",
      });

    if (method === "POST" && rest[0] === "v3" && rest[1] === "register")
      return this.#register(response, body, this.#tokenFrom(request, query));
    if (method === "POST" && rest[0] === "v3" && rest[1] === "login")
      return this.#json(response, 403, {
        errcode: "M_FORBIDDEN",
        error: "Password login is not supported on the embedded hub; FlareAI holds its token directly.",
      });

    const auth = this.#authenticate(request, query);
    if (!auth) {
      /**
       * A bridge feature-detects by probing endpoints, so a path this server
       * does not serve must say so whether or not a token came with it —
       * answering 401 reads as "your credentials failed" and sends the bridge
       * off to re-authenticate against a route that never existed.
       */
      if (!this.#recognised(method, rest))
        return this.#json(response, 404, {errcode: "M_UNRECOGNIZED", error: "Unknown endpoint"});
      // A token that was presented and rejected is unknown; only its absence
      // is missing. mautrix reads the difference to decide whether to re-login.
      return this.#json(
        response,
        401,
        this.#tokenFrom(request, query)
          ? {errcode: "M_UNKNOWN_TOKEN", error: "Unrecognised access token", soft_logout: false}
          : {errcode: "M_MISSING_TOKEN", error: "Missing access token"},
      );
    }

    if (method === "POST" && rest[0] === "v3" && rest[1] === "logout") {
      // `logout/all` is what a client calls to end every session it has, so
      // dropping only the token in hand left the others working.
      if (rest[2] === "all") this.#store.deleteTokensFor(auth.userId);
      else {
        const token = this.#tokenFrom(request, query);
        if (token) this.#store.deleteToken(token);
      }
      return this.#json(response, 200, {});
    }
    if (method === "GET" && rest[0] === "v3" && rest[1] === "account" && rest[2] === "whoami")
      return this.#json(response, 200, {user_id: auth.userId});
    if (method === "GET" && rest[0] === "v3" && rest[1] === "capabilities")
      return this.#json(response, 200, {capabilities: {"m.room_versions": {default: "11", available: {"11": "stable"}}}});

    if (rest[0] === "v1" && rest[1] === "appservice" && rest[3] === "ping" && method === "POST")
      return this.#appservicePing(response, auth, rest[2], body);

    if (rest[0] === "v3" && rest[1] === "profile")
      return this.#profile(response, auth, method, rest, body);

    if (method === "GET" && rest[0] === "v3" && rest[1] === "sync")
      return this.#sync(response, auth);

    if (method === "POST" && rest[0] === "v3" && rest[1] === "createRoom")
      return this.#createRoom(response, auth, body, query);

    if (
      method === "POST" &&
      rest[0] === "unstable" &&
      rest[1] === "com.beeper.backfill" &&
      rest[2] === "rooms" &&
      rest[3] &&
      rest[4] === "batch_send"
    )
      return this.#batchSend(response, auth, rest[3], body);

    if (rest[0] === "v3" && rest[1] === "rooms" && rest[2])
      return this.#roomRoute(response, auth, method, rest[2], rest.slice(3), body, query);

    if (method === "GET" && rest[0] === "v3" && rest[1] === "joined_rooms")
      return this.#json(response, 200, {joined_rooms: this.#store.roomsForUser(auth.userId)});

    if (method === "POST" && rest[0] === "v3" && rest[1] === "join" && rest[2]) {
      const roomId = rest[2].startsWith("#") ? this.#store.roomForAlias(rest[2]) : rest[2];
      if (!roomId || !this.#store.roomExists(roomId))
        return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "Unknown room"});
      this.#membershipEvent(roomId, auth.userId, auth.userId, "join", query, {}, auth.appservice?.id ?? null);
      return this.#json(response, 200, {room_id: roomId});
    }

    if (method === "POST" && rest[0] === "v3" && rest[1] === "search")
      return this.#search(response, auth, body, query);
    if (method === "GET" && rest[0] === "v3" && rest[1] === "notifications")
      return this.#notifications(response, auth, query);

    if (rest[0] === "v3" && rest[1] === "user" && rest[2])
      return this.#accountData(response, auth, method, rest.slice(2), body);

    if (rest[0] === "v3" && rest[1] === "directory" && rest[2] === "room" && rest[3]) {
      if (method === "PUT") {
        const target = (body as {room_id?: string}).room_id ?? "";
        // An alias pointing at nothing resolves to a room that cannot be
        // joined, and the caller was told it worked.
        if (!target || !this.#store.roomExists(target))
          return this.#json(response, 400, {
            errcode: "M_INVALID_PARAM",
            error: "room_id must name a room on this server",
          });
        this.#store.setAlias(rest[3], target);
        return this.#json(response, 200, {});
      }
      if (method === "DELETE") {
        if (!this.#store.roomForAlias(rest[3]))
          return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "Unknown alias"});
        this.#store.deleteAlias(rest[3]);
        return this.#json(response, 200, {});
      }
      const roomId = this.#store.roomForAlias(rest[3]);
      if (!roomId) return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "Unknown alias"});
      return this.#json(response, 200, {room_id: roomId, servers: [this.serverName]});
    }

    if (method === "PUT" && rest[0] === "v3" && rest[1] === "presence")
      return this.#json(response, 200, {});
    if (rest[0] === "v1" && rest[1] === "media")
      return this.#media(request, response, url, method, rest.slice(1), auth, body);

    return this.#json(response, 404, {errcode: "M_UNRECOGNIZED", error: "Unknown endpoint"});
  }

  /**
   * Whether a path is one this server serves at all, used to answer an unknown
   * endpoint with 404 before authentication rather than 401 after it. Kept
   * beside the route table it mirrors; a new endpoint that forgets to appear
   * here still works, it merely asks for a token first.
   */
  #recognised(method: string, rest: string[]): boolean {
    const [version, head, third, fourth] = rest;
    if (version === "versions") return true;
    if (version === "v1")
      return (
        (head === "appservice" && fourth === "ping") || head === "media" || head === "rooms"
      );
    if (version === "unstable") return head === "com.beeper.backfill";
    if (version !== "v3") return false;
    return (
      [
        "register",
        "login",
        "logout",
        "account",
        "capabilities",
        "profile",
        "sync",
        "createRoom",
        "rooms",
        "joined_rooms",
        "join",
        "search",
        "notifications",
        "user",
        "directory",
        "presence",
      ].includes(head ?? "") &&
      // `/rooms` and `/join` need a room to act on; without one there is no
      // endpoint, only a prefix.
      (!["rooms", "join"].includes(head ?? "") || Boolean(third)) &&
      (method !== "GET" || head !== "createRoom")
    );
  }

  // --- auth ---

  #tokenFrom(request: IncomingMessage, query: URLSearchParams): string | null {
    const header = request.headers.authorization;
    if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
    return query.get("access_token");
  }

  #authenticate(request: IncomingMessage, query: URLSearchParams): AuthContext | null {
    const token = this.#tokenFrom(request, query);
    if (!token) return null;
    const appservice = this.#store.appserviceByToken(token);
    if (appservice) {
      // Appservices act as their bot unless masquerading as a namespaced user
      // (this is how a bridge speaks as each ghost).
      const masquerade = query.get("user_id");
      const bot = this.#fullUserId(appservice.senderLocalpart);
      if (!masquerade) return {userId: bot, appservice};
      if (masquerade === bot || this.#inNamespace(appservice, masquerade))
        return {userId: masquerade, appservice};
      /**
       * A bridge may also speak as the account it bridges for. This is what
       * every Matrix bridge calls double puppeting, and elsewhere it needs the
       * user's own access token to do it — the point being that a bridge on
       * some other server must not be able to write as you.
       *
       * Here it is the same person either way: this server is local, single
       * user, never federates, and every appservice on it is one FlareAI
       * installed and supervises. Without this a message the user sent in
       * WhatsApp or WeChat itself cannot be attributed to them at all — it has
       * to arrive as the person they were talking to, which is worse than
       * wrong, it is unreadable.
       */
      if (this.#isLocalHuman(masquerade) && this.#store.userExists(masquerade))
        return {userId: masquerade, appservice};
      return null;
    }
    const userId = this.#store.userForToken(token);
    return userId ? {userId, appservice: null} : null;
  }

  #inNamespace(appservice: AppserviceRecord, userId: string): boolean {
    return appservice.userNamespaces.some((pattern) => {
      try {
        return new RegExp(`^${pattern}$`).test(userId);
      } catch {
        return false;
      }
    });
  }

  // --- endpoint groups ---

  #register(response: ServerResponse, body: unknown, token: string | null): void {
    const input = (body ?? {}) as {type?: string; username?: string; inhibit_login?: boolean};
    if (input.type !== "m.login.application_service")
      return this.#json(response, 403, {
        errcode: "M_FORBIDDEN",
        error: "Only appservice registration is supported; FlareAI provisions its own account internally.",
      });
    const appservice = token ? this.#store.appserviceByToken(token) : null;
    if (!appservice)
      return this.#json(response, 401, {errcode: "M_UNKNOWN_TOKEN", error: "Invalid appservice token"});
    const localpart = input.username ?? "";
    const userId = this.#fullUserId(localpart);
    if (localpart !== appservice.senderLocalpart && !this.#inNamespace(appservice, userId))
      return this.#json(response, 400, {
        errcode: "M_EXCLUSIVE",
        error: "Username is not covered by the appservice namespaces",
      });
    if (this.#store.userExists(userId))
      return this.#json(response, 400, {errcode: "M_USER_IN_USE", error: "User already registered"});
    this.#store.ensureUser(userId, appservice.id);
    const result: Record<string, unknown> = {user_id: userId, home_server: this.serverName};
    if (!input.inhibit_login) {
      result.access_token = this.#store.createToken(userId, "appservice");
      result.device_id = "appservice";
    }
    return this.#json(response, 200, result);
  }

  #profile(
    response: ServerResponse,
    auth: AuthContext,
    method: string,
    rest: string[],
    body: unknown,
  ): void {
    const userId = rest[2];
    const field = rest[3] as "displayname" | "avatar_url" | undefined;
    if (method === "PUT" && (field === "displayname" || field === "avatar_url")) {
      /**
       * Only the account itself, or an appservice that owns the ghost. This
       * handler was the one authenticated route that never received the auth
       * context, so any token could rename any user — including one bridge
       * renaming another bridge's ghosts.
       */
      const owned =
        userId === auth.userId ||
        (auth.appservice !== null && this.#inNamespace(auth.appservice, userId));
      if (!owned)
        return this.#json(response, 403, {
          errcode: "M_FORBIDDEN",
          error: "A profile belongs to the account it names",
        });
      const value = (body as Record<string, unknown>)[field];
      this.#store.setProfile(userId, field, typeof value === "string" ? value : null);
      // Member events carry the name they were written with, so a rename that
      // stops at the profile leaves every room the user is already in showing
      // the old one.
      this.#republishMembership(userId);
      return this.#json(response, 200, {});
    }
    // An unset field or unknown user answers 200 with the field absent rather
    // than 404: mautrix reads a ghost's profile before it has ever set one and
    // treats a failed GET as an error, not as "empty".
    const profile = this.#store.profile(userId);
    if (field === "displayname")
      return this.#json(response, 200, profile?.displayname ? {displayname: profile.displayname} : {});
    if (field === "avatar_url")
      return this.#json(response, 200, profile?.avatarUrl ? {avatar_url: profile.avatarUrl} : {});
    return this.#json(response, 200, {
      ...(profile?.displayname ? {displayname: profile.displayname} : {}),
      ...(profile?.avatarUrl ? {avatar_url: profile.avatarUrl} : {}),
    });
  }

  #createRoom(response: ServerResponse, auth: AuthContext, body: unknown, query: URLSearchParams): void {
    const input = (body ?? {}) as {
      name?: string;
      topic?: string;
      preset?: string;
      invite?: string[];
      is_direct?: boolean;
      creation_content?: Record<string, unknown>;
      initial_state?: Array<{type: string; state_key?: string; content: unknown}>;
      power_level_content_override?: Record<string, unknown>;
      room_version?: unknown;
    };
    // Silently substituting 11 left a bridge that asked for a particular
    // version believing it got one, with its redaction and event-format
    // assumptions quietly wrong.
    if (input.room_version !== undefined) {
      if (typeof input.room_version !== "string")
        return this.#json(response, 400, {errcode: "M_BAD_JSON", error: "room_version must be a string"});
      if (input.room_version !== "11")
        return this.#json(response, 400, {
          errcode: "M_UNSUPPORTED_ROOM_VERSION",
          error: "This server only creates room version 11",
        });
    }
    const roomId = `!${randomBytes(12).toString("base64url")}:${this.serverName}`;
    this.#store.createRoom(roomId, auth.userId);
    const ts = this.#timestamp(auth, query);
    if (ts === null) return this.#json(response, 400, BAD_TIMESTAMP);
    const append = (type: string, stateKey: string, content: unknown): StoredEvent =>
      this.#append({
        roomId,
        sender: auth.userId,
        type,
        stateKey,
        content,
        ts,
        origin: auth.appservice?.id ?? null,
      });

    append("m.room.create", "", {
      ...input.creation_content,
      // Room version 11 removed content.creator — the sender is where a reader
      // looks. Writing both while declaring 11 is self-contradictory: a reader
      // that trusts the version never sees this field, and one that reads it
      // may prefer it to the truth.
      room_version: "11",
    });
    append("m.room.member", auth.userId, {membership: "join"});
    // Not enforced here — the only writers are the user and bridges the user
    // installed — but mautrix reads this event locally to decide whether it may
    // rename a portal or invite a ghost, and an absent key reads as "no" in
    // some of its paths, which stops a bridge provisioning anything at all.
    append("m.room.power_levels", "", {
      ban: 50,
      events: {},
      events_default: 0,
      invite: 0,
      kick: 50,
      redact: 50,
      state_default: 50,
      users: {[auth.userId]: 100},
      users_default: 0,
      ...input.power_level_content_override,
    });
    // Shared history is the precondition for backfilled history being readable
    // by someone who joined after it happened, which is every portal.
    append("m.room.history_visibility", "", {history_visibility: "shared"});
    append("m.room.join_rules", "", {
      join_rule: input.preset === "public_chat" ? "public" : "invite",
    });
    for (const state of input.initial_state ?? [])
      append(state.type, state.state_key ?? "", state.content);
    if (input.name) append("m.room.name", "", {name: input.name});
    if (input.topic) append("m.room.topic", "", {topic: input.topic});
    for (const invited of input.invite ?? [])
      this.#membershipEvent(
        roomId,
        auth.userId,
        invited,
        "invite",
        query,
        {is_direct: input.is_direct === true},
        auth.appservice?.id ?? null,
      );
    return this.#json(response, 200, {room_id: roomId});
  }

  #roomRoute(
    response: ServerResponse,
    auth: AuthContext,
    method: string,
    roomId: string,
    rest: string[],
    body: unknown,
    query: URLSearchParams,
  ): void {
    /**
     * Forbidden rather than missing, which is what the spec asks for and what a
     * bridge acts on: mautrix reads 403 as "this portal is gone, stop", while
     * 404 reads as transient and is retried forever for a room that will never
     * exist. State that was never set still answers 404 — that is "not yet",
     * and a bridge probing for optional state depends on the difference.
     */
    if (!this.#store.roomExists(roomId))
      return this.#json(response, 403, {errcode: "M_FORBIDDEN", error: "Unknown room"});

    if (method === "POST" && ["invite", "kick", "ban"].includes(rest[0] ?? "")) {
      const target = (body as {user_id?: string}).user_id ?? "";
      // A ban is not a departure. Recording leave for both meant a banned user
      // could be invited straight back, which is the one thing a ban is for.
      const membership = rest[0] === "invite" ? "invite" : rest[0] === "ban" ? "ban" : "leave";
      const written = this.#membershipEvent(
        roomId,
        auth.userId,
        target,
        membership,
        query,
        {...(rest[0] === "invite" && (body as {is_direct?: boolean}).is_direct ? {is_direct: true} : {})},
        auth.appservice?.id ?? null,
      );
      if ("errcode" in written) return this.#json(response, 403, written);
      return this.#json(response, 200, {});
    }
    if (method === "POST" && rest[0] === "join") {
      this.#membershipEvent(roomId, auth.userId, auth.userId, "join", query, {}, auth.appservice?.id ?? null);
      return this.#json(response, 200, {room_id: roomId});
    }
    if (method === "POST" && rest[0] === "leave") {
      this.#membershipEvent(roomId, auth.userId, auth.userId, "leave", query, {}, auth.appservice?.id ?? null);
      return this.#json(response, 200, {});
    }
    if (method === "POST" && rest[0] === "forget") {
      const membership = (
        this.#store.stateEvent(roomId, "m.room.member", auth.userId)?.content as
          | {membership?: string}
          | undefined
      )?.membership;
      if (membership === "join" || membership === "invite")
        return this.#json(response, 400, {
          errcode: "M_UNKNOWN",
          error: "The room must be left before it can be forgotten",
        });
      return this.#json(response, 200, {});
    }

    if (method === "PUT" && rest[0] === "send" && rest[1] && rest[2] !== undefined) {
      const oversized = tooLarge(body);
      if (oversized) return this.#json(response, 413, oversized);
      /**
       * A client may redact through /send rather than /redact, and in room
       * version 11 the target is named in the content. Read either shape, so a
       * redaction sent this way is a redaction rather than an inert event that
       * silently retracts nothing.
       */
      const target =
        rest[1] === "m.room.redaction"
          ? ((body as {redacts?: unknown})?.redacts ?? undefined)
          : undefined;
      const stamp = this.#timestamp(auth, query);
      if (stamp === null) return this.#json(response, 400, BAD_TIMESTAMP);
      const event = this.#append({
        roomId,
        sender: auth.userId,
        type: rest[1],
        stateKey: null,
        content: body,
        ts: stamp,
        txnKey: this.#txnKey(auth.userId, roomId, "send", rest[2]),
        ...(typeof target === "string" ? {redacts: target} : {}),
        origin: auth.appservice?.id ?? null,
      });
      // Only the user's own token arms an outbound send; an appservice
      // writing through this same route is recording, not asking to transmit.
      if (!auth.appservice) this.#outboundArmed.add(event.eventId);
      return this.#json(response, 200, {event_id: event.eventId});
    }
    if (method === "PUT" && rest[0] === "redact" && rest[1] && rest[2] !== undefined) {
      const redactionStamp = this.#timestamp(auth, query);
      if (redactionStamp === null) return this.#json(response, 400, BAD_TIMESTAMP);
      const event = this.#append({
        roomId,
        sender: auth.userId,
        type: "m.room.redaction",
        stateKey: null,
        // Room version 11 moved the target into the content, and that is where
        // mautrix looks; the top-level field stays for anything older.
        content: {...((body ?? {}) as Record<string, unknown>), redacts: rest[1]},
        ts: redactionStamp,
        txnKey: this.#txnKey(auth.userId, roomId, "redact", rest[2]),
        redacts: rest[1],
        origin: auth.appservice?.id ?? null,
      });
      // A redaction retracts on the remote network, so it is a send too.
      if (!auth.appservice) this.#outboundArmed.add(event.eventId);
      return this.#json(response, 200, {event_id: event.eventId});
    }
    if (rest[0] === "state") {
      /**
       * Membership written as plain state still has to go through membership
       * handling. A bridge that creates a portal by PUTting `m.room.member`
       * rather than calling `/invite` — which mautrix's bridgev2 bridges do —
       * would otherwise skip the invite-to-join hop, and the invitation sits
       * unanswered forever: the room exists, the user is not in it, and
       * `/sync` reports only joined rooms, so the conversation is nowhere.
       */
      if (method === "PUT" && rest[1] === "m.room.member" && rest[2]) {
        const membership = (body as {membership?: string}).membership ?? "";
        const {membership: _membership, ...extra} = (body ?? {}) as Record<string, unknown>;
        const written = this.#membershipEvent(
          roomId,
          auth.userId,
          rest[2],
          membership,
          query,
          extra,
          auth.appservice?.id ?? null,
        );
        if ("errcode" in written) return this.#json(response, 403, written);
        // The event this call wrote, not whatever current state points at: the
        // auto-join hop lands a join immediately after an invite, so reading
        // state back reported the join and the bridge lost track of its invite.
        return this.#json(response, 200, {event_id: written.eventId});
      }
      if (method === "PUT" && rest[1]) {
        const oversized = tooLarge(body);
        if (oversized) return this.#json(response, 413, oversized);
        const stateStamp = this.#timestamp(auth, query);
        if (stateStamp === null) return this.#json(response, 400, BAD_TIMESTAMP);
        const event = this.#append({
          roomId,
          sender: auth.userId,
          type: rest[1],
          stateKey: rest[2] ?? "",
          content: body,
          ts: stateStamp,
          origin: auth.appservice?.id ?? null,
        });
        return this.#json(response, 200, {event_id: event.eventId});
      }
      if (method === "GET" && rest[1]) {
        const event = this.#store.stateEvent(roomId, rest[1], rest[2] ?? "");
        if (!event) return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "No such state"});
        // mautrix's FullStateEvent asks for the whole event with ?format=event.
        if (query.get("format") === "event")
        return this.#json(response, 200, this.#clientEventFor(event, auth));
        return this.#json(response, 200, event.content);
      }
      if (method === "GET")
        return this.#json(response, 200, this.#store.fullState(roomId).map(clientEvent));
    }
    if (method === "GET" && rest[0] === "event" && rest[1]) {
      const event = this.#store.event(rest[1]);
      if (!event || event.roomId !== roomId)
        return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "Unknown event"});
      return this.#json(response, 200, this.#clientEventFor(event, auth));
    }
    if (method === "GET" && rest[0] === "messages") {
      // Anything but "f" used to mean backwards, so a bridge backfilling with a
      // typo'd direction silently read history the wrong way round.
      const requested = query.get("dir");
      if (requested !== null && requested !== "b" && requested !== "f")
        return this.#json(response, 400, {
          errcode: "M_INVALID_PARAM",
          error: "dir must be 'b' or 'f'",
        });
      const dir = requested === "f" ? "f" : "b";
      const from = paginationToken(query.get("from"));
      const to = paginationToken(query.get("to"));
      // NaN bound silently matched nothing, so a garbage token was answered
      // with an empty page that reads exactly like the end of the room.
      if (from === undefined || to === undefined)
        return this.#json(response, 400, {
          errcode: "M_INVALID_PARAM",
          error: "from and to must be pagination tokens this server issued",
        });
      const page = this.#store.messages(roomId, {
        dir,
        from: from ?? undefined,
        to: to ?? undefined,
        limit: boundedNumber(query.get("limit"), 30, 1000),
      });
      return this.#json(response, 200, {
        chunk: page.events.map((event) => this.#clientEventFor(event, auth)),
        start: `t${page.start}`,
        // Absent once the room has no more to give, which is the only signal a
        // reader has to stop asking.
        ...(page.end === null ? {} : {end: `t${page.end}`}),
      });
    }
    if (method === "GET" && rest[0] === "joined_members") {
      const joined: Record<string, unknown> = {};
      for (const member of this.#store.members(roomId, "join")) {
        const profile = this.#store.profile(member.stateKey ?? "");
        joined[member.stateKey ?? ""] = {
          display_name: profile?.displayname ?? null,
          avatar_url: profile?.avatarUrl ?? null,
        };
      }
      return this.#json(response, 200, {joined});
    }
    if (method === "GET" && rest[0] === "members") {
      // A bridge syncing a portal's participants asks for joined members only;
      // ignoring the filter handed it everyone who ever left, and it invited
      // them back.
      const wanted = query.get("membership");
      const excluded = query.get("not_membership");
      const members = this.#store.members(roomId).filter((event) => {
        const membership = (event.content as {membership?: string} | undefined)?.membership;
        if (wanted && membership !== wanted) return false;
        if (excluded && membership === excluded) return false;
        return true;
      });
      return this.#json(response, 200, {chunk: members.map(clientEvent)});
    }
    if (method === "PUT" && rest[0] === "typing") return this.#json(response, 200, {});
    if (method === "POST" && rest[0] === "receipt" && rest[2]) {
      const event = this.#store.event(rest[2]);
      if (event) this.#store.setReceipt(auth.userId, roomId, event.streamOrder);
      return this.#json(response, 200, {});
    }
    if (method === "POST" && rest[0] === "read_markers") {
      const markers = (body ?? {}) as Record<string, string>;
      const fullyRead = markers["m.fully_read"];
      const marker = fullyRead ?? markers["m.read"];
      const event = marker ? this.#store.event(marker) : null;
      if (event) this.#store.setReceipt(auth.userId, roomId, event.streamOrder);
      // A fully-read marker is readable back as room account data, which is
      // where a client looks for it on the next launch.
      if (fullyRead)
        this.#store.setAccountData(auth.userId, roomId, "m.fully_read", {event_id: fullyRead});
      return this.#json(response, 200, {});
    }
    return this.#json(response, 404, {errcode: "M_UNRECOGNIZED", error: "Unknown room endpoint"});
  }

  #accountData(
    response: ServerResponse,
    auth: AuthContext,
    method: string,
    rest: string[],
    body: unknown,
  ): void {
    // rest: [userId, "account_data", type] or [userId, "rooms", roomId, "account_data", type]
    const roomId = rest[1] === "rooms" ? rest[2] : null;
    const type = rest[1] === "rooms" ? rest[4] : rest[2];
    if (!type) return this.#json(response, 404, {errcode: "M_UNRECOGNIZED", error: "Unknown endpoint"});
    // The path names whose account data this is, and it was ignored: a write
    // addressed to another account was silently filed under the caller's own.
    if (rest[0] && rest[0] !== auth.userId)
      return this.#json(response, 403, {
        errcode: "M_FORBIDDEN",
        error: "Account data belongs to the account that owns it",
      });
    if (method === "PUT") {
      this.#store.setAccountData(auth.userId, roomId, type, body);
      return this.#json(response, 200, {});
    }
    const content = this.#store.accountData(auth.userId, roomId, type);
    if (content === null)
      return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "No account data"});
    return this.#json(response, 200, content);
  }

  #search(
    response: ServerResponse,
    auth: AuthContext,
    body: unknown,
    query: URLSearchParams,
  ): void {
    const criteria = (
      body as {
        search_categories?: {
          room_events?: {search_term?: string; filter?: {limit?: number; rooms?: unknown}};
        };
      }
    )?.search_categories?.room_events;
    // `rooms` is how a client asks about one conversation. Ignoring it answered
    // a search of one chat with hits from every other chat the user has.
    const rooms = Array.isArray(criteria?.filter?.rooms)
      ? criteria.filter.rooms.filter((room): room is string => typeof room === "string")
      : undefined;
    const limit = criteria?.filter?.limit ?? 30;
    // The token a previous page handed back. Ignoring it answered every request
    // with the first page, so a client paging through results looped on it.
    const continued = query.get("next_batch");
    const {events, count} = this.#store.searchMessages(
      auth.userId,
      criteria?.search_term ?? "",
      limit,
      rooms,
      continued !== null && /^\d+$/.test(continued) ? Number(continued) : undefined,
    );
    return this.#json(response, 200, {
      search_categories: {
        room_events: {
          count,
          results: events.map((event) => ({rank: 1, result: this.#clientEventFor(event)})),
          // Only when there is more than this page, which is how a client knows
          // whether asking again would tell it anything new.
          ...(count > events.length && events.length === limit
            ? {next_batch: String(events[events.length - 1].streamOrder)}
            : {}),
        },
      },
    });
  }

  #notifications(response: ServerResponse, auth: AuthContext, query: URLSearchParams): void {
    const from = Number(query.get("from") ?? "0") || 0;
    const limit = boundedNumber(query.get("limit"), 100, 500);
    const events = this.#store.unread(auth.userId, from, limit);
    const last = events[events.length - 1];
    return this.#json(response, 200, {
      notifications: events.map((event) => ({
        read: false,
        room_id: event.roomId,
        ts: event.originServerTs,
        event: clientEvent(event),
        actions: ["notify"],
      })),
      ...(last && events.length === limit ? {next_token: String(last.streamOrder)} : {}),
    });
  }

  /**
   * A deliberately partial `/sync`: one snapshot of every joined room, with the
   * state, the newest message, the unread count and the member count. No
   * streaming, no `since`, no long poll.
   *
   * Bridges here are pushed their events as appservice transactions and never
   * call this. It exists for FlareAI's own chat list, which otherwise needs a
   * name, a member list and a last message per room — four hundred round trips
   * for a couple of hundred rooms, to assemble what one query already knows.
   */
  #sync(response: ServerResponse, auth: AuthContext): void {
    const unread = this.#store.unreadCounts(auth.userId);
    const join: Record<string, unknown> = {};
    for (const roomId of this.#store.roomsForUser(auth.userId)) {
      // A window rather than the single newest event: the last thing to happen
      // in a room is often a reaction, a join or a redaction, and a one-event
      // timeline then carries no message for the chat list to preview — the
      // row draws with no last line and no time. The reader takes the newest
      // message out of whatever this holds.
      const timeline = this.#store.messages(roomId, {limit: SYNC_TIMELINE_LIMIT, dir: "b"});
      join[roomId] = {
        state: {events: this.#store.fullState(roomId).map(clientEvent)},
        // `messages` reads backwards; a timeline runs oldest to newest.
        timeline: {events: timeline.events.map(clientEvent).reverse()},
        unread_notifications: {notification_count: unread.get(roomId) ?? 0},
        summary: {"m.joined_member_count": this.#store.members(roomId, "join").length},
      };
    }
    this.#json(response, 200, {next_batch: String(this.#store.maxStreamOrder()), rooms: {join}});
  }

  async #appservicePing(
    response: ServerResponse,
    auth: AuthContext,
    appserviceId: string,
    body: unknown,
  ): Promise<void> {
    const appservice = auth.appservice;
    if (!appservice || appservice.id !== appserviceId)
      return this.#json(response, 403, {errcode: "M_FORBIDDEN", error: "Not your appservice"});
    /**
     * A receive-only bridge registers no url at all, and MSC2659 has its own
     * answer for that. Reporting a connection failure instead sent the operator
     * looking for a listener that was never meant to exist.
     */
    if (!appservice.url)
      return this.#json(response, 400, {
        errcode: "M_URL_NOT_SET",
        error: "This appservice registered no url, so it cannot be pinged",
      });
    const transactionId = (body as {transaction_id?: string}).transaction_id ?? randomBytes(8).toString("hex");
    const started = Date.now();
    try {
      const result = await this.#fetch(`${appservice.url.replace(/\/+$/, "")}/_matrix/app/v1/ping`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appservice.hsToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({transaction_id: transactionId}),
        signal: AbortSignal.timeout(10_000),
      });
      if (!result.ok)
        return this.#json(response, 502, {
          errcode: "FI.MAU.MSC2659_BAD_STATUS",
          error: `Ping returned status ${result.status}`,
          status: result.status,
        });
      return this.#json(response, 200, {duration_ms: Date.now() - started});
    } catch (error) {
      return this.#json(response, 502, {
        errcode: "FI.MAU.MSC2659_CONNECTION_FAILED",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --- media ---

  async #media(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    method: string,
    rest: string[],
    _auth?: AuthContext,
    parsedBody?: unknown,
  ): Promise<void> {
    void parsedBody;
    // rest for legacy: ["v3", "upload"] / ["v3", "download", server, id, name?]
    // rest for authenticated media: ["media", "download", server, id] under
    // client/v1 — either way the verb sits at index 1 and the args after it.
    const parts = rest.slice(1);
    const verb = rest[1];
    if (method === "POST" && verb === "upload") {
      const mediaId = randomBytes(16).toString("base64url");
      const chunks: Buffer[] = [];
      let total = 0;
      await new Promise<void>((resolve, reject) => {
        request.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_BODY_BYTES) reject(new Error("Upload too large"));
          else chunks.push(chunk);
        });
        request.on("end", resolve);
        request.on("error", reject);
      });
      await writeFile(path.join(this.#mediaDir, mediaId), Buffer.concat(chunks));
      this.#store.recordMedia({
        mediaId,
        // An empty header is not a content type. Recording "" stored the bytes
        // under a type no reader accepts, and the download served nothing.
        contentType: request.headers["content-type"] || "application/octet-stream",
        fileName: url.searchParams.get("filename"),
        bytes: total,
      });
      return this.#json(response, 200, {content_uri: `mxc://${this.serverName}/${mediaId}`});
    }
    if (method === "GET" && verb === "download") {
      const mediaId = parts[2] ?? "";
      const record = this.#store.media(mediaId);
      if (!record) return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "Unknown media"});
      const data = await readFile(path.join(this.#mediaDir, mediaId));
      response.writeHead(200, {
        "Content-Type": record.contentType,
        "Content-Length": data.length,
        // The name the file was uploaded with, so saving an attachment keeps it
        // rather than inventing one from the media id. A name in the last path
        // segment wins, which is how a client asks for a download name of its
        // own choosing.
        ...(() => {
          const named = parts[3] ?? record.fileName;
          return named
            ? {"Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(named)}`}
            : {};
        })(),
      });
      response.end(data);
      return;
    }
    if (method === "GET" && verb === "thumbnail") {
      const mediaId = parts[2] ?? "";
      const record = this.#store.media(mediaId);
      if (!record) return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "Unknown media"});
      const data = await readFile(path.join(this.#mediaDir, mediaId));
      response.writeHead(200, {"Content-Type": record.contentType, "Content-Length": data.length});
      response.end(data);
      return;
    }
    if (method === "GET" && verb === "preview_url") return this.#json(response, 200, {});
    if (method === "GET" && verb === "config")
      return this.#json(response, 200, {"m.upload.size": MAX_BODY_BYTES});
    return this.#json(response, 404, {errcode: "M_UNRECOGNIZED", error: "Unknown media endpoint"});
  }

  // --- provisioning proxy ---

  async #proxyProvisioning(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    parts: string[],
  ): Promise<void> {
    const target = this.#provisioningTargets.get(parts[1] ?? "");
    if (!target)
      return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "Unknown bridge"});
    const rest = `/${parts.slice(2).map(encodeURIComponent).join("/")}${url.search}`;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    try {
      const upstream = await this.#fetch(`${target}${rest}`, {
        method: request.method,
        headers: {
          ...(request.headers.authorization ? {Authorization: request.headers.authorization} : {}),
          ...(request.headers["content-type"]
            ? {"Content-Type": String(request.headers["content-type"])}
            : {}),
        },
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
        // Login waits block until the remote side acts, so this mirrors the
        // client's own long ceiling rather than a normal request timeout.
        signal: AbortSignal.timeout(200_000),
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      });
      response.end(body);
    } catch (error) {
      this.#json(response, 502, {errcode: "M_UNKNOWN", error: unreachableBridge(error)});
    }
  }

  /**
   * Beeper batch sending: one request carrying a run of already-timestamped
   * history for a room. Synapse's version threads the batch into the room's
   * past; here the timeline is a single append-only stream read back in order,
   * so the batch is appended in the order it arrives with each event keeping
   * its own `origin_server_ts` — the same shape the per-event `?ts=` backfill
   * path already produces, and what the bridges' backfill queue needs to exist
   * before it will run at all.
   */
  #batchSend(response: ServerResponse, auth: AuthContext, roomId: string, body: unknown): void {
    if (!auth.appservice)
      return this.#json(response, 403, {errcode: "M_FORBIDDEN", error: "Batch sending is appservice-only"});
    if (!this.#store.roomExists(roomId))
      return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "Unknown room"});

    const events = (body as {events?: unknown}).events;
    if (!Array.isArray(events))
      return this.#json(response, 400, {errcode: "M_BAD_JSON", error: "events must be an array"});

    /**
     * Validated in full before anything is written. Interleaving the checks with
     * the writes left a rejected batch half-committed: the caller was told the
     * batch failed and half of it was in the room, which for a backfill means
     * history that can never be completed because the bridge will retry the
     * whole batch and skip what it thinks it already sent.
     */
    for (const entry of events) {
      if (typeof entry !== "object" || entry === null)
        return this.#json(response, 400, {errcode: "M_BAD_JSON", error: "events must be objects"});
      const {type, sender} = entry as Record<string, unknown>;
      if (typeof type !== "string" || typeof sender !== "string")
        return this.#json(response, 400, {
          errcode: "M_BAD_JSON",
          error: "events need a type and sender",
        });
    }
    const eventIds: string[] = [];
    for (const entry of events) {
      if (typeof entry !== "object" || entry === null)
        return this.#json(response, 400, {errcode: "M_BAD_JSON", error: "events must be objects"});
      const {
        type,
        sender,
        content,
        state_key: stateKey,
        origin_server_ts: ts,
      } = entry as Record<string, unknown>;
      if (typeof type !== "string" || typeof sender !== "string")
        return this.#json(response, 400, {errcode: "M_BAD_JSON", error: "events need a type and sender"});
      // A batch may carry the ghost's own membership; that has to go through
      // membership handling for the same reason a PUT of it does.
      if (type === "m.room.member" && typeof stateKey === "string") {
        const {membership, ...extra} = (content ?? {}) as Record<string, unknown>;
        this.#membershipEvent(
          roomId,
          sender,
          stateKey,
          typeof membership === "string" ? membership : "",
          new URLSearchParams(),
          extra,
          auth.appservice.id,
        );
        eventIds.push(this.#store.stateEvent(roomId, "m.room.member", stateKey)?.eventId ?? "");
        continue;
      }
      const event = this.#append({
        roomId,
        sender,
        type,
        stateKey: typeof stateKey === "string" ? stateKey : null,
        content: content ?? {},
        ts: typeof ts === "number" ? ts : Date.now(),
        origin: auth.appservice.id,
      });
      eventIds.push(event.eventId);
    }
    return this.#json(response, 200, {event_ids: eventIds});
  }

  // --- event machinery ---

  /**
   * MSC3316: appservices may massage timestamps, which bridges use to give
   * backfilled history its original times. A malformed value is refused rather
   * than quietly becoming now — a bridge importing a year of history would
   * otherwise stamp all of it with today's date and every conversation would
   * read as having happened at once.
   */
  #timestamp(auth: AuthContext, query: URLSearchParams): number | null {
    const ts = query.get("ts");
    if (ts !== null && !/^\d+$/.test(ts)) return null;
    if (auth.appservice && ts) return Number(ts);
    return Date.now();
  }

  #membershipEvent(
    roomId: string,
    sender: string,
    target: string,
    membership: string,
    query: URLSearchParams,
    extra: Record<string, unknown> = {},
    origin: string | null = null,
  ): StoredEvent | {errcode: string; error: string} {
    /**
     * Which transitions are legal, checked before anything is written. Without
     * this, inviting someone already joined demoted their membership to invite
     * — knocking a live portal out of the joined state the hub reads rooms
     * from — a user could invite themselves out of their own room, and kicking
     * a stranger minted an account for them and filed a departure they never
     * made.
     */
    const current = (
      this.#store.stateEvent(roomId, "m.room.member", target)?.content as
        | {membership?: string}
        | undefined
    )?.membership;
    if (membership === "invite") {
      if (current === "join")
        return {errcode: "M_FORBIDDEN", error: `${target} is already in the room`};
      if (sender === target)
        return {errcode: "M_FORBIDDEN", error: "A user cannot invite themselves"};
      if (current === "ban")
        return {errcode: "M_FORBIDDEN", error: `${target} is banned from the room`};
    }
    if (membership === "leave" && sender !== target && current !== "join" && current !== "invite")
      return {errcode: "M_FORBIDDEN", error: `${target} is not in the room`};
    this.#store.ensureUser(target);
    const profile = this.#store.profile(target);
    const written = this.#append({
      roomId,
      sender,
      type: "m.room.member",
      stateKey: target,
      content: {
        membership,
        ...(profile?.displayname ? {displayname: profile.displayname} : {}),
        ...(profile?.avatarUrl ? {avatar_url: profile.avatarUrl} : {}),
        ...extra,
      },
      ts: Date.now(),
      origin,
    });
    void query;
    // The invite-to-join hop replaces the external autojoin daemon: a bridge
    // inviting the local user into a portal should immediately produce a room
    // the user can read.
    if (
      membership === "invite" &&
      this.#options.autoJoin &&
      this.#isLocalHuman(target) &&
      this.#isAppserviceUser(sender)
    )
      this.#append({
        roomId,
        sender: target,
        type: "m.room.member",
        stateKey: target,
        content: {membership: "join"},
        ts: Date.now(),
      });
    // The invite itself, not the join that followed it.
    return written;
  }

  /**
   * Rewrites a user's membership in every room they are in, so a display name
   * or avatar change is visible where a reader actually looks for it. Only
   * where the profile differs from what the member event carries, so this is a
   * no-op for the rename that changed nothing.
   */
  #republishMembership(userId: string): void {
    const profile = this.#store.profile(userId);
    for (const roomId of this.#store.roomsForUser(userId)) {
      const current = this.#store.stateEvent(roomId, "m.room.member", userId);
      const content = (current?.content ?? {}) as Record<string, unknown>;
      if (!current || typeof content.membership !== "string") continue;
      this.#append({
        roomId,
        sender: userId,
        type: "m.room.member",
        stateKey: userId,
        content: {
          membership: content.membership,
          ...(profile?.displayname ? {displayname: profile.displayname} : {}),
          ...(profile?.avatarUrl ? {avatar_url: profile.avatarUrl} : {}),
        },
        ts: Date.now(),
        origin: this.#store.appservices().find((item) => this.#inNamespace(item, userId))?.id ?? null,
      });
    }
  }

  #isLocalHuman(userId: string): boolean {
    return userId.endsWith(`:${this.serverName}`) && !this.#isAppserviceUser(userId);
  }

  #isAppserviceUser(userId: string): boolean {
    return this.#store
      .appservices()
      .some(
        (appservice) =>
          userId === this.#fullUserId(appservice.senderLocalpart) ||
          this.#inNamespace(appservice, userId),
      );
  }

  /**
   * A transaction key, scoped so replay protection cannot swallow a different
   * write. `txn_key` is globally unique, so keying it on the sender and the
   * client's id alone meant the same id used in a second room deduplicated
   * against the first — the second message was dropped and the first one's id
   * returned — and a redaction reusing a send's id retracted nothing.
   */
  #txnKey(userId: string, roomId: string, kind: string, txnId: string): string {
    return `${userId}:${roomId}:${kind}:${txnId}`;
  }

  /**
   * A client event with the `unsigned` block the bare shape cannot carry,
   * because each field needs the store: why an event was redacted, the state it
   * replaced, and the transaction id that made it — which is how a client
   * matches a send it issued to the event it became, and how a bridge tells a
   * rename from a join without fetching the room's state again.
   */
  #clientEventFor(event: StoredEvent, auth?: AuthContext): Record<string, unknown> {
    const shaped = clientEvent(event);
    const unsigned: Record<string, unknown> = {};
    if (event.redactedBy) {
      const redaction = this.#store.event(event.redactedBy);
      if (redaction) unsigned.redacted_because = clientEvent(redaction);
    }
    if (event.stateKey !== null) {
      const previous = this.#store.previousState(
        event.roomId,
        event.type,
        event.stateKey,
        event.streamOrder,
      );
      if (previous) {
        unsigned.prev_content = previous.content;
        unsigned.replaces_state = previous.eventId;
      }
    }
    // Only ever shown to whoever sent it: a transaction id is that client's
    // own bookkeeping, and the key is composed as sender:room:kind:txnId.
    if (event.txnKey && auth && !auth.appservice && event.sender === auth.userId) {
      // User and room ids both contain colons, so the id cannot be recovered by
      // splitting the key — the prefix it was composed with is stripped instead.
      for (const kind of ["send", "redact"]) {
        const prefix = `${event.sender}:${event.roomId}:${kind}:`;
        if (event.txnKey.startsWith(prefix)) {
          unsigned.transaction_id = event.txnKey.slice(prefix.length);
          break;
        }
      }
    }
    return Object.keys(unsigned).length > 0 ? {...shaped, unsigned} : shaped;
  }

  #append(input: {
    roomId: string;
    sender: string;
    type: string;
    stateKey: string | null;
    content: unknown;
    ts: number;
    txnKey?: string;
    redacts?: string;
    /** The appservice writing this event; see StoredEvent.origin. */
    origin?: string | null;
  }): StoredEvent {
    const event = this.#store.appendEvent({
      eventId: `$${randomBytes(16).toString("base64url")}`,
      roomId: input.roomId,
      sender: input.sender,
      type: input.type,
      stateKey: input.stateKey,
      content: input.content ?? {},
      originServerTs: input.ts,
      redacts: input.redacts ?? null,
      txnKey: input.txnKey ?? null,
      origin: input.origin ?? null,
    });
    // Recording a redaction is not applying one: until the target is actually
    // stripped, a message "deleted" here is still readable from every endpoint
    // that reads it back.
    if (input.redacts && event.redacts) this.#store.redactEvent(input.redacts, event.eventId);
    for (const appservice of this.#store.appservices()) this.#wakePusher(appservice.id);
    if (input.type === "m.room.message" || input.type === "m.sticker")
      this.#options.onActivity?.({
        roomId: input.roomId,
        sender: input.sender,
        senderName: this.#store.profile(input.sender)?.displayname ?? null,
        type: input.type,
        ts: event.originServerTs,
      });
    return event;
  }

  // --- transaction pusher ---

  #wakePusher(appserviceId: string): void {
    // Exactly one loop per appservice, ever: a wake while the loop is busy is
    // recorded rather than spawning a competitor, because two loops racing on
    // one stream position either duplicate or skip deliveries.
    this.#pendingWakes.add(appserviceId);
    const wake = this.#pushWakers.get(appserviceId);
    if (wake) {
      wake();
      return;
    }
    if (this.#pushersActive.has(appserviceId)) return;
    this.#pushersActive.add(appserviceId);
    this.#pushers.set(
      appserviceId,
      this.#pushLoop(appserviceId).finally(() => this.#pushersActive.delete(appserviceId)),
    );
  }

  /**
   * Delivers new events to one bridge as appservice transactions, in order,
   * retrying while the bridge is down. Mirrors a real homeserver's contract:
   * a transaction id is stable across retries so the bridge can deduplicate.
   */
  async #pushLoop(appserviceId: string): Promise<void> {
    while (!this.#closed) {
      this.#pendingWakes.delete(appserviceId);
      const appservice = this.#store.appservices().find((item) => item.id === appserviceId);
      if (!appservice) return;
      const position = this.#store.appservicePosition(appserviceId);
      const events = this.#store.eventsAfter(position, TRANSACTION_BATCH);
      if (events.length === 0) {
        await this.#sleepUntilWoken(appserviceId);
        continue;
      }
      const batch = events.filter((event) => this.#interested(appservice, event));
      if (batch.length > 0) {
        const delivered = await this.#deliver(appservice, batch);
        // Undelivered means the bridge stayed down through every retry; keep
        // the position so the same batch goes out when it returns.
        if (!delivered) continue;
      }
      this.#store.setAppservicePosition(appserviceId, events[events.length - 1].streamOrder);
    }
  }

  async #deliver(appservice: AppserviceRecord, events: StoredEvent[]): Promise<boolean> {
    const txnId = `flareai-${events[0].streamOrder}`;
    for (const delay of [...PUSH_RETRY_MS, null]) {
      if (this.#closed) return false;
      try {
        const result = await this.#fetch(
          `${appservice.url.replace(/\/+$/, "")}/_matrix/app/v1/transactions/${encodeURIComponent(txnId)}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${appservice.hsToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({events: events.map(clientEvent)}),
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (result.ok) return true;
      } catch {
        // Bridge is down or restarting; fall through to the wait below.
      }
      if (delay === null) return false;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return false;
  }

  /** Whether a bridge should hear about an event, by namespace or membership. */
  #interested(appservice: AppserviceRecord, event: StoredEvent): boolean {
    /**
     * Never an event the bridge wrote itself. It already holds the event id
     * from the write's response, and the echo is not harmless: a message the
     * bridge double-puppeted in as the user comes back indistinguishable from
     * the user typing that message here, and the bridge sends it to the
     * network — every backfilled message the user ever sent, re-sent to the
     * person they sent it to.
     */
    if (event.origin === appservice.id) return false;
    /**
     * A timeline event handed to a bridge is a send: the bridge's whole job
     * is to put it on the network. So timeline events are deny-by-default —
     * only ones the user's own client armed this run go out (see
     * #outboundArmed). State still flows: membership, names and avatars are
     * bookkeeping a bridge needs, and transmitting nothing is exactly what it
     * does with them.
     */
    if (event.stateKey === null && !this.#outboundArmed.has(event.eventId)) return false;
    const bot = this.#fullUserId(appservice.senderLocalpart);
    if (event.sender === bot || this.#inNamespace(appservice, event.sender)) return true;
    if (event.stateKey && (event.stateKey === bot || this.#inNamespace(appservice, event.stateKey)))
      return true;
    return this.#store
      .members(event.roomId, "join")
      .some(
        (member) =>
          member.stateKey === bot || this.#inNamespace(appservice, member.stateKey ?? ""),
      );
  }

  #sleepUntilWoken(appserviceId: string): Promise<void> {
    // An event appended while the loop was delivering must not be slept past.
    if (this.#pendingWakes.delete(appserviceId)) return Promise.resolve();
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        if (timer) clearTimeout(timer);
        this.#pushWakers.delete(appserviceId);
        resolve();
      };
      // The timeout is a safety net; the normal wake is an appended event.
      timer = setTimeout(finish, 30_000);
      this.#pushWakers.set(appserviceId, finish);
      if (this.#closed) finish();
    });
  }

  // --- small helpers ---

  #fullUserId(localpart: string): string {
    return `@${localpart}:${this.serverName}`;
  }

  async #body(request: IncomingMessage, raw = false): Promise<unknown> {
    if (request.method === "GET" || request.method === "HEAD") return undefined;
    // Media uploads read the raw stream themselves.
    if (raw) return undefined;
    const contentType = request.headers["content-type"] ?? "";
    // A body sent as anything but JSON was dropped on the floor and the write
    // stored whatever an empty object meant, so the caller was told a broken
    // request had succeeded.
    if (!contentType.includes("application/json") && contentType !== "") return MALFORMED_BODY;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of request) {
      total += (chunk as Buffer).length;
      if (total > MAX_BODY_BYTES) throw new Error("Request body too large");
      chunks.push(chunk as Buffer);
    }
    if (chunks.length === 0) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      // Swallowing this stored a blank message and answered 200, so a client
      // that sent something broken was told it had sent something.
      return MALFORMED_BODY;
    }
  }

  #json(response: ServerResponse, status: number, body: unknown): void {
    const data = JSON.stringify(body);
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
      "Access-Control-Allow-Origin": "*",
    });
    response.end(data);
  }
}

function clientEvent(event: StoredEvent): Record<string, unknown> {
  return {
    event_id: event.eventId,
    room_id: event.roomId,
    sender: event.sender,
    type: event.type,
    origin_server_ts: event.originServerTs,
    content: event.content,
    ...(event.stateKey === null ? {} : {state_key: event.stateKey}),
    ...(event.redacts === null ? {} : {redacts: event.redacts}),
  };
}

/**
 * A pagination token this server issued, as a stream position. Returns null for
 * an absent token and undefined for one that is not a token at all — the caller
 * must refuse that rather than pass NaN to the store, where every comparison is
 * false and the reply is indistinguishable from having reached the end of the
 * room.
 */
function paginationToken(value: string | null): number | null | undefined {
  if (value === null) return null;
  if (!/^t\d+$/.test(value)) return undefined;
  return Number(value.slice(1));
}

/**
 * The wire limit on a single event. MAX_BODY_BYTES bounds a whole request,
 * which is the wrong unit: a bridge that stitches a caption onto a media event
 * can build something no real homeserver would accept, and it would be stored
 * here and rejected the moment it left for anywhere else.
 */
const MAX_EVENT_BYTES = 65_536;

function tooLarge(body: unknown): {errcode: string; error: string} | null {
  const size = Buffer.byteLength(JSON.stringify(body ?? {}), "utf8");
  return size > MAX_EVENT_BYTES
    ? {errcode: "M_TOO_LARGE", error: `Event is ${size} bytes; the limit is ${MAX_EVENT_BYTES}`}
    : null;
}

function boundedNumber(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, Math.floor(parsed));
}

/**
 * Why a proxied bridge request failed, in terms that mean something on screen.
 * `fetch` reports every transport failure as the word "fetch failed" and hides
 * the actual cause underneath, so a bridge that simply is not running reached
 * the user as "The bridge is not responding: fetch failed".
 */
export function unreachableBridge(error: unknown): string {
  const code = (error as {cause?: NodeJS.ErrnoException})?.cause?.code;
  if (code === "ECONNREFUSED") return "The bridge is not running.";
  if (code === "ETIMEDOUT" || (error as Error)?.name === "TimeoutError")
    return "The bridge did not answer in time.";
  const detail = error instanceof Error ? error.message : String(error);
  return detail && detail !== "fetch failed"
    ? `The bridge is not responding: ${detail}`
    : "The bridge is not responding.";
}
