/**
 * WeChat's SQLCipher snapshot engine, off the Electron main thread.
 *
 * The bridge follows WeChat's own databases by decrypting them into a private
 * plaintext copy and patching committed WAL frames into that copy. A large
 * first decrypt (or a checkpoint rebuild) is seconds of AES and HMAC on the
 * calling thread, so this module runs inside a `worker_threads` worker: the
 * main thread keeps only fast read-only queries against the snapshot file.
 *
 * The file layout is the interface between the two sides. Full rebuilds write
 * a staging file and rename it over the snapshot atomically, so a reader
 * opening the path always sees a complete database, old or new. Incremental
 * frame patches write in place. SqlcipherLiveSnapshot serializes worker
 * requests with its read-only queries so a reader cannot see a partial patch.
 *
 * The same file is imported directly by unit tests for its pure helpers, so
 * it depends only on Node builtins and never on the TypeScript sources: it
 * ships verbatim in `resources/wechat-writer/` (see
 * `scripts/wechat/build-wechat-writer.mjs`) and runs from the checkout in
 * development and tests.
 */

import {createDecipheriv, createHmac, pbkdf2Sync, timingSafeEqual} from "node:crypto";
import {open as openFile, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import {isMainThread, parentPort, workerData} from "node:worker_threads";

/** SQLCipher 4 defaults, which is what WeChat writes. */
const PAGE_SIZE = 4096;
/** Per page: a 16-byte IV and a 64-byte HMAC-SHA512 kept after the payload. */
const RESERVE = 80;
const SQLITE_MAGIC = "SQLite format 3\0";
/** Guards against snapshotting a database so large it is not worth reading. */
const MAX_DB_BYTES = 512 * 1024 * 1024;
const MIN_DB_BYTES = PAGE_SIZE;
/** A WAL frame is its 24-byte header plus one page. */
const FRAME_BYTES = 24 + PAGE_SIZE;
const SOURCE_READ_ATTEMPTS = 3;

/** HMAC key derivation: the page salt flipped, stretched twice with SHA-512. */
function macKeyFor(key, firstPage) {
  const hmacSalt = Buffer.from(firstPage.subarray(0, 16)).map((byte) => byte ^ 0x3a);
  return pbkdf2Sync(key, hmacSalt, 2, 32, "sha512");
}

/** Authenticates one encrypted page; throws when the key or the page is wrong. */
function verifyPageMac(page, macKey, pageNumber) {
  const number = Buffer.alloc(4);
  number.writeUInt32LE(pageNumber);
  const mac = createHmac("sha512", macKey)
    .update(page.subarray(pageNumber === 1 ? 16 : 0, PAGE_SIZE - 64))
    .update(number)
    .digest();
  if (!timingSafeEqual(mac, page.subarray(PAGE_SIZE - 64)))
    throw new Error("WeChat database page authentication failed");
}

/**
 * One full plaintext page, reserve tail zeroed. The salt in page one's first
 * 16 bytes is replaced with the SQLite magic the header expects.
 */
function decryptPage(page, key, macKey, pageNumber) {
  verifyPageMac(page, macKey, pageNumber);
  const start = pageNumber === 1 ? 16 : 0;
  const decipher = createDecipheriv("aes-256-cbc", key, page.subarray(PAGE_SIZE - RESERVE, PAGE_SIZE - 64));
  decipher.setAutoPadding(false);
  const body = Buffer.concat([decipher.update(page.subarray(start, PAGE_SIZE - RESERVE)), decipher.final()]);
  const plain = Buffer.alloc(PAGE_SIZE);
  body.copy(plain, start);
  if (pageNumber === 1) Buffer.from(SQLITE_MAGIC, "binary").copy(plain);
  return plain;
}

/** Whether the raw key authenticates the first page of this database. */
export function isKeyFor(main, key) {
  if (!Buffer.isBuffer(main) || !Buffer.isBuffer(key)) return false;
  if (key.length !== 32 || main.length < MIN_DB_BYTES) return false;
  try {
    verifyPageMac(main.subarray(0, PAGE_SIZE), macKeyFor(key, main), 1);
    return true;
  } catch {
    return false;
  }
}

function checksum(bytes, bigEndian, initial = [0, 0]) {
  let [a, b] = initial;
  for (let offset = 0; offset < bytes.length; offset += 8) {
    a = (a + (bigEndian ? bytes.readUInt32BE(offset) : bytes.readUInt32LE(offset)) + b) >>> 0;
    b = (b + (bigEndian ? bytes.readUInt32BE(offset + 4) : bytes.readUInt32LE(offset + 4)) + a) >>> 0;
  }
  return [a, b];
}

/**
 * The frames of a write-ahead log that belong to committed transactions.
 * SQLite chains the frames with checksums and stamps each commit with the
 * database size it produced; anything after the last commit is not yet part
 * of the catalog. Returns null when the log is absent, torn, or written by
 * something this reader does not understand.
 * https://sqlite.org/fileformat.html#walformat
 */
export function committedWalFrames(wal) {
  if (!Buffer.isBuffer(wal) || wal.length < 32) return null;
  const magic = wal.readUInt32BE(0);
  if (![0x377f0682, 0x377f0683].includes(magic) || wal.readUInt32BE(4) !== 3007000 || wal.readUInt32BE(8) !== PAGE_SIZE)
    return null;
  const bigEndian = magic === 0x377f0683;
  let sum = checksum(wal.subarray(0, 24), bigEndian);
  if (sum[0] !== wal.readUInt32BE(24) || sum[1] !== wal.readUInt32BE(28)) return null;
  const frames = [];
  let lastCommit = 0;
  for (let offset = 32; offset + FRAME_BYTES <= wal.length; offset += FRAME_BYTES) {
    const header = wal.subarray(offset, offset + 24);
    // Frames retained from an earlier log generation carry a stale salt.
    if (!header.subarray(8, 16).equals(wal.subarray(16, 24))) break;
    const page = wal.subarray(offset + 24, offset + 24 + PAGE_SIZE);
    sum = checksum(page, bigEndian, checksum(header.subarray(0, 8), bigEndian, sum));
    if (sum[0] !== header.readUInt32BE(16) || sum[1] !== header.readUInt32BE(20)) return null;
    const pageNumber = header.readUInt32BE(0);
    if (!pageNumber || pageNumber * PAGE_SIZE > MAX_DB_BYTES) return null;
    const commitSize = header.readUInt32BE(4);
    if (commitSize * PAGE_SIZE > MAX_DB_BYTES) return null;
    frames.push({pageNumber, commitSize, page});
    if (commitSize) lastCommit = frames.length;
  }
  return {frames: frames.slice(0, lastCommit), salt: wal.readUInt32BE(16)};
}

/**
 * Whether SQLite's shared-memory index says the log is empty: an initialized,
 * checksum-valid index whose frame count is zero. A checkpoint empties the
 * log without deleting the file, so the index — not the file size — says so.
 */
export function walIndexSaysEmpty(index) {
  if (!Buffer.isBuffer(index)) return false;
  if (index.length !== 96 || !index.subarray(0, 48).equals(index.subarray(48, 96)) ||
      index.readUInt32LE(0) !== 3007000 || index[12] !== 1 || index.readUInt32LE(16) !== 0) return false;
  const sum = checksum(index.subarray(0, 40), false);
  return sum[0] === index.readUInt32LE(40) && sum[1] === index.readUInt32LE(44);
}

async function fingerprint(main, wal, shm) {
  const describe = async (file) => {
    try {
      const value = await stat(file, {bigint: true});
      return value.isFile() && value.size > 0 ? `${value.size}:${value.mtimeNs}` : "-";
    } catch {
      return "-";
    }
  };
  return `${await describe(main)}|${await describe(wal)}|${await describe(shm)}`;
}

async function optionalBytes(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error?.code === "ENOENT") return Buffer.alloc(0);
    throw error;
  }
}

/**
 * Captures one coherent source generation. The fingerprint belongs to the
 * exact bytes returned: a commit before or after this read necessarily leaves
 * a different fingerprint for the next refresh instead of being mistaken for
 * data already published.
 */
async function stableSource(mainPath, walPath, shmPath, includeMain) {
  for (let attempt = 0; attempt < SOURCE_READ_ATTEMPTS; attempt += 1) {
    const before = await fingerprint(mainPath, walPath, shmPath);
    const [main, rawWal, rawIndex] = await Promise.all([
      includeMain ? readFile(mainPath) : Promise.resolve(null),
      optionalBytes(walPath),
      optionalBytes(shmPath),
    ]);
    const after = await fingerprint(mainPath, walPath, shmPath);
    if (before !== after) continue;
    const index = rawIndex.subarray(0, 96);
    const wal = walIndexSaysEmpty(index) ? Buffer.alloc(0) : rawWal;
    if (wal.length && !committedWalFrames(wal))
      throw new Error("WeChat write-ahead log is malformed or incomplete");
    return {main, wal, fingerprint: after};
  }
  throw new Error("WeChat database changed while its snapshot was being read");
}

/**
 * A decrypted, current copy of one SQLCipher database.
 *
 * The first build decrypts every page of the main file plus the log's
 * committed frames. Later refreshes decrypt only frames committed since the
 * last one and patch them into the same private file. When SQLite checkpoints
 * — the log resets under a new salt and the main file absorbs the changes —
 * the copy rebuilds from the main file, which is then the current truth.
 *
 * Rebuilds stage to a sibling file and rename it over the snapshot, so a
 * reader opening the path never sees a half-written database.
 */
export class SnapshotEngine {
  #main;
  #wal;
  #shm;
  #key;
  #snapshotFile;
  #stagingFile;
  #macKey = null;
  #handle = null;
  /** Pages physically present in the snapshot file. */
  #pages = 0;
  /** Page count the snapshot's header advertises to SQLite. */
  #headerPages = 0;
  #salt = 0;
  /** Frames of the log already folded in. */
  #framesApplied = 0;
  #last = "";

  constructor(main, key, snapshotFile) {
    this.#main = main;
    this.#wal = `${main}-wal`;
    this.#shm = `${main}-shm`;
    this.#key = key;
    this.#snapshotFile = snapshotFile;
    this.#stagingFile = `${snapshotFile}.tmp`;
  }

  async open() {
    const source = await stableSource(this.#main, this.#wal, this.#shm, true);
    const main = source.main;
    if (main.length < MIN_DB_BYTES || main.length % PAGE_SIZE || main.length > MAX_DB_BYTES)
      throw new Error("WeChat database file is not a usable SQLCipher store");
    const macKey = macKeyFor(this.#key, main);
    // The key is proven against the file before any plaintext is written, so
    // a wrong registry entry fails once, here, and nowhere else.
    verifyPageMac(main.subarray(0, PAGE_SIZE), macKey, 1);
    this.#macKey = macKey;
    const pages = main.length / PAGE_SIZE;
    const plain = Buffer.alloc(pages * PAGE_SIZE);
    for (let number = 1; number <= pages; number += 1)
      decryptPage(main.subarray((number - 1) * PAGE_SIZE, number * PAGE_SIZE), this.#key, macKey, number)
        .copy(plain, (number - 1) * PAGE_SIZE);
    this.#pages = pages;
    await this.#writeFresh(plain, source.wal, source.fingerprint);
  }

  async #writeFresh(plain, wal, sourceFingerprint) {
    const parsed = committedWalFrames(wal);
    const frames = parsed?.frames ?? [];
    let pages = this.#pages;
    for (const frame of frames) pages = Math.max(pages, frame.pageNumber, frame.commitSize || 0);
    const merged = Buffer.alloc(pages * PAGE_SIZE);
    plain.copy(merged);
    for (const frame of frames)
      decryptPage(frame.page, this.#key, this.#macKey, frame.pageNumber)
        .copy(merged, (frame.pageNumber - 1) * PAGE_SIZE);
    // The final commit is authoritative, including a transaction that shrinks
    // the database while older frames still describe now-unused pages.
    this.#headerPages = frames.length ? frames[frames.length - 1].commitSize : pages;
    this.#stampHeader(merged);
    // The persistent patch handle must not survive the swap: after the rename
    // it would write into the orphaned inode instead of the live snapshot.
    await this.#handle?.close().catch(() => undefined);
    this.#handle = null;
    await rm(this.#stagingFile, {force: true});
    await writeFile(this.#stagingFile, merged, {mode: 0o600});
    await rename(this.#stagingFile, this.#snapshotFile);
    this.#pages = pages;
    this.#salt = parsed?.salt ?? 0;
    this.#framesApplied = frames.length;
    this.#last = sourceFingerprint;
  }

  /** Makes the copy openable as an ordinary rollback-journal database. */
  #stampHeader(page1) {
    page1[18] = 1;
    page1[19] = 1;
    page1.writeUInt32BE(this.#headerPages, 28);
    page1.copy(page1, 92, 24, 28);
  }

  /**
   * Folds newly committed log frames into the copy. Returns whether anything
   * changed. A checkpoint resets the log under a new salt; the copy then
   * rebuilds from the main file, which holds every committed page again.
   */
  async refresh() {
    const last = await fingerprint(this.#main, this.#wal, this.#shm);
    if (this.#last && last === this.#last) return false;
    const source = await stableSource(this.#main, this.#wal, this.#shm, false);
    const wal = source.wal;
    const parsed = wal.length ? committedWalFrames(wal) : null;
    // A missing, torn, reset, or shrunken log means the copy's place in it is
    // no longer knowable; the main file is re-read in full, which is always
    // safe and only costs what a checkpoint would have anyway.
    if (!this.#macKey || !parsed || parsed.frames.length < this.#framesApplied || parsed.salt !== this.#salt) {
      await this.open();
      return true;
    }
    const fresh = parsed.frames.slice(this.#framesApplied);
    if (!fresh.length) {
      this.#last = source.fingerprint;
      return false;
    }
    this.#handle ??= await openFile(this.#snapshotFile, "r+");
    const handle = this.#handle;
    let lastCommitSize = 0;
    for (const frame of fresh)
      if (frame.commitSize) lastCommitSize = frame.commitSize;
    if (lastCommitSize) this.#headerPages = lastCommitSize;
    for (const frame of fresh) {
      const plain = decryptPage(frame.page, this.#key, this.#macKey, frame.pageNumber);
      if (frame.pageNumber > this.#pages) this.#pages = frame.pageNumber;
      if (frame.pageNumber === 1) this.#stampHeader(plain);
      await handle.write(plain, 0, plain.length, (frame.pageNumber - 1) * PAGE_SIZE);
    }
    this.#framesApplied = parsed.frames.length;
    if (lastCommitSize) {
      // Growth is covered by the frames themselves; a smaller count just
      // tells SQLite to ignore trailing pages. Both live in the header.
      const header = Buffer.alloc(8);
      header.writeUInt32BE(this.#headerPages);
      const change = Buffer.alloc(4);
      await handle.read(change, 0, 4, 24);
      await handle.write(change, 0, 4, 92);
      await handle.write(header.subarray(0, 4), 0, 4, 28);
    }
    this.#last = source.fingerprint;
    return true;
  }

  async close({removeSnapshot = true} = {}) {
    const handle = this.#handle;
    this.#handle = null;
    await handle?.close().catch(() => undefined);
    if (removeSnapshot) {
      await rm(this.#snapshotFile, {force: true}).catch(() => undefined);
      await rm(this.#stagingFile, {force: true}).catch(() => undefined);
    }
  }
}

// The worker entry: one engine per thread, driven by `{id, op}` messages.
// Importing this module on the main thread (as the tests do for the pure
// helpers above) starts no loop.
if (!isMainThread && parentPort) {
  let engine = new SnapshotEngine(
    workerData.main,
    Buffer.from(workerData.keyHex, "hex"),
    workerData.snapshotFile,
  );
  parentPort.on("message", async (message) => {
    const {id, op} = message ?? {};
    try {
      if (op === "replace-key") {
        if (typeof message.keyHex !== "string" || !/^[a-f0-9]{64}$/i.test(message.keyHex))
          throw new Error("invalid snapshot replacement key");
        // Authenticate and decrypt every source page before replacing the
        // published copy. A rejected key leaves the old engine and copy usable.
        const replacement = new SnapshotEngine(workerData.main,
          Buffer.from(message.keyHex, "hex"), workerData.snapshotFile);
        await replacement.open();
        await engine.close({removeSnapshot: false});
        engine = replacement;
        parentPort.postMessage({id, ok: true, result: true});
        return;
      }
      if (op !== "open" && op !== "refresh" && op !== "close")
        throw new Error(`unknown snapshot operation ${String(op)}`);
      const result = await engine[op]().then((value) => value ?? null);
      parentPort.postMessage({id, ok: true, result});
    } catch (error) {
      parentPort.postMessage({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
