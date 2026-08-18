import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

/**
 * A real Chromium on a real page, wired to the transport shape the package
 * expects. Used by `live.test.ts`.
 *
 * Chrome is launched **headful** (positioned off-screen) on purpose:
 * `--headless=new` deadlocks its whole browser process partway through a run of
 * `Input.dispatchKeyEvent`, so a headless suite reports a cascade of timeouts
 * that have nothing to do with this package. Both surfaces that ship — the
 * user's own browser and an Electron WebContentsView — are headful anyway.
 */

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

export function chromeBinary(): string | null {
  return CHROME_PATHS.find((path) => existsSync(path)) ?? null;
}

export interface LiveBrowser {
  transport: {
    send(method: string, params?: object): Promise<Record<string, unknown>>;
    enableDomain(domain: string): Promise<void>;
    onEvent(method: string, listener: (params: never) => void): () => void;
  };
  pageUrl: string;
  stop(): void;
}

export async function startLiveBrowser(fixture: string): Promise<LiveBrowser> {
  const binary = chromeBinary();
  if (!binary) throw new Error("No Chrome binary");

  const html = readFileSync(fixture, "utf8");
  const frame = readFileSync(
    new URL("./fixtures/frame.html", import.meta.url).pathname,
    "utf8",
  );
  const server: Server = createServer((request, response) => {
    if (request.url?.startsWith("/probe") || request.url === "/favicon.ico") {
      response.writeHead(404).end();
      return;
    }
    const body = request.url?.startsWith("/frame.html") ? frame : html;
    response.writeHead(200, { "Content-Type": "text/html" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const pageUrl = `http://127.0.0.1:${port}/`;

  const debugPort = 9300 + (process.pid % 500);
  const chrome: ChildProcess = spawn(
    binary,
    [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${process.env.TMPDIR ?? "/tmp"}/flareai-live-${process.pid}`,
      // Off-screen rather than headless; see the note above.
      "--window-position=-2400,0",
      // Off-screen windows are treated as occluded, and Chrome throttles
      // requestAnimationFrame to a crawl — which makes any timing measured
      // here a reading of the throttle, not of the animation.
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--no-first-run",
      "--no-default-browser-check",
      pageUrl,
    ],
    { stdio: "ignore" },
  );

  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let attempt = 0; attempt < 80 && !target; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
      const targets = (await response.json()) as Array<{
        type: string;
        url: string;
        webSocketDebuggerUrl?: string;
      }>;
      const page = targets.find(
        (candidate) =>
          candidate.type === "page" && candidate.url.startsWith("http://127.0.0.1"),
      );
      if (page?.webSocketDebuggerUrl)
        target = page as { webSocketDebuggerUrl: string };
    } catch {
      // Chrome is still coming up.
    }
    if (!target) await delay(250);
  }
  if (!target) {
    chrome.kill();
    server.close();
    throw new Error("Chrome never exposed a page target");
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("CDP socket failed to open"));
  });

  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  const listeners = new Map<string, Set<(params: never) => void>>();

  // Without this a dropped connection leaves every command pending forever, and
  // the suite reports timeouts instead of the one real cause.
  const failAll = (reason: string): void => {
    for (const [, entry] of pending) entry.reject(new Error(reason));
    pending.clear();
  };
  socket.onclose = () => failAll("CDP socket closed");

  socket.onmessage = (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      params?: never;
      result?: Record<string, unknown>;
      error?: { message: string };
    };
    if (message.method === "Inspector.targetCrashed") failAll("page crashed");
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result ?? {});
      return;
    }
    if (message.method)
      for (const listener of listeners.get(message.method) ?? [])
        listener(message.params ?? ({} as never));
  };

  const enabled = new Set<string>();
  const transport: LiveBrowser["transport"] = {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = (nextId += 1);
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      }),
    async enableDomain(domain) {
      if (enabled.has(domain)) return;
      await transport.send(`${domain}.enable`, {});
      enabled.add(domain);
    },
    onEvent(method, listener) {
      const set = listeners.get(method) ?? new Set();
      set.add(listener);
      listeners.set(method, set);
      return () => set.delete(listener);
    },
  };

  return {
    transport,
    pageUrl,
    stop() {
      socket.close();
      chrome.kill();
      server.close();
    },
  };
}
