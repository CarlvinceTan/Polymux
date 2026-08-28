import assert from "node:assert/strict";
import test from "node:test";
import { findWeChatNativeProfile } from "../src/wechat-native-profile.js";

test("native WeChat addresses are enabled only for an exact dylib digest", () => {
  const profile = findWeChatNativeProfile(
    "4E85ABA6FB2A99F7D0D28B3248DE8F06FEB9F38AEEA49A5EDC3E776E5A82A04F",
  );
  assert.equal(profile?.wechatVersion, "4.1.11");
  assert.equal(profile?.build, "269136");
  assert.equal(profile?.entryPoints.sessionSendHandlerRva, 0x6f7abc);
  assert.equal(profile?.entryPoints.slotSendRva, 0x6f9e74);
  assert.deepEqual(profile?.sendRouting, {
    mode: "entry-register-plus-offset",
    sessionRegister: "x26",
    recipientOffset: 0x2c0,
  });
  // 0x4f115d4 is mars::cdn RevokeTask, not WeChat's revokemsg entry. Message
  // recall stays intentionally unprofiled rather than calling the wrong ABI.
  assert.equal("revokeTaskRva" in (profile?.entryPoints ?? {}), false);
  assert.match(
    profile?.methodEncodings?.weTypeStickerSend ?? "",
    /basic_string<char/,
  );
  assert.equal(findWeChatNativeProfile("0".repeat(64)), undefined);
});
