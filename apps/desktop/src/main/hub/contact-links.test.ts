import assert from "node:assert/strict";
import test from "node:test";
import type {ContactLinkMemberDto, JsonValue} from "@polymux/protocol";
import {ContactLinks, type ContactLinkPreferenceStore} from "./contact-links.js";

class Preferences implements ContactLinkPreferenceStore {
  value: JsonValue | undefined;
  getPreference(): {value: JsonValue} | null {
    return this.value === undefined ? null : {value: this.value};
  }
  setPreference(_key: string, value: JsonValue): void {
    this.value = structuredClone(value);
  }
}

function member(platform: "whatsapp" | "telegram" | "signal", id: string): ContactLinkMemberDto {
  return {platform, remoteId: id, chatId: `!${platform}-${id}:local`};
}

test("cross-platform contact links persist and survive a replaced portal room", () => {
  const store = new Preferences();
  const links = new ContactLinks(store, {
    now: () => new Date("2026-08-28T08:00:00.000Z"),
    id: () => "pranav",
  });
  const created = links.merge({
    name: "Pranav",
    members: [member("whatsapp", "61400"), member("telegram", "42")],
  });
  assert.equal(created.id, "contact-pranav");

  const reopened = new ContactLinks(store);
  const extended = reopened.merge({
    name: "Pranav",
    members: [
      {...member("telegram", "42"), chatId: "!replacement:local"},
      member("signal", "signal-42"),
    ],
  });
  assert.equal(extended.id, created.id);
  assert.equal(extended.members.length, 3);
  assert.equal(extended.members.find((item) => item.platform === "telegram")?.chatId, "!replacement:local");
});

test("a contact link requires distinct platforms", () => {
  const links = new ContactLinks(new Preferences());
  assert.throws(
    () => links.merge({name: "One service", members: [member("telegram", "1"), member("telegram", "2")]}),
    /at least two platforms/,
  );
});

test("removing a contact link separates its routes", () => {
  const links = new ContactLinks(new Preferences(), {id: () => "one"});
  const created = links.merge({
    name: "Pranav",
    members: [member("whatsapp", "61400"), member("telegram", "42")],
  });
  links.remove(created.id);
  assert.deepEqual(links.list(), []);
});
