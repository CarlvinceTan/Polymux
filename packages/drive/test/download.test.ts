import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {Readable} from "node:stream";
import test from "node:test";
import {downloadToFile, etagAsMd5} from "../src/download.js";

/**
 * Downloads, against connections that fail the way real ones do.
 *
 * The behaviours worth pinning are the two that only show up on a bad line: a
 * broken stream resumes from what is already on disk rather than starting
 * again, and nothing incomplete or unverified is ever left at the destination
 * — a half-written file is the failure that costs real data, because nothing
 * about it looks wrong afterwards.
 */

async function workspace(): Promise<{
  dir: string;
  file: string;
  clean: () => Promise<void>;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "polymux-download-"));
  return {
    dir,
    file: path.join(dir, "report.pdf"),
    clean: () => rm(dir, {recursive: true, force: true}),
  };
}

const md5 = (bytes: Buffer): string =>
  createHash("md5").update(bytes).digest("hex");

/**
 * A body that delivers some bytes and then the connection drops.
 *
 * The drop is deferred by a tick on purpose: a real connection that dies
 * mid-file has already flushed what it sent, and destroying in the same tick
 * as the push would have the writable torn down with the bytes still in its
 * queue — which is a different scenario (nothing reached the disk) and is the
 * one the "never holds up" test covers.
 */
function brokenBody(bytes: Buffer, upTo: number): ReadableStream<Uint8Array> {
  let sent = false;
  return Readable.toWeb(
    new Readable({
      read() {
        if (sent) return;
        sent = true;
        this.push(bytes.subarray(0, upTo));
        setTimeout(() => this.destroy(new Error("connection reset")), 30);
      },
    }),
  ) as ReadableStream<Uint8Array>;
}

/** A body that drops with its bytes still in flight, so nothing reaches the
 * disk at all — the case where there is nothing to resume from. */
function stillbornBody(): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    new Readable({
      read() {
        this.push(Buffer.alloc(8, 1));
        this.destroy(new Error("connection reset"));
      },
    }),
  ) as ReadableStream<Uint8Array>;
}

const whole = (bytes: Buffer, status = 200): Response =>
  new Response(new Uint8Array(bytes), {status});

test("a complete download lands at the destination, with no partial left over", async () => {
  const {dir, file, clean} = await workspace();
  const bytes = Buffer.from("the quick brown fox");
  try {
    await downloadToFile(file, {
      expect: {size: bytes.byteLength, hash: {algorithm: "md5", expected: md5(bytes)}},
      open: async () => whole(bytes),
    });
    assert.deepEqual(await readFile(file), bytes);
    assert.deepEqual(await readdir(dir), ["report.pdf"]);
  } finally {
    await clean();
  }
});

test("a stream that dies is reopened from where it stopped", async () => {
  const {file, clean} = await workspace();
  const bytes = Buffer.from("0123456789abcdefghij");
  const offsets: number[] = [];
  try {
    await downloadToFile(file, {
      expect: {size: bytes.byteLength},
      open: async (offset) => {
        offsets.push(offset);
        if (offset === 0)
          return new Response(brokenBody(bytes, 8), {status: 200});
        // A resume is a 206 carrying only the remainder.
        return new Response(new Uint8Array(bytes.subarray(offset)), {
          status: 206,
        });
      },
    });
    // The whole file, once — the resumed part appended rather than restarted.
    assert.equal((await readFile(file)).toString(), bytes.toString());
    assert.deepEqual(offsets, [0, 8]);
  } finally {
    await clean();
  }
});

test("a provider that ignores the range restarts instead of splicing", async () => {
  const {file, clean} = await workspace();
  const bytes = Buffer.from("0123456789abcdefghij");
  let call = 0;
  try {
    await downloadToFile(file, {
      expect: {size: bytes.byteLength},
      open: async () => {
        call += 1;
        // The second answer is a 200: the whole file again, from the top.
        return call === 1
          ? new Response(brokenBody(bytes, 8), {status: 200})
          : whole(bytes);
      },
    });
    // Twenty bytes, not twenty-eight.
    assert.equal((await readFile(file)).toString(), bytes.toString());
  } finally {
    await clean();
  }
});

test("a file that fails its checksum is discarded rather than handed over", async () => {
  const {dir, file, clean} = await workspace();
  const bytes = Buffer.from("what the provider sent");
  try {
    await assert.rejects(
      downloadToFile(file, {
        expect: {
          size: bytes.byteLength,
          hash: {algorithm: "md5", expected: md5(Buffer.from("something else"))},
        },
        open: async () => whole(bytes),
      }),
      /does not match the copy on the provider/,
    );
    // Nothing at the destination, and no partial file left behind either.
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await clean();
  }
});

test("a download cut short of the stated size fails, and says by how much", async () => {
  const {dir, file, clean} = await workspace();
  try {
    await assert.rejects(
      downloadToFile(file, {
        expect: {size: 100},
        open: async () => whole(Buffer.alloc(40)),
      }),
      /cut short: 40 bytes of 100/,
    );
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await clean();
  }
});

test("a connection that never holds up leaves nothing behind", async () => {
  const {dir, file, clean} = await workspace();
  try {
    await assert.rejects(
      downloadToFile(file, {
        expect: {size: 64},
        open: async () => new Response(stillbornBody(), {status: 200}),
      }),
      /connection reset/,
    );
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await clean();
  }
});

test("an existing partial from an earlier attempt is not appended to", async () => {
  const {file, clean} = await workspace();
  const bytes = Buffer.from("fresh content");
  try {
    await writeFile(`${file}.polymux-partial`, "left over from last time");
    await downloadToFile(file, {
      expect: {size: bytes.byteLength, hash: {algorithm: "md5", expected: md5(bytes)}},
      open: async () => whole(bytes),
    });
    assert.equal((await readFile(file)).toString(), "fresh content");
  } finally {
    await clean();
  }
});

test("the size and hash a provider states on the response are used", async () => {
  const {file, clean} = await workspace();
  const bytes = Buffer.from("described by the response");
  try {
    await assert.rejects(
      downloadToFile(file, {
        describe: () => ({
          size: bytes.byteLength,
          hash: {algorithm: "md5", expected: md5(Buffer.from("no"))},
        }),
        open: async () => whole(bytes),
      }),
      /does not match/,
    );
  } finally {
    await clean();
  }
});

test("Dropbox's content hash is the hash of its block hashes", async () => {
  const {dir, file, clean} = await workspace();
  // Two blocks and a bit, so the concatenation actually has something to do.
  const block = 4 * 1024 * 1024;
  const bytes = Buffer.alloc(block * 2 + 17, 9);
  // Computed here from Dropbox's published definition, independently of the
  // implementation being checked.
  const blocks = [
    createHash("sha256").update(bytes.subarray(0, block)).digest(),
    createHash("sha256").update(bytes.subarray(block, block * 2)).digest(),
    createHash("sha256").update(bytes.subarray(block * 2)).digest(),
  ];
  const expected = createHash("sha256")
    .update(Buffer.concat(blocks))
    .digest("hex");
  try {
    const target = path.join(dir, "big.bin");
    await downloadToFile(target, {
      expect: {size: bytes.byteLength, hash: {algorithm: "dropbox", expected}},
      open: async () => whole(bytes),
    });
    assert.equal((await readFile(target)).byteLength, bytes.byteLength);
    void file;
  } finally {
    await clean();
  }
});

test("an S3 ETag is only trusted as an MD5 when the object was not multipart", async () => {
  assert.equal(
    etagAsMd5('"9bb58f26192e4ba00f01e2e7b136bbd8"'),
    "9bb58f26192e4ba00f01e2e7b136bbd8",
  );
  // A multipart ETag is a hash of hashes; checking a file against it would
  // fail every large upload the drive itself made.
  assert.equal(etagAsMd5('"9bb58f26192e4ba00f01e2e7b136bbd8-4"'), null);
  assert.equal(etagAsMd5(null), null);
});
