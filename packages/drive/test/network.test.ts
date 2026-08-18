import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { NetworkDrive } from "../src/network.js";

/**
 * A share, and the same share unmounted.
 *
 * "Unmounted" is modelled as the mount point simply not being there, which is
 * what an ejected volume looks like on macOS once the automounter has tidied
 * up. The case where the point exists but is empty is covered separately,
 * because that is the one that can silently eat files.
 */
async function share(): Promise<{root: string; base: string; clean: () => Promise<void>}> {
  const base = await mkdtemp(path.join(tmpdir(), "flareai-network-"));
  const root = path.join(base, "Volumes", "Studio");
  await mkdir(root, {recursive: true});
  return {root, base, clean: () => rm(base, {recursive: true, force: true})};
}

test("a mounted share reports connected, with the server's own free space", async () => {
  const {root, clean} = await share();
  try {
    const probe = await new NetworkDrive(root, "Studio").probe();
    assert.equal(probe.state, "connected");
    assert.equal(probe.root, root);
    assert.equal(probe.error, null);
    assert.deepEqual(probe.accounts.map((account) => account.name), ["Studio"]);
    assert.ok(probe.usage && probe.usage.total > 0, "a mounted volume reports a size");
  } finally {
    await clean();
  }
});

test("an unmounted share is logged out, not broken", async () => {
  const {root, clean} = await share();
  try {
    await rm(root, {recursive: true, force: true});
    const probe = await new NetworkDrive(root, "Studio").probe();
    // Not `error`: nothing is wrong, it is simply not attached, and the fix is
    // to mount it rather than to debug anything.
    assert.equal(probe.state, "logged-out");
    assert.equal(probe.error, null);
    assert.equal(probe.usage, null);
    // It still names itself, so Settings can offer to reconnect it.
    assert.deepEqual(probe.accounts.map((account) => account.name), ["Studio"]);
  } finally {
    await clean();
  }
});

test("an unmounted share refuses to be written to, rather than creating its own root", async () => {
  const {root, base, clean} = await share();
  try {
    await rm(root, {recursive: true, force: true});
    const drive = new NetworkDrive(root, "Studio");

    // This is the whole reason the class exists. `LocalDrive` makes its root
    // when it is missing; doing that here would write the user's files onto
    // the local disk at the mount point, where the real volume would later
    // mount straight over the top of them.
    await assert.rejects(
      () => drive.createFolder("", "Reports"),
      /not connected/i,
      "creating into an unmounted share must fail",
    );
    await assert.rejects(() => drive.list(""), /not connected/i);
    await assert.rejects(() => drive.remove(path.join(root, "anything")), /not connected/i);

    // And nothing was left behind on the local disk.
    assert.deepEqual(
      await readdir(path.join(base, "Volumes")),
      [],
      "the mount point was not recreated",
    );
  } finally {
    await clean();
  }
});

test("a mounted share behaves like any other folder", async () => {
  const {root, clean} = await share();
  try {
    const drive = new NetworkDrive(root, "Studio");
    const folder = await drive.createFolder("", "Reports");
    assert.equal(folder.kind, "folder");
    assert.equal(folder.name, "Reports");
    // The provider is what the row badge reads, so it has to be the network
    // rather than the local drive doing the work underneath.
    assert.equal(folder.provider, "local");

    await writeFile(path.join(root, "Reports", "note.txt"), "hello");
    const listed = await drive.list(folder.path);
    assert.deepEqual(listed.map((entry) => entry.name), ["note.txt"]);

    const renamed = await drive.rename(folder.path, "Archive");
    assert.equal(renamed.name, "Archive");
  } finally {
    await clean();
  }
});

test("a share that goes away mid-session stops answering", async () => {
  const {root, clean} = await share();
  try {
    const drive = new NetworkDrive(root, "Studio");
    await drive.createFolder("", "Reports");
    assert.equal((await drive.probe()).state, "connected");

    // The server sleeps, the VPN drops, someone ejects the volume.
    await rm(root, {recursive: true, force: true});

    assert.equal((await drive.probe()).state, "logged-out");
    await assert.rejects(() => drive.list(""), /not connected/i);
  } finally {
    await clean();
  }
});
