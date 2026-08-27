/**
 * Native WeChat entry points are private ABI and change without notice.
 * A driver must match the complete dylib digest before using any address.
 */
export interface WeChatNativeProfile {
  dylibSha256: string;
  wechatVersion: string;
  build: string;
  entryPoints: {
    /** Constructor/dispatcher anchor recovered for the native revoke task. */
    revokeTaskRva?: number;
    /** Sole direct call site, used to recover the task's three arguments. */
    revokeTaskCallerRva?: number;
    /** Objective-C implementation of WeTypeStickerService's encoded sender. */
    weTypeStickerSendRva?: number;
  };
  methodEncodings?: {
    /** Exact runtime ABI; the argument is a libc++ std::string by value. */
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
      revokeTaskRva: 0x4f115d4,
      revokeTaskCallerRva: 0x503fe48,
      weTypeStickerSendRva: 0x39b89b0,
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
