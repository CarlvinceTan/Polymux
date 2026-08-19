#!/usr/bin/env node
/**
 * Deterministically prove that a candidate is only a declared literal rename.
 *
 * Library module (no CLI): the sealed maintenance runner imports `prove` and
 * `RenameProofError`. The proof digest hashes the proof object serialized the
 * way Python does with json.dumps(sort_keys=True, separators=(",", ":")) —
 * sorted keys at every level, no spaces, non-ASCII as \uXXXX escapes — so the
 * emitter below must byte-match that format exactly.
 */
import {createHash} from "node:crypto";
import {lstatSync, readdirSync, readFileSync, readlinkSync, statSync} from "node:fs";

export class RenameProofError extends Error {
  constructor(message) {
    super(message);
    this.name = "RenameProofError";
  }
}

// Python sorts strings by Unicode code point. The default JS comparator works
// on UTF-16 code units, which orders astral characters (surrogate pairs)
// before some BMP characters — the opposite of Python. Every sort in this
// file feeds a digest or an error message, so all of them use this.
function codePointCompare(a, b) {
  const unitsA = [...a];
  const unitsB = [...b];
  const shared = Math.min(unitsA.length, unitsB.length);
  for (let i = 0; i < shared; i += 1) {
    const x = unitsA[i].codePointAt(0);
    const y = unitsB[i].codePointAt(0);
    if (x !== y) return x - y;
  }
  return unitsA.length - unitsB.length;
}

// json.dumps escapes everything outside 0x20-0x7e when ensure_ascii is on
// (the default); astral characters become surrogate-pair escapes, which
// UTF-16 code units produce for free.
const pyStr = (s) => JSON.stringify(s).replace(/[\u007f-\uffff]/g,
  (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));

// json.dumps(value, sort_keys=True, separators=(",", ":")). The proof object
// only ever contains strings, integers, nulls, arrays, and plain objects —
// no floats — so no float-repr marker is needed here.
function dumps(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : JSON.stringify(value);
  if (typeof value === "string") return pyStr(value);
  if (Array.isArray(value)) return `[${value.map(dumps).join(",")}]`;
  const keys = Object.keys(value).sort(codePointCompare);
  return `{${keys.map((key) => `${pyStr(key)}:${dumps(value[key])}`).join(",")}}`;
}

// str(value) the way a Python f-string renders it (None/True/False).
const pyStrOf = (value) => (
  value === null || value === undefined ? "None"
    : typeof value === "boolean" ? (value ? "True" : "False") : String(value)
);

// repr(text) for the error messages that interpolate {renamed!r} and lists.
// Printability of exotic Unicode categories is approximated by the common
// non-printable ranges; ordinary letters, CJK, and emoji pass through
// literally exactly as Python prints them.
function pyRepr(text) {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (ch === "\\" || ch === quote) out += "\\" + ch;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0xa0) || code === 0xad) {
      out += "\\x" + code.toString(16).padStart(2, "0");
    } else if (nonPrintable(code)) {
      out += code > 0xffff
        ? "\\U" + code.toString(16).padStart(8, "0")
        : "\\u" + code.toString(16).padStart(4, "0");
    } else out += ch;
  }
  return out + quote;
}

// Common non-printable ranges beyond Latin-1: separators, format controls,
// surrogates, private use, and specials — the ones repr() escapes.
function nonPrintable(code) {
  return (code >= 0x2000 && code <= 0x200f) || code === 0x1680
    || (code >= 0x2028 && code <= 0x202e) || (code >= 0x205f && code <= 0x206f)
    || code === 0x3000 || code === 0xfeff || (code >= 0xfff9 && code <= 0xfffb)
    || (code >= 0xd800 && code <= 0xf8ff);
}

const pyListRepr = (items) => `[${items.map(pyRepr).join(", ")}]`;

// dict.get(key, default): a stored null must come back as null, not the
// default, so this cannot use ??.
const getDefault = (obj, key, fallback) => (
  Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : fallback
);

const hasKey = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// dict[key]: raise KeyError('key') when absent, like Python's subscript.
function requireKey(mapping, key) {
  if (!hasKey(mapping, key)) {
    const error = new Error(pyRepr(key));
    error.name = "KeyError";
    throw error;
  }
  return mapping[key];
}

// str(PurePosixPath(raw)): collapse duplicate slashes (a leading exactly-
// double slash survives), drop "." components and trailing slashes, and
// render the empty path as ".". Used for fs access and error messages so
// paths print exactly as Python's Path would.
function pathStr(raw) {
  const s = String(raw);
  if (s === "") return ".";
  let root = "";
  if (s.startsWith("/")) root = s.startsWith("//") && !s.startsWith("///") ? "//" : "/";
  const joined = s.split("/").filter((part) => part !== "" && part !== ".").join("/");
  if (root) return root + joined;
  return joined === "" ? "." : joined;
}

// str(root / relative) for error messages.
const joinPath = (rootStr, relative) => (
  rootStr === "." ? relative : rootStr.endsWith("/") ? rootStr + relative : `${rootStr}/${relative}`
);

function ignored(relativeParts, name, policy) {
  const ignoredNames = new Set(getDefault(policy, "ignored_names", []));
  if (relativeParts.some((part) => ignoredNames.has(part))) return true;
  if (getDefault(policy, "ignored_suffixes", []).some((suffix) => name.endsWith(suffix))) return true;
  return name.startsWith(".syncthing.");
}

function replace(value, replacements, usage) {
  let result = value;
  for (const [old, replacement] of replacements) {
    // str.count / str.replace: non-overlapping occurrences, left to right.
    const count = result.split(old).length - 1;
    if (count) {
      usage.set(old, usage.get(old) + count);
      result = result.split(old).join(replacement);
    }
  }
  return result;
}

const ZERO = Buffer.from([0]);

function entryDigest(entries) {
  const digest = createHash("sha256");
  for (const relative of [...entries.keys()].sort(codePointCompare)) {
    const entry = entries.get(relative);
    digest.update(Buffer.from(relative, "utf8"));
    digest.update(ZERO);
    digest.update(Buffer.from(entry.kind, "ascii"));
    digest.update(ZERO);
    digest.update(Buffer.from(String(entry.mode), "ascii"));
    digest.update(ZERO);
    let value = "value" in entry ? entry.value : Buffer.alloc(0);
    if (typeof value === "string") value = Buffer.from(value, "utf8");
    digest.update(value);
    digest.update(ZERO);
  }
  return digest.digest("hex");
}

function readEntries(root, policy) {
  const rootStr = pathStr(root);
  let rootIsDir = false;
  try { rootIsDir = statSync(rootStr).isDirectory(); } catch { rootIsDir = false; }
  if (!rootIsDir) throw new RenameProofError(`Skill tree is missing: ${rootStr}`);

  // Path.rglob("*"): every descendant including dotfiles; symlinked
  // directories are listed as entries but not entered; unreadable
  // directories are skipped silently (pathlib suppresses PermissionError).
  const found = [];
  const walk = (dir, prefix) => {
    let names;
    try { names = readdirSync(dir); } catch (error) {
      if (error.code === "EACCES" || error.code === "EPERM") return;
      throw error;
    }
    for (const name of names) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(`${dir}/${name}`);
      found.push([relative, stat]);
      if (stat.isDirectory()) walk(`${dir}/${name}`, relative);
    }
  };
  walk(rootStr, "");
  // Python sorts the full paths as POSIX strings; with the identical root
  // prefix that is the same order as sorting the relative paths.
  found.sort((a, b) => codePointCompare(a[0], b[0]));

  const entries = new Map();
  for (const [relative, stat] of found) {
    if (ignored(relative.split("/"), relative.split("/").pop(), policy)) continue;
    const mode = stat.mode & 0o777;
    const absolute = `${rootStr === "/" || rootStr === "//" ? rootStr : `${rootStr}/`}${relative}`;
    let entry;
    if (stat.isSymbolicLink()) entry = {kind: "symlink", mode, value: readlinkSync(absolute)};
    else if (stat.isDirectory()) entry = {kind: "directory", mode};
    else if (stat.isFile()) entry = {kind: "file", mode, value: readFileSync(absolute)};
    else throw new RenameProofError(`Unsupported special file: ${joinPath(rootStr, relative)}`);
    entries.set(relative, entry);
  }
  return entries;
}

// Strict UTF-8 like Python's bytes.decode("utf-8"): reject invalid input,
// keep a leading BOM (TextDecoder strips it unless told otherwise).
const strictUtf8 = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true});

function transformEntries(entries, replacements) {
  const usage = new Map(replacements.map(([old]) => [old, 0]));
  const transformed = new Map();
  for (const relative of [...entries.keys()].sort(codePointCompare)) {
    const entry = entries.get(relative);
    const renamed = replace(relative, replacements, usage);
    // PurePosixPath semantics: "." components and empty segments drop out
    // of parts; the result may not be absolute, contain "..", or collapse
    // to nothing.
    const parts = renamed.split("/").filter((part) => part !== "" && part !== ".");
    if (renamed.startsWith("/") || parts.includes("..") || renamed === "" || renamed === ".") {
      throw new RenameProofError(`Replacement creates an unsafe path: ${pyRepr(renamed)}`);
    }
    if (transformed.has(renamed)) {
      throw new RenameProofError(`Replacement creates a path collision: ${renamed}`);
    }
    const updated = {kind: entry.kind, mode: entry.mode};
    if (entry.kind === "symlink") {
      updated.value = replace(String(entry.value), replacements, usage);
    } else if (entry.kind === "file") {
      const payload = entry.value;
      let text = null;
      try { text = strictUtf8.decode(payload); } catch { text = null; }
      // Binary payloads (not valid UTF-8) pass through untouched.
      updated.value = text === null ? payload : Buffer.from(replace(text, replacements, usage), "utf8");
    }
    transformed.set(renamed, updated);
  }
  return [transformed, usage];
}

// Python dict equality over {kind, mode, value?} entries; file values are
// bytes on both sides, symlink targets are strings on both sides.
function entriesEqual(a, b) {
  if (a.kind !== b.kind || a.mode !== b.mode) return false;
  const aHasValue = "value" in a;
  if (aHasValue !== ("value" in b)) return false;
  if (!aHasValue) return true;
  if (typeof a.value === "string" || typeof b.value === "string") return a.value === b.value;
  return a.value.equals(b.value);
}

function normalizeReplacements(raw) {
  if (!raw || raw.length === 0) {
    throw new RenameProofError("At least one --replace OLD=NEW value is required");
  }
  const result = [];
  const seen = new Set();
  for (const pair of raw) {
    if (pair.length !== 2) {
      throw new RenameProofError("Each replacement must contain exactly two values");
    }
    const old = pyStrOf(pair[0]);
    const replacement = pyStrOf(pair[1]);
    if (!old || !replacement || old === replacement) {
      throw new RenameProofError("Replacement values must be non-empty and different");
    }
    if (seen.has(old)) throw new RenameProofError(`Duplicate replacement source: ${old}`);
    seen.add(old);
    result.push([old, replacement]);
  }
  return result;
}

export function prove({
  metadata,
  state,
  policy,
  replacements,
  source_skill = null,
  replacement_skill = null,
}) {
  const pairs = normalizeReplacements(replacements);
  const action = getDefault(metadata, "action", null);
  const skills = getDefault(state, "skills", {});

  const requirePrimaryPair = (sourceId, destinationId) => {
    // id.split(":", 1)[-1]: everything after the first colon, or the whole id.
    const oldName = sourceId.indexOf(":") === -1 ? sourceId : sourceId.slice(sourceId.indexOf(":") + 1);
    const newName = destinationId.indexOf(":") === -1
      ? destinationId : destinationId.slice(destinationId.indexOf(":") + 1);
    if (!pairs.some(([old, replacement]) => old === oldName && replacement === newName)) {
      throw new RenameProofError(
        `Declared replacements must include the skill rename ${oldName}=${newName}`,
      );
    }
  };

  let sourceId;
  let sourceRoot;
  let destinationId;
  let destinationRoot;
  if (action === "update") {
    if (!source_skill || !replacement_skill) {
      throw new RenameProofError("A dependent rename update requires --source-skill and --replacement-skill");
    }
    if (!hasKey(skills, source_skill)) {
      throw new RenameProofError(`Approved source skill is missing: ${source_skill}`);
    }
    if (!hasKey(skills, replacement_skill)) {
      throw new RenameProofError(`Approved replacement skill is missing: ${replacement_skill}`);
    }
    requirePrimaryPair(source_skill, replacement_skill);
    sourceId = requireKey(metadata, "target_id");
    sourceRoot = requireKey(metadata, "baseline_snapshot");
    destinationId = requireKey(metadata, "target_id");
    destinationRoot = requireKey(metadata, "candidate_path");
  } else if (action === "new") {
    if (!source_skill || replacement_skill) {
      throw new RenameProofError("A new renamed skill requires only --source-skill");
    }
    if (!hasKey(skills, source_skill)) {
      throw new RenameProofError(`Approved source skill is missing: ${source_skill}`);
    }
    sourceId = source_skill;
    sourceRoot = requireKey(skills[source_skill], "snapshot");
    destinationId = requireKey(metadata, "target_id");
    destinationRoot = requireKey(metadata, "candidate_path");
    if (sourceId === destinationId) {
      throw new RenameProofError("The renamed skill must have a different target id");
    }
    requirePrimaryPair(sourceId, destinationId);
  } else if (action === "delete") {
    if (source_skill || !replacement_skill) {
      throw new RenameProofError("A rename deletion requires only --replacement-skill");
    }
    if (!hasKey(skills, replacement_skill)) {
      throw new RenameProofError(`Approved replacement skill is missing: ${replacement_skill}`);
    }
    sourceId = requireKey(metadata, "target_id");
    sourceRoot = requireKey(metadata, "baseline_snapshot");
    destinationId = replacement_skill;
    destinationRoot = requireKey(skills[replacement_skill], "snapshot");
    if (sourceId === destinationId) {
      throw new RenameProofError("The replacement skill must have a different target id");
    }
    requirePrimaryPair(sourceId, destinationId);
  } else {
    throw new RenameProofError(`Unsupported candidate action for rename proof: ${pyStrOf(action)}`);
  }

  const sourceEntries = readEntries(sourceRoot, policy);
  const [expectedEntries, usage] = transformEntries(sourceEntries, pairs);
  const destinationEntries = readEntries(destinationRoot, policy);

  const unused = [...usage.entries()].filter(([, count]) => count === 0).map(([old]) => old);
  if (unused.length) {
    throw new RenameProofError(`Declared replacements were unused: ${unused.join(", ")}`);
  }

  const missing = [...expectedEntries.keys()]
    .filter((relative) => !destinationEntries.has(relative)).sort(codePointCompare);
  const extra = [...destinationEntries.keys()]
    .filter((relative) => !expectedEntries.has(relative)).sort(codePointCompare);
  const changed = [...expectedEntries.keys()]
    .filter((relative) => destinationEntries.has(relative)
      && !entriesEqual(expectedEntries.get(relative), destinationEntries.get(relative)))
    .sort(codePointCompare);
  if (missing.length || extra.length || changed.length) {
    const details = [];
    if (missing.length) details.push(`missing=${pyListRepr(missing.slice(0, 8))}`);
    if (extra.length) details.push(`extra=${pyListRepr(extra.slice(0, 8))}`);
    if (changed.length) details.push(`changed=${pyListRepr(changed.slice(0, 8))}`);
    throw new RenameProofError("Candidate contains changes beyond the declared rename: " + details.join("; "));
  }

  const usageObject = {};
  for (const [old, count] of usage) usageObject[old] = count;
  const proof = {
    version: 1,
    action,
    candidate_skill: requireKey(metadata, "target_id"),
    tree_source_skill: sourceId,
    tree_destination_skill: destinationId,
    renamed_source_skill: source_skill || sourceId,
    renamed_destination_skill: replacement_skill || destinationId,
    replacement_skill,
    replacements: pairs.map(([old, replacement]) => [old, replacement]),
    usage: usageObject,
    source_tree_digest: entryDigest(sourceEntries),
    destination_tree_digest: entryDigest(destinationEntries),
    entry_count: destinationEntries.size,
  };
  proof.proof_digest = createHash("sha256")
    .update(Buffer.from(dumps(proof), "utf8"))
    .digest("hex");
  return proof;
}
