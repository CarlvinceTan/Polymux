import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  derInt,
  derOid,
  firefoxProfiles,
  fromMozSameSite,
  parseDer,
  parseProfilesIni,
  readFirefoxCookies,
  withSqliteCopy,
} from "./firefox.js";

function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), "polymux-firefox-test-"));
}

test("profiles.ini yields each profile, relative or absolute", () => {
  const entries = parseProfilesIni(
    [
      "[Install4F96D1932A9F858E]",
      "Default=Profiles/abc123.default-release",
      "",
      "[Profile0]",
      "Name=default-release",
      "IsRelative=1",
      "Path=Profiles/abc123.default-release",
      "",
      "[Profile1]",
      "Name=elsewhere",
      "IsRelative=0",
      "Path=/Volumes/Data/firefox-profile",
      "",
    ].join("\n"),
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.name, "default-release");
  assert.equal(entries[0]!.isRelative, true);
  // An absolute path is taken as written rather than joined onto the root.
  assert.equal(entries[1]!.isRelative, false);
  assert.equal(entries[1]!.path, "/Volumes/Data/firefox-profile");
});

test("a root with no profiles.ini reports nothing rather than throwing", () => {
  const directory = scratch();
  try {
    assert.deepEqual(firefoxProfiles(path.join(directory, "nope")), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("moz_cookies map across with seconds, not microseconds", () => {
  const directory = scratch();
  try {
    const file = path.join(directory, "cookies.sqlite");
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE moz_cookies (
      id INTEGER PRIMARY KEY, name TEXT, value TEXT, host TEXT, path TEXT,
      expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER
    )`);
    db.prepare(
      "INSERT INTO moz_cookies (name,value,host,path,expiry,isSecure,isHttpOnly,sameSite) VALUES (?,?,?,?,?,?,?,?)",
    ).run("session", "abc123", ".example.com", "/", 2_000_000_000, 1, 1, 1);
    // A session cookie: expiry 0 must not become 1970.
    db.prepare(
      "INSERT INTO moz_cookies (name,value,host,path,expiry,isSecure,isHttpOnly,sameSite) VALUES (?,?,?,?,?,?,?,?)",
    ).run("temp", "xyz", "host.example", "/", 0, 0, 0, 0);
    db.close();

    const { cookies } = readFirefoxCookies(directory);
    assert.equal(cookies.length, 2);

    const [first, second] = cookies;
    // Firefox stores expiry in seconds already — a microsecond conversion here
    // would push the date far into the future.
    assert.equal(first!.expirationDate, 2_000_000_000);
    assert.equal(first!.secure, true);
    assert.equal(first!.httpOnly, true);
    assert.equal(first!.domain, ".example.com", "a dotted host stays a domain cookie");
    assert.ok(first!.url.startsWith("https://"), "the secure flag picks the scheme");

    assert.equal(second!.expirationDate, undefined, "expiry 0 is a session cookie");
    assert.ok(second!.url.startsWith("http://"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("sameSite values cross over, and anything unknown stays unspecified", () => {
  assert.equal(fromMozSameSite(0), "no_restriction");
  assert.equal(fromMozSameSite(1), "lax");
  assert.equal(fromMozSameSite(2), "strict");
  assert.equal(fromMozSameSite(99), "unspecified");
  assert.equal(fromMozSameSite(null), "unspecified");
  assert.equal(fromMozSameSite("2"), "strict", "sqlite may hand back a string");
});

test("the DER reader walks a sequence and reads its parts", () => {
  // SEQUENCE { OID 1.2.840.113549.2.9 (hmacWithSHA256), INTEGER 1000 }
  const oid = Buffer.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x02, 0x09]);
  const integer = Buffer.from([0x02, 0x02, 0x03, 0xe8]);
  const body = Buffer.concat([oid, integer]);
  const sequence = Buffer.concat([Buffer.from([0x30, body.length]), body]);

  const node = parseDer(sequence);
  assert.equal(node.tag, 0x30);
  assert.equal(node.children.length, 2);
  assert.equal(derOid(node.children[0]!), "1.2.840.113549.2.9");
  assert.equal(derInt(node.children[1]!), 1000);
});

test("the DER reader handles a long-form length", () => {
  // A 200-byte octet string forces the 0x81 long-form length.
  const payload = Buffer.alloc(200, 0x41);
  const octets = Buffer.concat([Buffer.from([0x04, 0x81, 200]), payload]);
  const node = parseDer(octets);
  assert.equal(node.tag, 0x04);
  assert.equal(node.content.length, 200);
});

test("a truncated DER blob is rejected rather than read past its end", () => {
  // Claims 40 bytes of content but carries four.
  assert.throws(() => parseDer(Buffer.from([0x30, 0x28, 0x01, 0x02, 0x03, 0x04])));
});

test("a database is read from a copy, leaving the original untouched", () => {
  const directory = scratch();
  try {
    const file = path.join(directory, "cookies.sqlite");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE t (a TEXT)");
    db.prepare("INSERT INTO t VALUES (?)").run("value");
    db.close();
    // A stray sidecar must be copied alongside rather than tripping the read.
    writeFileSync(`${file}-wal`, "");

    const rows = withSqliteCopy(file, (copy) => copy.prepare("SELECT a FROM t").all());
    assert.equal((rows[0] as { a: string }).a, "value");

    // The source is still openable and unchanged — nothing was written back.
    const after = new DatabaseSync(file);
    assert.equal((after.prepare("SELECT COUNT(*) c FROM t").get() as { c: number }).c, 1);
    after.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a profile with no cookies yet is empty, not broken", () => {
  const directory = scratch();
  try {
    // A profile that has never been browsed in has no cookies.sqlite at all.
    // That is an empty profile, not a failure, and must not raise a warning.
    const { cookies, problems } = readFirefoxCookies(directory);
    assert.deepEqual(cookies, []);
    assert.deepEqual(problems, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a cookies database that cannot be read is reported", () => {
  const directory = scratch();
  try {
    // Present but not a database — the real failure, which the user is told
    // about rather than being handed a silent zero.
    writeFileSync(path.join(directory, "cookies.sqlite"), "not a database");
    const { cookies, problems } = readFirefoxCookies(directory);
    assert.deepEqual(cookies, []);
    assert.equal(problems.length > 0, true, "the caller is told why nothing came back");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
