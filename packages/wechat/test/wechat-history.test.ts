import assert from "node:assert/strict";
import test from "node:test";
import {parseWeChatJson, weChatAppMessageType, weChatAttachmentReply, weChatConversationList, weChatHistoryPage} from "../src/wechat-history.js";

test("app message types come only from one outer scalar field", () => {
  assert.equal(weChatAppMessageType('<msg><appmsg><type><![CDATA[6]]></type></appmsg></msg>'), '6');
  assert.equal(weChatAppMessageType('<appmsg><type>19</type><recorditem><appmsg><type>6</type></appmsg></recorditem></appmsg>'), '19');
  for (const xml of [
    '<msg><appmsg><refermsg><type>6</type></refermsg></appmsg></msg>',
    '<msg><appmsg><type>6</type><type>5</type></appmsg></msg>',
    '<msg><appmsg><type>6</type></appmsg><appmsg><type>5</type></appmsg></msg>',
    '<msg><appmsg><type><nested>6</nested></type></appmsg></msg>',
    '<!DOCTYPE msg><msg><appmsg><type>6</type></appmsg></msg>',
    '<msg><appmsg><type>6</type>', 'not XML',
  ]) assert.equal(weChatAppMessageType(xml), null);
});

test("the conversation directory grows past a full relay page without losing older chats", async () => {
  const chats = Array.from({length: 2_105}, (_, id) => ({id}));
  const limits: number[] = [];
  const result = await weChatConversationList(async (limit) => {
    limits.push(limit);
    return chats.slice(0, limit);
  });
  assert.deepEqual(result, chats);
  assert.deepEqual(limits, [1_000, 2_000, 4_000]);
});

test("an unavailable or oversized directory never succeeds with an incomplete chat list", async () => {
  await assert.rejects(weChatConversationList(async () => {throw new Error("disconnected");}), /disconnected/);
  await assert.rejects(weChatConversationList(async () => null as unknown as []), /conversation list/);
  await assert.rejects(weChatConversationList(async (limit) => Array.from({length: limit}, (_, id) => id)), /too large/);
});

test("Desktop attachment replies retain an exact 64-bit target from the outer media envelope", () => {
  const quote = '<extcommoninfo><refermsg><createtime>1788618540</createtime><svrid>1076601126396071190</svrid></refermsg></extcommoninfo>';
  assert.deepEqual(weChatAttachmentReply(`<msg><img aeskey="private"/>${quote}</msg>`), {svrId: "1076601126396071190"});
  for (const xml of [
    `<msg><appmsg><recorditem><msg>${quote}</msg></recorditem></appmsg></msg>`,
    `<msg>${quote.replace('1076601126396071190', '0')}</msg>`,
    `<msg>${quote.replace('1076601126396071190', '18446744073709551616')}</msg>`,
    `<msg>${quote.replace('1076601126396071190', '<nested>123</nested>')}</msg>`,
    `<!DOCTYPE msg [<!ENTITY secret SYSTEM "file:///private/secret">]><msg>${quote}</msg>`,
    '<msg><extcommoninfo>',
  ]) assert.equal(weChatAttachmentReply(xml), undefined);
});

test("history pagination carries every message across a busy second", async () => {
  const rows = [201, ...Array.from({length: 75}, () => 200), 199, 198]
    .map((timestamp, id) => ({id, timestamp}));
  const read = async ({until, limit}: {until?: number; limit: number}) =>
    rows.filter((row) => until === undefined || row.timestamp < until).slice(0, limit);
  const first = await weChatHistoryPage(read, (row) => row.timestamp, {limit: 10});
  assert.equal(first.rows.length, 76);
  assert.equal(first.nextUntil, 200);
  const second = await weChatHistoryPage(read, (row) => row.timestamp, {limit: 10, until: 200});
  assert.equal(second.nextUntil, null);
  assert.deepEqual(new Set([...first.rows, ...second.rows].map((row) => row.id)),
    new Set(rows.map((row) => row.id)));
  assert.equal(first.rows[0].timestamp, 200);
  assert.equal(first.rows.at(-1)?.timestamp, 201);
});

test("an invalid history page is an error, never proof of the end of history", async () => {
  for (const rows of [[{timestamp: 0}], [{timestamp: 50}], [{timestamp: Number.NaN}]])
    await assert.rejects(weChatHistoryPage(async () => rows, (row) => row.timestamp,
      {limit: 1, until: 50}), /invalid history page/);
  await assert.rejects(weChatHistoryPage(async () => {throw new Error("disconnected");},
    () => 1, {limit: 10}), /disconnected/);
});

test("an all-one-second archive terminates without dropping the boundary", async () => {
  const rows = Array.from({length: 32}, (_, id) => ({id, timestamp: 10}));
  const result = await weChatHistoryPage(async ({limit}) => rows.slice(0, limit),
    (row) => row.timestamp, {limit: 3});
  assert.equal(result.rows.length, 32);
  assert.equal(result.nextUntil, null);
});

test("relay parsing preserves 64-bit ids without editing message content", () => {
  const body = '{"server_id":18446744073709551615}';
  const value = parseWeChatJson<{id: string; body: string}>(
    `{"id":18446744073709551615,"body":${JSON.stringify(body)}}`);
  assert.equal(value.id, "18446744073709551615");
  assert.equal(value.body, body);
});
