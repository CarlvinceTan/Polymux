/**
 * Native WeChat entry points are private ABI and change without notice.
 * A driver must match the complete dylib digest before using any address.
 */
export interface WeChatNativeProfile {
  dylibSha256: string;
  wechatVersion: string;
  build: string;
  entryPoints: {
    /** Session send-handler entry; observed ABI starts with (Session*, action). */
    sessionSendHandlerRva?: number;
    /** Text-send routing slot observed while delivering to File Transfer. */
    slotSendRva?: number;
    /**
     * WeType synchronization entry point. It publishes encoded sticker data
     * to WeType; it is deliberately not an outbound chat-sticker handler.
     */
    weTypeStickerSendRva?: number;
  };
  sendRouting?: {
    mode: "entry-register-plus-offset";
    /** ARM64 register containing the live Session object at slotSendRva. */
    sessionRegister: "x26";
    /** Offset of the recipient std::string read by sessionSendHandlerRva. */
    recipientOffset: number;
  };
  methodEncodings?: {
    /** Exact runtime ABI for WeType synchronization, not chat delivery. */
    weTypeStickerSend?: string;
  };
}

export const WECHAT_NATIVE_PROFILES: readonly WeChatNativeProfile[] = [
  {
    dylibSha256:
      "4e85aba6fb2a99f7d0d28b3248de8f06feb9f38aeea49a5edc3e776e5a82a04f",
    wechatVersion: "4.1.11",
    build: "269136",
    entryPoints: {
      sessionSendHandlerRva: 0x6f7abc,
      slotSendRva: 0x6f9e74,
      weTypeStickerSendRva: 0x39b89b0,
    },
    sendRouting: {
      mode: "entry-register-plus-offset",
      sessionRegister: "x26",
      recipientOffset: 0x2c0,
    },
    methodEncodings: {
      weTypeStickerSend:
        "v40@0:8{basic_string<char, std::char_traits<char>, std::allocator<char>>={__compressed_pair<std::basic_string<char>::__rep, std::allocator<char>>={__rep=(?={__short=[23c][0C]b7b1}{__long=*Qb63b1}{__raw=[3Q]})}}}16",
    },
  },
] as const;

export function findWeChatNativeProfile(
  dylibSha256: string,
): WeChatNativeProfile | undefined {
  const digest = dylibSha256.trim().toLowerCase();
  return WECHAT_NATIVE_PROFILES.find(
    (profile) => profile.dylibSha256 === digest,
  );
}
