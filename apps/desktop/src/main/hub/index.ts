import path from "node:path";
import {weChatAttention} from "./wechat-attention.js";
import {unavailableWeChatLogin, isWeChatDeliveryUnconfirmed} from "@polymux/wechat";
import type {WeChatLoginDto} from "@polymux/protocol";
import {polymuxHome} from "../system/paths.js";
import {homedir} from "node:os";
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {
  bridgeDisplayName,
  EmailAccounts,
  MatrixHub,
  mediaUrl,
  shippedNetworkConfig,
  type CommandResult,
  type CommandRunner,
  type MailConsentPrompt,
  type MailOAuthProvider,
  type MatrixMessage,
  type MatrixContact,
  type MatrixRoom,
} from "@polymux/hub";
import {
  probeWeChatRelay,
  type WeChatSessionState,
  type WeChatStickerCatalogEntry,
} from "@polymux/wechat";
import {
  COMMS_PLATFORMS,
  type CommsBridgeDto,
  type CommsBridgeSetupDto,
  type ChatMemberDto,
  type ChatGroupInfoDto,
  type ChatMentionsDto,
  type ChatStickerDto,
  type CommsContactDto,
  type CommsEmailAccountDto,
  type CommsLoginStepDto,
  type CommsPlatform,
  type CommsStatusDto,
  type CommsWakeDto,
  type CreateChatRequest,
  type JsonValue,
  type MailEnvelopeDto,
  type MailAttachmentContentDto,
  type MailFolderDto,
  type MailListRequest,
  type MailMessageDto,
  type SaveEmailAccountRequest,
  type SaveMailSignaturesRequest,
  type SystemPermissionKind,
} from "@polymux/protocol";
import type {CredentialStore} from "@earendil-works/pi-ai";
import type {AppleMailSearchResult} from "./apple-mail.js";
import type {ContactLookupResult} from "./contacts.js";

/** Credential key the hub's access token is stored under. */
const HUB_CREDENTIAL_ID = "matrix-hub";
/** Where the bridge fleet is deployed when the user has not moved it. */
const DEFAULT_HUB_URL = "http://127.0.0.1:18080";
/**
 * The homeserver's own address. The hub proxy deliberately does not forward the
 * admin API, so provisioning has to reach the server directly.
 */
const DEFAULT_HOMESERVER_URL = "http://127.0.0.1:8008";
/** Preference key holding whether WeChat's relay is linked to the hub. */
const WECHAT_PREFERENCE = "comms-wechat";
const CONTACT_ALIASES_PREFERENCE = "comms-contact-aliases";
/**
 * WeChat's one way in. There is no sign-in to drive — the account is whichever
 * one WeChat.app holds — so linking is a single button that starts carrying
 * that app's messages, and unlinking stops it again.
 */
const WECHAT_FLOW = {
  id: "relay",
  name: "Use WeChat on this Mac",
  description: "Reads and sends through the WeChat app you are already signed in to.",
};

function normalizedIdentity(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizedPhone(value: string): string {
  return value.replace(/\D+/g, "").replace(/^00/, "");
}

function samePhone(left: string, right: string): boolean {
  if (left.length < 8 || right.length < 8) return false;
  const digits = Math.min(left.length, right.length, 10);
  return left.slice(-digits) === right.slice(-digits) || left.slice(-8) === right.slice(-8);
}

export function matchContactChats(
  rooms: MatrixRoom[],
  contacts: ContactLookupResult["matches"],
): MatrixRoom[] {
  const names = new Set(
    contacts.flatMap((contact) => [contact.name, ...contact.aliases]).map(normalizedIdentity),
  );
  const phones = new Set(
    contacts.flatMap((contact) => contact.phones).map(normalizedPhone).filter(Boolean),
  );
  return rooms.filter((room) => {
    const roomPhone = normalizedPhone(room.name);
    return names.has(normalizedIdentity(room.name)) ||
      [...phones].some((phone) => samePhone(roomPhone, phone));
  });
}

/** Display-relevant bridge identity used to decide whether open Hub views need
 * a push. The aggregate state alone is insufficient: replacing one connected
 * account with another is still `connected -> connected`. */
export function bridgeStatusFingerprint(bridge: CommsBridgeDto): string {
  return JSON.stringify({
    state: bridge.state,
    error: bridge.error,
    permission: bridge.permission,
    installUrl: bridge.installUrl,
    managementRoomHint: bridge.managementRoomHint,
    accounts: bridge.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      avatarUrl: account.avatarUrl,
      state: account.state,
      error: account.error,
    })),
  });
}

export function messageCoverageFromBridges(
  bridges: ReadonlyArray<Pick<CommsBridgeDto, "platform" | "state">>,
): Array<{platform: string; state: string; live: boolean}> {
  const states = new Map(bridges.map((bridge) => [bridge.platform, bridge.state]));
  return COMMS_PLATFORMS.filter((entry) => entry.value !== "matrix").map((entry) => {
    const state = states.get(entry.value) ?? "unknown";
    return {platform: entry.value, state, live: state === "connected"};
  });
}

export interface StoredContactAlias {
  alias: string;
  roomId: string;
  name: string;
  platform: string;
}

function storedContactAliases(value: unknown): StoredContactAlias[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 256).filter((entry): entry is StoredContactAlias => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    return [item.alias, item.roomId, item.name, item.platform].every((field) => typeof field === "string");
  });
}

export async function resolveChatAliasFromRooms(
  rooms: MatrixRoom[],
  alias: string,
  lookup?: (alias: string) => Promise<ContactLookupResult>,
  remembered: StoredContactAlias[] = [],
): Promise<{status: string; identities: ContactLookupResult["matches"]; chats: MatrixRoom[]}> {
  rooms = rooms.filter((room) => !room.space);
  const stored = remembered.filter((entry) => normalizedIdentity(entry.alias) === normalizedIdentity(alias));
  const rememberedRooms = rooms.filter((room) => stored.some((entry) =>
    room.roomId === entry.roomId ||
    (room.platform === entry.platform && normalizedIdentity(room.name) === normalizedIdentity(entry.name)),
  ));
  if (rememberedRooms.length) return {status: "remembered", identities: [], chats: rememberedRooms};
  const exact = rooms.filter((room) => normalizedIdentity(room.name) === normalizedIdentity(alias));
  if (exact.length) return {status: "direct", identities: [], chats: exact};
  if (!lookup) return {status: "unavailable", identities: [], chats: []};
  const contacts = await lookup(alias);
  return {status: contacts.status, identities: contacts.matches, chats: matchContactChats(rooms, contacts.matches)};
}

export interface CookieLoginRequest {
  platform: CommsPlatform;
  url: string;
  waitForUrl: string | null;
  userAgent: string | null;
  /** Cookie and storage keys the bridge needs harvested. */
  fields: Array<{source: string; id: string; required: boolean}>;
}

/**
 * Opens the network's own sign-in page and returns the session values the
 * bridge asked for. Supplied by the Electron layer; absent in tests.
 */
export type CookieLoginDriver = (
  request: CookieLoginRequest,
) => Promise<Record<string, string>>;

export interface PreferenceStore {
  getPreference(key: string): {value: unknown} | undefined;
  setPreference(key: string, value: JsonValue): void;
}

export interface EmbeddedHub {
  baseUrl: string;
  directory: string;
  /** Mints a local account directly — no admin API, both sides are in-process. */
  provision: (localpart: string) => {userId: string; accessToken: string};
  /**
   * Which bridge binaries are on disk, and which of them the host is holding
   * back. A platform that was never installed, one waiting on a credential and
   * one that is simply not answering are three different things, and only the
   * host knows which is which.
   */
  inventory?: () => Promise<
    {
      platform: string;
      binary: string;
      supported?: boolean;
      installed: boolean;
      blocked?: {reason: string; permission?: SystemPermissionKind} | null;
      running?: boolean;
    }[]
  >;
  /**
   * Brings one bridge up on demand. Bridges with nothing linked to them are
   * not started at launch, so opening a platform is what asks for it.
   */
  ensure?: (platform: string) => Promise<void>;
  /**
   * Re-checks bridges held back by something the user may have since fixed,
   * and starts whichever are now clear. Called when the tab is explicitly
   * asked to look again, which is also when a grant has just been given.
   */
  retryBlocked?: () => Promise<void>;
  /**
   * Starts the in-process WeChat bridge against Polymux's own account. Unlike
   * the rest of the fleet there is no binary to supervise, and the account has
   * to exist first, so it is started here rather than with the hub.
   */
  startWeChat?: (owner: string) => Promise<boolean>;
  loadOlderWeChatHistory?: (roomId: string, limit: number, oldestCachedAt?: number) => Promise<boolean>;
  refreshWeChatMedia?: (roomId: string, eventIds: string[]) => Promise<boolean>;
  /** True only when WeChat's persistent relay can send without a cold timeout. */
  weChatOutboundReady?: () => Promise<boolean>;
    weChatOutboundFailure?: () => string | null;
    weChatNativeOnly?: boolean;
  /** Fails closed before a live-test action can wake or enqueue the wrong chat. */
  assertWeChatLiveTestDestination?: (roomId: string) => void;
  /** Passive sender state; must never relaunch or interact with WeChat. */
  weChatOutboundStatus?: () => Promise<boolean>;
  /** Local keyed conversations remain readable when the sender is unavailable. */
  weChatNativeReadable?: () => boolean;
  /** Account-native stickers already observed by the WeChat bridge. */
  weChatStickers?: () => Promise<WeChatStickerCatalogEntry[]>;
  weChatMembers?: (roomId: string) => Promise<ChatMemberDto[] | null>;
  weChatGroupInfo?: (roomId: string) => Promise<ChatGroupInfoDto>;
  renameWeChatGroup?: (roomId: string, name: string, expectedName: string) => Promise<ChatGroupInfoDto>;
  /** Read-only desktop sign-in state after an explicit WeChat wake attempt. */
  weChatSessionState?: () => Promise<WeChatSessionState | null>;
  weChatLogin?: () => Promise<WeChatLoginDto>;
  /**
   * Takes the WeChat bridge back down. Unlinking cannot sign anything out —
   * the account belongs to WeChat.app — so what it does is stop carrying that
   * app's messages into the hub.
   */
  stopWeChat?: () => Promise<void>;
  /** Resolves only after the native bridge verifies this Matrix event. */
  waitForWeChatOutbound?: (eventId: string) => Promise<void>;
  /** Removes a local event whose remote delivery failed. */
  discardOutbound?: (eventId: string) => void;
  outboundDeliveryStatus?: (eventId: string) => "unconfirmed" | null;
  /** Recalls a verified WeChat send before redacting it locally. */
  recallWeChat?: (roomId: string, eventId: string) => Promise<void>;
  markWeChatRead?: (roomId: string, eventId: string) => Promise<void>;
  /** Values already recorded for a bridge's own configuration. */
  networkConfig?: (platform: string) => Promise<Record<string, string>>;
  /**
   * Records a bridge's configuration and restarts it so the values take
   * effect. Telegram's api_id/api_hash arrive this way.
   */
  configureNetwork?: (platform: string, values: Record<string, string>) => Promise<void>;
}

/**
 * OAuth client registrations for mail sign-in, read from the environment the
 * same way the drive providers' are. A dedicated mail registration wins, but
 * the provider's drive registration is a valid default too: users should not
 * lose one-click mailbox sign-in just because the build did not duplicate the
 * same client id under a second name.
 *
 * The shared registration still needs both loopback redirect URIs and the mail
 * scopes enabled in the provider console. Those are registration concerns;
 * asking for mail access remains a separate consent flow from Drive.
 */
export function mailOAuthClients(): Partial<
  Record<MailOAuthProvider, {clientId: string; clientSecret?: string}>
> {
  const clients: Partial<Record<MailOAuthProvider, {clientId: string; clientSecret?: string}>> = {};
  for (const [provider, mailPrefix, sharedPrefix] of [
    ["google", "POLYMUX_GOOGLE_MAIL", "POLYMUX_GOOGLE_DRIVE"],
    ["microsoft", "POLYMUX_MICROSOFT_MAIL", "POLYMUX_ONEDRIVE"],
  ] as const) {
    const dedicatedClientId = process.env[`${mailPrefix}_CLIENT_ID`]?.trim();
    const clientId = dedicatedClientId || process.env[`${sharedPrefix}_CLIENT_ID`]?.trim();
    if (!clientId) continue;
    // A dedicated Mail registration uses only its own secret, if any.
    // Sharing Drive is provider-specific: Google confidential clients require
    // the Drive secret on the token request, or Google replies
    // "client_secret is missing". Microsoft public clients reject a code
    // redeemed as confidential, so their Drive secret must not be sent.
    const secretPrefix = dedicatedClientId
      ? mailPrefix
      : provider === "google"
        ? sharedPrefix
        : undefined;
    const clientSecret = secretPrefix
      ? process.env[`${secretPrefix}_CLIENT_SECRET`]?.trim()
      : undefined;
    clients[provider] = {clientId, ...(clientSecret ? {clientSecret} : {})};
  }
  return clients;
}

export interface CommunicationsOptions {
  credentials: CredentialStore;
  storage: PreferenceStore;
  onChange: (status: CommsStatusDto) => void;
  /** A Matrix room changed and any open Hub surface should refresh it. */
  onActivity?: (activity: {roomId: string; sender: string}) => void;
  /** The in-process homeserver, used when no external hub is configured. */
  embedded?: EmbeddedHub;
  cookieLogin?: CookieLoginDriver;
  /** Closes any open cookie sign-in window for a platform. */
  cancelCookieLogin?: (platform: CommsPlatform) => void;
  /** Overridable for tests. */
  home?: string;
  /** Host operating system. Overridable for cross-platform tests. */
  platform?: NodeJS.Platform;
  run?: CommandRunner;
  fetch?: typeof globalThis.fetch;
  /** Polymux's own account file; defaults to one under its home. */
  emailStorePath?: string;
  /** Opens a provider's sign-in page; absent where no window can be shown. */
  mailConsent?: MailConsentPrompt;
  /** Overridable mailbox service for deterministic host tests. */
  email?: EmailAccounts;
  /** Read-only non-activating coverage for accounts owned by Apple Mail. */
  appleMailSearch?: (options: {
    queries: string[];
    maxResults: number;
    timeoutMs: number;
  }) => Promise<AppleMailSearchResult>;
  /** Bounded native contact lookup used only after an exact chat-name miss. */
  contactLookup?: (alias: string) => Promise<ContactLookupResult>;
}

interface HubPreference {
  baseUrl?: string;
  homeserverUrl?: string;
  directory?: string;
}

/**
 * Owns every messaging and email account the agent can reach: the local Matrix
 * hub and its bridge fleet, plus the user's mailboxes.
 *
 * Linking happens here rather than in a bridge's management room, so a QR scan
 * or cookie sign-in is a step this service drives and the settings UI renders.
 */
function settleWithin<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function normalizedContactIdentifier(value: string): string {
  const trimmed = value.trim().normalize("NFKC").toLowerCase();
  if (trimmed.startsWith("tel:")) return `tel:${normalizedPhone(trimmed)}`;
  return trimmed.replace(/\s+/g, "");
}

function contactMergeKeys(contact: CommsContactDto): string[] {
  const scope = contact.platform;
  const keys = new Set<string>();
  for (const account of contact.accounts) {
    if (account.chatId) keys.add(`${scope}:chat:${account.chatId}`);
    if (account.remoteId)
      keys.add(`${scope}:remote:${account.remoteId.trim().normalize("NFKC").toLowerCase()}`);
  }
  for (const identifier of contact.identifiers) {
    const normalized = normalizedContactIdentifier(identifier);
    if (normalized) keys.add(`${scope}:identifier:${normalized}`);
  }
  // An imported room with no remote identity must remain distinct. A matching
  // room id, remote id or platform identifier may merge it later; a shared
  // display name alone is never enough evidence that two people are one.
  if (keys.size === 0) keys.add(`${scope}:row:${contact.id}`);
  return [...keys];
}

function mergeContactRows(left: CommsContactDto, right: CommsContactDto): CommsContactDto {
  const accounts = new Map<string, CommsContactDto["accounts"][number]>();
  for (const account of [...left.accounts, ...right.accounts]) {
    const previous = accounts.get(account.accountId);
    accounts.set(account.accountId, previous
      ? {
          accountId: previous.accountId,
          accountName: previous.accountName || account.accountName,
          remoteId: previous.remoteId ?? account.remoteId,
          chatId: previous.chatId ?? account.chatId,
        }
      : account);
  }
  const routes = [...accounts.values()].sort((left, right) =>
    left.accountName.localeCompare(right.accountName) || left.accountId.localeCompare(right.accountId));
  const primary = routes.find((route) => route.accountId === left.accountId) ?? routes[0]!;
  return {
    ...left,
    remoteId: primary.remoteId,
    accountId: primary.accountId,
    accountName: primary.accountName,
    avatarUrl: left.avatarUrl ?? right.avatarUrl,
    identifiers: [...new Set([...left.identifiers, ...right.identifiers])],
    chatId: primary.chatId,
    accounts: routes,
  };
}

/** Collapses one person imported through several linked accounts into one
 * picker row while retaining each account-specific remote id and DM room. */
export function dedupeCommsContacts(contacts: CommsContactDto[]): CommsContactDto[] {
  const visibleContacts = contacts.map((contact) => ({
    ...contact,
    name: bridgeDisplayName(contact.name, contact.platform),
  }));
  const parent = visibleContacts.map((_, index) => index);
  const root = (index: number): number => {
    let current = index;
    while (parent[current] !== current) current = parent[current]!;
    while (parent[index] !== index) {
      const next = parent[index]!;
      parent[index] = current;
      index = next;
    }
    return current;
  };
  const merge = (left: number, right: number): void => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const seen = new Map<string, number>();
  visibleContacts.forEach((contact, index) => {
    for (const key of contactMergeKeys(contact)) {
      const previous = seen.get(key);
      if (previous !== undefined) merge(previous, index);
      else seen.set(key, index);
    }
  });
  const rows = new Map<number, CommsContactDto>();
  visibleContacts.forEach((contact, index) => {
    const key = root(index);
    const previous = rows.get(key);
    rows.set(key, previous ? mergeContactRows(previous, contact) : contact);
  });
  return [...rows.values()];
}

export class Communications {
  readonly #credentials: CredentialStore;
  readonly #storage: PreferenceStore;
  readonly #onChange: (status: CommsStatusDto) => void;
  readonly #onActivity?: CommunicationsOptions["onActivity"];
  readonly #cookieLogin?: CookieLoginDriver;
  readonly #cancelCookieLogin?: (platform: CommsPlatform) => void;
  readonly #email: EmailAccounts;
  readonly #appleMailSearch?: CommunicationsOptions["appleMailSearch"];
  readonly #contactLookup?: CommunicationsOptions["contactLookup"];
  readonly #run: CommandRunner;
  readonly #fetch?: typeof globalThis.fetch;
  readonly #home: string;
  readonly #hostPlatform: NodeJS.Platform;
  readonly #embedded: EmbeddedHub | null;
  #embeddedMode: boolean;
  #hub: MatrixHub;
  #baseUrl: string;
  #homeserverUrl: string;
  #directory: string | null;
  #matrixToken: string | null = null;
  #userId: string | null = null;
  #loaded = false;
  /** One credential/provisioning read for every concurrent startup caller. */
  #loadTask: Promise<void> | null = null;
  #syncController: AbortController | null = null;
  #syncTask: Promise<void> | null = null;
  #syncGeneration = 0;
  /** Connection-test outcomes, which are too slow to redo on every status read. */
  readonly #emailStatus = new Map<string, {status: "ok" | "error"; error: string | null}>();
  /** Most recent complete fleet snapshot. An explicit WeChat send wake can
   * return this immediately once its sender is ready, while a fresh status
   * pass catches the settings surface up in the background. */
  #lastStatus: CommsStatusDto | null = null;
  /**
   * What each bridge was last seen as, so a state that changed without anyone
   * asking for it can be pushed. Every other publish follows an action the
   * user took here; a bridge that comes up on its own — the WeChat relay is
   * started by the status read itself — has no such moment, and a window
   * already open would otherwise keep the list it happened to load with.
   */
  readonly #bridgeFingerprints = new Map<string, string>();
  /**
   * Cookie steps handed to the UI, keyed `<platform>:<stepId>`. The sign-in
   * window needs the exact url and field list the bridge asked for, and the
   * renderer is not trusted to hand those back.
   */
  readonly #cookieSteps = new Map<
    string,
    {
      url: string;
      waitForUrl: string | null;
      userAgent: string | null;
      fields: Array<{source: string; id: string; required: boolean}>;
    }
  >();

  constructor(options: CommunicationsOptions) {
    this.#credentials = options.credentials;
    this.#storage = options.storage;
    this.#onChange = options.onChange;
    this.#onActivity = options.onActivity;
    this.#cookieLogin = options.cookieLogin;
    this.#cancelCookieLogin = options.cancelCookieLogin;
    this.#home = options.home ?? homedir();
    this.#hostPlatform = options.platform ?? process.platform;
    this.#run = options.run ?? runCommand;
    this.#fetch = options.fetch;
    const preference = hubPreference(this.#storage.getPreference("comms-hub")?.value);
    this.#embedded = options.embedded ?? null;
    // Embedded is the default, full stop. Only an explicitly configured
    // address (Settings -> Hub -> Change) selects an external deployment.
    this.#embeddedMode = !!this.#embedded && !preference.baseUrl;
    if (this.#embeddedMode && this.#embedded) {
      this.#baseUrl = this.#embedded.baseUrl;
      this.#homeserverUrl = this.#embedded.baseUrl;
      this.#directory = this.#embedded.directory;
    } else {
      this.#baseUrl = preference.baseUrl ?? DEFAULT_HUB_URL;
      this.#homeserverUrl = preference.homeserverUrl ?? DEFAULT_HOMESERVER_URL;
      this.#directory = preference.directory ?? defaultHubDirectory(this.#home);
    }
    this.#email = options.email ?? new EmailAccounts({
      // Through `polymuxHome`, never a literal join: a side instance keys its
      // own `.polymux-<name>`, and joining the name here would have an
      // isolated run reading and writing the user's real mailboxes.
      storePath:
        options.emailStorePath ??
        path.join(polymuxHome(this.#home), "state", "email-accounts.json"),
      downloadsDir: path.join(this.#home, "Downloads"),
      run: this.#run,
      ...(options.mailConsent ? {consent: options.mailConsent} : {}),
      oauthClients: mailOAuthClients(),
    });
    this.#appleMailSearch = options.appleMailSearch;
    this.#contactLookup = options.contactLookup;
    this.#hub = this.#createHub();
  }

  /**
   * Last observed bridge availability for agent message tools. This is kept
   * deliberately probe-free: searches may read rooms cached by Matrix after a
   * bridge is unlinked, so every result needs the current coverage snapshot
   * without turning each agent call into another fleet-wide status check.
   */
  messageCoverage(): Array<{platform: string; state: string; live: boolean}> {
    return messageCoverageFromBridges(this.#lastStatus?.bridges ?? []);
  }

  /**
   * A deliberate second look, as opposed to the status the tab reads on its
   * own schedule. Anything the user could have changed outside Polymux — a grant
   * given in System Settings, a bridge binary dropped in — is re-checked here,
   * so "look again" actually acts rather than re-reading what was cached.
   */
  async refresh(): Promise<CommsStatusDto> {
    await this.#embedded?.retryBlocked?.().catch((): undefined => undefined);
    return this.status();
  }

  /**
   * Starts a dormant bridge because its platform has been opened, and answers
   * with the status once it is up — the login methods on offer are the
   * bridge's own, so there is nothing to show until it is running.
   *
   * The UI fires this on hover as well as on click, so it has to be cheap and
   * repeatable: a bridge already running makes it a plain status read.
   */
  #weChatLoginRequest: Promise<WeChatLoginDto> | null = null;
  #weChatObservation: string | null = null;
  #weChatPoll: Promise<void> | null = null;

  /** Background observer, independent of whether Hub is mounted. Never
   * prepares a sender, launches Desktop or changes its login controls. */
  async pollWeChat(): Promise<void> {
    if (this.#backgroundClosed) return;
    if (this.#weChatPoll) return this.#weChatPoll;
    const poll = (async () => {
      await this.#load();
      if (this.#backgroundClosed || !this.#userId || !this.#weChatLinked() || !this.#embedded?.weChatSessionState) return;
      const owner = this.#userId;
      const state = await this.#embedded.weChatSessionState();
      if (this.#backgroundClosed || owner !== this.#userId || !this.#weChatLinked()) return;
      const observed = JSON.stringify([owner, state, this.#embedded.weChatNativeReadable?.() ?? false]);
      if (observed === this.#weChatObservation) return;
      await this.status();
      if (!this.#backgroundClosed && owner === this.#userId && this.#weChatLinked()) this.#weChatObservation = observed;
    })();
    this.#weChatPoll = poll;
    try { await poll; }
    finally { if (this.#weChatPoll === poll) this.#weChatPoll = null; }
  }

  async weChatLogin(): Promise<WeChatLoginDto> {
    await this.#load();
    if (!this.#userId || !this.#weChatLinked() || !this.#embedded?.weChatLogin)
      return unavailableWeChatLogin();
    if (this.#weChatLoginRequest) return this.#weChatLoginRequest;
    const owner = this.#userId;
    const request = this.#embedded.weChatLogin().catch(unavailableWeChatLogin).then(result =>
      owner === this.#userId && this.#weChatLinked() ? result : unavailableWeChatLogin());
    this.#weChatLoginRequest = request;
    try {
      return await request;
    }
    finally { if (this.#weChatLoginRequest === request) this.#weChatLoginRequest = null; }
  }

  async wake(platform: CommsPlatform): Promise<CommsWakeDto> {
    await this.#embedded?.ensure?.(platform).catch((): undefined => undefined);
    let ready: boolean | null = null;
    if (platform === "wechat" && this.#userId) {
      // A complete status snapshot has already registered the in-process
      // appservice. Repeating that full relay probe before every composer
      // action is unnecessary; the background refresh below still performs
      // it so inbound sync can recover independently after a send.
      if (!this.#lastStatus)
        await this.#embedded?.startWeChat?.(this.#userId).catch(() => false);
      ready = await this.#embedded?.weChatOutboundReady?.().catch(() => false) ?? false;
    }
    const refreshedStatus = this.status();
    // The composer needs the sender answer, not another fleet-wide status
    // round trip. WeChat Desktop also paints its local bubble before remote
    // delivery verification; returning the last complete snapshot here lets
    // Polymux do the same without weakening the native exactly-once check.
    if (platform === "wechat" && ready === true && this.#lastStatus) {
      void refreshedStatus.catch((): undefined => undefined);
      return {
        platform,
        ready: true,
        status: {
          ...this.#lastStatus,
          bridges: this.#lastStatus.bridges.map((bridge) =>
            bridge.platform === "wechat"
              ? {...bridge, state: "connected", error: null, attention: null}
              : bridge,
          ),
        },
      };
    }
    const currentStatus = await refreshedStatus;
    return {
      platform,
      ready:
        ready ??
        currentStatus.bridges.some(
          (bridge) => bridge.platform === platform && bridge.state === "connected",
        ),
      status: platform === "wechat" && ready === false && this.#embedded?.weChatOutboundFailure?.()
        ? {...currentStatus, bridges: currentStatus.bridges.map(bridge => bridge.platform === "wechat"
          ? {...bridge, error: this.#embedded!.weChatOutboundFailure!()} : bridge)} : currentStatus,
    };
  }

  async status(): Promise<CommsStatusDto> {
    await this.#load();
    const probe = await this.#hub.probe();
    // Which binaries exist decides whether "not answering" means broken or
    // simply never installed. It also carries the host support boundary, so a
    // Windows install never offers a bridge whose dependencies cannot run
    // there and then blames the user for being unable to install it.
    const inventory = this.#embeddedMode
      ? await this.#embedded?.inventory
        ?.()
        .catch((): NonNullable<Awaited<ReturnType<NonNullable<EmbeddedHub["inventory"]>>>> => [])
      : undefined;
    const installed = new Map((inventory ?? []).map((entry) => [entry.platform, entry] as const));
    const platforms = COMMS_PLATFORMS.filter((entry) =>
      entry.value !== "matrix" &&
      (entry.value !== "wechat" || this.#hostPlatform === "darwin") &&
      installed.get(entry.value)?.supported !== false);
    /**
     * What a bridge still needs before it can run. Read from the config the
     * host actually wrote, so a value recorded on a previous launch counts and
     * the user is not asked for it twice.
     */
    const setupOf = async (
      entry: (typeof platforms)[number],
    ): Promise<CommsBridgeSetupDto | null> => {
      if (!entry.setup?.length) return null;
      const recorded =
        (await this.#embedded?.networkConfig
          ?.(entry.value)
          .catch((): Record<string, string> => ({}))) ?? {};
      // A pair Polymux ships counts as answered, and counts before the bridge
      // has started once: the config that will carry it is not written until
      // the first start, and until then the panel would ask for a credential
      // the user is never going to have to give.
      const shipped = shippedNetworkConfig(entry.value);
      return {
        fields: entry.setup,
        configured: entry.setup.every((field) => Boolean(recorded[field.id] ?? shipped[field.id])),
      };
    };
    /**
     * A bridge that will not be answering, with the reason it will not. Both
     * cases would otherwise read as "not answering yet, maybe it is still
     * starting" — which is what the tab says while the user waits for a bridge
     * that is deliberately parked and never coming up.
     */
    const missing = (entry: (typeof platforms)[number]): CommsBridgeDto | null => {
      const known = installed.get(entry.value);
      if (!known) return null;
      if (known.installed && !known.blocked) {
        // Installed, fine, and simply not running yet. Probing it would report
        // a silence that means nothing — it has not been asked for.
        if (known.running === false)
          return {
            platform: entry.value,
            name: entry.label,
            api: "bridgev2",
            state: "dormant",
            accounts: [],
            flows: [],
            setup: null,
            managementRoomHint: null,
            error: null,
          };
        return null;
      }
      return {
        platform: entry.value,
        name: entry.label,
        api: "bridgev2",
        state: "unavailable",
        accounts: [],
        flows: [],
        setup: null,
        managementRoomHint: null,
        error: known.installed
          ? known.blocked!.reason
          : `The ${entry.label} bridge is not installed.`,
        // Carried through so the tab can offer the grant as a button. A binary
        // that was never installed has no grant to offer.
        permission: known.installed ? (known.blocked!.permission ?? null) : null,
      };
    };
    /**
     * WeChat has no bridge to provision: it arrives through a relay against
     * the WeChat app on this Mac. There is nothing to log in to, so the row is
     * built from whether that relay is up and whose account it carries —
     * otherwise the tab reports "unavailable" over a platform that is working.
     */
    const relayRow = async (entry: (typeof platforms)[number]): Promise<CommsBridgeDto> => {
      // Unlinked is a choice the user made here, and it has to survive a
      // status read — which is the very thing that would otherwise start the
      // relay again a second later.
      if (!this.#weChatLinked())
        return {
          platform: entry.value,
          name: entry.label,
          api: "none",
          state: "logged-out",
          accounts: [],
          flows: [WECHAT_FLOW],
          setup: null,
          managementRoomHint: null,
          error: null,
        };
      // Require both a readable source and registration in this Hub. A
      // healthy relay configured for another homeserver is not enough; a
      // verified native directory can supply reads independently of the relay.
      // Bringing it up is part of reading its status: the bridge is in-process
      // and idempotent, so the first status read after sign-in is what starts
      // it. Nothing else would.
      if (this.#userId) await this.#embedded?.startWeChat?.(this.#userId).catch(() => false);
      const outboundProbe =
        this.#embedded?.weChatOutboundStatus ??
        this.#embedded?.weChatOutboundReady;
      const [relay, delivers, outboundReady, desktopSession] = await Promise.all([
        probeWeChatRelay(this.#embedded?.weChatNativeOnly),
        this.#hub.hasBridgeBot(`${entry.value}bot`),
        outboundProbe
          ? outboundProbe().catch(() => false)
          : Promise.resolve(true),
        this.#embedded?.weChatSessionState?.().catch((): null => null) ?? Promise.resolve(null),
      ]);
      const onDemand = outboundReady && relay.installUrl === null;
      const nativeReadable = this.#embedded?.weChatNativeReadable?.() ?? false;
      const usable = delivers && (relay.running || nativeReadable || onDemand);
      // Connection status governs conversation navigation. A failed sender
      // must not hide readable rooms; every outbound action has its own gate.
      const ready = usable;
      return {
        platform: entry.value,
        name: entry.label,
        api: "none",
        state: ready ? "connected" : usable ? "connecting" : "unavailable",
        accounts:
          usable && relay.account
            ? [{
                id: relay.account.id,
                name: relay.account.name,
                state: ready ? "connected" : "connecting",
                error: null,
              }]
            : [],
        flows: [],
        setup: null,
        managementRoomHint: null,
        // Recovery stays quiet. Confirmed sign-in/lock requirements use a
        // separate attention state so readable conversations remain available.
        error: relay.installUrl ? relay.error : null,
        installUrl: relay.installUrl,
        attention: weChatAttention(desktopSession, relay.installUrl, relay.running || nativeReadable),
      };
    };
    // One slow bridge should not serialize behind the others.
    const rows = probe.reachable
      ? await Promise.all(
          platforms.map(async (entry) => {
            if (entry.value === "wechat") return relayRow(entry);
            return missing(entry) ?? (await this.#hub.bridge(entry.value, entry.label, entry.route));
          }),
        )
      : platforms.map(
          (entry): CommsBridgeDto =>
            missing(entry) ?? {
              platform: entry.value,
              name: entry.label,
              api: entry.route ? "bridgev2" : "none",
              state: "unreachable",
              accounts: [],
              flows: [],
              setup: null,
              managementRoomHint: null,
              error: null,
            },
        );
    // Setup requirements are the catalogue's, not the bridge's, so they are
    // attached after the probe and survive a bridge that never answered.
    const bridges = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        setup: row.setup ?? (await setupOf(platforms.find((entry) => entry.value === row.platform)!)),
      })),
    );
    const result: CommsStatusDto = {
      hub: {
        baseUrl: this.#baseUrl,
        homeserverUrl: this.#homeserverUrl,
        canAutoConnect:
          probe.reachable &&
          !this.#matrixToken &&
          (this.#embeddedMode || (await this.#hub.canProvision())),
        directory: this.#directory,
        status: !probe.reachable
          ? this.#directory
            ? "unreachable"
            : "unconfigured"
          : this.#matrixToken
            ? "signed-in"
            : "reachable",
        userId: this.#userId,
        homeserverName: probe.homeserverName,
        error: probe.error,
      },
      bridges,
      email: {
        signInProviders: this.emailSignInProviders(),
        accounts: (await this.#email.list()).map((account) => {
          const tested = this.#emailStatus.get(account.id);
          return tested ? {...account, ...tested} : account;
        }),
      },
    };
    this.#lastStatus = result;
    // Read last, and only told about a change: a status read is not itself
    // news, and re-sending an unchanged fleet on every poll would repaint
    // every open window for nothing.
    const moved = bridges.some((bridge) =>
      this.#bridgeFingerprints.get(bridge.platform) !== bridgeStatusFingerprint(bridge));
    for (const bridge of bridges)
      this.#bridgeFingerprints.set(bridge.platform, bridgeStatusFingerprint(bridge));
    if (moved) this.#onChange(result);
    return result;
  }

  async setHubUrl(baseUrl: string): Promise<CommsStatusDto> {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(trimmed))
      throw new Error("The hub address must start with http:// or https://");
    // Naming an address is choosing an external hub — and the health probe
    // must follow it, not keep watching the embedded server.
    this.#stopSync();
    this.#embeddedMode = false;
    this.#baseUrl = trimmed;
    const stored = hubPreference(this.#storage.getPreference("comms-hub")?.value);
    // The settings surface accepts one hub address, so changing it changes
    // both halves of the deployment. Reusing the previously persisted
    // homeserver URL would leave provisioning, login and media pointed at the
    // old hub after the proxy had moved to the new one.
    this.#homeserverUrl = trimmed;
    this.#directory = stored.directory ?? defaultHubDirectory(this.#home);
    this.#persistHub();
    this.#hub = this.#createHub();
    this.#ensureSync();
    return this.#publish();
  }

  /**
   * Sets messaging up without asking the user for anything.
   *
   * Polymux registers a dedicated account on the local hub with a generated
   * password it never displays, then keeps only the access token. This is the
   * intended path: the hub is an implementation detail of "messaging works",
   * not something the user should have to hold credentials for. The password is
   * kept alongside the token so a revoked session can be re-established without
   * abandoning the bridges linked to this account.
   */
  async connect(): Promise<CommsStatusDto> {
    await this.#load();
    if (this.#matrixToken) return this.status();
    // A random localpart keeps repeat setups on one machine from colliding.
    const username = `polymux-${randomBytes(4).toString("hex")}`;
    if (this.#embeddedMode && this.#embedded) {
      const minted = this.#embedded.provision(username);
      await this.#store(minted.userId, minted.accessToken, null);
      return this.#publish();
    }
    const password = randomBytes(32).toString("base64url");
    const result = await this.#hub.provision(username, password);
    await this.#store(result.userId, result.accessToken, password);
    return this.#publish();
  }

  async signIn(userId: string, password: string): Promise<CommsStatusDto> {
    const result = await this.#hub.signIn(userId, password);
    // A password the user typed is theirs, not ours to keep.
    await this.#store(result.userId, result.accessToken, null);
    return this.#publish();
  }

  async #store(userId: string, accessToken: string, password: string | null): Promise<void> {
    // A replacement credential starts from a fresh sync position. Abort the
    // old request first so it cannot publish a late delta under the new user.
    this.#stopSync();
    this.#matrixToken = accessToken;
    this.#userId = userId;
    await this.#credentials.modify(HUB_CREDENTIAL_ID, async () => ({
      type: "api_key",
      key: accessToken,
      env: {
        MATRIX_USER_ID: userId,
        // Only ever a password Polymux generated itself.
        ...(password ? {MATRIX_PROVISIONED_PASSWORD: password} : {}),
      },
    }));
    this.#ensureSync();
  }

  async signOut(): Promise<CommsStatusDto> {
    this.#stopSync();
    await this.#hub.signOut();
    this.#matrixToken = null;
    this.#userId = null;
    await this.#credentials.delete(HUB_CREDENTIAL_ID);
    return this.#publish();
  }

  async loginStart(platform: CommsPlatform, flowId: string): Promise<CommsLoginStepDto> {
    if (platform === "wechat") {
      // Nothing to ask for and nobody to ask: the relay signs in as whoever
      // WeChat.app is. Linking is recording the choice and bringing it up.
      this.#setWeChatLinked(true);
      await this.#load();
      if (this.#userId) await this.#embedded?.startWeChat?.(this.#userId).catch(() => false);
      return {type: "complete", loginId: "wechat", accountId: null, accountName: null};
    }
    const {route} = await this.#target(platform);
    const step = await this.#hub.loginStart(route, flowId);
    return this.#remember(platform, step);
  }

  async loginSubmit(
    platform: CommsPlatform,
    loginId: string,
    stepId: string,
    values: Record<string, string>,
  ): Promise<CommsLoginStepDto> {
    const {route} = await this.#target(platform);
    const step = await this.#hub.loginSubmit(route, loginId, stepId, "user_input", values);
    return this.#remember(platform, step);
  }

  async loginWait(
    platform: CommsPlatform,
    loginId: string,
    stepId: string,
  ): Promise<CommsLoginStepDto> {
    const {route} = await this.#target(platform);
    const step = await this.#hub.loginWait(route, loginId, stepId);
    return this.#remember(platform, step);
  }

  async loginCookies(
    platform: CommsPlatform,
    loginId: string,
    stepId: string,
  ): Promise<CommsLoginStepDto> {
    if (!this.#cookieLogin)
      throw new Error("Cookie sign-in is not available in this build.");
    const {route} = await this.#target(platform);
    const pending = this.#cookieSteps.get(`${platform}:${stepId}`);
    if (!pending)
      throw new Error("This sign-in step expired. Start the connection again.");
    const values = await this.#cookieLogin({
      platform,
      url: pending.url,
      waitForUrl: pending.waitForUrl,
      userAgent: pending.userAgent,
      fields: pending.fields,
    });
    const step = await this.#hub.loginSubmit(route, loginId, stepId, "cookies", values);
    if (step.type === "complete") this.#cookieSteps.delete(`${platform}:${stepId}`);
    return this.#remember(platform, step);
  }

  /**
   * Keeps a cookie step's parameters so `loginCookies` can open the right page
   * without trusting the renderer to echo them back.
   */
  #remember(platform: CommsPlatform, step: CommsLoginStepDto): CommsLoginStepDto {
    if (step.type === "cookies")
      this.#cookieSteps.set(`${platform}:${step.stepId}`, {
        url: step.url,
        waitForUrl: step.waitForUrl,
        userAgent: step.userAgent,
        fields: step.fields.map((field) => ({
          source: field.source,
          id: field.id,
          required: field.required,
        })),
      });
    return step;
  }

  async loginCancel(platform: CommsPlatform, loginId: string): Promise<CommsStatusDto> {
    // Cancelling is best-effort cleanup: if the bridge has already forgotten
    // the flow, the user still needs the dialog to close.
    this.#cancelCookieLogin?.(platform);
    const target = await this.#target(platform).catch((): null => null);
    if (target) await this.#hub.loginCancel(target.route, loginId);
    return this.#publish();
  }

  async bridgeLogout(platform: CommsPlatform, accountId: string): Promise<CommsStatusDto> {
    if (platform === "wechat") {
      // There is no session to end — the account is WeChat.app's. Unlinking
      // stops the relay carrying it into the hub, and is remembered so the
      // next status read does not quietly start it again.
      this.#setWeChatLinked(false);
      await this.#embedded?.stopWeChat?.().catch((): void => undefined);
      return this.#publish();
    }
    const {route} = await this.#target(platform);
    await this.#hub.logout(route, accountId);
    return this.#publish();
  }

  /**
   * Records the values a bridge needs before it can run — Telegram's
   * api_id/api_hash — and restarts it so they take effect. Only fields the
   * catalogue declares for that platform are accepted: the renderer must not
   * be able to write arbitrary keys into a bridge's configuration.
   */
  async bridgeSetup(
    platform: CommsPlatform,
    values: Record<string, string>,
  ): Promise<CommsStatusDto> {
    const entry = COMMS_PLATFORMS.find((item) => item.value === platform);
    if (!entry?.setup?.length)
      throw new Error(`${platform} has nothing to configure.`);
    if (!this.#embedded?.configureNetwork)
      throw new Error("Bridge configuration is only available on the embedded hub.");

    const accepted: Record<string, string> = {};
    for (const field of entry.setup) {
      const value = values[field.id];
      if (typeof value !== "string" || value.trim() === "")
        throw new Error(`${field.name} is required.`);
      accepted[field.id] = value.trim();
    }
    await this.#embedded.configureNetwork(platform, accepted);
    return this.#publish();
  }

  async emailSave(request: SaveEmailAccountRequest): Promise<CommsStatusDto> {
    await this.#email.save(request);
    this.#emailStatus.delete(request.id);
    if (request.originalId) this.#emailStatus.delete(request.originalId);
    return this.#publish();
  }

  async emailSignaturesSave(request: SaveMailSignaturesRequest): Promise<CommsStatusDto> {
    await this.#email.saveSignatures(request);
    return this.#publish();
  }

  async emailRemove(id: string): Promise<CommsStatusDto> {
    await this.#email.remove(id);
    this.#emailStatus.delete(id);
    return this.#publish();
  }

  async emailTest(id: string): Promise<CommsEmailAccountDto> {
    const account = await this.#email.test(id);
    this.#emailStatus.set(id, {status: account.status as "ok" | "error", error: account.error});
    void this.#publish().catch((): undefined => undefined);
    return account;
  }

  /** Mailbox list without the fleet-wide status probe around it. */
  async emailAccounts(): Promise<CommsEmailAccountDto[]> {
    return this.#email.list();
  }

  /** The signed-in Matrix id, so a caller can tell the user's own messages apart. */
  get userId(): string | null {
    return this.#userId;
  }

  /**
   * What the media protocol handler needs to fetch an attachment: bridged
   * media is behind the homeserver's authenticated endpoint, so the renderer
   * cannot load it directly and the main process fetches on its behalf.
   */
  get mediaAuth(): {homeserverUrl: string; token: string | null} {
    return {homeserverUrl: this.#homeserverUrl, token: this.#matrixToken};
  }

  async chats(): Promise<MatrixRoom[]> {
    return this.#readWithEmbeddedAuthRecovery(() => this.#hub.rooms());
  }

  /** One merged address book over every linked account. A bridge directory is
   * the complete source where it exists; already-open direct rooms fill the
   * gaps for local relays. */
  async contacts(): Promise<CommsContactDto[]> {
    const [rooms, status] = await Promise.all([this.chats(), this.status()]);
    const directRooms = rooms.filter((room) => !room.group && !room.space);
    const found: CommsContactDto[] = [];

    await Promise.all(status.bridges.flatMap((bridge) => {
      const route = COMMS_PLATFORMS.find((entry) => entry.value === bridge.platform)?.route;
      if (!route || bridge.api !== "bridgev2" || bridge.state !== "connected") return [];
      return bridge.accounts.map(async (account) => {
        const contacts = await this.#hub.contacts(route, account.id).catch((): MatrixContact[] => []);
        for (const contact of contacts) {
          const name = bridgeDisplayName(contact.name, bridge.platform);
          const candidates = directRooms.filter((room) =>
            room.platform === bridge.platform &&
            (!room.accountIds?.length || room.accountIds.includes(account.id)));
          const exact = candidates.find((room) =>
            room.roomId === contact.chatId || room.remoteId === contact.id);
          // Some WhatsApp identities move between a phone JID and a LID. When
          // the bridge has not attached the DM room to its directory result,
          // an otherwise unique name+avatar match reconnects that imported
          // room without treating a shared display name as identity evidence.
          const visual = exact ? [] : candidates.filter((room) =>
            Boolean(contact.avatarUrl) &&
            room.avatarUrl === contact.avatarUrl &&
            room.name.trim().normalize("NFKC").toLowerCase() ===
              name.trim().normalize("NFKC").toLowerCase());
          const existing = exact ?? (visual.length === 1 ? visual[0] : undefined);
          const key = `${bridge.platform}:${account.id}:${contact.id}`;
          const chatId = contact.chatId ?? existing?.roomId ?? null;
          found.push({
            id: key,
            remoteId: contact.id,
            name,
            platform: bridge.platform,
            accountId: account.id,
            accountName: account.name,
            avatarUrl: contact.avatarUrl ?? existing?.avatarUrl ?? null,
            identifiers: contact.identifiers,
            chatId,
            accounts: [{
              accountId: account.id,
              accountName: account.name,
              remoteId: contact.id,
              chatId,
            }],
          });
        }
      });
    }));

    for (const room of directRooms) {
      // A directory result already linked to this room is the same person.
      // Older rooms may not carry accountIds, so key comparison alone would
      // otherwise add a second synthetic-account row for them.
      if (found.some((contact) => contact.accounts.some((account) => account.chatId === room.roomId)))
        continue;
      const bridge = status.bridges.find((entry) => entry.platform === room.platform);
      const accounts = room.accountIds?.length
        ? room.accountIds
        : bridge?.accounts.length === 1
          ? [bridge.accounts[0]!.id]
          : [status.hub.userId ?? room.platform];
      for (const accountId of accounts) {
        const accountName = bridge?.accounts.find((account) => account.id === accountId)?.name ??
          COMMS_PLATFORMS.find((entry) => entry.value === room.platform)?.label ??
          accountId;
        const key = `${room.platform}:${accountId}:${room.remoteId ?? room.roomId}`;
        found.push({
          id: key,
          remoteId: room.remoteId ?? null,
          name: room.name,
          platform: room.platform as CommsPlatform,
          accountId,
          accountName,
          avatarUrl: room.avatarUrl,
          identifiers: [],
          chatId: room.roomId,
          accounts: [{
            accountId,
            accountName,
            remoteId: room.remoteId ?? null,
            chatId: room.roomId,
          }],
        });
      }
    }

    return dedupeCommsContacts(found).sort((left, right) =>
      left.name.localeCompare(right.name) ||
      left.platform.localeCompare(right.platform) ||
      left.accountName.localeCompare(right.accountName));
  }

  async createChat(request: CreateChatRequest): Promise<string> {
    const participantIds = [...new Set(request.participantIds.map((id) => id.trim()).filter(Boolean))];
    if (participantIds.length === 0) throw new Error("Choose at least one person.");
    const {route} = await this.#target(request.platform);
    await this.#load();
    return this.#hub.createChat(route, request.accountId, participantIds, request.name);
  }

  /** Resolves one exact Hub contact route to a DM, creating the remote room
   * only when that contact does not already have one. This is the contact-side
   * seam used by an agent draft; it never sends a message. */
  async chatForContact(
    contactId: string,
    accountId?: string,
  ): Promise<{id: string; name: string; platform: CommsPlatform}> {
    const contact = (await this.contacts()).find((candidate) => candidate.id === contactId);
    if (!contact) throw new Error("That Hub contact no longer exists. Read message_contacts again.");
    const routes = accountId
      ? contact.accounts.filter((account) => account.accountId === accountId)
      : contact.accounts;
    if (routes.length === 0)
      throw new Error(`That contact is not reachable through account "${accountId}".`);
    if (routes.length > 1)
      throw new Error("That contact has multiple account routes. Pass the exact account_id from message_contacts.");
    const route = routes[0]!;
    if (route.chatId) return {id: route.chatId, name: contact.name, platform: contact.platform};
    if (!route.remoteId)
      throw new Error("That contact route cannot start a new conversation yet.");
    const id = await this.createChat({
      platform: contact.platform,
      accountId: route.accountId,
      participantIds: [route.remoteId],
    });
    return {id, name: contact.name, platform: contact.platform};
  }

  async resolveChatAlias(alias: string): Promise<{
    status: string;
    identities: ContactLookupResult["matches"];
    chats: MatrixRoom[];
  }> {
    const rooms = await this.chats();
    const remembered = storedContactAliases(
      this.#storage.getPreference(CONTACT_ALIASES_PREFERENCE)?.value,
    );
    return resolveChatAliasFromRooms(rooms, alias, this.#contactLookup, remembered);
  }

  async linkChatAlias(alias: string, chatId: string): Promise<StoredContactAlias> {
    const room = (await this.chats()).find((candidate) => candidate.roomId === chatId && !candidate.space);
    if (!room) throw new Error("The selected conversation no longer exists.");
    const current = storedContactAliases(
      this.#storage.getPreference(CONTACT_ALIASES_PREFERENCE)?.value,
    ).filter((entry) => normalizedIdentity(entry.alias) !== normalizedIdentity(alias));
    const linked = {alias, roomId: room.roomId, name: room.name, platform: room.platform};
    this.#storage.setPreference(
      CONTACT_ALIASES_PREFERENCE,
      [...current, linked].map((entry) => ({
        alias: entry.alias,
        roomId: entry.roomId,
        name: entry.name,
        platform: entry.platform,
      })),
    );
    return linked;
  }

  async readChat(
    chatId: string,
    limit: number,
    before?: string,
  ): Promise<{nextBefore: string | null; messages: MatrixMessage[]}> {
    return this.#readWithEmbeddedAuthRecovery(async () => {
      let page = await this.#hub.messages(chatId, limit, before);
      const refresh = this.#embedded?.refreshWeChatMedia;
      if (refresh && await this.#hub.roomPlatform(chatId) === "wechat") {
        const candidates = page.messages.filter(item =>
          !item.mine || item.body === "[unknown]" || item.body === "[Sticker]" ||
          item.viewIn?.app === "WeChat" ||
          item.attachments.some(attachment => attachment.kind === "image" || !attachment.url));
        if (candidates.length && await refresh(chatId, candidates.map(item => item.eventId)).catch(() => false))
          page = await this.#hub.messages(chatId, limit, before);
      }
      const load = this.#embedded?.loadOlderWeChatHistory;
      if (!load || (await this.#hub.roomPlatform(chatId)) !== "wechat") return page;
      // A complete boundary second must be imported before issuing the next
      // local cursor. This also brings older native pages into local search.
      while (true) {
        const oldest = page.nextBefore && page.messages.length
          ? Math.min(...page.messages.map((message) => Date.parse(message.sentAt))) : undefined;
        let more: boolean;
        try {
          more = await load(chatId, limit + 1, oldest);
        } catch (error) {
          // Cached messages remain readable while the Desktop connection is
          // unavailable. An empty requested page must expose the failure.
          if (page.messages.length) return page;
          throw error;
        }
        page = await this.#hub.messages(chatId, limit, before);
        if (!more) break;
      }
      return page;
    });
  }

  /** True for both Polymux's Matrix account and any linked bridge identity
   * used to carry that account's imported outgoing history. */
  async senderIsMine(chatId: string, sender: string): Promise<boolean> {
    await this.#load();
    return this.#hub.senderIsMine(chatId, sender);
  }

  async searchChats(
    query: string,
    limit: number,
    chatIds?: string[],
  ): Promise<{nextBatch: string | null; messages: unknown[]}> {
    return this.#readWithEmbeddedAuthRecovery(() => this.#hub.search(query, limit, chatIds));
  }

  async unreadChats(limit: number, platform?: string): Promise<unknown[]> {
    return this.#readWithEmbeddedAuthRecovery(() => this.#hub.unread(limit, platform));
  }

  /**
   * A disposable embedded profile may retain its encrypted Matrix credential
   * after its equally disposable homeserver database was replaced. Recover
   * lazily on the first read: validating every startup would add a network
   * round trip to unrelated turns. External hubs are never rewritten, and
   * mutating calls are never replayed.
   */
  async #readWithEmbeddedAuthRecovery<T>(read: () => Promise<T>): Promise<T> {
    await this.#load();
    try {
      return await read();
    } catch (error) {
      if (!this.#embeddedMode || !this.#embedded || !isUnknownMatrixToken(error)) throw error;
      const minted = this.#embedded.provision(`polymux-${randomBytes(4).toString("hex")}`);
      await this.#store(minted.userId, minted.accessToken, null);
      return read();
    }
  }

  async markChatRead(chatId: string, messageId: string): Promise<void> {
    await this.#load();
    if (this.#embedded?.markWeChatRead && (await this.#hub.roomPlatform(chatId)) === "wechat")
      return this.#embedded.markWeChatRead(chatId, messageId);
    return this.#hub.markRead(chatId, messageId);
  }

  async chatMembers(chatId: string): Promise<ChatMemberDto[]> {
    return this.#readWithEmbeddedAuthRecovery(async () => {
      if (this.#embedded?.weChatMembers && (await this.#hub.roomPlatform(chatId)) === "wechat") {
        const native = await this.#embedded.weChatMembers(chatId);
        if (native) return native;
      }
      return this.#hub.members(chatId);
    });
  }

  async chatGroupInfo(chatId: string): Promise<ChatGroupInfoDto> {
    await this.#load();
    if (!this.#embedded?.weChatGroupInfo || (await this.#hub.roomPlatform(chatId)) !== "wechat")
      throw new Error("Group renaming is available for connected WeChat groups");
    return this.#embedded.weChatGroupInfo(chatId);
  }

  async renameChatGroup(chatId: string, name: string, expectedName: string): Promise<ChatGroupInfoDto> {
    await this.#load();
    if (!this.#embedded?.renameWeChatGroup || (await this.#hub.roomPlatform(chatId)) !== "wechat")
      throw new Error("Group renaming is available for connected WeChat groups");
    this.#embedded.assertWeChatLiveTestDestination?.(chatId);
    return this.#embedded.renameWeChatGroup(chatId, name, expectedName);
  }

  async sendChat(
    chatId: string,
    text: string,
    replyTo?: string,
    mentions?: ChatMentionsDto,
  ): Promise<string> {
    await this.#load();
    await this.#assertChatOutboundReady(chatId);
    const eventId = await this.#hub.send(chatId, text, replyTo, mentions);
    await this.#confirmOutbound(chatId, eventId);
    return eventId;
  }

  /**
   * Sends files into a conversation. Each one is uploaded and then posted as
   * its own message, which is how every network carries an attachment.
   */
  async sendChatFiles(
    chatId: string,
    files: Array<{name: string; mimetype: string; bytes: Uint8Array}>,
  ): Promise<void> {
    await this.#load();
    await this.#assertChatOutboundReady(chatId);
    for (const file of files) {
      const url = await this.#hub.upload(file.name, file.mimetype, file.bytes);
      const eventId = await this.#hub.sendMedia(chatId, {
        url,
        name: file.name,
        mimetype: file.mimetype,
        size: file.bytes.byteLength,
        msgtype: msgtypeOf(file.mimetype),
      });
      await this.#confirmOutbound(chatId, eventId);
    }
  }

  async sendChatSticker(
    chatId: string,
    stickerId: string,
  ): Promise<void> {
    await this.#load();
    await this.#assertChatOutboundReady(chatId);
    if (
      !this.#embedded?.weChatStickers ||
      (await this.#hub.roomPlatform(chatId)) !== "wechat"
    )
      throw new Error("Native stickers are only available for WeChat chats");
    const sticker = (await this.#embedded.weChatStickers()).find(
      (entry) => entry.id === stickerId,
    );
    if (!sticker) throw new Error("That WeChat sticker is no longer available");
    const eventId = await this.#hub.sendSticker(chatId, {
      url: sticker.uri,
      name: "Sticker",
      mimetype: sticker.mimeType,
      size: sticker.size,
    });
    await this.#confirmOutbound(chatId, eventId);
  }

  async chatStickers(chatId: string): Promise<ChatStickerDto[]> {
    await this.#load();
    if (
      !this.#embedded?.weChatStickers ||
      (await this.#hub.roomPlatform(chatId)) !== "wechat"
    )
      return [];
    return (await this.#embedded.weChatStickers()).flatMap((sticker) => {
      const url = mediaUrl(sticker.uri);
      return url ? [{...sticker, url}] : [];
    });
  }

  async recallChat(chatId: string, eventId: string): Promise<void> {
    await this.#load();
    if (
      this.#embedded?.recallWeChat &&
      (await this.#hub.roomPlatform(chatId)) === "wechat"
    ) {
      // Recall is an outbound native action too. It can be invoked from a
      // message menu without the composer wake that precedes ordinary sends,
      // so prepare the same hidden, signed-in desktop session before touching
      // WeChat or redacting anything locally.
      await this.#assertChatOutboundReady(chatId);
      await this.#embedded.recallWeChat(chatId, eventId);
      return;
    }
    await this.#hub.redact(chatId, eventId);
  }

  outboundDeliveryStatus(eventId: string): "unconfirmed" | undefined {
    return this.#embedded?.outboundDeliveryStatus?.(eventId) ?? undefined;
  }

  async #confirmOutbound(chatId: string, eventId: string): Promise<void> {
    if (
      !this.#embedded?.waitForWeChatOutbound ||
      (await this.#hub.roomPlatform(chatId)) !== "wechat"
    )
      return;
    try {
      await this.#embedded.waitForWeChatOutbound(eventId);
    } catch (error) {
      // The native request may still arrive. Keep its local event and status;
      // returning it clears the submitted draft without presenting it as sent.
      if (isWeChatDeliveryUnconfirmed(error)) return;
      this.#embedded.discardOutbound?.(eventId);
      throw error;
    }
  }

  /** Rejects before Matrix creates an optimistic event, so an unready WeChat
   * relay never produces a bubble that disappears and restores the draft. */
  async #assertChatOutboundReady(chatId: string): Promise<void> {
    if ((await this.#hub.roomPlatform(chatId)) !== "wechat") return;
    // Acceptance mode is intentionally stricter than ordinary readiness: do
    // not launch WeChat, upload a file, or create even a local event for a
    // recipient outside File Transfer. The bridge repeats this check at the
    // transport boundary for Matrix clients that bypass this UI.
    this.#embedded?.assertWeChatLiveTestDestination?.(chatId);
    if (await this.#embedded?.weChatSessionState?.() === "locked")
      throw new Error("Unlock your Mac before sending through WeChat.");
    if (!this.#embedded?.weChatOutboundReady) return;
    if (await this.#embedded.weChatOutboundReady().catch(() => false)) return;
    const failure = this.#embedded.weChatOutboundFailure?.();
    if (failure) throw new Error(failure);
    const session = await this.#embedded.weChatSessionState?.();
    if (session === "locked")
      throw new Error("Unlock your Mac before sending through WeChat.");
    if (session === "signed_out" || session === "interactive_login")
      throw new Error("Sign in to WeChat Desktop, then try again.");
    throw new Error(
      "Polymux is reconnecting WeChat's background sender automatically. Try again in a moment.",
    );
  }

  async reactToChat(chatId: string, messageId: string, key: string): Promise<string> {
    await this.#load();
    return this.#hub.react(chatId, messageId, key);
  }

  /** Takes back a reaction, given the reaction event's own id. */
  async unreactChat(chatId: string, reactionId: string): Promise<void> {
    await this.#load();
    return this.#hub.redact(chatId, reactionId);
  }

  /** Which providers this build can sign a mailbox in to. */
  emailSignInProviders(): MailOAuthProvider[] {
    return this.#email.signInProviders();
  }

  /** Signs a mailbox in with its provider and reports the whole status back. */
  async emailSignIn(provider: MailOAuthProvider): Promise<CommsStatusDto> {
    await this.#email.signIn(provider);
    return this.#publish();
  }

  async mailFolders(account?: string): Promise<MailFolderDto[]> {
    return this.#email.folders(account);
  }

  async mailEnvelopes(request: MailListRequest): Promise<MailEnvelopeDto[]> {
    return this.#email.envelopes({
      account: request.account,
      folder: request.folder,
      page: request.page,
      pageSize: request.pageSize,
      query: request.query,
      sort: request.sort,
    });
  }

  async mailMessage(id: string, account?: string, folder?: string): Promise<MailMessageDto> {
    return this.#email.message({id, account, folder});
  }

  async mailMove(
    ids: string[],
    target: string,
    account?: string,
    folder?: string,
  ): Promise<void> {
    return this.#email.move({ids, target, account, folder});
  }

  async mailDelete(ids: string[], account?: string, folder?: string): Promise<void> {
    return this.#email.delete({ids, account, folder});
  }

  async mailDownload(id: string, account?: string, folder?: string): Promise<string[]> {
    return this.#email.download({id, account, folder});
  }

  async mailAttachment(
    id: string,
    part: string,
    account?: string,
    folder?: string,
  ): Promise<MailAttachmentContentDto> {
    const file = await this.#email.attachment({id, part, account, folder});
    return {
      id: file.id,
      name: file.name,
      mime: file.mime,
      content: Uint8Array.from(file.content).buffer,
    };
  }

  async mailFlag(
    ids: string[],
    flag: "seen" | "flagged",
    on: boolean,
    account?: string,
    folder?: string,
  ): Promise<void> {
    return this.#email.flag({ids, flag, on, account, folder});
  }

  /** Envelope list for the agent tools, which take a simple limit. */
  async emailEnvelopes(options: {
    account?: string;
    folder?: string;
    limit: number;
    query?: string;
  }): Promise<unknown> {
    return this.#email.envelopes({
      account: options.account,
      folder: options.folder,
      pageSize: options.limit,
      query: options.query,
    });
  }

  /** A bounded read-only search across configured inboxes. The host already
   * knows the accounts, so an agent should not spend a model round enumerating
   * and then querying each mailbox serially. One account failing does not hide
   * useful matches from the others. */
  async emailSearchAll(options: {
    queries: string[];
    limitPerQuery: number;
    maxResults: number;
    /** Internal test seam; the agent tool always uses the bounded default. */
    timeoutMs?: number;
  }): Promise<{
    messages: Array<{
      account: string;
      email: string;
      id: string;
      subject: string | null;
      from: MailEnvelopeDto["from"];
      date: string | null;
      preview: string;
      hasAttachment: boolean;
    }>;
    errors: Array<{account: string; email: string; query: string; error: string}>;
  }> {
    const accounts = await this.#email.list();
    const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 8_000, 30_000));
    const [searched, appleMail] = await Promise.all([
      Promise.all(accounts.map(async (account) => {
        const pages = await Promise.allSettled(options.queries.map((query) =>
          settleWithin(this.#email.envelopes({
            account: account.id,
            folder: "INBOX",
            pageSize: options.limitPerQuery,
            query,
          }), timeoutMs, `Mailbox search timed out after ${timeoutMs} ms`)
        ));
        const unique = new Map<string, {message: MailEnvelopeDto; queryIndexes: Set<number>}>();
        for (const [queryIndex, page] of pages.entries()) {
          if (page.status !== "fulfilled") continue;
          for (const message of page.value) {
            const existing = unique.get(message.id);
            if (existing) existing.queryIndexes.add(queryIndex);
            else unique.set(message.id, {message, queryIndexes: new Set([queryIndex])});
          }
        }
        return {
          account: account.id,
          email: account.email,
          matches: [...unique.values()],
          errors: pages.flatMap((page, index) =>
            page.status === "rejected"
              ? [{
                  account: account.id,
                  email: account.email,
                  query: options.queries[index]!,
                  error: page.reason instanceof Error ? page.reason.message : String(page.reason),
                }]
              : []
          ),
        };
      })),
      this.#appleMailSearch
        ? this.#appleMailSearch({queries: options.queries, maxResults: options.maxResults, timeoutMs})
            .catch((error): AppleMailSearchResult => ({
              messages: [],
              errors: options.queries.map((query) => ({
                account: "apple-mail",
                email: "Apple Mail",
                query,
                error: error instanceof Error ? error.message : String(error),
              })),
            }))
        : Promise.resolve({messages: [], errors: []} as AppleMailSearchResult),
    ]);
    const errors = [...searched.flatMap((result) => result.errors), ...appleMail.errors];
    const candidates = searched.flatMap((result) =>
        result.matches.map(({message, queryIndexes}) => ({
            account: result.account,
            email: result.email,
            id: message.id,
            subject: message.subject,
            from: message.from,
            date: message.date,
            preview: message.preview ?? "",
            hasAttachment: message.hasAttachment,
            queryIndexes,
          }))
    );
    for (const message of appleMail.messages) {
      candidates.push({...message, queryIndexes: new Set(options.queries.map((_, index) => index))});
    }
    const buckets = options.queries.map((_, queryIndex) => candidates
      .filter((candidate) => candidate.queryIndexes.has(queryIndex))
      .sort((left, right) => Date.parse(right.date ?? "") - Date.parse(left.date ?? "")));
    const selected = new Map<string, typeof candidates[number]>();
    for (let offset = 0; selected.size < options.maxResults; offset++) {
      let added = false;
      for (const bucket of buckets) {
        const candidate = bucket[offset];
        if (!candidate) continue;
        const key = `${candidate.account}:${candidate.id}`;
        if (!selected.has(key)) {
          selected.set(key, candidate);
          added = true;
        }
        if (selected.size >= options.maxResults) break;
      }
      if (!added && buckets.every((bucket) => offset >= bucket.length)) break;
    }
    const messages = [...selected.values()]
      .sort((left, right) => Date.parse(right.date ?? "") - Date.parse(left.date ?? ""))
      .map(({queryIndexes: _queryIndexes, ...message}) => message);
    return {messages, errors};
  }

  async emailRead(options: {id: string; account?: string; folder?: string}): Promise<unknown> {
    return this.#email.message(options);
  }

  async emailSend(options: {
    account?: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
    html?: string;
    draft?: boolean;
    attachments?: string[];
    inlineAttachments?: Array<{path: string; contentId: string}>;
    importance?: "high" | "normal" | "low";
    inReplyTo?: string;
    references?: string[];
  }): Promise<{
    sent: boolean;
    saved?: string;
    account: string;
    from: string;
    draft?: {id: string; folder: string};
  }> {
    const accounts = await this.#email.list();
    const account = options.account
      ? accounts.find((item) => item.id === options.account)
      : accounts.length === 1
        ? accounts[0]
        : undefined;
    if (!account)
      throw new Error(
        options.account
          ? `No email account named ${options.account}. Call email_accounts to see what is configured.`
          : accounts.length === 0
            ? "No email accounts are configured. Add one in Settings → Communications."
            : "More than one email account is configured. Pass an account id from email_accounts.",
      );
    // The From header has to match the account actually sending, or the
    // provider will reject or silently rewrite it.
    const from = account.displayName
      ? `${account.displayName} <${account.email}>`
      : account.email;
    const result = await this.#email.send({...options, account: account.id, from});
    // A draft went to the mailbox rather than to anyone: saying "sent" here
    // would have the agent report a message the recipient never got.
    return options.draft
      ? {sent: false, saved: "Drafts", account: account.id, from, draft: result.draft}
      : {sent: true, account: account.id, from};
  }

  /** Resolves the provisioning route for a platform, or explains why there is none. */
  async #target(platform: CommsPlatform): Promise<{route: string}> {
    const entry = COMMS_PLATFORMS.find((item) => item.value === platform);
    if (!entry?.route)
      throw new Error(
        `${entry?.label ?? platform} does not have a bridge that can be linked from here.`,
      );
    await this.#load();
    // A cached settings snapshot can still be showing this bridge's login
    // flows before the on-demand process from this launch is ready. Every
    // login action comes through #target, so make readiness a backend
    // invariant instead of relying on the renderer's best-effort warm-up.
    await this.#embedded?.ensure?.(platform);
    const bridge = await this.#hub.bridge(platform, entry.label, entry.route);
    if (bridge.api === "none")
      throw new Error(`${entry.label} is not reachable through the hub.`);
    return {route: entry.route};
  }

  async #load(): Promise<void> {
    if (this.#loaded) {
      this.#ensureSync();
      return;
    }
    if (this.#loadTask) return this.#loadTask;
    const task = this.#loadOnce().finally(() => {
      if (this.#loadTask === task) this.#loadTask = null;
    });
    this.#loadTask = task;
    return task;
  }

  /** Completes authentication before another read is allowed to use the Hub. */
  async #loadOnce(): Promise<void> {
    const stored = await this.#credentials
      .read(HUB_CREDENTIAL_ID)
      .catch((): undefined => undefined);
    if (stored?.type === "api_key" && stored.key) {
      this.#matrixToken = stored.key;
      const userId = stored.env?.MATRIX_USER_ID;
      this.#userId = typeof userId === "string" ? userId : null;
    }
    // On the embedded hub there is no setup decision to put in front of the
    // user — no password, no server, no choice — so the account is minted the
    // first time anything asks, and "set up messaging" ceases to be a page.
    if (this.#embeddedMode && this.#embedded && !this.#matrixToken) {
      const minted = this.#embedded.provision(`polymux-${randomBytes(4).toString("hex")}`);
      await this.#store(minted.userId, minted.accessToken, null);
    }
    // Set only after the credential read and any zero-config provisioning are
    // both complete. Setting it before the first await let startup's parallel
    // status/chats reads race ahead with a null Matrix token.
    this.#loaded = true;
    this.#ensureSync();
  }

  #backgroundClosed = false;
  readonly #publishing = new Set<Promise<unknown>>();
  #backgroundStarted = false;
  #backgroundTimer: ReturnType<typeof setTimeout> | null = null;
  #backgroundTask: Promise<void> | null = null;

  /** Own WeChat ingestion independently of any mounted Hub window. The passive
   * bridge start reads available stores and resumes an already signed-in app;
   * it never invokes composer readiness or overrides an explicit unlink. */
  startBackgroundSync(intervalMs = 3_000): void {
    if (this.#backgroundStarted || this.#backgroundClosed || !this.#embeddedMode) return;
    this.#backgroundStarted = true;
    const tick = () => {
      if (this.#backgroundClosed) return;
      this.#backgroundTask = (async () => {
        await this.#load();
        if (this.#backgroundClosed || !this.#embeddedMode || !this.#userId || !this.#weChatLinked()) return;
        await this.#embedded?.startWeChat?.(this.#userId);
        await this.pollWeChat();
      })().catch(() => {
        // Access can arrive after launch. Retry without making Hub the owner.
      }).finally(() => {
        this.#backgroundTask = null;
        if (!this.#backgroundClosed) {
          this.#backgroundTimer = setTimeout(tick, intervalMs);
          this.#backgroundTimer.unref?.();
        }
      });
    };
    tick();
  }

  /** Stops background work owned by this backend/profile. */
  async close(): Promise<void> {
    this.#backgroundClosed = true;
    if (this.#backgroundTimer) clearTimeout(this.#backgroundTimer);
    this.#backgroundTimer = null;
    // Let an in-flight status read finish before teardown: it reaches into the
    // mailbox store and the keychain, and shutdown must not report completion
    // while that work is still writing. An idle shutdown takes no extra turn.
    if (this.#publishing.size) await Promise.allSettled([...this.#publishing]);
    await this.#backgroundTask;
    await this.#weChatPoll?.catch(() => {});
    this.#stopSync();
    await this.#email.close();
  }

  /** Starts one sync follower for the current homeserver and credential. */
  #ensureSync(): void {
    if (!this.#onActivity || !this.#matrixToken || this.#syncTask) return;
    const controller = new AbortController();
    const generation = ++this.#syncGeneration;
    this.#syncController = controller;
    this.#syncTask = this.#followSync(controller.signal).finally(() => {
      if (generation !== this.#syncGeneration) return;
      this.#syncController = null;
      this.#syncTask = null;
    });
  }

  #stopSync(): void {
    this.#syncGeneration += 1;
    this.#syncController?.abort();
    this.#syncController = null;
    this.#syncTask = null;
  }

  /**
   * Keeps one Matrix long poll open. A failed request is retried with a small,
   * bounded delay; the last confirmed token is retained so reconnecting cannot
   * replay the whole room list as new activity or skip an event.
   */
  async #followSync(signal: AbortSignal): Promise<void> {
    let since: string | null = null;
    let failures = 0;
    while (!signal.aborted) {
      try {
        const delta = await this.#hub.sync(since, signal);
        since = delta.nextBatch;
        failures = 0;
        for (const activity of delta.activities) this.#onActivity?.(activity);
      } catch (error) {
        if (signal.aborted) return;
        // Authentication recovery belongs to the next explicit read, where an
        // embedded token can be safely reminted. A hot retry would only hammer
        // the same rejected credential forever.
        if (isUnknownMatrixToken(error)) return;
        failures += 1;
        await abortableDelay(Math.min(5_000, 250 * 2 ** Math.min(failures - 1, 5)), signal);
      }
    }
  }

  #publish(): Promise<CommsStatusDto> {
    const task = (async (): Promise<CommsStatusDto> => {
      const status = await this.status();
      this.#onChange(status);
      return status;
    })();
    // A status read touches the mailbox store and the OS keychain. Shutdown
    // has to know about the ones still running, or I/O lands after close()
    // has already resolved.
    this.#publishing.add(task);
    void task.catch((): undefined => undefined).finally(() => this.#publishing.delete(task));
    return task;
  }

  /**
   * Whether WeChat should be carried into the hub. Linked is the default: the
   * relay signs in as the app on this Mac, so someone who has WeChat open has
   * already done the only thing linking asks of them. Only an explicit unlink
   * is recorded.
   */
  #weChatLinked(): boolean {
    const stored = this.#storage.getPreference(WECHAT_PREFERENCE)?.value;
    if (!stored || typeof stored !== "object") return true;
    const linked = (stored as Record<string, unknown>).linked;
    return typeof linked === "boolean" ? linked : true;
  }

  #setWeChatLinked(linked: boolean): void {
    this.#storage.setPreference(WECHAT_PREFERENCE, {linked});
  }

  #persistHub(): void {
    this.#storage.setPreference("comms-hub", {
      baseUrl: this.#baseUrl,
      homeserverUrl: this.#homeserverUrl,
      directory: this.#directory,
    });
  }

  #createHub(): MatrixHub {
    return new MatrixHub({
      baseUrl: this.#baseUrl,
      homeserverUrl: this.#homeserverUrl,
      directory: this.#directory,
      embedded: this.#embeddedMode,
      auth: () => ({matrixToken: this.#matrixToken, userId: this.#userId}),
      fetch: this.#fetch,
    });
  }
}

function hubPreference(value: unknown): HubPreference {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl : undefined,
    homeserverUrl:
      typeof record.homeserverUrl === "string" ? record.homeserverUrl : undefined,
    directory: typeof record.directory === "string" ? record.directory : undefined,
  };
}

function isUnknownMatrixToken(error: unknown): boolean {
  return error instanceof Error && /(?:M_UNKNOWN_TOKEN|Unrecognised access token)/i.test(error.message);
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, {once: true});
  });
}

/**
 * Where a Matrix hub deployment lives by convention. Only used to recover
 * per-bridge shared secrets when the app has no Matrix token of its own.
 */
function defaultHubDirectory(home: string): string | null {
  if (process.platform === "darwin")
    return path.join(home, "Library", "Application Support", "matrix-hub");
  return path.join(home, ".local", "share", "matrix-hub");
}

/** Runs a command with no shell, writing `input` to stdin. */
const runCommand: CommandRunner = (command, args, input) =>
  new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {stdio: ["pipe", "pipe", "pipe"]});
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({code: code ?? -1, stdout, stderr}));
    child.stdin.end(input ?? "");
  });

/** Which kind of message carries a file, so clients render it in place. */
function msgtypeOf(mimetype: string): string {
  if (mimetype.startsWith("image/")) return "m.image";
  if (mimetype.startsWith("audio/")) return "m.audio";
  if (mimetype.startsWith("video/")) return "m.video";
  return "m.file";
}
