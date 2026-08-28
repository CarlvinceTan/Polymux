import assert from "node:assert/strict";
import test from "node:test";
import type {BroadcastRecipientDto, JsonValue} from "@polymux/protocol";
import {Broadcasts, type BroadcastPreferenceStore} from "./broadcasts.js";

class Preferences implements BroadcastPreferenceStore {
  value: JsonValue | undefined;
  getPreference(): {value: JsonValue} | null {
    return this.value === undefined ? null : {value: this.value};
  }
  setPreference(_key: string, value: JsonValue): void {
    this.value = structuredClone(value);
  }
}

const recipient = (
  id: string,
  platform: "whatsapp" | "telegram",
  chatId: string | null,
): BroadcastRecipientDto => ({
  id,
  name: id === "amy" ? "Amy" : "Ben",
  platform,
  accountId: `${platform}-account`,
  accountName: `${platform} account`,
  remoteId: `remote-${id}`,
  chatId,
  avatarUrl: null,
});

test("broadcasts persist cross-platform recipients and deliver through separate direct chats", async () => {
  const preferences = new Preferences();
  const opened: string[] = [];
  const sent: Array<[string, string]> = [];
  let id = 0;
  const broadcasts = new Broadcasts(
    preferences,
    {
      openDirect: async (target) => {
        opened.push(target.id);
        return `room-${target.id}`;
      },
      send: async (chatId, body) => void sent.push([chatId, body]),
    },
    {now: () => new Date("2026-08-28T10:00:00.000Z"), id: () => String(++id)},
  );

  const created = broadcasts.create({
    name: "Launch update",
    recipients: [recipient("amy", "whatsapp", "room-amy"), recipient("ben", "telegram", null)],
  });
  const result = await broadcasts.send(created.id, "We ship tomorrow");

  assert.deepEqual(opened, ["ben"]);
  assert.deepEqual(sent, [
    ["room-amy", "We ship tomorrow"],
    ["room-ben", "We ship tomorrow"],
  ]);
  assert.deepEqual(result.message.deliveries.map((item) => item.status), ["sent", "sent"]);
  assert.equal(result.broadcast.recipients[1]?.chatId, "room-ben");

  const reopened = new Broadcasts(preferences, {
    openDirect: async () => "unused",
    send: async () => {},
  });
  assert.equal(reopened.list()[0]?.preview, "We ship tomorrow");
  assert.equal(reopened.messages(created.id)[0]?.body, "We ship tomorrow");
});

test("one failed recipient does not cancel successful private deliveries", async () => {
  const broadcasts = new Broadcasts(
    new Preferences(),
    {
      openDirect: async (target) => `room-${target.id}`,
      send: async (chatId) => {
        if (chatId === "room-ben") throw new Error("Telegram is offline");
      },
    },
    {id: (() => { let id = 0; return () => String(++id); })()},
  );
  const created = broadcasts.create({
    name: "Class update",
    recipients: [recipient("amy", "whatsapp", null), recipient("ben", "telegram", null)],
  });

  const result = await broadcasts.send(created.id, "Room changed");

  assert.deepEqual(result.message.deliveries.map((item) => item.status), ["sent", "failed"]);
  assert.equal(result.message.deliveries[1]?.error, "Telegram is offline");
  assert.equal(broadcasts.messages(created.id).length, 1);
});
