// Midas agent surface — in-page presentation and control.
//
// Adapted from the user's Hermes Agent Surface extension so the presentation
// contract matches the ChatGPT desktop one exactly: a Codex-style favicon
// badge on leased tabs and the same spring-animated cursor (cursor-motion.js).
// On top of that, this content script executes control commands (navigate,
// click, type, scroll, read) that the Midas agent issues through the loopback
// feed, animating the cursor to the target before pointer actions.
(() => {
  "use strict";

  const BADGE_MARKER = "midas-favicon-badge";
  const BADGED_SELECTOR = 'link[data-midas-favicon-badge="true"]';
  const ICON_SELECTOR = 'link[rel~="icon"], link[rel="shortcut icon"]';
  const CREATED = "midasFaviconBadgeCreated";
  const ORIGINAL = "midasOriginalFaviconHref";
  const APPLE_TOUCH_ICON = "apple-touch-icon";
  const CURSOR_PATH =
    "M3.04536 4.45259C2.7582 3.60299 3.60299 2.7582 4.45259 3.04536L14.1828 6.33403C15.1637 6.66558 15.0872 8.08006 14.0715 8.39045L10.2994 9.54319C9.93919 9.65327 9.65327 9.93919 9.54319 10.2994L8.39046 14.0715C8.08007 15.0872 6.66558 15.1637 6.33404 14.1828L3.04536 4.45259Z";

  let applied = [];
  let displaced = [];
  let currentLeaseId = null;
  let currentLease = null;
  let currentSnapshot = null;
  let overlayHost = null;
  let cursorRenderer = null;
  let expiryTimer = null;
  let watching = false;
  let stopped = false;
  let handledCommandId = null;
  let pendingAction = null;
  // Local cursor moves ride above any server-driven sequence; monotonic so a
  // second action on the same lease is never deduped as an already-acknowledged
  // arrival.
  let localMoveSequence = 1_000_000;

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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-midas-favicon-badge="${BADGE_MARKER}" width="32" height="32" viewBox="0 0 32 32"><image href="${escapeXml(
      faviconUrl
    )}" width="32" height="32"${opacity} />${badgeShape(state)}</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  function isOurBadge(value) {
    if (!value || !value.startsWith("data:image/svg+xml,")) return false;
    try {
      return decodeURIComponent(value.slice(19)).includes(
        `data-midas-favicon-badge="${BADGE_MARKER}"`
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
    delete link.dataset.midasFaviconBadge;
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
      link.dataset.midasFaviconBadge = "true";
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

  function ensureOverlay() {
    if (cursorRenderer !== null) return;
    overlayHost = document.createElement("div");
    overlayHost.id = "midas-agent-overlay-root";
    overlayHost.dataset.midasOverlayRoot = "";
    const shadow = overlayHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent =
      ".midas-overlay{all:initial;z-index:2147483646;pointer-events:none;position:fixed;inset:0}@media print{.midas-overlay{display:none}}";
    const root = document.createElement("div");
    root.className = "midas-overlay";
    root.setAttribute("aria-hidden", "true");
    shadow.append(style, root);
    document.documentElement.appendChild(overlayHost);
    cursorRenderer = globalThis.MidasCursorMotion.createRenderer(root, {
      glowColor: "#339cff",
      onArrived(moveSequence) {
        if (pendingAction && pendingAction.moveSequence === moveSequence) {
          const action = pendingAction;
          pendingAction = null;
          action.run();
          return;
        }
        if (!currentLease?.id) return;
        chrome.runtime.sendMessage({
          type: "midas:cursor-arrived",
          leaseId: currentLease.id,
          moveSequence,
        });
      },
    });
  }

  function viewportSize() {
    return {
      height: window.visualViewport?.height ?? window.innerHeight,
      width: window.visualViewport?.width ?? window.innerWidth,
    };
  }

  function renderCursor(lease, cursorOverride = null) {
    ensureOverlay();
    cursorRenderer.setState({
      cursor: cursorOverride ?? lease?.cursor ?? null,
      isVisible: lease !== null,
      turnKey: lease?.id ?? null,
      viewportSize: viewportSize(),
    });
  }

  function destroyOverlay() {
    cursorRenderer?.destroy();
    cursorRenderer = null;
    overlayHost?.remove();
    overlayHost = null;
  }

  // --- Humanized input (ported from the old midas repo's humanize package:
  // randomized in-box click targets, aim and hold delays, per-character
  // typing cadence with thinking pauses, and accel/cruise/decel scrolling) --

  const rand = (min, max) => min + Math.random() * (max - min);
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  // Pace profiles: calm is the default assistant temperament — unhurried,
  // clearly human; fast is the old repo's "as fast as possible while staying
  // behaviourally indistinguishable" profile. Every humanized delay funnels
  // through paced().
  const PACE = { fast: 1, calm: 1.65 };
  let paceFactor = PACE.calm;
  const setPace = (pace) => {
    paceFactor = PACE[pace] ?? PACE.calm;
  };
  const paced = (min, max) => rand(min, max) * paceFactor;

  function isTextualTarget(element) {
    return (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLElement && element.isContentEditable)
    );
  }

  // Inputs land toward the left of the box (inside the text, not trailing
  // whitespace); buttons land near the centre. Never dead-centre every time.
  function humanClickPoint(element) {
    const rect = element.getBoundingClientRect();
    const input = isTextualTarget(element);
    const xFrac = input ? rand(0.15, 0.45) : rand(0.35, 0.65);
    const yFrac = input ? rand(0.3, 0.7) : rand(0.35, 0.65);
    return {
      x: Math.round(rect.left + rect.width * xFrac),
      y: Math.round(rect.top + rect.height * yFrac),
    };
  }

  // --- Control command execution -----------------------------------------

  function postResult(lease, command, result) {
    chrome.runtime.sendMessage({
      type: "midas:command-result",
      leaseId: lease.id,
      commandId: command.id,
      ok: result.ok !== false,
      error: result.error,
      pageUrl: location.href,
      pageTitle: document.title,
      content: result.content,
    });
  }

  function elementCenter(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function findTarget(command) {
    if (command.selector) {
      const element = document.querySelector(command.selector);
      if (!element) return { error: `No element matches: ${command.selector}` };
      element.scrollIntoView({ block: "center", inline: "nearest" });
      return { element, point: humanClickPoint(element) };
    }
    if (typeof command.x === "number" && typeof command.y === "number") {
      const element = document.elementFromPoint(command.x, command.y);
      return { element, point: { x: command.x, y: command.y } };
    }
    return { error: "No target: provide selector or x/y" };
  }

  async function synthesizeClick(element, point) {
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
      button: 0,
      view: window,
    };
    const fire = (type) => {
      const event =
        type.startsWith("pointer") && typeof PointerEvent === "function"
          ? new PointerEvent(type, { ...base, pointerId: 1, isPrimary: true })
          : new MouseEvent(type, base);
      element.dispatchEvent(event);
    };
    const textual = isTextualTarget(element);
    // Aim: a beat between arriving on the target and pressing.
    await sleep(textual ? paced(60, 130) : paced(80, 160));
    fire("pointerdown");
    fire("mousedown");
    // Hold: real clicks are not zero-width.
    await sleep(textual ? paced(40, 80) : paced(50, 100));
    fire("pointerup");
    fire("mouseup");
    fire("click");
    if (element instanceof HTMLElement) element.focus({ preventScroll: true });
  }

  function setNativeValue(element, value) {
    const proto =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  function keyEventInit(ch) {
    const upper = /[A-Z]/.test(ch);
    return {
      bubbles: true,
      cancelable: true,
      key: ch,
      code: /[a-zA-Z]/.test(ch) ? `Key${ch.toUpperCase()}` : undefined,
      shiftKey: upper,
      keyCode: ch.charCodeAt(0),
      which: ch.charCodeAt(0),
    };
  }

  async function synthesizeType(element, text, submit) {
    if (element instanceof HTMLElement) element.focus({ preventScroll: true });
    const field =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement;
    const editable =
      element instanceof HTMLElement && element.isContentEditable;
    if (!field && !editable)
      return { ok: false, error: "Target is not an editable element" };

    let value = field ? element.value : (element.textContent ?? "");
    for (const ch of text) {
      const init = keyEventInit(ch);
      element.dispatchEvent(new KeyboardEvent("keydown", init));
      element.dispatchEvent(new KeyboardEvent("keypress", init));
      value += ch;
      if (field) setNativeValue(element, value);
      else element.textContent = value;
      element.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" })
      );
      element.dispatchEvent(new KeyboardEvent("keyup", init));
      // Per-key cadence with the occasional thinking pause.
      await sleep(Math.random() < 0.03 ? paced(220, 480) : paced(35, 110));
    }
    if (field) element.dispatchEvent(new Event("change", { bubbles: true }));

    if (submit) {
      await sleep(paced(120, 260));
      const key = {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
      };
      element.dispatchEvent(new KeyboardEvent("keydown", key));
      element.dispatchEvent(new KeyboardEvent("keyup", key));
      const form = element.closest?.("form");
      // requestSubmit runs submit handlers and validation like a real Enter;
      // form.submit() would bypass both and hard-navigate.
      if (form?.requestSubmit) form.requestSubmit();
      else if (form) form.submit();
    }
    return { ok: true };
  }

  function readPage(maxChars) {
    const limit = Math.max(200, Math.min(80_000, maxChars || 20_000));
    const text = (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n");
    return {
      ok: true,
      content: text.length > limit ? `${text.slice(0, limit)}\n…[truncated]` : text,
    };
  }

  // Where the overlay cursor last landed, for approach-distance decisions.
  let lastCursorPoint = null;

  function moveCursorTo(lease, point) {
    return new Promise((resolve) => {
      ensureOverlay();
      localMoveSequence += 1;
      const moveSequence = localMoveSequence;
      pendingAction = { moveSequence, run: resolve };
      renderCursor(lease, {
        x: point.x,
        y: point.y,
        visible: true,
        animateMovement: true,
        moveSequence,
      });
    });
  }

  // Animate the cursor to the target, then run the action on arrival — the
  // same move-then-act sequencing the ChatGPT desktop presentation uses.
  // Long moves approach in two stages: land short of the target, settle for a
  // beat, then make the small corrective hop a real hand makes (Fitts' law);
  // straight-to-target long jumps are the tell that a robot is driving.
  function withCursorAt(lease, point, run) {
    void (async () => {
      const from = lastCursorPoint ?? {
        x: Math.round(window.innerWidth * 0.58),
        y: Math.round(window.innerHeight * 0.55),
      };
      const distance = Math.hypot(point.x - from.x, point.y - from.y);
      if (distance > 260) {
        // Undershoot along the travel direction with a little sideways miss.
        const shortfall = rand(24, 64);
        const angle = Math.atan2(point.y - from.y, point.x - from.x);
        const side = angle + Math.PI / 2;
        const miss = rand(-14, 14);
        const approach = {
          x: Math.round(point.x - Math.cos(angle) * shortfall + Math.cos(side) * miss),
          y: Math.round(point.y - Math.sin(angle) * shortfall + Math.sin(side) * miss),
        };
        await moveCursorTo(lease, approach);
        await sleep(paced(50, 110));
      }
      await moveCursorTo(lease, point);
      lastCursorPoint = point;
      run();
    })();
  }

  function executeCommand(lease) {
    const command = lease.command;
    if (!command || command.id === handledCommandId) return;
    handledCommandId = command.id;
    setPace(command.pace);

    if (command.kind === "navigate") {
      postResult(lease, command, { ok: true });
      window.setTimeout(() => {
        location.href = command.url;
      }, 30);
      return;
    }
    if (command.kind === "read") {
      postResult(lease, command, readPage(command.maxChars));
      return;
    }
    if (command.kind === "scroll") {
      void (async () => {
        const total = command.deltaY ?? 600;
        const direction = total < 0 ? -1 : 1;
        let remaining = Math.abs(total);
        const steps = [];
        // Acceleration, cruise, deceleration — a wheel spin, not a teleport.
        const accel = Math.round(rand(2, 3));
        const decel = Math.round(rand(2, 3));
        while (remaining > 0) {
          const cruise = steps.length >= accel && remaining > 220;
          const delta = Math.min(remaining, cruise ? rand(100, 150) : rand(60, 95));
          steps.push(delta);
          remaining -= delta;
        }
        for (let i = 0; i < steps.length; i++) {
          const slow = i < accel || i >= steps.length - decel;
          window.scrollBy(0, steps[i] * direction);
          await sleep(slow ? paced(60, 110) : paced(25, 50));
        }
        postResult(lease, command, { ok: true });
      })();
      return;
    }
    if (command.kind === "click" || command.kind === "type") {
      const target = findTarget(command);
      if (target.error || !target.element) {
        postResult(lease, command, {
          ok: false,
          error: target.error ?? "No element at that point",
        });
        return;
      }
      withCursorAt(lease, target.point, () => {
        void (async () => {
          try {
            if (command.kind === "click") {
              await synthesizeClick(target.element, target.point);
              postResult(lease, command, { ok: true });
            } else {
              await synthesizeClick(target.element, target.point);
              const outcome = await synthesizeType(
                target.element,
                command.text ?? "",
                command.submit === true
              );
              postResult(lease, command, outcome);
            }
          } catch (error) {
            postResult(lease, command, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })();
      });
      return;
    }
    postResult(lease, command, {
      ok: false,
      error: `Unsupported command: ${command.kind}`,
    });
  }

  // --- Feed plumbing (identical shape to the Hermes extension) ------------

  function requestSnapshot(afterRevision = null, waitMs = 0) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: afterRevision === null ? "midas:snapshot" : "midas:changes",
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
      renderCursor(null);
      return;
    }

    const favicon = lease.tab.faviconUrl || originalFavicon();
    if (currentLeaseId !== `${lease.id}:${lease.state}:${favicon}`) {
      applyFavicon(lease.state, favicon);
      currentLeaseId = `${lease.id}:${lease.state}:${favicon}`;
    }
    if (!pendingAction) renderCursor(lease);
    executeCommand(lease);
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

  function rerenderCursor() {
    if (!pendingAction) renderCursor(currentLease);
  }

  window.addEventListener("pageshow", start);
  window.addEventListener("hashchange", refresh);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("resize", rerenderCursor);
  window.visualViewport?.addEventListener("resize", rerenderCursor);
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearExpiryTimer();
    restoreFavicon();
    destroyOverlay();
  });
  start();
})();
