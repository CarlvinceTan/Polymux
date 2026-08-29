import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import type { Homeserver } from "./server.js";
import { loadHeadImages } from "./wechat-head-images.js";
import { visibleWeChatText } from "./wechat-emoji.js";

/**
 * WeChat, bridged into the embedded homeserver.
 *
 * Every other network here is a mautrix binary Polymux supervises. WeChat has
 * none — upstream's only Matrix bridge needs a Windows agent doing DLL
 * injection, which cannot run on a Mac. What does work on macOS is a local
 * relay driving the WeChat desktop app, exposing the account over loopback
 * HTTP with an SSE stream of new messages.
 *
 * So this is the missing half: an application service that owns portal rooms
 * and puppets on Polymux's own homeserver, and carries messages between them
 * and that relay. It runs in-process rather than as a spawned binary, because
 * there is no binary to spawn.
 */

const run: (
  file: string,
  args: string[],
  options: { timeout: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/**
 * Where `wechat-use` installs. Media is the one thing the loopback relay
 * cannot serve — WeChat stores images encrypted and hands out a CDN blob
 * descriptor rather than a url — so the bytes come from the CLI, which owns
 * the key derivation.
 */
function defaultCliPaths(): string[] {
  // Read when used rather than when this module loads: an override set after
  // startup — a test's stand-in, a path the user configures later — would
  // otherwise never be seen.
  //
  // An override is exclusive. Trying the next path when it fails means a
  // stand-in that cannot run silently hands the work to the real `wechat-use`
  // on the machine — which is how a test that must never touch WeChat ends up
  // reading someone's actual conversations.
  if (process.env.POLYMUX_WECHAT_CLI) return [process.env.POLYMUX_WECHAT_CLI];
  return [
    process.env.POLYMUX_WECHAT_CLI,
    `${homedir()}/.local/bin/wechat-use`,
    "/opt/homebrew/bin/wechat-use",
    "/usr/local/bin/wechat-use",
  ].filter((entry): entry is string => Boolean(entry));
}
/** Extraction can fall back to a CDN replay, so it gets room to finish. */
const MEDIA_TIMEOUT_MS = 30_000;
/** WeChat's background clipboard send may need to bootstrap its native session. */
const MEDIA_SEND_TIMEOUT_MS = 130_000;
/**
 * How long to keep asking for an image WeChat has not decrypted, and how often.
 * The gaps widen because nothing this end can hurry it along: the picture
 * becomes readable when the user opens it in WeChat, which may be in a minute
 * or never. A week is where asking stops being worth the heap scan.
 */
const IMAGE_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
];
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
 * Polymux's plumbing: nobody using the app should have to know they exist, so
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
  process.env.POLYMUX_WECHAT_BIN,
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
const MAX_RELAY_MEDIA_BYTES = 200 * 1024 * 1024;

/** How much of an already-read conversation to import, so it has a last line. */
const BACKFILL_MIN = 10;

/** Stands in until the relay names a sender, and never replaces a real name. */
const UNKNOWN_SENDER = "WeChat contact";
/** How long an outbound message may wait for its own echo to come back. */
const ECHO_TTL_MS = 5 * 60 * 1_000;

/** Native writer reasons are stable machine codes, not UI copy. Translate the
 * ones a person can act on before they cross IPC into the composer. */
const WECHAT_WRITER_FAILURES: Readonly<Record<string, string>> = {
  wechat_not_running:
    "Open WeChat and make sure you are signed in, then try again.",
  wechat_no_chat_selected:
    "Open this conversation in WeChat once, then try again.",
  tcc_accessibility_denied:
    "Allow WeChat bridge access in System Settings → Privacy & Security → Accessibility, then try again.",
  tcc_input_monitoring_denied:
    "Allow WeChat bridge access in System Settings → Privacy & Security → Input Monitoring, then try again.",
  delivery_verify_timeout:
    "WeChat did not confirm delivery. Check that WeChat is connected, then try again.",
  delivery_misrouted:
    "WeChat selected a different conversation, so Polymux stopped the send. Open the intended conversation and try again.",
  verify_account_mismatch:
    "Polymux and WeChat are connected to different accounts. Reconnect WeChat, then try again.",
  profile_missing:
    "This WeChat version is not supported by the installed bridge yet.",
  profile_expired:
    "The installed WeChat compatibility data has expired. Update the bridge, then try again.",
  dylib_sha_mismatch:
    "This WeChat build is not supported by the installed bridge yet.",
};

export function weChatWriterFailureMessage(
  reason: string | undefined,
  operation: WeChatWriteRequest["kind"],
): string {
  const raw = String(reason ?? "").trim();
  return (
    WECHAT_WRITER_FAILURES[raw.toLowerCase()] ||
    raw ||
    `WeChat did not verify the ${operation} operation`
  );
}

/** Keeps remote delivery truth separate from recovery of the inbound relay.
 * A verified write must not be reported as failed only because the relay did
 * not come back immediately; the caller would discard its local echo and a
 * retry could send the same message twice. */
export function settleWeChatWrite(
  result: WeChatWriteResult | undefined,
  operationError: unknown,
  restartError: unknown,
): {result: WeChatWriteResult; retryRelay: boolean} {
  if (operationError && restartError)
    throw new AggregateError(
      [operationError, restartError],
      "WeChat delivery failed and its relay did not restart",
    );
  if (operationError) throw operationError;
  if (!result?.deliveredVerified)
    throw new Error("WeChat writer returned no verified delivery result");
  return {result, retryRelay: Boolean(restartError)};
}

interface RelaySendResult {
  success?: boolean;
  ok?: boolean;
  error?: string;
  message?: string;
  messageId?: string;
  diagnostic?: {reason?: string};
}

function relayNeedsBackgroundPrime(result: RelaySendResult): boolean {
  const reason = String(result.diagnostic?.reason ?? result.error ?? "")
    .trim()
    .toLowerCase();
  return (
    reason === "slot_send_bp_armed_no_fire" ||
    reason === "wechat_no_chat_selected"
  );
}

function relayNeedsAppRelaunch(result: RelaySendResult): boolean {
  const reason = String(
    result.diagnostic?.reason ?? result.error ?? result.message ?? "",
  )
    .trim()
    .toLowerCase();
  return reason === "wechat_not_running";
}

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
  /** Exact CLI candidates; tests can inject one without changing global environment. */
  cliPaths?: string[];
  /**
   * The LLDB helper `wechatd` uses to capture WeChat's next CDN request. The
   * released daemon references this script but does not package it, and its
   * built-in fallback is a path on the machine it was compiled on — so unless
   * the daemon is told where the shipped copy lives, its CDN fallback for
   * media WeChat has not decrypted can never arm.
   */
  cdnCaptureScript?: string;
  /** Local roots from which relay-advertised media may be read. */
  mediaRoots?: string[];
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
  /**
   * Makes the native desktop app available without activating it. The desktop
   * host supplies the platform-specific launch; tests omit it so they can
   * never start a person's WeChat session.
   */
  ensureAppRunning?: () => Promise<boolean>;
  /**
   * Reconnects WeChat's current chat signal chain without activating the app.
   * The desktop host supplies the bounded macOS accessibility helper; other
   * platforms and tests normally omit it.
   */
  primeApp?: () => Promise<boolean>;
  /**
   * Optional full-fidelity writer. The shipping relay currently verifies text
   * and the CLI verifies images; a native driver can supply the remaining
   * WeChat operations without teaching the Matrix bridge about WeChat ABI/UI
   * details. Tests inject this boundary and never touch the real application.
   */
  writer?: WeChatWriter;
}

export type WeChatWriteRequest =
  | {
      kind: "text";
      chatId: string;
      body: string;
      replyTo?: string;
      /** Painted reply used when the writer cannot emit a native refermsg. */
      fallbackBody?: string;
      /** Matrix-side quote data for a freshly sent target not indexed yet. */
      replyContext?: {
        body: string;
        sender: string;
        createTime: number;
      };
      /** WeChat ids to encode as real @ mentions rather than painted text. */
      mentions?: string[];
    }
  | {
      kind: "media";
      chatId: string;
      mediaType: "image" | "sticker" | "video" | "audio" | "file";
      path: string;
      name: string;
      mimeType?: string;
      /** Exact WeChat `<emoji>` reference for a store-backed native sticker. */
      emojiXml?: string;
    }
  | {
      kind: "recall";
      chatId: string;
      messageId: string;
      /** Native client id returned by the original send, when Polymux sent it. */
      clientMessageId?: string;
    }
  | { kind: "read"; chatId: string };

export interface WeChatWriteResult {
  /** True only after WeChat itself accepted and echoed the operation. */
  deliveredVerified: boolean;
  messageId?: string;
  /** Native client id needed to recall a freshly injected message. */
  clientMessageId?: string;
  reason?: string;
}

export interface WeChatWriter {
  write(request: WeChatWriteRequest): Promise<WeChatWriteResult>;
}

/** A child stopped by a signal keeps `exitCode === null`; checking both
 * fields prevents a dead supervised relay from being mistaken for a live
 * process after SIGTERM or a crash signal. */
export function childProcessIsRunning(
  child: Pick<ChildProcess, "exitCode" | "signalCode"> | null | undefined,
): boolean {
  return Boolean(
    child && child.exitCode === null && child.signalCode === null,
  );
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
  mediaUrls?: string[];
  media_urls?: string[];
  localPath?: string;
  local_path?: string;
  media?: {
    url?: string;
    urls?: string[];
    localPath?: string;
    local_path?: string;
    mime?: string;
    mimeType?: string;
    filename?: string;
    size?: number;
  };
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
  const raw = Number(
    new RegExp(`${name}\\s*=\\s*"(\\d+)"`, "i").exec(xml)?.[1],
  );
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** The reusable native sticker element inside WeChat's message wrapper. */
function emojiElement(value: string): string | null {
  return (
    value.match(/<emoji\b[\s\S]*?<\/emoji>/i)?.[0] ??
    value.match(/<emoji\b[^>]*\/>/i)?.[0] ??
    null
  );
}

function emojiMd5(value: string): string | null {
  const element = emojiElement(value);
  return (
    element
      ?.match(/\bmd5\s*=\s*["']([a-f0-9]{32})["']/i)?.[1]
      ?.toLowerCase() ?? null
  );
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
    return String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
      ? "image/webp"
      : null;
  return null;
}

/** Every field under the camelCase name the rest of the bridge reads. */
function normalise(item: RelayMessage): RelayMessage {
  const chatId = item.chatId ?? item.chat_id;
  return {
    ...item,
    messageId: item.messageId ?? item.message_id,
    chatId,
    chatName: item.chatName ?? item.chat_name,
    senderId: item.senderId ?? item.sender_id,
    senderName: item.senderName ?? item.sender_name,
    isGroup: item.isGroup ?? item.is_group ?? /@chatroom$/i.test(chatId ?? ""),
    fromSelf: item.fromSelf ?? item.from_self,
    hasMedia: item.hasMedia ?? item.has_media,
    mediaType: item.mediaType ?? item.media_type,
    mediaUrls: item.mediaUrls ?? item.media_urls,
    localPath: item.localPath ?? item.local_path,
    messageKind: item.messageKind ?? item.message_kind,
  };
}

function named(value: unknown): string | null {
  const result = typeof value === "string" ? value.trim() : "";
  return result && result !== UNKNOWN_SENDER ? result : null;
}

/** The conversation name the relay or its chat directory already resolved. */
function conversationName(item: RelayMessage): string | null {
  return named(item.chatName) ?? named(item.display_name) ?? named(item.senderName);
}

/**
 * Direct messages have one remote participant, so the conversation name is
 * also the sender name when the message payload omitted it. Group titles must
 * never be used this way: they identify the room, not the person speaking.
 */
function senderDisplayName(item: RelayMessage, rememberedChatName?: string): string {
  const sender = named(item.senderName);
  if (sender) return sender;
  if (!item.isGroup) {
    const direct = conversationName(item) ?? named(rememberedChatName);
    if (direct && direct !== "WeChat") return direct;
  }
  return UNKNOWN_SENDER;
}

interface BridgeState {
  /** Portal room per WeChat conversation, and the reverse for outbound. */
  rooms: Record<string, { roomId: string; isGroup: boolean; name?: string }>;
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
  outboundEchoes: Array<{
    chatId: string;
    body: string;
    timestamp: number;
    operationId?: string;
  }>;
  /** Media sends awaiting WeChat's own accepted copy of the message. */
  outboundMediaEchoes?: Array<{
    chatId: string;
    kind: "image" | "sticker" | "video" | "audio" | "file" | "reply";
    timestamp: number;
    /** For `reply`, the authored text so its echo is matched on content, not
     * just kind — an unrelated `<refermsg>` message must not consume it. */
    body?: string;
    operationId?: string;
  }>;
  /** Verified sticker bytes -> WeChat's reusable native emoji reference. */
  stickerReferences?: Record<string, { xml: string; seenAt: number }>;
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
  /** Matrix event -> WeChat server message id, needed for native reply/recall. */
  remoteMessageIds?: Record<string, string>;
  /** Matrix event -> WeChat client message id, needed for immediate recall. */
  remoteMessageClientIds?: Record<string, string>;
  /** Hashed Matrix puppet id -> original WeChat id, needed for native mentions. */
  puppetRemoteIds?: Record<string, string>;
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
  /** Last cheap heap probe, so a large queue is retried fairly. */
  lastHeapAttemptAt?: number;
  firstFailedAt: number;
}

interface UploadedWeChatImage {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
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
    outboundMediaEchoes: [],
    stickerReferences: {},
    avatarUris: {},
    avatarsApplied: {},
    recentEvents: {},
    readReceipts: {},
    remoteMessageIds: {},
    remoteMessageClientIds: {},
    lastRemoteTimestamp: Math.floor(Date.now() / 1000) - 60,
  };
}

/**
 * The environment the relay's processes are started with. The daemon looks up
 * its CDN-capture helper by `WECHAT_CDN_CAPTURE_SCRIPT`, and a value the
 * operator already exported wins over the shipped copy — it is the documented
 * way to point the daemon at a helper of their own.
 */
export function relayEnvironment(
  base: NodeJS.ProcessEnv,
  cdnCaptureScript?: string,
): NodeJS.ProcessEnv {
  return cdnCaptureScript && !base.WECHAT_CDN_CAPTURE_SCRIPT
    ? { ...base, WECHAT_CDN_CAPTURE_SCRIPT: cdnCaptureScript }
    : base;
}

/** PID reported by `wechat-use daemon status`, or null when it is not running. */
export function weChatDaemonPid(status: string): number | null {
  const pid = Number(/\brunning\b[^\n]*\bpid=(\d+)\b/i.exec(status)?.[1]);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

/** The single process holding WeChat's loopback relay port, from `lsof -t`. */
export function weChatRelayListenerPid(output: string): number | null {
  const pids = output
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 1);
  return pids.length === 1 ? pids[0] : null;
}

/** Whether a running daemon inherited the capture helper chosen for this run. */
export function daemonUsesCaptureScript(
  processEnvironment: string,
  captureScript: string,
): boolean {
  const assignment = `WECHAT_CDN_CAPTURE_SCRIPT=${captureScript}`;
  const index = processEnvironment.indexOf(assignment);
  if (index < 0) return false;
  const end = index + assignment.length;
  return (
    (index === 0 || /\s/.test(processEnvironment[index - 1] ?? "")) &&
    (end === processEnvironment.length || /\s/.test(processEnvironment[end] ?? ""))
  );
}

export class WeChatBridge {
  readonly #options: Required<Pick<WeChatBridgeOptions, "relayUrl">> &
    WeChatBridgeOptions;
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
  readonly #selfSent = new Map<
    string,
    { at: number; timestamps: Set<number> }
  >();
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
  /** A reconnect and the timer can ask at once; only one may attach to WeChat. */
  #retryingImages = false;
  /** The read-state sweep, likewise. */
  #readSweep: ReturnType<typeof setInterval> | null = null;
  #token: string | null = null;
  /** The relay we started, if we were the one to start it. */
  #relayProcess: ChildProcess | null = null;
  /** Most recent daemon send readiness advertised by `/health`. */
  #relayHijackArmed: boolean | null = null;
  /** Whose portal rooms these are. Known only once Polymux has its account. */
  #owner = "";
  /** When the event stream last answered, so its replay is told from live. */
  #streamConnectAt = 0;
  /** True while the import re-pulls history, which replays by fields too. */
  #importing = false;
  /** Changes since the last flush, so a burst does not sit out a crash alone. */
  #unsaved = 0;
  #saving: NodeJS.Timeout | null = null;
  /** Completed native writes that may have beaten the IPC caller to its wait. */
  readonly #outboundResults = new Map<
    string,
    {error: string | null; completedAt: number}
  >();
  /** IPC callers waiting for the appservice transaction carrying their event. */
  readonly #outboundWaiters = new Map<
    string,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  /** Native writes and relay suspension are one critical section. */
  #writerQueue: Promise<void> = Promise.resolve();
  /** Expected stream interruption while a native writer owns WeChat. */
  #writerPaused = false;
  /** One stream follower at a time, including after WeChat is relaunched. */
  #consumeTask: Promise<void> | null = null;
  /** Invalidates an older follower when the same bridge is closed and linked
   * again before its aborted stream has finished unwinding. */
  #consumeGeneration = 0;
  /** Existing Matrix portals indexed once if the local routing map is absent. */
  #portalRecovery: Promise<Map<string, string>> | null = null;
  /** One Matrix-room creation per WeChat chat, even when startup history and
   * the live relay discover that chat at the same time. */
  readonly #portalTasks = new Map<string, Promise<string>>();

  constructor(options: WeChatBridgeOptions) {
    this.#options = {
      ...options,
      relayUrl: (options.relayUrl ?? DEFAULT_RELAY).replace(/\/+$/, ""),
    };
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
    if (!owner) return false;
    // A bridge that was unlinked and is being linked again comes back through
    // here; the flag that ended its loops must not outlive the stop.
    this.#stopped = false;
    this.#owner = owner;
    await this.#resolveToken();
    // A native write deliberately removes the relay because both it and the
    // writer attach to the same WeChat process. Status is polled while the Hub
    // is open; treating that intentional gap as a crash restarts the relay in
    // the middle of the write and lets media recovery attach a second
    // debugger. The appservice is still live, so report the bridge as started
    // until the writer has restored its relay.
    if (this.#writerPaused && this.#server) return true;
    if (!(await this.#relayHealthy())) await this.#ensureAppRunning();
    // Start the relay ourselves if it is not already up. Its absence is a
    // detail of how WeChat is reached, not something to hand back to the user
    // as a chore — the only thing they can actually fix is WeChat itself.
    if (!(await this.#relayHealthy()) && !(await this.#startRelay())) {
      this.#log("[wechat] no local relay on this Mac; WeChat stays unlinked.");
      return false;
    }
    // A prior stream can end when WeChat quits while the appservice server
    // remains registered. Relaunching WeChat must revive that same bridge,
    // not create another server or another set of portal rooms.
    if (this.#server) {
      this.#ensureConsume();
      return true;
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
    this.#ensureConsume();
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
    this.#consumeGeneration += 1;
    this.#streaming?.abort();
    this.#consumeTask = null;
    for (const [eventId, waiter] of this.#outboundWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`WeChat stopped before it delivered ${eventId}`));
    }
    this.#outboundWaiters.clear();
    this.#outboundResults.clear();
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

  /** Waits until WeChat itself has accepted the Matrix event, not merely until
   * the embedded homeserver has recorded it. Results are retained briefly so
   * a very fast appservice transaction cannot race ahead of the caller. */
  async waitForOutbound(eventId: string, timeoutMs = 320_000): Promise<void> {
    const completed = this.#outboundResults.get(eventId);
    if (completed) {
      this.#outboundResults.delete(eventId);
      if (completed.error) throw new Error(completed.error);
      return;
    }
    return await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#outboundWaiters.delete(eventId);
        reject(new Error("WeChat did not finish delivering the message in time"));
      }, timeoutMs);
      timer.unref?.();
      this.#outboundWaiters.set(eventId, {resolve, reject, timer});
    });
  }

  /** Recalls an event only after the native operation succeeds, then writes a
   * bridge-owned Matrix redaction so it cannot loop back out as a second recall. */
  async recall(roomId: string, eventId: string): Promise<void> {
    const chatId = this.#state.roomToChat[roomId];
    const messageId = this.#state.remoteMessageIds?.[eventId];
    if (!chatId || !messageId)
      throw new Error("This WeChat message is not available to recall");
    await this.#write({
      kind: "recall",
      chatId,
      messageId,
      ...(this.#state.remoteMessageClientIds?.[eventId]
        ? {clientMessageId: this.#state.remoteMessageClientIds[eventId]}
        : {}),
    });
    await this.#matrix(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(`wechat-recall-${randomUUID()}`)}`,
      {method: "PUT", as: this.#owner, body: {}},
    );
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
    if ((await this.#relayStatus()) !== "connected") return false;
    const authorized = await this.#relay("/unread").catch((): null => null);
    if (authorized === null) {
      this.#log("[wechat] the relay is running but refused this token.");
      return false;
    }
    return true;
  }

  async #relayStatus(): Promise<string | null> {
    const health = await this.#relay<{
      status?: string;
      hijackArmed?: boolean;
    }>("/health").catch((): null => null);
    this.#relayHijackArmed =
      typeof health?.hijackArmed === "boolean" ? health.hijackArmed : null;
    return typeof health?.status === "string" ? health.status : null;
  }

  async #ensureAppRunning(): Promise<boolean> {
    if (!this.#options.ensureAppRunning) return false;
    return await this.#options.ensureAppRunning().catch((error: unknown) => {
      this.#log(`[wechat] WeChat could not be started quietly: ${message(error)}`);
      return false;
    });
  }

  async #primeApp(): Promise<boolean> {
    if (!this.#options.primeApp) return false;
    return await this.#options.primeApp().catch((error: unknown) => {
      this.#log(`[wechat] background send warm-up failed: ${message(error)}`);
      return false;
    });
  }

  async #waitForRelay(): Promise<boolean> {
    const deadline = Date.now() + RELAY_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.#relayHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  /** The first of a set of binaries that exists on this Mac. */
  async #binary(name: string): Promise<string | null> {
    for (const directory of this.#options.binaryDirectories ??
      WECHAT_FALLBACK_DIRECTORIES) {
      const candidate = path.join(directory, name);
      const found = await access(candidate)
        .then(() => true)
        .catch(() => false);
      if (found) return candidate;
    }
    return null;
  }

  /** Exact known relay on this bridge's own port. This covers a relay restored
   * by a previous app instance, while refusing to signal an unrelated listener. */
  async #relayListenerPid(): Promise<number | null> {
    if (process.platform !== "darwin") return null;
    const found = await run(
      "/usr/sbin/lsof",
      ["-nP", `-iTCP:${this.#relayPort()}`, "-sTCP:LISTEN", "-t"],
      {timeout: PROBE_TIMEOUT_MS, env: process.env},
    ).catch((): null => null);
    const pid = weChatRelayListenerPid(found?.stdout ?? "");
    if (!pid) return null;
    const executable = await run(
      "/bin/ps",
      ["-p", String(pid), "-o", "comm="],
      {timeout: PROBE_TIMEOUT_MS, env: process.env},
    ).catch((): null => null);
    const actual = executable?.stdout.trim();
    if (!actual || path.basename(actual) !== "wechat-bridge") return null;
    const resolved = await realpath(actual).catch((): null => null);
    if (!resolved) return null;
    for (const directory of this.#options.binaryDirectories ?? WECHAT_FALLBACK_DIRECTORIES) {
      const known = await realpath(path.join(directory, "wechat-bridge")).catch(
        (): null => null,
      );
      if (known === resolved) return pid;
    }
    return null;
  }

  async #pauseRelayForWriter(): Promise<boolean> {
    const child = this.#relayProcess;
    const childRunning = childProcessIsRunning(child);
    const pid = childRunning ? child?.pid : await this.#relayListenerPid();
    if (!pid) return false;
    this.#writerPaused = true;
    this.#streaming?.abort();
    this.#relayProcess = null;
    if (childRunning && child) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve, reject) => {
        if (!childProcessIsRunning(child)) return resolve();
        const timer = setTimeout(
          () => reject(new Error("WeChat relay did not stop before the native operation")),
          5_000,
        );
        timer.unref?.();
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      return true;
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const stillKnown = await this.#relayListenerPid();
      if (stillKnown !== pid) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("WeChat relay did not stop before the native operation");
  }

  /**
   * Brings the relay up and waits for it to answer. Returns false when there
   * is nothing to start, which is the ordinary case on a Mac that has never
   * had these tools — not an error worth reporting anywhere but the log.
   */
  async #startRelay(): Promise<boolean> {
    const [bridge, cli] = await Promise.all(
      RELAY_BINARIES.map((name) => this.#binary(name)),
    );
    if (!bridge) {
      this.#log("[wechat] no relay binary on this Mac; WeChat stays unlinked.");
      return false;
    }
    // The daemon reads the capture-script variable from its own environment
    // when it arms a CDN capture, so it has to be present at `daemon start`.
    const environment = relayEnvironment(
      process.env,
      this.#options.cdnCaptureScript,
    );
    // The daemon underneath it has to be up first, and it is the piece that
    // actually attaches to WeChat, so a failure here is usually WeChat itself
    // being closed or signed out.
    if (cli) {
      const captureScript = environment.WECHAT_CDN_CAPTURE_SCRIPT;
      if (captureScript) {
        const status = await run(cli, ["daemon", "status"], {
          timeout: RELAY_START_TIMEOUT_MS,
          env: environment,
        }).catch((): null => null);
        const pid = weChatDaemonPid(
          `${status?.stdout ?? ""}\n${status?.stderr ?? ""}`,
        );
        if (pid) {
          const processEnvironment = await run(
            "/bin/ps",
            ["eww", "-p", String(pid), "-o", "command="],
            { timeout: RELAY_START_TIMEOUT_MS, env: environment },
          ).catch((): null => null);
          if (
            !processEnvironment?.stdout ||
            !daemonUsesCaptureScript(processEnvironment.stdout, captureScript)
          ) {
            const stopped = await run(cli, ["daemon", "stop"], {
              timeout: RELAY_START_TIMEOUT_MS,
              env: environment,
            }).catch((): null => null);
            if (!stopped)
              this.#log(
                "[wechat] the existing daemon could not be restarted with the CDN capture helper.",
              );
          }
        }
      }
      await run(cli, ["daemon", "start"], {
        timeout: RELAY_START_TIMEOUT_MS,
        env: environment,
      }).catch((): null => null);
    }
    // Our own token when we are the one starting it: an unauthenticated
    // loopback port is one any process on this Mac could read messages from.
    this.#token ??= randomBytes(24).toString("base64url");
    // A disconnected relay may already own the port while it waits for WeChat
    // to return. Reuse it; spawning a competitor here creates a false restart
    // failure and leaves the original process as the only possible recovery.
    const relayAlive = childProcessIsRunning(this.#relayProcess);
    if ((await this.#relayStatus()) === null && !relayAlive) {
      const child = spawn(
        bridge,
        ["--shape", "hermes", "--port", String(this.#relayPort())],
        {
          env: {...environment, WECHAT_BRIDGE_BEARER: this.#token},
          stdio: "ignore",
          detached: false,
        },
      );
      child.on("error", (error) =>
        this.#log(`[wechat] relay failed to start: ${error.message}`),
      );
      this.#relayProcess = child;
    }
    if (await this.#waitForRelay()) return true;
    this.#log(
      "[wechat] the relay did not come up; is WeChat open and signed in?",
    );
    return false;
  }

  #ensureConsume(): void {
    if (this.#consumeTask || this.#stopped) return;
    const generation = ++this.#consumeGeneration;
    const task = this.#consume(generation).finally(() => {
      if (this.#consumeTask === task) this.#consumeTask = null;
    });
    this.#consumeTask = task;
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
    const file = path.join(
      this.#options.directory,
      "wechat",
      "registration.json",
    );
    await mkdir(path.dirname(file), { recursive: true });
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
    if (address && typeof address === "object")
      registration.port = address.port;
    this.#server = server;
    await writeFile(
      path.join(this.#options.directory, "wechat", "registration.json"),
      `${JSON.stringify(registration, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  async #handle(
    request: Parameters<Parameters<typeof createServer>[1]>[0],
    response: Parameters<Parameters<typeof createServer>[1]>[1],
    registration: Registration,
  ): Promise<void> {
    const reply = (status: number, body: unknown): void => {
      const text = JSON.stringify(body);
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(text);
    };
    if (request.headers.authorization !== `Bearer ${registration.hsToken}`)
      return reply(403, { errcode: "M_FORBIDDEN" });
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const transaction = url.pathname.match(/transactions\/([^/]+)$/);
    if (request.method === "PUT" && transaction) {
      const id = decodeURIComponent(transaction[1]);
      // Transactions are retried on any failure to respond, so the id is what
      // keeps a redelivery from sending the same message to WeChat twice.
      if (!this.#state.seenTransactions[id]) {
        this.#state.seenTransactions[id] = Date.now();
        this.#save();
        const body = await readBody(request).catch(
          (): { events?: unknown[] } => ({}),
        );
        for (const event of (body.events ?? []) as MatrixEvent[]) {
          try {
            await this.#relayOutbound(event);
            this.#settleOutbound(event.event_id, null);
          } catch (error) {
            this.#settleOutbound(event.event_id, message(error));
            this.#log(`[wechat] outbound failed: ${message(error)}`);
          }
        }
      }
      return reply(200, {});
    }
    // Everything the homeserver asks about our namespace already exists.
    if (request.method === "GET" && /\/users\//.test(url.pathname))
      return reply(200, {});
    if (/\/ping$/.test(url.pathname)) return reply(200, {});
    return reply(404, { errcode: "M_UNRECOGNIZED" });
  }

  #settleOutbound(eventId: string | undefined, error: string | null): void {
    if (!eventId) return;
    const waiter = this.#outboundWaiters.get(eventId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.#outboundWaiters.delete(eventId);
      if (error) waiter.reject(new Error(error));
      else waiter.resolve();
      return;
    }
    const now = Date.now();
    this.#outboundResults.set(eventId, {error, completedAt: now});
    for (const [id, result] of this.#outboundResults)
      if (now - result.completedAt > 5 * 60_000)
        this.#outboundResults.delete(id);
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
    const listed = await this.#relay<RelayChat[] | { rows?: RelayChat[] }>(
      "/chats",
    ).catch((): null => null);
    const source =
      listed ??
      (await this.#relay<RelayChat[] | { rows?: RelayChat[] }>("/unread"));
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
        const chatIsGroup =
          chat.isGroup ?? chat.is_group ?? /@chatroom$/i.test(chatId);
        const chatName = named(chat.display_name);
        // Repair old generic puppet profiles from the chat directory even
        // when every history event is already deduplicated before ingestion.
        if (!chatIsGroup && chatName) {
          const puppet = this.#puppet(chatId);
          if (this.#state.puppetRemoteIds?.[puppet] !== chatId) {
            this.#state.puppetRemoteIds = {
              ...(this.#state.puppetRemoteIds ?? {}),
              [puppet]: chatId,
            };
            this.#save();
          }
          await this.#ensureVirtualUser(puppet, chatName);
        }
        const count = Math.max(
          0,
          Number(chat.unread_count ?? chat.unreadCount ?? 0),
        );
        // Unread decides how much to pull, not whether to pull: a read chat
        // still gets a page so it has a room, a name, and a last line.
        const history = await this.#relay<
          RelayMessage[] | { rows?: RelayMessage[] }
        >(
          `/chat/${encodeURIComponent(chatId)}/history?limit=${Math.min(50, Math.max(count, BACKFILL_MIN))}`,
        ).catch((): RelayMessage[] => []);
        const messages = (
          Array.isArray(history) ? history : (history.rows ?? [])
        ).sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
        const face = avatarUrlOf(chat);
        for (const item of messages)
          await this.#ingest({
            ...item,
            chatId: item.chatId ?? item.chat_id ?? chatId,
            chatName: item.chatName ?? item.chat_name ?? chat.display_name,
            isGroup:
              item.isGroup ??
              item.is_group ??
              chatIsGroup,
            display_name: chat.display_name,
            // The chat list knows the conversation's picture even when a single
            // message does not carry one.
            ...(face && !avatarUrlOf(item) ? { avatar: face } : {}),
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
      ).catch((error: unknown) =>
        this.#log(`[wechat] read state failed: ${message(error)}`),
      );
    }
  }

  /**
   * Marks a portal read up to whatever WeChat still counts as unread. The
   * receipt is sent as the user rather than as a ghost — this server lets a
   * bridge speak for the account it bridges for, which is what makes the count
   * clear in Polymux and anywhere else reading the same room.
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
      { method: "POST", as: this.#owner, body: {} },
    );
    this.#state.readReceipts = {
      ...(this.#state.readReceipts ?? {}),
      [chatId]: target,
    };
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

  /**
   * Follows the relay's event stream while the relay is connected to WeChat.
   * A stream can end because of a brief transport interruption, in which case
   * reconnecting is useful. Once the relay itself reports that WeChat is
   * disconnected, retrying cannot recover anything and only floods the log.
   */
  async #consume(generation: number): Promise<void> {
    let attempt = 0;
    while (!this.#stopped && generation === this.#consumeGeneration) {
      try {
        const url = new URL("/messages/stream", this.#options.relayUrl);
        // Without `since` the relay replays its entire history on connect.
        url.searchParams.set("since", String(this.#state.lastRemoteTimestamp));
        this.#streaming = new AbortController();
        const response = await this.#fetch(url, {
          headers: this.#relayHeaders(),
          signal: this.#streaming.signal,
        });
        if (!response.ok || !response.body)
          throw new Error(`stream returned ${response.status}`);
        attempt = 0;
        this.#streamConnectAt = Date.now();
        // A photo may have become readable while the relay was disconnected.
        // Probe immediately rather than making it wait for its old CDN
        // backoff. The retry path starts heap-only, so this does not block the
        // stream on another long CDN-capture window.
        void this.#retryPendingImages().catch((error: unknown) =>
          this.#log(`[wechat] image reconnect retry failed: ${message(error)}`),
        );
        for await (const payload of serverSentEvents(response.body))
          await this.#ingest(JSON.parse(payload) as RelayMessage).catch(
            (error: unknown) =>
              this.#log(`[wechat] inbound event failed: ${message(error)}`),
          );
        throw new Error("stream ended");
      } catch (error) {
        if (this.#stopped || generation !== this.#consumeGeneration) return;
        if (this.#writerPaused) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        const health = await this.#relayStatus();
        if (health && health !== "connected") {
          this.#log(
            `[wechat] stream stopped: relay is ${health}`,
          );
          // A remembered WeChat session can be relaunched hidden. If login
          // needs attention, the Hub reports that instead of stealing focus.
          if (await this.#ensureAppRunning()) {
            if (await this.#waitForRelay()) {
              attempt = 0;
              continue;
            }
          }
          return;
        }
        const ownedRelayStopped =
          this.#relayProcess !== null && !childProcessIsRunning(this.#relayProcess);
        // A crash or a native-writer interruption can remove the loopback
        // relay entirely. Network backoff cannot revive a process, so restart
        // the exact supervised child and then reopen the stream. An external
        // relay gets one normal retry before Polymux takes over supervision.
        if (health === null && (ownedRelayStopped || (!this.#relayProcess && attempt > 0))) {
          this.#log("[wechat] local relay stopped; restarting it.");
          await this.#ensureAppRunning();
          if (await this.#startRelay()) {
            attempt = 0;
            continue;
          }
        }
        const wait = RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)];
        attempt += 1;
        this.#log(
          `[wechat] stream unavailable: ${message(error)}; retrying in ${wait}ms`,
        );
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
      const inReplay =
        this.#importing || Date.now() - this.#streamConnectAt < REPLAY_GUARD_MS;
      if (inReplay) return;
    }

    // Whether the account sent this, from anywhere — this app, the phone, or
    // WeChat on the desk. The relay only marks its own sends and system
    // notices, so a message typed in WeChat itself came through as the
    // contact's: the conversation showed one side of itself twice and none of
    // the user's own words.
    const notice =
      item.messageKind === "system" || item.messageKind === "recalled";
    const mine =
      !notice &&
      (Boolean(item.fromSelf) || (await this.#sentByAccount(chatId, item)));

    // Media sent through the shared Hub composer already exists in Matrix.
    // WeChat streams its accepted copy back afterward; consume that echo rather
    // than drawing the same attachment twice.
    const echoedMedia =
      relayMediaType(item.messageKind) ??
      (String(item.body ?? "").includes("<refermsg>") ? "reply" : null);
    if (mine && echoedMedia) {
      // A reply echo carries its authored text in the appmsg <title>; match on
      // it so an unrelated self message that merely contains "<refermsg>" (a
      // phone-typed quote, a forwarded card) cannot consume the pending echo.
      const decodedReplyBody =
        echoedMedia === "reply" ? unescapeXml(String(item.body ?? "")) : "";
      const index = (this.#state.outboundMediaEchoes ?? []).findIndex(
        (echo) =>
          echo.chatId === chatId &&
          echo.kind === echoedMedia &&
          Date.now() - echo.timestamp < ECHO_TTL_MS &&
          (echoedMedia !== "reply" ||
            echo.body === undefined ||
            decodedReplyBody.includes(echo.body)),
      );
      if (index >= 0) {
        const [echo] = this.#state.outboundMediaEchoes?.splice(index, 1) ?? [];
        this.#consumeOutboundOperation(echo?.operationId);
        this.#carried(remoteId, fields);
        return;
      }
    }

    // Our own send, coming back around. Matched on content rather than id
    // because the relay assigns its own once WeChat accepts it.
    if (mine) {
      const body = bodyOf(item);
      const index = this.#state.outboundEchoes.findIndex(
        (echo) =>
          echo.chatId === chatId &&
          echo.body === body &&
          Date.now() - echo.timestamp < ECHO_TTL_MS,
      );
      if (index >= 0) {
        const [echo] = this.#state.outboundEchoes.splice(index, 1);
        this.#consumeOutboundOperation(echo.operationId);
        this.#carried(remoteId, fields);
        return;
      }
    }

    const roomId = await this.#portal(chatId, item);
    let sender = this.#owner;
    if (notice) {
      sender = this.botId;
    } else if (!mine) {
      const remoteSender = item.senderId || item.senderName || chatId;
      sender = this.#puppet(remoteSender);
      this.#state.puppetRemoteIds = {
        ...(this.#state.puppetRemoteIds ?? {}),
        [sender]: remoteSender,
      };
      this.#save();
      await this.#ensureVirtualUser(
        sender,
        senderDisplayName(item, this.#state.rooms[chatId]?.name),
      );
      const face = avatarUrlOf(item);
      if (face) await this.#setPuppetAvatar(sender, face);
      // Otherwise the picture WeChat itself holds for them, which is the only
      // place today's relay leaves one.
      else
        await this.#applyLocalAvatar({ user: sender }, item.senderId || chatId);
      await this.#join(roomId, sender);
    }
    // Stamped with when WeChat says it was sent, not when we imported it.
    // Without this an import lands a week of history all at the current
    // moment: every conversation shows the same time and the list cannot be
    // ordered by recency — which is not how the same list looks for a mautrix
    // bridge, and those two lists are meant to be the same list.
    const sentAt = originalTimestamp(item);
    const { content, retryImage } = await this.#content(chatId, item);
    const posted = await this.#matrix<{ event_id?: string }>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(`wechat-${randomUUID()}`)}${sentAt ? `?ts=${sentAt}` : ""}`,
      {
        method: "PUT",
        as: sender,
        body: {
          ...content,
          "co.polymux.wechat.remote": true,
          ...(notice ? { "co.polymux.notice": true } : {}),
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
    if (posted?.event_id && remoteId) {
      this.#state.remoteMessageIds = {
        ...(this.#state.remoteMessageIds ?? {}),
        [posted.event_id]: remoteId,
      };
    }
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
  ): Promise<{ content: Record<string, unknown>; retryImage?: string }> {
    if (item.messageKind === "location") {
      const location = weChatLocation(String(item.body ?? ""));
      if (location)
        return {
          content: {
            msgtype: "m.location",
            body: location.label,
            geo_uri: location.geoUri,
            "m.location": {
              uri: location.geoUri,
              description: location.label,
            },
          },
        };
    }
    // A sticker's body is the `<emoji>` document WeChat sends, and that
    // document names where the picture is: an ordinary CDN url that needs no
    // credentials. Carrying it across turns "[Sticker]" into the sticker.
    if (item.messageKind === "emoticon") {
      const media = await this.#sticker(item).catch((error: unknown): null => {
        this.#log(`[wechat] sticker not retrievable: ${message(error)}`);
        return null;
      });
      if (media)
        return {
          content: {
            msgtype: "m.image",
            body: "Sticker",
            url: media.uri,
            info: {
              mimetype: media.mimeType,
              size: media.size,
              ...(media.width ? { w: media.width } : {}),
              ...(media.height ? { h: media.height } : {}),
            },
            // Marks what it actually is, for anything that cares to tell a
            // sticker from a photo. It renders as a picture either way.
            "co.polymux.sticker": true,
          },
        };
    }
    if (item.messageKind === "image" && item.messageId) {
      const messageId = String(item.messageId);
      const media = await this.#imageOrThumbnail(chatId, messageId).catch(
        (error: unknown): null => {
          // Once per picture, not once per attempt: the retries below are quiet,
          // and this line is worth reading because it carries WeChat's own advice.
          if (!this.#state.pendingImages?.[`${chatId}:${messageId}`])
            this.#log(
              `[wechat] image ${messageId} not retrievable yet: ${message(error)}`,
            );
          return null;
        },
      );
      if (media)
        return {
          content: {
            msgtype: "m.image",
            body: media.name,
            url: media.uri,
            info: { mimetype: media.mimeType, size: media.size },
          },
        };
      // Carried back so the caller can note where the placeholder landed.
      return { content: this.#placeholder(item), retryImage: messageId };
    }
    if (
      (item.messageKind === "voice" || item.messageKind === "audio") &&
      item.messageId
    ) {
      const messageId = String(item.messageId);
      const media = await this.#audio(messageId).catch(
        (error: unknown): null => {
          this.#log(
            `[wechat] voice ${messageId} not retrievable: ${message(error)}`,
          );
          return null;
        },
      );
      if (media)
        return {
          content: {
            msgtype: "m.audio",
            body: media.name,
            url: media.uri,
            info: { mimetype: media.mimeType, size: media.size },
          },
        };
    }
    const relayKind = relayMediaType(item.messageKind);
    if (relayKind === "video" || relayKind === "file") {
      const media = await this.#relayAttachment(item, relayKind).catch(
        (error: unknown): null => {
          this.#log(`[wechat] ${relayKind} not retrievable: ${message(error)}`);
          return null;
        },
      );
      if (media)
        return {
          content: {
            msgtype: relayKind === "video" ? "m.video" : "m.file",
            body: media.name,
            filename: media.name,
            url: media.uri,
            info: { mimetype: media.mimeType, size: media.size },
          },
        };
    }
    return { content: this.#placeholder(item) };
  }

  /**
   * What stands in for media that could not be brought across. It is still
   * readable *somewhere* — in WeChat itself — so the placeholder carries the
   * way to open it rather than leaving a bare "[Photo]" with nowhere to go.
   * For an image that is also what makes it readable here later: opening it in
   * WeChat is exactly what lets the retry below succeed.
   */
  #placeholder(item: RelayMessage): Record<string, unknown> {
    const kind = item.messageKind ?? "";
    const body = visibleWeChatText(bodyOf(item));
    const describedBody = String(item.body ?? "").trim();
    const remoteMedia = remoteAttachment(kind, describedBody || body);
    const preview = richPreview(kind, describedBody);
    return {
      msgtype: remoteMedia?.msgtype ?? "m.text",
      body: remoteMedia?.name ?? body,
      ...(remoteMedia?.filename ? { filename: remoteMedia.filename } : {}),
      ...(remoteMedia?.size ? { info: { size: remoteMedia.size } } : {}),
      ...(preview ? { "co.polymux.link_preview": preview } : {}),
      ...(CARRIES_MEDIA.has(kind) || item.hasMedia
        ? { "co.polymux.view_in": { app: "WeChat", url: "weixin://" } }
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
    this.#selfId =
      rows[0]?.real_sender_id != null ? String(rows[0].real_sender_id) : null;
    if (!this.#selfId)
      this.#log("[wechat] could not tell which messages are the account's own");
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
    this.#selfSent.set(chatId, { at: Date.now(), timestamps });
    return timestamps;
  }

  /** A slice of a conversation as WeChat's own store holds it. */
  async #cliHistory(
    chatId: string,
    limit: number,
  ): Promise<
    Array<{ create_time?: number; real_sender_id?: string | number }>
  > {
    for (const cli of this.#cliPaths()) {
      const result = (await run(
        cli,
        [
          "history",
          chatId,
          "--json",
          "-n",
          String(limit),
          "--fields",
          "create_time,real_sender_id",
        ],
        { timeout: SELF_SENT_TIMEOUT_MS },
      ).catch((): null => null)) as { stdout: string } | null;
      if (!result) continue;
      try {
        const parsed = JSON.parse(result.stdout) as
          | Array<{ create_time?: number; real_sender_id?: string | number }>
          | {
              rows?: Array<{
                create_time?: number;
                real_sender_id?: string | number;
              }>;
            };
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
  async #sticker(item: RelayMessage): Promise<{
    uri: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
  } | null> {
    const body = item.body ?? "";
    const url = unescapeXml(/cdnurl\s*=\s*"([^"]+)"/i.exec(body)?.[1] ?? "");
    if (!/^https?:\/\//i.test(url)) return null;
    const response = await this.#fetch(url, {
      signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`sticker returned ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_STICKER_BYTES)
      return null;
    // The CDN answers `application/octet-stream` whatever it is holding, so
    // the bytes themselves have to say.
    const mimeType = imageTypeOf(bytes);
    if (!mimeType) return null;
    const md5 = createHash("md5").update(bytes).digest("hex");
    const reference = emojiElement(body);
    if (reference && emojiMd5(reference) === md5) {
      this.#state.stickerReferences = {
        ...(this.#state.stickerReferences ?? {}),
        [md5]: { xml: reference, seenAt: Date.now() },
      };
      this.#save();
    }
    const registration = await this.#registration_();
    const upload = await this.#fetch(
      new URL(
        "/_matrix/media/v3/upload?filename=sticker",
        this.#options.homeserver.baseUrl,
      ),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${registration.asToken}`,
          "Content-Type": mimeType,
        },
        body: bytes as unknown as BodyInit,
      },
    );
    if (!upload.ok) throw new Error(`upload returned ${upload.status}`);
    const { content_uri: uri } = (await upload.json()) as {
      content_uri: string;
    };
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
    from: "auto" | "heap" = "auto",
    variant: "mid" | "thumb" = "mid",
  ): Promise<UploadedWeChatImage | null> {
    const target = path.join(
      tmpdir(),
      `polymux-wechat-${randomBytes(8).toString("hex")}.bin`,
    );
    let extracted: {
      mime?: string;
      absolutePath?: string;
      error?: string;
    } | null = null;
    for (const cli of this.#cliPaths()) {
      const result = (await run(
        cli,
        [
          "image",
          "get",
          messageId,
          "--chat",
          chatId,
          "--out",
          target,
          "--from",
          from,
          "--variant",
          variant,
          "--json",
        ],
        { timeout: MEDIA_TIMEOUT_MS },
      ).catch((): null => null)) as { stdout: string } | null;
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
    if (extracted?.error)
      throw new Error(extracted.error.replace(/\s*\n\s*/g, " — "));
    if (!extracted) return null;
    // Where it says it put the file, not where it was asked to: a decrypt that
    // falls back to the CDN path writes into its own cache instead.
    const file = extracted.absolutePath ?? target;
    const bytes = await readFile(file);
    await rm(file, { force: true }).catch((): undefined => undefined);
    const mimeType = extracted.mime ?? "image/jpeg";
    const registration = await this.#registration_();
    const upload = await this.#fetch(
      new URL(
        `/_matrix/media/v3/upload?filename=${encodeURIComponent(`wechat-${messageId}`)}`,
        this.#options.homeserver.baseUrl,
      ),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${registration.asToken}`,
          "Content-Type": mimeType,
        },
        body: new Uint8Array(bytes),
      },
    );
    if (!upload.ok) throw new Error(`upload returned ${upload.status}`);
    const { content_uri: uri } = (await upload.json()) as {
      content_uri: string;
    };
    return {
      uri,
      name: `wechat-${messageId}.jpg`,
      mimeType,
      size: bytes.length,
    };
  }

  /**
   * Prefer the normal-size photo, but accept WeChat's thumbnail when that is
   * all the running client has decrypted. A real picture is materially better
   * than a permanent `[Photo]` placeholder; the heap-only thumbnail attempt is
   * bounded and never opens another CDN-capture window.
   */
  async #imageOrThumbnail(
    chatId: string,
    messageId: string,
    from: "auto" | "heap" = "auto",
  ): Promise<UploadedWeChatImage | null> {
    let originalError: unknown;
    try {
      return await this.#image(chatId, messageId, from, "mid");
    } catch (error) {
      originalError = error;
    }
    try {
      return await this.#image(chatId, messageId, "heap", "thumb");
    } catch {
      throw originalError;
    }
  }

  /** Carries the exact SILK_V3 payload WeChat stores for a voice message. */
  async #audio(messageId: string): Promise<{
    uri: string;
    name: string;
    mimeType: string;
    size: number;
  } | null> {
    const target = path.join(
      tmpdir(),
      `polymux-wechat-${randomBytes(8).toString("hex")}.silk`,
    );
    try {
      let extracted = false;
      for (const cli of this.#cliPaths()) {
        const result = await run(
          cli,
          ["audio", "get", messageId, "--out", target, "--json"],
          { timeout: MEDIA_TIMEOUT_MS },
        ).catch((): null => null);
        if (!result) continue;
        const answer = JSON.parse(result.stdout || "{}") as { error?: string };
        if (answer.error) throw new Error(answer.error);
        extracted = true;
        break;
      }
      if (!extracted) return null;
      const bytes = await readFile(target);
      if (bytes.byteLength === 0) return null;
      const mimeType = "audio/silk";
      const registration = await this.#registration_();
      const upload = await this.#fetch(
        new URL(
          `/_matrix/media/v3/upload?filename=${encodeURIComponent(`wechat-${messageId}.silk`)}`,
          this.#options.homeserver.baseUrl,
        ),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${registration.asToken}`,
            "Content-Type": mimeType,
          },
          body: new Uint8Array(bytes),
        },
      );
      if (!upload.ok) throw new Error(`upload returned ${upload.status}`);
      const { content_uri: uri } = (await upload.json()) as {
        content_uri: string;
      };
      return {
        uri,
        name: `wechat-${messageId}.silk`,
        mimeType,
        size: bytes.length,
      };
    } finally {
      await rm(target, { force: true }).catch((): undefined => undefined);
    }
  }

  /** Uploads bytes the relay already resolved for a file or video message. */
  async #relayAttachment(
    item: RelayMessage,
    kind: "video" | "file",
  ): Promise<{
    uri: string;
    name: string;
    mimeType: string;
    size: number;
  } | null> {
    const described = remoteAttachment(
      item.messageKind ?? "",
      String(item.body ?? ""),
    );
    const name =
      item.media?.filename ||
      described?.filename ||
      described?.name ||
      (kind === "video" ? "Video.mp4" : "File");
    const declaredMime = item.media?.mimeType || item.media?.mime;
    let bytes: Uint8Array;
    let mimeType =
      declaredMime ||
      (kind === "video" ? "video/mp4" : "application/octet-stream");
    const local =
      item.localPath || item.media?.localPath || item.media?.local_path;
    if (local) {
      const resolved = await realpath(local);
      const roots = await Promise.all(
        this.#mediaRoots().map((root) => realpath(root).catch(() => root)),
      );
      if (
        !roots.some(
          (root) =>
            resolved === root || resolved.startsWith(`${root}${path.sep}`),
        )
      )
        throw new Error("relay media path is outside WeChat's allowed roots");
      const info = await stat(resolved);
      if (!info.isFile() || info.size <= 0 || info.size > MAX_RELAY_MEDIA_BYTES)
        throw new Error("relay media file has an invalid size");
      bytes = new Uint8Array(await readFile(resolved));
    } else {
      const candidates = [
        ...(item.mediaUrls ?? []),
        ...(item.media?.urls ?? []),
        item.media?.url,
      ].filter(
        (value): value is string =>
          typeof value === "string" && /^https?:\/\//i.test(value),
      );
      const url = candidates[0];
      if (!url) return null;
      const response = await this.#fetch(url, {
        signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
      });
      if (!response.ok)
        throw new Error(`media download returned ${response.status}`);
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_RELAY_MEDIA_BYTES)
        throw new Error("relay media download is too large");
      bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_RELAY_MEDIA_BYTES)
        throw new Error("relay media download has an invalid size");
      mimeType =
        declaredMime || response.headers.get("content-type") || mimeType;
    }
    const registration = await this.#registration_();
    const upload = await this.#fetch(
      new URL(
        `/_matrix/media/v3/upload?filename=${encodeURIComponent(name)}`,
        this.#options.homeserver.baseUrl,
      ),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${registration.asToken}`,
          "Content-Type": mimeType,
        },
        body: bytes as unknown as BodyInit,
      },
    );
    if (!upload.ok) throw new Error(`upload returned ${upload.status}`);
    const { content_uri: uri } = (await upload.json()) as {
      content_uri: string;
    };
    return { uri, name, mimeType, size: bytes.byteLength };
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
      const response = await this.#fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`avatar returned ${response.status}`);
      const mimeType = response.headers.get("content-type") ?? "image/jpeg";
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error("avatar was empty");
      const registration = await this.#registration_();
      const upload = await this.#fetch(
        new URL(
          "/_matrix/media/v3/upload?filename=avatar",
          this.#options.homeserver.baseUrl,
        ),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${registration.asToken}`,
            "Content-Type": mimeType,
          },
          body: bytes,
        },
      );
      if (!upload.ok) throw new Error(`upload returned ${upload.status}`);
      const { content_uri: uri } = (await upload.json()) as {
        content_uri: string;
      };
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
    if (!this.#headImages)
      this.#headImages = loadHeadImages({ log: (line) => this.#log(line) });
    const bytes = (await this.#headImages).get(username);
    if (!bytes) return null;
    const uri = await this.#uploadAvatar(bytes, "image/jpeg");
    if (!uri) return null;
    this.#state.avatarUris = {
      ...(this.#state.avatarUris ?? {}),
      [username]: uri,
    };
    this.#save();
    return uri;
  }

  /**
   * Puts WeChat's picture for `username` on a room or a puppet, at most once
   * each. Rooms opened before this existed are covered too: applying is keyed
   * on the target rather than on the moment the portal was made.
   */
  async #applyLocalAvatar(
    target: { room?: string; user?: string },
    username: string,
  ): Promise<void> {
    const key = target.room ? `room:${target.room}` : `user:${target.user}`;
    if (this.#state.avatarsApplied?.[key]) return;
    const uri = await this.#localAvatar(username);
    if (!uri) return;
    const request = target.room
      ? this.#matrix(
          `/_matrix/client/v3/rooms/${encodeURIComponent(target.room)}/state/m.room.avatar/`,
          { method: "PUT", as: this.botId, body: { url: uri } },
        )
      : this.#matrix(
          `/_matrix/client/v3/profile/${encodeURIComponent(target.user ?? "")}/avatar_url`,
          { method: "PUT", as: target.user, body: { avatar_url: uri } },
        );
    const done = await request.then(() => true).catch(() => false);
    if (!done) return;
    this.#state.avatarsApplied = {
      ...(this.#state.avatarsApplied ?? {}),
      [key]: true,
    };
    this.#save();
  }

  /**
   * Gives the conversations already open the pictures they never had. Without
   * this only rooms created from here on would get one, which for an account
   * that has been bridged for a while is none of them.
   */
  async #syncRoomAvatars(): Promise<void> {
    for (const [chatId, room] of Object.entries(this.#state.rooms))
      await this.#applyLocalAvatar({ room: room.roomId }, chatId).catch(
        (error: unknown) =>
          this.#log(
            `[wechat] avatar for ${room.roomId} failed: ${message(error)}`,
          ),
      );
  }

  /** Puts bytes in the media repository and returns their `mxc://` id. */
  async #uploadAvatar(
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<string | null> {
    try {
      const registration = await this.#registration_();
      const upload = await this.#fetch(
        new URL(
          "/_matrix/media/v3/upload?filename=avatar",
          this.#options.homeserver.baseUrl,
        ),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${registration.asToken}`,
            "Content-Type": mimeType,
          },
          body: new Uint8Array(bytes),
        },
      );
      if (!upload.ok) throw new Error(`upload returned ${upload.status}`);
      const { content_uri: uri } = (await upload.json()) as {
        content_uri: string;
      };
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
    await this.#matrix(
      `/_matrix/client/v3/profile/${encodeURIComponent(userId)}/avatar_url`,
      {
        method: "PUT",
        as: userId,
        body: { avatar_url: uri },
      },
    ).catch((): undefined => undefined);
  }

  /** Puts a conversation's picture on its portal, so the chat list shows it. */
  async #setRoomAvatar(roomId: string, url: string): Promise<void> {
    const uri = await this.#avatarMedia(url);
    if (!uri) return;
    await this.#matrix(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.avatar/`,
      { method: "PUT", as: this.botId, body: { url: uri } },
    ).catch((): undefined => undefined);
  }

  /** The portal room for a conversation, created on first sight of it. */
  async #portal(chatId: string, item: RelayMessage): Promise<string> {
    const known = this.#state.rooms[chatId];
    const resolvedName = conversationName(item);
    const name = String(resolvedName ?? "WeChat").slice(0, 80);
    if (known) {
      if (resolvedName && known.name !== name) {
        known.name = name;
        this.#save();
      }
      return known.roomId;
    }
    const pending = this.#portalTasks.get(chatId);
    if (pending) return await pending;
    const task = this.#createPortal(chatId, item);
    this.#portalTasks.set(chatId, task);
    try {
      return await task;
    } finally {
      if (this.#portalTasks.get(chatId) === task)
        this.#portalTasks.delete(chatId);
    }
  }

  async #createPortal(chatId: string, item: RelayMessage): Promise<string> {
    const resolvedName = conversationName(item);
    const name = String(resolvedName ?? "WeChat").slice(0, 80);
    const channelId = createHash("sha256")
      .update(chatId)
      .digest("hex")
      .slice(0, 24);
    const recovered = (await this.#existingPortals()).get(channelId);
    if (recovered) {
      this.#state.rooms[chatId] = {
        roomId: recovered,
        isGroup: Boolean(item.isGroup),
        ...(resolvedName ? {name} : {}),
      };
      this.#state.roomToChat[recovered] = chatId;
      this.#save();
      return recovered;
    }
    const created = await this.#matrix<{ room_id: string }>(
      "/_matrix/client/v3/createRoom",
      {
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
              // Polymux files these rooms under WeChat by the identical rule it
              // uses for WhatsApp — no WeChat-specific case anywhere upstream.
              type: "m.bridge",
              state_key: `${this.#options.homeserver.serverName}/wechat`,
              content: {
                bridgebot: this.botId,
                protocol: { id: "wechat", displayname: "WeChat" },
                "com.beeper.room_type": item.isGroup ? "group" : "dm",
                channel: {
                  id: channelId,
                },
              },
            },
          ],
        },
      },
    );
    await this.#matrix(
      `/_matrix/client/v3/join/${encodeURIComponent(created.room_id)}`,
      {
        method: "POST",
        as: this.#owner,
        body: {},
      },
    ).catch((): undefined => undefined);
    const face = avatarUrlOf(item);
    if (face) await this.#setRoomAvatar(created.room_id, face);
    else await this.#applyLocalAvatar({ room: created.room_id }, chatId);
    this.#state.rooms[chatId] = {
      roomId: created.room_id,
      isGroup: Boolean(item.isGroup),
      ...(resolvedName ? { name } : {}),
    };
    this.#state.roomToChat[created.room_id] = chatId;
    this.#save();
    return created.room_id;
  }

  /**
   * Rebuilds the disposable chat-id routing map from bridge-attested Matrix
   * state. Losing or resetting state.json must not create a second room for
   * every WeChat conversation. If an older run already left duplicates, the
   * newest portal wins and the older history remains readable.
   */
  async #existingPortals(): Promise<Map<string, string>> {
    if (!this.#portalRecovery)
      this.#portalRecovery = (async () => {
        type PortalStateEvent = {
          type?: string;
          origin_server_ts?: number;
          content?: {
            protocol?: {id?: string};
            channel?: {id?: string};
          };
        };
        const joined = await this.#matrix<{joined_rooms?: string[]}>(
          "/_matrix/client/v3/joined_rooms",
          {as: this.#owner},
        ).catch((): {joined_rooms: string[]} => ({joined_rooms: []}));
        const portals = new Map<string, {roomId: string; createdAt: number}>();
        for (const roomId of joined.joined_rooms ?? []) {
          const state = await this.#matrix<PortalStateEvent[]>(
            `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state`,
            {as: this.#owner},
          ).catch((): PortalStateEvent[] => []);
          const bridge = state.find((event) => event.type === "m.bridge")?.content;
          const channelId = bridge?.channel?.id;
          if (bridge?.protocol?.id !== "wechat" || !channelId) continue;
          const createdAt =
            state.find((event) => event.type === "m.room.create")
              ?.origin_server_ts ?? 0;
          const previous = portals.get(channelId);
          if (!previous || createdAt >= previous.createdAt)
            portals.set(channelId, {roomId, createdAt});
        }
        return new Map(
          [...portals].map(([channelId, portal]) => [channelId, portal.roomId]),
        );
      })();
    return await this.#portalRecovery;
  }

  /**
   * A stable Matrix id for a WeChat contact. Hashed rather than carried
   * through: a wxid is a real identifier, and a room id is not the place to
   * spend one.
   */
  #puppet(remoteId: string): string {
    const digest = createHash("sha256")
      .update(String(remoteId))
      .digest("hex")
      .slice(0, 24);
    return `@wechat_${digest}:${this.#options.homeserver.serverName}`;
  }

  async #ensureVirtualUser(userId: string, displayName: string): Promise<void> {
    const profile = `/_matrix/client/v3/profile/${encodeURIComponent(userId)}`;
    const known = await this.#matrix<{ displayname?: string }>(profile).catch(
      (): null => null,
    );
    const wanted = displayName.slice(0, 100);
    if (known?.displayname === wanted) return;
    // A message that arrived without a sender name must not rename someone the
    // bridge has already learned: one anonymous line would turn a whole group
    // conversation back into "WeChat contact".
    if (known?.displayname && wanted === UNKNOWN_SENDER) return;
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
      body: { displayname: wanted },
    }).catch((): undefined => undefined);
  }

  async #join(roomId: string, userId: string): Promise<void> {
    this.#state.joinedVirtual[roomId] ??= {};
    if (this.#state.joinedVirtual[roomId][userId]) return;
    const room = encodeURIComponent(roomId);
    await this.#matrix(`/_matrix/client/v3/rooms/${room}/invite`, {
      method: "POST",
      as: this.botId,
      body: {
        user_id: userId,
        // This puppet joins only so Polymux can attribute WeChat messages.
        // Native WeChat join notices arrive separately as conversation events.
        "com.beeper.exclude_from_timeline": true,
      },
    }).catch((): undefined => undefined);
    await this.#matrix(`/_matrix/client/v3/join/${room}`, {
      method: "POST",
      as: userId,
      body: {"com.beeper.exclude_from_timeline": true},
    }).catch((): undefined => undefined);
    this.#state.joinedVirtual[roomId][userId] = true;
    this.#save();
  }

  // ---- outbound: Matrix to WeChat -----------------------------------------

  async #relayOutbound(event: MatrixEvent): Promise<void> {
    if (event.sender !== this.#owner) return;
    const chatId = this.#state.roomToChat[event.room_id ?? ""];
    if (!chatId) return;

    if (event.type === "m.room.redaction") {
      const target =
        event.redacts && this.#state.remoteMessageIds?.[event.redacts];
      if (!target) return;
      const clientMessageId = event.redacts
        ? this.#state.remoteMessageClientIds?.[event.redacts]
        : undefined;
      await this.#write({
        kind: "recall",
        chatId,
        messageId: target,
        ...(clientMessageId ? {clientMessageId} : {}),
      });
      return;
    }
    if (event.type === "m.receipt") {
      await this.#write({ kind: "read", chatId });
      return;
    }
    if (
      (event.type !== "m.room.message" && event.type !== "m.sticker") ||
      // Anything this bridge itself posted; relaying it back would loop.
      event.content?.["co.polymux.wechat.remote"]
    )
      return;

    const mediaType =
      event.type === "m.sticker" || event.content?.["co.polymux.sticker"] === true
        ? "sticker"
        : matrixMediaType(event.content?.msgtype);
    if (mediaType && typeof event.content?.url === "string") {
      const delivery = await this.#sendMedia(
        chatId,
        event.content.url,
        String(event.content.body ?? mediaType),
        mediaType,
        String(
          (event.content.info as { mimetype?: string } | undefined)?.mimetype ??
            "",
        ),
      );
      this.#rememberOutboundMessageId(event.event_id, delivery);
      return;
    }
    if (event.content?.msgtype === "m.location") {
      const label =
        String(event.content.body ?? "Location").trim() || "Location";
      const geo = String(
        event.content.geo_uri ??
          (event.content["m.location"] as { uri?: string } | undefined)?.uri ??
          "",
      ).trim();
      const delivery = await this.#sendOutboundText(
        chatId,
        geo && geo !== label ? `${label}\n${geo}` : label,
      );
      this.#rememberOutboundMessageId(event.event_id, delivery);
      return;
    }
    if (event.content?.msgtype !== "m.text") return;
    const authored = String(event.content?.body ?? "").trim();
    if (!authored) return;
    const replyEventId = replyEvent(event);
    const replyTo = replyEventId
      ? this.#state.remoteMessageIds?.[replyEventId]
      : undefined;
    const rendered = await this.#outboundText(event, authored);
    const mentions = matrixMentionIds(event)
      .map((userId) => this.#state.puppetRemoteIds?.[userId])
      .filter((userId): userId is string => Boolean(userId));
    // A native refermsg can preserve an exact reply only when it does not also
    // need WeChat's at-user list. Mentions stay on the daemon-owned route so a
    // person actively using WeChat is never paused by an LLDB writer.
    const nativeReply = Boolean(
      this.#options.writer && replyTo && mentions.length === 0,
    );
    const body = nativeReply ? authored : rendered.body;
    const delivery = await this.#sendOutboundText(
      chatId,
      body,
      replyTo,
      mentions,
      nativeReply ? rendered.body : undefined,
      nativeReply ? rendered.replyContext : undefined,
    );
    this.#rememberOutboundMessageId(event.event_id, delivery);
  }

  async #sendOutboundText(
    chatId: string,
    body: string,
    replyTo?: string,
    mentions: string[] = [],
    fallbackBody?: string,
    replyContext?: {body: string; sender: string; createTime: number},
  ): Promise<WeChatWriteResult> {
    const writeWithNative = async (): Promise<WeChatWriteResult> => {
      if (!this.#options.writer)
        throw new Error("WeChat native text writing is unavailable");
      const operationId = randomUUID();
      const pendingReply = replyTo
        ? {
            chatId,
            kind: "reply" as const,
            timestamp: Date.now(),
            body,
            operationId,
          }
        : undefined;
      const pendingText = {
        chatId,
        body: fallbackBody ?? body,
        timestamp: Date.now(),
        operationId,
      };
      if (pendingReply) {
        this.#state.outboundMediaEchoes ??= [];
        this.#state.outboundMediaEchoes.push(pendingReply);
      }
      this.#state.outboundEchoes.push(pendingText);
      this.#save();
      try {
        const result = await this.#write({
          kind: "text",
          chatId,
          body,
          ...(replyTo ? { replyTo } : {}),
          ...(replyTo && fallbackBody ? { fallbackBody } : {}),
          ...(replyTo && replyContext ? {replyContext} : {}),
          ...(mentions.length ? { mentions: [...new Set(mentions)] } : {}),
        });
        return result;
      } catch (error) {
        this.#consumeOutboundOperation(operationId);
        this.#save();
        throw error;
      }
    };

    // Replies without mentions need the exact native refermsg packet. Plain
    // text first uses the daemon below and falls back to this writer only when
    // WeChat says its hidden UI signal chain is cold.
    if (this.#options.writer && replyTo && mentions.length === 0)
      return await writeWithNative();

    if (mentions.length) {
      const args = ["send", body, "--wxid", chatId, "--json"];
      for (const mention of new Set(mentions)) args.push("--mention", mention);
      for (const cli of this.#cliPaths()) {
        const result = await run(cli, args, {
          timeout: MEDIA_SEND_TIMEOUT_MS,
        }).catch((): null => null);
        if (!result) continue;
        const answer = JSON.parse(result.stdout || "{}") as {
          error?: string;
          delivered_verified?: boolean;
        };
        if (answer.error) throw new Error(answer.error);
        if (answer.delivered_verified !== true)
          throw new Error(
            "WeChat did not verify that it delivered the mention",
          );
        this.#state.outboundEchoes.push({
          chatId,
          body,
          timestamp: Date.now(),
        });
        this.#save();
        return {deliveredVerified: true};
      }
      throw new Error("WeChat native mentions are unavailable");
    }
    const send = (): Promise<RelaySendResult> =>
      this.#relay<RelaySendResult>("/send", {
        method: "POST",
        body: {chatId, message: body},
      });
    let result = await send();
    if (
      result.success !== true &&
      result.ok !== true &&
      relayNeedsAppRelaunch(result) &&
      (await this.#ensureAppRunning())
    ) {
      await this.#waitForRelay();
      result = await send();
    }
    if (
      result.success !== true &&
      result.ok !== true &&
      relayNeedsBackgroundPrime(result) &&
      !this.#options.writer &&
      (await this.#primeApp())
    )
      result = await send();
    if (
      result.success !== true &&
      result.ok !== true &&
      relayNeedsBackgroundPrime(result) &&
      this.#options.writer
    )
      return await writeWithNative();
    if (result.success !== true && result.ok !== true)
      throw new Error(
        result.message || result.error || "the relay did not confirm delivery",
      );
    this.#state.outboundEchoes.push({ chatId, body, timestamp: Date.now() });
    this.#save();
    return {
      deliveredVerified: true,
      ...(result.messageId ? {messageId: result.messageId} : {}),
    };
  }

  /** Removes both possible echoes for one writer call once either arrives. */
  #consumeOutboundOperation(operationId?: string): void {
    if (!operationId) return;
    this.#state.outboundEchoes = this.#state.outboundEchoes.filter(
      (echo) => echo.operationId !== operationId,
    );
    this.#state.outboundMediaEchoes = (
      this.#state.outboundMediaEchoes ?? []
    ).filter((echo) => echo.operationId !== operationId);
  }

  #rememberOutboundMessageId(
    eventId: string | undefined,
    delivery: WeChatWriteResult,
  ): void {
    if (!eventId) return;
    if (delivery.messageId)
      this.#state.remoteMessageIds = {
        ...(this.#state.remoteMessageIds ?? {}),
        [eventId]: delivery.messageId,
      };
    if (delivery.clientMessageId)
      this.#state.remoteMessageClientIds = {
        ...(this.#state.remoteMessageClientIds ?? {}),
        [eventId]: delivery.clientMessageId,
      };
    if (!delivery.messageId && !delivery.clientMessageId) return;
    this.#save();
  }

  /** Painted fallback when no native writer can emit a refermsg packet. */
  async #outboundText(
    event: MatrixEvent,
    authored: string,
  ): Promise<{
    body: string;
    replyContext?: {body: string; sender: string; createTime: number};
  }> {
    const relation = event.content?.["m.relates_to"] as
      { "m.in_reply_to"?: { event_id?: string } } | undefined;
    const eventId = relation?.["m.in_reply_to"]?.event_id;
    if (!eventId || !event.room_id) return {body: authored};
    const quoted = await this.#matrix<MatrixEvent>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(event.room_id)}/event/${encodeURIComponent(eventId)}`,
    ).catch((): null => null);
    const quotedBody = String(quoted?.content?.body ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (!quotedBody) return {body: authored};
    const profile = quoted?.sender
      ? await this.#matrix<{ displayname?: string }>(
          `/_matrix/client/v3/profile/${encodeURIComponent(quoted.sender)}`,
        ).catch((): null => null)
      : null;
    const sender = profile?.displayname?.trim() || "Earlier message";
    return {
      body: `↳ ${sender}: ${quotedBody}\n${authored}`,
      replyContext: {
        body: quotedBody,
        sender,
        createTime: Math.max(
          1,
          Math.floor(Number(quoted?.origin_server_ts ?? Date.now()) / 1_000),
        ),
      },
    };
  }

  /** Downloads shared Matrix media and hands the same bytes to WeChat. */
  async #sendMedia(
    chatId: string,
    mxc: string,
    name: string,
    mediaType: "image" | "sticker" | "video" | "audio" | "file",
    mimeType = "",
  ): Promise<WeChatWriteResult> {
    const match = /^mxc:\/\/([^/]+)\/(.+)$/.exec(mxc);
    if (!match)
      throw new Error("the attachment has no downloadable Matrix media id");
    const registration = await this.#registration_();
    const response = await this.#fetch(
      new URL(
        `/_matrix/media/v3/download/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`,
        this.#options.homeserver.baseUrl,
      ),
      { headers: { Authorization: `Bearer ${registration.asToken}` } },
    );
    if (!response.ok)
      throw new Error(`attachment download returned ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error("the attachment was empty");
    const safeSuffix =
      path
        .extname(name)
        .replace(/[^.a-z0-9]/gi, "")
        .slice(0, 8) || mediaSuffix(mediaType);
    const target = path.join(
      tmpdir(),
      `polymux-wechat-send-${randomBytes(8).toString("hex")}${safeSuffix}`,
    );
    await writeFile(target, bytes, { mode: 0o600 });
    const pendingEcho = { chatId, kind: mediaType, timestamp: Date.now() };
    this.#state.outboundMediaEchoes ??= [];
    this.#state.outboundMediaEchoes.push(pendingEcho);
    this.#save();
    try {
      if (this.#options.writer) {
        const stickerReference =
          mediaType === "sticker"
            ? this.#state.stickerReferences?.[
                createHash("md5").update(bytes).digest("hex")
              ]?.xml
            : undefined;
        if (mediaType === "sticker" && !stickerReference)
          throw new Error(
            "this sticker is not in WeChat's native sticker catalog",
          );
        const result = await this.#write({
          kind: "media",
          chatId,
          mediaType,
          path: target,
          name,
          ...(mimeType ? { mimeType } : {}),
          ...(stickerReference ? { emojiXml: stickerReference } : {}),
        });
        return result;
      }
      // The helper's --image route decodes the input as an image. It does not
      // paste arbitrary file URLs despite earlier assumptions; live File
      // Transfer verification showed a text attachment produced no message.
      if (mediaType !== "image")
        throw new Error(`WeChat ${mediaType} sending needs the native writer`);
      for (const cli of this.#cliPaths()) {
        const result = await run(
          cli,
          ["send", name, "--image", target, "--wxid", chatId, "--json"],
          { timeout: MEDIA_SEND_TIMEOUT_MS },
        ).catch((): null => null);
        if (!result) continue;
        const answer = JSON.parse(result.stdout || "{}") as {
          error?: string;
          delivered_verified?: boolean;
        };
        if (answer.error) throw new Error(answer.error);
        if (answer.delivered_verified !== true)
          throw new Error(
            `WeChat did not verify that it delivered the ${mediaType}`,
          );
        return {deliveredVerified: true};
      }
      throw new Error(`WeChat ${mediaType} sending is unavailable`);
    } catch (error) {
      const index = this.#state.outboundMediaEchoes.indexOf(pendingEcho);
      if (index >= 0) this.#state.outboundMediaEchoes.splice(index, 1);
      this.#save();
      throw error;
    } finally {
      await rm(target, { force: true }).catch((): undefined => undefined);
    }
  }

  async #write(request: WeChatWriteRequest): Promise<WeChatWriteResult> {
    let release!: () => void;
    const previous = this.#writerQueue;
    this.#writerQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.#writeExclusive(request);
    } finally {
      release();
    }
  }

  async #writeExclusive(request: WeChatWriteRequest): Promise<WeChatWriteResult> {
    if (!this.#options.writer)
      throw new Error(`WeChat ${request.kind} writing is unavailable`);
    // This covers the whole native critical section, including its readiness
    // probe. `start()` is also called by status refreshes, and must see the
    // guard before the relay disappears rather than racing to replace it.
    this.#writerPaused = true;
    let retryRelay = false;
    try {
      // Relay health can stay green after WeChat itself exits because the
      // loopback service is still alive. Check the actual app on every native
      // write so a remembered session is relaunched hidden before delivery.
      if (
        this.#options.ensureAppRunning &&
        !(await this.#ensureAppRunning())
      )
        throw new Error(WECHAT_WRITER_FAILURES.wechat_not_running);
      // Recover a closed/crashed WeChat before pausing the relay for the native
      // writer. Start the relay here as well as from status(): an outbound
      // event can arrive before the Hub tab has performed its next status
      // refresh, and a prior native diagnostic may have intentionally stopped
      // the listener.
      if (!(await this.#relayHealthy())) {
        if (!(await this.#startRelay()))
          throw new Error(WECHAT_WRITER_FAILURES.wechat_not_running);
      }
      if (this.#relayHijackArmed === false) await this.#primeApp();
      const pausedRelay = await this.#pauseRelayForWriter();
      let result: WeChatWriteResult | undefined;
      let operationError: unknown;
      try {
        result = await this.#options.writer.write(request);
        if (result.deliveredVerified !== true)
          throw new Error(
            weChatWriterFailureMessage(result.reason, request.kind),
          );
      } catch (error) {
        operationError = error;
      }
      let restartError: unknown;
      if (pausedRelay && !this.#stopped) {
        try {
          if (!(await this.#startRelay()))
            throw new Error("WeChat relay did not restart after the native operation");
        } catch (error) {
          restartError = error;
        }
      }
      const settled = settleWeChatWrite(result, operationError, restartError);
      retryRelay = settled.retryRelay;
      if (retryRelay) {
        this.#log(
          `[wechat] outbound delivered, but relay recovery was delayed: ${message(restartError)}`,
        );
      }
      return settled.result;
    } finally {
      this.#writerPaused = false;
      if (!this.#stopped && retryRelay) {
        void this.start(this.#owner).catch((error: unknown) =>
          this.#log(`[wechat] relay recovery after outbound failed: ${message(error)}`),
        );
      } else if (!this.#stopped) {
        this.#ensureConsume();
      }
    }
  }

  #cliPaths(): string[] {
    return this.#options.cliPaths ?? defaultCliPaths();
  }

  #mediaRoots(): string[] {
    return (
      this.#options.mediaRoots ?? [
        path.join(homedir(), "Library/Containers/com.tencent.xinWeChat"),
        path.join(homedir(), ".wechat"),
      ]
    );
  }

  // ---- plumbing ------------------------------------------------------------

  #relayHeaders(): Record<string, string> {
    return this.#token ? { Authorization: `Bearer ${this.#token}` } : {};
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
    const fromEnvironment = process.env.POLYMUX_WECHAT_RELAY_TOKEN;
    if (fromEnvironment) {
      this.#token = fromEnvironment;
      return;
    }
    const found = await run(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-a",
        process.env.USER ?? "",
        "-s",
        RELAY_TOKEN_SERVICE,
        "-w",
      ],
      { timeout: MEDIA_TIMEOUT_MS },
    ).catch((): null => null);
    this.#token = found ? found.stdout.trim() : null;
  }

  async #relay<T>(
    endpoint: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const response = await this.#fetch(
      new URL(endpoint, this.#options.relayUrl),
      {
        method: options.method ?? "GET",
        headers: {
          ...this.#relayHeaders(),
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 10),
      },
    );
    if (!response.ok)
      throw new Error(`${endpoint} returned ${response.status}`);
    return (await response.json()) as T;
  }

  #retryDelays(): readonly number[] {
    return this.#options.imageRetryDelaysMs ?? IMAGE_RETRY_DELAYS_MS;
  }

  /** Notes an image to ask about again, keeping the first failure's time. */
  #rememberPendingImage(
    item: Omit<PendingImage, "attempts" | "nextAttemptAt" | "firstFailedAt">,
  ): void {
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
   * Heap probes stay frequent because they are local and are what notices the
   * moment a user opens the photo. The authenticated CDN fallback keeps its
   * widening backoff because it arms a debugger-backed capture and may occupy
   * the full media timeout. A handful per sweep keeps a chat full of unviewed
   * photos from monopolising the bridge.
   */
  async #retryPendingImages(): Promise<void> {
    if (this.#retryingImages) return;
    const pending = this.#state.pendingImages;
    if (!pending) return;
    this.#retryingImages = true;
    try {
      const now = Date.now();
      for (const [key, item] of Object.entries(pending)) {
        if (now - item.firstFailedAt <= IMAGE_RETRY_WINDOW_MS) continue;
        delete pending[key];
        this.#save();
      }
      const candidates = Object.entries(pending)
        .sort(
          ([, a], [, b]) =>
            (a.lastHeapAttemptAt ?? 0) - (b.lastHeapAttemptAt ?? 0),
        )
        .slice(0, IMAGE_RETRIES_PER_SWEEP);
      for (const [key, item] of candidates) {
        if (this.#stopped) return;
        item.lastHeapAttemptAt = Date.now();
        let media = await this.#imageOrThumbnail(
          item.chatId,
          item.messageId,
          "heap",
        ).catch((): null => null);
        if (!media && item.nextAttemptAt <= now) {
          media = await this.#imageOrThumbnail(
            item.chatId,
            item.messageId,
          ).catch((): null => null);
          if (!media) {
            item.attempts += 1;
            const delays = this.#retryDelays();
            item.nextAttemptAt =
              now + delays[Math.min(item.attempts, delays.length - 1)];
          }
        }
        if (!media) {
          this.#save();
          continue;
        }
        const picture = {
          msgtype: "m.image",
          body: media.name,
          url: media.uri,
          info: { mimetype: media.mimeType, size: media.size },
        };
        try {
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
                "m.relates_to": {
                  rel_type: "m.replace",
                  event_id: item.eventId,
                },
                "co.polymux.wechat.remote": true,
              },
            },
          );
        } catch (error) {
          this.#log(
            `[wechat] image ${item.messageId} arrived but could not be shown: ${message(error)}`,
          );
          // The bytes were real, but the placeholder is not upgraded until
          // Matrix accepts the edit. Keep it pending rather than reporting a
          // success the user still cannot see.
          item.nextAttemptAt = Date.now() + this.#retryDelays()[0];
          this.#save();
          continue;
        }
        this.#log(
          `[wechat] image ${item.messageId} came through after ${item.attempts + 1} attempts`,
        );
        delete pending[key];
        this.#save();
      }
    } finally {
      this.#retryingImages = false;
    }
  }

  /** A homeserver call as the appservice, optionally masquerading as a puppet. */
  async #matrix<T>(
    endpoint: string,
    options: { method?: string; body?: unknown; as?: string } = {},
  ): Promise<T> {
    const registration = await this.#registration_();
    const url = new URL(endpoint, this.#options.homeserver.baseUrl);
    if (options.as) url.searchParams.set("user_id", options.as);
    const response = await this.#fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${registration.asToken}`,
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok)
      throw new Error(`${endpoint} returned ${response.status}`);
    return (await response.json()) as T;
  }

  async #load(): Promise<void> {
    const file = path.join(this.#options.directory, "wechat", "state.json");
    const stored = await readFile(file, "utf8")
      .then((raw) => JSON.parse(raw) as Partial<BridgeState>)
      .catch((): null => null);
    if (stored) this.#state = { ...emptyState(), ...stored };
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
      Object.entries(this.#state.seenRemote).filter(
        ([, at]) => now - at < SEEN_TTL_MS,
      ),
    );
    this.#state.seenFields = Object.fromEntries(
      Object.entries(this.#state.seenFields ?? {}).filter(
        ([, at]) => now - at < SEEN_TTL_MS,
      ),
    );
    this.#state.seenTransactions = Object.fromEntries(
      Object.entries(this.#state.seenTransactions).filter(
        ([, at]) => now - at < 24 * 3_600_000,
      ),
    );
    this.#state.outboundEchoes = this.#state.outboundEchoes.filter(
      (echo) => now - echo.timestamp < ECHO_TTL_MS,
    );
    this.#state.outboundMediaEchoes = (
      this.#state.outboundMediaEchoes ?? []
    ).filter((echo) => now - echo.timestamp < ECHO_TTL_MS);
    this.#state.stickerReferences = Object.fromEntries(
      Object.entries(this.#state.stickerReferences ?? {})
        .sort(([, a], [, b]) => b.seenAt - a.seenAt)
        .slice(0, 512),
    );
    const file = path.join(this.#options.directory, "wechat", "state.json");
    // Unique per write: the debounced save and the flush `close` does can
    // overlap, and one shared `.tmp` means the second rename finds the file
    // the first one already moved.
    const temporary = `${file}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(file), { recursive: true }).catch(
      (): undefined => undefined,
    );
    await writeFile(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, file);
  }
}

interface RelayChat {
  username?: string;
  chatId?: string;
  display_name?: string;
  isGroup?: boolean;
  is_group?: boolean;
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
  event_id?: string;
  type?: string;
  sender?: string;
  room_id?: string;
  origin_server_ts?: number;
  redacts?: string;
  content?: { msgtype?: string; body?: string; [key: string]: unknown };
}

function replyEvent(event: MatrixEvent): string | undefined {
  const relation = event.content?.["m.relates_to"] as
    { "m.in_reply_to"?: { event_id?: string } } | undefined;
  return relation?.["m.in_reply_to"]?.event_id;
}

function matrixMentionIds(event: MatrixEvent): string[] {
  const mentions = event.content?.["m.mentions"] as
    { user_ids?: unknown } | undefined;
  return Array.isArray(mentions?.user_ids)
    ? mentions.user_ids.filter(
        (userId): userId is string => typeof userId === "string",
      )
    : [];
}

function matrixMediaType(
  msgtype: unknown,
): "image" | "sticker" | "video" | "audio" | "file" | null {
  switch (msgtype) {
    case "m.image":
      return "image";
    case "m.sticker":
      return "sticker";
    case "m.video":
      return "video";
    case "m.audio":
      return "audio";
    case "m.file":
      return "file";
    default:
      return null;
  }
}

function relayMediaType(
  kind: string | undefined,
): "image" | "sticker" | "video" | "audio" | "file" | null {
  switch (kind) {
    case "image":
      return "image";
    case "emoticon":
      return "sticker";
    case "video":
      return "video";
    case "voice":
    case "audio":
      return "audio";
    case "attachment":
    case "file":
      return "file";
    default:
      return null;
  }
}

function mediaSuffix(
  kind: "image" | "sticker" | "video" | "audio" | "file",
): string {
  switch (kind) {
    case "image":
      return ".png";
    case "sticker":
      return ".gif";
    case "video":
      return ".mp4";
    case "audio":
      return ".silk";
    case "file":
      return ".bin";
  }
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
const CARRIES_MEDIA = new Set([
  "image",
  "voice",
  "audio",
  "video",
  "file",
  "attachment",
  "emoticon",
  "location",
  "transfer",
  "redpacket",
  "card",
  "music",
  "miniprogram",
  "appmsg",
]);

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
  voip: "[Call]",
  voipmsg: "[Call]",
  call: "[Call]",
};

function bodyOf(item: RelayMessage): string {
  const kind = item.messageKind ?? "";
  const body = String(item.body ?? "").trim();
  // Rich WeChat items arrive as XML. Keep their human fields and discard the
  // transport credentials and protocol scaffolding surrounding them.
  if (body.startsWith("<")) {
    const title = xmlTag(body, "title");
    const description = xmlTag(body, "des");
    const url = xmlTag(body, "url");
    const quotedSender = xmlTag(body, "displayname");
    const quotedText = xmlTag(body, "content");
    if (
      kind === "appmsg" ||
      kind === "url" ||
      kind === "miniprogram" ||
      kind === "music"
    ) {
      const primary =
        title || description || KIND_LABELS[kind] || "WeChat item";
      const quote = quotedText
        ? `\n↳ ${quotedSender ? `${quotedSender}: ` : ""}${quotedText}`
        : "";
      return `${primary}${quote}${url && url !== primary ? `\n${url}` : ""}`;
    }
    if (kind === "location") {
      const label =
        xmlAttribute(body, "label") || xmlAttribute(body, "poiname");
      if (label) return label;
    }
    if (kind === "card") {
      const nickname =
        xmlAttribute(body, "nickname") ||
        xmlAttribute(body, "displayname") ||
        xmlTag(body, "nickname");
      const username =
        xmlAttribute(body, "username") || xmlTag(body, "username");
      if (nickname || username)
        return `Contact: ${nickname || username}${nickname && username ? ` (${username})` : ""}`;
    }
    if (kind === "transfer") {
      const amount = xmlTag(body, "feedesc") || xmlTag(body, "fee_desc");
      const memo = xmlTag(body, "pay_memo") || xmlTag(body, "paymemo");
      const status =
        xmlTag(body, "receivertitle") || xmlTag(body, "receiver_title");
      const details = [amount, memo, status].filter(Boolean).join(" · ");
      if (details) return `Transfer · ${details}`;
    }
    if (kind === "redpacket") {
      const title =
        xmlTag(body, "sendertitle") ||
        xmlTag(body, "receivertitle") ||
        xmlTag(body, "wishing");
      if (title) return `Red packet · ${title}`;
    }
  }
  // A link card's body is its headline, which is worth reading; a sticker's is
  // a wall of XML, which is not. So markup is labelled, and text is kept.
  if (KIND_LABELS[kind]) return KIND_LABELS[kind];
  // WeChat wraps its non-text kinds in tags that all end in `msg` — `msg`,
  // `sysmsg`, `appmsg`, `voipmsg`, … — so the tag family, not a list of
  // kinds, is what says "this is markup, label it".
  if (body.startsWith("<") && /^<[a-z0-9_]*msg\b/i.test(body))
    return `[${kind || "Unsupported WeChat message"}]`;
  if (body) return body;
  if (item.hasMedia)
    return (
      KIND_LABELS[item.mediaType ?? ""] ?? `[${item.mediaType || "Media"}]`
    );
  return `[${kind || "Unsupported WeChat message"}]`;
}

/**
 * Preserve the shape of media WeChat announced even when its helper cannot
 * supply bytes. This is a generic Matrix attachment plus `viewIn`, so the
 * renderer needs no WeChat-specific branch and other bridges can do the same.
 */
function remoteAttachment(
  kind: string,
  body: string,
): {
  msgtype: "m.audio" | "m.video" | "m.file";
  name: string;
  filename?: string;
  size?: number;
} | null {
  if (kind === "voice" || kind === "audio")
    return { msgtype: "m.audio", name: "Voice message" };
  if (kind === "video") return { msgtype: "m.video", name: "Video" };
  if (kind !== "file" && kind !== "attachment") return null;
  const match = /^\[(?:File|文件)\]\s*(.+?)(?:\s*\(([^)]+)\))?$/i.exec(body);
  const xmlName = body.startsWith("<") ? xmlTag(body, "title") : "";
  const xmlSize = body.startsWith("<") ? Number(xmlTag(body, "totallen")) : NaN;
  const filename = match?.[1]?.trim() || xmlName || "File";
  return {
    msgtype: "m.file",
    name: filename,
    filename,
    ...(Number.isFinite(xmlSize) && xmlSize > 0
      ? { size: xmlSize }
      : match?.[2]
        ? { size: parseHumanSize(match[2]) }
        : {}),
  };
}

function xmlTag(xml: string, tag: string): string {
  const match = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i",
  ).exec(xml);
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "").trim()) : "";
}

function xmlAttribute(xml: string, name: string): string {
  const match = new RegExp(`\\s${name}=["']([^"']*)["']`, "i").exec(xml);
  return match ? decodeXml(match[1]) : "";
}

function weChatLocation(xml: string): { label: string; geoUri: string } | null {
  if (!xml.startsWith("<")) return null;
  const latitude = Number(xmlAttribute(xml, "x"));
  const longitude = Number(xmlAttribute(xml, "y"));
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    return null;
  const label =
    xmlAttribute(xml, "label") ||
    xmlAttribute(xml, "poiname") ||
    `${latitude}, ${longitude}`;
  return { label, geoUri: `geo:${latitude},${longitude}` };
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseHumanSize(value: string): number | undefined {
  const match = /^([\d.]+)\s*(B|KB|MB|GB)$/i.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const powers: Record<string, number> = { B: 0, KB: 1, MB: 2, GB: 3 };
  return Math.round(amount * 1024 ** powers[match[2].toUpperCase()]);
}

function richPreview(
  kind: string,
  xml: string,
): {
  title: string;
  description?: string;
  url?: string;
  source: string;
} | null {
  if (
    !xml.startsWith("<") ||
    !["appmsg", "url", "miniprogram", "music"].includes(kind)
  )
    return null;
  // Type 57 is a quoted reply, not a link card; its refermsg context stays in
  // the ordinary shared reply text path.
  if (xmlTag(xml, "type") === "57") return null;
  const title = xmlTag(xml, "title");
  if (!title) return null;
  const description = xmlTag(xml, "des");
  const url = xmlTag(xml, "url");
  let source = "WeChat";
  if (/^https?:\/\//i.test(url)) {
    try {
      source = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      // Keep the source network label for a malformed remote URL.
    }
  }
  return {
    title,
    ...(description ? { description } : {}),
    ...(/^https?:\/\//i.test(url) ? { url } : {}),
    source,
  };
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
    .update(
      JSON.stringify([
        item.chatId,
        item.senderId,
        item.timestamp,
        item.body,
        item.mediaType,
      ]),
    )
    .digest("hex");
}

/** Yields the `data:` payload of each event in an SSE stream. */
async function* serverSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  let lines: string[] = [];
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
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
      } else if (line.startsWith("data:"))
        lines.push(line.slice(5).trimStart());
    }
  }
}

async function readBody(
  request: Parameters<Parameters<typeof createServer>[1]>[0],
): Promise<{ events?: unknown[] }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 8 * 1024 * 1024) throw new Error("request too large");
    chunks.push(chunk as Buffer);
  }
  return chunks.length
    ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        events?: unknown[];
      })
    : {};
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
