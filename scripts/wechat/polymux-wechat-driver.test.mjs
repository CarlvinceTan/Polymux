import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import {
  buildNativeBaseRequest,
  buildNativeCdnVideoRequest,
  buildNativeFileMessageRequest,
  buildNativeMessageRequest,
  buildNativeRevokeRequest,
  buildNativeSendEmojiRequest,
  buildNativeUploadAppAttachRequest,
  buildNativeVoiceRequest,
  buildReplyXml,
  buildStickerXml,
  extractEmojiElement,
  hasExactTextHistory,
  hasTextHistoryFragment,
  hasTypedMessageHistory,
  nativeWindowGuardReady,
  NATIVE_TASK_ROUTES,
  parseNativeUploadAppAttachResponse,
  parseNativeNewSendMessageResponse,
  parseNativeSendAppMessageResponse,
  parseNativeVideoResponse,
  sendComposerMessage,
  sendNativeTask,
  settleResidentComposerAttempt,
  sendTypedMessage,
  stickerMd5,
  WECHAT_NATIVE_PROFILE_SHA256,
} from "./wechat-wire.mjs";
import {
  daemonStatusRunning,
  hasWeChatDaemonCaptureProcess,
  recognisesDaemonStatus,
  settlePausedDaemonOperation,
  usesNativeTextTransport,
  weChatDaemonCaptureProcessIds,
} from "./wechat-daemon-coordination.mjs";
import { sentMediaMessageId } from "./wechat-media-history.mjs";

const driver = new URL("./polymux-wechat-driver.mjs", import.meta.url).pathname;
const wireInjector = new URL("./wechat_wire_inject.py", import.meta.url)
  .pathname;
const nativeTaskInjector = new URL(
  "./wechat_native_task_lldb.py",
  import.meta.url,
).pathname;
const nativeCdnInjector = new URL(
  "./wechat_native_cdn_upload_lldb.py",
  import.meta.url,
).pathname;
const nativePrimeInject = new URL(
  "../../packages/wechat/src/native/wechat-prime-inject.m",
  import.meta.url,
).pathname;
const writerBuilder = new URL(
  "./build-wechat-writer.mjs",
  import.meta.url,
).pathname;
const exec = promisify(execFile);

test("only reuses a window guard before its recorded deadline", () => {
  assert.equal(nativeWindowGuardReady("1\n100.000\n120.000\n", 110), true);
  assert.equal(nativeWindowGuardReady("1\n100.000\n120.000\n", 120), false);
  assert.equal(nativeWindowGuardReady("1\n100.000\n", 110), false);
  assert.equal(nativeWindowGuardReady("1\n200.000\n220.000\n", 110), false);
});

test("read-only mention requests respect the test fence without reading an account", async () => {
  const child = spawn(process.execPath, [driver, "read-mentions", "--json"], {
    env: {...process.env, POLYMUX_WECHAT_PROVIDER: "native", POLYMUX_WECHAT_TEST_ONLY_FILEHELPER: "1",
      POLYMUX_WECHAT_STORE_REGISTRY: path.join(tmpdir(), "unconfigured-wechat-test-registry.json")},
    stdio: ["pipe", "pipe", "pipe"],
  });
  const chunks = [];
  child.stdout.on("data", chunk => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {child.once("error", reject); child.once("close", resolve);});
  child.stdin.end(JSON.stringify({chatId: "123456@chatroom", serverId: "9001", localId: "1", timestamp: 1788662525}));
  assert.equal(await done, 0);
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), {mentionedIds: null});
});

test("media history proof rejects an unrelated same-kind row", () => {
  const bytes = Buffer.from("exact outbound bytes");
  const base = {
    create_time: 200,
    message_kind: "file",
    real_sender_id: "2", sender_wxid: "wxid_self",
    server_id: "file-server-id",
  };

  assert.equal(
    sentMediaMessageId([
      {...base, media: {filename: "other.txt", size_bytes: 1}},
    ], {
      mediaType: "file",
      bytes,
      sinceEpoch: 190, selfWxid: "wxid_self",
      expectedName: "parity.txt",
    }),
    undefined,
  );
  assert.equal(
    sentMediaMessageId([
      {...base, media: {filename: "parity.txt", size_bytes: bytes.length}},
    ], {
      mediaType: "file",
      bytes,
      sinceEpoch: 190, selfWxid: "wxid_self",
      expectedName: "/tmp/parity.txt",
    }),
    "file-server-id",
  );
  // Video is the one kind WeChat re-encodes on the way out, so its delivered
  // bytes never match the local file. A lone new video is still not proof that
  // it is ours — the account's phone can sync one inside the boundary — so only
  // the exact id the sender reported may acknowledge it.
  const reencodedVideo = {...base, message_kind: "video", media: {length: bytes.length - 1}};
  assert.equal(
    sentMediaMessageId([reencodedVideo], {
      mediaType: "video",
      bytes,
      sinceEpoch: 190, selfWxid: "wxid_self",
      expectedName: "parity.mp4",
    }),
    undefined,
  );
  assert.equal(
    sentMediaMessageId([
      reencodedVideo,
      {...reencodedVideo, server_id: "other-video-id"},
    ], {
      mediaType: "video",
      bytes,
      sinceEpoch: 190, selfWxid: "wxid_self",
      expectedName: "parity.mp4",
    }),
    undefined,
  );
  assert.equal(
    sentMediaMessageId([
      reencodedVideo,
      {...reencodedVideo, server_id: "other-video-id"},
    ], {
      mediaType: "video",
      bytes,
      sinceEpoch: 190, selfWxid: "wxid_self",
      expectedName: "parity.mp4",
      expectedMessageId: "file-server-id",
    }),
    "file-server-id",
  );
});

test("media history requires exact lengths and rejects uncorrelated re-encoded images", () => {
  const bytes = Buffer.from("exact outbound bytes");
  const row = {
    create_time: 200,
    real_sender_id: "2", sender_wxid: "wxid_self",
    server_id: "media-server-id",
  };

  assert.equal(
    sentMediaMessageId([
      {...row, message_kind: "audio", media: {length: bytes.length}},
    ], {mediaType: "audio", bytes, sinceEpoch: 190, selfWxid: "wxid_self"}),
    "media-server-id",
  );
  assert.equal(
    sentMediaMessageId([
      {...row, message_kind: "image", media: {md5: "wechat-reencoded"}},
    ], {mediaType: "image", bytes, sinceEpoch: 190, selfWxid: "wxid_self"}),
    undefined,
  );
  assert.equal(
    sentMediaMessageId([
      {...row, create_time: 189, message_kind: "image", media: {}},
    ], {mediaType: "image", bytes, sinceEpoch: 190, selfWxid: "wxid_self"}),
    undefined,
  );
});

test("recognises daemon startup and capture-debugger processes", () => {
  assert.equal(daemonStatusRunning("running pid=1234"), true);
  assert.equal(daemonStatusRunning("not running"), false);
  assert.equal(recognisesDaemonStatus("not running"), true);
  assert.equal(recognisesDaemonStatus('{"delivered_verified":true}'), false);
  assert.equal(
    hasWeChatDaemonCaptureProcess(
      "/opt/homebrew/bin/wechatd run\n/usr/bin/lldb -p 42 -s /tmp/wx-cdn-capture-daemon-a/cmd.lldb\n",
    ),
    true,
  );
  assert.equal(
    hasWeChatDaemonCaptureProcess("/opt/homebrew/bin/wechatd run\n"),
    false,
  );
  assert.equal(
    hasWeChatDaemonCaptureProcess(
      "59735 1 /usr/bin/lldb -p 16213 -s /tmp/wx-hijack-daemon-1788022614588164000/cmd.lldb\n",
    ),
    true,
  );
  assert.equal(
    hasWeChatDaemonCaptureProcess("node scripts/wechat/polymux-wechat-driver.mjs write --json\n"),
    false,
  );
  assert.deepEqual(
    weChatDaemonCaptureProcessIds(
      " 10507     1 /opt/homebrew/bin/wechatd run\n" +
        " 11494 10507 /usr/bin/lldb -p 95810 -s /tmp/wx-cdn-capture-daemon-10507/cmd.lldb\n" +
        " 11495 11494 /usr/libexec/debugserver --fd=12\n" +
        " 22000     1 /usr/bin/lldb -p 16213 -s /tmp/wx-hijack-daemon-22000/cmd.lldb\n" +
        " 22001 22000 /usr/libexec/debugserver --fd=13\n" +
        " 21000     1 /usr/bin/lldb -p 99\n",
    ),
    [11494, 22000, 11495, 22001],
  );
});

test("native text transport requires both exact-build runtime gates", () => {
  assert.equal(
    usesNativeTextTransport({
      POLYMUX_WECHAT_WIRE_NATIVE: "1",
      POLYMUX_WECHAT_LLDB_EXPERIMENTAL: "1",
    }),
    true,
  );
  assert.equal(
    usesNativeTextTransport({
      POLYMUX_WECHAT_WIRE_NATIVE: "1",
    }),
    false,
  );
});

test("preserves a verified native result when daemon recovery is delayed", () => {
  const result = {messageId: "verified-server-id"};
  const restartFailure = new Error("daemon start failed");
  assert.deepEqual(
    settlePausedDaemonOperation({result, restartFailure}),
    {result, restartFailure},
  );
  assert.throws(
    () => settlePausedDaemonOperation({
      actionFailure: new Error("send failed"),
      restartFailure,
    }),
    AggregateError,
  );
});

async function invoke(request, helperSource, environment = {}, primerSource) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "polymux-wechat-driver-"),
  );
  const helper = path.join(directory, "wechat-use");
  await writeFile(helper, helperSource, { mode: 0o700 });
  const primer = path.join(directory, "wechat-prime");
  if (primerSource) await writeFile(primer, primerSource, {mode: 0o700});
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [driver, "write", "--json"], {
      env: {
        ...process.env,
        POLYMUX_WECHAT_WIRE_NATIVE: "0",
        POLYMUX_WECHAT_LLDB_EXPERIMENTAL: "0",
        POLYMUX_WECHAT_RELAY_MANAGED: "1",
        POLYMUX_WECHAT_CLI: helper,
        ...(primerSource ? {POLYMUX_WECHAT_PRIMER: primer} : {}),
        POLYMUX_WECHAT_TEST_ONLY_FILEHELPER: "1",
        ...environment,
        POLYMUX_WECHAT_DYLIB: path.join(directory, "unavailable-native-build.dylib"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({
        code,
        body: JSON.parse(Buffer.concat(stdout).toString("utf8")),
      }),
    );
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

test("ordinary text fails closed without the exact-build model sender", async () => {
  const result = await invoke(
    { kind: "text", chatId: "filehelper", body: "parity test" },
    '#!/bin/sh\nprintf \'%s\\n\' \'{"delivered_verified":true,"message_id":"unsafe"}\'\n',
  );
  assert.equal(result.code, 0);
  assert.match(result.body.reason, /background-safe native WeChat text/);
});

test("ordinary text ignores nested CLI delivery claims", async () => {
  const result = await invoke(
    { kind: "text", chatId: "filehelper", body: "parity test" },
    '#!/bin/sh\nprintf \'%s\\n\' \'{"ok":true,"sent":true,"diagnostic":{"delivered_verified":true,"message_id":"84"}}\'\n',
  );
  assert.equal(result.code, 0);
  assert.match(result.body.reason, /background-safe native WeChat text/);
});

test("ordinary text does not query history after rejecting the CLI route", async () => {
  const result = await invoke(
    { kind: "text", chatId: "filehelper", body: "parity test" },
    `#!/bin/sh
if [ "$1" = "history" ]; then
  printf '%s\\n' '{"rows":[{"server_id":398437007617799014,"real_sender_id":"2","message_kind":"text","display_text":"parity test"}]}'
else
  printf '%s\\n' '{"ok":true,"diagnostic":{"delivered_verified":true}}'
fi
`,
  );
  assert.match(result.body.reason, /background-safe native WeChat text/);
});

test("replies fail closed instead of using the painted CLI fallback", async () => {
  const painted = "↳ A Friend: earlier message\nmy reply";
  const result = await invoke(
    {
      kind: "text",
      chatId: "filehelper",
      body: "my reply",
      replyTo: "398437007617799014",
      fallbackBody: painted,
    },
    `#!/usr/bin/env node
if (process.argv[2] === "send" && process.argv[3] === ${JSON.stringify(painted)}) {
  process.stdout.write('{"delivered_verified":true,"message_id":"85"}\\n');
  process.exit(0);
}
process.stdout.write('{"error":"unexpected helper call"}\\n');
process.exit(2);
`,
  );
  assert.equal(result.code, 0);
  assert.match(result.body.reason, /exact-build sender/);
});

test("reply mentions fail closed instead of using the CLI fallback", async () => {
  const painted = "↳ Alex: earlier message\n@Alex my reply";
  const result = await invoke(
    {
      kind: "text",
      chatId: "filehelper",
      body: "@Alex my reply",
      replyTo: "398437007617799014",
      fallbackBody: painted,
      mentions: ["wxid_alex"],
    },
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (
  args[0] === "send" &&
  args[1] === ${JSON.stringify(painted)} &&
  args.includes("--mention") &&
  args[args.indexOf("--mention") + 1] === "wxid_alex"
) {
  process.stdout.write('{"delivered_verified":true,"message_id":"86"}\\n');
  process.exit(0);
}
process.stdout.write(JSON.stringify({error: "mention was not preserved", args}) + "\\n");
process.exit(2);
`,
    {
      POLYMUX_WECHAT_WIRE_NATIVE: "1",
      POLYMUX_WECHAT_LLDB_TASK_NATIVE: "1",
    },
  );
  assert.equal(result.code, 0);
  assert.match(result.body.reason, /native mentions require a group chat/);
});

test("builds native refermsg XML with a lossless server id", () => {
  const xml = buildReplyXml({
    body: "answer & more",
    chatId: "filehelper",
    createTime: 1_787_884_403,
    displayName: "File <Transfer>",
    fromWxid: "wxid_self",
    messageId: "9007199254740993",
    quotedBody: "original",
  });
  assert.match(xml, /<type>57<\/type>/);
  assert.match(xml, /<svrid>9007199254740993<\/svrid>/);
  assert.match(xml, /<title>answer &amp; more<\/title>/);
  assert.match(xml, /<displayname>File &lt;Transfer&gt;<\/displayname>/);
  assert.ok(deflateSync(xml).length > 0);
});

test("native mentions stop before sending when the reader cannot verify their targets", async () => {
  const result = await invoke({kind: "text", chatId: "study@chatroom",
    body: "@Alex test", mentions: ["wxid_alex"]},
  `#!/usr/bin/env node
const command = process.argv[2];
process.stdout.write(JSON.stringify(command === 'accounts'
  ? {accounts: [{wxid: 'wxid_self'}]} : command === 'contacts' ? [] : {rows: []}));
`, {POLYMUX_WECHAT_TEST_ONLY_FILEHELPER: "0", POLYMUX_WECHAT_WIRE_NATIVE: "1",
    POLYMUX_WECHAT_LLDB_EXPERIMENTAL: "1"});
  assert.equal(result.body.deliveredVerified, false);
  assert.match(result.body.reason, /reader cannot verify native mentions; no message was sent/);
});

test("requires the helper bootstrap to be committed exactly", () => {
  const expected = "Polymux ready 0123456789";
  assert.equal(
    hasExactTextHistory(
      JSON.stringify({
        rows: [
          {
            display_text: expected,
            message_content: expected,
            message_kind: "text",
          },
        ],
      }),
      expected,
    ),
    true,
  );
  assert.equal(
    hasExactTextHistory(
      JSON.stringify({
        rows: [
          {
            display_text: `${expected}overlap`,
            message_content: `${expected}overlap`,
            message_kind: "text",
          },
        ],
      }),
      expected,
    ),
    false,
  );
  assert.equal(
    hasTextHistoryFragment(
      JSON.stringify({
        rows: [
          {
            display_text: "Polymuxattach0123456789",
            message_content: "Polymuxattach0123456789",
            message_kind: "text",
          },
        ],
      }),
      "0123456789",
    ),
    true,
  );
  assert.equal(
    hasTextHistoryFragment(
      JSON.stringify({
        rows: [
          {
            display_text:
              "Polymux attac 0123456789abcde 0123456789abcdef 0123456789abcdf",
            message_content:
              "Polymux attac 0123456789abcde 0123456789abcdef 0123456789abcdf",
            message_kind: "text",
          },
        ],
      }),
      "0123456789abcdef",
    ),
    true,
  );
});

test("recognizes the exact typed sticker only from native history", () => {
  const content =
    '<msg><emoji md5="78c1cd4929f6f9eca9a1a4333e1b13bb" type="2"/></msg>';
  assert.equal(
    hasTypedMessageHistory(
      JSON.stringify({
        rows: [
          {
            message_kind: "emoticon",
            message_content: content,
          },
        ],
      }),
      {content, messageType: 47},
    ),
    true,
  );
  assert.equal(
    hasTypedMessageHistory(
      JSON.stringify({
        rows: [{message_kind: "text", message_content: content}],
      }),
      {content, messageType: 47},
    ),
    false,
  );
});

test("keeps the driver's exact-build gate aligned with the native profile", async () => {
  const profile = await readFile(
    new URL("../../packages/wechat/src/wechat-native-profile.ts", import.meta.url),
    "utf8",
  );
  assert.match(profile, new RegExp(WECHAT_NATIVE_PROFILE_SHA256));
});

test("the sticker probe requires a verified account without launching Desktop", async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [driver, "stickers", "--json"], {
      env: {...process.env, POLYMUX_WECHAT_CLI: "/usr/bin/false"},
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8")));
        return;
      }
      resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
    });
  });
  assert.deepEqual(result, {deliveredVerified: false, reason: "WeChat account identity is unavailable"});
});

test("one native gate cannot re-enable the old CLI text path", async () => {
  const result = await invoke(
    { kind: "text", chatId: "filehelper", body: "must not be sent" },
    `#!/bin/sh
if [ "$1" = "polymux-wire-capabilities" ]; then
  printf '%s\\n' '{"error":"unknown command"}'
  exit 2
fi
printf '%s\\n' '{"delivered_verified":true,"message_id":"unexpected"}'
`,
    { POLYMUX_WECHAT_WIRE_NATIVE: "1" },
  );
  assert.equal(result.code, 0);
  assert.match(result.body.reason, /background-safe native WeChat text/);
});

test("ordinary text never primes and retries the old CLI sender", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "polymux-wechat-prime-test-"),
  );
  const counter = path.join(directory, "count");
  const result = await invoke(
    {kind: "text", chatId: "filehelper", body: "retry me"},
    `#!/bin/sh
count=0
[ -f "$POLYMUX_TEST_COUNTER" ] && count=$(cat "$POLYMUX_TEST_COUNTER")
count=$((count + 1))
printf '%s' "$count" > "$POLYMUX_TEST_COUNTER"
if [ "$count" -eq 1 ]; then
  printf '%s\n' '{"delivered_verified":false,"diagnostic":{"reason":"slot_send_bp_armed_no_fire"}}'
else
  printf '%s\n' '{"delivered_verified":true,"message_id":"primed"}'
fi
`,
    {POLYMUX_TEST_COUNTER: counter},
    `#!/bin/sh
printf '%s\n' '{"ok":true,"primed":true}'
`,
  );
  assert.match(result.body.reason, /background-safe native WeChat text/);
  await assert.rejects(readFile(counter), {code: "ENOENT"});
});

test("the model sender rejects unsafe recipients before touching WeChat", async () => {
  await assert.rejects(
    sendComposerMessage({
      kind: "text",
      recipient: "x".repeat(23),
      text: "must not be sent",
    }),
    /recipient is invalid/,
  );
});

test("the native wire helper stays disabled without an explicit opt-in", async () => {
  await assert.rejects(
    sendTypedMessage({
      content: "must not be sent",
      messageType: 1,
      recipient: "filehelper",
    }),
    /native WeChat wire sending is disabled/,
  );
});

test("the native wire helper keeps the LLDB task route separately guarded", async () => {
  const previous = process.env.POLYMUX_WECHAT_WIRE_NATIVE;
  process.env.POLYMUX_WECHAT_WIRE_NATIVE = "1";
  try {
    await assert.rejects(
      sendTypedMessage({
        content: "must not be sent",
        messageType: 1,
        recipient: "filehelper",
      }),
      /LLDB task sending is experimental and disabled/,
    );
  } finally {
    if (previous === undefined) delete process.env.POLYMUX_WECHAT_WIRE_NATIVE;
    else process.env.POLYMUX_WECHAT_WIRE_NATIVE = previous;
  }
});

test("builds the exact native newsendmsg protobuf captured from WeChat", () => {
  const request = buildNativeMessageRequest({
    clientMessageId: 2_093_731_455,
    content: "STACKPROBE_1787923600",
    messageType: 1,
    recipient: "filehelper",
    timestamp: 1_787_923_238,
  });
  assert.equal(
    request.toString("hex"),
    "080112670a0c0a0a66696c6568656c7065721215535441434b50524f42455f31373837393233363030180120a696c6d40628ff9cafe60732323c6d7367736f757263653e3c616c6e6f64653e3c66723e313c2f66723e3c2f616c6e6f64653e3c2f6d7367736f757263653e",
  );
});

test("pins the exact-build Mars command IDs for every outbound route", () => {
  assert.deepEqual(NATIVE_TASK_ROUTES, {
    newSendMessage: {
      cgi: "/cgi-bin/micromsg-bin/newsendmsg",
      commandId: 522,
    },
    uploadAppAttach: {
      cgi: "/cgi-bin/micromsg-bin/uploadappattach",
      commandId: 220,
    },
    sendAppMessage: {
      cgi: "/cgi-bin/micromsg-bin/sendappmsg",
      commandId: 222,
    },
    uploadVoice: {
      cgi: "/cgi-bin/micromsg-bin/uploadvoice",
      commandId: 127,
    },
    uploadVideo: {
      cgi: "/cgi-bin/micromsg-bin/uploadvideo",
      commandId: 149,
    },
    sendEmoji: {
      cgi: "/cgi-bin/micromsg-bin/sendemoji",
      commandId: 175,
    },
    revokeMessage: {
      cgi: "/cgi-bin/micromsg-bin/revokemsg",
      commandId: 594,
    },
  });
});

test("evaluates a native task once on the selected stopped thread", async () => {
  const source = await readFile(nativeTaskInjector, "utf8");
  assert.match(source, /SetTryAllThreads\(False\)/);
  assert.match(source, /SetStopOthers\(True\)/);
  assert.doesNotMatch(source, /SetTryAllThreads\(True\)/);
});

test("native task responses cannot call an absent synthetic callback", async () => {
  const source = await readFile(nativeTaskInjector, "utf8");
  assert.match(source, /RET_ZERO_STUB_OFFSET = 0x430BC/);
  assert.match(source, /struct\.pack_into\("<Q", vtable, 0x30, ret_zero\)/);
});

test("attachment composer sends stay cloaked through late window ordering", async () => {
  const source = await readFile(nativePrimeInject, "utf8");
  assert.match(source, /PMXComposerGuardDeadline/);
  assert.match(
    source,
    /BOOL cloakComposer =\s*NSWorkspace\.sharedWorkspace\.frontmostApplication\.processIdentifier !=\s*getpid\(\)/,
  );
  assert.doesNotMatch(source, /cloakComposer = !NSApp\.isActive/);
  assert.match(source, /if \(window\.isVisible\) PMXCloakWindow\(window\)/);
  assert.match(source, /PMXUncloakWindows\(YES\)/);
  assert.match(source, /\[window orderBack:nil\]/);
});

test("a hidden launch remains guarded until the user actually activates WeChat", async () => {
  const source = await readFile(nativePrimeInject, "utf8");
  assert.match(
    source,
    /PMXGuardEnabled && \(PMXStartupFinished \|\| launchWindowOpen\)/,
  );
  assert.match(
    source,
    /return PMXColdGuardActive\(\) \|\| PMXComposerGuardActive\(\);/,
  );
  assert.doesNotMatch(
    source,
    /PMXColdGuardActive\(\) && !PMXStartupFinished/,
  );
  assert.match(
    source,
    /NSWorkspace\.sharedWorkspace\.frontmostApplication\.processIdentifier != getpid\(\)/,
  );
  assert.match(source, /PMXGuardEnabled = NO;\s*PMXUncloakWindows\(NO\);/);
});

test("builds the profiled native file upload and app-message requests", () => {
  const taskId = 0x20000123;
  const base = buildNativeBaseRequest({
    clientProof: Buffer.from("m64a7624402b3883"),
    deviceId: 0xfffffffff264a0b0n,
    sessionId: 2_408_811_374,
    taskId,
  });
  assert.equal(base.includes(Buffer.from("UnifiedPCMac 26 arm64")), true);
  const upload = buildNativeUploadAppAttachRequest({
    chunk: Buffer.from("file bytes"),
    clientAppDataId: "filehelper_1_UploadFile",
    fileMd5: "1306c37da4b32f4ea2707fa319c91f3d",
    recipient: "filehelper",
    startPosition: 0,
    taskId,
    totalLength: 10,
  });
  assert.equal(upload.includes(Buffer.from("filehelper")), true);
  assert.equal(upload.includes(Buffer.from("file bytes")), true);
  const request = buildNativeFileMessageRequest({
    attachmentId: "@cdn_attachment",
    clientMessageId: "filehelper_1_UploadFile_xwechat_1",
    extension: "txt",
    fileName: "parity.txt",
    fileSize: 10,
    fromWxid: "wxid_self",
    recipient: "filehelper",
    taskId,
    timestamp: 1_787_927_412,
  });
  assert.equal(request.includes(Buffer.from("<type>6</type>")), true);
  assert.equal(request.includes(Buffer.from("@cdn_attachment")), true);
  assert.equal(
    parseNativeUploadAppAttachResponse(
      Buffer.from("0a0208001a066d6564696131", "hex"),
    ),
    "media1",
  );
});

test("parses server message ids from exact native send responses", () => {
  assert.equal(
    parseNativeNewSendMessageResponse(
      Buffer.from(
        "0a040800120010011a300800120c0a0a66696c6568656c706572180020f7cf9bc70428d29dc7d40630d59dc7d4063801409cbc95bbfdb485a4692000",
        "hex",
      ),
    ),
    "7586337382923066908",
  );
  assert.equal(
    parseNativeSendAppMessageResponse(
      Buffer.from("0a040800120048939fe1bf81bc97a621", "hex"),
    ),
    "2399395918537838483",
  );
  assert.equal(
    parseNativeVideoResponse(Buffer.from("0a0408001200307b", "hex")),
    "123",
  );
});

test("builds the native voice upload request", () => {
  const taskId = 0x20000124;
  const voice = buildNativeVoiceRequest({
    chunk: Buffer.from("silk chunk"),
    clientMessageId: "wxid_self_1787927412",
    durationMs: 2_340,
    fromWxid: "wxid_self",
    offset: 65_000,
    recipient: "filehelper",
    taskId,
    timestamp: 1_787_927_412,
    totalLength: 70_000,
  });
  assert.equal(voice.includes(Buffer.from("silk chunk")), true);
  assert.equal(voice.includes(Buffer.from("filehelper")), true);
  assert.equal(voice.includes(Buffer.from("wxid_self_1787927412")), true);

});

test("builds the CDN-backed native video send request", () => {
  const request = buildNativeCdnVideoRequest({
    aesKey: "9f3ca58e7ae9f07352e90c3627ffbe79",
    cdnKey: "305f02010004cdn-key",
    clientMessageId: "filehelper_1787927413_160_xwechat_1",
    durationSeconds: 4,
    fromWxid: "wxid_self",
    md5Key: "1306c37da4b32f4ea2707fa319c91f3d",
    recipient: "filehelper",
    taskId: 0x20000127,
    videoId: "filehelper_1787927413_617_1",
    videoSize: 67_849,
  });
  for (const value of [
    "305f02010004cdn-key",
    "9f3ca58e7ae9f07352e90c3627ffbe79",
    "1306c37da4b32f4ea2707fa319c91f3d",
    "filehelper_1787927413_617_1",
    "<cf>3</cf>",
  ])
    assert.equal(request.includes(Buffer.from(value)), true);
  assert.equal(request.includes(Buffer.from("7000", "hex")), true);
  assert.equal(request.includes(Buffer.from("b00200", "hex")), true);
});

test("uses a pointer-free exact-build CDN video payload", async () => {
  const source = await readFile(nativeCdnInjector, "utf8");
  assert.match(source, /recipient != "filehelper"/);
  assert.match(source, /def _video_payload_template\(\)/);
  assert.match(source, /START_UPLOAD_WRAPPER_OFFSET = 0x4E6D714/);
  assert.match(source, /callback_one = _allocate/);
  assert.match(source, /callback_two = _allocate/);
  assert.doesNotMatch(source, /payloadHex|uploadController|capture_warmup/);
});

test("packages the self-contained CDN uploader with the writer", async () => {
  const source = await readFile(writerBuilder, "utf8");
  assert.match(source, /"wechat_native_cdn_upload_lldb\.py"/);
  assert.doesNotMatch(source, /cdn-warmup/);
});

test("builds a lossless native recall request", () => {
  const request = buildNativeRevokeRequest({
    clientMessageId: "client-1",
    fromWxid: "wxid_self",
    recipient: "wxid_peter",
    serverMessageId: "9007199254740993",
    taskId: 0x20000125,
    timestamp: 1_787_927_414,
  });
  assert.equal(request.includes(Buffer.from("client-1")), true);
  assert.equal(request.includes(Buffer.from("wxid_peter")), true);
  // 9007199254740993 encoded as an unsigned protobuf varint.
  assert.equal(request.includes(Buffer.from("8180808080808010", "hex")), true);
});

test("recall resolves a client id and always confirms native history", async () => {
  const source = await readFile(driver, "utf8");
  assert.match(source, /request\.clientMessageId/);
  assert.match(source, /target\?\.local_id/);
  assert.match(source, /if \(!\(await waitForRecallHistory/);
  assert.doesNotMatch(source, /target\.client_message_id/);
});

test("the wire injector overwrites a misrouted protobuf recipient", async () => {
  const script = `
import importlib.util, json
spec = importlib.util.spec_from_file_location("injector", ${JSON.stringify(wireInjector)})
injector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(injector)
inner = injector._encode([
    (1, 2, injector._encode([(1, 2, b"wxid_wrong"), (2, 2, b"metadata")])),
    (2, 2, b"POLYMUX_SENTINEL"),
    (3, 0, 1),
])
raw = injector._encode([(1, 0, 1), (2, 2, inner)])
rewritten, original, final = injector.rewrite_message(
    raw,
    b"POLYMUX_SENTINEL",
    b"filehelper",
    49,
    b"<msg><appmsg><type>57</type></appmsg></msg>",
)
bad = injector._encode([
    (2, 2, injector._encode([(2, 2, b"POLYMUX_SENTINEL"), (3, 0, 1)])),
])
try:
    injector.rewrite_message(
        bad, b"POLYMUX_SENTINEL", b"filehelper", 1, b"body"
    )
    invalid = "accepted"
except ValueError as error:
    invalid = str(error)
print(json.dumps({
    "hex": rewritten.hex(),
    "original": original,
    "final": final,
    "invalid": invalid,
}))
`;
  const { stdout } = await exec("python3", ["-c", script]);
  const result = JSON.parse(stdout);
  assert.equal(result.original, "wxid_wrong");
  assert.equal(result.final, "filehelper");
  const body = Buffer.from(result.hex, "hex");
  assert.equal(body.includes(Buffer.from("filehelper")), true);
  assert.equal(body.includes(Buffer.from("wxid_wrong")), false);
  assert.equal(body.includes(Buffer.from("metadata")), true);
  assert.equal(body.includes(Buffer.from("<type>57</type>")), true);
  assert.match(result.invalid, /required fields/);
});

test("image sending fails closed without the exact-build model sender", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-image-"));
  const imagePath = path.join(directory, "pixel.png");
  await writeFile(imagePath, "image bytes");
  const result = await invoke(
    {
      kind: "media",
      chatId: "filehelper",
      mediaType: "image",
      path: imagePath,
      name: "pixel.png",
    },
    `#!/bin/sh
if [ "$1" = "history" ]; then
  printf '%s\\n' '{"rows":[{"server_id":2549984119094729143,"real_sender_id":"2","message_kind":"image","media":{"md5":"wechat-reencoded-hash","length":11}}]}'
else
  printf '%s\\n' '{"ok":true}'
fi
`,
    { POLYMUX_WECHAT_ALLOW_FOCUSED_IMAGE_SEND: "1" },
  );
  assert.match(result.body.reason, /exact-build model sender/);
});

test("refuses a sticker without a native WeChat reference", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-sticker-"));
  const stickerPath = path.join(directory, "sticker.gif");
  await writeFile(stickerPath, "gif bytes");
  const result = await invoke(
    {
      kind: "media",
      chatId: "filehelper",
      mediaType: "sticker",
      path: stickerPath,
      name: "sticker.gif",
    },
    "#!/bin/sh\nexit 99\n",
  );
  assert.match(result.body.reason, /emojiXml/);
});

test("builds a native sticker wrapper and preserves its md5", () => {
  const element =
    '<emoji fromusername="old" tousername="old" md5="1306c37da4b32f4ea2707fa319c91f3d" len="31357"></emoji>';
  const xml = buildStickerXml(element, {
    chatId: "filehelper",
    fromWxid: "wxid_self",
  });
  assert.equal(
    extractEmojiElement(xml)?.includes('tousername="filehelper"'),
    true,
  );
  assert.equal(stickerMd5(xml), "1306c37da4b32f4ea2707fa319c91f3d");
});

test("builds a native sendemoji request from the stored sticker id", () => {
  const request = buildNativeSendEmojiRequest({
    animationId: "1306c37da4b32f4ea2707fa319c91f3d",
    recipient: "filehelper",
    taskId: 0x20000126,
    timestampMs: 1_787_927_415_123,
  });
  assert.equal(
    request.includes(Buffer.from("1306c37da4b32f4ea2707fa319c91f3d")),
    true,
  );
  assert.equal(request.includes(Buffer.from("filehelper")), true);
  assert.equal(request.includes(Buffer.from("1787927415123")), true);
});

test("does not mistake an absent CLI unread row for native read confirmation", async () => {
  const result = await invoke(
    { kind: "read", chatId: "filehelper" },
    '#!/bin/sh\nprintf \'%s\\n\' \'{"rows":[{"username":"another-chat","unread_count":2}]}\'\n',
  );
  assert.equal(result.body.deliveredVerified, false);
});

test("read acknowledgement rejects malformed state and preserves a native unread count", async () => {
  for (const payload of [{}, {rows: false}, {rows: [{username: "filehelper", unread_count: -1}]},
    {rows: [{username: "filehelper", unread_count: 3}]}]) {
    const result = await invoke({kind: "read", chatId: "filehelper"},
      `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(payload))});\n`);
    assert.equal(result.body.deliveredVerified, false);
  }
});

test("refuses every non-File Transfer destination in live-test mode", async () => {
  const result = await invoke(
    { kind: "text", chatId: "someone-else", body: "must not send" },
    "#!/bin/sh\nexit 99\n",
  );
  assert.equal(result.code, 0);
  assert.match(result.body.reason, /restricted to the selected test chats/);
});

test("does not silently downgrade native-only operations", async () => {
  for (const request of [
    { kind: "media", chatId: "filehelper", mediaType: "audio", path: "/tmp/x" },
    { kind: "recall", chatId: "filehelper", messageId: "1" },
  ]) {
    const result = await invoke(request, "#!/bin/sh\nexit 99\n");
    assert.equal(result.code, 0);
    assert.match(result.body.reason, /exact-build wire sender/);
  }
});

test("audio media stays a native voice bubble through history verification", async () => {
  const source = await readFile(driver, "utf8");
  const audioStart = source.indexOf('if (mediaType === "audio")');
  const videoStart = source.indexOf('if (mediaType === "video")', audioStart);
  assert.ok(audioStart >= 0 && videoStart > audioStart);
  const audioBranch = source.slice(audioStart, videoStart);

  assert.match(audioBranch, /wechatVoice\(bytes, request\.name\)/);
  assert.match(audioBranch, /sendNativeVoice\(/);
  assert.match(
    audioBranch,
    /waitForSentMediaMessageId\([\s\S]*?mediaType,[\s\S]*?voice\.bytes/,
  );
  assert.match(
    audioBranch,
    /WeChat voice submission was not confirmed in history/,
  );
  assert.doesNotMatch(audioBranch, /sendComposerMessage|sendTypedMessage/);
});

test("the native file path remains exact-build gated", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-native-file-"));
  const filePath = path.join(directory, "parity.txt");
  await writeFile(filePath, "file bytes");
  const result = await invoke(
    {
      kind: "media",
      chatId: "filehelper",
      mediaType: "file",
      path: filePath,
      name: "parity.txt",
    },
    `#!/bin/sh
if [ "$1" = "accounts" ]; then
  printf '%s\n' '{"accounts":[{"wxid":"wxid_self"}]}'
elif [ "$1" = "contacts" ]; then
  printf '%s\n' '[]'
elif [ "$1" = "daemon" ]; then
  printf '%s\n' 'stopped'
else
  exit 99
fi
`,
  );
  assert.match(result.body.reason, /exact-build wire sender/);
});

test("file and video sending never invoke the desktop composer fallback", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-native-media-safety-"));
  const mediaPath = path.join(directory, "parity.bin");
  const unsafeHelper = path.join(directory, "unsafe-desktop-helper");
  const sentinel = path.join(directory, "desktop-helper-was-invoked");
  await writeFile(mediaPath, "media bytes");
  await writeFile(
    unsafeHelper,
    '#!/bin/sh\nprintf invoked > "$POLYMUX_WECHAT_UNSAFE_SENTINEL"\nexit 99\n',
    {mode: 0o700},
  );

  for (const mediaType of ["file", "video"]) {
    const result = await invoke(
      {
        kind: "media",
        chatId: "filehelper",
        mediaType,
        path: mediaPath,
        name: mediaType === "file" ? "parity.txt" : "parity.mp4",
      },
      "#!/bin/sh\nexit 99\n",
      {
        POLYMUX_WECHAT_WIRE_NATIVE: "1",
        POLYMUX_WECHAT_PASTE_SEND: unsafeHelper,
        POLYMUX_WECHAT_UNSAFE_SENTINEL: sentinel,
      },
    );
    assert.equal(result.code, 0);
    // Video shares the exact-build model sender with files once the composer
    // transport is enabled; neither may fall back to a desktop helper.
    assert.match(result.body.reason, /exact-build model sender/);
  }

  await assert.rejects(readFile(sentinel), {code: "ENOENT"});
});

test("resident recipient rejection never authorizes a debugger resend", async () => {
  await assert.rejects(settleResidentComposerAttempt(async () => ({
    ok: false, submitted: false, reason: "wechat_model_recipient_changed",
  })), /wechat_model_recipient_changed/);
  await assert.rejects(settleResidentComposerAttempt(async () => {
    throw new Error("unknown channel failure");
  }), /unknown channel failure/);
});

test("an accepted resident request with a lost reply stays pending verification", async () => {
  const answer = await settleResidentComposerAttempt(async () => {
    throw Object.assign(new Error("reply lost"), {modelRequestSubmitted: true});
  });
  assert.equal(answer.submitted, true);
  assert.equal(answer.verificationPending, true);
});

test("resident setup fallback requires proof that no request was submitted", async () => {
  assert.equal(await settleResidentComposerAttempt(async () => {
    throw Object.assign(new Error("socket absent"), {modelRequestSubmitted: false});
  }), null);
  assert.equal(await settleResidentComposerAttempt(async () => ({
    ok: false, submitted: false, reason: "wechat_model_configuration_changed",
  })), null);
  await assert.rejects(settleResidentComposerAttempt(async () => ({
    ok: false, reason: "wechat_model_configuration_changed",
  })), /wechat_model_configuration_changed/);
});

test("the native composer requires a known recipient before paste and rechecks it before delayed send", async () => {
  const source = await readFile(nativePrimeInject, "utf8");
  const check = source.indexOf("if (!currentRecipient.length ||");
  const paste = source.indexOf("metacall(input, 0, (int)pasteMethodIndex, arguments)", check);
  const recheck = source.indexOf("memcmp(recipientStorage, savedRecipient.bytes, 24) == 0", paste);
  const send = source.indexOf("if (recipientUnchanged) {", recheck);
  const restore = source.indexOf("PMXRestorePasteboard(pasteboard, saved)", send);
  assert.ok(check > 0 && paste > check && recheck > paste && send > recheck && restore > send);
  const submit = source.slice(send, restore);
  assert.match(submit, /if \(PMXModelSendMethodIndex != UINT32_MAX\)/);
  assert.match(submit, /int action = 0;\s*void \*sendArguments\[\] = \{NULL, &action\};\s*metacall\(input, 0, \(int\)PMXModelSendMethodIndex, sendArguments\);/);
  assert.match(submit, /send\(view, 0\);/);
  assert.doesNotMatch(source.slice(check, restore), /(?:memcpy|memset)\(recipientStorage/);
});

test("model submit ABI follows the exact loaded build in both configuration routes", async () => {
  await exec("python3", ["-c", `
import runpy, sys, types
sys.modules['lldb'] = types.ModuleType('lldb')
module = runpy.run_path(sys.argv[1])
select = module['_select_wechat_build']
for uuid, entry, recipient, context in [
    ('CDB81058-0FAC-3518-95F5-C0CC7860F9B5', 0x87bc3c, 0x258, True),
    ('C6F8C0A6-BB7C-3DF1-B3AC-CAD6A1A1461F', 0x6f7abc, 0x2c0, False),
]:
    select(types.SimpleNamespace(GetUUIDString=lambda: uuid))
    assert select.__globals__['CHAT_INPUT_VIEW_SEND_OFFSET'] == entry
    assert select.__globals__['CHAT_INPUT_VIEW_RECIPIENT_OFFSET'] == recipient
    assert select.__globals__['CHAT_INPUT_VIEW_SEND_VIA_FIELD_SIGNAL'] == context

resolve = module['_send_method_index']
g = resolve.__globals__
# Old build retains the fixed handler without even looking up the signal.
assert resolve(None, None, None) == 0xffffffff
select(types.SimpleNamespace(GetUUIDString=lambda: 'CDB81058-0FAC-3518-95F5-C0CC7860F9B5'))
method = {'name':'send', 'argumentTypes':['SendActionType'], 'flags':6}
base = {'class':'QObject', 'methodCount':5, 'methods':[]}
field = {'class':'mmui::ChatInputField', 'methodCount':1, 'methods':[method]}
g['_qmetaobject_chain'] = lambda *args: [field, base]
assert resolve(None, None, None) == 5
for methods in [[], [method, method], [{**method, 'argumentTypes':['metatype:2']}], [{**method, 'flags':10}]]:
    field['methods'] = methods
    try:
        resolve(None, None, None)
        raise AssertionError('invalid signal accepted')
    except RuntimeError:
        pass
`, nativeTaskInjector]);
  const source = await readFile(nativeTaskInjector, "utf8");
  assert.equal(source.match(/send_method_index = _send_method_index\(process, frame, field\)/g)?.length, 2);
  assert.equal(source.match(/unsigned long long,unsigned long long,unsigned int,unsigned int\)\)/g)?.length, 2);
  const native = await readFile(nativePrimeInject, "utf8");
  assert.match(native, /uint32_t recipientOffset, uint32_t sendMethodIndex/);
  assert.match(native, /sendMethodIndex != UINT32_MAX && sendMethodIndex > 512/);
  assert.match(native, /PMXModelSendMethodIndex = sendMethodIndex/);
});

test("shared native paths follow the target's sandbox so a sandboxed WeChat can read them", async () => {
  const { weChatTemporaryDirectoryFor } = await import("./wechat-wire.mjs");
  assert.equal(
    weChatTemporaryDirectoryFor({ sandboxed: true, home: "/Users/me", fallback: "/var/folders/T" }),
    "/Users/me/Library/Containers/com.tencent.xinWeChat/Data/tmp",
  );
  assert.equal(
    weChatTemporaryDirectoryFor({ sandboxed: false, home: "/Users/me", fallback: "/var/folders/T" }),
    "/var/folders/T",
  );
  // A sandboxed target cannot read /tmp or the repository, so nothing the
  // wrapper shares with it may be hardcoded there.
  const prime = await readFile(nativePrimeInject, "utf8");
  assert.doesNotMatch(prime, /@?\"\/tmp\"/);
  assert.match(prime, /NSTemporaryDirectory\(\) stringByAppendingPathComponent/);
  const wire = await readFile(nativeTaskInjector.replace(/\.py$/, ".py"), "utf8");
  assert.ok(wire.length > 0);
  const driverSource = await readFile(new URL("./wechat-wire.mjs", import.meta.url).pathname, "utf8");
  assert.doesNotMatch(driverSource, /tmpdir\(\), `polymux-wechat-model-arm-/);
  assert.doesNotMatch(driverSource, /tmpdir\(\), `polymux-wechat-prime-status-model-/);
});

test("model attachments are staged inside the target's sandbox and cleaned up after", async () => {
  const source = await readFile(
    new URL("./wechat-wire.mjs", import.meta.url).pathname, "utf8");
  const stage = source.indexOf("async function stageModelAttachment");
  const helper = source.indexOf("async function nativePrimeLibrary", stage);
  assert.ok(stage > 0 && helper > stage);
  const body = source.slice(stage, helper);
  // The recipient must see the caller's file name, not a staging identifier.
  assert.match(body, /path\.basename\(filePath\)/);
  assert.match(body, /await weChatTemporaryDirectory\(\)/);
  assert.match(body, /await chmod\(stagedFile, 0o600\)/);
  assert.doesNotMatch(body, /randomBytes[\s\S]{0,80}\$\{path\.extname/);

  const send = source.indexOf("export async function sendComposerMessage");
  const end = source.indexOf("\n}\n", source.indexOf("transport: \"debugger\"", send));
  const sender = source.slice(send, end);
  assert.match(sender, /kind === "text" \? null : await stageModelAttachment\(filePath\)/);
  assert.match(sender, /\.\.\.\(kind === "text" \? \{ text \} : \{ path: attachment\.path \}\)/);
  assert.match(sender, /rm\(attachment\.staged, \{ force: true, recursive: true \}\)/);
});

test("a re-encoded outgoing video needs the exact sender id", async () => {
  const { sentMediaMessageId } = await import("./wechat-media-history.mjs");
  const bytes = Buffer.from("local video bytes");
  const base = {
    create_time: 200, server_id: "video-server-id", sender_wxid: "wxid_self",
    message_kind: "video", message_source: "<msgsource/>",
  };
  // WeChat re-encodes video, so md5 and length differ from the local file. A
  // lone new video is still not proof: the account's phone can sync one inside
  // the same window, so this stays unconfirmed.
  const reencoded = {...base, media: {md5: "e43aa6e6648d540d993c101732fe9386", length: 97030}};
  assert.equal(
    sentMediaMessageId([reencoded], {
      mediaType: "video", bytes, sinceEpoch: 190, selfWxid: "wxid_self",
      expectedName: "clip.mp4",
    }),
    undefined,
  );
  // The id the sender reported is the only thing that acknowledges it.
  assert.equal(
    sentMediaMessageId([
      reencoded,
      {...reencoded, server_id: "other"},
    ], {
      mediaType: "video", bytes, sinceEpoch: 190, selfWxid: "wxid_self",
      expectedName: "clip.mp4", expectedMessageId: "video-server-id",
    }),
    "video-server-id",
  );
  assert.equal(
    sentMediaMessageId([reencoded], {
      mediaType: "video", bytes, sinceEpoch: 190, selfWxid: "wxid_self",
      expectedName: "clip.mp4", expectedMessageId: "an-older-id",
    }),
    undefined,
  );
  // An exact byte match still wins and is unaffected.
  const exactBytes = Buffer.from("appended local bytes");
  assert.equal(
    sentMediaMessageId([
      {...base, server_id: "older", media: {md5: "0".repeat(32), length: 1}},
      {...base, create_time: 201, media: {md5: "5".repeat(32), length: 21}},
    ], {
      mediaType: "video", bytes: exactBytes, sinceEpoch: 190, selfWxid: "wxid_self",
      expectedName: "clip.mp4",
    }),
    undefined,
  );
});

test("wire-layer sends refuse a build whose offsets were never derived", async () => {
  const { assertWeChatWireProfile } = await import("./wechat-wire.mjs");
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wire-profile-"));
  const write = async (digest) => {
    const file = path.join(directory, `${digest.slice(0, 8)}.dylib`);
    // The gate hashes the whole file, so stub a body and use the real digests
    // through a controlled environment instead of faking a hash.
    await writeFile(file, `body:${digest}`);
    return file;
  };
  const previous = process.env.POLYMUX_WECHAT_DYLIB;
  const previousWire = process.env.POLYMUX_WECHAT_WIRE_NATIVE;
  const previousLldb = process.env.POLYMUX_WECHAT_LLDB_EXPERIMENTAL;
  process.env.POLYMUX_WECHAT_WIRE_NATIVE = "1";
  process.env.POLYMUX_WECHAT_LLDB_EXPERIMENTAL = "1";
  try {
    // 4.1.13 build 269602 has model profiles but no Mars task offsets.
    process.env.POLYMUX_WECHAT_DYLIB = await write(
      "6e82322680d7747020c305f67e932b235fe68b22578c24d9c524dabb31a4694a",
    );
    await assert.rejects(assertWeChatWireProfile(), /needs a Polymux update/);
    await assert.rejects(
      sendNativeTask({cgi: "/cgi-bin/x", commandId: 1, recipient: "filehelper",
        request: Buffer.from("x"), userId: "wxid_self"}),
      /needs a Polymux update/,
    );
  } finally {
    if (previous === undefined) delete process.env.POLYMUX_WECHAT_DYLIB;
    else process.env.POLYMUX_WECHAT_DYLIB = previous;
    if (previousWire === undefined) delete process.env.POLYMUX_WECHAT_WIRE_NATIVE;
    else process.env.POLYMUX_WECHAT_WIRE_NATIVE = previousWire;
    if (previousLldb === undefined) delete process.env.POLYMUX_WECHAT_LLDB_EXPERIMENTAL;
    else process.env.POLYMUX_WECHAT_LLDB_EXPERIMENTAL = previousLldb;
  }
  // The injector carries the same allowlist as a last line of defence.
  const injector = await readFile(nativeTaskInjector, "utf8");
  assert.match(injector, /_WIRE_TASK_BUILD_UUIDS = \{"C6F8C0A6-BB7C-3DF1-B3AC-CAD6A1A1461F"\}/);
  assert.match(injector, /def _require_wire_task_build\(target\)/);
  assert.match(injector, /_require_wire_task_build\(debugger\.GetSelectedTarget\(\)\)/);
});
