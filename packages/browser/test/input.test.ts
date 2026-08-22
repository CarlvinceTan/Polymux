import assert from "node:assert/strict";
import test from "node:test";

import { humanPoint, pacer, parseKey } from "../src/input.js";

test("a bare character types itself", () => {
  const key = parseKey("a");
  assert.equal(key.key, "a");
  assert.equal(key.code, "KeyA");
  assert.equal(key.text, "a");
  assert.equal(key.modifiers, 0);
});

test("a capital carries the shift modifier", () => {
  const key = parseKey("A");
  assert.equal(key.text, "A");
  assert.equal(key.modifiers, 4);
});

test("named keys resolve to their virtual key code", () => {
  assert.equal(parseKey("Enter").windowsVirtualKeyCode, 13);
  assert.equal(parseKey("Enter").text, "\r");
  assert.equal(parseKey("Escape").windowsVirtualKeyCode, 27);
  // Escape has no text: sending one would insert a character as well as
  // dismissing whatever is open.
  assert.equal(parseKey("Escape").text, undefined);
  assert.equal(parseKey("ArrowDown").code, "ArrowDown");
});

test("a modified key is a shortcut, so it carries no text", () => {
  const key = parseKey("Control+a");
  assert.equal(key.modifiers, 2);
  assert.equal(key.text, undefined, "Control+a must not also insert 'a'");
  assert.equal(key.windowsVirtualKeyCode, 65);
});

test("modifiers combine", () => {
  assert.equal(parseKey("Control+Shift+a").modifiers, 2 | 4);
  assert.equal(parseKey("Meta+Shift+z").modifiers, 8 | 4);
});

test("Control+Enter keeps the key code and drops the text", () => {
  const key = parseKey("Control+Enter");
  assert.equal(key.windowsVirtualKeyCode, 13);
  assert.equal(key.text, undefined);
});

test("click points land inside the box, and toward the text in a field", () => {
  const box = { x: 100, y: 200, width: 300, height: 40 };
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const button = humanPoint(box, false);
    assert.ok(button.x >= 100 && button.x <= 400, `x ${button.x}`);
    assert.ok(button.y >= 200 && button.y <= 240, `y ${button.y}`);

    const field = humanPoint(box, true);
    // Inputs are aimed at the left of the box — clicking the right half of a
    // long field puts the caret after the text, not in it.
    assert.ok(field.x <= 100 + 300 * 0.45, `field x ${field.x}`);
  }
});

test("click points vary rather than repeating one centre", () => {
  const box = { x: 0, y: 0, width: 200, height: 50 };
  const seen = new Set<string>();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const point = humanPoint(box, false);
    seen.add(`${point.x},${point.y}`);
  }
  assert.ok(seen.size > 10, `only ${seen.size} distinct points`);
});

test("calm pacing is slower than fast, and both stay in their band", () => {
  const calm = pacer("calm");
  const fast = pacer("fast");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    assert.ok(fast(10, 20) >= 10 && fast(10, 20) <= 20);
    const value = calm(10, 20);
    assert.ok(value >= 16.5 && value <= 33, `calm ${value}`);
  }
});

test("an unknown pace falls back to calm rather than to no delay", () => {
  const value = pacer(undefined)(10, 10);
  assert.equal(Math.round(value), 17);
});
