import {
  BrowserWindow,
  nativeTheme,
  shell,
  type BrowserWindow as BrowserWindowType,
} from "electron";
import type {DriveConsentPrompt, DriveConsentWindow} from "@polymux/drive";
import {
  consentWaitingHtml,
  requireWebConsentUrl,
} from "./oauth-consent-page.js";

/**
 * The Electron half of an OAuth sign-in, for a drive or a mailbox.
 *
 * The packages run the whole flow — PKCE, the loopback listener, the state
 * check — and need exactly one thing they cannot do under plain Node: put the
 * provider's own page on screen.
 *
 * That page cannot stay in a BrowserWindow if the user needs a passkey.
 * Electron 43's `configureWebAuthn` only enables Touch ID credentials stored
 * in Polymux's own keychain group — device-bound, not iCloud-synced, and not
 * the Google passkey already on this Mac. Chromium's iCloud Keychain path is
 * gated on Apple's `com.apple.developer.web-browser.public-key-credential`
 * entitlement, which only real browsers get. Electron 45's `platformPasskeys`
 * still needs `webcredentials:` associated domains plus an AASA file on the
 * relying party; google.com will not list Polymux. Apple's web-browser
 * passkey entitlement is reserved for apps that launch as a URL-bar browser;
 * Thunderbird was refused and pointed at `ASWebAuthenticationSession`. That
 * API does use Safari/iCloud passkeys, but on macOS it still opens the
 * default browser — not an in-app Chromium sheet — and it wants a custom
 * scheme rather than this flow's `http://127.0.0.1` loopback. Joining
 * another app's keychain access group is also impossible: groups are
 * Team-ID-prefixed and code-signed. Spoofing a Chrome User-Agent can make
 * Google paint the current UI, but `navigator.credentials` would still hang
 * or fail — the same stuck "Complete sign-in using your passkey" sheet this
 * flow used to show. The system browser is the host that can raise the OS
 * passkey prompt for those credentials.
 *
 * The small Polymux window is only a cancel handle; closing it aborts the wait.
 *
 * One implementation serves both because the two prompts are the same shape.
 * `kind` only keeps their throwaway sessions apart, so signing into a Google
 * drive and a Gmail mailbox are separate acts rather than one silently
 * answering for the other.
 */
export function electronConsent(
  parent: () => BrowserWindowType | undefined,
  kind: "drive" | "mail" = "drive",
): DriveConsentPrompt {
  return {
    async open({provider, title, url, onClosed}): Promise<DriveConsentWindow> {
      const owner = parent();
      const alive = owner !== undefined && !owner.isDestroyed();
      const window = new BrowserWindow({
        width: 420,
        height: 220,
        // Kept above Polymux so it cannot be lost behind the window waiting on
        // it, but deliberately not modal: a macOS modal child window is drawn
        // as a sheet without a title bar, which leaves the user no visible way
        // out. A framed child window gets real traffic lights, so closing it
        // is the obvious thing it looks like.
        parent: alive ? owner : undefined,
        modal: false,
        frame: true,
        title,
        show: false,
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff",
        autoHideMenuBar: true,
        minimizable: true,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
          partition: `polymux-${kind}-oauth-${provider}`,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      window.on("closed", onClosed);
      window.on("page-title-updated", (event) => event.preventDefault());
      window.webContents.on("before-input-event", (_event, input) => {
        if (input.type !== "keyDown") return;
        const chord = process.platform === "darwin" ? input.meta : input.control;
        if (input.key === "Escape" || (chord && input.key.toLowerCase() === "w"))
          if (!window.isDestroyed()) window.close();
      });

      const target = requireWebConsentUrl(url);
      void window.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(
          consentWaitingHtml(nativeTheme.shouldUseDarkColors),
        )}`,
      );
      // Inactive so this cancel sheet does not steal the browser that has to
      // show the passkey prompt. The provider page is opened last so it is
      // what comes to the front.
      if (!window.isDestroyed()) window.showInactive();
      await shell.openExternal(target);

      return {
        close: () => {
          if (!window.isDestroyed()) window.destroy();
        },
      };
    },
  };
}
