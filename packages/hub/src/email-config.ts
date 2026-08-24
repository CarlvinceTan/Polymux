import {readFile, writeFile, mkdir, rename} from "node:fs/promises";
import path from "node:path";
import {parse as parseToml} from "smol-toml";

/**
 * Polymux's own record of the user's mailboxes.
 *
 * An account is described here and nowhere else. What the file never holds is
 * a secret: passwords and OAuth tokens live in the OS keychain, and this names
 * only the account they are filed under. So the file can be read, copied or
 * backed up without carrying a credential with it.
 */
export interface StoredEndpoint {
  host: string;
  port: number;
  encryption: "tls" | "start-tls" | "none";
  login: string;
}

/** How an account proves who it is. */
export type StoredAuth =
  | {kind: "password"}
  | {
      kind: "oauth2";
      clientId: string;
      /**
       * Which provider this is, when Polymux signed the account in itself.
       * Renewal then goes through the OAuth library's discovery rather than a
       * URL written down here. An account adopted from a foreign config has no
       * provider — only the token endpoint it was configured with.
       */
      provider?: "google" | "microsoft";
      tokenUrl: string;
      scope?: string;
      /**
       * Whether a client secret is filed in the keychain for this account. The
       * secret itself is never written here — a provider issuing public
       * clients (PKCE) has none at all, and one that does not is holding a
       * credential, which this file does not carry.
       */
      hasClientSecret?: boolean;
    }
  /**
   * A token produced by a command the user configured.
   *
   * This is the only honest description of an account whose sign-in is held by
   * something outside Polymux — a token helper the user already runs, which
   * refreshes on its own. Polymux cannot renew such an account, because it was
   * never given the refresh token: it can only ask, each time, for whatever the
   * command prints. Storing one reading of that command would work for an hour
   * and then leave the mailbox dead.
   *
   * The command is the user's, from their own configuration. It is never
   * invented, and an account only becomes one of these by having been one.
   */
  | {kind: "command"; cmd: string};

export interface StoredAccount {
  id: string;
  email: string;
  displayName?: string;
  isDefault?: boolean;
  /**
   * Whether this account's provider files its own copy of a sent message.
   *
   * Nothing in the protocols answers this. RFC 6154 defines the `\Sent` folder
   * and then declines to say who fills it — a server "might put messages here
   * automatically", or it "might just be advice that a client save sent
   * messages here" — and there is no capability or response code by which to
   * ask. So it is learnt from the one experiment available: send once, look.
   *
   * Learnt rather than probed each time because it is a property of the
   * account's submission and store pair, not of the message. Absent until the
   * first send has answered it.
   */
  filesSentCopy?: boolean;
  imap: StoredEndpoint;
  smtp: StoredEndpoint;
  auth: StoredAuth;
}

interface StoreFile {
  version: 1;
  accounts: StoredAccount[];
}

/** Reads the account file, answering an empty set when there is not one yet. */
export async function readAccounts(file: string): Promise<StoredAccount[]> {
  const source = await readFile(file, "utf8").catch(
    (error: NodeJS.ErrnoException): string | undefined => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (!source) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    // A corrupt file is not a reason to answer "you have no mail accounts",
    // which reads as data loss and invites the user to add them again.
    throw new Error(`The email account file at ${file} could not be read.`);
  }
  if (!parsed || typeof parsed !== "object") return [];
  const accounts = (parsed as Partial<StoreFile>).accounts;
  return Array.isArray(accounts) ? accounts.filter(isAccount) : [];
}

/**
 * Replaces the account file. Written to a sibling and renamed over the
 * destination, so a reader sees the previous file or the new one and never a
 * half-written list of the user's mailboxes.
 */
export async function writeAccounts(file: string, accounts: StoredAccount[]): Promise<void> {
  await mkdir(path.dirname(file), {recursive: true});
  const body = `${JSON.stringify({version: 1, accounts} satisfies StoreFile, null, 2)}\n`;
  const temporary = `${file}.${process.pid}.tmp`;
  // 0600: it names hosts, logins and the shape of the user's correspondence.
  await writeFile(temporary, body, {encoding: "utf8", mode: 0o600});
  await rename(temporary, file);
}

function isAccount(value: unknown): value is StoredAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<StoredAccount>;
  return (
    typeof account.id === "string" &&
    typeof account.email === "string" &&
    !!account.imap &&
    !!account.smtp &&
    !!account.auth
  );
}

/**
 * The accounts described by a Himalaya config, for the one-time import.
 *
 * Polymux used to keep its mailboxes in Himalaya's file and drive its CLI.
 * Nothing does now — but a user who set accounts up under that arrangement has
 * them there and nowhere else, and silently starting them at zero would read
 * as having lost them. So the file is read once, on a machine that has one and
 * no accounts of Polymux's own, and then never again. It is never written to
 * and never deleted: it is not ours, and leaving it whole is what lets the
 * import be undone by deleting *our* file.
 *
 * Credentials cannot come across as data. The config names a command that
 * prints each secret; `readSecret` runs it, and the result is filed in
 * Polymux's own keychain entries by the caller.
 */
export async function importHimalayaAccounts(file: string): Promise<StoredAccount[]> {
  const source = await readFile(file, "utf8").catch((): string | undefined => undefined);
  if (!source) return [];
  let parsed: unknown;
  try {
    parsed = parseToml(source);
  } catch {
    return [];
  }
  const accounts = table(parsed)?.accounts;
  const entries = table(accounts);
  if (!entries) return [];
  const imported: StoredAccount[] = [];
  for (const [id, value] of Object.entries(entries)) {
    const account = table(value);
    if (!account) continue;
    const backend = table(account.backend);
    const send = table(table(table(account.message)?.send)?.backend);
    if (!backend || backend.type !== "imap") continue;
    const email = typeof account.email === "string" ? account.email : "";
    if (!email) continue;
    const auth = table(backend.auth);
    const oauth = auth?.type === "oauth2";
    imported.push({
      id,
      email,
      ...(typeof account["display-name"] === "string"
        ? {displayName: account["display-name"]}
        : {}),
      ...(account.default === true ? {isDefault: true} : {}),
      imap: endpoint(backend, email, 993),
      smtp: endpoint(send ?? {}, email, 587),
      auth: importedAuth(auth, oauth),
    });
  }
  return imported;
}

export interface Source {
  cmd?: string;
  raw?: string;
}

/** Where a Himalaya account keeps each of its secrets. */
export function himalayaSecrets(config: string, id: string): {
  password: Source | null;
  accessToken: Source | null;
  refreshToken: Source | null;
  clientSecret: Source | null;
} {
  let parsed: unknown;
  try {
    parsed = parseToml(config);
  } catch {
    return {password: null, accessToken: null, refreshToken: null, clientSecret: null};
  }
  const account = table(table(table(parsed)?.accounts)?.[id]);
  const auth = table(table(account?.backend)?.auth);
  if (!auth) return {password: null, accessToken: null, refreshToken: null, clientSecret: null};
  if (auth.type === "oauth2")
    return {
      password: null,
      accessToken: source(auth["access-token"]),
      refreshToken: source(auth["refresh-token"]),
      clientSecret: source(auth["client-secret"]),
    };
  return {password: source(auth), accessToken: null, refreshToken: null, clientSecret: null};
}

/**
 * How an imported account signs in.
 *
 * An OAuth account is only carried across as OAuth if Polymux can actually
 * renew it — which needs a refresh token it can read. Where the old setup
 * delegated renewal to a command (a token helper that refreshes on its own),
 * that command comes across instead: it is the only thing that knows how to
 * get a fresh token, and reading it once would give an account that works
 * until the token expires and then stops.
 */
function importedAuth(auth: Record<string, unknown> | null, oauth: boolean): StoredAuth {
  if (!oauth) return {kind: "password"};
  const refresh = source(auth?.["refresh-token"]);
  const accessCommand = source(auth?.["access-token"])?.cmd;
  // A keyring reference names an entry in someone else's keychain namespace,
  // which Polymux cannot resolve; it counts as no refresh token at all.
  const hasRefresh = !!refresh && (!!refresh.raw || !!refresh.cmd);
  // Renewal goes through the OAuth library, which works from a provider rather
  // than a bare endpoint — so an account is only carried across as OAuth if we
  // can tell whose it is. Anything else has no way to renew and would go dead
  // at the first expiry, which is exactly the failure this import exists to
  // avoid: the command keeps it alive until the user signs in properly.
  const provider = providerFor(string(auth?.["token-url"]));
  if ((!hasRefresh || !provider) && accessCommand) return {kind: "command", cmd: accessCommand};
  const clientSecret = source(auth?.["client-secret"]);
  return {
    kind: "oauth2",
    clientId: string(auth?.["client-id"]),
    ...(provider ? {provider} : {}),
    // Only a secret with something in it. The key being present says nothing:
    // a public client writes it empty, and claiming to hold one we never
    // stored makes the account file disagree with the keychain.
    ...(clientSecret && (clientSecret.raw || clientSecret.cmd) ? {hasClientSecret: true} : {}),
    tokenUrl: string(auth?.["token-url"]),
    ...(string(auth?.scope) ? {scope: string(auth?.scope)} : {}),
  };
}

/** Whose token endpoint this is, where we recognise it. */
function providerFor(tokenUrl: string): "google" | "microsoft" | undefined {
  const host = tokenUrl.toLowerCase();
  if (host.includes("googleapis.com") || host.includes("accounts.google.com")) return "google";
  if (host.includes("microsoftonline.com")) return "microsoft";
  return undefined;
}

function source(value: unknown): Source | null {
  if (typeof value === "string") return {raw: value};
  const entry = table(value);
  if (!entry) return null;
  if (typeof entry.raw === "string") return {raw: entry.raw};
  if (typeof entry.cmd === "string") return {cmd: entry.cmd};
  return null;
}

function endpoint(value: Record<string, unknown>, email: string, fallbackPort: number): StoredEndpoint {
  const encryption = table(value.encryption)?.type ?? value.encryption;
  return {
    host: string(value.host),
    port: typeof value.port === "number" ? value.port : fallbackPort,
    encryption:
      encryption === "start-tls" || encryption === "none" ? encryption : "tls",
    login: string(value.login) || email,
  };
}

function table(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
