import assert from "node:assert/strict";
import test from "node:test";
import { renderAxTree } from "../src/snapshot.js";

/**
 * AX nodes as CDP returns them. `ignored` wrappers are included on purpose:
 * Chrome marks most layout scaffolding ignored, and dropping their children
 * would lose the page.
 */
const NODES = [
  { nodeId: "1", ignored: false, role: v("RootWebArea"), name: v("Shop"), childIds: ["2"] },
  { nodeId: "2", parentId: "1", ignored: true, role: v("generic"), childIds: ["3", "4", "5"] },
  {
    nodeId: "3",
    parentId: "2",
    ignored: false,
    role: v("heading"),
    name: v("Basket"),
    properties: [{ name: "level", value: v(1) }],
  },
  {
    nodeId: "4",
    parentId: "2",
    ignored: false,
    role: v("link"),
    name: v("Checkout"),
    backendDOMNodeId: 41,
    properties: [{ name: "url", value: v("https://shop.example/checkout") }],
  },
  {
    nodeId: "5",
    parentId: "2",
    ignored: false,
    role: v("textbox"),
    name: v("Promo code"),
    backendDOMNodeId: 52,
    properties: [{ name: "placeholder", value: v("SAVE10") }],
  },
];

function v(value: unknown): { value: unknown } {
  return { value };
}

test("actionable nodes get refs and non-actionable ones do not", () => {
  const { text, refs } = renderAxTree(NODES);
  assert.match(text, /- link "Checkout" .*\[ref=e1\]/);
  assert.match(text, /- textbox "Promo code" .*\[ref=e2\]/);
  // A heading is context, not a target — giving it a ref invites a click that
  // does nothing.
  assert.match(text, /- heading "Basket" level=1$/m);
  assert.equal(refs.get("e1"), 41);
  assert.equal(refs.get("e2"), 52);
  assert.equal(refs.size, 2);
});

test("children survive an omitted root and an ignored wrapper, un-indented", () => {
  const { text } = renderAxTree(NODES);
  const heading = text.split("\n").find((line: string) => line.includes("heading"));
  // Neither the omitted RootWebArea nor the ignored generic is emitted, so
  // neither costs the real content a level of indent.
  assert.equal(heading, '- heading "Basket" level=1');
  assert.equal(text.includes("RootWebArea"), false);
});

test("refs restart at e1 every snapshot", () => {
  const first = renderAxTree(NODES);
  const second = renderAxTree(NODES);
  assert.deepEqual([...first.refs.keys()], [...second.refs.keys()]);
  assert.equal(second.refs.get("e1"), 41);
});

test("a session can offset refs so stale snapshots cannot target new nodes", () => {
  const first = renderAxTree(NODES);
  const second = renderAxTree(NODES, { refOffset: first.refs.size });
  assert.deepEqual([...first.refs.keys()], ["e1", "e2"]);
  assert.deepEqual([...second.refs.keys()], ["e3", "e4"]);
});

test("interactive drops everything without a ref", () => {
  const { text, refs } = renderAxTree(NODES, { interactive: true });
  assert.equal(text.includes("heading"), false);
  assert.equal(refs.size, 2);
  assert.equal(text.split("\n").length, 2);
});

test("compact drops unnamed structural nodes but keeps named ones", () => {
  const nodes = [
    { nodeId: "1", ignored: false, role: v("generic"), childIds: ["2"] },
    { nodeId: "2", parentId: "1", ignored: false, role: v("group"), name: v("Filters") },
  ];
  const { text } = renderAxTree(nodes, { compact: true });
  assert.equal(text.includes("- generic"), false);
  assert.match(text, /- group "Filters"/);
});

test("urls: false omits hrefs", () => {
  assert.equal(renderAxTree(NODES, { urls: false }).text.includes("href="), false);
  assert.equal(renderAxTree(NODES).text.includes("href="), true);
});

test("names are truncated so one node cannot eat the snapshot", () => {
  const nodes = [
    { nodeId: "1", ignored: false, role: v("button"), name: v("x".repeat(500)), backendDOMNodeId: 9 },
  ];
  const { text } = renderAxTree(nodes);
  assert.equal(text.includes("x".repeat(500)), false);
  assert.match(text, /\.\.\."/);
});
