import assert from "node:assert/strict";
import test from "node:test";
import { findByLocator, locatorOf } from "../src/locators.js";

function locator(index?: number) {
  return locatorOf({role: "button", name: "Save", ...(index === undefined ? {} : {index})})!;
}

test("an ambiguous locator requires an explicit index", async () => {
  const send = async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "Runtime.evaluate" && params.expression === "document")
      return {result: {objectId: "document"}};
    if (method === "Runtime.callFunctionOn")
      return {result: {value: {count: 2, describe: ['button "Save"', 'button "Save"']}}};
    throw new Error(`unexpected ${method}`);
  };
  await assert.rejects(() => findByLocator(send, locator()), /provide index/);
});

test("an explicit zero index selects the first match", async () => {
  const calls: string[] = [];
  const send = async (method: string, params: Record<string, unknown> = {}) => {
    calls.push(String(params.expression ?? method));
    if (method === "Runtime.evaluate" && params.expression === "document")
      return {result: {objectId: "document"}};
    if (method === "Runtime.callFunctionOn")
      return {result: {value: {count: 2, describe: ['button "Save"', 'button "Save"']}}};
    if (method === "Runtime.evaluate") return {result: {objectId: "selected"}};
    if (method === "DOM.describeNode") return {node: {backendNodeId: 42}};
    throw new Error(`unexpected ${method}`);
  };
  assert.equal((await findByLocator(send, locator(0))).backendNodeId, 42);
  assert.ok(calls.includes("window.__polymuxLocatorMatches[0]"));
});
