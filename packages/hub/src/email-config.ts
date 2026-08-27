import {readFile, writeFile, mkdir, rename} from "node:fs/promises";
import path from "node:path";

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

export interface StoredMailSignature {
  id: string;
  name: string;
  body: string;
  html?: string | null;
}

/** How an account proves who it is. */
export type StoredAuth =
  | {kind: "password"}
  | {
      kind: "oauth2";
      clientId: string;
      provider: "google" | "microsoft";
      /**
       * Whether a client secret is filed in the keychain for this account. The
       * secret itself is never written here — a provider issuing public
       * clients (PKCE) has none at all, and one that does not is holding a
       * credential, which this file does not carry.
       */
      hasClientSecret?: boolean;
    };

export interface StoredAccount {
  id: string;
  email: string;
  displayName?: string;
  signatures?: StoredMailSignature[];
  defaultSignatureId?: string;
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
  return Array.isArray(accounts) ? accounts.filter(isAccount).map(withoutLegacyDefault) : [];
}

/**
 * Replaces the account file. Written to a sibling and renamed over the
 * destination, so a reader sees the previous file or the new one and never a
 * half-written list of the user's mailboxes.
 */
export async function writeAccounts(file: string, accounts: StoredAccount[]): Promise<void> {
  await mkdir(path.dirname(file), {recursive: true});
  const current = accounts.map(withoutLegacyDefault);
  const body = `${JSON.stringify({version: 1, accounts: current} satisfies StoreFile, null, 2)}\n`;
  const temporary = `${file}.${process.pid}.tmp`;
  // 0600: it names hosts, logins and the shape of the user's correspondence.
  await writeFile(temporary, body, {encoding: "utf8", mode: 0o600});
  await rename(temporary, file);
}

/** Old pre-release builds stored a preferred mailbox. It never affected the
 * mailbox itself, so drop it as the file is read or rewritten. */
function withoutLegacyDefault(account: StoredAccount): StoredAccount {
  const {isDefault: _isDefault, ...current} = account as StoredAccount & {
    isDefault?: unknown;
  };
  void _isDefault;
  return current;
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
