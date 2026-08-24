import {createHash} from "node:crypto";
import {createReadStream, createWriteStream} from "node:fs";
import {open, rename, rm, stat} from "node:fs/promises";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";

/**
 * How many times a broken download is reopened before it is a failure.
 *
 * A transfer is not one request the way a listing is: it can die at 90% for
 * reasons that have nothing to do with the request being wrong, so it gets its
 * own budget rather than the request layer's.
 */
const DOWNLOAD_ATTEMPTS = 10;

/** The block size Dropbox's content hash is defined over. */
const DROPBOX_BLOCK = 4 * 1024 * 1024;

/** What the file is supposed to be, once the provider has said. */
export interface Expectation {
  /** Bytes, when the provider states them. */
  size?: number | null;
  /** The hash to check the file against, when there is one to check. */
  hash?: {
    /** Named in the failure, so a mismatch says what was compared. */
    algorithm: "md5" | "sha256" | "dropbox";
    expected: string;
  } | null;
}

export interface DownloadSource {
  /**
   * Opens the object's bytes. A non-zero `offset` asks the provider to resume,
   * which it signals by answering 206; anything else means it sent the whole
   * file again and the local copy has to start over.
   */
  open(offset: number): Promise<Response>;
  /** Reads size and hash off the first response, for the providers that put
   * them there rather than in a separate metadata call. */
  describe?(response: Response): Expectation;
  /** What a metadata call already established, if anything. */
  expect?: Expectation;
}

/**
 * Fetches an object to a local path, surviving a broken connection and
 * refusing to hand over a file that does not match what the provider said it
 * was.
 *
 * Two things make this different from streaming a response to disk:
 *
 * The bytes land in a `.partial` file and are renamed into place only once
 * they are complete and verified — so an interrupted download is never
 * mistaken for a finished one, which is the failure that costs a user real
 * data because nothing about the file looks wrong.
 *
 * And a stream that dies is reopened from the offset already written rather
 * than from zero, so a large download survives the kind of blip that a
 * request-level retry cannot even see — by the time the body fails, the
 * request has long since succeeded.
 */
export async function downloadToFile(
  destination: string,
  source: DownloadSource,
): Promise<void> {
  const partial = `${destination}.polymux-partial`;
  await rm(partial, {force: true});

  let expectation: Expectation = source.expect ?? {};
  let written = 0;
  let failure: Error | undefined;

  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
    const response = await source.open(written);
    if (attempt === 0 && source.describe)
      expectation = {...source.describe(response), ...source.expect};

    // A provider that ignores the range sends the file from the top; keeping
    // the earlier bytes would splice one copy onto another.
    const resuming = written > 0 && response.status === 206;
    if (written > 0 && !resuming) written = 0;

    if (!response.body) {
      failure = new Error("The download returned no content.");
      break;
    }

    try {
      await pipeline(
        Readable.fromWeb(
          response.body as Parameters<typeof Readable.fromWeb>[0],
        ),
        createWriteStream(partial, {flags: resuming ? "a" : "w"}),
      );
      failure = undefined;
      break;
    } catch (cause) {
      // The connection died mid-file. What is on disk is still good as far as
      // it goes, so the next attempt asks for the rest of it.
      failure = cause instanceof Error ? cause : new Error(String(cause));
    }
    // Read from the file rather than counting bytes as they pass: what the
    // next request must resume from is what actually reached the disk, which
    // a counter can only approximate.
    written = await sizeOf(partial);
  }

  if (failure) {
    await rm(partial, {force: true});
    throw failure;
  }

  try {
    await verify(partial, expectation);
  } catch (cause) {
    // A file that fails its own checksum is worse than no file: it will be
    // opened, and it will be wrong.
    await rm(partial, {force: true});
    throw cause;
  }

  await rename(partial, destination);
}

async function verify(file: string, expectation: Expectation): Promise<void> {
  if (typeof expectation.size === "number") {
    const actual = await sizeOf(file);
    if (actual !== expectation.size)
      throw new Error(
        `The download was cut short: ${actual} bytes of ${expectation.size}.`,
      );
  }
  const hash = expectation.hash;
  if (!hash) return;
  const actual = await digest(file, hash.algorithm);
  if (actual.toLowerCase() !== hash.expected.toLowerCase())
    throw new Error(
      "The download does not match the copy on the provider, so it was discarded.",
    );
}

export async function digest(
  file: string,
  algorithm: Expectation["hash"] extends {algorithm: infer A} ? A : never,
): Promise<string> {
  return algorithm === "dropbox"
    ? dropboxContentHash(file)
    : streamDigest(file, algorithm);
}

function streamDigest(file: string, algorithm: "md5" | "sha256"): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm === "md5" ? "md5" : "sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (piece) => hash.update(piece))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Dropbox's own content hash: SHA-256 of each 4 MB block, concatenated, then
 * hashed again. Dropbox publishes no plain checksum, so this is the only way
 * to check a file against what it holds.
 */
async function dropboxContentHash(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const blocks = createHash("sha256");
    const buffer = Buffer.alloc(DROPBOX_BLOCK);
    let offset = 0;
    for (;;) {
      const {bytesRead} = await handle.read(buffer, 0, DROPBOX_BLOCK, offset);
      if (bytesRead === 0) break;
      blocks.update(
        createHash("sha256").update(buffer.subarray(0, bytesRead)).digest(),
      );
      offset += bytesRead;
    }
    return blocks.digest("hex");
  } finally {
    await handle.close();
  }
}

/**
 * An S3 ETag is the object's MD5 — but only for one that was uploaded in a
 * single request. A multipart object's ETag is a hash of hashes with a `-N`
 * suffix, and checking a file against it would fail every large upload.
 */
export function etagAsMd5(etag: string | null): string | null {
  const trimmed = etag?.replace(/"/g, "") ?? "";
  return /^[0-9a-f]{32}$/i.test(trimmed) ? trimmed : null;
}

async function sizeOf(file: string): Promise<number> {
  return stat(file).then(
    (info) => info.size,
    () => 0,
  );
}
