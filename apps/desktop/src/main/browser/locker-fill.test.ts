import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAutofillOffer,
  encodeAutofillItem,
  parseAutofillItem,
} from "./locker-fill.js";

test("autofill item ids round-trip without colliding sources", () => {
  const locker = encodeAutofillItem("locker", "abc");
  const browser = encodeAutofillItem("browser", "abc");
  assert.notEqual(locker, browser);
  assert.deepEqual(parseAutofillItem(locker), { source: "locker", id: "abc" });
  assert.deepEqual(parseAutofillItem(browser), { source: "browser", id: "abc" });
  assert.equal(parseAutofillItem("nope"), null);
});

test("a locked locker is offered without item titles", () => {
  const offer = buildAutofillOffer({
    tabId: "tab-1",
    page: { origin: "https://github.com", forms: 1, otp: 0, focus: "login" },
    locker: "locked",
    lockerItems: [
      {
        id: "secret",
        title: "GitHub",
        username: "ada",
        url: "https://github.com",
        notes: "",
        groupId: "g",
        groupName: "Locker",
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
  assert.equal(offer.locker, "locked");
  assert.equal(offer.items.length, 0);
  assert.equal(JSON.stringify(offer).includes("ada"), false);
});

test("an unlocked locker offers matching passwords and totp, not empty vaults", () => {
  const offer = buildAutofillOffer({
    tabId: "tab-1",
    page: { origin: "https://github.com", forms: 1, otp: 1, focus: "otp" },
    locker: "unlocked",
    lockerItems: [
      {
        id: "one",
        title: "GitHub",
        username: "ada",
        url: "https://github.com",
        notes: "",
        groupId: "g",
        groupName: "Locker",
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

test("no bar when the page has no form and the locker is unlocked empty", () => {
  assert.equal(
    buildAutofillOffer({
      tabId: "tab-1",
      page: { origin: "https://github.com", forms: 0, otp: 0, focus: null },
      locker: "unlocked",
      lockerItems: [],
      browserLogins: [],
    }),
    null,
  );
});
