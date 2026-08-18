import {open} from "node:fs/promises";

/**
 * Above this, an upload goes through the provider's session protocol instead
 * of one request.
 *
 * Every provider here caps a single-request upload — Dropbox at 150 MB, Graph
 * at 250 MB, and Google recommends resumable past a few MB — but the size that
 * matters first is this process's: a file read into a Buffer is a file held
 * whole in the main process's memory.
 */
export const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;

/**
 * The chunk size for a session upload.
 *
 * Google requires a multiple of 256 KiB and Microsoft a multiple of 320 KiB;
 * 7.5 MiB satisfies both (256 KiB × 30, 320 KiB × 24) and clears S3's 5 MiB
 * minimum part size, so one constant serves every provider.
 */
export const CHUNK_BYTES = 7_864_320;

export interface Chunk {
  bytes: Buffer;
  /** Offset of the first byte, from the start of the file. */
  start: number;
  /** Offset one past the last byte, so `end - start` is the length. */
  end: number;
  total: number;
  last: boolean;
}

/**
 * Reads a file in order, one chunk at a time.
 *
 * The point is that only one chunk is in memory at once: uploading a 4 GB
 * video should cost the same as uploading a 4 MB one, which is not true of
 * anything that starts with `readFile`.
 *
 * A generator rather than a callback so a provider can stop consuming — a
 * session that reports a different committed offset needs to seek, not to be
 * handed the next chunk regardless.
 */
export async function* fileChunks(
  localPath: string,
  chunkBytes = CHUNK_BYTES,
): AsyncGenerator<Chunk, void, number | undefined> {
  const handle = await open(localPath, "r");
  try {
    const total = (await handle.stat()).size;
    let start = 0;
    while (start < total) {
      const length = Math.min(chunkBytes, total - start);
      const bytes = Buffer.alloc(length);
      // A short read is legal on any file; keep asking until the chunk is
      // whole, or a slow disk would silently upload a hole.
      let filled = 0;
      while (filled < length) {
        const {bytesRead} = await handle.read(
          bytes,
          filled,
          length - filled,
          start + filled,
        );
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      if (filled < length)
        throw new Error(
          "The file was truncated while it was being uploaded.",
        );
      const end = start + length;
      // A consumer that yields back an offset is resuming: the provider has a
      // different idea of what it already holds, and it is the authority.
      const resumeAt = yield {bytes, start, end, total, last: end >= total};
      start = resumeAt ?? end;
    }
  } finally {
    await handle.close();
  }
}

/** `bytes 0-7864319/20000000`, as every resumable protocol here spells it. */
export function contentRange(chunk: Chunk): string {
  return `bytes ${chunk.start}-${chunk.end - 1}/${chunk.total}`;
}

/**
 * Runs a session upload to its end.
 *
 * The three session protocols differ in every detail except their shape: send
 * a chunk, and the provider either finishes or says which offset it is really
 * at. `send` answers in those terms and this deals with the rest — including
 * closing the file, which returning from inside a `for await` does not do.
 */
export async function uploadInChunks<T>(
  localPath: string,
  send: (chunk: Chunk) => Promise<{done: T} | {resumeAt: number}>,
  what = "The upload",
): Promise<T> {
  const chunks = fileChunks(localPath);
  let resumeAt: number | undefined;
  try {
    for (;;) {
      const next = await chunks.next(resumeAt);
      if (next.done || !next.value) break;
      const outcome = await send(next.value);
      if ("done" in outcome) return outcome.done;
      resumeAt = outcome.resumeAt;
    }
  } finally {
    // The generator is suspended mid-file on every path that returns early;
    // this is what closes the descriptor rather than leaving it to the
    // collector, which Node warns about and will one day refuse.
    await chunks.return(undefined);
  }
  throw new Error(`${what} ended before the file did.`);
}
