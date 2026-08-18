import type { BrowserSiteDto } from "@flareai/protocol";
import type { Cookie } from "electron";

/**
 * What the embedded browser is holding, and how it is let go.
 *
 * Electron 43 has no per-origin storage figure — `getCacheSize` is the whole
 * session and there is no quota query — so a site is listed on the evidence
 * that does exist: cookies in the jar, decisions the user has recorded, and
 * logins saved for it. Nothing here promises a byte count it cannot produce.
 */

/** The slice of an Electron session this module needs, named so it can be
 * stood up in a test without an Electron runtime. */
export interface DataSession {
  cookies: {
    get(filter: Record<string, never>): Promise<Cookie[]>;
  };
  clearData(options: {
    dataTypes?: string[];
    origins?: string[];
  }): Promise<void>;
  clearStorageData(options?: { origin?: string; storages?: string[] }): Promise<void>;
  clearCache(): Promise<void>;
  clearAuthCache(): Promise<void>;
  clearHostResolverCache(): Promise<void>;
}

export interface SiteRecords {
  listSitePermissions(origin?: string): { origin: string }[];
  listSavedLogins(origin?: string): { origin: string }[];
  clearSitePermissions(origin?: string): number;
}

/**
 * The origin a cookie belongs to. `host_key` may carry a leading dot meaning
 * "and every subdomain", which is not part of a URL, so it is dropped; the
 * scheme is inferred from the secure flag because the jar does not record one.
 */
export function cookieOrigin(cookie: Pick<Cookie, "domain" | "secure">): string | null {
  const host = (cookie.domain ?? "").replace(/^\./, "");
  if (!host) return null;
  return `${cookie.secure ? "https" : "http"}://${host}`;
}

export class BrowsingData {
  readonly #session: () => DataSession;
  readonly #records: SiteRecords;

  constructor(options: { session: () => DataSession; records: SiteRecords }) {
    this.#session = options.session;
    this.#records = options.records;
  }

  async sites(): Promise<BrowserSiteDto[]> {
    const sites = new Map<string, BrowserSiteDto>();
    const at = (origin: string): BrowserSiteDto => {
      const existing = sites.get(origin);
      if (existing) return existing;
      const fresh: BrowserSiteDto = { origin, cookies: 0, permissions: 0, logins: 0 };
      sites.set(origin, fresh);
      return fresh;
    };
    // An empty filter is how Electron spells "every cookie in the jar".
    for (const cookie of await this.#session().cookies.get({})) {
      const origin = cookieOrigin(cookie);
      if (origin) at(origin).cookies += 1;
    }
    // A site the user has decided something about, or saved a password for,
    // belongs in the list even with no cookie to its name.
    for (const row of this.#records.listSitePermissions()) at(row.origin).permissions += 1;
    for (const row of this.#records.listSavedLogins()) at(row.origin).logins += 1;
    return [...sites.values()].sort((left, right) => left.origin.localeCompare(right.origin));
  }

  /**
   * Clears one site. Chromium matches cookies at the registrable domain, so
   * this reaches neighbouring subdomains too — which is why the UI says "and
   * its subdomains" rather than claiming a precision the platform lacks.
   *
   * Saved logins are deliberately left: clearing a site's data is not the same
   * as throwing away the password for it.
   */
  async clearSite(origin: string): Promise<BrowserSiteDto[]> {
    await this.#session().clearData({
      origins: [origin],
      dataTypes: [
        "cookies",
        "cache",
        "fileSystems",
        "indexedDB",
        "localStorage",
        "serviceWorkers",
      ],
    });
    this.#records.clearSitePermissions(origin);
    return this.sites();
  }

  /** The whole jar. Each part is opt-in, so nothing is cleared that was not
   * asked for. */
  async clearAll(options: {
    cookies: boolean;
    cache: boolean;
  }): Promise<void> {
    const session = this.#session();
    if (options.cookies)
      await session.clearStorageData({
        storages: [
          "cookies",
          "filesystem",
          "indexdb",
          "localstorage",
          "shadercache",
          "serviceworkers",
          "cachestorage",
        ],
      });
    if (options.cache) {
      await session.clearCache();
      // Kept with the cache rather than the cookies: these are what make a
      // site still recognise the browser after its cookies are gone.
      await session.clearAuthCache();
      await session.clearHostResolverCache();
    }
  }
}
