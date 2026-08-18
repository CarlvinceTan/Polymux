/**
 * The order the hub rail puts its sources in, and its accounts within each of
 * them.
 *
 * The rail's natural order is whatever the status report happens to list —
 * bridges as the homeserver returns them, mailboxes as Himalaya's config holds
 * them. That is not an order anyone chose, so the rail lets a row be dragged
 * and remembers where it was put. It survives restarts in localStorage, next to
 * the browser history, because it is a preference about this window rather than
 * anything the backend needs to know.
 *
 * Only positions are stored, never the sources themselves: a platform that is
 * unlinked or a mailbox that is deleted leaves a stale id behind, and a stale id
 * simply never matches. Anything the store has no opinion about keeps its
 * natural order, after everything it does.
 */
const KEY = 'flareaiHubRailOrder';

type Stored = {
  /** Rail rows, top to bottom: `platform:<name>` and `mail`. */
  sources: string[];
  /** Account ids within a row, keyed by that row's id. */
  accounts: Record<string, string[]>;
};

function load(): Stored {
  if (typeof localStorage === 'undefined') return {sources: [], accounts: {}};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {sources: [], accounts: {}};
    const stored = raw as Partial<Stored>;
    const accounts: Record<string, string[]> = {};
    for (const [group, ids] of Object.entries(stored.accounts ?? {}))
      if (Array.isArray(ids)) accounts[group] = ids.filter((id): id is string => typeof id === 'string');
    return {
      sources: Array.isArray(stored.sources)
        ? stored.sources.filter((id): id is string => typeof id === 'string')
        : [],
      accounts,
    };
  } catch {
    return {sources: [], accounts: {}};
  }
}

function persist(order: Stored): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    // A full or unavailable store costs the arrangement, not the rail.
  }
}

export type RailOrder = Stored;

export function loadRailOrder(): RailOrder {
  return load();
}

export function saveSourceOrder(order: RailOrder, sources: string[]): RailOrder {
  const next = {...order, sources};
  persist(next);
  return next;
}

export function saveAccountOrder(order: RailOrder, group: string, ids: string[]): RailOrder {
  const next = {...order, accounts: {...order.accounts, [group]: ids}};
  persist(next);
  return next;
}

/**
 * Sorts by the stored order, keeping anything unlisted in the order it arrived
 * in and after everything that is listed — so a newly linked platform appears
 * at the bottom rather than somewhere arbitrary among rows the user placed.
 */
export function applyOrder<T>(items: T[], key: (item: T) => string, order: string[]): T[] {
  const rank = new Map(order.map((id, index) => [id, index] as const));
  return items
    .map((item, index) => ({item, index}))
    .sort((a, b) => {
      const left = rank.get(key(a.item)) ?? Number.POSITIVE_INFINITY;
      const right = rank.get(key(b.item)) ?? Number.POSITIVE_INFINITY;
      return left === right ? a.index - b.index : left - right;
    })
    .map((entry) => entry.item);
}

/** The list with `id` moved `step` places, clamped to the ends. */
export function moveBy(ids: string[], id: string, step: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const to = Math.min(ids.length - 1, Math.max(0, from + step));
  if (to === from) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
