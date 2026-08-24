import {createDecipheriv} from "node:crypto";
import {readFile, readdir, rm, writeFile} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {homedir, tmpdir} from "node:os";
import path from "node:path";

/**
 * WeChat's contact pictures, read out of the app's own store.
 *
 * The relay this bridge talks to serves no avatars — not on `/chats`, not on
 * `/contacts`, not on a chat — so a conversation imported from WeChat had
 * nothing to show but an initial, while every mautrix-bridged conversation
 * beside it in the same list had a picture. WeChat itself keeps them in
 * `head_image.db`, keyed by exactly the ids this bridge already uses for
 * portals and puppets, with the JPEG bytes inline.
 *
 * That database is SQLCipher-encrypted, and the key is one `wechat-use` has
 * already extracted and written to its own key file. So the work here is:
 * decrypt the pages with that key, hand the plaintext to the same `node:sqlite`
 * the rest of the app uses, and read the blobs out. No native module, no
 * additional binary, and nothing is written back — this store is only ever
 * read.
 */

/** SQLCipher 4 defaults, which is what WeChat writes. */
const PAGE_SIZE = 4096;
/** Per page: a 16-byte IV and a 64-byte HMAC-SHA512 kept after the payload. */
const RESERVE = 80;
const SQLITE_MAGIC = "SQLite format 3\0";
/** Where the key `wechat-use` extracted is kept. */
const KEY_FILE = ".wx-rs/keys.json";
const KEY_ENTRY = "head_image/head_image.db";

export interface HeadImageOptions {
  /** Overridable for tests; the user's home directory otherwise. */
  home?: string;
  log?: (message: string) => void;
}

/**
 * Every contact picture WeChat has cached, keyed by the id the rest of the
 * bridge knows a contact or group by. An empty map is the answer whenever
 * anything is missing — WeChat not installed, no key extracted yet, a database
 * this code cannot read — because a missing picture is a fallback to an
 * initial, never a failure worth stopping an import for.
 */
export async function loadHeadImages(
  options: HeadImageOptions = {},
): Promise<Map<string, Uint8Array>> {
  const home = options.home ?? homedir();
  const log = options.log ?? ((): void => {});
  const images = new Map<string, Uint8Array>();
  let files: string[] = [];
  let key: Buffer | null = null;
  try {
    key = await headImageKey(home);
    files = key ? await headImageDatabases(home) : [];
  } catch (error) {
    log(`[wechat] contact pictures unavailable: ${describe(error)}`);
    return images;
  }
  if (!key) return images;
  for (const file of files) {
    // One account at a time, each on its own: a store this cannot read — a
    // WeChat version that moved on, a half-written file, a clone whose key is
    // not the one on record — must not cost the accounts that can be read.
    try {
      const plain = await decryptDatabase(file, key);
      if (!plain) continue;
      for (const [username, bytes] of await readImages(plain)) images.set(username, bytes);
    } catch (error) {
      log(`[wechat] contact pictures unreadable in one account: ${describe(error)}`);
    }
  }
  return images;
}

/** The raw AES key, as `wechat-use` recorded it. */
async function headImageKey(home: string): Promise<Buffer | null> {
  const contents = await readFile(path.join(home, KEY_FILE), "utf8").catch((): null => null);
  if (!contents) return null;
  const parsed = JSON.parse(contents) as {entries?: Record<string, {key_hex?: string}>};
  const hex = parsed.entries?.[KEY_ENTRY]?.key_hex;
  // 32 bytes, or it is not the raw key this expects and guessing would only
  // produce noise further down.
  return hex && /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, "hex") : null;
}

/**
 * The store belongs to a signed-in account, and a Mac can have had several —
 * several WeChats, too, since a clone installs under its own bundle id. All of
 * them are read: a picture found under any account is still the right picture
 * for that contact.
 */
async function headImageDatabases(home: string): Promise<string[]> {
  const containers = path.join(home, "Library/Containers");
  const apps = (await entriesOf(containers))
    // `com.tencent.xinWeChat`, and `…xinWeChat2` and up for the clones a user
    // can run a second account in. The share and file-provider extensions
    // carry the same prefix and hold no store, hence the anchored match.
    .filter((entry) => entry.isDirectory() && /^com\.tencent\.xinWeChat\d*$/.test(entry.name))
    .map((entry) => path.join(containers, entry.name, "Data/Documents/xwechat_files"));
  const databases: string[] = [];
  for (const root of apps)
    for (const account of await entriesOf(root))
      if (account.isDirectory() && account.name.startsWith("wxid_"))
        databases.push(path.join(root, account.name, "db_storage/head_image/head_image.db"));
  return databases;
}

async function entriesOf(directory: string): Promise<Array<{name: string; isDirectory: () => boolean}>> {
  return readdir(directory, {withFileTypes: true}).catch(
    (): Array<{name: string; isDirectory: () => boolean}> => [],
  );
}

/**
 * Turns the encrypted file into a plaintext SQLite one. Each page carries its
 * own IV and keeps its reserved tail; page one begins with the salt where the
 * file header would be, so the header is put back and the reserve is declared
 * in it rather than pages being repacked.
 */
async function decryptDatabase(file: string, key: Buffer): Promise<Buffer | null> {
  const raw = await readFile(file).catch((): null => null);
  if (!raw || raw.length < PAGE_SIZE) return null;
  const pages = Math.floor(raw.length / PAGE_SIZE);
  const out: Buffer[] = [];
  for (let index = 0; index < pages; index += 1) {
    const page = raw.subarray(index * PAGE_SIZE, (index + 1) * PAGE_SIZE);
    const body = page.subarray(index === 0 ? 16 : 0, PAGE_SIZE - RESERVE);
    const iv = page.subarray(PAGE_SIZE - RESERVE, PAGE_SIZE - RESERVE + 16);
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    decipher.setAutoPadding(false);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    out.push(index === 0 ? Buffer.concat([Buffer.from(SQLITE_MAGIC, "binary"), plain]) : plain);
    // The reserved tail is not carried across, but the space has to stay so
    // page offsets still land where the header says they do.
    out.push(Buffer.alloc(RESERVE));
  }
  const database = Buffer.concat(out);
  if (database.subarray(0, 15).toString("binary") !== SQLITE_MAGIC.slice(0, 15)) return null;
  database[20] = RESERVE;
  return database;
}

/**
 * Reads the pictures out of a decrypted copy. `node:sqlite` opens a path
 * rather than bytes, so the plaintext is written to a temporary file and
 * deleted straight after — it is a copy of the user's contact pictures and has
 * no business outliving the read.
 */
async function readImages(database: Buffer): Promise<Array<[string, Uint8Array]>> {
  const file = path.join(
    tmpdir(),
    `polymux-wechat-heads-${process.pid}-${Date.now()}.db`,
  );
  await writeFile(file, database, {mode: 0o600});
  try {
    const store = new DatabaseSync(file, {readOnly: true});
    try {
      const rows = store
        .prepare("SELECT username, image_buffer FROM head_image WHERE image_buffer IS NOT NULL")
        .all() as Array<{username?: string; image_buffer?: Uint8Array}>;
      return rows
        .filter((row) => row.username && row.image_buffer && row.image_buffer.byteLength > 0)
        .map((row) => [row.username as string, row.image_buffer as Uint8Array]);
    } finally {
      store.close();
    }
  } finally {
    await rm(file, {force: true}).catch((): undefined => undefined);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
