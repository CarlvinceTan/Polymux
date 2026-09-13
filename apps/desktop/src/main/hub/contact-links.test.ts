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
  const ids = ["pranav", "pranav-v2"];
  const links = new ContactLinks(store, {
    now: () => new Date("2026-08-28T08:00:00.000Z"),
    id: () => ids.shift() ?? "unexpected",
  });
  const created = links.merge({
    name: "Pranav",
    members: [member("whatsapp", "61400"), member("telegram", "42")],
  });
  assert.equal(created.id, "contact-pranav");

  const reopened = new ContactLinks(store, {
    now: () => new Date("2026-08-28T08:01:00.000Z"),
    id: () => ids.shift() ?? "unexpected",
  });
  const extended = reopened.merge({
    name: "Pranav",
    members: [
      {...member("telegram", "42"), chatId: "!replacement:local"},
      member("signal", "signal-42"),
    ],
  });
  assert.equal(extended.id, "contact-pranav-v2");
  assert.notEqual(extended.id, created.id);
  assert.equal(extended.members.length, 3);
  assert.equal(extended.members.find((item) => item.platform === "telegram")?.chatId, "!replacement:local");
  reopened.remove(created.id);
  assert.equal(reopened.list().length, 1, "a stale view cannot remove the extended identity");
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

test("a renamed single contact persists and follows its remote identity", () => {
  const store = new Preferences();
  const ids = ["renamed", "renamed-v2"];
  const links = new ContactLinks(store, {
    now: () => new Date("2026-08-31T08:00:00.000Z"),
    id: () => ids.shift() ?? "unexpected",
  });
  const renamed = links.rename({
    name: "  小朱 🫶  ",
    member: member("whatsapp", "61400"),
  });
  assert.equal(renamed.name, "小朱 🫶");
  assert.equal(renamed.members.length, 1);

  const reopened = new ContactLinks(store, {
    now: () => new Date("2026-08-31T08:01:00.000Z"),
    id: () => ids.shift() ?? "unexpected",
  });
  const revised = reopened.rename({
    name: "Best friend",
    member: {...member("whatsapp", "61400"), chatId: "!replacement:local"},
  });
  assert.equal(revised.id, "contact-renamed-v2");
  assert.equal(revised.members[0]?.chatId, "!replacement:local");
  reopened.remove(renamed.id);
  assert.equal(reopened.list()[0]?.name, "Best friend", "a stale rename revision cannot clear the current name");
});

test("renaming one linked route preserves the whole cross-platform identity", () => {
  const links = new ContactLinks(new Preferences(), {
    now: () => new Date("2026-08-31T08:00:00.000Z"),
    id: (() => {
      const ids = ["linked", "renamed"];
      return () => ids.shift() ?? "unexpected";
    })(),
  });
  links.merge({
    name: "Pranav",
    members: [member("whatsapp", "61400"), member("telegram", "42")],
  });
  const renamed = links.rename({
    name: "Uni friend",
    member: member("telegram", "42"),
  });
  assert.equal(renamed.name, "Uni friend");
  assert.deepEqual(renamed.members.map((item) => item.platform), ["whatsapp", "telegram"]);
});

test("contact names must be non-empty and at most 80 characters", () => {
  const links = new ContactLinks(new Preferences());
  assert.throws(
    () => links.rename({name: "   ", member: member("telegram", "1")}),
    /Enter a contact name/,
  );
  assert.throws(
    () => links.rename({name: "x".repeat(81), member: member("telegram", "1")}),
    /at most 80 characters/,
  );
});
