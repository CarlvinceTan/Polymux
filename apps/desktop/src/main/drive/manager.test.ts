import assert from "node:assert/strict";
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {Drive} from "./index.js";
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

test("gives each conversation its own folder under the output root", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    const first = await drive.conversationFolder("11111111-aaaa", "Q3 planning");
    const second = await drive.conversationFolder("22222222-bbbb", "Q3 planning");

    // Same title, different chats: the id is what keeps them apart, so one
    // chat's output never lands in another's folder.
    assert.notEqual(first, second);
    assert.equal(path.dirname(first), root);
    assert.ok(path.basename(first).startsWith("Q3 planning"));

    // Created on the way back, so the drive can open on a chat that has not
    // written anything yet.
    assert.ok((await readdir(root)).includes(path.basename(first)));

    // Asking twice is the common case — every tool call does it — and must
    // answer with the same folder rather than making a second one.
    assert.equal(await drive.conversationFolder("11111111-aaaa", "Q3 planning"), first);

    // A title with a separator in it must not write outside the root.
    const awkward = await drive.conversationFolder("33333333-cccc", "Reports/2024");
    assert.equal(path.dirname(awkward), root);
  } finally {
    await cleanup();
  }
});

test("offers the output folder and this Mac as separate sources", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    const status = await drive.status();
    const local = status.sources.filter((source) => source.provider === "local");

    assert.deepEqual(local.map((source) => source.id), [
      "local#outputs",
      "local#home",
    ]);
    // The two differ only in where they are rooted, which is the whole point:
    // one is confined to the output folder, the other reaches the home folder.
    assert.equal(local[0].root, root);
    assert.notEqual(local[1].root, root);
  } finally {
    await cleanup();
  }
});

test("names the storage a new file would go to", async () => {
  const {drive, cleanup} = await fixture();
  try {
    // Only the local disk can be connected without credentials, so it is what
    // the save order resolves to — and what the drive opens on. The output
    // folder specifically, not this Mac: a new file belongs where the agent
    // writes, not loose in the home directory.
    assert.equal(await drive.preferredSource(), "local#outputs");
  } finally {
    await cleanup();
  }
});
