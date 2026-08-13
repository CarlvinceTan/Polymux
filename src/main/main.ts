import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import started from "electron-squirrel-startup";
import { DesktopBackend, modelFromEnvironment } from "./backend.js";
import {
  MIDAS_TRAFFIC_LIGHT_POSITION,
  syncMacWindowButtons,
} from "./window-buttons.js";

if (started) app.quit();

// Development runs execute inside Electron.app, whose bundle name would
// otherwise appear as "Electron" in the macOS Dock tooltip.
app.setName("Midas");
process.title = "Midas";
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
    officialSkillDirectories: [
      path.join(
        app.isPackaged ? process.resourcesPath : app.getAppPath(),
        "skills",
        "official",
      ),
    ],
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
  // The packaged bundle already supplies its multi-resolution ICNS to macOS.
  // Only Electron's development host needs a runtime override; its Dock API
  // does not reliably decode ICNS paths, so give it the directly rendered
  // 1024px PNG instead. Never let a cosmetic override prevent startup.
  if (process.platform === "darwin" && !app.isPackaged) {
    const dockIcon = path.join(app.getAppPath(), "assets", "appicon.png");
    try {
      app.dock.setIcon(dockIcon);
    } catch (error) {
      console.warn("Could not set the development Dock icon", error);
    }
  }

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
