import assert from "node:assert/strict";
import {execFile, spawn} from "node:child_process";
import {once} from "node:events";
import {promisify} from "node:util";
import test from "node:test";
import {wechatPid} from "./wechat-wire.mjs";

const run = promisify(execFile);

test("native target pins never rediscover another process", {skip: process.platform === "win32"}, async () => {
  const target = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  const oldPid = process.env.POLYMUX_WECHAT_TARGET_PID;
  const oldIdentity = process.env.POLYMUX_WECHAT_TARGET_IDENTITY;
  try {
    await once(target, "spawn");
    const {stdout} = await run("/bin/ps", ["-p", String(target.pid), "-o", "lstart=,comm="]);
    process.env.POLYMUX_WECHAT_TARGET_PID = String(target.pid);
    process.env.POLYMUX_WECHAT_TARGET_IDENTITY = stdout.trim();
    assert.equal(await wechatPid(), target.pid);

    process.env.POLYMUX_WECHAT_TARGET_IDENTITY = "different process birth";
    await assert.rejects(wechatPid(), /changed or exited/);
    delete process.env.POLYMUX_WECHAT_TARGET_IDENTITY;
    await assert.rejects(wechatPid(), /pin is invalid/);

    process.env.POLYMUX_WECHAT_TARGET_IDENTITY = stdout.trim();
    const closed = once(target, "close");
    target.kill("SIGTERM");
    await closed;
    await assert.rejects(wechatPid(), /no replacement was selected/);
  } finally {
    if (target.exitCode === null && target.signalCode === null) target.kill("SIGKILL");
    if (oldPid === undefined) delete process.env.POLYMUX_WECHAT_TARGET_PID;
    else process.env.POLYMUX_WECHAT_TARGET_PID = oldPid;
    if (oldIdentity === undefined) delete process.env.POLYMUX_WECHAT_TARGET_IDENTITY;
    else process.env.POLYMUX_WECHAT_TARGET_IDENTITY = oldIdentity;
  }
});
