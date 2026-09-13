import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePasswordCsv } from "../src/csv.js";

test("Chrome CSV maps name, url, username, password and note", () => {
  const csv = `name,url,username,password,note
GitHub,https://github.com,ada,se cret,work
`;
  const parsed = parsePasswordCsv(csv);
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.logins.length, 1);
  assert.deepEqual(parsed.logins[0], {
    title: "GitHub",
    username: "ada",
    password: "se cret",
    url: "https://github.com",
    notes: "work",
    totp: "",
    group: "",
  });
});

test("Bitwarden CSV keeps TOTP and folder", () => {
  const csv = `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
Work,0,login,GitHub,,,0,https://github.com,ada,secret,otpauth://totp/GitHub:ada?secret=JBSWY3DPEHPK3PXP
`;
  const parsed = parsePasswordCsv(csv);
  assert.equal(parsed.logins[0]?.group, "Work");
  assert.match(parsed.logins[0]?.totp ?? "", /otpauth:\/\//);
  assert.equal(parsed.logins[0]?.password, "secret");
});

test("quoted commas inside a password stay in the password", () => {
  const csv = `name,url,username,password
Mail,https://mail.example,ada,"a,b""c"
`;
  const parsed = parsePasswordCsv(csv);
  assert.equal(parsed.logins[0]?.password, 'a,b"c');
});

test("an unknown header is reported instead of guessed", () => {
  const parsed = parsePasswordCsv("foo,bar\n1,2\n");
  assert.equal(parsed.logins.length, 0);
  assert.match(parsed.problems[0] ?? "", /not a password export/);
});
