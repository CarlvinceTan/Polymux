import assert from "node:assert/strict";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {LocalDrive} from "../drive/local.js";
import {copyName} from "../drive/types.js";

test("names a copy so it keeps opening in the same application", () => {
  assert.equal(copyName("Report.docx"), "Report copy.docx");
  // No extension to protect, so the suffix simply trails the name.
  assert.equal(copyName("Reports"), "Reports copy");
  // A leading dot is the whole name of a hidden file, not an extension.
  assert.equal(copyName(".gitignore"), ".gitignore copy");
  // Only the last dot separates the extension.
  assert.equal(copyName("archive.tar.gz"), "archive.tar copy.gz");
});

async function fixture(): Promise<{root: string; drive: LocalDrive; cleanup: () => Promise<void>}> {
  const base = await mkdtemp(path.join(tmpdir(), "flareai-drive-"));
  const root = path.join(base, "drive");
  await mkdir(root, {recursive: true});
  return {
    root,
    drive: new LocalDrive(root),
    cleanup: () => rm(base, {recursive: true, force: true}),
  };
}

test("browses a folder and reports what each entry is", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    await writeFile(path.join(root, "notes.md"), "hello");
    await mkdir(path.join(root, "Reports"));
    // Dotfiles are machinery rather than the user's documents.
    await writeFile(path.join(root, ".DS_Store"), "");

    const entries = await drive.list("");
    assert.deepEqual(
      entries.map((entry) => entry.name).sort(),
      ["Reports", "notes.md"],
    );
    const file = entries.find((entry) => entry.name === "notes.md")!;
    assert.equal(file.kind, "file");
    assert.equal(file.size, 5);
    assert.equal(file.provider, "local");
    // A folder reports no size rather than a misleading zero.
    assert.equal(entries.find((entry) => entry.name === "Reports")!.size, null);
  } finally {
    await cleanup();
  }
});

test("refuses to read or write outside the drive folder", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    const outside = path.join(root, "..", "secret.txt");
    await writeFile(outside, "not yours");

    await assert.rejects(() => drive.list("../"), /outside the drive folder/);
    await assert.rejects(
      () => drive.remove(outside),
      /outside the drive folder/,
    );
    await assert.rejects(
      () => drive.createFolder("..", "escaped"),
      /outside the drive folder/,
    );
    // The guard must not have deleted what it refused to touch.
    assert.equal(await readFile(outside, "utf8"), "not yours");
  } finally {
    await cleanup();
  }
});

test("does not mistake a sibling folder with a shared prefix for a child", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    // `<root>-old` starts with the root's own path as a string, but is not
    // inside it — the separator is what tells the two apart.
    const sibling = `${root}-old`;
    await mkdir(sibling, {recursive: true});
    await assert.rejects(() => drive.list(sibling), /outside the drive folder/);
  } finally {
    await cleanup();
  }
});

test("creates, renames and deletes inside the folder", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    const folder = await drive.createFolder("", "Reports");
    assert.equal(folder.kind, "folder");
    assert.equal(folder.path, path.join(root, "Reports"));

    const renamed = await drive.rename(folder.path, "Archive");
    assert.equal(renamed.name, "Archive");
    assert.deepEqual((await drive.list("")).map((entry) => entry.name), ["Archive"]);

    await drive.remove(renamed.path);
    assert.deepEqual(await drive.list(""), []);
  } finally {
    await cleanup();
  }
});

test("moves an entry into another folder, keeping its name", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    await writeFile(path.join(root, "notes.md"), "hello");
    const folder = await drive.createFolder("", "Reports");

    const moved = await drive.move(path.join(root, "notes.md"), folder.path);
    assert.equal(moved.name, "notes.md");
    assert.equal(moved.path, path.join(root, "Reports", "notes.md"));
    // Gone from where it was, present where it went.
    assert.deepEqual((await drive.list("")).map((entry) => entry.name), ["Reports"]);
    assert.deepEqual(
      (await drive.list(folder.path)).map((entry) => entry.name),
      ["notes.md"],
    );
  } finally {
    await cleanup();
  }
});

test("refuses to move an entry out of the drive folder", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    await writeFile(path.join(root, "notes.md"), "hello");
    await assert.rejects(
      () => drive.move(path.join(root, "notes.md"), ".."),
      /outside the drive folder/,
    );
  } finally {
    await cleanup();
  }
});

test("duplicates a file beside itself, suffixing before the extension", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    await writeFile(path.join(root, "Report.docx"), "body");

    const copy = await drive.copy(path.join(root, "Report.docx"));
    // The suffix goes before the extension so the copy still opens in the
    // same application as the original.
    assert.equal(copy.name, "Report copy.docx");
    assert.equal(await readFile(copy.path, "utf8"), "body");
    // The original is untouched.
    assert.equal(await readFile(path.join(root, "Report.docx"), "utf8"), "body");
  } finally {
    await cleanup();
  }
});

test("duplicates a folder with everything inside it", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    await mkdir(path.join(root, "Reports"));
    await writeFile(path.join(root, "Reports", "q3.md"), "numbers");

    const copy = await drive.copy(path.join(root, "Reports"));
    assert.equal(copy.name, "Reports copy");
    assert.equal(copy.kind, "folder");
    assert.deepEqual(
      (await drive.list(copy.path)).map((entry) => entry.name),
      ["q3.md"],
    );
  } finally {
    await cleanup();
  }
});

test("creates the folder it is pointed at and reports the volume's space", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    const missing = path.join(root, "nested", "drive");
    drive.setRoot(missing);
    const probe = await drive.probe();
    assert.equal(probe.state, "connected");
    assert.equal(probe.root, missing);
    assert.ok((probe.usage?.total ?? 0) > 0);
    // Local storage cannot be logged out, so it always has an account.
    assert.equal(probe.accounts.length, 1);
  } finally {
    await cleanup();
  }
});
