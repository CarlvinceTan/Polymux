/** Development-only test fences are intersections: adding a second fence
 * cannot silently broaden an existing File Transfer-only run. */
export function weChatTestChatAllowed(chatId, environment = process.env) {
  if (environment.POLYMUX_WECHAT_TEST_ONLY_FILEHELPER === "1" && chatId !== "filehelper") return false;
  const configured = environment.POLYMUX_WECHAT_TEST_CHAT_IDS;
  if (configured == null) return true;
  const ids = configured.split(",").map(id => id.trim());
  if (!ids.length || ids.some(id => !/^(?:filehelper|wxid_[A-Za-z0-9_-]+|[1-9]\d*@chatroom)$/.test(id)))
    throw new Error("The WeChat test chat allowlist is invalid");
  return ids.includes(chatId);
}
