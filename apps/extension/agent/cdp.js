// Promise-based chrome.debugger wrapper, plus the per-tab attach bookkeeping
// the lease lifecycle needs.
//
// The debugger attaches once when a lease binds to a tab and detaches when the
// lease is released, the tab closes, or the worker restarts — the same
// session-long shape the Codex extension uses. Attaching is what makes the
// capability set possible at all (accessibility snapshots, trusted input,
// screenshots, console, dialogs, file inputs), and it is also what puts
// Chrome's debugging infobar on the tab, so it is scoped to the lease rather
// than left on.

const CDP_VERSION = "1.3";

/** tabId -> {domains:Set<string>} for tabs this worker attached. */
const attached = new Map();

/** Listeners for CDP events, keyed by `${tabId}:${method}`. */
const eventListeners = new Map();

export class CdpError extends Error {
  constructor(message) {
    super(message);
    this.name = "CdpError";
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const listeners = eventListeners.get(`${source.tabId}:${method}`);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener(params ?? {});
    } catch {
      // A misbehaving listener must never break the event pump.
    }
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (typeof source.tabId === "number") forgetTab(source.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));

function forgetTab(tabId) {
  attached.delete(tabId);
  for (const key of [...eventListeners.keys()])
    if (key.startsWith(`${tabId}:`)) eventListeners.delete(key);
}

export function isAttached(tabId) {
  return attached.has(tabId);
}

export async function attach(tabId) {
  if (attached.has(tabId)) return;
  await new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, CDP_VERSION, () => {
      const error = chrome.runtime.lastError;
      // Another client (DevTools, another extension) already owns this tab.
      // Say so plainly — it is the most common attach failure and the user can
      // fix it by closing DevTools.
      if (error) {
        reject(
          new CdpError(
            /already attached|another debugger/i.test(error.message)
              ? `Cannot control this tab: something else is already debugging it (DevTools open?). ${error.message}`
              : error.message,
          ),
        );
        return;
      }
      resolve();
    });
  });
  attached.set(tabId, { domains: new Set() });
}

export function detach(tabId) {
  if (!attached.has(tabId)) return;
  forgetTab(tabId);
  try {
    chrome.debugger.detach({ tabId }, () => void chrome.runtime.lastError);
  } catch {
    // Detach races with tab-close are normal; never surface them.
  }
}

export function detachAll() {
  for (const tabId of [...attached.keys()]) detach(tabId);
}

export async function send(tabId, method, params = {}) {
  if (!attached.has(tabId)) throw new CdpError(`Not attached to tab ${tabId}`);
  return await new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new CdpError(`${method}: ${error.message}`));
        return;
      }
      resolve(result ?? {});
    });
  });
}

/** Enable a CDP domain at most once per attached tab. */
export async function enableDomain(tabId, domain, params = {}) {
  const entry = attached.get(tabId);
  if (!entry) throw new CdpError(`Not attached to tab ${tabId}`);
  if (entry.domains.has(domain)) return;
  await send(tabId, `${domain}.enable`, params);
  entry.domains.add(domain);
}

export function onEvent(tabId, method, listener) {
  const key = `${tabId}:${method}`;
  const listeners = eventListeners.get(key) ?? new Set();
  listeners.add(listener);
  eventListeners.set(key, listeners);
  return () => listeners.delete(listener);
}


/**
 * A @polymux/browser transport bound to one tab.
 *
 * This is the whole of what the extension contributes to command execution:
 * the shared package owns every command, and this hands it a way to speak CDP
 * to a tab in the user's own browser.
 */
export function chromeTransport(tabId, moveCursor) {
  return {
    send: (method, params) => send(tabId, method, params),
    enableDomain: (domain, params) => enableDomain(tabId, domain, params),
    onEvent: (method, listener) => onEvent(tabId, method, listener),
    moveCursor,
  };
}
