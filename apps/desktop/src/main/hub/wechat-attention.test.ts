import assert from "node:assert/strict";
import test from "node:test";
import {weChatAttention} from "./wechat-attention.js";

test("confirmed WeChat sign-in states explain the next user action", () => {
  assert.deepEqual(weChatAttention("signed_out"), {
    title: "Sign in to WeChat Desktop", detail: "We’ll check automatically after you sign in.",
  });
  assert.equal(weChatAttention("interactive_login")!.title, "Sign in to WeChat Desktop");
  assert.equal(weChatAttention("remembered_login")!.title, "Sign in to WeChat Desktop");
  assert.match(weChatAttention("locked")!.detail, /Unlock your Mac/);
});

test("automatic recovery and unreadable windows do not claim a user signed out", () => {
  for (const state of ["signed_in", "launching", "unavailable", null, undefined] as const)
    assert.equal(weChatAttention(state), null);
});

test("missing Desktop takes precedence over session state", () => {
  assert.deepEqual(weChatAttention("interactive_login", "https://mac.weixin.qq.com/"), {
    title: "Install WeChat Desktop", detail: "Install WeChat and sign in to use it in Hub.",
    installUrl: "https://mac.weixin.qq.com/",
  });
});

test("sender sign-in never stands in for readable conversations", () => {
  assert.equal(weChatAttention("signed_in", null, false)?.title, "WeChat hasn’t synced yet");
  assert.equal(weChatAttention("signed_in", null, false)?.retry, true);
  assert.equal(weChatAttention("signed_in", null, true), null);
  assert.equal(weChatAttention("unavailable", null, false)?.title, "Can’t connect to WeChat");
  assert.equal(weChatAttention("signed_out", null, false)?.title, "Sign in to WeChat Desktop");
});
