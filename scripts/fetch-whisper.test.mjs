import assert from "node:assert/strict";
import test from "node:test";
import {
  WHISPER_ARCHIVES,
  WHISPER_RELEASE,
  WHISPER_SOURCE_SHA256,
  WINDOWS_RUNTIME_FILES,
  whisperTarget,
} from "./fetch-whisper.mjs";

test("the Windows runtime is pinned to the official x64 release archive", () => {
  const target = whisperTarget("win32", "x64");
  assert.equal(target.kind, "archive");
  assert.equal(target.archive, WHISPER_ARCHIVES["win32-x64"].name);
  assert.equal(target.sha256, WHISPER_ARCHIVES["win32-x64"].sha256);
  assert.match(target.url, /\/whisper-bin-x64\.zip$/);
  assert.ok(WINDOWS_RUNTIME_FILES.includes("whisper-cli.exe"));
  assert.ok(WINDOWS_RUNTIME_FILES.includes("whisper-server.exe"));
  assert.ok(WINDOWS_RUNTIME_FILES.includes("whisper.dll"));
  assert.ok(WINDOWS_RUNTIME_FILES.some((name) => name.startsWith("ggml-cpu-")));
});

test("Linux x64 and arm64 use their hash-pinned official archives", () => {
  for (const arch of ["x64", "arm64"]) {
    const target = whisperTarget("linux", arch);
    assert.equal(target.kind, "archive");
    assert.match(target.archive, new RegExp(`ubuntu-${arch}\\.tar\\.gz$`));
    assert.match(target.sha256, /^[a-f0-9]{64}$/);
    assert.match(target.url, new RegExp(`/${WHISPER_RELEASE}/`));
  }
});

test("macOS arm64 builds the hash-pinned source release", () => {
  const target = whisperTarget("darwin", "arm64");
  assert.equal(target.kind, "source");
  assert.equal(target.sha256, WHISPER_SOURCE_SHA256);
  assert.match(target.url, new RegExp(`/tags/${WHISPER_RELEASE}$`));
});

test("unsupported whisper.cpp package targets fail closed", () => {
  assert.throws(() => whisperTarget("win32", "arm64"), /No bundled/);
  assert.throws(() => whisperTarget("darwin", "x64"), /No bundled/);
});
