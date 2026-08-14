import { app, BrowserWindow, ipcMain } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import started from "electron-squirrel-startup";
import { DesktopBackend, modelFromEnvironment } from "./backend.js";
import {
  MIDAS_TRAFFIC_LIGHT_POSITION,
  syncMacWindowButtons,
} from "./window-buttons.js";

if (started) app.quit();

// The credential store, API-key pool, and SQLite database all live in one
// userData directory, and each instance caches them in memory: a second
// instance (say, a forgotten `npm start`) writes its stale cache back over
// the other's changes — observed losing a freshly saved API key. Hand the
// session to the instance that already owns the directory instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
}

// Development runs execute inside Electron.app, whose bundle name would
// otherwise appear as "Electron" in the macOS Dock tooltip.
app.setName("Midas");
process.title = "Midas";
// Electron does not always build Chromium's accessibility tree until assistive
// technology requests it. Keep the renderer tree available so macOS can expose
// Midas's labelled chat controls to VoiceOver and exact-window automation.
app.commandLine.appendSwitch("force-renderer-accessibility");
// Electron's geolocation provider reads GOOGLE_API_KEY before any renderer is
// created. Keep a Midas-specific variable available for packaged launches while
// still respecting Electron's documented variable when it is supplied.
if (!process.env.GOOGLE_API_KEY && process.env.MIDAS_GOOGLE_API_KEY)
  process.env.GOOGLE_API_KEY = process.env.MIDAS_GOOGLE_API_KEY;

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let backend: DesktopBackend | undefined;

function createWindow(): void {
  const window = new BrowserWindow({
    title: "Midas",
    width: 1000,
    height: 618,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#ffffff",
    // `hiddenInset` places the traffic lights on its own line, which does not
    // agree with the title bar's controls. `hidden` hands us the position, so
    // they align optically with the renderer controls. Native lights rasterise
    // around y=19 differently from SVG strokes, while the 28px app controls
    // render at y=12; these measured positions share the same visual line.
    titleBarStyle: process.platform === "darwin" ? "hidden" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? MIDAS_TRAFFIC_LIGHT_POSITION : undefined,
    webPreferences: {
      preload: path.join(currentDirectory, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.platform === "darwin") {
    const syncWindowButtons = (): void =>
      syncMacWindowButtons(window, window.isFocused());
    window.on("focus", syncWindowButtons);
    window.on("blur", syncWindowButtons);
    window.webContents.once("did-finish-load", syncWindowButtons);
  }

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

  backend = new DesktopBackend({
    dataDirectory: app.getPath("userData"),
    officialSkillDirectories: [officialSkillDirectory()],
    axReaderSourcePath: bundledResource("native", "ax-reader.swift"),
    window,
    ipcMain,
    model: modelFromEnvironment(),
  });
  backend.register();
  void backend
    .reloadMcp()
    .catch((error) => console.error("Could not load MCP configuration", error));
  window.once("closed", () => {
    const closing = backend;
    backend = undefined;
    void closing?.close();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(
      path.join(
        currentDirectory,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
      ),
    );
  }
}

app.whenReady().then(() => {
  // No runtime Dock icon override: `dock.setIcon` draws the raw bitmap with
  // none of the system's icon shaping, which is exactly the unmasked-square
  // artifact it used to cause. Development gets its icon from the rebranded
  // bundle's ICNS (scripts/dev-app-name.mjs); packaged builds from their own.
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/**
 * `app.isPackaged` cannot pick this path: it merely checks that the executable
 * is not named "electron", and the development bundle is deliberately renamed
 * to "Midas" for the Dock (scripts/dev-app-name.mjs), which makes a dev run
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
