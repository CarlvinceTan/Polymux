// Accessibility-tree page snapshot with actionable refs.
//
// This is the agent's primary way of seeing a page: `Accessibility.getFullAXTree`
// rendered as indented text, with every actionable node tagged `[ref=eN]`. It
// is what makes the rest of the command set addressable — click, fill, select,
// hover and upload all take a ref rather than a CSS selector, so the agent
// never has to guess at markup.
//
// Ported from the Polymux extension's snapshot handler, with the filtering
// options agent-browser added on top (interactive-only, compact, depth,
// scoped) — those exist because an untrimmed tree on a real page is mostly
// wrapper noise, and the noise is what the model pays for.

const ACTIONABLE_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "switch",
  "slider",
  "spinbutton",
]);

const OMIT_ROLES = new Set(["none", "presentation", "RootWebArea"]);

// Roles that carry no information once their name is empty — the wrapper
// noise `compact` exists to drop.
const STRUCTURAL_ROLES = new Set([
  "generic",
  "group",
  "section",
  "paragraph",
  "LineBreak",
  "StaticText",
  "InlineTextBox",
]);

function strValue(value) {
  if (!value) return "";
  if (typeof value.value === "string") return value.value;
  if (value.value === undefined || value.value === null) return "";
  return String(value.value);
}

function quote(text) {
  const trimmed = text.length > 200 ? `${text.slice(0, 197)}...` : text;
  return JSON.stringify(trimmed);
}

function extractProperties(node, includeUrls) {
  const out = [];
  for (const property of node.properties ?? []) {
    const value = property.value?.value;
    switch (property.name) {
      case "level":
      case "valuenow":
      case "valuemin":
      case "valuemax":
      case "setsize":
      case "posinset":
        if (value !== undefined) out.push(`${property.name}=${String(value)}`);
        break;
      case "checked":
      case "selected":
      case "expanded":
      case "pressed":
      case "disabled":
      case "required":
      case "readonly":
        if (value === true || value === "true") out.push(property.name);
        break;
      case "placeholder":
        if (typeof value === "string" && value)
          out.push(`placeholder=${quote(value)}`);
        break;
      case "url":
        if (includeUrls && typeof value === "string" && value)
          out.push(`href=${quote(value)}`);
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Build the snapshot text and a fresh ref -> backendNodeId map.
 *
 * `refOffset` lets a session keep refs monotonic across snapshots, so a stale
 * ref is absent rather than silently resolving to a different node. The pure
 * renderer defaults to zero for callers that render one standalone tree.
 */
export function renderAxTree(nodes, options = {}) {
  const {
    interactive = false,
    compact = false,
    urls = true,
    depth: maxDepth = null,
    refOffset = 0,
  } = options;

  const byId = new Map();
  for (const node of nodes) byId.set(node.nodeId, node);

  const roots = nodes.filter((node) => !node.parentId);
  if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0]);

  const refs = new Map();
  const lines = [];
  let refCounter = 0;

  const format = (node, role, depth) => {
    const name = strValue(node.name);
    const value = strValue(node.value);
    const actionable =
      ACTIONABLE_ROLES.has(role) && node.backendDOMNodeId !== undefined;

    if (interactive && !actionable) return null;
    if (compact && !actionable && !name && STRUCTURAL_ROLES.has(role))
      return null;

    const parts = [`${"  ".repeat(Math.max(0, depth))}- ${role}`];
    if (name) parts.push(quote(name));
    if (value && value !== name) parts.push(`value=${quote(value)}`);
    for (const property of extractProperties(node, urls)) parts.push(property);
    if (actionable) {
      refCounter += 1;
      const ref = `e${refOffset + refCounter}`;
      refs.set(ref, node.backendDOMNodeId);
      parts.push(`[ref=${ref}]`);
    }
    return parts.join(" ");
  };

  const walk = (node, depth) => {
    let emitted = false;
    if (!node.ignored) {
      const role = strValue(node.role);
      if (role && !OMIT_ROLES.has(role)) {
        if (maxDepth === null || depth <= maxDepth) {
          const line = format(node, role, depth);
          if (line !== null) {
            lines.push(line);
            emitted = true;
          }
        }
      }
    }
    // Descend even through ignored and dropped nodes — Chrome routinely marks
    // meaningful content's wrappers as ignored, so skipping their children
    // would lose the page. Only emitted nodes advance the indent.
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child) walk(child, emitted ? depth + 1 : depth);
    }
  };

  for (const root of roots) walk(root, 0);
  return { text: lines.join("\n"), refs };
}
