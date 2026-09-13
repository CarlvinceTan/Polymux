import assert from "node:assert/strict";
import test from "node:test";
import {tagCommit, verifyResolvedTag} from "./verify-bridge-pins.mjs";

test("an annotated release tag resolves to its peeled source commit", () => {
  const output = [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v1.0.0",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v1.0.0^{}",
  ].join("\n");

  assert.equal(
    tagCommit(output, "v1.0.0"),
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
});

test("a lightweight release tag resolves directly to its source commit", () => {
  const output =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v1.0.0\n";

  assert.equal(
    tagCommit(output, "v1.0.0"),
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
});

test("a release pin fails when its tag points at another commit", () => {
  assert.throws(
    () =>
      verifyResolvedTag(
        {
          binary: "mautrix-example",
          repo: "example",
          tag: "v1.0.0",
          commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v1.0.0\n",
      ),
    /pins a{40}.*resolves to b{40}/,
  );
});
