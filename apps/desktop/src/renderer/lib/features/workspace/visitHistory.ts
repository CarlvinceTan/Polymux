import {writable} from 'svelte/store';
import {flareaiApi} from '../../api/flareai';

/**
 * Pages visited in the embedded browser, most recent first. The workspace
 * launcher offers these instead of the generic create-something suggestions
 * once there are enough of them to be worth showing, so it survives restarts
 * in localStorage rather than living for one window's lifetime.
 */
export type Visit = {url: string; title: string; favicon?: string | null};

/** Below this the list reads as noise, so the launcher falls back to the
 * create-something suggestions. */
export const HISTORY_SUGGESTION_MINIMUM = 3;
/** What the launcher shows at most; the store keeps a little more so closing
 * one entry still leaves a full list. */
export const HISTORY_SUGGESTION_LIMIT = 5;
const KEY = 'flareaiBrowserHistory';
const CAP = 24;

function normalized(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch {
    return value;
  }
}

/**
 * The renderer's CSP is `img-src 'self' data: blob:`, so an icon is only ever
 * usable as bytes it already holds — the main process fetches favicons and
 * hands them over as `data:` urls (src/main/browser/favicon.ts). Anything else
 * is a guaranteed CSP violation on the console for an icon that can never
 * appear, so a remote value is dropped rather than kept and re-tried forever.
 */
function usableIcon(favicon: string | null | undefined): string | null {
  if (!favicon) return null;
  return /^(data|blob):/i.test(favicon) ? favicon : null;
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Sites already asked about under the current scheme. Icons are no longer
 * stored with the history, so without this the five rows on screen would each
 * cost an ipc round trip on every redraw. */
let asked = new Map<string, Promise<string | null>>();

/**
 * Fills in the icons for the visits given.
 *
 * A site serves one mark per colour scheme, and this list outlives both a theme
 * change and a restart — so an icon stored alongside a visit is only right
 * until the user switches theme, and wrong forever after on a site that ships a
 * single scheme-specific mark. Resolving when the row is drawn is what keeps
 * the answer current; the main process replies from its own per-origin,
 * per-scheme cache, so this is a round trip rather than a fetch.
 *
 * The trailing argument is a reactivity trigger, not a value this reads.
 */
export function resolveVisitFavicons(visits: Visit[], _revision = 0): void {
  for (const visit of visits) {
    const origin = originOf(visit.url);
    // Checked before anything async so a redraw caused by the update below
    // stops here rather than asking again.
    if (!origin || asked.has(origin)) continue;
    const pending = flareaiApi().browser.favicon(origin).catch((): null => null);
    asked.set(origin, pending);
    void pending.then((favicon) => {
      if (!usableIcon(favicon)) return;
      visitHistory.update((entries) =>
        entries.map((entry) => (originOf(entry.url) === origin ? {...entry, favicon} : entry)),
      );
    });
  }
}

/**
 * Drops what was resolved under the previous scheme, so the next draw asks
 * again. The icons already on screen are deliberately left in place: a stale
 * mark holds the row better than a globe does for the moment the right one
 * takes to arrive, and if the stale one is invisible the drawer's own probe
 * shows the globe anyway.
 */
export function forgetVisitFavicons(): void {
  asked = new Map();
}

/** Hosts whose result pages are a step on the way somewhere, not a
 * destination. Matched on the registrable-looking tail so regional domains
 * (google.com.sg, bing.co.uk) and `www.`/`search.` prefixes all land. */
const SEARCH_HOSTS = [
  'google.',
  'bing.',
  'duckduckgo.',
  'yahoo.',
  'baidu.',
  'yandex.',
  'ecosia.',
  'startpage.',
  'search.brave.',
  'qwant.',
  'mojeek.',
  'searx.',
  'lite.duckduckgo.',
];
/** The query keys the engines above put the terms under. */
const SEARCH_PARAMS = ['q', 'query', 'p', 'wd', 'text', 'k', 'eddt'];

/**
 * A search-results page is the agent's own work showing through — the user
 * asked for a site, not for the query that found it. Anything on a known
 * engine's host is dropped, as is any `/search?q=` style url elsewhere.
 */
function isSearchResult(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const hasTerms = SEARCH_PARAMS.some((key) => Boolean(url.searchParams.get(key)));
  const searchPath = /(^|\/)(search|results)(\/|$)/i.test(url.pathname);
  // An engine's own product pages (docs.google.com/document/…) are real
  // destinations, so a known host only counts when it is being searched.
  const engineHost = SEARCH_HOSTS.some((engine) => host === engine.slice(0, -1) || host.includes(engine));
  if (engineHost && (hasTerms || searchPath)) return true;
  return searchPath && hasTerms;
}

function load(): Visit[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((entry): entry is Visit => Boolean(entry) && typeof (entry as Visit).url === 'string')
      // Lists written before search results were excluded still hold them.
      .filter((entry) => worthKeeping(entry.url))
      .slice(0, CAP)
      // Icons are resolved per scheme when a row is drawn, never read back:
      // lists written by an older build still carry bytes, and those were
      // chosen under whichever theme was in use when they were stored.
      .map((entry) => ({url: entry.url, title: entry.title, favicon: null}));
  } catch {
    return [];
  }
}

/** Icons are left out on purpose — see `resolveVisitFavicons`. Dropping them
 * also keeps the list well clear of the storage quota, which a couple of dozen
 * inline images had been eating into. */
function persist(entries: Visit[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.map(({url, title}) => ({url, title}))));
  } catch {
    // A full or unavailable store only costs the suggestions, not the visit.
  }
}

export const visitHistory = writable<Visit[]>(load());

/** A blank tab has no page behind it yet, internal pages are not somewhere the
 * user can be offered to go back to, and search results are not a destination. */
function worthKeeping(url: string): boolean {
  if (!url || !/^https?:/i.test(url)) return false;
  try {
    return !isSearchResult(new URL(url));
  } catch {
    return false;
  }
}

export function recordVisit(visit: Visit): void {
  if (!worthKeeping(visit.url)) return;
  const url = normalized(visit.url);
  visitHistory.update((entries) => {
    const previous = entries.find((entry) => normalized(entry.url) === url);
    const next = [
      {
        url,
        title: visit.title || previous?.title || url,
        favicon: usableIcon(visit.favicon) ?? previous?.favicon ?? null,
      },
      ...entries.filter((entry) => normalized(entry.url) !== url),
    ].slice(0, CAP);
    persist(next);
    return next;
  });
}
