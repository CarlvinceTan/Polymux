import type { AgentTool } from "@flareai/core";
import type { JsonObject } from "@flareai/inference";
import { Ledger, LEDGER_CLAIM_MAX } from "./ledger.js";
import type { LedgerItem } from "./ledger.js";

/** How old a claim must be before another worker may take it over. Long
 * enough that a slow worker never loses its batch, short enough that a dead
 * worker's batch is reclaimed while the pull loop is still draining. */
const DEFAULT_STALE_MS = 120_000;

const KINDS = ["event", "category", "page", "note"] as const;
const TERMINAL_STATUSES = ["analyzed", "duplicate", "irrelevant"] as const;
const STATUSES = ["posted", "claimed", ...TERMINAL_STATUSES] as const;

/** The reads a delegating run always gets: cheap, stateless, and the way its
 * global track stays current while workers report through the ledger instead
 * of through their closing messages. */
export function createLedgerReadTools(ledger: Ledger): AgentTool[] {
  return [createLedgerListTool(ledger), createLedgerStatsTool(ledger)];
}

/** What a worker dispatched with `ledger: true` gets: it can record findings,
 * pull batches of unworked items, and mark what it finishes — all tagged with
 * its task name, so the fleet can tell the orchestrator who wrote what. */
export function createLedgerWorkerTools(ledger: Ledger, source: string): AgentTool[] {
  return [
    createLedgerPostTool(ledger, source),
    createLedgerClaimTool(ledger, source),
    createLedgerUpdateTool(ledger, source),
    createLedgerListTool(ledger),
  ];
}

function createLedgerPostTool(ledger: Ledger, source: string): AgentTool {
  return {
    name: "ledger_post",
    description: [
      "Record a finding in the ledger shared with every other worker on this job, so coverage is visible and nothing is analysed twice.",
      "",
      "- One call per distinct item, as soon as you find it — do not batch your findings into your closing message; the ledger is how they reach the orchestrator.",
      "- `key` is the dedup identity: use the item's canonical URL when it has one. Re-posting an existing key merges instead of duplicating, and the result's `created: false` tells you another worker already found it — move on rather than analyse it again.",
      "- Set `kind` to what the item is and `category` to the grouping it came from (e.g. the category page), so the orchestrator can track coverage per category.",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Dedup identity — the item's canonical URL when it has one.",
        },
        kind: {
          type: "string",
          enum: [...KINDS],
          description: "What the item is.",
        },
        title: { type: "string", description: "The item's name or headline." },
        category: {
          type: "string",
          description: "The grouping it belongs to (e.g. the category page it came from).",
        },
        url: { type: "string", description: "Where the item lives, when distinct from `key`." },
        date: { type: "string", description: "When it happens, for dated items." },
        summary: {
          type: "string",
          description: "What you already know about it — a sentence or two.",
        },
      },
      required: ["key", "kind", "title"],
      additionalProperties: false,
    },
    async execute(input: JsonObject) {
      const { created, item } = ledger.post({
        key: required(input, "key"),
        kind: oneOf(input, "kind", KINDS),
        title: required(input, "title"),
        category: optional(input, "category"),
        url: optional(input, "url"),
        date: optional(input, "date"),
        summary: optional(input, "summary"),
        source,
      });
      return {
        content: JSON.stringify({
          key: item.key,
          created,
          status: item.status,
          note: created
            ? "Recorded."
            : "Already in the ledger — merged, not duplicated. Do not analyse it again if someone else owns it.",
        }),
      };
    },
  };
}

function createLedgerClaimTool(ledger: Ledger, source: string): AgentTool {
  return {
    name: "ledger_claim",
    description: [
      "Claim the next batch of unworked ledger items for yourself. Claimed items are reserved to you alone — a concurrent worker's claim can never receive the same item — so everything you claim, you must then work and mark with ledger_update.",
      "",
      "Loop until the pool is empty: claim → work the batch → ledger_update each item → claim again. You may stop only when a claim comes back with `remaining: 0` **and** `claimed_elsewhere: 0` — the first means nothing is unworked, the second that no other worker is still holding a batch. When `claimed_elsewhere` is above 0, claim once more with `stale_ms` set before you stop: if the worker holding those items died, its batch is handed to you rather than lost.",
      "",
      `Items claimed longer than \`stale_ms\` (default ${DEFAULT_STALE_MS}ms) without an update belonged to a worker that died mid-batch; claiming takes them over so the loop drains instead of stalling.`,
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [...KINDS],
          description: "Claim only items of this kind (e.g. \"event\" once search has posted events).",
        },
        category: {
          type: "string",
          description: "Claim only items in this category.",
        },
        limit: {
          type: "number",
          description: `Batch size. Defaults to 10, capped at ${LEDGER_CLAIM_MAX}.`,
        },
        stale_ms: {
          type: "number",
          description: `Also reclaim claims older than this many milliseconds. Defaults to ${DEFAULT_STALE_MS}.`,
        },
      },
      additionalProperties: false,
    },
    async execute(input: JsonObject) {
      const limit =
        typeof input.limit === "number" && Number.isFinite(input.limit)
          ? input.limit
          : undefined;
      const staleMs =
        typeof input.stale_ms === "number" && Number.isFinite(input.stale_ms)
          ? input.stale_ms
          : DEFAULT_STALE_MS;
      const { claimed, remaining, claimedElsewhere } = ledger.claim(source, {
        kind: input.kind ? oneOf(input, "kind", KINDS) : undefined,
        category: optional(input, "category"),
        limit,
        staleMs,
      });
      return {
        content: JSON.stringify({
          claimed: claimed.map(compact),
          remaining,
          claimed_elsewhere: claimedElsewhere,
          note: claimed.length
            ? "Work this batch, ledger_update each item, then claim again."
            : remaining > 0
              ? "Nothing free this moment, but the pool is not empty — claim again after finishing what you hold."
              : claimedElsewhere > 0
                ? `Nothing to claim, but ${claimedElsewhere} item(s) are still held by other workers. Claim once more with \`stale_ms\` before you stop: if one of them died, its batch comes to you.`
                : "The pool is empty and nothing is in flight — you are done.",
        }),
      };
    },
  };
}

function createLedgerUpdateTool(ledger: Ledger, source: string): AgentTool {
  return {
    name: "ledger_update",
    description: [
      "Mark a ledger item you claimed as resolved — only one you hold, or one the orchestrator assigned you that nobody has claimed; resolving another worker's item is refused. The orchestrator reads results back through ledger_list, so write each `summary` to stand alone — it is the item's analysis, not a note to yourself.",
      "",
      '- "analyzed": you judged it against the brief; `summary` carries the verdict.',
      '- "duplicate": it is the same thing as another key; `summary` names that key.',
      '- "irrelevant": it does not match the brief; `summary` says why in a few words.',
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "The item's key." },
        status: {
          type: "string",
          enum: [...TERMINAL_STATUSES],
          description: "The item's resolution.",
        },
        summary: {
          type: "string",
          description: "The finding, written to stand alone.",
        },
      },
      required: ["key", "status"],
      additionalProperties: false,
    },
    async execute(input: JsonObject) {
      const key = required(input, "key");
      const resolution = ledger.update(
        key,
        {
          status: oneOf(input, "status", TERMINAL_STATUSES),
          summary: optional(input, "summary"),
        },
        source,
      );
      if (!resolution.ok)
        return {
          content:
            resolution.reason === "missing"
              ? `No ledger item with key "${key}" — check the key against ledger_list.`
              : `"${key}" is claimed by ${resolution.owner} and is theirs to resolve. Work the items your own ledger_claim handed you.`,
          isError: true,
        };
      return { content: JSON.stringify({ key, status: resolution.item!.status }) };
    },
  };
}

function createLedgerListTool(ledger: Ledger): AgentTool {
  return {
    name: "ledger_list",
    description: [
      "Read items from the run's shared ledger, filtered by `category`, `kind`, `status`, an explicit set of `keys`, or a text query `q` over titles, summaries and urls.",
      "",
      "`total` is how many items match in full: whenever it exceeds `returned` the list is a page, not the answer — raise `limit` or narrow the filter before reporting it as complete.",
      "",
      "A directed dispatch uses this to fetch the details of the keys it was assigned. The orchestrator uses it to see what the fleet has found so far and to collect everything `analyzed` once workers are done.",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "Only this category." },
        kind: { type: "string", enum: [...KINDS], description: "Only this kind." },
        status: {
          type: "string",
          enum: [...STATUSES],
          description: "Only items in this status.",
        },
        keys: {
          type: "array",
          items: { type: "string" },
          description: "Only these keys — the directed-read form.",
        },
        q: {
          type: "string",
          description: "Substring match over title, summary, url and category.",
        },
        limit: {
          type: "number",
          description: "Most items to return, oldest first. Defaults to 50.",
        },
      },
      additionalProperties: false,
    },
    async execute(input: JsonObject) {
      const keys = Array.isArray(input.keys)
        ? input.keys.filter((key): key is string => typeof key === "string")
        : undefined;
      const filter = {
        category: optional(input, "category"),
        kind: input.kind ? oneOf(input, "kind", KINDS) : undefined,
        status: input.status ? oneOf(input, "status", STATUSES) : undefined,
        keys,
        q: optional(input, "q"),
        limit:
          typeof input.limit === "number" && Number.isFinite(input.limit)
            ? input.limit
            : undefined,
      };
      const items = ledger.list(filter);
      const total = ledger.count(filter);
      return {
        content: JSON.stringify({
          items: items.map(compact),
          returned: items.length,
          total,
          ...(total > items.length
            ? {
                truncated: true,
                note: `Showing ${items.length} of ${total} matching items — raise \`limit\` or narrow the filter before treating this as the whole set.`,
              }
            : {}),
        }),
      };
    },
  };
}

function createLedgerStatsTool(ledger: Ledger): AgentTool {
  return {
    name: "ledger_stats",
    description: [
      "Per-category counts of ledger items by status — the global view of coverage: what is still `posted` (unworked), what is `claimed` (in flight), and what is done (`analyzed` / `duplicate` / `irrelevant`). `claimedBy` names which worker is holding how many, so a batch stuck with a task that has already reported back is visible as a straggler to chase or reassign.",
      "",
      "Use it to decide whether to dispatch more workers and whether a phase has finished — never to re-dispatch items a worker already holds. And never run directed assignment and pull-claiming over the same items in the same phase: direct when you must guarantee exactly who covers what, pull when the pool is large or still growing.",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Only count this category.",
        },
      },
      additionalProperties: false,
    },
    async execute(input: JsonObject) {
      const stats = ledger.stats({ category: optional(input, "category") });
      return { content: JSON.stringify(stats) };
    },
  };
}

/** The ledger row as a tool reports it: everything except the bookkeeping
 * timestamps, which only the staleness logic reads. */
function compact(item: LedgerItem): Record<string, unknown> {
  return {
    key: item.key,
    kind: item.kind,
    ...(item.category !== undefined ? { category: item.category } : {}),
    title: item.title,
    ...(item.url !== undefined ? { url: item.url } : {}),
    ...(item.date !== undefined ? { date: item.date } : {}),
    ...(item.summary !== undefined ? { summary: item.summary } : {}),
    status: item.status,
    ...(item.owner !== undefined ? { owner: item.owner } : {}),
    source: item.source,
  };
}

function required(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}

function optional(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function oneOf<T extends string>(input: JsonObject, key: string, values: readonly T[]): T {
  const value = input[key];
  if (typeof value !== "string" || !values.includes(value as T))
    throw new Error(`${key} must be one of: ${values.join(", ")}`);
  return value as T;
}
