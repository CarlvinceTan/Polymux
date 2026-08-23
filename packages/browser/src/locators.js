// Semantic locators: address an element by what it is, not by where it sits.
//
// A CSS selector breaks the moment a class is renamed, and a ref is only valid
// until the next snapshot. `role`, `text`, `label`, `placeholder` and `testid`
// survive both, which is why agent-browser leads with them — and why its 0.32.4
// fix matters here: matching only an explicit `role=` attribute misses ordinary
// HTML, so a plain `<button>Save</button>` has to be findable as role "button"
// with accessible name "Save".

import { ControlError, TargetError } from "./targets.js";

/**
 * Locator fields, and the kind each one searches by.
 *
 * The text locator is carried as `locatorText`, not `text`: `type` and `fill`
 * use `text` for what to enter, and a field that means "find this" in one
 * command and "type this" in another will eventually do the wrong one.
 */
const LOCATOR_FIELDS = [
  ["role", "role"],
  ["locatorText", "text"],
  ["label", "label"],
  ["placeholder", "placeholder"],
  ["testid", "testid"],
];

export const LOCATOR_KINDS = LOCATOR_FIELDS.map(([, kind]) => kind);

/** Roles Chrome infers from the tag alone. */
const IMPLICIT_ROLES = {
  BUTTON: "button",
  A: "link",
  TEXTAREA: "textbox",
  SELECT: "combobox",
  H1: "heading",
  H2: "heading",
  H3: "heading",
  H4: "heading",
  H5: "heading",
  H6: "heading",
  IMG: "img",
  NAV: "navigation",
  MAIN: "main",
  TABLE: "table",
  FORM: "form",
  OPTION: "option",
  LI: "listitem",
};

// Runs in the page. Collects matches onto a well-known global so the caller can
// take a handle on one without re-running the search (and re-running it after
// the page moved is how you act on a different element than you measured).
const FIND_SOURCE = `(kind, query, wantName, exact, implicitRoles) => {
  const norm = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const hit = (haystack, needle) =>
    exact ? haystack === needle : haystack.toLowerCase().includes(needle.toLowerCase());

  const accessibleName = (el) => {
    const labelledBy = el.getAttribute && el.getAttribute("aria-labelledby");
    const fromLabelledBy = labelledBy
      ? labelledBy
          .split(/\\s+/)
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .map((node) => node.innerText)
          .join(" ")
      : "";
    return norm(
      (el.getAttribute && el.getAttribute("aria-label")) ||
        fromLabelledBy ||
        (el.labels && el.labels[0] ? el.labels[0].innerText : "") ||
        (el.getAttribute && el.getAttribute("title")) ||
        (el.getAttribute && el.getAttribute("alt")) ||
        (el.getAttribute && el.getAttribute("placeholder")) ||
        (el.tagName === "INPUT" ? el.value : "") ||
        el.innerText,
    );
  };

  const roleOf = (el) => {
    const explicit = el.getAttribute && el.getAttribute("role");
    if (explicit) return explicit.trim().toLowerCase();
    if (el.tagName === "INPUT") {
      const type = String(el.type || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button" || type === "reset") return "button";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    if (el.tagName === "A" && !el.hasAttribute("href")) return "generic";
    if (el.isContentEditable) return "textbox";
    return implicitRoles[el.tagName] || "generic";
  };

  const all = Array.prototype.slice.call(document.querySelectorAll("*"));
  let found;
  if (kind === "role") {
    const wanted = query.toLowerCase();
    found = all.filter((el) => roleOf(el) === wanted);
    if (wantName !== null) found = found.filter((el) => hit(accessibleName(el), norm(wantName)));
  } else if (kind === "text") {
    // Leaf nodes only: every ancestor of a match also "contains" the text, and
    // clicking the <body> because it contains "Sign in" is never what was meant.
    found = all.filter((el) => el.children.length === 0 && hit(norm(el.innerText), query));
  } else if (kind === "label") {
    found = all.filter(
      (el) =>
        ((el.labels && el.labels.length) || (el.getAttribute && el.getAttribute("aria-label"))) &&
        hit(accessibleName(el), query),
    );
  } else if (kind === "placeholder") {
    found = all.filter((el) => el.getAttribute && hit(norm(el.getAttribute("placeholder")), query));
  } else if (kind === "testid") {
    found = all.filter((el) => el.getAttribute && hit(norm(el.getAttribute("data-testid")), query));
  } else {
    return { error: "Unknown locator kind: " + kind };
  }

  // Drop an ancestor that only matched through a descendant already matched.
  found = found.filter((el) => !found.some((other) => other !== el && el.contains(other)));

  window.__polymuxLocatorMatches = found;
  return {
    count: found.length,
    describe: found.slice(0, 5).map((el) => {
      const id = el.id ? "#" + el.id : "";
      const name = accessibleName(el).slice(0, 40);
      return el.tagName.toLowerCase() + id + (name ? ' "' + name + '"' : "");
    }),
  };
}`;

/** Pull the locator out of a command, or null when it carries none. */
export function locatorOf(command) {
  for (const [field, kind] of LOCATOR_FIELDS) {
    const query = command[field];
    if (typeof query === "string" && query.length > 0)
      return {
        kind,
        query,
        name: typeof command.name === "string" ? command.name : null,
        exact: command.exact === true,
        index: typeof command.index === "number" ? command.index : null,
      };
  }
  return null;
}

export function describeLocator({ kind, query, name, index }) {
  const parts = [`${kind}=${JSON.stringify(query)}`];
  if (name) parts.push(`name=${JSON.stringify(name)}`);
  if (index !== null) parts.push(`index=${index}`);
  return parts.join(" ");
}

/**
 * Resolve a locator to a backend node id.
 *
 * A miss reports the locator and what was actually on the page, because a bare
 * "not found" leaves the agent to guess — and it usually guesses the same
 * locator again.
 */
export async function findByLocator(send, locator) {
  const search = await send("Runtime.callFunctionOn", {
    functionDeclaration: FIND_SOURCE,
    executionContextId: undefined,
    arguments: [
      { value: locator.kind },
      { value: locator.query },
      { value: locator.name },
      { value: locator.exact },
      { value: IMPLICIT_ROLES },
    ],
    returnByValue: true,
    objectId: await documentHandle(send),
  });
  if (search.exceptionDetails)
    throw new ControlError(
      search.exceptionDetails.exception?.description ?? "locator failed",
    );
  const outcome = search.result?.value ?? {};
  if (outcome.error) throw new TargetError(outcome.error);

  const described = describeLocator(locator);
  if (!outcome.count)
    throw new TargetError(`No element matches ${described}`);
  if (locator.index !== null && (locator.index < 0 || locator.index >= outcome.count))
    throw new TargetError(
      `${described} matched ${outcome.count} element(s), so index ${locator.index} is out of range. Matched: ${outcome.describe.join(", ")}`,
    );
  if (outcome.count > 1 && locator.index === null)
    throw new TargetError(
      `${described} matched ${outcome.count} elements; provide index to choose one. Matched: ${outcome.describe.join(", ")}`,
    );

  const selectedIndex = locator.index ?? 0;
  const handle = await send("Runtime.evaluate", {
    expression: `window.__polymuxLocatorMatches[${selectedIndex}]`,
  });
  const objectId = handle.result?.objectId;
  if (!objectId) throw new TargetError(`${described} resolved to no element`);
  const { node } = await send("DOM.describeNode", { objectId });
  return { backendNodeId: node.backendNodeId, ambiguous: outcome.count > 1, matches: outcome.describe };
}

async function documentHandle(send) {
  const response = await send("Runtime.evaluate", { expression: "document" });
  const objectId = response.result?.objectId;
  if (!objectId) throw new ControlError("Could not take a handle on the document");
  return objectId;
}
