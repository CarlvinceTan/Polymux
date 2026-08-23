import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  FULL_DISK_ACCESS_REASON,
  SAFARI_PASSWORDS_UNAVAILABLE,
  parseBinaryCookies,
  readSafariCookies,
  safariCookiePaths,
  safariLogins,
  safariProfiles,
  unixFromMacAbsolute,
  type ProbeResult,
} from "./safari.js";
import { MAC_EPOCH_OFFSET_SECONDS } from "./types.js";

/**
 * The fixtures are built byte by byte rather than copied from a real Mac,
 * because the point of the exercise is the layout: a fixture that agrees with
 * the parser about where a field sits proves nothing unless the fixture was
 * written from the format. Nothing here touches a real Safari container, and
 * nothing needs a keychain.
 */

interface CookieFields {
  url: string;
  name: string;
  path?: string;
  value: string;
  flags?: number;
  /** Mac absolute time — seconds since 2001-01-01, as Safari stores it. */
  expiry?: number;
  creation?: number;
}

/** One record: a 56-byte little-endian header, then the four strings it points
 * at, each NUL-terminated, in url/name/path/value order. */
function record(fields: CookieFields): Buffer {
  const strings = [fields.url, fields.name, fields.path ?? "/", fields.value].map((value) =>
    Buffer.from(`${value}\0`, "utf8"),
  );
  const offsets: number[] = [];
  let at = 56;
  for (const string of strings) {
    offsets.push(at);
    at += string.length;
  }
  const header = Buffer.alloc(56);
  header.writeUInt32LE(at, 0); // the record's own size, strings included
  header.writeUInt32LE(0, 4); // unused
  header.writeUInt32LE(fields.flags ?? 0, 8);
  header.writeUInt32LE(0, 12); // unused
  header.writeUInt32LE(offsets[0], 16);
  header.writeUInt32LE(offsets[1], 20);
  header.writeUInt32LE(offsets[2], 24);
  header.writeUInt32LE(offsets[3], 28);
  header.writeUInt32LE(0, 32); // end-of-record, 8 bytes
  header.writeUInt32LE(0, 36);
  header.writeDoubleLE(fields.expiry ?? 0, 40);
  header.writeDoubleLE(fields.creation ?? 0, 48);
  return Buffer.concat([header, ...strings]);
}

/** One page: the 0x00000100 header big-endian, then a little-endian count and
 * offset table, the records, and the four-byte footer a real file carries. */
function page(records: Buffer[]): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(0x0000_0100, 0);
  header.writeUInt32LE(records.length, 4);
  const table = Buffer.alloc(records.length * 4);
  let at = 8 + records.length * 4;
  records.forEach((entry, index) => {
    table.writeUInt32LE(at, index * 4);
    at += entry.length;
  });
  return Buffer.concat([header, table, ...records, Buffer.alloc(4)]);
}

/** The file header is big-endian, unlike everything inside a page. The trailing
 * eight bytes stand in for the checksum a real file ends with, which the parser
 * has no business caring about. */
function jar(pages: Buffer[]): Buffer {
  const header = Buffer.alloc(8 + pages.length * 4);
  header.write(MAGIC, 0, "latin1");
  header.writeUInt32BE(pages.length, 4);
  pages.forEach((entry, index) => header.writeUInt32BE(entry.length, 8 + index * 4));
  return Buffer.concat([header, ...pages, Buffer.alloc(8)]);
}

const MAGIC = "cook";
/** 2023-11-14T22:13:20Z, chosen because it is a whole number of seconds in both
 * epochs and so survives the conversion exactly. */
const UNIX_EXPIRY = 1_700_000_000;
const MAC_EXPIRY = UNIX_EXPIRY - MAC_EPOCH_OFFSET_SECONDS;

test("reads a cookie's strings, flags and expiry out of one page", () => {
  const data = parseBinaryCookies(
    jar([
      page([
        record({
          url: ".example.com",
          name: "session",
          path: "/app",
          value: "abc123",
          flags: 0x1 | 0x4,
          expiry: MAC_EXPIRY,
          creation: MAC_EXPIRY - 86_400,
        }),
      ]),
    ]),
  );

  assert.deepEqual(data.problems, []);
  assert.equal(data.cookies.length, 1);
  assert.deepEqual(data.cookies[0], {
    url: "https://example.com/app",
    name: "session",
    value: "abc123",
    path: "/app",
    secure: true,
    httpOnly: true,
    domain: ".example.com",
    // Mac absolute time is seconds since 2001; Electron wants seconds since 1970.
    expirationDate: UNIX_EXPIRY,
  });
});

test("a leading dot is a domain cookie, and its absence is host-only", () => {
  const data = parseBinaryCookies(
    jar([
      page([
        record({ url: ".example.com", name: "wide", value: "1" }),
        record({ url: "app.example.com", name: "narrow", value: "2" }),
      ]),
    ]),
  );

  assert.deepEqual(data.problems, []);
  assert.equal(data.cookies[0].domain, ".example.com");
  assert.equal(
    "domain" in data.cookies[1],
    false,
    "a host-only cookie must not carry a domain — Electron infers host-only from its absence",
  );
  // The dot is not part of a url, whichever kind of cookie it is.
  assert.deepEqual(
    data.cookies.map((cookie) => cookie.url),
    ["http://example.com/", "http://app.example.com/"],
  );
});

test("clear flags mean an insecure, script-readable cookie on http", () => {
  const [cookie] = parseBinaryCookies(
    jar([page([record({ url: "plain.test", name: "a", value: "b", flags: 0 })])]),
  ).cookies;
  assert.equal(cookie.secure, false);
  assert.equal(cookie.httpOnly, false);
  assert.equal(cookie.url, "http://plain.test/");
});

test("each flag is read on its own rather than as a pair", () => {
  const only = (flags: number) =>
    parseBinaryCookies(jar([page([record({ url: "x.test", name: "a", value: "b", flags })])]))
      .cookies[0];
  assert.deepEqual([only(0x1).secure, only(0x1).httpOnly], [true, false]);
  assert.deepEqual([only(0x4).secure, only(0x4).httpOnly], [false, true]);
});

test("a zero expiry is a session cookie, not 2001", () => {
  const [cookie] = parseBinaryCookies(
    jar([page([record({ url: "x.test", name: "a", value: "b", expiry: 0 })])]),
  ).cookies;
  assert.equal(
    "expirationDate" in cookie,
    false,
    "an absent expiry is how Electron records a cookie that dies with the session",
  );
});

test("cookies are recovered across several pages, in file order", () => {
  const data = parseBinaryCookies(
    jar([
      page([record({ url: "one.test", name: "a", value: "1" })]),
      page([
        record({ url: "two.test", name: "b", value: "2" }),
        record({ url: "two.test", name: "c", value: "3" }),
      ]),
      page([record({ url: "three.test", name: "d", value: "4" })]),
    ]),
  );

  assert.deepEqual(data.problems, []);
  // A page's cookie count is little-endian while the file's page count is
  // big-endian: read either with the other's endianness and these four cookies
  // do not survive the trip.
  assert.deepEqual(
    data.cookies.map((cookie) => `${cookie.name}=${cookie.value}`),
    ["a=1", "b=2", "c=3", "d=4"],
  );
});

test("an empty jar is empty rather than a failure", () => {
  const data = parseBinaryCookies(jar([page([])]));
  assert.deepEqual(data.cookies, []);
  assert.deepEqual(data.problems, []);
});

test("a truncated file keeps the pages that survived and reports the cut", () => {
  const whole = jar([
    page([record({ url: "kept.test", name: "a", value: "1" })]),
    page([record({ url: "lost.test", name: "b", value: "2" })]),
  ]);
  // Cut inside the second page, which is what a copy taken mid-write looks like.
  const data = parseBinaryCookies(whole.subarray(0, whole.length - 20));

  assert.deepEqual(
    data.cookies.map((cookie) => cookie.name),
    ["a"],
  );
  assert.equal(data.problems.length, 1);
  assert.match(data.problems[0], /cut short at page 2 of 2/);
});

test("garbage is reported rather than thrown", () => {
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from("not a cookie jar at all", "utf8"),
    Buffer.from("cook", "latin1"),
  ]) {
    const data = parseBinaryCookies(bytes);
    assert.deepEqual(data.cookies, []);
    assert.equal(data.problems.length, 1, `one problem for ${bytes.length} bytes of junk`);
  }
});

test("a page count that cannot fit is refused instead of trusted", () => {
  const bytes = Buffer.alloc(16);
  bytes.write(MAGIC, 0, "latin1");
  bytes.writeUInt32BE(0xffff_ffff, 4);
  const data = parseBinaryCookies(bytes);
  assert.deepEqual(data.cookies, []);
  assert.match(data.problems[0], /4294967295 pages/);
});

test("one bad record costs only itself", () => {
  const good = record({ url: "good.test", name: "a", value: "1" });
  const bad = record({ url: "bad.test", name: "b", value: "2" });
  // A value offset pointing off the end of the record: the kind of thing a
  // half-written jar produces, and the kind of thing that must not cost the
  // user the cookies either side of it.
  bad.writeUInt32LE(0xffff, 28);
  const alsoGood = record({ url: "later.test", name: "c", value: "3" });
  const data = parseBinaryCookies(jar([page([good, bad, alsoGood])]));

  assert.deepEqual(
    data.cookies.map((cookie) => cookie.name),
    ["a", "c"],
  );
  assert.equal(data.problems.length, 1);
  assert.match(data.problems[0], /Cookie 2 on page 1 .* value is stored outside the record/);
});

test("a record that claims more bytes than its page holds is refused", () => {
  const overrun = record({ url: "x.test", name: "a", value: "1" });
  overrun.writeUInt32LE(4096, 0);
  const data = parseBinaryCookies(jar([page([overrun])]));
  assert.deepEqual(data.cookies, []);
  assert.match(data.problems[0], /declares 4096 bytes but its page ends first/);
});

test("a page that is not a cookie page is skipped, not followed", () => {
  const broken = page([record({ url: "x.test", name: "a", value: "1" })]);
  broken.writeUInt32BE(0x0001_0000, 0); // the page header, read the wrong way round
  const data = parseBinaryCookies(
    jar([broken, page([record({ url: "y.test", name: "b", value: "2" })])]),
  );
  assert.deepEqual(
    data.cookies.map((cookie) => cookie.name),
    ["b"],
  );
  assert.match(data.problems[0], /Page 1 .* is not a cookie page/);
});

test("mac absolute time converts, and non-times do not", () => {
  assert.equal(unixFromMacAbsolute(MAC_EXPIRY), UNIX_EXPIRY);
  assert.equal(unixFromMacAbsolute(0), null);
  assert.equal(unixFromMacAbsolute(-1), null);
  assert.equal(unixFromMacAbsolute(Number.NaN), null);
});

test("reads a jar off disk, and reports one it cannot open", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "polymux-safari-"));
  const file = path.join(directory, "Cookies.binarycookies");
  writeFileSync(file, jar([page([record({ url: ".disk.test", name: "a", value: "1" })])]));

  const read = await readSafariCookies(file);
  assert.deepEqual(read.problems, []);
  assert.deepEqual(
    read.cookies.map((cookie) => cookie.url),
    ["http://disk.test/"],
  );

  const missing = await readSafariCookies(path.join(directory, "nothing.binarycookies"));
  assert.deepEqual(missing.cookies, []);
  assert.equal(missing.problems.length, 1);
});

test("the profile carries the Full Disk Access reason when the container is closed", async () => {
  const blocked = async (): Promise<ProbeResult> => "blocked";
  const [profile] = await safariProfiles({ home: "/Users/nobody", platform: "darwin", probe: blocked });

  assert.equal(profile.readable, false);
  assert.equal(profile.reason, FULL_DISK_ACCESS_REASON);
  assert.match(profile.reason ?? "", /Full Disk Access/);
  assert.match(profile.reason ?? "", /quit and reopen/i);
  assert.equal(profile.path, safariCookiePaths("/Users/nobody")[0]);
});

test("a readable jar is a readable profile, and none at all is no profile", async () => {
  const container = safariCookiePaths("/Users/nobody")[0];
  const onlyContainer = async (file: string): Promise<ProbeResult> =>
    file === container ? "readable" : "missing";
  const [profile] = await safariProfiles({
    home: "/Users/nobody",
    platform: "darwin",
    probe: onlyContainer,
  });
  assert.deepEqual(
    { readable: profile.readable, reason: profile.reason, path: profile.path },
    { readable: true, reason: null, path: container },
  );

  const nothing = async (): Promise<ProbeResult> => "missing";
  assert.deepEqual(
    await safariProfiles({ home: "/Users/nobody", platform: "darwin", probe: nothing }),
    [],
  );
  // Safari is macOS-only; elsewhere there is nothing to offer the user.
  assert.deepEqual(
    await safariProfiles({ home: "/Users/nobody", platform: "win32", probe: async () => "readable" }),
    [],
  );
});

test("a readable old-location jar wins over a blocked container", async () => {
  const [container, legacy] = safariCookiePaths("/Users/nobody");
  const [profile] = await safariProfiles({
    home: "/Users/nobody",
    platform: "darwin",
    probe: async (file) => (file === container ? "blocked" : "readable"),
  });
  assert.equal(profile.path, legacy);
  assert.equal(profile.readable, true);
});

test("passwords are declined in words the user can act on", () => {
  const data = safariLogins();
  assert.deepEqual(data.logins, []);
  assert.deepEqual(data.problems, [SAFARI_PASSWORDS_UNAVAILABLE]);
  assert.match(SAFARI_PASSWORDS_UNAVAILABLE, /Export/);
  assert.match(SAFARI_PASSWORDS_UNAVAILABLE, /CSV/);
});

test("results never share arrays with the empty constant", async () => {
  const first = parseBinaryCookies(Buffer.alloc(0));
  const second = parseBinaryCookies(Buffer.alloc(0));
  first.cookies.push({ url: "http://x.test/", name: "a", value: "1" });
  assert.deepEqual(second.cookies, [], "each result owns its arrays");
  assert.deepEqual((await readSafariCookies("/nowhere/at/all")).cookies, []);
});
