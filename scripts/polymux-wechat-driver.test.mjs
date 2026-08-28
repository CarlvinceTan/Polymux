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
  nativeCdnWarmupProfilePath,
  NATIVE_TASK_ROUTES,
  parseNativeUploadAppAttachResponse,
  parseNativeNewSendMessageResponse,
  parseNativeSendAppMessageResponse,
  parseNativeVideoResponse,
  sendTypedMessage,
  stickerMd5,
  WECHAT_NATIVE_PROFILE_SHA256,
} from "./wechat-wire.mjs";

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
const writerBuilder = new URL(
  "./build-wechat-writer.mjs",
  import.meta.url,
).pathname;
const exec = promisify(execFile);

async function invoke(request, helperSource, environment = {}) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "polymux-wechat-driver-"),
  );
  const helper = path.join(directory, "wechat-use");
  await writeFile(helper, helperSource, { mode: 0o700 });
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [driver, "write", "--json"], {
      env: {
        ...process.env,
        POLYMUX_WECHAT_CLI: helper,
        POLYMUX_WECHAT_TEST_ONLY_FILEHELPER: "1",
        ...environment,
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

test("sends verified text only to File Transfer in live-test mode", async () => {
  const result = await invoke(
    { kind: "text", chatId: "filehelper", body: "parity test" },
    '#!/bin/sh\nprintf \'%s\\n\' \'{"delivered_verified":true,"message_id":"42"}\'\n',
  );
  assert.equal(result.code, 0);
  assert.deepEqual(result.body, { deliveredVerified: true, messageId: "42" });
});

test("accepts the helper's nested verified-delivery diagnostic", async () => {
  const result = await invoke(
    { kind: "text", chatId: "filehelper", body: "parity test" },
    '#!/bin/sh\nprintf \'%s\\n\' \'{"ok":true,"sent":true,"diagnostic":{"delivered_verified":true,"message_id":"84"}}\'\n',
  );
  assert.equal(result.code, 0);
  assert.deepEqual(result.body, { deliveredVerified: true, messageId: "84" });
});

test("reads back WeChat's server message id when delivery omits it", async () => {
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
  assert.deepEqual(result.body, {
    deliveredVerified: true,
    messageId: "398437007617799014",
  });
});

test("uses the bridge's painted reply when native wire delivery is unavailable", async () => {
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
  assert.deepEqual(result.body, { deliveredVerified: true, messageId: "85" });
});

test("keeps mentions on a reply when the native writer is enabled", async () => {
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
  assert.deepEqual(result.body, { deliveredVerified: true, messageId: "86" });
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
    new URL("../packages/hub/src/wechat-native-profile.ts", import.meta.url),
    "utf8",
  );
  assert.match(profile, new RegExp(WECHAT_NATIVE_PROFILE_SHA256));
});

test("refuses typed sends before attach without the separate LLDB opt-in", async () => {
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
  assert.match(result.body.reason, /LLDB task sending is experimental/);
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

test("binds CDN warmup state to one WeChat process", async () => {
  const configured = process.env.POLYMUX_WECHAT_CDN_PROFILE;
  delete process.env.POLYMUX_WECHAT_CDN_PROFILE;
  try {
    assert.match(
      nativeCdnWarmupProfilePath(95_810),
      /polymux-wechat-cdn-profile-95810\.json$/,
    );
    assert.throws(() => nativeCdnWarmupProfilePath(0), /pid is invalid/);
  } finally {
    if (configured === undefined)
      delete process.env.POLYMUX_WECHAT_CDN_PROFILE;
    else process.env.POLYMUX_WECHAT_CDN_PROFILE = configured;
  }
  const source = await readFile(nativeCdnInjector, "utf8");
  assert.match(source, /recipient != "filehelper"/);
  assert.match(source, /callback_one = _allocate/);
  assert.match(source, /callback_two = _allocate/);
});

test("packages the CDN uploader and warmup entrypoint with the writer", async () => {
  const source = await readFile(writerBuilder, "utf8");
  assert.match(source, /"wechat_native_cdn_upload_lldb\.py"/);
  assert.match(source, /"polymux-wechat-cdn-warmup\.mjs"/);
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

test("recall uses the local id and waits for history confirmation", async () => {
  const source = await readFile(driver, "utf8");
  assert.match(source, /clientMessageId:\s*requireString\(String\(target\.local_id/);
  assert.match(source, /if \(!\(await waitForRecallHistory\(cli, chatId, messageId\)\)\)/);
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

test("verifies image delivery from history when the helper omits a flag", async () => {
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
  assert.deepEqual(result.body, {
    deliveredVerified: true,
    messageId: "2549984119094729143",
  });
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

test("verifies File Transfer is already read from WeChat's unread state", async () => {
  const result = await invoke(
    { kind: "read", chatId: "filehelper" },
    '#!/bin/sh\nprintf \'%s\\n\' \'{"rows":[{"username":"another-chat","unread_count":2}]}\'\n',
  );
  assert.deepEqual(result.body, { deliveredVerified: true });
});

test("refuses every non-File Transfer destination in live-test mode", async () => {
  const result = await invoke(
    { kind: "text", chatId: "someone-else", body: "must not send" },
    "#!/bin/sh\nexit 99\n",
  );
  assert.equal(result.code, 0);
  assert.match(result.body.reason, /restricted to filehelper/);
});

test("does not silently downgrade native-only operations", async () => {
  for (const request of [
    { kind: "media", chatId: "filehelper", mediaType: "audio", path: "/tmp/x" },
    { kind: "media", chatId: "filehelper", mediaType: "video", path: "/tmp/x" },
    { kind: "recall", chatId: "filehelper", messageId: "1" },
  ]) {
    const result = await invoke(request, "#!/bin/sh\nexit 99\n");
    assert.equal(result.code, 0);
    assert.match(result.body.reason, /exact-build wire sender/);
  }
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
