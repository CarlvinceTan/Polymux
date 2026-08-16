// FlareAI browser extension — background service worker.
//
// Two responsibilities:
//  1. Tab context: stream the open-tab list to the FlareAI desktop agent through
//     the com.flareai.tab_context native messaging host (tabs.json on disk).
//  2. Agent surface: proxy the loopback FlareAI feed for content scripts —
//     snapshot/long-poll, cursor arrivals, and control-command results —
//     because content scripts cannot fetch 127.0.0.1 from arbitrary origins.

const HOST = "com.flareai.tab_context";
const HEARTBEAT_MINUTES = 1;
const DEBOUNCE_MS = 500;

const SURFACE_ORIGIN = "http://127.0.0.1:47654";
const SNAPSHOT_URL = `${SURFACE_ORIGIN}/v1/snapshot`;
const ARRIVAL_URL = `${SURFACE_ORIGIN}/v1/cursor-arrivals`;
const RESULTS_URL = `${SURFACE_ORIGIN}/v1/results`;

// --- Tab context ----------------------------------------------------------

let pending = null;

function scheduleSnapshot() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void sendSnapshot();
  }, DEBOUNCE_MS);
}

async function sendSnapshot() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  const payload = {
    captured_at: new Date().toISOString(),
    browser: "chrome",
    tabs: tabs
      .filter((tab) => tab.url && !tab.url.startsWith("chrome://"))
      .map((tab) => ({
        id: tab.id,
        window_id: tab.windowId,
        title: tab.title ?? "",
        url: tab.url ?? "",
        active: Boolean(tab.active),
        pinned: Boolean(tab.pinned),
        audible: Boolean(tab.audible),
        last_accessed: tab.lastAccessed
          ? new Date(tab.lastAccessed).toISOString()
          : null,
      })),
  };
  try {
    await chrome.runtime.sendNativeMessage(HOST, payload);
  } catch {
    // Host not installed or blocked; retry on the next event.
  }
}

chrome.tabs.onCreated.addListener(scheduleSnapshot);
chrome.tabs.onRemoved.addListener(scheduleSnapshot);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete")
    scheduleSnapshot();
});
chrome.tabs.onActivated.addListener(scheduleSnapshot);
chrome.tabs.onMoved.addListener(scheduleSnapshot);
chrome.tabs.onAttached.addListener(scheduleSnapshot);
chrome.windows.onFocusChanged.addListener(scheduleSnapshot);

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("flareai-tab-context-heartbeat", {
    periodInMinutes: HEARTBEAT_MINUTES,
  });
  scheduleSnapshot();
});
chrome.runtime.onStartup.addListener(scheduleSnapshot);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "flareai-tab-context-heartbeat") scheduleSnapshot();
});

// --- Agent surface proxy ----------------------------------------------------

function respondWith(promise, sendResponse) {
  promise
    .then((value) => sendResponse(value))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  return true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "flareai:cursor-arrived") {
    return respondWith(
      fetch(ARRIVAL_URL, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseId: message.leaseId,
          moveSequence: message.moveSequence,
        }),
      }).then((response) => ({ ok: response.ok })),
      sendResponse
    );
  }

  if (message?.type === "flareai:command-result") {
    return respondWith(
      fetch(RESULTS_URL, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseId: message.leaseId,
          commandId: message.commandId,
          ok: message.ok,
          error: message.error,
          pageUrl: message.pageUrl,
          pageTitle: message.pageTitle,
          content: message.content,
        }),
      }).then((response) => ({ ok: response.ok })),
      sendResponse
    );
  }

  if (message?.type === "flareai:snapshot" || message?.type === "flareai:changes") {
    const url = new URL(SNAPSHOT_URL);
    if (
      message.type === "flareai:changes" &&
      Number.isInteger(message.afterRevision)
    ) {
      url.searchParams.set("after", String(message.afterRevision));
      url.searchParams.set(
        "waitMs",
        String(Math.max(0, Math.min(25_000, Number(message.waitMs) || 0)))
      );
    }
    return respondWith(
      fetch(url.href, { cache: "no-store" }).then(async (response) => {
        if (!response.ok)
          throw new Error(`FlareAI agent surface returned ${response.status}`);
        return { ok: true, snapshot: await response.json() };
      }),
      sendResponse
    );
  }

  return false;
});
