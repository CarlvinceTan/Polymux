import assert from "node:assert/strict";
import {mkdtemp, writeFile} from "node:fs/promises";
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
