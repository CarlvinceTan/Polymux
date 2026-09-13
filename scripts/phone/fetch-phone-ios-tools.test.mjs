import assert from "node:assert/strict";
import test from "node:test";
import {GO_IOS_RELEASE, goIosTarget} from "./fetch-phone-ios-tools.mjs";

test("maps every desktop release target to a pinned go-ios executable", () => {
  assert.equal(GO_IOS_RELEASE, "1.3.2");
  assert.equal(goIosTarget("darwin", "arm64").executable, "ios");
  assert.match(goIosTarget("darwin", "x64").source, /darwin-amd64/);
  assert.match(goIosTarget("linux", "arm64").source, /linux-arm64/);
  assert.match(goIosTarget("linux", "x64").source, /linux-amd64/);
  assert.equal(goIosTarget("win32", "x64").executable, "ios.exe");
  assert.throws(() => goIosTarget("win32", "arm64"), /No pinned iOS phone runtime/);
});

test("pins each platform binary with a sha256 digest", () => {
  for (const [platform, arch] of [["darwin", "arm64"], ["linux", "x64"], ["win32", "x64"]])
    assert.match(goIosTarget(platform, arch).sha256, /^[a-f0-9]{64}$/);
});
