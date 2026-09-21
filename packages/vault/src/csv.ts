/**
 * Password CSV dialects written by the tools people actually export from.
 *
 * Columns are resolved by name, never by position: Chrome puts the URL second,
 * Firefox first, Bitwarden under `login_uri`. A decoder that counted columns
 * would silently import a title as a username.
 */

export interface CsvLogin {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  totp: string;
  group: string;
}

export interface CsvImport {
  logins: CsvLogin[];
  problems: string[];
}

interface Columns {
  dialect: string;
  title: number | null;
  username: number | null;
  password: number | null;
  url: number | null;
  notes: number | null;
  totp: number | null;
  group: number | null;
}

const BITWARDEN_MARKERS = ["login_uri", "login_username", "login_password"];
const FIREFOX_MARKERS = ["httprealm", "formactionorigin", "guid"];
const SAFARI_MARKERS = ["otpauth", "title"];
const KEEPASS_MARKERS = ["account", "login name", "web site"];

export function parsePasswordCsv(text: string): CsvImport {
  const rows = parseCsv(text);
  const logins: CsvLogin[] = [];
  const problems: string[] = [];
  if (rows.length === 0)
    return { logins, problems: ["the file is empty"] };

  const columns = detectColumns(rows[0]);
  if (!columns) {
    problems.push(`not a password export: the first row reads ${rows[0].slice(0, 8).join(", ")}`);
    return { logins, problems };
  }

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const password = cell(row, columns.password);
    const username = cell(row, columns.username);
    const url = cell(row, columns.url);
    const title = cell(row, columns.title) || hostnameTitle(url) || username || "Imported";
    if (!password && !username && !url && cell(row, columns.totp) === "") {
      problems.push(`row ${index + 1} is empty`);
      continue;
    }
    logins.push({
      title,
      username,
      password,
      url,
      notes: cell(row, columns.notes),
      totp: cell(row, columns.totp),
      group: cell(row, columns.group),
    });
  }
  return { logins, problems };
}

export function parseCsv(text: string): string[][] {
  const source = stripBom(text);
  const rows: string[][] = [];
  let cells: string[] = [];
  let field = "";
  let rowQuoted = false;
  let quoted = false;
  const endRow = (): void => {
    cells.push(field);
    field = "";
    if (!(cells.length === 1 && cells[0] === "" && !rowQuoted)) rows.push(cells);
    cells = [];
    rowQuoted = false;
  };
  let at = 0;
  while (at < source.length) {
    const char = source[at];
    if (quoted) {
      if (char === '"') {
        if (source[at + 1] === '"') {
          field += '"';
          at += 2;
          continue;
        }
        quoted = false;
        at += 1;
        continue;
      }
      field += char === "\r" && source[at + 1] === "\n" ? "\n" : char;
      at += char === "\r" && source[at + 1] === "\n" ? 2 : 1;
      continue;
    }
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

function detectColumns(header: string[]): Columns | null {
  const names = header.map((item) => item.trim().toLowerCase());
  const find = (...candidates: string[]): number | null => {
    for (const candidate of candidates) {
      const index = names.indexOf(candidate);
      if (index >= 0) return index;
    }
    return null;
  };

  if (BITWARDEN_MARKERS.every((marker) => names.includes(marker))) {
    return {
      dialect: "Bitwarden",
      title: find("name"),
      username: find("login_username"),
      password: find("login_password"),
      url: find("login_uri"),
      notes: find("notes"),
      totp: find("login_totp"),
      group: find("folder"),
    };
  }
  if (FIREFOX_MARKERS.some((marker) => names.includes(marker))) {
    return {
      dialect: "Firefox",
      title: find("url"),
      username: find("username"),
      password: find("password"),
      url: find("url"),
      notes: find("httprealm"),
      totp: null,
      group: null,
    };
  }
  if (SAFARI_MARKERS.every((marker) => names.includes(marker))) {
    return {
      dialect: "Safari",
      title: find("title", "name"),
      username: find("username"),
      password: find("password"),
      url: find("url"),
      notes: find("notes"),
      totp: find("otpauth"),
      group: null,
    };
  }
  if (KEEPASS_MARKERS.every((marker) => names.includes(marker))) {
    return {
      dialect: "KeePass",
      title: find("account"),
      username: find("login name"),
      password: find("password"),
      url: find("web site"),
      notes: find("comments"),
      totp: null,
      group: null,
    };
  }

  const username = find("username", "user name", "user", "login");
  const password = find("password");
  const url = find("url", "uri", "website", "web site", "login_uri");
  if (password === null && username === null && url === null && find("totp", "otp", "otpauth") === null)
    return null;
  return {
    dialect: names.includes("name") && names.includes("url") ? "Chrome" : "Generic",
    title: find("name", "title", "account"),
    username,
    password,
    url,
    notes: find("note", "notes", "comments"),
    totp: find("totp", "otp", "otpauth", "login_totp"),
    group: find("folder", "group", "collection"),
  };
}

function cell(row: string[], index: number | null): string {
  if (index === null || index < 0 || index >= row.length) return "";
  return row[index]?.trim() ?? "";
}

function hostnameTitle(url: string): string {
  try {
    const host = new URL(url.includes("://") ? url : `https://${url}`).hostname;
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
