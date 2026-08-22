import assert from "node:assert/strict";
import test from "node:test";
import {configuredRemoteDebuggingPort, requestsBackgroundLaunch} from "./launch-mode.js";

test("background launch can be requested by switch, argument, or packaged environment", () => {
  const base = {platform: "darwin" as const, argv: [] as string[], hasSwitch: () => false};
  assert.equal(requestsBackgroundLaunch({...base, hasSwitch: (name) => name === "flareai-background"}), true);
  assert.equal(requestsBackgroundLaunch({...base, argv: ["--flareai-background"]}), true);
  assert.equal(requestsBackgroundLaunch({...base, environment: {FLAREAI_BACKGROUND_LAUNCH: "1"}}), true);
  assert.equal(requestsBackgroundLaunch(base), false);
  assert.equal(requestsBackgroundLaunch({...base, platform: "linux"}), false);
});

test("environment-provided debugging ports are strictly bounded", () => {
  assert.equal(configuredRemoteDebuggingPort("9341"), 9341);
  for (const value of [undefined, "", "9341x", "0", "1023", "65536", "-1"])
    assert.equal(configuredRemoteDebuggingPort(value), null);
});
