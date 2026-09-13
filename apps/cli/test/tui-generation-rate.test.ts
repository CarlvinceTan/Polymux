import { strict as assert } from "node:assert";
import { test } from "node:test";
import { GenerationRate } from "../src/tui/generation-rate.js";
const chunk = "x".repeat(38);
function stream(rate: GenerationRate, start = 0, count = 51) {
  for (let i = 0; i < count; i++) rate.add(chunk, start + i * 100);
}
test("steady generation excludes initial wait and holds across long pauses", () => {
  const r = new GenerationRate();
  r.start("a/model");
  stream(r, 10000);
  assert.ok(Math.abs(r.rate! - 100) < 0.001);
  const before = r.rate;
  r.add(chunk, 60000);
  assert.equal(r.rate, before);
  stream(r, 60100);
  assert.ok(Math.abs(r.rate! - 100) < 0.001);
});
test("same-model tool turns retain rate; a different provider resets", () => {
  const r = new GenerationRate();
  r.start("a/model");
  stream(r);
  r.start("a/model");
  r.add(chunk, 50000);
  assert.equal(Math.round(r.rate!), 100);
  r.start("b/model");
  assert.equal(r.rate, null);
});
test("usage calibrates per model without treating final totals as a burst", () => {
  const r = new GenerationRate();
  r.start("a/model");
  stream(r);
  r.finish(1020, true);
  assert.ok(r.rate! > 100 && r.rate! < 200);
  r.start("b/model");
  stream(r);
  assert.equal(Math.round(r.rate!), 100);
});
test("hidden reasoning and missing usage do not inflate output speed", () => {
  const r = new GenerationRate();
  r.start("a/model");
  stream(r);
  const before = r.rate;
  r.finish(10000, false);
  assert.equal(r.rate, before);
  r.finish(undefined, true);
  assert.equal(r.rate, before);
});
test("real sustained slowdowns are reflected gradually", () => {
  const r = new GenerationRate();
  r.start("a/model");
  stream(r);
  for (let i = 1; i <= 100; i++) r.add("x".repeat(19), 5000 + i * 100);
  assert.ok(r.rate! > 50 && r.rate! < 60);
});
