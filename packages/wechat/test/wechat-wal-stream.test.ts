import assert from "node:assert/strict";
import fs, {mkdir, mkdtemp, rm} from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import test, {type TestContext} from "node:test";
import {type NativeHistoryRow, type WeChatNativeStore} from "../src/wechat-native-store.js";
import {WeChatWalWatcher, type WeChatWalMessage} from "../src/wechat-wal-stream.js";

const SHARD = "message/message_0.db";
const realWatch = fs.watch;

async function until(check: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!check() && Date.now() < deadline) await delay(5);
  assert.ok(check(), `timed out waiting for ${description}`);
}

function row(localId: number): NativeHistoryRow {
  return {
    local_id: localId,
    server_id: String(localId),
    local_type: 1,
    create_time: 1_788_650_000 + localId,
    real_sender_id: 2,
    sender_wxid: "wxid_fixture_peer",
    message_kind: "text",
    message_content: `message ${localId}`,
  };
}

async function fixture(
  context: TestContext,
  options: {
    chats?: string[];
    onMessages?: (messages: WeChatWalMessage[]) => Promise<void>;
    beforeSeed?: () => Promise<void>;
    debounceMs?: number;
    sweepIntervalMs?: number;
  } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), "wechat-wal-regression-"));
  await Promise.all(["message", "session", "contact"].map(name =>
    mkdir(path.join(directory, name))));
  const cleanupAbort = new AbortController();
  let openWatches = 0;
  let closedWatches = 0;
  // Keep the operating-system watches real while retaining a cleanup signal
  // independent of the implementation. A broken stop() must not leak loops
  // from the failing baseline into the following tests.
  const watchMock = context.mock.method(fs, "watch", (
    filename: string,
    watchOptions: {persistent?: boolean; signal?: AbortSignal} = {},
  ) => {
    const signal = watchOptions.signal
      ? AbortSignal.any([watchOptions.signal, cleanupAbort.signal])
      : cleanupAbort.signal;
    const events = realWatch(filename, {...watchOptions, signal});
    return (async function* () {
      openWatches += 1;
      try { yield* events; }
      finally { closedWatches += 1; }
    })();
  });
  syncBuiltinESMExports();

  const shardRows = new Map<string, Map<string, NativeHistoryRow[]>>([[SHARD, new Map()]]);
  const received: WeChatWalMessage[] = [];
  let changed = false;
  let refreshes = 0;
  let batchReads = 0;
  let registryRevision = 0;
  const keyGenerations = new Map<string, number>();
  let pendingRegistryUpdate: (() => void) | undefined;
  let directoryChanges = 0;
  const refresh = async (): Promise<boolean> => {
    refreshes += 1;
    const answer = changed;
    changed = false;
    return answer;
  };
  const store = {
    wxid: "wxid_fixture_account",
    dbDir: directory,
    has: () => false,
    get registryRevision() {return registryRevision;},
    keyGeneration: (entry: string) => keyGenerations.get(entry) ?? 0,
    refreshRegistry: async () => {
      const update = pendingRegistryUpdate;
      pendingRegistryUpdate = undefined;
      update?.();
      return Boolean(update);
    },
    messageShards: () => [...shardRows.keys()],
    shardsOf: async (chatId: string) => [...shardRows].filter(([, rows]) => rows.has(chatId)).map(([shard]) => shard),
    maxLocalId: async (chatId: string, shard: string) => {
      await options.beforeSeed?.();
      await refresh();
      return shardRows.get(shard)?.get(chatId)?.at(-1)?.local_id ?? 0;
    },
    snapshot: async () => ({refresh}),
    rowsSinceForChats: async (shard: string, cursors: ReadonlyMap<string, number>, limit: number) => {
      batchReads += 1;
      await refresh();
      return new Map([...cursors].flatMap(([chatId, cursor]) => {
        const rows = shardRows.get(shard)?.get(chatId);
        return rows ? [[chatId, rows.filter(item => item.local_id > cursor).slice(0, limit)] as const] : [];
      }));
    },
  } as unknown as WeChatNativeStore;
  const watcher = new WeChatWalWatcher({
    stores: [store],
    chats: () => options.chats ?? ["filehelper"],
    onMessages: options.onMessages ?? (async messages => {received.push(...messages);}),
    onDirectory: () => {directoryChanges += 1;},
    debounceMs: options.debounceMs ?? 1,
    sweepIntervalMs: options.sweepIntervalMs ?? 10,
  });
  context.after(async () => {
    cleanupAbort.abort();
    await until(() => closedWatches === openWatches, "fixture watches to close");
    await watcher.stop();
    watchMock.mock.restore();
    syncBuiltinESMExports();
    await rm(directory, {recursive: true, force: true});
  });
  return {
    watcher, received, refresh,
    refreshRegistry: store.refreshRegistry,
    provision(shard: string, chatId: string, rows: NativeHistoryRow[]): void {
      pendingRegistryUpdate = () => {
        shardRows.set(shard, new Map([[chatId, rows]]));
        keyGenerations.set(shard, (keyGenerations.get(shard) ?? 0) + 1);
        registryRevision += 1;
      };
    },
    get directoryChanges() {return directoryChanges;},
    commit(chatId: string, committed: NativeHistoryRow[], shard = SHARD): void {
      const rows = shardRows.get(shard) ?? new Map<string, NativeHistoryRow[]>();
      rows.set(chatId, committed);
      shardRows.set(shard, rows);
      changed = true;
    },
    get refreshes() {return refreshes;},
    get batchReads() {return batchReads;},
    get openWatches() {return openWatches;},
    get closedWatches() {return closedWatches;},
  };
}

test("a single native commit drains every row beyond the first 200", async context => {
  const current = await fixture(context);
  await current.watcher.start();
  current.commit("filehelper", Array.from({length: 450}, (_, index) => row(index + 1)));
  await until(() => current.received.length === 450, "all 450 committed messages");
  assert.deepEqual(current.received.map(message => message.localId),
    Array.from({length: 450}, (_, index) => index + 1));
});

test("a new shard drains restarted local IDs and retries without replaying seeded history", async context => {
  let attempts = 0;
  const received: WeChatWalMessage[] = [];
  const current = await fixture(context, {onMessages: async messages => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary downstream failure");
    received.push(...messages);
  }});
  current.commit("filehelper", [row(450)]);
  await current.watcher.start();
  current.commit("filehelper", Array.from({length: 225}, (_, index) => ({
    ...row(index + 1), server_id: String(10_000 + index), create_time: 1_788_660_000 + index,
  })), "message/message_1.db");
  await until(() => received.length === 225, "all rows after shard rollover");
  assert.deepEqual(received.map(message => message.localId), Array.from({length: 225}, (_, i) => i + 1));
  assert.equal(attempts, 3, "one failed first batch, its retry, then the remaining rows");
  current.commit("filehelper", [row(450), {...row(451), server_id: "20000"}]);
  await until(() => received.length === 226, "a subsequent commit in the older shard");
  assert.equal(received.at(-1)?.localId, 451);
});

test("history refreshing the shared snapshot cannot consume an inbound wake", async context => {
  const current = await fixture(context);
  await current.watcher.start();
  current.commit("filehelper", [row(1)]);
  assert.equal(await current.refresh(), true, "an ordinary history read refreshes first");
  await until(() => current.received.length === 1, "the row already in the refreshed snapshot");
  assert.equal(current.received[0].localId, 1);
});

test("registry provisioning discovers a new shard without restarting the watcher", async context => {
  const current = await fixture(context);
  current.commit("filehelper", [row(450)]);
  await current.watcher.start();
  current.provision("message/message_1.db", "filehelper", [
    {...row(1), server_id: "5001"}, {...row(2), server_id: "5002"},
  ]);
  await until(() => current.received.length === 2, "the newly provisioned shard");
  assert.deepEqual(current.received.map(message => message.serverId), ["5001", "5002"]);
  assert.ok(current.directoryChanges > 0);
});

test("a key rotation consumed by a history reader still resets the stream's shard cursor", async context => {
  const current = await fixture(context);
  current.commit("filehelper", [row(450)]);
  await current.watcher.start();
  current.provision(SHARD, "filehelper", [
    {...row(1), server_id: "6001"}, {...row(2), server_id: "6002"},
  ]);
  await current.refreshRegistry();
  await until(() => current.received.length === 2, "restarted row IDs after key rotation");
  assert.deepEqual(current.received.map(message => message.serverId), ["6001", "6002"]);
  const reads = current.batchReads;
  await until(() => current.batchReads > reads + 2, "subsequent sweeps");
  assert.equal(current.received.length, 2);
  assert.ok(current.directoryChanges > 0);
});

test("a failed downstream delivery retries before committing its cursor", async context => {
  let attempts = 0;
  const delivered: number[] = [];
  const current = await fixture(context, {onMessages: async messages => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary Matrix failure");
    delivered.push(...messages.map(message => message.localId));
  }});
  await current.watcher.start();
  current.commit("filehelper", [row(1), row(2)]);
  await until(() => delivered.length === 2, "retry of the unacknowledged batch");
  assert.equal(attempts, 2);
  assert.deepEqual(delivered, [1, 2]);
  const afterDelivery = current.refreshes;
  await until(() => current.refreshes >= afterDelivery + 3, "three subsequent refreshes");
  assert.equal(attempts, 2, "successfully acknowledged rows cannot replay each sweep");
});

test("an idle pass reads once per shard rather than once per chat", async context => {
  const chats = Array.from({length: 100}, (_, index) => `wxid_peer_${index}`);
  const current = await fixture(context, {chats, sweepIntervalMs: 1_000_000});
  for (const chatId of chats) current.commit(chatId, []);
  await current.watcher.start();
  current.commit("wxid_new_peer", [row(1)]);
  current.commit("wxid_new_peer", [{...row(2), server_id: "20002"}], "message/message_1.db");
  await current.watcher.addChat("wxid_new_peer");
  await until(() => current.received.length === 2, "rows from both shards");
  assert.equal(current.batchReads % 2, 0, "every completed pass reads both shards once");
  assert.ok(current.batchReads <= 4, "watch startup can queue at most one extra two-shard pass");
  assert.ok(current.batchReads < chats.length, "batch reads remain independent of chat count");
});

test("late chat registration delivers its first rows while startup seeds history", async context => {
  const current = await fixture(context);
  current.commit("filehelper", [row(1), row(2)]);
  await current.watcher.start();
  current.commit("wxid_new_peer", [row(1), row(2), row(3)]);
  await current.watcher.addChat("wxid_new_peer");
  await until(() => current.received.length === 3, "the new chat's initial messages");
  assert.deepEqual(current.received.map(message => [message.chatId, message.localId]), [
    ["wxid_new_peer", 1], ["wxid_new_peer", 2], ["wxid_new_peer", 3],
  ]);
});

test("stopping the watcher closes every real directory watch", async context => {
  const current = await fixture(context);
  await current.watcher.start();
  await until(() => current.openWatches === 3, "all three directory watches");
  await current.watcher.stop();
  assert.equal(current.closedWatches, 3, "stop waits for the watch loops to finish");
  const afterStop = current.refreshes;
  current.commit("filehelper", [row(1)]);
  await delay(35);
  assert.equal(current.refreshes, afterStop, "the stopped sweep cannot read stores");
  assert.deepEqual(current.received, []);
});

test("continuous wakeups cannot postpone the debounce deadline", async context => {
  // A sweep arriving before the debounce expires exercises the same repeated
  // wakeups as a busy directory, without depending on event coalescing.
  const current = await fixture(context, {debounceMs: 30, sweepIntervalMs: 5});
  await current.watcher.start();
  current.commit("filehelper", [row(1)]);
  await until(() => current.received.length === 1, "delivery during continuous wakeups");
});

test("concurrent registration preserves a startup cursor being seeded", async context => {
  let release = (): void => {};
  let seeding = false;
  const seed = new Promise<void>(resolve => {release = resolve;});
  const current = await fixture(context, {beforeSeed: async () => {
    seeding = true;
    await seed;
  }});
  current.commit("filehelper", [row(1)]);
  const starting = current.watcher.start();
  try {
    await until(() => seeding, "the initial cursor read");
    const registering = current.watcher.addChat("filehelper");
    release();
    await Promise.all([starting, registering]);
    current.commit("filehelper", [row(1), row(2)]);
    await until(() => current.received.length > 0, "the next live message");
    assert.deepEqual(current.received.map(message => message.localId), [2]);
  } finally {
    release();
    await starting;
  }
});

test("stop during initial seeding cannot install watches or revive the sweep", async context => {
  let release = (): void => {};
  let seeding = false;
  const seed = new Promise<void>(resolve => {release = resolve;});
  const current = await fixture(context, {beforeSeed: async () => {
    seeding = true;
    await seed;
  }});
  current.commit("filehelper", [row(1)]);
  const starting = current.watcher.start();
  try {
    await until(() => seeding, "a pending initial cursor read");
    const stopping = current.watcher.stop();
    release();
    await Promise.all([starting, stopping]);
    assert.equal(current.openWatches, 0);
    const afterStop = current.refreshes;
    await delay(35);
    assert.equal(current.refreshes, afterStop);
    assert.deepEqual(current.received, []);
  } finally {
    release();
    await starting;
  }
});

test("stop waits for an in-flight message delivery", async context => {
  let release = (): void => {};
  let delivering = false;
  const delivery = new Promise<void>(resolve => {release = resolve;});
  const current = await fixture(context, {onMessages: async () => {
    delivering = true;
    await delivery;
  }});
  await current.watcher.start();
  current.commit("filehelper", [row(1)]);
  try {
    await until(() => delivering, "the delivery callback");
    let stopped = false;
    const stopping = current.watcher.stop().then(() => {stopped = true;});
    await until(() => current.closedWatches === 3, "watches closing during delivery");
    assert.equal(stopped, false, "stop must wait for the callback before stores close");
    release();
    await stopping;
    assert.equal(stopped, true);
  } finally {
    release();
  }
});

test("a watcher refuses to mix independent accounts in one cursor namespace", () => {
  assert.throws(() => new WeChatWalWatcher({
    stores: [{}, {}] as WeChatNativeStore[],
    chats: () => [],
    onMessages: async () => {},
  }), /one selected account/);
});
