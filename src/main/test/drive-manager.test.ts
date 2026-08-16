import assert from "node:assert/strict";
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {Drive} from "../drive/index.js";
import type {JsonValue} from "@flareai/protocol";

/**
 * The manager wired to a real folder, exercising the same path the renderer
 * drives through IPC. The pickers stand in for the file dialogs, which is what
 * lets the upload flow be tested at all.
 */
async function fixture() {
  /** What the file picker will answer with. Mutable so a test can create the
   * file it is about to "choose" after the drive is already built. */
  const picked: string[] = [];
  const base = await mkdtemp(path.join(tmpdir(), "flareai-drive-mgr-"));
  const root = path.join(base, "drive");
  const preferences = new Map<string, JsonValue>([
    ["drive", {localRoot: root} as unknown as JsonValue],
  ]);
  const drive = new Drive({
    storage: {
      getPreference: (key) => {
        const value = preferences.get(key);
        return value === undefined ? undefined : {value};
      },
      setPreference: (key, value) => void preferences.set(key, value),
    },
    secrets: {
      read: async () => undefined,
      write: async () => {},
      clear: async () => {},
    },
    pickers: {
      folder: async () => null,
      files: async () => picked,
      downloads: () => base,
    },
    parent: () => undefined,
  });
  return {base, root, drive, picked, cleanup: () => rm(base, {recursive: true, force: true})};
}

test("creates a folder that then shows up in the listing", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    const created = await drive.createFolder("local", "", "Q3 numbers");
    assert.equal(created.kind, "folder");
    assert.equal(created.name, "Q3 numbers");

    // The listing is what the drive repaints from, so the folder existing on
    // disk is only half of it — it has to come back from `list` too.
    const entries = await drive.list("local", "");
    assert.deepEqual(entries.map((entry) => entry.name), ["Q3 numbers"]);
    assert.deepEqual(await readdir(root), ["Q3 numbers"]);

    // And nested, since the drive passes the folder's own path back in.
    await drive.createFolder("local", created.path, "Drafts");
    assert.deepEqual(
      (await drive.list("local", created.path)).map((entry) => entry.name),
      ["Drafts"],
    );
  } finally {
    await cleanup();
  }
});

test("reports a name that is already taken instead of failing silently", async () => {
  const {drive, cleanup} = await fixture();
  try {
    await drive.createFolder("local", "", "Reports");
    // The renderer turns this into the message shown above the list; a
    // rejection that never arrived would look like a button doing nothing.
    await assert.rejects(() => drive.createFolder("local", "", "Reports"));
  } finally {
    await cleanup();
  }
});

test("uploads the files the picker returns, into the folder in view", async () => {
  const {base, root, drive, picked, cleanup} = await fixture();
  try {
    const source = path.join(base, "notes.md");
    await writeFile(source, "hello");
    picked.push(source);
    const folder = await drive.createFolder("local", "", "Reports");

    // No paths passed: this is the toolbar's Upload, which opens the picker.
    const uploaded = await drive.upload("local", folder.path);
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].name, "notes.md");
    assert.equal(uploaded[0].size, 5);

    assert.deepEqual(
      (await drive.list("local", folder.path)).map((entry) => entry.name),
      ["notes.md"],
    );
    assert.equal(await readFile(path.join(root, "Reports", "notes.md"), "utf8"), "hello");
  } finally {
    await cleanup();
  }
});

test("uploads nothing when the picker is cancelled", async () => {
  const {drive, cleanup} = await fixture();
  try {
    // Cancelling is not a failure: it resolves empty rather than rejecting, so
    // the drive has nothing to report and nothing to repaint.
    assert.deepEqual(await drive.upload("local", ""), []);
    assert.deepEqual(await drive.list("local", ""), []);
  } finally {
    await cleanup();
  }
});

test("names the storage a new file would go to", async () => {
  const {drive, cleanup} = await fixture();
  try {
    // Only the local disk can be connected without credentials, so it is what
    // the save order resolves to — and what the drive opens on.
    assert.equal(await drive.preferredProvider(), "local");
  } finally {
    await cleanup();
  }
});
