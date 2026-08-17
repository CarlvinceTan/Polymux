import assert from "node:assert/strict";
import {copyFile, mkdir, mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {loadHeadImages} from "./wechat-head-images.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures", "wechat");

/**
 * Lays out a fake home the way a Mac with WeChat and `wechat-use` on it looks:
 * the app's encrypted picture store where WeChat keeps it, and the key where
 * the CLI wrote it. The fixture database is a real SQLCipher file, so the
 * decryption this exercises is the real thing rather than a stand-in.
 */
async function withHome(
  body: (home: string) => Promise<void>,
  options: {key?: string; database?: boolean} = {},
): Promise<void> {
  const home = await mkdtemp(path.join(tmpdir(), "flareai-heads-"));
  const account = path.join(
    home,
    "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_owner_1234",
    "db_storage/head_image",
  );
  await mkdir(account, {recursive: true});
  if (options.database !== false)
    await copyFile(path.join(fixtures, "head_image.db"), path.join(account, "head_image.db"));
  const key = options.key ?? (await readFile(path.join(fixtures, "head_image.key"), "utf8")).trim();
  await mkdir(path.join(home, ".wx-rs"), {recursive: true});
  await writeFile(
    path.join(home, ".wx-rs", "keys.json"),
    JSON.stringify({entries: {"head_image/head_image.db": {key_hex: key}}}),
  );
  await body(home);
}

test("reads WeChat's own contact pictures, contacts and groups alike", async () => {
  await withHome(async (home) => {
    const images = await loadHeadImages({home});
    // Keyed by the same ids the bridge uses for portals and puppets, which is
    // what lets a picture be found for a conversation at all.
    assert.deepEqual([...images.keys()].sort(), ["44161457724@chatroom", "wxid_friend"]);
    const face = images.get("wxid_friend")!;
    assert.equal(face[0], 0xff);
    assert.equal(face[1], 0xd8, "the bytes are a JPEG, ready to upload as-is");
  });
});

test("a home with no key, or the wrong one, yields no pictures rather than failing", async () => {
  // A Mac without WeChat, or one where `wechat-use init` has not run, is the
  // ordinary case; an initial in the list is the answer, not an error.
  await withHome(
    async (home) => assert.equal((await loadHeadImages({home})).size, 0),
    {key: "00".repeat(32)},
  );
  await withHome(async (home) => assert.equal((await loadHeadImages({home})).size, 0), {
    database: false,
  });
  const bare = await mkdtemp(path.join(tmpdir(), "flareai-heads-bare-"));
  assert.equal((await loadHeadImages({home: bare})).size, 0);
});
