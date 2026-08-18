import assert from "node:assert/strict";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {LocalDrive} from "../src/local.js";
import type {DriveAdapter, DriveProbe} from "../src/types.js";
import {VirtualDrive, type VirtualSource} from "../src/virtual.js";

/**
 * The virtual drive, over real local adapters standing in for providers.
 *
 * Using two `LocalDrive`s rather than fakes is deliberate: the behaviour worth
 * pinning is that the union really routes to two separate backing stores, and
 * a fake that agreed with the router would not show that.
 */

async function twoProviders(): Promise<{
  drive: VirtualDrive;
  left: string;
  right: string;
  clean: () => Promise<void>;
}> {
  const base = await mkdtemp(path.join(tmpdir(), "flareai-virtual-"));
  const left = path.join(base, "left");
  const right = path.join(base, "right");
  await mkdir(left, {recursive: true});
  await mkdir(right, {recursive: true});
  const sources: VirtualSource[] = [
    {id: "google-drive#a", provider: "google-drive", adapter: new LocalDrive(left)},
    {id: "dropbox#b", provider: "dropbox", adapter: new LocalDrive(right)},
  ];
  return {
    drive: new VirtualDrive(
      () => sources,
      async () => "dropbox#b",
    ),
    left,
    right,
    clean: () => rm(base, {recursive: true, force: true}),
  };
}

test("the root is every connected source at once", async () => {
  const {drive, left, right, clean} = await twoProviders();
  try {
    await drive.createFolder("", "shared");
    await writeFile(path.join(left, "from-drive.txt"), "one");
    await writeFile(path.join(right, "from-dropbox.txt"), "two");

    const entries = await drive.list("");
    assert.deepEqual(
      entries.map((entry) => entry.name).sort(),
      ["from-drive.txt", "from-dropbox.txt", "shared"].sort(),
    );
    // Every row still knows which provider answered for it, which is what the
    // badge beside the name reads.
    const byName = new Map(entries.map((entry) => [entry.name, entry.provider]));
    assert.equal(byName.get("from-drive.txt"), "google-drive");
    assert.equal(byName.get("from-dropbox.txt"), "dropbox");
  } finally {
    await clean();
  }
});

test("two providers holding the same name give two rows, not one", async () => {
  const {drive, left, right, clean} = await twoProviders();
  try {
    await writeFile(path.join(left, "notes.txt"), "drive copy");
    await writeFile(path.join(right, "notes.txt"), "dropbox copy");
    const entries = await drive.list("");
    assert.equal(entries.filter((entry) => entry.name === "notes.txt").length, 2);
    // They are different files; collapsing them would be the drive lying about
    // what the user has.
    assert.equal(new Set(entries.map((entry) => entry.path)).size, 2);
  } finally {
    await clean();
  }
});

test("a new file goes where the save order says", async () => {
  const {drive, left, right, clean} = await twoProviders();
  try {
    const base = await mkdtemp(path.join(tmpdir(), "flareai-src-"));
    const file = path.join(base, "report.txt");
    await writeFile(file, "hello");
    const uploaded = await drive.upload("", file);
    assert.equal(uploaded.provider, "dropbox");
    // On disk in the preferred provider, and nowhere else.
    assert.equal((await readFile(path.join(right, "report.txt"))).toString(), "hello");
    await assert.rejects(readFile(path.join(left, "report.txt")));
    await rm(base, {recursive: true, force: true});
  } finally {
    await clean();
  }
});

test("a path round-trips: listing a folder reaches the source that holds it", async () => {
  const {drive, right, clean} = await twoProviders();
  try {
    const folder = await drive.createFolder("", "Reports");
    const base = await mkdtemp(path.join(tmpdir(), "flareai-src-"));
    const file = path.join(base, "q3.txt");
    await writeFile(file, "figures");
    await drive.upload(folder.path, file);

    const inside = await drive.list(folder.path);
    assert.deepEqual(inside.map((entry) => entry.name), ["q3.txt"]);
    // And it really landed inside that provider's own folder.
    assert.equal(
      (await readFile(path.join(right, "Reports", "q3.txt"))).toString(),
      "figures",
    );
    await rm(base, {recursive: true, force: true});
  } finally {
    await clean();
  }
});

test("moving between providers carries the bytes and drops the original", async () => {
  const {drive, left, right, clean} = await twoProviders();
  try {
    await writeFile(path.join(left, "move-me.txt"), "payload");
    const [entry] = await drive.list("");
    assert.ok(entry);

    const moved = await drive.move(entry.path, "dropbox#b/");
    assert.equal(moved.provider, "dropbox");
    assert.equal((await readFile(path.join(right, "move-me.txt"))).toString(), "payload");
    // The original is gone only after the copy arrived.
    await assert.rejects(readFile(path.join(left, "move-me.txt")));
  } finally {
    await clean();
  }
});

test("a provider that fails does not empty the whole drive", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "flareai-virtual-"));
  try {
    const working = path.join(base, "working");
    await mkdir(working, {recursive: true});
    const sources: VirtualSource[] = [
      {
        id: "google-drive#a",
        provider: "google-drive",
        adapter: {
          id: "google-drive",
          probe: async (): Promise<DriveProbe> => ({
            state: "error",
            accounts: [],
            usage: null,
            root: null,
            error: "offline",
          }),
          list: async () => {
            throw new Error("Google Drive is unreachable.");
          },
        } as never,
      },
      {id: "dropbox#b", provider: "dropbox", adapter: new LocalDrive(working)},
    ];
    const drive = new VirtualDrive(() => sources, async () => "dropbox#b");
    await writeFile(path.join(working, "still-here.txt"), "yes");

    const entries = await drive.list("");
    assert.ok(entries.some((entry) => entry.name === "still-here.txt"));
  } finally {
    await rm(base, {recursive: true, force: true});
  }
});

test("usage is what the connected providers add up to", async () => {
  const sources: VirtualSource[] = [
    {
      id: "a#1",
      provider: "google-drive",
      adapter: {
        probe: async (): Promise<DriveProbe> => ({
          state: "connected",
          accounts: [],
          usage: {used: 100, total: 1000},
          root: null,
          error: null,
        }),
      } as never,
    },
    {
      id: "b#1",
      provider: "dropbox",
      adapter: {
        probe: async (): Promise<DriveProbe> => ({
          state: "connected",
          accounts: [],
          // A provider with no quota to report is skipped rather than counted
          // as an empty one.
          usage: {used: 50, total: null},
          root: null,
          error: null,
        }),
      } as never,
    },
  ];
  const probe = await new VirtualDrive(() => sources, async () => "a#1").probe();
  assert.equal(probe.state, "connected");
  assert.deepEqual(probe.usage, {used: 150, total: 1000});
});

test("a folder belongs to one provider, and so does everything inside it", async () => {
  const {drive, left, right, clean} = await twoProviders();
  try {
    // Same folder name in both providers, and a file inside each. The root
    // mixes providers; nothing below it may.
    await mkdir(path.join(left, "Reports", "2026"), {recursive: true});
    await writeFile(path.join(left, "Reports", "drive-only.txt"), "a");
    await mkdir(path.join(right, "Reports"), {recursive: true});
    await writeFile(path.join(right, "Reports", "dropbox-only.txt"), "b");

    const root = await drive.list("");
    // Two folders called Reports, one per provider — the root is the only
    // place two providers sit side by side.
    const reports = root.filter((entry) => entry.name === "Reports");
    assert.equal(reports.length, 2);
    assert.deepEqual(
      reports.map((entry) => entry.provider).sort(),
      ["dropbox", "google-drive"],
    );

    for (const folder of reports) {
      const children = await drive.list(folder.path);
      // Every child carries the folder's provider, and no other.
      assert.deepEqual(
        [...new Set(children.map((child) => child.provider))],
        [folder.provider],
        "a folder's contents all come from the provider that holds it",
      );
      // And they are that provider's files, not the other's.
      const names = children.map((child) => child.name).sort();
      assert.deepEqual(
        names,
        folder.provider === "google-drive" ? ["2026", "drive-only.txt"] : ["dropbox-only.txt"],
      );
    }
  } finally {
    await clean();
  }
});

test("nesting is kept as it is, however deep", async () => {
  const {drive, left, clean} = await twoProviders();
  try {
    await mkdir(path.join(left, "Reports", "2026", "Q3"), {recursive: true});
    await writeFile(path.join(left, "Reports", "2026", "Q3", "summary.txt"), "x");

    // Walk down by path, the way the workspace does, and the tree that comes
    // back is the one on disk — same names, same shape, same provider.
    let here = (await drive.list("")).find((entry) => entry.name === "Reports")!;
    for (const step of ["2026", "Q3"]) {
      const children = await drive.list(here.path);
      const next = children.find((entry) => entry.name === step);
      assert.ok(next, `${step} should be inside ${here.name}`);
      assert.equal(next!.provider, "google-drive");
      here = next!;
    }
    const leaf = await drive.list(here.path);
    assert.deepEqual(leaf.map((entry) => entry.name), ["summary.txt"]);
    assert.equal(leaf[0]!.provider, "google-drive");
  } finally {
    await clean();
  }
});

test("a file's own page survives being lifted into the virtual drive", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "flareai-weburl-"));
  try {
    // A stand-in for a cloud adapter: the only thing that matters here is that
    // whatever it puts on `webUrl` reaches the row unchanged, because that is
    // what "open where it lives" follows for a file with no path on this Mac.
    const cloud: DriveAdapter = {
      id: "google-drive" as const,
      probe: async () => ({state: "connected" as const, accounts: [], usage: null, root: null, error: null}),
      list: async () => [
        {
          id: "abc123",
          name: "Launch brief",
          kind: "file" as const,
          size: 10,
          modifiedAt: null,
          provider: "google-drive" as const,
          path: "abc123",
          mimeType: null,
          webUrl: "https://drive.google.com/file/d/abc123/view",
        },
      ],
      createFolder: async () => { throw new Error("not used"); },
      upload: async () => { throw new Error("not used"); },
      download: async () => {},
      remove: async () => {},
      rename: async () => { throw new Error("not used"); },
      move: async () => { throw new Error("not used"); },
      copy: async () => { throw new Error("not used"); },
    };
    const drive = new VirtualDrive(
      () => [{id: "google-drive#a", provider: "google-drive", adapter: cloud}],
      async () => "google-drive#a",
    );

    const [entry] = await drive.list("");
    assert.equal(entry!.webUrl, "https://drive.google.com/file/d/abc123/view");
    // And the id is still rewritten so it round-trips through the union.
    assert.ok(entry!.id.startsWith("google-drive#a/"));
  } finally {
    await rm(base, {recursive: true, force: true});
  }
});

test("a file on a volume has no page to open", async () => {
  const {drive, left, clean} = await twoProviders();
  try {
    await writeFile(path.join(left, "notes.txt"), "x");
    const [entry] = await drive.list("");
    // Undefined rather than a guessed URL: a local file is opened from the
    // volume, and inventing a link would send the user somewhere wrong.
    assert.equal(entry!.webUrl ?? null, null);
  } finally {
    await clean();
  }
});
