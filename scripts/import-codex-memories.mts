/**
 * Copies a Codex Desktop memory vault into FlareAI's own vault.
 *
 * Read-only against the source: the Codex vault at ~/.codex/memories keeps
 * working exactly as it did. Only FlareAI's vault is written.
 *
 * What comes across:
 * - every ad-hoc note, as one memory each, keeping its original date
 * - the durable bullets from memory_summary.md (profile, preferences, tips)
 * - memory_summary.md itself, so the imported context reaches the prompt on
 *   the very first turn instead of waiting for a consolidation run
 *
 * ComputerHistory rollout summaries are deliberately left behind: they describe
 * Codex sessions, and FlareAI keeps its own computerHistory.
 *
 * Usage: npm run memories -- [sourceVault] [targetVault]
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryManager } from "../packages/agent/src/memory/manager.js";

const source = path.resolve(process.argv[2] ?? path.join(os.homedir(), ".codex", "memories"));
const target = path.resolve(process.argv[3] ?? path.join(os.homedir(), ".flareai", "memories"));

if (!existsSync(source)) {
  console.error(`No Codex memory vault at ${source}`);
  process.exit(1);
}

interface Candidate {
  content: string;
  kind: string;
  /** Original authoring time, so an imported memory is not dated today. */
  at: Date;
}

const summaryPath = path.join(source, "memory_summary.md");
const summaryText = existsSync(summaryPath) ? readFileSync(summaryPath, "utf8") : "";
const summaryAt = existsSync(summaryPath) ? statSync(summaryPath).mtime : new Date();

const candidates: Candidate[] = [
  ...noteCandidates(path.join(source, "extensions", "ad_hoc", "notes")),
  ...bulletCandidates(summaryText, "User preferences", "preference", summaryAt),
  ...bulletCandidates(summaryText, "General Tips", "learning", summaryAt),
  ...profileCandidate(summaryText, summaryAt),
].sort((left, right) => left.at.getTime() - right.at.getTime());

// A mutable clock is the only way to preserve each memory's original date:
// remember() stamps createdAt/updatedAt from the manager's clock.
let now = new Date();
const memory = new MemoryManager({ directory: target, clock: () => now });

let imported = 0;
let skipped = 0;
for (const candidate of candidates) {
  now = candidate.at;
  const before = memory.userMemories().length;
  memory.remember(candidate.content, { kind: candidate.kind });
  if (memory.userMemories().length > before) imported += 1;
  else skipped += 1;
}

// Codex's summary is richer than the mechanical dump FlareAI builds from notes,
// so it wins. The watermark stops rebuildIndexes() from overwriting it and stops
// every imported memory from being re-appended as "not yet consolidated".
if (summaryText.trim()) {
  copyFileSync(summaryPath, path.join(target, "memory_summary.md"));
  const watermark = candidates.at(-1)?.at ?? summaryAt;
  writeFileSync(
    path.join(target, "consolidation.json"),
    `${JSON.stringify(
      {
        watermark: watermark.toISOString(),
        consolidatedAt: summaryAt.toISOString(),
        consecutiveFailures: 0,
        retryAfter: null,
        lastError: null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

console.log(
  `Imported ${imported} memories into ${target} (${skipped} already present, source untouched).`,
);

function noteCandidates(directory: string): Candidate[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const file = path.join(directory, entry.name);
      return {
        content: readFileSync(file, "utf8").trim(),
        kind: "note",
        at: dateFromName(entry.name) ?? statSync(file).mtime,
      };
    })
    .filter((candidate) => candidate.content.length > 0);
}

/** Top-level bullets under a `## Heading`, one memory per bullet. */
function bulletCandidates(
  text: string,
  heading: string,
  kind: string,
  at: Date,
): Candidate[] {
  return section(text, heading)
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => ({ content: line.slice(2).trim(), kind, at }))
    .filter((candidate) => candidate.content.length > 0);
}

function profileCandidate(text: string, at: Date): Candidate[] {
  const body = section(text, "User Profile").trim();
  return body ? [{ content: body, kind: "profile", at }] : [];
}

function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/** Codex names notes by timestamp; fall back to mtime when it does not parse. */
function dateFromName(name: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2})-(\d{2})-(\d{2}))?/.exec(name);
  if (!match) return null;
  const [, day, hour, minute, second] = match;
  const value = new Date(
    hour ? `${day}T${hour}:${minute}:${second}Z` : `${day}T00:00:00Z`,
  );
  return Number.isNaN(value.getTime()) ? null : value;
}
