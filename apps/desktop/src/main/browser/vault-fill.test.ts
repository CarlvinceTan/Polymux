import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAutofillOffer,
  encodeAutofillItem,
  parseAutofillItem,
} from "./vault-fill.js";

test("autofill item ids round-trip without colliding sources", () => {
  const vault = encodeAutofillItem("vault", "abc");
  const browser = encodeAutofillItem("browser", "abc");
  assert.notEqual(vault, browser);
  assert.deepEqual(parseAutofillItem(vault), { source: "vault", id: "abc" });
  assert.deepEqual(parseAutofillItem(browser), { source: "browser", id: "abc" });
  assert.equal(parseAutofillItem("nope"), null);
});

test("a locked vault is offered without item titles", () => {
  const offer = buildAutofillOffer({
    tabId: "tab-1",
    page: { origin: "https://github.com", forms: 1, otp: 0, focus: "login" },
    vault: "locked",
    vaultItems: [
      {
        id: "secret",
        title: "GitHub",
        username: "ada",
        url: "https://github.com",
        notes: "",
        groupId: "g",
        groupName: "Vault",
        hasPassword: true,
        hasTotp: false,
        hasRecoveryCodes: false,
        hasPasskey: false,
        updatedAt: null,
      },
    ],
    browserLogins: [],
  });
  assert.ok(offer);
  assert.equal(offer.vault, "locked");
  assert.equal(offer.items.length, 0);
  assert.equal(JSON.stringify(offer).includes("ada"), false);
});

test("an unlocked vault offers matching passwords and totp, not empty vaults", () => {
  const offer = buildAutofillOffer({
    tabId: "tab-1",
    page: { origin: "https://github.com", forms: 1, otp: 1, focus: "otp" },
    vault: "unlocked",
    vaultItems: [
      {
        id: "one",
        title: "GitHub",
        username: "ada",
        url: "https://github.com",
        notes: "",
        groupId: "g",
        groupName: "Vault",
        hasPassword: true,
        hasTotp: true,
        hasRecoveryCodes: false,
        hasPasskey: false,
        updatedAt: null,
      },
    ],
    browserLogins: [],
  });
  assert.ok(offer);
  assert.equal(offer.items[0]?.hasTotp, true);
  assert.equal(offer.items[0]?.username, "ada");
  assert.equal("password" in offer.items[0]!, false);
});

test("no bar when the page has no form and the vault is unlocked empty", () => {
  assert.equal(
    buildAutofillOffer({
      tabId: "tab-1",
      page: { origin: "https://github.com", forms: 0, otp: 0, focus: null },
      vault: "unlocked",
      vaultItems: [],
      browserLogins: [],
    }),
    null,
  );
});
