export {
  WeChatBridge,
  WECHAT_FALLBACK_DIRECTORIES,
  relayEnvironment,
  type WeChatBridgeOptions,
  type WeChatWriter,
  type WeChatWriteRequest,
  type WeChatWriteResult,
  type WeChatStickerCatalogEntry,
  type WeChatHomeserver,
  type WeChatAppserviceRecord,
} from "./wechat-bridge.js";

export {ProcessWeChatWriter} from "./wechat-writer.js";
export {weChatLoginHidden, unavailableWeChatLogin} from "./wechat-login.js";

export {
  ensureWeChatAppRunningHidden,
  primeWeChatAppHidden,
  weChatSessionReadyHidden,
  weChatSessionStateHidden,
  weChatAppIsRunning,
  weChatAppProcessId,
  openWeChatDesktop,
  type EnsureWeChatAppOptions,
  type PrimeWeChatAppOptions,
  type WeChatSessionState,
} from "./wechat-app.js";

export {
  WECHAT_NATIVE_PROFILES,
  findWeChatNativeProfile,
  type WeChatNativeProfile,
} from "./wechat-native-profile.js";

export {loadHeadImages, type HeadImageOptions} from "./wechat-head-images.js";

export {
  probeWeChatRelay,
  setupGuidance,
  setupHint,
  WECHAT_DOWNLOAD_URL,
  WECHAT_DOWNLOAD_URLS,
  weChatDownloadUrl,
  type WeChatRelayStatus,
} from "./wechat-relay.js";

export {visibleWeChatText} from "./wechat-emoji.js";

export {
  forwardedBundleOf,
  forwardedBundleText,
  weChatForwardedBundle,
} from "./wechat-forwarded.js";

export {
  isWeChatContainerChannel,
  isWeChatSessionContainer,
  weChatMemberTitle,
  weChatPortalChannelId,
} from "./wechat-conversations.js";

export {pauseWeChatRelay} from "./wechat-relay-lease.js";
export {weChatCallText} from "./wechat-call.js";

export {
  parseWeChatJson,
  weChatAttachmentReply,
  weChatConversationList,
  weChatHistoryPage,
} from "./wechat-history.js";

export {
  resolveWeChatAccounts,
  defaultWeChatStoreRegistryPath,
  SqlcipherLiveSnapshot,
  WeChatNativeStore,
  weChatKindFromLocalType,
  weChatMessageTable,
  type SqlcipherLiveSnapshotOptions,
  type WeChatNativeAccount,
  type WeChatNativeStoreOptions,
  type WeChatNativeStoreRuntimeOptions,
  type WeChatConversation,
  type WeChatGroupMember,
  type NativeHistoryRow,
} from "./wechat-native-store.js";

export {
  WeChatWalWatcher,
  nativeRowToMessage,
  type WeChatWalMessage,
  type WeChatWalWatcherOptions,
} from "./wechat-wal-stream.js";

export {WeChatDeliveryUnconfirmedError, isWeChatDeliveryUnconfirmed} from "./wechat-delivery.js";
