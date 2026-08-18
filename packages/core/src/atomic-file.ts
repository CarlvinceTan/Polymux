import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * Replaces a file's contents in one step.
 *
 * Writing in place has two failure modes, and both read as corruption rather
 * than as a crash: a process that dies mid-write leaves a truncated file where
 * a whole one was, and a reader that arrives mid-write sees half of each. The
 * bytes therefore go to a sibling temporary and are `rename`d over the
 * destination, which is atomic within a filesystem — a reader sees the old file
 * or the new one and never a partial one.
 *
 * The temporary is a sibling rather than a file in the system temp directory
 * on purpose: `rename` across filesystems is not atomic and would fall back to
 * a copy, which is the very thing this exists to avoid.
 */
export function writeFileAtomicSync(
  file: string,
  contents: string | Uint8Array,
): void {
  const temporary = join(
    dirname(file),
    `.${randomBytes(6).toString("hex")}.tmp`,
  );
  let handle: number | null = null;
  try {
    handle = openSync(temporary, "wx", 0o600);
    writeSync(
      handle,
      typeof contents === "string" ? Buffer.from(contents, "utf8") : contents,
    );
    // Without this the rename can be durable while the bytes it points at are
    // not, which on a power loss is an empty file where the old one was.
    fsyncSync(handle);
    closeSync(handle);
    handle = null;
    renameSync(temporary, file);
  } catch (error) {
    if (handle !== null) {
      try {
        closeSync(handle);
      } catch {
        // Already closed, or a handle that never opened; the rm below is what
        // actually matters here.
      }
    }
    rmSync(temporary, { force: true });
    throw error;
  }
}
