import assert from "node:assert/strict";
import test from "node:test";
import {
  phoneRuntimeFileNames,
  phoneToolsTarget,
  SCRCPY_RELEASE,
} from "./fetch-phone-tools.mjs";

test("maps each release target to a pinned official scrcpy archive", () => {
  assert.equal(SCRCPY_RELEASE, "4.1");
  assert.match(phoneToolsTarget("darwin", "arm64").archive, /macos-aarch64/);
  assert.match(phoneToolsTarget("darwin", "x64").archive, /macos-x86_64/);
  assert.match(phoneToolsTarget("linux", "x64").archive, /linux-x86_64/);
  assert.match(phoneToolsTarget("win32", "x64").archive, /win64/);
  assert.throws(() => phoneToolsTarget("linux", "arm64"), /No pinned Android phone runtime/);
});

test("keeps the complete minimal runtime for each desktop platform", () => {
  assert.deepEqual(
    phoneRuntimeFileNames(["LICENSE", "adb", "scrcpy", "scrcpy-server", "scrcpy.png"], "darwin"),
    ["adb", "scrcpy", "scrcpy-server", "LICENSE"],
  );
  assert.deepEqual(
    phoneRuntimeFileNames([
      "LICENSE.txt", "adb.exe", "scrcpy.exe", "scrcpy-server",
      "SDL3.dll", "AdbWinApi.dll", "scrcpy.png",
    ], "win32"),
    ["adb.exe", "scrcpy.exe", "scrcpy-server", "AdbWinApi.dll", "SDL3.dll", "LICENSE.txt"],
  );
  assert.throws(
    () => phoneRuntimeFileNames(["LICENSE", "adb", "scrcpy"], "linux"),
    /missing scrcpy-server/,
  );
});
