#!/usr/bin/env node
/**
 * Quick validation script for skills - minimal version
 */
import {readFileSync, existsSync} from "node:fs";
import path from "node:path";

const MAX_SKILL_NAME_LENGTH = 64;

/**
 * A YAML subset sufficient for SKILL.md frontmatter. The deployed skill folder
 * has no node_modules, so a parser library is not available here; this covers
 * the shapes frontmatter actually takes (scalars, block and inline sequences,
 * nested maps, block scalars) and reports anything else as a YAML error rather
 * than guessing.
 */
class YamlError extends Error {}

const scalar = (raw) => {
  const text = raw.trim();
  if (text === "" || text === "~" || text === "null" || text === "Null" || text === "NULL") return null;
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^[+-]?\d+$/.test(text)) return parseInt(text, 10);
  if (/^[+-]?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return parseFloat(text);
  if (/^["'].*["']$/s.test(text) && text[0] === text[text.length - 1]) {
    const body = text.slice(1, -1);
    return text[0] === '"'
      ? body.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : body.replace(/''/g, "'");
  }
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) throw new YamlError("malformed inline sequence");
    const inner = text.slice(1, -1).trim();
    return inner ? splitInline(inner).map(scalar) : [];
  }
  if (text.startsWith("{")) {
    if (!text.endsWith("}")) throw new YamlError("malformed inline mapping");
    const inner = text.slice(1, -1).trim();
    if (!inner) return {};
    const out = {};
    for (const part of splitInline(inner)) {
      const idx = part.indexOf(":");
      if (idx === -1) throw new YamlError("malformed inline mapping entry");
      out[scalar(part.slice(0, idx))] = scalar(part.slice(idx + 1));
    }
    return out;
  }
  return text;
};

// Split on commas that are not inside quotes or nested brackets.
function splitInline(text) {
  const parts = [];
  let depth = 0, quote = null, current = "";
  for (const ch of text) {
    if (quote) { current += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === "[" || ch === "{") depth += 1;
    if (ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

// True when a quoted scalar opened on this line also closes on it.
function isClosed(text) {
  const quote = text[0];
  for (let i = 1; i < text.length; i += 1) {
    if (text[i] === "\\" && quote === '"') { i += 1; continue; }
    if (text[i] === quote) return true;
  }
  return false;
}

// Join a multi-line scalar the way YAML folds it: lines separated by a space.
function foldScalar(lines, start, parentPad, seed = "") {
  const buf = seed ? [seed] : [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (line.match(/^\s*/)[0].length <= parentPad) break;
    buf.push(line.trim());
    i += 1;
  }
  return [scalar(buf.join(" ")), i];
}

function parseBlock(lines, start, indent) {
  // Returns [value, nextIndex] for the block beginning at `start`.
  const isSeq = () => {
    const line = lines[start];
    return line !== undefined && /^\s*-\s/.test(line) && (line.match(/^\s*/)[0].length === indent);
  };
  if (isSeq()) {
    const items = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim() || line.trim().startsWith("#")) { i += 1; continue; }
      const pad = line.match(/^\s*/)[0].length;
      if (pad < indent || !/^\s*-\s*/.test(line)) break;
      if (pad > indent) throw new YamlError("inconsistent sequence indentation");
      items.push(scalar(line.replace(/^\s*-\s*/, "")));
      i += 1;
    }
    return [items, i];
  }
  const map = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i += 1; continue; }
    const pad = line.match(/^\s*/)[0].length;
    if (pad < indent) break;
    if (pad > indent) throw new YamlError("inconsistent mapping indentation");
    const match = /^\s*([^:#]+?)\s*:\s*(.*)$/.exec(line);
    if (!match) throw new YamlError(`could not parse line: ${line.trim()}`);
    const key = scalar(match[1]);
    const rest = match[2];
    if (rest === "" || rest === "|" || rest === ">") {
      const next = lines[i + 1];
      const nextPad = next && next.trim() ? next.match(/^\s*/)[0].length : -1;
      if (rest === "|" || rest === ">") {
        const buf = [];
        let j = i + 1;
        while (j < lines.length && (!lines[j].trim() || lines[j].match(/^\s*/)[0].length > pad)) {
          buf.push(lines[j].slice(nextPad)); j += 1;
        }
        map[key] = rest === "|" ? `${buf.join("\n")}\n` : `${buf.join(" ").trim()}\n`;
        i = j;
        continue;
      }
      if (nextPad > pad) {
        // An indented block under a bare key is a nested collection only when it
        // looks like one; otherwise YAML folds it into a multi-line scalar.
        const looksCollection = /^\s*(-\s|[^:#]+?\s*:(\s|$))/.test(next);
        if (!looksCollection) {
          const [folded, next3] = foldScalar(lines, i + 1, pad);
          map[key] = folded; i = next3; continue;
        }
        const [value, next2] = parseBlock(lines, i + 1, nextPad); map[key] = value; i = next2; continue;
      }
      map[key] = null; i += 1; continue;
    }
    // A quoted scalar may continue onto following, more-indented lines.
    if (/^["']/.test(rest) && !isClosed(rest)) {
      const [folded, next4] = foldScalar(lines, i + 1, pad, rest);
      map[key] = folded; i = next4; continue;
    }
    map[key] = scalar(rest);
    i += 1;
  }
  return [map, i];
}

function safeLoad(text) {
  const lines = text.split("\n");
  let first = 0;
  while (first < lines.length && (!lines[first].trim() || lines[first].trim().startsWith("#"))) first += 1;
  if (first >= lines.length) return null;
  const [value] = parseBlock(lines, first, lines[first].match(/^\s*/)[0].length);
  return value;
}

// Python reports the type name in two error messages; mirror its spelling.
const pyType = (value) => {
  if (value === null) return "NoneType";
  if (Array.isArray(value)) return "list";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "object") return "dict";
  return "str";
};

function validateSkill(skillPath) {
  const skillMd = path.join(skillPath, "SKILL.md");
  if (!existsSync(skillMd)) return [false, "SKILL.md not found"];

  const content = readFileSync(skillMd, "utf8");
  if (!content.startsWith("---")) return [false, "No YAML frontmatter found"];

  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return [false, "Invalid frontmatter format"];

  let frontmatter;
  try {
    frontmatter = safeLoad(match[1]);
    if (frontmatter === null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
      return [false, "Frontmatter must be a YAML dictionary"];
    }
  } catch (error) {
    return [false, `Invalid YAML in frontmatter: ${error.message}`];
  }

  const allowedProperties = ["allowed-tools", "description", "license", "metadata", "name"];
  const unexpectedKeys = Object.keys(frontmatter).filter((k) => !allowedProperties.includes(k));
  if (unexpectedKeys.length) {
    const allowed = allowedProperties.join(", ");
    const unexpected = unexpectedKeys.sort().join(", ");
    return [false, `Unexpected key(s) in SKILL.md frontmatter: ${unexpected}. Allowed properties are: ${allowed}`];
  }

  if (!("name" in frontmatter)) return [false, "Missing 'name' in frontmatter"];
  if (!("description" in frontmatter)) return [false, "Missing 'description' in frontmatter"];

  let name = "name" in frontmatter ? frontmatter.name : "";
  if (typeof name !== "string") return [false, `Name must be a string, got ${pyType(name)}`];
  name = name.trim();
  if (!name) return [false, "Name must not be empty"];
  if (!/^[a-z0-9-]+$/.test(name)) {
    return [false, `Name '${name}' should be hyphen-case (lowercase letters, digits, and hyphens only)`];
  }
  if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
    return [false, `Name '${name}' cannot start/end with hyphen or contain consecutive hyphens`];
  }
  if (name.length > MAX_SKILL_NAME_LENGTH) {
    return [false, `Name is too long (${name.length} characters). Maximum is ${MAX_SKILL_NAME_LENGTH} characters.`];
  }

  let description = "description" in frontmatter ? frontmatter.description : "";
  if (typeof description !== "string") return [false, `Description must be a string, got ${pyType(description)}`];
  description = description.trim();
  if (!description) return [false, "Description must not be empty"];
  if (description.includes("<") || description.includes(">")) {
    return [false, "Description cannot contain angle brackets (< or >)"];
  }
  if (description.length > 1024) {
    return [false, `Description is too long (${description.length} characters). Maximum is 1024 characters.`];
  }

  return [true, "Skill is valid!"];
}

const argv = process.argv.slice(2);
if (argv.length !== 1) {
  console.log("Usage: python quick_validate.py <skill_directory>");
  process.exit(1);
}
const [valid, message] = validateSkill(argv[0]);
console.log(message);
process.exit(valid ? 0 : 1);
