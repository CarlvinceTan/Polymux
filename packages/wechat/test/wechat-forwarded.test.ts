import assert from "node:assert/strict";
import test from "node:test";
import {forwardedBundleOf, weChatForwardedBundle} from "../src/wechat-forwarded.js";

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const item = (body = "Hello &amp; welcome") => `<dataitem datatype="1"><sourcename>Alice</sourcename><sourcetime>2026-09-05 12:34:56</sourcetime><datadesc>${body}</datadesc></dataitem>`;
const record = (items = item(), count = 1) => `<recordinfo><title>Test conversation</title><datalist count="${count}">${items}</datalist></recordinfo>`;
const appmsg = (content: string) => `<msg><appmsg><type>19</type><title>Forwarded messages</title><recorditem>${content}</recorditem></appmsg></msg>`;

test("reads native CDATA, escaped XML, and embedded record bundles without losing text entities", () => {
  const xml = record(item("Literal &lt;b&gt; and &#x1F44B;\nnext line"));
  for (const encoded of [`<![CDATA[${xml}]]>`, escape(xml), xml]) {
    const bundle = weChatForwardedBundle(appmsg(encoded));
    assert.equal(bundle?.title, "Test conversation");
    assert.deepEqual(bundle?.messages, [{
      kind: "text", senderName: "Alice", sentAt: "2026-09-05 12:34:56",
      body: "Literal <b> and 👋\nnext line",
    }]);
    assert.equal(bundle?.truncated, false);
    assert.deepEqual(forwardedBundleOf(bundle), bundle);
  }
});

test("retains attachment names and nested senders while excluding native transport secrets", () => {
  const attachment = `<dataitem datatype="8"><sourcename>Bob</sourcename><datatitle>notes.pdf</datatitle><cdndatakey>private-key</cdndatakey><cdndataurl>private-transport</cdndataurl><sourceheadurl>https://example.invalid/avatar</sourceheadurl></dataitem>`;
  const nested = `<dataitem datatype="17"><sourcename>Carol</sourcename><recorditem>${escape(record())}</recorditem></dataitem>`;
  const bundle = weChatForwardedBundle(appmsg(escape(record(attachment + nested, 2))));
  assert.deepEqual(bundle?.messages[0], {senderName: "Bob", sentAt: null, kind: "file", body: "notes.pdf"});
  assert.equal(bundle?.messages[1].senderName, "Carol");
  assert.equal(bundle?.messages[1].forwarded?.messages[0].senderName, "Alice");
  assert.doesNotMatch(JSON.stringify(bundle), /private-|example.invalid/);
  assert.deepEqual(forwardedBundleOf(bundle), bundle);
});

test("preserves native descriptions for a forwarded sticker and text-only voice reference", () => {
  const sticker = '<dataitem datatype="37"><datadesc>[Sticker]</datadesc><emojiitem><md5>private-transport</md5></emojiitem></dataitem>';
  const voice = '<dataitem datatype="1"><datadesc>[Audio] 2&quot;</datadesc></dataitem>';
  const bundle = weChatForwardedBundle(appmsg(record(sticker + voice, 2)))!;
  assert.equal(bundle.messages[0].body, "[Sticker]");
  assert.equal(bundle.messages[1].kind, "text", "Desktop did not attach a playable recording to this forward");
  assert.equal(bundle.messages[1].body, '[Audio] 2"');
  assert.doesNotMatch(JSON.stringify(bundle), /private-transport/);
  assert.deepEqual(forwardedBundleOf(bundle), bundle);
});

test("leaves non-records and malformed XML on the existing fallback path without entity expansion", () => {
  for (const xml of [
    "text", appmsg("missing"), appmsg(escape(record())).replace("<type>19", "<type>57"),
    appmsg(escape(record())).replace("</appmsg>", "</mismatch>"),
    `<!DOCTYPE msg [<!ENTITY secret SYSTEM "file:///private/secret">]>${appmsg(escape(record(item("&secret;"))))}`,
    appmsg(escape(record(item("&undeclared;")))), "x".repeat(2 * 1024 * 1024 + 1),
  ]) assert.equal(weChatForwardedBundle(xml), null);
});

test("bounds wide, long, and deeply nested bundles and exposes truncation", () => {
  const wide = weChatForwardedBundle(appmsg(record(item().repeat(501), 501)));
  assert.equal(wide?.messages.length, 500);
  assert.equal(wide?.truncated, true);
  assert.deepEqual(forwardedBundleOf(wide), wide);
  const long = weChatForwardedBundle(appmsg(record(item("x".repeat(20_000)))));
  assert.equal(long?.messages[0].body.length, 10_000);
  assert.equal(long?.truncated, true);
  let nested = record();
  for (let depth = 0; depth < 10; depth++) nested = record(`<dataitem datatype="17">${nested}</dataitem>`);
  const deep = weChatForwardedBundle(appmsg(nested));
  assert.ok(deep);
  let current = deep;
  let depth = 0;
  while (current.messages[0].forwarded) {current = current.messages[0].forwarded; depth++;}
  assert.equal(depth, 6);
  assert.equal(current.truncated, true);
  assert.deepEqual(forwardedBundleOf(deep), deep);
});

test("rejects malformed Matrix bundles and copies only the display contract", () => {
  const valid = weChatForwardedBundle(appmsg(record()))!;
  for (const value of [null, {}, {...valid, messages: []}, {...valid, title: 1},
    {...valid, messages: [{...valid.messages[0], body: {}}]},
    {...valid, messages: [{...valid.messages[0], forwarded: valid, kind: "javascript"}]},
    {...valid, messages: [{...valid.messages[0], forwarded: {messages: []}}]},
    {...valid, messages: Array(501).fill(valid.messages[0])},
  ]) assert.equal(forwardedBundleOf(value), null);
  assert.deepEqual(forwardedBundleOf({...valid, secret: "private", messages: valid.messages.map((message) => ({...message, cdnKey: "private"}))}), valid);
});
