import assert from "node:assert/strict";
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {Drive, createDriveTools} from "../src/index.js";
import {DRIVE_LOCAL_HOME, type JsonValue} from "@flareai/protocol";
import type {AgentToolContext} from "@flareai/core";

/** The call context a tool is handed by the runtime. Nothing in the drive tools
 * reads it, so the fields exist only to satisfy the signature. */
const callContext = {
  runId: "test-run",
  turn: 0,
  callId: "test",
  signal: new AbortController().signal,
  emitProgress: async () => {},
} satisfies AgentToolContext;

/** `content` is a string or a block list; assert messages take a string. */
const say = (result: {content: unknown}) => JSON.stringify(result.content);

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
    consent: {
      open: async () => {
        throw new Error("These tests never reach a consent window.");
      },
    },
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

test("steps a taken folder name aside rather than failing on it", async () => {
  const {drive, cleanup} = await fixture();
  try {
    await drive.createFolder("local", "", "Reports");
    // New Folder suggests the same name every time, so the second one must
    // land beside the first rather than reading as a button doing nothing.
    const second = await drive.createFolder("local", "", "Reports");
    assert.equal(second.name, "Reports 1");
    const third = await drive.createFolder("local", "", "Reports");
    assert.equal(third.name, "Reports 2");
    assert.deepEqual(
      (await drive.list("local", "")).map((entry) => entry.name).sort(),
      ["Reports", "Reports 1", "Reports 2"],
    );
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

test("a dropped folder arrives as the tree it stands for", async () => {
  const {base, root, drive, cleanup} = await fixture();
  try {
    // No provider takes a directory as an upload, so dragging one in has to
    // become a folder plus everything under it — nested included.
    const source = path.join(base, "Trip");
    await mkdir(path.join(source, "photos"), {recursive: true});
    await writeFile(path.join(source, "plan.md"), "day one");
    await writeFile(path.join(source, "photos", "beach.txt"), "sand");

    const uploaded = await drive.upload("local", "", [source]);
    // One row for the drop, which is the folder the user sees appear.
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].kind, "folder");
    assert.equal(uploaded[0].name, "Trip");

    assert.deepEqual((await readdir(path.join(root, "Trip"))).sort(), ["photos", "plan.md"]);
    assert.equal(
      await readFile(path.join(root, "Trip", "photos", "beach.txt"), "utf8"),
      "sand",
    );
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

test("output goes in one FlareAI folder, not one per chat", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    const folder = await drive.outputFolder();
    // The output root itself: a user looking for something they made last week
    // should not have to remember which chat made it.
    assert.equal(folder, root);
    assert.equal(await drive.outputFolder(), folder);

    // Created on the way back, so the drive can open before anything has been
    // written to it.
    assert.ok((await stat(folder)).isDirectory());
    // And nothing else is made alongside it.
    assert.deepEqual(await readdir(root), []);
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

test("the virtual drive gathers FlareAI's folders, not the whole home directory", async () => {
  const {drive, cleanup} = await fixture();
  try {
    const created = await drive.createFolder("all", "", "New folder");
    const entries = await drive.list("all", "");

    // The home source is every folder in `~`. It exists so the agent can reach
    // files that were never FlareAI's, but the virtual drive is the opposite
    // idea — FlareAI's own folder in each place — and listing home here buried
    // a folder the user had just made among their entire home directory.
    assert.equal(
      entries.filter((entry) => entry.path.startsWith(`local#${DRIVE_LOCAL_HOME}/`)).length,
      0,
      "the unconfined home source has no place in the virtual root",
    );

    // What the user just made is right there, and findable.
    const found = entries.find((entry) => entry.name === "New folder");
    assert.ok(found, "a folder created at the root is listed at the root");
    assert.equal(found!.path, created.path);
    assert.equal(entries.length, 1, "and is not lost among unrelated folders");
  } finally {
    await cleanup();
  }
});

test("home is still reachable on its own, just not through the virtual drive", async () => {
  const {drive, cleanup} = await fixture();
  try {
    // Excluding it from the union must not disconnect it: the agent still
    // lists it directly, which is the whole reason the source exists.
    const listed = await drive.list(`local#${DRIVE_LOCAL_HOME}`, "");
    assert.ok(Array.isArray(listed), "the home source still answers");
  } finally {
    await cleanup();
  }
});

test("several network shares connect at once, each its own place", async () => {
  const {base, drive, cleanup} = await fixture();
  try {
    const studio = path.join(base, "Volumes", "Studio");
    const archive = path.join(base, "Volumes", "Archive");
    await mkdir(studio, {recursive: true});
    await mkdir(archive, {recursive: true});

    await drive.addShare(studio, "Studio");
    const status = await drive.addShare(archive, "Archive");

    const shares = status.sources.filter((source) => source.provider === "network");
    // Named the way an account is: the provider labels the row, the share
    // labels the account — the same shape as "Google Drive / someone@ex.com".
    assert.deepEqual(shares.map((source) => source.accountLabel).sort(), ["Archive", "Studio"]);
    assert.deepEqual(
      [...new Set(shares.map((source) => source.state))],
      ["connected"],
      "a mounted share is connected",
    );

    // Each is a real, separate place: a folder made in one is not in the other.
    const made = await drive.createFolder(shares[0]!.id, "", "Reports");
    assert.equal(made.name, "Reports");
    const other = shares.find((source) => source.id !== shares[0]!.id)!;
    assert.deepEqual(await drive.list(other.id, ""), []);
  } finally {
    await cleanup();
  }
});

test("an unmounted share still lists, so it can be reconnected", async () => {
  const {base, drive, cleanup} = await fixture();
  try {
    const studio = path.join(base, "Volumes", "Studio");
    await mkdir(studio, {recursive: true});
    await drive.addShare(studio, "Studio");

    // Ejected. The share must not vanish from Settings — the user needs a row
    // to see why it is unavailable and to remove it if they are done with it.
    await rm(studio, {recursive: true, force: true});
    const status = await drive.refresh();
    const share = status.sources.find((source) => source.provider === "network");
    assert.ok(share, "the share is still listed");
    assert.equal(share!.state, "logged-out", "and reports itself as not attached");
  } finally {
    await cleanup();
  }
});

test("shares join the virtual drive, and leave it when removed", async () => {
  const {base, drive, cleanup} = await fixture();
  try {
    const studio = path.join(base, "Volumes", "Studio");
    await mkdir(studio, {recursive: true});
    await drive.addShare(studio, "Studio");
    await drive.createFolder(`network#${studio}`, "", "From the share");

    const root = await drive.list("all", "");
    const fromShare = root.find((entry) => entry.name === "From the share");
    assert.ok(fromShare, "a share's folder shows up in the virtual drive");
    assert.equal(fromShare!.provider, "network", "and is badged as network");

    await drive.removeShare(studio);
    assert.equal(
      (await drive.list("all", "")).some((entry) => entry.name === "From the share"),
      false,
      "removing the share takes it out of the union",
    );
  } finally {
    await cleanup();
  }
});

test("a file reached through the virtual drive can be described and fetched", async () => {
  const {drive, cleanup} = await fixture();
  try {
    // What "open it" leans on when a file has no page to send the user to: the
    // handler describes the entry to find out whether it is on a volume, and
    // downloads it when it is not. Both have to work through a union path,
    // which carries a source prefix the adapters know nothing about.
    const folder = await drive.createFolder("all", "", "Reports");
    const root = await drive.list("all", "");
    const made = root.find((entry) => entry.name === "Reports");
    assert.ok(made, "the folder is in the union");

    const described = await drive.describe("all", made!.path);
    assert.equal(described.name, "Reports");
    assert.equal(described.path, folder.path, "describe round-trips the union path");
  } finally {
    await cleanup();
  }
});

test("a deliverable with no named source follows the save order", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    const [write] = createDriveTools(drive).filter(
      (tool) => tool.name === "drive_write",
    );
    // The point of the default: `source` is not required, so the tool call the
    // model makes for an ordinary deliverable carries no destination at all.
    assert.ok(write);
    assert.deepEqual(write.parameters.required, ["name", "content"]);

    const result = await write.execute({
      name: "report.md",
      content: "# Q3\n",
    }, callContext);
    assert.ok(!result.isError, say(result));

    // Nothing cloud is connected here, so the order falls through to the local
    // output folder — the one source that cannot be logged out of.
    assert.deepEqual(await readdir(root), ["report.md"]);
    assert.equal(await readFile(path.join(root, "report.md"), "utf8"), "# Q3\n");
  } finally {
    await cleanup();
  }
});

test("a named source still wins over the save order", async () => {
  const {base, root, drive, cleanup} = await fixture();
  try {
    const [write] = createDriveTools(drive).filter(
      (tool) => tool.name === "drive_write",
    );
    const home = path.join(base, "home-target");
    await mkdir(home, {recursive: true});
    await drive.addShare(home, "Target");
    const share = (await drive.status()).sources.find(
      (source) => source.provider === "network",
    );
    assert.ok(share);

    const result = await write.execute({
      source: share.id,
      name: "invoice.txt",
      content: "paid",
    }, callContext);
    assert.ok(!result.isError, say(result));
    assert.deepEqual(await readdir(home), ["invoice.txt"]);
    // And the default destination was left alone.
    assert.deepEqual(await readdir(root), []);
  } finally {
    await cleanup();
  }
});

test("the prompt context names the default destination and the cloud boundary", async () => {
  const {base, drive, cleanup} = await fixture();
  try {
    const share = path.join(base, "share");
    await mkdir(share, {recursive: true});
    await drive.addShare(share, "Studio");
    await drive.status();

    const context = drive.promptContext();
    assert.equal(context.defaultSource, "all#all");
    // The order is what the user set in Settings, not this package's opinion.
    assert.equal(context.order[0], "This Mac");
    assert.ok(context.connected.some((entry) => entry.includes("network#")));
    assert.ok(context.reach.some((entry) => entry.includes("mounted")));
  } finally {
    await cleanup();
  }
});

test("two runs saving the same name are ordered rather than lost", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    const [write] = createDriveTools(drive).filter(
      (tool) => tool.name === "drive_write",
    );
    assert.ok(write);
    // Both aim at one path. Without the per-path lock the two uploads
    // interleave and one deliverable is silently replaced mid-write; with it
    // the later one wins whole, which is what create-or-replace means.
    await Promise.all([
      write.execute({source: "local", name: "report.md", content: "first"}, callContext),
      write.execute({source: "local", name: "report.md", content: "second"}, callContext),
    ]);
    const saved = await readFile(path.join(root, "report.md"), "utf8");
    assert.ok(["first", "second"].includes(saved), `unexpected: ${saved}`);
  } finally {
    await cleanup();
  }
});

// Parallel chats writing different files is the ordinary case — two drafts, a
// report and its data — and must stay parallel. The lock is keyed by
// destination path for exactly this reason.
test("two runs saving different names do not wait on each other", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    const [write] = createDriveTools(drive).filter(
      (tool) => tool.name === "drive_write",
    );
    assert.ok(write);
    const results = await Promise.all([
      write.execute({source: "local", name: "draft-a.md", content: "a"}, callContext),
      write.execute({source: "local", name: "draft-b.md", content: "b"}, callContext),
    ]);
    for (const result of results) assert.match(say(result), /saved/);
    assert.equal(await readFile(path.join(root, "draft-a.md"), "utf8"), "a");
    assert.equal(await readFile(path.join(root, "draft-b.md"), "utf8"), "b");
  } finally {
    await cleanup();
  }
});

// The failure the write lock cannot reach: both runs read the same file, then
// both write. Ordering them keeps the file whole and still loses an edit, so
// the second write has to be refused rather than applied.
test("a write is refused when the file changed after it was read", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    const tools = createDriveTools(drive);
    const [write] = tools.filter((tool) => tool.name === "drive_write");
    const [read] = tools.filter((tool) => tool.name === "drive_read");
    assert.ok(write && read);

    await write.execute(
      {source: "local", name: "report.md", content: "base\n"},
      callContext,
    );
    // The run reads it, which is what establishes what it is about to replace.
    const seen = await read.execute(
      {source: "local", path: path.join(root, "report.md")},
      callContext,
    );
    assert.equal(say(seen).includes("base"), true);

    // Somebody else writes in between — another chat, or the user in the
    // provider's own web page. mtime granularity is coarse enough that an
    // immediate rewrite can land in the same millisecond, so the size differs.
    await writeFile(path.join(root, "report.md"), "theirs, longer\n");

    const result = await write.execute(
      {source: "local", name: "report.md", content: "mine\n"},
      callContext,
    );
    assert.equal(result.isError, true, say(result));
    assert.match(say(result), /changed by someone else/);
    // Refused means refused: their edit is still there.
    assert.equal(
      await readFile(path.join(root, "report.md"), "utf8"),
      "theirs, longer\n",
    );

    // And the expectation was dropped, so re-reading and writing again works
    // rather than failing forever on a token that is already stale.
    await read.execute(
      {source: "local", path: path.join(root, "report.md")},
      callContext,
    );
    const retry = await write.execute(
      {source: "local", name: "report.md", content: "merged\n"},
      callContext,
    );
    assert.ok(!retry.isError, say(retry));
    assert.equal(await readFile(path.join(root, "report.md"), "utf8"), "merged\n");
  } finally {
    await cleanup();
  }
});

test("a file the run never read is written without a condition", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    const [write] = createDriveTools(drive).filter(
      (tool) => tool.name === "drive_write",
    );
    assert.ok(write);
    // Something already at that name, never read by this run: replacing it is
    // an ordinary save and must not be second-guessed.
    await mkdir(root, {recursive: true});
    await writeFile(path.join(root, "notes.md"), "older\n");
    const result = await write.execute(
      {source: "local", name: "notes.md", content: "newer\n"},
      callContext,
    );
    assert.ok(!result.isError, say(result));
    assert.equal(await readFile(path.join(root, "notes.md"), "utf8"), "newer\n");
  } finally {
    await cleanup();
  }
});

test("a run writing the same file twice does not conflict with itself", async () => {
  const {root, drive, cleanup} = await fixture();
  try {
    const tools = createDriveTools(drive);
    const [write] = tools.filter((tool) => tool.name === "drive_write");
    const [read] = tools.filter((tool) => tool.name === "drive_read");
    assert.ok(write && read);
    await write.execute({source: "local", name: "log.md", content: "one\n"}, callContext);
    await read.execute({source: "local", path: path.join(root, "log.md")}, callContext);
    // The upload's own result is the new baseline, so the second write is
    // conditional on what the first one wrote rather than on what was read.
    const second = await write.execute(
      {source: "local", name: "log.md", content: "two\n"},
      callContext,
    );
    assert.ok(!second.isError, say(second));
    const third = await write.execute(
      {source: "local", name: "log.md", content: "three\n"},
      callContext,
    );
    assert.ok(!third.isError, say(third));
    assert.equal(await readFile(path.join(root, "log.md"), "utf8"), "three\n");
  } finally {
    await cleanup();
  }
});
