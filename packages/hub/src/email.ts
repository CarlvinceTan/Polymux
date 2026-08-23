import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import {MailStore, type MailCredentials} from "./mail-store.js";
import {
  importHimalayaAccounts,
  himalayaSecrets,
  readAccounts,
  writeAccounts,
  type StoredAccount,
  type StoredEndpoint,
} from "./email-config.js";
import {EmailSecrets, keychainService, type CommandRunner} from "./email-secrets.js";
import {mimeMessage, mimeType, newMessageId} from "./email-mime.js";
import {
  MAIL_OAUTH_PROVIDERS,
  renewMailToken,
  signInToMailbox,
  type MailConsentPrompt,
  type MailOAuthProvider,
} from "./email-oauth.js";
import {presetForHost} from "@polymux/protocol";
import type {
  CommsEmailAccountDto,
  CommsEmailEndpointDto,
  MailEnvelopeDto,
  MailFolderDto,
  MailMessageDto,
  SaveEmailAccountRequest,
} from "@polymux/protocol";

export {EMAIL_KEYCHAIN_SERVICE, keychainService} from "./email-secrets.js";
export type {CommandRunner} from "./email-secrets.js";

/**
 * How long a command-produced token is reused before the command is asked
 * again. Well under the hour an access token usually lasts, so a stale one is
 * never presented, and long enough that opening a folder does not run the
 * helper once per message.
 */
const COMMAND_TOKEN_MS = 5 * 60_000;

/** How many times Sent is asked before a copy is filed there. */
const SENT_LOOKUPS = 3;
const SENT_LOOKUP_WAIT_MS = 800;

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface EmailAccountsOptions {
  /** Polymux's own account file, under its home: `state/email-accounts.json`. */
  storePath: string;
  /** Runs `security`, and nothing else. */
  run: CommandRunner;
  /** Where `download` saves a message's attachments. */
  downloadsDir: string;
  /**
   * A Himalaya config to adopt accounts from, once, if Polymux has none of its
   * own yet. Absent on a machine that never had one.
   */
  importFrom?: string;
  /** Swapped in tests; the token endpoint is the only thing fetched. */
  fetch?: typeof fetch;
  /**
   * Opens the provider's sign-in page. Absent on a host that cannot show one,
   * where signing in reports that rather than half-running.
   */
  consent?: MailConsentPrompt;
  /** OAuth client registrations, by provider. */
  oauthClients?: Partial<Record<MailOAuthProvider, {clientId: string; clientSecret?: string}>>;
}

/**
 * The user's mailboxes: the accounts Polymux keeps, the credentials it holds
 * for them in the OS keychain, and the live IMAP connections reading them.
 *
 * Everything about a mailbox is Polymux's own. Reading is IMAP over a
 * connection held open here, sending is SMTP, a draft is an IMAP APPEND, and
 * an expired OAuth token is renewed against the provider's token endpoint.
 * There is no CLI anywhere in it: a mailbox is reached in one round trip on a
 * connection that is already authenticated, which a process-per-command tool
 * cannot do however fast the tool itself is.
 *
 * A secret never enters the account file. It names the keychain entry, and the
 * value is fetched when a connection is opened and held only in memory.
 */
export class EmailAccounts {
  readonly #storePath: string;
  readonly #downloadsDir: string;
  readonly #importFrom: string | undefined;
  readonly #run: CommandRunner;
  readonly #fetch: typeof fetch | undefined;
  readonly #secrets: EmailSecrets;
  readonly #consent: MailConsentPrompt | undefined;
  readonly #oauthClients: Partial<Record<MailOAuthProvider, {clientId: string; clientSecret?: string}>>;
  readonly #store: MailStore;
  /** The one-time adoption, attempted once per run whatever asks first. */
  #imported: Promise<void> | undefined;
  /** Tokens a command produced, held only long enough to answer a burst. */
  readonly #commandTokens = new Map<string, {token: string; until: number}>();

  constructor(options: EmailAccountsOptions) {
    this.#storePath = options.storePath;
    this.#downloadsDir = options.downloadsDir;
    this.#importFrom = options.importFrom;
    this.#run = options.run;
    this.#fetch = options.fetch;
    this.#secrets = new EmailSecrets(options.run);
    this.#consent = options.consent;
    this.#oauthClients = options.oauthClients ?? {};
    this.#store = new MailStore({
      credentials: (accountId) => this.#credentials(accountId),
      renew: (accountId) => this.#renew(accountId),
    });
  }

  get storePath(): string {
    return this.#storePath;
  }

  /** Which providers this build can actually sign in to. */
  signInProviders(): MailOAuthProvider[] {
    if (!this.#consent) return [];
    return (Object.keys(MAIL_OAUTH_PROVIDERS) as MailOAuthProvider[]).filter(
      (provider) => !!this.#oauthClients[provider]?.clientId,
    );
  }

  /**
   * Signs a mailbox in with the provider's own account, and files it.
   *
   * The address comes back from the provider, so nothing is asked of the user
   * that the sign-in already answered — including the servers, which follow
   * from the provider. Signing in over an account that already exists replaces
   * how it authenticates and leaves everything else about it alone: that is
   * how a mailbox held together by an outside token helper becomes one Polymux
   * can renew on its own.
   */
  async signIn(provider: MailOAuthProvider): Promise<string> {
    const client = this.#oauthClients[provider];
    if (!this.#consent || !client?.clientId)
      throw new Error(`This build cannot sign in to ${provider}.`);
    const authorized = await signInToMailbox(provider, {
      clientId: client.clientId,
      ...(client.clientSecret ? {clientSecret: client.clientSecret} : {}),
      consent: this.#consent,
    });
    const accounts = await this.#accounts();
    const existing = accounts.find(
      (item) => item.email.toLowerCase() === authorized.address.toLowerCase(),
    );
    const id = existing?.id ?? accountId(authorized.address, accounts);
    const login = authorized.address;
    // Stored before the account is written: an account that says it signs in
    // with a token, with no token filed, is worse than one not yet written.
    await this.#secrets.write(id, login, "refresh-token", authorized.refreshToken);
    await this.#secrets.write(id, login, "access-token", authorized.accessToken);
    if (client.clientSecret)
      await this.#secrets.write(id, login, "client-secret", client.clientSecret);
    const account: StoredAccount = {
      ...(existing ?? {}),
      id,
      email: authorized.address,
      imap: {...authorized.servers.imap, login},
      smtp: {...authorized.servers.smtp, login},
      auth: {
        kind: "oauth2",
        provider,
        clientId: client.clientId,
        ...(client.clientSecret ? {hasClientSecret: true} : {}),
        tokenUrl: MAIL_OAUTH_PROVIDERS[provider].issuer,
      },
      ...(accounts.length === 0 ? {isDefault: true} : {}),
    };
    await this.#write([...accounts.filter((item) => item.id !== id), account]);
    // A password left over from however this mailbox used to sign in is not
    // the credential any more, and keeping it invites a stale one being tried.
    await this.#secrets.remove(id, login, "password");
    this.#commandTokens.delete(id);
    await this.#store.disconnect(id);
    return id;
  }

  async list(): Promise<CommsEmailAccountDto[]> {
    const accounts = await this.#accounts();
    return Promise.all(accounts.map((account) => this.#toDto(account)));
  }

  async save(request: SaveEmailAccountRequest): Promise<void> {
    const login = request.imapLogin ?? request.email;
    const smtpLogin = request.smtpLogin ?? request.email;
    const previousId = request.originalId ?? request.id;
    const renamed = !!request.originalId && request.originalId !== request.id;

    const accounts = await this.#accounts();
    const previous = accounts.find((account) => account.id === previousId);
    // An OAuth account keeps the client registration it was set up with: the
    // settings form never collects one, so rewriting it from these fields
    // would turn an editable account into a broken one.
    const auth: StoredAccount["auth"] =
      previous?.auth.kind === "oauth2" && !request.password
        ? previous.auth
        : {kind: "password"};

    // A mailbox set up as "Other" carries only hostnames — the form has no port
    // or encryption field — so a provider whose ports are not the usual ones
    // would be unreachable. Where the host is one we know, its own settings
    // win over the generic defaults that came with the request.
    const known = presetForHost(request.smtpHost);
    const account: StoredAccount = {
      id: request.id,
      email: request.email,
      ...(request.displayName ? {displayName: request.displayName} : {}),
      ...(request.isDefault ? {isDefault: true} : {}),
      imap: {
        host: request.imapHost,
        port: request.imapPort,
        encryption: request.imapEncryption,
        login,
      },
      smtp: {
        host: request.smtpHost,
        port: known?.smtpPort ?? request.smtpPort,
        encryption: known?.smtpEncryption ?? request.smtpEncryption,
        login: smtpLogin,
      },
      auth,
    };

    if (request.password) await this.#secrets.write(request.id, login, "password", request.password);
    // A rename moves the keychain entries with the account; without this the
    // credential is orphaned under an id nothing refers to any more.
    else if (renamed) await this.#secrets.rename(request.originalId!, request.id, login);

    const next = accounts.filter((item) => item.id !== previousId && item.id !== request.id);
    next.push(account);
    // Exactly one default, or which mailbox a bare request means is a guess.
    await this.#write(
      request.isDefault
        ? next.map((item) => (item.id === account.id ? item : dropDefault(item)))
        : next,
    );
    await this.#store.disconnect(previousId);
    if (renamed) await this.#store.disconnect(request.id);
  }

  async remove(id: string): Promise<void> {
    const accounts = await this.#accounts();
    const account = accounts.find((item) => item.id === id);
    if (!account) return;
    await this.#write(accounts.filter((item) => item.id !== id));
    await this.#store.disconnect(id);
    await this.#secrets.removeAll(id, account.imap.login);
  }

  /** Proves the account works by opening a connection and listing its folders. */
  async test(id: string): Promise<CommsEmailAccountDto> {
    const accounts = await this.#accounts();
    const account = accounts.find((item) => item.id === id);
    if (!account) throw new Error(`No email account named ${id}`);
    const dto = await this.#toDto(account);
    // Connecting *is* the test, and it leaves behind the connection the first
    // click would otherwise have waited for.
    try {
      await this.#store.check(id);
      return {...dto, status: "ok", error: null};
    } catch (cause) {
      return {...dto, status: "error", error: reason(cause)};
    }
  }

  /** Folders, classified by the special-use flags IMAP advertises for them. */
  async folders(account?: string): Promise<MailFolderDto[]> {
    return this.#store.folders(await this.#accountId(account));
  }

  /** Message envelopes in a folder, newest first. */
  async envelopes(options: {
    account?: string;
    folder?: string;
    page?: number;
    pageSize?: number;
    query?: string;
    sort?: "date-desc" | "date-asc" | "subject" | "from";
  }): Promise<MailEnvelopeDto[]> {
    return this.#store.envelopes({
      account: await this.#accountId(options.account),
      folder: options.folder ?? "INBOX",
      page: options.page,
      pageSize: options.pageSize,
      query: options.query,
      sort: options.sort,
    });
  }

  async message(options: {
    id: string;
    account?: string;
    folder?: string;
  }): Promise<MailMessageDto> {
    return this.#store.message({
      account: await this.#accountId(options.account),
      folder: options.folder ?? "INBOX",
      id: options.id,
    });
  }

  /**
   * Sends a message, or saves it to Drafts.
   *
   * A draft never reaches the network as mail: it is appended to the mailbox's
   * own Drafts folder over the connection already open, so it appears wherever
   * the user reads their mail and can be finished on a phone.
   */
  async send(options: {
    account?: string;
    from: string;
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
  }): Promise<void> {
    const accountId = await this.#accountId(options.account);
    const account = await this.#account(accountId);
    const files = await Promise.all(
      (options.attachments ?? []).map(async (file) => ({
        name: path.basename(file),
        mime: mimeType(file),
        content: await (await import("node:fs/promises")).readFile(file),
      })),
    );
    const messageId = newMessageId(options.from);
    // The draft keeps its Bcc; the sent copy must not carry one.
    const raw = mimeMessage({
      ...options,
      attachments: files,
      messageId,
      retainBcc: options.draft === true,
    });
    if (options.draft) {
      const folders = await this.folders(accountId);
      const drafts = folders.find((folder) => folder.role === "drafts")?.name ?? "Drafts";
      await this.#store
        .append({account: accountId, folder: drafts, raw, flags: ["\\Draft"]})
        .catch((cause: unknown) => {
          throw new Error(`Could not save the draft: ${reason(cause)}`);
        });
      return;
    }
    const deliver = async (): Promise<void> => {
      const transport = await this.#transport(account);
      await transport.sendMail({
        envelope: {
          from: account.email,
          to: [...options.to, ...options.cc, ...options.bcc],
        },
        raw,
      });
    };
    try {
      await deliver();
      await this.#fileInSent(accountId, raw, messageId);
    } catch (cause) {
      // A bearer token that expired between opening the app and pressing send
      // is refused exactly like a wrong password. Reading it a second time is
      // the same one-shot renewal the mailbox connection already does — and it
      // is only ever tried once, so a genuinely wrong credential fails rather
      // than being retried forever. A send that failed for any other reason is
      // never retried: it may have been delivered already.
      if (account.auth.kind !== "password" && isAuthFailure(cause)) {
        await this.#renew(account.id).catch((): undefined => undefined);
        try {
          await deliver();
          await this.#fileInSent(accountId, raw, messageId);
          return;
        } catch (second) {
          throw new Error(`Could not send the email: ${reason(second)}`);
        }
      }
      throw new Error(`Could not send the email: ${reason(cause)}`);
    }
  }

  /**
   * Puts a copy of a sent message in Sent, if the provider has not already.
   *
   * Whether SMTP submission files a copy is the provider's decision and nothing
   * in the protocol announces it: Gmail and Office365 do, a plain IMAP/SMTP host
   * generally does not. Appending regardless would give duplicates on the first
   * kind, and appending never loses the record entirely on the second — so
   * instead the folder is asked. The message carries a Message-ID of our own
   * precisely so that question can be answered.
   *
   * Failure here is never a failed send. The mail has already gone; saying
   * otherwise would invite the user to send it a second time.
   */
  async #fileInSent(accountId: string, raw: string, messageId: string): Promise<void> {
    try {
      const account = await this.#account(accountId);
      // Once the answer is known it does not change: a provider either files
      // its own copies or it does not, so every later send acts on what the
      // first one found rather than asking again.
      if (account.filesSentCopy === true) return;
      const sent = (await this.folders(accountId)).find((folder) => folder.role === "sent");
      if (!sent) return;
      if (account.filesSentCopy === false) {
        await this.#store.append({account: accountId, folder: sent.name, raw, flags: ["\\Seen"]});
        return;
      }
      // The first send is the only experiment available. A provider that files
      // its own copy may take a moment over it, and a duplicate is worse than
      // a short wait.
      for (let attempt = 0; attempt < SENT_LOOKUPS; attempt++) {
        if (await this.#store.contains({account: accountId, folder: sent.name, messageId})) {
          await this.#learn(accountId, true);
          return;
        }
        if (attempt < SENT_LOOKUPS - 1)
          await new Promise((done) => setTimeout(done, SENT_LOOKUP_WAIT_MS));
      }
      await this.#store.append({account: accountId, folder: sent.name, raw, flags: ["\\Seen"]});
      await this.#learn(accountId, false);
    } catch {
      // Deliberately silent: see above.
    }
  }

  /** Records what the first send discovered about this provider. */
  async #learn(accountId: string, filesSentCopy: boolean): Promise<void> {
    const accounts = await this.#accounts();
    if (!accounts.some((item) => item.id === accountId)) return;
    await this.#write(
      accounts.map((item) => (item.id === accountId ? {...item, filesSentCopy} : item)),
    );
  }

  /** Erases messages outright, with no folder to recover them from. */
  async delete(options: {ids: string[]; account?: string; folder?: string}): Promise<void> {
    if (options.ids.length === 0) return;
    await this.#store
      .delete({
        account: await this.#accountId(options.account),
        folder: options.folder ?? "INBOX",
        ids: options.ids,
      })
      .catch((cause: unknown) => {
        throw new Error(`Could not delete the message: ${reason(cause)}`);
      });
  }

  /** Saves a message's attachments and reports where they landed. */
  async download(options: {id: string; account?: string; folder?: string}): Promise<string[]> {
    const accountId = await this.#accountId(options.account);
    const files = await this.#store
      .attachments({account: accountId, folder: options.folder ?? "INBOX", id: options.id})
      .catch((cause: unknown) => {
        throw new Error(`Could not save the attachments: ${reason(cause)}`);
      });
    await mkdir(this.#downloadsDir, {recursive: true});
    const written: string[] = [];
    for (const file of files) {
      const destination = await this.#free(path.join(this.#downloadsDir, safeName(file.name)));
      await writeFile(destination, file.content);
      written.push(destination);
    }
    return written;
  }

  /** Moves messages to another folder, which is how junk and trash are applied. */
  async move(options: {
    ids: string[];
    target: string;
    account?: string;
    folder?: string;
  }): Promise<void> {
    if (options.ids.length === 0) return;
    await this.#store
      .move({
        account: await this.#accountId(options.account),
        folder: options.folder ?? "INBOX",
        ids: options.ids,
        target: options.target,
      })
      .catch((cause: unknown) => {
        throw new Error(`Could not move the message: ${reason(cause)}`);
      });
  }

  async flag(options: {
    ids: string[];
    flag: "seen" | "flagged";
    on: boolean;
    account?: string;
    folder?: string;
  }): Promise<void> {
    if (options.ids.length === 0) return;
    await this.#store
      .flag({
        account: await this.#accountId(options.account),
        folder: options.folder ?? "INBOX",
        ids: options.ids,
        flag: options.flag,
        on: options.on,
      })
      .catch((cause: unknown) => {
        throw new Error(`Could not update the message: ${reason(cause)}`);
      });
  }

  /** Closes every held connection. */
  async close(): Promise<void> {
    await this.#store.close();
  }

  /** An SMTP transport for one send, authenticated the account's own way. */
  async #transport(account: StoredAccount): Promise<nodemailer.Transporter> {
    const secret = await this.#secret(account);
    return nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.encryption === "tls",
      requireTLS: account.smtp.encryption === "start-tls",
      auth:
        account.auth.kind === "password"
          ? {user: account.smtp.login, pass: secret}
          : {type: "OAuth2", user: account.smtp.login, accessToken: secret},
    });
  }

  /**
   * The account's current credential, renewing an expired OAuth token when the
   * stored one has run out. A password is simply what is in the keychain.
   */
  async #secret(account: StoredAccount): Promise<string> {
    if (account.auth.kind === "command") {
      // Asked again each time rather than stored: the command is a token
      // helper that refreshes on its own, so its answer is only good for as
      // long as the token it just minted. Held briefly in memory so a burst of
      // prefetches does not run it once per message.
      const cached = this.#commandTokens.get(account.id);
      if (cached && cached.until > Date.now()) return cached.token;
      const token = await this.#print(account.auth.cmd);
      if (!token)
        throw new Error(
          `The token command for ${account.email} printed nothing. Check that it still runs.`,
        );
      this.#commandTokens.set(account.id, {token, until: Date.now() + COMMAND_TOKEN_MS});
      return token;
    }
    if (account.auth.kind === "password") {
      const password = await this.#secrets.read(account.id, account.imap.login, "password");
      if (!password) throw new Error(`No password is stored for ${account.email}.`);
      return password;
    }
    const token = await this.#secrets.read(account.id, account.imap.login, "access-token");
    if (token) return token;
    return this.#renewNow(account);
  }

  /**
   * Exchanges the refresh token for a new access token and files it.
   *
   * A rotated refresh token is stored before the access token, because losing
   * a rotated refresh token means the account can never renew again — while
   * losing the access token merely costs one more exchange.
   */
  async #renewNow(account: StoredAccount): Promise<string> {
    if (account.auth.kind !== "oauth2")
      throw new Error(`${account.email} does not sign in with a token.`);
    const refresh = await this.#secrets.read(account.id, account.imap.login, "refresh-token");
    if (!refresh)
      throw new Error(`${account.email} needs to be signed in again.`);
    // The client secret, where the provider issues one, is held in the
    // keychain like every other credential rather than in the account file.
    const clientSecret = account.auth.hasClientSecret
      ? await this.#secrets.read(account.id, account.imap.login, "client-secret")
      : null;
    if (!account.auth.provider)
      throw new Error(`${account.email} needs to be signed in again.`);
    const renewed = await renewMailToken(account.auth.provider, {
      clientId: account.auth.clientId,
      ...(clientSecret ? {clientSecret} : {}),
      refreshToken: refresh,
      ...(this.#fetch ? {fetch: this.#fetch} : {}),
    });
    if (renewed.refreshToken)
      await this.#secrets.write(account.id, account.imap.login, "refresh-token", renewed.refreshToken);
    await this.#secrets.write(account.id, account.imap.login, "access-token", renewed.accessToken);
    return renewed.accessToken;
  }

  /**
   * Asked by the connection layer when a login was refused: the stored access
   * token has expired, so it is discarded and exchanged for a new one. The
   * connection is opened again afterwards and reads the fresh token.
   */
  async #renew(accountId: string): Promise<void> {
    const account = await this.#account(accountId);
    if (account.auth.kind === "command") {
      // The helper is what renews; all this side has to do is stop reusing
      // the token it was last given.
      this.#commandTokens.delete(accountId);
      return;
    }
    if (account.auth.kind !== "oauth2") return;
    await this.#secrets.remove(accountId, account.imap.login, "access-token");
    await this.#renewNow(account);
  }

  /** The connection details for an account, secret included. */
  async #credentials(accountId: string): Promise<MailCredentials | null> {
    const accounts = await this.#accounts();
    const account = accounts.find((item) => item.id === accountId);
    if (!account) return null;
    return {
      host: account.imap.host,
      port: account.imap.port,
      encryption: account.imap.encryption,
      login: account.imap.login,
      kind: account.auth.kind === "password" ? "password" : "oauth2",
      secret: await this.#secret(account),
    };
  }

  async #account(accountId: string): Promise<StoredAccount> {
    const accounts = await this.#accounts();
    const account = accounts.find((item) => item.id === accountId);
    if (!account) throw new Error(`No email account named ${accountId}`);
    return account;
  }

  /**
   * The account an operation belongs to, defaulting to the one the user marked
   * as theirs rather than making every caller know about the default.
   */
  async #accountId(account?: string): Promise<string> {
    if (account) return account;
    const accounts = await this.#accounts();
    const chosen = accounts.find((item) => item.isDefault) ?? accounts[0];
    if (!chosen) throw new Error("No email account is set up yet.");
    return chosen.id;
  }

  async #accounts(): Promise<StoredAccount[]> {
    await this.#adopt();
    return readAccounts(this.#storePath);
  }

  async #write(accounts: StoredAccount[]): Promise<void> {
    await writeAccounts(this.#storePath, accounts);
  }

  /**
   * Adopts the accounts of an earlier Polymux that kept them in a Himalaya
   * config, once. Runs only where Polymux has no accounts of its own, so it
   * cannot overwrite anything, and never touches the file it read.
   */
  #adopt(): Promise<void> {
    this.#imported ??= this.#adoptOnce().catch((): undefined => undefined);
    return this.#imported;
  }

  async #adoptOnce(): Promise<void> {
    if (!this.#importFrom) return;
    // The guard is the file's existence, not its contents. Keyed on "no
    // accounts", deleting the last mailbox would import all of them back on
    // the next launch, secrets and all — an undo that undoes the user.
    const {access} = await import("node:fs/promises");
    const adopted = await access(this.#storePath).then(
      (): boolean => true,
      (): boolean => false,
    );
    if (adopted) return;
    const accounts = await importHimalayaAccounts(this.#importFrom);
    if (!accounts.length) return;
    const {readFile} = await import("node:fs/promises");
    const config = await readFile(this.#importFrom, "utf8").catch((): string => "");
    for (const account of accounts) {
      // A command account keeps its command; there is no secret to carry, and
      // one reading of it would expire.
      if (account.auth.kind === "command") continue;
      const sources = himalayaSecrets(config, account.id);
      for (const [kind, source] of [
        ["password", sources.password],
        ["access-token", sources.accessToken],
        ["refresh-token", sources.refreshToken],
        ["client-secret", sources.clientSecret],
      ] as const) {
        if (!source) continue;
        const secret = source.raw ?? (await this.#print(source.cmd ?? ""));
        if (secret) await this.#secrets.write(account.id, account.imap.login, kind, secret);
      }
    }
    await writeAccounts(this.#storePath, accounts);
  }

  /** Runs a credential command from the old config, which was shell syntax. */
  async #print(command: string): Promise<string> {
    if (!command) return "";
    const result = await this.#run("/bin/sh", ["-c", command]).catch(
      (): CommandResult => ({code: -1, stdout: "", stderr: ""}),
    );
    return result.code === 0 ? result.stdout.trim() : "";
  }

  /** A path that does not exist yet, so a second save cannot overwrite a first. */
  async #free(destination: string): Promise<string> {
    const {access} = await import("node:fs/promises");
    const extension = path.extname(destination);
    const base = destination.slice(0, destination.length - extension.length);
    for (let index = 0; index < 100; index++) {
      const candidate = index === 0 ? destination : `${base} (${index})${extension}`;
      const taken = await access(candidate).then(
        (): boolean => true,
        (): boolean => false,
      );
      if (!taken) return candidate;
    }
    return `${base} (${Date.now()})${extension}`;
  }

  async #toDto(account: StoredAccount): Promise<CommsEmailAccountDto> {
    return {
      id: account.id,
      displayName: account.displayName ?? null,
      email: account.email,
      isDefault: account.isDefault === true,
      incoming: toEndpoint(account.imap, "imap", account.auth.kind),
      outgoing: toEndpoint(account.smtp, "smtp", account.auth.kind),
      secretStored: await this.#secrets.held(account.id, account.imap.login),
      status: "unknown",
      error: null,
    };
  }
}

function toEndpoint(
  endpoint: StoredEndpoint,
  kind: "imap" | "smtp",
  auth: StoredAccount["auth"]["kind"],
): CommsEmailEndpointDto {
  return {
    kind,
    host: endpoint.host,
    port: endpoint.port,
    encryption: endpoint.encryption,
    login: endpoint.login,
    // A command account is signed in by something outside Polymux; saying
    // "password" would invite the user to change one that does not exist.
    auth: auth === "oauth2" ? "oauth2" : auth === "command" ? "command" : "password",
  };
}

function dropDefault(account: StoredAccount): StoredAccount {
  if (!account.isDefault) return account;
  const {isDefault, ...rest} = account;
  void isDefault;
  return rest;
}

/** A short, unique id for a newly signed-in mailbox. */
function accountId(address: string, taken: StoredAccount[]): string {
  const base = address.split("@")[0]?.replace(/[^a-z0-9._-]/gi, "").toLowerCase() || "mail";
  if (!taken.some((item) => item.id === base)) return base;
  for (let index = 2; ; index++) {
    const candidate = `${base}${index}`;
    if (!taken.some((item) => item.id === candidate)) return candidate;
  }
}

/** A filename that cannot climb out of the downloads directory. */
function safeName(name: string): string {
  const leaf = path.basename(name).replace(/[/\\]/g, "-").trim();
  return leaf && leaf !== "." && leaf !== ".." ? leaf : "attachment";
}

/** Whether a server refused the credential, as opposed to anything else. */
function isAuthFailure(cause: unknown): boolean {
  const text = cause instanceof Error ? cause.message : String(cause);
  const code = cause instanceof Error ? String((cause as {code?: unknown}).code ?? "") : "";
  return /auth|credential|password|token|login|535|534/i.test(`${code} ${text}`);
}

/**
 * An error's own words, for a message shown to the user. A refusal from a mail
 * server carries its explanation in `responseText` — "Invalid credentials" —
 * while the message is the generic "Command failed", so the server's own
 * sentence is preferred wherever there is one.
 */
function reason(cause: unknown): string {
  if (cause instanceof Error) {
    const detail = cause as {
      responseText?: unknown;
      error_description?: unknown;
      error?: unknown;
    };
    const response = detail.responseText;
    if (typeof response === "string" && response.trim()) return response.trim();
    // An OAuth refusal says everything useful in the body rather than the
    // message — "invalid_grant" is the one that means sign in again, and the
    // library's own text is the unhelpfully generic half.
    const described = detail.error_description ?? detail.error;
    if (typeof described === "string" && described.trim()) return described.trim();
    if (cause.message.trim()) return cause.message.trim();
  }
  const text = String(cause).trim();
  return text || "The mail server did not say why.";
}
