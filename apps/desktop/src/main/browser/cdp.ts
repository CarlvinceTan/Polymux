import type { WebContents } from "electron";

/**
 * A @flareai/browser transport for a WebContentsView in the in-app
 * Browser.
 *
 * Electron exposes the same Chrome DevTools Protocol the extension reaches
 * through `chrome.debugger`, so the in-app Browser runs the identical command
 * set — accessibility snapshots with refs, trusted input, screenshots, console
 * and network, dialogs, uploads — rather than the selector-only subset it had
 * when it drove pages through `executeJavaScript`.
 *
 * There is no debugging infobar here: this is FlareAI's own view, not a tab in
 * the user's browser, so attaching costs the user nothing.
 */
export interface CdpTransport {
  send(method: string, params?: object): Promise<Record<string, unknown>>;
  enableDomain(domain: string): Promise<void>;
  onEvent(method: string, listener: (params: unknown) => void): () => void;
  detach(): void;
}

export function electronTransport(contents: WebContents): CdpTransport {
  if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");

  const listeners = new Map<string, Set<(params: unknown) => void>>();
  const onMessage = (_event: unknown, method: string, params: unknown): void => {
    for (const listener of listeners.get(method) ?? []) {
      try {
        listener(params);
      } catch {
        // A misbehaving listener must never break the event pump.
      }
    }
  };
  contents.debugger.on("message", onMessage);

  const enabled = new Set<string>();
  return {
    async send(method, params = {}) {
      return (await contents.debugger.sendCommand(method, params)) as Record<
        string,
        unknown
      >;
    },
    async enableDomain(domain) {
      if (enabled.has(domain)) return;
      await contents.debugger.sendCommand(`${domain}.enable`, {});
      enabled.add(domain);
    },
    onEvent(method, listener) {
      const set = listeners.get(method) ?? new Set();
      set.add(listener);
      listeners.set(method, set);
      return () => set.delete(listener);
    },
    detach() {
      listeners.clear();
      contents.debugger.off("message", onMessage);
      // A view torn down mid-command is the normal case, not a failure.
      try {
        if (contents.debugger.isAttached()) contents.debugger.detach();
      } catch {
        /* ignore */
      }
    },
  };
}
