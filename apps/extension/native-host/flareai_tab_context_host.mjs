#!/usr/bin/env node
/**
 * Native messaging host: persists the browser's tab snapshot for FlareAI.
 *
 * Chrome launches this process and frames each JSON message with a 4-byte
 * little-endian length prefix. Every snapshot received is written atomically to
 * ~/Library/Application Support/flareai-tab-context/tabs.json, where the FlareAI
 * browser-use skill reads it (scripts/tab_context.mjs).
 */
import {mkdirSync, readSync, renameSync, statSync, writeFileSync, writeSync} from "node:fs";
import {homedir} from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";

const CACHE_DIR = path.join(homedir(), "Library", "Application Support", "flareai-tab-context");
const CACHE_PATH = path.join(CACHE_DIR, "tabs.json");
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/**
 * Python's json.loads differs from JSON.parse in ways this host can observe:
 * it accepts NaN/Infinity/-Infinity, it keeps ints and floats apart (2 and 2.0
 * survive a round trip differently), and its ints never lose precision. The
 * snapshot is re-serialised into tabs.json, so parse with a small scanner that
 * keeps each number's source token instead of collapsing everything into a JS
 * double. Dicts become Maps (insertion order kept, and a "__proto__" key stays
 * an ordinary key).
 */
class Num {
  constructor(raw) {
    this.raw = raw;
  }
}

class ParseError extends Error {}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/y;
const SIMPLE_ESCAPES = {'"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t"};

function loads(text) {
  let pos = 0;
  const fail = () => new ParseError(`invalid JSON at position ${pos}`);
  const skipWs = () => {
    while (pos < text.length && " \t\n\r".includes(text[pos])) pos += 1;
  };
  const literal = (word, out) => {
    if (!text.startsWith(word, pos)) throw fail();
    pos += word.length;
    return out;
  };

  function parseString() {
    pos += 1; // opening quote
    let out = "";
    for (;;) {
      if (pos >= text.length) throw fail();
      const ch = text[pos];
      if (ch === '"') {
        pos += 1;
        return out;
      }
      if (ch === "\\") {
        const escape = text[pos + 1];
        if (escape === "u") {
          const hex = text.slice(pos + 2, pos + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw fail();
          // Lone surrogates are legal here, exactly as in Python's json.
          out += String.fromCharCode(parseInt(hex, 16));
          pos += 6;
        } else {
          const simple = SIMPLE_ESCAPES[escape];
          if (simple === undefined) throw fail();
          out += simple;
          pos += 2;
        }
        continue;
      }
      // strict=True (the default): raw control characters are rejected.
      if (ch.charCodeAt(0) < 0x20) throw fail();
      out += ch;
      pos += 1;
    }
  }

  function parseValue() {
    skipWs();
    if (pos >= text.length) throw fail();
    const ch = text[pos];
    if (ch === '"') return parseString();
    if (ch === "{") {
      pos += 1;
      const out = new Map();
      skipWs();
      if (text[pos] === "}") {
        pos += 1;
        return out;
      }
      for (;;) {
        skipWs();
        if (text[pos] !== '"') throw fail();
        const key = parseString();
        skipWs();
        if (text[pos] !== ":") throw fail();
        pos += 1;
        out.set(key, parseValue()); // duplicate keys: last one wins
        skipWs();
        if (text[pos] === ",") {
          pos += 1;
          continue;
        }
        if (text[pos] === "}") {
          pos += 1;
          return out;
        }
        throw fail();
      }
    }
    if (ch === "[") {
      pos += 1;
      const out = [];
      skipWs();
      if (text[pos] === "]") {
        pos += 1;
        return out;
      }
      for (;;) {
        out.push(parseValue());
        skipWs();
        if (text[pos] === ",") {
          pos += 1;
          continue;
        }
        if (text[pos] === "]") {
          pos += 1;
          return out;
        }
        throw fail();
      }
    }
    if (ch === "t") return literal("true", true);
    if (ch === "f") return literal("false", false);
    if (ch === "n") return literal("null", null);
    // json.loads accepts these non-standard constants by default.
    if (ch === "N") return literal("NaN", new Num("NaN"));
    if (ch === "I") return literal("Infinity", new Num("Infinity"));
    if (text.startsWith("-Infinity", pos)) {
      pos += 9;
      return new Num("-Infinity");
    }
    NUMBER.lastIndex = pos;
    const match = NUMBER.exec(text);
    if (!match) throw fail();
    pos += match[0].length;
    return new Num(match[0]);
  }

  const value = parseValue();
  skipWs();
  if (pos !== text.length) throw new ParseError("Extra data");
  return value;
}

/**
 * json.dumps replicas. Reply frames use Python's default separators
 * (", " and ": ") with ensure_ascii=True; the snapshot file uses indent=2 with
 * ensure_ascii=False. Numbers keep Python's int/float split: an int token is
 * echoed verbatim (arbitrary precision, "-0" collapses to "0"), a float token
 * renders through repr(float).
 */
function pyFloatRepr(x) {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "Infinity";
  if (x === -Infinity) return "-Infinity";
  if (Object.is(x, -0)) return "-0.0";
  if (x === 0) return "0.0";
  // toExponential() without an argument yields the shortest uniquely-decoding
  // digits — the same digits CPython's dtoa produces. Only the presentation
  // differs: Python uses fixed notation for decimal exponents in [-4, 15] and
  // pads scientific exponents to two digits.
  let [mantissa, expPart] = x.toExponential().split("e");
  const exp = parseInt(expPart, 10);
  const negative = mantissa.startsWith("-");
  if (negative) mantissa = mantissa.slice(1);
  const digits = mantissa.replace(".", "");
  let out;
  if (exp < -4 || exp > 15) {
    out = `${mantissa}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  } else if (exp < 0) {
    out = `0.${"0".repeat(-exp - 1)}${digits}`;
  } else if (exp >= digits.length - 1) {
    out = `${digits}${"0".repeat(exp - digits.length + 1)}.0`;
  } else {
    out = `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
  }
  return negative ? `-${out}` : out;
}

function numText(num) {
  const raw = num.raw;
  if (raw === "NaN" || raw === "Infinity" || raw === "-Infinity") return raw;
  if (!/[.eE]/.test(raw)) return raw === "-0" ? "0" : raw; // Python int
  return pyFloatRepr(Number(raw));
}

const STR_ESCAPES = new Map([
  ["\\", "\\\\"], ['"', '\\"'], ["\b", "\\b"], ["\f", "\\f"],
  ["\n", "\\n"], ["\r", "\\r"], ["\t", "\\t"],
]);

function pyStr(s, ensureAscii) {
  let out = '"';
  for (let i = 0; i < s.length; i += 1) {
    const mapped = STR_ESCAPES.get(s[i]);
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = s.charCodeAt(i);
    // ensure_ascii escapes everything past 0x7e (astral characters fall out as
    // surrogate pairs, which UTF-16 code units give for free).
    if (code < 0x20 || (ensureAscii && code > 0x7e)) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      out += s[i];
    }
  }
  return `${out}"`;
}

function dumps(value, ensureAscii, indent = null, level = 1) {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "string") return pyStr(value, ensureAscii);
  if (typeof value === "number") return String(value); // locally-built ints only
  if (value instanceof Num) return numText(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const parts = value.map((item) => dumps(item, ensureAscii, indent, level + 1));
    if (indent === null) return `[${parts.join(", ")}]`;
    const pad = " ".repeat(indent * level);
    return `[\n${parts.map((p) => pad + p).join(",\n")}\n${" ".repeat(indent * (level - 1))}]`;
  }
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  if (!entries.length) return "{}";
  const parts = entries.map(([key, item]) =>
    `${pyStr(String(key), ensureAscii)}: ${dumps(item, ensureAscii, indent, level + 1)}`);
  if (indent === null) return `{${parts.join(", ")}}`;
  const pad = " ".repeat(indent * level);
  return `{\n${parts.map((p) => pad + p).join(",\n")}\n${" ".repeat(indent * (level - 1))}}`;
}

/**
 * str(OSError) on macOS reads "[Errno N] message: 'path'" (plus " -> 'dest'"
 * for rename). Node raises the same errnos with different message text, and
 * the text travels in a reply frame, so rebuild Python's wording exactly.
 */
const STRERROR = new Map([
  [1, "Operation not permitted"],
  [2, "No such file or directory"],
  [5, "Input/output error"],
  [13, "Permission denied"],
  [17, "File exists"],
  [20, "Not a directory"],
  [21, "Is a directory"],
  [22, "Invalid argument"],
  [24, "Too many open files"],
  [27, "File too large"],
  [28, "No space left on device"],
  [30, "Read-only file system"],
  [62, "Too many levels of symbolic links"],
  [63, "File name too long"],
  [66, "Directory not empty"],
  [69, "Disc quota exceeded"],
]);

// repr() of a path as OSError prints it: single quotes preferred, double when
// the text contains a single quote but no double quote.
function pyRepr(text) {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (ch === "\\" || ch === quote) out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return out + quote;
}

// Returns Python's str(OSError) for a Node fs error, or null when the error
// is not one (the caller re-throws those, as Python's `except OSError` would).
function osErrorString(error) {
  if (!error || typeof error.code !== "string" || typeof error.errno !== "number"
      || typeof error.syscall !== "string") return null;
  const errnum = Math.abs(error.errno);
  let out = `[Errno ${errnum}] ${STRERROR.get(errnum) ?? error.code}`;
  if (typeof error.path === "string") out += `: ${pyRepr(error.path)}`;
  if (typeof error.dest === "string") out += ` -> ${pyRepr(error.dest)}`;
  return out;
}

// Dependency-free sleep for the (unlikely) case that stdin was handed to us
// in non-blocking mode.
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// sys.stdin.buffer.read(n): block until n bytes arrive or the pipe closes.
function readExact(count) {
  const buffer = Buffer.alloc(count);
  let got = 0;
  while (got < count) {
    let n;
    try {
      n = readSync(0, buffer, got, count - got, null);
    } catch (error) {
      if (error.code === "EAGAIN") {
        sleepMs(5);
        continue;
      }
      if (error.code === "EOF") break;
      throw error;
    }
    if (n === 0) break; // EOF: the browser closed the pipe
    got += n;
  }
  return buffer.subarray(0, got);
}

function readMessage() {
  const header = readExact(4);
  if (header.length < 4) return null;
  const length = header.readUInt32LE(0);
  if (length === 0 || length > MAX_MESSAGE_BYTES) return null;
  const body = readExact(length);
  if (body.length < length) return null;
  let value;
  try {
    // Python decodes strictly before parsing; Buffer#toString would paper over
    // invalid UTF-8 with U+FFFD, so decode with {fatal: true}. ignoreBOM keeps
    // a leading BOM in the text, which the parser then rejects — same outcome
    // as Python's "Unexpected UTF-8 BOM".
    value = loads(new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(body));
  } catch {
    return new Map();
  }
  return value instanceof Map ? value : new Map();
}

function writeAll(buffer) {
  let done = 0;
  while (done < buffer.length) done += writeSync(1, buffer, done, buffer.length - done);
}

function sendMessage(value) {
  const body = Buffer.from(dumps(value, true), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  writeAll(header);
  writeAll(body);
}

// Path.mkdir(parents=True, exist_ok=True), kept non-recursive so an error
// names the same path component Python's pathlib names.
function mkdirExistOk(dir, parents) {
  try {
    mkdirSync(dir);
    return;
  } catch (error) {
    if (error.code === "ENOENT") {
      if (!parents || path.dirname(dir) === dir) throw error;
      mkdirExistOk(path.dirname(dir), true);
      mkdirExistOk(dir, false);
      return;
    }
    // exist_ok forgives any failure only when the path is now a directory.
    let isDirectory = false;
    try {
      isDirectory = statSync(dir).isDirectory();
    } catch {}
    if (!isDirectory) throw error;
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function writeSnapshot(snapshot) {
  mkdirExistOk(CACHE_DIR, true);
  const temporary = path.join(CACHE_DIR, `.tabs.json.tmp-${process.pid}`);
  const text = dumps(snapshot, false, 2) + "\n";
  // Python's write_text(encoding="utf-8") cannot encode a lone surrogate: the
  // temp file is created empty, then UnicodeEncodeError — which is NOT an
  // OSError — escapes main() and kills the host with exit code 1. Node would
  // silently substitute U+FFFD; reproduce the Python behaviour instead.
  if (LONE_SURROGATE.test(text)) {
    writeFileSync(temporary, "");
    throw new Error("'utf-8' codec can't encode character: surrogates not allowed");
  }
  writeFileSync(temporary, text);
  renameSync(temporary, CACHE_PATH); // os.replace: atomic on the same volume
}

function main() {
  for (;;) {
    const message = readMessage();
    if (message === null) return 0;
    if (message.has("tabs") && Array.isArray(message.get("tabs"))) {
      try {
        writeSnapshot(message);
        sendMessage({ok: true, tab_count: message.get("tabs").length});
      } catch (error) {
        const asOsError = osErrorString(error);
        if (asOsError === null) throw error; // not an OSError; crash like Python
        sendMessage({ok: false, error: asOsError});
      }
    } else {
      sendMessage({ok: false, error: "snapshot must contain a tabs list"});
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
