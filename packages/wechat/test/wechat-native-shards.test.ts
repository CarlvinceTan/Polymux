import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import {WeChatNativeStore, weChatMessageTable, type SqlcipherLiveSnapshot} from "../src/wechat-native-store.js";

test("native history merges shards while keeping sender identity and local cursors in their own file", async context => {
  const oldShard = "message/message_0.db";
  const newShard = "message/message_1.db";
  const databases = new Map([oldShard, newShard].map(shard => [shard, new DatabaseSync(":memory:")]));
  let refreshes = 0;
  let queries = 0;
  context.after(() => {for (const database of databases.values()) database.close();});
  const store = new WeChatNativeStore({wxid: "wxid_self", dbDir: "/unused",
    keys: new Map([...databases.keys()].map(shard => [shard, Buffer.alloc(32)]))});
  context.mock.method(store, "snapshot", async (shard: string) => ({
    refresh: async () => {refreshes += 1; return false;},
    query: async <T>(read: (database: DatabaseSync) => T): Promise<T> => {
      queries += 1;
      return read(databases.get(shard)!);
    },
  }) as unknown as SqlcipherLiveSnapshot);
  const createChat = (shard: string, chat = "filehelper"): void => {
    databases.get(shard)!.exec(`CREATE TABLE ${weChatMessageTable(chat)} (
      local_id INTEGER, server_id TEXT, local_type INTEGER, create_time INTEGER,
      real_sender_id INTEGER, message_content TEXT, WCDB_CT_message_content INTEGER)`);
  };
  const insert = (shard: string, localId: number, serverId: string, time: number, body: string): void => {
    databases.get(shard)!.prepare(`INSERT INTO ${weChatMessageTable("filehelper")} VALUES (?, ?, 1, ?, 2, ?, 0)`)
      .run(localId, serverId, time, body);
  };
  for (const [shard, database] of databases) {
    database.exec("CREATE TABLE Name2Id (user_name TEXT)");
    database.prepare("INSERT INTO Name2Id (rowid,user_name) VALUES (2,?)")
      .run(shard === oldShard ? "wxid_old_sender" : "wxid_new_sender");
  }
  createChat(oldShard);
  insert(oldShard, 450, "9007199254740993", 100, "August");
  assert.deepEqual(await store.shardsOf("filehelper"), [oldShard]);
  createChat(newShard); // A table created after the first lookup must be found.
  insert(newShard, 1, "9007199254740994", 200, "September");
  insert(oldShard, 449, "9007199254740995", 99, "old duplicate");
  insert(newShard, 2, "9007199254740995", 199, "new duplicate");
  insert(oldShard, 451, "0", 201, "old pending");
  insert(newShard, 3, "0", 202, "new pending");
  assert.deepEqual(await store.shardsOf("filehelper"), [oldShard, newShard]);
  const history = await store.historyPage("filehelper", {limit: 10});
  assert.deepEqual(history.map(row => [row.message_content, row.local_id, row.sender_wxid]), [
    ["new pending", 3, "wxid_new_sender"], ["old pending", 451, "wxid_old_sender"],
    ["September", 1, "wxid_new_sender"], ["new duplicate", 2, "wxid_new_sender"],
    ["August", 450, "wxid_old_sender"],
  ]);
  assert.deepEqual((await store.historyPage("filehelper", {limit: 2, until: 201}))
    .map(row => row.server_id), ["9007199254740994", "9007199254740995"]);
  assert.equal(await store.maxLocalId("filehelper", oldShard), 451);
  assert.equal(await store.maxLocalId("filehelper", newShard), 3);
  assert.deepEqual((await store.rowsSince("filehelper", 1, 200, newShard)).map(row => row.local_id), [2, 3]);
  assert.deepEqual((await store.rowsSince("filehelper", 450, 200, oldShard)).map(row => row.local_id), [451]);
  const beforeBatch = {refreshes, queries};
  const batched = await store.rowsSinceForChats(newShard, new Map([
    ["filehelper", 1],
    ["wxid_missing", 0],
  ]));
  assert.deepEqual(batched.get("filehelper")?.map(row => row.local_id), [2, 3]);
  assert.equal(batched.has("wxid_missing"), false);
  assert.deepEqual(
    {refreshes: refreshes - beforeBatch.refreshes, queries: queries - beforeBatch.queries},
    {refreshes: 1, queries: 1},
  );
  await assert.rejects(store.rowsSince("filehelper", 0, 200, "contact/contact.db"), /shard is invalid/);
});
