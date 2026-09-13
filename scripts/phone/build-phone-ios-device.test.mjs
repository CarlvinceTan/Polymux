import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {
  IOS_DEVICE_PROTOCOL_VERSION,
  IOS_DEVICE_PYTHON_RELEASE,
  IOS_DEVICE_SOURCE_ARCHIVES,
  iosDeviceTarget,
  PYMOBILEDEVICE3_RELEASE,
  PYMOBILEDEVICE3_SOURCE_SHA256,
} from "./build-phone-ios-device.mjs";

test("maps each desktop release to a locked no-root iPhone tunnel runtime", () => {
  assert.match(iosDeviceTarget("darwin", "arm64").lock, /darwin-arm64/);
  assert.match(iosDeviceTarget("win32", "x64").lock, /win32-x64/);
  assert.match(iosDeviceTarget("linux", "x64").lock, /linux-x64/);
  assert.throws(() => iosDeviceTarget("linux", "arm64"), /No bundled iPhone device runtime/);
});

test("hash-locks pymobiledevice3 and every target dependency", async () => {
  assert.equal(IOS_DEVICE_PROTOCOL_VERSION, 1);
  assert.equal(PYMOBILEDEVICE3_RELEASE, "11.3.0");
  assert.match(IOS_DEVICE_PYTHON_RELEASE, /^3\.13\./u);
  assert.match(PYMOBILEDEVICE3_SOURCE_SHA256, /^[a-f0-9]{64}$/u);
  assert.equal(IOS_DEVICE_SOURCE_ARCHIVES.length, 14);
  assert.equal(new Set(IOS_DEVICE_SOURCE_ARCHIVES.map((source) => source.name)).size, 14);
  assert.ok(IOS_DEVICE_SOURCE_ARCHIVES.some((source) => source.name === "pmd-pytcp"));
  assert.ok(IOS_DEVICE_SOURCE_ARCHIVES.some((source) => source.name === "pygnuutils"));
  assert.ok(IOS_DEVICE_SOURCE_ARCHIVES.every((source) =>
    /^[a-f0-9]{64}$/u.test(source.sha256) && source.url.startsWith("https://files.pythonhosted.org/")));
  for (const target of [
    iosDeviceTarget("darwin", "arm64"),
    iosDeviceTarget("win32", "x64"),
    iosDeviceTarget("linux", "x64"),
  ]) {
    const lock = await readFile(new URL(target.lock, import.meta.url), "utf8");
    assert.match(lock, /^pymobiledevice3==11\.3\.0 /mu);
    const requirements = lock.split("\n").filter((line) => /^[a-zA-Z0-9_.-]+==/u.test(line));
    assert.ok(requirements.length >= 99);
    assert.ok(requirements.every((line) => line.endsWith(" \\")));
    assert.ok(lock.split("\n").filter((line) => line.trimStart().startsWith("--hash=")).length >= requirements.length);
    assert.doesNotMatch(lock, /^sslpsk-pmd3==/mu);
  }
});
