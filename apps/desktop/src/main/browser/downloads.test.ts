import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { availablePath, downloadKind } from "./downloads.js";

function directory(): string {
  return mkdtempSync(path.join(tmpdir(), "flareai-downloads-"));
}

test("a name already taken is stepped past rather than written through", () => {
  const folder = directory();
  try {
    const first = availablePath(folder, "report.pdf");
    assert.equal(first, path.join(folder, "report.pdf"));

    // Chromium's own "(1)" suffixing lives behind its save dialog and is not
    // reachable from setSavePath, so this is what stands between a second
    // download and the first one's bytes.
    writeFileSync(first, "first");
    const second = availablePath(folder, "report.pdf");
    assert.equal(second, path.join(folder, "report (1).pdf"));

    writeFileSync(second, "second");
    assert.equal(availablePath(folder, "report.pdf"), path.join(folder, "report (2).pdf"));

    // The original is still there — that is the whole point.
    assert.equal(second !== first, true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("the suffix goes before the extension, not after the name", () => {
  const folder = directory();
  try {
    writeFileSync(path.join(folder, "archive.tar.gz"), "x");
    // Only the final extension is one: "archive.tar" is the stem, which is
    // what keeps the result openable.
    assert.equal(
      availablePath(folder, "archive.tar.gz"),
      path.join(folder, "archive.tar (1).gz"),
    );

    writeFileSync(path.join(folder, "LICENSE"), "x");
    assert.equal(availablePath(folder, "LICENSE"), path.join(folder, "LICENSE (1)"));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a file is sorted by what it is, and anything unrecognised is just a file", () => {
  assert.equal(downloadKind("notes.pdf"), "pdf");
  assert.equal(downloadKind("photo.HEIC"), "image", "extensions match case-insensitively");
  assert.equal(downloadKind("budget.xlsx"), "spreadsheet");
  assert.equal(downloadKind("letter.docx"), "document");
  assert.equal(downloadKind("installer.dmg"), "file");
  assert.equal(downloadKind("no-extension"), "file");
});
