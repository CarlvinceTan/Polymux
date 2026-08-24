import {execFile} from "node:child_process";
import {createDecipheriv, pbkdf2Sync} from "node:crypto";
import {existsSync} from "node:fs";
import {copyFile, mkdtemp, readFile, rm} from "node:fs/promises";
import {homedir, tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {promisify} from "node:util";
import {
  cookieUrl,
  WINDOWS_EPOCH_OFFSET_SECONDS,
  type ImportedCookie,
  type ImportedData,
  type ImportedLogin,
  type ImportedProfile,
  type ImportedVisit,
} from "./types.js";

/**
 * Reads cookies and saved logins out of a Chromium browser's own SQLite stores
 * on macOS.
 *
 * The scheme is the one every Chromium fork inherited: values are AES-128-CBC
 * blobs whose key is stretched from a per-app secret kept in the login
 * keychain. So the work here is the same shape as `wechat-head-images.ts` —
 * derive the key, decrypt with `node:crypto`, read the plaintext with the same
 * `node:sqlite` the rest of the app uses. No native module, no npm dependency,
 * and the source browser's files are only ever read: every database is copied
 * to a temp dir before it is opened, because a running browser holds its
 * `Cookies` file in WAL mode and the newest rows live in the `-wal` sidecar.
 *
 * Scope is deliberately macOS and the classic `v10` scheme only. App-bound
 * encryption (`v20`) is a Windows-only DPAPI construction; there is no `v20`
 * path here because there are no `v20` blobs to read on a Mac.
 */

/** A Chromium browser this can read, and where it keeps its things. */
export interface ChromiumBrowser {
  /** Stable slug used in problem messages and profile ids. */
  id: string;
  name: string;
  /**
   * Where the "User Data" directory sits, relative to
   * `~/Library/Application Support`. It holds `Local State` and the profile
   * folders (`Default`, `Profile 1`, …).
   */
  dataDir: string;
  /**
   * The exact generic-password service name the browser stored its Safe
   * Storage secret under. This string is not guessable from the app name — a
   * fork picks its own — so each is spelled out.
   */
  keychain: string;
}

/**
 * The forks worth offering to import from. Arc and Dia (both The Browser
 * Company) nest their profiles under a `User Data` subfolder the way upstream
 * Chromium's installer scripts do; the rest put `Local State` at the top of
 * their support directory.
 */
export const CHROMIUM_BROWSERS: readonly ChromiumBrowser[] = [
  {id: "chrome", name: "Google Chrome", dataDir: "Google/Chrome", keychain: "Chrome Safe Storage"},
  {id: "edge", name: "Microsoft Edge", dataDir: "Microsoft Edge", keychain: "Microsoft Edge Safe Storage"},
  {id: "brave", name: "Brave", dataDir: "BraveSoftware/Brave-Browser", keychain: "Brave Safe Storage"},
  {id: "arc", name: "Arc", dataDir: "Arc/User Data", keychain: "Arc Safe Storage"},
  {id: "dia", name: "Dia", dataDir: "Dia/User Data", keychain: "Dia Safe Storage"},
  {id: "vivaldi", name: "Vivaldi", dataDir: "Vivaldi", keychain: "Vivaldi Safe Storage"},
  {id: "opera", name: "Opera", dataDir: "com.operasoftware.Opera", keychain: "Opera Safe Storage"},
  {id: "chromium", name: "Chromium", dataDir: "Chromium", keychain: "Chromium Safe Storage"},
];

/** Absolute path to a browser's "User Data" directory for a given home. */
export function chromiumUserDataDir(browser: ChromiumBrowser, home: string = homedir()): string {
  return path.join(home, "Library/Application Support", browser.dataDir);
}

/** PBKDF2 parameters Chromium fixed on macOS and never changed. AES-128, so a
 * 16-byte key; the salt and iteration count are constants, not stored anywhere. */
const SALT = "saltysalt";
const ITERATIONS = 1003;
const KEY_LENGTH = 16;

/** IV is sixteen spaces (0x20), the same for every blob — the confidentiality
 * comes from the key, which is per-app and behind the keychain. */
const IV = Buffer.alloc(16, 0x20);

/** Every encrypted value carries this ASCII tag; a byte string without it is
 * either a legacy plaintext value or not ours to decrypt. */
const V10 = "v10";

/**
 * The AES key for a browser, stretched from its Safe Storage secret. Pure and
 * cheap, so tests can pin it against a known vector without a keychain.
 */
export function deriveKey(secret: string): Buffer {
  return pbkdf2Sync(Buffer.from(secret, "utf8"), Buffer.from(SALT, "utf8"), ITERATIONS, KEY_LENGTH, "sha1");
}

/**
 * Turns one encrypted value into its string, or null when the blob is not a
 * `v10` value this can read. Never throws: a foreign, truncated or corrupt blob
 * is one skipped cookie, not a failed import.
 *
 * `stripDomainHash` is the 2024 change (Cookies `meta.version` >= 24): Chrome
 * began prepending `SHA256(host_key)` — 32 bytes — to a cookie's plaintext
 * before encrypting, as a bind-to-domain check. Those bytes are stripped here
 * and only here, and only for cookies from a new-enough store. Passwords are
 * never domain-prefixed, so the flag is false for logins whatever the version.
 */
export function decryptValue(
  blob: Buffer,
  key: Buffer,
  options: {stripDomainHash: boolean},
): string | null {
  if (blob.length < V10.length) return null;
  if (blob.subarray(0, V10.length).toString("latin1") !== V10) return null;
  const body = blob.subarray(V10.length);
  // CBC only decrypts whole blocks; a length that is not a multiple of 16 is a
  // blob we have no business feeding to the cipher.
  if (body.length === 0 || body.length % 16 !== 0) return null;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, IV);
    // Chrome's own writer occasionally leaves a value whose PKCS#7 trailer is
    // off by a byte, and node's built-in unpadding would reject the whole
    // value for it. Unpad by hand instead: strip a well-formed trailer, keep
    // the bytes when it is malformed rather than losing a readable cookie.
    decipher.setAutoPadding(false);
    let plain: Buffer = Buffer.concat([decipher.update(body), decipher.final()]);
    plain = stripPkcs7(plain);
    if (options.stripDomainHash) {
      // A genuine v24 cookie plaintext is at least the 32-byte hash; anything
      // shorter did not come from this key, so treat it as unreadable.
      if (plain.length < 32) return null;
      plain = plain.subarray(32);
    }
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

/** Removes a valid PKCS#7 trailer, and only a valid one. */
function stripPkcs7(plain: Buffer): Buffer {
  if (plain.length === 0) return plain;
  const pad = plain[plain.length - 1];
  if (pad < 1 || pad > 16 || pad > plain.length) return plain;
  for (let index = plain.length - pad; index < plain.length; index += 1) {
    if (plain[index] !== pad) return plain;
  }
  return plain.subarray(0, plain.length - pad);
}

/**
 * Chromium keeps `expires_utc` as microseconds since 1601-01-01. Returns Unix
 * seconds, which is what an `ImportedCookie` carries, or undefined for a value
 * of 0 — a session cookie, which has no expiry to convert. Takes a bigint
 * because the real numbers (~1.3e16) run past `Number.MAX_SAFE_INTEGER`, so the
 * arithmetic is done in bigint before it narrows to a safe Unix second.
 */
export function chromeTimestampToUnixSeconds(micros: number | bigint): number | undefined {
  const value = typeof micros === "bigint" ? micros : BigInt(Math.trunc(micros));
  if (value <= 0n) return undefined;
  return Number(value / 1_000_000n - BigInt(WINDOWS_EPOCH_OFFSET_SECONDS));
}

/** Chromium's `samesite` column, in Electron's vocabulary. */
function sameSiteFrom(value: number): ImportedCookie["sameSite"] {
  switch (value) {
    case 0:
      return "no_restriction";
    case 1:
      return "lax";
    case 2:
      return "strict";
    default:
      // -1, and anything a newer schema invents, is "unspecified".
      return "unspecified";
  }
}

/**
 * The profiles a browser's `Local State` declares, in the order it lists them.
 * Falls back to a single "Default" when the file is missing or unreadable — a
 * fresh profile that has never been renamed has no `info_cache` entry yet but
 * its folder is still there to read.
 */
export async function chromiumProfiles(userDataDir: string): Promise<ImportedProfile[]> {
  const raw = await readFile(path.join(userDataDir, "Local State"), "utf8").catch((): null => null);
  const cache = raw ? infoCache(raw) : null;
  const entries: Array<[string, {name?: string} | null]> =
    cache && Object.keys(cache).length > 0 ? Object.entries(cache) : [["Default", null]];
  return entries.map(([dir, info]) => {
    const directory = path.join(userDataDir, dir);
    const present = existsSync(directory);
    return {
      id: dir,
      name: (info && typeof info.name === "string" && info.name) || dir,
      path: directory,
      readable: present,
      reason: present ? null : "This profile is listed but its folder is missing.",
    };
  });
}

function infoCache(raw: string): Record<string, {name?: string}> | null {
  try {
    const parsed = JSON.parse(raw) as {profile?: {info_cache?: Record<string, {name?: string}>}};
    return parsed.profile?.info_cache ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetches a browser's Safe Storage secret from the login keychain. Injected
 * rather than called inline (see `ChromiumSource.secret`) so nothing under test
 * ever prompts.
 *
 * `security find-generic-password -ws` fires the macOS keychain prompt whose
 * "Always Allow" grant is bound to the *calling app's code signature*. A
 * signed, notarised build is granted once; an unsigned or ad-hoc dev build has
 * a different (or no) signature every run, so it re-prompts each time. That is
 * expected, not a bug to route around.
 */
export async function keychainSecret(item: string): Promise<string> {
  const {stdout} = await promisify(execFile)("/usr/bin/security", ["find-generic-password", "-ws", item]);
  // `-w` prints the password and a trailing newline; only that newline is ours
  // to trim, the secret itself is opaque base64.
  return stdout.replace(/\n$/, "");
}

/**
 * Opens a copy of a SQLite database read-only, never the source. A running
 * browser keeps `Cookies`/`Login Data` in WAL mode, so the `-wal` and `-shm`
 * sidecars are copied alongside — the uncheckpointed rows (a session's newest
 * cookies) live in the `-wal`, and without it they are simply absent.
 */
export async function withDatabaseCopy<T>(dbPath: string, read: (db: DatabaseSync) => T): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "polymux-chromium-"));
  try {
    const copy = path.join(dir, path.basename(dbPath));
    await copyFile(dbPath, copy);
    for (const suffix of ["-wal", "-shm"]) {
      // A cleanly closed browser has already checkpointed and left no sidecar;
      // its absence is normal, not a failure.
      await copyFile(dbPath + suffix, copy + suffix).catch((): undefined => undefined);
    }
    const db = new DatabaseSync(copy, {readOnly: true});
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, {recursive: true, force: true}).catch((): undefined => undefined);
  }
}

/** What one store yields: the rows it could read, plus a line per row it could
 * not, so a single bad cookie never costs the rest. */
type CookieResult = {cookies: ImportedCookie[]; problems: string[]};
type LoginResult = {logins: ImportedLogin[]; problems: string[]};

interface CookieRow {
  host_key: string;
  name: string;
  value: string | null;
  encrypted_value: Uint8Array | null;
  path: string | null;
  is_secure: bigint;
  is_httponly: bigint;
  samesite: bigint;
  has_expires: bigint;
  is_persistent: bigint;
  expires_utc: bigint;
}

/**
 * Every cookie in one `Cookies` database, decrypted. `where` names the store in
 * any problem it reports so a caller aggregating several profiles can tell them
 * apart.
 */
export async function readChromiumCookies(
  cookiesDb: string,
  key: Buffer,
  where = path.basename(path.dirname(cookiesDb)),
): Promise<CookieResult> {
  const cookies: ImportedCookie[] = [];
  const problems: string[] = [];
  try {
    await withDatabaseCopy(cookiesDb, (db) => {
      const stripDomainHash = cookieVersion(db) >= 24;
      const statement = db.prepare(
        "SELECT host_key, name, value, encrypted_value, path, is_secure, is_httponly, " +
          "samesite, has_expires, is_persistent, expires_utc FROM cookies",
      );
      // `expires_utc` overruns a JS number, so every integer comes back as a
      // bigint and is narrowed where it is used.
      statement.setReadBigInts(true);
      for (const row of statement.all() as unknown as CookieRow[]) {
        try {
          const cookie = cookieFromRow(row, key, stripDomainHash);
          if (cookie) cookies.push(cookie);
          else problems.push(`${where}: could not decrypt cookie ${row.name} for ${row.host_key}`);
        } catch (error) {
          problems.push(`${where}: cookie ${row.name} for ${row.host_key}: ${describe(error)}`);
        }
      }
    });
  } catch (error) {
    problems.push(`${where}: could not read cookies: ${describe(error)}`);
  }
  return {cookies, problems};
}

/** One row to an `ImportedCookie`, or null when its value cannot be recovered. */
export function cookieFromRow(row: CookieRow, key: Buffer, stripDomainHash: boolean): ImportedCookie | null {
  let value: string | null;
  if (row.encrypted_value && row.encrypted_value.byteLength > 0) {
    value = decryptValue(Buffer.from(row.encrypted_value), key, {stripDomainHash});
    if (value === null) return null;
  } else {
    // A handful of very old rows never got encrypted and still carry a
    // plaintext `value`; an empty value is a legitimate empty cookie.
    value = row.value ?? "";
  }

  const secure = row.is_secure !== 0n;
  const cookie: ImportedCookie = {
    url: cookieUrl(row.host_key, secure, row.path ?? "/"),
    name: row.name,
    value,
    path: row.path ?? "/",
    secure,
    httpOnly: row.is_httponly !== 0n,
    // Not `Number(row.samesite)` directly: a null column coerces to 0, which
    // is `no_restriction` — the most permissive of the four. Missing is not
    // the same as "the site opted out of same-site protection".
    sameSite: sameSiteFrom(row.samesite == null ? -1 : Number(row.samesite)),
  };
  // A leading dot means "and subdomains" — a domain cookie. Its absence means
  // host-only, which Electron infers from a missing `domain`, so it is left off.
  if (row.host_key.startsWith(".")) cookie.domain = row.host_key;
  // A session cookie (no expiry, or not persisted) carries no expirationDate.
  if (row.has_expires !== 0n && row.is_persistent !== 0n) {
    const expires = chromeTimestampToUnixSeconds(row.expires_utc);
    if (expires !== undefined) cookie.expirationDate = expires;
  }
  return cookie;
}

/** The Cookies schema version, which decides whether cookie plaintext is
 * domain-prefixed. Absent or unparseable reads as 0 — the pre-2024 behaviour. */
function cookieVersion(db: DatabaseSync): number {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as
      | {value?: string | number}
      | undefined;
    return row?.value === undefined ? 0 : Number(row.value) || 0;
  } catch {
    return 0;
  }
}

interface LoginRow {
  origin_url: string;
  username_value: string | null;
  password_value: Uint8Array | null;
  blacklisted_by_user: number;
}

/**
 * Every saved login in one `Login Data` database. Blacklisted origins (sites
 * the user told Chrome never to offer a password for) and rows with no username
 * or no password are skipped — they are not logins there is anything to apply.
 */
export async function readChromiumLogins(
  loginData: string,
  key: Buffer,
  where = path.basename(path.dirname(loginData)),
): Promise<LoginResult> {
  const logins: ImportedLogin[] = [];
  const problems: string[] = [];
  try {
    await withDatabaseCopy(loginData, (db) => {
      const rows = db
        .prepare(
          "SELECT origin_url, username_value, password_value, blacklisted_by_user FROM logins",
        )
        .all() as unknown as LoginRow[];
      for (const row of rows) {
        if (row.blacklisted_by_user) continue;
        const username = row.username_value ?? "";
        if (!username) continue;
        if (!row.password_value || row.password_value.byteLength === 0) continue;
        try {
          // Passwords are never domain-prefixed, whatever the Cookies version.
          const password = decryptValue(Buffer.from(row.password_value), key, {stripDomainHash: false});
          if (!password) {
            problems.push(`${where}: could not decrypt password for ${row.origin_url}`);
            continue;
          }
          const origin = originOf(row.origin_url);
          if (!origin) {
            problems.push(`${where}: unusable origin ${row.origin_url}`);
            continue;
          }
          logins.push({origin, username, password});
        } catch (error) {
          problems.push(`${where}: login for ${row.origin_url}: ${describe(error)}`);
        }
      }
    });
  } catch (error) {
    problems.push(`${where}: could not read logins: ${describe(error)}`);
  }
  return {logins, problems};
}

/** `scheme://host[:port]` with no path, or null for a stored origin that is not
 * a web one (Chrome keeps `android://…` and `federation://…` rows too). */
export function originOf(originUrl: string): string | null {
  try {
    const url = new URL(originUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * One browser's cookies and logins across every readable profile, tied
 * together with an injected `secret`. The keychain read is the injection point
 * so a caller can pass `() => keychainSecret(browser.keychain)` in production
 * and a fixed string in a test.
 */
export interface ChromiumSource {
  browser: ChromiumBrowser;
  /** The browser's "User Data" directory. Defaults to the standard location. */
  userDataDir?: string;
  /** Reads the Safe Storage secret. Never called for its value here beyond
   * deriving the key, so it is the whole of this module's keychain contact. */
  secret: () => Promise<string>;
}

export async function importChromium(source: ChromiumSource): Promise<ImportedData> {
  const userDataDir = source.userDataDir ?? chromiumUserDataDir(source.browser);
  const result: ImportedData = {cookies: [], logins: [], visits: [], problems: []};
  let key: Buffer;
  try {
    key = deriveKey(await source.secret());
  } catch (error) {
    // No secret means nothing decrypts; there is nothing else to try.
    result.problems.push(`${source.browser.name}: could not read the Safe Storage key: ${describe(error)}`);
    return result;
  }

  for (const profile of await chromiumProfiles(userDataDir)) {
    if (!profile.readable) {
      if (profile.reason) result.problems.push(`${source.browser.name} / ${profile.name}: ${profile.reason}`);
      continue;
    }
    const cookiesDb = path.join(profile.path, "Cookies");
    const loginData = path.join(profile.path, "Login Data");
    if (existsSync(cookiesDb)) {
      const {cookies, problems} = await readChromiumCookies(cookiesDb, key, `${source.browser.name} / ${profile.name}`);
      result.cookies.push(...cookies);
      result.problems.push(...problems);
    }
    if (existsSync(loginData)) {
      const {logins, problems} = await readChromiumLogins(loginData, key, `${source.browser.name} / ${profile.name}`);
      result.logins.push(...logins);
      result.problems.push(...problems);
    }
  }
  return result;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The pages a Chromium profile has been to.
 *
 * `urls` is already one row per page with the count and the last visit on it,
 * which is exactly the shape our own history keeps — so there is no need to
 * walk `visits` and aggregate. `last_visit_time` is microseconds since 1601,
 * the same clock the cookies use.
 *
 * Rows with no usable time are dropped rather than dated to 1601: a history
 * sorted by time is the whole point, and a page pinned to the beginning of
 * time is worse than a page that did not import.
 */
export async function readChromiumHistory(
  file: string,
  label: string,
): Promise<{visits: ImportedVisit[]; problems: string[]}> {
  const problems: string[] = [];
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await withDatabaseCopy(file, (db) =>
      db
        .prepare(
          "SELECT url, title, visit_count, last_visit_time FROM urls WHERE url <> '' ORDER BY last_visit_time DESC",
        )
        .all() as Array<Record<string, unknown>>,
    );
  } catch (error) {
    return {visits: [], problems: [`${label}: history could not be read: ${describe(error)}`]};
  }

  const visits: ImportedVisit[] = [];
  let undated = 0;
  for (const row of rows) {
    const url = String(row.url ?? "");
    if (!url || !/^https?:/i.test(url)) continue;
    const visitedAt = chromeTimestampToUnixSeconds(Number(row.last_visit_time ?? 0));
    if (visitedAt === undefined) {
      undated += 1;
      continue;
    }
    visits.push({
      url,
      title: String(row.title ?? ""),
      visitedAt,
      visitCount: Math.max(1, Number(row.visit_count ?? 1)),
    });
  }
  if (undated) problems.push(`${label}: ${undated} history entries had no usable date`);
  return {visits, problems};
}
