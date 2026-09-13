import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {EmailSecrets} from "../../hub/src/email-secrets.js";
import {
  createKeychainShimRun,
  HeadlessCredentialStore,
  splitSecurityLine,
} from "../src/credentials.js";

test("security lines split like the shell would", () => {
  assert.deepEqual(
    splitSecurityLine("find-generic-password -s 'Polymux Email: x' -a 'user (password)' -w"),
    ["find-generic-password", "-s", "Polymux Email: x", "-a", "user (password)", "-w"],
  );
  assert.deepEqual(
    splitSecurityLine("add-generic-password -U -s 'a'\\''b' -a 'x' -w 'p'"),
    ["add-generic-password", "-U", "-s", "a'b", "-a", "x", "-w", "p"],
  );
  assert.deepEqual(splitSecurityLine("  "), []);
  assert.deepEqual(splitSecurityLine("-w '' -a 'x'"), ["-w", "", "-a", "x"]);
});

test("headless credential store round-trips and quarantines on secret change", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-headless-creds-"));
  try {
    const file = path.join(directory, "credentials.json");
    const store = new HeadlessCredentialStore(file, "admin-secret");
    assert.equal(await store.read("hub"), undefined);
    await store.modify("hub", async () => ({type: "api_key", key: "token-123"}));
    assert.deepEqual(await store.read("hub"), {type: "api_key", key: "token-123"});
    assert.deepEqual(await store.list(), [{providerId: "hub", type: "api_key"}]);
    await store.delete("hub");
    assert.equal(await store.read("hub"), undefined);
    await store.modify("hub", async () => ({type: "api_key", key: "token-123"}));
    const rotated = new HeadlessCredentialStore(file, "other-secret");
    assert.equal(await rotated.read("hub"), undefined);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("keychain shim stores and clears mailbox secrets", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-headless-shim-"));
  try {
    const run = createKeychainShimRun(path.join(directory, "email-secrets.json"), "admin-secret");
    const missing = await run("security", ["-i"], "find-generic-password -s 'svc' -a 'acct' -w\n");
    assert.notEqual(missing.code, 0);
    assert.equal(await run("security", ["-i"], "add-generic-password -U -s 'svc' -a 'acct' -w 's3cret'\n").then((result) => result.code), 0);
    const found = await run("security", ["-i"], "find-generic-password -s 'svc' -a 'acct' -w\n");
    assert.equal(found.code, 0);
    assert.equal(found.stdout, "s3cret\n");
    assert.equal(await run("security", ["-i"], "delete-generic-password -s 'svc' -a 'acct'\n").then((result) => result.code), 0);
    assert.notEqual((await run("security", ["-i"], "find-generic-password -s 'svc' -a 'acct' -w\n")).code, 0);
    const passthrough = await run(process.execPath, ["--version"]);
    assert.equal(passthrough.code, 0);
    assert.match(passthrough.stdout, /v\d+\./);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("EmailSecrets preserves unusual logins and passwords through concurrent writes and reload", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-headless-mail-logins-"));
  try {
    const file = path.join(directory, "email-secrets.json");
    const secrets = new EmailSecrets(createKeychainShimRun(file, "admin-secret"));
    const logins = ["-s", "-a", "-w", "-U", "__proto__", "constructor", "toString", "a'b \\ c"];
    for (const login of logins) {
      assert.equal(await secrets.read("mailbox", login, "password"), null, login);
    }
    await Promise.all(logins.map((login, index) =>
      secrets.write("mailbox", login, "password", `secret ${index} ' \\ -w\nnext line`),
    ));

    const reloaded = new EmailSecrets(createKeychainShimRun(file, "admin-secret"));
    for (const [index, login] of logins.entries()) {
      assert.equal(await reloaded.read("mailbox", login, "password"), `secret ${index} ' \\ -w\nnext line`, login);
      await reloaded.remove("mailbox", login, "password");
      assert.equal(await reloaded.read("mailbox", login, "password"), null, login);
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("keychain shim preserves empty values and rejects incomplete options", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-headless-mail-options-"));
  try {
    const run = createKeychainShimRun(path.join(directory, "email-secrets.json"), "admin-secret");
    const secrets = new EmailSecrets(run);
    // EmailSecrets maps an empty stored password to null, but writing one must
    // still preserve its token rather than report a missing -w argument.
    await secrets.write("mailbox", "login", "password", "");
    const found = await run("security", ["-i"], "find-generic-password -s 'Polymux Email: mailbox' -a login -w\n");
    assert.equal(found.code, 0);
    assert.equal(found.stdout, "\n");
    const incomplete = await run("security", ["-i"], "add-generic-password -s svc -a login -w\n");
    assert.notEqual(incomplete.code, 0);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
