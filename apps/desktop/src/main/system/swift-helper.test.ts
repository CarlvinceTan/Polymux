import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {bundledSwiftHelperPath, SwiftHelper} from "./swift-helper.js";

test("packaged Swift helpers resolve beside their bundled source", () => {
  assert.equal(
    bundledSwiftHelperPath("calendar", path.join("resources", "native", "calendar.swift")),
    path.join("resources", "native", "bin", "calendar"),
  );
});

test("a bundled Swift helper avoids an end-user compiler dependency", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-swift-helper-"));
  try {
    const sourcePath = path.join(directory, "native", "contacts.swift");
    const binary = bundledSwiftHelperPath("contacts", sourcePath);
    await mkdir(path.dirname(binary), {recursive: true});
    await writeFile(sourcePath, "// source fallback");
    await writeFile(binary, "precompiled");
    const helper = new SwiftHelper({
      name: "contacts",
      sourcePath,
      cacheDirectory: path.join(directory, "cache"),
    });
    assert.equal(await helper.binary(), binary);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
