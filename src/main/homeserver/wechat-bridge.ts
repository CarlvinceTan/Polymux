import {execFile, spawn, type ChildProcess} from "node:child_process";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {createServer, type Server} from "node:http";
import {access, mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {homedir, tmpdir} from "node:os";
import {promisify} from "node:util";
import path from "node:path";
import type {Homeserver} from "./server.js";

/**
 * WeChat, bridged into the embedded homeserver.
 *
 * Every other network here is a mautrix binary FlareAI supervises. WeChat has
 * none — upstream's only Matrix bridge needs a Windows agent doing DLL
 * injection, which cannot run on a Mac. What does work on macOS is a local
 * relay driving the WeChat desktop app, exposing the account over loopback
 * HTTP with an SSE stream of new messages.
 *
 * So this is the missing half: an application service that owns portal rooms
 * and puppets on FlareAI's own homeserver, and carries messages between them
 * and that relay. It runs in-process rather than as a spawned binary, because
 * there is no binary to spawn.
 */

const run: (
  file: string,
  args: string[],
  options: {timeout: number},
) => Promise<{stdout: string; stderr: string}> = promisify(execFile);

/**
 * Where `wechat-use` installs. Media is the one thing the loopback relay
 * cannot serve — WeChat stores images encrypted and hands out a CDN blob
 * descriptor rather than a url — so the bytes come from the CLI, which owns
 * the key derivation.
 */
const CLI_PATHS = [
  process.env.FLAREAI_WECHAT_CLI,
  `${homedir()}/.local/bin/wechat-use`,
  "/opt/homebrew/bin/wechat-use",
  "/usr/local/bin/wechat-use",
].filter((entry): entry is string => Boolean(entry));
/** Extraction can fall back to a CDN replay, so it gets room to finish. */
const MEDIA_TIMEOUT_MS = 30_000;
/** Keychain item the relay reads its own bearer from. */
const RELAY_TOKEN_SERVICE = "Matrix Hub WeChat Bridge Token";
/**
 * The relay's own binaries. `wechatd` is the daemon that talks to the WeChat
 * app; `wechat-bridge` is the loopback HTTP/SSE service over it. Both are
 * FlareAI's plumbing: nobody using the app should have to know they exist, so
 * they are started here rather than named in an instruction.
 */
const RELAY_BINARIES = ["wechat-bridge", "wechat-use"] as const;
/**
 * Where to look, in order. The copy shipped inside the app comes first — an
 * install has to work on a Mac that has never had these tools, and anything
 * resolved from the user's own PATH is a dependency on that one machine. The
 * rest are fallbacks for a developer running from a checkout.
 */
export const WECHAT_FALLBACK_DIRECTORIES = [
  process.env.FLAREAI_WECHAT_BIN,
  `${homedir()}/.local/bin`,
  "/opt/homebrew/bin",
  "/usr/local/bin",
].filter((entry): entry is string => Boolean(entry));
/** How long a freshly spawned relay has to bind its port. */
const RELAY_START_TIMEOUT_MS = 15_000;

/** Where the relay listens, unless told otherwise. */
const DEFAULT_RELAY = "http://127.0.0.1:18400";
/** How long a relay has to answer before it counts as absent. */
const PROBE_TIMEOUT_MS = 1_500;
const RECONNECT_MS = [1_000, 2_000, 5_000, 15_000, 30_000];
/** Remote ids are remembered this long, so a replayed stream is not re-posted. */
const SEEN_TTL_MS = 30 * 24 * 3_600 * 1_000;
/** How long an outbound message may wait for its own echo to come back. */
const ECHO_TTL_MS = 5 * 60 * 1_000;

export interface WeChatBridgeOptions {
  homeserver: Homeserver;
  /** Where registration and state are kept, i.e. the hub's bridges directory. */
  directory: string;
  relayUrl?: string;
  /**
   * Bearer the relay requires. Omitted means "find it": the relay is usually
   * started with a token out of the login keychain, and only `/health` is
   * public, so a bridge without it connects and then fails every real call.
   */
  relayToken?: string | null;
  log?: (message: string) => void;
  fetch?: typeof globalThis.fetch;
  /**
   * Where to look for the relay's binaries, highest priority first. The app
   * passes its own bundled copy ahead of anything on the machine, so a fresh
   * install does not depend on what the developer happened to have installed.
   * A test passes an empty list: supervision spawns real processes and talks
   * to the WeChat app, which a test must never do.
   */
  binaryDirectories?: string[];
}

/** A message as the relay's `hermes` shape presents it. */
interface RelayMessage {
  messageId?: string | number;
  chatId?: string;
  chatName?: string;
  display_name?: string;
  senderId?: string;
  senderName?: string;
  body?: string;
  timestamp?: number;
  isGroup?: boolean;
  fromSelf?: boolean;
  hasMedia?: boolean;
  mediaType?: string;
  messageKind?: string;
}

interface BridgeState {
  /** Portal room per WeChat conversation, and the reverse for outbound. */
  rooms: Record<string, {roomId: string; isGroup: boolean}>;
  roomToChat: Record<string, string>;
  joinedVirtual: Record<string, Record<string, boolean>>;
  seenRemote: Record<string, number>;
  seenTransactions: Record<string, number>;
  /**
   * Messages this bridge sent outward, waiting to be recognised when WeChat
   * streams them back. Without this every sent message appears twice.
   */
  outboundEchoes: Array<{chatId: string; body: string; timestamp: number}>;
  lastRemoteTimestamp: number;
}

interface Registration {
  asToken: string;
  hsToken: string;
  port: number;
}

function emptyState(): BridgeState {
  return {
    rooms: {},
    roomToChat: {},
    joinedVirtual: {},
    seenRemote: {},
    seenTransactions: {},
    outboundEchoes: [],
    lastRemoteTimestamp: Math.floor(Date.now() / 1000) - 60,
  };
}

export class WeChatBridge {
  readonly #options: Required<Pick<WeChatBridgeOptions, "relayUrl">> & WeChatBridgeOptions;
  readonly #log: (message: string) => void;
  readonly #fetch: typeof globalThis.fetch;
  #state: BridgeState = emptyState();
  #registration: Registration | null = null;
  #server: Server | null = null;
  #stopped = false;
  /** Aborts the event stream on close; a `for await` on it never ends by itself. */
  #streaming: AbortController | null = null;
  #token: string | null = null;
  /** The relay we started, if we were the one to start it. */
  #relayProcess: ChildProcess | null = null;
  /** Whose portal rooms these are. Known only once FlareAI has its account. */
  #owner = "";
  #saving: NodeJS.Timeout | null = null;

  constructor(options: WeChatBridgeOptions) {
    this.#options = {...options, relayUrl: (options.relayUrl ?? DEFAULT_RELAY).replace(/\/+$/, "")};
    this.#log = options.log ?? ((): undefined => undefined);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  get botId(): string {
    return `@wechatbot:${this.#options.homeserver.serverName}`;
  }

  /**
   * Brings the bridge up if the relay is there. A Mac without it is the
   * ordinary case, not a failure: nothing is registered, and the platform
   * reports itself unavailable rather than pretending to be linked.
   */
  async start(owner: string): Promise<boolean> {
    // Asked for every time the platform's status is read, so it has to be
    // cheap and repeatable: already up is the answer, not a second bridge.
    if (this.#server) return true;
    if (!owner) return false;
    this.#owner = owner;
    await this.#resolveToken();
    // Start the relay ourselves if it is not already up. Its absence is a
    // detail of how WeChat is reached, not something to hand back to the user
    // as a chore — the only thing they can actually fix is WeChat itself.
    if (!(await this.#relayHealthy()) && !(await this.#startRelay())) {
      this.#log("[wechat] no local relay on this Mac; WeChat stays unlinked.");
      return false;
    }
    await this.#load();
    const registration = await this.#registration_();
    await this.#listen(registration);
    this.#options.homeserver.registerAppservice({
      id: "wechat",
      asToken: registration.asToken,
      hsToken: registration.hsToken,
      url: `http://127.0.0.1:${registration.port}`,
      senderLocalpart: "wechatbot",
      userNamespaces: [
        `@wechatbot:${this.#escapedServer()}`,
        `@wechat_.*:${this.#escapedServer()}`,
      ],
    });
    await this.#ensureVirtualUser(this.botId, "WeChat");
    // Both left running rather than awaited. Importing unread history can take
    // a while — an image whose key is not in WeChat's heap costs a CDN round
    // trip before it gives up — and the caller of this is a status read, which
    // must not sit behind it. Rooms appear as they are imported.
    void this.#backfill().catch((error: unknown) =>
      this.#log(`[wechat] initial import delayed: ${message(error)}`),
    );
    void this.#consume();
    return true;
  }

  async close(): Promise<void> {
    this.#stopped = true;
    this.#streaming?.abort();
    // Only the relay we started; one that was already running belongs to
    // whoever started it and outlives us.
    this.#relayProcess?.kill();
    await this.#flush();
    await new Promise<void>((resolve) => {
      if (!this.#server) return resolve();
      this.#server.close(() => resolve());
    });
  }

  #escapedServer(): string {
    return this.#options.homeserver.serverName.replace(/\./g, "\\.");
  }

  /**
   * Whether the relay is both up and willing to talk to us. `/health` is
   * public, so it alone would call an unusable relay healthy and leave the
   * platform claiming to be linked while every read came back 401.
   */
  async #relayHealthy(): Promise<boolean> {
    const health = await this.#relay<{status?: string}>("/health").catch((): null => null);
    if (health?.status !== "connected") return false;
    const authorized = await this.#relay("/unread").catch((): null => null);
    if (authorized === null) {
      this.#log("[wechat] the relay is running but refused this token.");
      return false;
    }
    return true;
  }

  /** The first of a set of binaries that exists on this Mac. */
  async #binary(name: string): Promise<string | null> {
    for (const directory of this.#options.binaryDirectories ?? WECHAT_FALLBACK_DIRECTORIES) {
      const candidate = path.join(directory, name);
      const found = await access(candidate)
        .then(() => true)
        .catch(() => false);
      if (found) return candidate;
    }
    return null;
  }

  /**
   * Brings the relay up and waits for it to answer. Returns false when there
   * is nothing to start, which is the ordinary case on a Mac that has never
   * had these tools — not an error worth reporting anywhere but the log.
   */
  async #startRelay(): Promise<boolean> {
    const [bridge, cli] = await Promise.all(RELAY_BINARIES.map((name) => this.#binary(name)));
    if (!bridge) {
      this.#log("[wechat] no relay binary on this Mac; WeChat stays unlinked.");
      return false;
    }
    // The daemon underneath it has to be up first, and it is the piece that
    // actually attaches to WeChat, so a failure here is usually WeChat itself
    // being closed or signed out.
    if (cli)
      await run(cli, ["daemon", "start"], {timeout: RELAY_START_TIMEOUT_MS}).catch(
        (): null => null,
      );
    // Our own token when we are the one starting it: an unauthenticated
    // loopback port is one any process on this Mac could read messages from.
    this.#token ??= randomBytes(24).toString("base64url");
    const child = spawn(bridge, ["--shape", "hermes", "--port", String(this.#relayPort())], {
      env: {...process.env, WECHAT_BRIDGE_BEARER: this.#token},
      stdio: "ignore",
      detached: false,
    });
    child.on("error", (error) => this.#log(`[wechat] relay failed to start: ${error.message}`));
    this.#relayProcess = child;
    const deadline = Date.now() + RELAY_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.#relayHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    this.#log("[wechat] the relay did not come up; is WeChat open and signed in?");
    return false;
  }

  #relayPort(): number {
    return Number(new URL(this.#options.relayUrl).port || 18400);
  }

  /**
   * Tokens are minted once and kept, because a new pair on every launch would
   * orphan the rooms the previous one created.
   */
  async #registration_(): Promise<Registration> {
    if (this.#registration) return this.#registration;
    const file = path.join(this.#options.directory, "wechat", "registration.json");
    await mkdir(path.dirname(file), {recursive: true});
    const existing = await readFile(file, "utf8")
      .then((raw) => JSON.parse(raw) as Registration)
      .catch((): null => null);
    const registration = existing ?? {
      asToken: randomBytes(32).toString("base64url"),
      hsToken: randomBytes(32).toString("base64url"),
      // Zero asks the OS for a free port; the chosen one is recorded below.
      port: 0,
    };
    this.#registration = registration;
    return registration;
  }

  /** The transaction endpoint the homeserver pushes events to. */
  async #listen(registration: Registration): Promise<void> {
    const server = createServer((request, response) => {
      void this.#handle(request, response, registration);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(registration.port, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address && typeof address === "object") registration.port = address.port;
    this.#server = server;
    await writeFile(
      path.join(this.#options.directory, "wechat", "registration.json"),
      `${JSON.stringify(registration, null, 2)}\n`,
      {mode: 0o600},
    );
  }

  async #handle(
    request: Parameters<Parameters<typeof createServer>[1]>[0],
    response: Parameters<Parameters<typeof createServer>[1]>[1],
    registration: Registration,
  ): Promise<void> {
    const reply = (status: number, body: unknown): void => {
      const text = JSON.stringify(body);
      response.writeHead(status, {"Content-Type": "application/json"});
      response.end(text);
    };
    if (request.headers.authorization !== `Bearer ${registration.hsToken}`)
      return reply(403, {errcode: "M_FORBIDDEN"});
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const transaction = url.pathname.match(/transactions\/([^/]+)$/);
    if (request.method === "PUT" && transaction) {
      const id = decodeURIComponent(transaction[1]);
      // Transactions are retried on any failure to respond, so the id is what
      // keeps a redelivery from sending the same message to WeChat twice.
      if (!this.#state.seenTransactions[id]) {
        this.#state.seenTransactions[id] = Date.now();
        this.#save();
        const body = await readBody(request).catch((): {events?: unknown[]} => ({}));
        for (const event of (body.events ?? []) as MatrixEvent[])
          await this.#relayOutbound(event).catch((error: unknown) =>
            this.#log(`[wechat] outbound failed: ${message(error)}`),
          );
      }
      return reply(200, {});
    }
    // Everything the homeserver asks about our namespace already exists.
    if (request.method === "GET" && /\/users\//.test(url.pathname)) return reply(200, {});
    if (/\/ping$/.test(url.pathname)) return reply(200, {});
    return reply(404, {errcode: "M_UNRECOGNIZED"});
  }

  // ---- inbound: WeChat to Matrix ------------------------------------------

  async #backfill(): Promise<void> {
    const unread = await this.#relay<RelayChat[] | {rows?: RelayChat[]}>("/unread");
    const chats = Array.isArray(unread) ? unread : (unread.rows ?? []);
    for (const chat of chats) {
      const chatId = String(chat.username ?? chat.chatId ?? "");
      const count = Math.max(0, Number(chat.unread_count ?? chat.unreadCount ?? 0));
      if (!chatId || !count) continue;
      const history = await this.#relay<RelayMessage[] | {rows?: RelayMessage[]}>(
        `/chat/${encodeURIComponent(chatId)}/history?limit=${Math.min(50, count)}`,
      ).catch((): RelayMessage[] => []);
      const messages = (Array.isArray(history) ? history : (history.rows ?? [])).sort(
        (a, b) => Number(a.timestamp) - Number(b.timestamp),
      );
      for (const item of messages)
        await this.#ingest({...item, display_name: chat.display_name}).catch((error: unknown) =>
          this.#log(`[wechat] import failed: ${message(error)}`),
        );
    }
  }

  /** Follows the relay's event stream, reconnecting for as long as we are up. */
  async #consume(): Promise<void> {
    let attempt = 0;
    while (!this.#stopped) {
      try {
        const url = new URL("/messages/stream", this.#options.relayUrl);
        // Without `since` the relay replays its entire history on connect.
        url.searchParams.set("since", String(this.#state.lastRemoteTimestamp));
        this.#streaming = new AbortController();
        const response = await this.#fetch(url, {
          headers: this.#relayHeaders(),
          signal: this.#streaming.signal,
        });
        if (!response.ok || !response.body) throw new Error(`stream returned ${response.status}`);
        attempt = 0;
        for await (const payload of serverSentEvents(response.body))
          await this.#ingest(JSON.parse(payload) as RelayMessage).catch((error: unknown) =>
            this.#log(`[wechat] inbound event failed: ${message(error)}`),
          );
        throw new Error("stream ended");
      } catch (error) {
        if (this.#stopped) return;
        const wait = RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)];
        attempt += 1;
        this.#log(`[wechat] stream unavailable: ${message(error)}; retrying in ${wait}ms`);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  async #ingest(item: RelayMessage): Promise<void> {
    const chatId = String(item.chatId ?? "");
    if (!chatId) return;
    const remoteId = stableId(item);
    if (this.#state.seenRemote[remoteId]) return;

    // Our own send, coming back around. Matched on content rather than id
    // because the relay assigns its own once WeChat accepts it.
    if (item.fromSelf) {
      const body = bodyOf(item);
      const index = this.#state.outboundEchoes.findIndex(
        (echo) =>
          echo.chatId === chatId && echo.body === body && Date.now() - echo.timestamp < ECHO_TTL_MS,
      );
      if (index >= 0) {
        this.#state.outboundEchoes.splice(index, 1);
        this.#state.seenRemote[remoteId] = Date.now();
        this.#save();
        return;
      }
    }

    const roomId = await this.#portal(chatId, item);
    let sender = this.#owner;
    if (!item.fromSelf) {
      sender = this.#puppet(item.senderId || item.senderName || chatId);
      await this.#ensureVirtualUser(sender, item.senderName || "WeChat contact");
      await this.#join(roomId, sender);
    }
    await this.#matrix(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(`wechat-${randomUUID()}`)}`,
      {
        method: "PUT",
        as: sender,
        body: {
          ...(await this.#content(chatId, item)),
          "co.flareai.wechat.remote": true,
        },
      },
    );
    this.#state.seenRemote[remoteId] = Date.now();
    this.#state.lastRemoteTimestamp = Math.max(
      this.#state.lastRemoteTimestamp,
      Number(item.timestamp) || 0,
    );
    this.#save();
  }

  /**
   * What the message becomes in Matrix. An image is carried across as an
   * image; everything else is text, because that is all the relay can give.
   */
  async #content(chatId: string, item: RelayMessage): Promise<Record<string, unknown>> {
    if (item.messageKind === "image" && item.messageId) {
      const media = await this.#image(chatId, String(item.messageId)).catch(
        (error: unknown): null => {
          this.#log(`[wechat] image ${String(item.messageId)} not retrievable: ${message(error)}`);
          return null;
        },
      );
      if (media)
        return {
          msgtype: "m.image",
          body: media.name,
          url: media.uri,
          info: {mimetype: media.mimeType, size: media.size},
        };
    }
    return {
      msgtype: "m.text",
      body: bodyOf(item),
      // Media that could not be brought across is still readable *somewhere* —
      // in WeChat itself — so the placeholder carries the way to open it
      // rather than leaving a bare "[Photo]" with nowhere to go.
      ...(CARRIES_MEDIA.has(item.messageKind ?? "") || item.hasMedia
        ? {"co.flareai.view_in": {app: "WeChat", url: "weixin://"}}
        : {}),
    };
  }

  /**
   * Pulls an image out of WeChat and into the homeserver's media store. The
   * CLI writes it to a file, which is then uploaded and deleted — the copy
   * that matters is the one Matrix now holds.
   */
  async #image(
    chatId: string,
    messageId: string,
  ): Promise<{uri: string; name: string; mimeType: string; size: number} | null> {
    const target = path.join(tmpdir(), `flareai-wechat-${randomBytes(8).toString("hex")}.bin`);
    let extracted: {mime?: string; absolutePath?: string; error?: string} | null = null;
    for (const cli of CLI_PATHS) {
      const result = (await run(
        cli,
        ["image", "get", messageId, "--chat", chatId, "--out", target, "--json"],
        {timeout: MEDIA_TIMEOUT_MS},
      ).catch((): null => null)) as {stdout: string} | null;
      if (result) {
        extracted = JSON.parse(result.stdout) as {
          mime?: string;
          absolutePath?: string;
          error?: string;
        };
        break;
      }
    }
    // The tool reports a refusal in its own payload and still exits zero — an
    // id the message database does not know, most often, since the relay and
    // the store number messages independently.
    if (extracted?.error) throw new Error(extracted.error.split("\n")[0]);
    if (!extracted) return null;
    // Where it says it put the file, not where it was asked to: a decrypt that
    // falls back to the CDN path writes into its own cache instead.
    const file = extracted.absolutePath ?? target;
    const bytes = await readFile(file);
    await rm(file, {force: true}).catch((): undefined => undefined);
    const mimeType = extracted.mime ?? "image/jpeg";
    const registration = await this.#registration_();
    const upload = await this.#fetch(
      new URL(
        `/_matrix/media/v3/upload?filename=${encodeURIComponent(`wechat-${messageId}`)}`,
        this.#options.homeserver.baseUrl,
      ),
      {
        method: "POST",
        headers: {Authorization: `Bearer ${registration.asToken}`, "Content-Type": mimeType},
        body: new Uint8Array(bytes),
      },
    );
    if (!upload.ok) throw new Error(`upload returned ${upload.status}`);
    const {content_uri: uri} = (await upload.json()) as {content_uri: string};
    return {uri, name: `wechat-${messageId}.jpg`, mimeType, size: bytes.length};
  }

  /** The portal room for a conversation, created on first sight of it. */
  async #portal(chatId: string, item: RelayMessage): Promise<string> {
    const known = this.#state.rooms[chatId];
    if (known) return known.roomId;
    const name = String(
      item.chatName || item.display_name || item.senderName || "WeChat",
    ).slice(0, 80);
    const created = await this.#matrix<{room_id: string}>("/_matrix/client/v3/createRoom", {
      method: "POST",
      as: this.botId,
      body: {
        preset: "private_chat",
        visibility: "private",
        name,
        is_direct: !item.isGroup,
        invite: [this.#owner],
        initial_state: [
          {
            // The same state event every mautrix bridge writes, so the rest of
            // FlareAI files these rooms under WeChat by the identical rule it
            // uses for WhatsApp — no WeChat-specific case anywhere upstream.
            type: "m.bridge",
            state_key: `${this.#options.homeserver.serverName}/wechat`,
            content: {
              bridgebot: this.botId,
              protocol: {id: "wechat", displayname: "WeChat"},
              "com.beeper.room_type": item.isGroup ? "group" : "dm",
              channel: {id: createHash("sha256").update(chatId).digest("hex").slice(0, 24)},
            },
          },
        ],
      },
    });
    await this.#matrix(`/_matrix/client/v3/join/${encodeURIComponent(created.room_id)}`, {
      method: "POST",
      as: this.#owner,
      body: {},
    }).catch((): undefined => undefined);
    this.#state.rooms[chatId] = {roomId: created.room_id, isGroup: Boolean(item.isGroup)};
    this.#state.roomToChat[created.room_id] = chatId;
    this.#save();
    return created.room_id;
  }

  /**
   * A stable Matrix id for a WeChat contact. Hashed rather than carried
   * through: a wxid is a real identifier, and a room id is not the place to
   * spend one.
   */
  #puppet(remoteId: string): string {
    const digest = createHash("sha256").update(String(remoteId)).digest("hex").slice(0, 24);
    return `@wechat_${digest}:${this.#options.homeserver.serverName}`;
  }

  async #ensureVirtualUser(userId: string, displayName: string): Promise<void> {
    const profile = `/_matrix/client/v3/profile/${encodeURIComponent(userId)}`;
    const known = await this.#matrix(profile).catch((): null => null);
    if (!known)
      await this.#matrix("/_matrix/client/v3/register", {
        method: "POST",
        body: {
          type: "m.login.application_service",
          username: userId.slice(1).split(":")[0],
        },
      }).catch((): undefined => undefined);
    await this.#matrix(`${profile}/displayname`, {
      method: "PUT",
      as: userId,
      body: {displayname: displayName.slice(0, 100)},
    }).catch((): undefined => undefined);
  }

  async #join(roomId: string, userId: string): Promise<void> {
    this.#state.joinedVirtual[roomId] ??= {};
    if (this.#state.joinedVirtual[roomId][userId]) return;
    const room = encodeURIComponent(roomId);
    await this.#matrix(`/_matrix/client/v3/rooms/${room}/invite`, {
      method: "POST",
      as: this.botId,
      body: {user_id: userId},
    }).catch((): undefined => undefined);
    await this.#matrix(`/_matrix/client/v3/join/${room}`, {
      method: "POST",
      as: userId,
      body: {},
    }).catch((): undefined => undefined);
    this.#state.joinedVirtual[roomId][userId] = true;
    this.#save();
  }

  // ---- outbound: Matrix to WeChat -----------------------------------------

  async #relayOutbound(event: MatrixEvent): Promise<void> {
    if (
      event.type !== "m.room.message" ||
      event.sender !== this.#owner ||
      event.content?.msgtype !== "m.text" ||
      // Anything this bridge itself posted; relaying it back would loop.
      event.content?.["co.flareai.wechat.remote"]
    )
      return;
    const chatId = this.#state.roomToChat[event.room_id ?? ""];
    const body = String(event.content?.body ?? "").trim();
    if (!chatId || !body) return;
    const result = await this.#relay<{success?: boolean; ok?: boolean}>("/send", {
      method: "POST",
      body: {chatId, message: body},
    });
    if (result.success !== true && result.ok !== true)
      throw new Error("the relay did not confirm delivery");
    this.#state.outboundEchoes.push({chatId, body, timestamp: Date.now()});
    this.#save();
  }

  // ---- plumbing ------------------------------------------------------------

  #relayHeaders(): Record<string, string> {
    return this.#token ? {Authorization: `Bearer ${this.#token}`} : {};
  }

  /**
   * The relay's bearer, from the environment or the login keychain. Read once
   * and kept: `security` prompts the first time, and asking again on every
   * reconnect would put that prompt in front of the user repeatedly.
   */
  async #resolveToken(): Promise<void> {
    if (this.#options.relayToken !== undefined) {
      this.#token = this.#options.relayToken;
      return;
    }
    const fromEnvironment = process.env.FLAREAI_WECHAT_RELAY_TOKEN;
    if (fromEnvironment) {
      this.#token = fromEnvironment;
      return;
    }
    const found = await run(
      "/usr/bin/security",
      ["find-generic-password", "-a", process.env.USER ?? "", "-s", RELAY_TOKEN_SERVICE, "-w"],
      {timeout: MEDIA_TIMEOUT_MS},
    ).catch((): null => null);
    this.#token = found ? found.stdout.trim() : null;
  }

  async #relay<T>(
    endpoint: string,
    options: {method?: string; body?: unknown} = {},
  ): Promise<T> {
    const response = await this.#fetch(new URL(endpoint, this.#options.relayUrl), {
      method: options.method ?? "GET",
      headers: {
        ...this.#relayHeaders(),
        ...(options.body === undefined ? {} : {"Content-Type": "application/json"}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 10),
    });
    if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
    return (await response.json()) as T;
  }

  /** A homeserver call as the appservice, optionally masquerading as a puppet. */
  async #matrix<T>(
    endpoint: string,
    options: {method?: string; body?: unknown; as?: string} = {},
  ): Promise<T> {
    const registration = await this.#registration_();
    const url = new URL(endpoint, this.#options.homeserver.baseUrl);
    if (options.as) url.searchParams.set("user_id", options.as);
    const response = await this.#fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${registration.asToken}`,
        ...(options.body === undefined ? {} : {"Content-Type": "application/json"}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
    return (await response.json()) as T;
  }

  async #load(): Promise<void> {
    const file = path.join(this.#options.directory, "wechat", "state.json");
    const stored = await readFile(file, "utf8")
      .then((raw) => JSON.parse(raw) as Partial<BridgeState>)
      .catch((): null => null);
    if (stored) this.#state = {...emptyState(), ...stored};
  }

  /** Debounced, because a busy stream would otherwise write on every event. */
  #save(): void {
    if (this.#saving) return;
    this.#saving = setTimeout(() => {
      this.#saving = null;
      void this.#flush();
    }, 250);
  }

  async #flush(): Promise<void> {
    const now = Date.now();
    // Both maps grow forever otherwise; neither is worth keeping past its use.
    this.#state.seenRemote = Object.fromEntries(
      Object.entries(this.#state.seenRemote).filter(([, at]) => now - at < SEEN_TTL_MS),
    );
    this.#state.seenTransactions = Object.fromEntries(
      Object.entries(this.#state.seenTransactions).filter(([, at]) => now - at < 24 * 3_600_000),
    );
    this.#state.outboundEchoes = this.#state.outboundEchoes.filter(
      (echo) => now - echo.timestamp < ECHO_TTL_MS,
    );
    const file = path.join(this.#options.directory, "wechat", "state.json");
    const temporary = `${file}.tmp`;
    await mkdir(path.dirname(file), {recursive: true}).catch((): undefined => undefined);
    await writeFile(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, {mode: 0o600});
    await rename(temporary, file);
  }
}

interface RelayChat {
  username?: string;
  chatId?: string;
  display_name?: string;
  unread_count?: number;
  unreadCount?: number;
}

interface MatrixEvent {
  type?: string;
  sender?: string;
  room_id?: string;
  content?: {msgtype?: string; body?: string; [key: string]: unknown};
}

/**
 * What a message says, in words. WeChat carries several kinds whose body is
 * markup rather than text — a sticker arrives as an `<emoji>` document — and
 * pasting that into a conversation is worse than saying what it was.
 */
/**
 * Kinds whose content lives outside anything the relay can hand over. A photo
 * is here too: it reaches this list only when decryption failed, since a photo
 * that worked is sent as an image and never reaches the text path.
 */
const CARRIES_MEDIA = new Set(["image", "voice", "video", "file", "emoticon", "location"]);

const KIND_LABELS: Record<string, string> = {
  emoticon: "[Sticker]",
  image: "[Photo]",
  voice: "[Voice message]",
  video: "[Video]",
  file: "[File]",
  location: "[Location]",
  transfer: "[Transfer]",
  redpacket: "[Red packet]",
  card: "[Contact card]",
  music: "[Music]",
  miniprogram: "[Mini program]",
};

function bodyOf(item: RelayMessage): string {
  const kind = item.messageKind ?? "";
  // A link card's body is its headline, which is worth reading; a sticker's is
  // a wall of XML, which is not. So markup is labelled, and text is kept.
  if (KIND_LABELS[kind]) return KIND_LABELS[kind];
  const body = String(item.body ?? "").trim();
  if (body.startsWith("<") && /^<(msg|sysmsg|appmsg)/i.test(body))
    return `[${kind || "Unsupported WeChat message"}]`;
  if (body) return body;
  if (item.hasMedia) return `[${item.mediaType || "Media"}]`;
  return `[${kind || "Unsupported WeChat message"}]`;
}

/**
 * An id for a message that survives a reconnect. The relay only assigns one
 * for messages WeChat has accepted, so anything else is identified by what it
 * is made of.
 */
function stableId(item: RelayMessage): string {
  if (item.messageId) return String(item.messageId);
  return createHash("sha256")
    .update(JSON.stringify([item.chatId, item.senderId, item.timestamp, item.body, item.mediaType]))
    .digest("hex");
}

/** Yields the `data:` payload of each event in an SSE stream. */
async function* serverSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  let lines: string[] = [];
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, {stream: true});
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      // A blank line terminates an event; anything else accumulates.
      if (!line) {
        if (lines.length) {
          yield lines.join("\n");
          lines = [];
        }
      } else if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
    }
  }
}

async function readBody(
  request: Parameters<Parameters<typeof createServer>[1]>[0],
): Promise<{events?: unknown[]}> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 8 * 1024 * 1024) throw new Error("request too large");
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as {events?: unknown[]}) : {};
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
