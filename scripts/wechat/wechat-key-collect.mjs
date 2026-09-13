/** Collect clean-room SQLCipher keys for WeChat's own databases.
 *
 * Polymux reads WeChat's message, session, and contact stores directly once it
 * holds their raw 32-byte keys. This script provisions those keys without the
 * external daemon:
 *
 * 1. Migration: copies an already-provisioned Mac's `~/.wx-rs/keys.json` +
 *    `config.json` into Polymux's own registry
 *    (`~/Library/Application Support/Polymux/wechat/store.json` on macOS).
 * 2. Validation: imported keys for readable databases are checked against
 *    their first-page HMAC (SQLCipher 4 defaults). Unavailable databases are
 *    checked by the native reader before it publishes any plaintext.
 *
 * `--capture <wxid>` starts one explicitly requested, guarded setup attempt
 * using the public CommonCrypto observer. Existing encrypted databases are
 * required; live fresh-key acceptance and automatic setup remain unfinished.
 * `--lldb` prints reference information
 * for permitted test builds exposing the public SQLCipher keying APIs; the
 * installed 4.1.11 build does not expose those named symbols. It does not
 * attach, launch, re-sign or patch WeChat. Passphrases and encoded key
 * literals cannot be treated as raw 32-byte keys.
 *
 * `--set <wxid> <entry>` accepts one raw key as 64 hex characters through
 * stdin, avoiding process arguments and shell history. A readable database
 * must authenticate a replacement before it can overwrite an existing key.
 */

import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {mkdir, open, readFile, readdir, realpath, rename, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {isKeyForDatabase} from './wechat-key-auth.mjs';
export {isKeyForDatabase} from './wechat-key-auth.mjs';

const PAGE_SIZE = 4096;

export function defaultStoreRegistryPath(home = homedir()) {
  if (process.platform === "darwin")
    return path.join(home, "Library/Application Support/Polymux/wechat/store.json");
  return path.join(home, ".polymux", "wechat", "store.json");
}

function isHexKey(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function isWxid(value) {
  return typeof value === "string" && /^wxid_[A-Za-z0-9_-]+$/.test(value);
}

function rootMatchesAccount(root, wxid) {
  const folder = path.basename(path.dirname(root));
  return folder === wxid || new RegExp(`^${wxid}_[a-f0-9]{4}$`, 'i').test(folder);
}

function isEntry(value) {
  return typeof value === "string" && value.endsWith(".db") &&
    !value.includes("..") && !path.isAbsolute(value);
}

async function readOwnRegistry(file) {
  let raw;
  try { raw = await readFile(file, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return {accounts: {}};
    throw error;
  }
  let registry;
  try { registry = JSON.parse(raw); }
  catch { throw new Error("The existing WeChat key registry is invalid; it was not overwritten"); }
  if (!registry?.accounts || typeof registry.accounts !== "object" || Array.isArray(registry.accounts))
    throw new Error("The existing WeChat key registry is invalid; it was not overwritten");
  for (const [wxid, record] of Object.entries(registry.accounts)) {
    if (!isWxid(wxid) || typeof record?.dbDir !== "string" || !record.keys ||
        typeof record.keys !== "object" || Array.isArray(record.keys) ||
        Object.entries(record.keys).some(([entry, hex]) => !isEntry(entry) || !isHexKey(hex)))
      throw new Error("The existing WeChat key registry is invalid; it was not overwritten");
  }
  return registry;
}

async function writeRegistry(file, registry) {
  await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, {mode: 0o600, flag: "wx"});
    await rename(temporary, file);
  } finally {
    await rm(temporary, {force: true});
  }
}

async function firstPage(file) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(PAGE_SIZE);
    const {bytesRead} = await handle.read(buffer, 0, PAGE_SIZE, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

async function entriesOf(directory) {
  return readdir(directory, {withFileTypes: true}).catch(() => []);
}

/** Every `db_storage` root WeChat keeps on this Mac, clones included. */
export async function weChatDatabaseRoots(home = homedir()) {
  const containers = path.join(home, "Library/Containers");
  const roots = [];
  for (const app of await entriesOf(containers)) {
    if (!app.isDirectory() || !/^com\.tencent\.xinWeChat\d*$/.test(app.name)) continue;
    const base = path.join(containers, app.name, "Data/Documents/xwechat_files");
    for (const account of await entriesOf(base)) {
      if (account.isDirectory() && account.name.startsWith("wxid_"))
        roots.push(path.join(base, account.name, "db_storage"));
    }
  }
  return roots;
}

async function readJson(file) {
  return readFile(file, "utf8")
    .then((raw) => JSON.parse(raw))
    .catch(() => null);
}

/** Legacy registry shape provisioned by the external tool, if present. */
export async function readLegacyRegistry(home = homedir()) {
  const config = await readJson(path.join(home, ".wx-rs/config.json"));
  const keys = await readJson(path.join(home, ".wx-rs/keys.json"));
  if (!config && !keys) return null;
  return {config, keys};
}

/**
 * Merge the legacy registry into Polymux's own shape, keeping only well-formed
 * entries. Validation against live bytes happens in `collectWeChatKeys` when
 * the databases are readable; otherwise entries are carried over and the
 * bridge proves them on open (a wrong key fails once, there, and nowhere else).
 */
export function migrateLegacyRegistry(legacy, roots) {
  const accounts = {};
  const rootByWxid = new Map();
  for (const root of roots ?? []) rootByWxid.set(path.basename(path.dirname(root)), root);
  const wxid = typeof legacy?.config?.account_wxid === "string" ? legacy.config.account_wxid : null;
  const dbDir = typeof legacy?.config?.db_dir === "string" ? legacy.config.db_dir : null;
  const entries = legacy?.keys?.entries ?? {};
  if (!wxid || !isWxid(wxid)) return {accounts};
  const keys = {};
  for (const [entry, record] of Object.entries(entries)) {
    if (typeof entry !== "string" || !entry.endsWith(".db")) continue;
    if (entry.includes("..") || path.isAbsolute(entry)) continue;
    const hex = record?.key_hex;
    if (!isHexKey(hex)) continue;
    keys[entry] = hex.toLowerCase();
  }
  if (!Object.keys(keys).length) return {accounts};
  accounts[wxid] = {
    dbDir: dbDir ?? rootByWxid.get(wxid) ?? "",
    keys,
  };
  return {accounts};
}

export async function collectWeChatKeys(options = {}) {
  const home = options.home ?? homedir();
  const out = options.registryPath ?? defaultStoreRegistryPath(home);
  const registry = await readOwnRegistry(out);
  const roots = await weChatDatabaseRoots(home);
  const legacy = await readLegacyRegistry(home);
  const imported = migrateLegacyRegistry(legacy, roots);
  let validated = 0;
  for (const [wxid, account] of Object.entries(imported.accounts)) {
    const existing = registry.accounts[wxid];
    const dbDir = account.dbDir || existing?.dbDir ||
      roots.find((root) => path.basename(path.dirname(root)) === wxid) || "";
    const merged = existing ?? {dbDir, keys: {}};
    if (!merged.dbDir) merged.dbDir = dbDir;
    for (const [entry, hex] of Object.entries(account.keys)) {
      let proven = false;
      if (options.validate !== false && dbDir) {
        const main = await firstPage(path.join(dbDir, entry)).catch(() => null);
        if (main && !isKeyForDatabase(main, Buffer.from(hex, "hex"))) continue;
        proven = main !== null;
        if (proven) validated += 1;
      }
      // An unavailable legacy database must not replace a hand-captured key
      // or move existing keys to another container. New entries are re-proven
      // by the reader before any decrypted snapshot is published.
      if (existing?.dbDir && dbDir !== existing.dbDir) continue;
      if (!(entry in merged.keys) || proven) merged.keys[entry] = hex;
    }
    if (Object.keys(merged.keys).length) registry.accounts[wxid] = merged;
  }
  await writeRegistry(out, registry);
  return {registry, validated, path: out};
}

/**
 * Records one hand-captured key (`--set`) into the registry. When the account
 * has no directory yet, the live container on this Mac supplies it, so a key
 * captured with LLDB works immediately instead of pointing at nothing.
 */
export async function recordRegistryKey({home = homedir(), registryPath, wxid, entry, hex}) {
  if (!isWxid(wxid) || !isEntry(entry) || !isHexKey(hex))
    throw new Error("Invalid WeChat key registry entry");
  const out = registryPath ?? defaultStoreRegistryPath(home);
  const existing = await readOwnRegistry(out);
  const accounts = existing.accounts;
  let dbDir = accounts[wxid]?.dbDir ?? "";
  if (!dbDir) {
    const roots = await weChatDatabaseRoots(home);
    const matches = roots.filter((root) => rootMatchesAccount(root, wxid));
    if (matches.length > 1) throw new Error("The WeChat account has multiple database containers; select its directory before recording a key");
    dbDir = matches[0] ?? "";
  }
  const main = dbDir ? await firstPage(path.join(dbDir, entry)).catch(() => null) : null;
  if (main && !isKeyForDatabase(main, Buffer.from(hex, "hex")))
    throw new Error("The captured WeChat key does not authenticate this database; the registry was not changed");
  const previous = accounts[wxid]?.keys?.[entry];
  if (previous && previous.toLowerCase() !== hex.toLowerCase() && !main)
    throw new Error("The WeChat database must be readable before replacing its existing key");
  accounts[wxid] = {
    dbDir,
    keys: {...(accounts[wxid]?.keys ?? {}), [entry]: hex.toLowerCase()},
  };
  await writeRegistry(out, {accounts});
  return out;
}

export function lldbKeyCaptureCommands() {
  return [
    "# Reference only: public-symbol capture is not validated for WeChat 4.1.11.",
    "# Check that the selected, permitted build exports these symbols before using breakpoints.",
    "# This helper does not attach, re-sign, launch, or change any process.",
    "(lldb) breakpoint set -n sqlite3_key",
    "(lldb) breakpoint set -n sqlite3_key_v2",
    "# At sqlite3_key on arm64: pointer x1, byte count w2.",
    "# Only if w2 is 32 and the input is a raw key:",
    "# Capture bytes through a private pipe/file, never the debugger console or logs.",
    "# At sqlite3_key_v2 on arm64: pointer x2, byte count w3.",
    "# At this entry the same raw-key check requires w3 == 32.",
    "# Associate each hit with its exact database handle; do not guess from the stack.",
    "# Passphrases and encoded key literals need separate handling; do not truncate them.",
    "# Detach when finished: process detach",
    "# Pipe one 64-character hex value to the recorder; never put a key in argv:",
    "#   node scripts/wechat/wechat-key-collect.mjs --set <wxid> <entry> < /path/to/private-key.txt",
  ].join("\n");
}

/** Explicit setup for an existing Desktop account whose encrypted files exist.
 * It must start from a stopped, supported Desktop build. Never attaches to a
 * running app, changes its signature or imports external keys on capture failure.
 */
export async function captureWeChatKeys({wxid, home = homedir(), registryPath}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || !isWxid(wxid))
    throw new Error('Fresh WeChat key capture requires a selected account on an Apple Silicon Mac');
  const out = registryPath ?? defaultStoreRegistryPath(home);
  const registry = await readOwnRegistry(out);
  const roots = await weChatDatabaseRoots(home);
  const selected = registry.accounts[wxid]?.dbDir;
  const matches = roots.filter(root => selected ? root === selected : rootMatchesAccount(root, wxid));
  if (matches.length !== 1) throw new Error('Select one existing WeChat account directory before capturing its keys');
  const dbDir = matches[0], entries = [];
  async function visit(directory, depth = 0) {
    if (depth > 4) throw new Error('WeChat database layout is not supported for key capture');
    for (const item of await readdir(directory, {withFileTypes: true})) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await visit(file, depth + 1);
      else if (item.isFile() && item.name.endsWith('.db')) {
        const page = await firstPage(file);
        if (page.length !== PAGE_SIZE || page.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) continue;
        const entry = path.relative(dbDir, file);
        if (!/^[\w-]+\/[\w-]+\.db$/.test(entry))
          throw new Error('This WeChat database layout needs an updated reader before key capture');
        entries.push(entry);
        if (entries.length > 128) throw new Error('Too many WeChat databases for one bounded key capture');
      }
    }
  }
  await visit(dbDir);
  if (!entries.length) throw new Error('WeChat has no encrypted databases yet; finish its first sign-in before setup');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../native/bin'), path.resolve(here, '../../resources/native/bin')];
  let native, revision;
  for (const directory of candidates) {
    const value = await readFile(path.join(directory, 'VERSION'), 'utf8').catch(() => '');
    if (/^[a-f0-9]{64}$/.test(value.trim())) { native = directory; revision = value.trim(); break; }
  }
  if (!native) throw new Error('Polymux native key capture helpers are unavailable');
  const execute = promisify(execFile);
  const json = async (name, args, timeout) => {
    const {stdout} = await execute(path.join(native, name), args, {timeout, maxBuffer: 64 * 1024});
    return JSON.parse(stdout);
  };
  const {captureWeChatDatabaseKeys} = await import('./wechat-key-capture.mjs');
  const processArgs = (pid, target) => ['--pid', String(pid), '--expected-birth', String(target.birthSeconds), String(target.birthMicros)];
  const result = await captureWeChatDatabaseKeys({
    dbDir, entries,
    launch: directory => json('wechat-launch-hidden', ['/Applications/WeChat.app',
      path.join(here, 'wechat_native_task_lldb.py'),
      path.join(native, `libpolymux-wechat-prime-${revision}.dylib`), '--key-capture', directory], 20_000),
    sessionState: (pid, target) => json('wechat-prime', ['--status-only', ...processArgs(pid, target)], 5_000),
    requestLogin: (pid, target) => json('wechat-prime', processArgs(pid, target), 20_000),
  });
  try {
    for (const [entry, key] of result.keys)
      await recordRegistryKey({home, registryPath: out, wxid, entry, hex: key.toString('hex')});
    return {captured: result.keys.size, missing: result.missing, state: result.state, path: out};
  } finally { for (const key of result.keys.values()) key.fill(0); }
}

function parseArgs(argv) {
  const args = {};
  const valueAt = (index) => typeof argv[index] === "string" && !argv[index].startsWith("--") && argv[index].length > 0;
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (seen.has(arg)) throw new Error("Duplicate WeChat key collector option");
    seen.add(arg);
    if (arg === "--check") args.check = true;
    else if (arg === "--capture" && valueAt(i + 1)) args.capture = argv[++i];
    else if (arg === "--lldb") args.lldb = true;
    else if (arg === "--out" && valueAt(i + 1)) args.out = argv[++i];
    else if (arg === "--home" && valueAt(i + 1)) args.home = argv[++i];
    else if (arg === "--no-validate") args.validate = false;
    else if (arg === "--set" && valueAt(i + 1) && valueAt(i + 2)) args.set = [argv[++i], argv[++i]];
    else throw new Error("Unknown or incomplete WeChat key collector option");
  }
  if (args.lldb && (args.set || args.capture || args.check || args.validate === false) ||
      args.set && (args.capture || args.check || args.validate === false) ||
      args.capture && (args.check || args.validate === false))
    throw new Error("Conflicting WeChat key collector options");
  return args;
}

async function keyFromStdin() {
  if (process.stdin.isTTY)
    throw new Error("Pipe one 64-character hex key through stdin; keys must not appear in command arguments");
  let value = "";
  for await (const chunk of process.stdin) {
    value += chunk.toString("utf8");
    if (value.length > 256) throw new Error("The WeChat key input is invalid");
  }
  value = value.trim();
  if (!isHexKey(value)) throw new Error("The WeChat key input must contain exactly one 64-character hex key");
  return value;
}

const invoked = process.argv[1] ? (await realpath(process.argv[1]).catch(() => null)) ===
  await realpath(fileURLToPath(import.meta.url)) : false;
if (invoked) {
 try {
  const args = parseArgs(process.argv.slice(2));
  if (args.lldb) {
    process.stdout.write(`${lldbKeyCaptureCommands()}\n`);
  } else if (args.set) {
    const [wxid, entry] = args.set;
    const hex = await keyFromStdin();
    if (!isWxid(wxid) || typeof entry !== "string" || !entry.endsWith(".db") ||
        entry.includes("..") || path.isAbsolute(entry) || !isHexKey(hex ?? "")) {
      console.error("usage: --set <wxid_...> <relative/path.db> (pipe the key through stdin)");
      process.exit(1);
    }
    const out = await recordRegistryKey({
      home: args.home ?? homedir(),
      registryPath: args.out,
      wxid,
      entry,
      hex,
    });
    process.stdout.write(`recorded ${wxid} ${entry} in ${out}\n`);
  } else if (args.capture) {
    const result = await captureWeChatKeys({wxid: args.capture, home: args.home, registryPath: args.out});
    process.stdout.write(`captured ${result.captured} authenticated keys; ${result.missing.length} pending (${result.state})\n`);
    if (result.missing.length) process.exitCode = 1;
  } else {
    const {registry, validated, path: out} = await collectWeChatKeys({
      home: args.home,
      registryPath: args.out,
      validate: args.validate,
    });
    const count = Object.values(registry.accounts).reduce((n, a) => n + Object.keys(a.keys).length, 0);
    process.stdout.write(`wrote ${count} keys (${validated} validated) to ${out}\n`);
    if (args.check && !count) process.exit(1);
  }
 } catch (error) {
   console.error(error instanceof Error ? error.message : "WeChat key collection failed");
   process.exitCode = 1;
 }
}
