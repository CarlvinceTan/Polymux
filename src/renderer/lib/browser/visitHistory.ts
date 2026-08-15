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
const KEY = 'midasBrowserHistory';
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

function load(): Visit[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((entry): entry is Visit => Boolean(entry) && typeof (entry as Visit).url === 'string')
      .slice(0, CAP)
      .map((entry) => ({...entry, favicon: usableIcon(entry.favicon)}));
  } catch {
    return [];
  }
}

export const visitHistory = writable<Visit[]>(load());

/** A blank tab has no page behind it yet, and internal pages are not somewhere
 * the user can be offered to go back to. */
function worthKeeping(url: string): boolean {
  return Boolean(url) && /^https?:/i.test(url);
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
