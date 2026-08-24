import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importFromFile, parseCookiesTxt, parseCsv, parsePasswordCsv } from "./files.js";
import { EMPTY_IMPORT } from "./types.js";

/** Every filesystem test builds its own file: a real profile is the one thing
 * this folder must never touch, and none of this needs a keychain. */
function directory(): string {
  return mkdtempSync(path.join(tmpdir(), "polymux-import-files-"));
}

function file(folder: string, name: string, body: string | Buffer): string {
  const at = path.join(folder, name);
  writeFileSync(at, body);
  return at;
}

test("a quoted field keeps its commas, its quotes and its line breaks", () => {
  // The row that matters: a password with all three, plus CRLF around it.
  const csv = 'name,url\r\nExample,"p,a""ss\r\nword"\r\n';

  assert.deepEqual(parseCsv(csv), [
    ["name", "url"],
    ["Example", 'p,a"ss\nword'],
  ]);
});

test("a bare quote inside a field is a character, not a quoted field", () => {
  // A writer that emits `O"Brien` unquoted means it literally; opening a quote
  // there would swallow every following comma and newline in the file.
  assert.deepEqual(parseCsv('a,O"Brien,c\nd,e,f'), [
    ["a", 'O"Brien', "c"],
    ["d", "e", "f"],
  ]);
});

test("blank lines are dropped but a deliberately empty quoted row is not", () => {
  assert.deepEqual(parseCsv("a,b\n\n\nc,d\n"), [
    ["a", "b"],
    ["c", "d"],
  ]);
  assert.deepEqual(parseCsv('a\n""\n'), [["a"], [""]]);
  assert.deepEqual(parseCsv(""), []);
});

test("the Chrome dialect, with a BOM, CRLF and a password holding everything", () => {
  const csv =
    "﻿name,url,username,password,note\r\n" +
    'Example,https://example.com/login,ada,"p,a""ss\r\nword",a note\r\n' +
    "Old,http://old.test:8080/,,hunter2,\r\n";

  const { logins, cookies, problems } = parsePasswordCsv(csv);

  assert.deepEqual(problems, []);
  assert.deepEqual(cookies, []);
  assert.deepEqual(logins, [
    // The path is gone and the port is kept — an origin, as the contract says.
    { origin: "https://example.com", username: "ada", password: 'p,a"ss\nword' },
    { origin: "http://old.test:8080", username: "", password: "hunter2" },
  ]);
});

test("the Chrome dialect before M115, which has no note column", () => {
  const csv = "name,url,username,password\nExample,https://example.com,ada,secret\n";

  assert.deepEqual(parsePasswordCsv(csv).logins, [
    { origin: "https://example.com", username: "ada", password: "secret" },
  ]);
});

test("the Firefox dialect, whose url comes first and whose header is quoted", () => {
  const csv =
    '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated",' +
    '"timeLastUsed","timePasswordChanged"\n' +
    '"https://example.com","ada","se,cret","","https://example.com",' +
    '"{2f3b}","1690000000000","1690000000000","1690000000000"\n';

  const { logins, problems } = parsePasswordCsv(csv);

  assert.deepEqual(problems, []);
  // Position would have read the *url* as the username here; the header is
  // what keeps them apart.
  assert.deepEqual(logins, [
    { origin: "https://example.com", username: "ada", password: "se,cret" },
  ]);
});

test("the Safari dialect, whose first column is a title", () => {
  const csv =
    "Title,URL,Username,Password,Notes,OTPAuth\n" +
    "Example,https://example.com,ada,se cret,my note,otpauth://totp/x\n";

  assert.deepEqual(parsePasswordCsv(csv).logins, [
    { origin: "https://example.com", username: "ada", password: "se cret" },
  ]);
});

test("a bare host in a Safari export is taken as https", () => {
  const csv = "Title,URL,Username,Password,Notes,OTPAuth\nExample,example.com,ada,secret,,\n";

  assert.deepEqual(parsePasswordCsv(csv).logins, [
    { origin: "https://example.com", username: "ada", password: "secret" },
  ]);
});

test("a malformed row is reported and the rows around it still import", () => {
  const csv = [
    "name,url,username,password,note",
    "First,https://first.test,ada,one,",
    "Short,https://second.test,ada",
    "NoPassword,https://third.test,ada,,",
    "Android,android://hash@com.example/,ada,four,",
    "Last,https://last.test,grace,five,",
  ].join("\n");

  const { logins, problems } = parsePasswordCsv(csv);

  assert.deepEqual(
    logins.map((login) => login.origin),
    ["https://first.test", "https://last.test"],
  );
  // Row numbers count the header, so they are the numbers the user sees when
  // the file is open in front of them.
  assert.equal(problems.length, 3);
  assert.match(problems[0], /^row 3: 3 columns, expected at least 4$/);
  assert.match(problems[1], /^row 4: skipped, it has no password$/);
  assert.match(problems[2], /^row 5: "android:\/\/hash@com\.example\/" is not a site/);
});

test("a header-only export says so rather than looking like a success", () => {
  const { logins, cookies, problems } = parsePasswordCsv("name,url,username,password,note\n");

  assert.deepEqual({ logins, cookies }, { logins: EMPTY_IMPORT.logins, cookies: EMPTY_IMPORT.cookies });
  assert.deepEqual(problems, ["the Chrome export lists no passwords"]);
});

test("something that is not a password export at all", () => {
  const result = parsePasswordCsv("first,second,third\n1,2,3\n");

  assert.deepEqual({ logins: result.logins, cookies: result.cookies }, { logins: [], cookies: [] });
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /^not a password export: the first row reads first, second, third$/);

  const empty = parsePasswordCsv("");
  assert.deepEqual(empty, { cookies: [], logins: [], visits: [], problems: ["the file is empty"] });
});

test("a cookies.txt: the HttpOnly flag is a flag, the comment is a comment", () => {
  const text = [
    "# Netscape HTTP Cookie File",
    "# This file was generated by libcurl! Edit at your own risk.",
    "",
    "#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1893456000\tsession\tabc123",
    "www.example.com\tFALSE\t/app\tFALSE\t0\tprefs\tdark",
  ].join("\r\n");

  const { cookies, logins, problems } = parseCookiesTxt(text);

  assert.deepEqual(problems, []);
  assert.deepEqual(logins, []);
  assert.deepEqual(cookies, [
    {
      url: "https://example.com/",
      name: "session",
      value: "abc123",
      path: "/",
      secure: true,
      httpOnly: true,
      domain: ".example.com",
      expirationDate: 1_893_456_000,
    },
    {
      url: "http://www.example.com/app",
      name: "prefs",
      value: "dark",
      path: "/app",
      secure: false,
      httpOnly: false,
      // No domain: FALSE and no leading dot make this host-only, which is the
      // distinction Electron infers from the field being absent.
      // No expirationDate either: zero is a session cookie, not 1970.
    },
  ]);
});

test("a cookies.txt with a BOM and a domain flag but no leading dot", () => {
  const text = "﻿# Netscape HTTP Cookie File\nexample.com\tTRUE\t\tFALSE\t100\ta\tb\n";

  const [cookie] = parseCookiesTxt(text).cookies;

  assert.equal(cookie.domain, ".example.com");
  // An empty path field still has to produce a usable url.
  assert.equal(cookie.url, "http://example.com/");
  assert.equal(cookie.path, "/");
  assert.equal(cookie.expirationDate, 100);
});

test("a bad cookie line is reported and the rest of the file survives", () => {
  const text = [
    "# Netscape HTTP Cookie File",
    "good.test\tFALSE\t/\tFALSE\t1893456000\tkeep\tme",
    "broken.test FALSE / FALSE 1893456000 spaces not-tabs",
    "shifted.test\tFALSE\t/\tFALSE\tnever\tname\tvalue",
    "\tFALSE\t/\tFALSE\t0\tnohost\tvalue",
    "also-good.test\tFALSE\t/\tFALSE\t0\talso\tkept",
  ].join("\n");

  const { cookies, problems } = parseCookiesTxt(text);

  assert.deepEqual(
    cookies.map((cookie) => cookie.name),
    ["keep", "also"],
  );
  assert.deepEqual(problems, [
    "line 3: 1 tab-separated fields, expected 7",
    'line 4: "never" is not an expiry in seconds',
    "line 5: a cookie needs a domain and a name",
  ]);
});

test("a cookies.txt holding nothing but its banner", () => {
  const result = parseCookiesTxt("# Netscape HTTP Cookie File\n\n# nothing here\n");

  assert.deepEqual(result, { cookies: [], logins: [], visits: [], problems: ["the file lists no cookies"] });
});

test("importFromFile reads what is in the file, not what the name claims", async () => {
  const folder = directory();
  try {
    // A cookies.txt saved as .csv, and a password export saved as .txt.
    const cookies = file(
      folder,
      "export.csv",
      "# Netscape HTTP Cookie File\n#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1893456000\tsid\tv\n",
    );
    const logins = file(
      folder,
      "passwords.txt",
      "name,url,username,password,note\nExample,https://example.com,ada,secret,\n",
    );

    const fromCookies = await importFromFile(cookies);
    assert.deepEqual(fromCookies.logins, []);
    assert.equal(fromCookies.cookies.length, 1);
    assert.equal(fromCookies.cookies[0].httpOnly, true);

    const fromLogins = await importFromFile(logins);
    assert.deepEqual(fromLogins.cookies, []);
    assert.deepEqual(fromLogins.logins, [
      { origin: "https://example.com", username: "ada", password: "secret" },
    ]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("importFromFile recognises a cookies.txt whose banner was stripped", async () => {
  const folder = directory();
  try {
    const at = file(folder, "cookies", "example.com\tFALSE\t/\tFALSE\t0\tsid\tvalue\n");

    const result = await importFromFile(at);

    assert.deepEqual(result.problems, []);
    assert.equal(result.cookies[0]?.name, "sid");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("importFromFile decodes a UTF-16 export, which is what a spreadsheet writes", async () => {
  const folder = directory();
  try {
    const csv = "name,url,username,password,note\nExample,https://example.com,ada,secret,\n";
    const at = file(folder, "utf16.csv", Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(csv, "utf16le"),
    ]));

    const result = await importFromFile(at);

    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.logins, [
      { origin: "https://example.com", username: "ada", password: "secret" },
    ]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("an empty file, a garbage file and a missing file each say why", async () => {
  const folder = directory();
  try {
    const empty = await importFromFile(file(folder, "empty.csv", ""));
    assert.deepEqual(
      { cookies: empty.cookies, logins: empty.logins },
      { cookies: EMPTY_IMPORT.cookies, logins: EMPTY_IMPORT.logins },
    );
    assert.equal(empty.problems.length, 1);
    assert.match(empty.problems[0], /^empty\.csv is not a password export or a cookies\.txt$/);

    const garbage = await importFromFile(file(folder, "notes.txt", "just some words\nand more\n"));
    assert.deepEqual({ cookies: garbage.cookies, logins: garbage.logins }, { cookies: [], logins: [] });
    assert.match(garbage.problems[0], /^notes\.txt is not a password export or a cookies\.txt$/);

    const missing = await importFromFile(path.join(folder, "absent.csv"));
    assert.deepEqual({ cookies: missing.cookies, logins: missing.logins }, { cookies: [], logins: [] });
    assert.equal(missing.problems.length, 1);
    assert.match(missing.problems[0], /^absent\.csv could not be read: /);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("nothing returned shares the contract's own empty arrays", async () => {
  // A caller applying an import mutates what it is handed; a decoder that
  // returned EMPTY_IMPORT itself would poison every later import.
  const result = parsePasswordCsv("");
  result.problems.push("mutated");
  result.cookies.push({ url: "https://x.test/", name: "n", value: "v" });

  assert.deepEqual(EMPTY_IMPORT, { cookies: [], logins: [], visits: [], problems: [] });
});
