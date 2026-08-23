import assert from "node:assert/strict";
import {createCipheriv, createHash} from "node:crypto";
import {mkdirSync, mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {DatabaseSync} from "node:sqlite";
import {
  chromeTimestampToUnixSeconds,
  chromiumProfiles,
  cookieFromRow,
  decryptValue,
  deriveKey,
  importChromium,
  originOf,
  readChromiumCookies,
  readChromiumLogins,
  type ChromiumBrowser,
} from "./chromium.js";
import {WINDOWS_EPOCH_OFFSET_SECONDS} from "./types.js";

/** The same IV the module uses: sixteen spaces. Kept here so the test encrypts
 * exactly the way Chrome does rather than reaching into the module for it. */
const IV = Buffer.alloc(16, 0x20);

/** Encrypts a value the Chrome way — optional 32-byte domain hash, PKCS#7
 * padding, AES-128-CBC, then the `v10` tag — so a round-trip proves the decoder
 * against real ciphertext rather than a stub. */
function encryptChromium(plaintext: string, key: Buffer, domainHash?: Buffer): Buffer {
  const body = domainHash
    ? Buffer.concat([domainHash, Buffer.from(plaintext, "utf8")])
    : Buffer.from(plaintext, "utf8");
  const cipher = createCipheriv("aes-128-cbc", key, IV);
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([Buffer.from("v10", "latin1"), encrypted]);
}

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "polymux-chromium-test-"));
}

test("deriveKey matches Chromium's fixed macOS parameters", () => {
  // Independent reference: PBKDF2-HMAC-SHA1('peanuts', 'saltysalt', 1003, 16),
  // computed with Python's hashlib, which shares no code with node's crypto.
  assert.equal(deriveKey("peanuts").toString("hex"), "d9a09d499b4e1b7461f28e67972c6dbd");
  assert.equal(deriveKey("peanuts").length, 16);
});

test("decryptValue round-trips a value encrypted with the same scheme", () => {
  const key = deriveKey("some safe storage secret");
  const blob = encryptChromium("session=abc123; theme=dark", key);
  assert.equal(decryptValue(blob, key, {stripDomainHash: false}), "session=abc123; theme=dark");
});

test("the 32-byte domain hash is stripped for v24 and kept for older stores", () => {
  const key = deriveKey("secret");
  const hash = createHash("sha256").update("example.com").digest();
  const blob = encryptChromium("real-value", key, hash);
  // With the flag on (version >= 24), the hash is gone and the value is clean.
  assert.equal(decryptValue(blob, key, {stripDomainHash: true}), "real-value");
  // With it off (version < 24), the same bytes decrypt to hash-plus-value, so
  // the result is not the value — proving the strip is what recovers it.
  const notStripped = decryptValue(blob, key, {stripDomainHash: false});
  assert.notEqual(notStripped, "real-value");
  assert.equal(notStripped?.endsWith("real-value"), true);
});

test("chromeTimestampToUnixSeconds converts 1601 microseconds and treats 0 as a session cookie", () => {
  const unix = 1_700_000_000;
  const micros = (BigInt(unix) + BigInt(WINDOWS_EPOCH_OFFSET_SECONDS)) * 1_000_000n;
  assert.equal(chromeTimestampToUnixSeconds(micros), unix);
  assert.equal(chromeTimestampToUnixSeconds(0n), undefined);
  assert.equal(chromeTimestampToUnixSeconds(0), undefined);
});

test("a foreign or corrupt blob returns null rather than throwing", () => {
  const key = deriveKey("secret");
  // A Windows v20 blob, a Linux v11 blob, plain garbage, and a too-short buffer.
  assert.equal(decryptValue(Buffer.from("v20abcdefghijklmnop", "latin1"), key, {stripDomainHash: false}), null);
  assert.equal(decryptValue(Buffer.from("v11abcdefghijklmnop", "latin1"), key, {stripDomainHash: false}), null);
  assert.equal(decryptValue(Buffer.from("not encrypted at all"), key, {stripDomainHash: false}), null);
  assert.equal(decryptValue(Buffer.from("v1"), key, {stripDomainHash: false}), null);
  // A v10 tag over a body that is not a whole number of AES blocks.
  assert.equal(decryptValue(Buffer.from("v10short"), key, {stripDomainHash: false}), null);
});

test("cookieFromRow reads a session cookie without an expiry and a domain cookie's dot", () => {
  const key = deriveKey("secret");
  const cookie = cookieFromRow(
    {
      host_key: ".example.com",
      name: "sid",
      value: null,
      encrypted_value: encryptChromium("xyz", key),
      path: "/",
      is_secure: 1n,
      is_httponly: 1n,
      samesite: 1n,
      has_expires: 0n,
      is_persistent: 0n,
      expires_utc: 0n,
    },
    key,
    false,
  );
  assert.ok(cookie);
  assert.equal(cookie.value, "xyz");
  assert.equal(cookie.domain, ".example.com");
  assert.equal(cookie.url, "https://example.com/");
  assert.equal(cookie.sameSite, "lax");
  assert.equal(cookie.secure, true);
  assert.equal(cookie.httpOnly, true);
  assert.equal("expirationDate" in cookie, false);
});

/** Builds a real Cookies database at the given `meta.version`, the way the
 * reader will find it in a profile folder. */
function writeCookiesDb(dir: string, version: number, key: Buffer): string {
  const profile = path.join(dir, "Default");
  mkdirSync(profile, {recursive: true});
  const file = path.join(profile, "Cookies");
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE meta(key TEXT NOT NULL, value TEXT); " +
      "CREATE TABLE cookies(host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, " +
      "is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, has_expires INTEGER, " +
      "is_persistent INTEGER, expires_utc INTEGER)",
  );
  db.prepare("INSERT INTO meta(key, value) VALUES('version', ?)").run(String(version));
  const insert = db.prepare(
    "INSERT INTO cookies(host_key, name, value, encrypted_value, path, is_secure, is_httponly, " +
      "samesite, has_expires, is_persistent, expires_utc) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  );
  const domainHash = version >= 24 ? createHash("sha256").update("example.com").digest() : undefined;
  const expires = (BigInt(1_800_000_000) + BigInt(WINDOWS_EPOCH_OFFSET_SECONDS)) * 1_000_000n;
  // A normal encrypted cookie, prefixed only when the store is new enough.
  insert.run("example.com", "sid", "", encryptChromium("secret-value", key, domainHash), "/", 1, 0, 2, 1, 1, expires);
  // A legacy row with a plaintext value and no encrypted bytes.
  insert.run("legacy.test", "old", "plain", null, "/", 0, 0, 0, 0, 0, 0n);
  // A blob this key cannot read — must become a problem, not a thrown import.
  insert.run("bad.test", "broken", "", Buffer.from("v10garbagebytes!"), "/", 1, 0, 1, 1, 1, expires);
  db.close();
  return file;
}

test("readChromiumCookies strips the domain hash only at version >= 24", async () => {
  const key = deriveKey("secret");
  for (const version of [24, 18]) {
    const file = writeCookiesDb(tempDir(), version, key);
    const {cookies, problems} = await readChromiumCookies(file, key);
    const sid = cookies.find((cookie) => cookie.name === "sid");
    assert.equal(sid?.value, "secret-value", `version ${version} recovers the encrypted value`);
    assert.equal(sid?.domain, undefined, "example.com is host-only, so no domain field");
    assert.equal(sid?.expirationDate, 1_800_000_000, "the expiry converts to Unix seconds");
    const legacy = cookies.find((cookie) => cookie.name === "old");
    assert.equal(legacy?.value, "plain", "a plaintext legacy value is read as-is");
    // The unreadable row is recorded and the rest survive.
    assert.equal(cookies.some((cookie) => cookie.name === "broken"), false);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /broken/);
  }
});

function writeLoginsDb(dir: string, key: Buffer): string {
  const profile = path.join(dir, "Default");
  mkdirSync(profile, {recursive: true});
  const file = path.join(profile, "Login Data");
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE logins(origin_url TEXT, username_value TEXT, password_value BLOB, blacklisted_by_user INTEGER)",
  );
  const insert = db.prepare(
    "INSERT INTO logins(origin_url, username_value, password_value, blacklisted_by_user) VALUES(?,?,?,?)",
  );
  insert.run("https://mail.example.com/login", "alice", encryptChromium("hunter2", key), 0);
  // Blacklisted: the user told Chrome never to save here.
  insert.run("https://nope.example.com", "bob", encryptChromium("x", key), 1);
  // No username, empty password, and a non-web origin — all skipped.
  insert.run("https://empty.example.com", "", encryptChromium("y", key), 0);
  insert.run("https://blank.example.com", "carol", Buffer.alloc(0), 0);
  insert.run("android://token@com.example.app", "dave", encryptChromium("z", key), 0);
  // A password blob this key cannot decrypt — a problem, not a crash.
  insert.run("https://broken.example.com", "erin", Buffer.from("v10notreal"), 0);
  db.close();
  return file;
}

test("readChromiumLogins keeps real logins and records what it cannot use", async () => {
  const key = deriveKey("secret");
  const file = writeLoginsDb(tempDir(), key);
  const {logins, problems} = await readChromiumLogins(file, key);
  assert.equal(logins.length, 1);
  assert.deepEqual(logins[0], {
    origin: "https://mail.example.com",
    username: "alice",
    password: "hunter2",
  });
  // The android origin and the undecryptable blob both leave a note.
  assert.equal(problems.length, 2);
  assert.ok(problems.some((problem) => /android/.test(problem)));
  assert.ok(problems.some((problem) => /broken\.example\.com/.test(problem)));
});

test("originOf keeps web origins and drops the rest", () => {
  assert.equal(originOf("https://mail.example.com/inbox?x=1"), "https://mail.example.com");
  assert.equal(originOf("http://localhost:8080/app"), "http://localhost:8080");
  assert.equal(originOf("android://abc@com.example"), null);
  assert.equal(originOf("not a url"), null);
});

test("chromiumProfiles reads Local State's info_cache and falls back to Default", async () => {
  const dir = tempDir();
  mkdirSync(path.join(dir, "Default"), {recursive: true});
  mkdirSync(path.join(dir, "Profile 1"), {recursive: true});
  writeFileSync(
    path.join(dir, "Local State"),
    JSON.stringify({
      profile: {info_cache: {Default: {name: "Personal"}, "Profile 1": {name: "Work"}, "Profile 2": {name: "Gone"}}},
    }),
  );
  const profiles = await chromiumProfiles(dir);
  assert.deepEqual(
    profiles.map((profile) => [profile.id, profile.name, profile.readable]),
    [
      ["Default", "Personal", true],
      ["Profile 1", "Work", true],
      ["Profile 2", "Gone", false],
    ],
  );
  assert.equal(profiles[2].reason !== null, true, "a listed-but-missing profile explains itself");

  // No Local State at all: a single readable-or-not Default.
  const bare = tempDir();
  const fallback = await chromiumProfiles(bare);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].id, "Default");
});

test("importChromium ties a profile together with an injected secret", async () => {
  const key = deriveKey("injected");
  const userDataDir = tempDir();
  writeCookiesDb(userDataDir, 24, key);
  writeLoginsDb(userDataDir, key);
  writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({profile: {info_cache: {Default: {name: "Personal"}}}}),
  );
  const browser: ChromiumBrowser = {
    id: "test",
    name: "Test Browser",
    dataDir: "unused",
    keychain: "Test Safe Storage",
  };

  let asked = 0;
  const data = await importChromium({
    browser,
    userDataDir,
    // The keychain seam: a fixed string, so the test never prompts.
    secret: async () => {
      asked += 1;
      return "injected";
    },
  });
  assert.equal(asked, 1, "the secret is fetched once and reused across stores");
  assert.equal(data.cookies.find((cookie) => cookie.name === "sid")?.value, "secret-value");
  assert.equal(data.logins.length, 1);
  assert.equal(data.logins[0].username, "alice");
});
