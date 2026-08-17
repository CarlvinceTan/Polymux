import {BrowserWindow, nativeTheme, session, type BrowserWindow as BrowserWindowType} from "electron";
import {commsPlatformLabel} from "@flareai/protocol";
import type {CommsPlatform} from "@flareai/protocol";
import type {CookieLoginRequest} from "./index.js";

/**
 * Some networks only return a usable session to a browser that looks like one;
 * the bridge tells us which user agent it expects, and this is the fallback.
 */
const FALLBACK_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Sign-in windows currently on screen, by platform. Cancelling a login from the
 * app has to reach the window it opened, or the Close button in the app would
 * end the flow while the network's page stayed up.
 */
const openSheets = new Map<string, BrowserWindowType>();

/** Closes the sign-in window for a platform, if one is open. */
export function cancelCookieLogin(platform: string): void {
  const sheet = openSheets.get(platform);
  if (sheet && !sheet.isDestroyed()) sheet.close();
}

/**
 * Signs the user in to a network's own website and harvests the session values
 * a cookie-login bridge needs.
 *
 * The window is a real, isolated browser session rather than a scripted form
 * fill: the user types their own password into the network's own page, and only
 * the named cookies and storage keys ever leave it. Each platform gets its own
 * partition so signing in to one does not disturb another, or the user's
 * workspace browser.
 */
export async function runCookieLogin(
  request: CookieLoginRequest,
  parent?: BrowserWindowType,
): Promise<Record<string, string>> {
  const partition = `persist:flareai-comms-${request.platform}`;
  const userAgent = request.userAgent ?? FALLBACK_USER_AGENT;
  const label = commsPlatformLabel(request.platform as CommsPlatform);
  const window = new BrowserWindow({
    width: 520,
    height: 760,
    // Kept above FlareAI so it cannot be lost behind the window waiting on it,
    // but deliberately not modal: a macOS modal sheet is drawn without a title
    // bar, which left the user with no visible way out of a network's sign-in
    // page. A framed child window gets real traffic lights, so closing it is
    // the obvious thing it looks like.
    parent: parent?.isDestroyed() ? undefined : parent,
    modal: false,
    frame: true,
    title: `Sign in to ${label}`,
    // The page paints late; without this the sheet flashes white on a dark
    // desktop before the network's own page arrives.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff",
    autoHideMenuBar: true,
    // Nothing here belongs to FlareAI, so there is no app chrome to imitate:
    // the window is the network's page under the platform's name, and it
    // resizes like the browser window it stands in for.
    minimizable: true,
    maximizable: true,
    fullscreenable: false,
    webPreferences: {
      partition,
      // The page is untrusted third-party content; it gets no bridge into the
      // app and no Node integration.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setUserAgent(userAgent);
  openSheets.set(request.platform, window);

  // The network's own page decides its <title>; the bar should say which
  // account the user is signing in to, so keep ours.
  window.on("page-title-updated", (event) => event.preventDefault());

  // The close button is the obvious way out, but the keyboard should work too:
  // Escape, and the platform's own close-window chord. Closing counts as
  // cancelling.
  window.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown") return;
    const chord = process.platform === "darwin" ? input.meta : input.control;
    if (input.key === "Escape" || (chord && input.key.toLowerCase() === "w"))
      if (!window.isDestroyed()) window.close();
  });

  const wanted = request.fields.filter((field) => field.source === "cookie" || field.source === "local_storage");
  const waitFor = request.waitForUrl ? safeRegExp(request.waitForUrl) : null;

  try {
    return await new Promise<Record<string, string>>((resolve, reject) => {
      let settled = false;
      const finish = (
        outcome: {values: Record<string, string>} | {error: Error},
      ): void => {
        if (settled) return;
        settled = true;
        if ("error" in outcome) reject(outcome.error);
        else resolve(outcome.values);
      };

      window.on("closed", () =>
        finish({
          error: new Error(`Sign-in to ${label} was closed before it finished.`),
        }),
      );

      const attempt = async (): Promise<void> => {
        if (settled || window.isDestroyed()) return;
        const values = await collect(window, partition, wanted).catch(
          (): Record<string, string> => ({}),
        );
        const missing = request.fields.filter(
          (field) => field.required && !values[field.id],
        );
        if (missing.length > 0) return;
        finish({values});
        if (!window.isDestroyed()) window.close();
      };

      window.webContents.on("did-navigate", (_event, url) => {
        // A `wait_for_url` match means the network considers the user signed
        // in; without one, poll for the cookies themselves.
        if (!waitFor || waitFor.test(url)) void attempt();
      });
      window.webContents.on("did-navigate-in-page", (_event, url) => {
        if (!waitFor || waitFor.test(url)) void attempt();
      });
      window.webContents.on("did-finish-load", () => void attempt());

      void window.loadURL(request.url, {userAgent}).catch((error: unknown) =>
        finish({
          error: new Error(
            `Could not open the sign-in page: ${error instanceof Error ? error.message : String(error)}`,
          ),
        }),
      );
    });
  } finally {
    if (openSheets.get(request.platform) === window) openSheets.delete(request.platform);
    if (!window.isDestroyed()) window.destroy();
  }
}

async function collect(
  window: BrowserWindowType,
  partition: string,
  fields: Array<{source: string; id: string}>,
): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  const cookieNames = fields.filter((field) => field.source === "cookie").map((field) => field.id);
  if (cookieNames.length > 0) {
    const url = window.webContents.getURL();
    const cookies = await session.fromPartition(partition).cookies.get(
      url ? {url} : {},
    );
    for (const name of cookieNames) {
      const match = cookies.find((cookie) => cookie.name === name);
      if (match?.value) values[name] = match.value;
    }
  }
  const storageKeys = fields
    .filter((field) => field.source === "local_storage")
    .map((field) => field.id);
  if (storageKeys.length > 0 && !window.isDestroyed()) {
    const read = await window.webContents
      .executeJavaScript(
        `(() => { const out = {}; for (const key of ${JSON.stringify(storageKeys)}) { const value = window.localStorage.getItem(key); if (value !== null) out[key] = value; } return out; })()`,
      )
      .catch((): Record<string, string> => ({}));
    Object.assign(values, read as Record<string, string>);
  }
  return values;
}

/** A bridge-supplied pattern must never take down the login window. */
function safeRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
