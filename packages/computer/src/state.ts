import type {
  ComputerStateInput,
  ComputerStateQuery,
  ComputerStateResult,
  ComputerSurface,
  ComputerActivityEvent,
  SurfaceCapabilities,
  SurfaceView,
} from "./types.js";

const readOnly: SurfaceCapabilities = {read: true, control: false, background: true, scopes: []};
const embeddedTab: SurfaceCapabilities = {read: true, control: true, background: true, scopes: ["element", "tab"]};
const externalTab: SurfaceCapabilities = {read: true, control: true, background: true, scopes: ["element", "tab"]};

export class ComputerState {
  readonly #source: () => ComputerStateInput;
  readonly #events: ComputerActivityEvent[] = [];

  constructor(source: () => ComputerStateInput) {
    this.#source = source;
  }

  query(query: ComputerStateQuery = {}): ComputerStateResult {
    const input = this.#source();
    const all = surfaces(input);
    this.#applyRecentActivity(all);
    const requested = new Set(query.surfaces?.length ? query.surfaces : ["apps", "windows", "tabs"]);
    const app = query.app?.trim().toLowerCase();
    const selected = all.filter((surface) =>
      requested.has(viewOf(surface)) && (!app || surface.app.toLowerCase().includes(app)),
    );
    const userSurface = all.find((surface) => surface.userControlled);
    return {
      user: {
        surfaceId: userSurface?.id,
        app: userSurface?.app,
        kind: userSurface?.kind,
        capturedAt: userSurface?.capturedAt,
        locked: input.locked === true,
      },
      surfaces: selected,
      counts: {
        apps: all.filter((surface) => surface.kind === "app").length,
        windows: all.filter((surface) => surface.kind === "window").length,
        tabs: all.filter((surface) => surface.kind === "tab").length,
      },
    };
  }

  surface(id: string): ComputerSurface | undefined {
    const all = surfaces(this.#source());
    this.#applyRecentActivity(all);
    return all.find((surface) => surface.id === id);
  }

  controlContext(id: string): {appId?: string; windowId?: string} {
    const all = surfaces(this.#source());
    const byId = new Map(all.map((surface) => [surface.id, surface]));
    let current = byId.get(id);
    let appId: string | undefined;
    let windowId: string | undefined;
    while (current) {
      if (current.kind === "app") appId = current.id;
      if (current.kind === "window") windowId = current.id;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return {appId, windowId};
  }

  recordActivity(event: ComputerActivityEvent): void {
    this.#events.push(event);
    const cutoff = Date.now() - 120_000;
    while (this.#events.length && Date.parse(this.#events[0]!.at) < cutoff) this.#events.shift();
    if (this.#events.length > 500) this.#events.splice(0, this.#events.length - 500);
  }

  matchingActivitySurfaces(event: ComputerActivityEvent): ComputerSurface[] {
    return surfaces(this.#source()).filter((surface) => eventMatches(event, surface));
  }

  locked(): boolean {
    return this.#source().locked === true;
  }

  #applyRecentActivity(all: ComputerSurface[]): void {
    const recent = [...this.#events].reverse();
    for (const surface of all) {
      const event = recent.find((candidate) => eventMatches(candidate, surface));
      if (event)
        surface.lastUserEvent = {kind: event.kind, at: event.at, ...(event.count === undefined ? {} : {count: event.count})};
    }
  }
}

function surfaces(input: ComputerStateInput): ComputerSurface[] {
  const result: ComputerSurface[] = [];
  const apps = new Map<string, ComputerSurface>();
  const addApp = (app: string, frontmost: boolean, capturedAt?: string) => {
    const id = `app:${key(app)}`;
    const existing = apps.get(id);
    if (existing) {
      existing.frontmost ||= frontmost;
      existing.active ||= frontmost;
      existing.userControlled ||= frontmost;
      return existing;
    }
    const surface: ComputerSurface = {
      id, kind: "app", app, title: app, frontmost, active: frontmost,
      userControlled: frontmost, capturedAt, capabilities: readOnly,
    };
    apps.set(id, surface);
    result.push(surface);
    return surface;
  };

  for (const [index, window] of (input.windows ?? []).entries()) {
    const app = addApp(window.app, window.frontmost, input.windowsCapturedAt);
    result.push({
      id: `window:${key(window.app)}:${index}:${key(window.title)}`,
      parentId: app.id,
      kind: "window",
      app: window.app,
      title: window.title,
      frontmost: window.frontmost,
      active: window.frontmost,
      userControlled: window.frontmost,
      capturedAt: input.windowsCapturedAt,
      capabilities: readOnly,
    });
  }

  if (input.browserTabs?.length) {
    const app = addApp("Polymux Browser", false, input.browserTabsCapturedAt);
    const windowId = "window:polymux-browser:main";
    result.push({id: windowId, parentId: app.id, kind: "window", app: app.app, title: "Polymux Browser", frontmost: false, active: false, userControlled: false, capturedAt: input.browserTabsCapturedAt, capabilities: readOnly});
    for (const tab of input.browserTabs)
      result.push({id: `tab:polymux:${tab.tabId}`, parentId: windowId, kind: "tab", app: app.app, title: tab.title, url: sanitizeUrl(tab.url), frontmost: false, active: false, userControlled: false, capturedAt: input.browserTabsCapturedAt, capabilities: embeddedTab});
  }

  const externalWindows = new Map<number | null, string>();
  const externalWindowApps = new Map<number | null, {app: string; title: string} | undefined>();
  for (const tab of input.externalBrowserTabs ?? []) {
    if (!tab.active) continue;
    const matched = input.windows?.find((window) => window.frontmost && titlesMatch(window.title, tab.title));
    if (matched) externalWindowApps.set(tab.windowId, {app: matched.app, title: matched.title});
  }
  for (const tab of input.externalBrowserTabs ?? []) {
    const matchedWindow = externalWindowApps.get(tab.windowId);
    const userTab = Boolean(matchedWindow && tab.active);
    const app = addApp(matchedWindow?.app ?? "External Browser", userTab, input.externalBrowserCapturedAt);
    let windowId = externalWindows.get(tab.windowId);
    if (!windowId) {
      windowId = `window:external-browser:${tab.windowId ?? "unknown"}`;
      externalWindows.set(tab.windowId, windowId);
      result.push({id: windowId, parentId: app.id, kind: "window", app: app.app, title: matchedWindow?.title ?? "External Browser", frontmost: Boolean(matchedWindow), active: tab.active, userControlled: Boolean(matchedWindow), capturedAt: input.externalBrowserCapturedAt, capabilities: readOnly});
    }
    result.push({id: `tab:external:${tab.tabId}`, parentId: windowId, kind: "tab", app: app.app, title: tab.title, url: sanitizeUrl(tab.url), frontmost: userTab, active: tab.active, userControlled: userTab, capturedAt: input.externalBrowserCapturedAt, capabilities: externalTab});
  }
  return result;
}

function eventMatches(event: ComputerActivityEvent, surface: ComputerSurface): boolean {
  if (event.url && surface.url && sanitizeUrl(event.url) === surface.url) return true;
  if (event.title && surface.title && titlesMatch(event.title, surface.title)) return true;
  return event.app.toLowerCase() === surface.app.toLowerCase() && surface.userControlled;
}

function titlesMatch(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function viewOf(surface: ComputerSurface): SurfaceView {
  return surface.kind === "app" ? "apps" : surface.kind === "window" ? "windows" : "tabs";
}

function key(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}
