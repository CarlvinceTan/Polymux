import assert from "node:assert/strict";
import test from "node:test";
import {homeserverPortFor} from "./instance-port.js";

test("ordinary, named, and hidden benchmark launches never share a homeserver port", () => {
  const ordinary = homeserverPortFor(undefined);
  const named = homeserverPortFor("review");
  const background = homeserverPortFor(undefined, true);
  assert.equal(ordinary, 47_664);
  assert.equal(background, 47_865);
  assert.notEqual(named, ordinary);
  assert.notEqual(background, ordinary);
  assert.notEqual(background, named);
});

test("named hidden benchmarks keep distinct homeserver ownership", () => {
  const baseline = homeserverPortFor("eval-baseline", true);
  const candidate = homeserverPortFor("eval-candidate", true);
  assert.notEqual(baseline, candidate);
  assert.notEqual(baseline, homeserverPortFor(undefined, true));
  assert.notEqual(candidate, homeserverPortFor(undefined, true));
});
