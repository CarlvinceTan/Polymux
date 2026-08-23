import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { GoogleDrive } from "../src/google-drive.js";
import { Drive } from "../src/manager.js";
import type { DriveConsentPrompt, DriveSecretStore } from "../src/types.js";
import type { JsonValue } from "@polymux/protocol";

/**
 * What a file is called once it reaches this Mac, and what a Google Doc even
 * is once it leaves Drive.
 *
 * Drive and Graph address files by an opaque id, so every path here is a
 * behaviour the user sees directly: a download named after an id opens in
 * nothing, and a Doc fetched as bytes does not download at all.
 */

const secrets = (): DriveSecretStore => {
  const store = new Map([
    [
      "drive:google-drive:default",
      JSON.stringify({ accessToken: "t", refreshToken: "r", expiresAt: null }),
    ],
  ]);
  return {
    read: async (id) => store.get(id),
    write: async (id, secret) => void store.set(id, secret),
    clear: async (id) => void store.delete(id),
  };
};

const consent: DriveConsentPrompt = {
  open: async () => {
    throw new Error("These tests never sign in.");
  },
};

function withClientId<T>(run: () => T): T {
  const before = process.env;
  process.env = { ...before, POLYMUX_GOOGLE_DRIVE_CLIENT_ID: "id" };
  try {
    return run();
  } finally {
    process.env = before;
  }
}

async function withFetch(
  handler: (url: string, init: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const before = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? {})) as typeof globalThis.fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = before;
  }
}

/** A drive whose downloads land in `downloads`, over a real local root. */
function driveOver(root: string, downloads: string): Drive {
  const preferences = new Map<string, JsonValue>([
    ["drive", { localRoot: root } as unknown as JsonValue],
  ]);
  return new Drive({
    storage: {
      getPreference: (key) => {
        const value = preferences.get(key);
        return value === undefined ? undefined : { value };
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
      files: async () => [],
      downloads: () => downloads,
    },
    consent,
  });
}

test("downloading the same file twice keeps both copies", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "polymux-naming-"));
  try {
    const root = path.join(base, "root");
    const downloads = path.join(base, "downloads");
    await mkdir(root, { recursive: true });
    await mkdir(downloads, { recursive: true });
    await writeFile(path.join(root, "report.pdf"), "one");

    const drive = driveOver(root, downloads);
    const first = await drive.download("local", path.join(root, "report.pdf"));
    const second = await drive.download("local", path.join(root, "report.pdf"));

    assert.equal(path.basename(first), "report.pdf");
    // Silently overwriting the first copy is not what a download looks like it
    // does, and the suffix goes before the extension so both still open.
    assert.equal(path.basename(second), "report (2).pdf");
    assert.deepEqual((await readdir(downloads)).sort(), [
      "report (2).pdf",
      "report.pdf",
    ]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a Google Doc downloads as its exported form, with the right extension", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "polymux-export-"));
  try {
    const asked: string[] = [];
    await withFetch(
      async (url) => {
        asked.push(url);
        if (url.includes("fields=size,md5Checksum,mimeType"))
          return new Response(
            JSON.stringify({
              mimeType: "application/vnd.google-apps.spreadsheet",
            }),
          );
        if (url.includes("/export?mimeType="))
          return new Response(new Uint8Array(Buffer.from("xlsx bytes")));
        throw new Error(`unexpected call: ${url}`);
      },
      async () => {
        const drive = withClientId(
          () => new GoogleDrive(secrets(), consent, "default"),
        );
        await drive.download("1Sheet", path.join(base, "Q3 figures.xlsx"));
      },
    );
    assert.deepEqual(await readdir(base), ["Q3 figures.xlsx"]);
    // A Sheet exports as a spreadsheet rather than as a PDF: the user is
    // almost always going to keep working on it.
    assert.ok(
      asked.some((url) =>
        url.includes(
          encodeURIComponent(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ),
        ),
      ),
      `no spreadsheet export among ${asked.join(", ")}`,
    );
    // And it never asks for the bytes directly, which Drive refuses for a Doc.
    assert.ok(!asked.some((url) => url.includes("alt=media")));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a Workspace document lists under the name it will have on disk", async () => {
  await withFetch(
    async () =>
      new Response(
        JSON.stringify({
          files: [
            {
              id: "1Doc",
              name: "Team notes",
              mimeType: "application/vnd.google-apps.document",
            },
            { id: "1Pdf", name: "Scan.pdf", mimeType: "application/pdf" },
          ],
        }),
      ),
    async () => {
      const drive = withClientId(
        () => new GoogleDrive(secrets(), consent, "default"),
      );
      const entries = await drive.list("folder");
      assert.deepEqual(
        entries.map((entry) => entry.name),
        ["Team notes.docx", "Scan.pdf"],
      );
    },
  );
});

test("two uploads starting together create one Polymux folder, not two", async () => {
  let searches = 0;
  let creates = 0;
  await withFetch(
    async (url, init) => {
      if (init.method === "POST" && url.includes("uploadType=multipart"))
        return new Response(JSON.stringify({ id: "f", name: "a.txt" }));
      if (init.method === "POST") {
        creates += 1;
        return new Response(JSON.stringify({ id: "root-1" }));
      }
      searches += 1;
      // The folder does not exist yet, which is what makes the race possible.
      return new Response(JSON.stringify({ files: [] }));
    },
    async () => {
      const base = await mkdtemp(path.join(tmpdir(), "polymux-root-"));
      try {
        const file = path.join(base, "a.txt");
        await writeFile(file, "hello");
        const drive = withClientId(
          () => new GoogleDrive(secrets(), consent, "default"),
        );
        // Both uploads look for the root at once; before the lookup was
        // shared, each found nothing and each created a folder.
        await Promise.all([drive.upload("", file), drive.upload("", file)]);
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    },
  );
  assert.equal(
    searches,
    3,
    "the root once and both destination names are looked up",
  );
  assert.equal(creates, 1, "and created once");
});
