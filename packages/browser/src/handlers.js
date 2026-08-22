// The command set the agent can run against a page.
//
// One entry per command. Each handler takes a session and the command payload
// and returns `{content?, image?}`; the caller wraps that into whatever result
// its surface expects. Handlers throw to fail, and the message is what the
// agent reads, so it should say what to do differently.
//
// The same table serves both browsers. Nothing here knows whether `send` is
// reaching an Electron WebContentsView or a tab in the user's Chrome — which is
// the point: a capability added here appears on both surfaces at once.
//
// Pointer commands animate a cursor to the target and wait for it to arrive
// before dispatching input, when the session provides one.
import {
  humanClick,
  humanScroll,
  humanType,
  insertText,
  keyHalf,
  mouseButton,
  mouseMove,
  pressKey,
  restingPoint,
  sleep,
} from "./input.js";
import { renderAxTree } from "./snapshot.js";
import { callOnElement, coveringElement, resolveTarget, TargetError } from "./targets.js";

/**
 * The longest an action will wait for the cursor to reach its target.
 *
 * The cursor is a follower, not a gate. When someone is watching it is worth a
 * short pause so the pointer is seen arriving before the control is used —
 * that is what makes the two read as one gesture. But it is capped, because an
 * agent working through a long list must not run at the speed of an animation,
 * and it is skipped entirely when nobody is looking.
 */
const CURSOR_WAIT_CAP_MS = 550;

const READ_LIMIT_DEFAULT = 20_000;
const READ_LIMIT_MAX = 80_000;

export function fillValueRetained(verification) {
  return verification?.supported !== true || verification.matches === true;
}

/**
 * Resolve a target and send the cursor to it.
 *
 * The cursor is started as soon as the point is known and the overlap is
 * deliberate: the covering-element check is a round trip to the page, and the
 * pointer can be travelling during it rather than after it. So the wait, when
 * there is one, is only for whatever travel is left.
 */
async function aim(session, command) {
  const target = await resolveTarget(session.send, command, session.refs);
  const travelling = session.moveCursor(target.point);
  if (target.objectId) {
    const covering = await coveringElement(session.send, target);
    if (covering)
      throw new TargetError(
        `Target is covered by ${covering} at that point — dismiss it, then re-snapshot before retrying.`,
      );
  }
  await settleCursor(session, travelling);
  return target;
}

/**
 * Wait for the cursor only when it is worth waiting for: someone is watching,
 * and then only up to the cap.
 */
async function settleCursor(session, travelling) {
  if (!session.observed?.()) return;
  await Promise.race([travelling, sleep(CURSOR_WAIT_CAP_MS)]);
}

/**
 * Park the cursor at the field's corner so it does not sit over the text.
 *
 * Never waited on: the text can start appearing while the pointer is still
 * sliding clear, which is what a hand does anyway.
 */
function restCursor(session, target) {
  if (!target.box) return;
  void session.moveCursor(restingPoint(target.box));
}

async function pageInfo(session) {
  const { result } = await session.send("Runtime.evaluate", {
    expression: "({url: location.href, title: document.title})",
    returnByValue: true,
  });
  return result?.value ?? {};
}

async function waitForLoad(session, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { result } = await session.send("Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true,
    });
    if (result?.value === "complete" || result?.value === "interactive") return;
    await sleep(120);
  }
}

export const handlers = {
  // --- Navigation ---------------------------------------------------------

  async navigate(session, command) {
    if (!command.url) throw new TargetError("navigate requires url");
    await session.send("Page.navigate", { url: command.url });
    await waitForLoad(session);
    return { content: `navigated to ${command.url}` };
  },

  async back(session) {
    await historyStep(session, -1);
    return { content: "went back" };
  },

  async forward(session) {
    await historyStep(session, 1);
    return { content: "went forward" };
  },

  async reload(session) {
    await session.send("Page.reload", {});
    await waitForLoad(session);
    return { content: "reloaded" };
  },

  // --- Reading the page ---------------------------------------------------

  async snapshot(session, command) {
    await session.send("Accessibility.enable");
    const nodes = await axTreeWithFrames(session, command);
    const { text, refs } = renderAxTree(nodes, {
      interactive: command.interactive === true,
      compact: command.compact === true,
      urls: command.urls !== false,
      depth: typeof command.depth === "number" ? command.depth : null,
      refOffset: session.refCounter,
    });
    // Replace the session's refs wholesale — a ref from the previous snapshot
    // must not survive into this one under a different node.
    session.refs.clear();
    for (const [ref, backendNodeId] of refs) session.refs.set(ref, backendNodeId);
    session.refCounter += refs.size;
    const limit = typeof command.maxChars === "number"
      ? Math.max(200, Math.min(READ_LIMIT_MAX, command.maxChars))
      : null;
    const content = text || "(empty accessibility tree)";
    return {
      content: limit !== null && content.length > limit
        ? `${content.slice(0, limit)}\n…[truncated]`
        : content,
    };
  },

  async read(session, command) {
    const limit = Math.max(
      200,
      Math.min(READ_LIMIT_MAX, command.maxChars || READ_LIMIT_DEFAULT),
    );
    const { result } = await session.send("Runtime.evaluate", {
      expression: "(document.body ? document.body.innerText : '')",
      returnByValue: true,
    });
    const text = String(result?.value ?? "").replace(/\n{3,}/g, "\n\n");
    return {
      content:
        text.length > limit ? `${text.slice(0, limit)}\n…[truncated]` : text,
    };
  },

  async screenshot(session, command) {
    const format = command.format === "jpeg" ? "jpeg" : "png";
    const params = { format, captureBeyondViewport: command.fullPage === true };
    if (format === "jpeg") params.quality = command.quality ?? 80;
    const { data } = await session.send("Page.captureScreenshot", params);
    return {
      content: `captured ${command.fullPage ? "full-page" : "viewport"} ${format}`,
      image: { data, mimeType: `image/${format}` },
    };
  },

  async eval(session, command) {
    if (!command.expression) throw new TargetError("eval requires expression");
    const response = await session.send("Runtime.evaluate", {
      expression: command.expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (response.exceptionDetails)
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text ??
          "eval threw",
      );
    const value = response.result?.value;
    return {
      content: value === undefined ? "undefined" : JSON.stringify(value, null, 2),
    };
  },

  async get(session, command) {
    const target = await resolveTarget(session.send, command, session.refs);
    if (!target.objectId)
      throw new TargetError("get requires ref or selector, not x/y");
    const property = command.property ?? "text";
    const readers = {
      text: "function() { return this.innerText ?? this.textContent ?? ''; }",
      html: "function() { return this.innerHTML; }",
      value: "function() { return this.value ?? null; }",
      attr: `function(name) { return this.getAttribute(name); }`,
      box: "function() { const r = this.getBoundingClientRect(); return {x:r.left,y:r.top,width:r.width,height:r.height}; }",
      visible:
        "function() { const r = this.getBoundingClientRect(); const s = getComputedStyle(this); return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; }",
      enabled: "function() { return !this.disabled; }",
      checked: "function() { return this.checked === true; }",
    };
    const reader = readers[property];
    if (!reader)
      throw new TargetError(
        `Unknown property ${property}; expected one of ${Object.keys(readers).join(", ")}`,
      );
    const value = await callOnElement(
      session.send,
      target.objectId,
      reader,
      property === "attr" ? [command.attribute ?? ""] : [],
    );
    return { content: typeof value === "string" ? value : JSON.stringify(value) };
  },

  async console(session, command) {
    if (command.clear === true) {
      session.observers.clearConsole();
      return { content: "console cleared" };
    }
    const entries = [
      ...session.observers.console.map((entry) => ({ ...entry, kind: "console" })),
      ...session.observers.errors.map((entry) => ({
        ...entry,
        kind: "error",
        level: "error",
      })),
    ];
    if (entries.length === 0) return { content: "(no console output)" };
    return {
      content: entries
        .map((entry) =>
          `[${entry.level}] ${entry.text}${entry.url ? ` (${entry.url}:${entry.line ?? 0})` : ""}`,
        )
        .join("\n"),
    };
  },

  async network(session, command) {
    if (command.clear === true) {
      session.observers.clearRequests();
      return { content: "request log cleared" };
    }
    if (command.requestId) {
      const detail = await session.observers.requestDetail(command.requestId);
      if (!detail) throw new TargetError(`Unknown requestId ${command.requestId}`);
      return { content: JSON.stringify(detail, null, 2) };
    }
    let requests = session.observers.requests;
    if (command.filter)
      requests = requests.filter((request) => request.url.includes(command.filter));
    if (command.method)
      requests = requests.filter(
        (request) => request.method === String(command.method).toUpperCase(),
      );
    if (requests.length === 0) return { content: "(no requests recorded)" };
    return {
      content: requests
        .map(
          (request) =>
            `${request.id} ${request.method} ${request.status ?? request.error ?? "pending"} ${request.type} ${request.url}`,
        )
        .join("\n"),
    };
  },

  // --- Pointer and keyboard ----------------------------------------------

  async click(session, command) {
    const target = await aim(session, command);
    await humanClick(session.send, target.point, {
      paced: session.paced,
      button: command.button ?? "left",
      clickCount: 1,
      textual: target.textual,
    });
    return { content: "clicked" };
  },

  async dblclick(session, command) {
    const target = await aim(session, command);
    await humanClick(session.send, target.point, {
      paced: session.paced,
      clickCount: 2,
      textual: target.textual,
    });
    return { content: "double-clicked" };
  },

  async hover(session, command) {
    const target = await aim(session, command);
    await mouseMove(session.send, target.point);
    return { content: "hovering" };
  },

  async drag(session, command) {
    const from = await aim(session, command);
    const to = await resolveTarget(
      session.send,
      { ref: command.toRef, selector: command.toSelector, x: command.toX, y: command.toY },
      session.refs,
    );
    let releasePoint = from.point;
    await mouseButton(session.send, from.point, "mousePressed", "left", 1);
    try {
      // Drop through intermediate moves — a single jump from press to release
      // is ignored by most drag implementations, which track mousemove.
      const steps = 12;
      for (let step = 1; step <= steps; step += 1) {
        releasePoint = {
          x: Math.round(from.point.x + ((to.point.x - from.point.x) * step) / steps),
          y: Math.round(from.point.y + ((to.point.y - from.point.y) * step) / steps),
        };
        await mouseMove(session.send, releasePoint, "left");
        await sleep(session.paced(12, 28));
      }
      await settleCursor(session, session.moveCursor(to.point));
    } finally {
      await mouseButton(session.send, releasePoint, "mouseReleased", "left", 1);
    }
    return { content: "dragged" };
  },

  async type(session, command) {
    const target = await aim(session, command);
    await humanClick(session.send, target.point, {
      paced: session.paced,
      textual: true,
    });
    restCursor(session, target);
    await humanType(session.send, command.text ?? "", { paced: session.paced });
    if (command.submit === true) {
      await sleep(session.paced(120, 260));
      await pressKey(session.send, "Enter");
    }
    return { content: "typed" };
  },

  /** Clear the field first, then enter the text in one shot. */
  async fill(session, command) {
    const target = await aim(session, command);
    if (!target.objectId) throw new TargetError("fill requires ref or selector");
    await humanClick(session.send, target.point, {
      paced: session.paced,
      textual: true,
    });
    await callOnElement(
      session.send,
      target.objectId,
      "function() { this.focus(); if ('value' in this) { this.select?.(); } }",
    );
    await pressKey(session.send, "Control+a");
    await pressKey(session.send, "Delete");
    restCursor(session, target);
    await insertText(session.send, command.text ?? "");
    // insertText fires `input` but not `change`; frameworks that only listen
    // for change (and every native form validator) need the second one.
    await callOnElement(
      session.send,
      target.objectId,
      "function() { this.dispatchEvent(new Event('change', {bubbles: true})); }",
    );
    // A command result is evidence only when the value actually stuck. This
    // catches controlled inputs that reject the edit as well as malformed
    // calls that would otherwise claim success after clearing a field.
    await sleep(session.paced(20, 40));
    const verification = await callOnElement(
      session.send,
      target.objectId,
      "function(expected) { return 'value' in this ? {supported: true, matches: String(this.value) === expected} : {supported: false, matches: true}; }",
      [command.text ?? ""],
    );
    if (!fillValueRetained(verification))
      throw new TargetError("The field did not retain the requested value. Re-snapshot it before retrying or reporting success.");
    if (command.submit === true) {
      await sleep(session.paced(120, 260));
      await pressKey(session.send, "Enter");
    }
    return { content: verification?.supported ? "filled and verified" : "filled" };
  },

  async press(session, command) {
    if (!command.key) throw new TargetError("press requires key");
    await pressKey(session.send, command.key);
    return { content: `pressed ${command.key}` };
  },

  async keydown(session, command) {
    if (!command.key) throw new TargetError("keydown requires key");
    await keyHalf(session.send, command.key, "keyDown");
    return { content: `key down ${command.key}` };
  },

  async keyup(session, command) {
    if (!command.key) throw new TargetError("keyup requires key");
    await keyHalf(session.send, command.key, "keyUp");
    return { content: `key up ${command.key}` };
  },

  // --- Form controls ------------------------------------------------------

  async check(session, command) {
    return await setChecked(session, command, true);
  },

  async uncheck(session, command) {
    return await setChecked(session, command, false);
  },

  async select(session, command) {
    const target = await aim(session, command);
    if (!target.objectId) throw new TargetError("select requires ref or selector");
    const chosen = await callOnElement(
      session.send,
      target.objectId,
      `function(wanted) {
        if (this.tagName !== 'SELECT') return null;
        const option = [...this.options].find(
          (o) => o.value === wanted || o.label === wanted || o.text.trim() === wanted,
        );
        if (!option) return null;
        this.value = option.value;
        this.dispatchEvent(new Event('input', {bubbles: true}));
        this.dispatchEvent(new Event('change', {bubbles: true}));
        return option.text.trim();
      }`,
      [command.value ?? ""],
    );
    if (chosen === null)
      throw new TargetError(
        `No option matching ${JSON.stringify(command.value)} on that <select>`,
      );
    return { content: `selected ${chosen}` };
  },

  /**
   * Set a file input's files by absolute path. This works where the Polymux
   * version had to refuse: there the file lived on a remote server, whereas
   * FlareAI's agent and browser share one machine, so the path the agent has
   * is a path the browser can open.
   */
  async upload(session, command) {
    const files = Array.isArray(command.files)
      ? command.files
      : command.files
        ? [command.files]
        : [];
    if (files.length === 0) throw new TargetError("upload requires files");
    const target = await resolveTarget(session.send, command, session.refs);
    if (target.backendNodeId === null)
      throw new TargetError("upload requires ref or selector");
    await session.send("DOM.setFileInputFiles", {
      backendNodeId: target.backendNodeId,
      files,
    });
    return { content: `attached ${files.length} file(s)` };
  },

  // --- Raw mouse ----------------------------------------------------------

  async mousemove(session, command) {
    const point = requirePoint(command);
    await settleCursor(session, session.moveCursor(point));
    await mouseMove(session.send, point);
    return { content: `moved to ${point.x},${point.y}` };
  },

  async mousedown(session, command) {
    const point = command.x === undefined ? session.cursor : requirePoint(command);
    await mouseButton(session.send, point, "mousePressed", command.button ?? "left", 1);
    return { content: "mouse down" };
  },

  async mouseup(session, command) {
    const point = command.x === undefined ? session.cursor : requirePoint(command);
    await mouseButton(session.send, point, "mouseReleased", command.button ?? "left", 1);
    return { content: "mouse up" };
  },

  async scroll(session, command) {
    const point = session.cursor ?? { x: 200, y: 300 };
    await humanScroll(
      session.send,
      point,
      command.deltaY ?? 600,
      command.deltaX ?? 0,
      { paced: session.paced },
    );
    return { content: "scrolled" };
  },

  // --- Dialogs ------------------------------------------------------------

  async dialog(session, command) {
    if (command.status === true)
      return {
        content: session.observers.dialog
          ? JSON.stringify(session.observers.dialog)
          : "(no dialog open)",
      };
    const accept = command.accept !== false;
    if (!session.observers.dialog)
      throw new TargetError("No JavaScript dialog is currently open");
    const params = { accept };
    if (accept && typeof command.text === "string") params.promptText = command.text;
    await session.send("Page.handleJavaScriptDialog", params);
    session.observers.dialog = null;
    return { content: accept ? "accepted dialog" : "dismissed dialog" };
  },

  // --- Waits --------------------------------------------------------------

  async wait(session, command) {
    if (typeof command.ms === "number") {
      await sleep(Math.min(30_000, Math.max(0, command.ms)));
      return { content: `waited ${command.ms}ms` };
    }
    const timeout = Math.min(60_000, command.timeoutMs ?? 15_000);
    const deadline = Date.now() + timeout;
    const expression = command.selector
      ? `!!document.querySelector(${JSON.stringify(command.selector)})`
      : command.text
        ? `(document.body?.innerText ?? '').includes(${JSON.stringify(command.text)})`
        : command.fn
          ? `!!(${command.fn})`
          : null;
    if (!expression)
      throw new TargetError("wait requires ms, selector, text, or fn");
    while (Date.now() < deadline) {
      const { result } = await session.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
      });
      if (result?.value === true) return { content: "condition met" };
      await sleep(180);
    }
    throw new TargetError(`Timed out after ${timeout}ms waiting for the condition`);
  },
};

/**
 * The page's accessibility tree with iframe content spliced in where the
 * iframes sit.
 *
 * Without this an iframe is a dead end in the snapshot, and the things most
 * worth automating live inside one — card fields at checkout, embedded sign-in,
 * consent dialogs. Refs inside a frame address their node like any other, so
 * click and fill need no frame switching.
 *
 * Only one level is expanded, and a cross-origin frame that refuses to hand
 * over its tree is skipped rather than failing the snapshot — its content is
 * genuinely out of reach, and a partial page beats an error.
 */
async function axTreeWithFrames(session, command) {
  const root = await session.send("Accessibility.getFullAXTree", {});
  const nodes = [...(root.nodes ?? [])];
  if (command.frames === false) return nodes;

  const iframes = nodes.filter(
    (node) => String(node.role?.value ?? "").toLowerCase() === "iframe",
  );
  for (const iframe of iframes) {
    if (iframe.backendDOMNodeId === undefined) continue;
    let frameNodes;
    try {
      const described = await session.send("DOM.describeNode", {
        backendNodeId: iframe.backendDOMNodeId,
      });
      const frameId = described.node?.frameId;
      if (!frameId) continue;
      const inner = await session.send("Accessibility.getFullAXTree", { frameId });
      frameNodes = inner.nodes ?? [];
    } catch {
      // Cross-origin, detached, or still loading: leave the iframe as a leaf.
      continue;
    }
    if (frameNodes.length === 0) continue;

    // Ids are only unique within their own tree, so namespace the frame's before
    // splicing — otherwise a child id collides with a main-frame node and the
    // walk reparents half the page.
    const prefix = `f${iframe.backendDOMNodeId}:`;
    const rename = (id) => (id === undefined ? undefined : `${prefix}${id}`);
    const rooted = frameNodes.map((node) => ({
      ...node,
      nodeId: rename(node.nodeId),
      parentId: node.parentId === undefined ? undefined : rename(node.parentId),
      childIds: (node.childIds ?? []).map(rename),
    }));
    for (const node of rooted) if (!node.parentId) node.parentId = iframe.nodeId;
    iframe.childIds = [
      ...(iframe.childIds ?? []),
      ...rooted.filter((node) => node.parentId === iframe.nodeId).map((n) => n.nodeId),
    ];
    nodes.push(...rooted);
  }
  return nodes;
}

async function historyStep(session, offset) {
  const history = await session.send("Page.getNavigationHistory", {});
  const target = history.entries?.[history.currentIndex + offset];
  if (!target)
    throw new TargetError(
      offset < 0 ? "Nothing to go back to" : "Nothing to go forward to",
    );
  await session.send("Page.navigateToHistoryEntry", { entryId: target.id });
  await waitForLoad(session);
}

async function setChecked(session, command, wanted) {
  const target = await aim(session, command);
  if (!target.objectId) throw new TargetError("check requires ref or selector");
  const already = await callOnElement(
    session.send,
    target.objectId,
    "function() { return this.checked === true; }",
  );
  if (already === wanted) return { content: `already ${wanted ? "checked" : "unchecked"}` };
  await humanClick(session.send, target.point, { paced: session.paced });
  return { content: wanted ? "checked" : "unchecked" };
}

function requirePoint(command) {
  if (typeof command.x !== "number" || typeof command.y !== "number")
    throw new TargetError("This command requires x and y");
  return { x: command.x, y: command.y };
}

export { pageInfo };
