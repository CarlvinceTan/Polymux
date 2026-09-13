import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {weChatRuntimeFile, weChatNativeInboundEnabled, weChatExternalAccessEnabled} from "./wechat-runtime.js";

test("development uses current WeChat source despite stale packaging output", async context => {
  const directory = await mkdtemp(path.join(tmpdir(), "wechat-runtime-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const sourceDirectory = path.join(directory, "source");
  const bundledDirectory = path.join(directory, "bundled");
  await Promise.all([mkdir(sourceDirectory), mkdir(bundledDirectory)]);
  for (const name of ["polymux-wechat-driver.mjs", "wechat_native_task_lldb.py", "wechat-snapshot-worker.mjs"]) {
    await writeFile(path.join(sourceDirectory, name), "current safeguards");
    await writeFile(path.join(bundledDirectory, name), "old build");
    const options = {sourceDirectory, bundledDirectory};
    assert.equal(await readFile(weChatRuntimeFile(name, {...options, development: true})!, "utf8"), "current safeguards");
    assert.equal(await readFile(weChatRuntimeFile(name, {...options, development: false})!, "utf8"), "old build");
    await rm(path.join(sourceDirectory, name));
    assert.equal(weChatRuntimeFile(name, {...options, development: true}), undefined,
      "missing development source must not silently execute a stale bundle");
    await writeFile(path.join(sourceDirectory, name), "current safeguards");
    await rm(path.join(bundledDirectory, name));
    assert.equal(weChatRuntimeFile(name, {...options, development: false}), undefined,
      "a package must not depend on a source checkout");
  }
});

test("ordinary startup enables keyed imports without the live-test environment", () => {
  assert.equal(weChatNativeInboundEnabled({}), true);
  assert.equal(weChatNativeInboundEnabled({POLYMUX_WECHAT_NATIVE_INBOUND: "1"}), true);
  assert.equal(weChatNativeInboundEnabled({POLYMUX_WECHAT_NATIVE_INBOUND: "0"}), false);
});

test("named isolates require explicit live WeChat access regardless of transport or registry", () => {
  const isolate = {POLYMUX_DEV_INSTANCE: "release-review"};
  assert.equal(weChatExternalAccessEnabled(isolate), false);
  assert.equal(weChatExternalAccessEnabled({...isolate, POLYMUX_WECHAT_NATIVE_INBOUND: "0"}), false);
  assert.equal(weChatExternalAccessEnabled({...isolate, POLYMUX_WECHAT_STORE_REGISTRY: "/synthetic/store.json"}), false);
  for (const value of ["", "0", "true", " 1 "]) {
    assert.equal(weChatExternalAccessEnabled({...isolate, POLYMUX_WECHAT_ISOLATE_LIVE: value}), false);
  }
  assert.equal(weChatExternalAccessEnabled({...isolate, POLYMUX_WECHAT_ISOLATE_LIVE: "1"}), true);
  assert.equal(weChatExternalAccessEnabled({}), true);
  assert.equal(weChatExternalAccessEnabled({POLYMUX_DEV_INSTANCE: "  "}), true);
  assert.equal(weChatExternalAccessEnabled({POLYMUX_WECHAT_ISOLATE_LIVE: "0"}), true,
    "the isolate flag must not change ordinary app startup");
});
