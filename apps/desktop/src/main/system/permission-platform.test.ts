import assert from "node:assert/strict";
import test from "node:test";
import type {BuiltInPermissionKind} from "@polymux/protocol";
import {
  builtInPermissionRequestsUser,
  resolvedMediaPermissionStatus,
} from "./permission-platform.js";

const kinds: BuiltInPermissionKind[] = [
  "microphone",
  "screen-recording",
  "accessibility",
  "full-disk-access",
];

test("macOS asks for every built-in capability", () => {
  assert.deepEqual(
    kinds.filter((kind) => builtInPermissionRequestsUser(kind, "darwin")),
    kinds,
  );
});

test("Windows asks only for its microphone privacy control", () => {
  assert.deepEqual(
    kinds.filter((kind) => builtInPermissionRequestsUser(kind, "win32")),
    ["microphone"],
  );
});

test("Linux asks for microphone access and its screen-cast portal", () => {
  assert.deepEqual(
    kinds.filter((kind) => builtInPermissionRequestsUser(kind, "linux")),
    ["microphone", "screen-recording"],
  );
});

test("unknown platforms do not invent permission dialogs", () => {
  assert.deepEqual(
    kinds.filter((kind) => builtInPermissionRequestsUser(kind, "freebsd")),
    [],
  );
});

test("a real media answer wins over a coarse Windows privacy status", () => {
  assert.equal(resolvedMediaPermissionStatus("granted", "denied"), "denied");
  assert.equal(resolvedMediaPermissionStatus("unknown", "granted"), "granted");
  assert.equal(resolvedMediaPermissionStatus("restricted", "unknown"), "restricted");
});
