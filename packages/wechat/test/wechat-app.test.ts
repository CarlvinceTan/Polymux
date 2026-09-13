import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {
  ensureWeChatAppRunningHidden,
  primeWeChatAppHidden,
  weChatAppIsRunning,
  weChatAppProcessId,
  weChatSessionReadyHidden,
  weChatSessionStateHidden,
} from "../src/wechat-app.js";

const appPath = "/Applications/WeChat.app";
const executable = `${appPath}/Contents/MacOS/WeChat`;

test("hidden-window session fallback requires the selected account and cannot override login or lock states", async () => {
  const accountId = "wxid_selected";
  const fingerprint = createHash("sha256").update(accountId).digest("hex");
  let axState = "unavailable", native = {ok:true,state:"signed_in",pid:1234,accountFingerprint:fingerprint};
  let calls = 0;
  const options = {platform:"darwin" as const, helperPath:"/app/prime",
    nativeSessionHelperPath:"/app/session",accountId,
    run:async (file: string, args: string[]) => {
      if (file === "/app/prime") return {stdout:JSON.stringify({ok:true,state:axState,pid:1234}),stderr:""};
      calls++;
      assert.deepEqual(args,["--pid","1234"]);
      return {stdout:JSON.stringify(native),stderr:""};
    }};
  assert.equal(await weChatSessionStateHidden(options),"signed_in");
  assert.equal(calls,1);
  for (const state of ["signed_out","remembered_login","interactive_login","locked","launching"]) {
    axState=state;
    assert.equal(await weChatSessionStateHidden(options),state);
    assert.equal(calls,1);
  }
  axState="unavailable";
  for (const invalid of [{accountFingerprint:"foreign"},{pid:5678},{ok:false},{state:"unavailable"}]) {
    native={ok:true,state:"signed_in",pid:1234,accountFingerprint:fingerprint,...invalid};
    assert.equal(await weChatSessionStateHidden(options),"unavailable");
  }
  native={ok:true,state:"locked",pid:1234,accountFingerprint:fingerprint};
  assert.equal(await weChatSessionStateHidden(options),"locked");
  const before=calls;
  assert.equal(await weChatSessionStateHidden({...options,accountId:undefined}),"unavailable");
  assert.equal(calls,before);
});

test("native target discovery rejects helpers, ambiguous applications and unreadable processes", async () => {
  let stdout = `  42 ${executable}\n 43 ${executable} Helper\n 44 /tmp/WeChat\n`;
  const options = {platform: "darwin" as const, appPaths: [appPath],
    run: async (file: string, args: string[]) => {
      assert.equal(file, "/bin/ps");
      assert.deepEqual(args, ["-axo", "pid=,comm="]);
      return {stdout, stderr: ""};
    }};
  assert.equal(await weChatAppProcessId(options), 42);
  stdout += ` 45 ${executable}\n`;
  assert.equal(await weChatAppProcessId(options), null);
  stdout = `46 ${executable} Helper\n`;
  assert.equal(await weChatAppProcessId(options), null);
  assert.equal(await weChatAppProcessId({...options, run: async () => {throw new Error("unreadable");}}), null);
  assert.equal(await weChatAppProcessId({...options, platform: "linux",
    run: async () => {throw new Error("must not inspect this platform");}}), null);
});

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

test("missing guarded-launch resources never invoke open or start WeChat", async () => {
  for (const extra of [{}, {primeLibraryPath: "/app/primer.dylib"},
    {primeLibraryPath: "/app/primer.dylib", launchHelperPath: "/app/launcher"}]) {
    const calls: string[] = [];
    assert.equal(await ensureWeChatAppRunningHidden({platform: "darwin", appPaths: [appPath],
      ...extra, exists: async () => true, run: async (file) => {
        calls.push(file); return {stdout: "", stderr: ""};
      }}), false);
    assert.deepEqual(calls, ["/bin/ps"]);
  }
});

test("a cold launch uses the guarded helper and never falls back to open", async () => {
  const calls: Array<{file: string; args: string[]}> = [];
  let running = false;
  const ready = await ensureWeChatAppRunningHidden({
    platform: "darwin",
    appPaths: [appPath],
    launchHelperPath: "/app/wechat-launch-hidden",
    nativeTaskScriptPath: "/app/wechat_native_task_lldb.py",
    primeLibraryPath: "/app/libpolymux-wechat-prime.dylib",
    exists: async () => true,
    run: async (file, args) => {
      calls.push({file, args});
      if (file === "/app/wechat-launch-hidden") running = true;
      return {
        stdout:
          file === "/app/wechat-launch-hidden"
            ? '{"ok":true,"pid":42,"guarded":true}'
            : running
              ? `${executable}\n`
              : "",
        stderr: "",
      };
    },
  });
  assert.equal(ready, true);
  assert.deepEqual(calls[1], {
    file: "/app/wechat-launch-hidden",
    args: [
      appPath,
      "/app/wechat_native_task_lldb.py",
      "/app/libpolymux-wechat-prime.dylib",
    ],
  });
  assert.equal(calls.some((call) => call.file === "/usr/bin/open"), false);
});

test("a process alone is not evidence that the launch guard is installed", async () => {
  for (const response of [{ok:true,pid:42},{ok:true,pid:0,guarded:true},
    {ok:true,pid:42,guarded:false},{ok:false,pid:42,guarded:true}]) {
    const ready = await ensureWeChatAppRunningHidden({platform:"darwin",appPaths:[appPath],
      launchHelperPath:"/app/launch",nativeTaskScriptPath:"/app/task.py",primeLibraryPath:"/app/guard.dylib",
      exists:async()=>true,run:async(file)=>({stdout:file==="/bin/ps"?"":JSON.stringify(response),stderr:""})});
    assert.equal(ready,false);
  }
});

test("a failed guarded launch does not expose WeChat through Launch Services", async () => {
  const calls: Array<{file: string; args: string[]}> = [];
  const ready = await ensureWeChatAppRunningHidden({
    platform: "darwin",
    appPaths: [appPath],
    launchHelperPath: "/app/wechat-launch-hidden",
    nativeTaskScriptPath: "/app/wechat_native_task_lldb.py",
    primeLibraryPath: "/app/libpolymux-wechat-prime.dylib",
    exists: async () => true,
    run: async (file, args) => {
      calls.push({file, args});
      if (file === "/app/wechat-launch-hidden")
        return {stdout: '{"ok":false,"reason":"window_guard_failed"}', stderr: ""};
      return {stdout: "", stderr: ""};
    },
  });
  assert.equal(ready, false);
  assert.equal(calls.some((call) => call.file === "/usr/bin/open"), false);
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
    await weChatSessionReadyHidden({
      platform: "darwin",
      helperPath: "/app/wechat-prime",
      run: async (file, args) => {
        calls.push({file, args});
        return {
          stdout: '{"ok":true,"ready":true,"state":"signed_in"}',
          stderr: "",
        };
      },
    }),
    true,
  );
  assert.deepEqual(calls.at(-1), {
    file: "/app/wechat-prime",
    args: ["--status-only"],
  });
  assert.equal(
    await weChatSessionStateHidden({
      platform: "darwin",
      helperPath: "/app/wechat-prime",
      run: async () => ({
        stdout: '{"ok":true,"ready":false,"state":"remembered_login"}',
        stderr: "",
      }),
    }),
    "remembered_login",
  );
  assert.equal(
    await weChatSessionStateHidden({
      platform: "darwin",
      helperPath: "/app/wechat-prime",
      run: async () => ({
        stdout: '{"ok":true,"ready":false,"state":"signed_out"}',
        stderr: "",
      }),
    }),
    "signed_out",
  );
  assert.equal(
    await weChatSessionStateHidden({
      platform: "darwin",
      helperPath: "/app/wechat-prime",
      run: async () => ({
        stdout: '{"ok":true,"ready":false,"state":"interactive_login"}',
        stderr: "",
      }),
    }),
    "interactive_login",
  );
  assert.equal(
    await weChatSessionStateHidden({
      platform: "darwin",
      helperPath: "/app/wechat-prime",
      run: async () => ({
        stdout: '{"ok":true,"ready":false,"state":"launching"}',
        stderr: "",
      }),
    }),
    "launching",
  );
  assert.equal(
    await weChatSessionStateHidden({
      platform: "darwin",
      helperPath: "/app/wechat-prime",
      run: async () => ({
        stdout: '{"ok":true,"ready":false,"state":"locked"}',
        stderr: "",
      }),
    }),
    "locked",
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

test("explicit Open WeChat uses foreground Launch Services and reports missing installs", async () => {
  const calls: unknown[] = [];
  const {openWeChatDesktop} = await import('../src/wechat-app.js');
  const options = {platform: 'darwin' as const, appPaths: [appPath], exists: async () => true,
    run: async (file: string, args: string[]) => {calls.push([file, args]); return {stdout: '', stderr: ''};}};
  await openWeChatDesktop(options);
  assert.deepEqual(calls, [['/usr/bin/open', ['-a', appPath]]]);
  await assert.rejects(openWeChatDesktop({...options, exists: async () => false}), /Install WeChat/);
  await assert.rejects(openWeChatDesktop({...options, platform: 'linux'}), /only supported on Mac/);
  assert.equal(calls.length, 1);
  await assert.rejects(openWeChatDesktop({...options, run: async () => {throw new Error('launch refused');}}), /launch refused/);
});
