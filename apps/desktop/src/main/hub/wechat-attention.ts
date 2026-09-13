import type {CommsBridgeDto} from "@polymux/protocol";
import type {WeChatSessionState} from "@polymux/wechat";

/** Keep sign-in, installation and read availability separate. An unreadable
 * window is not proof of logout, and sender readiness is not proof of sync. */
export function weChatAttention(state: WeChatSessionState | null | undefined, installUrl?: string | null, readable?: boolean): CommsBridgeDto["attention"] {
  if (installUrl) return {title: "Install WeChat Desktop", detail: "Install WeChat and sign in to use it in Hub.", installUrl};
  switch (state) {
    case "signed_out":
    case "interactive_login":
    case "remembered_login":
      return {title: "Sign in to WeChat Desktop", detail: "We’ll check automatically after you sign in."};
    case "locked":
      return {title: "Your Mac is locked", detail: "Unlock your Mac to continue with WeChat."};
    case "launching":
      return readable === false ? {
        title: "Connecting to WeChat",
        detail: "Waiting for WeChat Desktop to finish signing in.",
      } : null;
    case "signed_in":
      return readable === false ? {
        title: "WeChat hasn’t synced yet",
        detail: "You’re signed in, but Hub hasn’t gained access to your chats yet.",
        retry: true,
      } : null;
    default:
      return readable === false ? {
        title: "Can’t connect to WeChat",
        detail: "Open WeChat Desktop. We’ll check for your chats automatically.",
        retry: true,
      } : null;
  }
}
