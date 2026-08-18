import {createDecipheriv, createHash, createHmac, pbkdf2Sync} from "node:crypto";
import {copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {homedir, tmpdir} from "node:os";
import path from "node:path";
import {
  cookieUrl,
  type ImportedCookie,
  type ImportedLogin,
  type ImportedProfile,
  type ImportedVisit,
} from "./types.js";

/**
 * Firefox and its forks, read off the disk on macOS.
 *
 * The two halves of this file are not alike. Cookies are plaintext — a copy of
 * `cookies.sqlite` and a `SELECT`, and the hard part is only doing it without
 * writing to a file the browser has open. Passwords are the opposite: the bytes
 * in `logins.json` are useless on their own, wrapped by NSS behind a key that
 * `key4.db` only hands over after a chain of PBE decryptions this has to redo by
 * hand. Both stay entirely read-only with respect to the browser — same rule as
 * the WeChat store next door: decrypt a *copy*, never write back, no native
 * module, `node:crypto` and `node:sqlite` only.
 *
 * Nothing here imports a value from "electron"; the module runs under plain
 * `tsx --test`, and every filesystem entry point takes `home` so a test never
 * has to go near a real profile or a keychain.
 */

export interface FirefoxBrowser {
  /** Stable identifier, used to key a profile and to name a problem. */
  id: string;
  /** How the browser is shown to the user. */
  name: string;
  /** Its folder under `~/Library/Application Support`. */
  dir: string;
}

/**
 * Every fork that ships Mozilla's profile layout unchanged, which is all of
 * them: a Zen or a LibreWolf profile is a Firefox profile in a differently
 * named folder, so the same reader serves each. Zen's folder is lower-case
 * `zen`, unlike the rest — its own choice, matched here rather than corrected.
 */
export const FIREFOX_BROWSERS: FirefoxBrowser[] = [
  {id: "firefox", name: "Firefox", dir: "Firefox"},
  {id: "zen", name: "Zen", dir: "zen"},
  {id: "librewolf", name: "LibreWolf", dir: "LibreWolf"},
  {id: "waterfox", name: "Waterfox", dir: "Waterfox"},
];

/** The profile root a browser keeps its `profiles.ini` under. */
export function firefoxRoot(browser: FirefoxBrowser, home: string = homedir()): string {
  return path.join(home, "Library/Application Support", browser.dir);
}

// -- profiles.ini ----------------------------------------------------------

/** One profile as `profiles.ini` describes it, before its path is resolved. */
export interface ProfileEntry {
  /** The `Path=` value, relative to the root unless `IsRelative=0`. */
  path: string;
  /** The `Name=` value, or the path's basename when the ini omits it. */
  name: string;
  /** `IsRelative=0` makes `path` absolute; anything else keeps it relative. */
  isRelative: boolean;
  /** True when an `[Install…]` section names this path as its `Default=`, or
   * the legacy `Default=1` sits in the profile's own section. */
  isDefault: boolean;
}

/**
 * Reads `profiles.ini` into entries, best-effort.
 *
 * The file is a flat INI of `[Section]` headers and `key=value` lines. Which
 * profile is *default* is not a flag on the profile in current Firefox but a
 * pointer from an `[Install…]` section — one per installed binary — whose
 * `Default=` holds a profile's path. The older `Default=1` inside a `[ProfileN]`
 * section is still honoured for profiles written by an ancient Firefox. Both are
 * folded into `isDefault` here so a caller does not have to know which era wrote
 * the file.
 */
export function parseProfilesIni(text: string): ProfileEntry[] {
  const sections: {name: string; keys: Map<string, string>}[] = [];
  let current: {name: string; keys: Map<string, string>} | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = {name: header[1], keys: new Map()};
      sections.push(current);
      continue;
    }
    const eq = line.indexOf("=");
    if (!current || eq < 0) continue;
    current.keys.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }

  // The paths every `[Install…]` section points at. A profile is default if it
  // is any install's default — a machine can carry several binaries, each with
  // its own — so this is a set, not a single winner.
  const installDefaults = new Set(
    sections
      .filter((section) => /^Install/i.test(section.name))
      .map((section) => section.keys.get("Default"))
      .filter((value): value is string => Boolean(value)),
  );

  const profiles: ProfileEntry[] = [];
  for (const section of sections) {
    if (!/^Profile/i.test(section.name)) continue;
    const profilePath = section.keys.get("Path");
    if (!profilePath) continue;
    profiles.push({
      path: profilePath,
      name: section.keys.get("Name") ?? path.basename(profilePath),
      // `IsRelative=1` (or absent) means relative; only an explicit `0` is not.
      isRelative: section.keys.get("IsRelative") !== "0",
      isDefault: installDefaults.has(profilePath) || section.keys.get("Default") === "1",
    });
  }
  return profiles;
}

/**
 * The profiles under a root, resolved to absolute directories and each tagged
 * with whether its secrets are actually reachable.
 *
 * `readable` is `false` for exactly one recoverable reason: a Primary Password.
 * When one is set, `key4.db`'s check value will not decrypt with the empty
 * password, and there is nothing this module can do about it without prompting —
 * which is not its job. The reason names the fix the user can carry out. Every
 * other profile is reported readable; a profile whose logins later fail for some
 * other cause surfaces that as a `problems` entry from `readFirefoxLogins`,
 * where it can sit beside the cookies that did import.
 */
export function firefoxProfiles(root: string): ImportedProfile[] {
  const iniPath = path.join(root, "profiles.ini");
  const text = readOrNull(iniPath);
  if (text === null) return [];
  const profiles: ImportedProfile[] = [];
  // Default first, then by name, so the profile the user actually browses in
  // leads the list rather than whichever the ini happened to write first.
  const entries = parseProfilesIni(text).sort(
    (left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const dir = entry.isRelative ? path.join(root, entry.path) : entry.path;
    const locked = primaryPasswordReason(dir);
    profiles.push({
      id: entry.path,
      name: entry.name,
      path: dir,
      readable: locked === null,
      reason: locked,
    });
  }
  return profiles;
}

/** The message for a profile behind a Primary Password, or null when there is
 * none (including when there is no `key4.db` to be behind one at all). */
function primaryPasswordReason(profileDir: string): string | null {
  const key4 = path.join(profileDir, "key4.db");
  if (!existsSync(key4)) return null;
  try {
    const material = readKeyMaterial(key4);
    // No check value is not a lock; it is a profile that never stored a login.
    if (!material || !material.passwordCheck) return null;
    verifyEmptyPassword(material);
    return null;
  } catch (error) {
    if (error instanceof PrimaryPasswordError) {
      return "Protected by a Primary Password. Remove it in the browser, then import again.";
    }
    // An unsupported algorithm or an unreadable key4.db is not something the
    // user can act on the way a Primary Password is, so it does not make the
    // profile "locked" here — it becomes a problem when logins are read.
    return null;
  }
}

// -- cookies (plaintext) ---------------------------------------------------

/**
 * The cookies in a profile, mapped to what the session will accept.
 *
 * Firefox keeps time two ways in the same row and this only wants one of them:
 * `expiry` is already Unix *seconds*, the unit the session takes, so it passes
 * straight through — unlike Chromium, which would need the microsecond and
 * epoch conversion. `creationTime`/`lastAccessed` are microseconds and of no
 * interest to an import, so they are left where they are.
 */
export function readFirefoxCookies(profileDir: string): {cookies: ImportedCookie[]; problems: string[]} {
  const file = path.join(profileDir, "cookies.sqlite");
  const problems: string[] = [];
  if (!existsSync(file)) return {cookies: [], problems};
  let rows: Record<string, unknown>[];
  try {
    rows = withSqliteCopy(file, (db) =>
      db.prepare("SELECT * FROM moz_cookies").all() as Record<string, unknown>[],
    );
  } catch (error) {
    problems.push(`Firefox cookies could not be read: ${describe(error)}`);
    return {cookies: [], problems};
  }

  const cookies: ImportedCookie[] = [];
  for (const row of rows) {
    // One malformed row is one cookie lost, not the jar — the contract is
    // explicit that a bad row must not cost the user the rest.
    try {
      const host = String(row.host ?? "");
      const name = String(row.name ?? "");
      if (!host || !name) continue;
      const path_ = row.path ? String(row.path) : "/";
      const secure = toBool(row.isSecure);
      const cookie: ImportedCookie = {
        url: cookieUrl(host, secure, path_),
        name,
        value: String(row.value ?? ""),
        path: path_,
        secure,
        httpOnly: toBool(row.isHttpOnly),
        sameSite: fromMozSameSite(row.sameSite),
      };
      // A leading dot is Firefox's mark of a cookie that covers subdomains; the
      // session infers host-only from `domain` being absent, so a host cookie
      // gets none.
      if (host.startsWith(".")) cookie.domain = host;
      // `expiry` is seconds already; a zero or unset one is a session cookie,
      // which carries no expiration.
      const expiry = Number(row.expiry);
      if (Number.isFinite(expiry) && expiry > 0) cookie.expirationDate = expiry;
      cookies.push(cookie);
    } catch (error) {
      problems.push(`Skipped a Firefox cookie: ${describe(error)}`);
    }
  }
  return {cookies, problems};
}

/** Firefox's `sameSite`: 0 none, 1 lax, 2 strict. Anything else — a column an
 * old schema never had, a value a new one added — is reported unspecified
 * rather than guessed into one of the three. */
export function fromMozSameSite(value: unknown): ImportedCookie["sameSite"] {
  // Guarded before the coercion because `Number(null)` and `Number("")` are
  // both 0, which is `no_restriction` — the most permissive setting of the
  // four. A value that is missing rather than zero must not be read as the
  // site having opted out of same-site protection.
  if (value === null || value === undefined || value === "") return "unspecified";
  switch (Number(value)) {
    case 0:
      return "no_restriction";
    case 1:
      return "lax";
    case 2:
      return "strict";
    default:
      return "unspecified";
  }
}

// -- logins (NSS-encrypted) ------------------------------------------------

/**
 * The saved logins in a profile, decrypted.
 *
 * The shape of the work: `key4.db` holds a check value and a wrapped master key,
 * both sealed by the same password-based scheme; unwrapping the master key needs
 * that scheme run twice, and every record in `logins.json` is then a 3DES blob
 * that key opens. A Primary Password stops all of it and is reported as a
 * problem the user can clear. A record this cannot read is skipped with a
 * problem of its own; the rest still import.
 */
export function readFirefoxLogins(profileDir: string): {logins: ImportedLogin[]; problems: string[]} {
  const problems: string[] = [];
  const key4 = path.join(profileDir, "key4.db");
  const loginsFile = path.join(profileDir, "logins.json");
  if (!existsSync(key4) || !existsSync(loginsFile)) return {logins: [], problems};

  let masterKey: Buffer;
  try {
    const material = readKeyMaterial(key4);
    if (!material) return {logins: [], problems};
    verifyEmptyPassword(material);
    masterKey = unwrapMasterKey(material);
  } catch (error) {
    if (error instanceof PrimaryPasswordError) {
      problems.push("Firefox logins are behind a Primary Password; remove it in the browser and import again.");
    } else if (error instanceof UnsupportedAlgorithmError) {
      problems.push(
        `Firefox logins use a key algorithm this version cannot read (OID ${error.oid}); its passwords were skipped.`,
      );
    } else {
      problems.push(`Firefox logins could not be unlocked: ${describe(error)}`);
    }
    return {logins: [], problems};
  }

  let records: {hostname?: string; encryptedUsername?: string; encryptedPassword?: string}[];
  try {
    const parsed = JSON.parse(readFileSync(loginsFile, "utf8")) as {logins?: unknown};
    records = Array.isArray(parsed.logins) ? (parsed.logins as typeof records) : [];
  } catch (error) {
    problems.push(`Firefox logins.json could not be read: ${describe(error)}`);
    return {logins: [], problems};
  }

  const logins: ImportedLogin[] = [];
  for (const record of records) {
    try {
      if (!record.hostname || !record.encryptedUsername || !record.encryptedPassword) continue;
      const username = decodeLoginField(record.encryptedUsername, masterKey).toString("utf8");
      const password = decodeLoginField(record.encryptedPassword, masterKey).toString("utf8");
      logins.push({origin: record.hostname, username, password});
    } catch (error) {
      problems.push(`Skipped a Firefox login for ${record.hostname ?? "an unknown site"}: ${describe(error)}`);
    }
  }
  return {logins, problems};
}

/** The NSS id under which the 3DES master key is filed in `nssPrivate`. */
const MASTER_KEY_ID = Buffer.from("f8000000000000000000000000000001", "hex");
/** What `key4.db`'s check value decrypts to when no Primary Password is set. */
const PASSWORD_CHECK = Buffer.from("password-check", "binary");

interface KeyMaterial {
  /** Salt mixed into every derivation for this profile. */
  globalSalt: Buffer;
  /** The check-value blob from `metadata`, or null if the profile has none. */
  passwordCheck: Buffer | null;
  /** The wrapped-master-key blob from `nssPrivate`, or null if absent. */
  wrappedKey: Buffer | null;
}

/** Reads the salt and the two sealed blobs out of a copy of `key4.db`. */
function readKeyMaterial(key4: string): KeyMaterial | null {
  return withSqliteCopy(key4, (db) => {
    const meta = db
      .prepare("SELECT item1, item2 FROM metadata WHERE id = 'password'")
      .get() as {item1?: Uint8Array; item2?: Uint8Array} | undefined;
    if (!meta?.item1) return null;
    // `nssPrivate` can hold more than one key; the master is the row filed under
    // the fixed id above. Read the ids and match in JS rather than trust a BLOB
    // equality in SQL across schema quirks.
    const keyRows = db.prepare("SELECT a11, a102 FROM nssPrivate").all() as {
      a11?: Uint8Array;
      a102?: Uint8Array;
    }[];
    const master = keyRows.find(
      (row) => row.a102 && Buffer.from(row.a102).equals(MASTER_KEY_ID),
    );
    return {
      globalSalt: Buffer.from(meta.item1),
      passwordCheck: meta.item2 ? Buffer.from(meta.item2) : null,
      wrappedKey: master?.a11 ? Buffer.from(master.a11) : null,
    };
  });
}

/** Throws `PrimaryPasswordError` when the empty password does not open the
 * check value, which is exactly the signal that a Primary Password is set. */
function verifyEmptyPassword(material: KeyMaterial): void {
  if (!material.passwordCheck) return;
  const plain = decryptPbe(material.passwordCheck, material.globalSalt, Buffer.alloc(0));
  if (!plain.subarray(0, PASSWORD_CHECK.length).equals(PASSWORD_CHECK)) {
    throw new PrimaryPasswordError();
  }
}

/** Unwraps the 3DES master key, of which only the first 24 bytes are the key —
 * NSS pads the stored blob and we drop the tail, as it does. */
function unwrapMasterKey(material: KeyMaterial): Buffer {
  if (!material.wrappedKey) throw new Error("no master key stored");
  const plain = decryptPbe(material.wrappedKey, material.globalSalt, Buffer.alloc(0));
  return plain.subarray(0, 24);
}

export class PrimaryPasswordError extends Error {
  constructor() {
    super("primary password set");
    this.name = "PrimaryPasswordError";
  }
}

export class UnsupportedAlgorithmError extends Error {
  constructor(readonly oid: string) {
    super(`unsupported PBE algorithm ${oid}`);
    this.name = "UnsupportedAlgorithmError";
  }
}

/** pbeWithSha1AndTripleDES-CBC — the pre-75 wrapping. */
const OID_PBE_3DES = "1.2.840.113549.1.12.5.1.3";
/** pkcs5 PBES2 — the modern wrapping (PBKDF2-SHA256 then AES-256-CBC). */
const OID_PBES2 = "1.2.840.113549.1.5.13";
/** pkcs5 PBKDF2, the key-derivation half of PBES2. */
const OID_PBKDF2 = "1.2.840.113549.1.5.12";
/** aes-256-CBC, the cipher half of PBES2. */
const OID_AES256_CBC = "2.16.840.1.101.3.4.1.42";
/** des-ede3-cbc — how every login record is sealed, whichever way the master
 * key above was wrapped. */
const OID_DES_EDE3_CBC = "1.2.840.113549.3.7";

/**
 * Opens one of NSS's PBE blobs — the check value, the wrapped key, both the same
 * shape: `SEQUENCE { AlgorithmIdentifier, OCTET STRING cipherText }`. The
 * algorithm OID picks the generation; one this does not implement is raised as
 * `UnsupportedAlgorithmError` rather than being run as if it were 3DES, which is
 * what keeps a Firefox 144-era profile from decrypting to noise. Padding is
 * left on the plaintext: the callers want a known prefix or a fixed-length key,
 * not a padded string.
 */
export function decryptPbe(blob: Buffer, globalSalt: Buffer, password: Buffer): Buffer {
  const outer = parseDer(blob);
  const algorithm = outer.children[0];
  const cipherText = outer.children[1].content;
  const algorithmOid = derOid(algorithm.children[0]);

  if (algorithmOid === OID_PBE_3DES) {
    const params = algorithm.children[1];
    const entrySalt = params.children[0].content;
    const {key, iv} = deriveLegacyKey(globalSalt, password, entrySalt);
    return decipher("des-ede3-cbc", key, iv, cipherText);
  }

  if (algorithmOid === OID_PBES2) {
    const params = algorithm.children[1];
    const kdf = params.children[0];
    if (derOid(kdf.children[0]) !== OID_PBKDF2) throw new UnsupportedAlgorithmError(derOid(kdf.children[0]));
    const kdfParams = kdf.children[1];
    const entrySalt = kdfParams.children[0].content;
    const iterations = derInt(kdfParams.children[1]);
    const keyLength = derInt(kdfParams.children[2]);
    const cipher = params.children[1];
    const cipherOid = derOid(cipher.children[0]);
    if (cipherOid !== OID_AES256_CBC) throw new UnsupportedAlgorithmError(cipherOid);
    const iv = cipher.children[1].content;
    const key = derivePbes2Key(globalSalt, password, entrySalt, iterations, keyLength);
    return decipher("aes-256-cbc", key, iv, cipherText);
  }

  throw new UnsupportedAlgorithmError(algorithmOid);
}

/**
 * The legacy derivation, which is its own thing, not PBKDF2. NSS folds the
 * global salt, the password and the per-entry salt through SHA-1 and three HMACs
 * to produce 40 bytes, of which the first 24 are the 3DES key and the last 8 are
 * the IV. The `pes` is the entry salt right-padded to 20 bytes with zeros, as
 * NSS does it. Exported so a test can drive the same bytes in the encrypting
 * direction without re-deriving the constants.
 */
export function deriveLegacyKey(
  globalSalt: Buffer,
  password: Buffer,
  entrySalt: Buffer,
): {key: Buffer; iv: Buffer} {
  const hp = sha1(Buffer.concat([globalSalt, password]));
  const pes = Buffer.concat([entrySalt, Buffer.alloc(Math.max(0, 20 - entrySalt.length))]).subarray(0, 20);
  const chp = sha1(Buffer.concat([hp, entrySalt]));
  const k1 = hmacSha1(chp, Buffer.concat([pes, entrySalt]));
  const tk = hmacSha1(chp, pes);
  const k2 = hmacSha1(chp, Buffer.concat([tk, entrySalt]));
  const k = Buffer.concat([k1, k2]);
  return {key: k.subarray(0, 24), iv: k.subarray(k.length - 8)};
}

/**
 * The modern derivation: PBKDF2-SHA256 over SHA-1 of the global salt and
 * password, salted per entry. Returns the AES-256 key; the IV travels with the
 * blob, not with the key. Exported for the same reason as its legacy sibling.
 */
export function derivePbes2Key(
  globalSalt: Buffer,
  password: Buffer,
  entrySalt: Buffer,
  iterations: number,
  keyLength: number,
): Buffer {
  const seed = sha1(Buffer.concat([globalSalt, password]));
  return pbkdf2Sync(seed, entrySalt, iterations, keyLength, "sha256");
}

/**
 * Opens one login field. Each is base64 of
 * `SEQUENCE { OCTET STRING keyId, SEQUENCE { OID des-ede3-cbc, OCTET STRING iv },
 * OCTET STRING cipherText }` — always 3DES, regardless of the key4.db
 * generation, so a non-3DES OID here is a record shape this does not know and is
 * refused rather than mis-decrypted. The plaintext is PKCS#7-padded UTF-8, and
 * the padding is removed on the way out.
 */
export function decodeLoginField(base64: string, masterKey: Buffer): Buffer {
  const outer = parseDer(Buffer.from(base64, "base64"));
  const algorithmOid = derOid(outer.children[1].children[0]);
  if (algorithmOid !== OID_DES_EDE3_CBC) throw new UnsupportedAlgorithmError(algorithmOid);
  const iv = outer.children[1].children[1].content;
  const cipherText = outer.children[2].content;
  return stripPkcs7(decipher("des-ede3-cbc", masterKey, iv, cipherText));
}

function decipher(algorithm: "des-ede3-cbc" | "aes-256-cbc", key: Buffer, iv: Buffer, data: Buffer): Buffer {
  const cipher = createDecipheriv(algorithm, key, iv);
  // Padding is handled by the caller — the master key blob is not PKCS#7-padded
  // in a way we want stripped, and the check value we compare with its tail on.
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/** Removes PKCS#7 padding, refusing a byte count that cannot be padding —
 * a corrupt field should raise, not hand back a truncated password. */
function stripPkcs7(data: Buffer): Buffer {
  const pad = data[data.length - 1];
  if (pad < 1 || pad > 8 || pad > data.length) throw new Error("bad padding");
  return data.subarray(0, data.length - pad);
}

function sha1(data: Buffer): Buffer {
  return createHash("sha1").update(data).digest();
}

function hmacSha1(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha1", key).update(data).digest();
}

// -- DER ------------------------------------------------------------------

/** A parsed DER element. `content` is the raw value bytes; `children` is filled
 * only for a constructed type (a SEQUENCE), where the value is itself a run of
 * elements. This is deliberately just enough for NSS's blobs — no BER, no
 * indefinite lengths, no tag classes beyond what appears here. */
export interface DerNode {
  tag: number;
  content: Buffer;
  children: DerNode[];
}

/** Parses the single DER element at the start of `bytes`. Throws on anything
 * malformed so a caller can turn it into a `problems` entry. */
export function parseDer(bytes: Buffer): DerNode {
  const {node, end} = readNode(bytes, 0);
  if (end !== bytes.length) {
    // Trailing bytes after a complete element mean the blob is not what we
    // think it is; better to fail than to read half of it.
    throw new Error("trailing bytes after DER element");
  }
  return node;
}

function readNode(bytes: Buffer, offset: number): {node: DerNode; end: number} {
  if (offset + 2 > bytes.length) throw new Error("truncated DER header");
  const tag = bytes[offset];
  let cursor = offset + 1;
  let length = bytes[cursor++];
  if (length & 0x80) {
    // Long form: the low seven bits count the length bytes that follow.
    const count = length & 0x7f;
    if (count === 0 || count > 4) throw new Error("unsupported DER length");
    length = 0;
    for (let i = 0; i < count; i += 1) {
      if (cursor >= bytes.length) throw new Error("truncated DER length");
      length = (length << 8) | bytes[cursor++];
    }
  }
  const valueStart = cursor;
  const valueEnd = valueStart + length;
  if (valueEnd > bytes.length) throw new Error("DER value runs past end");
  const content = bytes.subarray(valueStart, valueEnd);

  const children: DerNode[] = [];
  // Bit 0x20 marks a constructed type; only those carry children.
  if (tag & 0x20) {
    let inner = valueStart;
    while (inner < valueEnd) {
      const child = readNode(bytes, inner);
      children.push(child.node);
      inner = child.end;
    }
  }
  return {node: {tag, content, children}, end: valueEnd};
}

/** The dotted OID string of an OBJECT IDENTIFIER node. */
export function derOid(node: DerNode): string {
  const bytes = node.content;
  if (bytes.length === 0) throw new Error("empty OID");
  // The first byte packs the first two arcs: first = byte / 40, second = the
  // remainder, except the first arc saturates at 2 and the second carries the
  // overflow.
  const first = Math.min(2, Math.floor(bytes[0] / 40));
  const parts = [first, bytes[0] - first * 40];
  let value = 0;
  for (let i = 1; i < bytes.length; i += 1) {
    // Base-128, high bit set on every byte but the last of an arc.
    value = (value << 7) | (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

/** The value of an INTEGER node, as a number. NSS's integers here — iteration
 * counts and a key length — are small; a value too large to hold exactly is a
 * blob we would not have understood anyway. */
export function derInt(node: DerNode): number {
  let value = 0;
  for (const byte of node.content) value = value * 256 + byte;
  if (!Number.isSafeInteger(value)) throw new Error("DER integer too large");
  return value;
}

// -- filesystem helpers ---------------------------------------------------

/**
 * Runs `read` against a *copy* of a SQLite database opened read-only.
 *
 * A running Firefox holds `cookies.sqlite` and `key4.db` in WAL mode, so the
 * newest rows live in the `-wal` sidecar and a naive read of the main file
 * misses them — and opening the live file at all risks contending with the
 * browser. The copy takes all three files so the read-only open sees a
 * consistent, complete database, and the source is never touched. The copy is
 * deleted whatever happens; it is a copy of the user's cookies and keys and has
 * no business outliving the read.
 */
export function withSqliteCopy<T>(file: string, read: (db: DatabaseSync) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), "flareai-ff-import-"));
  const copy = path.join(dir, path.basename(file));
  try {
    copyFileSync(file, copy);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(file + suffix)) copyFileSync(file + suffix, copy + suffix);
    }
    const db = new DatabaseSync(copy, {readOnly: true});
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

function readOrNull(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function toBool(value: unknown): boolean {
  return Number(value) !== 0;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The pages a Firefox profile has been to.
 *
 * `moz_places` is already one row per page with `visit_count` and
 * `last_visit_date` on it, so the visit table is not walked. The date is
 * microseconds since the Unix epoch — not the 1601 epoch Chromium uses, and
 * not the seconds Firefox uses for cookie expiry, which is why this converts
 * separately from `readFirefoxCookies`.
 *
 * `hidden` rows are framed or redirected pages Firefox does not show in its
 * own history; they are left out here for the same reason.
 */
export function readFirefoxHistory(profileDir: string): {visits: ImportedVisit[]; problems: string[]} {
  const file = path.join(profileDir, "places.sqlite");
  if (!existsSync(file)) return {visits: [], problems: []};
  let rows: Record<string, unknown>[];
  try {
    rows = withSqliteCopy(file, (db) =>
      db
        .prepare(
          `SELECT url, title, visit_count, last_visit_date FROM moz_places
           WHERE url <> '' AND hidden = 0 ORDER BY last_visit_date DESC`,
        )
        .all() as Record<string, unknown>[],
    );
  } catch (error) {
    return {visits: [], problems: [`Firefox history could not be read: ${describe(error)}`]};
  }

  const visits: ImportedVisit[] = [];
  let undated = 0;
  for (const row of rows) {
    const url = String(row.url ?? "");
    if (!url || !/^https?:/i.test(url)) continue;
    const micros = Number(row.last_visit_date ?? 0);
    if (!micros || !Number.isFinite(micros)) {
      undated += 1;
      continue;
    }
    visits.push({
      url,
      title: row.title === null || row.title === undefined ? "" : String(row.title),
      visitedAt: Math.floor(micros / 1_000_000),
      visitCount: Math.max(1, Number(row.visit_count ?? 1)),
    });
  }
  return {visits, problems: undated ? [`Firefox: ${undated} history entries had no usable date`] : []};
}
