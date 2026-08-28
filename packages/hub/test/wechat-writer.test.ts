import assert from "node:assert/strict";
import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {ProcessWeChatWriter} from "../src/wechat-writer.js";

async function helper(response: object): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-writer-test-"));
  const executable = path.join(directory, "driver");
  await writeFile(
    executable,
    `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '${JSON.stringify(response)}'\n`,
    {mode: 0o700},
  );
  return executable;
}

test("preserves a driver's verified message id", async () => {
  const writer = new ProcessWeChatWriter(
    await helper({deliveredVerified: true, messageId: "remote-42"}),
  );
  assert.deepEqual(
    await writer.write({kind: "text", chatId: "filehelper", body: "test"}),
    {deliveredVerified: true, messageId: "remote-42"},
  );
});

test("preserves an operational refusal instead of claiming a process crash", async () => {
  const writer = new ProcessWeChatWriter(
    await helper({deliveredVerified: false, reason: "native reply is unavailable"}),
  );
  assert.deepEqual(
    await writer.write({kind: "read", chatId: "filehelper"}),
    {deliveredVerified: false, reason: "native reply is unavailable"},
  );
});

test("runs a bundled script through its interpreter and private environment", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-writer-runtime-"));
  const executable = path.join(directory, "runtime");
  await writeFile(
    executable,
    `#!/bin/sh
test "$1" = "/bundled/writer.mjs" || exit 3
test "$2" = "write" || exit 4
test "$POLYMUX_WECHAT_WIRE_NATIVE" = "1" || exit 5
cat >/dev/null
printf '%s\n' '{"deliveredVerified":true}'
`,
    {mode: 0o700},
  );
  const writer = new ProcessWeChatWriter(executable, {
    prefixArgs: ["/bundled/writer.mjs"],
    environment: {...process.env, POLYMUX_WECHAT_WIRE_NATIVE: "1"},
  });
  assert.deepEqual(
    await writer.write({kind: "read", chatId: "filehelper"}),
    {deliveredVerified: true},
  );
});

test("gives a timed-out driver a cleanup window before forcing it closed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-writer-cleanup-"));
  const executable = path.join(directory, "driver");
  const marker = path.join(directory, "cleaned");
  await writeFile(
    executable,
    `#!/bin/sh
trap 'printf cleaned > "$POLYMUX_CLEANUP_MARKER"; exit 0' TERM
cat >/dev/null
while :; do sleep 0.05; done
`,
    {mode: 0o700},
  );
  const writer = new ProcessWeChatWriter(executable, {
    environment: {...process.env, POLYMUX_CLEANUP_MARKER: marker},
    timeoutMs: 500,
  });
  await assert.rejects(
    writer.write({kind: "read", chatId: "filehelper"}),
    /timed out after 500ms/,
  );
  assert.equal(await readFile(marker, "utf8"), "cleaned");
});
