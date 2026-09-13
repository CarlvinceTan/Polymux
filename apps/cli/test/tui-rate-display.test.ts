import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RateDisplay } from "../src/tui/rate-display.js";
test("eases quickly upward and downward without overshoot", () => {
  const display = new RateDisplay();
  assert.equal(display.step(null), false);
  display.step(80);
  assert.equal(display.value, 1);
  display.step(80);
  assert.equal(display.value, 25);
  for (let n = 0; n < 14; n++) {
    const before: number = display.value!;
    display.step(80);
    assert.ok(display.value! >= before && display.value! <= 80);
  }
  assert.equal(display.value, 80);
  assert.equal(display.step(80), false);
  display.step(20);
  assert.equal(display.value, 62);
  for (let n = 0; n < 14; n++) display.step(20);
  assert.equal(display.value, 20);
  display.reset();
  display.step(120);
  assert.equal(display.value, 1);
});
test("tracks a revised target immediately instead of finishing an old ramp", () => {
  const display = new RateDisplay();
  display.step(200);
  display.step(200);
  const before: number = display.value!;
  display.step(30);
  assert.ok(display.value! < before && display.value! >= 30);
});
