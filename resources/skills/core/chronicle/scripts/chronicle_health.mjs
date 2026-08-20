#!/usr/bin/env node
/**
 * Read-only health report for FlareAI's built-in Chronicle on macOS.
 *
 * FlareAI records Chronicle inside the app itself: accessibility text frames are
 * saved as Markdown under the Chronicle directory, indexed per day, and
 * summarised into timeline.md. There is no separate recorder process to check;
 * health is the recorder setting plus evidence freshness on disk.
 */
import {readFileSync, readdirSync, statSync} from "node:fs";
import {homedir} from "node:os";
import path from "node:path";

/**
 * Python prints floats with a trailing ".0" where JSON.stringify prints a bare
 * integer, and json.dumps(sort_keys=True) orders keys by codepoint. Both matter
 * because this report is diffed against the Python original, so floats carry a
 * marker through serialisation and keys are sorted on the way out.
 */
const F = (value) => ({__float: value});
function dumps(value, indent = 2, level = 1) {
  const pad = " ".repeat(indent * level);
  const closePad = " ".repeat(indent * (level - 1));
  if (value === null || value === undefined) return "null";
  if (typeof value === "object" && "__float" in value) {
    const n = value.__float;
    return Number.isFinite(n) && Number.isInteger(n) ? `${n}.0` : JSON.stringify(n);
  }
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value.map((v) => pad + dumps(v, indent, level + 1)).join(",\n")}\n${closePad}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    if (!keys.length) return "{}";
    return `{\n${keys.map((k) => `${pad}${dumps(k, indent, level)}: ${dumps(value[k], indent, level + 1)}`)
      .join(",\n")}\n${closePad}}`;
  }
  if (typeof value === "string") {
    // json.dumps default ensure_ascii=True: non-ASCII becomes \uXXXX escapes
    // (astral chars as surrogate pairs, which UTF-16 code units give for free).
    return JSON.stringify(value).replace(/[\u0080-\uffff]/g,
      (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
  }
  return JSON.stringify(value);
}

// Python's round() is half-to-even; JS toFixed is half-away-from-zero.
function pyRound(value, digits) {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded;
  if (Math.abs(diff - 0.5) < Number.EPSILON * Math.abs(scaled)) {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  } else rounded = Math.round(scaled);
  return rounded / factor;
}

function newestFile(root, suffix) {
  let newest = null;
  let entries;
  try {
    if (!statSync(root).isDirectory()) return null;
  } catch { return null; }
  const walk = (dir) => {
    try { entries = readdirSync(dir, {withFileTypes: true}); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(suffix)) {
        try {
          const modified = statSync(abs).mtimeMs / 1000;
          if (newest === null || modified > newest[0]) newest = [modified, abs];
        } catch { /* unreadable entry, same as Python's OSError skip */ }
      }
    }
  };
  walk(root);
  return newest ? newest[1] : null;
}

function fileState(filePath, now, freshSeconds) {
  if (filePath === null) return {available: false, path: null, age_seconds: null, fresh: false};
  let modified;
  try { modified = statSync(filePath).mtimeMs / 1000; }
  catch { return {available: false, path: null, age_seconds: null, fresh: false}; }
  const age = Math.max(0, now - modified);
  return {
    available: true,
    path: String(filePath),
    modified_unix: F(modified),
    age_seconds: F(pyRound(age, 3)),
    fresh: age <= freshSeconds,
    freshness_threshold_seconds: F(freshSeconds),
  };
}

function recorderState(root) {
  const errors = [];
  let isDir = false;
  try { isDir = statSync(root).isDirectory(); } catch { isDir = false; }
  const state = {directory: String(root), present: isDir, enabled: null};
  if (!isDir) {
    errors.push("Chronicle directory is missing; Chronicle has never run");
    return [state, errors];
  }
  try {
    const value = JSON.parse(readFileSync(path.join(root, "settings.json"), "utf8"));
    state.enabled = Boolean(value.enabled ?? true);
    // What the user allowed Chronicle to see. Reported rather than judged:
    // an excluded app is a choice, and the point of surfacing it is that a
    // gap in the evidence has an explanation other than "it did not happen".
    state.excluded_apps = value.excludeApps ?? [];
    state.excluded_sites = value.excludeSites ?? [];
    state.records_private_browsing = value.recordPrivateBrowsing ?? true;
    state.interaction_events = value.interactionEvents ?? true;
  } catch {
    // Missing settings mean FlareAI is using its defaults; not an error.
    state.enabled = null;
  }
  if (state.enabled === false) errors.push("Chronicle is disabled in FlareAI settings");
  return [state, errors];
}

function parseArgs(argv) {
  const out = {
    chronicleRoot: path.join(homedir(), "Library/Application Support/FlareAI/chronicle"),
    frameFresh: 120.0, eventFresh: 600.0, timelineFresh: 1200.0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--chronicle-root") out.chronicleRoot = argv[++i];
    else if (argv[i] === "--frame-fresh-seconds") out.frameFresh = parseFloat(argv[++i]);
    else if (argv[i] === "--event-fresh-seconds") out.eventFresh = parseFloat(argv[++i]);
    else if (argv[i] === "--timeline-fresh-seconds") out.timelineFresh = parseFloat(argv[++i]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const now = Date.now() / 1000;
const root = args.chronicleRoot;

const [recorder, errors] = recorderState(root);
const frame = fileState(newestFile(path.join(root, "index"), ".jsonl"), now, args.frameFresh);
const events = fileState(newestFile(path.join(root, "events"), ".jsonl"), now, args.eventFresh);
let timelinePath = null;
try { if (statSync(path.join(root, "timeline.md")).isFile()) timelinePath = path.join(root, "timeline.md"); }
catch { timelinePath = null; }
const timeline = fileState(timelinePath, now, args.timelineFresh);

const warnings = [];
if (!frame.available) errors.push("No Chronicle frame index is available");
else if (!frame.fresh) warnings.push("Newest Chronicle frame is stale");
if (!timeline.available) warnings.push("No Chronicle timeline is available");
else if (!timeline.fresh) warnings.push("Chronicle timeline is stale");
if (recorder.interaction_events === false) {
  warnings.push("Interaction events are switched off; only window text is recorded");
} else if (!events.available) warnings.push("No Chronicle interaction events are available");
if ((recorder.excluded_apps ?? []).length || (recorder.excluded_sites ?? []).length) {
  warnings.push("Some apps or sites are excluded from capture");
}
if (recorder.records_private_browsing === false) {
  warnings.push("Private browsing windows are excluded from capture");
}

const status = errors.length ? "unavailable" : warnings.length ? "degraded" : "ok";
console.log(dumps({
  status,
  checked_unix: F(now),
  recorder,
  latest_frame_index: frame,
  latest_events: events,
  timeline,
  errors,
  warnings,
}));
process.exit(errors.length ? 2 : warnings.length ? 1 : 0);
