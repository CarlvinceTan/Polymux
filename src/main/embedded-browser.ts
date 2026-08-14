import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserDownloadDto, BrowserEventDto } from "@midas/protocol";
import { shell, WebContentsView, type BrowserWindow, type WebContents } from "electron";

/**
 * The workspace browser: one WebContentsView per browser tab, attached to the
 * app window and positioned under a rectangle the renderer measures. Real
 * Chromium contents rather than an iframe, so sites that refuse framing load,
 * and navigation state, find, print and capture all exist.
 *
 * The renderer owns which tab is visible and where it sits; this class owns
 * the views' lifecycle and reports page state back over a single event
 * channel.
 */
export class EmbeddedBrowser {
  readonly #window: BrowserWindow;
  readonly #views = new Map<string, WebContentsView>();
  readonly #downloads: BrowserDownloadDto[] = [];
  readonly #downloadsDir: string;
  readonly #send: (event: BrowserEventDto) => void;
  #downloadsWired = false;

  constructor(options: {
    window: BrowserWindow;
    downloadsDir: string;
    send: (event: BrowserEventDto) => void;
  }) {
    this.#window = options.window;
    this.#downloadsDir = options.downloadsDir;
    this.#send = options.send;
  }

  open(tabId: string, url?: string): void {
    if (this.#views.has(tabId)) {
      if (url) this.navigate(tabId, url);
      return;
    }
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.#views.set(tabId, view);
    this.#window.contentView.addChildView(view);
    // Zero-sized until the renderer reports where the tab's surface sits, so a
    // newly opened view never flashes over unrelated UI.
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    this.#wireDownloads(view.webContents);
    this.#wireState(tabId, view.webContents);
    if (url) this.navigate(tabId, url);
  }

  navigate(tabId: string, url: string): void {
    void this.#views.get(tabId)?.webContents.loadURL(url).catch(() => {
      // Unreachable hosts surface through Chromium's own error page.
    });
  }

  history(tabId: string, delta: -1 | 1): void {
    const contents = this.#views.get(tabId)?.webContents;
    if (!contents) return;
    if (delta === -1) contents.navigationHistory.goBack();
    else contents.navigationHistory.goForward();
  }

  reload(tabId: string): void {
    this.#views.get(tabId)?.webContents.reload();
  }

  setBounds(tabId: string, bounds: { x: number; y: number; width: number; height: number }): void {
    this.#views.get(tabId)?.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    });
  }

  setVisible(tabId: string, visible: boolean): void {
    this.#views.get(tabId)?.setVisible(visible);
  }

  close(tabId: string): void {
    const view = this.#views.get(tabId);
    if (!view) return;
    this.#views.delete(tabId);
    this.#window.contentView.removeChildView(view);
    view.webContents.close();
  }

  closeAll(): void {
    for (const tabId of [...this.#views.keys()]) this.close(tabId);
  }

  find(tabId: string, text: string, forward: boolean): void {
    if (!text) return;
    this.#views.get(tabId)?.webContents.findInPage(text, { forward, findNext: false });
  }

  stopFind(tabId: string): void {
    this.#views.get(tabId)?.webContents.stopFindInPage("clearSelection");
  }

  print(tabId: string): void {
    this.#views.get(tabId)?.webContents.print();
  }

  async screenshot(tabId: string): Promise<BrowserDownloadDto | null> {
    const contents = this.#views.get(tabId)?.webContents;
    if (!contents) return null;
    const image = await contents.capturePage();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(this.#downloadsDir, `Screenshot ${stamp}.png`);
    mkdirSync(this.#downloadsDir, { recursive: true });
    await writeFile(file, image.toPNG());
    return this.#recordDownload(file);
  }

  downloads(): BrowserDownloadDto[] {
    return [...this.#downloads];
  }

  openDownload(id: string): void {
    const entry = this.#downloads.find((download) => download.id === id);
    if (entry) void shell.openPath(entry.path);
  }

  openDownloadsFolder(): void {
    const latest = this.#downloads[0];
    if (latest) shell.showItemInFolder(latest.path);
    else void shell.openPath(this.#downloadsDir);
  }

  #wireState(tabId: string, contents: WebContents): void {
    const emit = (): void => {
      if (contents.isDestroyed()) return;
      this.#send({
        type: "state",
        state: {
          tabId,
          url: contents.getURL(),
          title: contents.getTitle(),
          canGoBack: contents.navigationHistory.canGoBack(),
          canGoForward: contents.navigationHistory.canGoForward(),
          loading: contents.isLoading(),
        },
      });
    };
    contents.on("did-navigate", emit);
    contents.on("did-navigate-in-page", emit);
    contents.on("page-title-updated", emit);
    contents.on("did-start-loading", emit);
    contents.on("did-stop-loading", emit);
    contents.on("found-in-page", (_event, result) => {
      this.#send({
        type: "found",
        found: { tabId, matches: result.matches, activeMatch: result.activeMatchOrdinal },
      });
    });
    // Target-blank links stay inside the same tab: the workspace browser has
    // no window management, and a denied popup would otherwise go nowhere.
    contents.setWindowOpenHandler(({ url }) => {
      this.navigate(tabId, url);
      return { action: "deny" };
    });
  }

  /** Session-wide download capture, wired once from the first view's session. */
  #wireDownloads(contents: WebContents): void {
    if (this.#downloadsWired) return;
    this.#downloadsWired = true;
    contents.session.on("will-download", (_event, item) => {
      mkdirSync(this.#downloadsDir, { recursive: true });
      item.setSavePath(path.join(this.#downloadsDir, item.getFilename()));
      item.once("done", (_doneEvent, state) => {
        if (state === "completed") this.#recordDownload(item.getSavePath());
      });
    });
  }

  #recordDownload(file: string): BrowserDownloadDto {
    const entry: BrowserDownloadDto = {
      id: crypto.randomUUID(),
      title: path.basename(file),
      path: file,
      kind: downloadKind(file),
      completedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    this.#downloads.unshift(entry);
    this.#send({ type: "downloads", downloads: this.downloads() });
    return entry;
  }
}

function downloadKind(file: string): BrowserDownloadDto["kind"] {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".heic"].includes(extension)) return "image";
  if ([".csv", ".xlsx", ".xls", ".numbers", ".tsv"].includes(extension)) return "spreadsheet";
  if ([".doc", ".docx", ".txt", ".md", ".rtf", ".pages"].includes(extension)) return "document";
  return "file";
}
