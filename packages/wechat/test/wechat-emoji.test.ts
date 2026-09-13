import assert from "node:assert/strict";
import test from "node:test";
import {visibleWeChatText, WECHAT_EMOJI_ALIASES} from "../src/wechat-emoji.js";

test("every supported WeChat alias becomes visible rather than bracketed text", () => {
  // 105 classic aliases, both spellings of WeChat's historic Grimace typo,
  // and the newer Salute and Facepalm aliases.
  assert.equal(WECHAT_EMOJI_ALIASES.length, 108);
  for (const alias of WECHAT_EMOJI_ALIASES)
    assert.doesNotMatch(visibleWeChatText(`[${alias}]`), /^\[.+\]$/, alias);
});

test("aliases work inside a message and unknown bracketed text stays authored text", () => {
  assert.equal(
    visibleWeChatText("Hi [Smile] [not an emoji] [Salute]"),
    "Hi 😄 [not an emoji] 🫡",
  );
});
