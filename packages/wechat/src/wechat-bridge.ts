import {WeChatDeliveryUnconfirmedError, isWeChatDeliveryUnconfirmed} from "./wechat-delivery.js";
import {WeChatOutbox} from "./wechat-outbox.js";
import {weChatAppSticker} from "./wechat-sticker-info.js";
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
import type {ChatGroupInfoDto, ChatMemberDto} from "@polymux/protocol";

export interface WeChatAppserviceRecord {
  id: string;
  asToken: string;
  hsToken: string;
  url: string;
  senderLocalpart: string;
  receiveEphemeral?: boolean;
  userNamespaces: string[];
}

export interface WeChatHomeserver {
  serverName: string;
  baseUrl: string;
  registerAppservice(registration: WeChatAppserviceRecord): void;
  setOutboundDeliveryStatus?(eventId: string, status: "unconfirmed" | null): void;
}
import type { WeChatSessionState } from "./wechat-app.js";
import {recoverWeChatSession} from "./wechat-session-recovery.js";
import {readLocalWeChatPhoto, readLocalWeChatSticker} from "./wechat-local-media.js";
import { loadHeadImages } from "./wechat-head-images.js";
import { visibleWeChatText } from "./wechat-emoji.js";
import {parseWeChatJson, weChatAppMessageType, weChatAttachmentReply, weChatConversationList, weChatHistoryPage} from "./wechat-history.js";
import {isWeChatSessionContainer, weChatMemberTitle, weChatPortalChannelId} from "./wechat-conversations.js";
import {pauseWeChatRelay, type WeChatRelayRelease} from "./wechat-relay-lease.js";
import {forwardedBundleText, weChatForwardedBundle} from "./wechat-forwarded.js";
import type {WeChatNativeStore} from "./wechat-native-store.js";
import {WeChatWalWatcher, type WeChatWalMessage} from "./wechat-wal-stream.js";

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
  options: {
    timeout: number;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  },
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
/** A native/relay handoff can report failure just before WeChat commits the
 * message. Keep the optimistic Hub send pending long enough to reconcile that
 * late acknowledgement instead of restoring text that is already in flight. */
const OUTBOUND_RECONCILE_MS = 30_000;
/** A native capability probe is local but still starts a short-lived helper.
 * Reuse its answer across status refreshes instead of respawning it every time
 * the Hub asks whether a composer can send. */
const WRITER_READINESS_TTL_MS = 30_000;
/** Starting only the shared daemon is much cheaper than waiting for the whole
 * inbound relay, and lets the first desktop-owned send reuse an armed session. */

/** Where the relay listens, unless told otherwise. */
const DEFAULT_RELAY = "http://127.0.0.1:18400";
/** How long a relay has to answer before it counts as absent. */
const PROBE_TIMEOUT_MS = 1_500;
/** A composer readiness probe is either immediate or the desktop writer wins. */
const OUTBOUND_PROBE_TIMEOUT_MS = 250;
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
  wechat_signed_out:
    "Open WeChat and sign in, then try again.",
  wechat_session_locked:
    "Unlock your Mac and make sure WeChat is signed in, then try again.",
  wechat_interactive_sign_in_required:
    "WeChat needs one phone confirmation before Polymux can reconnect.",
  wechat_signed_out_confirmation_required:
    "WeChat needs one phone confirmation before Polymux can reconnect.",
  wechat_login_action_failed:
    "WeChat needs one phone confirmation before Polymux can reconnect.",
  wechat_login_pending:
    "Waiting for WeChat sign-in confirmation.",
  wechat_no_chat_selected:
    "Polymux could not prepare WeChat's background sender. Keep WeChat signed in and try again.",
  wechat_model_recipient_changed:
    "Message not sent. Open this conversation in WeChat Desktop, then try again.",
  wechat_model_configuration_changed:
    "Message not sent. WeChat's sender changed; try again.",
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
  delivered_verified?: boolean;
}

export interface WeChatBridgeOptions {
  homeserver: WeChatHomeserver;
  /** Where registration and state are kept, i.e. the hub's bridges directory. */
  directory: string;
  relayUrl?: string;
  /** Disable all external CLI/relay fallbacks; native reads and writer only. */
  externalProvider?: boolean;
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
  /** Local avatar provider; tests supply an empty map instead of personal data. */
  headImages?: () => Promise<Map<string, Uint8Array>>;
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
  /** Reopens the authenticated incremental stream on this cadence. WeChat's
   * live hook can omit messages authored in the desktop app, while reconnect
   * backfill includes them, so the embedded app uses a short local pulse. */
  desktopMessageSyncMs?: number;
  /** How long an uncertain plain-text failure is checked against WeChat's own
   * history before it becomes retryable. Overridable for bounded tests. */
  outboundReconcileMs?: number;
  /** Read-only signed-in session probe paired with `primeApp`. A successful
   * remembered-login action is not ready until this reports true. */
  sessionReady?: () => Promise<boolean>;
  /** Must confirm login options before the native remembered-login fallback. */
  prepareLoginOptions?: () => Promise<boolean>;
  /** Structured companion used to route remembered-account login through the
   * exact-build native action without probing a half-built desktop window. */
  sessionState?: () => Promise<
    | "signed_in"
    | "signed_out"
    | "remembered_login"
    | "interactive_login"
    | "locked"
    | "launching"
    | "unavailable"
  >;
  /** Bounds cold desktop session preparation. Overridable for focused tests. */
  desktopSessionWarmupMs?: number;
  /**
   * Makes the native desktop app available without activating it. The desktop
   * host supplies the platform-specific launch; tests omit it so they can
   * never start a person's WeChat session.
   */
  ensureAppRunning?: () => Promise<boolean>;
  /** Read-only exact application discovery, independent of relay metadata.
   * An ambiguous or absent result blocks a native operation. */
  appProcessId?: () => Promise<number | null>;
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
  /** Development acceptance-test fence. When enabled, every outbound
   * mutation is rejected unless it targets WeChat's File Transfer chat. Keep
   * this at the bridge boundary as well as in the native writer: plain text
   * can legitimately use the already-attached relay and must not bypass the
   * live-test recipient restriction. */
  testOnlyFileHelper?: boolean;
  /** Exact native recipients for a controlled acceptance test. If both test
   * fences are set, a recipient must satisfy both. */
  testChatIds?: readonly string[];
  /**
   * Live readers over WeChat's own databases, resolved by the desktop host.
   * Present with message keys, they carry inbound traffic, conversation
   * lists, history, and identity without the loopback relay; every relay and
   * CLI read below stays as the fallback for a machine without them. Tests
   * omit them: a test must never read a person's conversations.
   */
  nativeStores?: WeChatNativeStore[];
  /** Inbound selection when native readers exist. The relay's own SSE stream
   * is the default for compatibility; native reads it straight from WeChat's
   * write-ahead logs instead. */
  preferNativeInbound?: boolean;
}

export interface WeChatReplyContext {
  body: string;
  sender: string;
  createTime: number;
  kind?: string;
  senderId?: string;
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
      replyContext?: WeChatReplyContext;
      /** WeChat ids to encode as real @ mentions rather than painted text. */
      mentions?: string[];
    }
  | {
      kind: "media";
      chatId: string;
      mediaType: "image" | "sticker" | "video" | "audio" | "file";
      path: string;
      name: string;
      /** Visible session title used by the desktop composer transport. */
      chatName?: string;
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
  | { kind: "read"; chatId: string }
  | { kind: "rename-group"; chatId: string; name: string; expectedName: string };

export interface WeChatWriteResult {
  /** True only after WeChat itself accepted and echoed the operation. */
  deliveredVerified: boolean;
  /** Submitted or queued, but no authoritative acknowledgement arrived. */
  deliveryUnconfirmed?: boolean;
  messageId?: string;
  /** Native client id needed to recall a freshly injected message. */
  clientMessageId?: string;
  reason?: string;
  /** False when native debugger detach was not confirmed. Recovery must wait. */
  relayRecoverySafe?: boolean;
}

export interface WeChatStickerCatalogEntry {
  id: string;
  uri: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface WeChatNativeSticker {
  /** Lowercase MD5 used by WeChat for this saved favourite. */
  id: string;
  /** Exact reusable `<emoji>` element, including its current CDN location. */
  xml: string;
}

export interface WeChatNativeReadState {
  chatId: string;
  unreadCount: number;
  markedUnread: boolean;
}

export interface WeChatMediaReadRequest {
  chatId: string;
  /** Read only Polymux's registry and Desktop's existing cache. */
  localOnly?: boolean;
  serverId: string;
  localId?: string;
  timestamp: number;
  kind: "audio" | "file" | "video";
}

export interface WeChatNativeMedia {
  name: string;
  mimeType: string;
  size: number;
  bodyBase64?: string;
  localPath?: string;
  md5?: string;
  durationMs?: number;
}

export interface WeChatWriter {
  /** Read-only build check before any launch, warm-up, relay or native action. */
  compatible?(): Promise<boolean>;
  /** Pins child drivers to the process protected by the native relay lease. */
  setNativeTarget?(target: {pid: number; identity: string} | null): void;
  /** Verifies an automatic transport without sending a message or touching
   * the WeChat UI. Optional for injected/custom writers used by tests. */
  ready?(): Promise<boolean>;
  readinessFailure?(): string | null;
  readinessRecoverySafe?(): boolean;
  /** Saved favourites currently present in WeChat Desktop's native picker. */
  stickers?(): Promise<WeChatNativeSticker[]>;
  /** Includes Desktop's manual unread flag, which the relay counts omit. */
  readStates?(): Promise<WeChatNativeReadState[]>;
  groupInfo?(chatId: string): Promise<ChatGroupInfoDto & {chatId: string}>;
  /** Read-only media lookup against exact native history and local caches. */
  readMedia?(request: WeChatMediaReadRequest): Promise<WeChatNativeMedia | null>;
  /** Exact native mention targets, including sources omitted by the relay. */
  readMentions?(request: Omit<WeChatMediaReadRequest, "kind">): Promise<string[] | null>;
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
  /** Relay row ids and server ids are different namespaces. Media extraction
   * needs the local row; native quotes and recall need the server id. */
  localId?: string | number;
  serverId?: string | number;
  messageId?: string | number;
  message_id?: string | number;
  server_id?: string | number;
  local_id?: string | number;
  create_time?: number;
  real_sender_id?: string | number;
  sender_wxid?: string;
  message_content?: string;
  display_text?: string;
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
  mentionedIds?: string[];
  refer?: {svrId?: string | number; fromUser?: string; chatUser?: string; displayName?: string; content?: string};
  recall?: {replacedMsgId?: string | number; text?: string};
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

interface WeChatTextHistoryRow {
  create_time?: number;
  real_sender_id?: string | number;
  sender_wxid?: string;
  server_id?: string | number;
  message_kind?: string;
  display_text?: string;
  message_content?: string;
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
      ?.toLowerCase() ?? weChatAppSticker(value)?.md5 ?? null
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
  const kind = item.messageKind ?? item.message_kind;
  const body = item.body ?? item.message_content ?? "";
  return {
    ...item,
    messageId: item.messageId ?? item.message_id ?? item.server_id ?? item.local_id,
    localId: item.localId ?? item.local_id ?? item.messageId ?? item.message_id,
    serverId: item.serverId ?? item.server_id,
    chatId,
    chatName: item.chatName ?? item.chat_name,
    senderId: item.sender_wxid ?? item.senderId ?? item.sender_id,
    senderName: item.senderName ?? item.sender_name,
    isGroup: item.isGroup ?? item.is_group ?? /@chatroom$/i.test(chatId ?? ""),
    fromSelf: item.fromSelf ?? item.from_self,
    timestamp: item.timestamp ?? item.create_time,
    body: item.body ?? item.message_content ?? item.display_text,
    hasMedia: item.hasMedia ?? item.has_media,
    mediaType: item.mediaType ?? item.media_type,
    mediaUrls: item.mediaUrls ?? item.media_urls,
    localPath: item.localPath ?? item.local_path,
    messageKind: /<voipmsg\b/i.test(item.body ?? item.message_content ?? "")
      ? "call" : weChatAppSticker(item.body ?? item.message_content ?? "")
        ? "emoticon" : kind === "appmsg" && weChatAppMessageType(body) === "6" ? "file" : kind,
    refer: item.refer ?? weChatAttachmentReply(item.message_content ?? item.body ?? ""),
  };
}

function named(value: unknown): string | null {
  const result = typeof value === "string" ? value.trim() : "";
  return result && result !== UNKNOWN_SENDER ? result : null;
}

/** The conversation name the relay or its chat directory already resolved. */
function conversationName(item: RelayMessage): string | null {
  const explicit = named(item.chatName) ?? named(item.chat_name);
  if (explicit) return explicit;
  // A message's display name can identify the person speaking. The chat
  // directory supplies its authoritative group title as chatName instead.
  if (item.isGroup || item.is_group || /@chatroom$/i.test(item.chatId ?? item.chat_id ?? "")) return null;
  return named(item.display_name) ?? named(item.senderName);
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
  /** Exact current local owner, and native-attested ownership of imported events. */
  owner?: string;
  ownMessageEvents?: Record<string, Record<string, boolean>>;
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
    eventId?: string;
    /** Excludes pre-existing identical messages from late-send reconciliation. */
    previousIds?: string[];
    /** Restored from the durable send fence, not the expiring replay cache. */
    recovered?: boolean;
  }>;
  /** Verified sticker bytes -> WeChat's reusable native emoji reference. */
  stickerReferences?: Record<
    string,
    {
      xml: string;
      seenAt: number;
      uri?: string;
      mimeType?: string;
      size?: number;
      width?: number | null;
      height?: number | null;
    }
  >;
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
  /** Desktop counts can increase after a manual mark-unread, whereas Matrix
   * receipts only move forward. Publish these separately for portal badges. */
  unreadCounts?: Record<string, number>;
  /** Native list metadata is available before a portal's history is imported. */
  chatSummaries?: Record<string, WeChatChatSummary>;
  /** Matrix event -> WeChat server message id, needed for native reply/recall. */
  remoteMessageIds?: Record<string, string>;
  /** Matrix event -> WeChat client message id, needed for immediate recall. */
  remoteMessageClientIds?: Record<string, string>;
  /** Hashed Matrix puppet id -> original WeChat id, needed for native mentions. */
  puppetRemoteIds?: Record<string, string>;
  /** Next exclusive native history boundary; null means all local history was read. */
  historyCursors?: Record<string, number | null>;
  nativeMessageEvents?: Record<string, Record<string, string>>;
  /** Native local row + exact send time -> event, retained when a stream
   * arrives before the native database can supply its server id. */
  nativeLocalMessageEvents?: Record<string, Record<string, string>>;
  recalledMessageIds?: Record<string, Record<string, boolean>>;
}

interface PendingImage {
  chatId: string;
  messageId: string;
  /** Where the placeholder landed, so success can edit it into the picture. */
  roomId: string;
  eventId: string;
  replyTo?: string;
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
    stickerReferences: {},
    avatarUris: {},
    avatarsApplied: {},
    recentEvents: {},
    readReceipts: {},
    unreadCounts: {},
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
  #stateLoad: Promise<void> | null = null;
  #registration: Registration | null = null;
  /** Uploaded contact pictures by source url; null means it could not be had. */
  readonly #avatars = new Map<string, string | null>();
  /** Stable account identity; numeric Name2Id rows belong to individual shards. */
  #selfWxid: string | null | undefined;
  readonly #readStateTasks = new Map<string, Promise<void>>();
  readonly #nativeMentions = new Map<string, string[]>();
  #nativeWriteRevision = 0;
  /**
   * WeChat's own picture store, read once per run. Held as the promise rather
   * than the result so a burst of messages arriving together waits on one read
   * instead of starting one each.
   */
  #headImages: Promise<Map<string, Uint8Array>> | null = null;
  readonly #memberTitles = new Map<string, {name: string | null; refreshAt: number}>();
  #server: Server | null = null;
  #stopped = false;
  /** Aborts the event stream on close; a `for await` on it never ends by itself. */
  #streaming: AbortController | null = null;
  /** The image-retry sweep, so closing the bridge stops it. */
  #imageSweep: ReturnType<typeof setInterval> | null = null;
  /** A reconnect and the timer can ask at once; only one may attach to WeChat. */
  #retryingImages = false;
  /** Cancels a background heap/CDN retry before the exclusive outbound writer
   * takes ownership of WeChat. */
  #imageRetryAbort: AbortController | null = null;
  #activeImageReads = new Set<AbortController>();
  /** The read-state sweep, likewise. */
  #readSweep: ReturnType<typeof setInterval> | null = null;
  #token: string | null = null;
  /** The relay we started, if we were the one to start it. */
  #relayProcess: ChildProcess | null = null;
  #releaseRelayPause: WeChatRelayRelease | null = null;
  /** Most recent daemon send readiness advertised by `/health`. */
  #relayHijackArmed: boolean | null = null;
  /** WeChat process the relay is currently attached to. A reachable relay with
   * no pid is read-capable but cannot send until an explicit action relaunches
   * the app. */
  #relayWeChatPid: number | null = null;
  /** Whose portal rooms these are. Known only once Polymux has its account. */
  #owner = "";
  /** When the event stream last answered, so its replay is told from live. */
  #streamConnectAt = 0;
  /** True while the import re-pulls history, which replays by fields too. */
  #importing = false;
  /** One history import at a time when several explicit wakes share recovery. */
  #backfillTask: Promise<void> | null = null;
  #historyTasks = new Map<string, Promise<boolean>>();
  #ingestTasks = new Map<string, Promise<void>>();
  #nativeIdentityPages = new Map<string, {at: number; rows: Promise<RelayMessage[]>}>();
  #resolvedRichEvents = new Set<string>();
  #originalPhotoDigests = new Map<string, string>();
  #mediaRefreshTasks = new Map<string, Promise<boolean>>();
  #mediaRefreshAt = new Map<string, number>();
  #reconciledLocalRows = new Set<string>();
  #historyGeneration = 0;
  #outboundChatTasks = new Map<string, Promise<void>>();
  #transactionTasks = new Map<string, Promise<void>>();
  #outbox: WeChatOutbox | null = null;
  #outboxOwner: string | null = null;
  #flushQueue: Promise<void> = Promise.resolve();
  /** Changes since the last flush, so a burst does not sit out a crash alone. */
  #unsaved = 0;
  #saving: NodeJS.Timeout | null = null;
  /** Completed native writes that may have beaten the IPC caller to its wait. */
  readonly #outboundResults = new Map<
    string,
    {error: Error | null; completedAt: number}
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
  #activeNativeWrite: WeChatWriteRequest | null = null;
  /** Coalesces the explicit cold wake shared by Hub selection, an agent draft,
   * and a send submitted before the desktop has finished signing in. */
  #writerSessionWake: Promise<boolean> | null = null;
  /** A semantic composer selection survives the optional relay reconnect. Keep
   * its short freshness window so `wake()` followed immediately by `send()`
   * does not repeat the same native preparation. */
  #desktopComposerWarmAt = 0;
  /** Gives an explicit send a brief head start over the passive receive loop.
   * Without it, that loop can spend the next relay timeout rebuilding inbound
   * sync before the already-warm desktop composer is allowed to send. */
  #writerPriorityUntil = 0;
  /** Blocks every relay restart while WeChat is between its remembered-login
   * window and signed-in session list. Attaching the debugger in this interval
   * freezes the transition and leaves the desktop permanently half-open. */
  #desktopSessionPending = false;
  /** Recovery starts after WeChat has acknowledged a native write. It remains
   * visible here so another native write cannot race the relay as it reattaches. */
  #relayRecovery: Promise<void> | null = null;
  /** One relay launch at a time. Hub hover, click, composer readiness and the
   * stream's own recovery can all notice the same stopped loopback service;
   * coalescing them prevents two bridge processes racing for its port. */
  #relayStart: Promise<boolean> | null = null;
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
  readonly #publishedRoomNames = new Map<string, string>();
  readonly #traceStartedAt = Date.now();
  /** The write-ahead-log stream, when native readers own the inbound side. */
  #wal: WeChatWalWatcher | null = null;
  #nativeInboundFailed = false;
  #nativeDirectoryReadable = false;
  #nativeRetryAt = 0;
  #relayRecoverySafe = true;

  constructor(options: WeChatBridgeOptions) {
    if (options.testChatIds !== undefined && (!options.testChatIds.length ||
        options.testChatIds.some(id => !/^(?:filehelper|wxid_[A-Za-z0-9_-]+|[1-9]\d*@chatroom)$/.test(id))))
      throw new Error("The WeChat test chat allowlist is invalid");
    this.#options = {
      ...options,
      ...(options.testChatIds ? {testChatIds: [...options.testChatIds]} : {}),
      relayUrl: (options.relayUrl ?? DEFAULT_RELAY).replace(/\/+$/, ""),
    };
    this.#log = options.log ?? ((): undefined => undefined);
    if ((options.nativeStores?.length ?? 0) > 1) {
      // Matrix portals currently belong to one WeChat account. A directory
      // of historical accounts must not be merged into that identity.
      this.#options.nativeStores = [];
      this.#log("[wechat] native reads require one selected account; using the relay instead");
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  #trace(label: string): void {
    if (process.env.POLYMUX_WECHAT_READY_TRACE === "1")
      this.#log(
        `[wechat-ready +${Date.now() - this.#traceStartedAt}ms] ${label}`,
      );
  }

  get botId(): string {
    return `@wechatbot:${this.#options.homeserver.serverName}`;
  }

  /** Lets the desktop reject a live-test action before it wakes WeChat,
   * uploads media, or creates an optimistic Matrix event. The bridge still
   * repeats the check at each transport boundary because other Matrix clients
   * can submit events without going through the desktop UI. */
  assertLiveTestDestination(roomId: string): void {
    const chatId = this.#state.roomToChat[roomId];
    if (chatId) return this.#assertLiveTestDestination(chatId);
    if (!this.#options.testOnlyFileHelper && this.#options.testChatIds === undefined) return;
    throw new Error("live WeChat testing is restricted to the selected test chats");
  }

  /**
   * Brings the bridge up if the relay is there. A Mac without it is the
   * ordinary case, not a failure: nothing is registered, and the platform
   * reports itself unavailable rather than pretending to be linked.
   */
  #startTask: Promise<boolean> | null = null;
  #initialImportComplete = false;
  #verifiedOwnerRooms = new Set<string>();

  async start(owner: string): Promise<boolean> {
    if (this.#startTask) return this.#startTask;
    const task = this.#startOnce(owner);
    this.#startTask = task;
    try { return await task; }
    finally { if (this.#startTask === task) this.#startTask = null; }
  }

  #ensureInitialImport(): void {
    if (this.#initialImportComplete || this.#backfillTask || this.#stopped) return;
    const owner = this.#owner;
    void this.#backfill().then(() => {
      if (!this.#stopped && this.#owner === owner) this.#initialImportComplete = true;
    }).catch((error: unknown) => this.#log(`[wechat] initial import delayed: ${message(error)}`));
  }

  async #startOnce(owner: string): Promise<boolean> {
    // Asked for every time the platform's status is read, so it has to be
    // cheap and repeatable: already up is the answer, not a second bridge.
    if (!owner) return false;
    // A bridge that was unlinked and is being linked again comes back through
    // here; the flag that ended its loops must not outlive the stop.
    this.#stopped = false;
    if (this.#owner !== owner) {
      this.#initialImportComplete = false;
      this.#verifiedOwnerRooms.clear();
      this.#portalRecovery = null;
    }
    this.#owner = owner;
    if (this.#state.owner && this.#state.owner !== owner) {this.#state.owner = owner; this.#save();}
    await this.#resolveToken();
    // A native write deliberately removes the relay because both it and the
    // writer attach to the same WeChat process. Status is polled while the Hub
    // is open; treating that intentional gap as a crash restarts the relay in
    // the middle of the write and lets media recovery attach a second
    // debugger. The appservice is still live, so report the bridge as started
    // until the writer has restored its relay.
    if (this.#writerPaused && this.#server) return true;
    // Once the appservice exists, `start` is also the ordinary 30-second Hub
    // status path. It may resume a healthy stream, but must not undo a user's
    // explicit WeChat quit. Composer/agent use calls `outboundReady` to wake
    // the app and relay on demand.
    if (this.#server) {
      // A startup read can fail while Desktop is still signing in. In
      // native-only mode there is no relay to recover it later. Re-authenticate
      // the supplied stores before admitting them again; never reset keys or
      // weaken snapshot validation merely because the UI reports signed in.
      if (this.#nativeInboundFailed && this.#options.externalProvider === false &&
          !this.#consumeTask && Date.now() >= this.#nativeRetryAt &&
          await this.#desktopSessionState() === "signed_in") {
        this.#nativeRetryAt = Date.now() + 10_000;
        const stores = this.#options.nativeStores ?? [];
        try {
          for (const store of stores) {
            await store.refreshRegistry();
            for (const shard of store.messageShards()) await (await store.snapshot(shard)).refresh();
            await store.conversations();
          }
          if (stores.length && !this.#stopped) {
            this.#nativeInboundFailed = false;
            this.#initialImportComplete = false;
          }
        } catch { /* Keep imported data and retry later; source writes are forbidden. */ }
      }
      if (this.#nativeReadable()) this.#ensureInitialImport();
      if (this.#nativeInboundActive()) {
        this.#ensureConsume();
      } else if (await this.#relayHealthy()) {
        this.#ensureInitialImport();
        this.#ensureConsume();
      } else {
        // A user can reopen and sign in to WeChat independently of Polymux.
        // Resume the relay only after that already-running desktop session is
        // verified; a signed-out or absent app remains completely idle until
        // a Hub composer or agent draft explicitly asks to wake it.
        const sessionState = await this.#desktopSessionState();
        if (sessionState === "signed_in") {
          this.#desktopSessionPending = false;
          if (await this.#startRelay()) {
            this.#ensureInitialImport();
            this.#ensureConsume();
          }
        }
      }
      return true;
    }
    this.#nativeInboundFailed = false;
    this.#nativeDirectoryReadable = false;
    this.#initialImportComplete = false;
    await Promise.all(this.#nativeStores().map(store => store.reopen()));
    const relayHealthy = await this.#relayHealthy();
    const nativeReadable = this.#nativeReadable();
    // Register the cached Hub even while WeChat is user-quit. The bundled
    // writer is the on-demand capability; opening Polymux or polling status
    // must not launch the desktop app or attach its daemon in the background.
    // A keyed native store is a third way to be useful without the relay.
    if (!relayHealthy && !this.#options.writer && !nativeReadable) {
      this.#log("[wechat] no local relay on this Mac; WeChat stays unlinked.");
      return false;
    }
    // A prior stream can end when WeChat quits while the appservice server
    // remains registered. Relaunching WeChat must revive that same bridge,
    // not create another server or another set of portal rooms.
    await this.#load();
    this.#state.owner = owner;
    this.#restoreOutbox(owner);
    this.#invalidateHistoryCoverage();
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
    // must not sit behind it. Rooms appear as they are imported. Native reads
    // import without the relay; otherwise the relay path stays as before.
    if (relayHealthy || nativeReadable)
      this.#ensureInitialImport();
    // Conversations opened before this run have no picture yet; giving them
    // one is independent of the import and runs beside it.
    if (relayHealthy || nativeReadable) {
      void this.#syncRoomAvatars().catch((error: unknown) =>
        this.#log(`[wechat] contact pictures delayed: ${message(error)}`),
      );
      this.#ensureConsume();
    }
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
    await this.#startTask?.catch(() => false);
    if (this.#imageSweep) clearInterval(this.#imageSweep);
    this.#imageSweep = null;
    this.#imageRetryAbort?.abort();
    this.#imageRetryAbort = null;
    if (this.#readSweep) clearInterval(this.#readSweep);
    this.#readSweep = null;
    this.#consumeGeneration += 1;
    this.#streaming?.abort();
    const wal = this.#wal;
    this.#wal = null;
    if (wal) await wal.stop().catch((): undefined => undefined);
    this.#consumeTask = null;
    // Dropping the decrypted snapshots is closing-time work, not GC: the
    // plaintext copies in the temp directory must not outlive the bridge.
    await Promise.all((this.#options.nativeStores ?? []).map((store) =>
      store.close().catch((): undefined => undefined)));
    for (const [eventId, waiter] of this.#outboundWaiters) {
      clearTimeout(waiter.timer);
      const attempt = this.#outbox?.get(eventId);
      waiter.reject(attempt && ["pending", "unconfirmed"].includes(attempt.status)
        ? new WeChatDeliveryUnconfirmedError()
        : new Error(`WeChat stopped before it delivered ${eventId}`));
    }
    this.#outboundWaiters.clear();
    this.#outboundResults.clear();
    this.#writerReadiness = null;
    this.#desktopComposerWarmAt = 0;
    this.#writerPriorityUntil = 0;
    // Only the relay we started; one that was already running belongs to
    // whoever started it and outlives us.
    this.#relayProcess?.kill();
    this.#relayProcess = null;
    await this.#resumeSupervisedRelay();
    await new Promise<void>((resolve) => {
      const server = this.#server;
      if (!server) return resolve();
      // Dropped here rather than left behind: `start` reads it as "already
      // up", and a closed server would make relinking a silent no-op.
      this.#server = null;
      server.close(() => resolve());
    });
    if (this.#saving) clearTimeout(this.#saving);
    this.#saving = null;
    await this.#flush();
    this.#outbox?.close();
    this.#outbox = null;
    this.#outboxOwner = null;
  }

  /** Waits until WeChat itself has accepted the Matrix event, not merely until
   * the embedded homeserver has recorded it. Results are retained briefly so
   * a very fast appservice transaction cannot race ahead of the caller. */
  async waitForOutbound(eventId: string, timeoutMs = 320_000): Promise<void> {
    const completed = this.#outboundResults.get(eventId);
    if (completed) {
      this.#outboundResults.delete(eventId);
      if (completed.error) throw completed.error;
      return;
    }
    const recorded = this.#outbox?.get(eventId);
    if (recorded?.status === "confirmed") return;
    if (recorded?.status === "unconfirmed") throw new WeChatDeliveryUnconfirmedError();
    if (recorded?.status === "failed") throw new Error(recorded.error ?? "The previous WeChat attempt failed");
    return await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#outboundWaiters.delete(eventId);
        this.#options.homeserver.setOutboundDeliveryStatus?.(eventId, "unconfirmed");
        reject(new WeChatDeliveryUnconfirmedError());
      }, timeoutMs);
      timer.unref?.();
      this.#outboundWaiters.set(eventId, {resolve, reject, timer});
    });
  }

  /**
   * Whether the persistent relay can accept an outbound message now.
   *
   * A connected process is not enough: WeChat rebuilds its Qt input chain
   * after restarts, and the relay then reports `hijackArmed:false` until a chat
   * selection reaches it. Try the non-activating native primer once, then
   * report the truth to startup and composers instead of discovering the cold
   * path through a timeout after a local bubble has already appeared.
   */
  outboundFailure(): string | null { return this.#options.writer?.readinessFailure?.() ?? null; }

  async outboundReady(): Promise<boolean> {
    const ready = await this.#outboundSenderReady();
    if (ready) await this.#ensureFileTransferPortal();
    return ready;
  }

  async #outboundSenderReady(): Promise<boolean> {
    if (!this.#relayRecoverySafe) return false;
    if (this.#options.writer?.compatible && !(await this.#options.writer.compatible())) return false;
    this.#trace("outbound ready start");
    // Explicit text work takes priority over best-effort image recovery in
    // this bridge. The writer performs the matching daemon-wide preemption at
    // its own process boundary.
    await this.#quiesceImageRecoveryForWriter();
    // Production supplies a read-only session helper. A signed-in desktop can
    // prepare its composer directly without waiting on authenticated relay
    // reads that may currently be occupied by media recovery.
    let desktopSession: WeChatSessionState | null = null;
    let recentlyWarmedUnavailableSession = false;
    if (this.#options.writer && this.#options.sessionState) {
      const session = await this.#desktopSessionState();
      desktopSession = session;
      this.#trace(`outbound desktop state ${session}`);
      if (
        session === "signed_out" ||
        session === "interactive_login" ||
        session === "locked"
      ) {
        this.#desktopComposerWarmAt = 0;
        return false;
      }
      if (session === "signed_in") {
        // A healthy receive relay does not prove the inactive desktop
        // composer has its bounded window guard installed. Explicit Hub/agent
        // wake owns that one-time preparation so the first actual send never
        // pays the native setup cost or risks surfacing WeChat.
        return await this.#writerReady();
      }
      // A deliberately hidden WeChat window can stop advertising its AX tree
      // immediately after a successful cold wake. Preserve that freshly
      // prepared composer until current relay health confirms whether the same
      // desktop process is still attached; otherwise sendAudio/sendFile calls
      // perform a second cold wake directly after renderer readiness.
      recentlyWarmedUnavailableSession = session === "unavailable" &&
        this.#desktopComposerIsWarm();
      if (!recentlyWarmedUnavailableSession) this.#desktopComposerWarmAt = 0;
    }
    // Older/custom writer integrations may not expose the read-only desktop
    // session probe. Their successful semantic preparation is still safe to
    // reuse for the same short readiness window, avoiding duplicate launches
    // when a wake and its send arrive back-to-back.
    if (
      this.#options.writer &&
      !this.#options.sessionState &&
      this.#desktopComposerIsWarm()
    )
      return true;
    // A signed-out relay cannot become healthy by itself. Let the bounded
    // native readiness path request WeChat's remembered-account login in the
    // background; QR/new-account challenges remain interactive and fail closed.
    // A bundled desktop writer does not depend on the inbound relay. Its
    // explicit wake only needs a quick attachment hint before launching or
    // preparing WeChat; waiting on the relay's full authenticated read can
    // otherwise postpone a cold app launch by an entire network timeout.
    let relayHealthy = this.#options.writer
      ? (await this.#relayStatus(OUTBOUND_PROBE_TIMEOUT_MS)) === "connected"
      : await this.#relayHealthy();
    this.#trace(`outbound relay hint ${relayHealthy ? "connected" : "unavailable"}`);
    const warmedDesktopStillAttached = recentlyWarmedUnavailableSession &&
      relayHealthy && this.#relayWeChatPid !== null;
    if (recentlyWarmedUnavailableSession && !warmedDesktopStillAttached)
      this.#desktopComposerWarmAt = 0;
    // A timed-out relay probe deliberately preserves its last confirmed PID,
    // but the native desktop session helper is fresher evidence that WeChat is
    // currently absent or still launching. Treat that as a cold wake so the
    // idempotent app launcher runs immediately instead of trusting stale relay
    // attachment state.
    const appWasAttached = warmedDesktopStillAttached || (
      !(
        desktopSession === "unavailable" ||
          desktopSession === "launching" ||
          desktopSession === "remembered_login"
      ) && this.#relayWeChatPid !== null
    );
    // The relay can remain reachable after the WeChat app itself exits. An
    // explicit readiness request comes from a Hub composer or agent action,
    // so this is the right boundary for an on-demand, non-activating relaunch.
    // Passive stream/status work deliberately does not cross this boundary.
    if (!relayHealthy || this.#relayWeChatPid === null) {
      // A positive native-manager result belongs to the WeChat process that
      // just disconnected. Re-probe after the remembered session relaunches;
      // retain a recent negative result so status polling cannot attach a new
      // debugger on every pass while login is still pending.
      if (!this.#writerPaused && this.#writerReadiness?.ready === true)
        this.#writerReadiness = null;
      if (this.#options.writer) {
        // Keep the readiness answer behind the real cold wake. Returning the
        // bundled writer's capability here used to let the renderer create a
        // "Sending" bubble while remembered login was still pending; a later
        // failure then restored the draft and made a retry ambiguous. Healthy
        // sessions still take the fast path above.
        this.#trace(`outbound scheduling ${appWasAttached ? "warm" : "cold"} wake`);
        return await this.#scheduleWriterSessionWake(appWasAttached);
      }
      if (await this.#ensureAppRunning()) {
        // Plain text and cached draft work use the bundled writer. They do not
        // need the relay's native-manager probe, which can block behind a
        // daemon recovering from the old WeChat process. Prime the new
        // desktop session directly and let the passive consumer resume the
        // inbound relay independently.
        relayHealthy = await this.#waitForRelay();
        if (!relayHealthy) relayHealthy = await this.#startRelay();
      }
      if (!relayHealthy) return false;
      if (!(await this.#waitForRelayApp())) return false;
      this.#ensureConsume();
      if (!appWasAttached && (await this.#warmNewDesktopComposer())) return true;
    }
    if (this.#relayHijackArmed !== false) return true;
    // The bundled native writer is the definite fallback for a cold relay and
    // checks its exact WeChat build when a send actually uses it. A status
    // read must not pause a healthy relay just to prove that capability again.
    if (this.#options.writer) return true;
    if (await this.#primeApp())
      if (await this.#waitForRelayArmed()) return true;
    // Current WeChat builds can expose a read-only accessibility chat list to
    // other processes. The writer's readiness path schedules the same
    // semantic selection inside WeChat, restarts its persistent hook, and only
    // returns true after the relay advertises that it observed the selection.
    return await this.#writerReady();
  }

  /** Read-only sender state for periodic Hub status. Unlike `outboundReady`,
   * this never launches WeChat, selects a chat, or attaches a native probe. */
  async outboundStatus(): Promise<boolean> {
    const status = await this.#relayStatus();
    // A bundled writer plus the installed loopback relay is an on-demand
    // capability even while WeChat itself is user-quit. Reporting that
    // capability keeps cached WeChat chats available to open; the explicit
    // wake path performs the actual hidden relaunch.
    if (this.#options.writer) return true;
    if (status !== "connected" || this.#relayWeChatPid === null) return false;
    if (this.#relayHijackArmed !== false) return true;
    return false;
  }

  /** Saved stickers currently present in WeChat Desktop's native picker.
   * Missing Matrix previews are hydrated from their exact CDN reference
   * without opening or foregrounding WeChat. */
  async stickerCatalog(): Promise<WeChatStickerCatalogEntry[]> {
    await this.#load();
    let references: Array<[
      string,
      NonNullable<BridgeState["stickerReferences"]>[string],
    ]>;
    if (this.#options.writer?.stickers) {
      const native = await this.#options.writer.stickers();
      const seenAt = Date.now();
      const stored = {...(this.#state.stickerReferences ?? {})};
      const nativeReferences: typeof references = native.map((sticker, index) => {
        if (
          !/^[a-f0-9]{32}$/.test(sticker.id) ||
          !new RegExp(`\\bmd5\\s*=\\s*["']${sticker.id}["']`, "i").test(
            sticker.xml,
          )
        )
          throw new Error("WeChat returned an invalid native sticker");
        stored[sticker.id] = {
          ...(stored[sticker.id] ?? {}),
          xml: sticker.xml,
          seenAt: seenAt - index,
        };
        return [sticker.id, stored[sticker.id]];
      });
      this.#state.stickerReferences = stored;
      this.#save();
      // The bundled writer's picker probe is intentionally best-effort on
      // builds where WeChat exposes no stable listing API. An empty result
      // must not erase exact references already verified from real message
      // history; keep native ordering first, then the observed catalog.
      const nativeIds = new Set(nativeReferences.map(([id]) => id));
      references = [
        ...nativeReferences,
        ...Object.entries(stored)
          .filter(([id]) => !nativeIds.has(id))
          .sort(([, left], [, right]) => right.seenAt - left.seenAt),
      ];
    } else {
      // Injected writers used by tests and integrations predating the native
      // picker still expose the exact references observed in chat history.
      references = Object.entries(this.#state.stickerReferences ?? {}).sort(
        ([, left], [, right]) => right.seenAt - left.seenAt,
      );
    }
    const catalog = await Promise.all(
      references.map(([id, reference]) =>
        this.#stickerCatalogEntry(id, reference).catch((): null => null),
      ),
    );
    return catalog.filter(
      (entry): entry is WeChatStickerCatalogEntry => entry !== null,
    );
  }

  /** Read-only desktop authentication state for the Hub's explicit wake UI.
   * Passive status paths must not use this to relaunch or interact with WeChat. */
  async desktopSessionState(): Promise<WeChatSessionState | null> {
    return await this.#desktopSessionState();
  }

  /** The native directory includes silent group members who have never had a
   * message imported into this portal. Reading it does not send invitations
   * or mark the group read. */
  async members(roomId: string): Promise<ChatMemberDto[] | null> {
    await this.#load();
    const chatId = this.#state.roomToChat[roomId];
    if (!chatId || !/@chatroom$/i.test(chatId)) return null;
    const nativeStore = this.#nativeStores()[0];
    if (nativeStore) {
      const rows = await nativeStore.members(chatId);
      const members = rows.filter(row => row.wxid !== nativeStore.wxid).map((row): ChatMemberDto => {
        const userId = this.#puppet(row.wxid);
        (this.#state.puppetRemoteIds ??= {})[userId] = row.wxid;
        return {userId, name: row.displayName || row.wxid, avatarUrl: null};
      });
      this.#save();
      return members.sort((left, right) => left.name.localeCompare(right.name));
    }

    for (const cli of this.#cliPaths()) {
      const result = await run(cli, ["members", chatId, "--json"], {
        timeout: SELF_SENT_TIMEOUT_MS,
      }).catch((): null => null);
      if (!result) continue;
      const rows: unknown = JSON.parse(result.stdout);
      if (!Array.isArray(rows)) throw new Error("WeChat did not return its group member directory");
      const self = await this.#accountWxid();
      const members = new Map<string, ChatMemberDto>();
      for (const row of rows) {
        if (!row || typeof row.wxid !== "string" || !/^[A-Za-z0-9_-]+$/.test(row.wxid))
          throw new Error("WeChat returned an invalid group member");
        if (row.wxid === self) continue;
        const userId = this.#puppet(row.wxid);
        (this.#state.puppetRemoteIds ??= {})[userId] = row.wxid;
        members.set(userId, {userId,
          name: named(row.group_nickname) ?? named(row.display_name) ?? row.wxid,
          avatarUrl: null});
      }
      this.#save();
      return [...members.values()].sort((left, right) => left.name.localeCompare(right.name));
    }
    throw new Error("WeChat's group member directory is unavailable");
  }

  async groupInfo(roomId: string): Promise<ChatGroupInfoDto> {
    await this.#load();
    const chatId = this.#state.roomToChat[roomId];
    if (!chatId || !/^[1-9]\d{0,30}@chatroom$/.test(chatId))
      throw new Error("Only WeChat groups can be renamed");
    this.#assertLiveTestDestination(chatId);
    if (!this.#options.writer?.groupInfo)
      throw new Error("WeChat group settings are unavailable");
    const info = await this.#options.writer.groupInfo(chatId);
    if (info.chatId !== chatId) throw new Error("WeChat returned another group's settings");
    return {name: info.name, isMember: info.isMember};
  }

  async renameGroup(roomId: string, name: string, expectedName: string): Promise<ChatGroupInfoDto> {
    if (typeof name !== "string" || !name.trim() || name !== name.trim() ||
        /[\u0000-\u001f\u007f]/.test(name) || Buffer.byteLength(name) > 1024 ||
        Buffer.from(name).toString() !== name || typeof expectedName !== "string" ||
        Buffer.byteLength(expectedName) > 4096)
      throw new Error("Enter a valid group name and reload the current name before saving");
    const current = await this.groupInfo(roomId);
    if (!current.isMember) throw new Error("You are no longer a member of this WeChat group");
    if (current.name !== expectedName && current.name !== name)
      throw new Error("The group name changed in WeChat. Reload the current name and try again.");
    const chatId = this.#state.roomToChat[roomId]!;
    await this.#write({kind: "rename-group", chatId, name, expectedName});
    // Re-read after native verification; never paint an unconfirmed name or
    // overwrite a newer remote rename with this form's old input.
    const confirmed = await this.groupInfo(roomId);
    if (!confirmed.isMember || confirmed.name !== name)
      throw new Error("The group name changed again in WeChat. Reload its current name.");
    await this.#portal(chatId, {chatId, chatName: confirmed.name});
    return confirmed;
  }

  async #accountWxid(): Promise<string | null> {
    if (this.#selfWxid !== undefined) return this.#selfWxid;
    const native = this.#nativeStores()[0]?.wxid;
    if (native) return this.#selfWxid = native;
    for (const cli of this.#cliPaths()) {
      const result = await run(cli, ["accounts", "--json"], {timeout: SELF_SENT_TIMEOUT_MS}).catch((): null => null);
      if (!result) continue;
      try {
        const data = JSON.parse(result.stdout);
        const rows = Array.isArray(data.accounts) ? data.accounts : [];
        const selected = Array.isArray(data.default) ? rows.find((row: {wxid?: string; bundle_id?: string}) =>
          row.wxid === data.default[1] && (!row.bundle_id || row.bundle_id === data.default[0])) :
          rows.length === 1 ? rows[0] : null;
        if (typeof selected?.wxid === "string") return this.#selfWxid = selected.wxid;
      } catch { /* Another configured reader may expose accounts. */ }
    }
    return null;
  }

  /** A primer action only means macOS accepted the semantic command. WeChat
   * still has to advertise that its sender actually rebuilt; otherwise a cold
   * relay can return a false-positive success without creating a message. */
  async #waitForRelayArmed(timeoutMs = 500): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    do {
      const relayStatus = await this.#relayStatus(
        Math.min(OUTBOUND_PROBE_TIMEOUT_MS, Math.max(1, deadline - Date.now())),
      );
      if (relayStatus === "connected" && this.#relayHijackArmed === true)
        return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    return false;
  }

  #writerReadiness: {checkedAt: number; ready: boolean} | null = null;
  #writerReadinessTask: Promise<boolean> | null = null;

  async #writerReady(): Promise<boolean> {
    if (!this.#relayRecoverySafe) return false;
    const writer = this.#options.writer;
    if (!writer?.ready) return false;
    if (
      this.#writerReadiness &&
      Date.now() - this.#writerReadiness.checkedAt < WRITER_READINESS_TTL_MS
    )
      return this.#writerReadiness.ready;
    if (this.#writerReadinessTask) return await this.#writerReadinessTask;
    const check: Promise<boolean> = this.#probeWriterReady(writer)
      .catch((error: unknown) => {
        this.#log(`[wechat] automatic sender is not ready: ${message(error)}`);
        return false;
      })
      .then((ready) => {
        this.#writerReadiness = {checkedAt: Date.now(), ready};
        return ready;
      })
      .finally(() => {
        if (this.#writerReadinessTask === check)
          this.#writerReadinessTask = null;
      });
    this.#writerReadinessTask = check;
    return await check;
  }

  async #probeWriterReady(writer: WeChatWriter): Promise<boolean> {
    let release!: () => void;
    const previous = this.#writerQueue;
    this.#writerQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    let restartRelay = false;
    let prepared = false;
    let probeError: unknown;
    try {
      if (this.#relayRecovery) await this.#relayRecovery;
      this.#writerPaused = true;
      restartRelay = await this.#pauseRelayForWriter();
      prepared = await writer.ready!();
      if (writer.readinessRecoverySafe?.() === false) this.#holdRelayRecovery();
      if (!prepared && writer.readinessFailure?.())
        this.#log(`[wechat] native preparation: ${writer.readinessFailure()}`);
    } catch (error) {
      if (writer.readinessRecoverySafe?.() === false ||
          this.#unsafeNativeFailure(error)) this.#holdRelayRecovery();
      probeError = error;
    }
    // Restore the relay synchronously after the exclusive native-manager
    // probe. Native readiness is independent of the relay's optional Qt send
    // hook, so a cold `hijackArmed` flag does not invalidate this result.
    this.#writerPaused = false;
    try {
      if (probeError) {
        if (!this.#stopped && restartRelay) this.#scheduleRelayRecovery();
        throw probeError;
      }
      // A remembered-account login request is intentionally not ready yet.
      // Restore the relay in the background while the phone approval completes
      // instead of holding a Hub status read on the relay's startup timeout.
      if (this.#stopped || !prepared) {
        if (!this.#stopped && restartRelay) this.#scheduleRelayRecovery();
        return false;
      }
      if (!this.#stopped && restartRelay && !(await this.#startRelay()))
        return false;
      return true;
    } finally {
      release();
      if (!this.#stopped) this.#ensureConsume();
    }
  }

  /** Recalls an event only after the native operation succeeds, then writes a
   * bridge-owned Matrix redaction so it cannot loop back out as a second recall. */
  async recall(roomId: string, eventId: string): Promise<void> {
    const chatId = this.#state.roomToChat[roomId];
    const messageId = this.#state.remoteMessageIds?.[eventId];
    if (!chatId || !messageId)
      throw new Error("This WeChat message is not available to recall");
    this.#assertLiveTestDestination(chatId);
    const target = await this.#matrix<MatrixEvent>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
    );
    if (target.room_id !== roomId || target.sender !== this.#owner)
      throw new Error("Only this account's messages in this WeChat conversation can be recalled");
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

  /** The Desktop acknowledgement must precede the local receipt. An accepted
   * Matrix receipt alone cannot establish that WeChat cleared its badge. */
  async markRead(roomId: string, eventId: string): Promise<void> {
    const chatId = this.#state.roomToChat[roomId];
    if (!chatId) throw new Error("This WeChat conversation is not available");
    this.#assertLiveTestDestination(chatId);
    const target = await this.#matrix<MatrixEvent>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
    );
    if (target.room_id !== roomId)
      throw new Error("The read marker belongs to another conversation");
    await this.#write({kind: "read", chatId});
    await this.#matrix(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
      {method: "POST", as: this.#owner, body: {}},
    );
    await this.#publishUnreadCount(chatId, () => 0);
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

  async #relayStatus(timeoutMs = PROBE_TIMEOUT_MS * 10): Promise<string | null> {
    const health = await this.#relay<{
      status?: string;
      hijackArmed?: boolean;
      wechatPid?: number;
    }>("/health", {timeoutMs}).catch((): null => null);
    // A busy loopback service is not evidence that WeChat detached. Preserve
    // the last confirmed attachment until an actual health response replaces
    // it, so one delayed read cannot force a slow native wake.
    if (health) {
      this.#relayHijackArmed =
        typeof health.hijackArmed === "boolean" ? health.hijackArmed : null;
      this.#relayWeChatPid =
        Number.isInteger(health.wechatPid) && Number(health.wechatPid) > 0
          ? Number(health.wechatPid)
          : null;
    }
    if (health?.status === "connected" && this.#writerReadiness?.ready === false)
      this.#writerReadiness = null;
    return typeof health?.status === "string" ? health.status : null;
  }

  async #ensureAppRunning(): Promise<boolean> {
    if (!this.#options.ensureAppRunning) return false;
    return await this.#options.ensureAppRunning().catch((error: unknown) => {
      this.#log(`[wechat] WeChat could not be started quietly: ${message(error)}`);
      return false;
    });
  }

  /** A long-lived wechatd may retain its debugger watch after the desktop app
   * exits. If it sees the next cold process before the login window finishes,
   * that process stays permanently in Launch Services' `launching` state.
   * Disarm it while no account process is attached; relay recovery starts the
   * daemon again after the remembered session and composer are ready. */
  async #stopDaemonForColdLaunch(): Promise<boolean> {
    // An explicit empty binary fleet is the test/integration opt-out. Never
    // fall through to a developer machine's globally installed WeChat CLI.
    if (this.#options.binaryDirectories?.length === 0) return false;
    let target = this.#releaseRelayPause?.nativeTarget;
    if (!target) {
      const pid = await this.#nativeWriterTargetPid();
      if (pid) {
        const observed = await run("/bin/ps", ["-p", String(pid), "-o", "lstart=,comm="],
          {timeout: 2_000, env: process.env});
        const identity = observed.stdout.trim();
        if (!identity) throw new Error("WeChat exited before session recovery");
        target = {pid, identity};
      }
    }
    for (const cli of this.#cliPaths()) {
      try {
        await recoverWeChatSession(cli, {target});
        return true;
      } catch (error) {
        // Only a binary that never launched permits trying the next path.
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
        if (this.#unsafeNativeFailure(error)) this.#holdRelayRecovery();
        throw error;
      }
    }
    return false;
  }

  async #primeApp(): Promise<boolean> {
    if (!this.#options.primeApp) return false;
    return await this.#options.primeApp().catch((error: unknown) => {
      this.#log(`[wechat] background send warm-up failed: ${message(error)}`);
      return false;
    });
  }

  async #desktopSessionState(): Promise<WeChatSessionState | null> {
    if (!this.#options.sessionState) return null;
    return await this.#options.sessionState().catch(
      (): "unavailable" => "unavailable",
    );
  }

  /** The renderer normally checks `outboundReady()` before it creates an
   * outbound event, but Matrix events and recalls can
   * also reach the writer directly.  Re-check the actual desktop session at
   * the last responsible boundary so a running, signed-out WeChat process is
   * never mistaken for a usable sender. */
  async #assertOutboundSessionSignedIn(): Promise<void> {
    const state = await this.#desktopSessionState();
    if (state === null || state === "signed_in") return;
    this.#desktopComposerWarmAt = 0;
    const reason = state === "locked"
      ? "wechat_session_locked"
      : state === "signed_out"
        ? "wechat_signed_out"
        : state === "interactive_login"
          ? "wechat_interactive_sign_in_required"
          : "wechat_login_pending";
    throw new Error(WECHAT_WRITER_FAILURES[reason]);
  }

  /** The native driver carries the same guard, but not every operation uses
   * it: an attached relay owns the fastest plain-text route. Enforce the
   * acceptance-test recipient before either transport can touch WeChat. */
  #assertLiveTestDestination(chatId: string): void {
    if (isWeChatSessionContainer(chatId))
      throw new Error("This WeChat folder is not a conversation. Open one of its chats instead.");
    if (this.#options.testChatIds !== undefined && !this.#options.testChatIds.includes(chatId))
      throw new Error("live WeChat testing is restricted to the selected test chats");
    if (
      this.#options.testOnlyFileHelper &&
      chatId.trim().toLowerCase() !== "filehelper"
    )
      throw new Error("live WeChat testing is restricted to filehelper");
  }

  /** Waits for a newly launched WeChat window to expose its semantic chat
   * controls, then selects the current conversation without activation. This
   * deliberately does not wait for relay health: the relay and its daemon can
   * still be recovering from the previous WeChat process, while the desktop
   * composer is already safe to prepare for one verified send. */
  async #warmNewDesktopComposer(
    timeoutMs = this.#options.desktopSessionWarmupMs ?? 15_000,
  ): Promise<boolean> {
    if (!this.#options.primeApp) return false;
    const deadline = Date.now() + timeoutMs;
    let primed = false;
    do {
      if (this.#options.sessionState) {
        const state = await this.#options.sessionState().catch(
          (): "unavailable" => "unavailable",
        );
        if (
          state === "signed_out" ||
          state === "remembered_login" ||
          state === "interactive_login" ||
          state === "locked"
        )
          return false;
        if (state === "signed_in") {
          const primed = await this.#primeApp();
          if (!primed) return false;
          await new Promise((resolve) => setTimeout(resolve, 100));
          this.#desktopComposerWarmAt = Date.now();
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      if (!primed) primed = await this.#primeApp();
      if (primed) {
        const ready = this.#options.sessionReady
          ? await this.#options.sessionReady().catch(() => false)
          : true;
        if (ready) {
          // A remembered-login request exposes the signed-in session list
          // before its first chat selection has rebuilt the composer. Apply
          // one final semantic prime, then let that Qt transition settle.
          if (this.#options.sessionReady) await this.#primeApp();
          await new Promise((resolve) => setTimeout(resolve, 500));
          this.#desktopComposerWarmAt = Date.now();
          return true;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    return false;
  }

  #desktopComposerIsWarm(): boolean {
    return this.#desktopComposerWarmAt > 0 &&
      Date.now() - this.#desktopComposerWarmAt < WRITER_READINESS_TTL_MS;
  }

  /** Keeps the relay detached through WeChat's post-login window rebuild. The
   * exact login action can return while the session list is still absent; an
   * early debugger reattach freezes that transition indefinitely. */
  async #waitForDesktopSession(timeoutMs = 45_000): Promise<boolean> {
    if (!this.#options.sessionState && !this.#options.sessionReady) return false;
    const deadline = Date.now() + timeoutMs;
    let rememberedLoginRequested = false;
    let rememberedLoginAttempted = false;
    let interactiveSince = 0;
    let previousState = "";
    do {
      const state = this.#options.sessionState
        ? await this.#options.sessionState().catch(
            (): "unavailable" => "unavailable",
          )
        : (await this.#options.sessionReady?.().catch(() => false))
          ? "signed_in"
          : "unavailable";
      if (state !== previousState) {
        this.#trace(`writer session state ${state}`);
        previousState = state;
      }
      if (state === "signed_in") {
        await this.#primeApp();
        await new Promise((resolve) => setTimeout(resolve, 500));
        this.#desktopComposerWarmAt = Date.now();
        return true;
      }
      if (state === "remembered_login" && !rememberedLoginAttempted) {
        // The semantic primer can press this exact remembered-account action
        // without a debugger or activation. Qt may expose that control only
        // as AXRaise; in that exact pinned build the isolated native writer
        // owns the in-process semantic fallback. Ask each path once, then keep
        // every later readiness poll read-only while WeChat rebuilds.
        rememberedLoginAttempted = true;
        rememberedLoginRequested = await this.#primeApp();
        if (!rememberedLoginRequested && this.#options.writer &&
            (!this.#options.prepareLoginOptions || await this.#options.prepareLoginOptions().catch(() => false)))
          rememberedLoginRequested = await this.#writerReady();
      }
      // WeChat briefly exposes login-prefixed controls while replacing the
      // remembered-account window with the signed-in session list. Require an
      // interactive-login surface to persist before treating it as a QR/user
      // handoff; otherwise a successful automatic restore can be rejected in
      // the last second of its transition.
      if (state === "interactive_login") {
        interactiveSince ||= Date.now();
        if (Date.now() - interactiveSince >= 5_000) return false;
      } else {
        interactiveSince = 0;
      }
      if (state === "signed_out" || state === "locked") return false;
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    return false;
  }

  async #waitForRelay(): Promise<boolean> {
    const deadline = Date.now() + RELAY_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.#relayHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  async #waitForRelayApp(timeoutMs = RELAY_START_TIMEOUT_MS): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await this.#relayHealthy()) && this.#relayWeChatPid !== null)
        return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
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
    const binaryDirectories =
      this.#options.binaryDirectories ?? WECHAT_FALLBACK_DIRECTORIES;
    // An explicit empty list is the bridge's hard boundary against managing
    // local binaries (including in the isolated test harness). Do not scan
    // the whole Mac for a process we could not authorize afterward anyway.
    if (!binaryDirectories.length) return null;
    const found = await run(
      "/usr/sbin/lsof",
      [
        "-nP",
        "-a",
        `-iTCP:${this.#relayPort()}`,
        "-sTCP:LISTEN",
        "-c",
        "wechat-bridge",
        "-t",
      ],
      { timeout: PROBE_TIMEOUT_MS, env: process.env },
    ).catch((): null => null);
    const pid = weChatRelayListenerPid(found?.stdout ?? "");
    if (!pid) return null;
    const executable = await run(
      "/bin/ps",
      ["-p", String(pid), "-o", "comm="],
      { timeout: PROBE_TIMEOUT_MS, env: process.env },
    ).catch((): null => null);
    const actual = executable?.stdout.trim();
    if (!actual || path.basename(actual) !== "wechat-bridge") return null;
    const resolved = await realpath(actual).catch((): null => null);
    if (!resolved) return null;
    for (const directory of binaryDirectories) {
      const known = await realpath(path.join(directory, "wechat-bridge")).catch(
        (): null => null,
      );
      if (known === resolved) return pid;
    }
    return null;
  }

  async #pauseRelayForWriter(): Promise<boolean> {
    if (this.#options.externalProvider === false) {
      // The native driver checks for competing capture processes without
      // calling, stopping or restarting the external provider.
      return false;
    }
    await this.#quiesceImageRecoveryForWriter();
    if (this.#releaseRelayPause) return true;
    const child = this.#relayProcess;
    const childRunning = childProcessIsRunning(child);
    const pid = childRunning ? child?.pid : await this.#relayListenerPid();
    if (!pid) return false;
    this.#writerPaused = true;
    this.#streaming?.abort();
    if (childRunning && child) {
      const targetPid = await this.#nativeWriterTargetPid();
      const writer = this.#options.writer;
      if (!targetPid || !writer?.setNativeTarget)
        throw new Error("WeChat native writing needs an exact process identity before stopping its relay");
      const target = await run(
        "/bin/ps",
        ["-p", String(targetPid), "-o", "lstart=,comm="],
        {timeout: PROBE_TIMEOUT_MS, env: process.env},
      ).catch((): null => null);
      const identity = target?.stdout.trim();
      if (!identity)
        throw new Error("WeChat native target exited before its relay could be stopped");
      const nativeTarget = {pid: targetPid, identity};
      writer.setNativeTarget(nativeTarget);
      // Use the same release slot as an externally supervised relay. A
      // successful writer cleanup lets recovery clear this pin; an unknown
      // stop or writer cleanup keeps both the pin and recovery hold in place.
      this.#releaseRelayPause = Object.assign(
        async (): Promise<void> => undefined,
        {nativeTarget},
      );
      this.#relayProcess = null;
      child.kill("SIGTERM");
      try {
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
      } catch (error) {
        this.#holdRelayRecovery();
        throw error;
      }
      return true;
    } else {
      this.#relayProcess = null;
      const targetPid = await this.#nativeWriterTargetPid();
      const writer = this.#options.writer;
      if (!targetPid || !writer?.setNativeTarget)
        throw new Error("WeChat native writing needs an exact process identity before pausing its relay");
      const release = await pauseWeChatRelay(pid, {nativeTargetPid: targetPid});
      this.#releaseRelayPause = release;
      writer.setNativeTarget(release.nativeTarget!);
      return true;
    }
  }

  async #nativeWriterTargetPid(): Promise<number | null> {
    const pid = this.#options.appProcessId
      ? await this.#options.appProcessId().catch((): null => null)
      : this.#relayWeChatPid;
    return Number.isSafeInteger(pid) && Number(pid) > 1 ? pid : null;
  }

  async #resumeSupervisedRelay(): Promise<void> {
    if (!this.#relayRecoverySafe) return;
    const release = this.#releaseRelayPause;
    if (!release) return;
    try {
      await release();
      if (this.#releaseRelayPause === release) this.#releaseRelayPause = null;
      this.#options.writer?.setNativeTarget?.(null);
    } catch (error) {
      // A dead watchdog or a still-traced target is not a release receipt.
      // Keep the callback and process pin for diagnosis; do not start a relay.
      this.#holdRelayRecovery();
      throw error;
    }
  }

  async #quiesceImageRecoveryForWriter(): Promise<void> {
    // Image recovery can spend tens of seconds asking WeChat's daemon for an
    // old encrypted photo. It must yield before either the daemon-owned text
    // sender or an exclusive native writer asks the same WeChat process to do
    // outbound work.
    this.#imageRetryAbort?.abort();
    for (const controller of this.#activeImageReads) controller.abort();
    const imageRetryDeadline = Date.now() + 1_000;
    while (this.#retryingImages && Date.now() < imageRetryDeadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
  }

  /**
   * Brings the relay up and waits for it to answer. Returns false when there
   * is nothing to start, which is the ordinary case on a Mac that has never
   * had these tools — not an error worth reporting anywhere but the log.
   */
  async #startRelay(): Promise<boolean> {
    if (this.#options.externalProvider === false) return false;
    if (!this.#relayRecoverySafe) return false;
    await this.#resumeSupervisedRelay();
    if (this.#desktopSessionPending) return false;
    if (this.#relayStart) return await this.#relayStart;
    const start = this.#startRelayOnce();
    this.#relayStart = start;
    try {
      return await start;
    } finally {
      if (this.#relayStart === start) this.#relayStart = null;
    }
  }

  #scheduleWriterSessionWake(appWasAttached: boolean): Promise<boolean> {
    if (this.#writerSessionWake) return this.#writerSessionWake;
    const wake = this.#wakeWriterSession(appWasAttached)
      .catch((error: unknown) => {
        this.#log(`[wechat] relay wake failed: ${message(error)}`);
        return false;
      })
      .finally(() => {
        if (this.#writerSessionWake === wake) this.#writerSessionWake = null;
      });
    this.#writerSessionWake = wake;
    return wake;
  }

  async #wakeWriterSession(appWasAttached: boolean): Promise<boolean> {
    this.#trace(`writer wake start ${appWasAttached ? "attached" : "cold"}`);
    let available = true;
    let keepPausedForWriter = false;
    try {
      if (!appWasAttached) {
        this.#writerPaused = true;
        // Stop the relay before launching WeChat. Its debugger otherwise sees
        // the process first and suspends the remembered-login window before
        // the semantic button action can be handled.
        await this.#pauseRelayForWriter();
        this.#trace("writer wake relay paused");
        const daemonStopped = await this.#stopDaemonForColdLaunch();
        this.#trace(
          `writer wake daemon ${daemonStopped ? "stopped" : "unavailable"}`,
        );
        available = await this.#ensureAppRunning();
        this.#trace(`writer wake app ${available ? "running" : "unavailable"}`);
        const warm = available ? await this.#warmNewDesktopComposer() : false;
        this.#trace(`writer wake composer ${warm ? "warm" : "pending"}`);
        if (available && !warm) {
          // A locked session cannot service its semantic controls. A process
          // that is merely still launching must remain pending: remembered
          // sessions can outlive the first warm-up and then become sendable
          // without user intervention.
          if ((await this.#desktopSessionState()) === "locked") return false;
          this.#desktopSessionPending = Boolean(
            this.#options.sessionState || this.#options.sessionReady,
          );
          available = this.#options.sessionState || this.#options.sessionReady
            ? await this.#waitForDesktopSession()
            : await this.#writerReady();
          this.#trace(`writer wake session ${available ? "ready" : "unavailable"}`);
          if (available) this.#desktopSessionPending = false;
        } else if (warm) {
          this.#desktopSessionPending = false;
        }
      }
      if (available) {
        // Publish writer ownership before dropping `#writerPaused`. A passive
        // consumer may already be waiting to restore inbound sync; without
        // this handoff it can attach the daemon in the narrow gap and put the
        // explicit send behind an entire relay-recovery timeout.
        this.#writerPriorityUntil = Math.max(
          this.#writerPriorityUntil,
          Date.now() + 5_000,
        );
        keepPausedForWriter = true;
      }
    } finally {
      this.#writerPaused = false;
      if (!keepPausedForWriter || this.#stopped) await this.#resumeSupervisedRelay();
    }
    if (this.#stopped) return false;
    // Never let the debugger back into a remembered-login transition that did
    // not finish. A later explicit Hub or agent action can retry the wake.
    if (!available) return false;
    // The desktop-owned writer can deliver once its composer is warm even if
    // the optional inbound relay is still being restored. Schedule that
    // recovery now, but keep it behind the writer-priority window so its
    // debugger cannot reclaim WeChat between readiness and the queued send.
    this.#scheduleRelayRecovery();
    return true;
  }

  async #startRelayOnce(): Promise<boolean> {
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
      child.once("exit", (code, signal) => {
        if (this.#relayProcess === child) this.#relayProcess = null;
        if (!this.#stopped && !this.#writerPaused && (code !== 0 || signal))
          this.#log(
            `[wechat] relay exited before recovery (${signal ?? `code ${code ?? "unknown"}`}).`,
          );
      });
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
    const native = this.#nativeInboundActive();
    if (!native && (!this.#relayRecoverySafe || this.#options.externalProvider === false)) return;
    const consume = native ? this.#consumeNative(generation).catch(async (error: unknown) => {
      if (this.#stopped || generation !== this.#consumeGeneration) return;
      this.#nativeInboundFailed = true;
      this.#log(`[wechat] native inbound unavailable; ${this.#options.externalProvider === false ? "imported chats remain available" : "using relay"}: ${message(error)}`);
      if (this.#relayRecoverySafe && this.#options.externalProvider !== false) await this.#consume(generation);
    }) : this.#consume(generation);
    const task = consume.catch((error: unknown) =>
      this.#log(`[wechat] inbound stopped: ${message(error)}`),
    ).finally(() => {
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
      let body: {events?: unknown[]};
      try {body = await readBody(request);}
      catch {return reply(400, {errcode: "M_BAD_JSON"});}
      if (!body || typeof body !== "object" || !Array.isArray(body.events ?? []))
        return reply(400, {errcode: "M_BAD_JSON"});
      if (!this.#state.seenTransactions[id]) {
        let task = this.#transactionTasks.get(id);
        if (!task) {
          task = (async () => {
            for (const event of (body.events ?? []) as MatrixEvent[]) {
              try {
                await this.#relayOutbound(event);
                this.#settleOutbound(event.event_id, null);
              } catch (error) {
                this.#settleOutbound(event?.event_id, error instanceof Error ? error : new Error(message(error)));
                this.#log(`[wechat] outbound failed: ${message(error)}`);
              }
            }
            // Only completed batches enter the replay cache. Each actionable
            // event is fenced durably before its own dispatch, so a crash in
            // a batch leaves later, untouched events eligible for delivery.
            this.#state.seenTransactions[id] = Date.now();
            await this.#flush();
          })();
          this.#transactionTasks.set(id, task);
        }
        try {await task;}
        catch {return reply(500, {errcode: "M_UNKNOWN"});}
        finally {if (this.#transactionTasks.get(id) === task) this.#transactionTasks.delete(id);}
      }
      return reply(200, {});
    }
    // Everything the homeserver asks about our namespace already exists.
    if (request.method === "GET" && /\/users\//.test(url.pathname))
      return reply(200, {});
    if (/\/ping$/.test(url.pathname)) return reply(200, {});
    return reply(404, { errcode: "M_UNRECOGNIZED" });
  }

  #settleOutbound(eventId: string | undefined, error: Error | null): void {
    if (!eventId) return;
    if (!error || isWeChatDeliveryUnconfirmed(error))
      this.#options.homeserver.setOutboundDeliveryStatus?.(eventId,
        error ? "unconfirmed" : null);
    const waiter = this.#outboundWaiters.get(eventId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.#outboundWaiters.delete(eventId);
      if (error) waiter.reject(error);
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

  /** The relay's messageId is a local row number. Resolve its native identity
   * against an exact row and second, never against display text or magnitude. */
  async #withNativeIdentity(item: RelayMessage, localOnly = false): Promise<RelayMessage> {
    // The relay labels Desktop's combined forwards but omits their record XML.
    // Resolve that payload from the same exact native row used for identity.
    const needsNativeBody = ["forward", "appmsg", "image", "video", "emoticon", "file", "attachment", "voice", "audio"]
      .includes(item.messageKind ?? "") &&
      !String(item.body ?? "").trimStart().startsWith("<");
    const hasNativeSender = Boolean(item.sender_wxid) ||
      (item.real_sender_id != null && this.#nativeMessageStores().length > 0);
    if ((!needsNativeBody && hasNativeSender) ||
        (!item.serverId && !item.localId) || !item.chatId) return item;
    const second = Math.floor((originalTimestamp(item) ?? 0) / 1000);
    if (!second) return item;
    const minute = Math.floor(second / 60) * 60;
    // A cached-page read must not inherit an external-provider lookup that
    // happens to be in flight for the same conversation and minute.
    const key = JSON.stringify([item.chatId, minute, localOnly]);
    let page = this.#nativeIdentityPages.get(key);
    if (!page || Date.now() - page.at > 2_000) {
      const chatId = item.chatId;
      const rows = (async (): Promise<RelayMessage[]> => {
        const nativeRead = await this.#nativeHistoryRead(chatId).catch((): null => null);
        if (nativeRead) {
          try {return await nativeRead({until: minute + 60, limit: 1000});}
          catch { /* An unavailable native snapshot can use the configured CLI. */ }
        }
        if (localOnly) return [];
        for (const cli of this.#cliPaths()) {
          const result = await run(cli, ["history", chatId, "--since", String(minute),
            "--until", String(minute + 60), "--limit", "1000", "--json", "--no-transcribe",
            "--fields", "local_id,server_id,create_time,real_sender_id,sender_wxid,message_kind,message_content"],
          {timeout: SELF_SENT_TIMEOUT_MS}).catch((): null => null);
          if (!result) continue;
          try {
            const payload = parseWeChatJson<{rows?: RelayMessage[]}>(result.stdout);
            if (Array.isArray(payload.rows)) return payload.rows;
          } catch { /* Try the next configured reader. */ }
        }
        return [];
      })();
      page = {at: Date.now(), rows};
      this.#nativeIdentityPages.set(key, page);
      if (this.#nativeIdentityPages.size > 128)
        this.#nativeIdentityPages.delete(this.#nativeIdentityPages.keys().next().value!);
    }
    const matches = (await page.rows).filter((row) =>
      (item.serverId ? String(row.server_id) === String(item.serverId) :
        String(row.local_id) === String(item.localId)) && Number(row.create_time) === second &&
      row.server_id != null && String(row.server_id) !== "0");
    if (matches.length !== 1) return item;
    const match = matches[0];
    const resolved = normalise({...item, localId: match.local_id ?? item.localId,
      serverId: match.server_id, real_sender_id: match.real_sender_id,
      sender_wxid: match.sender_wxid ?? item.sender_wxid,
      senderId: match.sender_wxid ?? item.senderId,
      ...(needsNativeBody && typeof match.message_content === "string" ? {
        body: match.message_content,
        messageKind: match.message_kind ?? item.messageKind,
        refer: item.refer ?? weChatAttachmentReply(match.message_content),
      } : {})});
    const fromSelf = await this.#nativeAuthorship(item.chatId, resolved);
    return {...resolved, ...(fromSelf !== null ? {fromSelf} : {})};
  }

  /** Imports the next complete native history page only when the reader asks
   * for it. This never launches, primes, marks read, or sends through WeChat. */
  async loadOlderHistory(roomId: string, limit = 50, throughTimestamp?: number): Promise<boolean> {
    const chatId = this.#state.roomToChat[roomId];
    if (!chatId || isWeChatSessionContainer(chatId)) return false;
    const active = this.#historyTasks.get(chatId);
    if (active) return await active;
    if (this.#state.historyCursors?.[chatId] === null) return false;
    const cursor = this.#state.historyCursors?.[chatId];
    if (typeof cursor === "number" && throughTimestamp !== undefined &&
      Number.isFinite(throughTimestamp) && cursor * 1000 <= throughTimestamp) return false;
    const task = this.#loadOlderHistory(chatId, limit);
    this.#historyTasks.set(chatId, task);
    try { return await task; }
    finally { this.#historyTasks.delete(chatId); }
  }

  /** Retry local files and ordinary sticker downloads for the displayed page. No Desktop launch,
   * debugger, CDN capture, read receipt, or outbound message is involved. */
  async refreshCachedMedia(roomId: string, eventIds: string[]): Promise<boolean> {
    const chatId = this.#state.roomToChat[roomId];
    if (!chatId || this.#stopped || !this.#nativeStores().length) return false;
    const active = this.#mediaRefreshTasks.get(roomId);
    if (active) return active;
    const task = (async () => {
      let changed = false;
      const deadline = Date.now() + 3_000;
      for (const eventId of [...new Set(eventIds)].slice(0, 100)) {
        if (this.#stopped || Date.now() > deadline) break;
        if (Date.now() - (this.#mediaRefreshAt.get(eventId) ?? 0) < 60_000) continue;
        this.#mediaRefreshAt.set(eventId, Date.now());
        if (this.#mediaRefreshAt.size > 2_000) this.#mediaRefreshAt.delete(this.#mediaRefreshAt.keys().next().value!);
        try {
          const event = await this.#matrix<MatrixEvent>(
            `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`, {as: this.#owner});
          const native = event.content?.["co.polymux.wechat.native"] as
            {serverId?: string; localId?: string; kind?: string; body?: string} | undefined;
          if (event.content?.["co.polymux.wechat.remote"] !== true || !native?.serverId ||
              this.#state.nativeMessageEvents?.[chatId]?.[native.serverId] !== eventId) continue;
          const item = await this.#withNativeIdentity(normalise({chatId, serverId: native.serverId, localId: native.localId,
            messageKind: native.kind, body: native.body, timestamp: event.origin_server_ts}), true);
          const previousOwnership = this.#state.ownMessageEvents?.[chatId]?.[eventId];
          if (["image", "emoticon", "call", "text", "unknown", "audio", "voice", "file", "attachment", "video"].includes(item.messageKind ?? "")) {
            changed = await this.#recoverRichMessage(chatId, item, native.serverId, true) || changed;
            changed ||= previousOwnership !== this.#state.ownMessageEvents?.[chatId]?.[eventId];
            if (item.messageKind === "image") changed = (await this.#upgradeCachedPhoto(chatId, item, eventId, event)) || changed;
          }
        } catch (error) { this.#log(`[wechat] local media refresh delayed: ${message(error)}`); }
      }
      return changed;
    })();
    this.#mediaRefreshTasks.set(roomId, task);
    try { return await task; }
    finally { this.#mediaRefreshTasks.delete(roomId); }
  }

  /** Revisit cached thumbnails when Desktop later downloads the original.
   * Only exact local originals qualify; a missing original never downgrades
   * an already recovered image or invokes the native sender/debugger. */
  async #upgradeCachedPhoto(chatId: string, item: RelayMessage, eventId: string, event: MatrixEvent): Promise<boolean | null> {
    if (!item.localId || !event.sender) return null;
    const stamp = originalTimestamp(item);
    if (!stamp) return null;
    for (const store of this.#nativeStores()) {
      const original = await readLocalWeChatPhoto(store, chatId, String(item.localId), stamp).catch((): null => null);
      if (!original || original.thumbnail) continue;
      const digest = createHash("sha256").update(original.bytes).digest("hex");
      if (this.#originalPhotoDigests.get(eventId) === digest) return false;
      const uri = await this.#uploadSticker(original.bytes, original.mimeType);
      const content: Record<string, unknown> = {...event.content, msgtype: "m.image", url: uri,
        body: `wechat-${item.localId}.${original.mimeType === "image/jpeg" ? "jpg" : original.mimeType.slice(6)}`,
        info: {mimetype: original.mimeType, size: original.bytes.length}};
      delete content["co.polymux.view_in"];
      await this.#matrix(
        `/_matrix/client/v3/rooms/${encodeURIComponent(event.room_id ?? this.#state.rooms[chatId]!.roomId)}/send/m.room.message/${encodeURIComponent(`wechat-original-${eventId}-${digest}`)}?ts=${stamp}`,
        {method: "PUT", as: event.sender, body: {...content, body: `* ${content.body}`,
          "m.new_content": content, "m.relates_to": {rel_type: "m.replace", event_id: eventId}}},
      );
      this.#originalPhotoDigests.set(eventId, digest);
      if (this.#originalPhotoDigests.size > 1_000) this.#originalPhotoDigests.delete(this.#originalPhotoDigests.keys().next().value!);
      return true;
    }
    return null;
  }

  async #loadOlderHistory(chatId: string, limit: number): Promise<boolean> {
    if (this.#stopped) throw new Error("WeChat history is disconnected");
    const generation = this.#historyGeneration;
    const cursor = this.#state.historyCursors?.[chatId];
    const until = typeof cursor === "number" ? cursor : undefined;
    const nativeRead = await this.#nativeHistoryRead(chatId);
    // A session can remain in Desktop's directory while its message shard is
    // absent or not yet readable. Keep the cached thread usable in native-only
    // mode and retain its cursor so a later key/shard refresh can retry it.
    if (!nativeRead && this.#options.externalProvider === false) return false;
    const page = await weChatHistoryPage(
      nativeRead ?? (async (query) => {
        const params = new URLSearchParams({limit: String(query.limit)});
        if (query.until !== undefined) params.set("until", String(query.until));
        const result = await this.#relay<RelayMessage[] | {rows?: RelayMessage[]}>(
          `/chat/${encodeURIComponent(chatId)}/history?${params}`,
        );
        const rows = Array.isArray(result) ? result : result?.rows;
        if (!Array.isArray(rows)) throw new Error("WeChat history did not return a message list");
        return rows;
      }),
      (row) => Math.floor((originalTimestamp(normalise(row)) ?? 0) / 1000),
      {until, limit},
    );
    const room = this.#state.rooms[chatId];
    for (const row of page.rows) {
      if (this.#stopped) throw new Error("WeChat history was disconnected during import");
      await this.#ingest({...row, chatId,
        chatName: row.chatName ?? row.chat_name ?? room?.name,
        isGroup: row.isGroup ?? row.is_group ?? room?.isGroup}, true);
    }
    // Commit only after every row succeeds. Repeating an interrupted page is
    // safe; advancing past a failed image or message import would lose it.
    if (generation !== this.#historyGeneration) return true;
    (this.#state.historyCursors ??= {})[chatId] = page.nextUntil;
    this.#save();
    return page.nextUntil !== null;
  }

  #invalidateHistoryCoverage(): void {
    // An archive was complete only as of its last connection. A reconnect
    // can reveal more than the recent snapshot or stream replay carries.
    this.#historyGeneration += 1;
    this.#state.historyCursors = {};
    this.#save();
  }

  /**
   * Every conversation the account has, not only the ones with something
   * unread. A chat with nothing waiting is still a chat the user expects to
   * find here, and importing only unread ones left the list a fraction of what
   * WeChat itself shows.
   *
   * Native session stores win when keyed: the same directory the relay serves,
   * read straight from `session/session.db` with no daemon. Relay stays the
   * fallback for a machine without keys.
   */
  async #chatList(): Promise<RelayChat[]> {
    const native = await this.#nativeChatList().catch((): null => null);
    const directory = native ?? await weChatConversationList<RelayChat>(async (limit) => {
      const source = await this.#relay<RelayChat[] | { rows?: RelayChat[] }>(
        `/chats?limit=${limit}`,
      );
      const rows = Array.isArray(source) ? source : source?.rows;
      if (!Array.isArray(rows)) throw new Error("WeChat did not return a conversation list");
      return rows;
    });
    // Filter only after fetching the complete directory: folders contribute
    // to the relay's page length, but are not independent chat destinations.
    const chats = directory.filter(chat => !isWeChatSessionContainer(String(chat.username ?? chat.chatId ?? "")));
    for (const chat of chats) {
      const chatId = String(chat.username ?? chat.chatId ?? "");
      if (!named(chat.display_name) && /@chatroom$/i.test(chatId))
        chat.display_name = await this.#unnamedGroupTitle(chatId) ?? "WeChat group";
    }
    if (!this.#options.writer?.readStates) return chats;
    // A failed native read must leave the last known badges intact. Falling
    // back to the relay here would silently clear manually marked chats.
    const states = new Map((await this.#options.writer.readStates())
      .map((state) => [state.chatId, state]));
    return chats.map((chat) => {
      const state = states.get(String(chat.username ?? chat.chatId ?? ""));
      return state ? {...chat, unread_count: Math.max(state.unreadCount, state.markedUnread ? 1 : 0)} : chat;
    });
  }

  async #unnamedGroupTitle(chatId: string): Promise<string | null> {
    const cached = this.#memberTitles.get(chatId);
    if (cached && cached.refreshAt > Date.now()) return cached.name;
    let name: string | null = null;
    for (const store of this.#nativeStores()) {
      try {
        const members = await store.members(chatId);
        name = weChatMemberTitle(
          members.map((member) => ({wxid: member.wxid, display_name: member.displayName ?? member.wxid})),
          store.wxid,
        );
        if (name) break;
      } catch { /* Not a native group or no contact key; try the CLI. */ }
    }
    for (const cli of this.#cliPaths()) {
      try {
        const result = await run(cli, ["members", chatId, "--json"], {timeout: SELF_SENT_TIMEOUT_MS});
        name = weChatMemberTitle(JSON.parse(result.stdout), await this.#accountWxid());
        if (name) break;
      } catch { /* An unavailable directory must not hold up the other chats. */ }
    }
    // A transient read failure must not erase the last resolved member title.
    name ??= cached?.name ?? null;
    this.#memberTitles.set(chatId, {name, refreshAt: Date.now() + (name ? 5 * 60_000 : 30_000)});
    return name;
  }

  async #backfill(): Promise<void> {
    if (this.#backfillTask) return await this.#backfillTask;
    const task = this.#backfillOnce();
    this.#backfillTask = task;
    try {
      await task;
    } finally {
      if (this.#backfillTask === task) this.#backfillTask = null;
    }
  }

  async #backfillOnce(): Promise<void> {
    const readRevision = this.#nativeWriteRevision;
    const chats = [...await this.#chatList()].sort((left, right) => {
      const isFileTransfer = (chat: RelayChat): boolean =>
        String(chat.username ?? chat.chatId ?? "").toLowerCase() === "filehelper";
      return Number(isFileTransfer(right)) - Number(isFileTransfer(left));
    });
    // History is replay, whatever its shape: an import that reruns — every
    // start does — must not post a second copy of what the last one carried.
    this.#importing = true;
    try {
      // Publish the complete conversation directory before decoding history.
      // One uncached photo must not hide every chat behind it during startup.
      for (const chat of chats) {
        const chatId = String(chat.username ?? chat.chatId ?? "");
        if (this.#stopped) return;
        if (chatId) await this.#portal(chatId, {
          chatId, chatName: chat.display_name,
          isGroup: chat.isGroup ?? chat.is_group ?? /@chatroom$/i.test(chatId),
        }, nativeChatSummary(chat));
      }
      for (const chat of chats) {
        if (this.#stopped) return;
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
        // Native stores serve the same page when keyed; relay stays fallback.
        const limit = Math.min(50, Math.max(count, BACKFILL_MIN));
        const nativeRead = await this.#nativeHistoryRead(chatId).catch((): null => null);
        const history = nativeRead
          ? await weChatHistoryPage(
              nativeRead,
              (row) => Math.floor((originalTimestamp(normalise(row)) ?? 0) / 1000),
              {limit},
            ).then((page) => page.rows).catch((): RelayMessage[] => [])
          : await this.#relay<
              RelayMessage[] | { rows?: RelayMessage[] }
            >(
              `/chat/${encodeURIComponent(chatId)}/history?limit=${limit}`,
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
        await this.#applyReadState(chatId, count, readRevision).catch((error: unknown) =>
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
    // The read sweep is passive. When WeChat is quit, signed out, or its relay
    // is intentionally detached for native work, it must neither wake the
    // stack nor emit a failure every thirty seconds.
    if (this.#activeNativeWrite || this.#writerPaused) return;
    const readRevision = this.#nativeWriteRevision;
    const native = this.#nativeReadable();
    if (!native && !(await this.#relayHealthy())) return;
    for (const chat of await this.#chatList()) {
      const chatId = String(chat.username ?? chat.chatId ?? "");
      if (!chatId) continue;
      await this.#portal(chatId, {chatId, chatName: chat.display_name,
        isGroup: chat.isGroup ?? chat.is_group ?? /@chatroom$/i.test(chatId)}, nativeChatSummary(chat));
      await this.#applyReadState(
        chatId,
        Math.max(0, Number(chat.unread_count ?? chat.unreadCount ?? 0)),
        readRevision,
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
  async #applyReadState(chatId: string, unread: number, readRevision: number): Promise<void> {
    if (!Number.isSafeInteger(unread) || unread < 0) return;
    const current = (): boolean => readRevision === this.#nativeWriteRevision && !this.#activeNativeWrite;
    // A snapshot taken before a native write may arrive after its verified
    // acknowledgement. Never let that older count resurrect a cleared badge.
    if (!current()) return;
    await this.#publishUnreadCount(chatId, (previous) => current() ? unread : previous);
    if (!current()) return;
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

  async #publishUnreadCount(chatId: string, update: (current: number) => number): Promise<void> {
    const previous = this.#readStateTasks.get(chatId) ?? Promise.resolve();
    const task = previous.catch((): undefined => undefined).then(async (): Promise<void> => {
      const roomId = this.#state.rooms[chatId]?.roomId;
      if (!roomId) return;
      const current = this.#state.unreadCounts?.[chatId];
      const count = update(current ?? 0);
      if (count === current) return;
      await this.#matrix(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/co.polymux.wechat.unread/`,
        {method: "PUT", as: this.botId, body: {count}},
      );
      (this.#state.unreadCounts ??= {})[chatId] = count;
      this.#save();
    });
    this.#readStateTasks.set(chatId, task);
    try {await task;}
    finally {if (this.#readStateTasks.get(chatId) === task) this.#readStateTasks.delete(chatId);}
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
    if (this.#options.externalProvider === false) return;
    let attempt = 0;
    while (!this.#stopped && this.#relayRecoverySafe && generation === this.#consumeGeneration) {
      let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
      let reconcilingDesktopMessages = false;
      try {
        const url = new URL("/messages/stream", this.#options.relayUrl);
        // Without `since` the relay replays its entire history on connect.
        url.searchParams.set("since", String(this.#state.lastRemoteTimestamp));
        const streaming = new AbortController();
        this.#streaming = streaming;
        const desktopMessageSyncMs = Number(
          this.#options.desktopMessageSyncMs ?? 0,
        );
        if (Number.isFinite(desktopMessageSyncMs) && desktopMessageSyncMs > 0) {
          reconcileTimer = setTimeout(() => {
            reconcilingDesktopMessages = true;
            streaming.abort();
          }, desktopMessageSyncMs);
          reconcileTimer.unref?.();
        }
        const response = await this.#fetch(url, {
          headers: this.#relayHeaders(),
          signal: streaming.signal,
        });
        if (!response.ok || !response.body)
          throw new Error(`stream returned ${response.status}`);
        attempt = 0;
        this.#streamConnectAt = Date.now();
        // A photo may have become readable while the relay was disconnected.
        // Probe immediately rather than making it wait for its old CDN
        // backoff. The retry path starts heap-only, so this does not block the
        // stream on another long CDN-capture window.
        // The embedded app deliberately reconnects this stream every second to
        // recover messages authored in WeChat Desktop. Old image retries have
        // their own one-minute cadence; starting them on every sync pulse made
        // heap scans run continuously and starved outbound sends.
        if (!(Number.isFinite(desktopMessageSyncMs) && desktopMessageSyncMs > 0))
          void this.#retryPendingImages().catch((error: unknown) =>
            this.#log(`[wechat] image reconnect retry failed: ${message(error)}`),
          );
        for await (const payload of serverSentEvents(response.body)) {
          // A live Qt signal is one message, but reconnect history is one SSE
          // event containing an array. Treating that array as a RelayMessage
          // left it without a chat id, silently discarding every desktop-authored
          // message the reconnect was specifically meant to recover.
          const parsed = parseWeChatJson<RelayMessage | RelayMessage[]>(payload);
          const messages = (Array.isArray(parsed) ? parsed : [parsed]).sort(
            (a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0),
          );
          for (const item of messages)
            await this.#ingest(item).catch((error: unknown) =>
              this.#log(`[wechat] inbound event failed: ${message(error)}`),
            );
        }
        throw new Error("stream ended");
      } catch (error) {
        if (this.#stopped || !this.#relayRecoverySafe || generation !== this.#consumeGeneration) return;
        if (
          this.#writerPaused ||
          Date.now() < this.#writerPriorityUntil
        ) {
          const priorityRemaining = Math.max(
            1,
            this.#writerPriorityUntil - Date.now(),
          );
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(250, priorityRemaining)),
          );
          continue;
        }
        // The long-lived hook does not report every message authored in the
        // desktop client. Reopening with the persisted `since` cursor asks the
        // relay for its incremental history, which includes those messages.
        // This is an expected local sync pulse, not a transport failure worth
        // logging or backing off.
        if (reconcilingDesktopMessages) {
          attempt = 0;
          continue;
        }
        this.#invalidateHistoryCoverage();
        const health = await this.#relayStatus();
        if (health && health !== "connected") {
          this.#log(
            `[wechat] stream stopped: relay is ${health}`,
          );
          // A user-quit WeChat app stays quit while the bridge is idle. The
          // next composer/agent readiness request owns the hidden relaunch;
          // this passive receive loop only reports the stopped stream.
          return;
        }
        const ownedRelayStopped =
          this.#relayProcess !== null && !childProcessIsRunning(this.#relayProcess);
        // A crash or a native-writer interruption can remove the loopback
        // relay entirely. Network backoff cannot revive a process, so restart
        // the exact supervised child and then reopen the stream. An external
        // relay gets one normal retry before Polymux takes over supervision.
        if (health === null && (ownedRelayStopped || (!this.#relayProcess && attempt > 0))) {
          const sessionState = await this.#desktopSessionState();
          if (sessionState && sessionState !== "signed_in") {
            this.#desktopSessionPending =
              sessionState === "remembered_login" ||
              sessionState === "launching" ||
              sessionState === "unavailable";
            this.#log(
              `[wechat] stream stopped: desktop session is ${sessionState}`,
            );
            return;
          }
          if (sessionState === "signed_in") this.#desktopSessionPending = false;
          this.#log("[wechat] local relay stopped; restarting it.");
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
      } finally {
        if (reconcileTimer) clearTimeout(reconcileTimer);
      }
    }
  }

  async #ingest(raw: RelayMessage, historical = false): Promise<void> {
    const item = normalise(raw);
    if (isWeChatSessionContainer(String(item.chatId ?? ""))) return;
    if (!item.messageId) return await this.#ingestOnce(raw, historical);
    const key = JSON.stringify([item.chatId, String(item.localId ?? item.messageId), originalTimestamp(item)]);
    const active = this.#ingestTasks.get(key);
    if (active) return await active;
    const task = this.#ingestOnce(raw, historical);
    this.#ingestTasks.set(key, task);
    try { await task; }
    finally { this.#ingestTasks.delete(key); }
  }

  async #ingestOnce(raw: RelayMessage, historical: boolean): Promise<void> {
    while (this.#writerPaused && !this.#stopped)
      await new Promise((resolve) => setTimeout(resolve, 25));
    if (this.#stopped) return;
    const item = await this.#withNativeIdentity(normalise(raw));
    const chatId = String(item.chatId ?? "");
    if (!chatId) return;
    if (!item.mentionedIds && /@chatroom$/.test(chatId) && item.messageKind === "text" &&
        item.body?.includes("@") && item.serverId && item.localId != null && originalTimestamp(item) &&
        this.#options.writer?.readMentions) {
      const identity = {chatId, serverId: String(item.serverId), localId: String(item.localId),
        timestamp: Math.floor(originalTimestamp(item)! / 1000)};
      const key = JSON.stringify(identity);
      const ids = this.#nativeMentions.get(key) ?? await this.#options.writer.readMentions(identity)
        .catch((error: unknown): null => {this.#log(`[wechat] native mention metadata unavailable: ${message(error)}`); return null;});
      if (ids != null) {
        item.mentionedIds = ids;
        this.#nativeMentions.set(key, ids);
        if (this.#nativeMentions.size > 2048) this.#nativeMentions.delete(this.#nativeMentions.keys().next().value!);
      }
    }
    // An accepted message is identified by the relay's id, remembered for a
    // month. An unaccepted one has none — and its fields can carry no
    // substitute, because two distinct ones may share every field this bridge
    // sees: whole-second timestamps, and nothing arrives until WeChat accepts
    // the second. So its id is per arrival, and its repeats are recognised by
    // the fields, where a replay actually happens: at a connect, or in an
    // import. A live stream gets every message it is handed.
    const acceptedMessageId = item.serverId || item.messageId
      ? String(item.serverId || item.messageId)
      : null;
    const serverMessageId = item.serverId ? String(item.serverId) : undefined;
    const localKey = item.localId != null && originalTimestamp(item) != null
      ? JSON.stringify([String(item.localId), originalTimestamp(item)]) : undefined;
    const localEvent = item.messageKind !== "recalled" && serverMessageId && localKey
      ? await this.#reconcileLocalRow(chatId, item, serverMessageId, localKey)
      : localKey ? this.#state.nativeLocalMessageEvents?.[chatId]?.[localKey] : undefined;
    if (item.messageKind !== "recalled" && localEvent) {
      if (serverMessageId) {
        ((this.#state.nativeMessageEvents ??= {})[chatId] ??= {})[serverMessageId] = localEvent;
        (this.#state.remoteMessageIds ??= {})[localEvent] = serverMessageId;
        await this.#recoverRichMessage(chatId, item, serverMessageId).catch((error: unknown) =>
          this.#log(`[wechat] rich message recovery deferred: ${message(error)}`));
      }
      this.#save();
      return;
    }
    if (item.messageKind !== "recalled" && serverMessageId && localKey &&
        this.#state.seenRemote[`accepted:${JSON.stringify([chatId, String(item.localId), originalTimestamp(item)])}`])
      return; // The original was carried; an unresolved alias must not duplicate it.
    const fields = acceptedMessageId ? null : fieldIdentity(item);
    const remoteId =
      fields === null
        // WeChat's local row ids can be reused after a database rotation and
        // are not global across chats. The sent timestamp makes a new row
        // distinct while an exact reconnect replay keeps the same identity.
        ? `accepted:${JSON.stringify([
            chatId,
            acceptedMessageId,
            originalTimestamp(item),
          ])}`
        : `${fields}-${randomBytes(8).toString("base64url")}`;
    const recalled = item.recall?.replacedMsgId;
    if (item.messageKind === "recalled" && recalled != null) {
      const nativeId = String(recalled);
      ((this.#state.recalledMessageIds ??= {})[chatId] ??= {})[nativeId] = true;
      const target = this.#state.nativeMessageEvents?.[chatId]?.[nativeId];
      const roomId = this.#state.rooms[chatId]?.roomId;
      if (target && roomId)
        await this.#matrix(
          `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(target)}/${encodeURIComponent(`wechat-remote-recall-${nativeId}`)}`,
          {method: "PUT", as: this.botId, body: {}},
        );
      this.#save();
    }
    if (item.messageKind !== "recalled" && serverMessageId &&
      this.#state.nativeMessageEvents?.[chatId]?.[serverMessageId]) {
      await this.#recoverRichMessage(chatId, item, serverMessageId).catch((error: unknown) =>
        this.#log(`[wechat] rich message recovery deferred: ${message(error)}`));
      this.#carried(remoteId, fields);
      return;
    }
    if (this.#state.seenRemote[remoteId]) return;
    if (item.messageKind !== "recalled" && acceptedMessageId &&
      this.#state.recalledMessageIds?.[chatId]?.[acceptedMessageId]) {
      this.#carried(remoteId, fields);
      return;
    }
    if (fields !== null && this.#state.seenFields?.[fields] !== undefined) {
      const inReplay =
        historical || this.#importing || Date.now() - this.#streamConnectAt < REPLAY_GUARD_MS;
      if (inReplay) return;
    }

    // Whether the account sent this, from anywhere — this app, the phone, or
    // WeChat on the desk. The relay only marks its own sends and system
    // notices, so a message typed in WeChat itself came through as the
    // contact's: the conversation showed one side of itself twice and none of
    // the user's own words.
    const notice =
      item.messageKind === "system" || item.messageKind === "recalled";
    const textBody = bodyOf(item);
    const mine = !notice && await this.#sentByAccount(chatId, item);

    // The native store acknowledges sends independently from this stream.
    // Let an in-flight send establish its exact server id before reconciling
    // the echo. Matching only the media kind swallowed unrelated phone sends.
    const pendingWrite = this.#activeNativeWrite;
    const couldBeEcho = pendingWrite?.chatId === chatId && (
      pendingWrite.kind === "text" ? textBody === visibleWeChatText(pendingWrite.body) :
      pendingWrite.kind === "media" && (
        pendingWrite.mediaType === item.messageKind ||
        (pendingWrite.mediaType === "sticker" && item.messageKind === "emoticon") ||
        (pendingWrite.mediaType === "audio" && item.messageKind === "voice")
      )
    );
    if (mine && couldBeEcho) {
      const queuedRoomId = this.#state.rooms[chatId]?.roomId;
      if (queuedRoomId)
        await this.#outboundChatTasks.get(queuedRoomId)?.catch((): undefined => undefined);
      if (serverMessageId && this.#state.nativeMessageEvents?.[chatId]?.[serverMessageId]) {
        this.#carried(remoteId, fields);
        return;
      }
    }

    // Our own send, coming back around. Matched on content rather than id
    // because the relay assigns its own once WeChat accepts it.
    if (mine) {
      const candidates = this.#state.outboundEchoes.flatMap((echo, index) =>
        echo.chatId === chatId && echo.body === textBody &&
        (echo.recovered
          ? (originalTimestamp(item) ?? 0) <= echo.timestamp + ECHO_TTL_MS
          : Date.now() - echo.timestamp < ECHO_TTL_MS) &&
        (!echo.previousIds || (serverMessageId && !echo.previousIds.includes(serverMessageId) &&
          (originalTimestamp(item) ?? 0) >= echo.timestamp - 1_000)) ? [index] : []);
      // Two indistinguishable submissions cannot be acknowledged by a body
      // match. Keep their uncertainty visible instead of choosing one.
      const index = candidates.length === 1 ? candidates[0] : -1;
      if (index >= 0) {
        const [echo] = this.#state.outboundEchoes.splice(index, 1);
        if (serverMessageId)
          this.#rememberOutboundMessageId(echo.eventId,
            {deliveredVerified: true, messageId: serverMessageId}, chatId);
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
    const quoteId = item.refer?.svrId == null ? undefined : String(item.refer.svrId);
    const quotedEvent = quoteId ? this.#state.nativeMessageEvents?.[chatId]?.[quoteId] : undefined;
    if (quotedEvent) content["m.relates_to"] = {"m.in_reply_to": {event_id: quotedEvent}};
    else if (item.refer?.content)
      content.body = `↳ ${item.refer.displayName || "Earlier message"}: ${item.refer.content}\n${String(content.body ?? "")}`;
    if (item.mentionedIds?.length) content["m.mentions"] = await this.#mentionContent(item.mentionedIds);
    const posted = await this.#matrix<{ event_id?: string }>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(`wechat-${randomUUID()}`)}${sentAt ? `?ts=${sentAt}` : ""}`,
      {
        method: "PUT",
        as: sender,
        body: {
          ...content,
          "co.polymux.wechat.remote": true,
          "co.polymux.wechat.native": {
            ...(serverMessageId ? {serverId: serverMessageId} : {}),
            ...(item.localId ? {localId: String(item.localId)} : {}),
            kind: item.messageKind ?? "text",
            sender: item.senderId ?? "",
            body: item.body ?? "",
          },
          ...(historical ? {"co.polymux.backfill": true} : {}),
          ...(notice ? { "co.polymux.notice": true } : {}),
        },
      },
    );
    if (posted?.event_id) {
      ((this.#state.ownMessageEvents ??= {})[chatId] ??= {})[posted.event_id] = mine;
      this.#save();
    }
    if (retryImage && posted?.event_id)
      this.#rememberPendingImage({
        chatId,
        messageId: retryImage,
        roomId,
        eventId: posted.event_id,
        ...(quotedEvent ? {replyTo: quotedEvent} : {}),
        sender,
        sentAt: sentAt || Date.now(),
      });
    if (posted?.event_id && !historical && !mine && !notice) {
      this.#rememberEvent(chatId, posted.event_id);
      if (!this.#importing)
        await this.#publishUnreadCount(chatId, (current) => current + 1);
    }
    if (posted?.event_id && serverMessageId) {
      ((this.#state.nativeMessageEvents ??= {})[chatId] ??= {})[serverMessageId] = posted.event_id;
      this.#state.remoteMessageIds = {
        ...(this.#state.remoteMessageIds ?? {}),
        [posted.event_id]: serverMessageId,
      };
      if ((content["co.polymux.forwarded"] || content["co.polymux.sticker"]) && (!quoteId || quotedEvent))
        this.#resolvedRichEvents.add(`${posted.event_id}:${quoteId ?? ""}`);
    }
    if (posted?.event_id && localKey && item.messageKind !== "recalled")
      ((this.#state.nativeLocalMessageEvents ??= {})[chatId] ??= {})[localKey] = posted.event_id;
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

  /** An early stream can precede the native identity lookup. Recover its
   * original event from local row + time, including after a reconnect. */
  async #reconcileLocalRow(chatId: string, item: RelayMessage, serverId: string, localKey: string): Promise<string | undefined> {
    const known = this.#state.nativeLocalMessageEvents?.[chatId]?.[localKey];
    const key = JSON.stringify([chatId, localKey]);
    const sentAt = originalTimestamp(item)!;
    const earlier = `accepted:${JSON.stringify([chatId, String(item.localId), sentAt])}`;
    const roomId = this.#state.rooms[chatId]?.roomId;
    if (this.#reconciledLocalRows.has(key) || !this.#state.seenRemote[earlier] || !roomId) return known;
    let from: string | undefined;
    let complete = false;
    const candidates: MatrixEvent[] = [];
    for (let page = 0; page < 50; page++) {
      const params = new URLSearchParams({dir: "b", limit: "100"});
      if (from) params.set("from", from);
      const result = await this.#matrix<{chunk?: MatrixEvent[]; end?: string}>(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?${params}`, {as: this.#owner});
      if (!Array.isArray(result.chunk)) throw new Error("Native row reconciliation returned no timeline");
      for (const event of result.chunk) {
        const native = event.content?.["co.polymux.wechat.native"] as {localId?: string; serverId?: string} | undefined;
        const relation = event.content?.["m.relates_to"] as {rel_type?: string} | undefined;
        if (event.type === "m.room.message" && event.content?.["co.polymux.wechat.remote"] === true &&
            event.origin_server_ts === sentAt && native?.localId === String(item.localId) &&
            relation?.rel_type !== "m.replace" && event.event_id) candidates.push(event);
      }
      // Matrix pages follow import order, so an older native timestamp is not
      // the end of this search: a backfill may have arrived after the target.
      if (!result.end || result.end === from) {complete = true; break;}
      from = result.end;
    }
    if (!complete) return known;
    const unresolved = candidates.filter(event => !(event.content?.["co.polymux.wechat.native"] as {serverId?: string}).serverId);
    if (unresolved.length !== 1) return known;
    const original = unresolved[0];
    // Reject local-id reuse or ambiguous authors; matching text is never used.
    if (candidates.some(event => event.sender !== original.sender ||
        ((event.content?.["co.polymux.wechat.native"] as {serverId?: string}).serverId ?? serverId) !== serverId)) return known;
    for (const duplicate of candidates.filter(event => event.event_id !== original.event_id))
      await this.#matrix(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(duplicate.event_id!)}/${encodeURIComponent(`wechat-duplicate-${duplicate.event_id}`)}`,
        // Bot-authored local cleanup never enters the account's recall route.
        {method: "PUT", as: this.botId, body: {reason: "Duplicate import of the same native message"}},
      );
    ((this.#state.nativeLocalMessageEvents ??= {})[chatId] ??= {})[localKey] = original.event_id!;
    this.#reconciledLocalRows.add(key);
    this.#save();
    return original.event_id!;
  }

  /** A later native history pass can supply missing media, call metadata,
   * replies, or authorship. Upgrade the existing event without duplicating it. */
  async #recoverRichMessage(chatId: string, item: RelayMessage, serverId: string, localOnly = false): Promise<boolean> {
    const mappedEvent = this.#state.nativeMessageEvents?.[chatId]?.[serverId];
    const authored = await this.#nativeAuthorship(chatId, item);
    if (mappedEvent && authored !== null && this.#state.ownMessageEvents?.[chatId]?.[mappedEvent] !== authored) {
      ((this.#state.ownMessageEvents ??= {})[chatId] ??= {})[mappedEvent] = authored;
      this.#save();
    }
    const rich = ["forward", "appmsg", "emoticon", "call"].includes(item.messageKind ?? "");
    const media = ["image", "audio", "voice", "file", "attachment", "video"].includes(item.messageKind ?? "");
    const quoteId = item.refer?.svrId == null ? undefined : String(item.refer.svrId);
    if (!rich && !media && !quoteId && !item.mentionedIds?.length) return false;
    const eventId = this.#state.nativeMessageEvents?.[chatId]?.[serverId];
    const roomId = this.#state.rooms[chatId]?.roomId;
    const key = `${eventId}:${quoteId ?? ""}:${JSON.stringify(item.mentionedIds ?? [])}`;
    if (!eventId || !roomId || this.#resolvedRichEvents.has(key)) return false;
    const event = await this.#matrix<MatrixEvent>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
      {as: this.#owner},
    );
    if (!event?.sender || event.content?.["co.polymux.wechat.remote"] !== true) return false;
    const quotedEvent = quoteId ? this.#state.nativeMessageEvents?.[chatId]?.[quoteId] : undefined;
    const needsQuote = quotedEvent && replyEvent(event) !== quotedEvent;
    const mentions = item.mentionedIds?.length ? await this.#mentionContent(item.mentionedIds) : undefined;
    const needsMentions = mentions && JSON.stringify(mentions) !== JSON.stringify(event.content["m.mentions"]);
    let content = (rich && !event.content["co.polymux.sticker"] || media && !event.content.url)
      ? (await this.#content(chatId, item, localOnly)).content : {};
    if (content["co.polymux.forwarded"] &&
        JSON.stringify(content["co.polymux.forwarded"]) === JSON.stringify(event.content["co.polymux.forwarded"])) content = {};
    const needsCall = item.messageKind === "call" && content.body !== event.content.body;
    if (!content["co.polymux.forwarded"] && !content["co.polymux.sticker"] && !content.url && !needsQuote && !needsMentions && !needsCall) {
      if ((!rich || event.content["co.polymux.forwarded"] || event.content["co.polymux.sticker"]) && (!media || event.content.url) &&
          (!quoteId || quotedEvent)) this.#resolvedRichEvents.add(key);
      return false;
    }
    const updated: Record<string, unknown> = {...event.content, ...content};
    if (mentions) updated["m.mentions"] = mentions;
    if (content.url) {
      delete updated["co.polymux.view_in"];
      delete updated["co.polymux.link_preview"];
    }
    if (quotedEvent) updated["m.relates_to"] = {"m.in_reply_to": {event_id: quotedEvent}};
    const revision = createHash("sha256").update(JSON.stringify({
      forwarded: updated["co.polymux.forwarded"], quote: quotedEvent,
      mentions: updated["m.mentions"],
      media: content.url ? [content.msgtype, content.body, content.info] : null,
      preview: updated["co.polymux.link_preview"] ?? null,
      call: needsCall ? content.body : null,
    })).digest("hex").slice(0, 16);
    await this.#matrix(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(`wechat-rich-${chatId}-${serverId}-${revision}`)}?ts=${originalTimestamp(item) ?? Date.now()}`,
      {method: "PUT", as: event.sender, body: {
        ...updated, body: `* ${String(updated.body ?? "")}`,
        "m.new_content": updated,
        "m.relates_to": {rel_type: "m.replace", event_id: eventId},
      }},
    );
    const pendingImage = item.localId == null ? undefined :
      this.#state.pendingImages?.[`${chatId}:${String(item.localId)}`];
    if (pendingImage && quotedEvent) {
      pendingImage.replyTo = quotedEvent;
      this.#save();
    }
    if (pendingImage && content.url) {
      delete this.#state.pendingImages![`${chatId}:${String(item.localId)}`];
      this.#save();
    }
    // The transaction id above also makes reconnect recovery idempotent.
    if (!quoteId || quotedEvent) this.#resolvedRichEvents.add(key);
    return true;
  }

  async #mentionContent(ids: string[]): Promise<{user_ids: string[]}> {
    const self = await this.#accountWxid();
    return {user_ids: [...new Set(ids)].filter(id => /^[A-Za-z0-9_-]+$/.test(id))
      .map(id => id === self ? this.#owner : this.#puppet(id))};
  }

  /** Convert native content into Hub messages, retaining a readable fallback
   * when an attachment is not available from the current local sources. */
  async #content(
    chatId: string,
    item: RelayMessage,
    localOnly = false,
  ): Promise<{ content: Record<string, unknown>; retryImage?: string }> {
    if (item.messageKind === "appmsg" || item.messageKind === "forward") {
      const forwarded = weChatForwardedBundle(String(item.body ?? ""));
      if (forwarded) return {content: {
        msgtype: "m.text",
        body: forwardedBundleText(forwarded),
        "co.polymux.forwarded": forwarded,
        "co.polymux.view_in": {app: "WeChat", url: "weixin://"},
      }};
    }
    const nativeKind = relayMediaType(item.messageKind);
    if (nativeKind === "audio" || nativeKind === "file" || nativeKind === "video") {
      const media = await this.#nativeMedia(chatId, item, nativeKind, localOnly).catch((error: unknown): null => {
        this.#log(`[wechat] native ${nativeKind} not retrievable: ${message(error)}`);
        return null;
      });
      if (media) return {content: {
        msgtype: nativeKind === "audio" ? "m.audio" : nativeKind === "video" ? "m.video" : "m.file",
        body: media.name, filename: media.name, url: media.uri,
        info: {mimetype: media.mimeType, size: media.size,
          ...(media.durationMs != null ? {duration: media.durationMs} : {})},
      }};
      if (localOnly) return {content: this.#placeholder(item)};
    }
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
      const media = await this.#sticker(item, localOnly).catch((error: unknown): null => {
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
    if (item.messageKind === "image" && item.localId) {
      const messageId = String(item.localId);
      const media = await this.#imageOrThumbnail(chatId, messageId, "auto", undefined, originalTimestamp(item) ?? undefined, localOnly).catch(
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
      item.serverId
    ) {
      const messageId = String(item.serverId);
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
   * Native sender wxids are stable across shards. A numeric real_sender_id
   * is comparable only to the selected account's Name2Id in this chat's
   * shard. Generic relay senderId values can name the conversation itself,
   * so they cannot override an explicit fromSelf flag.
   */
  async #sentByAccount(
    chatId: string,
    item: RelayMessage,
  ): Promise<boolean> {
    return (await this.#nativeAuthorship(chatId, item)) ?? (item.fromSelf === true);
  }

  async #nativeAuthorship(
    chatId: string,
    item: Pick<RelayMessage, "sender_wxid" | "real_sender_id">,
  ): Promise<boolean | null> {
    // File Transfer has no remote participant; this does not establish a
    // reusable participant number for any other conversation.
    if (chatId === "filehelper") return true;
    if (item.sender_wxid) {
      const wxid = await this.#accountWxid();
      if (wxid) return item.sender_wxid === wxid;
    }
    if (item.real_sender_id != null) {
      const self = await this.#selfSenderId(chatId);
      if (self) return String(item.real_sender_id) === self;
    }
    return null;
  }

  /** The account's participant number in the target chat's native shard. */
  async #selfSenderId(chatId: string): Promise<string | null> {
    for (const store of this.#nativeMessageStores()) {
      try {
        const shard = await store.shardOf(chatId);
        if (!shard) continue;
        const self = await store.selfSenderId(chatId);
        if (self) return self;
      } catch { /* Missing target-shard identity remains unknown. */ }
    }
    return null;
  }

  /**
   * Prefer a digest-verified local sticker. Both `<emoji>` and appmsg type 8
   * can supply an ordinary download URL; encrypted references are not used.
   */
  async #sticker(item: RelayMessage, localOnly = false): Promise<{
    uri: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
  } | null> {
    const body = item.body ?? "";
    const id = emojiMd5(body);
    if (id) {
      for (const store of this.#nativeStores()) {
        const local = await readLocalWeChatSticker(store, id).catch((): null => null);
        if (local) return {uri: await this.#uploadSticker(local.bytes, local.mimeType),
          mimeType: local.mimeType, size: local.bytes.length,
          width: numberAttribute(body, "width"), height: numberAttribute(body, "height")};
      }
      let reference = this.#state.stickerReferences?.[id];
      if (!localOnly && !reference && this.#options.writer?.stickers) {
        const native = (await this.#options.writer.stickers().catch((): WeChatNativeSticker[] => [])).find((sticker) =>
          sticker.id === id && emojiMd5(sticker.xml) === id);
        if (native) reference = {xml: native.xml, seenAt: Date.now()};
      }
      // Desktop's own sent stickers contain only MD5 and dimensions. Their
      // exact favorite/history reference supplies the already verified media.
      if (reference && !localOnly) {
        const media = await this.#stickerCatalogEntry(id, reference);
        if (media) return {...media,
          width: numberAttribute(body, "width") ?? media.width,
          height: numberAttribute(body, "height") ?? media.height};
      }
    }
    const url = weChatAppSticker(body)?.cdnUrl ?? unescapeXml(/cdnurl\s*=\s*"([^"]+)"/i.exec(body)?.[1] ?? "");
    if (!/^https?:\/\//i.test(url)) return null;
    const response = await this.#fetch(url, {
      signal: AbortSignal.timeout(localOnly ? 1_500 : MEDIA_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`sticker returned ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > MAX_STICKER_BYTES) {await reader.cancel(); return null;}
        chunks.push(chunk.value);
      }
    } finally {reader.releaseLock();}
    const bytes = Buffer.concat(chunks);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_STICKER_BYTES)
      return null;
    // The CDN answers `application/octet-stream` whatever it is holding, so
    // the bytes themselves have to say.
    const mimeType = imageTypeOf(bytes);
    if (!mimeType) return null;
    const md5 = createHash("md5").update(bytes).digest("hex");
    if (id && md5 !== id) return null;
    const reference = emojiElement(body);
    const width = numberAttribute(body, "width");
    const height = numberAttribute(body, "height");
    const uri = await this.#uploadSticker(bytes, mimeType);
    if (reference && emojiMd5(reference) === md5) {
      this.#state.stickerReferences = {
        ...(this.#state.stickerReferences ?? {}),
        [md5]: {
          xml: reference,
          seenAt: Date.now(),
          uri,
          mimeType,
          size: bytes.byteLength,
          width,
          height,
        },
      };
      this.#save();
    }
    return {uri, mimeType, size: bytes.byteLength, width, height};
  }

  async #uploadSticker(bytes: Uint8Array, mimeType: string): Promise<string> {
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
    if (!uri?.startsWith("mxc://")) throw new Error("sticker upload returned no media id");
    return uri;
  }

  async #stickerCatalogEntry(
    id: string,
    reference: NonNullable<BridgeState["stickerReferences"]>[string],
  ): Promise<WeChatStickerCatalogEntry | null> {
    if (
      reference.uri?.startsWith("mxc://") &&
      reference.mimeType &&
      Number.isFinite(reference.size)
    )
      return {
        id,
        uri: reference.uri,
        mimeType: reference.mimeType,
        size: Number(reference.size),
        width: reference.width ?? numberAttribute(reference.xml, "width"),
        height: reference.height ?? numberAttribute(reference.xml, "height"),
      };
    const url = unescapeXml(
      /cdnurl\s*=\s*"([^"]+)"/i.exec(reference.xml)?.[1] ?? "",
    );
    if (!/^https?:\/\//i.test(url)) return null;
    const response = await this.#fetch(url, {
      signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > MAX_STICKER_BYTES ||
      createHash("md5").update(bytes).digest("hex") !== id
    )
      return null;
    const mimeType = imageTypeOf(bytes);
    if (!mimeType) return null;
    const uri = await this.#uploadSticker(bytes, mimeType);
    const hydrated = {
      ...reference,
      uri,
      mimeType,
      size: bytes.byteLength,
      width: numberAttribute(reference.xml, "width"),
      height: numberAttribute(reference.xml, "height"),
    };
    this.#state.stickerReferences = {
      ...(this.#state.stickerReferences ?? {}),
      [id]: hydrated,
    };
    this.#save();
    return {
      id,
      uri,
      mimeType,
      size: bytes.byteLength,
      width: hydrated.width,
      height: hydrated.height,
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
    signal?: AbortSignal,
  ): Promise<UploadedWeChatImage | null> {
    if (this.#writerPaused || signal?.aborted) return null;
    const controller = new AbortController();
    this.#activeImageReads.add(controller);
    signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
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
        { timeout: MEDIA_TIMEOUT_MS, ...(signal ? {signal} : {}) },
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
    if (file === target)
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
    } finally {
      this.#activeImageReads.delete(controller);
    }
  }

  /**
   * Prefer an exact local original, then a local preview. Cached-page refresh
   * stops there; normal ingestion retains the guarded provider fallback and
   * its bounded heap-thumbnail attempt when no local image is available.
   */
  async #imageOrThumbnail(
    chatId: string,
    messageId: string,
    from: "auto" | "heap" = "auto",
    signal?: AbortSignal,
    sentAt?: number,
    localOnly = false,
  ): Promise<UploadedWeChatImage | null> {
    if (sentAt && !signal?.aborted) for (const store of this.#nativeStores()) {
      const local = await readLocalWeChatPhoto(store, chatId, messageId, sentAt).catch((): null => null);
      if (local) return {uri: await this.#uploadSticker(local.bytes, local.mimeType),
        name: `wechat-${messageId}.${local.mimeType === "image/jpeg" ? "jpg" : local.mimeType.slice(6)}`,
        mimeType: local.mimeType, size: local.bytes.length};
    }
    if (localOnly) return null;
    let originalError: unknown;
    try {
      return await this.#image(chatId, messageId, from, "mid", signal);
    } catch (error) {
      originalError = error;
    }
    try {
      return await this.#image(chatId, messageId, "heap", "thumb", signal);
    } catch {
      throw originalError;
    }
  }

  async #nativeMedia(chatId: string, item: RelayMessage, kind: WeChatMediaReadRequest["kind"], localOnly = false): Promise<{
    uri: string; name: string; mimeType: string; size: number; durationMs?: number;
  } | null> {
    if (!this.#options.writer?.readMedia || !item.serverId || !originalTimestamp(item)) return null;
    const media = await this.#options.writer.readMedia({chatId, kind, serverId: String(item.serverId),
      ...(localOnly ? {localOnly: true} : {}),
      ...(item.localId != null ? {localId: String(item.localId)} : {}),
      timestamp: Math.floor(originalTimestamp(item)! / 1000)});
    if (!media) return null;
    let bytes: Buffer;
    if (media.bodyBase64) bytes = Buffer.from(media.bodyBase64, "base64");
    else if (media.localPath) {
      const resolved = await realpath(media.localPath);
      const roots = await Promise.all(this.#mediaRoots().map(root => realpath(root).catch(() => root)));
      if (!roots.some(root => resolved.startsWith(`${root}${path.sep}`)))
        throw new Error("native media path is outside WeChat's allowed roots");
      const info = await stat(resolved);
      if (!info.isFile() || info.size !== media.size || info.size > MAX_RELAY_MEDIA_BYTES)
        throw new Error("native media size changed");
      bytes = await readFile(resolved);
      if (createHash("md5").update(bytes).digest("hex") !== media.md5)
        throw new Error("native media digest changed");
    } else return null;
    if (!bytes.length || bytes.length !== media.size || bytes.length > MAX_RELAY_MEDIA_BYTES)
      throw new Error("native media has an invalid size");
    const registration = await this.#registration_();
    const upload = await this.#fetch(new URL(
      `/_matrix/media/v3/upload?filename=${encodeURIComponent(media.name)}`, this.#options.homeserver.baseUrl), {
      method: "POST", headers: {Authorization: `Bearer ${registration.asToken}`, "Content-Type": media.mimeType},
      body: new Uint8Array(bytes),
    });
    if (!upload.ok) throw new Error(`upload returned ${upload.status}`);
    const {content_uri: uri} = await upload.json() as {content_uri?: string};
    if (!uri?.startsWith("mxc://")) throw new Error("native media upload returned no media id");
    return {uri, name: media.name, mimeType: media.mimeType, size: bytes.length,
      ...(media.durationMs != null ? {durationMs: media.durationMs} : {})};
  }

  /** Fallback for readers that only expose the original SILK_V3 payload. */
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
  async #nativeHeadImages(): Promise<Map<string, Uint8Array>> {
    const store = this.#nativeStores()[0];
    if (!store?.has("head_image/head_image.db")) return new Map();
    try {
      const snapshot = await store.snapshot("head_image/head_image.db");
      await snapshot.refresh();
      return await snapshot.query(db => {
        const images = new Map<string, Uint8Array>();
        const rows = db.prepare("SELECT username, image_buffer FROM head_image WHERE image_buffer IS NOT NULL").all();
        for (const row of rows)
          if (typeof row.username === "string" && row.image_buffer instanceof Uint8Array && row.image_buffer.length <= 5 * 1024 * 1024)
            images.set(row.username, row.image_buffer);
        return images;
      });
    } catch (error) {
      this.#log(`[wechat] native contact pictures unavailable: ${message(error)}`);
      return new Map();
    }
  }

  async #localAvatar(username: string): Promise<string | null> {
    if (!username) return null;
    const known = this.#state.avatarUris?.[username];
    if (known) return known;
    if (!this.#headImages)
      this.#headImages = this.#options.headImages?.() ??
        (this.#options.externalProvider === false ? this.#nativeHeadImages() : loadHeadImages({ log: (line) => this.#log(line) }));
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
    for (const [chatId, room] of Object.entries(this.#state.rooms)) {
      if (isWeChatSessionContainer(chatId)) continue;
      await this.#applyLocalAvatar({ room: room.roomId }, chatId).catch(
        (error: unknown) =>
          this.#log(
            `[wechat] avatar for ${room.roomId} failed: ${message(error)}`,
          ),
      );
    }
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
  async #ensureFileTransferPortal(): Promise<void> {
    await this.#portal("filehelper", {
      chatId: "filehelper",
      chatName: "File Transfer",
      display_name: "File Transfer",
      isGroup: false,
    });
  }

  async #portal(chatId: string, item: RelayMessage, summary?: WeChatChatSummary): Promise<string> {
    const previous = this.#portalTasks.get(chatId);
    const task = (async () => {
      await previous?.catch((): undefined => undefined);
      const roomId = await this.#resolvePortal(chatId, item, summary);
      if (summary && JSON.stringify(this.#state.chatSummaries?.[chatId]) !== JSON.stringify(summary)) {
        await this.#matrix(
          `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/co.polymux.wechat.session/`,
          {method: "PUT", as: this.botId, body: summary},
        );
        (this.#state.chatSummaries ??= {})[chatId] = summary;
        this.#save();
      }
      // Late-discovered chats join the WAL stream from their current tail.
      // Fire-and-forget: a missing table seeds at zero and is picked up once
      // its shard appears; a failure never blocks the portal itself.
      void this.#wal?.addChat(chatId).catch((): undefined => undefined);
      return roomId;
    })();
    this.#portalTasks.set(chatId, task);
    try {
      return await task;
    } finally {
      if (this.#portalTasks.get(chatId) === task)
        this.#portalTasks.delete(chatId);
    }
  }

  async #syncPortalName(roomId: string, name: string): Promise<void> {
    if (!this.#publishedRoomNames.has(roomId)) {
      const current = await this.#matrix<{name?: string}>(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name/`,
      );
      this.#publishedRoomNames.set(roomId, current.name ?? "");
    }
    if (this.#publishedRoomNames.get(roomId) === name) return;
    await this.#matrix(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name/`,
      {method: "PUT", as: this.botId, body: {name}},
    );
    this.#publishedRoomNames.set(roomId, name);
  }

  async #resolvePortal(chatId: string, item: RelayMessage, summary?: WeChatChatSummary): Promise<string> {
    const known = this.#state.rooms[chatId];
    // An established chat may be renamed only by a conversation title. This
    // also keeps our own display name on a Desktop echo out of a DM's title.
    const resolvedName = known
      ? named(item.chatName) ?? named(item.chat_name)
      : conversationName(item);
    const name = String(resolvedName ?? "WeChat").slice(0, 1024);
    if (known) {
      await this.#ensureOwnerRoom(known.roomId, chatId);
      if (resolvedName) {
        await this.#syncPortalName(known.roomId, name);
        if (known.name !== name) {
          known.name = name;
          this.#save();
        }
      }
      return known.roomId;
    }
    return await this.#createPortal(chatId, item, summary);
  }

  /** Persisted portal mappings outlive local Hub credentials. Reconcile the
   * current owner against Matrix membership, never a saved "joined" flag. */
  async #ensureOwnerRoom(roomId: string, chatId: string): Promise<void> {
    const owner = this.#owner;
    const key = `${owner}|${roomId}`;
    if (this.#verifiedOwnerRooms.has(key)) return;
    const room = encodeURIComponent(roomId);
    const bridge = await this.#matrix<{protocol?: {id?: string}; channel?: {id?: string}}>(
      `/_matrix/client/v3/rooms/${room}/state/m.bridge/${encodeURIComponent(`${this.#options.homeserver.serverName}/wechat`)}`,
      {as: this.botId},
    );
    if (bridge.protocol?.id !== "wechat" || bridge.channel?.id !== weChatPortalChannelId(chatId))
      throw new Error("Saved WeChat room does not match its bridge identity");
    const membershipPath = `/_matrix/client/v3/rooms/${room}/state/m.room.member/${encodeURIComponent(owner)}`;
    const member = await this.#matrix<{membership?: string}>(membershipPath, {as: this.botId})
      .catch((error: unknown): {membership?: string} | null => {
        if (error instanceof Error && error.message.endsWith(" returned 404")) return null;
        throw error;
      });
    if (member?.membership === "leave" || member?.membership === "ban")
      throw new Error("Current Hub account explicitly left this WeChat room");
    if (member?.membership !== "join") {
      if (member?.membership !== "invite")
        await this.#matrix(`/_matrix/client/v3/rooms/${room}/invite`, {
          method: "POST", as: this.botId,
          body: {user_id: owner, "com.beeper.exclude_from_timeline": true},
        });
      await this.#matrix(`/_matrix/client/v3/join/${room}`, {
        method: "POST", as: owner, body: {"com.beeper.exclude_from_timeline": true},
      });
      const verified = await this.#matrix<{membership?: string}>(membershipPath, {as: this.botId});
      if (verified.membership !== "join") throw new Error("WeChat room membership was not confirmed");
    }
    if (owner === this.#owner) this.#verifiedOwnerRooms.add(key);
  }

  async #createPortal(chatId: string, item: RelayMessage, summary?: WeChatChatSummary): Promise<string> {
    const resolvedName = conversationName(item);
    const name = String(resolvedName ?? "WeChat").slice(0, 1024);
    const channelId = weChatPortalChannelId(chatId);
    const recovered = (await this.#existingPortals()).get(channelId);
    if (recovered) {
      await this.#ensureOwnerRoom(recovered, chatId);
      if (resolvedName) await this.#syncPortalName(recovered, name);
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
            ...(summary ? [{
              type: "co.polymux.wechat.session",
              state_key: "",
              content: summary,
            }] : []),
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
    this.#publishedRoomNames.set(created.room_id, name);
    const face = avatarUrlOf(item);
    if (face) await this.#setRoomAvatar(created.room_id, face);
    else await this.#applyLocalAvatar({ room: created.room_id }, chatId);
    this.#state.rooms[chatId] = {
      roomId: created.room_id,
      isGroup: Boolean(item.isGroup),
      ...(resolvedName ? { name } : {}),
    };
    this.#state.roomToChat[created.room_id] = chatId;
    if (summary) (this.#state.chatSummaries ??= {})[chatId] = summary;
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
    const roomId = event.room_id ?? "";
    const previous = this.#outboundChatTasks.get(roomId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() => this.#relayOutboundDurable(event));
    this.#outboundChatTasks.set(roomId, task);
    try { await task; }
    finally {
      if (this.#outboundChatTasks.get(roomId) === task) this.#outboundChatTasks.delete(roomId);
    }
  }

  async #relayOutboundDurable(event: MatrixEvent): Promise<void> {
    const chatId = this.#state.roomToChat[event.room_id ?? ""];
    if (event.sender !== this.#owner || !chatId ||
        !["m.room.message", "m.sticker", "m.room.redaction"].includes(event.type ?? "") ||
        event.content?.["co.polymux.wechat.remote"])
      return await this.#relayOutboundOnce(event);
    if (!event.event_id) throw new Error("The WeChat send has no event identity");
    if (!this.#outbox) throw new Error("The WeChat send record is unavailable");
    const recorded = this.#outbox.claim(event.event_id, this.#owner, chatId);
    if (recorded) {
      if (recorded.status === "confirmed") return;
      if (recorded.status === "failed") throw new Error(recorded.error ?? "The previous WeChat attempt failed");
      throw new WeChatDeliveryUnconfirmedError();
    }
    try {
      await this.#relayOutboundOnce(event);
      try {this.#outbox.finish(event.event_id, "confirmed");}
      catch {throw new WeChatDeliveryUnconfirmedError("WeChat delivery could not be recorded. Check WeChat before sending again.");}
    } catch (error) {
      const unconfirmed = isWeChatDeliveryUnconfirmed(error);
      try {
        if (this.#outbox.get(event.event_id)?.status === "confirmed") return;
        this.#outbox.finish(event.event_id, unconfirmed ? "unconfirmed" : "failed", message(error));
      }
      catch {throw new WeChatDeliveryUnconfirmedError("WeChat delivery could not be recorded. Check WeChat before sending again.");}
      throw error;
    }
  }

  #restoreOutbox(owner: string): void {
    if (this.#outboxOwner === owner) return;
    this.#outbox ??= new WeChatOutbox(path.join(this.#options.directory, "wechat"));
    const entries = this.#outbox.recover(owner);
    // A cached in-flight body match without a pre-send baseline cannot prove
    // delivery after a crash. Rebuild these only from the durable journal.
    this.#state.outboundEchoes = this.#state.outboundEchoes.filter(echo => !echo.eventId);
    for (const entry of entries) {
      if (entry.status === "confirmed") {
        if (entry.messageId) {
          ((this.#state.nativeMessageEvents ??= {})[entry.chatId] ??= {})[entry.messageId] = entry.eventId;
          (this.#state.remoteMessageIds ??= {})[entry.eventId] = entry.messageId;
        }
        if (entry.clientMessageId)
          (this.#state.remoteMessageClientIds ??= {})[entry.eventId] = entry.clientMessageId;
        this.#options.homeserver.setOutboundDeliveryStatus?.(entry.eventId, null);
      } else {
        this.#options.homeserver.setOutboundDeliveryStatus?.(entry.eventId, "unconfirmed");
        if (entry.body !== null && entry.previousIds !== null)
          this.#state.outboundEchoes.push({chatId: entry.chatId, body: entry.body,
            timestamp: entry.timestamp, previousIds: entry.previousIds, eventId: entry.eventId, recovered: true});
      }
    }
    this.#outboxOwner = owner;
    if (entries.length) this.#save();
  }

  async #relayOutboundOnce(event: MatrixEvent): Promise<void> {
    if (event.sender !== this.#owner) return;
    const chatId = this.#state.roomToChat[event.room_id ?? ""];
    if (!chatId) return;
    if (this.#stopped) throw new Error("WeChat is disconnected");
    this.#assertLiveTestDestination(chatId);
    if (event.type === "m.room.redaction") {
      const target =
        event.redacts && this.#state.remoteMessageIds?.[event.redacts];
      if (!target) return;
      await this.#assertOutboundSessionSignedIn();
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
      await this.#assertOutboundSessionSignedIn();
      await this.#write({ kind: "read", chatId });
      await this.#publishUnreadCount(chatId, () => 0);
      return;
    }
    if (
      (event.type !== "m.room.message" && event.type !== "m.sticker") ||
      // Anything this bridge itself posted; relaying it back would loop.
      event.content?.["co.polymux.wechat.remote"]
    )
      return;

    // Renderer readiness is advisory: another Matrix client or a restored
    // local event can enter here without ever asking it. Require the desktop
    // account itself to be signed in before touching either outbound
    // transport, so a merely running login window is never treated as WeChat.
    await this.#assertOutboundSessionSignedIn();

    const mediaType =
      event.type === "m.sticker" || event.content?.["co.polymux.sticker"] === true
        ? "sticker"
        : matrixMediaType(event.content?.msgtype);
    if (mediaType && typeof event.content?.url === "string") {
      if (replyEvent(event))
        throw new Error("WeChat does not support sending an attachment as a native reply yet");
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
      this.#rememberOutboundMessageId(event.event_id, delivery, chatId);
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
      this.#rememberOutboundMessageId(event.event_id, delivery, chatId);
      return;
    }
    if (event.content?.msgtype !== "m.text") return;
    const authored = String(event.content?.body ?? "").trim();
    if (!authored) return;
    const replyEventId = replyEvent(event);
    const replyTo = replyEventId
      ? this.#state.remoteMessageIds?.[replyEventId]
      : undefined;
    if (replyEventId && !replyTo)
      throw new Error("The quoted WeChat message has no verified native message id yet");
    const rendered = await this.#outboundText(event, authored);
    if ((event.content?.["m.mentions"] as {room?: boolean} | undefined)?.room)
      throw new Error("WeChat group-wide mentions are not supported yet");
    const mentions = matrixMentionIds(event).map((userId) => {
      const nativeId = this.#state.puppetRemoteIds?.[userId];
      if (!nativeId) throw new Error("A mentioned person has no verified WeChat member id");
      return nativeId;
    });
    // Preserve the native quote and its at-user list in the same request.
    const nativeReply = Boolean(
      this.#options.writer && replyTo,
    );
    const body = nativeReply ? authored : rendered.body;
    const startedAt = Date.now();
    const previousIds = !replyTo && !mentions.length
      ? await this.#sentTextMessageIds(chatId, body, startedAt) : null;
    if (event.event_id && previousIds !== null)
      this.#outbox?.textCandidate(event.event_id, body, startedAt, previousIds);
    let delivery: WeChatWriteResult;
    try {
      delivery = await this.#sendOutboundText(
        chatId,
        body,
        replyTo,
        mentions,
        nativeReply ? rendered.body : undefined,
        nativeReply ? rendered.replyContext : undefined,
        event.event_id,
      );
    } catch (error) {
      // Ordinary text first travels through the relay before any native
      // fallback. A relay/native handoff can time out while its accepted send
      // is still reaching WeChat; treating that uncertainty as rejection puts
      // the text back in the composer and makes the natural retry a duplicate.
      // Replies and mentions use different native payloads and retain their
      // existing fail-closed verification until they have an exact matcher.
      if (replyTo || mentions.length > 0 || previousIds === null) throw error;
      try {
        delivery = await this.#reconcilePlainTextDelivery(
          chatId, body, startedAt, error, previousIds,
        );
      } catch (unresolved) {
        if (isWeChatDeliveryUnconfirmed(unresolved) && event.event_id) {
          this.#state.outboundEchoes.push({chatId, body, timestamp: startedAt,
            eventId: event.event_id, previousIds, recovered: true});
          this.#save();
        }
        throw unresolved;
      }
    }
    this.#rememberOutboundMessageId(event.event_id, delivery, chatId);
  }

  async #reconcilePlainTextDelivery(
    chatId: string,
    body: string,
    startedAt: number,
    originalError: unknown,
    previousIds: string[],
  ): Promise<WeChatWriteResult> {
    const timeoutMs = Math.max(
      0,
      Number(this.#options.outboundReconcileMs ?? OUTBOUND_RECONCILE_MS),
    );
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw originalError;

    const operationId = randomUUID();
    this.#state.outboundEchoes.push({
      chatId,
      body,
      timestamp: Date.now(),
      operationId,
    });
    this.#save();
    const deadline = Date.now() + timeoutMs;
    try {
      do {
        const ids = await this.#sentTextMessageIds(
          chatId,
          body,
          startedAt,
        );
        const fresh = [...new Set(ids ?? [])].filter((id) => !previousIds.includes(id));
        if (fresh.length === 1) return {deliveredVerified: true, messageId: fresh[0]};
        await new Promise((resolve) => setTimeout(resolve, 250));
      } while (Date.now() < deadline);
      throw originalError;
    } catch (error) {
      this.#consumeOutboundOperation(operationId);
      this.#save();
      throw error;
    }
  }

  /** Finds only a self-authored text row created for this send attempt. The
   * server id is parsed losslessly because WeChat uses unsigned 64-bit ids. */
  async #sentTextMessageIds(
    chatId: string,
    body: string,
    startedAt: number,
  ): Promise<string[] | null> {
    const wxid = chatId === "filehelper" ? null : await this.#accountWxid();
    const self = chatId === "filehelper" ? null : await this.#selfSenderId(chatId);
    if (chatId !== "filehelper" && !wxid && !self) return null;
    const since = Math.max(1, Math.floor(startedAt / 1_000) - 1);
    const matchingIds = (rows: WeChatTextHistoryRow[]): string[] => rows.filter(candidate => {
      const authored = chatId === "filehelper" || (candidate.sender_wxid && wxid
        ? candidate.sender_wxid === wxid
        : self !== null && String(candidate.real_sender_id ?? "") === self);
      return authored && Number(candidate.create_time) >= since &&
        candidate.message_kind === "text" &&
        (candidate.display_text === body || candidate.message_content === body) &&
        candidate.server_id != null && String(candidate.server_id) !== "0";
    }).map(row => String(row.server_id));
    const nativeRead = await this.#nativeHistoryRead(chatId).catch((): null => null);
    if (nativeRead) {
      try {return matchingIds(await nativeRead({limit: 20}));}
      catch { /* A configured CLI can still verify stable sender identities. */ }
    }
    for (const cli of this.#cliPaths()) {
      const result = (await run(
        cli,
        [
          "history",
          chatId,
          "--since",
          String(since),
          "--limit",
          "20",
          "--json",
          "--no-transcribe",
          "--fields",
          "server_id,real_sender_id,sender_wxid,create_time,message_kind,display_text,message_content",
        ],
        {timeout: SELF_SENT_TIMEOUT_MS},
      ).catch((): null => null)) as {stdout: string} | null;
      if (!result) continue;
      try {
        const parsed = parseWeChatJson<WeChatTextHistoryRow[] | {rows?: WeChatTextHistoryRow[]}>(result.stdout);
        const rows = Array.isArray(parsed) ? parsed : parsed?.rows;
        if (!Array.isArray(rows)) continue;
        return matchingIds(rows);
      } catch {
        // Another CLI candidate may understand the richer history fields.
      }
    }
    return null;
  }

  async #sendOutboundText(
    chatId: string,
    body: string,
    replyTo?: string,
    mentions: string[] = [],
    fallbackBody?: string,
    replyContext?: WeChatReplyContext,
    eventId?: string,
  ): Promise<WeChatWriteResult> {
    const writeWithNative = async (): Promise<WeChatWriteResult> => {
      if (!this.#options.writer)
        throw new Error("WeChat native text writing is unavailable");
      const operationId = randomUUID();
      const pendingText = {
        chatId,
        body: fallbackBody ?? body,
        timestamp: Date.now(),
        operationId,
        eventId,
      };
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
        // A verified server id is the reconciliation key. Retaining a body
        // match after this acknowledgement could swallow a distinct phone
        // message with the same text.
        if (result.messageId) this.#consumeOutboundOperation(operationId);
        return result;
      } catch (error) {
        this.#consumeOutboundOperation(operationId);
        this.#save();
        throw error;
      }
    };

    // Use one recipient-checked, exclusively owned route for every native
    // text send. Relay health is not evidence of its recipient or delivery.
    if (this.#options.writer) return await writeWithNative();

    if (replyTo)
      throw new Error("WeChat native replies require the bundled writer");

    if (mentions.length) {
      const args = ["send", body, "--wxid", chatId, "--json"];
      for (const mention of new Set(mentions)) args.push("--mention", mention);
      for (const cli of this.#cliPaths()) {
        const result = await this.#runSendCli(cli, args);
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
    // Once dispatched, even a negative relay answer can describe a send that
    // arrives later. Never prime, relaunch or switch transports and resend it.
    const result = await this.#relay<RelaySendResult>("/send", {
      method: "POST",
      body: {chatId, message: body},
    });
    if (result.delivered_verified !== true || result.error)
      throw new Error(
        result.message || result.error ||
        "WeChat delivery is unverified; check the conversation before sending again",
      );
    this.#relayHijackArmed = true;
    this.#state.outboundEchoes.push({ chatId, body, timestamp: Date.now(), eventId });
    this.#save();
    return {
      deliveredVerified: true,
      ...(result.messageId ? {messageId: result.messageId} : {}),
    };
  }

  /** Retires an operation once its exact native acknowledgement is known. */
  #consumeOutboundOperation(operationId?: string): void {
    if (!operationId) return;
    this.#state.outboundEchoes = this.#state.outboundEchoes.filter(
      (echo) => echo.operationId !== operationId,
    );
  }

  #rememberOutboundMessageId(
    eventId: string | undefined,
    delivery: WeChatWriteResult,
    chatId: string,
  ): void {
    if (!eventId) return;
    if (delivery.deliveredVerified && delivery.messageId) {
      try {this.#outbox?.acknowledge(eventId, delivery.messageId, delivery.clientMessageId);}
      catch {throw new WeChatDeliveryUnconfirmedError("WeChat delivery could not be recorded. Check WeChat before sending again.");}
      this.#options.homeserver.setOutboundDeliveryStatus?.(eventId, null);
    }
    if (delivery.messageId)
      ((this.#state.nativeMessageEvents ??= {})[chatId] ??= {})[delivery.messageId] = eventId;
    if (delivery.messageId)
      this.#state.remoteMessageIds = {
        ...(this.#state.remoteMessageIds ?? {}),
        [eventId]: delivery.messageId,
      };
    if (delivery.messageId)
      this.#state.outboundEchoes = this.#state.outboundEchoes.filter(
        (echo) => echo.eventId !== eventId,
      );
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
    replyContext?: WeChatReplyContext;
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
    const native = quoted?.content?.["co.polymux.wechat.native"] as
      {body?: string; kind?: string; sender?: string} | undefined;
    const senderId = native?.sender || (quoted?.sender === this.#owner
      ? await this.#accountWxid() : this.#state.puppetRemoteIds?.[quoted?.sender ?? ""]);
    const kind = native?.kind ?? ({"m.image": "image", "m.video": "video", "m.audio": "audio", "m.file": "file"}[
      String(quoted?.content?.msgtype) as "m.image" | "m.video" | "m.audio" | "m.file"] ?? "text");
    return {
      body: `↳ ${sender}: ${quotedBody}\n${authored}`,
      replyContext: {
        body: native?.body || quotedBody,
        sender,
        kind,
        ...(senderId ? {senderId} : {}),
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
          ...(this.#state.rooms[chatId]?.name
            ? {chatName: this.#state.rooms[chatId].name}
            : {}),
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
        const result = await this.#runSendCli(
          cli,
          ["send", name, "--image", target, "--wxid", chatId, "--json"],
        );
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
    this.#activeNativeWrite = request;
    this.#nativeWriteRevision += 1;
    try {
      return await this.#writeExclusive(request);
    } finally {
      this.#activeNativeWrite = null;
      this.#nativeWriteRevision += 1;
      release();
    }
  }

  async #writeExclusive(request: WeChatWriteRequest): Promise<WeChatWriteResult> {
    if (this.#options.writer?.compatible && !(await this.#options.writer.compatible()))
      throw new Error(this.#options.writer.readinessFailure?.() || "This WeChat version needs a Polymux update before sending.");
    if (!this.#relayRecoverySafe)
      throw new Error("WeChat native cleanup was not confirmed; reconnect after restarting WeChat and Polymux");
    if (!this.#options.writer)
      throw new Error(`WeChat ${request.kind} writing is unavailable`);
    this.#assertLiveTestDestination(request.chatId);
    // The composer can fall back to a debugger even for plain text. Every
    // native write holds relay ownership through completion; a five-second
    // priority hint cannot protect a longer readiness or send operation.
    // A recovery already owning the process must finish before a new native
    // operation. The exception is the recovery deliberately queued behind
    // this cold wake's priority lease: waiting for it would invert the lease.
    if (this.#relayRecovery && Date.now() >= this.#writerPriorityUntil)
      await this.#relayRecovery;
    // This covers the whole native critical section, including its readiness
    // probe. `start()` is also called by status refreshes, and must see the
    // guard before the relay disappears rather than racing to replace it.
    this.#writerPaused = true;
    let retryRelay = false;
    try {
      await this.#relayStatus(OUTBOUND_PROBE_TIMEOUT_MS);
      const appWasAttached = this.#relayWeChatPid !== null;
      // Relay health can stay green after WeChat itself exits because the
      // loopback service is still alive. Check the actual app on every native
      // write so a remembered session is relaunched hidden before delivery.
      if (
        this.#options.ensureAppRunning &&
        !(await this.#ensureAppRunning())
      )
        throw new Error(WECHAT_WRITER_FAILURES.wechat_not_running);
      await this.#assertOutboundSessionSignedIn();
      // The native writer is also the fallback while the relay itself is still
      // starting. Do not spend the relay's 15-second readiness budget before
      // invoking a sender that does not depend on that readiness.
      const relayWasHealthy = (await this.#relayStatus(OUTBOUND_PROBE_TIMEOUT_MS)) === "connected";
      const pausedRelay = await this.#pauseRelayForWriter();
      if (this.#options.externalProvider !== false && request.kind === "text" && !appWasAttached && !this.#desktopComposerIsWarm())
        await this.#warmNewDesktopComposer();
      let result: WeChatWriteResult | undefined;
      let operationError: unknown;
      try {
        result = await this.#writeNative(request);
        if (result.deliveryUnconfirmed === true)
          throw new WeChatDeliveryUnconfirmedError(result.reason);
        if (result.deliveredVerified !== true)
          throw new Error(
            weChatWriterFailureMessage(result.reason, request.kind),
          );
      } catch (error) {
        operationError = error;
      }
      // Delivery acknowledgement belongs to the operation above. Reattaching
      // the inbound relay can take many seconds and must not keep a successful
      // Hub send pending for that unrelated recovery work.
      retryRelay = pausedRelay || !relayWasHealthy;
      const settled = settleWeChatWrite(result, operationError, undefined);
      return settled.result;
    } finally {
      // Exact history verification has settled the writer operation, so the
      // recovery scheduled by a cold wake may resume immediately rather than
      // waiting out the remainder of its five-second lease.
      this.#writerPriorityUntil = 0;
      this.#writerPaused = false;
      if (!this.#stopped && retryRelay) {
        this.#scheduleRelayRecovery();
      } else if (!this.#stopped) {
        this.#ensureConsume();
      }
    }
  }

  /** A terminated or malformed driver response cannot establish detachment. */
  #unsafeNativeFailure(error: unknown): boolean {
    return typeof error === "object" && error !== null &&
      "relayRecoverySafe" in error && error.relayRecoverySafe === false;
  }

  async #writeNative(request: WeChatWriteRequest): Promise<WeChatWriteResult> {
    if (!this.#relayRecoverySafe)
      throw new Error("WeChat native cleanup was not confirmed; reconnect after restarting WeChat and Polymux");
    try {
      const result = await this.#options.writer!.write(request);
      if (result.relayRecoverySafe === false) this.#holdRelayRecovery();
      return result;
    } catch (error) {
      if (this.#unsafeNativeFailure(error)) this.#holdRelayRecovery();
      throw error;
    }
  }

  #holdRelayRecovery(): void {
    this.#relayRecoverySafe = false;
    this.#writerReadiness = null;
    this.#desktopComposerWarmAt = 0;
    this.#streaming?.abort();
    this.#imageRetryAbort?.abort();
    for (const controller of this.#activeImageReads) controller.abort();
  }

  #scheduleRelayRecovery(): void {
    if (this.#options.externalProvider === false) { this.#ensureConsume(); return; }
    if (this.#stopped || this.#relayRecovery || !this.#relayRecoverySafe) return;
    const recovery = new Promise<void>((resolve) => setTimeout(resolve, 500))
      .then(async () => {
        // A cold Hub or agent wake schedules receive recovery before its send
        // has entered the writer queue. Honour the moving priority deadline:
        // the write extends it on entry and clears it after exact history
        // verification, so the relay resumes as soon as delivery settles
        // without racing the desktop composer for WeChat's daemon.
        while (
          !this.#stopped &&
          (this.#writerPaused || Date.now() < this.#writerPriorityUntil)
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (this.#stopped || !this.#relayRecoverySafe) return true;
        await this.#resumeSupervisedRelay();
        if (
          (await this.#relayStatus(OUTBOUND_PROBE_TIMEOUT_MS)) === "connected"
        ) {
          this.#ensureConsume();
          return true;
        }
        return await this.#startRelay();
      })
      .then((started) => {
        if (!started)
          throw new Error("WeChat relay did not restart after the native operation");
      })
      .catch((error: unknown) =>
        this.#log(`[wechat] relay recovery after outbound failed: ${message(error)}`),
      )
      .finally(() => {
        if (this.#relayRecovery === recovery) this.#relayRecovery = null;
        if (this.#stopped) {
          this.#relayProcess?.kill();
          this.#relayProcess = null;
        } else {
          this.#ensureConsume();
        }
      });
    this.#relayRecovery = recovery;
  }

  /** Only a missing executable proves that a CLI send never started. A
   * timeout or nonzero exit can happen after delivery and must not select
   * another installed copy to replay the operation. */
  async #runSendCli(cli: string, args: string[]): Promise<{stdout: string; stderr: string} | null> {
    try {
      return await run(cli, args, {timeout: MEDIA_SEND_TIMEOUT_MS});
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("WeChat send outcome is unknown; check the conversation before sending again", {cause: error});
    }
  }

  #cliPaths(): string[] {
    if (this.#options.externalProvider === false) return [];
    return this.#options.cliPaths ?? defaultCliPaths();
  }

  // ---- native store reads ----------------------------------------------------

  /** The host-supplied live readers, one per account with a key registry. */
  #nativeStores(): WeChatNativeStore[] {
    if (!this.#options.preferNativeInbound || this.#nativeInboundFailed) return [];
    return this.#options.nativeStores ?? [];
  }

  /** Readers that can actually serve message history, keys and all. */
  #nativeMessageStores(): WeChatNativeStore[] {
    return this.#nativeStores().filter((store) => store.messageShards().length > 0);
  }

  /** Native inbound wins only when explicitly preferred and keyed. Relay SSE
   * stays the default so an unprovisioned Mac keeps its current behaviour. */
  #nativeInboundActive(): boolean {
    return (this.#options.preferNativeInbound ?? false) &&
      this.#nativeMessageStores().length > 0;
  }

  /** Whether this bridge linked through anything that can read WeChat. Used
   * for startup and read-state gating so a keyed Mac does not need the relay
   * to be connected first. */
  nativeReadable(): boolean {
    return Boolean(this.#server) && this.#nativeDirectoryReadable && this.#nativeReadable();
  }

  #nativeReadable(): boolean {
    return this.#nativeStores().length > 0;
  }

  /**
   * A native row in the shape the ingest pipeline already understands. The
   * mapping keeps native field names, which `normalise` folds, so the relay
   * and native paths share every downstream decision.
   */
  #nativeRelayMessage(row: WeChatWalMessage): RelayMessage {
    const accepted = row.serverId && row.serverId !== "0";
    return {
      local_id: row.localId,
      ...(accepted ? {server_id: row.serverId, message_id: row.serverId} : {}),
      chatId: row.chatId,
      create_time: row.timestamp,
      real_sender_id: row.realSenderId ?? undefined,
      sender_wxid: row.senderWxid ?? undefined,
      message_kind: row.kind,
      message_content: row.body ?? "",
      is_group: /@chatroom$/i.test(row.chatId),
      ...(row.kind === "recalled" ? {recall: nativeRecall(row.body)} : {}),
    };
  }

  /** Merged session directory from every keyed account, or null when no
   * native store can serve one. Throws only when every store fails; an empty
   * account list falls back to the relay so a fresh sign-in keeps working. */
  async #nativeChatList(): Promise<RelayChat[] | null> {
    const stores = this.#nativeStores();
    if (!stores.length) return null;
    const merged = new Map<string, RelayChat>();
    let served = false;
    for (const store of stores) {
      let conversations: Awaited<ReturnType<WeChatNativeStore["conversations"]>>;
      try {
        conversations = await store.conversations();
      } catch {
        continue;
      }
      served = true;
      for (const conversation of conversations) {
        if (!conversation.chatId) continue;
        const previous = merged.get(conversation.chatId);
        const last = conversation.lastTimestamp ?? 0;
        if (previous && Number(previous.last_timestamp ?? 0) >= last) continue;
        merged.set(conversation.chatId, {
          username: conversation.chatId,
          chatId: conversation.chatId,
          display_name: conversation.name ?? undefined,
          isGroup: conversation.isGroup,
          unread_count: conversation.unreadCount + (conversation.markedUnread && !conversation.unreadCount ? 1 : 0),
          last_timestamp: conversation.lastTimestamp ?? undefined,
          summary: conversation.summary ?? undefined,
        });
      }
    }
    this.#nativeDirectoryReadable = served;
    return served ? [...merged.values()] : null;
  }

  /** Native history reader for one chat, or null when no keyed shard holds
   * it. Returned rows already match the relay's history shape so the paging
   * helper and ingest pipeline stay shared. */
  async #nativeHistoryRead(chatId: string): Promise<((query: {until?: number; limit: number}) => Promise<RelayMessage[]>) | null> {
    for (const store of this.#nativeMessageStores()) {
      let holds = false;
      try {
        holds = (await store.shardOf(chatId)) !== null;
      } catch {
        continue;
      }
      if (!holds) continue;
      return async (query: {until?: number; limit: number}): Promise<RelayMessage[]> => {
        const rows = await store.historyPage(chatId, {until: query.until, limit: query.limit});
        return rows.map((row) => ({
          local_id: row.local_id,
          ...(row.server_id && row.server_id !== "0" ? {server_id: row.server_id} : {}),
          chatId,
          create_time: row.create_time,
          real_sender_id: row.real_sender_id ?? undefined,
          sender_wxid: row.sender_wxid ?? undefined,
          message_kind: row.message_kind,
          message_content: row.message_content ?? "",
          is_group: /@chatroom$/i.test(chatId),
          ...(row.message_kind === "recalled" ? {recall: nativeRecall(row.message_content)} : {}),
        }));
      };
    }
    return null;
  }

  /** Follows WeChat's write-ahead logs instead of the relay's event stream. */
  async #consumeNative(generation: number): Promise<void> {
    // A key's presence does not prove it can decrypt a live store. Probe the
    // session and every keyed message shard before replacing relay SSE.
    for (const store of this.#nativeMessageStores()) {
      await store.conversations();
      for (const entry of store.messageShards()) await store.snapshot(entry);
    }
    if (this.#stopped || generation !== this.#consumeGeneration) return;
    const wal = new WeChatWalWatcher({
      stores: this.#nativeMessageStores(),
      chats: () => Object.keys(this.#state.rooms),
      onMessages: async (rows) => {
        for (const row of rows) {
          if (this.#stopped || generation !== this.#consumeGeneration) return;
          await this.#ingest(this.#nativeRelayMessage(row));
        }
      },
      // Badges and titles move without a new message row: read state and
      // renames land in the session and contact stores.
      onDirectory: () => {
        void this.#syncReadState().catch((error: unknown) =>
          this.#log(`[wechat] read state pass failed: ${message(error)}`),
        );
      },
      log: this.#log,
    });
    this.#wal = wal;
    try {
      await wal.start();
      // The watcher drives everything from here; hold the consume task open
      // until the bridge closes and aborts it.
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (this.#stopped || generation !== this.#consumeGeneration) {
            clearInterval(timer);
            resolve();
          }
        }, 250);
        timer.unref?.();
      });
    } finally {
      if (this.#wal === wal) this.#wal = null;
      await wal.stop();
    }
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
    options: { method?: string; body?: unknown; timeoutMs?: number } = {},
  ): Promise<T> {
    if (this.#options.externalProvider === false) throw new Error("External WeChat provider is disabled");
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
        signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS * 10),
      },
    );
    if (!response.ok)
      throw new Error(`${endpoint} returned ${response.status}`);
    return parseWeChatJson<T>(await response.text());
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
    if (this.#retryingImages || this.#writerPaused || !this.#relayRecoverySafe) return;
    const pending = this.#state.pendingImages;
    if (!pending) return;
    const controller = new AbortController();
    this.#imageRetryAbort = controller;
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
        if (this.#stopped || this.#writerPaused || controller.signal.aborted)
          return;
        item.lastHeapAttemptAt = Date.now();
        let media = await this.#imageOrThumbnail(
          item.chatId,
          item.messageId,
          "heap",
          controller.signal,
          item.sentAt,
        ).catch((): null => null);
        if (this.#writerPaused || controller.signal.aborted) return;
        if (!media && item.nextAttemptAt <= now) {
          media = await this.#imageOrThumbnail(
            item.chatId,
            item.messageId,
            "auto",
            controller.signal,
            item.sentAt,
          ).catch((): null => null);
          if (this.#writerPaused || controller.signal.aborted) return;
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
          ...(item.replyTo ? {"m.relates_to": {"m.in_reply_to": {event_id: item.replyTo}}} : {}),
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
      if (this.#imageRetryAbort === controller)
        this.#imageRetryAbort = null;
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
    this.#stateLoad ??= (async (): Promise<void> => {
      const file = path.join(this.#options.directory, "wechat", "state.json");
      const stored = await readFile(file, "utf8")
        .then((raw) => JSON.parse(raw) as Partial<BridgeState>)
        .catch((): null => null);
      if (stored) this.#state = { ...emptyState(), ...stored };
    })();
    // Catalog and member reads can run before the next debounced flush. A
    // second disk load would erase newly created portals and native send ids.
    await this.#stateLoad;
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
        void this.#flush().catch(error => this.#log(`[wechat] cache save failed: ${message(error)}`));
      }, 250);
    if (++this.#unsaved >= SAVE_EVERY_CHANGES) {
      this.#unsaved = 0;
      void this.#flush().catch(error => this.#log(`[wechat] cache save failed: ${message(error)}`));
    }
  }

  #flush(): Promise<void> {
    const task = this.#flushQueue.catch(() => {}).then(() => this.#flushOnce());
    this.#flushQueue = task;
    return task;
  }

  async #flushOnce(): Promise<void> {
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
      (echo) => echo.recovered || now - echo.timestamp < ECHO_TTL_MS,
    );
    this.#state.stickerReferences = Object.fromEntries(
      Object.entries(this.#state.stickerReferences ?? {})
        .sort(([, a], [, b]) => b.seenAt - a.seenAt)
        .slice(0, 512),
    );
    const file = path.join(this.#options.directory, "wechat", "state.json");
    // Replace atomically. The flush queue prevents an older snapshot from
    // landing after a newer one; private temporary names avoid collisions.
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
  last_timestamp?: number;
  summary?: string;
  avatar?: string;
  avatarUrl?: string;
  avatar_url?: string;
  head_img?: string;
  head_img_url?: string;
  small_head_url?: string;
  big_head_url?: string;
}

interface WeChatChatSummary {
  last_message_ts: number | null;
  preview: string | null;
}

function nativeChatSummary(chat: RelayChat): WeChatChatSummary {
  const timestamp = Number(chat.last_timestamp) * 1_000;
  return {
    // last_timestamp is authored time; sort_timestamp may instead pin a chat.
    last_message_ts: Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= 8_640_000_000_000_000
      ? timestamp : null,
    preview: typeof chat.summary === "string" ? chat.summary.trim().slice(0, 2_048) || null : null,
  };
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
  "forward",
]);

const KIND_LABELS: Record<string, string> = {
  emoticon: "[Sticker]",
  image: "[Photo]",
  voice: "[Voice message]",
  video: "[Video]",
  file: "[File]",
  forward: "[Forwarded messages]",
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

/**
 * A native recall row carries the revoked server id inside its `<revokemsg>`
 * payload (`<newmsgid>` / `<svrid>`), matching the relay's `recallConfirmed`
 * contract in `scripts/wechat/wechat-message-history.mjs`. Returns an empty
 * object when the body carries no id so the row still ingests as a notice.
 */
function nativeRecall(body: string | null): {replacedMsgId?: string; text?: string} {
  const revoke = /<revokemsg(?:\s[^>]*)?>[\s\S]*?<\/revokemsg>/i.exec(String(body ?? ""))?.[0];
  if (!revoke) return {};
  const id = xmlTag(revoke, "newmsgid") || xmlTag(revoke, "svrid");
  return /^[1-9]\d{0,19}$/.test(id) ? {replacedMsgId: id} : {};
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
  if (["19", "57"].includes(xmlTag(xml, "type"))) return null;
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
