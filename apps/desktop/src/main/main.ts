import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, screen } from "electron";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import {homeserverPortFor} from "./system/instance-port.js";
import {configuredRemoteDebuggingPort, requestsBackgroundLaunch} from "./system/launch-mode.js";
import { fileURLToPath } from "node:url";
import started from "electron-squirrel-startup";
import { channels } from "@polymux/protocol";
import { DesktopBackend, modelFromEnvironment, type DesktopBackendOptions } from "./backend.js";
import {builtinModels} from "@earendil-works/pi-ai/providers/all";
import {PiInference} from "@polymux/inference/pi";
import {EncryptedCredentialStore, OpenCodeCredentialFallback} from "./system/credential-store.js";
import {safeStorage} from "electron";
import { BridgeHost, Homeserver, WeChatBridge, WECHAT_FALLBACK_DIRECTORIES, loadShippedCredentials } from "@polymux/hub";
import { serveMedia } from "./hub/media.js";
import { PREVIEW_SCHEME, previewResponse } from "./workspace/preview.js";
import { registerPrivilegedSchemes } from "./system/schemes.js";
import { loadAgentPrompts } from "@polymux/agent";
import { coreSkillNames, installOfficialSkills } from "./skills/official.js";
import { exportNodeRuntime } from "./system/node-runtime.js";
import {
  POLYMUX_TRAFFIC_LIGHT_POSITION,
  syncMacWindowButtons,
} from "./system/window-buttons.js";

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

// A side instance: `npm start -- --isolated` (or any POLYMUX_DEV_INSTANCE
// value) runs a second Polymux that shares nothing with the one already open.
// Everything that makes two runs collide is keyed off the name — the userData
// directory, and with it Electron's single-instance lock, plus the hub's
// homeserver port — so an agent can start the app to check a change without
// evicting the session the user is sitting in front of.
const devInstance = process.env.POLYMUX_DEV_INSTANCE?.trim();
if (devInstance) {
  app.setPath("userData", `${app.getPath("userData")}-${devInstance}`);
}
const backgroundLaunch = requestsBackgroundLaunch({
  platform: process.platform,
  argv: process.argv,
  hasSwitch: (name) => app.commandLine.hasSwitch(name),
  environment: process.env,
});
const providerProbe = process.argv.includes("--polymux-provider-probe");
if (process.platform === "darwin") {
  if (providerProbe) app.setActivationPolicy("prohibited");
  // Apply this before app readiness. `open -g` asks Launch Services not to
  // activate us, but a regular Electron application can still become active
  // during cold start before its BrowserWindow exists. Accessory applications
  // retain a real, accessibility-visible window without being eligible to
  // displace the user's foreground application.
  else if (backgroundLaunch) app.setActivationPolicy("accessory");
}
const environmentDebuggingPort = configuredRemoteDebuggingPort(
  process.env.POLYMUX_REMOTE_DEBUGGING_PORT,
);
if (environmentDebuggingPort !== null && !app.commandLine.hasSwitch("remote-debugging-port"))
  app.commandLine.appendSwitch("remote-debugging-port", String(environmentDebuggingPort));
const orchestrationExperiment =
  process.env.POLYMUX_ORCHESTRATION_EXPERIMENT === "1" ||
  app.commandLine.hasSwitch("orchestration-experiment") ||
  process.argv.includes("--orchestration-experiment");
if (devInstance)
  console.log("Polymux launch mode", {
    orchestrationExperiment,
    experimentEnvironment: process.env.POLYMUX_ORCHESTRATION_EXPERIMENT === "1",
    experimentElectronSwitch: app.commandLine.hasSwitch("orchestration-experiment"),
    experimentArgument: process.argv.includes("--orchestration-experiment"),
    preloadOfficialSkillExperiment:
      process.env.POLYMUX_PRELOAD_OFFICIAL_SKILL_EXPERIMENT === "1",
  });
// The unsigned benchmark bundle must not open the ordinary encrypted
// credential files with a different Keychain identity. Its SQLite/session
// state is disposable, while skills and MCP configuration deliberately remain
// in the ordinary ~/.polymux home.
if (backgroundLaunch && !devInstance)
  app.setPath("userData", `${app.getPath("userData")}-background-benchmark`);

/**
 * The port the embedded homeserver listens on: 47664 for the ordinary run,
 * 47865 for the packaged background benchmark, and a deterministic offset for
 * a named side instance. Deterministic
 * rather than "any free port" because the bridge configs on disk name the
 * homeserver by URL, so the same instance has to come back on the same port.
 */
function homeserverPort(): number {
  return homeserverPortFor(devInstance, backgroundLaunch);
}

// The credential store, API-key pool, and SQLite database all live in one
// userData directory, and each instance caches them in memory: a second
// instance (say, a forgotten `npm start`) writes its stale cache back over
// the other's changes — observed losing a freshly saved API key. Hand the
// session to the instance that already owns the directory instead.
// The provider probe reads only the encrypted credential and exits. It must be
// able to run alongside the user's signed app: acquiring its single-instance
// lock would instead hand off to that UI process and silently skip the probe.
if (!providerProbe && !app.requestSingleInstanceLock()) {
  // Say so. This instance dies before it ever builds a window, so without a
  // line here `npm start` looks hung: the dev server stays up, the terminal
  // goes quiet, and the only Polymux on screen is the older instance still
  // running its older bundle.
  console.error(
    "Polymux is already running, so this instance is handing the session over " +
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
app.setName("Polymux");
process.title = "Polymux";
// Electron does not always build Chromium's accessibility tree until assistive
// technology requests it. Keep the renderer tree available so macOS can expose
// Polymux's labelled chat controls to VoiceOver and exact-window automation.
app.commandLine.appendSwitch("force-renderer-accessibility");
// Electron's geolocation provider reads GOOGLE_API_KEY before any renderer is
// created. Keep a Polymux-specific variable available for packaged launches while
// still respecting Electron's documented variable when it is supplied.
if (!process.env.GOOGLE_API_KEY && process.env.POLYMUX_GOOGLE_API_KEY)
  process.env.GOOGLE_API_KEY = process.env.POLYMUX_GOOGLE_API_KEY;

// The interpreter the skill scripts run under (`"${POLYMUX_NODE:-node}"`):
// the bundled runtime in a packaged app, the dev Electron in a checkout. Set
// before anything spawns a shell so every agent subprocess inherits it. After
// the devInstance block above on purpose — the dev wrapper is written into
// this instance's own userData.
if (
  !exportNodeRuntime({
    bundledNode: bundledResource("node", process.platform === "win32" ? "node.exe" : "node"),
    checkoutMarker: path.join(app.getAppPath(), "resources", "skills"),
    execPath: process.execPath,
    wrapperDirectory: path.join(app.getPath("userData"), "bin"),
  })
)
  console.warn(
    "No bundled Node runtime and no checkout to borrow one from; " +
      "skill scripts fall back to `node` from PATH.",
  );

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let backend: DesktopBackend | undefined;
// The startup splash covers the first paint of a cold launch. Reopening a
// window on an already-running app (macOS Dock activate) has nothing to cover,
// so the renderer is told which kind of launch it is.
let coldStartConsumed = false;
let startupShellWindow: BrowserWindow | undefined;

/** Paints the real startup animation before app-scoped services are ready.
 * The document deliberately does not mount Svelte or call IPC; it simply
 * settles on the animation's end pose and stays there until the real window
 * has rendered its first complete frame. */
function createStartupShellWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "Polymux",
    width: 1000,
    height: 618,
    minWidth: 973,
    minHeight: 672,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff",
    titleBarStyle: process.platform === "darwin" ? "hidden" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? POLYMUX_TRAFFIC_LIGHT_POSITION : undefined,
    webPreferences: {
      preload: path.join(currentDirectory, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const reveal = (): void => {
    if (window.isDestroyed() || window.isVisible()) return;
    if (backgroundLaunch) {
      window.setOpacity(0);
      window.setIgnoreMouseEvents(true);
      window.showInactive();
    } else if (devInstance) window.showInactive();
    else window.show();
    void window.webContents.executeJavaScript(
      'document.documentElement.dataset.splash = "playing"',
      true,
    ).catch(() => {});
  };
  const deadline = setTimeout(reveal, 4000);
  window.once("ready-to-show", () => {
    clearTimeout(deadline);
    reveal();
  });
  window.once("closed", () => clearTimeout(deadline));
  loadStartupShell(window);
  return window;
}

function loadStartupShell(window: BrowserWindow): void {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    url.searchParams.set("splashOnly", "1");
    void window.loadURL(url.toString()).catch((error: unknown) =>
      console.error(`[startup-shell] loadURL rejected: ${String(error)}`));
  } else {
    void window.loadFile(
      path.join(currentDirectory, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      {query: {splashOnly: "1"}},
    ).catch((error: unknown) =>
      console.error(`[startup-shell] loadFile rejected: ${String(error)}`));
  }
}

type SeparateWorkspaceView = "drive" | "schedule" | "hub" | "tasks";
type WorkspaceWindowPlacement = {x: number; y: number; width?: number; height?: number};

const DETACHED_WINDOW_WIDTH = 1000;
const DETACHED_WINDOW_HEIGHT = 672;

function detachedWindowBounds(
  placement?: WorkspaceWindowPlacement,
): WorkspaceWindowPlacement | undefined {
  if (!placement) return undefined;
  const point = {x: Math.round(placement.x), y: Math.round(placement.y)};
  const {workArea} = screen.getDisplayNearestPoint(point);
  const width = Math.min(
    Math.max(Math.round(placement.width ?? DETACHED_WINDOW_WIDTH), 360),
    workArea.width,
  );
  const height = Math.min(
    Math.max(Math.round(placement.height ?? DETACHED_WINDOW_HEIGHT), 320),
    workArea.height,
  );
  return {
    x: Math.min(
      Math.max(point.x, workArea.x),
      workArea.x + Math.max(0, workArea.width - width),
    ),
    y: Math.min(
      Math.max(point.y, workArea.y),
      workArea.y + Math.max(0, workArea.height - height),
    ),
    width,
    height,
  };
}

function createWindow(
  workspaceView?: SeparateWorkspaceView,
  conversationId?: string,
  placement?: WorkspaceWindowPlacement,
): BrowserWindow {
  const bounds = detachedWindowBounds(placement);
  const window = new BrowserWindow({
    title: "Polymux",
    width: bounds?.width ?? DETACHED_WINDOW_WIDTH,
    height: bounds?.height ?? 618,
    x: bounds?.x,
    y: bounds?.y,
    // The floor where the split layout still reads: history at its 180px
    // minimum, the conversation at its 432px measure and the workspace at its
    // 360px minimum, which is SPLIT_LAYOUT_MIN_WIDTH in the renderer's
    // layoutSizing — keep the two in step.
    minWidth: workspaceView ? 360 : 973,
    // The welcome composer sits on the window's centre line, so its menus open
    // downward into the lower half. 672px leaves the tallest of them (the model
    // menu, five rows) 28px clear of the bottom edge, and pairs with the width
    // at a 1.45 ratio rather than a letterbox.
    minHeight: workspaceView ? 320 : 672,
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
      process.platform === "darwin" ? POLYMUX_TRAFFIC_LIGHT_POSITION : undefined,
    webPreferences: {
      preload: path.join(currentDirectory, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // First frame ready — the splash is painted — so the window can appear
  // showing it. The deadline covers a renderer that never reaches its first
  // paint (a broken dev bundle, a hung load): a visible broken window can be
  // diagnosed, an invisible one just looks like the app refused to start.
  let appReadyPoll: NodeJS.Timeout | undefined;
  let appReadyChecking = false;
  const reveal = (readyChecked = false): void => {
    if (window.isDestroyed() || window.isVisible()) return;
    if (!readyChecked && startupShellWindow && !startupShellWindow.isDestroyed()) {
      if (appReadyChecking) return;
      appReadyChecking = true;
      // The real app being ready is only one half of the handoff. The startup
      // shell may still be drawing its mark, so keep it on screen until its
      // complete sequence has reached the settled end pose as well.
      void Promise.all([
        window.webContents.executeJavaScript(
          'document.documentElement.dataset.appReady === "true"',
          true,
        ) as Promise<boolean>,
        startupShellWindow.webContents.executeJavaScript(
          'document.documentElement.dataset.splash === "done"',
          true,
        ) as Promise<boolean>,
      ]).then(([appReady, splashDone]) => {
        appReadyChecking = false;
        if (appReady && splashDone) reveal(true);
        else appReadyPoll = setTimeout(reveal, 50);
      }).catch(() => {
        appReadyChecking = false;
        appReadyPoll = setTimeout(reveal, 50);
      });
      return;
    }
    // A side instance is an agent's test run, opened beside the window the user
    // is working in. A packaged app launched with macOS' background/hidden
    // launch flag has the same contract: honour that launch request instead of
    // undoing it with BrowserWindow.show(), which activates the app even when
    // `open -g -j` correctly started it in the background. Ordinary launches,
    // including onboarding, still show and focus as normal.
    if (backgroundLaunch) {
      // A hidden (`open -j`) Electron application cannot reliably paint or
      // expose its renderer through Accessibility. The background launcher
      // therefore uses `open -g` and this explicit switch: Launch Services
      // keeps the app nonfrontmost while Electron reveals the window inactive.
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
      // Keep the automation surface present for AX even when the foreground
      // app owns a fullscreen Space, without painting over or intercepting the
      // user's work there.
      window.setOpacity(0);
      window.setIgnoreMouseEvents(true);
      window.showInactive();
    } else if (devInstance)
      window.showInactive();
    else window.show();
    if (startupShellWindow && !startupShellWindow.isDestroyed()) {
      startupShellWindow.close();
      startupShellWindow = undefined;
    }
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
  window.once("closed", () => {
    clearTimeout(showDeadline);
    clearTimeout(appReadyPoll);
  });

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
            "Check that the dev server is up and quit any other running Polymux.",
        );
        return;
      }
      retriesLeft -= 1;
      retryTimer = setTimeout(() => {
        if (window.isDestroyed()) return;
        console.error(`[renderer] retrying the load (${retriesLeft} attempts left)`);
        loadRenderer(window, workspaceView, conversationId);
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

  // Permission handling belongs to the backend's SitePermissions, installed
  // when the window attaches. It has to be one place: the app window and every
  // browser tab share this session, so a handler written for the window alone
  // denied every page in every tab with no way to grant.

  // `close` fires while the window is still alive; this is the last moment
  // the embedded browser can lift its pages out before they die with it.
  // A detached workspace window shares the app backend, but it must not steal
  // ownership of the embedded-browser surface from the main conversation
  // window or detach that surface when the detached window closes.
  const ownsBackendWindow = !backend || !workspaceView;
  if (ownsBackendWindow) window.on("close", () => backend?.detachWindow());
  else {
    // `closed` runs after Electron has destroyed the BrowserWindow. Reading
    // window.webContents there throws during a multi-window Cmd+Q, turning an
    // ordinary quit into an uncaught main-process failure. Capture the stable
    // id while the window is alive and remove that trust record by value.
    const trustedWebContentsId = window.webContents.id;
    window.on("closed", () => backend?.untrustWindow(trustedWebContentsId));
  }

  // The backend is app-scoped: created for the first window, reattached to
  // every later one, and closed only by quitting. Closing the window leaves
  // agent runs, MCP connections, storage, and messaging all running.
  if (backend) {
    if (ownsBackendWindow) backend.attachWindow(window);
    else backend.trustWindow(window);
  } else {
    backend = createDesktopBackend(window, true, true);
  }

  loadRenderer(window, workspaceView, conversationId);
  return window;
}

function desktopBackendOptions(window: BrowserWindow): Omit<DesktopBackendOptions, "reloadForProfileChange"> {
  return {
      dataDirectory: app.getPath("userData"),
      officialSkillDirectories: [officialSkillDirectory()],
      coreSkills: coreSkillNames(bundledResource("skills", "core")),
      // Polymux's own prompts travel as files beside the skills — same bundle,
      // neither tier, never mirrored into the user's skills directory.
      agentPrompts: loadAgentPrompts(
        bundledResource("prompts"),
        orchestrationExperiment
          ? bundledResource("prompts", "experiments", "orchestration")
          : undefined,
      ),
      orchestrationExperiment,
      suppressSystemNotifications: backgroundLaunch,
      suppressAutomaticUpdateChecks: backgroundLaunch,
      axReaderSourcePath: bundledResource("native", "ax-reader.swift"),
      axEventsSourcePath: bundledResource("native", "ax-events.swift"),
      pillImageSourcePath: bundledResource("native", "pill-image.swift"),
      appPermissionsSourcePath: bundledResource("native", "app-permissions.swift"),
      contactsSourcePath: bundledResource("native", "contacts.swift"),
      remindersSourcePath: bundledResource("native", "reminders.swift"),
      hub: hub
        ? {
            homeserver: hub.homeserver,
            directory: hub.directory,
            bridges: hub.bridges,
            startWeChat: (owner: string) => wechat!.start(owner),
            stopWeChat: () => wechat!.close(),
            onActivity: (listener) => {
              onHubActivity = listener;
            },
          }
        : undefined,
      window,
      ipcMain,
      model: modelFromEnvironment(),
  };
}

function createDesktopBackend(window: BrowserWindow, loadMcp = true, selectDefaultProfile = false): DesktopBackend {
  let instance!: DesktopBackend;
  instance = new DesktopBackend({
    ...desktopBackendOptions(window),
    selectDefaultProfile,
    reloadForProfileChange: () => void replaceDesktopBackend(instance, window),
  });
  instance.register();
  if (loadMcp)
    void instance.reloadMcp().catch((error) => console.error("Could not load MCP configuration", error));
  return instance;
}

async function replaceDesktopBackend(previous: DesktopBackend, window: BrowserWindow): Promise<void> {
  if (backend !== previous || quitting || window.isDestroyed()) return;
  await previous.close("Configuration profile changed");
  if (backend !== previous || quitting || window.isDestroyed()) return;
  const next = createDesktopBackend(window, false);
  backend = next;
  for (const candidate of BrowserWindow.getAllWindows()) {
    if (candidate !== window && !candidate.isDestroyed()) next.trustWindow(candidate);
  }
  await next.reloadMcp().catch((error) => console.error("Could not load MCP configuration", error));
  if (!window.isDestroyed()) window.webContents.send(channels.profilesChanged, next.profileSnapshot());
}

ipcMain.handle(channels.windowOpenWorkspaceView, (
  event,
  value: unknown,
  conversationId: unknown,
  placement: unknown,
) => {
  const sourceWindow = BrowserWindow.fromWebContents(event.sender);
  if (!sourceWindow || event.senderFrame !== event.sender.mainFrame)
    throw new Error("Rejected IPC from an untrusted frame");
  if (value !== "drive" && value !== "schedule" && value !== "hub" && value !== "tasks")
    throw new Error("Unknown workspace view");
  if (conversationId !== undefined && typeof conversationId !== "string")
    throw new Error("Invalid conversation id");
  if (placement !== undefined && (
    typeof placement !== "object" || placement === null
    || typeof (placement as WorkspaceWindowPlacement).x !== "number"
    || !Number.isFinite((placement as WorkspaceWindowPlacement).x)
    || typeof (placement as WorkspaceWindowPlacement).y !== "number"
    || !Number.isFinite((placement as WorkspaceWindowPlacement).y)
    || ((placement as WorkspaceWindowPlacement).width !== undefined
      && (typeof (placement as WorkspaceWindowPlacement).width !== "number"
        || !Number.isFinite((placement as WorkspaceWindowPlacement).width)
        || (placement as WorkspaceWindowPlacement).width! <= 0))
    || ((placement as WorkspaceWindowPlacement).height !== undefined
      && (typeof (placement as WorkspaceWindowPlacement).height !== "number"
        || !Number.isFinite((placement as WorkspaceWindowPlacement).height)
        || (placement as WorkspaceWindowPlacement).height! <= 0))
  )) throw new Error("Invalid workspace window placement");
  const validPlacement = placement as WorkspaceWindowPlacement | undefined;
  createWindow(
    value,
    typeof conversationId === "string" ? conversationId : undefined,
    validPlacement,
  );
});

/**
 * Points a window at the renderer. Separate from `createWindow` because the
 * failed-load retry above needs to ask for exactly the same document again,
 * and a retry that quietly loaded something else would be worse than the blank
 * window it is trying to replace.
 */
function loadRenderer(window: BrowserWindow, workspaceView?: SeparateWorkspaceView, conversationId?: string): void {
  const coldStart = !coldStartConsumed;
  coldStartConsumed = true;

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    url.searchParams.set("coldStart", coldStart ? "1" : "0");
    if (workspaceView) url.searchParams.set("workspaceView", workspaceView);
    if (conversationId) url.searchParams.set("conversationId", conversationId);
    // `npm run onboarding` reopens first-run setup over this machine's
    // real profile without recording that it ran. Only the dev-server branch
    // reads it, so a packaged build has no way to reach it.
    if (process.env.POLYMUX_ONBOARDING === "1")
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
        { query: {
          coldStart: coldStart ? "1" : "0",
          ...(workspaceView ? {workspaceView} : {}),
          ...(conversationId ? {conversationId} : {}),
        } },
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
/**
 * Where conversation traffic is announced. The homeserver is built before the
 * window exists, so it reports into this and the backend puts the real
 * listener in once there is somewhere to send it.
 */
let onHubActivity:
  | ((activity: {
      roomId: string;
      sender: string;
      senderName: string | null;
      type: string;
      ts: number;
    }) => void)
  | undefined;
/** WeChat has no binary to supervise, so its bridge runs here. */
let wechat: WeChatBridge | undefined;

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
      host: process.env.POLYMUX_UPDATE_FEED_URL ?? "https://polymux.com/api/releases",
      log: (message) => console.warn(`[credentials] ${message}`),
    }),
    8_000,
    "shipped credentials",
  ).catch((): undefined => undefined);
  const homeserver = new Homeserver({
    serverName: "polymux.local",
    dataDirectory: directory,
    port: homeserverPort(),
    onActivity: (activity) => onHubActivity?.(activity),
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
  // No binary to supervise for WeChat, and no account to log into: it is a
  // relay against the desktop app. Started on demand rather than here, because
  // portal rooms belong to Polymux's Matrix user and that does not exist yet.
  wechat = new WeChatBridge({
    homeserver,
    directory: path.join(directory, "bridges"),
    // The bundled copy first, then a writable directory of the user's own —
    // the same order the bridge fleet uses, and for the same reason: an
    // install must not depend on what happens to be on the machine.
    binaryDirectories: [
      bundledResource("wechat"),
      path.join(directory, "bin"),
      ...WECHAT_FALLBACK_DIRECTORIES,
    ],
    log: (line) => console.warn(line),
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

// Before ready, which is the only moment a scheme can be made privileged —
// without it `<audio>` and `<video>` cannot seek within a bridged voice note
// or a previewed clip.
registerPrivilegedSchemes();

async function runProviderProbe(): Promise<number> {
  const provider = "openai-codex";
  const model = "gpt-5.6-luna";
  const started = Date.now();
  const credentials = new OpenCodeCredentialFallback(new EncryptedCredentialStore(
    path.join(app.getPath("userData"), "credentials.json"),
    safeStorage,
  ));
  const inference = new PiInference(builtinModels({credentials}));
  let answer = "";
  let failure: {code: string; retryable: boolean} | null = null;
  for await (const event of inference.stream({
    model: {provider, id: model},
    messages: [{role: "user", content: [{type: "text", text: "Reply exactly READY."}]}],
    reasoning: "low",
    maxOutputTokens: 16,
    timeoutMs: 20_000,
    maxRetries: 0,
  })) {
    if (event.type === "textDelta") answer += event.delta;
    // textEnd contains the complete block, not another delta.
    if (event.type === "textEnd") answer = event.text;
    if (event.type === "error") failure = {code: event.error.code, retryable: event.error.retryable};
  }
  const status = answer.trim() === "READY" ? "ready" : failure?.code ?? "probe_failed";
  process.stdout.write(`${JSON.stringify({
    version: 1,
    capturedAt: new Date().toISOString(),
    model: `${provider}/${model}`,
    reasoning: "low",
    latencyMs: Date.now() - started,
    status,
    retryable: failure?.retryable ?? false,
  }, null, 2)}\n`);
  return status === "ready" ? 0 : 3;
}

function writeProviderProbeFailure(status: string): void {
  process.stdout.write(`${JSON.stringify({
    version: 1,
    capturedAt: new Date().toISOString(),
    model: "openai-codex/gpt-5.6-luna",
    reasoning: "low",
    latencyMs: 0,
    status,
    retryable: false,
  }, null, 2)}\n`);
}

app.whenReady().then(async () => {
  if (quitting) return;
  if (providerProbe) {
    const code = await runProviderProbe().catch((error) => {
      // The outer preflight deliberately discards stderr, but the signed route
      // should still give it a structured, secret-free reason to stop.
      void error;
      writeProviderProbeFailure("credential_unavailable");
      return 3;
    });
    app.exit(code);
    return;
  }
  // Polymux is designed to be controllable through exact-window accessibility
  // whether its window was launched normally or in the background. Electron
  // otherwise waits for an assistive client to attach and can leave a running
  // normal window with no semantic tree after a fullscreen/Space transition.
  app.setAccessibilitySupportEnabled(true);
  startupShellWindow = createStartupShellWindow();
  // The shell owns the only cold-start animation. The real renderer mounts
  // invisibly behind it and replaces it only after `ready-to-show`, avoiding a
  // restarted animation or a blank handoff.
  coldStartConsumed = true;
  // Bridged media is fetched by the main process, which holds the token the
  // renderer never sees. Read per request, so a later sign-in is picked up.
  serveMedia(() => backend?.mediaAuth ?? {homeserverUrl: "", token: null});
  // A produced file is streamed to the page the same way, and for the same
  // reason: an <img> cannot reach the disk, and a data: uri would hold a whole
  // clip in memory. Range is forwarded or a <video> could play but not seek.
  protocol.handle(PREVIEW_SCHEME, async (request) => {
    if (!backend) return new Response("Not granted", {status: 404});
    return previewResponse(
      backend.previewGrants,
      request,
      (url, init) => net.fetch(url, init),
      async (file) => (await stat(file)).size,
    );
  });
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
  const closingWeChat = wechat;
  wechat = undefined;
  void Promise.allSettled([
    closingBackend?.close(),
    closingWeChat?.close(),
    closingHub?.bridges.close(),
    closingHub?.homeserver.close(),
  ]).finally(() => app.exit(0));
});

/**
 * `app.isPackaged` cannot pick this path: it merely checks that the executable
 * is not named "electron", and the development bundle is deliberately renamed
 * to "Polymux" for the Dock (scripts/dev-app-name.mjs), which makes a dev run
 * look packaged and pointed skill loading at the bundle's empty Resources.
 * Probing for the directory that actually exists is launch-mode-proof.
 *
 * The bundle is only the source: skills are loaded from the mirror under
 * `~/.polymux`, so every skill the app runs lives in the user's own directory.
 */
function officialSkillDirectory(): string {
  return installOfficialSkills([
    bundledResource("skills", "core"),
    bundledResource("skills", "official"),
  ]);
}

/**
 * A path inside `resources/` — the skills, the native helpers and the bridge
 * binaries, everything shipped beside the code rather than bundled into it.
 * The tree is copied wholesale by `extraResource`, so the same segments
 * resolve in a packaged app and in a checkout; the prefix lives here so call
 * sites name what they want rather than where the packager put it.
 */
function bundledResource(...segments: string[]): string {
  const candidates = [
    path.join(process.resourcesPath, "resources", ...segments),
    path.join(app.getAppPath(), "resources", ...segments),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
