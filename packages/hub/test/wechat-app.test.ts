import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureWeChatAppRunningHidden,
  primeWeChatAppHidden,
  weChatAppIsRunning,
} from "../src/wechat-app.js";

const appPath = "/Applications/WeChat.app";
const executable = `${appPath}/Contents/MacOS/WeChat`;

test("an existing WeChat instance is reused without hiding or relaunching it", async () => {
  const calls: Array<{file: string; args: string[]}> = [];
  const ready = await ensureWeChatAppRunningHidden({
    platform: "darwin",
    appPaths: [appPath],
    exists: async () => true,
    run: async (file, args) => {
      calls.push({file, args});
      return {stdout: `${executable}\n`, stderr: ""};
    },
  });
  assert.equal(ready, true);
  assert.deepEqual(calls, [{file: "/bin/ps", args: ["-axo", "command="]}]);
});

test("an absent WeChat instance is launched once, hidden and in the background", async () => {
  const calls: Array<{file: string; args: string[]}> = [];
  let running = false;
  const ready = await ensureWeChatAppRunningHidden({
    platform: "darwin",
    appPaths: [appPath],
    exists: async () => true,
    waitMs: 500,
    run: async (file, args) => {
      calls.push({file, args});
      if (file === "/usr/bin/open") running = true;
      return {stdout: running && file === "/bin/ps" ? `${executable}\n` : "", stderr: ""};
    },
  });
  assert.equal(ready, true);
  assert.deepEqual(calls[1], {
    file: "/usr/bin/open",
    args: ["-g", "-j", appPath],
  });
  assert.equal(calls.filter((call) => call.file === "/usr/bin/open").length, 1);
  assert.equal(calls[1]?.args.includes("-n"), false, "a second WeChat instance is never requested");
});

test("unsupported systems do not attempt a macOS app launch", async () => {
  let called = false;
  assert.equal(
    await ensureWeChatAppRunningHidden({
      platform: "linux",
      run: async () => {
        called = true;
        return {stdout: "", stderr: ""};
      },
    }),
    false,
  );
  assert.equal(called, false);
});

test("process matching ignores helpers and commands that only mention WeChat", () => {
  assert.equal(
    weChatAppIsRunning(
      `${executable}.helper\n/bin/zsh -c ${executable}\n`,
      executable,
    ),
    false,
  );
  assert.equal(weChatAppIsRunning(`${executable} --restored\n`, executable), true);
});

test("the native primer is bounded to macOS and accepts only a verified result", async () => {
  const calls: Array<{file: string; args: string[]}> = [];
  assert.equal(
    await primeWeChatAppHidden({
      platform: "darwin",
      helperPath: "/app/wechat-prime",
      run: async (file, args) => {
        calls.push({file, args});
        return {stdout: '{"ok":true,"primed":true}', stderr: ""};
      },
    }),
    true,
  );
  assert.deepEqual(calls, [{file: "/app/wechat-prime", args: []}]);
  assert.equal(
    await primeWeChatAppHidden({
      platform: "darwin",
      helperPath: "/app/wechat-prime",
      run: async () => ({
        stdout: '{"ok":false,"reason":"wechat_frontmost"}',
        stderr: "",
      }),
    }),
    false,
  );
  assert.equal(
    await primeWeChatAppHidden({
      platform: "linux",
      helperPath: "/app/wechat-prime",
      run: async () => {
        throw new Error("must not run");
      },
    }),
    false,
  );
});
