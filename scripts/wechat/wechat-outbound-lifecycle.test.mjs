import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import test from "node:test";

const run = promisify(execFile);
for (const mode of ["cancel", "timeout", "service-cancel", "send", "send-unconfirmed", "sticker-unconfirmed", "recall", "detach-retry", "detach-blocked", "detach-unconfirmed", "detach-state-unknown", "detach-still-stopped", "ready-unconfirmed", "ready-resident", "cached-media-file", "cached-media-video", "cached-media-missing"]) {
  test(`outbound ${mode} follows its production lifecycle with fixture processes`, async () => {
    const {stdout} = await run(process.execPath, ["--experimental-vm-modules",
      new URL("./test-fixtures/outbound-lifecycle.mjs", import.meta.url).pathname, mode],
    {timeout: 20_000});
    const result = JSON.parse(stdout);
    assert.equal(result.mode, mode);
    assert.equal(result.cleanDetach ?? result.destinationShardVerified ?? result.recoverySafe ?? result.ownRegistryOnly, true);
  });
}
