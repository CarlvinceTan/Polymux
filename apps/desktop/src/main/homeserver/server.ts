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
  onActivity?: (activity: {roomId: string; sender: string; type: string}) => void;
  fetch?: typeof globalThis.fetch;
}

interface AuthContext {
  userId: string;
  appservice: AppserviceRecord | null;
}

const MAX_BODY_BYTES = 64 * 1024 * 1024;
const TRANSACTION_BATCH = 100;
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
        },
      });

    const body = await this.#body(request);
    const query = url.searchParams;

    if (method === "POST" && rest[0] === "v3" && rest[1] === "register")
      return this.#register(response, body, this.#tokenFrom(request, query));
    if (method === "POST" && rest[0] === "v3" && rest[1] === "login")
      return this.#json(response, 403, {
        errcode: "M_FORBIDDEN",
        error: "Password login is not supported on the embedded hub; FlareAI holds its token directly.",
      });

    const auth = this.#authenticate(request, query);
    if (!auth)
      return this.#json(response, 401, {errcode: "M_MISSING_TOKEN", error: "Missing or unknown token"});

    if (method === "POST" && rest[0] === "v3" && rest[1] === "logout") {
      const token = this.#tokenFrom(request, query);
      if (token) this.#store.deleteToken(token);
      return this.#json(response, 200, {});
    }
    if (method === "GET" && rest[0] === "v3" && rest[1] === "account" && rest[2] === "whoami")
      return this.#json(response, 200, {user_id: auth.userId});
    if (method === "GET" && rest[0] === "v3" && rest[1] === "capabilities")
      return this.#json(response, 200, {capabilities: {"m.room_versions": {default: "11", available: {"11": "stable"}}}});

    if (rest[0] === "v1" && rest[1] === "appservice" && rest[3] === "ping" && method === "POST")
      return this.#appservicePing(response, auth, rest[2], body);

    if (rest[0] === "v3" && rest[1] === "profile") return this.#profile(response, method, rest, body);

    if (method === "GET" && rest[0] === "v3" && rest[1] === "sync")
      return this.#sync(response, auth);

    if (method === "POST" && rest[0] === "v3" && rest[1] === "createRoom")
      return this.#createRoom(response, auth, body, query);

    if (rest[0] === "v3" && rest[1] === "rooms" && rest[2])
      return this.#roomRoute(response, auth, method, rest[2], rest.slice(3), body, query);

    if (method === "GET" && rest[0] === "v3" && rest[1] === "joined_rooms")
      return this.#json(response, 200, {joined_rooms: this.#store.roomsForUser(auth.userId)});

    if (method === "POST" && rest[0] === "v3" && rest[1] === "join" && rest[2]) {
      const roomId = rest[2].startsWith("#") ? this.#store.roomForAlias(rest[2]) : rest[2];
      if (!roomId || !this.#store.roomExists(roomId))
        return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "Unknown room"});
      this.#membershipEvent(roomId, auth.userId, auth.userId, "join", query);
      return this.#json(response, 200, {room_id: roomId});
    }

    if (method === "POST" && rest[0] === "v3" && rest[1] === "search")
      return this.#search(response, auth, body);
    if (method === "GET" && rest[0] === "v3" && rest[1] === "notifications")
      return this.#notifications(response, auth, query);

    if (rest[0] === "v3" && rest[1] === "user" && rest[2])
      return this.#accountData(response, auth, method, rest.slice(2), body);

    if (rest[0] === "v3" && rest[1] === "directory" && rest[2] === "room" && rest[3]) {
      if (method === "PUT") {
        this.#store.setAlias(rest[3], (body as {room_id?: string}).room_id ?? "");
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

  #profile(response: ServerResponse, method: string, rest: string[], body: unknown): void {
    const userId = rest[2];
    const field = rest[3] as "displayname" | "avatar_url" | undefined;
    if (method === "PUT" && (field === "displayname" || field === "avatar_url")) {
      const value = (body as Record<string, unknown>)[field];
      this.#store.setProfile(userId, field, typeof value === "string" ? value : null);
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
    };
    const roomId = `!${randomBytes(12).toString("base64url")}:${this.serverName}`;
    this.#store.createRoom(roomId, auth.userId);
    const ts = this.#timestamp(auth, query);
    const append = (type: string, stateKey: string, content: unknown): StoredEvent =>
      this.#append({roomId, sender: auth.userId, type, stateKey, content, ts});

    append("m.room.create", "", {
      ...input.creation_content,
      creator: auth.userId,
      room_version: "11",
    });
    append("m.room.member", auth.userId, {membership: "join"});
    append("m.room.power_levels", "", {
      users: {[auth.userId]: 100},
      users_default: 0,
      events_default: 0,
      state_default: 50,
      ...input.power_level_content_override,
    });
    append("m.room.join_rules", "", {
      join_rule: input.preset === "public_chat" ? "public" : "invite",
    });
    for (const state of input.initial_state ?? [])
      append(state.type, state.state_key ?? "", state.content);
    if (input.name) append("m.room.name", "", {name: input.name});
    if (input.topic) append("m.room.topic", "", {topic: input.topic});
    for (const invited of input.invite ?? [])
      this.#membershipEvent(roomId, auth.userId, invited, "invite", query, {
        is_direct: input.is_direct === true,
      });
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
    if (!this.#store.roomExists(roomId))
      return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "Unknown room"});

    if (method === "POST" && ["invite", "kick", "ban"].includes(rest[0] ?? "")) {
      const target = (body as {user_id?: string}).user_id ?? "";
      const membership = rest[0] === "invite" ? "invite" : "leave";
      this.#membershipEvent(roomId, auth.userId, target, membership, query, {
        ...(rest[0] === "invite" && (body as {is_direct?: boolean}).is_direct ? {is_direct: true} : {}),
      });
      return this.#json(response, 200, {});
    }
    if (method === "POST" && rest[0] === "join") {
      this.#membershipEvent(roomId, auth.userId, auth.userId, "join", query);
      return this.#json(response, 200, {room_id: roomId});
    }
    if (method === "POST" && rest[0] === "leave") {
      this.#membershipEvent(roomId, auth.userId, auth.userId, "leave", query);
      return this.#json(response, 200, {});
    }
    if (method === "POST" && rest[0] === "forget") return this.#json(response, 200, {});

    if (method === "PUT" && rest[0] === "send" && rest[1] && rest[2] !== undefined) {
      const event = this.#append({
        roomId,
        sender: auth.userId,
        type: rest[1],
        stateKey: null,
        content: body,
        ts: this.#timestamp(auth, query),
        txnKey: `${auth.userId}:${rest[2]}`,
      });
      return this.#json(response, 200, {event_id: event.eventId});
    }
    if (method === "PUT" && rest[0] === "redact" && rest[1] && rest[2] !== undefined) {
      const event = this.#append({
        roomId,
        sender: auth.userId,
        type: "m.room.redaction",
        stateKey: null,
        content: body ?? {},
        ts: this.#timestamp(auth, query),
        txnKey: `${auth.userId}:${rest[2]}`,
        redacts: rest[1],
      });
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
        this.#membershipEvent(roomId, auth.userId, rest[2], membership, query, extra);
        const event = this.#store.stateEvent(roomId, "m.room.member", rest[2]);
        return this.#json(response, 200, {event_id: event?.eventId ?? ""});
      }
      if (method === "PUT" && rest[1]) {
        const event = this.#append({
          roomId,
          sender: auth.userId,
          type: rest[1],
          stateKey: rest[2] ?? "",
          content: body,
          ts: this.#timestamp(auth, query),
        });
        return this.#json(response, 200, {event_id: event.eventId});
      }
      if (method === "GET" && rest[1]) {
        const event = this.#store.stateEvent(roomId, rest[1], rest[2] ?? "");
        if (!event) return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "No such state"});
        // mautrix's FullStateEvent asks for the whole event with ?format=event.
        if (query.get("format") === "event") return this.#json(response, 200, clientEvent(event));
        return this.#json(response, 200, event.content);
      }
      if (method === "GET")
        return this.#json(response, 200, this.#store.fullState(roomId).map(clientEvent));
    }
    if (method === "GET" && rest[0] === "event" && rest[1]) {
      const event = this.#store.event(rest[1]);
      if (!event || event.roomId !== roomId)
        return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "Unknown event"});
      return this.#json(response, 200, clientEvent(event));
    }
    if (method === "GET" && rest[0] === "messages") {
      const dir = query.get("dir") === "f" ? "f" : "b";
      const from = query.get("from");
      const {events, end} = this.#store.messages(roomId, {
        dir,
        from: from ? Number(from.replace(/^t/, "")) : undefined,
        limit: boundedNumber(query.get("limit"), 30, 1000),
      });
      return this.#json(response, 200, {
        chunk: events.map(clientEvent),
        start: from ?? "t0",
        ...(end === null ? {} : {end: `t${end}`}),
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
    if (method === "GET" && rest[0] === "members")
      return this.#json(response, 200, {chunk: this.#store.members(roomId).map(clientEvent)});
    if (method === "PUT" && rest[0] === "typing") return this.#json(response, 200, {});
    if (method === "POST" && rest[0] === "receipt" && rest[2]) {
      const event = this.#store.event(rest[2]);
      if (event) this.#store.setReceipt(auth.userId, roomId, event.streamOrder);
      return this.#json(response, 200, {});
    }
    if (method === "POST" && rest[0] === "read_markers") {
      const marker = (body as Record<string, string>)["m.fully_read"] ?? (body as Record<string, string>)["m.read"];
      const event = marker ? this.#store.event(marker) : null;
      if (event) this.#store.setReceipt(auth.userId, roomId, event.streamOrder);
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
    if (method === "PUT") {
      this.#store.setAccountData(auth.userId, roomId, type, body);
      return this.#json(response, 200, {});
    }
    const content = this.#store.accountData(auth.userId, roomId, type);
    if (content === null)
      return this.#json(response, 404, {errcode: "M_NOT_FOUND", error: "No account data"});
    return this.#json(response, 200, content);
  }

  #search(response: ServerResponse, auth: AuthContext, body: unknown): void {
    const criteria = (body as {search_categories?: {room_events?: {search_term?: string; filter?: {limit?: number}}}})
      ?.search_categories?.room_events;
    const events = this.#store.searchMessages(
      auth.userId,
      criteria?.search_term ?? "",
      criteria?.filter?.limit ?? 30,
    );
    return this.#json(response, 200, {
      search_categories: {
        room_events: {
          count: events.length,
          results: events.map((event) => ({rank: 1, result: clientEvent(event)})),
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
      const timeline = this.#store.messages(roomId, {limit: 1, dir: "b"});
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
        contentType: request.headers["content-type"] ?? "application/octet-stream",
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

  // --- event machinery ---

  #timestamp(auth: AuthContext, query: URLSearchParams): number {
    // MSC3316: appservices may massage timestamps, which bridges use to give
    // backfilled history its original times.
    const ts = query.get("ts");
    if (auth.appservice && ts && /^\d+$/.test(ts)) return Number(ts);
    return Date.now();
  }

  #membershipEvent(
    roomId: string,
    sender: string,
    target: string,
    membership: string,
    query: URLSearchParams,
    extra: Record<string, unknown> = {},
  ): void {
    this.#store.ensureUser(target);
    const profile = this.#store.profile(target);
    this.#append({
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

  #append(input: {
    roomId: string;
    sender: string;
    type: string;
    stateKey: string | null;
    content: unknown;
    ts: number;
    txnKey?: string;
    redacts?: string;
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
    });
    for (const appservice of this.#store.appservices()) this.#wakePusher(appservice.id);
    if (input.type === "m.room.message" || input.type === "m.sticker")
      this.#options.onActivity?.({roomId: input.roomId, sender: input.sender, type: input.type});
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

  async #body(request: IncomingMessage): Promise<unknown> {
    if (request.method === "GET" || request.method === "HEAD") return undefined;
    // Media uploads read the raw stream themselves.
    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.includes("application/json") && contentType !== "") return undefined;
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
      return {};
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
