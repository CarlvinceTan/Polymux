import {readFile} from "node:fs/promises";
import {createHmac} from "node:crypto";
import path from "node:path";
import type {
  CommsBridgeAccountDto,
  CommsBridgeDto,
  CommsLoginCookieFieldDto,
  CommsLoginFieldDto,
  CommsLoginFlowDto,
  CommsLoginStepDto,
  CommsPlatform,
} from "@flareai/protocol";

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
        "Could not read the homeserver's registration secret, so FlareAI cannot create its own account. Sign in with an existing account instead.",
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
          initial_device_display_name: "FlareAI",
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
          initial_device_display_name: "FlareAI",
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

  /** Joined rooms with their display names and the platform they came from. */
  async rooms(): Promise<Array<{roomId: string; name: string; platform: string}>> {
    const joined = await this.#client<{joined_rooms?: string[]}>(
      "/_matrix/client/v3/joined_rooms",
    );
    return Promise.all(
      (joined.joined_rooms ?? []).map(async (roomId) => ({
        roomId,
        name: await this.#roomName(roomId),
        platform: await this.#roomPlatform(roomId),
      })),
    );
  }

  async messages(
    roomId: string,
    limit: number,
    before?: string,
  ): Promise<{nextBefore: string | null; messages: MatrixMessage[]}> {
    const params = new URLSearchParams({dir: "b", limit: String(limit)});
    if (before) params.set("from", before);
    const result = await this.#client<{end?: string; chunk?: RawEvent[]}>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?${params}`,
    );
    return {
      nextBefore: result.end ?? null,
      messages: (result.chunk ?? []).filter(isMessage).map(toMessage),
    };
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

  async send(roomId: string, body: string): Promise<string> {
    // A transaction id makes the send idempotent if the request is retried.
    const txnId = `flareai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await this.#client<{event_id?: string}>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
      {method: "PUT", body: {msgtype: "m.text", body}},
    );
    return result.event_id ?? "";
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
    options: {method?: "GET" | "POST" | "PUT"; body?: unknown} = {},
  ): Promise<T> {
    const {matrixToken} = this.#auth();
    if (!matrixToken)
      throw new Error(
        "FlareAI is not signed in to the Matrix hub. Open Settings → Communications to connect it.",
      );
    return this.#json<T>(`${this.#homeserverUrl}${endpoint}`, {
      method: options.method,
      body: options.body,
      headers: {Authorization: `Bearer ${matrixToken}`},
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
        error:
          "This platform runs through a local relay on this Mac rather than a hosted login, so there is nothing to link here.",
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
        // The legacy API can take a token but cannot drive a QR scan over
        // plain HTTP, so offer only what actually works from here.
        flows: legacy.loggedIn
          ? []
          : [
              {
                id: "token",
                name: "Access token",
                description: `Paste a ${name} account token to link it`,
              },
            ],
        managementRoomHint: legacy.managementRoom,
        error: null,
      };
    }
    if (whoami instanceof Error)
      return {...base, state: "unreachable", error: whoami.message};

    const accounts = (whoami.logins ?? []).map(toAccount);
    // whoami already carries the flows, so no second round-trip is needed.
    return {
      ...base,
      state: bridgeState(accounts),
      accounts,
      flows: (whoami.login_flows ?? []).map(toFlow),
      managementRoomHint: whoami.management_room || null,
      error: accounts.find((account) => account.error)?.error ?? null,
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
          `Could not read ${route}'s provisioning secret from the hub, and FlareAI holds no Matrix token for this bridge.`,
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
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
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

export interface MatrixMessage {
  eventId: string;
  roomId: string;
  roomName: string;
  platform: string;
  sender: string;
  body: string;
  sentAt: string;
}

interface RawEvent {
  event_id?: string;
  room_id?: string;
  sender?: string;
  type?: string;
  origin_server_ts?: number;
  content?: {body?: string; msgtype?: string};
}

function isMessage(event: RawEvent | undefined): event is RawEvent {
  return event?.type === "m.room.message" && typeof event.content?.body === "string";
}

function toMessage(event: RawEvent): MatrixMessage {
  return {
    eventId: event.event_id ?? "",
    roomId: event.room_id ?? "",
    roomName: "",
    platform: "",
    sender: event.sender ?? "",
    body: event.content?.body ?? "",
    sentAt: new Date(event.origin_server_ts ?? 0).toISOString(),
  };
}

/**
 * Bridge ghosts are named `@<platform>_<remote id>:<server>`, which is the only
 * reliable signal of which network a room's traffic came from.
 */
function platformFromSender(sender: string): string | null {
  const localpart = sender.startsWith("@") ? sender.slice(1) : sender;
  const prefix = localpart.split("_")[0]?.toLowerCase();
  const known = [
    "whatsapp",
    "telegram",
    "discord",
    "messenger",
    "instagram",
    "linkedin",
    "imessage",
    "wechat",
  ];
  if (prefix && known.includes(prefix)) return prefix;
  // Meta's bridges use `fb`/`ig` prefixes in some deployments.
  if (prefix === "fb") return "messenger";
  if (prefix === "ig") return "instagram";
  if (prefix === "signal") return "signal";
  return null;
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

function toFlow(flow: RawFlow): CommsLoginFlowDto {
  return {
    id: flow.id ?? "",
    name: flow.name ?? flow.id ?? "Sign in",
    description: flow.description ?? "",
  };
}

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
    case "LOGGED_OUT":
      return "bad-credentials";
    default:
      return event ? "unknown" : "connected";
  }
}

function bridgeState(accounts: CommsBridgeAccountDto[]): CommsBridgeDto["state"] {
  if (accounts.length === 0) return "logged-out";
  if (accounts.some((account) => account.state === "connected")) return "connected";
  if (accounts.some((account) => account.state === "connecting")) return "connecting";
  if (accounts.some((account) => account.state === "bad-credentials")) return "error";
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
