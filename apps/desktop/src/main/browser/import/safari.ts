import { existsSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
// The read-only temp-copy open, shared rather than written twice.
import { withDatabaseCopy } from "./chromium.js";
import {
  EMPTY_IMPORT,
  MAC_EPOCH_OFFSET_SECONDS,
  cookieUrl,
  type ImportedCookie,
  type ImportedData,
  type ImportedVisit,
  type ImportedProfile,
} from "./types.js";

/**
 * Safari's cookies, read out of the jar Safari itself writes.
 *
 * Nothing here is encrypted, which makes this the shortest decoder in the
 * folder and the one with the most format in it: `Cookies.binarycookies` is a
 * hand-rolled binary file, not a database, so there is no SQLite copy step and
 * no key to fetch. What there is instead is a container the system protects.
 * The file lives inside `com.apple.Safari`'s sandbox, and macOS refuses the
 * read outright unless the *running app* holds Full Disk Access — a permission
 * that cannot be prompted for from code the way the microphone can. All this
 * can do about that is recognise the refusal and say, precisely, what the user
 * has to switch on.
 *
 * Passwords are not here, and never will be — see `SAFARI_PASSWORDS_UNAVAILABLE`.
 *
 * Read-only throughout: this module opens Safari's file for reading and writes
 * nothing anywhere.
 */

/** Safari has one jar, not a profile per identity, so this id is fixed. */
export const SAFARI_PROFILE_ID = "safari";

/**
 * What the user is told when the container is closed to us. It names the exact
 * pane because "grant Full Disk Access" sends people to the Files and Folders
 * list, which is a different setting and will not fix this — and it names the
 * relaunch because TCC decisions are read at launch, so toggling the switch
 * while Polymux is running changes nothing until it starts again.
 */
export const FULL_DISK_ACCESS_REASON =
  "Safari keeps its cookies in a container macOS protects, so Polymux cannot read them without Full Disk Access. Open System Settings → Privacy & Security → Full Disk Access, switch Polymux on, then quit and reopen Polymux.";

/**
 * Why there is no Safari password path, and why adding one would be wasted
 * work rather than merely difficult.
 *
 * Safari's passwords are keychain items, and every one of them carries an ACL
 * that trusts Apple's own binaries and nothing else: any other process asking
 * for the secret is refused, or prompts the user for their login password once
 * per item and *still* hands back nothing scriptable. Items synced through
 * iCloud Keychain go further and are marked non-exportable at the item level.
 * Shelling out to `security` does not route around either of those — it is
 * just another untrusted process at the same wall — so this module does not
 * try, and no future version of it should. The supported route is the export
 * Safari offers the user themselves (Passwords → Export), which produces a CSV
 * that `files.ts` reads; that path has the user's consent behind it, which is
 * the reason it works at all.
 */
export const SAFARI_PASSWORDS_UNAVAILABLE =
  "Safari does not let another app read its saved passwords. In Safari, choose Passwords → Export to save a CSV, then import that file here.";

/** Stated as a result rather than only as prose, so a caller listing what each
 * browser can offer gets the same shape from Safari as from the others. */
export function safariLogins(): ImportedData {
  const data = empty();
  data.problems.push(SAFARI_PASSWORDS_UNAVAILABLE);
  return data;
}

/** `readable` is the only answer that means the bytes can be had; `blocked` is
 * TCC saying no, which is a different message to the user than a Mac that
 * simply has no Safari data. */
export type ProbeResult = "readable" | "blocked" | "missing";
export type FileProbe = (file: string) => Promise<ProbeResult>;

export interface SafariOptions {
  /** Overridable for tests; the user's home directory otherwise. */
  home?: string;
  platform?: NodeJS.Platform;
  probe?: FileProbe;
}

/**
 * Where the jar can be, newest location first. Safari was sandboxed into a
 * container in macOS 10.14; a Mac upgraded across that boundary can still have
 * the old file, and a very old one has only that.
 */
export function safariCookiePaths(home: string): string[] {
  return [
    path.join(home, "Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies"),
    path.join(home, "Library/Cookies/Cookies.binarycookies"),
  ];
}

/**
 * The Safari profile, whether or not it can be read. An unreadable one is
 * still worth returning: the user needs to see Safari in the list with the
 * reason attached, rather than watch it silently not appear and conclude
 * Polymux cannot import from it at all.
 *
 * Empty only when there is no Safari jar to speak of — another platform, or a
 * Mac where Safari has never stored a cookie.
 */
export async function safariProfiles(options: SafariOptions = {}): Promise<ImportedProfile[]> {
  const { home = homedir(), platform = process.platform, probe = probeFile } = options;
  if (platform !== "darwin") return [];
  let blocked: string | null = null;
  for (const file of safariCookiePaths(home)) {
    const state = await probe(file);
    if (state === "readable") return [profile(file, true, null)];
    // Remember the first refusal but keep looking: the pre-container path is
    // outside the protected container and may be readable when the new one is
    // not, and a jar we can actually read beats a message about one we cannot.
    if (state === "blocked" && !blocked) blocked = file;
  }
  return blocked ? [profile(blocked, false, FULL_DISK_ACCESS_REASON)] : [];
}

/**
 * The cookies in one jar. Never rejects: a jar that cannot be opened, or one
 * whose bytes are not what this understands, comes back as a problem the user
 * can read beside whatever else the import found.
 *
 * There is no copy-to-temp dance here, unlike the SQLite-backed decoders: this
 * is a flat file with no journal beside it, and Safari replaces it wholesale
 * rather than editing it in place, so a single read is a consistent snapshot.
 */
export async function readSafariCookies(file: string): Promise<ImportedData> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (error) {
    const data = empty();
    const code = (error as NodeJS.ErrnoException).code;
    data.problems.push(
      code === "EPERM" || code === "EACCES"
        ? FULL_DISK_ACCESS_REASON
        : `Safari's cookie file at ${file} could not be read: ${describe(error)}`,
    );
    return data;
  }
  return parseBinaryCookies(bytes);
}

/** 'cook', in the four bytes the file opens with. */
const MAGIC = "cook";
/** Each page opens with these four bytes. Read big-endian, as here, they are
 * 0x00000100; the same bytes read little-endian are 0x00010000, which is the
 * first sign that a page is being read with the wrong endianness. */
const PAGE_HEADER = 0x0000_0100;
/** Size, flags, the four string offsets and the two timestamps, before any
 * string bytes begin. */
const COOKIE_HEADER_BYTES = 56;
const FLAG_SECURE = 0x1;
const FLAG_HTTP_ONLY = 0x4;

/**
 * A whole `Cookies.binarycookies` file, turned into cookies.
 *
 * Pure, and total: every structural failure lands in `problems` and the cookies
 * either side of it are still returned. A jar is thousands of records the user
 * has accumulated over years, and losing all of them to one bad offset would be
 * the worst possible trade.
 *
 * The format's one real trap is endianness, and it is not consistent: the file
 * header — magic, page count, page sizes — is **big**-endian, while everything
 * inside a page — cookie count, the offset table, each record's fields and
 * timestamps — is **little**-endian. Read a page's cookie count big-endian and
 * a two-cookie page claims 33,554,432 of them; read the page count
 * little-endian and a normal file claims a few billion pages. Both mistakes
 * fail loudly here rather than quietly returning nothing, which is why the
 * header sizes are bounds-checked against the buffer before anything is read.
 */
export function parseBinaryCookies(bytes: Buffer): ImportedData {
  const data = empty();
  if (bytes.length < 8 || bytes.subarray(0, 4).toString("latin1") !== MAGIC) {
    data.problems.push(
      "This is not a Safari cookie file: it does not begin with the 'cook' marker, so it was left alone.",
    );
    return data;
  }
  const pageCount = bytes.readUInt32BE(4);
  const directoryEnd = 8 + pageCount * 4;
  if (directoryEnd > bytes.length) {
    data.problems.push(
      `Safari's cookie file claims ${pageCount} pages, which does not fit in its ${bytes.length} bytes; no cookies could be read.`,
    );
    return data;
  }
  let at = directoryEnd;
  for (let index = 0; index < pageCount; index += 1) {
    const size = bytes.readUInt32BE(8 + index * 4);
    // A page that runs off the end means the file was truncated — copied while
    // Safari was writing, or cut short on disk. Everything before the cut is
    // intact and is kept; there is nothing past it to look at.
    if (size < 12 || at + size > bytes.length) {
      data.problems.push(
        `Safari's cookie file is cut short at page ${index + 1} of ${pageCount}; the ${data.cookies.length} cookies before it were read.`,
      );
      break;
    }
    readPage(bytes.subarray(at, at + size), index, data);
    at += size;
  }
  return data;
}

/** One page's records. A page whose header is wrong is skipped whole: its
 * offset table cannot be trusted, and following it would read arbitrary bytes
 * as cookie values. */
function readPage(page: Buffer, index: number, data: ImportedData): void {
  if (page.readUInt32BE(0) !== PAGE_HEADER) {
    data.problems.push(`Page ${index + 1} of Safari's cookie file is not a cookie page and was skipped.`);
    return;
  }
  const count = page.readUInt32LE(4);
  if (8 + count * 4 > page.length) {
    data.problems.push(
      `Page ${index + 1} of Safari's cookie file claims ${count} cookies, more than it has room for, and was skipped.`,
    );
    return;
  }
  for (let cookie = 0; cookie < count; cookie += 1) {
    try {
      data.cookies.push(readCookie(page, page.readUInt32LE(8 + cookie * 4)));
    } catch (error) {
      data.problems.push(
        `Cookie ${cookie + 1} on page ${index + 1} of Safari's cookie file was skipped: ${describe(error)}`,
      );
    }
  }
}

/**
 * One record, at its offset from the start of the page.
 *
 * Every field is little-endian and every string offset is relative to the
 * record, not the page, so the record's own declared size is what bounds the
 * strings. A record that overruns its page is refused rather than clamped: the
 * bytes past the end belong to the next record, and reading them would hand the
 * user a cookie whose value is somebody else's.
 */
function readCookie(page: Buffer, at: number): ImportedCookie {
  if (at + COOKIE_HEADER_BYTES > page.length) throw new Error("its record begins past the end of the page");
  const size = page.readUInt32LE(at);
  if (size < COOKIE_HEADER_BYTES) throw new Error(`its record declares ${size} bytes, too few to hold a cookie`);
  if (at + size > page.length) throw new Error(`its record declares ${size} bytes but its page ends first`);
  const end = at + size;

  const flags = page.readUInt32LE(at + 8);
  const secure = (flags & FLAG_SECURE) !== 0;
  const httpOnly = (flags & FLAG_HTTP_ONLY) !== 0;
  const host = text(page, at, page.readUInt32LE(at + 16), end, "domain");
  const name = text(page, at, page.readUInt32LE(at + 20), end, "name");
  // Safari omits the path on a cookie set for the whole site; a cookie's path
  // is "/" when it has none, and `cookieUrl` needs a real one either way.
  const cookiePath = text(page, at, page.readUInt32LE(at + 24), end, "path") || "/";
  const value = text(page, at, page.readUInt32LE(at + 28), end, "value");
  if (!host) throw new Error("it names no domain");

  const cookie: ImportedCookie = {
    url: cookieUrl(host, secure, cookiePath),
    name,
    value,
    path: cookiePath,
    secure,
    httpOnly,
  };
  // The leading dot is the whole record of "and subdomains" — Safari stores
  // `.github.com` for a cookie set with `Domain=github.com`, and a bare
  // `gist.github.com` for a host-only one. Passing the dot through keeps that
  // distinction, which Electron reads back from the presence of the field.
  if (host.startsWith(".")) cookie.domain = host;
  const expires = unixFromMacAbsolute(page.readDoubleLE(at + 40));
  if (expires !== null) cookie.expirationDate = expires;
  // The 8 bytes at +48 are the creation time, in the same units. Nothing
  // downstream takes one, so it is read past rather than carried.
  //
  // There is no SameSite in this format: it predates the attribute, and Safari
  // keeps its own tracking rules outside the jar. Leaving the field unset lets
  // Electron apply its default rather than inventing a value the source never
  // recorded.
  return cookie;
}

/** A NUL-terminated string at `offset` bytes into the record. The offset must
 * land in the record's string area — one pointing into the header, or past the
 * record, is corruption rather than an empty value. */
function text(page: Buffer, record: number, offset: number, end: number, field: string): string {
  const start = record + offset;
  if (offset < COOKIE_HEADER_BYTES || start >= end) throw new Error(`its ${field} is stored outside the record`);
  const nul = page.indexOf(0, start);
  return page.subarray(start, nul === -1 || nul > end ? end : nul).toString("utf8");
}

/**
 * Mac absolute time — seconds since 2001-01-01 — as the seconds since 1970 the
 * rest of the pipeline speaks, or null for a cookie with no expiry to carry.
 *
 * Safari writes 0 for a session cookie, and a negative value would put the
 * expiry before 2001, which no browser ever wrote and none would honour. Both
 * become an absent `expirationDate`, which is exactly how Electron records a
 * cookie that dies with the session.
 */
export function unixFromMacAbsolute(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds + MAC_EPOCH_OFFSET_SECONDS;
}

/**
 * Whether a path can be opened for reading, and if not, why. TCC denies a
 * protected container with EPERM rather than pretending the file is missing,
 * which is the only signal there is that Full Disk Access is what is wanted —
 * so the two codes are kept apart here instead of collapsing into "no".
 */
async function probeFile(file: string): Promise<ProbeResult> {
  let handle;
  try {
    handle = await open(file, "r");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM" || code === "EACCES" ? "blocked" : "missing";
  }
  await handle.close();
  return "readable";
}

function profile(file: string, readable: boolean, reason: string | null): ImportedProfile {
  return { id: SAFARI_PROFILE_ID, name: "Safari", path: file, readable, reason };
}

/** A result of the contract's empty shape with arrays of its own — everything
 * here appends as it goes, and `EMPTY_IMPORT` is one shared object. */
function empty(): ImportedData {
  return {
    cookies: [...EMPTY_IMPORT.cookies],
    logins: [...EMPTY_IMPORT.logins],
    visits: [...EMPTY_IMPORT.visits],
    problems: [...EMPTY_IMPORT.problems],
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Where Safari keeps its history, which is not beside its cookies. */
export function safariHistoryPath(home: string = homedir()): string {
  return path.join(home, "Library/Safari/History.db");
}

/**
 * The pages Safari has been to.
 *
 * Unlike the Chromium and Firefox stores, the page and its visits are two
 * tables: `history_items` holds the url and total count, `history_visits` the
 * individual visits and — this is the part worth knowing — the *title*, which
 * `history_items` does not carry at all. So the newest visit per item is
 * joined back on to get a title, rather than listing every visit.
 *
 * `visit_time` is Mac absolute time: seconds since 2001-01-01, and a float.
 *
 * Reading it needs Full Disk Access exactly as the cookies do, and the same
 * message is returned so the user is told once what to grant.
 */
export async function readSafariHistory(
  file: string = safariHistoryPath(),
): Promise<{visits: ImportedVisit[]; problems: string[]}> {
  if (!existsSync(file)) return {visits: [], problems: ["Safari's history could not be found"]};
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await withDatabaseCopy(file, (db) =>
      db
        .prepare(
          `SELECT i.url AS url, i.visit_count AS visit_count,
                  MAX(v.visit_time) AS visit_time,
                  (SELECT title FROM history_visits
                    WHERE history_item = i.id AND title IS NOT NULL
                    ORDER BY visit_time DESC LIMIT 1) AS title
             FROM history_items i
             JOIN history_visits v ON v.history_item = i.id
            WHERE i.url <> ''
            GROUP BY i.id
            ORDER BY visit_time DESC`,
        )
        .all() as Array<Record<string, unknown>>,
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      visits: [],
      problems: [
        code === "EPERM" || code === "EACCES"
          ? FULL_DISK_ACCESS_REASON
          : `Safari's history could not be read: ${describe(error)}`,
      ],
    };
  }

  const visits: ImportedVisit[] = [];
  let undated = 0;
  for (const row of rows) {
    const url = String(row.url ?? "");
    if (!url || !/^https?:/i.test(url)) continue;
    const visitedAt = unixFromMacAbsolute(Number(row.visit_time ?? 0));
    if (visitedAt === null) {
      undated += 1;
      continue;
    }
    visits.push({
      url,
      title: row.title === null || row.title === undefined ? "" : String(row.title),
      visitedAt,
      visitCount: Math.max(1, Number(row.visit_count ?? 1)),
    });
  }
  return {
    visits,
    problems: undated ? [`Safari: ${undated} history entries had no usable date`] : [],
  };
}
