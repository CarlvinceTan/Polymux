import assert from "node:assert/strict";
import test from "node:test";
import {
  mobileRuntimeFileNames,
  mobileToolsTarget,
  SCRCPY_RELEASE,
} from "./fetch-mobile-tools.mjs";

test("maps each release target to a pinned official scrcpy archive", () => {
  assert.equal(SCRCPY_RELEASE, "4.1");
  assert.match(mobileToolsTarget("darwin", "arm64").archive, /macos-aarch64/);
  assert.match(mobileToolsTarget("darwin", "x64").archive, /macos-x86_64/);
  assert.match(mobileToolsTarget("linux", "x64").archive, /linux-x86_64/);
  assert.match(mobileToolsTarget("win32", "x64").archive, /win64/);
  assert.throws(() => mobileToolsTarget("linux", "arm64"), /No pinned Android mobile runtime/);
});

test("keeps the complete minimal runtime for each desktop platform", () => {
  assert.deepEqual(
    mobileRuntimeFileNames(["LICENSE", "adb", "scrcpy", "scrcpy-server", "scrcpy.png"], "darwin"),
    ["adb", "scrcpy", "scrcpy-server", "LICENSE"],
  );
  assert.deepEqual(
    mobileRuntimeFileNames([
      "LICENSE.txt", "adb.exe", "scrcpy.exe", "scrcpy-server",
      "SDL3.dll", "AdbWinApi.dll", "scrcpy.png",
    ], "win32"),
    ["adb.exe", "scrcpy.exe", "scrcpy-server", "AdbWinApi.dll", "SDL3.dll", "LICENSE.txt"],
  );
  assert.throws(
    () => mobileRuntimeFileNames(["LICENSE", "adb", "scrcpy"], "linux"),
    /missing scrcpy-server/,
  );
});
