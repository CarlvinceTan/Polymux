import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserDownloadDto, BrowserEventDto } from "@polymux/protocol";
import {
  createSession,
  startSession,
  stopSession,
} from "@polymux/browser";
import { nativeTheme, WebContentsView, type BrowserWindow, type WebContents } from "electron";
import { electronTransport, type CdpTransport } from "./cdp.js";
import { PageCursor } from "./cursor.js";
import { availablePath, type Downloads } from "./downloads.js";
import {selectPromptTabs} from "./tab-context.js";
import { clearFaviconCache, tabFaviconDataUrl } from "./favicon.js";
import {
  browserViewportMode,
  mobileBrowserUserAgent,
  type BrowserViewportMode,
  type BrowserViewportSize,
} from "./viewport.js";

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
  readonly #sessions = new Map<
    string,
    { session: ControlSession; transport: CdpTransport; cursor: PageCursor }
  >();
  /** Tabs currently on screen, as the renderer reports them. */
  readonly #onScreen = new Set<string>();
  readonly #downloads: Downloads;
  readonly #send: (event: BrowserEventDto) => void;
  /** One per live tab, re-resolving that tab's icon for the current scheme. */
  readonly #faviconRefreshers = new Map<string, () => void>();
  /** One per live tab, re-sending that tab's current page state. */
  readonly #stateEmitters = new Map<string, () => void>();
  readonly #viewportModes = new Map<string, BrowserViewportMode>();
  readonly #desktopUserAgents = new Map<string, string>();
  readonly #onTabReset: (tabId: string) => void;
  readonly #onVisit: (visit: {url: string; title: string}) => void;

  constructor(options: {
    window: BrowserWindow;
    downloads: Downloads;
    send: (event: BrowserEventDto) => void;
    /** Fired when a tab navigates away or closes, so anything holding state
     * for the page that was there — an unanswered permission prompt above all
     * — can let it go rather than wait on a page that no longer exists. */
    onTabReset?: (tabId: string) => void;
    /** Records a page the user actually landed on. Optional so the view can be
     * built in a test without a store behind it. */
    onVisit?: (visit: {url: string; title: string}) => void;
  }) {
    this.#window = options.window;
    this.#downloads = options.downloads;
    this.#send = options.send;
    this.#onTabReset = options.onTabReset ?? (() => {});
    this.#onVisit = options.onVisit ?? ((): void => {});
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
      if (view.webContents.isDestroyed()) {
        this.#views.delete(tabId);
        this.#viewportModes.delete(tabId);
        this.#desktopUserAgents.delete(tabId);
      }
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

  open(tabId: string, url?: string, viewport?: BrowserViewportSize): { url: string; title: string } {
    const existing = this.#views.get(tabId);
    if (existing) {
      if (viewport) this.#applyViewport(tabId, existing.webContents, viewport);
      // A remount re-opens tabs it already knows about. Navigating again would
      // discard the live page state the detach/attach cycle just preserved,
      // so only a view with nothing loaded takes the url.
      if (url && !existing.webContents.getURL()) this.navigate(tabId, url);
      // A tab the agent opened has finished loading before the renderer mounts
      // its pane, so no further state event is coming on its own. Without this
      // snapshot the pane keeps its empty state — a placeholder sitting over a
      // page that is already there.
      else this.#stateEmitters.get(tabId)?.();
      return { url: existing.webContents.getURL(), title: existing.webContents.getTitle() };
    }
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Built beside main.js by its own entry in forge.config.ts. It finds
        // login forms and fills them on request; the page never reaches
        // anything but the one credential it is handed.
        preload: path.join(path.dirname(fileURLToPath(import.meta.url)), "autofill.js"),
      },
    });
    this.#viewportModes.delete(tabId);
    this.#views.set(tabId, view);
    this.#desktopUserAgents.set(tabId, view.webContents.getUserAgent());
    this.#window.contentView.addChildView(view);
    // Zero-sized until the renderer reports where the tab's surface sits, so a
    // newly opened view never flashes over unrelated UI.
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    if (viewport) this.#applyViewport(tabId, view.webContents, viewport);
    this.#downloads.wire(view.webContents.session);
    this.#wireState(tabId, view.webContents);
    if (url) this.navigate(tabId, url);
    return { url: view.webContents.getURL(), title: view.webContents.getTitle() };
  }

  /**
   * The tab a webContents belongs to, or null when it is not one of ours.
   * Permission handling hangs off this: the session is shared with the app
   * window, so "is this a page in a browser tab" is the first question asked
   * of every request.
   */
  tabIdFor(contents: WebContents | null): string | null {
    if (!contents) return null;
    for (const [tabId, view] of this.#views)
      if (!view.webContents.isDestroyed() && view.webContents === contents) return tabId;
    return null;
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
    const view = this.#views.get(tabId);
    if (!view) return;
    this.#applyViewport(tabId, view.webContents, bounds);
    view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    });
  }

  setVisible(tabId: string, visible: boolean): void {
    if (visible) this.#onScreen.add(tabId);
    else this.#onScreen.delete(tabId);
    this.#views.get(tabId)?.setVisible(visible);
  }

  close(tabId: string): void {
    this.#releaseSession(tabId);
    const view = this.#views.get(tabId);
    this.#viewportModes.delete(tabId);
    this.#desktopUserAgents.delete(tabId);
    if (!view) return;
    this.#views.delete(tabId);
    this.#faviconRefreshers.delete(tabId);
    this.#stateEmitters.delete(tabId);
    this.#onTabReset(tabId);
    if (!this.#window.isDestroyed()) this.#window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.#send({ type: "closed", tabId });
  }

  #applyViewport(tabId: string, contents: WebContents, viewport: BrowserViewportSize): void {
    const width = Math.max(0, Math.round(viewport.width));
    const height = Math.max(0, Math.round(viewport.height));
    if (!width || !height || contents.isDestroyed()) return;

    const previous = this.#viewportModes.get(tabId) ?? "desktop";
    const mode = browserViewportMode({width, height}, previous);
    if (mode === previous) return;

    this.#viewportModes.set(tabId, mode);
    contents.setUserAgent(
      mode === "mobile"
        ? mobileBrowserUserAgent(process.versions.chrome)
        : (this.#desktopUserAgents.get(tabId) ?? contents.session.getUserAgent()),
    );
    // The WebContentsView already has the drawer's true narrow dimensions.
    // Sites such as Notion additionally choose their application shell from
    // the user agent during initial navigation, so reload once when that
    // identity crosses modes; ordinary resizes keep the live page intact.
    if (contents.getURL()) contents.reload();
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

  /** Bounded state for an always-present model prompt. `tabs()` remains the
   * complete inventory used by explicit browser inspection. */
  promptTabs(maximum = 12): Array<{tabId: string; url: string; title: string}> {
    return selectPromptTabs(this.tabs(), this.#onScreen, maximum);
  }

  /** Exact live pages currently painted in the workspace. */
  visibleTabs(): Array<{tabId: string; url: string; title: string}> {
    return this.tabs().filter((tab) => this.#onScreen.has(tab.tabId));
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

  /**
   * The agent's control session for a tab, created on first use.
   *
   * This is the same session type the browser extension builds for a tab in the
   * user's own browser, over the same protocol — so the in-app Browser answers
   * the identical command set rather than the selector-only subset it used to
   * drive through `executeJavaScript`. Held per tab because the ref map and the
   * console and network buffers belong to the page, not to one command.
   */
  async session(tabId: string): Promise<ControlSession> {
    const existing = this.#sessions.get(tabId);
    if (existing) return existing.session;
    const contents = this.#contents(tabId);
    if (!contents) throw new Error(`No such browser tab: ${tabId}`);
    const transport = electronTransport(contents);
    const cursor = new PageCursor(transport);
    const session = createSession({
      ...transport,
      // The cursor always animates; whether an action waits for it is decided
      // by `observed`. On a tab nobody is looking at, the work runs at full
      // speed and the pointer simply follows along behind.
      moveCursor: (point) => cursor.moveTo(point),
      observed: () => this.#isWatched(tabId),
    }) as ControlSession;
    await startSession(session);
    // Armed for the life of the session, not just while the tab is on screen —
    // the user may look over at any point, and the cursor should already be
    // where the work is rather than appearing once they arrive.
    await cursor.setActive(true);
    await cursor.install();
    this.#sessions.set(tabId, { session, transport, cursor });
    return session;
  }

  /**
   * Is a person plausibly looking at this tab? Only then is it worth holding an
   * action back so the pointer is seen arriving first.
   */
  #isWatched(tabId: string): boolean {
    if (!this.#onScreen.has(tabId)) return false;
    return this.#window.isFocused() && !this.#window.isMinimized();
  }

  #releaseSession(tabId: string): void {
    const entry = this.#sessions.get(tabId);
    if (!entry) return;
    this.#sessions.delete(tabId);
    this.#onScreen.delete(tabId);
    void entry.cursor.setActive(false);
    stopSession(entry.session);
    entry.transport.detach();
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

  async preview(tabId: string): Promise<string | null> {
    const contents = this.#views.get(tabId)?.webContents;
    if (!contents || contents.isDestroyed()) return null;
    const image = await contents.capturePage();
    return image.isEmpty() ? null : image.toDataURL();
  }

  async screenshot(tabId: string): Promise<BrowserDownloadDto | null> {
    const contents = this.#views.get(tabId)?.webContents;
    if (!contents) return null;
    const image = await contents.capturePage();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const directory = this.#downloads.directory();
    const file = availablePath(directory, `Screenshot ${stamp}.png`);
    await writeFile(file, image.toPNG());
    return this.#downloads.record(file, contents.getURL());
  }

  downloads(): BrowserDownloadDto[] {
    return this.#downloads.list();
  }

  openDownload(id: string): void {
    this.#downloads.open(id);
  }

  openDownloadsFolder(): void {
    this.#downloads.openFolder();
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
    this.#stateEmitters.set(tabId, emit);
    this.#faviconRefreshers.set(tabId, () => {
      if (!contents.isDestroyed()) resolveFavicon();
    });
    contents.on("page-favicon-updated", (_event, favicons) => {
      const source = favicons[0] ?? null;
      if (source === faviconSource) return;
      faviconSource = source;
      resolveFavicon();
    });
    // A committed top-level navigation is the moment a page becomes a visit —
    // not `did-navigate-in-page`, which fires for every anchor and history
    // push and would file a dozen rows for one page.
    contents.on("did-navigate", (_event, url): void => {
      if (/^https?:/i.test(url)) this.#onVisit({url, title: contents.getTitle()});
    });
    // The title usually arrives after the navigation, so the row is corrected
    // once it does rather than being left under a bare url.
    contents.on("page-title-updated", (_event, title): void => {
      const url = contents.getURL();
      if (/^https?:/i.test(url)) this.#onVisit({url, title});
    });
    contents.on("did-navigate", (): void => {
      // A navigation invalidates the previous page's icon until the new one
      // reports; without this the old favicon lingers on the wrong site.
      faviconSource = null;
      faviconUrl = null;
      faviconRequest += 1;
      this.#onTabReset(tabId);
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

}

/**
 * A @polymux/browser session. The package is plain JavaScript so the
 * browser extension can load it without a build step, so its shape is named
 * here rather than imported.
 */
export interface ControlSession {
  send(method: string, params?: object): Promise<Record<string, unknown>>;
  refs: Map<string, number>;
  observers: { dialog: { type: string; message: string } | null };
  cursor: { x: number; y: number } | null;
  paced: (min: number, max: number) => number;
  moveCursor(point: { x: number; y: number }): Promise<void>;
}
