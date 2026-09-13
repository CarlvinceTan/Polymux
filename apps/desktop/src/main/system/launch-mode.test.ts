import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {configuredRemoteDebuggingPort, requestsBackgroundLaunch} from "./launch-mode.js";

test("background launch can be requested by switch, argument, or packaged environment", () => {
  const base = {platform: "darwin" as const, argv: [] as string[], hasSwitch: () => false};
  assert.equal(requestsBackgroundLaunch({...base, hasSwitch: (name) => name === "polymux-background"}), true);
  assert.equal(requestsBackgroundLaunch({...base, argv: ["--polymux-background"]}), true);
  assert.equal(requestsBackgroundLaunch({...base, environment: {POLYMUX_BACKGROUND_LAUNCH: "1"}}), true);
  assert.equal(requestsBackgroundLaunch(base), false);
  assert.equal(requestsBackgroundLaunch({...base, platform: "linux"}), false);
});

test("environment-provided debugging ports are strictly bounded", () => {
  assert.equal(configuredRemoteDebuggingPort("9341"), 9341);
  for (const value of [undefined, "", "9341x", "0", "1023", "65536", "-1"])
    assert.equal(configuredRemoteDebuggingPort(value), null);
});

test("the hidden startup shell keeps animating until its handoff", async () => {
  const source = await readFile(new URL("../main.ts", import.meta.url), "utf8");
  const start = source.indexOf("function createStartupShellWindow");
  const end = source.indexOf("function loadStartupShell", start);
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(start, end), /backgroundThrottling:\s*false/);
});
