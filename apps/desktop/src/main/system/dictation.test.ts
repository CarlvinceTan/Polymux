import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  DEFAULT_MODEL_REVISION,
  DEFAULT_MODEL_SHA256,
  dictationBinaryCandidates,
  dictationUnavailableMessage,
} from "./dictation.js";

test("Windows dictation prefers the packaged executable", () => {
  assert.deepEqual(
    dictationBinaryCandidates("whisper-cli", {
      binaryDirectory: path.join("fixtures", "whisper"),
      platform: "win32",
    }),
    [
      path.join("fixtures", "whisper", "whisper-cli.exe"),
      "whisper-cli.exe",
    ],
  );
});

test("macOS dictation retains Homebrew and PATH development fallbacks", () => {
  assert.deepEqual(
    dictationBinaryCandidates("whisper-server", {platform: "darwin"}),
    [
      "/opt/homebrew/bin/whisper-server",
      "/usr/local/bin/whisper-server",
      "whisper-server",
    ],
  );
});

test("a missing packaged engine recommends reinstalling on every release platform", () => {
  for (const platform of ["win32", "darwin", "linux"] as const) {
    const message = dictationUnavailableMessage(platform);
    assert.match(message, /dictation engine/);
    assert.match(message, /Reinstall Polymux/);
    assert.doesNotMatch(message, /brew|PATH|apt|dnf/i);
  }
});

test("the automatic model download is pinned by revision and sha256", () => {
  assert.match(DEFAULT_MODEL_REVISION, /^[a-f0-9]{40}$/);
  assert.match(DEFAULT_MODEL_SHA256, /^[a-f0-9]{64}$/);
});
