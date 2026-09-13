import {execFile} from "node:child_process";
import {promisify} from "node:util";
import test from "node:test";

test("capture cleanup releases its target after timeout or parent exit", async () => {
  await promisify(execFile)("python3", [
    new URL("./wxcdn_fileid_capture.test.py", import.meta.url).pathname,
  ], {timeout: 10_000});
});

test("real LLDB releases an owned disposable target and exits with stdin open", {
  skip: process.platform !== "darwin" || process.env.POLYMUX_TEST_LLDB !== "1",
}, async () => {
  await promisify(execFile)("python3", [
    new URL("./wxcdn_fileid_capture.integration.py", import.meta.url).pathname,
  ], {timeout: 25_000});
});
