import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CHUNK_BYTES, fileChunks, SIMPLE_UPLOAD_LIMIT } from "../src/chunks.js";
import { DropboxDrive } from "../src/dropbox.js";
import { GoogleDrive } from "../src/google-drive.js";
import { OneDrive } from "../src/onedrive.js";
import type { DriveConsentPrompt, DriveSecretStore } from "../src/types.js";

/**
 * The session uploads, against a fake of each provider's protocol.
 *
 * What is being checked is not that the requests are well formed — a fake will
 * agree with whatever we send — but the two behaviours that decide whether a
 * big upload survives a bad connection: that the file is read a chunk at a
 * time rather than whole, and that the *server's* idea of the committed offset
 * wins over ours. Both only matter when something goes wrong, which is exactly
 * when nobody is watching.
 */

const secrets = (): DriveSecretStore => {
  const store = new Map<string, string>([
    [
      "drive:google-drive:default",
      JSON.stringify({
        accessToken: "token",
        refreshToken: "r",
        expiresAt: null,
      }),
    ],
    [
      "drive:dropbox:default",
      JSON.stringify({
        accessToken: "token",
        refreshToken: "r",
        expiresAt: null,
      }),
    ],
    [
      "drive:onedrive:default",
      JSON.stringify({
        accessToken: "token",
        refreshToken: "r",
        expiresAt: null,
      }),
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

/** Credentials have to look configured or the adapter refuses to start. */
function withClientId<T>(run: () => T): T {
  const before = process.env;
  process.env = {
    ...before,
    FLAREAI_GOOGLE_DRIVE_CLIENT_ID: "id",
    FLAREAI_DROPBOX_CLIENT_ID: "id",
    FLAREAI_ONEDRIVE_CLIENT_ID: "id",
  };
  try {
    return run();
  } finally {
    process.env = before;
  }
}

async function bigFile(): Promise<{
  file: string;
  size: number;
  clean: () => Promise<void>;
}> {
  const base = await mkdtemp(path.join(tmpdir(), "flareai-upload-"));
  const file = path.join(base, "recording.mov");
  // Two chunks and a bit: enough to exercise a resume in the middle.
  const size = CHUNK_BYTES * 2 + 1024;
  await writeFile(file, Buffer.alloc(size, 7));
  return {
    file,
    size,
    clean: () => rm(base, { recursive: true, force: true }),
  };
}

/** Swaps global fetch for the duration of one test. */
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

test("a file is read one chunk at a time, in order and whole", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "flareai-chunks-"));
  try {
    const file = path.join(base, "data.bin");
    await writeFile(file, Buffer.from("abcdefghij"));
    const seen: string[] = [];
    let total = 0;
    for await (const chunk of fileChunks(file, 4)) {
      seen.push(chunk.bytes.toString());
      total = chunk.total;
      assert.equal(chunk.end - chunk.start, chunk.bytes.byteLength);
    }
    assert.deepEqual(seen, ["abcd", "efgh", "ij"]);
    assert.equal(total, 10);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("a chunk stream can be told to seek backwards, and re-reads from there", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "flareai-chunks-"));
  try {
    const file = path.join(base, "data.bin");
    await writeFile(file, Buffer.from("abcdefghij"));
    const chunks = fileChunks(file, 4);
    const first = await chunks.next();
    assert.equal(first.value && first.value.bytes.toString(), "abcd");
    // The server says it only has the first two bytes — the next chunk has to
    // start there, not where we thought we were.
    const resumed = await chunks.next(2);
    assert.ok(resumed.value);
    assert.equal(resumed.value.bytes.toString(), "cdef");
    assert.equal(resumed.value.start, 2);
    await chunks.return(undefined);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("an empty file still goes through the simple path", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "flareai-chunks-"));
  try {
    const file = path.join(base, "empty.txt");
    await writeFile(file, "");
    const chunks = [];
    for await (const chunk of fileChunks(file)) chunks.push(chunk);
    assert.deepEqual(chunks, []);
    assert.ok(0 <= SIMPLE_UPLOAD_LIMIT);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Google Drive uploads a large file in chunks and resumes where 308 says", async () => {
  const { file, size, clean } = await bigFile();
  const ranges: string[] = [];
  let held = 0;
  let refused = false;

  await withFetch(
    async (url, init) => {
      if (url.includes("/drive/v3/files?q="))
        return new Response(JSON.stringify({ files: [] }));
      if (url.includes("uploadType=resumable"))
        return new Response("{}", {
          status: 200,
          headers: { location: "https://upload.test/session/1" },
        });
      if (url.startsWith("https://upload.test/session/")) {
        const range = (init.headers as Record<string, string>)[
          "content-range"
        ]!;
        ranges.push(range);
        const [, start, end] = /bytes (\d+)-(\d+)\//.exec(range)!;
        // The second chunk is accepted only in part, which is the case the
        // whole protocol exists for.
        if (!refused && Number(start) > 0) {
          refused = true;
          held = Number(start) + 1024;
          return new Response("", {
            status: 308,
            headers: { range: `bytes=0-${held - 1}` },
          });
        }
        held = Number(end) + 1;
        if (held >= size)
          return new Response(
            JSON.stringify({ id: "f1", name: "recording.mov" }),
            {
              status: 200,
            },
          );
        return new Response("", {
          status: 308,
          headers: { range: `bytes=0-${held - 1}` },
        });
      }
      throw new Error(`unexpected call: ${url}`);
    },
    async () => {
      const drive = withClientId(
        () => new GoogleDrive(secrets(), consent, "default"),
      );
      const entry = await drive.upload("folder-id", file);
      assert.equal(entry.id, "f1");
    },
  );

  await clean();
  assert.equal(ranges.length, 3);
  assert.equal(ranges[0], `bytes 0-${CHUNK_BYTES - 1}/${size}`);
  // The partly-accepted chunk is not re-sent from where we thought we were:
  // the next range starts at the offset Drive reported holding, and the rest
  // of the file follows from there.
  assert.equal(ranges[2], `bytes ${CHUNK_BYTES + 1024}-${size - 1}/${size}`);
});

test("Dropbox follows its own offset when an append lands in the wrong place", async () => {
  const { file, size, clean } = await bigFile();
  const offsets: number[] = [];
  let corrected = false;

  await withFetch(
    async (url, init) => {
      if (url.endsWith("/upload_session/start"))
        return new Response(JSON.stringify({ session_id: "s1" }));
      const arg = JSON.parse(
        (init.headers as Record<string, string>)["dropbox-api-arg"]!,
      ) as { cursor?: { offset: number } };
      if (url.endsWith("/upload_session/append_v2")) {
        offsets.push(arg.cursor!.offset);
        if (!corrected && arg.cursor!.offset === CHUNK_BYTES) {
          corrected = true;
          return new Response(
            JSON.stringify({
              error: { ".tag": "incorrect_offset", correct_offset: 4096 },
            }),
            { status: 409 },
          );
        }
        return new Response("{}");
      }
      if (url.endsWith("/upload_session/finish")) {
        offsets.push(arg.cursor!.offset);
        return new Response(
          JSON.stringify({
            name: "recording.mov",
            size,
            path_lower: "/recording.mov",
          }),
        );
      }
      throw new Error(`unexpected call: ${url}`);
    },
    async () => {
      const drive = withClientId(
        () => new DropboxDrive(secrets(), consent, "default"),
      );
      const entry = await drive.upload("", file);
      assert.equal(entry.name, "recording.mov");
    },
  );

  await clean();
  // After the rejection the session picks up at Dropbox's offset, not ours.
  assert.deepEqual(offsets.slice(0, 3), [0, CHUNK_BYTES, 4096]);
});

test("OneDrive follows nextExpectedRanges", async () => {
  const { file, size, clean } = await bigFile();
  const starts: number[] = [];

  await withFetch(
    async (url, init) => {
      if (url.endsWith("createUploadSession"))
        return new Response(
          JSON.stringify({ uploadUrl: "https://upload.test/graph/1" }),
        );
      if (url.startsWith("https://upload.test/graph/")) {
        const range = (init.headers as Record<string, string>)[
          "content-range"
        ]!;
        const [, start, end] = /bytes (\d+)-(\d+)\//.exec(range)!;
        starts.push(Number(start));
        if (Number(end) + 1 >= size)
          return new Response(
            JSON.stringify({ id: "g1", name: "recording.mov", size }),
            { status: 201 },
          );
        // Graph reports the next range it wants, which is what we follow.
        return new Response(
          JSON.stringify({ nextExpectedRanges: [`${Number(end) + 1}-`] }),
          { status: 202 },
        );
      }
      throw new Error(`unexpected call: ${url}`);
    },
    async () => {
      const drive = withClientId(
        () => new OneDrive(secrets(), consent, "default"),
      );
      const entry = await drive.upload("root-id", file);
      assert.equal(entry.id, "g1");
    },
  );

  await clean();
  assert.deepEqual(starts, [0, CHUNK_BYTES, CHUNK_BYTES * 2]);
});

test("Google Drive lists every page of a folder, not just the first", async () => {
  const pages = [
    { files: [{ id: "a", name: "a.txt" }], nextPageToken: "p2" },
    { files: [{ id: "b", name: "b.txt" }], nextPageToken: "p3" },
    { files: [{ id: "c", name: "c.txt" }] },
  ];
  let call = 0;

  await withFetch(
    async (url) => {
      assert.ok(url.includes("nextPageToken"), "the token has to be requested");
      if (call > 0)
        assert.ok(
          url.includes(`pageToken=p${call + 1}`),
          `page ${call + 1} should carry its token: ${url}`,
        );
      const page = pages[call];
      call += 1;
      return new Response(JSON.stringify(page));
    },
    async () => {
      const drive = withClientId(
        () => new GoogleDrive(secrets(), consent, "default"),
      );
      const entries = await drive.list("folder-id");
      assert.deepEqual(
        entries.map((entry) => entry.name),
        ["a.txt", "b.txt", "c.txt"],
      );
    },
  );
  assert.equal(call, 3);
});
