import assert from "node:assert/strict";
import { test } from "node:test";
import type { WebContents } from "electron";
import { Autofill, autofillMessage, type LoginRecords, type LoginVault } from "./autofill.js";

function records(): LoginRecords & { rows: Map<string, any> } {
  const rows = new Map<string, any>();
  return {
    rows,
    listSavedLogins(origin?: string) {
      return [...rows.values()].filter((row) => origin === undefined || row.origin === origin);
    },
    upsertSavedLogin(input) {
      // Mirrors the real table's UNIQUE(origin, username): an account that
      // already exists keeps its id.
      const existing = [...rows.values()].find(
        (row) => row.origin === input.origin && row.username === input.username,
      );
      if (existing) return { id: existing.id };
      rows.set(input.id, {
        ...input,
        source: input.source ?? "manual",
        createdAt: "2026-08-17T00:00:00.000Z",
        updatedAt: "2026-08-17T00:00:00.000Z",
        lastUsedAt: null,
      });
      return { id: input.id };
    },
    touchSavedLogin(id) {
      const row = rows.get(id);
      if (row) row.lastUsedAt = "2026-08-17T01:00:00.000Z";
      return row ?? null;
    },
    deleteSavedLogin(id) {
      return rows.delete(id);
    },
    getSavedLogin(id) {
      return rows.get(id) ?? null;
    },
  };
}

function vault(): LoginVault & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async read(id) {
      return store.get(id) ?? null;
    },
    async write(id, password) {
      store.set(id, password);
    },
    async delete(id) {
      store.delete(id);
    },
    async clear() {
      store.clear();
    },
  };
}

function harness(enabled = true) {
  const store = records();
  const secrets = vault();
  const sent: any[] = [];
  const contents = {
    send: (_channel: string, payload: unknown) => sent.push(payload),
  } as unknown as WebContents;
  let changes = 0;
  const autofill = new Autofill({
    records: store,
    vault: secrets,
    enabled: () => enabled,
    changed: () => {
      changes += 1;
    },
  });
  return { autofill, store, secrets, sent, contents, changes: () => changes };
}

test("a message from a page is checked, not trusted", () => {
  assert.equal(autofillMessage({ kind: "page", origin: "https://a.example", forms: 1 })?.kind, "page");
  // No origin, an opaque origin, a missing password, or an unknown kind are
  // all refused: this arrives from a web page.
  assert.equal(autofillMessage({ kind: "page", forms: 1 }), null);
  assert.equal(autofillMessage({ kind: "page", origin: "null", forms: 1 }), null);
  assert.equal(autofillMessage({ kind: "submitted", origin: "https://a.example", username: "me" }), null);
  assert.equal(
    autofillMessage({ kind: "submitted", origin: "https://a.example", username: "me", password: "" }),
    null,
  );
  assert.equal(autofillMessage({ kind: "whatever", origin: "https://a.example" }), null);
  assert.equal(autofillMessage("not an object"), null);
  assert.equal(autofillMessage(null), null);
});

test("saving a login keeps the password out of the listing", async () => {
  const app = harness();
  await app.autofill.save("https://shop.example", "me@example.com", "hunter2");
  const listed = app.autofill.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.username, "me@example.com");
  assert.equal("password" in listed[0]!, false, "a listed login carries no secret");
  // The secret is reachable only by asking for it explicitly.
  assert.equal(await app.autofill.reveal(listed[0]!.id), "hunter2");
});

test("re-saving an account replaces its password under the same id", async () => {
  const app = harness();
  await app.autofill.save("https://shop.example", "me@example.com", "first");
  const id = app.autofill.list()[0]!.id;
  await app.autofill.save("https://shop.example", "me@example.com", "second");
  assert.equal(app.autofill.list().length, 1, "not a second row");
  assert.equal(await app.autofill.reveal(id), "second");
  assert.equal(app.secrets.store.size, 1, "and no stranded secret left behind");
});

test("filling hands the page one credential and nothing else", async () => {
  const app = harness();
  await app.autofill.save("https://shop.example", "me@example.com", "hunter2");
  await app.autofill.save("https://shop.example", "other@example.com", "different");
  const [first] = app.autofill.list();

  assert.equal(await app.autofill.fill(app.contents, first!.id), true);
  assert.equal(app.sent.length, 1);
  assert.equal(app.sent[0].password, "hunter2");
  // The page is not told that a second account exists for the site.
  assert.equal(JSON.stringify(app.sent[0]).includes("different"), false);
  assert.equal(JSON.stringify(app.sent[0]).includes("other@example.com"), false);
  // Using a login stamps it, so the picker can lead with it next time.
  assert.ok(app.store.rows.get(first!.id).lastUsedAt);
});

test("nothing is filled when autofill is switched off", async () => {
  const app = harness(false);
  const on = harness();
  await on.autofill.save("https://shop.example", "me@example.com", "hunter2");
  // Save through the disabled instance too, then prove it refuses to fill.
  await app.autofill.save("https://shop.example", "me@example.com", "hunter2");
  assert.equal(await app.autofill.fill(app.contents, app.autofill.list()[0]!.id), false);
  assert.equal(app.sent.length, 0);
});

test("filling an id that is not there fails rather than throwing", async () => {
  const app = harness();
  assert.equal(await app.autofill.fill(app.contents, "no-such-login"), false);
  assert.equal(app.sent.length, 0);
});

test("an unchanged password on sign-in is not re-saved", async () => {
  const app = harness();
  await app.autofill.save("https://shop.example", "me@example.com", "hunter2");
  // Signing in again with the same password must not ask the user anything.
  assert.equal(
    await app.autofill.captureSubmission({
      origin: "https://shop.example",
      username: "me@example.com",
      password: "hunter2",
    }),
    "unchanged",
  );
  // A changed one is saved over the old.
  assert.equal(
    await app.autofill.captureSubmission({
      origin: "https://shop.example",
      username: "me@example.com",
      password: "rotated",
    }),
    "saved",
  );
  assert.equal(await app.autofill.reveal(app.autofill.list()[0]!.id), "rotated");
  assert.equal(app.autofill.list().length, 1);
});

test("deleting a login takes its password with it", async () => {
  const app = harness();
  await app.autofill.save("https://shop.example", "me@example.com", "hunter2");
  const id = app.autofill.list()[0]!.id;
  await app.autofill.delete(id);
  assert.equal(app.autofill.list().length, 0);
  assert.equal(app.secrets.store.size, 0, "the secret does not outlive the row");
});

test("clearing removes every login and every secret", async () => {
  const app = harness();
  await app.autofill.save("https://a.example", "me", "one");
  await app.autofill.save("https://b.example", "me", "two");
  await app.autofill.clear();
  assert.equal(app.autofill.list().length, 0);
  assert.equal(app.secrets.store.size, 0);
});

test("logins are scoped to the site that asked", async () => {
  const app = harness();
  await app.autofill.save("https://a.example", "me", "one");
  await app.autofill.save("https://b.example", "me", "two");
  assert.equal(app.autofill.forOrigin("https://a.example").length, 1);
  assert.equal(app.autofill.forOrigin("https://a.example")[0]!.origin, "https://a.example");
  assert.equal(app.autofill.forOrigin("https://nowhere.example").length, 0);
});
