import assert from "node:assert/strict";
import test from "node:test";
import {SqliteStorage} from "@polymux/storage";
import {HubCache} from "./cache.js";
import type {ChatDto, ChatMessageDto, CommsStatusDto, MailEnvelopeDto, MailFolderDto, MailMessageDto} from "@polymux/protocol";

function fixture() {
  const storage = new SqliteStorage(":memory:");
  return {storage, cache: new HubCache(storage)};
}

const folders = [{name: "INBOX", label: "Inbox", role: "inbox"}] as MailFolderDto[];
const envelope = {id: "1", subject: "Hello"} as MailEnvelopeDto;
const body = {id: "1", subject: "Hello", body: "Hi there"} as MailMessageDto;

test("obsolete WeChat call pages are discarded once and replaced by structured history", () => {
  const {cache, storage} = fixture();
  cache.putChats([{id:"!wechat",platform:"wechat"},{id:"!matrix",platform:"matrix"}] as ChatDto[]);
  const old = {id:"call",body:"[Call]"} as ChatMessageDto;
  cache.putChatPage("!wechat",[old],null);
  cache.putChatPage("!matrix",[old],null);
  assert.deepEqual(cache.snapshot().messages.map(page=>page.chatId),["!matrix"]);
  assert.equal(storage.readCommsCache("hub:chat:!wechat"),null);
  const refreshed: ChatMessageDto = {...old,call:{kind:"voice",status:"ended",durationSeconds:1135}};
  cache.putChatPage("!wechat",[refreshed],null);
  assert.equal(cache.snapshot().messages.find(page=>page.chatId==="!wechat")?.messages[0].call?.durationSeconds,1135);
});

test("the snapshot hands back what passed through, and is empty before anything has", () => {
  const {cache} = fixture();
  assert.deepEqual(cache.snapshot(), {status: null, chats: [], mailboxes: [], mail: [], messages: []});

  cache.putStatus({hub: {baseUrl: "http://local"}} as unknown as CommsStatusDto);
  cache.putChats([{id: "!room", name: "Ana"} as ChatDto]);
  cache.putMailbox("work", "INBOX", folders, [envelope]);
  cache.putMail("work", "INBOX", body);
  cache.putChatPage("!room", [], "t1");

  const snapshot = cache.snapshot();
  assert.equal(snapshot.chats[0]!.name, "Ana");
  assert.deepEqual(snapshot.mailboxes[0]!.envelopes, [envelope]);
  assert.equal(snapshot.mail[0]!.message.body, "Hi there");
  assert.deepEqual(snapshot.messages[0], {chatId: "!room", messages: [], nextBefore: "t1"});
});

test("signing out leaves nothing of the mailbox behind", () => {
  const {cache} = fixture();
  cache.putMailbox("work", "INBOX", folders, [envelope]);
  cache.putMail("work", "INBOX", body);
  cache.clear();
  assert.deepEqual(cache.snapshot(), {status: null, chats: [], mailboxes: [], mail: [], messages: []});
});

test("a row that will not parse is skipped rather than taking the snapshot with it", () => {
  const {storage, cache} = fixture();
  storage.writeCommsCache("hub:body:work|INBOX|old", "{not json");
  cache.putMail("work", "INBOX", body);
  assert.equal(cache.snapshot().mail.length, 1);
});

test("a store that throws costs a spinner, not the request that was already answered", () => {
  const broken = new HubCache({
    readCommsCache() { throw new Error("no disk"); },
    listCommsCache() { throw new Error("no disk"); },
    writeCommsCache() { throw new Error("no disk"); },
    deleteCommsCache() { throw new Error("no disk"); },
    trimCommsCache() { throw new Error("no disk"); },
  });
  assert.doesNotThrow(() => broken.putChats([]));
  assert.doesNotThrow(() => broken.clear());
  assert.deepEqual(broken.snapshot(), {status: null, chats: [], mailboxes: [], mail: [], messages: []});
});

test("a body too large to be worth carrying is not kept at all", () => {
  const {cache} = fixture();
  cache.putMail("work", "INBOX", {...body, html: "x".repeat(600 * 1024)} as MailMessageDto);
  assert.equal(cache.snapshot().mail.length, 0);
  cache.putMail("work", "INBOX", body);
  assert.equal(cache.snapshot().mail.length, 1);
});
