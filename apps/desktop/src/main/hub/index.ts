import path from "node:path";
import {polymuxHome} from "../system/paths.js";
import {homedir} from "node:os";
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {
  bridgeDisplayName,
  EmailAccounts,
  MatrixHub,
  probeWeChatRelay,
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
  COMMS_PLATFORMS,
  type CommsBridgeDto,
  type CommsBridgeSetupDto,
  type CommsContactDto,
  type CommsEmailAccountDto,
  type CommsLoginStepDto,
  type CommsPlatform,
  type CommsStatusDto,
  type CreateChatRequest,
  type JsonValue,
  type MailEnvelopeDto,
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
    managementRoomHint: bridge.managementRoomHint,
    accounts: bridge.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      state: account.state,
      error: account.error,
    })),
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
  /**
   * Takes the WeChat bridge back down. Unlinking cannot sign anything out —
   * the account belongs to WeChat.app — so what it does is stop carrying that
   * app's messages into the hub.
   */
  stopWeChat?: () => Promise<void>;
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
 * the provider's drive registration is a valid public desktop client too and
 * is the useful default: users should not lose one-click mailbox sign-in just
 * because the build did not duplicate the same client id under a second name.
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
    const clientId =
      process.env[`${mailPrefix}_CLIENT_ID`]?.trim() ||
      process.env[`${sharedPrefix}_CLIENT_ID`]?.trim();
    if (!clientId) continue;
    const clientSecret =
      process.env[`${mailPrefix}_CLIENT_SECRET`]?.trim() ||
      process.env[`${sharedPrefix}_CLIENT_SECRET`]?.trim();
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
  #syncController: AbortController | null = null;
  #syncTask: Promise<void> | null = null;
  #syncGeneration = 0;
  /** Connection-test outcomes, which are too slow to redo on every status read. */
  readonly #emailStatus = new Map<string, {status: "ok" | "error"; error: string | null}>();
  /**
   * What each bridge was last seen as, so a state that changed without anyone
   * asking for it can be pushed. Every other publish follows an action the
   * user took here; a bridge that comes up on its own — the WeChat relay is
   * started by the status read itself — has no such moment, and a window
   * already open would otherwise keep the list it happened to load with.
   */
  readonly #bridgeStates = new Map<string, string>();
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
    return COMMS_PLATFORMS.filter((entry) => entry.value !== "matrix").map((entry) => {
      const state = this.#bridgeStates.get(entry.value) ?? "unknown";
      return {platform: entry.value, state, live: state === "connected"};
    });
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
  async wake(platform: CommsPlatform): Promise<CommsStatusDto> {
    await this.#embedded?.ensure?.(platform).catch((): undefined => undefined);
    return this.status();
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
      // Two independent questions, and both have to be yes. A relay reports on
      // its link to the WeChat app, not on where it delivers: one configured
      // against another homeserver is entirely healthy and still invisible
      // here. Reporting only the first is how a seat comes to say "connected"
      // over a platform whose messages can never arrive.
      // Bringing it up is part of reading its status: the bridge is in-process
      // and idempotent, so the first status read after sign-in is what starts
      // it. Nothing else would.
      if (this.#userId) await this.#embedded?.startWeChat?.(this.#userId).catch(() => false);
      const [relay, delivers] = await Promise.all([
        probeWeChatRelay(),
        this.#hub.hasBridgeBot(`${entry.value}bot`),
      ]);
      const usable = relay.running && delivers;
      return {
        platform: entry.value,
        name: entry.label,
        api: "none",
        state: usable ? "connected" : "unavailable",
        accounts:
          usable && relay.account
            ? [{id: relay.account.id, name: relay.account.name, state: "connected", error: null}]
            : [],
        flows: [],
        setup: null,
        managementRoomHint: null,
        error:
          relay.running && !delivers
            ? `Polymux has reached ${entry.label} on this Mac but has not finished connecting it. Reopen this in a moment.`
            : relay.error,
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
    // Read last, and only told about a change: a status read is not itself
    // news, and re-sending an unchanged fleet on every poll would repaint
    // every open window for nothing.
    const moved = bridges.some((bridge) =>
      this.#bridgeStates.get(bridge.platform) !== bridgeStatusFingerprint(bridge));
    for (const bridge of bridges)
      this.#bridgeStates.set(bridge.platform, bridgeStatusFingerprint(bridge));
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
    const {route, api} = await this.#target(platform);
    if (api === "legacy") {
      const loginId = `legacy:${platform}:${flowId}`;
      if (flowId === "qr") {
        const code = await this.#hub.legacyQrLoginStart(route, loginId);
        return {
          type: "display_and_wait",
          loginId,
          stepId: "qr",
          display: "qr",
          data: code,
          imageUrl: "",
          instructions: "In Discord mobile, open your profile, choose Scan QR Code, then approve this login.",
        };
      }
      const labels: Record<string, {name: string; instructions: string}> = {
        "user-token": {
          name: "User token",
          instructions: "Paste your Discord user token. Treat it like a password; Discord may flag unusual account automation.",
        },
        "bot-token": {
          name: "Bot token",
          instructions: "Paste a bot token. It can access only servers and channels where that bot was invited and granted permission.",
        },
        "oauth-token": {
          name: "OAuth token",
          instructions: "Paste a Discord OAuth token. Its access is limited to the scopes granted and usually cannot mirror personal messages.",
        },
      };
      const copy = labels[flowId] ?? labels["user-token"]!;
      return {
        type: "user_input",
        loginId,
        stepId: "token",
        instructions: copy.instructions,
        fields: [
          {
            id: "token",
            type: "token",
            name: copy.name,
            description: null,
            pattern: null,
          },
        ],
      };
    }
    const step = await this.#hub.loginStart(route, flowId);
    return this.#remember(platform, step);
  }

  async loginSubmit(
    platform: CommsPlatform,
    loginId: string,
    stepId: string,
    values: Record<string, string>,
  ): Promise<CommsLoginStepDto> {
    const {route, api} = await this.#target(platform);
    if (api === "legacy") {
      const token = values.token?.trim();
      if (!token) throw new Error("An account token is required");
      const kind = loginId.split(":").at(-1);
      const credential = kind === "bot-token" ? `Bot ${token}` : kind === "oauth-token" ? `Bearer ${token}` : token;
      await this.#hub.legacyTokenLogin(route, credential);
      return {type: "complete", loginId, accountId: null, accountName: null};
    }
    const step = await this.#hub.loginSubmit(route, loginId, stepId, "user_input", values);
    return this.#remember(platform, step);
  }

  async loginWait(
    platform: CommsPlatform,
    loginId: string,
    stepId: string,
  ): Promise<CommsLoginStepDto> {
    const {route, api} = await this.#target(platform);
    if (api === "legacy") {
      const result = await this.#hub.legacyQrLoginWait(loginId);
      return result.complete
        ? {type: "complete", loginId, accountId: null, accountName: null}
        : {
            type: "display_and_wait",
            loginId,
            stepId,
            display: "qr",
            data: result.code!,
            imageUrl: "",
            instructions: "The QR code refreshed. Scan it in Discord mobile, then approve this login.",
          };
    }
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
    if (target?.api === "bridgev2") await this.#hub.loginCancel(target.route, loginId);
    else if (target?.api === "legacy") this.#hub.legacyQrLoginCancel(loginId);
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
    const {route, api} = await this.#target(platform);
    await this.#hub.logout(route, accountId, api);
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
   * gaps for legacy bridges and local relays. */
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
    const {route, api} = await this.#target(request.platform);
    if (api !== "bridgev2")
      throw new Error(`${COMMS_PLATFORMS.find((entry) => entry.value === request.platform)?.label ?? request.platform} cannot start new conversations from the Hub yet.`);
    await this.#load();
    return this.#hub.createChat(route, request.accountId, participantIds, request.name);
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
    return this.#readWithEmbeddedAuthRecovery(() => this.#hub.messages(chatId, limit, before));
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
    return this.#hub.markRead(chatId, messageId);
  }

  async sendChat(chatId: string, text: string, replyTo?: string): Promise<string> {
    await this.#load();
    return this.#hub.send(chatId, text, replyTo);
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
    for (const file of files) {
      const url = await this.#hub.upload(file.name, file.mimetype, file.bytes);
      await this.#hub.sendMedia(chatId, {
        url,
        name: file.name,
        mimetype: file.mimetype,
        size: file.bytes.byteLength,
        msgtype: msgtypeOf(file.mimetype),
      });
    }
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
  async #target(
    platform: CommsPlatform,
  ): Promise<{route: string; api: "bridgev2" | "legacy"}> {
    const entry = COMMS_PLATFORMS.find((item) => item.value === platform);
    if (!entry?.route)
      throw new Error(
        `${entry?.label ?? platform} does not have a bridge that can be linked from here.`,
      );
    await this.#load();
    const bridge = await this.#hub.bridge(platform, entry.label, entry.route);
    if (bridge.api === "none")
      throw new Error(`${entry.label} is not reachable through the hub.`);
    return {route: entry.route, api: bridge.api};
  }

  async #load(): Promise<void> {
    if (this.#loaded) {
      this.#ensureSync();
      return;
    }
    this.#loaded = true;
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
      try {
        const minted = this.#embedded.provision(`polymux-${randomBytes(4).toString("hex")}`);
        await this.#store(minted.userId, minted.accessToken, null);
      } catch {
        // The homeserver may still be binding its port; the next status()
        // retries because #loaded only reflects the credential read.
        this.#loaded = false;
      }
    }
    this.#ensureSync();
  }

  /** Stops background work owned by this backend/profile. */
  close(): void {
    this.#stopSync();
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

  async #publish(): Promise<CommsStatusDto> {
    const status = await this.status();
    this.#onChange(status);
    return status;
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
