import {execFile, spawn, type ChildProcess} from "node:child_process";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {createServer, type Server} from "node:http";
import {access, mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {homedir, tmpdir} from "node:os";
import {promisify} from "node:util";
import path from "node:path";
import type {Homeserver} from "./server.js";
import {loadHeadImages} from "./wechat-head-images.js";

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
function cliPaths(): string[] {
  // Read when used rather than when this module loads: an override set after
  // startup — a test's stand-in, a path the user configures later — would
  // otherwise never be seen.
  //
  // An override is exclusive. Trying the next path when it fails means a
  // stand-in that cannot run silently hands the work to the real `wechat-use`
  // on the machine — which is how a test that must never touch WeChat ends up
  // reading someone's actual conversations.
  if (process.env.FLAREAI_WECHAT_CLI) return [process.env.FLAREAI_WECHAT_CLI];
  return [
    process.env.FLAREAI_WECHAT_CLI,
    `${homedir()}/.local/bin/wechat-use`,
    "/opt/homebrew/bin/wechat-use",
    "/usr/local/bin/wechat-use",
  ].filter((entry): entry is string => Boolean(entry));
}
/** Extraction can fall back to a CDN replay, so it gets room to finish. */
const MEDIA_TIMEOUT_MS = 30_000;
/**
 * How long to keep asking for an image WeChat has not decrypted, and how often.
 * The gaps widen because nothing this end can hurry it along: the picture
 * becomes readable when the user opens it in WeChat, which may be in a minute
 * or never. A week is where asking stops being worth the heap scan.
 */
const IMAGE_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const IMAGE_RETRY_WINDOW_MS = 7 * 24 * 60 * 60_000;
const IMAGE_RETRY_SWEEP_MS = 60_000;
/**
 * How often WeChat's own unread counts are re-read and pushed to the
 * homeserver as read receipts. A conversation read on the phone is read
 * everywhere, so the only question is how long the app keeps showing a badge
 * for it.
 */
const READ_SYNC_SWEEP_MS = 30_000;
/**
 * How many recent events per chat are remembered so an unread count can be
 * turned back into "read up to this event". Comfortably past any unread count
 * a chat list reports, and small enough to keep in the state file.
 */
const READ_WINDOW = 64;
const IMAGE_RETRIES_PER_SWEEP = 5;
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
/**
 * How long after the event stream connects its redelivery is still told apart
 * from live traffic. An accepted message needs no such window — the relay's
 * id for it is remembered for a month — but an unaccepted one has none, and
 * two of them may share every field this bridge sees: WeChat timestamps only
 * whole seconds and reports a message once WeChat accepts it. There, a repeat
 * of fields just after a connect is the replay, not a pair of messages.
 */
const REPLAY_GUARD_MS = 30_000;
/**
 * State changes that force a write on their own, ahead of the debounce. A hard
 * kill loses only what sits between two writes, and that is re-delivered at
 * the next connect — so this bounds a crash to a handful of duplicate
 * candidates rather than the whole burst.
 */
const SAVE_EVERY_CHANGES = 16;

/** How long a chat's own-message list is trusted before it is read again. */
const SELF_SENT_TTL_MS = 15_000;
/** How far back that list reaches. Deep enough for an import, not a history. */
const SELF_SENT_WINDOW = 200;
/** A local database read; it either answers quickly or is not worth waiting for. */
const SELF_SENT_TIMEOUT_MS = 5_000;

/** A sticker larger than this is not a sticker; it is not brought across. */
const MAX_STICKER_BYTES = 8 * 1024 * 1024;

/** How much of an already-read conversation to import, so it has a last line. */
const BACKFILL_MIN = 10;

/** Stands in until the relay names a sender, and never replaces a real name. */
const UNKNOWN_SENDER = "WeChat contact";
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
  /**
   * How often to ask again for images WeChat has not decrypted, and how long to
   * wait between attempts on any one of them. Overridable so a test need not
   * sit out a backoff measured in hours.
   */
  imageRetrySweepMs?: number;
  imageRetryDelaysMs?: readonly number[];
  /** How often WeChat's unread counts are re-read and pushed to the
   * homeserver. Overridable for the same reason. */
  readSyncSweepMs?: number;
}

/**
 * A message as the relay's `hermes` shape presents it. The relay is not
 * consistent about case — chats arrive with `unread_count`, messages with
 * `chatId` — so both spellings are declared and `normalise` folds them
 * together. A missed `sender_name` is not a quiet loss: the puppet is keyed on
 * the sender, so everyone in a group collapses into one nameless contact.
 */
interface RelayMessage {
  messageId?: string | number;
  message_id?: string | number;
  chatId?: string;
  chat_id?: string;
  chatName?: string;
  chat_name?: string;
  display_name?: string;
  senderId?: string;
  sender_id?: string;
  senderName?: string;
  sender_name?: string;
  body?: string;
  timestamp?: number;
  isGroup?: boolean;
  is_group?: boolean;
  fromSelf?: boolean;
  from_self?: boolean;
  hasMedia?: boolean;
  has_media?: boolean;
  mediaType?: string;
  media_type?: string;
  messageKind?: string;
  message_kind?: string;
  /**
   * A contact's picture. The relay in use today sends none of these, so the
   * list falls back to an initial; the spellings are the ones WeChat's own
   * store and the tools around it use, so whichever a build supplies is
   * picked up without another change here.
   */
  avatar?: string;
  avatarUrl?: string;
  avatar_url?: string;
  head_img?: string;
  head_img_url?: string;
  small_head_url?: string;
  big_head_url?: string;
}

/** The first usable picture url on a relay payload, whatever it calls it. */
function avatarUrlOf(item: RelayMessage | RelayChat): string | null {
  const candidates = [
    item.avatar,
    item.avatarUrl,
    item.avatar_url,
    item.head_img,
    item.head_img_url,
    item.big_head_url,
    item.small_head_url,
  ];
  const found = candidates.find(
    (value) => typeof value === "string" && /^https?:\/\//i.test(value),
  );
  return found ?? null;
}

/**
 * When the message was sent, in milliseconds. The relay counts in seconds,
 * but not every build does, so a value already large enough to be milliseconds
 * is left alone rather than being multiplied into the year 55000.
 */
function originalTimestamp(item: RelayMessage): number | null {
  const raw = Number(item.timestamp);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw > 1e12 ? raw : raw * 1000);
}

/** The five entities an XML attribute out of WeChat can carry. */
function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function numberAttribute(xml: string, name: string): number | null {
  const raw = Number(new RegExp(`${name}\\s*=\\s*"(\\d+)"`, "i").exec(xml)?.[1]);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * What a picture is, from its first bytes. WeChat's sticker CDN labels
 * everything `application/octet-stream`, and most stickers are animated GIFs,
 * so trusting the header would send them all across as the wrong type.
 */
function imageTypeOf(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]): boolean =>
    signature.every((byte, index) => bytes[index] === byte);
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  // RIFF????WEBP — the format tag sits after the four-byte length.
  if (starts(0x52, 0x49, 0x46, 0x46))
    return String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP" ? "image/webp" : null;
  return null;
}

/** Every field under the camelCase name the rest of the bridge reads. */
function normalise(item: RelayMessage): RelayMessage {
  return {
    ...item,
    messageId: item.messageId ?? item.message_id,
    chatId: item.chatId ?? item.chat_id,
    chatName: item.chatName ?? item.chat_name,
    senderId: item.senderId ?? item.sender_id,
    senderName: item.senderName ?? item.sender_name,
    isGroup: item.isGroup ?? item.is_group,
    fromSelf: item.fromSelf ?? item.from_self,
    hasMedia: item.hasMedia ?? item.has_media,
    mediaType: item.mediaType ?? item.media_type,
    messageKind: item.messageKind ?? item.message_kind,
  };
}

interface BridgeState {
  /** Portal room per WeChat conversation, and the reverse for outbound. */
  rooms: Record<string, {roomId: string; isGroup: boolean}>;
  roomToChat: Record<string, string>;
  joinedVirtual: Record<string, Record<string, boolean>>;
  seenRemote: Record<string, number>;
  /**
   * Fields of messages the relay never got an id for, so a replay that hands
   * one back — at a connect or during an import — is still recognised as one.
   */
  seenFields?: Record<string, number>;
  seenTransactions: Record<string, number>;
  /**
   * Messages this bridge sent outward, waiting to be recognised when WeChat
   * streams them back. Without this every sent message appears twice.
   */
  outboundEchoes: Array<{chatId: string; body: string; timestamp: number}>;
  lastRemoteTimestamp: number;
  /** Contact pictures already uploaded, by WeChat id, so each is sent once. */
  avatarUris?: Record<string, string>;
  /** Rooms and puppets already wearing theirs, so it is not re-set per message. */
  avatarsApplied?: Record<string, boolean>;
  /**
   * Images WeChat would not hand over yet, keyed `chatId:messageId`.
   *
   * WeChat stores an image encrypted and only decrypts it into the running
   * app's heap when someone opens it, so an image that has never been viewed
   * cannot be read at all — `wechat-use` says as much, and its own advice is
   * to open it in WeChat once and retry. The CDN copy expires, so for older
   * pictures viewing is the only route left.
   *
   * One attempt at import therefore fixes a picture as a placeholder forever,
   * even after the user opens it and it becomes readable. These are the ones
   * worth asking about again.
   */
  pendingImages?: Record<string, PendingImage>;
  /**
   * The tail of each portal's timeline, oldest first, so WeChat's unread count
   * for a chat can be turned into the event to mark read: `n` unread means
   * everything before the last `n` of these has been seen. Capped at
   * `READ_WINDOW`.
   */
  recentEvents?: Record<string, string[]>;
  /** The last event a receipt was sent for, per chat, so a steady unread count
   * is not re-posted every sweep. */
  readReceipts?: Record<string, string>;
}

interface PendingImage {
  chatId: string;
  messageId: string;
  /** Where the placeholder landed, so success can edit it into the picture. */
  roomId: string;
  eventId: string;
  sender: string;
  /** WeChat's own send time, so the edit cannot jump to the top of the thread. */
  sentAt: number;
  attempts: number;
  nextAttemptAt: number;
  firstFailedAt: number;
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
    seenFields: {},
    seenTransactions: {},
    outboundEchoes: [],
    avatarUris: {},
    avatarsApplied: {},
    recentEvents: {},
    readReceipts: {},
    lastRemoteTimestamp: Math.floor(Date.now() / 1000) - 60,
  };
}

export class WeChatBridge {
  readonly #options: Required<Pick<WeChatBridgeOptions, "relayUrl">> & WeChatBridgeOptions;
  readonly #log: (message: string) => void;
  readonly #fetch: typeof globalThis.fetch;
  #state: BridgeState = emptyState();
  #registration: Registration | null = null;
  /** Uploaded contact pictures by source url; null means it could not be had. */
  readonly #avatars = new Map<string, string | null>();
  /**
   * The participant number that means "this account", and the timestamps of
   * its own messages per chat. Both come from WeChat's own store; see
   * `#sentByAccount`. `undefined` means not yet calibrated, `null` means the
   * calibration is not available on this machine.
   */
  #selfId: string | null | undefined;
  readonly #selfSent = new Map<string, {at: number; timestamps: Set<number>}>();
  /**
   * WeChat's own picture store, read once per run. Held as the promise rather
   * than the result so a burst of messages arriving together waits on one read
   * instead of starting one each.
   */
  #headImages: Promise<Map<string, Uint8Array>> | null = null;
  #server: Server | null = null;
  #stopped = false;
  /** Aborts the event stream on close; a `for await` on it never ends by itself. */
  #streaming: AbortController | null = null;
  /** The image-retry sweep, so closing the bridge stops it. */
  #imageSweep: ReturnType<typeof setInterval> | null = null;
  /** The read-state sweep, likewise. */
  #readSweep: ReturnType<typeof setInterval> | null = null;
  #token: string | null = null;
  /** The relay we started, if we were the one to start it. */
  #relayProcess: ChildProcess | null = null;
  /** Whose portal rooms these are. Known only once FlareAI has its account. */
  #owner = "";
  /** When the event stream last answered, so its replay is told from live. */
  #streamConnectAt = 0;
  /** True while the import re-pulls history, which replays by fields too. */
  #importing = false;
  /** Changes since the last flush, so a burst does not sit out a crash alone. */
  #unsaved = 0;
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
    // A bridge that was unlinked and is being linked again comes back through
    // here; the flag that ended its loops must not outlive the stop.
    this.#stopped = false;
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
    // Conversations opened before this run have no picture yet; giving them
    // one is independent of the import and runs beside it.
    void this.#syncRoomAvatars().catch((error: unknown) =>
      this.#log(`[wechat] contact pictures delayed: ${message(error)}`),
    );
    void this.#consume();
    /**
     * Unref'd: a timer that keeps asking about pictures must never be the
     * reason a process stays alive, and this one would otherwise hold the app
     * — and every test that starts a bridge — open for a minute at a time.
     */
    this.#imageSweep = setInterval(() => {
      void this.#retryPendingImages().catch((error: unknown) =>
        this.#log(`[wechat] image retry pass failed: ${message(error)}`),
      );
    }, this.#options.imageRetrySweepMs ?? IMAGE_RETRY_SWEEP_MS);
    this.#imageSweep.unref?.();
    // Unref'd for the same reason, and started after the import rather than
    // instead of it: the import seeds the timelines this reads against.
    this.#readSweep = setInterval(() => {
      void this.#syncReadState().catch((error: unknown) =>
        this.#log(`[wechat] read state pass failed: ${message(error)}`),
      );
    }, this.#options.readSyncSweepMs ?? READ_SYNC_SWEEP_MS);
    this.#readSweep.unref?.();
    return true;
  }

  async close(): Promise<void> {
    this.#stopped = true;
    if (this.#imageSweep) clearInterval(this.#imageSweep);
    this.#imageSweep = null;
    if (this.#readSweep) clearInterval(this.#readSweep);
    this.#readSweep = null;
    this.#streaming?.abort();
    // Only the relay we started; one that was already running belongs to
    // whoever started it and outlives us.
    this.#relayProcess?.kill();
    this.#relayProcess = null;
    await this.#flush();
    await new Promise<void>((resolve) => {
      const server = this.#server;
      if (!server) return resolve();
      // Dropped here rather than left behind: `start` reads it as "already
      // up", and a closed server would make relinking a silent no-op.
      this.#server = null;
      server.close(() => resolve());
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

  /**
   * Every conversation the account has, not only the ones with something
   * unread. A chat with nothing waiting is still a chat the user expects to
   * find here, and importing only unread ones left the list a fraction of what
   * WeChat itself shows.
   */
  async #chatList(): Promise<RelayChat[]> {
    // `/chats` is the whole list where the relay offers it; `/unread` is the
    // fallback for a relay that predates it, and is a strict subset.
    const listed = await this.#relay<RelayChat[] | {rows?: RelayChat[]}>("/chats").catch(
      (): null => null,
    );
    const source = listed ?? (await this.#relay<RelayChat[] | {rows?: RelayChat[]}>("/unread"));
    return Array.isArray(source) ? source : (source.rows ?? []);
  }

  async #backfill(): Promise<void> {
    const chats = await this.#chatList();
    // History is replay, whatever its shape: an import that reruns — every
    // start does — must not post a second copy of what the last one carried.
    this.#importing = true;
    try {
      for (const chat of chats) {
        const chatId = String(chat.username ?? chat.chatId ?? "");
        if (!chatId) continue;
        const count = Math.max(0, Number(chat.unread_count ?? chat.unreadCount ?? 0));
        // Unread decides how much to pull, not whether to pull: a read chat
        // still gets a page so it has a room, a name, and a last line.
        const history = await this.#relay<RelayMessage[] | {rows?: RelayMessage[]}>(
          `/chat/${encodeURIComponent(chatId)}/history?limit=${Math.min(50, Math.max(count, BACKFILL_MIN))}`,
        ).catch((): RelayMessage[] => []);
        const messages = (Array.isArray(history) ? history : (history.rows ?? [])).sort(
          (a, b) => Number(a.timestamp) - Number(b.timestamp),
        );
        const face = avatarUrlOf(chat);
        for (const item of messages)
          await this.#ingest({
            ...item,
            display_name: chat.display_name,
            // The chat list knows the conversation's picture even when a single
            // message does not carry one.
            ...(face && !avatarUrlOf(item) ? {avatar: face} : {}),
          }).catch((error: unknown) =>
            this.#log(`[wechat] import failed: ${message(error)}`),
          );
        // Straight after the import, while this chat's tail is exactly what was
        // just written: history imported for a chat with nothing unread is
        // history the user has already read, and without this every one of those
        // messages arrives in the app as new.
        await this.#applyReadState(chatId, count).catch((error: unknown) =>
          this.#log(`[wechat] read state failed: ${message(error)}`),
        );
      }
    } finally {
      this.#importing = false;
    }
  }

  /**
   * Re-reads WeChat's own unread counts and pushes them to the homeserver.
   *
   * This is the half of read state that has nowhere else to come from: a chat
   * read on the phone or in WeChat on the desk leaves no message behind, so
   * nothing arrives on the stream to say so, and the count in the chat list is
   * the only evidence of it. Pulling it on a timer is what keeps the app's
   * badges — and its notifications — agreeing with WeChat itself.
   */
  async #syncReadState(): Promise<void> {
    for (const chat of await this.#chatList()) {
      const chatId = String(chat.username ?? chat.chatId ?? "");
      if (!chatId) continue;
      await this.#applyReadState(
        chatId,
        Math.max(0, Number(chat.unread_count ?? chat.unreadCount ?? 0)),
      ).catch((error: unknown) => this.#log(`[wechat] read state failed: ${message(error)}`));
    }
  }

  /**
   * Marks a portal read up to whatever WeChat still counts as unread. The
   * receipt is sent as the user rather than as a ghost — this server lets a
   * bridge speak for the account it bridges for, which is what makes the count
   * clear in FlareAI and anywhere else reading the same room.
   */
  async #applyReadState(chatId: string, unread: number): Promise<void> {
    const roomId = this.#state.rooms[chatId]?.roomId;
    const timeline = this.#state.recentEvents?.[chatId] ?? [];
    if (!roomId || !timeline.length) return;
    // More unread than we have remembered means the read line sits further
    // back than this window reaches; saying nothing beats moving it forward.
    if (unread >= timeline.length) return;
    const target = timeline[timeline.length - 1 - unread];
    if (!target || this.#state.readReceipts?.[chatId] === target) return;
    await this.#matrix(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(target)}`,
      {method: "POST", as: this.#owner, body: {}},
    );
    this.#state.readReceipts = {...(this.#state.readReceipts ?? {}), [chatId]: target};
    this.#save();
  }

  /** Keeps the tail of a portal's timeline, which is what an unread count is
   * read against. */
  #rememberEvent(chatId: string, eventId: string): void {
    const events = [...(this.#state.recentEvents?.[chatId] ?? []), eventId];
    this.#state.recentEvents = {
      ...(this.#state.recentEvents ?? {}),
      [chatId]: events.slice(-READ_WINDOW),
    };
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
        this.#streamConnectAt = Date.now();
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

  async #ingest(raw: RelayMessage): Promise<void> {
    const item = normalise(raw);
    const chatId = String(item.chatId ?? "");
    if (!chatId) return;
    // An accepted message is identified by the relay's id, remembered for a
    // month. An unaccepted one has none — and its fields can carry no
    // substitute, because two distinct ones may share every field this bridge
    // sees: whole-second timestamps, and nothing arrives until WeChat accepts
    // the second. So its id is per arrival, and its repeats are recognised by
    // the fields, where a replay actually happens: at a connect, or in an
    // import. A live stream gets every message it is handed.
    const fields = item.messageId ? null : fieldIdentity(item);
    const remoteId =
      fields === null
        ? String(item.messageId)
        : `${fields}-${randomBytes(8).toString("base64url")}`;
    if (this.#state.seenRemote[remoteId]) return;
    if (fields !== null && this.#state.seenFields?.[fields] !== undefined) {
      const inReplay = this.#importing || Date.now() - this.#streamConnectAt < REPLAY_GUARD_MS;
      if (inReplay) return;
    }

    // Whether the account sent this, from anywhere — this app, the phone, or
    // WeChat on the desk. The relay only marks its own sends and system
    // notices, so a message typed in WeChat itself came through as the
    // contact's: the conversation showed one side of itself twice and none of
    // the user's own words.
    const mine = Boolean(item.fromSelf) || (await this.#sentByAccount(chatId, item));

    // Our own send, coming back around. Matched on content rather than id
    // because the relay assigns its own once WeChat accepts it.
    if (mine) {
      const body = bodyOf(item);
      const index = this.#state.outboundEchoes.findIndex(
        (echo) =>
          echo.chatId === chatId && echo.body === body && Date.now() - echo.timestamp < ECHO_TTL_MS,
      );
      if (index >= 0) {
        this.#state.outboundEchoes.splice(index, 1);
        this.#carried(remoteId, fields);
        return;
      }
    }

    const roomId = await this.#portal(chatId, item);
    let sender = this.#owner;
    if (!mine) {
      sender = this.#puppet(item.senderId || item.senderName || chatId);
      await this.#ensureVirtualUser(sender, item.senderName || UNKNOWN_SENDER);
      const face = avatarUrlOf(item);
      if (face) await this.#setPuppetAvatar(sender, face);
      // Otherwise the picture WeChat itself holds for them, which is the only
      // place today's relay leaves one.
      else await this.#applyLocalAvatar({user: sender}, item.senderId || chatId);
      await this.#join(roomId, sender);
    }
    // Stamped with when WeChat says it was sent, not when we imported it.
    // Without this an import lands a week of history all at the current
    // moment: every conversation shows the same time and the list cannot be
    // ordered by recency — which is not how the same list looks for a mautrix
    // bridge, and those two lists are meant to be the same list.
    const sentAt = originalTimestamp(item);
    const {content, retryImage} = await this.#content(chatId, item);
    const posted = await this.#matrix<{event_id?: string}>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(`wechat-${randomUUID()}`)}${sentAt ? `?ts=${sentAt}` : ""}`,
      {
        method: "PUT",
        as: sender,
        body: {
          ...content,
          "co.flareai.wechat.remote": true,
        },
      },
    );
    if (retryImage && posted?.event_id)
      this.#rememberPendingImage({
        chatId,
        messageId: retryImage,
        roomId,
        eventId: posted.event_id,
        sender,
        sentAt: sentAt || Date.now(),
      });
    if (posted?.event_id) this.#rememberEvent(chatId, posted.event_id);
    this.#state.lastRemoteTimestamp = Math.max(
      this.#state.lastRemoteTimestamp,
      Number(item.timestamp) || 0,
    );
    this.#carried(remoteId, fields);
  }

  /**
   * A message is carried: never to be posted again. Unaccepted ones are also
   * filed by what they are made of, which is the only handle a replay of
   * them will carry.
   */
  #carried(remoteId: string, fields: string | null): void {
    this.#state.seenRemote[remoteId] = Date.now();
    if (fields !== null) (this.#state.seenFields ??= {})[fields] = Date.now();
    this.#save();
  }

  /**
   * What the message becomes in Matrix. An image is carried across as an
   * image; everything else is text, because that is all the relay can give.
   */
  async #content(
    chatId: string,
    item: RelayMessage,
  ): Promise<{content: Record<string, unknown>; retryImage?: string}> {
    // A sticker's body is the `<emoji>` document WeChat sends, and that
    // document names where the picture is: an ordinary CDN url that needs no
    // credentials. Carrying it across turns "[Sticker]" into the sticker.
    if (item.messageKind === "emoticon") {
      const media = await this.#sticker(item).catch((error: unknown): null => {
        this.#log(`[wechat] sticker not retrievable: ${message(error)}`);
        return null;
      });
      if (media)
        return {content: {
          msgtype: "m.image",
          body: "Sticker",
          url: media.uri,
          info: {
            mimetype: media.mimeType,
            size: media.size,
            ...(media.width ? {w: media.width} : {}),
            ...(media.height ? {h: media.height} : {}),
          },
          // Marks what it actually is, for anything that cares to tell a
          // sticker from a photo. It renders as a picture either way.
          "co.flareai.sticker": true,
        }};
    }
    if (item.messageKind === "image" && item.messageId) {
      const messageId = String(item.messageId);
      const media = await this.#image(chatId, messageId).catch((error: unknown): null => {
        // Once per picture, not once per attempt: the retries below are quiet,
        // and this line is worth reading because it carries WeChat's own advice.
        if (!this.#state.pendingImages?.[`${chatId}:${messageId}`])
          this.#log(`[wechat] image ${messageId} not retrievable yet: ${message(error)}`);
        return null;
      });
      if (media)
        return {content: {
          msgtype: "m.image",
          body: media.name,
          url: media.uri,
          info: {mimetype: media.mimeType, size: media.size},
        }};
      // Carried back so the caller can note where the placeholder landed.
      return {content: this.#placeholder(item), retryImage: messageId};
    }
    return {content: this.#placeholder(item)};
  }

  /**
   * What stands in for media that could not be brought across. It is still
   * readable *somewhere* — in WeChat itself — so the placeholder carries the
   * way to open it rather than leaving a bare "[Photo]" with nowhere to go.
   * For an image that is also what makes it readable here later: opening it in
   * WeChat is exactly what lets the retry below succeed.
   */
  #placeholder(item: RelayMessage): Record<string, unknown> {
    return {
      msgtype: "m.text",
      body: bodyOf(item),
      ...(CARRIES_MEDIA.has(item.messageKind ?? "") || item.hasMedia
        ? {"co.flareai.view_in": {app: "WeChat", url: "weixin://"}}
        : {}),
    };
  }

  /**
   * Whether the account itself sent a message, decided from WeChat's own
   * store rather than from the relay.
   *
   * WeChat numbers the participants of each conversation and stamps every
   * message with that number; the relay does not pass it on. The CLI does, and
   * the number standing for the account is the one on every message in the
   * file-transfer chat — a chat that by definition only ever holds messages
   * the account sent to itself. That is the same calibration the CLI itself
   * uses when asked which messages are one's own.
   *
   * Answers are per chat and short-lived: a lookup costs a subprocess, and a
   * conversation being read arrives faster than one is worth spending per
   * message.
   */
  async #sentByAccount(chatId: string, item: RelayMessage): Promise<boolean> {
    const at = Number(item.timestamp);
    if (!Number.isFinite(at) || at <= 0) return false;
    const self = await this.#selfSenderId();
    if (!self) return false;
    const known = this.#selfSent.get(chatId);
    const fresh =
      known && Date.now() - known.at < SELF_SENT_TTL_MS
        ? known.timestamps
        : await this.#loadSelfSent(chatId, self);
    return fresh.has(at);
  }

  /** The participant number WeChat gives this account. Calibrated once. */
  async #selfSenderId(): Promise<string | null> {
    if (this.#selfId !== undefined) return this.#selfId;
    const rows = await this.#cliHistory("filehelper", 1);
    // Every message in the file-transfer chat is one the account sent itself,
    // so whichever number they carry is this account's.
    this.#selfId = rows[0]?.real_sender_id != null ? String(rows[0].real_sender_id) : null;
    if (!this.#selfId) this.#log("[wechat] could not tell which messages are the account's own");
    return this.#selfId;
  }

  async #loadSelfSent(chatId: string, self: string): Promise<Set<number>> {
    const rows = await this.#cliHistory(chatId, SELF_SENT_WINDOW);
    const timestamps = new Set(
      rows
        .filter((row) => String(row.real_sender_id ?? "") === self)
        .map((row) => Number(row.create_time))
        .filter((value) => Number.isFinite(value) && value > 0),
    );
    this.#selfSent.set(chatId, {at: Date.now(), timestamps});
    return timestamps;
  }

  /** A slice of a conversation as WeChat's own store holds it. */
  async #cliHistory(
    chatId: string,
    limit: number,
  ): Promise<Array<{create_time?: number; real_sender_id?: string | number}>> {
    for (const cli of cliPaths()) {
      const result = (await run(
        cli,
        ["history", chatId, "--json", "-n", String(limit), "--fields", "create_time,real_sender_id"],
        {timeout: SELF_SENT_TIMEOUT_MS},
      ).catch((): null => null)) as {stdout: string} | null;
      if (!result) continue;
      try {
        const parsed = JSON.parse(result.stdout) as
          | Array<{create_time?: number; real_sender_id?: string | number}>
          | {rows?: Array<{create_time?: number; real_sender_id?: string | number}>};
        return Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
      } catch {
        // The tool prints progress on stderr and json on stdout; anything else
        // is a build that does not answer this, and guessing is worse than
        // leaving the relay's own answer alone.
      }
    }
    return [];
  }

  /**
   * The picture behind a sticker message. The `<emoji>` document carries a
   * plain `cdnurl`; the encrypted variant beside it needs a key exchange this
   * has no part in, so only the plain one is used and a sticker without one
   * falls back to the text placeholder.
   */
  async #sticker(
    item: RelayMessage,
  ): Promise<{
    uri: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
  } | null> {
    const body = item.body ?? "";
    const url = unescapeXml(/cdnurl\s*=\s*"([^"]+)"/i.exec(body)?.[1] ?? "");
    if (!/^https?:\/\//i.test(url)) return null;
    const response = await this.#fetch(url, {signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS)});
    if (!response.ok) throw new Error(`sticker returned ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_STICKER_BYTES) return null;
    // The CDN answers `application/octet-stream` whatever it is holding, so
    // the bytes themselves have to say.
    const mimeType = imageTypeOf(bytes);
    if (!mimeType) return null;
    const registration = await this.#registration_();
    const upload = await this.#fetch(
      new URL("/_matrix/media/v3/upload?filename=sticker", this.#options.homeserver.baseUrl),
      {
        method: "POST",
        headers: {Authorization: `Bearer ${registration.asToken}`, "Content-Type": mimeType},
        body: bytes,
      },
    );
    if (!upload.ok) throw new Error(`upload returned ${upload.status}`);
    const {content_uri: uri} = (await upload.json()) as {content_uri: string};
    return {
      uri,
      mimeType,
      size: bytes.byteLength,
      width: numberAttribute(body, "width"),
      height: numberAttribute(body, "height"),
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
    for (const cli of cliPaths()) {
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
    // The whole message, hint included. Keeping only the first line threw away
    // the one actionable half — that opening the picture in WeChat once makes
    // it readable — and left a log line nobody could act on.
    if (extracted?.error) throw new Error(extracted.error.replace(/\s*\n\s*/g, " — "));
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

  /**
   * Fetches a contact picture and puts it in the media repository, returning
   * its `mxc://` id. Cached by url: the same picture is on every message a
   * contact sends, and re-uploading it per message would be absurd.
   */
  async #avatarMedia(url: string): Promise<string | null> {
    const cached = this.#avatars.get(url);
    if (cached !== undefined) return cached;
    try {
      const response = await this.#fetch(url, {signal: AbortSignal.timeout(10_000)});
      if (!response.ok) throw new Error(`avatar returned ${response.status}`);
      const mimeType = response.headers.get("content-type") ?? "image/jpeg";
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error("avatar was empty");
      const registration = await this.#registration_();
      const upload = await this.#fetch(
        new URL("/_matrix/media/v3/upload?filename=avatar", this.#options.homeserver.baseUrl),
        {
          method: "POST",
          headers: {Authorization: `Bearer ${registration.asToken}`, "Content-Type": mimeType},
          body: bytes,
        },
      );
      if (!upload.ok) throw new Error(`upload returned ${upload.status}`);
      const {content_uri: uri} = (await upload.json()) as {content_uri: string};
      this.#avatars.set(url, uri);
      return uri;
    } catch (error) {
      this.#log(`[wechat] avatar not retrievable: ${message(error)}`);
      // Remembered as absent so a picture that cannot be fetched is not
      // fetched again on every message from that contact.
      this.#avatars.set(url, null);
      return null;
    }
  }

  /**
   * The picture WeChat holds for a contact or group, uploaded to the media
   * repository and remembered so it is only ever sent once.
   */
  async #localAvatar(username: string): Promise<string | null> {
    if (!username) return null;
    const known = this.#state.avatarUris?.[username];
    if (known) return known;
    if (!this.#headImages) this.#headImages = loadHeadImages({log: (line) => this.#log(line)});
    const bytes = (await this.#headImages).get(username);
    if (!bytes) return null;
    const uri = await this.#uploadAvatar(bytes, "image/jpeg");
    if (!uri) return null;
    this.#state.avatarUris = {...(this.#state.avatarUris ?? {}), [username]: uri};
    this.#save();
    return uri;
  }

  /**
   * Puts WeChat's picture for `username` on a room or a puppet, at most once
   * each. Rooms opened before this existed are covered too: applying is keyed
   * on the target rather than on the moment the portal was made.
   */
  async #applyLocalAvatar(target: {room?: string; user?: string}, username: string): Promise<void> {
    const key = target.room ? `room:${target.room}` : `user:${target.user}`;
    if (this.#state.avatarsApplied?.[key]) return;
    const uri = await this.#localAvatar(username);
    if (!uri) return;
    const request = target.room
      ? this.#matrix(
          `/_matrix/client/v3/rooms/${encodeURIComponent(target.room)}/state/m.room.avatar/`,
          {method: "PUT", as: this.botId, body: {url: uri}},
        )
      : this.#matrix(
          `/_matrix/client/v3/profile/${encodeURIComponent(target.user ?? "")}/avatar_url`,
          {method: "PUT", as: target.user, body: {avatar_url: uri}},
        );
    const done = await request.then(() => true).catch(() => false);
    if (!done) return;
    this.#state.avatarsApplied = {...(this.#state.avatarsApplied ?? {}), [key]: true};
    this.#save();
  }

  /**
   * Gives the conversations already open the pictures they never had. Without
   * this only rooms created from here on would get one, which for an account
   * that has been bridged for a while is none of them.
   */
  async #syncRoomAvatars(): Promise<void> {
    for (const [chatId, room] of Object.entries(this.#state.rooms))
      await this.#applyLocalAvatar({room: room.roomId}, chatId).catch((error: unknown) =>
        this.#log(`[wechat] avatar for ${room.roomId} failed: ${message(error)}`),
      );
  }

  /** Puts bytes in the media repository and returns their `mxc://` id. */
  async #uploadAvatar(bytes: Uint8Array, mimeType: string): Promise<string | null> {
    try {
      const registration = await this.#registration_();
      const upload = await this.#fetch(
        new URL("/_matrix/media/v3/upload?filename=avatar", this.#options.homeserver.baseUrl),
        {
          method: "POST",
          headers: {Authorization: `Bearer ${registration.asToken}`, "Content-Type": mimeType},
          body: new Uint8Array(bytes),
        },
      );
      if (!upload.ok) throw new Error(`upload returned ${upload.status}`);
      const {content_uri: uri} = (await upload.json()) as {content_uri: string};
      return uri;
    } catch (error) {
      this.#log(`[wechat] avatar upload failed: ${message(error)}`);
      return null;
    }
  }

  /** Puts a contact's picture on their puppet, once. */
  async #setPuppetAvatar(userId: string, url: string): Promise<void> {
    const uri = await this.#avatarMedia(url);
    if (!uri) return;
    await this.#matrix(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}/avatar_url`, {
      method: "PUT",
      as: userId,
      body: {avatar_url: uri},
    }).catch((): undefined => undefined);
  }

  /** Puts a conversation's picture on its portal, so the chat list shows it. */
  async #setRoomAvatar(roomId: string, url: string): Promise<void> {
    const uri = await this.#avatarMedia(url);
    if (!uri) return;
    await this.#matrix(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.avatar/`,
      {method: "PUT", as: this.botId, body: {url: uri}},
    ).catch((): undefined => undefined);
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
    const face = avatarUrlOf(item);
    if (face) await this.#setRoomAvatar(created.room_id, face);
    else await this.#applyLocalAvatar({room: created.room_id}, chatId);
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
    const known = await this.#matrix<{displayname?: string}>(profile).catch((): null => null);
    // A message that arrived without a sender name must not rename someone the
    // bridge has already learned: one anonymous line would turn a whole group
    // conversation back into "WeChat contact".
    if (known?.displayname && displayName === UNKNOWN_SENDER) return;
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

  #retryDelays(): readonly number[] {
    return this.#options.imageRetryDelaysMs ?? IMAGE_RETRY_DELAYS_MS;
  }

  /** Notes an image to ask about again, keeping the first failure's time. */
  #rememberPendingImage(item: Omit<PendingImage, "attempts" | "nextAttemptAt" | "firstFailedAt">): void {
    const key = `${item.chatId}:${item.messageId}`;
    const pending = (this.#state.pendingImages ??= {});
    const now = Date.now();
    pending[key] = {
      ...item,
      attempts: 0,
      nextAttemptAt: now + this.#retryDelays()[0],
      firstFailedAt: pending[key]?.firstFailedAt ?? now,
    };
    this.#save();
  }

  /**
   * Asks again for the images WeChat would not decrypt, and edits the
   * placeholder into the picture when one finally comes through.
   *
   * Backing off rather than hammering: each attempt spawns the CLI, which scans
   * the running app's heap, and nothing here can make an image become readable
   * — only the user opening it in WeChat does that, at a moment nobody can
   * predict. A handful per sweep keeps a chat full of unviewed photos from
   * costing more than it is worth.
   */
  async #retryPendingImages(): Promise<void> {
    const pending = this.#state.pendingImages;
    if (!pending) return;
    const now = Date.now();
    const due = Object.entries(pending)
      .filter(([, item]) => item.nextAttemptAt <= now)
      .sort(([, a], [, b]) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, IMAGE_RETRIES_PER_SWEEP);
    for (const [key, item] of due) {
      if (this.#stopped) return;
      // Given up on: WeChat's CDN copy is long gone and the picture was never
      // opened, so there is nothing left to ask for. The placeholder stays,
      // and it still says where the picture can be seen.
      if (now - item.firstFailedAt > IMAGE_RETRY_WINDOW_MS) {
        delete pending[key];
        this.#save();
        continue;
      }
      const media = await this.#image(item.chatId, item.messageId).catch((): null => null);
      if (!media) {
        item.attempts += 1;
        const delays = this.#retryDelays();
        item.nextAttemptAt = now + delays[Math.min(item.attempts, delays.length - 1)];
        this.#save();
        continue;
      }
      const picture = {
        msgtype: "m.image",
        body: media.name,
        url: media.uri,
        info: {mimetype: media.mimeType, size: media.size},
      };
      await this.#matrix(
        `/_matrix/client/v3/rooms/${encodeURIComponent(item.roomId)}/send/m.room.message/${encodeURIComponent(`wechat-${randomUUID()}`)}?ts=${item.sentAt}`,
        {
          method: "PUT",
          as: item.sender,
          body: {
            // An edit, so the placeholder already in the thread becomes the
            // picture in place rather than the same message arriving twice —
            // once as text, once, much later, as an image out of order.
            ...picture,
            body: `* ${picture.body}`,
            "m.new_content": picture,
            "m.relates_to": {rel_type: "m.replace", event_id: item.eventId},
            "co.flareai.wechat.remote": true,
          },
        },
      ).catch((error: unknown) => {
        this.#log(`[wechat] image ${item.messageId} arrived but could not be shown: ${message(error)}`);
      });
      this.#log(`[wechat] image ${item.messageId} came through after ${item.attempts + 1} attempts`);
      delete pending[key];
      this.#save();
    }
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

  /**
   * Debounced, because a busy stream would otherwise write on every event.
   * A hard kill between flushes loses whatever has not been written yet — and
   * the relay hands it back at the next connect — so a burst also writes on
   * its own, keeping what one crash can cost to a handful of messages rather
   * than everything since the last quiet moment.
   */
  #save(): void {
    if (!this.#saving)
      this.#saving = setTimeout(() => {
        this.#saving = null;
        void this.#flush();
      }, 250);
    if (++this.#unsaved >= SAVE_EVERY_CHANGES) {
      this.#unsaved = 0;
      void this.#flush();
    }
  }

  async #flush(): Promise<void> {
    const now = Date.now();
    this.#unsaved = 0;
    // Both maps grow forever otherwise; neither is worth keeping past its use.
    this.#state.seenRemote = Object.fromEntries(
      Object.entries(this.#state.seenRemote).filter(([, at]) => now - at < SEEN_TTL_MS),
    );
    this.#state.seenFields = Object.fromEntries(
      Object.entries(this.#state.seenFields ?? {}).filter(([, at]) => now - at < SEEN_TTL_MS),
    );
    this.#state.seenTransactions = Object.fromEntries(
      Object.entries(this.#state.seenTransactions).filter(([, at]) => now - at < 24 * 3_600_000),
    );
    this.#state.outboundEchoes = this.#state.outboundEchoes.filter(
      (echo) => now - echo.timestamp < ECHO_TTL_MS,
    );
    const file = path.join(this.#options.directory, "wechat", "state.json");
    // Unique per write: the debounced save and the flush `close` does can
    // overlap, and one shared `.tmp` means the second rename finds the file
    // the first one already moved.
    const temporary = `${file}.${randomUUID()}.tmp`;
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
  avatar?: string;
  avatarUrl?: string;
  avatar_url?: string;
  head_img?: string;
  head_img_url?: string;
  small_head_url?: string;
  big_head_url?: string;
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
  // WeChat wraps its non-text kinds in tags that all end in `msg` — `msg`,
  // `sysmsg`, `appmsg`, `voipmsg`, … — so the tag family, not a list of
  // kinds, is what says "this is markup, label it".
  if (body.startsWith("<") && /^<[a-z0-9_]*msg\b/i.test(body))
    return `[${kind || "Unsupported WeChat message"}]`;
  if (body) return body;
  if (item.hasMedia) return KIND_LABELS[item.mediaType ?? ""] ?? `[${item.mediaType || "Media"}]`;
  return `[${kind || "Unsupported WeChat message"}]`;
}

/**
 * What an unaccepted message is made of, so a replay that hands it back can be
 * told from the live stream. It is not an id: two distinct messages may share
 * all of it — WeChat timestamps only whole seconds, and does not report a
 * message until WeChat accepts it — which is why repeats are recognised only
 * where a replay actually happens.
 */
function fieldIdentity(item: RelayMessage): string {
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
