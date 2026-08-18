import { readFile } from "node:fs/promises";
import path from "node:path";
import { cookieUrl, type ImportedCookie, type ImportedData, type ImportedLogin } from "./types.js";

/**
 * The import that needs no permission at all: a file the user exported.
 *
 * Every other decoder in this folder reads another browser's own storage, which
 * on macOS means Full Disk Access, a keychain prompt, or a Primary Password —
 * three things a user can reasonably refuse and one of which (Safari's) cannot
 * be worked around. What every browser does still offer is an export: Chrome's
 * password manager writes a CSV, Firefox's about:logins writes a different CSV,
 * the macOS Passwords app writes a third, and every cookie extension writes the
 * Netscape cookies.txt that curl and wget have read since 1996.
 *
 * So this is the fallback that always works, and the price of it is that the
 * three CSVs agree on nothing but the existence of a header row. Columns are
 * therefore resolved by *name*, never by position: Chromium puts the url
 * second, Firefox first, Safari second again, and a decoder that counted
 * columns would silently import a title as a username. Nothing here parses a
 * date, a keychain or a database — it is text in, `ImportedData` out, and a bad
 * line costs that line only.
 */

/** How a row's columns are laid out, once the header has been read. The
 * dialect is carried only so a problem can name the file the user gave us. */
interface PasswordColumns {
  dialect: "Chrome" | "Firefox" | "Safari";
  url: number;
  username: number;
  password: number;
}

/** Chromium omitted `note` before M115, so the header alone is not a fixed
 * string in any of the three dialects — only these marker columns are. */
const SAFARI_MARKERS = ["otpauth", "notes", "title"];
const FIREFOX_MARKERS = ["httprealm", "formactionorigin", "guid", "timepasswordchanged"];

/** `#HttpOnly_` is a flag, not a comment, and the difference is a whole class
 * of session cookie — the login ones. */
const HTTP_ONLY_PREFIX = "#httponly_";

/** A cookies.txt line is seven tab-separated fields. Nothing else in a text
 * file the user might hand us looks like that, which is what makes it a
 * reliable sniff even when the banner line has been stripped. */
const COOKIE_FIELDS = 7;

/**
 * A CSV, as written by the tools that actually write them.
 *
 * Hand-rolled because the one thing this has to get right is the thing a
 * naive `split(",")` gets wrong: passwords are the field most likely in any
 * file anywhere to contain a comma, a quote, or — since Chromium exports notes
 * in the same row — a line break. Those arrive quoted, with an inner quote
 * doubled, and a row that spans two physical lines is still one row.
 */
export function parseCsv(text: string): string[][] {
  const source = stripBom(text);
  const rows: string[][] = [];
  let cells: string[] = [];
  let field = "";
  // Whether the row used quoting anywhere, which is the only way to tell a
  // blank line from a line holding one deliberately-empty quoted field.
  let rowQuoted = false;
  let quoted = false;

  const endRow = (): void => {
    cells.push(field);
    field = "";
    // A blank line carries nothing; dropping it here means every later stage
    // can treat "a row" as "a record" and report a short row as a real fault.
    if (!(cells.length === 1 && cells[0] === "" && !rowQuoted)) rows.push(cells);
    cells = [];
    rowQuoted = false;
  };

  let at = 0;
  while (at < source.length) {
    const char = source[at];
    if (quoted) {
      if (char === '"') {
        // A doubled quote is one literal quote; a lone one closes the field.
        if (source[at + 1] === '"') {
          field += '"';
          at += 2;
          continue;
        }
        quoted = false;
        at += 1;
        continue;
      }
      if (char === "\r" && source[at + 1] === "\n") {
        // The CR belongs to the file's line ending, not to the value, even
        // when the line ending falls inside a quoted note.
        field += "\n";
        at += 2;
        continue;
      }
      field += char;
      at += 1;
      continue;
    }
    // Only a quote at the start of a field opens one. Writers that emit a bare
    // quote mid-field (`O"Brien`) mean it literally, and treating it as an
    // opening quote there would swallow the rest of the file.
    if (char === '"' && field === "") {
      quoted = true;
      rowQuoted = true;
      at += 1;
      continue;
    }
    if (char === ",") {
      cells.push(field);
      field = "";
      at += 1;
      continue;
    }
    if (char === "\n" || char === "\r") {
      at += char === "\r" && source[at + 1] === "\n" ? 2 : 1;
      endRow();
      continue;
    }
    field += char;
    at += 1;
  }
  endRow();
  return rows;
}

/**
 * Logins from any of the three password exports, told apart by their header.
 *
 * An unparseable row is reported and skipped rather than thrown: these files
 * run to hundreds of rows and one hand-edited line should not cost the rest.
 */
export function parsePasswordCsv(text: string): ImportedData {
  const rows = parseCsv(text);
  const logins: ImportedLogin[] = [];
  const problems: string[] = [];
  if (rows.length === 0) return { cookies: [], logins, visits: [], problems: ["the file is empty"] };

  const columns = passwordColumns(rows[0]);
  if (!columns) {
    problems.push(`not a password export: the first row reads ${rows[0].join(", ")}`);
    return { cookies: [], logins, visits: [], problems };
  }
  const needed = Math.max(columns.url, columns.username, columns.password) + 1;

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    // Numbered as a spreadsheet numbers it, header included, because that is
    // what the user will be looking at when they go and check the row.
    const line = index + 1;
    // A row *longer* than the header is normal and harmless: it comes from a
    // trailing note whose separator was not quoted, and every column before it
    // is still where the header says. A short row is genuinely misaligned.
    if (row.length < needed) {
      problems.push(`row ${line}: ${row.length} columns, expected at least ${needed}`);
      continue;
    }
    const url = row[columns.url].trim();
    const username = row[columns.username];
    const password = row[columns.password];
    if (!url || !password) {
      problems.push(`row ${line}: skipped, it has no ${url ? "password" : "url"}`);
      continue;
    }
    const origin = loginOrigin(url);
    if (!origin) {
      // Chromium exports Android app credentials as `android://hash@package`,
      // which is a real credential with no site to sign in to.
      problems.push(`row ${line}: "${url}" is not a site this can sign in to`);
      continue;
    }
    logins.push({ origin, username, password });
  }

  if (logins.length === 0 && problems.length === 0)
    problems.push(`the ${columns.dialect} export lists no passwords`);
  return { cookies: [], logins, visits: [], problems };
}

/**
 * Cookies from a Netscape `cookies.txt` — the format curl, wget and every
 * cookie-exporting extension write.
 *
 * Seven tab-separated fields, and the two that are easy to get wrong are the
 * first and the fifth. `#HttpOnly_` on the domain is a flag rather than a
 * comment, and skipping those lines as comments would drop precisely the
 * cookies worth importing. An expiry of zero means a session cookie, not the
 * epoch, so it becomes an absent `expirationDate` rather than 1970.
 */
export function parseCookiesTxt(text: string): ImportedData {
  const cookies: ImportedCookie[] = [];
  const problems: string[] = [];
  const lines = stripBom(text).split(/\r\n|\n|\r/);

  for (let index = 0; index < lines.length; index += 1) {
    // Trailing whitespace only: a leading tab means an empty domain field,
    // which is a line to report rather than one to quietly re-align.
    const line = lines[index].replace(/\s+$/, "");
    const at = index + 1;
    if (!line) continue;

    let httpOnly = false;
    let body = line;
    if (line.toLowerCase().startsWith(HTTP_ONLY_PREFIX)) {
      httpOnly = true;
      body = line.slice(HTTP_ONLY_PREFIX.length);
    } else if (line.startsWith("#")) {
      continue;
    }

    const fields = body.split("\t");
    if (fields.length < COOKIE_FIELDS) {
      problems.push(`line ${at}: ${fields.length} tab-separated fields, expected ${COOKIE_FIELDS}`);
      continue;
    }
    const [rawHost, subdomains, rawPath, secure, expiry] = fields;
    const host = rawHost.trim();
    const name = fields[5];
    // A value is the last field, but a re-exported file can carry a tab inside
    // it; keeping the tail together loses less than truncating at the tab.
    const value = fields.slice(6).join("\t");
    if (!host || !name) {
      problems.push(`line ${at}: a cookie needs a domain and a name`);
      continue;
    }
    const seconds = Number(expiry);
    if (!Number.isFinite(seconds)) {
      // Not a number here almost always means the columns are shifted, so the
      // rest of this line cannot be trusted either.
      problems.push(`line ${at}: "${expiry}" is not an expiry in seconds`);
      continue;
    }

    const cookiePath = rawPath || "/";
    const isSecure = isTrue(secure);
    const cookie: ImportedCookie = {
      url: cookieUrl(host, isSecure, cookiePath),
      name,
      value,
      path: cookiePath,
      secure: isSecure,
      httpOnly,
    };
    // Field two says "covers subdomains", and so does a leading dot on the
    // host. Files in the wild set one without the other, so either is enough —
    // and `domain` stays absent otherwise, which is what makes it host-only.
    if (isTrue(subdomains) || host.startsWith("."))
      cookie.domain = host.startsWith(".") ? host : `.${host}`;
    if (seconds > 0) cookie.expirationDate = seconds;
    cookies.push(cookie);
  }

  if (cookies.length === 0 && problems.length === 0) problems.push("the file lists no cookies");
  return { cookies, logins: [], visits: [], problems };
}

/**
 * Whatever the user picked, read and decoded by what is in it.
 *
 * The extension is no guide — a cookies.txt is routinely saved as `.txt`,
 * `.dat` or with no extension at all, and a browser will happily hand back a
 * `.csv` full of cookies. Never rejects: a file this cannot make sense of is a
 * problem in the result, because the user chose it in a picker and deserves to
 * be told what was wrong with it.
 */
export async function importFromFile(file: string): Promise<ImportedData> {
  const name = path.basename(file);
  let text: string;
  try {
    text = decodeText(await readFile(file));
  } catch (error) {
    return {
      cookies: [],
      logins: [],
      visits: [],
      problems: [`${name} could not be read: ${describe(error)}`],
    };
  }
  if (looksLikeCookies(text)) return parseCookiesTxt(text);
  if (passwordColumns(firstRow(text))) return parsePasswordCsv(text);
  return {
    cookies: [],
    logins: [],
    visits: [],
    problems: [`${name} is not a password export or a cookies.txt`],
  };
}

/** Where the url, username and password sit, or null when this is not a
 * password export at all. Matching is case-insensitive, and tolerates quotes a
 * writer left in the header cell itself — Firefox quotes every header. */
function passwordColumns(header: string[]): PasswordColumns | null {
  const names = header.map((cell) => stripBom(cell).trim().replace(/^"+|"+$/g, "").toLowerCase());
  const url = names.indexOf("url");
  const username = names.indexOf("username");
  const password = names.indexOf("password");
  if (url < 0 || username < 0 || password < 0) return null;
  const has = (marker: string): boolean => names.includes(marker);
  const dialect = SAFARI_MARKERS.some(has)
    ? "Safari"
    : FIREFOX_MARKERS.some(has)
      ? "Firefox"
      : "Chrome";
  return { dialect, url, username, password };
}

/** The header row, without paying to parse the whole file. A header never
 * spans two lines — only a value can — so the first line is enough. */
function firstRow(text: string): string[] {
  const source = stripBom(text);
  const end = source.search(/\r\n|\n|\r/);
  return parseCsv(end < 0 ? source : source.slice(0, end))[0] ?? [];
}

/** The banner if it survived whatever wrote the file, and the shape of the
 * lines if it did not. */
function looksLikeCookies(text: string): boolean {
  const lines = stripBom(text).split(/\r\n|\n|\r/);
  if (/^#\s*Netscape HTTP Cookie File/i.test(lines[0]?.trim() ?? "")) return true;
  return lines
    .slice(0, 40)
    .some((line) => line.split("\t").length >= COOKIE_FIELDS && !line.trimStart().startsWith("#"));
}

/** `scheme://host[:port]`, or null when the row names something no browsing
 * session can hold a login for. A bare host is taken as https, which is what a
 * Safari export without a scheme means. */
function loginOrigin(value: string): string | null {
  const text = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.host) return null;
  return `${parsed.protocol}//${parsed.host}`;
}

/**
 * Bytes to text. UTF-8 is what all three browsers write, but a file that has
 * been through a Windows spreadsheet comes back UTF-16, and decoding that as
 * UTF-8 yields a header full of NULs that matches nothing.
 */
function decodeText(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
    return bytes.subarray(2).toString("utf16le");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
    return bytes.subarray(2).swap16().toString("utf16le");
  return bytes.toString("utf8");
}

/** A UTF-8 BOM survives as one character and would otherwise be part of the
 * first header cell, where it stops `url` matching `url`. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isTrue(field: string): boolean {
  return field.trim().toUpperCase() === "TRUE";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
