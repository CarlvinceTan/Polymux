// FlareAI browser extension — background service worker.
//
// Three responsibilities:
//  1. Tab context: stream the open-tab list to the FlareAI desktop agent
//     through the com.flareai.tab_context native messaging host (tabs.json).
//  2. Command execution: poll the loopback FlareAI feed, bind each lease to
//     the exact tab it names, attach chrome.debugger to that tab, and run the
//     agent's commands over CDP.
//  3. Presentation relay: ask the leased tab's content script to animate the
//     cursor to a target and wait for it to arrive before dispatching input.
//
// Execution lives here rather than in the content script because everything
// past click/type/scroll needs the debugger — accessibility snapshots,
// screenshots, console and network, dialogs, file inputs, trusted key events.
// The side benefit is that CDP reaches a background tab, so driving a lease
// never pulls the tab in front of whatever the user is doing.

import { attach, chromeTransport, detach, detachAll, isAttached } from "./lib/cdp.js";
import {
  createSession,
  handlers,
  pacer,
  pageInfo,
  startSession,
  stopSession,
} from "./shared/index.js";

const HOST = "com.flareai.tab_context";
const HEARTBEAT_MINUTES = 1;
const DEBOUNCE_MS = 500;

const SURFACE_ORIGIN = "http://127.0.0.1:47654";
const SNAPSHOT_URL = `${SURFACE_ORIGIN}/v1/snapshot`;
const ARRIVAL_URL = `${SURFACE_ORIGIN}/v1/cursor-arrivals`;
const RESULTS_URL = `${SURFACE_ORIGIN}/v1/results`;
const POLL_WAIT_MS = 25_000;
const CURSOR_TIMEOUT_MS = 4_000;

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
  if (alarm.name === "flareai-tab-context-heartbeat") {
    scheduleSnapshot();
    void pump();
  }
});

// --- Lease sessions -------------------------------------------------------

/** leaseId -> session. A session owns one tab's debugger attachment. */
const sessions = new Map();
const handledCommands = new Set();

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

/**
 * Find the one tab a lease names. Identity comes from URL first and title
 * second — never from position or recency, because those are exactly the
 * signals that pick the wrong tab when the user has two of the same site open.
 */
async function findTab(tab) {
  const tabs = await chrome.tabs.query({});
  const wantedUrl = normalizedUrl(tab.url || "");
  const wantedTitle = String(tab.title || "").trim().toLowerCase();
  const candidates = tabs.filter((candidate) => {
    if (!candidate.url || candidate.url.startsWith("chrome://")) return false;
    if (wantedUrl && normalizedUrl(candidate.url) === wantedUrl) return true;
    if (!wantedUrl && wantedTitle)
      return String(candidate.title ?? "").trim().toLowerCase() === wantedTitle;
    return false;
  });
  if (candidates.length === 0) return null;
  if (candidates.length > 1 && wantedTitle) {
    const exact = candidates.find(
      (candidate) =>
        String(candidate.title ?? "").trim().toLowerCase() === wantedTitle,
    );
    if (exact) return exact;
  }
  return candidates[0];
}

async function sessionFor(lease) {
  const existing = sessions.get(lease.id);
  if (existing) {
    // The tab may have been closed under us; a stale attachment would fail
    // every command with an opaque CDP error instead of a clear one.
    if (isAttached(existing.tabId)) return existing;
    await closeSession(lease.id);
  }
  const tab = await findTab(lease.tab);
  if (!tab)
    throw new Error(
      `No open tab matches ${lease.tab.url || lease.tab.title} — is it still open?`,
    );
  await attach(tab.id);
  const session = createSession({
    ...chromeTransport(tab.id, (point) => moveCursor(lease.id, tab.id, point)),
    // Only a tab the user is actually looking at is worth slowing down for.
    observed: () => watchedTabs.has(tab.id),
  });
  // The lease is pinned to this tab id from now on. Re-matching by URL on
  // every command is how two sessions on the same site end up driving each
  // other's tab — the hijacking agent-browser fixed by binding to a stable
  // target id in 0.34.0. A navigation changes the URL, not the tab.
  session.leaseId = lease.id;
  session.tabId = tab.id;
  await startSession(session);
  sessions.set(lease.id, session);
  return session;
}

async function closeSession(leaseId) {
  const session = sessions.get(leaseId);
  if (!session) return;
  sessions.delete(leaseId);
  stopSession(session);
  detach(session.tabId);
}

/**
 * Animate the in-page cursor to a point and wait for it to land. The content
 * script owns the animation; this only sequences it ahead of the input, which
 * is what makes the pointer look like it travelled rather than teleported.
 */
async function moveCursor(leaseId, tabId, point) {
  try {
    await Promise.race([
      chrome.tabs.sendMessage(tabId, {
        type: "flareai:move-cursor",
        leaseId,
        point,
      }),
      new Promise((resolve) => setTimeout(resolve, CURSOR_TIMEOUT_MS)),
    ]);
  } catch {
    // No content script (a restricted page, or one that has not loaded yet).
    // The command still runs — presentation must never block the action.
  }
}

/**
 * Tabs the user is plausibly looking at: the active tab of the focused window.
 *
 * Kept as a set updated from events rather than queried per action, because
 * the answer is needed on the hot path of every pointer command and a
 * round trip to chrome.tabs there would cost more than the cursor saves.
 */
const watchedTabs = new Set();

async function refreshWatchedTabs() {
  watchedTabs.clear();
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    for (const window of windows) {
      if (!window.focused) continue;
      for (const tab of window.tabs ?? []) if (tab.active) watchedTabs.add(tab.id);
    }
  } catch {
    // Without an answer, assume watched: a little latency beats a screen that
    // changes with no pointer to explain it.
    watchedTabs.clear();
  }
}

chrome.tabs.onActivated.addListener(() => void refreshWatchedTabs());
chrome.windows.onFocusChanged.addListener(() => void refreshWatchedTabs());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete") void refreshWatchedTabs();
});
void refreshWatchedTabs();

// --- Worker-level commands (these need chrome.tabs, not CDP) --------------

const tabCommands = {
  async tabs() {
    const tabs = await chrome.tabs.query({});
    return {
      content: tabs
        .filter((tab) => tab.url && !tab.url.startsWith("chrome://"))
        .map(
          (tab) =>
            `${tab.id}${tab.active ? " *" : "  "} ${tab.title ?? ""} — ${tab.url}`,
        )
        .join("\n"),
    };
  },
  async tabNew(command) {
    // Deliberately inactive: opening a tab must not move the user off what
    // they are looking at. The agent focuses a lease on it instead.
    const tab = await chrome.tabs.create({
      url: command.url || "about:blank",
      active: false,
    });
    return { content: JSON.stringify({ tabId: tab.id, url: tab.url }) };
  },
  async tabClose(command) {
    if (typeof command.tabId !== "number")
      throw new Error("tabClose requires tabId");
    await chrome.tabs.remove(command.tabId);
    return { content: `closed tab ${command.tabId}` };
  },
};

// --- Command dispatch -----------------------------------------------------

async function runCommand(lease) {
  const command = lease.command;
  if (tabCommands[command.kind]) return await tabCommands[command.kind](command);

  const handler = handlers[command.kind];
  if (!handler) throw new Error(`Unsupported command: ${command.kind}`);

  const session = await sessionFor(lease);
  session.paced = pacer(command.pace);

  // A dialog blocks the renderer, so every later command would time out with
  // no hint as to why. Say what is actually in the way.
  if (session.observers.dialog && command.kind !== "dialog")
    throw new Error(
      `A ${session.observers.dialog.type} dialog is blocking the page: ${JSON.stringify(
        session.observers.dialog.message,
      )}. Answer it with the dialog action first.`,
    );

  return await handler(session, command);
}

async function executeLeaseCommand(lease) {
  const command = lease.command;
  if (!command || handledCommands.has(command.id)) return;
  handledCommands.add(command.id);
  // Bounded so a long-lived worker does not accumulate ids forever.
  if (handledCommands.size > 500)
    for (const id of [...handledCommands].slice(0, 250)) handledCommands.delete(id);

  let payload;
  try {
    const outcome = await runCommand(lease);
    const info = sessions.has(lease.id)
      ? await pageInfo(sessions.get(lease.id)).catch(() => ({}))
      : {};
    payload = {
      ok: true,
      content: outcome.content,
      image: outcome.image,
      pageUrl: info.url,
      pageTitle: info.title,
    };
  } catch (error) {
    payload = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  await fetch(RESULTS_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leaseId: lease.id,
      commandId: command.id,
      ...payload,
    }),
  }).catch(() => {
    // The desktop app went away mid-command; its own timeout covers this.
  });
}

// --- Feed polling ---------------------------------------------------------

let pumping = false;

async function pump() {
  if (pumping) return;
  pumping = true;
  let revision = -1;
  try {
    for (;;) {
      const url = new URL(SNAPSHOT_URL);
      if (revision >= 0) {
        url.searchParams.set("after", String(revision));
        url.searchParams.set("waitMs", String(POLL_WAIT_MS));
      }
      let snapshot;
      try {
        const response = await fetch(url.href, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        snapshot = await response.json();
      } catch {
        // FlareAI is not running. Drop every attachment so no tab is left
        // wearing the debugging infobar for a session that no longer exists.
        await releaseAll();
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        revision = -1;
        continue;
      }
      if (Number.isInteger(snapshot.revision)) revision = snapshot.revision;

      const live = new Set();
      for (const lease of snapshot.leases ?? []) {
        if (lease.kind !== "tab") continue;
        live.add(lease.id);
        if (lease.command) void executeLeaseCommand(lease);
      }
      for (const leaseId of [...sessions.keys()])
        if (!live.has(leaseId)) await closeSession(leaseId);
    }
  } finally {
    pumping = false;
  }
}

async function releaseAll() {
  for (const leaseId of [...sessions.keys()]) await closeSession(leaseId);
  detachAll();
}

// --- Content-script relay -------------------------------------------------

// The content script still reads the feed itself for presentation (badge and
// cursor state), and cannot fetch 127.0.0.1 from an arbitrary origin.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "flareai:cursor-arrived") {
    fetch(ARRIVAL_URL, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leaseId: message.leaseId,
        moveSequence: message.moveSequence,
      }),
    })
      .then((response) => sendResponse({ ok: response.ok }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
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
        String(Math.max(0, Math.min(POLL_WAIT_MS, Number(message.waitMs) || 0))),
      );
    }
    fetch(url.href, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`FlareAI agent surface returned ${response.status}`);
        sendResponse({ ok: true, snapshot: await response.json() });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});

chrome.runtime.onSuspend?.addListener(() => void releaseAll());

scheduleSnapshot();
void pump();
