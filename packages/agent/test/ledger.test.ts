import assert from "node:assert/strict";
import { test } from "node:test";
import { Ledger, LEDGER_CLAIM_MAX, type LedgerItemStatus } from "../src/subagents/ledger.js";

const event = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  kind: "event" as const,
  title: `Event ${key}`,
  source: "task_1",
  ...extra,
});

/** A ledger whose clock the test winds by hand, so staleness is exact. */
function timedLedger() {
  let now = 1_000;
  const ledger = new Ledger(() => now);
  return { ledger, advance: (ms: number) => (now += ms) };
}

test("post creates, and a re-post merges without clobbering status", () => {
  const ledger = new Ledger();
  const first = ledger.post(event("a", { date: "Fri", category: "Social" }));
  assert.equal(first.created, true);
  assert.equal(first.item.status, "posted");

  ledger.claim("task_2", {});
  const repost = ledger.post({
    key: "a",
    kind: "event",
    title: "Event a — renamed",
    category: "Social",
    summary: "seen again",
    source: "task_3",
  });
  assert.equal(repost.created, false, "the keyed upsert must report the re-find");
  // The claim survives, the original source stays the item's discoverer, and
  // the re-find may only fill gaps: it adds the summary nobody had written,
  // and leaves the title the owner is working under alone.
  assert.equal(repost.item.status, "claimed");
  assert.equal(repost.item.owner, "task_2");
  assert.equal(repost.item.source, "task_1");
  assert.equal(repost.item.title, "Event a");
  assert.equal(repost.item.summary, "seen again");
  assert.equal(repost.item.date, "Fri");
  assert.equal(ledger.list().length, 1);
});

test("a late re-find never writes over an analysis", () => {
  // Search and analysis overlap by design: a search worker can re-find an
  // event minutes after another worker has judged it. Its rough blurb must
  // not land on top of the verdict the parent is going to read back.
  const ledger = new Ledger();
  ledger.post(event("a", { summary: "found on the sports page" }));
  ledger.claim("task_2", {});
  ledger.update("a", { status: "analyzed", summary: "relevant: welcome night" }, "task_2");
  ledger.post(event("a", { summary: "climbing social, Friday", source: "task_3" }));
  const item = ledger.list({ keys: ["a"] })[0]!;
  assert.equal(item.summary, "relevant: welcome night");
  assert.equal(item.status, "analyzed");
});

test("a re-posted analysed event is not resurrected for a second analysis", () => {
  const ledger = new Ledger();
  ledger.post(event("a"));
  ledger.claim("task_2", {});
  ledger.update("a", { status: "analyzed", summary: "worth it" }, "task_2");
  const repost = ledger.post(event("a", { source: "task_4" }));
  assert.equal(repost.created, false);
  assert.equal(repost.item.status, "analyzed");
  assert.equal(repost.item.summary, "worth it");
  // And it never comes back out of a claim.
  assert.deepEqual(ledger.claim("task_5", {}).claimed, []);
});

test("claim reserves posted items first and hands out disjoint batches", () => {
  const ledger = new Ledger();
  for (const key of ["a", "b", "c", "d", "e"]) ledger.post(event(key));
  const first = ledger.claim("task_2", { limit: 2 });
  const second = ledger.claim("task_3", { limit: 2 });
  assert.deepEqual(first.claimed.map((item) => item.key), ["a", "b"]);
  assert.deepEqual(second.claimed.map((item) => item.key), ["c", "d"]);
  const overlap = first.claimed.filter((item) =>
    second.claimed.some((other) => other.key === item.key),
  );
  assert.deepEqual(overlap, [], "parallel claims must never share an item");
  assert.equal(first.remaining, 3, "remaining counts what a later claim can take");
  assert.equal(second.remaining, 1);
  for (const item of first.claimed) assert.equal(item.owner, "task_2");
  assert.deepEqual(ledger.claim("task_4", {}).claimed.map((item) => item.key), ["e"]);
  assert.equal(ledger.claim("task_4", {}).remaining, 0);
});

test("claim reports what other workers still hold, so nobody stops on a stranded batch", () => {
  const { ledger, advance } = timedLedger();
  for (const key of ["a", "b"]) ledger.post(event(key));
  const mine = ledger.claim("task_2", { limit: 1 });
  assert.equal(mine.claimedElsewhere, 0, "your own batch is not someone else's");
  const theirs = ledger.claim("task_3", { limit: 1 });
  assert.equal(theirs.remaining, 0, "nothing is claimable...");
  assert.equal(theirs.claimedElsewhere, 1, "...but task_2 is still holding one");

  // task_3 finishes its own item, then task_2 dies. task_3 checks once more
  // with stale_ms rather than stopping, and the stranded item comes to it
  // instead of being lost.
  ledger.update(theirs.claimed[0]!.key, { status: "analyzed" }, "task_3");
  advance(5_000);
  const rescued = ledger.claim("task_3", { staleMs: 1_000 });
  assert.deepEqual(rescued.claimed.map((item) => item.key), ["a"]);
  assert.equal(rescued.remaining, 0);
  assert.equal(rescued.claimedElsewhere, 0, "nothing left in anyone else's hands");
});

test("count says how much a filter really matches, so a page is never read as the whole set", () => {
  const ledger = new Ledger();
  for (let i = 0; i < 120; i += 1) ledger.post(event(`e${i}`, { category: "Social" }));
  assert.equal(ledger.list({ limit: 50 }).length, 50);
  assert.equal(ledger.count({}), 120, "the full match count is what tells a caller it saw a page");
  assert.equal(ledger.count({ category: "Sports" }), 0);
  assert.equal(ledger.list().length, 50, "the default limit still pages");
});

test("claim respects kind and category filters, and caps the batch", () => {
  const ledger = new Ledger();
  for (let i = 0; i < LEDGER_CLAIM_MAX + 5; i += 1)
    ledger.post(event(`e${i}`, { category: i % 2 ? "Sports" : "Social" }));
  ledger.post({ key: "page-1", kind: "page", title: "Page", source: "task_1" });

  const events = ledger.claim("task_2", { kind: "event", limit: LEDGER_CLAIM_MAX + 10 });
  assert.equal(events.claimed.length, LEDGER_CLAIM_MAX, "the cap holds");
  assert.ok(events.claimed.every((item) => item.kind === "event"));

  const social = ledger.claim("task_3", { kind: "event", category: "Social" });
  assert.ok(social.claimed.every((item) => item.category === "Social"));
  const pages = ledger.claim("task_4", { kind: "page" });
  assert.deepEqual(pages.claimed.map((item) => item.key), ["page-1"]);
  assert.equal(pages.remaining, 0);
});

test("a dead worker's claim is reclaimed only once it is stale", () => {
  const { ledger, advance } = timedLedger();
  ledger.post(event("a"));
  ledger.post(event("b"));
  const claimed = ledger.claim("task_2", {});
  assert.equal(claimed.claimed.length, 2);

  // Fresh claims are the owner's, staleMs or not.
  assert.equal(ledger.claim("task_3", { staleMs: 1_000 }).claimed.length, 0);

  advance(1_500);
  // Without staleMs, claimed items are simply out of the pool.
  assert.equal(ledger.claim("task_3", {}).claimed.length, 0);

  const reclaimed = ledger.claim("task_3", { staleMs: 1_000 });
  assert.deepEqual(
    reclaimed.claimed.map((item) => item.key).sort(),
    ["a", "b"],
    "the abandoned batch goes to a live worker",
  );
  assert.ok(reclaimed.claimed.every((item) => item.owner === "task_3"));
});

test("claim takes posted work before stale reclaimed work", () => {
  const { ledger, advance } = timedLedger();
  ledger.post(event("old"));
  ledger.claim("task_2", {});
  advance(10_000);
  ledger.post(event("fresh"));
  const batch = ledger.claim("task_3", { limit: 1, staleMs: 1_000 });
  assert.deepEqual(batch.claimed.map((item) => item.key), ["fresh"]);
  assert.equal(batch.remaining, 1, "the stale item still counts as claimable");
});

test("update refuses to resolve an item another worker holds", () => {
  const ledger = new Ledger();
  ledger.post(event("a"));
  ledger.claim("task_2", {});
  const refused = ledger.update("a", { status: "analyzed", summary: "mine" }, "task_3");
  assert.deepEqual(refused, { ok: false, reason: "owned", owner: "task_2" });
  const item = ledger.list({ keys: ["a"] })[0]!;
  assert.equal(item.status, "claimed", "the claim holds against an outside write");
  assert.equal(item.summary, undefined);
  // The owner writes it, and an unclaimed item stays open to the directed
  // pattern, where the parent assigned the keys and nobody reserved them.
  assert.equal(ledger.update("a", { status: "analyzed" }, "task_2").ok, true);
  ledger.post(event("b"));
  assert.equal(ledger.update("b", { status: "irrelevant" }, "task_9").ok, true);
});

test("update resolves an item idempotently and keeps a standalone summary", () => {
  const ledger = new Ledger();
  ledger.post(event("a"));
  assert.deepEqual(ledger.update("missing", { status: "analyzed" }, "task_2"), {
    ok: false,
    reason: "missing",
  });
  ledger.update("a", { status: "analyzed", summary: "relevant: welcome night" }, "task_2");
  ledger.update("a", { status: "analyzed", summary: "relevant: welcome night" }, "task_2");
  const item = ledger.list({ keys: ["a"] })[0]!;
  assert.equal(item.status, "analyzed");
  assert.equal(item.summary, "relevant: welcome night");
  assert.equal(ledger.stats().byStatus.analyzed, 1);
});

test("stats count per category and per status", () => {
  const ledger = new Ledger();
  ledger.post(event("a", { category: "Social" }));
  ledger.post(event("b", { category: "Social" }));
  ledger.post(event("c", { category: "Sports" }));
  ledger.claim("task_2", { category: "Sports" });
  ledger.update("c", { status: "irrelevant" }, "task_2");

  const stats = ledger.stats();
  assert.equal(stats.total, 3);
  assert.equal(stats.byStatus.posted, 2);
  assert.equal(stats.byStatus.irrelevant, 1);
  assert.deepEqual(stats.byCategory.Social, counts({ posted: 2 }));
  assert.deepEqual(stats.byCategory.Sports, counts({ irrelevant: 1 }));

  // Who is holding what: the straggler check the orchestrator runs.
  ledger.post(event("d", { category: "Social" }));
  ledger.claim("task_3", { category: "Social", limit: 1 });
  assert.deepEqual(ledger.stats().claimedBy, { task_3: 1 });
  assert.deepEqual(ledger.stats({ category: "Sports" }).claimedBy, {});

  const socialOnly = ledger.stats({ category: "Social" });
  assert.equal(socialOnly.total, 3);
  assert.equal(socialOnly.byCategory.Sports, undefined);
});

test("list filters by status, kind, keys and query", () => {
  const ledger = new Ledger();
  ledger.post(event("a", { category: "Social", title: "Welcome Night" }));
  ledger.post(event("b", { category: "Sports", title: "5K Run" }));
  ledger.post({ key: "c", kind: "page", title: "Committee", source: "task_1" });
  ledger.claim("task_2", { kind: "event" });

  assert.deepEqual(
    ledger.list({ status: "claimed" }).map((item) => item.key).sort(),
    ["a", "b"],
  );
  assert.deepEqual(ledger.list({ kind: "page" }).map((item) => item.key), ["c"]);
  assert.deepEqual(ledger.list({ keys: ["b"] }).map((item) => item.key), ["b"]);
  assert.deepEqual(ledger.list({ q: "welcome" }).map((item) => item.key), ["a"]);
  assert.equal(ledger.list({ limit: 2 }).length, 2);
});

test("byTask tallies each task's writes, so the fleet knows who used the ledger", () => {
  const ledger = new Ledger();
  ledger.post(event("a"));
  ledger.post(event("a", { source: "task_2" }));
  ledger.claim("task_2", {});
  ledger.update("a", { status: "analyzed" }, "task_2");

  assert.deepEqual(ledger.byTask("task_1"), { posted: 1, claimed: 0, updated: 0 });
  assert.deepEqual(ledger.byTask("task_2"), { posted: 1, claimed: 1, updated: 1 });
  assert.deepEqual(ledger.byTask("task_9"), { posted: 0, claimed: 0, updated: 0 });
});

function counts(partial: Partial<Record<LedgerItemStatus, number>>) {
  return { posted: 0, claimed: 0, analyzed: 0, duplicate: 0, irrelevant: 0, ...partial };
}
