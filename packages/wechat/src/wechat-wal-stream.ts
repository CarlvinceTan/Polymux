import {watch} from "node:fs/promises";
import path from "node:path";
import {
  WeChatNativeStore,
  type NativeHistoryRow,
} from "./wechat-native-store.js";

/**
 * The inbound stream, read straight out of WeChat's write-ahead logs.
 *
 * Follows committed rows in the selected account's SQLCipher stores without
 * attaching a debugger. Directory notifications reduce latency; periodic
 * sweeps cover dropped notifications, and cursors retain failed deliveries.
 *
 * Existing chats start at their newest row, with earlier history recovered
 * by the bridge's startup import. Chats discovered while running start at
 * zero so the messages that created their session are delivered too.
 */

/** FSEvents can coalesce or drop directory events, and a poll that finds
 * nothing costs one stat per database, so a slow sweep is the safety net. */
const SWEEP_INTERVAL_MS = 5_000;
/** Commits arrive in bursts (a sync downloads many rows at once); waiting
 * this long after the first event lets the burst land before reading. */
const DEBOUNCE_MS = 80;
/** Rows handed over per chat per pass; a longer burst continues next pass. */
const ROWS_PER_PASS = 200;

export interface WeChatWalMessage {
  chatId: string;
  localId: number;
  serverId: string;
  /** Authored time, in seconds. */
  timestamp: number;
  realSenderId: number | null;
  senderWxid: string | null;
  kind: string;
  body: string | null;
}

export interface WeChatWalWatcherOptions {
  /** The selected account's store. A bridge has one account/portal namespace. */
  stores: WeChatNativeStore[];
  /** New native rows, oldest first within a chat. Backpressure is respected:
   * the next pass waits for the previous delivery to finish. */
  onMessages: (messages: WeChatWalMessage[]) => Promise<void>;
  /** The session or contact stores changed; badges and names are worth a
   * re-read even when no new message row was committed. */
  onDirectory?: () => void;
  /** Existing chats to seed at startup. Register newly discovered chats with
   * addChat so their initial messages are delivered. */
  chats: () => Iterable<string>;
  log?: (message: string) => void;
  /** Overridable for bounded tests. */
  debounceMs?: number;
  sweepIntervalMs?: number;
}

export function nativeRowToMessage(row: NativeHistoryRow, chatId: string): WeChatWalMessage {
  return {
    chatId,
    localId: row.local_id,
    serverId: row.server_id,
    timestamp: row.create_time,
    realSenderId: row.real_sender_id,
    senderWxid: row.sender_wxid,
    kind: row.message_kind,
    body: row.message_content,
  };
}

export class WeChatWalWatcher {
  readonly #options: WeChatWalWatcherOptions;
  // Native local IDs restart in each shard; a chat-wide maximum loses the
  // first rows when WeChat rolls a conversation into a newer database.
  readonly #cursors = new Map<string, Map<string, number>>();
  readonly #registrations = new Map<string, Promise<void>>();
  readonly #keyGenerations = new Map<string, number>();
  #registryRevision = 0;
  /** Abort closes the real watch; its task settles after the iterator exits. */
  readonly #watchers = new Set<{abort: AbortController; task: Promise<void>}>();
  #sweep: ReturnType<typeof setInterval> | null = null;
  #debounce: ReturnType<typeof setTimeout> | null = null;
  /** One refresh pass at a time; the next waits for the previous delivery. */
  #pass: Promise<void> = Promise.resolve();
  #passQueued = false;
  #running = false;
  #startTask: Promise<void> | null = null;
  #stopTask: Promise<void> | null = null;

  constructor(options: WeChatWalWatcherOptions) {
    if (options.stores.length > 1)
      throw new Error("WeChat native inbound requires one selected account store");
    this.#options = options;
  }

  /** Starts following the selected account's message and directory stores. */
  async start(): Promise<void> {
    if (this.#stopTask) await this.#stopTask;
    if (this.#startTask) return await this.#startTask;
    if (this.#running) return;
    this.#running = true;
    const task = this.#startFollowing();
    this.#startTask = task;
    try {
      await task;
    } catch (error) {
      await this.stop();
      throw error;
    } finally {
      if (this.#startTask === task) this.#startTask = null;
    }
  }

  async #startFollowing(): Promise<void> {
    const store = this.#options.stores[0];
    if (store) {
      await store.refreshRegistry().catch(() => {
        this.#log("[wechat] key registry refresh delayed; keeping verified keys");
      });
      this.#registryRevision = store.registryRevision;
      for (const shard of store.messageShards())
        this.#keyGenerations.set(shard, store.keyGeneration(shard));
    }
    for (const chatId of this.#options.chats()) {
      if (!this.#running) return;
      await this.#registerChat(chatId, true);
    }
    if (!this.#running) return;
    for (const store of this.#options.stores)
      for (const directory of this.#watchedDirectories(store))
        this.#follow(directory);
    const sweepInterval = this.#options.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
    this.#sweep = setInterval(() => this.#schedulePass(), sweepInterval);
    this.#sweep.unref?.();
  }

  /** Registers a newly discovered chat, including its first committed rows. */
  async addChat(chatId: string): Promise<void> {
    if (!this.#running) return;
    await this.#registerChat(chatId, false);
    this.#schedulePass();
  }

  async #registerChat(chatId: string, seedExisting: boolean): Promise<void> {
    if (this.#cursors.has(chatId)) return;
    const pending = this.#registrations.get(chatId);
    if (pending) return await pending;
    const task = (async (): Promise<void> => {
      const cursors = new Map<string, number>();
      const store = this.#options.stores[0];
      if (seedExisting && store)
        for (const shard of await store.shardsOf(chatId)) {
          const generation = store.keyGeneration(shard);
          const maximum = await store.maxLocalId(chatId, shard);
          cursors.set(shard, generation === store.keyGeneration(shard) ? maximum : 0);
        }
      if (this.#running && !this.#cursors.has(chatId)) this.#cursors.set(chatId, cursors);
    })();
    this.#registrations.set(chatId, task);
    try {
      await task;
    } finally {
      if (this.#registrations.get(chatId) === task) this.#registrations.delete(chatId);
    }
  }

  #follow(directory: string): void {
    const abort = new AbortController();
    let events: ReturnType<typeof watch>;
    try {
      events = watch(directory, {persistent: false, signal: abort.signal});
    } catch (error) {
      this.#log(`[wechat] cannot watch ${directory}: ${describe(error)}`);
      return;
    }
    const watcher = {abort, task: Promise.resolve()};
    this.#watchers.add(watcher);
    watcher.task = (async (): Promise<void> => {
      try {
        for await (const _ of events) {
          void _;
          this.#schedulePass();
        }
      } catch {
        // A dropped watch is the sweep's to cover; the directory is re-added
        // the next time its account's stores are opened.
      } finally {
        this.#watchers.delete(watcher);
      }
    })();
  }

  /** The stores whose commits can change what the bridge shows. */
  #watchedDirectories(store: WeChatNativeStore): string[] {
    return [
      path.join(store.dbDir, "message"),
      path.join(store.dbDir, "session"),
      path.join(store.dbDir, "contact"),
    ];
  }

  #schedulePass(): void {
    if (!this.#running) return;
    // Bound the wait from the first event. Continuous WAL writes must not
    // keep moving delivery's deadline into the future.
    if (this.#debounce) return;
    this.#debounce = setTimeout(() => {
      this.#debounce = null;
      this.#queuePass();
    }, this.#options.debounceMs ?? DEBOUNCE_MS);
    this.#debounce.unref?.();
  }

  #queuePass(): void {
    if (this.#passQueued) return;
    this.#passQueued = true;
    const previous = this.#pass;
    const pass = previous
      .catch((): undefined => undefined)
      .then(async (): Promise<void> => {
        // Released before the pass runs, so an event arriving while it does
        // queues a follow-up instead of waiting out the sweep.
        this.#passQueued = false;
        await this.#runPass();
      })
      .catch((error: unknown): void =>
        this.#log(`[wechat] inbound pass failed: ${describe(error)}`));
    this.#pass = pass;
  }

  async #runPass(): Promise<void> {
    if (!this.#running) return;
    const messages: WeChatWalMessage[] = [];
    const deliveredCursors = new Map<string, Map<string, number>>();
    let directoryChanged = false;
    let more = false;
    for (const store of this.#options.stores) {
      await store.refreshRegistry().catch(() => {
        this.#log("[wechat] key registry refresh delayed; keeping verified keys");
      });
      // Another history reader may have consumed the reload already. The
      // revision and per-shard generations keep that wake from being lost.
      if (this.#registryRevision !== store.registryRevision) {
        directoryChanged = true;
        this.#registryRevision = store.registryRevision;
      }
      for (const shard of store.messageShards()) {
        const generation = store.keyGeneration(shard);
        const previous = this.#keyGenerations.get(shard);
        if (previous !== undefined && previous !== generation)
          for (const cursors of this.#cursors.values()) cursors.delete(shard);
        this.#keyGenerations.set(shard, generation);
      }
      for (const entry of ["session/session.db", "contact/contact.db"]) {
        if (!store.has(entry)) continue;
        const changed = await store.snapshot(entry)
          .then(snapshot => snapshot.refresh()).catch(() => false);
        if (changed) directoryChanged = true;
      }
      // A history read can refresh the same snapshot first, and a large
      // commit needs several passes. Cursor progress, not refresh's boolean,
      // determines whether anything remains to deliver.
      const byChat = new Map<string, {messages: WeChatWalMessage[]; shard: string; cursor: number}[]>();
      for (const shard of store.messageShards()) {
        if (!this.#running) return;
        const cursors = new Map<string, number>();
        for (const [chatId, chatCursors] of this.#cursors)
          cursors.set(chatId, chatCursors.get(shard) ?? 0);
        const rowsByChat = await store.rowsSinceForChats(shard, cursors, ROWS_PER_PASS);
        for (const [chatId, rows] of rowsByChat) {
          if (!rows.length) continue;
          const current = this.#cursors.get(chatId);
          if (!current) continue;
          const batch = byChat.get(chatId) ?? [];
          batch.push({
            messages: rows.map((row) => nativeRowToMessage(row, chatId)),
            shard,
            cursor: rows[rows.length - 1].local_id,
          });
          byChat.set(chatId, batch);
          if (rows.length >= ROWS_PER_PASS) more = true;
        }
      }
      for (const [chatId, cursors] of this.#cursors) {
        const batches = byChat.get(chatId);
        if (!batches?.length) continue;
        const next = new Map(cursors);
        const chatMessages: WeChatWalMessage[] = [];
        for (const batch of batches) {
          next.set(batch.shard, batch.cursor);
          chatMessages.push(...batch.messages);
        }
        deliveredCursors.set(chatId, next);
        messages.push(...chatMessages.sort((a, b) => a.timestamp - b.timestamp || a.localId - b.localId));
      }
    }
    let delivered = true;
    if (messages.length) {
      if (!this.#running) return;
      try {
        await this.#options.onMessages(messages);
        for (const [chatId, cursor] of deliveredCursors) this.#cursors.set(chatId, cursor);
      } catch (error) {
        delivered = false;
        this.#log(`[wechat] inbound delivery failed: ${describe(error)}`);
      }
    }
    if (directoryChanged) this.#options.onDirectory?.();
    // A burst longer than one pass continues immediately instead of sitting
    // out the next directory event.
    if (more && delivered) this.#schedulePass();
  }

  async stop(): Promise<void> {
    if (this.#stopTask) return await this.#stopTask;
    const task = this.#stopFollowing();
    this.#stopTask = task;
    try {
      await task;
    } finally {
      if (this.#stopTask === task) this.#stopTask = null;
    }
  }

  async #stopFollowing(): Promise<void> {
    this.#running = false;
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = null;
    if (this.#sweep) clearInterval(this.#sweep);
    this.#sweep = null;
    // Startup may be awaiting a snapshot. It checks #running before adding
    // any watches or sweep, so stopping during that await cannot revive it.
    await this.#startTask?.catch((): undefined => undefined);
    const watchers = [...this.#watchers];
    for (const watcher of watchers) watcher.abort.abort();
    await Promise.all(watchers.map(watcher => watcher.task));
    await this.#pass.catch((): undefined => undefined);
    await Promise.all([...this.#registrations.values()]
      .map(task => task.catch((): undefined => undefined)));
    this.#cursors.clear();
    this.#keyGenerations.clear();
    this.#registryRevision = 0;
  }

  #log(message: string): void {
    this.#options.log?.(message);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
