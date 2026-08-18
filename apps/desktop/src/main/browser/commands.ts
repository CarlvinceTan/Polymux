import type { JsonObject } from "@flareai/inference";
import type { SurfaceCommand } from "../agent/surface.js";

/**
 * One description, one schema and one validator for the page command set, so
 * the in-app Browser (`browser`) and the user's own browser (`browser_control`)
 * present the agent with the same actions under the same argument names.
 *
 * Only the page-level actions live here. What each tool owns on top differs —
 * workspace tabs on one side, tab leases on the other — and stays with it.
 */

/** Page actions, in the order an agent normally needs them. */
export const CONTROL_ACTIONS = [
  "snapshot",
  "read",
  "screenshot",
  "get",
  "console",
  "network",
  "eval",
  "click",
  "dblclick",
  "hover",
  "drag",
  "type",
  "fill",
  "press",
  "keydown",
  "keyup",
  "mousemove",
  "mousedown",
  "mouseup",
  "scroll",
  "check",
  "uncheck",
  "select",
  "upload",
  "dialog",
  "wait",
  "back",
  "forward",
  "reload",
] as const;

export type ControlAction = (typeof CONTROL_ACTIONS)[number];

/** Ways to name an element, in the order of preference the agent should use. */
export const LOCATOR_PARAMETERS = {
  ref: { type: "string", description: "Handle from the last snapshot, e.g. e12 — the most reliable target" },
  role: { type: "string", description: "ARIA role, explicit or implicit: button, link, textbox…" },
  text: { type: "string" },
  label: { type: "string" },
  placeholder: { type: "string" },
  testid: { type: "string" },
  name: { type: "string", description: "Accessible name, to narrow a role match" },
  exact: { type: "boolean" },
  index: { type: "number", description: "Which match to take when a locator matches several" },
  selector: { type: "string", description: "CSS selector — a last resort; it breaks when markup changes" },
};

export const CONTROL_PARAMETERS = {
  ...LOCATOR_PARAMETERS,
  x: { type: "number" },
  y: { type: "number" },
  value: { type: "string" },
  key: { type: "string" },
  expression: { type: "string" },
  property: {
    type: "string",
    enum: ["text", "html", "value", "attr", "box", "visible", "enabled", "checked"],
  },
  attribute: { type: "string" },
  files: { type: "array", items: { type: "string" } },
  button: { type: "string", enum: ["left", "middle", "right"] },
  deltaX: { type: "number" },
  deltaY: { type: "number" },
  submit: { type: "boolean" },
  maxChars: { type: "number" },
  interactive: { type: "boolean" },
  compact: { type: "boolean" },
  urls: { type: "boolean" },
  depth: { type: "number" },
  frames: { type: "boolean" },
  fullPage: { type: "boolean" },
  format: { type: "string", enum: ["png", "jpeg"] },
  quality: { type: "number" },
  clear: { type: "boolean" },
  filter: { type: "string" },
  method: { type: "string" },
  requestId: { type: "string" },
  toRef: { type: "string" },
  toSelector: { type: "string" },
  toX: { type: "number" },
  toY: { type: "number" },
  accept: { type: "boolean" },
  status: { type: "boolean" },
  ms: { type: "number" },
  timeoutMs: { type: "number" },
  fn: { type: "string" },
  pace: { type: "string", enum: ["fast", "calm"] },
};

/** The shared half of both tools' descriptions. */
export function describeActions(): string {
  return [
    "See the page with 'snapshot': it returns the accessibility tree with [ref=eN] handles, which is the cheapest and most reliable way to read a page. Pass interactive: true for controls only, compact: true to drop wrapper noise, depth to limit nesting. Iframe content is included in place, so refs reach inside embedded checkout, sign-in and consent frames without switching frames; frames: false leaves them out. Re-snapshot after the page changes — refs are reissued each time and a stale one is refused.",
    "Target an element by ref, or by a semantic locator that survives a redesign: role (with name), text, label, placeholder, testid. Use selector or x/y only as a last resort.",
    "Other ways to look: 'read' (visible text), 'screenshot' (image; fullPage optional), 'get' (one property of one element: text, html, value, attr, box, visible, enabled, checked), 'console' (logs and uncaught errors), 'network' (requests seen so far; requestId for full detail), 'eval' (run an expression).",
    "Act: 'click', 'dblclick', 'hover', 'drag' (to toRef/toSelector/toX+toY), 'type' (per-key, submit: true presses Enter), 'fill' (clear then set, best for long text), 'press'/'keydown'/'keyup' (key like 'Enter' or 'Control+a'), 'scroll' (deltaY), raw 'mousemove'/'mousedown'/'mouseup', 'check'/'uncheck', 'select' (value), 'upload' (files: absolute paths on this machine).",
    "Move with 'back'/'forward'/'reload'. Answer a blocking JavaScript dialog with 'dialog' (accept, text, or status: true to inspect). Synchronise with 'wait' (ms, or selector/text/fn with timeoutMs).",
    "Input pacing defaults to calm, unhurried human movement; pass pace: 'fast' when speed matters more than subtlety.",
  ].join(" ");
}

const NEEDS_TARGET = new Set([
  "click",
  "dblclick",
  "hover",
  "drag",
  "type",
  "fill",
  "check",
  "uncheck",
  "select",
  "upload",
  "get",
]);

const POINT_IS_ENOUGH = new Set(["click", "dblclick", "hover"]);

const LOCATOR_KEYS = ["ref", "role", "text", "label", "placeholder", "testid", "selector"];

/** Reject the argument mistakes that would otherwise fail deep inside a page. */
export function validate(action: string, input: JsonObject): string | null {
  const has = (name: string): boolean =>
    input[name] !== undefined && input[name] !== null && input[name] !== "";

  if (NEEDS_TARGET.has(action)) {
    // `text` names an element for a locator but carries content for type/fill,
    // so it only counts as a target for the actions that have no other use
    // for it.
    const locatorKeys = LOCATOR_KEYS.filter(
      (key) => !(key === "text" && (action === "type" || action === "fill")),
    );
    const targeted = locatorKeys.some((key) => has(key));
    const pointOk =
      POINT_IS_ENOUGH.has(action) &&
      typeof input.x === "number" &&
      typeof input.y === "number";
    if (!targeted && !pointOk)
      return `${action} requires a target: ref (from snapshot), a locator (role/text/label/placeholder/testid), or selector`;
  }
  if (action === "navigate" && !has("url")) return "navigate requires url";
  if (action === "eval" && !has("expression")) return "eval requires expression";
  if (["press", "keydown", "keyup"].includes(action) && !has("key"))
    return `${action} requires key`;
  if (action === "select" && !has("value")) return "select requires value";
  if (action === "upload" && !Array.isArray(input.files))
    return "upload requires files (absolute paths on this machine)";
  if (
    action === "drag" &&
    !has("toRef") &&
    !has("toSelector") &&
    typeof input.toX !== "number"
  )
    return "drag requires toRef, toSelector, or toX/toY";
  if (action === "tabClose" && typeof input.tabId !== "number")
    return "tabClose requires tabId";
  if (
    action === "wait" &&
    typeof input.ms !== "number" &&
    !has("selector") &&
    !has("text") &&
    !has("fn")
  )
    return "wait requires ms, selector, text, or fn";
  return null;
}

/**
 * Shape a tool's flat input into the command a handler executes. Only the
 * fields an action uses are forwarded, so a stray argument can never quietly
 * mean something other than the agent intended.
 */
export function buildCommand(
  action: string,
  input: JsonObject,
): Omit<SurfaceCommand, "id"> {
  const string = (name: string): string | undefined =>
    typeof input[name] === "string" ? (input[name] as string) : undefined;
  const number = (name: string): number | undefined =>
    typeof input[name] === "number" ? (input[name] as number) : undefined;
  const boolean = (name: string): boolean | undefined =>
    typeof input[name] === "boolean" ? (input[name] as boolean) : undefined;

  // The element-naming fields, carried together so every targeting action
  // accepts the same ones.
  const target = {
    ref: string("ref"),
    role: string("role"),
    label: string("label"),
    placeholder: string("placeholder"),
    testid: string("testid"),
    name: string("name"),
    exact: boolean("exact"),
    index: number("index"),
    selector: string("selector"),
    x: number("x"),
    y: number("y"),
  };
  // For actions that do not type anything, `text` names the element. It is
  // carried as `locatorText` so it can never be mistaken for content.
  const targetWithText = { ...target, locatorText: string("text") };
  const pace = input.pace === "fast" ? ("fast" as const) : undefined;
  const base = { kind: action as SurfaceCommand["kind"], ...(pace ? { pace } : {}) };

  switch (action) {
    case "navigate":
      return { ...base, url: string("url") };
    case "snapshot":
      return {
        ...base,
        interactive: boolean("interactive"),
        compact: boolean("compact"),
        urls: boolean("urls"),
        depth: number("depth"),
        frames: boolean("frames"),
      };
    case "read":
      return { ...base, maxChars: number("maxChars") };
    case "screenshot":
      return {
        ...base,
        fullPage: boolean("fullPage"),
        format: input.format === "jpeg" ? "jpeg" : undefined,
        quality: number("quality"),
      };
    case "eval":
      return { ...base, expression: string("expression") };
    case "get":
      return {
        ...base,
        ...targetWithText,
        property: string("property") ?? "text",
        attribute: string("attribute"),
      };
    case "console":
      return { ...base, clear: boolean("clear") };
    case "network":
      return {
        ...base,
        clear: boolean("clear"),
        filter: string("filter"),
        method: string("method"),
        requestId: string("requestId"),
      };
    case "click":
    case "dblclick":
      return { ...base, ...targetWithText, button: buttonOf(input) };
    case "hover":
    case "check":
    case "uncheck":
      return { ...base, ...targetWithText };
    case "drag":
      return {
        ...base,
        ...targetWithText,
        toRef: string("toRef"),
        toSelector: string("toSelector"),
        toX: number("toX"),
        toY: number("toY"),
      };
    case "type":
    case "fill":
      // Here `text` is what to enter, so it is not part of the target.
      return { ...base, ...target, text: string("text") ?? "", submit: boolean("submit") };
    case "press":
    case "keydown":
    case "keyup":
      return { ...base, key: string("key") };
    case "mousemove":
    case "mousedown":
    case "mouseup":
      return { ...base, x: number("x"), y: number("y"), button: buttonOf(input) };
    case "scroll":
      return { ...base, deltaY: number("deltaY") ?? 600, deltaX: number("deltaX") };
    case "select":
      return { ...base, ...targetWithText, value: string("value") };
    case "upload":
      return {
        ...base,
        ...targetWithText,
        files: Array.isArray(input.files)
          ? (input.files as unknown[]).filter(
              (file): file is string => typeof file === "string",
            )
          : [],
      };
    case "dialog":
      return {
        ...base,
        accept: boolean("accept"),
        text: string("text"),
        status: boolean("status"),
      };
    case "wait":
      return {
        ...base,
        ms: number("ms"),
        selector: string("selector"),
        text: string("text"),
        fn: string("fn"),
        timeoutMs: number("timeoutMs"),
      };
    case "tabNew":
      return { ...base, url: string("url") };
    case "tabClose":
      return { ...base, tabId: number("tabId") };
    default:
      return base;
  }
}

function buttonOf(input: JsonObject): "left" | "middle" | "right" | undefined {
  return input.button === "middle" || input.button === "right" || input.button === "left"
    ? input.button
    : undefined;
}
