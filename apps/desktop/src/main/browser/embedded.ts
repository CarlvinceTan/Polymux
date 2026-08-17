import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserDownloadDto, BrowserEventDto } from "@flareai/protocol";
import { nativeTheme, shell, WebContentsView, type BrowserWindow, type WebContents } from "electron";
import { clearFaviconCache, tabFaviconDataUrl } from "./favicon.js";

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
  #window: BrowserWindow;
  readonly #views = new Map<string, WebContentsView>();
  readonly #downloads: BrowserDownloadDto[] = [];
  readonly #downloadsDir: string;
  readonly #send: (event: BrowserEventDto) => void;
  /** One per live tab, re-resolving that tab's icon for the current scheme. */
  readonly #faviconRefreshers = new Map<string, () => void>();
  #downloadsWired = false;

  constructor(options: {
    window: BrowserWindow;
    downloadsDir: string;
    send: (event: BrowserEventDto) => void;
  }) {
    this.#window = options.window;
    this.#downloadsDir = options.downloadsDir;
    this.#send = options.send;
    // Sites serve a different mark per colour scheme, so a theme change makes
    // every icon on screen the one chosen for the theme the user just left.
    // Settings clears the cache when the *preference* changes, which is a
    // different event: under 'system' the preference never moves and the
    // appearance does, so without this an OS flip would leave a whole strip of
    // tabs holding the wrong mark until each happened to navigate.
    nativeTheme.on("updated", () => {
      clearFaviconCache();
      for (const refresh of this.#faviconRefreshers.values()) refresh();
    });
  }

  /**
   * Re-homes the browser onto a new app window. The old window's destruction
   * took the hosted views' webContents with it, so surviving map entries are
   * corpses to sweep, not tabs to migrate.
   */
  attachWindow(window: BrowserWindow): void {
    this.#window = window;
    for (const [tabId, view] of [...this.#views]) {
      if (view.webContents.isDestroyed()) this.#views.delete(tabId);
      else window.contentView.addChildView(view);
    }
  }

  /**
   * Lifts every view out of the window before it is destroyed, so the pages —
   * webContents and all — survive a window close and re-home on the next one.
   * Must run on the window's `close` event; after `closed` it is too late.
   */
  detachWindow(): void {
    if (this.#window.isDestroyed()) return;
    for (const view of this.#views.values()) this.#window.contentView.removeChildView(view);
  }

  open(tabId: string, url?: string): void {
    const existing = this.#views.get(tabId);
    if (existing) {
      // A remount re-opens tabs it already knows about. Navigating again would
      // discard the live page state the detach/attach cycle just preserved,
      // so only a view with nothing loaded takes the url.
      if (url && !existing.webContents.getURL()) this.navigate(tabId, url);
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
    this.#faviconRefreshers.delete(tabId);
    if (!this.#window.isDestroyed()) this.#window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.#send({ type: "closed", tabId });
  }

  closeAll(): void {
    for (const tabId of [...this.#views.keys()]) this.close(tabId);
  }

  /* ---- Agent control -------------------------------------------------- */

  /** Tabs the agent can act on, newest last. */
  tabs(): Array<{ tabId: string; url: string; title: string }> {
    return [...this.#views]
      .filter(([, view]) => !view.webContents.isDestroyed())
      .map(([tabId, view]) => ({
        tabId,
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
      }));
  }

  /**
   * Opens a tab on the agent's behalf. The renderer learns about it through the
   * `opened` event and gives it a workspace tab, so the user sees the page the
   * agent is working in rather than a hidden view.
   */
  async openAgentTab(url: string, show = false): Promise<{ tabId: string; url: string; title: string }> {
    const tabId = crypto.randomUUID();
    this.open(tabId, url);
    this.#send({ type: "opened", tab: { tabId, url, title: "" }, show });
    return this.settle(tabId);
  }

  /** Brings an existing agent tab to the front of the workspace — what "show
   * me the page" asks for once the tab is already open. */
  reveal(tabId: string): void {
    const page = this.pageInfo(tabId);
    this.#send({ type: "opened", tab: page, show: true });
  }

  /** Resolves once the page stops loading, or after `timeoutMs` either way —
   * a page that never finishes is still readable. */
  async settle(tabId: string, timeoutMs = 15_000): Promise<{ tabId: string; url: string; title: string }> {
    const contents = this.#contents(tabId);
    if (contents && contents.isLoading())
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          contents.off("did-stop-loading", done);
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        contents.once("did-stop-loading", done);
      });
    return this.pageInfo(tabId);
  }

  pageInfo(tabId: string): { tabId: string; url: string; title: string } {
    const contents = this.#contents(tabId);
    return {
      tabId,
      url: contents?.getURL() ?? "",
      title: contents?.getTitle() ?? "",
    };
  }

  /** The page's visible text, trimmed to what a tool result can carry. */
  async readPage(tabId: string, maxChars: number): Promise<string> {
    return this.#run<string>(tabId, `(() => {
      const root = document.querySelector('main, article') ?? document.body;
      return (root?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim().slice(0, ${Math.max(1, Math.floor(maxChars))});
    })()`);
  }

  async click(tabId: string, selector: string): Promise<boolean> {
    return this.#run<boolean>(tabId, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.scrollIntoView({block: 'center'});
      element.click();
      return true;
    })()`);
  }

  async type(tabId: string, selector: string, text: string, submit: boolean): Promise<boolean> {
    return this.#run<boolean>(tabId, `(() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      if (!field) return false;
      field.focus();
      const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value')?.set;
      // React and friends listen for the native setter, not a plain assignment.
      if (setter) setter.call(field, ${JSON.stringify(text)});
      else field.value = ${JSON.stringify(text)};
      field.dispatchEvent(new Event('input', {bubbles: true}));
      field.dispatchEvent(new Event('change', {bubbles: true}));
      if (${submit ? "true" : "false"}) {
        field.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
        field.form?.requestSubmit?.();
      }
      return true;
    })()`);
  }

  async scroll(tabId: string, deltaY: number): Promise<boolean> {
    return this.#run<boolean>(tabId, `(() => { window.scrollBy(0, ${Math.round(deltaY)}); return true; })()`);
  }

  #contents(tabId: string): WebContents | null {
    const contents = this.#views.get(tabId)?.webContents;
    return contents && !contents.isDestroyed() ? contents : null;
  }

  /** Evaluated in the page's own main world, so whatever comes back is page
   * content: untrusted data for the agent to read, never instructions. */
  async #run<T>(tabId: string, script: string): Promise<T> {
    const contents = this.#contents(tabId);
    if (!contents) throw new Error(`No such browser tab: ${tabId}`);
    return contents.executeJavaScript(script, true) as Promise<T>;
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
    // The icon the page declares, and the bytes fetched for it. They are kept
    // apart because the fetch is async: a second navigation can land while the
    // first page's icon is still in flight, and only the icon that still
    // belongs to the current page may be shown.
    let faviconSource: string | null = null;
    let faviconUrl: string | null = null;
    // Bumped by everything that invalidates a resolution already in flight — a
    // navigation, a newly reported icon, a theme change — so a late answer to a
    // superseded question is dropped rather than painted over the current page.
    let faviconRequest = 0;
    const emit = (): void => {
      if (contents.isDestroyed()) return;
      this.#send({
        type: "state",
        state: {
          tabId,
          url: contents.getURL(),
          title: contents.getTitle(),
          faviconUrl,
          canGoBack: contents.navigationHistory.canGoBack(),
          canGoForward: contents.navigationHistory.canGoForward(),
          loading: contents.isLoading(),
        },
      });
    };
    // The renderer cannot load a remote icon itself, so the bytes are fetched
    // here and reported once they arrive; until then the tab keeps showing
    // whatever it has, which after a navigation is the globe. What Chromium
    // reported is only a candidate — the page is read first, because Chromium
    // ignores the `media` attribute that says which scheme an icon is for.
    const resolveFavicon = (): void => {
      const request = (faviconRequest += 1);
      void tabFaviconDataUrl(contents.session, contents.getURL(), faviconSource, {
        prefersDark: nativeTheme.shouldUseDarkColors,
      }).then((dataUrl) => {
        if (contents.isDestroyed() || faviconRequest !== request) return;
        faviconUrl = dataUrl;
        emit();
      });
    };
    this.#faviconRefreshers.set(tabId, () => {
      if (!contents.isDestroyed()) resolveFavicon();
    });
    contents.on("page-favicon-updated", (_event, favicons) => {
      const source = favicons[0] ?? null;
      if (source === faviconSource) return;
      faviconSource = source;
      resolveFavicon();
    });
    contents.on("did-navigate", (): void => {
      // A navigation invalidates the previous page's icon until the new one
      // reports; without this the old favicon lingers on the wrong site.
      faviconSource = null;
      faviconUrl = null;
      faviconRequest += 1;
      emit();
    });
    contents.on("did-navigate-in-page", emit);
    contents.on("page-title-updated", emit);
    contents.on("did-start-loading", emit);
    contents.on("did-stop-loading", emit);
    contents.on("focus", () => this.#send({ type: "focus", tabId }));
    // A view with nothing loaded still sits over the pane and eats the click
    // without reporting a focus change, so the press itself is the signal: it
    // proves the pointer went to the page and not to the chrome.
    contents.on("input-event", (_event, input) => {
      if (input.type === "mouseDown") this.#send({ type: "focus", tabId });
    });
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
