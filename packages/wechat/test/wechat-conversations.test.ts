import assert from "node:assert/strict";
import test from "node:test";
import {weChatMemberTitle} from "../src/wechat-conversations.js";

test("an untitled group's label uses native members without mistaking ids for names", () => {
  assert.equal(weChatMemberTitle([
    {wxid: "wxid_me", display_name: "Me"},
    {wxid: "wxid_ann", display_name: "Old name", group_nickname: " Ann "},
    {wxid: "wxid_bo", display_name: "Bo", group_nickname: " "},
    {wxid: "wxid_unknown", display_name: "wxid_unknown"},
    {wxid: "wxid_ann", display_name: "Ann"},
    {wxid: "wxid_other_ann", display_name: "Ann"},
    {wxid: "wxid_chen", display_name: "Chen"},
  ], "wxid_me"), "Ann, Bo, Ann…");
  for (const rows of [null, {}, [], [{wxid: "wxid_unknown", display_name: "wxid_unknown"}]])
    assert.equal(weChatMemberTitle(rows, null), null);
});
