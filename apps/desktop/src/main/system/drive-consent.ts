import {BrowserWindow, nativeTheme, type BrowserWindow as BrowserWindowType} from "electron";
import type {DriveConsentPrompt, DriveConsentWindow} from "@polymux/drive";

/**
 * The Electron half of an OAuth sign-in, for a drive or a mailbox.
 *
 * The packages run the whole flow — PKCE, the loopback listener, the state
 * check — and need exactly one thing they cannot do under plain Node: put the
 * provider's own page on screen. That is all this does. The user types their
 * password into the provider's page and nothing about the code that comes back
 * is decided here.
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
        width: 520,
        height: 760,
        // Kept above Polymux so it cannot be lost behind the window waiting on
        // it, but deliberately not modal: a macOS modal child window is drawn
        // as a sheet without a title bar, which leaves the user no visible way
        // out of the provider's sign-in page. A framed child window gets real
        // traffic lights, so closing it is the obvious thing it looks like.
        // This is the same shape as the cookie-login sheet, for the same
        // reason.
        parent: alive ? owner : undefined,
        modal: false,
        frame: true,
        title,
        // The page paints late; without this the window flashes white on a
        // dark desktop before the provider's own page arrives.
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff",
        autoHideMenuBar: true,
        // Nothing here belongs to Polymux, so there is no app chrome to
        // imitate: it is the provider's page under the provider's name, and it
        // resizes like the browser window it stands in for.
        minimizable: true,
        maximizable: true,
        fullscreenable: false,
        webPreferences: {
          // A throwaway partition: consent runs in a clean session so it never
          // picks up, or disturbs, the user's workspace browser cookies.
          partition: `polymux-${kind}-oauth-${provider}`,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      window.on("closed", onClosed);
      void window.loadURL(url);

      return {
        close: () => {
          if (!window.isDestroyed()) window.destroy();
        },
      };
    },
  };
}
