import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";

/** Real CDP against an isolated headless Chromium, without a user profile. */
export function chromeBinary(): string | null {
  const binary = chromium.executablePath();
  return existsSync(binary) ? binary : null;
}

export interface LiveBrowser {
  transport: {
    send(method: string, params?: object): Promise<Record<string, unknown>>;
    enableDomain(domain: string): Promise<void>;
    onEvent(method: string, listener: (params: never) => void): () => void;
  };
  pageUrl: string;
  stop(): Promise<void>;
}

export async function startLiveBrowser(fixture: string): Promise<LiveBrowser> {
  const html = readFileSync(fixture, "utf8");
  const frame = readFileSync(new URL("./fixtures/frame.html", import.meta.url), "utf8");
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/probe") || request.url === "/favicon.ico") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" })
      .end(request.url?.startsWith("/frame.html") ? frame : html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const pageUrl = `http://127.0.0.1:${port}/`;
  // Playwright's headless shell avoids the native-window key-event deadlock
  // of launching a full macOS Chrome with --headless=new.
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const stop = async () => {
    try { await browser?.close(); }
    finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  };
  try {
    browser = await chromium.launch({headless: true});
    const page = await browser.newPage();
    // Let the package observe and answer dialogs through CDP. Without a
    // listener Playwright automatically dismisses them before the assertion.
    page.on("dialog", () => {});
    await page.goto(pageUrl);
    const cdp = await page.context().newCDPSession(page);
    const enabled = new Set<string>();
    const transport: LiveBrowser["transport"] = {
      async send(method, params = {}) {
        return await cdp.send(method as Parameters<typeof cdp.send>[0], params) as Record<string, unknown>;
      },
      async enableDomain(domain) {
        if (enabled.has(domain)) return;
        await transport.send(`${domain}.enable`, {});
        enabled.add(domain);
      },
      onEvent(method, listener) {
        const handler = (event: {method: string; params?: object}) => {
          if (event.method === method) listener(event.params as never);
        };
        cdp.on("event", handler);
        return () => { cdp.off("event", handler); };
      },
    };
    return {transport, pageUrl, stop};
  } catch (error) {
    await stop();
    throw error;
  }
}
