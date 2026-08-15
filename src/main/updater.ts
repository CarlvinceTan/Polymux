import { app, autoUpdater } from "electron";
import type { AppUpdateDto, AppVersionDto } from "@midas/protocol";

/**
 * Updates are served as static files from Cloudflare R2 behind
 * updates.polymux.com. Nothing dynamic runs there: macOS reads a small JSON
 * document describing the newest build, Windows reads the RELEASES index that
 * MakerSquirrel already produces. `scripts/publish-updates.mjs` writes both.
 */
const FEED_HOST = process.env.MIDAS_UPDATE_HOST ?? "https://updates.polymux.com";
const CHANNEL = "stable";

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
  if (!app.isPackaged) return false;
  // deb/rpm are updated through the user's package manager; Squirrel has no
  // Linux backend to point at.
  return process.platform === "darwin" || process.platform === "win32";
}

function feedUrl(): string {
  const base = `${FEED_HOST}/${CHANNEL}/${process.platform}/${process.arch}`;
  // Squirrel.Windows walks a directory listing for RELEASES and the .nupkg
  // beside it; Squirrel.Mac wants the JSON document itself.
  return process.platform === "darwin" ? `${base}/RELEASES.json` : base;
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
        ? "This platform updates through its package manager."
        : "Development builds do not update.",
    });
    return;
  }

  autoUpdater.setFeedURL({
    url: feedUrl(),
    serverType: process.platform === "darwin" ? "json" : "default",
  });

  autoUpdater.on("update-not-available", () => settle({ status: "current", latest: null, message: null }));
  autoUpdater.on("update-available", () => settle({ status: "downloading", message: null }));
  autoUpdater.on("update-downloaded", (_event, notes, name) =>
    settle({ status: "ready", latest: name, message: notes || null }),
  );
  autoUpdater.on("error", (error) => {
    // A failed check is not worth interrupting the session over: the next poll
    // retries, and the common causes are transient (offline, R2 hiccup).
    settle({ status: "error", message: error instanceof Error ? error.message : String(error) });
  });

  autoUpdater.checkForUpdates();
  timer = setInterval(() => {
    // Once a build is staged, further checks can only replace it with the same
    // file; the restart is what is outstanding.
    if (state.status !== "ready") autoUpdater.checkForUpdates();
  }, POLL_INTERVAL_MS);
}

export function stopUpdateChecks(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  autoUpdater.removeAllListeners();
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
      resolve(value);
    };
    pending.push(finish);
    setTimeout(() => finish(state), CHECK_TIMEOUT_MS);
    autoUpdater.checkForUpdates();
  });
}

/** Restarts into a downloaded update. No-op when none is staged. */
export function installUpdate(): Promise<AppUpdateDto> {
  if (state.status !== "ready") return Promise.resolve(state);
  // quitAndInstall does not return; the reply the renderer gets is whatever it
  // manages to read before the process goes away.
  setImmediate(() => autoUpdater.quitAndInstall());
  return Promise.resolve(state);
}
