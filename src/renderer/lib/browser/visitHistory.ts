import {writable} from 'svelte/store';

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
 * hands them over as `data:` urls (src/main/favicon.ts). This list outlives
 * the build that wrote it, though, and entries stored before that carry the
 * site's own `/favicon.ico` url instead. Loading one is a guaranteed CSP
 * violation on the console at every launch, for an icon that can never appear,
 * so a remote value is dropped rather than kept and re-tried forever.
 */
function usableIcon(favicon: string | null | undefined): string | null {
  if (!favicon) return null;
  return /^(data|blob):/i.test(favicon) ? favicon : null;
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
      .map((entry) => ({...entry, favicon: usableIcon(entry.favicon)}));
  } catch {
    return [];
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
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // A full or unavailable store only costs the suggestions, not the visit.
      }
    }
    return next;
  });
}
