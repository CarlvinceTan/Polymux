/**
 * The order the hub rail puts its sources in, and its accounts within each of
 * them.
 *
 * The first order the rail shows becomes its baseline; later status responses
 * are discovery, not a request to reshuffle it. The rail lets a row be dragged
 * and remembers where it was put. It survives restarts in localStorage, next
 * to the browser history, because it is a preference about this window rather
 * than anything the backend needs to know.
 *
 * Only positions are stored, never the sources themselves: a platform that is
 * unlinked or a mailbox that is deleted leaves a stale id behind, and a stale id
 * simply never matches. A genuinely new source or account is appended after
 * the remembered ones in the order it was first seen.
 */
const KEY = 'polymuxHubRailOrder';

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

export type ObservedRailRow = {
  id: string;
  accountIds: string[];
};

export function loadRailOrder(): RailOrder {
  return load();
}

/** Adds ids the rail has seen without letting a later status refresh reorder
 * the ones it already knows. The first status therefore becomes a remembered
 * order even before anyone drags a row; future refreshes can only append a
 * genuinely new source or account. Stale ids deliberately remain, so an
 * account that disappears during a reconnect returns to the same position. */
export function rememberRailOrder(order: RailOrder, rows: ObservedRailRow[]): RailOrder {
  const appendMissing = (remembered: string[], observed: string[]): string[] => {
    const seen = new Set<string>();
    const next: string[] = [];
    for (const id of [...remembered, ...observed]) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      next.push(id);
    }
    return next;
  };

  const sources = appendMissing(order.sources, rows.map((row) => row.id));
  const accounts = {...order.accounts};
  let changed = sources.length !== order.sources.length ||
    sources.some((id, index) => id !== order.sources[index]);
  for (const row of rows) {
    const remembered = accounts[row.id] ?? [];
    const next = appendMissing(remembered, row.accountIds);
    if (next.length !== remembered.length || next.some((id, index) => id !== remembered[index])) {
      accounts[row.id] = next;
      changed = true;
    }
  }
  if (!changed) return order;
  const next = {sources, accounts};
  persist(next);
  return next;
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
    .map((item, index) => ({item, index, rank: rank.get(key(item)) ?? Number.POSITIVE_INFINITY}))
    .sort((a, b) => {
      return a.rank === b.rank ? a.index - b.index : a.rank - b.rank;
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
