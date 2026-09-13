// Polymux agent surface — in-page presentation and control.
//
// Adapted from the user's Hermes Agent Surface extension so the presentation
// contract matches the ChatGPT desktop one exactly: a Codex-style favicon
// badge on leased tabs and the same spring-animated cursor (cursor-motion.js).
// On top of that, this content script executes control commands (navigate,
// click, type, scroll, read) that the Polymux agent issues through the loopback
// feed, animating the cursor to the target before pointer actions.
(() => {
  "use strict";

  const BADGE_MARKER = "polymux-favicon-badge";
  const BADGED_SELECTOR = 'link[data-polymux-favicon-badge="true"]';
  const ICON_SELECTOR = 'link[rel~="icon"], link[rel="shortcut icon"]';
  const CREATED = "polymuxFaviconBadgeCreated";
  const ORIGINAL = "polymuxOriginalFaviconHref";
  const APPLE_TOUCH_ICON = "apple-touch-icon";
  const CURSOR_PATH =
    "M3.04536 4.45259C2.7582 3.60299 3.60299 2.7582 4.45259 3.04536L14.1828 6.33403C15.1637 6.66558 15.0872 8.08006 14.0715 8.39045L10.2994 9.54319C9.93919 9.65327 9.65327 9.93919 9.54319 10.2994L8.39046 14.0715C8.08007 15.0872 6.66558 15.1637 6.33404 14.1828L3.04536 4.45259Z";

  let applied = [];
  let displaced = [];
  let currentLeaseId = null;
  let currentLease = null;
  let currentSnapshot = null;
  let expiryTimer = null;
  let watching = false;
  let stopped = false;

  function escapeXml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function badgeShape(state) {
    if (state === "active") {
      return `<path d="${CURSOR_PATH}" fill="black" stroke="white" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke fill" transform="translate(-2 -2) scale(2.1)" />`;
    }
    if (state === "deliverable") {
      return '<circle cx="24" cy="24" r="7" fill="#22c55e" />';
    }
    if (state === "handoff") {
      return '<circle cx="24" cy="24" r="7" fill="#facc15" />';
    }
    return "";
  }

  function badgedFavicon(state, faviconUrl) {
    const opacity = state === "active" ? ' opacity="0.3"' : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-polymux-favicon-badge="${BADGE_MARKER}" width="32" height="32" viewBox="0 0 32 32"><image href="${escapeXml(
      faviconUrl
    )}" width="32" height="32"${opacity} />${badgeShape(state)}</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  function isOurBadge(value) {
    if (!value || !value.startsWith("data:image/svg+xml,")) return false;
    try {
      return decodeURIComponent(value.slice(19)).includes(
        `data-polymux-favicon-badge="${BADGE_MARKER}"`
      );
    } catch {
      return false;
    }
  }

  function head() {
    if (document.head) return document.head;
    const element = document.createElement("head");
    document.documentElement.prepend(element);
    return element;
  }

  function originalFavicon() {
    const existing = [...document.querySelectorAll(ICON_SELECTOR)].find(
      (link) => !isOurBadge(link.getAttribute("href"))
    );
    if (existing?.href) return existing.href;
    return `${location.origin}/favicon.ico`;
  }

  function clearDataset(link) {
    delete link.dataset.polymuxFaviconBadge;
    delete link.dataset[CREATED];
    delete link.dataset[ORIGINAL];
  }

  function restoreLink({ badgedHref, created, originalHref, link }) {
    const href = link.getAttribute("href");
    const stillBadged = href === badgedHref || isOurBadge(href);
    clearDataset(link);
    if (!stillBadged) return;
    if (created) {
      link.remove();
    } else if (originalHref === null) {
      link.removeAttribute("href");
    } else {
      link.href = originalHref;
    }
  }

  function restoreFavicon() {
    const previous = applied;
    applied = [];
    for (const item of previous) restoreLink(item);

    for (const link of document.querySelectorAll(BADGED_SELECTOR)) {
      if (!isOurBadge(link.getAttribute("href"))) {
        clearDataset(link);
        continue;
      }
      restoreLink({
        link,
        badgedHref: link.getAttribute("href"),
        created: link.dataset[CREATED] === "true",
        originalHref: link.dataset[ORIGINAL] ?? null,
      });
    }

    const oldDisplaced = displaced;
    displaced = [];
    for (const [link, rel] of oldDisplaced) {
      if (isOurBadge(link.getAttribute("href"))) link.remove();
      else if (link.rel === APPLE_TOUCH_ICON) link.rel = rel;
    }
  }

  function applyFavicon(state, faviconUrl) {
    restoreFavicon();
    const badgedHref = badgedFavicon(state, faviconUrl);
    let links = [...document.querySelectorAll(ICON_SELECTOR)];
    if (links.length === 0) {
      const link = document.createElement("link");
      link.rel = "icon";
      head().appendChild(link);
      links = [link];
    }
    applied = links.map((link) => {
      const originalHref = link.getAttribute("href");
      const created = originalHref === null;
      link.href = badgedHref;
      link.dataset.polymuxFaviconBadge = "true";
      if (created) link.dataset[CREATED] = "true";
      else link.dataset[ORIGINAL] = originalHref;
      return { badgedHref, created, originalHref, link };
    });
  }

  function normalizedUrl(value) {
    try {
      const url = new URL(value);
      url.hash = "";
      return url.href;
    } catch {
      return "";
    }
  }

  function matchingLease(snapshot) {
    const here = normalizedUrl(location.href);
    const title = document.title.trim().toLowerCase();
    return (snapshot?.leases || [])
      .filter(
        (lease) =>
          lease.kind === "tab" &&
          lease.expiresAtMs > Date.now() &&
          lease.tab
      )
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .find((lease) => {
        const targetUrl = normalizedUrl(lease.tab.url || "");
        const targetTitle = String(lease.tab.title || "").trim().toLowerCase();
        if (targetUrl && targetUrl === here) return true;
        return Boolean(targetTitle && title && targetTitle === title);
      });
  }

  // The overlay itself is shared with the in-app Browser
  // (@polymux/browser/src/cursor-overlay.js, loaded just before this
  // file), so the agent's pointer looks and moves identically in both.
  const overlay = () => globalThis.PolymuxCursorOverlay;

  // --- Cursor requests from the background worker ------------------------

  // The worker owns command execution; before it dispatches a pointer event it
  // asks for the cursor to travel to the target and waits for this reply. That
  // keeps the move-then-act sequencing the presentation is built around, with
  // the input itself trusted (CDP) rather than synthesized in-page.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "polymux:move-cursor") return false;
    if (!currentLease || !message.point) {
      sendResponse({ ok: false });
      return true;
    }
    overlay()
      .moveTo(message.point)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  });

  // --- Feed plumbing (identical shape to the Hermes extension) ------------

  function requestSnapshot(afterRevision = null, waitMs = 0) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: afterRevision === null ? "polymux:snapshot" : "polymux:changes",
          afterRevision,
          waitMs,
        },
        (response) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || "snapshot unavailable"));
            return;
          }
          resolve(response.snapshot);
        }
      );
    });
  }

  function clearExpiryTimer() {
    if (expiryTimer !== null) window.clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  function applySnapshot(snapshot) {
    currentSnapshot = snapshot;
    const lease = matchingLease(snapshot) ?? null;
    currentLease = lease;
    if (!lease) {
      if (currentLeaseId !== null) restoreFavicon();
      currentLeaseId = null;
      clearExpiryTimer();
      overlay().hide();
      return;
    }

    const favicon = lease.tab.faviconUrl || originalFavicon();
    if (currentLeaseId !== `${lease.id}:${lease.state}:${favicon}`) {
      applyFavicon(lease.state, favicon);
      currentLeaseId = `${lease.id}:${lease.state}:${favicon}`;
    }
    overlay().show();
    clearExpiryTimer();
    expiryTimer = window.setTimeout(
      () => applySnapshot(currentSnapshot),
      Math.max(0, lease.expiresAtMs - Date.now()) + 5
    );
  }

  async function refresh() {
    try {
      applySnapshot(await requestSnapshot());
    } catch {
      applySnapshot({ leases: [] });
    }
  }

  async function watchChanges() {
    if (watching) return;
    watching = true;
    let revision = Number.isInteger(currentSnapshot?.revision)
      ? currentSnapshot.revision
      : -1;
    while (!stopped) {
      try {
        const snapshot = await requestSnapshot(revision, 25_000);
        if (stopped) break;
        applySnapshot(snapshot);
        if (Number.isInteger(snapshot?.revision)) {
          revision = snapshot.revision;
        }
      } catch {
        if (stopped) break;
        applySnapshot({ leases: [] });
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
    }
    watching = false;
  }

  async function start() {
    stopped = false;
    if (watching) return;
    try {
      applySnapshot(await requestSnapshot());
    } catch {
      applySnapshot({ leases: [] });
    }
    watchChanges();
  }

  window.addEventListener("pageshow", start);
  window.addEventListener("hashchange", refresh);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearExpiryTimer();
    restoreFavicon();
    overlay().hide();
  });
  start();
})();
