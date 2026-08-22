import assert from "node:assert/strict";
import test from "node:test";
import {fillValueRetained, handlers} from "../src/handlers.js";

test("fill verification fails closed when a value-bearing field rejects the edit", () => {
  assert.equal(fillValueRetained({supported: true, matches: true}), true);
  assert.equal(fillValueRetained({supported: true, matches: false}), false);
  assert.equal(fillValueRetained({supported: false, matches: true}), true);
});

test("a failed drag releases the pressed mouse button", async () => {
  const events: Array<Record<string, unknown>> = [];
  let moves = 0;
  const session = {
    refs: new Map(),
    paced: () => 0,
    observed: () => false,
    moveCursor: async () => {},
    send: async (method: string, params: Record<string, unknown>) => {
      if (method === "Input.dispatchMouseEvent") {
        events.push(params);
        if (params.type === "mouseMoved" && ++moves === 1) throw new Error("move failed");
      }
      return {};
    },
  };

  await assert.rejects(
    () => handlers.drag(session, {x: 10, y: 10, toX: 100, toY: 100}),
    /move failed/,
  );
  assert.equal(events[0]?.type, "mousePressed");
  assert.equal(events.at(-1)?.type, "mouseReleased");
});
