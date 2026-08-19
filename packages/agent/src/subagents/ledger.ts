/**
 * The shared, in-memory store of one delegating run. Every task the run
 * dispatches with ledger access holds the same reference, so a finding one
 * worker posts is visible to — and deduplicated against — every other worker,
 * and the orchestrator reads the whole picture back without a single result
 * having to travel through a notification.
 *
 * Nothing here survives the run: the ledger is a coordination surface for work
 * in flight, not a record to keep. A fresh run starts with an empty one.
 */

export type LedgerItemKind = "event" | "category" | "page" | "note";

export type LedgerItemStatus =
  | "posted"
  | "claimed"
  | "analyzed"
  | "duplicate"
  | "irrelevant";

export interface LedgerItem {
  /** Dedup identity — the item's canonical URL when it has one. */
  key: string;
  kind: LedgerItemKind;
  category?: string;
  title: string;
  url?: string;
  date?: string;
  summary?: string;
  status: LedgerItemStatus;
  /** Task name that currently holds the item, once claimed. */
  owner?: string;
  /** Task name that first posted the item. */
  source: string;
  updatedAt: number;
}

export type LedgerPostInput = Pick<LedgerItem, "key" | "kind" | "title"> &
  Partial<Pick<LedgerItem, "category" | "url" | "date" | "summary">> & {
    source: string;
  };

export interface LedgerListFilter {
  category?: string;
  kind?: LedgerItemKind;
  status?: LedgerItemStatus;
  keys?: string[];
  q?: string;
  limit?: number;
}

export interface LedgerClaimFilter {
  kind?: LedgerItemKind;
  category?: string;
  limit?: number;
  /**
   * Also reclaim items whose claim is older than this — the abandoned batch
   * of a worker that died mid-task. Without it only `posted` items move.
   */
  staleMs?: number;
}

export interface LedgerStats {
  total: number;
  byStatus: Record<LedgerItemStatus, number>;
  /** Per-category status counts. Items with no category land under "(none)". */
  byCategory: Record<string, Record<LedgerItemStatus, number>>;
  /** How many claimed items each worker is holding — the straggler check:
   * a name here with nothing moving is a worker to chase or replace. */
  claimedBy: Record<string, number>;
}

/** What `update` did: resolved the item, could not find it, or refused
 * because another worker holds the claim. */
export interface LedgerResolution {
  ok: boolean;
  /** The resolved item, when the write went through. */
  item?: LedgerItem;
  /** Why it did not: no such key, or another worker holds the claim. */
  reason?: "missing" | "owned";
  /** The task that holds the claim, when that is what refused the write. */
  owner?: string;
}

export interface LedgerTaskTally {
  posted: number;
  claimed: number;
  updated: number;
}

/** How many items one claim hands out at most: a batch a worker can finish
 * and report on within a turn or two, small enough that several workers share
 * the pool instead of one draining it. */
export const LEDGER_CLAIM_MAX = 20;
const CLAIM_DEFAULT = 10;
const LIST_DEFAULT = 50;
const LIST_MAX = 200;
const UNCATEGORISED = "(none)";

const STATUSES: LedgerItemStatus[] = [
  "posted",
  "claimed",
  "analyzed",
  "duplicate",
  "irrelevant",
];

export class Ledger {
  readonly #items = new Map<string, LedgerItem>();
  readonly #tallies = new Map<string, LedgerTaskTally>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /**
   * Keyed upsert. A new key is created `posted`; an existing one is merged
   * into — but only ever additively once it has left `posted`. A re-find is
   * allowed to fill in what nobody knew yet; it is never allowed to overwrite
   * what the item's owner has since written, which is what keeps a search
   * worker's rough blurb from landing on top of an analysis verdict while the
   * two phases overlap. Status is never walked back either, so an event found
   * twice is still analysed once.
   */
  post(input: LedgerPostInput): { created: boolean; item: LedgerItem } {
    const existing = this.#items.get(input.key);
    this.#tally(input.source, "posted");
    if (existing) {
      // Unworked: the re-find is as current as anything already there.
      // Worked or in flight: fill gaps only.
      const open = existing.status === "posted";
      const merge = <K extends "title" | "category" | "url" | "date" | "summary">(
        field: K,
        value: LedgerItem[K],
      ) => {
        if (value === undefined) return;
        if (open || existing[field] === undefined) existing[field] = value;
      };
      merge("title", input.title || undefined);
      merge("category", input.category);
      merge("url", input.url);
      merge("date", input.date);
      merge("summary", input.summary);
      // Re-finding an unworked item freshens it; touching a claimed item's
      // timestamp would only mask a dead worker's abandoned batch.
      if (open) existing.updatedAt = this.#now();
      return { created: false, item: existing };
    }
    const item: LedgerItem = {
      key: input.key,
      kind: input.kind,
      category: input.category,
      title: input.title,
      url: input.url,
      date: input.date,
      summary: input.summary,
      status: "posted",
      source: input.source,
      updatedAt: this.#now(),
    };
    this.#items.set(item.key, item);
    return { created: true, item };
  }

  /** Compact, filterable read. `keys` narrows to an explicit set — the form a
   * directed dispatch fetches its assigned detail through. */
  list(filter: LedgerListFilter = {}): LedgerItem[] {
    const limit = Math.max(
      1,
      Math.min(LIST_MAX, Math.floor(filter.limit ?? LIST_DEFAULT)),
    );
    return this.#matching(filter).slice(0, limit);
  }

  /** How many items the same filter matches in full — what `list` would have
   * returned with no limit. A caller that reports a list as the whole answer
   * needs this to know whether it is. */
  count(filter: LedgerListFilter = {}): number {
    return this.#matching(filter).length;
  }

  #matching(filter: LedgerListFilter): LedgerItem[] {
    let items = [...this.#items.values()];
    if (filter.keys) items = items.filter((item) => filter.keys!.includes(item.key));
    if (filter.kind) items = items.filter((item) => item.kind === filter.kind);
    if (filter.category !== undefined)
      items = items.filter((item) => item.category === filter.category);
    if (filter.status)
      items = items.filter((item) => item.status === filter.status);
    if (filter.q) {
      const needle = filter.q.toLowerCase();
      items = items.filter((item) =>
        [item.title, item.summary, item.url, item.category]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(needle)),
      );
    }
    items.sort((a, b) => a.updatedAt - b.updatedAt);
    return items;
  }

  /**
   * Atomically reserves a batch for one owner: `posted` items first, then —
   * when `staleMs` is given — claims older than that, which are a dead
   * worker's abandoned work handed to someone alive. The whole reservation
   * happens synchronously, so two workers claiming in the same parallel tool
   * execution can never be handed the same item.
   *
   * `remaining` counts what a later claim could still take under the same
   * filters (items freshly claimed by other workers are theirs, not the
   * pool's) and is the pull loop's stop condition.
   */
  claim(
    owner: string,
    filter: LedgerClaimFilter = {},
  ): { claimed: LedgerItem[]; remaining: number; claimedElsewhere: number } {
    const now = this.#now();
    const matches = (item: LedgerItem) =>
      (filter.kind === undefined || item.kind === filter.kind) &&
      (filter.category === undefined || item.category === filter.category);
    const eligible = [...this.#items.values()].filter(
      (item) =>
        matches(item) &&
        (item.status === "posted" ||
          (item.status === "claimed" &&
            filter.staleMs !== undefined &&
            now - item.updatedAt > filter.staleMs)),
    );
    eligible.sort(
      (a, b) =>
        (a.status === "posted" ? 0 : 1) - (b.status === "posted" ? 0 : 1) ||
        a.updatedAt - b.updatedAt,
    );
    const limit = Math.max(
      1,
      Math.min(LEDGER_CLAIM_MAX, Math.floor(filter.limit ?? CLAIM_DEFAULT)),
    );
    const batch = eligible.slice(0, limit);
    for (const item of batch) {
      item.status = "claimed";
      item.owner = owner;
      item.updatedAt = now;
    }
    if (batch.length) this.#tally(owner, "claimed", batch.length);
    // Work someone else is holding right now: not claimable, but not done
    // either. A worker that stops at `remaining === 0` while this is positive
    // is leaving a batch to a peer that may never come back with it.
    const claimedElsewhere = [...this.#items.values()].filter(
      (item) =>
        item.status === "claimed" && item.owner !== owner && matches(item),
    ).length;
    return {
      claimed: batch.map((item) => ({ ...item })),
      remaining: eligible.length - batch.length,
      claimedElsewhere,
    };
  }

  /**
   * Resolves an item the caller is entitled to: one it claimed, or one still
   * unclaimed (the directed pattern, where the parent assigned the keys and
   * nobody reserved them). Writing over an item another worker holds is
   * refused rather than merged — the claim is what makes a batch disjoint, and
   * a resolution from outside it would undo that guarantee. Idempotent for the
   * rightful writer: the same call twice changes nothing.
   */
  update(
    key: string,
    patch: {
      status: Extract<LedgerItemStatus, "analyzed" | "duplicate" | "irrelevant">;
      summary?: string;
    },
    writer?: string,
  ): LedgerResolution {
    const item = this.#items.get(key);
    if (!item) return { ok: false, reason: "missing" };
    if (item.owner !== undefined && writer !== undefined && item.owner !== writer)
      return { ok: false, reason: "owned", owner: item.owner };
    item.status = patch.status;
    if (patch.summary !== undefined) item.summary = patch.summary;
    item.updatedAt = this.#now();
    if (writer) this.#tally(writer, "updated");
    return { ok: true, item };
  }

  /** The orchestrator's global track: per-category counts per status, so it
   * can see what is unworked, what is in flight, and who the stragglers are. */
  stats(filter: { category?: string } = {}): LedgerStats {
    const items = [...this.#items.values()].filter(
      (item) => filter.category === undefined || item.category === filter.category,
    );
    const byStatus = emptyStatusCounts();
    const byCategory: Record<string, Record<LedgerItemStatus, number>> = {};
    const claimedBy: Record<string, number> = {};
    for (const item of items) {
      byStatus[item.status] += 1;
      const category = item.category ?? UNCATEGORISED;
      byCategory[category] ??= emptyStatusCounts();
      byCategory[category]![item.status] += 1;
      if (item.status === "claimed" && item.owner)
        claimedBy[item.owner] = (claimedBy[item.owner] ?? 0) + 1;
    }
    return { total: items.length, byStatus, byCategory, claimedBy };
  }

  /** Per-task write tallies — which tasks have actually coordinated through
   * the ledger, so their notifications can point here instead of repeating
   * the data. */
  byTask(name: string): LedgerTaskTally {
    return { posted: 0, claimed: 0, updated: 0, ...this.#tallies.get(name) };
  }

  #tally(name: string, field: keyof LedgerTaskTally, count = 1): void {
    const tally = this.#tallies.get(name) ?? { posted: 0, claimed: 0, updated: 0 };
    tally[field] += count;
    this.#tallies.set(name, tally);
  }
}

function emptyStatusCounts(): Record<LedgerItemStatus, number> {
  return Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<
    LedgerItemStatus,
    number
  >;
}
