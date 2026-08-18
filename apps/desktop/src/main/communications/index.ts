import path from "node:path";
import {homedir} from "node:os";
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {
  EmailAccounts,
  MatrixHub,
  probeWeChatRelay,
  shippedNetworkConfig,
  type CommandResult,
  type CommandRunner,
  type MatrixMessage,
  type MatrixRoom,
} from "@flareai/hub";
import {
  COMMS_PLATFORMS,
  type CommsBridgeDto,
  type CommsBridgeSetupDto,
  type CommsEmailAccountDto,
  type CommsLoginStepDto,
  type CommsPlatform,
  type CommsStatusDto,
  type JsonValue,
  type MailEnvelopeDto,
  type MailFolderDto,
  type MailListRequest,
  type MailMessageDto,
  type SaveEmailAccountRequest,
  type SystemPermissionKind,
} from "@flareai/protocol";
import type {CredentialStore} from "@earendil-works/pi-ai";

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
   * Starts the in-process WeChat bridge against FlareAI's own account. Unlike
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

export interface CommunicationsOptions {
  credentials: CredentialStore;
  storage: PreferenceStore;
  onChange: (status: CommsStatusDto) => void;
  /** The in-process homeserver, used when no external hub is configured. */
  embedded?: EmbeddedHub;
  cookieLogin?: CookieLoginDriver;
  /** Closes any open cookie sign-in window for a platform. */
  cancelCookieLogin?: (platform: CommsPlatform) => void;
  /** Overridable for tests. */
  home?: string;
  run?: CommandRunner;
  fetch?: typeof globalThis.fetch;
  emailConfigPath?: string;
}

interface HubPreference {
  baseUrl?: string;
  homeserverUrl?: string;
  directory?: string;
}

/**
 * Owns every messaging and email account the agent can reach: the local Matrix
 * hub and its bridge fleet, plus the mailboxes Himalaya is configured for.
 *
 * Linking happens here rather than in a bridge's management room, so a QR scan
 * or cookie sign-in is a step this service drives and the settings UI renders.
 */
export class Communications {
  readonly #credentials: CredentialStore;
  readonly #storage: PreferenceStore;
  readonly #onChange: (status: CommsStatusDto) => void;
  readonly #cookieLogin?: CookieLoginDriver;
  readonly #cancelCookieLogin?: (platform: CommsPlatform) => void;
  readonly #email: EmailAccounts;
  readonly #run: CommandRunner;
  readonly #fetch?: typeof globalThis.fetch;
  readonly #home: string;
  readonly #embedded: EmbeddedHub | null;
  #embeddedMode: boolean;
  #hub: MatrixHub;
  #baseUrl: string;
  #homeserverUrl: string;
  #directory: string | null;
  #matrixToken: string | null = null;
  #userId: string | null = null;
  #loaded = false;
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
    this.#cookieLogin = options.cookieLogin;
    this.#cancelCookieLogin = options.cancelCookieLogin;
    this.#home = options.home ?? homedir();
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
    this.#email = new EmailAccounts({
      configPath:
        options.emailConfigPath ?? path.join(this.#home, ".config", "himalaya", "config.toml"),
      run: this.#run,
    });
    this.#hub = this.#createHub();
  }

  /**
   * A deliberate second look, as opposed to the status the tab reads on its
   * own schedule. Anything the user could have changed outside FlareAI — a grant
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
    const platforms = COMMS_PLATFORMS.filter((entry) => entry.value !== "matrix");
    // Which binaries exist decides whether "not answering" means broken or
    // simply never installed, so it is read before anything is probed.
    const inventory = await this.#embedded?.inventory
      ?.()
      .catch((): NonNullable<Awaited<ReturnType<NonNullable<EmbeddedHub["inventory"]>>>> => []);
    const installed = new Map((inventory ?? []).map((entry) => [entry.platform, entry] as const));
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
      // A pair FlareAI ships counts as answered, and counts before the bridge
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
          : `${known.binary} is not installed on this Mac, so ${entry.label} cannot be brought in yet.`,
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
            ? `FlareAI has reached ${entry.label} on this Mac but has not finished connecting it. Reopen this in a moment.`
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
        tooling: await this.#email.tooling(),
        accounts: (await this.#email.list()).map((account) => {
          const tested = this.#emailStatus.get(account.id);
          return tested ? {...account, ...tested} : account;
        }),
      },
    };
    // Read last, and only told about a change: a status read is not itself
    // news, and re-sending an unchanged fleet on every poll would repaint
    // every open window for nothing.
    const moved = bridges.some((bridge) => this.#bridgeStates.get(bridge.platform) !== bridge.state);
    for (const bridge of bridges) this.#bridgeStates.set(bridge.platform, bridge.state);
    if (moved) this.#onChange(result);
    return result;
  }

  async setHubUrl(baseUrl: string): Promise<CommsStatusDto> {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(trimmed))
      throw new Error("The hub address must start with http:// or https://");
    // Naming an address is choosing an external hub — and the health probe
    // must follow it, not keep watching the embedded server.
    this.#embeddedMode = false;
    this.#baseUrl = trimmed;
    const stored = hubPreference(this.#storage.getPreference("comms-hub")?.value);
    this.#homeserverUrl = stored.homeserverUrl ?? trimmed;
    this.#directory = stored.directory ?? defaultHubDirectory(this.#home);
    this.#persistHub();
    this.#hub = this.#createHub();
    return this.#publish();
  }

  /**
   * Sets messaging up without asking the user for anything.
   *
   * FlareAI registers a dedicated account on the local hub with a generated
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
    const username = `flareai-${randomBytes(4).toString("hex")}`;
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
    this.#matrixToken = accessToken;
    this.#userId = userId;
    await this.#credentials.modify(HUB_CREDENTIAL_ID, async () => ({
      type: "api_key",
      key: accessToken,
      env: {
        MATRIX_USER_ID: userId,
        // Only ever a password FlareAI generated itself.
        ...(password ? {MATRIX_PROVISIONED_PASSWORD: password} : {}),
      },
    }));
  }

  async signOut(): Promise<CommsStatusDto> {
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
      // A legacy bridge has no step machine; present the one field it accepts
      // and complete it on submit.
      return {
        type: "user_input",
        loginId: `legacy:${platform}`,
        stepId: "token",
        instructions:
          "Paste an account token. This bridge is an older build with no in-app QR support.",
        fields: [
          {
            id: "token",
            type: "token",
            name: "Account token",
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
      await this.#hub.legacyTokenLogin(route, token);
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
    if (target?.api === "bridgev2") await this.#hub.loginCancel(target.route, loginId);
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
    await this.#load();
    return this.#hub.rooms();
  }

  async readChat(
    chatId: string,
    limit: number,
    before?: string,
  ): Promise<{nextBefore: string | null; messages: MatrixMessage[]}> {
    await this.#load();
    return this.#hub.messages(chatId, limit, before);
  }

  async searchChats(
    query: string,
    limit: number,
    chatIds?: string[],
  ): Promise<{nextBatch: string | null; messages: unknown[]}> {
    await this.#load();
    return this.#hub.search(query, limit, chatIds);
  }

  async unreadChats(limit: number, platform?: string): Promise<unknown[]> {
    await this.#load();
    return this.#hub.unread(limit, platform);
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
    draft?: boolean;
    attachments?: string[];
    importance?: "high" | "normal" | "low";
    inReplyTo?: string;
    references?: string[];
  }): Promise<{sent: boolean; saved?: string; account: string; from: string}> {
    const accounts = await this.#email.list();
    const account = options.account
      ? accounts.find((item) => item.id === options.account)
      : (accounts.find((item) => item.isDefault) ?? accounts[0]);
    if (!account)
      throw new Error(
        options.account
          ? `No email account named ${options.account}. Call email_accounts to see what is configured.`
          : "No email accounts are configured. Add one in Settings → Communications.",
      );
    // The From header has to match the account actually sending, or the
    // provider will reject or silently rewrite it.
    const from = account.displayName
      ? `${account.displayName} <${account.email}>`
      : account.email;
    await this.#email.send({...options, account: account.id, from});
    // A draft went to the mailbox rather than to anyone: saying "sent" here
    // would have the agent report a message the recipient never got.
    return options.draft
      ? {sent: false, saved: "Drafts", account: account.id, from}
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
    if (this.#loaded) return;
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
        const minted = this.#embedded.provision(`flareai-${randomBytes(4).toString("hex")}`);
        await this.#store(minted.userId, minted.accessToken, null);
      } catch {
        // The homeserver may still be binding its port; the next status()
        // retries because #loaded only reflects the credential read.
        this.#loaded = false;
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
