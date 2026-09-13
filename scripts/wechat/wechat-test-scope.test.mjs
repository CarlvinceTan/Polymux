import assert from "node:assert/strict";
import test from "node:test";
import {weChatTestChatAllowed} from "./wechat-test-scope.mjs";

test("test chat fences accept exact recipients and cannot broaden one another", () => {
  const environment = {POLYMUX_WECHAT_TEST_CHAT_IDS: "filehelper,123456@chatroom"};
  assert.equal(weChatTestChatAllowed("filehelper", environment), true);
  assert.equal(weChatTestChatAllowed("123456@chatroom", environment), true);
  assert.equal(weChatTestChatAllowed("1234567@chatroom", environment), false);
  assert.equal(weChatTestChatAllowed("wxid_other", environment), false);
  assert.equal(weChatTestChatAllowed("123456@chatroom", {...environment, POLYMUX_WECHAT_TEST_ONLY_FILEHELPER: "1"}), false);
  assert.equal(weChatTestChatAllowed("filehelper", {POLYMUX_WECHAT_TEST_CHAT_IDS: "123456@chatroom", POLYMUX_WECHAT_TEST_ONLY_FILEHELPER: "1"}), false);
  for (const value of ["", "*", "测试", "filehelper,", "../filehelper"])
    assert.throws(() => weChatTestChatAllowed("filehelper", {POLYMUX_WECHAT_TEST_CHAT_IDS: value}), /invalid/);
  assert.equal(weChatTestChatAllowed("123456@chatroom", {}), true);
});
