import type { BrowserImportResultDto, SavedLoginDto } from "@polymux/protocol";
import type { CookiesSetDetails } from "electron";
import type {
  ImportedCookie,
  ImportedData,
  ImportedLogin,
  ImportedVisit,
} from "./types.js";

/**
 * Putting decoded data where it belongs.
 *
 * The decoders know how each browser stores things; this knows what our own
 * session will accept, which is a separate and surprisingly picky question.
 * Chromium rejects a cookie outright for several reasons that are easy to hit
 * when replaying someone else's jar, so the ones that cannot land are counted
 * and explained rather than thrown.
 */

export interface CookieWriter {
  set(details: CookiesSetDetails): Promise<void>;
}

export interface VisitWriter {
  /** Writes every visit in one transaction and answers how many landed. */
  record(visits: ImportedVisit[]): number;
}

export interface LoginWriter {
  save(
    origin: string,
    username: string,
    password: string,
    source: "manual" | "import",
  ): Promise<SavedLoginDto[]>;
}

/**
 * Whether Chromium will take this cookie at all, and why not when it will not.
 *
 * Checked before the write because `cookies.set` rejects with a message that
 * does not say which cookie failed, and a jar of several thousand would report
 * a wall of identical errors.
 */
export function cookieProblem(cookie: ImportedCookie): string | null {
  if (!cookie.name && !cookie.value) return "the cookie has neither a name nor a value";
  // SameSite=None is meaningless without Secure, and Chromium refuses it.
  if (cookie.sameSite === "no_restriction" && !cookie.secure)
    return "SameSite=None without Secure";
  // The prefixes are enforced by Chromium, so a cookie that breaks its own
  // prefix's rules is refused however it was stored at the source.
  if (cookie.name.startsWith("__Secure-") && !cookie.secure)
    return "a __Secure- cookie that is not secure";
  if (cookie.name.startsWith("__Host-")) {
    if (!cookie.secure) return "a __Host- cookie that is not secure";
    if (cookie.domain) return "a __Host- cookie with a domain";
    if (cookie.path && cookie.path !== "/") return "a __Host- cookie outside the root path";
  }
  // An expiry already in the past would be accepted and immediately dropped,
  // which is a write that achieves nothing.
  if (cookie.expirationDate !== undefined && cookie.expirationDate <= Date.now() / 1000)
    return "the cookie has already expired";
  try {
    new URL(cookie.url);
  } catch {
    return "the cookie has no usable url";
  }
  return null;
}

/** Cookies come out of some jars in an order that repeats a name for the same
 * host; the last one written wins, so earlier duplicates are dropped rather
 * than each costing a round trip. */
export function dedupeCookies(cookies: ImportedCookie[]): ImportedCookie[] {
  const byKey = new Map<string, ImportedCookie>();
  for (const cookie of cookies)
    byKey.set(`${cookie.domain ?? ""}|${cookie.url}|${cookie.name}`, cookie);
  return [...byKey.values()];
}

/** A visit needs a usable address and a date that is not nonsense; a row
 * dated to 1970 or to next century sorts a real history into uselessness. */
export function visitProblem(visit: ImportedVisit): string | null {
  if (!visit.url) return "the page has no address";
  try {
    const url = new URL(visit.url);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return "the page is not a web address";
  } catch {
    return "the page has no usable address";
  }
  if (!Number.isFinite(visit.visitedAt) || visit.visitedAt <= 0)
    return "the visit has no date";
  // A little slack for clock skew, then anything further ahead is a bad
  // conversion rather than a visit.
  if (visit.visitedAt > Date.now() / 1000 + 86_400) return "the visit is dated in the future";
  return null;
}

/** A login is worth saving only if it can identify itself later. */
export function loginProblem(login: ImportedLogin): string | null {
  if (!login.password) return "the login has no password";
  if (!login.origin) return "the login has no site";
  try {
    new URL(login.origin);
  } catch {
    return "the login's site is not a usable address";
  }
  return null;
}

/**
 * Writes decoded data into the session and the vault.
 *
 * Problems are summarised by kind rather than listed one per item: "412
 * cookies skipped (already expired)" is useful, four hundred identical lines
 * are not.
 */
export async function applyImport(
  data: ImportedData,
  writers: {cookies: CookieWriter; logins: LoginWriter; visits?: VisitWriter},
): Promise<BrowserImportResultDto> {
  const result: BrowserImportResultDto = {
    cookiesImported: 0,
    cookiesSkipped: 0,
    passwordsImported: 0,
    passwordsSkipped: 0,
    historyImported: 0,
    historySkipped: 0,
    problems: [...data.problems],
  };
  const skipped = new Map<string, number>();
  const note = (reason: string): void => {
    skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  };

  for (const cookie of dedupeCookies(data.cookies)) {
    const problem = cookieProblem(cookie);
    if (problem) {
      result.cookiesSkipped += 1;
      note(problem);
      continue;
    }
    try {
      await writers.cookies.set({
        url: cookie.url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expirationDate,
        sameSite: cookie.sameSite,
      });
      result.cookiesImported += 1;
    } catch (error) {
      result.cookiesSkipped += 1;
      note(error instanceof Error ? error.message : String(error));
    }
  }

  for (const login of data.logins) {
    const problem = loginProblem(login);
    if (problem) {
      result.passwordsSkipped += 1;
      note(problem);
      continue;
    }
    try {
      await writers.logins.save(login.origin, login.username, login.password, "import");
      result.passwordsImported += 1;
    } catch (error) {
      result.passwordsSkipped += 1;
      note(error instanceof Error ? error.message : String(error));
    }
  }

  if (writers.visits && data.visits.length) {
    const keep: ImportedVisit[] = [];
    for (const visit of data.visits) {
      const problem = visitProblem(visit);
      if (problem) {
        result.historySkipped += 1;
        note(problem);
        continue;
      }
      keep.push(visit);
    }
    try {
      // One call, not one per page: a Chrome history is tens of thousands of
      // rows and the writer batches them into a single transaction.
      result.historyImported = writers.visits.record(keep);
    } catch (error) {
      result.historySkipped += keep.length;
      note(error instanceof Error ? error.message : String(error));
    }
  }

  for (const [reason, count] of skipped)
    result.problems.push(count === 1 ? reason : `${reason} (${count} items)`);
  return result;
}
