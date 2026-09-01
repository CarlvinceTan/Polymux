import assert from "node:assert/strict";
import test from "node:test";
import {
  cliOption,
  IOS_SIGNER_PROTOCOL_VERSION,
  IOS_SIGNER_REQUIREMENTS,
  iosSignerTarget,
} from "./build-phone-ios-signer.mjs";

test("preserves complete paths passed to the signer builder", () => {
  assert.equal(
    cliOption(["node", "script", "--zsign-directory=resources/phone/ios"], "zsign-directory"),
    "resources/phone/ios",
  );
});

test("maps each desktop release to a no-install iPhone signer", () => {
  assert.equal(iosSignerTarget("darwin", "arm64").pythonExecutable, "python/bin/python3");
  assert.equal(iosSignerTarget("darwin", "arm64").anisetteProvider, "system-aoskit");
  assert.equal(iosSignerTarget("win32", "x64").zsignExecutable, "zsign.exe");
  assert.equal(
    iosSignerTarget("win32", "x64").anisetteProvider,
    "portable-apple-libraries",
  );
  assert.equal(iosSignerTarget("linux", "x64").zsignSource, "zsign-musl");
  assert.throws(() => iosSignerTarget("linux", "arm64"), /No bundled iPhone signer/);
});

test("hash-locks the helper protocol and every dependency", () => {
  assert.equal(IOS_SIGNER_PROTOCOL_VERSION, 1);
  const lines = IOS_SIGNER_REQUIREMENTS.trim().split("\n");
  assert.equal(lines.length, 16);
  assert.ok(lines.every((line) => /==[^ ]+ .*--hash=sha256:[a-f0-9]{64}/u.test(line)));
  assert.match(IOS_SIGNER_REQUIREMENTS, /Anisette==1\.2\.4/);
  assert.doesNotMatch(IOS_SIGNER_REQUIREMENTS, /unicorn==/);
});
