import assert from "node:assert/strict";
import {mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import test from "node:test";

const driver = new URL("./polymux-wechat-driver.mjs", import.meta.url).pathname;

async function invoke(request, helperSource) {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-driver-"));
  const helper = path.join(directory, "wechat-use");
  await writeFile(helper, helperSource, {mode: 0o700});
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [driver, "write", "--json"], {
      env: {
        ...process.env,
        POLYMUX_WECHAT_CLI: helper,
        POLYMUX_WECHAT_TEST_ONLY_FILEHELPER: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({code, body: JSON.parse(Buffer.concat(stdout).toString("utf8"))}),
    );
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

test("sends verified text only to File Transfer in live-test mode", async () => {
  const result = await invoke(
    {kind: "text", chatId: "filehelper", body: "parity test"},
    "#!/bin/sh\nprintf '%s\\n' '{\"delivered_verified\":true,\"message_id\":\"42\"}'\n",
  );
  assert.equal(result.code, 0);
  assert.deepEqual(result.body, {deliveredVerified: true, messageId: "42"});
});

test("accepts the helper's nested verified-delivery diagnostic", async () => {
  const result = await invoke(
    {kind: "text", chatId: "filehelper", body: "parity test"},
    "#!/bin/sh\nprintf '%s\\n' '{\"ok\":true,\"sent\":true,\"diagnostic\":{\"delivered_verified\":true,\"message_id\":\"84\"}}'\n",
  );
  assert.equal(result.code, 0);
  assert.deepEqual(result.body, {deliveredVerified: true, messageId: "84"});
});

test("reads back WeChat's server message id when delivery omits it", async () => {
  const result = await invoke(
    {kind: "text", chatId: "filehelper", body: "parity test"},
    `#!/bin/sh
if [ "$1" = "history" ]; then
  printf '%s\\n' '{"rows":[{"server_id":398437007617799014,"real_sender_id":"2","message_kind":"text","display_text":"parity test"}]}'
else
  printf '%s\\n' '{"ok":true,"diagnostic":{"delivered_verified":true}}'
fi
`,
  );
  assert.equal(result.code, 0);
  assert.deepEqual(result.body, {
    deliveredVerified: true,
    messageId: "398437007617799014",
  });
});

test("sends a reply with exact quoted history context", async () => {
  const result = await invoke(
    {kind: "text", chatId: "filehelper", body: "answer", replyTo: "9007199254740993"},
    `#!/bin/sh
if [ "$1" = "history" ]; then
  printf '%s\\n' '{"rows":[{"server_id":9007199254740993,"sender_name":"File Transfer","display_text":"original"}]}'
else
  case "$2" in
    *"File Transfer: original"*) printf '%s\\n' '{"delivered_verified":true,"message_id":"7"}' ;;
    *) printf '%s\\n' '{"error":"missing quote"}' ;;
  esac
fi
`,
  );
  assert.deepEqual(result.body, {deliveredVerified: true, messageId: "7"});
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
  );
  assert.deepEqual(result.body, {
    deliveredVerified: true,
    messageId: "2549984119094729143",
  });
});

test("preserves a sticker through the verified image fallback", async () => {
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
    `#!/bin/sh
if [ "$1" = "history" ]; then
  printf '%s\\n' '{"rows":[{"server_id":99,"real_sender_id":"2","message_kind":"image","media":{"length":9}}]}'
else
  printf '%s\\n' '{"ok":true}'
fi
`,
  );
  assert.deepEqual(result.body, {deliveredVerified: true, messageId: "99"});
});

test("verifies File Transfer is already read from WeChat's unread state", async () => {
  const result = await invoke(
    {kind: "read", chatId: "filehelper"},
    "#!/bin/sh\nprintf '%s\\n' '{\"rows\":[{\"username\":\"another-chat\",\"unread_count\":2}]}'\n",
  );
  assert.deepEqual(result.body, {deliveredVerified: true});
});

test("refuses every non-File Transfer destination in live-test mode", async () => {
  const result = await invoke(
    {kind: "text", chatId: "someone-else", body: "must not send"},
    "#!/bin/sh\nexit 99\n",
  );
  assert.equal(result.code, 0);
  assert.match(result.body.reason, /restricted to filehelper/);
});

test("does not silently downgrade native-only operations", async () => {
  for (const request of [
    {kind: "media", chatId: "filehelper", mediaType: "audio", path: "/tmp/x"},
    {kind: "media", chatId: "filehelper", mediaType: "file", path: "/tmp/x"},
    {kind: "media", chatId: "filehelper", mediaType: "video", path: "/tmp/x"},
    {kind: "recall", chatId: "filehelper", messageId: "1"},
  ]) {
    const result = await invoke(request, "#!/bin/sh\nexit 99\n");
    assert.equal(result.code, 0);
    assert.match(result.body.reason, /not implemented yet/);
  }
});
