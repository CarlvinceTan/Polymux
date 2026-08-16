import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import started from "electron-squirrel-startup";
import { channels } from "@flareai/protocol";
import { DesktopBackend, modelFromEnvironment } from "./backend.js";
import { BridgeHost, Homeserver } from "./homeserver/index.js";
import { loadShippedCredentials } from "./homeserver/shipped-credentials.js";
import {
  FLAREAI_TRAFFIC_LIGHT_POSITION,
  syncMacWindowButtons,
} from "./window-buttons.js";

// `npm start` runs the app as a child of the CLI, so its stdout and stderr are
// pipes. Kill the terminal (or let the launcher exit) and the read end goes
// away, but the app keeps running — the next `console.warn` then throws EPIPE
// out of Node's writable stream, which Electron reports as an uncaught main
// process exception and pins a modal error dialog over a window that can no
// longer be quit. A log line losing its reader is not a fatal condition.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") throw error;
  });
}

// `app.quit()` only *starts* a shutdown: `whenReady` still fires afterwards, so
// without this flag the instance that is on its way out builds a second window
// and hands the user a blank one over the instance that actually owns the
// session.
let quitting = false;

if (started) {
  quitting = true;
  app.quit();
}

// The credential store, API-key pool, and SQLite database all live in one
// userData directory, and each instance caches them in memory: a second
// instance (say, a forgotten `npm start`) writes its stale cache back over
// the other's changes — observed losing a freshly saved API key. Hand the
// session to the instance that already owns the directory instead.
if (!app.requestSingleInstanceLock()) {
  // Say so. This instance dies before it ever builds a window, so without a
  // line here `npm start` looks hung: the dev server stays up, the terminal
  // goes quiet, and the only FlareAI on screen is the older instance still
  // running its older bundle.
  console.error(
    "FlareAI is already running, so this instance is handing the session over " +
      "and exiting. Quit the running one (Cmd+Q) before starting again.",
  );
  quitting = true;
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    // Windowless but still holding the lock — a renderer that could not be
    // revived, or a macOS run whose last window was closed. The second launch
    // is the user asking for the app, so give them the window rather than
    // silently exiting and leaving them with nothing on screen.
    if (!window) {
      createWindow();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.focus();
  });
}

// Development runs execute inside Electron.app, whose bundle name would
// otherwise appear as "Electron" in the macOS Dock tooltip.
app.setName("FlareAI");
process.title = "FlareAI";
// Electron does not always build Chromium's accessibility tree until assistive
// technology requests it. Keep the renderer tree available so macOS can expose
// FlareAI's labelled chat controls to VoiceOver and exact-window automation.
app.commandLine.appendSwitch("force-renderer-accessibility");
// Electron's geolocation provider reads GOOGLE_API_KEY before any renderer is
// created. Keep a FlareAI-specific variable available for packaged launches while
// still respecting Electron's documented variable when it is supplied.
if (!process.env.GOOGLE_API_KEY && process.env.FLAREAI_GOOGLE_API_KEY)
  process.env.GOOGLE_API_KEY = process.env.FLAREAI_GOOGLE_API_KEY;

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let backend: DesktopBackend | undefined;
// The startup splash covers the first paint of a cold launch. Reopening a
// window on an already-running app (macOS Dock activate) has nothing to cover,
// so the renderer is told which kind of launch it is.
let coldStartConsumed = false;

function createWindow(): void {
  const window = new BrowserWindow({
    title: "FlareAI",
    width: 1000,
    height: 618,
    // The floor where the split layout still reads: history at its 180px
    // minimum, the conversation at its 432px measure and the workspace at its
    // 360px minimum, which is SPLIT_LAYOUT_MIN_WIDTH in the renderer's
    // layoutSizing — keep the two in step.
    minWidth: 973,
    // The welcome composer sits on the window's centre line, so its menus open
    // downward into the lower half. 672px leaves the tallest of them (the model
    // menu, five rows) 28px clear of the bottom edge, and pairs with the width
    // at a 1.45 ratio rather than a letterbox.
    minHeight: 672,
    // The window only appears once the renderer has its first frame — the
    // startup splash — so there is never a blank window in either theme: the
    // window opens already showing the loading screen. `ready-to-show` below
    // pairs with this.
    show: false,
    // For paints after showing (resizes, reloads): follow the system so the
    // brief native ground matches the splash. Which theme the app itself uses
    // is the renderer's call (theme-boot) and is already painted by the time
    // this is visible.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff",
    // `hiddenInset` places the traffic lights on its own line, which does not
    // agree with the title bar's controls. `hidden` hands us the position, so
    // they align optically with the renderer controls. Native lights rasterise
    // around y=19 differently from SVG strokes, while the 28px app controls
    // render at y=12; these measured positions share the same visual line.
    titleBarStyle: process.platform === "darwin" ? "hidden" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? FLAREAI_TRAFFIC_LIGHT_POSITION : undefined,
    webPreferences: {
      preload: path.join(currentDirectory, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // First frame ready — the splash is painted — so the window can appear
  // showing it. The deadline covers a renderer that never reaches its first
  // paint (a broken dev bundle, a hung load): a visible broken window can be
  // diagnosed, an invisible one just looks like the app refused to start.
  const reveal = (): void => {
    if (window.isDestroyed() || window.isVisible()) return;
    window.show();
    // Only now is the splash on screen. A hidden Electron window still reports
    // its document as visible, so the renderer cannot tell this moment for
    // itself, and a slide started before it is a slide spent behind a window
    // nobody can see. The attribute is what the stylesheet animates on.
    void window.webContents
      .executeJavaScript('document.documentElement.dataset.splash = "playing"', true)
      .catch(() => {});
  };
  const showDeadline = setTimeout(reveal, 4000);
  window.once("ready-to-show", () => {
    clearTimeout(showDeadline);
    reveal();
  });
  window.once("closed", () => clearTimeout(showDeadline));

  // A load that never lands is the other way to get a blank window, and unlike
  // a crashed renderer it leaves no trace at all: `render-process-gone` never
  // fires, the deadline above reveals the window anyway, and the terminal stays
  // clean. In development the usual cause is a race — the window asks for the
  // dev server in the moment Vite is still rebinding, or on a port a dying
  // previous run has just let go of — which a retry a second later fixes.
  const LOAD_RETRIES = 5;
  let retriesLeft = LOAD_RETRIES;
  let retryTimer: NodeJS.Timeout | undefined;
  window.webContents.on("did-finish-load", () => {
    retriesLeft = LOAD_RETRIES;
  });
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // Sub-frames and the aborts a normal navigation cancels itself with
      // (-3 is ERR_ABORTED) are not a window that failed to come up.
      if (!isMainFrame || errorCode === -3) return;
      console.error(
        `[renderer] load failed (${errorCode} ${errorDescription}) for ${validatedURL}`,
      );
      if (window.isDestroyed()) return;
      if (retriesLeft <= 0) {
        console.error(
          "[renderer] giving up on the load; the window will stay blank. " +
            "Check that the dev server is up and quit any other running FlareAI.",
        );
        return;
      }
      retriesLeft -= 1;
      retryTimer = setTimeout(() => {
        if (window.isDestroyed()) return;
        console.error(`[renderer] retrying the load (${retriesLeft} attempts left)`);
        loadRenderer(window);
      }, 1000);
    },
  );

  // Renderer exceptions never reach the terminal on their own: a throw inside
  // `mount()` empties #app and prints only to devtools nobody has open. Mirror
  // errors out so a blank window explains itself where the launch was started.
  window.webContents.on("console-message", (event) => {
    if (event.level === "error")
      console.error(`[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });

  window.once("closed", () => clearTimeout(retryTimer));

  // A dead renderer leaves the BrowserWindow standing but blank, and on macOS
  // `window-all-closed` never fires for a window that was never closed: the
  // main process then lives on windowless, still holding the single-instance
  // lock, so every later `npm start` hands its session to a ghost and exits
  // without showing anything. Observed as `exit_code=9` kills of the renderer
  // and GPU helpers during a dev run. Reloading respawns the render process
  // over the same window, which is invisible to the user beyond a reload.
  //
  // A renderer that dies immediately on every attempt would spin here, so the
  // budget is small and only refills once a load actually survives: past it,
  // the window closes and the app quits, which is recoverable — a zombie is
  // not. `killed` is excluded from the budget's reset because a run that is
  // being torn down should not look like a healthy load.
  const RENDERER_RESPAWNS = 3;
  let respawnsLeft = RENDERER_RESPAWNS;
  window.webContents.on("did-finish-load", () => {
    respawnsLeft = RENDERER_RESPAWNS;
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.warn(`[renderer] gone ${JSON.stringify(details)}`);
    if (window.isDestroyed()) return;
    // `clean-exit` is the renderer going away because the window is on its way
    // out. Reloading that would resurrect a window the user just closed.
    if (details.reason === "clean-exit") return;
    if (respawnsLeft <= 0) {
      console.warn(
        `[renderer] gone ${RENDERER_RESPAWNS} times without a successful load; closing the window`,
      );
      window.close();
      return;
    }
    respawnsLeft -= 1;
    console.warn(`[renderer] reloading (${respawnsLeft} respawns left)`);
    window.webContents.reload();
  });

  if (process.platform === "darwin") {
    const syncWindowButtons = (): void =>
      syncMacWindowButtons(window, window.isFocused());
    window.on("focus", syncWindowButtons);
    window.on("blur", syncWindowButtons);
    window.webContents.once("did-finish-load", syncWindowButtons);
  }

  // Full screen takes the traffic lights away, so the renderer stops holding
  // their space open and starts its controls at the window edge instead.
  // macOS announces enter/leave only once its zoom animation has settled, and
  // freezes the web contents for the whole of it: told that late, the renderer
  // repositions on the first live frame afterwards, which reads as a jump.
  // The window snaps to its destination bounds in the first frames of the
  // animation with isFullScreen() already reporting the destination state
  // (measured ~25ms in, versus ~550ms), which is early enough for the renderer
  // to paint before the freeze and let the zoom cover the move. The dedupe
  // keeps ordinary drag-resizes from repeating the message.
  let sentFullscreen: boolean | undefined;
  const sendFullscreen = (): void => {
    if (window.isDestroyed()) return;
    const fullscreen = window.isFullScreen();
    if (fullscreen === sentFullscreen) return;
    sentFullscreen = fullscreen;
    window.webContents.send(channels.windowFullscreen, fullscreen);
  };
  window.on("resize", sendFullscreen);
  window.on("enter-full-screen", sendFullscreen);
  window.on("leave-full-screen", sendFullscreen);
  // A reload starts the renderer over without the attribute, so the sentinel
  // has to forget the last delivery along with it.
  window.webContents.on("did-finish-load", () => {
    sentFullscreen = undefined;
    sendFullscreen();
  });

  const windowSession = window.webContents.session;
  windowSession.setPermissionCheckHandler(
    (webContents, permission, _origin, details) =>
      webContents === window.webContents &&
      (permission === "geolocation" ||
        (permission === "media" && details.mediaType === "audio")),
  );
  windowSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const ownWindow = webContents === window.webContents;
      const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
      const audioOnly = permission === "media" &&
        mediaTypes?.length === 1 &&
        mediaTypes[0] === "audio";
      callback(ownWindow && (permission === "geolocation" || audioOnly));
    },
  );

  // `close` fires while the window is still alive; this is the last moment
  // the embedded browser can lift its pages out before they die with it.
  window.on("close", () => backend?.detachWindow());

  // The backend is app-scoped: created for the first window, reattached to
  // every later one, and closed only by quitting. Closing the window leaves
  // agent runs, MCP connections, storage, and messaging all running.
  if (backend) {
    backend.attachWindow(window);
  } else {
    backend = new DesktopBackend({
      dataDirectory: app.getPath("userData"),
      officialSkillDirectories: [officialSkillDirectory()],
      axReaderSourcePath: bundledResource("native", "ax-reader.swift"),
      hub: hub
        ? {homeserver: hub.homeserver, directory: hub.directory, bridges: hub.bridges}
        : undefined,
      window,
      ipcMain,
      model: modelFromEnvironment(),
    });
    backend.register();
    void backend
      .reloadMcp()
      .catch((error) => console.error("Could not load MCP configuration", error));
  }

  loadRenderer(window);
}

/**
 * Points a window at the renderer. Separate from `createWindow` because the
 * failed-load retry above needs to ask for exactly the same document again,
 * and a retry that quietly loaded something else would be worse than the blank
 * window it is trying to replace.
 */
function loadRenderer(window: BrowserWindow): void {
  const coldStart = !coldStartConsumed;
  coldStartConsumed = true;

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    url.searchParams.set("coldStart", coldStart ? "1" : "0");
    // `npm run start:onboarding` reopens first-run setup over this machine's
    // real profile without recording that it ran. Only the dev-server branch
    // reads it, so a packaged build has no way to reach it.
    if (process.env.FLAREAI_ONBOARDING === "1")
      url.searchParams.set("onboarding", "1");
    void window.loadURL(url.toString()).catch((error: unknown) => {
      // `did-fail-load` covers the retry; this only keeps the rejection from
      // surfacing as an unhandled promise on top of it.
      console.error(`[renderer] loadURL rejected: ${String(error)}`);
    });
  } else {
    void window
      .loadFile(
        path.join(
          currentDirectory,
          `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
        ),
        { query: { coldStart: coldStart ? "1" : "0" } },
      )
      .catch((error: unknown) => {
        console.error(`[renderer] loadFile rejected: ${String(error)}`);
      });
  }
}

/**
 * The message hub — embedded homeserver plus its supervised bridge children —
 * is app-scoped, not window-scoped: closing the window closes a backend, but
 * conversations keep flowing until the app actually quits. Quitting is the
 * one and only teardown.
 */
let hub: {homeserver: Homeserver; bridges: BridgeHost; directory: string} | undefined;

async function startHub(): Promise<NonNullable<typeof hub>> {
  const directory = path.join(app.getPath("userData"), "hub");
  // Before any bridge is discovered or started: which application a bridge
  // identifies itself as is decided at seed time, and a pair that arrived
  // after the config was written would not take effect until the next launch.
  // Bounded, and its own failure is not the hub's — the built-in pair covers
  // every way this can go wrong.
  await withTimeout(
    loadShippedCredentials({
      directory: app.getPath("userData"),
      host: process.env.FLAREAI_UPDATE_HOST ?? "https://updates.flarehq.co",
      log: (message) => console.warn(`[credentials] ${message}`),
    }),
    8_000,
    "shipped credentials",
  ).catch((): undefined => undefined);
  const homeserver = new Homeserver({
    serverName: "flareai.local",
    dataDirectory: directory,
    port: 47_664,
  });
  const bridges = new BridgeHost({
    directory: path.join(directory, "bridges"),
    // The bundled fleet first, then a writable directory of the user's own:
    // networks upstream ships no macOS build for (Google Chat, iMessage) can
    // be dropped in there and are picked up on the next launch.
    binariesDirectory: [bundledResource("bridges"), path.join(directory, "bin")],
    homeserver,
    log: (message) => console.warn(message),
  });
  await homeserver.start();
  // Only the bridges carrying an account. The rest of the fleet is started on
  // demand when its platform is opened, which keeps a dozen idle processes and
  // their databases off a machine that signed into two networks.
  void bridges.startLinked().catch((error: unknown) => {
    console.warn(`Bridges failed to start: ${error instanceof Error ? error.message : String(error)}`);
  });
  return {homeserver, bridges, directory};
}

/**
 * Rejects if `work` has not settled within `ms`. The work itself is not
 * cancellable, so a late arrival is shut down rather than left running: a
 * homeserver that finishes binding after we gave up on it would otherwise hold
 * port 47664 with nothing pointing at it, and the launch after this one would
 * hang on exactly the same step.
 */
async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  what: string,
  onLate?: (late: T) => unknown,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`${what} did not start within ${ms}ms; continuing without it`));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // Whatever the abandoned work eventually produces still has to be disposed
    // of; the caller knows how, because only it knows what it asked for.
    if (timedOut) void work.then((late) => onLate?.(late)).catch(() => {});
  }
}

app.whenReady().then(async () => {
  if (quitting) return;
  // No runtime Dock icon override: `dock.setIcon` draws the raw bitmap with
  // none of the system's icon shaping, which is exactly the unmasked-square
  // artifact it used to cause. Development gets its icon from the rebranded
  // bundle's ICNS (scripts/dev-app-name.mjs); packaged builds from their own.
  try {
    // Bounded, because the window is built after this and messaging is not
    // worth a UI for: a hub that hangs rather than failing — a port an
    // orphaned previous main process has not released yet, a bridge database
    // waiting on a lock — would otherwise hold the first window back forever,
    // which on screen is indistinguishable from the app refusing to start.
    hub = await withTimeout(startHub(), 10_000, "the embedded message hub", (late) =>
      Promise.allSettled([late.bridges.close(), late.homeserver.close()]),
    );
  } catch (error) {
    // A hub that cannot bind its port degrades messaging, nothing else.
    console.warn(`Embedded hub failed to start: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (quitting) return;
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Quitting means quitting: the bridges get their SIGTERM and the homeserver
// releases its port before the process exits. `will-quit` fires after every
// window (and thus every backend) has already closed.
let shutdownDone = false;
app.on("will-quit", (event) => {
  if (shutdownDone) return;
  shutdownDone = true;
  event.preventDefault();
  const closingBackend = backend;
  backend = undefined;
  const closingHub = hub;
  hub = undefined;
  void Promise.allSettled([
    closingBackend?.close(),
    closingHub?.bridges.close(),
    closingHub?.homeserver.close(),
  ]).finally(() => app.exit(0));
});

/**
 * `app.isPackaged` cannot pick this path: it merely checks that the executable
 * is not named "electron", and the development bundle is deliberately renamed
 * to "FlareAI" for the Dock (scripts/dev-app-name.mjs), which makes a dev run
 * look packaged and pointed skill loading at the bundle's empty Resources.
 * Probing for the directory that actually exists is launch-mode-proof.
 */
function officialSkillDirectory(): string {
  return bundledResource("skills", "official");
}

function bundledResource(...segments: string[]): string {
  const candidates = [
    path.join(process.resourcesPath, ...segments),
    path.join(app.getAppPath(), ...segments),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
