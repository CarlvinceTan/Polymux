import assert from "node:assert/strict";
import test from "node:test";
import {
  type AddressRow,
  addressRowRank,
  displayUrl,
  findInlineCompletionCandidate,
  getInlineCompletion,
  looksLikeAddress,
  rankAddressRows,
} from "./browserAddressSuggestions";

const sampleRows: AddressRow[] = [
  {
    id: "history-github",
    kind: "history",
    title: "CarlvinceTan/Polymux - GitHub",
    detail: "github.com/CarlvinceTan/Polymux",
    value: "https://github.com/CarlvinceTan/Polymux",
  },
  {
    id: "history-polymux",
    kind: "history",
    title: "Polymux — Your personal assistant, ready from the start",
    detail: "polymux.com",
    value: "https://polymux.com/",
  },
  {
    id: "history-posthog",
    kind: "history",
    title: "Install AI Observability with PostHog - Docs",
    detail: "posthog.com/docs/ai-observability/installation",
    value: "https://posthog.com/docs/ai-observability/installation",
  },
  {
    id: "search-po",
    kind: "search",
    title: "po",
    detail: "Search with Google",
    value: "po",
  },
  {
    id: "search-porous",
    kind: "search",
    title: "porous beige stone material",
    detail: "Search with Google",
    value: "porous beige stone material",
  },
];

test("displayUrl extracts clean host and path", () => {
  assert.equal(displayUrl("https://polymux.com/"), "polymux.com");
  assert.equal(displayUrl("https://polymux.com/docs"), "polymux.com/docs");
  assert.equal(
    displayUrl("http://localhost:3000/test?foo=bar"),
    "localhost:3000/test?foo=bar",
  );
  assert.equal(displayUrl("invalid-url"), "invalid-url");
});

test("looksLikeAddress detects URLs and domains", () => {
  assert.equal(looksLikeAddress("https://google.com"), true);
  assert.equal(looksLikeAddress("localhost:5173"), true);
  assert.equal(looksLikeAddress("polymux.com"), true);
  assert.equal(looksLikeAddress("po"), false);
  assert.equal(looksLikeAddress("porous stone"), false);
});

test("getInlineCompletion matches host prefix for history rows", () => {
  const polymuxRow = sampleRows[1];
  assert.equal(getInlineCompletion("po", polymuxRow), "polymux.com");
  assert.equal(getInlineCompletion("poly", polymuxRow), "polymux.com");
  // Preserves user casing
  assert.equal(getInlineCompletion("Po", polymuxRow), "Polymux.com");
  // Returns null when already fully typed
  assert.equal(getInlineCompletion("polymux.com", polymuxRow), null);
  // Returns null when prefix does not match
  assert.equal(getInlineCompletion("go", polymuxRow), null);
});

test("getInlineCompletion matches path when query contains slash", () => {
  const posthogRow = sampleRows[2];
  assert.equal(
    getInlineCompletion("posthog.com/d", posthogRow),
    "posthog.com/docs/ai-observability/installation",
  );
});

test("getInlineCompletion matches search suggestions", () => {
  const porousRow = sampleRows[4];
  assert.equal(
    getInlineCompletion("po", porousRow),
    "porous beige stone material",
  );
  assert.equal(
    getInlineCompletion("porous", porousRow),
    "porous beige stone material",
  );
  // Raw query matches exactly -> no inline remainder
  const rawQueryRow = sampleRows[3];
  assert.equal(getInlineCompletion("po", rawQueryRow), null);
});

test("rankAddressRows places prefix-matching hosts at the top", () => {
  const ranked = rankAddressRows(sampleRows, "po");
  // polymux and posthog start with 'po' -> top ranks
  assert.equal(ranked[0]?.id, "history-polymux");
  assert.equal(ranked[1]?.id, "history-posthog");
  // github row matches 'Polymux' in title, but not host prefix -> ranked lower
  const githubIndex = ranked.findIndex((r) => r.id === "history-github");
  assert(githubIndex > 1);
});

test("rankAddressRows leaves order intact when query is empty", () => {
  const ranked = rankAddressRows(sampleRows, "");
  assert.deepEqual(ranked, sampleRows);
});

test("findInlineCompletionCandidate finds synchronous match from rows or cached history", () => {
  // Finds from visible rows
  const match1 = findInlineCompletionCandidate("po", sampleRows);
  assert.equal(match1?.completion, "polymux.com");
  assert.equal(match1?.row.id, "history-polymux");

  // Finds continuously as user types more letters
  const match2 = findInlineCompletionCandidate("pol", sampleRows);
  assert.equal(match2?.completion, "polymux.com");
  const match3 = findInlineCompletionCandidate("poly", sampleRows);
  assert.equal(match3?.completion, "polymux.com");

  // Finds from cached fallback when current rows are empty
  const matchCached = findInlineCompletionCandidate("post", [], sampleRows);
  assert.equal(matchCached?.completion, "posthog.com");

  // Returns null if no match
  const noMatch = findInlineCompletionCandidate("xyz", sampleRows);
  assert.equal(noMatch, null);
});
