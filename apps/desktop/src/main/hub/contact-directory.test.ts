import assert from "node:assert/strict";
import test from "node:test";
import type {CommsContactDto} from "@polymux/protocol";
import {dedupeCommsContacts} from "./index.js";

function contact(
  id: string,
  accountId: string,
  options: {remoteId?: string; chatId?: string; identifiers?: string[]} = {},
): CommsContactDto {
  const accountName = `Account ${accountId}`;
  const remoteId = options.remoteId ?? null;
  const chatId = options.chatId ?? null;
  return {
    id,
    remoteId,
    name: "Cindy",
    platform: "whatsapp",
    accountId,
    accountName,
    avatarUrl: "polymux-media://local/cindy",
    identifiers: options.identifiers ?? [],
    chatId,
    accounts: [{accountId, accountName, remoteId, chatId}],
  };
}

test("one remote contact shared by two accounts stays one selectable person", () => {
  const rows = dedupeCommsContacts([
    contact("one", "personal", {remoteId: "61400@s.whatsapp.net", chatId: "!one:local"}),
    contact("two", "work", {remoteId: "61400@s.whatsapp.net", chatId: "!two:local"}),
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.accounts.map((account) => account.accountId), ["personal", "work"]);
  assert.deepEqual(rows[0]?.accounts.map((account) => account.chatId), ["!one:local", "!two:local"]);
});

test("formatted platform identifiers merge phone-JID and LID entries", () => {
  const rows = dedupeCommsContacts([
    contact("phone", "personal", {
      remoteId: "61400@s.whatsapp.net",
      identifiers: ["tel:+61 400 111 222"],
    }),
    contact("lid", "personal", {
      remoteId: "12345@lid",
      identifiers: ["tel:+61400111222"],
    }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.accounts.length, 1);
});

test("a matching display name without shared identity remains distinct", () => {
  const rows = dedupeCommsContacts([
    contact("one", "personal", {remoteId: "one@lid"}),
    contact("two", "personal", {remoteId: "two@lid"}),
  ]);
  assert.equal(rows.length, 2);
});

test("all trailing WhatsApp bridge suffixes are removed from contact names", () => {
  const rows = dedupeCommsContacts([
    {...contact("one", "personal", {remoteId: "one@lid"}), name: "Cindy (WA)"},
    {...contact("two", "personal", {remoteId: "two@lid"}), name: "+61400111222 (WA) (WA)"},
  ]);
  assert.deepEqual(rows.map((row) => row.name), ["Cindy", "+61400111222"]);
});
