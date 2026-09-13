import assert from "node:assert/strict";
import test from "node:test";
import {recoverWeChatSession} from "../src/wechat-session-recovery.js";

const target = {pid: 42, identity: "exact WeChat birth and executable"};
function fixture(options: {state?: string; identity?: string; error?: Error} = {}) {
  const calls: string[][] = [];
  return {calls, run: async (file: string, args: string[]) => {
    calls.push([file, ...args]);
    if (file === "cli") {
      if (options.error) throw options.error;
      return {stdout: "done", stderr: ""};
    }
    if (args.at(-1) === "pid=,ppid=,command=") return {stdout: "", stderr: ""};
    return {stdout: args.at(-1) === "stat=" ? options.state ?? "S" : options.identity ?? target.identity, stderr: ""};
  }};
}

test("existing WeChat is cleanly unfrozen before readiness, not merely daemon-stopped", async () => {
  const f = fixture();
  await recoverWeChatSession("cli", {target, run: f.run, quietMs: 0});
  assert.deepEqual(f.calls.filter(c => c[0] === "cli"), [["cli", "unfreeze", "--pid", "42"]]);
  assert.equal(f.calls[0]?.at(-1), "lstart=,comm=");
  assert.equal(f.calls.at(-1)?.at(-1), "lstart=,comm=");
});

test("a cold launch without a target only disarms the old daemon", async () => {
  const f = fixture();
  await recoverWeChatSession("cli", {run: f.run});
  assert.deepEqual(f.calls, [["cli", "daemon", "stop"]]);
});

for (const state of ["T", "SX", "Z", ""]) {
  test(`cleanup does not claim readiness while native state is ${JSON.stringify(state)}`, async () => {
    const f = fixture({state});
    await assert.rejects(recoverWeChatSession("cli", {target, run: f.run, waitMs: 0}),
      (error: unknown) => (error as {nativeDetachUnconfirmed?: boolean}).nativeDetachUnconfirmed === true);
  });
}

test("a replaced target is never resumed", async () => {
  const f = fixture({identity: "different process"});
  await assert.rejects(recoverWeChatSession("cli", {target, run: f.run}), /changed before/);
  assert.equal(f.calls.some(c => c[0] === "cli"), false);
});

test("an executed recovery failure retains the relay safety hold", async () => {
  const f = fixture({error: Object.assign(new Error("cleanup failed"), {code: 1})});
  await assert.rejects(recoverWeChatSession("cli", {target, run: f.run}),
    (error: unknown) => {
      const failure = error as {nativeDetachUnconfirmed?: boolean; relayRecoverySafe?: boolean};
      return failure.nativeDetachUnconfirmed === true && failure.relayRecoverySafe === false;
    });
  assert.equal(f.calls.filter(c => c[0] === "cli").length, 1);
});

test("a missing executable preserves the pre-launch fallback signal", async () => {
  const missing = Object.assign(new Error("not installed"), {code: "ENOENT", path: "cli"});
  const f = fixture({error: missing});
  await assert.rejects(recoverWeChatSession("cli", {target, run: f.run}), error => error === missing);
});

test("a running target is not enough while the old capture debugger still exists", async () => {
  const f = fixture();
  const run = async (file: string, args: string[]) => args.at(-1) === "pid=,ppid=,command="
    ? {stdout: "123 1 /usr/bin/lldb -s /tmp/wx-cdn-capture-daemon-test/cmd.lldb\n124 123 /usr/bin/debugserver", stderr: ""}
    : f.run(file, args);
  await assert.rejects(recoverWeChatSession("cli", {target, run, waitMs: 0, quietMs: 0}),
    error => (error as {relayRecoverySafe?: boolean}).relayRecoverySafe === false);
});

test("a late stopped state resets the continuous recovery interval", async () => {
  const f = fixture();
  let probes = 0;
  const run = async (file: string, args: string[]) => args.at(-1) === "stat="
    ? {stdout: ++probes === 2 ? "T" : "S", stderr: ""}
    : f.run(file, args);
  await recoverWeChatSession("cli", {target, run, waitMs: 1_000, quietMs: 50});
  assert.ok(probes >= 4, "must observe a fresh quiet interval after the late stop");
});
