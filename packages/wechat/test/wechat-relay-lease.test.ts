import assert from "node:assert/strict";
import {execFile, spawn, type ChildProcess} from "node:child_process";
import {createRequire, syncBuiltinESMExports} from "node:module";
import {promisify} from "node:util";
import test from "node:test";
import {pauseWeChatRelay, type WeChatRelayRelease} from "../src/wechat-relay-lease.js";

const run = promisify(execFile);
async function state(pid: number): Promise<string> {
  return (await run("/bin/ps", ["-p", String(pid), "-o", "stat="])).stdout.trim();
}
async function resumed(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!/[Tt]/.test(await state(pid))) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail("fixture relay did not resume");
}
test("a paused supervised relay resumes without changing its PID", {skip: process.platform === "win32"}, async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  const pid = child.pid!;
  let release: (() => Promise<void>) | undefined;
  try {
    release = await pauseWeChatRelay(pid);
    const paused = await run("/bin/ps", ["-p", String(pid), "-o", "stat="]);
    assert.match(paused.stdout, /T/);
    await release(); release = undefined;
    const resumed = await run("/bin/ps", ["-p", String(pid), "-o", "stat="]);
    assert.doesNotMatch(resumed.stdout, /T/);
    assert.equal(child.exitCode, null);
  } finally {await release?.(); child.kill("SIGTERM");}
});

test("a relay resumes when its owning application crashes", {skip: process.platform === "win32"}, async () => {
  const relay = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  const source = new URL("../src/wechat-relay-lease.ts", import.meta.url).href;
  const parent = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `const {pauseWeChatRelay}=await import(${JSON.stringify(source)});
     await pauseWeChatRelay(${relay.pid});
     process.stdout.write('paused\\n'); setInterval(()=>{},1000);`,
  ], {stdio: ["ignore", "pipe", "pipe"]});
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("test owner did not pause its relay")), 5_000);
      parent.stdout.once("data", () => {clearTimeout(timeout); resolve();});
      parent.once("error", (error) => {clearTimeout(timeout); reject(error);});
      parent.once("exit", () => {clearTimeout(timeout); reject(new Error("test owner exited before pausing"));});
    });
    assert.match((await run("/bin/ps", ["-p", String(relay.pid), "-o", "stat="])).stdout, /T/);
    parent.kill("SIGKILL");
    const deadline = Date.now() + 3_000;
    let state = "T";
    while (/T/.test(state) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      state = (await run("/bin/ps", ["-p", String(relay.pid), "-o", "stat="])).stdout;
    }
    assert.doesNotMatch(state, /T/, "the watchdog resumes the same relay after its parent dies");
    assert.equal(relay.exitCode, null);
  } finally {parent.kill("SIGTERM"); relay.kill("SIGTERM");}
});

test("native lease expiry retains ownership until explicit completion", {skip: process.platform === "win32"}, async () => {
  const relay = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  const target = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  let release: WeChatRelayRelease | undefined;
  try {
    release = await pauseWeChatRelay(relay.pid!, {nativeTargetPid: target.pid!, deadlineMs: 30});
    assert.equal(release.nativeTarget?.pid, target.pid);
    assert.ok(release.nativeTarget?.identity.includes("node"));
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.match(await state(relay.pid!), /T/);
    assert.doesNotMatch(await state(target.pid!), /T/);
    await release();
    release = undefined;
    await resumed(relay.pid!);
  } finally {
    target.kill("SIGKILL");
    await release?.();
    relay.kill("SIGCONT");
    relay.kill("SIGTERM");
  }
});

test("native release refuses a stopped target and can retry after detach", {skip: process.platform === "win32"}, async () => {
  const relay = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  const target = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  let release: WeChatRelayRelease | undefined;
  try {
    release = await pauseWeChatRelay(relay.pid!, {nativeTargetPid: target.pid!});
    target.kill("SIGSTOP");
    await assert.rejects(release(), /cleanup is unconfirmed/);
    assert.match(await state(relay.pid!), /T/);
    target.kill("SIGCONT");
    await release();
    release = undefined;
    await resumed(relay.pid!);
  } finally {
    target.kill("SIGKILL");
    await release?.();
    relay.kill("SIGCONT");
    relay.kill("SIGTERM");
  }
});

test("native lease survives parent death before an orphan writer attaches", {skip: process.platform === "win32"}, async () => {
  const relay = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  const target = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  const source = new URL("../src/wechat-relay-lease.ts", import.meta.url).href;
  const parent = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `const {pauseWeChatRelay}=await import(${JSON.stringify(source)});
     await pauseWeChatRelay(${relay.pid}, {nativeTargetPid:${target.pid},deadlineMs:30});
     process.stdout.write('paused\\n'); setInterval(()=>{},1000);`,
  ], {stdio: ["ignore", "pipe", "pipe"]});
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("fixture parent did not pause relay")), 5_000);
      parent.stdout.once("data", () => {clearTimeout(timer); resolve();});
      parent.once("error", reject);
    });
    parent.kill("SIGKILL");
    // The orphan writer has not attached yet: the target is still runnable,
    // but EOF/deadline must not release the reservation in this gap.
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.doesNotMatch(await state(target.pid!), /T/);
    assert.match(await state(relay.pid!), /T/);
    target.kill("SIGSTOP");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.match(await state(relay.pid!), /T/);
    // Only this exact fixture target is killed; no WeChat/debugger is used.
    target.kill("SIGKILL");
    await resumed(relay.pid!);
  } finally {
    parent.kill("SIGKILL");
    target.kill("SIGKILL");
    relay.kill("SIGCONT");
    relay.kill("SIGTERM");
  }
});

test("a guarded relay resumes after its exact native target exits", {skip: process.platform === "win32"}, async () => {
  const relay = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  const target = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  try {
    await pauseWeChatRelay(relay.pid!, {nativeTargetPid: target.pid!});
    target.kill("SIGKILL");
    await resumed(relay.pid!);
  } finally {
    target.kill("SIGKILL");
    relay.kill("SIGCONT");
    relay.kill("SIGTERM");
  }
});

test("a guard process crash cannot acknowledge relay release", {skip: process.platform === "win32"}, async t => {
  const relay = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  const target = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  const childProcess = createRequire(import.meta.url)("node:child_process") as typeof import("node:child_process");
  const originalSpawn = childProcess.spawn;
  let guard: ChildProcess | undefined;
  const intercepted = t.mock.method(childProcess, "spawn", (...args: Parameters<typeof spawn>) => {
    const child = originalSpawn(...args);
    guard = child;
    return child;
  });
  syncBuiltinESMExports();
  try {
    const release = await pauseWeChatRelay(relay.pid!, {nativeTargetPid: target.pid!});
    assert.ok(guard, "the intercepted child is the exact fixture guard");
    const closed = new Promise<void>(resolve => guard!.once("close", () => resolve()));
    guard.kill("SIGKILL");
    await closed;
    await assert.rejects(release(), /without confirming a safe release/);
    assert.match(await state(relay.pid!), /T/);
  } finally {
    intercepted.mock.restore();
    syncBuiltinESMExports();
    guard?.kill("SIGKILL");
    target.kill("SIGKILL");
    relay.kill("SIGCONT");
    relay.kill("SIGTERM");
  }
});
