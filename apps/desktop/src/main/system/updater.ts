import { app, autoUpdater as squirrelUpdater } from "electron";
import electronUpdater from "electron-updater";
import type { AppUpdateDto, AppVersionDto } from "@polymux/protocol";

const { autoUpdater: linuxUpdater } = electronUpdater;

/** The website resolves the latest signed GitHub Release into Squirrel.Mac's
 * tiny JSON feed. Keeping the feed on the product domain makes the update route
 * stable while release assets remain visible and downloadable on GitHub. */
const FEED_URL = process.env.POLYMUX_UPDATE_FEED_URL ?? "https://polymux.com/api/releases";

function feedUrl(): string {
  if (process.platform === "win32") {
    // Squirrel.Windows appends /RELEASES to this base URL. The website turns
    // that manifest into absolute GitHub Release asset URLs, so both the feed
    // and immutable packages remain reachable through a stable product URL.
    return `${FEED_URL.replace(/\/releases$/, '')}/updates/win32/${process.arch}`;
  }
  if (process.platform === "linux")
    return `${FEED_URL.replace(/\/releases$/, '')}/updates/linux/${process.arch}`;
  return FEED_URL;
}

// Squirrel polls rather than being pushed to, so the interval is the worst-case
// delay before a machine notices a release. Ten minutes matches what
// update-electron-app uses and is far below any rate limit on static hosting.
const POLL_INTERVAL_MS = 10 * 60 * 1000;

// A check that never reports back would leave the Settings spinner turning for
// the rest of the session, so the caller gets whatever is known by this point.
const CHECK_TIMEOUT_MS = 30_000;

let timer: NodeJS.Timeout | null = null;
let started = false;

/**
 * Squirrel emits its result as an event rather than returning it, so the state
 * lives here and `checkForUpdates` waits for the next transition.
 */
let state: AppUpdateDto = {
  status: "current",
  version: app.getVersion(),
  latest: null,
  checkedAt: new Date().toISOString(),
  message: null,
};

let pending: ((value: AppUpdateDto) => void)[] = [];

function settle(next: Partial<AppUpdateDto>): void {
  state = { ...state, ...next, checkedAt: new Date().toISOString() };
  const waiting = pending;
  pending = [];
  for (const resolve of waiting) resolve(state);
}

/**
 * Squirrel.Mac refuses to apply an update whose signature does not match the
 * running app, and an unsigned development build has no signature at all. It
 * reports that as a generic download failure, so without this guard a local
 * `npm start` would spend the session retrying an update it can never install.
 */
function canSelfUpdate(): boolean {
  // The development Electron bundle is renamed to Polymux.app on macOS so its
  // Dock identity is correct. That makes `app.isPackaged` report true even
  // though Forge launched the checkout through Electron's default-app route.
  // Squirrel cannot update that bundle and macOS rejects its commands.
  if (!app.isPackaged || process.defaultApp) return false;
  return process.platform === "darwin" || process.platform === "win32" || process.platform === "linux";
}

function updater() {
  return process.platform === "linux" ? linuxUpdater : squirrelUpdater;
}

/** Installed build identity, shown in the General settings tab. */
export function appVersion(): AppVersionDto {
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    packaged: app.isPackaged,
  };
}

export function startUpdateChecks(): void {
  if (started) return;
  started = true;

  if (!canSelfUpdate()) {
    settle({
      status: "unsupported",
      message: app.isPackaged
        ? process.platform === "linux"
          ? "This platform updates through its package manager."
          : "Automatic updates are not available on this platform yet. Download the latest installer from GitHub Releases."
        : "Development builds do not update.",
    });
    return;
  }

  if (process.platform === "linux") {
    linuxUpdater.setFeedURL({provider: "generic", url: feedUrl()});
  } else {
    squirrelUpdater.setFeedURL({
      url: feedUrl(),
      serverType: process.platform === "darwin" ? "json" : "default",
    });
  }

  const activeUpdater = updater();
  activeUpdater.on("update-not-available", () => settle({ status: "current", latest: null, message: null }));
  activeUpdater.on("update-available", () => settle({ status: "downloading", message: null }));
  if (process.platform === "linux") {
    linuxUpdater.on("update-downloaded", (info) =>
      settle({status: "ready", latest: info.version, message: null}),
    );
  } else {
    squirrelUpdater.on("update-downloaded", (_event, notes, name) =>
      settle({ status: "ready", latest: name, message: notes || null }),
    );
  }
  activeUpdater.on("error", (error: Error) => {
    // A failed check is not worth interrupting the session over: the next poll
    // retries, and the common causes are transient (offline, R2 hiccup).
    settle({ status: "error", message: error instanceof Error ? error.message : String(error) });
  });

  void activeUpdater.checkForUpdates();
  timer = setInterval(() => {
    // Once a build is staged, further checks can only replace it with the same
    // file; the restart is what is outstanding.
    if (state.status !== "ready") void activeUpdater.checkForUpdates();
  }, POLL_INTERVAL_MS);
}

export function stopUpdateChecks(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  updater().removeAllListeners();
}

/** Asks the configured update feed whether a newer build exists. */
export function checkForUpdates(): Promise<AppUpdateDto> {
  if (!canSelfUpdate() || state.status === "unsupported") return Promise.resolve(state);
  // A staged update is the end of the line until the app restarts; asking
  // Squirrel again would report nothing new and clear the "ready" badge.
  if (state.status === "ready") return Promise.resolve(state);

  return new Promise((resolve) => {
    let done = false;
    const finish = (value: AppUpdateDto) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      pending = pending.filter((waiter) => waiter !== finish);
      resolve(value);
    };
    pending.push(finish);
    const deadline = setTimeout(() => finish(state), CHECK_TIMEOUT_MS);
    void updater().checkForUpdates();
  });
}

/** Restarts into a downloaded update. No-op when none is staged. */
export function installUpdate(): Promise<AppUpdateDto> {
  if (state.status !== "ready") return Promise.resolve(state);
  // quitAndInstall does not return; the reply the renderer gets is whatever it
  // manages to read before the process goes away.
  setImmediate(() => updater().quitAndInstall());
  return Promise.resolve(state);
}
