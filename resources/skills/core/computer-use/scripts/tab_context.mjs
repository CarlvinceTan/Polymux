#!/usr/bin/env node
import {readFileSync, existsSync} from "node:fs";
import {homedir} from "node:os";
import path from "node:path";

const CACHE_PATH = path.join(
  homedir(), "Library", "Application Support", "polymux-tab-context", "tabs.json",
);
const STOP = new Set(["about", "after", "again", "also", "because", "could", "from", "have", "into", "like", "more", "some", "that", "their", "then", "there", "these", "they", "this", "what", "when", "where", "which", "with", "would", "your"]);

// Python's json.dumps puts a space after ',' and ':'; JSON.stringify does not.
// Compact output is compared against the Python original, so match it exactly.
const compact = (value) => JSON.stringify(value, null, 1).replace(/\n\s*/g, (m) =>
  m.includes("\n") ? "" : m).replace(/([,:])(?=\S)/g, "$1 ");

function tokens(text) {
  const found = String(text).toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return new Set(found.filter((word) => !STOP.has(word)));
}

function parseArgs(argv) {
  const out = {query: "", limit: 8};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--query") out.query = argv[++i] ?? "";
    else if (argv[i] === "--limit") out.limit = parseInt(argv[++i], 10);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!existsSync(CACHE_PATH)) {
  console.log(compact({available: false, reason: "cache_missing"}));
  process.exit(0);
}
const payload = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
const queryTokens = tokens(args.query);
const ranked = (payload.tabs ?? []).map((tab) => {
  const haystack = [tab.title ?? "", tab.url ?? "", tab.description ?? ""].join(" ");
  const hay = tokens(haystack);
  let overlap = 0;
  for (const word of queryTokens) if (hay.has(word)) overlap += 1;
  return {score: overlap * 10 + (tab.active ? 2 : 0), tab};
});
// Python's sort is stable and reverse=True preserves input order among ties;
// a stable descending comparator in JS gives the same ordering.
ranked.sort((a, b) => b.score - a.score);

const captured = payload.captured_at ?? "";
let ageSeconds = null;
const parsed = Date.parse(String(captured).replace(/Z$/, "+00:00"));
if (!Number.isNaN(parsed)) ageSeconds = Math.trunc((Date.now() - parsed) / 1000);

console.log(JSON.stringify({
  available: true,
  captured_at: captured,
  age_seconds: ageSeconds,
  tab_count: ranked.length,
  tabs: ranked.slice(0, Math.max(1, args.limit))
    .filter((item) => item.score > 0 || queryTokens.size === 0)
    .map((item) => item.tab),
}, null, 2));
