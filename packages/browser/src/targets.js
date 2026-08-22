// Resolving a command's target to a node, a point, and an object handle.
//
// Commands address elements three ways: a `ref` from the last snapshot (the
// recommended path — deterministic, and immune to markup churn), a semantic
// locator (role/text/label/placeholder/testid, which survive a redesign that
// renames every class), or a CSS `selector`. All of them funnel into one
// backend node id, so every handler sees the same resolved shape.

import { humanPoint } from "./input.js";
import { findByLocator, locatorOf } from "./locators.js";

const TEXTUAL_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
]);

export class ControlError extends Error {
  constructor(message) {
    super(message);
    this.name = "ControlError";
  }
}

export class TargetError extends Error {
  constructor(message) {
    super(message);
    this.name = "TargetError";
  }
}

/**
 * @param {(method: string, params?: object) => Promise<any>} send
 * @param {string} selector
 */
async function backendNodeIdForSelector(send, selector) {
  const { root } = await send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });
  if (!nodeId) throw new TargetError(`No element matches: ${selector}`);
  const { node } = await send("DOM.describeNode", { nodeId });
  return node.backendNodeId;
}

/**
 * @param {(method: string, params?: object) => Promise<any>} send
 * @param {number} backendNodeId
 */
export async function resolveObject(send, backendNodeId) {
  const { object } = await send("DOM.resolveNode", { backendNodeId });
  if (!object?.objectId)
    throw new TargetError(`Could not resolve node ${backendNodeId}`);
  return object.objectId;
}

/** Run a function with the element as `this`, returning its value. */
/**
 * @param {(method: string, params?: object) => Promise<any>} send
 * @param {string} objectId
 * @param {string} functionDeclaration
 * @param {unknown[]} [args]
 */
export async function callOnElement(send, objectId, functionDeclaration, args = []) {
  const result = await send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw new ControlError(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "element call failed",
    );
  return result.result?.value;
}

/**
 * Resolve a target to `{backendNodeId, objectId, point, textual, box}`.
 *
 * The element is scrolled into view first, because a point computed against a
 * box that is off-screen addresses whatever happens to be at those viewport
 * coordinates instead — which is how an agent clicks the wrong thing while
 * believing it hit the right one.
 */
/**
 * @param {(method: string, params?: object) => Promise<any>} send
 * @param {Record<string, any>} command
 * @param {Map<string, number>} refs
 */
export async function resolveTarget(send, command, refs) {
  let backendNodeId;
  const locator = locatorOf(command);
  if (locator) {
    const found = await findByLocator(send, locator);
    backendNodeId = found.backendNodeId;
  } else if (command.ref) {
    backendNodeId = refs.get(command.ref);
    if (backendNodeId === undefined)
      throw new TargetError(
        `Unknown ref ${command.ref} — take a snapshot first, and re-snapshot after the page changes.`,
      );
  } else if (command.selector) {
    backendNodeId = await backendNodeIdForSelector(send, command.selector);
  } else if (typeof command.x === "number" && typeof command.y === "number") {
    return {
      backendNodeId: null,
      objectId: null,
      point: { x: command.x, y: command.y },
      textual: false,
      box: null,
    };
  } else {
    throw new TargetError(
      "No target: provide ref (from snapshot), a locator (role/text/label/placeholder/testid), selector, or x/y",
    );
  }

  try {
    await send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
  } catch {
    // Detached or zero-size nodes cannot scroll; the box check below reports
    // that more usefully than a scroll failure would.
  }

  const objectId = await resolveObject(send, backendNodeId);
  const box = await elementBox(send, backendNodeId, objectId);
  const textual = await callOnElement(
    send,
    objectId,
    `function() {
      if (this.isContentEditable) return true;
      const tag = this.tagName;
      if (tag === 'TEXTAREA') return true;
      if (tag !== 'INPUT') return false;
      return ${JSON.stringify([...TEXTUAL_INPUT_TYPES])}.includes((this.type || 'text').toLowerCase());
    }`,
  );
  return {
    backendNodeId,
    objectId,
    box,
    textual: Boolean(textual),
    point: humanPoint(box, Boolean(textual)),
  };
}

/**
 * The element's box in **main-frame** coordinates.
 *
 * `DOM.getContentQuads` is used rather than `getBoundingClientRect` because a
 * rect read inside an iframe is relative to that iframe's own viewport: click
 * there and the pointer lands at those coordinates in the *top* document,
 * which is somewhere else entirely. CDP resolves the frame offsets for us.
 *
 * @param {(method: string, params?: object) => Promise<any>} send
 * @param {number} backendNodeId
 * @param {string} objectId
 */
async function elementBox(send, backendNodeId, objectId) {
  try {
    const { quads } = await send("DOM.getContentQuads", { backendNodeId });
    const quad = (quads ?? []).find((candidate) => quadArea(candidate) > 1);
    if (quad) {
      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
  } catch {
    // Not laid out, or a node type with no quads; fall through to the rect.
  }
  // Fallback for anything CDP will not quantify — correct in the main frame,
  // and the only option left.
  const box = await callOnElement(
    send,
    objectId,
    `function() {
      const r = this.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }`,
  );
  if (!box || (box.width === 0 && box.height === 0))
    throw new TargetError(
      "Target has no visible box — it is hidden, collapsed, or not laid out.",
    );
  return box;
}

/** Shoelace area of a CDP quad, to skip the empty ones. */
function quadArea(quad) {
  let area = 0;
  for (let corner = 0; corner < 4; corner += 1) {
    const nextCorner = (corner + 1) % 4;
    area +=
      quad[corner * 2] * quad[nextCorner * 2 + 1] -
      quad[nextCorner * 2] * quad[corner * 2 + 1];
  }
  return Math.abs(area / 2);
}

/**
 * Report what is actually on top at the click point, so a click that would
 * land on an overlay fails with the reason rather than silently dismissing a
 * cookie banner. Returns null when the target (or a descendant of it) is on
 * top, which is the normal case.
 */
/**
 * @param {(method: string, params?: object) => Promise<any>} send
 * @param {{objectId: string|null, point: {x: number, y: number}}} target
 */
export async function coveringElement(send, target) {
  if (!target.objectId) return null;
  const covering = await callOnElement(
    send,
    target.objectId,
    `function(x, y) {
      const top = document.elementFromPoint(x, y);
      if (!top) return null;
      if (top === this || this.contains(top) || top.contains(this)) return null;
      const id = top.id ? '#' + top.id : '';
      const cls = typeof top.className === 'string' && top.className
        ? '.' + top.className.trim().split(/\\s+/).slice(0, 2).join('.')
        : '';
      return top.tagName.toLowerCase() + id + cls;
    }`,
    [target.point.x, target.point.y],
  );
  return covering ?? null;
}
