import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {buildMessageSource, buildReplyXml} from "./wechat-wire.mjs";
import {sentMediaMessageId} from "./wechat-media-history.mjs";
import {parseWeChatHistory, recallConfirmed, sentStickerMessageId, sentTextMessageId} from "./wechat-message-history.mjs";

const row = {server_id: "9007199254740993", create_time: 200, real_sender_id: 2, sender_wxid: "wxid_self",
  message_kind: "text", message_content: "hello"};
const expected = {body: "hello", sinceEpoch: 200, excludedIds: [], selfWxid: "wxid_self"};

test("history keeps unsigned ids and quoted message JSON intact", () => {
  const output = '{"rows":[{"server_id":18446744073709551615,"message_content":"{\\"server_id\\":18446744073709551615}"}]}';
  const parsed = parseWeChatHistory(output).rows[0];
  assert.equal(parsed.server_id, "18446744073709551615");
  assert.equal(parsed.message_content, '{"server_id":18446744073709551615}');
  for (const invalid of ["{}", "null", '{"error":"locked"}', '{"rows":false}'])
    assert.throws(() => parseWeChatHistory(invalid), /message list/);
});

test("text acknowledgement excludes old, incoming, unaccepted and ambiguous copies", () => {
  assert.equal(sentTextMessageId([row], expected), row.server_id);
  for (const bad of [{...row, create_time: 199}, {...row, sender_wxid: "wxid_other"},
    {...row, server_id: 0}, {...row, server_id: Number(row.server_id)},
    {...row, message_content: "hello there"}])
    assert.equal(sentTextMessageId([bad], expected), undefined);
  assert.equal(sentTextMessageId([row], {...expected, excludedIds: [row.server_id]}), undefined);
  const another = {...row, server_id: "9007199254740994"};
  assert.equal(sentTextMessageId([row, another], expected), undefined);
  assert.equal(sentTextMessageId([row, another], {...expected, expectedMessageId: another.server_id}), another.server_id);
});

test("acknowledgements match account wxid across destination shard sender ids", () => {
  const sent = {...row, real_sender_id: 7};
  const incoming = {...row, real_sender_id: 2, sender_wxid: "wxid_other"};
  assert.equal(sentTextMessageId([sent, incoming], expected), sent.server_id);
  assert.equal(sentTextMessageId([incoming], expected), undefined);
  assert.equal(sentTextMessageId([{...sent, sender_wxid: undefined}], expected), undefined);
  assert.equal(sentTextMessageId([sent], {...expected, selfWxid: undefined}), undefined);
});

test("native replies match the entire title and exact quoted id, including CDATA", () => {
  const body = "answer & <detail>";
  const xml = buildReplyXml({body, chatId: "group@chatroom", createTime: 180,
    displayName: "Alex", fromWxid: "wxid_self", messageId: "123",
    quotedBody: "original", quotedSender: "wxid_alex"});
  const reply = {...row, message_kind: "appmsg", message_content: xml};
  const target = {...expected, body, replyTo: "123"};
  assert.equal(sentTextMessageId([reply], target), row.server_id);
  assert.equal(sentTextMessageId([reply], {...target, replyTo: "12"}), undefined);
  assert.equal(sentTextMessageId([reply], {...target, body: "answer"}), undefined);
  assert.equal(sentTextMessageId([{...reply, message_content: xml.replace(
    "answer &amp; &lt;detail&gt;", "<![CDATA[answer & <detail>]]>")}], target), row.server_id);
  assert.match(xml, /<chatusr>wxid_alex<\/chatusr>/);
});

test("mentions require an exact native target list, including when replying", () => {
  const source = buildMessageSource("group@chatroom", ["wxid_alex", "wxid_alex"]);
  const target = {...expected, mentions: ["wxid_alex"]};
  assert.equal(sentTextMessageId([row], target), undefined);
  assert.equal(sentTextMessageId([{...row, message_source: source}], target), row.server_id);
  assert.equal(sentTextMessageId([{...row, message_source: source}],
    {...target, mentions: ["wxid_other"]}), undefined);
  for (const users of [["wxid_alex,wxid_other"], ["x</atuserlist>"], ["notify@all"], "wxid_alex"])
    assert.throws(() => buildMessageSource("group@chatroom", users), /exact member ids/);
  assert.throws(() => buildMessageSource("filehelper", ["wxid_alex"]), /group chat/);
});

test("sticker history requires the emoji's md5, not a matching substring elsewhere", () => {
  const md5 = "a".repeat(32);
  const sticker = {...row, message_kind: "emoticon", message_content: `<msg><emoji md5="${md5}" /></msg>`};
  assert.equal(sentStickerMessageId([sticker], {...expected, md5}), row.server_id);
  assert.equal(sentStickerMessageId([{...sticker, message_content: `<msg><title>${md5}</title></msg>`}],
    {...expected, md5}), undefined);
  assert.equal(sentStickerMessageId([sticker], {...expected, md5, excludedIds: [row.server_id]}), undefined);
});

test("media ignores previous sends and fails when a new acknowledgement is ambiguous", () => {
  const bytes = Buffer.from("new image");
  const picture = {...row, message_kind: "image", media: {}};
  const media = {...expected, mediaType: "image", bytes};
  assert.equal(sentMediaMessageId([picture], {...media, excludedIds: [row.server_id]}), undefined);
  assert.equal(sentMediaMessageId([picture, {...picture, server_id: "other"}], media), undefined);
  assert.equal(sentMediaMessageId([{...row, message_kind: "file", media: {
    filename: "file.txt", size_bytes: bytes.length, md5: "b".repeat(32),
  }}], {...media, mediaType: "file", expectedName: "file.txt"}), undefined);
});

test("a phone image cannot acknowledge an unrelated pending image", () => {
  const bytes = Buffer.from("Polymux outgoing photo");
  const phone = {...row, message_kind: "image", media: {md5: "f".repeat(32), size_bytes: 500}};
  const media = {...expected, mediaType: "image", bytes};
  assert.equal(sentMediaMessageId([phone], media), undefined);
  assert.equal(sentMediaMessageId([{...phone, media: {}}], media), undefined);
  assert.equal(sentMediaMessageId([phone], {...media, expectedMessageId: "another-id"}), undefined);
  // A concrete native acknowledgement correlates a re-encoded picture.
  assert.equal(sentMediaMessageId([phone], {...media, expectedMessageId: phone.server_id}), phone.server_id);
  const exact = {...phone, media: {md5: createHash("md5").update(bytes).digest("hex")}};
  assert.equal(sentMediaMessageId([exact], media), exact.server_id);
});

test("recall acknowledgement cannot confuse ids that share a prefix", () => {
  const recalled = {message_kind: "system", message_content:
    "<sysmsg><revokemsg><newmsgid>1234</newmsgid></revokemsg></sysmsg>"};
  assert.equal(recallConfirmed([recalled], "1234"), true);
  assert.equal(recallConfirmed([recalled], "123"), false);
  assert.equal(recallConfirmed([{...recalled, message_content: "1234 recalled"}], "1234"), false);
});
