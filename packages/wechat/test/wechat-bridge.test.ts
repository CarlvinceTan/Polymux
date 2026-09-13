import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import { Homeserver, MatrixHub } from "@polymux/hub";
import {
  daemonUsesCaptureScript,
  childProcessIsRunning,
  WeChatBridge,
  relayEnvironment,
  settleWeChatWrite,
  weChatWriterFailureMessage,
  weChatDaemonPid,
  weChatRelayListenerPid,
  type WeChatWriteRequest,
} from "../src/wechat-bridge.js";
import type {NativeHistoryRow, WeChatConversation, WeChatNativeStore} from "../src/wechat-native-store.js";

import {
  setupGuidance,
  setupHint,
  WECHAT_DOWNLOAD_URL,
  WECHAT_DOWNLOAD_URLS,
  weChatDownloadUrl,
} from "../src/wechat-relay.js";

const noDeviceOptions = {
  cliPaths: [] as string[],
  relayToken: null as null,
  headImages: async () => new Map<string, Uint8Array>(),
};

test("native WeChat failure codes become actionable messages", () => {
  assert.equal(
    weChatWriterFailureMessage("wechat_model_recipient_changed", "text"),
    "Message not sent. Open this conversation in WeChat Desktop, then try again.",
  );
  assert.equal(
    weChatWriterFailureMessage("wechat_not_running", "media"),
    "Open WeChat and make sure you are signed in, then try again.",
  );
  assert.equal(
    weChatWriterFailureMessage("wechat_interactive_sign_in_required", "text"),
    "WeChat needs one phone confirmation before Polymux can reconnect.",
  );
  assert.equal(
    weChatWriterFailureMessage("native delivery rejected", "media"),
    "native delivery rejected",
  );
  assert.equal(
    weChatWriterFailureMessage(undefined, "media"),
    "WeChat did not verify the media operation",
  );
});

test("the native group directory includes silent members and preserves mention identities", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wechat-member-fixture-"));
  const cli = path.join(directory, "reader");
  await writeFile(cli, `#!/usr/bin/env node
const command = process.argv[2];
process.stdout.write(JSON.stringify(command === 'accounts'
  ? {default:['com.tencent.xinWeChat','wxid_me'], accounts:[{wxid:'wxid_old'},{wxid:'wxid_me'}]}
  : command === 'members' ? [
    {wxid:'wxid_silent', display_name:'Old Name', group_nickname:'Group Name'},
    {wxid:'wxid_me', display_name:'Me'},
    {wxid:'wxid_alex', display_name:'Alex'}
  ] : {rows:[]}));
`, {mode: 0o755});
  await withBridge(async ({hub, bridge, relay}) => {
    relay.emit({messageId: "group-opener", chatId: "fixture@chatroom", isGroup: true,
      senderId: "wxid_alex", body: "hello", timestamp: 1});
    const [room] = await roomsWhen(hub, (rooms) => rooms.length === 1, "the group portal");
    await threadWhen(hub, ({messages}) => messages.some((item) => item.body === "hello"), "the group message");
    const members = await bridge.members(room.roomId);
    assert.deepEqual(members?.map((member) => member.name), ["Alex", "Group Name"]);
    assert.ok(members?.every((member) => member.userId.startsWith("@wechat_")));
  }, undefined, {cliPaths: [cli]});
});

test("a verified write stays successful when relay recovery is delayed", () => {
  const result = {deliveredVerified: true, messageId: "server-ack"};
  assert.deepEqual(
    settleWeChatWrite(result, undefined, new Error("relay restart failed")),
    {result, retryRelay: true},
  );
  assert.throws(
    () => settleWeChatWrite(undefined, new Error("send failed"), undefined),
    /send failed/,
  );
});

test("a signal-terminated relay is not treated as a running child", () => {
  assert.equal(
    childProcessIsRunning({exitCode: null, signalCode: null}),
    true,
  );
  assert.equal(
    childProcessIsRunning({exitCode: 1, signalCode: null}),
    false,
  );
  assert.equal(
    childProcessIsRunning({exitCode: null, signalCode: "SIGTERM"}),
    false,
  );
});

test("the loopback relay listener is accepted only when it is unambiguous", () => {
  assert.equal(weChatRelayListenerPid("15019\n"), 15019);
  assert.equal(weChatRelayListenerPid("15019\n15020\n"), null);
  assert.equal(weChatRelayListenerPid("not a pid"), null);
});

/**
 * The relay, stubbed. Everything the bridge needs from the WeChat side is
 * loopback HTTP plus an SSE stream, so a fake one exercises the whole bridge
 * without a WeChat account — and without sending anything to a real person.
 */
interface Relay {
  server: Server;
  url: string;
  /** Payloads the bridge asked the relay to send outward. */
  sent: Array<{ chatId?: string; message?: string }>;
  /** Optional queued `/send` answers; success is the default. */
  sendResults: Array<Record<string, unknown>>;
  /** Controls whether `/health` advertises a warmed outbound signal chain. */
  setHijackArmed: (armed: boolean | undefined) => void;
  /** Models the desktop process independently from the long-lived relay. */
  setWeChatAttached: (attached: boolean) => void;
  /** Fixture-only exact process advertised by `/health`. */
  setWeChatPid: (pid: number | undefined) => void;
  /** What `/chats` answers, and the history each chat hands back on import. */
  catalogue: { chats: unknown[]; history: Record<string, unknown[]> };
  /** Explicit limits requested from the relay's default-20 session list. */
  chatListLimits: number[];
  /** Chat ids in the order their import pages were requested. */
  historyRequests: string[];
  /** How many times the bridge has opened the stream, reconnects included. */
  connections: number;
  /** Pushes one message down the stream, as a new WeChat message would arrive. */
  emit: (message: Record<string, unknown> | Record<string, unknown>[]) => void;
  /** Ends the stream as a network blip would, so the bridge reconnects. */
  dropStream: () => void;
  /** Reports WeChat disconnected and ends the stream permanently. */
  disconnect: () => void;
  /** Removes the relay listener entirely, as a crashed local child would. */
  vanish: () => Promise<void>;
  /** Makes the relay report connected again after a hidden app relaunch. */
  reconnect: () => void;
  /** Resolves once the bridge has actually subscribed to the stream. */
  connected: () => Promise<void>;
}

async function stubRelay(): Promise<Relay> {
  const sent: Relay["sent"] = [];
  const catalogue: Relay["catalogue"] = { chats: [], history: {} };
  const historyRequests: string[] = [];
  const chatListLimits: number[] = [];
  let connections = 0;
  let stream: ServerResponse | null = null;
  let health = "connected";
  let hijackArmed: boolean | undefined;
  let wechatPid: number | undefined = 42_424;
  const sendResults: Array<Record<string, unknown>> = [];
  const server = createServer((request, response) => {
    const reply = (body: unknown): void => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const url = request.url ?? "/";
    if (url.startsWith("/health"))
      return reply({
        status: health,
        ...(hijackArmed === undefined ? {} : {hijackArmed}),
        ...(wechatPid === undefined ? {} : {wechatPid}),
      });
    if (url.startsWith("/chats")) {
      const limit = Number(new URL(url, "http://relay").searchParams.get("limit") ?? 20);
      chatListLimits.push(limit);
      return reply({rows: catalogue.chats.slice(0, limit)});
    }
    if (url.startsWith("/sticker.gif")) {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      // A real GIF header: the CDN labels everything octet-stream, so the
      // bytes are what the bridge has to read the type from.
      return response.end(
        Buffer.from("GIF89a" + "\u0000".repeat(20), "binary"),
      );
    }
    if (url.startsWith("/face.jpg")) {
      response.writeHead(200, { "Content-Type": "image/jpeg" });
      return response.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }
    if (url.startsWith("/unread")) return reply([]);
    const history = /^\/chat\/([^/]+)\/history/.exec(url);
    if (history) {
      const chatId = decodeURIComponent(history[1]);
      historyRequests.push(chatId);
      const query = new URL(url, "http://localhost").searchParams;
      const until = Number(query.get("until")) || Infinity;
      const limit = Number(query.get("limit")) || 50;
      const rows = (catalogue.history[chatId] ?? []) as Array<{timestamp?: number; create_time?: number}>;
      return reply(rows.filter((row) => Number(row.timestamp ?? row.create_time) < until)
        .sort((a, b) => Number(b.timestamp ?? b.create_time) - Number(a.timestamp ?? a.create_time))
        .slice(0, limit));
    }
    if (url.startsWith("/messages/stream")) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      connections += 1;
      stream = response;
      return;
    }
    if (request.method === "POST" && url.startsWith("/send")) {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk as Buffer));
      request.on("end", () => {
        sent.push(
          JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          ) as Relay["sent"][number],
        );
        reply(sendResults.shift() ?? { success: true, delivered_verified: true });
      });
      return;
    }
    response.writeHead(404);
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    sent,
    sendResults,
    setHijackArmed: (armed) => {
      hijackArmed = armed;
    },
    setWeChatAttached: (attached) => {
      wechatPid = attached ? 42_424 : undefined;
    },
    setWeChatPid: (pid) => {
      wechatPid = pid;
    },
    catalogue,
    historyRequests,
    chatListLimits,
    get connections() {
      return connections;
    },
    emit: (message) => stream?.write(`data: ${JSON.stringify(message)}\n\n`),
    dropStream: () => {
      stream?.end();
      stream = null;
    },
    disconnect: () => {
      health = "disconnected";
      wechatPid = undefined;
      stream?.end();
      stream = null;
    },
    vanish: async () => {
      stream?.end();
      stream = null;
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()),
      );
    },
    reconnect: () => {
      health = "connected";
      wechatPid = 42_424;
    },
    // Emitting before the bridge has subscribed writes into nothing, so every
    // test waits for the subscription rather than for a guessed delay.
    connected: async () => {
      for (let attempt = 0; attempt < 100 && !stream; attempt += 1)
        await new Promise((resolve) => setTimeout(resolve, 20));
      if (!stream)
        throw new Error("the bridge never subscribed to the relay stream");
    },
  };
}

async function withBridge(
  body: (context: {
    bridge: WeChatBridge;
    hub: MatrixHub;
    relay: Relay;
    homeserver: Homeserver;
    accessToken: string;
    directory: string;
  }) => Promise<void>,
  /** Runs before the bridge starts, for state its initial import should find. */
  prepare?: (relay: Relay) => void,
  /** Bridge options a test needs to differ, e.g. the image-retry cadence. */
  overrides: Partial<ConstructorParameters<typeof WeChatBridge>[0]> = {},
  /** Native inbound intentionally never connects to the fixture's SSE. */
  awaitRelay = true,
): Promise<void> {
  const relay = await stubRelay();
  prepare?.(relay);
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-"));
  // No port: the OS picks a free one and the harness reads it back off the
  // server. Counting up from a fixed base made two test files run at once
  // fight over the same numbers, which fails as a bridge error rather than as
  // anything to do with the bridge.
  const homeserver = new Homeserver({
    serverName: "polymux.local",
    dataDirectory: directory,
  });
  await homeserver.start();
  const owner = homeserver.createLocalUser("polymux-test");
  // No binary directories: these tests must never spawn the real relay or
  // touch the WeChat app on the machine running them.
  const bridge = new WeChatBridge({
    ...noDeviceOptions,
    homeserver,
    directory,
    relayUrl: relay.url,
    binaryDirectories: [],
    log: (line) => {
      if (process.env.WECHAT_TEST_LOG) console.log(line);
    },
    ...overrides,
  });
  await bridge.start(owner.userId);
  const hub = new MatrixHub({
    baseUrl: homeserver.baseUrl,
    homeserverUrl: homeserver.baseUrl,
    directory,
    embedded: true,
    auth: () => ({ matrixToken: owner.accessToken, userId: owner.userId }),
  });
  try {
    if (awaitRelay) await relay.connected();
    await body({
      bridge,
      hub,
      relay,
      homeserver,
      accessToken: owner.accessToken,
      directory,
    });
  } finally {
    await bridge.close();
    if (relay.server.listening) relay.server.close();
    await homeserver.close();
  }
}

/** Native schema-shaped rows backed only by temporary test directories. */
async function nativeInboundFixture(options: {
  snapshotError?: string;
  wxid?: string;
  senderIdForChat?: (chatId: string) => string;
  timestamp?: number;
} = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "wechat-native-bridge-fixture-"));
  await Promise.all(["message", "session", "contact"].map(name =>
    mkdir(path.join(directory, name))));
  const chats = new Map<string, WeChatConversation>();
  const rows = new Map<string, NativeHistoryRow[]>();
  let reads = 0;
  let snapshots = 0;
  let wake = 0;
  const store = {
    wxid: options.wxid ?? "wxid_native_fixture",
    dbDir: directory,
    has: () => false,
    registryRevision: 0,
    keyGeneration: () => 0,
    refreshRegistry: async () => false,
    messageShards: () => {reads += 1; return ["message/message_0.db"];},
    conversations: async () => {reads += 1; return [...chats.values()];},
    shardOf: async (chatId: string) => {
      reads += 1;
      return rows.has(chatId) ? "message/message_0.db" : null;
    },
    shardsOf: async (chatId: string) => rows.has(chatId) ? ["message/message_0.db"] : [],
    snapshot: async () => {
      reads += 1;
      snapshots += 1;
      if (options.snapshotError) throw new Error(options.snapshotError);
      return {refresh: async () => false};
    },
    maxLocalId: async (chatId: string) => rows.get(chatId)?.at(-1)?.local_id ?? 0,
    rowsSinceForChats: async (_shard: string, cursors: ReadonlyMap<string, number>, limit: number) =>
      new Map([...cursors].flatMap(([chatId, cursor]) => {
        const found = rows.get(chatId);
        return found
          ? [[chatId, found.filter(row => row.local_id > cursor).slice(0, limit)] as const]
          : [];
      })),
    historyPage: async (chatId: string, query: {until?: number; limit: number}) => {
      reads += 1;
      return [...(rows.get(chatId) ?? [])].reverse()
        .filter(row => query.until === undefined || row.create_time < query.until).slice(0, query.limit);
    },
    selfSenderId: async (chatId: string) => options.senderIdForChat?.(chatId) ?? "1",
    members: async (): Promise<Array<{wxid: string; displayName: string | null}>> => [],
    reopen: () => {},
    close: async () => {},
  } as unknown as WeChatNativeStore;
  return {
    store,
    get reads() {return reads;},
    get snapshots() {return snapshots;},
    async commit(chatId: string, bodies: string[], identities?: Array<{
      senderWxid: string | null; realSenderId: number;
    }>): Promise<void> {
      const messages = bodies.map((body, index): NativeHistoryRow => ({
        local_id: index + 1,
        server_id: String(700_000 + index),
        local_type: 1,
        create_time: (options.timestamp ?? 1_788_650_000) + index,
        real_sender_id: identities?.[index]?.realSenderId ?? 2,
        sender_wxid: identities?.[index] ? identities[index].senderWxid : chatId,
        message_kind: "text",
        message_content: body,
      }));
      rows.set(chatId, messages);
      chats.set(chatId, {
        chatId, name: "Native fixture peer", unreadCount: messages.length,
        markedUnread: false, isGroup: false,
        lastTimestamp: messages.at(-1)?.create_time ?? null,
        summary: messages.at(-1)?.message_content ?? null,
      });
      await writeFile(path.join(directory, "message", "fixture-wake"), String(++wake));
    },
    dispose: () => rm(directory, {recursive: true, force: true}),
  };
}

test("native inbound imports the first message of a newly discovered conversation", async () => {
  const native = await nativeInboundFixture();
  try {
    await withBridge(async ({hub, bridge, relay}) => {
      await until(() => native.snapshots > 0, "native snapshot preflight");
      assert.deepEqual(await hub.rooms(), []);
      await native.commit("wxid_new_native_peer", ["first native message"]);
      const {messages} = await threadWhen(hub,
        thread => thread.messages.some(row => row.body === "first native message"),
        "the new conversation's first native row");
      assert.equal(messages.filter(row => row.body === "first native message").length, 1);
      assert.equal(relay.connections, 0, "native ingestion does not depend on relay SSE");
      assert.equal(bridge.nativeReadable(), true, "a verified native directory is readable without a sender");
    }, undefined, {nativeStores: [native.store], preferNativeInbound: true, readSyncSweepMs: 20}, false);
  } finally {await native.dispose();}
});

test("native inbound retries a Matrix failure without duplicating an acknowledged prefix", async () => {
  const native = await nativeInboundFixture();
  const realFetch = globalThis.fetch;
  let failed = false;
  let secondAttempts = 0;
  const guardedFetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.includes("/send/m.room.message/") && typeof init?.body === "string") {
      const content = JSON.parse(init.body) as {body?: string};
      if (content.body === "retry native second") {
        secondAttempts += 1;
        if (!failed) {
          failed = true;
          return Response.json({errcode: "M_UNKNOWN", error: "temporary fixture failure"}, {status: 503});
        }
      }
    }
    return await realFetch(input, init);
  };
  try {
    await withBridge(async ({hub, relay}) => {
      await until(() => native.snapshots > 0, "native snapshot preflight");
      await native.commit("wxid_retry_native_peer", ["native first", "retry native second"]);
      await until(() => failed, "the injected Matrix failure");
      const deadline = Date.now() + 7_000;
      let messages: Thread["messages"] = [];
      while (Date.now() < deadline) {
        const rooms = await hub.rooms();
        if (rooms.length) messages = (await hub.messages(rooms[0].roomId, 20)).messages;
        if (messages.some(row => row.body === "retry native second")) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.deepEqual(messages.map(row => row.body).sort(), ["native first", "retry native second"]);
      assert.equal(secondAttempts, 2);
      assert.equal(relay.connections, 0);
    }, undefined, {nativeStores: [native.store], preferNativeInbound: true,
      readSyncSweepMs: 20, fetch: guardedFetch}, false);
  } finally {await native.dispose();}
});

test("native inbound falls back to relay SSE when a keyed snapshot cannot open", async () => {
  const native = await nativeInboundFixture({snapshotError: "WeChat database page authentication failed"});
  const logs: string[] = [];
  try {
    await withBridge(async ({hub, bridge, relay}) => {
      assert.ok(native.snapshots > 0, "native preflight actually attempted the keyed shard");
      assert.ok(logs.some(line => line.includes("authentication failed")));
      assert.equal(bridge.nativeReadable(), false, "failed native keys never advertise readable conversations");
      const beforeRelay = native.reads;
      relay.emit({messageId: "fallback-live", chatId: "wxid_relay_fallback",
        senderId: "wxid_relay_fallback", body: "relay after native failure", timestamp: 20});
      const {room} = await threadWhen(hub,
        thread => thread.messages.some(row => row.body === "relay after native failure"), "relay fallback delivery");
      relay.catalogue.history.wxid_relay_fallback = [{messageId: "fallback-history",
        chatId: "wxid_relay_fallback", body: "older relay history", timestamp: 10}];
      await bridge.loadOlderHistory(room.roomId, 10);
      assert.ok((await hub.messages(room.roomId, 20)).messages.some(row => row.body === "older relay history"));
      assert.equal(native.reads, beforeRelay, "failed native readers stay disabled during relay operation");
    }, undefined, {nativeStores: [native.store], preferNativeInbound: true, log: line => logs.push(line)});
  } finally {await native.dispose();}
});

test("default relay mode never reads supplied native stores", async () => {
  const native = await nativeInboundFixture();
  try {
    await native.commit("wxid_hidden_native_peer", ["must remain native-only"]);
    await withBridge(async ({hub, relay}) => {
      relay.emit({messageId: "default-relay", chatId: "wxid_default_relay",
        senderId: "wxid_default_relay", body: "default relay message", timestamp: 20});
      const {messages} = await threadWhen(hub,
        thread => thread.messages.some(row => row.body === "default relay message"), "default relay delivery");
      assert.equal(native.reads, 0);
      assert.deepEqual(messages.map(row => row.body), ["default relay message"]);
      assert.equal((await hub.rooms()).length, 1);
    }, undefined, {nativeStores: [native.store]});
    assert.equal(native.reads, 0);
  } finally {await native.dispose();}
});

test("multiple native account stores fall back without merging their conversations", async () => {
  const first = await nativeInboundFixture();
  const second = await nativeInboundFixture({wxid: "wxid_second_native_fixture"});
  const logs: string[] = [];
  try {
    await first.commit("wxid_first_account_peer", ["first account only"]);
    await second.commit("wxid_second_account_peer", ["second account only"]);
    await withBridge(async ({hub, relay}) => {
      relay.emit({messageId: "selected-relay", chatId: "wxid_selected_relay",
        senderId: "wxid_selected_relay", body: "selected relay message", timestamp: 20});
      await threadWhen(hub, thread => thread.messages.length === 1, "the selected relay's message");
      assert.equal((await hub.rooms()).length, 1);
      assert.equal(first.reads + second.reads, 0);
      assert.ok(logs.some(line => line.includes("one selected account")));
    }, undefined, {nativeStores: [first.store, second.store], preferNativeInbound: true,
      log: line => logs.push(line)});
  } finally {await Promise.all([first.dispose(), second.dispose()]);}
});

for (const outcome of ["response", "error"] as const) {
test(`an unsafe native ${outcome} suppresses later relay recovery`, async () => {
  const logs: string[] = [];
  let controlled: Relay | undefined;
  await withBridge(async ({bridge, hub, relay}) => {
    relay.emit({messageId: "unsafe-detach-opener", chatId: "wxid_unsafe_detach_peer",
      senderId: "wxid_unsafe_detach_peer", body: "native operation target", timestamp: 10});
    const {room, messages} = await threadWhen(hub, thread => thread.messages.length === 1,
      "the native operation's fixture conversation");
    const mark = bridge.markRead(room.roomId, messages[0].eventId);
    if (outcome === "error") await assert.rejects(mark, /native driver cleanup unknown/);
    else await mark;
    assert.equal(await bridge.start("@polymux-test:polymux.local"), true);
    await new Promise(resolve => setTimeout(resolve, 1_300));
    assert.equal(relay.connections, 1, "no stream can reattach after detach safety is lost");
    assert.equal(logs.some(line => line.includes("no relay binary") ||
      line.includes("local relay stopped; restarting")), false);
  }, relay => {controlled = relay;}, {
    log: line => logs.push(line),
    sessionState: async () => "signed_in",
    ensureAppRunning: async () => true,
    writer: {write: async request => {
      assert.equal(request.kind, "read");
      controlled?.dropStream();
      if (outcome === "error") throw Object.assign(new Error("native driver cleanup unknown"),
        {relayRecoverySafe: false});
      return {deliveredVerified: true, relayRecoverySafe: false};
    }},
  });
});
}

test("unsafe native readiness keeps relay recovery held across later probes", async () => {
  let probes = 0;
  await withBridge(async ({bridge, relay}) => {
    assert.equal(await bridge.outboundReady(), false);
    assert.equal(probes, 1);
    assert.equal(await bridge.outboundReady(), false);
    assert.equal(probes, 1, "a held detach cannot start another native readiness probe");
    assert.equal(await bridge.start("@polymux-test:polymux.local"), true);
    await new Promise(resolve => setTimeout(resolve, 1_300));
    assert.equal(relay.connections, 1, "the aborted stream stays detached after readiness fails");
  }, undefined, {
    sessionState: async () => "signed_in",
    ensureAppRunning: async () => true,
    writer: {
      ready: async () => {probes += 1; return false;},
      readinessRecoverySafe: () => false,
      write: async () => {throw new Error("readiness must not send a message");},
    },
  });
});

/**
 * A stand-in for `wechat-use`, which is where the account's own participant
 * number comes from. Answers `history` with whatever the test asked for, in
 * the `{meta, rows}` shape the real tool uses with `--fields`.
 */
async function stubCli(
  rows: Record<
    string,
    Array<{
      create_time: number;
      real_sender_id: string;
      server_id?: string;
      local_id?: string;
      sender_wxid?: string;
      message_kind?: string;
      display_text?: string;
      message_content?: string;
    }>
  >,
  sendLog?: string,
  audio?: Uint8Array,
  accountWxid?: string,
): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-cli-"));
  const file = path.join(directory, "wechat-use");
  const table = JSON.stringify(rows).replace(/'/g, "'\\''");
  await writeFile(
    file,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `const table = ${JSON.stringify(rows)};`,
      `const accountWxid = ${JSON.stringify(accountWxid ?? null)};`,
      "if (process.argv[2] === 'accounts' && accountWxid) {",
      "  process.stdout.write(JSON.stringify({default:['com.tencent.xinWeChat',accountWxid],accounts:[{wxid:accountWxid}]}));",
      "  process.exit(0);",
      "}",
      "if (process.argv[2] === 'send') {",
      "  const imageIndex = process.argv.indexOf('--image');",
      "  const image = imageIndex >= 0 ? process.argv[imageIndex + 1] : '';",
      `  const log = ${JSON.stringify(sendLog ?? "")};`,
      "  if (log) fs.appendFileSync(log, JSON.stringify({args: process.argv.slice(2), bytes: image ? fs.readFileSync(image).toString('base64') : ''}) + '\\n');",
      "  process.stdout.write(JSON.stringify({delivered_verified: true}));",
      "  process.exit(0);",
      "}",
      "if (process.argv[2] === 'audio' && process.argv[3] === 'get') {",
      "  const out = process.argv[process.argv.indexOf('--out') + 1];",
      `  const bytes = Buffer.from(${JSON.stringify(audio ? Buffer.from(audio).toString("base64") : "")}, 'base64');`,
      "  if (!bytes.length) { process.stdout.write(JSON.stringify({error: 'voice fixture missing'})); process.exit(0); }",
      "  fs.writeFileSync(out, bytes);",
      "  process.stdout.write(JSON.stringify({ok: true}));",
      "  process.exit(0);",
      "}",
      "const chat = process.argv[3];",
      "process.stdout.write(JSON.stringify({meta: {}, rows: table[chat] ?? []}));",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(file, 0o755);
  void table;
  return file;
}

/**
 * Waits for what a test is actually waiting for, by polling until a read of the
 * hub answers it.
 *
 * These tests used to sleep for a fixed 1.5s instead. Three things move on
 * their own schedule between an emit and an assertion — the relay's stream, the
 * bridge's handling of each message, and the homeserver's push loop — and a
 * guessed interval is either longer than the work takes or, on a machine busy
 * running the other suites, shorter than it. That is why this file passed alone
 * and failed as part of `npm run test:hub`.
 *
 * The budget is generous, and the interval deliberately not tight. node:test
 * runs this file's tests concurrently, so a dozen bridges, homeservers and
 * relays are all working at once; each poll costs a `/sync` and the profile
 * reads behind it, and polling hard enough to matter starves the very work it
 * is waiting for. 100ms is far below the threshold where a person would notice
 * and far above the point where the loop competes with the bridge.
 */
const POLL_MS = 100;
const POLL_ATTEMPTS = 300;

async function eventually<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  what: string,
): Promise<T> {
  let last: T | undefined;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    last = await read();
    if (ready(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(
    `Timed out waiting for ${what}; last read was ${JSON.stringify(last)}`,
  );
}

/** Polls a plain condition, for state that is not read out of the hub. */
function until(check: () => boolean, what: string): Promise<unknown> {
  return eventually(
    async () => check(),
    (ready) => ready,
    what,
  );
}

/** The hub's room list, once it satisfies what the test needs. */
function roomsWhen(
  hub: MatrixHub,
  ready: (rooms: Awaited<ReturnType<MatrixHub["rooms"]>>) => boolean,
  what: string,
): Promise<Awaited<ReturnType<MatrixHub["rooms"]>>> {
  return eventually(() => hub.rooms(), ready, what);
}

type Thread = {
  room: Awaited<ReturnType<MatrixHub["rooms"]>>[number];
  messages: Awaited<ReturnType<MatrixHub["messages"]>>["messages"];
};

/**
 * The first portal and its messages, once they satisfy what the test needs.
 * Both are read together because most of these tests assert across the pair —
 * a message in the thread and the preview the list draws from it.
 */
async function threadWhen(
  hub: MatrixHub,
  ready: (thread: Thread) => boolean,
  what: string,
): Promise<Thread> {
  const state = await eventually(
    async (): Promise<Thread | null> => {
      const rooms = await hub.rooms();
      if (rooms.length === 0) return null;
      const { messages } = await hub.messages(rooms[0].roomId, 20);
      return { room: rooms[0], messages };
    },
    (thread) => thread !== null && ready(thread),
    what,
  );
  // eventually only returns once ready held, and ready cannot hold for null.
  return state as Thread;
}

test("an inbound message opens a portal room the hub files under WeChat", async () => {
  await withBridge(async ({ hub, relay }) => {
    relay.emit({
      messageId: "m1",
      chatId: "wxid_friend",
      chatName: "A Friend",
      senderId: "wxid_friend",
      senderName: "A Friend",
      body: "ping",
      timestamp: Math.floor(Date.now() / 1000),
    });
    const rooms = await roomsWhen(
      hub,
      (list) =>
        list.length === 1 &&
        list[0].preview !== null &&
        (list[0].unread ?? 0) > 0,
      "the portal to carry the message and its unread count",
    );
    assert.equal(rooms.length, 1);
    // The portal carries an `m.bridge` event, so it is recognised by the same
    // rule every mautrix room is — no WeChat special case in the chat list.
    assert.equal(rooms[0].platform, "wechat");
    assert.equal(rooms[0].name, "A Friend");
    assert.equal(rooms[0].preview, "ping");
    assert.equal(rooms[0].unread, 1);
    const {messages} = await hub.messages(rooms[0].roomId, 20);
    assert.deepEqual(
      messages.map((message) => message.body),
      ["ping"],
      "the puppet's connection membership is not native conversation activity",
    );
  });
});

test("a reused WeChat local row id is new at a later sent timestamp", async () => {
  await withBridge(async ({hub, relay}) => {
    const message = {
      messageId: "111",
      chatId: "wxid_friend",
      chatName: "A Friend",
      senderId: "wxid_friend",
      senderName: "A Friend",
      body: "before database rotation",
      timestamp: 100,
    };
    relay.emit(message);
    await threadWhen(
      hub,
      ({messages}) => messages.some((item) => item.body === message.body),
      "the original local row id",
    );

    relay.emit({...message, body: "after database rotation", timestamp: 200});
    const thread = await threadWhen(
      hub,
      ({messages}) =>
        messages.some((item) => item.body === "before database rotation") &&
        messages.some((item) => item.body === "after database rotation"),
      "the reused local row id at its new timestamp",
    );

    // An exact reconnect replay still has the same chat, row id, and sent
    // timestamp, so it remains one message.
    relay.emit({...message, body: "after database rotation", timestamp: 200});
    await new Promise((resolve) => setTimeout(resolve, 250));
    const {messages} = await hub.messages(thread.room.roomId, 20);
    assert.equal(
      messages.filter((item) => item.body === "after database rotation").length,
      1,
    );
  });
});

test("a missing routing map recovers the existing portal instead of duplicating it", async () => {
  const relay = await stubRelay();
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-recovery-"));
  const bridgeDirectory = path.join(directory, "bridges");
  const homeserver = new Homeserver({
    serverName: "polymux.local",
    dataDirectory: directory,
  });
  await homeserver.start();
  const owner = homeserver.createLocalUser("polymux-recovery");
  const makeBridge = (): WeChatBridge => new WeChatBridge({
    ...noDeviceOptions,
    homeserver,
    directory: bridgeDirectory,
    relayUrl: relay.url,
    binaryDirectories: [],
  });
  const hub = new MatrixHub({
    baseUrl: homeserver.baseUrl,
    homeserverUrl: homeserver.baseUrl,
    directory,
    embedded: true,
    auth: () => ({matrixToken: owner.accessToken, userId: owner.userId}),
  });
  let bridge = makeBridge();
  try {
    await bridge.start(owner.userId);
    await relay.connected();
    relay.emit({
      messageId: "before-reset",
      chatId: "wxid_same_chat",
      chatName: "Same chat",
      senderId: "wxid_same_chat",
      senderName: "Same chat",
      body: "before",
      timestamp: 1,
    });
    const [original] = await roomsWhen(
      hub,
      (rooms) => rooms.length === 1 && rooms[0].preview === "before",
      "the original portal",
    );
    await bridge.close();

    const statePath = path.join(bridgeDirectory, "wechat", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      rooms: Record<string, unknown>;
      roomToChat: Record<string, unknown>;
    };
    state.rooms = {};
    state.roomToChat = {};
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    bridge = makeBridge();
    await bridge.start(owner.userId);
    await until(() => relay.connections >= 2, "the restarted relay subscription");
    relay.emit({
      messageId: "after-reset",
      chatId: "wxid_same_chat",
      chatName: "Renamed chat",
      senderId: "wxid_same_chat",
      senderName: "Same chat",
      body: "after",
      timestamp: 2,
    });
    const rooms = await roomsWhen(
      hub,
      (list) =>
        list.length === 1 &&
        list[0].name === "Renamed chat" &&
        list[0].preview === "after" &&
        list[0].currentPortal === true,
      "the existing portal to be recovered as current",
    );
    assert.equal(rooms[0].roomId, original.roomId);
  } finally {
    await bridge.close();
    relay.server.close();
    await homeserver.close();
  }
});

test("startup history and the live stream share one portal creation", async () => {
  const realFetch = globalThis.fetch;
  let createRoomCalls = 0;
  let releaseCreate!: () => void;
  let firstCreateStarted!: () => void;
  const createStarted = new Promise<void>((resolve) => {
    firstCreateStarted = resolve;
  });
  const createReleased = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  const guardedFetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/_matrix/client/v3/createRoom")) {
      createRoomCalls += 1;
      firstCreateStarted();
      await createReleased;
    }
    return await realFetch(input, init);
  };

  try {
    await withBridge(
      async ({hub, relay}) => {
        await createStarted;
        relay.emit({
          messageId: "live-race",
          chatId: "wxid_portal_race",
          chatName: "Portal Race",
          senderId: "wxid_portal_race",
          senderName: "Portal Race",
          body: "from live stream",
          timestamp: 2,
        });
        // Give the stream consumer a chance to reach the same in-flight portal
        // while the startup import is held at Matrix room creation.
        await new Promise((resolve) => setTimeout(resolve, 100));
        releaseCreate();
        const rooms = await roomsWhen(
          hub,
          (items) => items.length === 1 && items[0].preview === "from live stream",
          "both deliveries to converge on one portal",
        );
        assert.equal(rooms.length, 1);
        assert.equal(createRoomCalls, 1);
      },
      (relay) => {
        relay.catalogue.chats = [{
          username: "wxid_portal_race",
          display_name: "Portal Race",
          unread_count: 1,
        }];
        relay.catalogue.history.wxid_portal_race = [{
          message_id: "history-race",
          chat_id: "wxid_portal_race",
          chat_name: "Portal Race",
          sender_id: "wxid_portal_race",
          sender_name: "Portal Race",
          body: "from startup history",
          timestamp: 1,
        }];
      },
      {fetch: guardedFetch},
    );
  } finally {
    releaseCreate();
  }
});

test("relinking cannot let an old stream clear the new consumer", async () => {
  const relay = await stubRelay();
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-stream-owner-"));
  const homeserver = new Homeserver({
    serverName: "polymux.local",
    dataDirectory: directory,
  });
  await homeserver.start();
  const owner = homeserver.createLocalUser("polymux-stream-owner");
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const realFetch = globalThis.fetch;
  const heldStreamFetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/messages/stream")
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          streams.push(controller);
        },
      }), {
        status: 200,
        headers: {"Content-Type": "text/event-stream"},
      });
    return await realFetch(input, init);
  };
  const bridge = new WeChatBridge({
    ...noDeviceOptions,
    homeserver,
    directory,
    relayUrl: relay.url,
    binaryDirectories: [],
    fetch: heldStreamFetch,
  });
  try {
    await bridge.start(owner.userId);
    await until(() => streams.length === 1, "the first stream consumer");
    await bridge.close();
    await bridge.start(owner.userId);
    await until(() => streams.length === 2, "the replacement stream consumer");

    streams[0].close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(streams.length, 2, "the retired consumer cannot reconnect");
  } finally {
    await bridge.close();
    for (const stream of streams) {
      try {
        stream.close();
      } catch {
        // It may already have been closed by the assertion path.
      }
    }
    relay.server.close();
    await homeserver.close();
  }
});

test("a group message is attributed to whoever sent it, in either case", async () => {
  await withBridge(async ({ hub, relay }) => {
    // The relay is not consistent about case, and a dropped sender name is
    // silent: every member of a group would come through as one nameless
    // contact, which is exactly what a group thread cannot afford.
    relay.emit({
      message_id: "m1",
      chat_id: "wxid_group",
      chat_name: "Badminton",
      sender_id: "wxid_ann",
      sender_name: "Ann",
      body: "court is booked",
      timestamp: 1,
    });
    relay.emit({
      messageId: "m2",
      chatId: "wxid_group",
      senderId: "wxid_bo",
      senderName: "Bo",
      body: "see you there",
      timestamp: 2,
    });
    const { messages } = await threadWhen(
      hub,
      ({ messages }) => messages.length >= 2,
      "both group messages to arrive",
    );
    const named = new Map(messages.map((item) => [item.body, item.senderName]));
    assert.equal(named.get("court is booked"), "Ann");
    assert.equal(named.get("see you there"), "Bo");
  });
});

test("Desktop folder entries never become chats through directory import or the live stream", async () => {
  const folders = ["@placeholder_foldgroup", "brandsessionholder", "brandservicesessionholder"];
  await withBridge(async ({hub, relay}) => {
    await roomsWhen(hub, rows => rows.length === 2, "both real chats inside native folders");
    for (const chatId of folders)
      relay.emit({messageId: `folder-${chatId}`, chatId, body: "folder preview", timestamp: 10});
    relay.emit({messageId: "after-folders", chatId: "123456@chatroom", senderId: "wxid_ann", body: "real message", timestamp: 11});
    await threadWhen(hub, ({messages}) => messages.some(row => row.body === "real message"), "the message after the folder stream entries");
    assert.equal((await hub.rooms()).length, 2);
    assert.ok(relay.historyRequests.every(id => !folders.includes(id)), "folder summaries are never queried as message history");
    assert.equal(relay.sent.length, 0);
  }, relay => {
    relay.catalogue.chats = [
      ...folders.map(username => ({username, unread_count: 17, summary: "folder preview"})),
      {username: "123456@chatroom", display_name: "Badminton", unread_count: 2},
      {username: "gh_news", display_name: "News", unread_count: 1},
    ];
  });
});

test("previously imported folders cannot send, clear unread or load native history", async () => {
  await withBridge(async ({homeserver}) => {
    const directory = await mkdtemp(path.join(tmpdir(), "wechat-stored-folder-"));
    await mkdir(path.join(directory, "wechat"));
    const roomId = "!stored-folder:polymux.local";
    await writeFile(path.join(directory, "wechat", "state.json"), JSON.stringify({
      rooms: {brandsessionholder: {roomId, isGroup: false}},
      roomToChat: {[roomId]: "brandsessionholder"},
    }));
    const bridge = new WeChatBridge({...noDeviceOptions, homeserver, directory, binaryDirectories: [],
      fetch: async () => {throw new Error("a folder must not reach a transport");}});
    try {
      assert.equal(await bridge.members(roomId), null); // Loads the existing routing map.
      assert.throws(() => bridge.assertLiveTestDestination(roomId), /folder is not a conversation/);
      await assert.rejects(bridge.markRead(roomId, "$old-preview"), /folder is not a conversation/);
      assert.equal(await bridge.loadOlderHistory(roomId), false);
    } finally {await bridge.close();}
  });
});

test("untitled group portals recover member labels and still accept a later explicit group name", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wechat-untitled-groups-"));
  const cli = path.join(directory, "reader");
  await writeFile(cli, `#!/usr/bin/env node
const command = process.argv[2];
process.stdout.write(JSON.stringify(command === 'accounts'
  ? {default:['com.tencent.xinWeChat','wxid_me'], accounts:[{wxid:'wxid_me'}]}
  : command === 'members' && process.argv[3] === '123456@chatroom' ? [
    {wxid:'wxid_me', display_name:'Me'},
    {wxid:'wxid_ann', display_name:'Old Name', group_nickname:'Ann'},
    {wxid:'wxid_bo', display_name:'Bo'}
  ] : []));
`, {mode: 0o755});
  await withBridge(async ({hub, relay}) => {
    relay.emit({messageId: "untitled-first", chatId: "123456@chatroom",
      senderId: "wxid_ann", senderName: "Ann", body: "hello", timestamp: 1});
    const {room: original} = await threadWhen(hub,
      ({messages}) => messages.some(row => row.body === "hello"), "the preexisting unnamed group");
    relay.catalogue.chats = [
      {username: "123456@chatroom", display_name: null, unread_count: 0},
      {username: "654321@chatroom", display_name: " ", unread_count: 0},
    ];
    let rows = await roomsWhen(hub, rows => rows.some(row => row.name === "Ann, Bo") &&
      rows.some(row => row.name === "WeChat group"), "native member titles and the unavailable-directory fallback");
    assert.equal(rows.find(row => row.name === "Ann, Bo")?.roomId, original.roomId);
    relay.catalogue.chats[0] = {username: "123456@chatroom", display_name: "Study group", unread_count: 0};
    rows = await roomsWhen(hub, rows => rows.some(row => row.name === "Study group"), "the explicit native group name");
    assert.equal(rows.find(row => row.name === "Study group")?.roomId, original.roomId);
    assert.equal(rows.length, 2);
    assert.equal((await hub.messages(original.roomId, 20)).messages.filter(row => row.body === "hello").length, 1);
    assert.equal(relay.sent.length, 0);
  }, undefined, {cliPaths: [cli], readSyncSweepMs: 100});
});

test("group titles sync from the directory without becoming a speaker's name", async () => {
  await withBridge(async ({hub, relay, directory}) => {
    const chatId = "123456@chatroom";
    relay.emit({messageId: "title-first", chatId, chatName: "Original group",
      senderId: "wxid_ann", senderName: "Ann", body: "first", timestamp: 1});
    const {room: original} = await threadWhen(hub,
      ({messages}) => messages.some(item => item.body === "first"), "the original group");
    relay.emit({messageId: "title-second", chatId, display_name: "Bo",
      senderId: "wxid_bo", senderName: "Bo", body: "second", timestamp: 2});
    await threadWhen(hub, ({messages}) => messages.some(item => item.body === "second"),
      "the message without a group title");
    const stateFile = path.join(directory, "wechat", "state.json");
    const readState = async (): Promise<{rooms?: Record<string, {name?: string}>}> =>
      JSON.parse(await readFile(stateFile, "utf8").catch(() => "{}"));
    await eventually(readState,
      state => state.rooms?.[chatId]?.name === "Original group", "the retained native group title");
    assert.equal((await hub.rooms()).find(room => room.roomId === original.roomId)?.name, "Original group");

    // A rename can occur without another message. The passive directory sweep
    // must publish it to Matrix as well as updating the native writer's label.
    relay.catalogue.chats = [{username: chatId, display_name: "Renamed group", unread_count: 0}];
    const rooms = await roomsWhen(hub,
      rows => rows.length === 1 && rows[0].name === "Renamed group", "the native group rename");
    assert.equal(rooms[0].roomId, original.roomId);
    await eventually(readState,
      state => state.rooms?.[chatId]?.name === "Renamed group", "the renamed writer target");
    assert.equal((await hub.messages(original.roomId, 20)).messages.length, 2);
    assert.equal(relay.sent.length, 0, "syncing a native rename must not send a native group edit");
  }, undefined, {readSyncSweepMs: 100});
});

test("outbound group renaming publishes only a verified native name in the existing room", async () => {
  const chatId = "123456@chatroom";
  let name = "Study group", isMember = true, accepted = false;
  const writes: WeChatWriteRequest[] = [];
  await withBridge(async ({hub, bridge, relay}) => {
    relay.emit({messageId: "rename-first", chatId, chatName: name,
      senderId: "wxid_ann", body: "group message", timestamp: 1});
    const {room} = await threadWhen(hub, ({messages}) => messages.some(item => item.body === "group message"), "the rename target");
    assert.deepEqual(await bridge.groupInfo(room.roomId), {name, isMember: true});
    await assert.rejects(bridge.renameGroup(room.roomId, "学习小组 🐷", "stale name"), /changed/);
    isMember = false;
    await assert.rejects(bridge.renameGroup(room.roomId, "学习小组 🐷", name), /member/);
    isMember = true;
    assert.equal(writes.length, 0);
    await assert.rejects(bridge.renameGroup(room.roomId, "学习小组 🐷", name), /not confirmed/);
    assert.equal((await hub.rooms())[0]?.name, name, "a rejected native rename must not repaint Matrix");
    accepted = true;
    assert.deepEqual(await bridge.renameGroup(room.roomId, "学习小组 🐷", name), {name: "学习小组 🐷", isMember: true});
    const [renamed] = await hub.rooms();
    assert.equal(renamed?.roomId, room.roomId);
    assert.equal(renamed?.name, "学习小组 🐷");
    assert.equal((await hub.messages(room.roomId, 20)).messages.length, 1);
    assert.equal(relay.sent.length, 0, "renaming does not send a chat message");
    assert.equal(writes.filter(item => item.kind === "rename-group").length, 2);
  }, undefined, {readSyncSweepMs: 100_000, writer: {
    groupInfo: async id => ({chatId: id, name, isMember}),
    write: async request => {
      writes.push(request);
      if (!accepted) return {deliveredVerified: false, reason: "WeChat has not confirmed the new name"};
      if (request.kind === "rename-group") name = request.name;
      return {deliveredVerified: true};
    },
  }});
});

test("group renaming rejects direct chats and conversations outside the native test fence", async () => {
  let reads = 0, writes = 0;
  await withBridge(async ({hub, bridge, relay}) => {
    for (const chatId of ["wxid_friend", "999@chatroom"]) {
      relay.emit({messageId: `fence-${chatId}`, chatId, chatName: chatId,
        senderId: "wxid_ann", body: chatId, timestamp: 1});
      const rooms = await roomsWhen(hub, rooms => rooms.some(room => room.name === chatId), "the fenced room");
      const room = rooms.find(room => room.name === chatId)!;
      await assert.rejects(bridge.renameGroup(room.roomId, "New name", chatId), /groups|restricted/);
    }
    assert.equal(reads, 0);
    assert.equal(writes, 0);
  }, undefined, {testChatIds: ["123456@chatroom"], writer: {
    groupInfo: async chatId => {reads++; return {chatId, name: "Old name", isMember: true};},
    write: async () => {writes++; return {deliveredVerified: true};},
  }});
});

test("a self echo cannot rename an established direct conversation", async () => {
  await withBridge(async ({hub, relay, directory}) => {
    relay.emit({messageId: "direct-first", chatId: "wxid_friend", chatName: "A Friend",
      senderId: "wxid_friend", senderName: "A Friend", body: "first", timestamp: 1});
    const {room} = await threadWhen(hub, ({messages}) => messages.length === 1, "the direct conversation");
    relay.emit({messageId: "direct-own", chatId: "wxid_friend", fromSelf: true,
      senderName: "My Display Name", display_name: "My Display Name", body: "mine", timestamp: 2});
    await threadWhen(hub, ({messages}) => messages.some(item => item.body === "mine" && item.mine), "the self echo");
    assert.equal((await hub.rooms()).find(item => item.roomId === room.roomId)?.name, "A Friend");
    await eventually(async () => JSON.parse(await readFile(path.join(directory, "wechat", "state.json"), "utf8").catch(() => "{}")),
      state => state.rooms?.wxid_friend?.name === "A Friend", "the retained native recipient name");
  });
});

test("a direct history message inherits the contact name from the chat directory", async () => {
  await withBridge(
    async ({ hub }) => {
      const { room, messages } = await threadWhen(
        hub,
        ({ messages }) => messages.some((item) => item.body === "hello from history"),
        "the nameless history message to be imported",
      );
      assert.equal(room.name, "·W·");
      assert.equal(
        messages.find((item) => item.body === "hello from history")?.senderName,
        "·W·",
      );
    },
    (relay) => {
      relay.catalogue.chats = [{
        username: "wxid_friend",
        display_name: "·W·",
        unread_count: 0,
      }];
      // Some relay builds omit sender_name from direct-chat history even
      // though /chats already resolved the same person's display name.
      relay.catalogue.history.wxid_friend = [{
        message_id: "history-1",
        chat_id: "wxid_friend",
        sender_id: "wxid_friend",
        body: "hello from history",
        timestamp: 1,
      }];
    },
  );
});

test("the chat directory repairs a direct contact profile without reimporting history", async () => {
  await withBridge(
    async ({ homeserver, accessToken }) => {
      const digest = createHash("sha256")
        .update("wxid_friend")
        .digest("hex")
        .slice(0, 24);
      const userId = `@wechat_${digest}:polymux.local`;
      const response = await fetch(
        new URL(
          `/_matrix/client/v3/profile/${encodeURIComponent(userId)}`,
          homeserver.baseUrl,
        ),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      assert.equal(response.ok, true);
      assert.equal(
        ((await response.json()) as { displayname?: string }).displayname,
        "·W·",
      );
    },
    (relay) => {
      relay.catalogue.chats = [{
        username: "wxid_friend",
        display_name: "·W·",
        unread_count: 0,
      }];
      relay.catalogue.history.wxid_friend = [];
    },
  );
});

test("a conversation with nothing unread is imported too", async () => {
  await withBridge(
    async ({ hub }) => {
      const names = (
        await roomsWhen(
          hub,
          (rooms) => rooms.length === 2,
          "both conversations to be imported",
        )
      )
        .map((room) => room.name)
        .sort();
      // Importing only what was unread showed a fraction of the account: a
      // chat that has been read is still a chat the user expects to find.
      assert.deepEqual(names, ["Already Read", "Has Unread"]);
    },
    (relay) => {
      relay.catalogue.chats = [
        {
          username: "wxid_read",
          display_name: "Already Read",
          unread_count: 0,
        },
        {
          username: "wxid_unread",
          display_name: "Has Unread",
          unread_count: 2,
        },
      ];
      relay.catalogue.history = {
        wxid_read: [
          {
            message_id: "r1",
            chat_id: "wxid_read",
            chat_name: "Already Read",
            sender_id: "wxid_read",
            sender_name: "Already Read",
            body: "seen this",
            timestamp: 1,
          },
        ],
        wxid_unread: [
          {
            message_id: "u1",
            chat_id: "wxid_unread",
            chat_name: "Has Unread",
            sender_id: "wxid_unread",
            sender_name: "Has Unread",
            body: "new one",
            timestamp: 2,
          },
        ],
      };
    },
  );
});

test("File Transfer is imported before the rest of a cold account", async () => {
  await withBridge(
    async ({hub, relay}) => {
      await roomsWhen(
        hub,
        (rooms) => rooms.some((room) => room.name === "File Transfer"),
        "File Transfer to be imported",
      );
      await until(() => relay.historyRequests.length > 0, "the first native history request");
      assert.equal(
        relay.historyRequests[0],
        "filehelper",
        "the safe utility conversation must not wait behind account history",
      );
    },
    (relay) => {
      relay.catalogue.chats = [
        {username: "wxid_other", display_name: "Other", unread_count: 0},
        {username: "filehelper", display_name: "File Transfer", unread_count: 0},
      ];
      relay.catalogue.history = {
        wxid_other: [{
          message_id: "other-1",
          chat_id: "wxid_other",
          chat_name: "Other",
          body: "other history",
          timestamp: 1,
        }],
        filehelper: [{
          message_id: "filehelper-1",
          chat_id: "filehelper",
          chat_name: "File Transfer",
          body: "safe history",
          timestamp: 1,
        }],
      };
    },
  );
});

test("the bridge imports conversations beyond the relay's default 20, including read chats", async () => {
  await withBridge(async ({hub, relay}) => {
    const rooms = await roomsWhen(hub, (rooms) => rooms.length === 25, "the complete conversation directory");
    assert.ok(rooms.some((room) => room.name === "Older conversation 24"));
    assert.ok(relay.chatListLimits.every((limit) => limit > 20));
  }, (relay) => {
    relay.catalogue.chats = Array.from({length: 25}, (_, id) => ({
      username: `wxid_directory_${id}`, display_name: `Older conversation ${id}`, unread_count: 0,
    }));
  });
});

test("WeChat's own unread counts decide what the hub calls unread", async () => {
  await withBridge(
    async ({ hub }) => {
      const rooms = await eventually(
        () => hub.rooms(),
        (rooms) =>
          rooms.length === 2 &&
          rooms.every((room) => room.name !== room.roomId) &&
          rooms.find((room) => room.name === "Already Read")?.unread === 0 &&
          Number(rooms.find((room) => room.name === "Has Unread")?.unread) >= 1,
        "both conversations and their native unread counts to be imported",
      );
      const unread = new Map(rooms.map((room) => [room.name, room.unread]));
      // Read in WeChat itself, so the import is history rather than news: the
      // count it arrives with is the one WeChat states, not one per message.
      assert.equal(unread.get("Already Read"), 0);
      // And a chat that really does have one waiting keeps it.
      assert.ok((unread.get("Has Unread") ?? 0) >= 1);
    },
    (relay) => {
      relay.catalogue.chats = [
        {
          username: "wxid_read",
          display_name: "Already Read",
          unread_count: 0,
        },
        {
          username: "wxid_unread",
          display_name: "Has Unread",
          unread_count: 1,
        },
      ];
      relay.catalogue.history = {
        wxid_read: [
          {
            message_id: "r1",
            chat_id: "wxid_read",
            chat_name: "Already Read",
            sender_id: "wxid_read",
            sender_name: "Already Read",
            body: "seen this",
            timestamp: 1,
          },
          {
            message_id: "r2",
            chat_id: "wxid_read",
            chat_name: "Already Read",
            sender_id: "wxid_read",
            sender_name: "Already Read",
            body: "and this",
            timestamp: 2,
          },
        ],
        wxid_unread: [
          {
            message_id: "u1",
            chat_id: "wxid_unread",
            chat_name: "Has Unread",
            sender_id: "wxid_unread",
            sender_name: "Has Unread",
            body: "read one",
            timestamp: 1,
          },
          {
            message_id: "u2",
            chat_id: "wxid_unread",
            chat_name: "Has Unread",
            sender_id: "wxid_unread",
            sender_name: "Has Unread",
            body: "new one",
            timestamp: 2,
          },
        ],
      };
    },
  );
});

test("native session times order the directory before history and keep newer messages ahead of backfill", async () => {
  await withBridge(async ({hub, relay}) => {
    const ready = (rooms: Awaited<ReturnType<MatrixHub["rooms"]>>): boolean =>
      rooms.length === 2 && rooms[0]?.name === "Recent chat" && rooms[0]?.preview === "Newest native preview";
    const rooms = await roomsWhen(hub, ready, "native timestamps and previews before history");
    assert.deepEqual(rooms.map((room) => room.lastActivity), [
      new Date(200_000).toISOString(), new Date(100_000).toISOString(),
    ]);
    assert.equal(rooms[1]?.preview, "Older native preview");
    relay.catalogue.chats[0] = {username: "wxid_recent", display_name: "Renamed recent chat",
      last_timestamp: 200, summary: "Newest native preview", unread_count: 0};
    await roomsWhen(hub, (rows) => rows[0]?.name === "Renamed recent chat" &&
      rows[0]?.lastActivity === new Date(200_000).toISOString(), "a title update that preserves recency");
    relay.emit({messageId: "new-stream-message", chatId: "wxid_old", chatName: "Old chat",
      senderId: "wxid_old", body: "A new incoming message", timestamp: 300});
    await roomsWhen(hub, (rows) => rows[0]?.name === "Old chat" &&
      rows[0]?.lastActivity === new Date(300_000).toISOString() && rows[0]?.preview === "A new incoming message",
    "the live message moving its conversation to the top");
  }, (relay) => {
    // Creation is recent-first, making the older portal's setup events newer.
    // The recent chat has only older history; the directory owns both previews.
    relay.catalogue.chats = [
      {username: "wxid_recent", display_name: "Recent chat", last_timestamp: 200,
        summary: "Newest native preview", unread_count: 0},
      {username: "wxid_old", display_name: "Old chat", last_timestamp: 100,
        sort_timestamp: 9_999_999_999, summary: "Older native preview", unread_count: 0},
    ];
    relay.catalogue.history.wxid_recent = [{messageId: "older-history", chatId: "wxid_recent",
      senderId: "wxid_recent", body: "An older cached message", timestamp: 150}];
  }, {readSyncSweepMs: 50});
});

test("native unread badges can be restored after a read, including self-only chats", async () => {
  await withBridge(async ({hub, relay}) => {
    const setCount = (count: number): void => {
      relay.catalogue.chats = [{username: "filehelper", display_name: "File Transfer", unread_count: count}];
    };
    await roomsWhen(hub, (rooms) => rooms[0]?.unread === 1, "the initial native unread count");
    setCount(0);
    await roomsWhen(hub, (rooms) => rooms[0]?.unread === 0, "a read in Desktop");
    setCount(1);
    await roomsWhen(hub, (rooms) => rooms[0]?.unread === 1, "a later manual mark-unread in Desktop");
  }, (relay) => {
    relay.catalogue.chats = [{username: "filehelper", display_name: "File Transfer", unread_count: 1}];
    relay.catalogue.history = {filehelper: [{messageId: "self-only", body: "mine", fromSelf: true, timestamp: 1}]};
  }, {readSyncSweepMs: 50});
});

test("Desktop manual unread overrides the relay's zero count and survives a failed refresh", async () => {
  let markedUnread = true;
  let available = true;
  let failedReads = 0;
  await withBridge(async ({hub}) => {
    await roomsWhen(hub, (rooms) => rooms[0]?.unread === 1, "the native manual unread flag");
    available = false;
    await until(() => failedReads > 0, "a failed native refresh");
    assert.equal((await hub.rooms())[0]?.unread, 1, "unavailable native state cannot clear the badge");
    markedUnread = false;
    available = true;
    await roomsWhen(hub, (rooms) => rooms[0]?.unread === 0, "the native flag clearing");
  }, (relay) => {
    relay.catalogue.chats = [{username: "filehelper", display_name: "File Transfer", unread_count: 0}];
    relay.catalogue.history = {filehelper: [{messageId: "self-only", body: "mine", fromSelf: true, timestamp: 1}]};
  }, {readSyncSweepMs: 50, writer: {
    readStates: async () => {
      if (!available) {failedReads += 1; throw new Error("native snapshot unavailable");}
      return [{chatId: "filehelper", unreadCount: 0, markedUnread}];
    },
    write: async () => {throw new Error("a passive unread sweep cannot write to WeChat");},
  }});
});

test("an unread refresh started before mark-read cannot restore the stale native badge", async () => {
  let delayNext = false;
  let captured = false;
  let read = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {release = resolve;});
  await withBridge(async ({hub, bridge}) => {
    const [room] = await roomsWhen(hub, (rooms) => rooms[0]?.unread === 1, "the initial unread badge");
    const {messages} = await hub.messages(room.roomId, 20);
    delayNext = true;
    await until(() => captured, "the delayed native unread snapshot");
    try {
      await bridge.markRead(room.roomId, messages[0].eventId);
      assert.equal((await hub.rooms())[0]?.unread, 0);
    } finally {release();}
    // Wait for several sweeps, checking each value so a transient stale badge
    // cannot be hidden by the next successful native refresh.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal((await hub.rooms())[0]?.unread, 0);
    }
  }, (relay) => {
    relay.catalogue.chats = [{username: "filehelper", display_name: "File Transfer", unread_count: 0}];
    relay.catalogue.history = {filehelper: [{messageId: "self-only", body: "mine", fromSelf: true, timestamp: 1}]};
  }, {readSyncSweepMs: 50, writer: {
    readStates: async () => {
      const markedUnread = !read;
      if (delayNext && !captured) {captured = true; await gate;}
      return [{chatId: "filehelper", unreadCount: 0, markedUnread}];
    },
    write: async (request) => {assert.equal(request.kind, "read"); read = true; return {deliveredVerified: true};},
  }});
});

test("an imported message keeps the time WeChat sent it", async () => {
  await withBridge(async ({ hub, relay }) => {
    const sentAt = Math.floor(Date.parse("2026-08-10T02:30:00.000Z") / 1000);
    relay.emit({
      messageId: "m1",
      chatId: "wxid_friend",
      chatName: "A Friend",
      body: "last week",
      timestamp: sentAt,
    });
    const { room, messages } = await threadWhen(
      hub,
      ({ room, messages }) =>
        messages.length >= 1 && room.lastActivity !== null,
      "the imported message and the activity time taken from it",
    );
    // Stamped on import, a week of history all lands at the current moment:
    // every row shows the same time and the list cannot be sorted by recency.
    assert.equal(messages[0].sentAt, new Date(sentAt * 1000).toISOString());
    assert.equal(room.lastActivity, new Date(sentAt * 1000).toISOString());
  });
});

test("a contact's picture becomes the chat's avatar when the relay sends one", async () => {
  await withBridge(async ({ hub, relay }) => {
    relay.emit({
      messageId: "m1",
      chatId: "wxid_friend",
      chatName: "A Friend",
      senderId: "wxid_friend",
      senderName: "A Friend",
      // The relay shipping today sends no picture at all, so the list falls
      // back to an initial. This is the path for one that does.
      head_img_url: `${relay.url}/face.jpg`,
      body: "ping",
      timestamp: 1,
    });
    const { room, messages } = await threadWhen(
      hub,
      ({ room, messages }) => room.avatarUrl !== null && messages.length >= 1,
      "the portal to take the contact's picture",
    );
    assert.ok(room.avatarUrl, "the portal took the contact's picture");
    assert.ok(messages[0].senderAvatarUrl, "and so did the contact");
  });
});

test("a sticker arrives as the picture rather than as its markup", async () => {
  await withBridge(async ({ hub, relay }) => {
    relay.emit({
      messageId: "m1",
      chatId: "wxid_friend",
      chatName: "A Friend",
      messageKind: "emoticon",
      // What WeChat actually sends: an `<emoji>` document naming a plain CDN
      // url. Read as text it is a wall of markup, so it used to be replaced
      // with "[Sticker]" — a placeholder for a picture that was fetchable all
      // along.
      body: `<msg><emoji fromusername="wxid_friend" type="2" md5="abc" cdnurl="${relay.url}/sticker.gif?m=abc&amp;bizid=1023" width="240" height="180"></emoji></msg>`,
      timestamp: 1,
    });
    const { room, messages } = await threadWhen(
      hub,
      ({ messages }) => (messages[0]?.attachments.length ?? 0) > 0,
      "the sticker's picture to be carried across",
    );
    const [attachment] = messages[0].attachments;
    assert.equal(attachment?.kind, "image");
    assert.equal(attachment?.mimeType, "image/gif");
    assert.equal(attachment?.width, 240);
    assert.equal(
      room.preview,
      "Sticker",
      "the list names it, rather than showing markup",
    );
  });
});

test("a sticker whose picture cannot be fetched still arrives as a message", async () => {
  await withBridge(async ({ hub, relay }) => {
    relay.emit({
      messageId: "m1",
      chatId: "wxid_friend",
      chatName: "A Friend",
      messageKind: "emoticon",
      // A CDN that is unreachable — blocked, offline, or simply gone. The
      // message must still land: losing it entirely would be worse than the
      // placeholder this falls back to.
      body: `<msg><emoji md5="abc" cdnurl="${relay.url}/nothing-here.gif"></emoji></msg>`,
      timestamp: 1,
    });
    const { messages } = await threadWhen(
      hub,
      ({ messages }) => messages.length >= 1,
      "the sticker to arrive even though its picture could not be fetched",
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].attachments.length, 0);
    assert.equal(messages[0].body, "[Sticker]");
    assert.equal(
      messages[0].viewIn?.app,
      "WeChat",
      "and it says where it can be seen",
    );
  });
});

test("a Desktop MD5-only sticker resolves from saved favorites and repairs its placeholder", async () => {
  const bytes = Buffer.from("GIF89a" + "\u0000".repeat(20), "binary");
  const id = createHash("md5").update(bytes).digest("hex");
  let catalog: Array<{id: string; xml: string}> = [];
  await withBridge(async ({hub, relay}) => {
    const native = {messageId: "217", server_id: "1226123112514593737", chatId: "filehelper",
      messageKind: "emoticon", timestamp: 1788659173,
      body: `<msg><emoji md5="${id}" type="2" len="26" width="397" height="397"/><gameext type="0"/></msg>`};
    relay.emit(native);
    const before = await threadWhen(hub, ({messages}) => messages.length === 1, "the sticker placeholder");
    assert.equal(before.messages[0].viewIn?.app, "WeChat");
    catalog = [{id, xml: `<msg><emoji md5="${id}" cdnurl="${relay.url}/sticker.gif" /></msg>`}];
    relay.emit(native);
    const after = await threadWhen(hub, ({messages}) => !!messages[0]?.attachments[0]?.url, "the recovered saved sticker");
    assert.equal(after.messages.length, 1);
    assert.ok(before.messages[0].eventId);
    assert.equal(after.messages[0].eventId, before.messages[0].eventId);
    assert.equal(after.messages[0].attachments[0].mimeType, "image/gif");
    assert.equal(after.messages[0].attachments[0].width, 397);
    assert.equal(after.messages[0].viewIn, null);
    assert.equal(after.messages[0].mine, true);
    relay.emit({...native, messageId: "218", server_id: "1226123112514593738", timestamp: 1788659174});
    const again = await threadWhen(hub, ({messages}) => messages.length === 2, "a second use of the same saved sticker");
    assert.ok(again.messages.every((m) => m.attachments[0]?.mimeType === "image/gif"));
  }, undefined, {writer: {stickers: async () => catalog, write: async () => {throw new Error("must not send");}}});
});

test("a WeChat voice message carries its exact SILK bytes into Matrix", async () => {
  const bytes = Buffer.from("#!SILK_V3\u0002polymux-voice-fixture", "binary");
  const cli = await stubCli({}, undefined, bytes);
  await withBridge(
    async ({ hub, relay, homeserver, accessToken }) => {
      relay.emit({
        messageId: "voice-123",
        serverId: "900123",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "[Voice]",
        messageKind: "voice",
        fromSelf: true,
        timestamp: 1,
      });
      const { messages } = await threadWhen(
        hub,
        ({ messages }) => messages.length === 1,
        "the voice message to arrive",
      );
      assert.equal(messages[0].attachments[0]?.kind, "audio");
      assert.equal(messages[0].attachments[0]?.mimeType, "audio/silk");
      const match = /^polymux-media:\/\/([^/]+)\/(.+)$/.exec(
        messages[0].attachments[0].url,
      );
      assert.ok(match);
      const response = await fetch(
        new URL(
          `/_matrix/media/v3/download/${match[1]}/${match[2]}`,
          homeserver.baseUrl,
        ),
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      assert.equal(response.ok, true);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    },
    undefined,
    { cliPaths: [cli] },
  );
});

for (const recovery of ["stream", "cached page", "native appmsg cached page"])
test(`native voice, file and video ${recovery} recovery upgrades existing events without sends or duplicates`, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "wechat-native-media-recovery-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const fixture = await nativeInboundFixture();
  t.after(() => fixture.dispose());
  const store = {...fixture.store, messageShards: (): string[] => []} as unknown as WeChatNativeStore;
  const file = path.join(root, "clip.mp4");
  const fileBytes = Buffer.from("exact file payload");
  const voiceBytes = Buffer.from("RIFFplayable-voice-fixture");
  await writeFile(file, fileBytes);
  const cli = path.join(root, "fixture-reader");
  const cliLog = path.join(root, "external-reads.log");
  await writeFile(cli, `#!/usr/bin/env node
const fs = require('node:fs');
if (['history', 'audio'].includes(process.argv[2]))
  fs.appendFileSync(${JSON.stringify(cliLog)}, process.argv[2] + '\\n');
process.stdout.write(JSON.stringify({rows: []}));
`, {mode: 0o755});
  let available = false;
  const requests: Array<{kind: string; serverId: string; localId?: string; timestamp: number; localOnly?: boolean}> = [];
  await withBridge(async ({hub, bridge, relay, homeserver, accessToken}) => {
    const voice = {messageId: "223", serverId: "9072123356052134871", chatId: "filehelper",
      fromSelf: true, messageKind: "audio", body: "[Voice]", timestamp: 1788662525};
    const attachment = {messageId: "224", serverId: "8178394810349871736", chatId: "filehelper",
      fromSelf: true, messageKind: recovery === "native appmsg cached page" ? "appmsg" : "file",
      body: recovery === "native appmsg cached page"
        ? '<msg><appmsg><title>clip.mp4</title><type>6</type><appattach><totallen>18</totallen></appattach></appmsg></msg>'
        : "[File] clip.mp4", timestamp: 1788662561};
    const video = {messageId: "225", serverId: "8178394810349871737", chatId: "filehelper",
      fromSelf: true, messageKind: "video", body: "[Video]", timestamp: 1788662562};
    relay.emit([voice, attachment, video]);
    const before = await threadWhen(hub, ({messages}) => messages.length === 3, "the native media placeholders");
    assert.ok(before.messages.every(m => !m.attachments[0]?.url));
    available = true;
    if (recovery === "stream") relay.emit([voice, attachment, video]);
    else {
      const [room] = await hub.rooms();
      // Native history is unavailable in this fixture. Once the transient
      // identity cache expires, reading the page must still stay local.
      await new Promise(resolve => setTimeout(resolve, 2_100));
      await writeFile(cliLog, "");
      const readsBefore = requests.length;
      assert.equal(await bridge.refreshCachedMedia(room.roomId, before.messages.map(m => m.eventId)), true);
      assert.equal(requests.length - readsBefore, 3);
      assert.ok(requests.slice(readsBefore).every(request => request.localOnly === true));
      assert.equal(await bridge.refreshCachedMedia(room.roomId, before.messages.map(m => m.eventId)), false);
      assert.equal(await readFile(cliLog, "utf8"), "");
    }
    const after = await threadWhen(hub, ({messages}) => messages.length === 3 && messages.every(m => !!m.attachments[0]?.url), "native media recovery");
    assert.deepEqual(after.messages.map(m => m.eventId).sort(), before.messages.map(m => m.eventId).sort());
    assert.deepEqual(after.messages.map(m => m.sentAt), before.messages.map(m => m.sentAt));
    assert.ok(after.messages.every(m => !m.viewIn));
    assert.ok(after.messages.every(m => !m.linkPreview), "recovered media must replace the old fallback card");
    for (const message of after.messages) {
      const media = message.attachments[0];
      const match = /^polymux-media:\/\/([^/]+)\/(.+)$/.exec(media.url)!;
      const response = await fetch(new URL(`/_matrix/media/v3/download/${match[1]}/${match[2]}`, homeserver.baseUrl),
        {headers: {Authorization: `Bearer ${accessToken}`}});
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), media.kind === "audio" ? voiceBytes : fileBytes);
    }
    assert.ok(requests.some(r => r.serverId === voice.serverId && r.localId === "223" && r.timestamp === voice.timestamp));
    assert.ok(requests.some(r => r.kind === "file" && r.serverId === attachment.serverId && r.localId === "224" && r.timestamp === attachment.timestamp));
    assert.ok(requests.some(r => r.kind === "video" && r.serverId === video.serverId && r.localId === "225" && r.timestamp === video.timestamp));
    assert.equal(after.messages.find(m => m.attachments[0]?.kind === "video")?.attachments[0]?.duration, 11);
    assert.equal(relay.sent.length, 0);
  }, undefined, {cliPaths: [cli], mediaRoots: [root], preferNativeInbound: true, nativeStores: [store], writer: {
    readMedia: async request => {
      requests.push(request);
      if (!available) return null;
      return request.kind === "audio"
        ? {name: "voice.wav", mimeType: "audio/wav", size: voiceBytes.length, bodyBase64: voiceBytes.toString("base64"), durationMs: 1800}
        : {name: "clip.mp4", mimeType: "video/mp4", localPath: file, size: fileBytes.length,
          md5: createHash("md5").update(fileBytes).digest("hex"), ...(request.kind === "video" ? {durationMs: 11000} : {})};
    },
    write: async () => {throw new Error("An incoming media read must not send");},
  }});
});

test("WeChat files and videos with resolved local media become real Matrix attachments", async () => {
  const mediaRoot = await mkdtemp(
    path.join(tmpdir(), "polymux-wechat-relay-media-"),
  );
  const fileBytes = new TextEncoder().encode("inbound File Transfer fixture\n");
  const videoBytes = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
  const filePath = path.join(mediaRoot, "inbound.txt");
  const videoPath = path.join(mediaRoot, "inbound.mp4");
  await writeFile(filePath, fileBytes);
  await writeFile(videoPath, videoBytes);

  await withBridge(
    async ({ hub, relay, homeserver, accessToken }) => {
      relay.emit({
        messageId: "file-in",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "[File] inbound.txt",
        messageKind: "file",
        localPath: filePath,
        media: { filename: "inbound.txt", mimeType: "text/plain" },
        fromSelf: true,
        timestamp: 1,
      });
      relay.emit({
        messageId: "video-in",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "[Video]",
        messageKind: "video",
        local_path: videoPath,
        media: { filename: "inbound.mp4", mime: "video/mp4" },
        fromSelf: true,
        timestamp: 2,
      });
      const { messages } = await threadWhen(
        hub,
        ({ messages }) => messages.length === 2,
        "both resolved attachments to arrive",
      );
      const attachments = Object.fromEntries(
        messages.map((item) => [
          item.attachments[0]?.name,
          item.attachments[0],
        ]),
      );
      assert.equal(attachments["inbound.txt"]?.kind, "file");
      assert.equal(attachments["inbound.txt"]?.mimeType, "text/plain");
      assert.equal(attachments["inbound.mp4"]?.kind, "video");
      assert.equal(attachments["inbound.mp4"]?.mimeType, "video/mp4");

      const first = /^polymux-media:\/\/([^/]+)\/(.+)$/.exec(
        attachments["inbound.txt"].url,
      );
      assert.ok(first);
      const response = await fetch(
        new URL(
          `/_matrix/media/v3/download/${first[1]}/${first[2]}`,
          homeserver.baseUrl,
        ),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      assert.equal(response.ok, true);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), fileBytes);
    },
    undefined,
    { mediaRoots: [mediaRoot] },
  );
});

test("a message the account sent in WeChat itself is shown as its own", async () => {
  const cli = await stubCli({
    // Name2Id rows differ between shards: the account is 7 in File Transfer,
    // but 12 in this chat, where 7 belongs to the peer.
    filehelper: [{ create_time: 1, real_sender_id: "7", sender_wxid: "wxid_fixture_self" }],
    wxid_friend: [
      {local_id: "m1", server_id: "90001", create_time: 100, real_sender_id: "12", sender_wxid: "wxid_fixture_self"},
      {local_id: "m2", server_id: "90002", create_time: 100, real_sender_id: "7", sender_wxid: "wxid_friend"},
    ],
  }, undefined, undefined, "wxid_fixture_self");
  await withBridge(
    async ({ hub, relay }) => {
      // The relay reports both of these the same way — as the contact, with
      // `fromSelf` false — so without the exact native sender the user's half
      // of the conversation appears as the other person's.
      relay.emit({
        messageId: "m1",
        chatId: "wxid_friend",
        chatName: "A Friend",
        senderId: "wxid_friend",
        senderName: "A Friend",
        body: "mine",
        timestamp: 100,
      });
      relay.emit({
        messageId: "m2",
        chatId: "wxid_friend",
        senderId: "wxid_friend",
        senderName: "A Friend",
        body: "theirs",
        timestamp: 100,
      });
      const { messages } = await threadWhen(
        hub,
        ({ messages }) => messages.length >= 2,
        "both sides of the conversation to arrive",
      );
      const senders = new Map(messages.map((item) => [item.body, item.sender]));
      assert.match(
        senders.get("mine") ?? "",
        /^@polymux-/,
        "the account's own message is its own",
      );
      assert.match(
        senders.get("theirs") ?? "",
        /^@wechat_/,
        "and the contact's is still theirs",
      );
    },
    undefined,
    { cliPaths: [cli] },
  );
});

test("generic relay sender labels cannot override explicit authorship", async () => {
  const cli = await stubCli({filehelper: [{create_time: 1, real_sender_id: "7"}]},
    undefined, undefined, "wxid_fixture_self");
  await withBridge(async ({hub, relay}) => {
    relay.emit([
      {messageId: "generic-own", chatId: "wxid_generic_peer", senderId: "wxid_generic_peer",
        real_sender_id: "7", fromSelf: true, body: "own relay flag", timestamp: 100},
      {messageId: "generic-peer", chatId: "wxid_generic_peer", senderId: "wxid_generic_peer",
        real_sender_id: "7", fromSelf: false, body: "peer relay flag", timestamp: 101},
    ]);
    const {messages} = await threadWhen(hub, thread => thread.messages.length === 2,
      "relay flags without trustworthy shard identity");
    assert.match(messages.find(row => row.body === "own relay flag")?.sender ?? "", /^@polymux-/);
    assert.match(messages.find(row => row.body === "peer relay flag")?.sender ?? "", /^@wechat_/);
  }, undefined, {cliPaths: [cli]});
});

test("native numeric authorship uses the target chat's own shard", async () => {
  const queriedChats: string[] = [];
  const native = await nativeInboundFixture({senderIdForChat: chatId => {
    queriedChats.push(chatId);
    return chatId === "filehelper" ? "7" : "12";
  }});
  try {
    await withBridge(async ({hub}) => {
      await until(() => native.snapshots > 0, "native identity preflight");
      await native.commit("wxid_sharded_peer", ["target shard self", "target shard peer"], [
        {senderWxid: null, realSenderId: 12}, {senderWxid: null, realSenderId: 7},
      ]);
      const {messages} = await threadWhen(hub, thread => thread.messages.length === 2,
        "target-shard numeric attribution");
      assert.match(messages.find(row => row.body === "target shard self")?.sender ?? "", /^@polymux-/);
      assert.match(messages.find(row => row.body === "target shard peer")?.sender ?? "", /^@wechat_/);
      assert.ok(queriedChats.includes("wxid_sharded_peer"));
      assert.equal(queriedChats.includes("filehelper"), false);
    }, undefined, {nativeStores: [native.store], preferNativeInbound: true, readSyncSweepMs: 20}, false);
  } finally {await native.dispose();}
});

test("native text reconciliation verifies the target shard without an external CLI", async () => {
  const native = await nativeInboundFixture({
    timestamp: Math.floor(Date.now() / 1000),
    senderIdForChat: chatId => chatId === "filehelper" ? "7" : "42",
  });
  const chatId = "wxid_native_reconcile_peer";
  try {
    await native.commit(chatId, ["ready"]);
    await withBridge(async ({bridge, hub, relay}) => {
      const {room} = await threadWhen(hub, thread => thread.messages.some(row => row.body === "ready"),
        "the native reconciliation target");
      const eventId = await hub.send(room.roomId, "native-only acknowledgement");
      await bridge.waitForOutbound(eventId, 5_000);
      const messages = (await hub.messages(room.roomId, 20)).messages;
      assert.equal(messages.filter(row => row.body === "native-only acknowledgement").length, 1);
      assert.equal(relay.connections, 0);
    }, relay => relay.setHijackArmed(false), {
      nativeStores: [native.store], preferNativeInbound: true, outboundReconcileMs: 400,
      primeApp: async () => false,
      writer: {write: async () => {
        await native.commit(chatId, ["ready", "native-only acknowledgement"], [
          {senderWxid: chatId, realSenderId: 7}, {senderWxid: null, realSenderId: 42},
        ]);
        return {deliveredVerified: false, reason: "native acknowledgement delayed"};
      }},
    }, false);
  } finally {await native.dispose();}
});

for (const candidate of [
  {name: "self", senderWxid: "wxid_fixture_self", localSender: 42, accepted: true},
  {name: "peer", senderWxid: "wxid_reconcile_peer", localSender: 7, accepted: false},
]) {
  test(`text reconciliation identifies the ${candidate.name} by stable wxid across shards`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "wechat-sharded-send-"));
    const submitted = path.join(directory, "submitted.json");
    const cli = path.join(directory, "wechat-use");
    const at = Math.floor(Date.now() / 1000);
    await writeFile(cli, `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] === 'accounts') {
  process.stdout.write(JSON.stringify({default:['com.tencent.xinWeChat','wxid_fixture_self'],accounts:[{wxid:'wxid_fixture_self'}]}));
} else {
  const rows = process.argv[3] === 'filehelper'
    ? [{create_time:${at}, real_sender_id:'7', sender_wxid:'wxid_fixture_self'}]
    : fs.existsSync(${JSON.stringify(submitted)}) ? [JSON.parse(fs.readFileSync(${JSON.stringify(submitted)},'utf8'))] : [];
  const fields = (process.argv[process.argv.indexOf('--fields') + 1] || '').split(',');
  process.stdout.write(JSON.stringify({rows:rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>fields.includes(key))))}));
}
`, {mode: 0o700});
    try {
      await withBridge(async ({bridge, hub, relay}) => {
        relay.emit({messageId: "sharded-send-opener", chatId: "wxid_reconcile_peer",
          senderId: "wxid_reconcile_peer", body: "ready", timestamp: at - 1});
        const {room} = await threadWhen(hub, thread => thread.messages.length === 1, "the reconciliation target");
        const eventId = await hub.send(room.roomId, "sharded reconciliation text");
        if (candidate.accepted) await bridge.waitForOutbound(eventId, 5_000);
        else await assert.rejects(bridge.waitForOutbound(eventId, 5_000), /fixture send uncertain/);
      }, relay => relay.setHijackArmed(false), {
        cliPaths: [cli], outboundReconcileMs: 400, primeApp: async () => false,
        writer: {write: async () => {
          await writeFile(submitted, JSON.stringify({create_time: at, real_sender_id: candidate.localSender,
            sender_wxid: candidate.senderWxid, server_id: "sharded-new-server-id",
            message_kind: "text", message_content: "sharded reconciliation text"}));
          return {deliveredVerified: false, reason: "fixture send uncertain"};
        }},
      });
    } finally {await rm(directory, {recursive: true, force: true});}
  });
}

test("a WeChat system item is a conversation notice, not the account's message", async () => {
  await withBridge(async ({ hub, relay }) => {
    relay.emit({
      messageId: "system-1",
      chatId: "group-1",
      chatName: "A Group",
      body: "Peter6C invited Percival to the group chat",
      messageKind: "system",
      fromSelf: true,
      timestamp: 1,
    });
    const { messages } = await threadWhen(
      hub,
      ({ messages }) => messages.length === 1,
      "the group event to arrive",
    );
    assert.equal(messages[0].notice, true);
    assert.doesNotMatch(messages[0].sender, /^@polymux-/);
  });
});

test("a WeChat built-in emoji is displayed as the glyph its client paints", async () => {
  await withBridge(async ({ hub, relay }) => {
    relay.emit({
      messageId: "emoji-1",
      chatId: "wxid_friend",
      body: "Hello [Salute] [Facepalm] [Coffee]",
      messageKind: "text",
      timestamp: 1,
    });
    const { messages } = await threadWhen(
      hub,
      ({ messages }) => messages.length === 1,
      "the emoji to arrive",
    );
    assert.equal(messages[0].body, "Hello 🫡 🤦 ☕");
  });
});

test("a reply cannot silently become painted text without a native writer", async () => {
  await withBridge(async ({ hub, relay, bridge }) => {
    relay.emit({
      messageId: "m1", server_id: "server-m1",
      chatId: "wxid_friend",
      senderName: "Alex",
      body: "ping",
      timestamp: 1,
    });
    const [room] = await roomsWhen(
      hub,
      (rooms) => rooms.length === 1,
      "the portal to open",
    );
    const { messages } = await threadWhen(
      hub,
      ({ messages }) => messages.length === 1,
      "the quoted message to arrive",
    );
    const eventId = await hub.send(room.roomId, "pong", messages[0].eventId);
    await assert.rejects(bridge.waitForOutbound(eventId), /native replies require the bundled writer/);
    assert.equal(relay.sent.length, 0);
  });
});

test("native history paging imports older rows once without creating unread badges", async () => {
  const rows = Array.from({length: 95}, (_, index) => ({
    messageId: `history-${index}`, chatId: "wxid_history", senderId: "wxid_history",
    body: `old ${index}`, timestamp: 100 + Math.floor(index / 3),
  }));
  await withBridge(async ({bridge, hub, relay}) => {
    const {room} = await threadWhen(hub, ({messages}) => messages.length === 10,
      "the initial history page");
    await roomsWhen(hub, (rooms) => rooms[0]?.unread === 0, "the native read count");
    relay.emit({messageId: "live", chatId: "wxid_history", senderId: "wxid_history",
      body: "new live message", timestamp: 200});
    await roomsWhen(hub, (rooms) => rooms[0]?.unread === 1, "one unread live message");
    let more = true;
    let pages = 0;
    while (more && pages++ < 10) more = await bridge.loadOlderHistory(room.roomId, 17);
    assert.equal(more, false);
    const history = await hub.messages(room.roomId, 200);
    assert.equal(history.messages.length, 96);
    assert.equal(new Set(history.messages.map((row) => row.body)).size, 96);
    assert.equal((await hub.rooms())[0].unread, 1);
    assert.equal((await hub.unread(200)).length, 1);
    assert.equal(await bridge.loadOlderHistory(room.roomId, 17), false);
  }, (relay) => {
    relay.catalogue.chats = [{username: "wxid_history", display_name: "History", unread_count: 0}];
    relay.catalogue.history.wxid_history = rows;
  });
});

test("history coverage is checked again after a stream interruption", async () => {
  await withBridge(async ({bridge, hub, relay}) => {
    const {room} = await threadWhen(hub, ({messages}) => messages.length === 1,
      "the original archive");
    assert.equal(await bridge.loadOlderHistory(room.roomId, 5), false);
    relay.catalogue.history.wxid_history.push({messageId: "missed", chatId: "wxid_history",
      body: "arrived while disconnected", timestamp: 20});
    const connections = relay.connections;
    relay.dropStream();
    await until(() => relay.connections > connections, "the reconnected native stream");
    assert.equal(await bridge.loadOlderHistory(room.roomId, 5, 10_000), false);
    assert.deepEqual((await hub.messages(room.roomId, 10)).messages.map((row) => row.body),
      ["arrived while disconnected", "original"]);
  }, (relay) => {
    relay.catalogue.chats = [{username: "wxid_history", unread_count: 0}];
    relay.catalogue.history.wxid_history = [
      {messageId: "original", chatId: "wxid_history", body: "original", timestamp: 10},
    ];
  });
});

test("incoming structured quotes link to the native target and recall removes it", async () => {
  await withBridge(async ({bridge, hub, relay}) => {
    const original = {messageId: "local-original", server_id: "18446744073709551615", chatId: "wxid_quotes",
      senderId: "wxid_quotes", senderName: "Alex", body: "original", timestamp: 10};
    relay.emit(original);
    const {room, messages} = await threadWhen(hub, ({messages}) => messages.length === 1,
      "the quoted native message");
    relay.emit({messageId: "reply", chatId: "wxid_quotes", senderId: "wxid_quotes",
      body: "answer", timestamp: 11, messageKind: "appmsg",
      refer: {svrId: original.server_id, displayName: "Alex", content: "original"}});
    const quoted = await threadWhen(hub, ({messages}) => messages.length === 2,
      "the structured quote");
    assert.equal(quoted.messages.find((row) => row.body === "answer")?.replyTo, messages[0].eventId);
    relay.emit({messageId: "recall", chatId: "wxid_quotes", messageKind: "recalled",
      body: "Alex recalled a message", timestamp: 12,
      recall: {replacedMsgId: original.server_id, text: "Alex recalled a message"}});
    await threadWhen(hub, ({messages}) => !messages.some((row) => row.body === "original"),
      "the native recall to remove its exact target");
    relay.catalogue.history.wxid_quotes = [original];
    await bridge.loadOlderHistory(room.roomId, 10);
    assert.equal((await hub.messages(room.roomId, 20)).messages.some((row) => row.body === "original"), false);
    assert.equal(relay.sent.length, 0);
  });
});

test("a native read refusal leaves the local unread badge unchanged", async () => {
  const writes: WeChatWriteRequest[] = [];
  await withBridge(async ({bridge, hub, relay}) => {
    relay.emit({messageId: "unread", chatId: "wxid_read", senderId: "wxid_read",
      body: "still unread", timestamp: 10});
    const {room, messages} = await threadWhen(hub, ({messages}) => messages.length === 1,
      "an unread message");
    assert.equal((await hub.rooms())[0].unread, 1);
    await assert.rejects(bridge.markRead(room.roomId, messages[0].eventId), /still reports/);
    assert.equal((await hub.rooms())[0].unread, 1);
    assert.deepEqual(writes, [{kind: "read", chatId: "wxid_read"}]);
  }, undefined, {writer: {write: async (request) => {
    writes.push(request);
    return {deliveredVerified: false, reason: "WeChat still reports 1 unread item"};
  }}});
});

test("an unknown reply target is refused before either native or relay sending", async () => {
  const writes: WeChatWriteRequest[] = [];
  await withBridge(async ({bridge, hub, relay}) => {
    relay.emit({messageId: "seed", chatId: "filehelper", body: "ready", timestamp: 1});
    const {room} = await threadWhen(hub, ({messages}) => messages.length === 1, "File Transfer");
    const eventId = await hub.send(room.roomId, "reply", "$unknown");
    await assert.rejects(bridge.waitForOutbound(eventId), /no verified native message id/);
    assert.equal(writes.length, 0);
    assert.equal(relay.sent.length, 0);
  }, undefined, {writer: {write: async (request) => {
    writes.push(request); return {deliveredVerified: true};
  }}});
});

test("an outbound Matrix location reaches File Transfer with its coordinates", async () => {
  await withBridge(async ({ hub, relay, homeserver, accessToken }) => {
    relay.emit({
      messageId: "open",
      chatId: "filehelper",
      chatName: "File Transfer",
      body: "ready",
      fromSelf: true,
      timestamp: 1,
    });
    const [room] = await roomsWhen(
      hub,
      (rooms) => rooms.length === 1,
      "File Transfer to open",
    );
    const response = await fetch(
      new URL(
        `/_matrix/client/v3/rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/location-parity`,
        homeserver.baseUrl,
      ),
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          msgtype: "m.location",
          body: "NUS School of Computing",
          geo_uri: "geo:1.2966,103.7764",
        }),
      },
    );
    assert.equal(response.ok, true);
    await until(() => relay.sent.length === 1, "the location to reach WeChat");
    assert.deepEqual(relay.sent, [
      {
        chatId: "filehelper",
        message: "NUS School of Computing\ngeo:1.2966,103.7764",
      },
    ]);
  });
});

test("an uncertain relay send is never primed and replayed", async () => {
  let primes = 0;
  await withBridge(
    async ({bridge, hub, relay}) => {
      relay.emit({
        messageId: "prime-open",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      relay.sendResults.push(
        {
          success: false,
          error: "slot_send_bp_armed_no_fire",
          diagnostic: {reason: "slot_send_bp_armed_no_fire"},
        },
        {success: true, messageId: "primed-send"},
      );
      const eventId = await hub.send(room.roomId, "one attempt only");
      await assert.rejects(bridge.waitForOutbound(eventId, 5_000), /slot_send_bp_armed_no_fire/);
      assert.equal(primes, 0);
      assert.deepEqual(relay.sent, [{chatId: "filehelper", message: "one attempt only"}]);
    },
    undefined,
    {
      primeApp: async () => {
        primes += 1;
        return true;
      },
    },
  );
});

test("native text does not depend on warming the relay send chain", async () => {
  let primes = 0;
  const writes: WeChatWriteRequest[] = [];
  await withBridge(
    async ({bridge, hub, relay}) => {
      relay.emit({
        messageId: "writer-prime-open",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      const first = await hub.send(room.roomId, "writer after hidden prime");
      await bridge.waitForOutbound(first, 2_000);
      const second = await hub.send(room.roomId, "already warm");
      await bridge.waitForOutbound(second, 2_000);
      assert.equal(primes, 0);
      assert.deepEqual(writes, [
        {kind: "text", chatId: "filehelper", body: "writer after hidden prime"},
        {kind: "text", chatId: "filehelper", body: "already warm"},
      ]);
      assert.equal(relay.sent.length, 0);
    },
    (relay) => relay.setHijackArmed(false),
    {
      primeApp: async () => {
        primes += 1;
        return true;
      },
      writer: {
        write: async (request) => {
          writes.push({...request});
          return {deliveredVerified: true};
        },
      },
    },
  );
});

test("outbound readiness requires the relay's send chain, not health alone", async () => {
  let primes = 0;
  await withBridge(
    async ({bridge}) => {
      assert.equal(await bridge.outboundReady(), false);
      assert.equal(primes, 1);
    },
    (relay) => relay.setHijackArmed(false),
    {
      primeApp: async () => {
        primes += 1;
        return false;
      },
    },
  );
});

test("outbound readiness accepts a relay armed by the background primer", async () => {
  let relayRef: Relay | undefined;
  await withBridge(
    async ({bridge}) => {
      assert.equal(await bridge.outboundReady(), true);
    },
    (relay) => {
      relayRef = relay;
      relay.setHijackArmed(false);
    },
    {
      primeApp: async () => {
        relayRef?.setHijackArmed(true);
        return true;
      },
    },
  );
});

test("outbound readiness accepts the native fallback without pausing a healthy relay", async () => {
  let readinessChecks = 0;
  let relayRef: Relay | undefined;
  await withBridge(
    async ({bridge}) => {
      assert.equal(await bridge.outboundReady(), true);
      assert.equal(await bridge.outboundReady(), true);
      assert.equal(readinessChecks, 0, "status does not interrupt the relay");
    },
    (relay) => {
      relayRef = relay;
      relay.setHijackArmed(false);
    },
    {
      primeApp: async () => false,
      writer: {
        ready: async () => {
          readinessChecks += 1;
          relayRef?.setHijackArmed(true);
          return true;
        },
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("a signed-in desktop prepares its guarded writer once without relay reads", async () => {
  let primes = 0;
  let readinessChecks = 0;
  await withBridge(
    async ({bridge, hub}) => {
      assert.equal(await bridge.outboundReady(), true);
      assert.equal(await bridge.outboundReady(), true);
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to appear after explicit readiness",
      );
      assert.equal(room.name, "File Transfer");
      assert.equal(primes, 0);
      assert.equal(readinessChecks, 1);
    },
    (relay) => relay.setHijackArmed(false),
    {
      primeApp: async () => {
        primes += 1;
        return true;
      },
      sessionState: async () => "signed_in",
      writer: {
        ready: async () => {
          readinessChecks += 1;
          return true;
        },
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("a signed-out desktop refuses immediately without probing or priming it", async () => {
  let primes = 0;
  let readinessChecks = 0;
  await withBridge(
    async ({bridge}) => {
      assert.equal(await bridge.outboundReady(), false);
      assert.equal(primes, 0);
      assert.equal(readinessChecks, 0);
    },
    undefined,
    {
      primeApp: async () => {
        primes += 1;
        return true;
      },
      sessionState: async () => "signed_out",
      writer: {
        ready: async () => {
          readinessChecks += 1;
          return true;
        },
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("a direct Matrix send cannot bypass the signed-in desktop gate", async () => {
  let launches = 0;
  let writes = 0;
  await withBridge(
    async ({bridge, hub, relay, homeserver}) => {
      relay.emit({
        messageId: "signed-out-open",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "existing history",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      const eventId = await hub.send(room.roomId, "must stay local");
      await assert.rejects(
        bridge.waitForOutbound(eventId, 2_000),
        /Open WeChat and sign in/,
      );
      homeserver.discardOutbound(eventId);
      assert.equal(launches, 0);
      assert.equal(writes, 0);
      assert.equal(relay.sent.length, 0);
    },
    undefined,
    {
      outboundReconcileMs: 0,
      ensureAppRunning: async () => {
        launches += 1;
        return true;
      },
      sessionState: async () => "signed_out",
      writer: {
        write: async () => {
          writes += 1;
          return {deliveredVerified: true};
        },
      },
    },
  );
});

test("a disconnected relay wakes the writer without its native readiness probe", async () => {
  let readinessChecks = 0;
  let launches = 0;
  let primes = 0;
  const logs: string[] = [];
  await withBridge(
    async ({bridge, relay}) => {
      relay.disconnect();
      assert.equal(await bridge.outboundReady(), true);
      assert.equal(await bridge.outboundReady(), true);
      await until(
        () => logs.some((line) => line.includes("no relay binary")),
        "the explicit wake to start inbound sync immediately",
      );
      assert.equal(launches, 1);
      assert.equal(primes, 1);
      assert.equal(
        readinessChecks,
        0,
        "ordinary chat wake-up never attaches the native readiness probe",
      );
    },
    undefined,
    {
      log: (line) => logs.push(line),
      ensureAppRunning: async () => {
        launches += 1;
        return true;
      },
      primeApp: async () => {
        primes += 1;
        return true;
      },
      writer: {
        ready: async () => {
          readinessChecks += 1;
          return false;
        },
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("a cold writer wake does not wait for stalled inbound relay health", async () => {
  let stallHealth = false;
  let launches = 0;
  let desktopRunning = false;
  await withBridge(
    async ({bridge, relay}) => {
      relay.disconnect();
      stallHealth = true;
      const startedAt = Date.now();
      assert.equal(await bridge.outboundReady(), true);
      assert.ok(
        Date.now() - startedAt < 1_500,
        "the desktop writer should win before the inbound health timeout",
      );
      assert.equal(launches, 1);
    },
    undefined,
    {
      fetch: async (input, init) => {
        const target = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        if (stallHealth && target.pathname === "/health") {
          return await new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            const aborted = (): void =>
              reject(signal?.reason ?? new Error("health probe aborted"));
            if (signal?.aborted) aborted();
            else signal?.addEventListener("abort", aborted, {once: true});
          });
        }
        return await globalThis.fetch(input, init);
      },
      ensureAppRunning: async () => {
        launches += 1;
        desktopRunning = true;
        return true;
      },
      sessionState: async () => desktopRunning ? "signed_in" : "unavailable",
      primeApp: async () => true,
      writer: {
        ready: async () => false,
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("a cold native reply does not wait out the writer priority lease", async () => {
  let controlled: Relay | undefined;
  let desktopRunning = false;
  let writerStartedAt = 0;
  await withBridge(
    async ({bridge, hub, relay}) => {
      relay.emit({
        messageId: "cold-reply-target", server_id: "cold-reply-target",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "reply here",
        fromSelf: true,
        timestamp: 1,
      });
      const thread = await threadWhen(
        hub,
        ({ messages }) => messages.length === 1,
        "the cold reply target",
      );
      relay.disconnect();
      assert.equal(await bridge.outboundReady(), true);

      const requestedAt = Date.now();
      const eventId = await hub.send(
        thread.room.roomId,
        "reply without a five-second stall",
        thread.messages[0].eventId,
      );
      await bridge.waitForOutbound(eventId, 3_000);
      assert.ok(writerStartedAt >= requestedAt);
      assert.ok(
        writerStartedAt - requestedAt < 2_000,
        "the native reply should enter the writer during its priority lease",
      );

      const deliveredAt = Date.now();
      await until(
        () => relay.connections >= 2,
        "inbound relay recovery after the native reply",
      );
      assert.ok(
        Date.now() - deliveredAt < 2_000,
        "inbound recovery should not wait out the remaining priority lease",
      );
    },
    (relay) => {
      controlled = relay;
    },
    {
      ensureAppRunning: async () => {
        desktopRunning = true;
        controlled?.reconnect();
        return true;
      },
      primeApp: async () => true,
      sessionState: async () => (desktopRunning ? "signed_in" : "unavailable"),
      writer: {
        write: async () => {
          writerStartedAt = Date.now();
          return {
            deliveredVerified: true,
            messageId: "cold-reply-server-id",
          };
        },
      },
    },
  );
});

test("a freshly hidden cold composer is reused when its relay stays attached", async () => {
  let controlled: Relay | undefined;
  let desktopRunning = false;
  let launches = 0;
  let sessionReads = 0;
  let primes = 0;
  await withBridge(
    async ({bridge, relay}) => {
      controlled = relay;
      relay.disconnect();
      assert.equal(await bridge.outboundReady(), true);
      assert.equal(await bridge.outboundReady(), true);
      assert.equal(launches, 1, "one explicit wake prepares both send stages");
      assert.equal(primes, 1, "the hidden composer is not selected twice");
    },
    undefined,
    {
      ensureAppRunning: async () => {
        launches += 1;
        desktopRunning = true;
        controlled?.reconnect();
        return true;
      },
      sessionState: async () => {
        if (!desktopRunning) return "unavailable";
        sessionReads += 1;
        return sessionReads === 1 ? "signed_in" : "unavailable";
      },
      primeApp: async () => {
        primes += 1;
        return true;
      },
      writer: {
        ready: async () => false,
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("a cold remembered login settles before the relay can reattach", async () => {
  const order: string[] = [];
  let sessionChecks = 0;
  let readinessChecks = 0;
  await withBridge(
    async ({bridge, relay}) => {
      relay.disconnect();
      assert.equal(await bridge.outboundReady(), true);
      await until(
        () => sessionChecks === 2 && order.filter((item) => item === "prime").length === 2,
        "remembered login and its final composer selection",
      );
      assert.deepEqual(order.slice(0, 5), [
        "launch",
        "prime",
        "session:false",
        "session:true",
        "prime",
      ]);
      assert.equal(
        readinessChecks,
        0,
        "the slower native readiness fallback is unnecessary",
      );
    },
    undefined,
    {
      ensureAppRunning: async () => {
        order.push("launch");
        return true;
      },
      primeApp: async () => {
        order.push("prime");
        return true;
      },
      sessionReady: async () => {
        sessionChecks += 1;
        const ready = sessionChecks >= 2;
        order.push(`session:${ready}`);
        return ready;
      },
      writer: {
        ready: async () => {
          readinessChecks += 1;
          return false;
        },
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("a remembered account waits through its rebuild without a native debugger", async () => {
  const order: string[] = [];
  let sessionChecks = 0;
  let readinessChecks = 0;
  await withBridge(
    async ({bridge, relay}) => {
      relay.disconnect();
      assert.equal(await bridge.outboundReady(), true);
      await until(
        () => order.includes("prime"),
        "the signed-in composer to be selected after native login",
      );
      assert.deepEqual(order.slice(0, 7), [
        "session:remembered_login",
        "launch",
        "session:remembered_login",
        "session:unavailable",
        "session:interactive_login",
        "session:signed_in",
        "prime",
      ]);
      assert.equal(readinessChecks, 0);
    },
    undefined,
    {
      ensureAppRunning: async () => {
        order.push("launch");
        return true;
      },
      primeApp: async () => {
        order.push("prime");
        return true;
      },
      sessionState: async () => {
        sessionChecks += 1;
        const state = sessionChecks <= 2
          ? "remembered_login"
          : sessionChecks === 3
            ? "unavailable"
            : sessionChecks === 4
              ? "interactive_login"
              : "signed_in";
        order.push(`session:${state}`);
        return state;
      },
      writer: {
        ready: async () => {
          readinessChecks += 1;
          return false;
        },
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("remembered login does not bypass unconfirmed login options", async () => {
  let checks = 0;
  let nativeRequests = 0;
  let optionChecks = 0;
  await withBridge(async ({bridge, relay}) => {
    relay.disconnect();
    assert.equal(await bridge.outboundReady(), false);
    assert.equal(optionChecks, 1);
    assert.equal(nativeRequests, 0);
  }, undefined, {
    ensureAppRunning: async () => true,
    primeApp: async () => false,
    sessionState: async () => ++checks <= 4 ? "remembered_login" : "signed_out",
    prepareLoginOptions: async () => { optionChecks += 1; return false; },
    writer: {
      ready: async () => { nativeRequests += 1; return true; },
      write: async () => ({deliveredVerified: true}),
    },
  });
});

test("remembered login recovery keeps readiness pending until it settles", async () => {
  let readinessStarted!: () => void;
  let releaseReadiness!: () => void;
  const started = new Promise<void>((resolve) => {
    readinessStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseReadiness = resolve;
  });
  let readinessChecks = 0;
  await withBridge(
    async ({bridge, relay}) => {
      relay.disconnect();
      let settled = false;
      const readiness = bridge.outboundReady().finally(() => {
        settled = true;
      });
      await started;
      assert.equal(readinessChecks, 1);
      assert.equal(
        settled,
        false,
        "native dispatch must remain blocked during remembered login",
      );
      releaseReadiness();
      assert.equal(await readiness, false);
    },
    undefined,
    {
      desktopSessionWarmupMs: 0,
      ensureAppRunning: async () => true,
      primeApp: async () => false,
      writer: {
        ready: async () => {
          readinessChecks += 1;
          readinessStarted();
          await released;
          return false;
        },
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("a slow launch stays pending without entering the native readiness probe", async () => {
  let readinessChecks = 0;
  let launches = 0;
  let sessionChecks = 0;
  await withBridge(
    async ({bridge, relay}) => {
      relay.disconnect();
      const started = Date.now();
      assert.equal(await bridge.outboundReady(), true);
      assert.ok(Date.now() - started < 1_000);
      assert.equal(launches, 1);
      assert.equal(readinessChecks, 0);
    },
    undefined,
    {
      desktopSessionWarmupMs: 0,
      ensureAppRunning: async () => {
        launches += 1;
        return true;
      },
      primeApp: async () => false,
      sessionState: async () => {
        sessionChecks += 1;
        return sessionChecks >= 4 ? "signed_in" : "launching";
      },
      writer: {
        ready: async () => {
          readinessChecks += 1;
          return false;
        },
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("a locked desktop session refuses a cold wake without native probing", async () => {
  let readinessChecks = 0;
  await withBridge(
    async ({bridge, relay}) => {
      relay.disconnect();
      assert.equal(await bridge.outboundReady(), false);
      assert.equal(readinessChecks, 0);
    },
    undefined,
    {
      ensureAppRunning: async () => true,
      primeApp: async () => false,
      sessionState: async () => "locked",
      writer: {
        ready: async () => {
          readinessChecks += 1;
          return false;
        },
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("an unarmed relay that cannot be primed uses the native writer immediately", async () => {
  let primes = 0;
  const writes: WeChatWriteRequest[] = [];
  await withBridge(
    async ({bridge, hub, relay}) => {
      relay.emit({
        messageId: "writer-cold-open",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      const eventId = await hub.send(room.roomId, "bypass the cold relay");
      await bridge.waitForOutbound(eventId, 2_000);
      // A local health probe that times out under load can skip the optional
      // primer and fall straight through to the same verified native writer.
      // What must not happen is repeated warm-up or an ambiguous relay send.
      assert.ok(primes <= 1);
      assert.equal(relay.sent.length, 0, "the known-cold relay is not given a timeout-sized attempt");
      assert.deepEqual(writes, [{kind: "text", chatId: "filehelper", body: "bypass the cold relay"}]);
    },
    (relay) => relay.setHijackArmed(false),
    {
      primeApp: async () => {
        primes += 1;
        return false;
      },
      writer: {
        write: async (request) => {
          writes.push({...request});
          return {deliveredVerified: true, messageId: "native-cold-send"};
        },
      },
    },
  );
});

test("plain text reaches the native writer before any relay send", async () => {
  const writes: WeChatWriteRequest[] = [];
  let appChecks = 0;
  await withBridge(
    async ({bridge, hub, relay}) => {
      relay.emit({
        messageId: "cold-writer-open",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      relay.sendResults.push({
        success: false,
        error: "wechat_not_running",
        diagnostic: {reason: "wechat_not_running"},
      });
      const eventId = await hub.send(room.roomId, "native without relay wait");
      await bridge.waitForOutbound(eventId, 2_000);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].kind, "text");
      assert.equal(appChecks, 1, "only the native critical section checks WeChat");
      assert.equal(relay.sent.length, 0, "the relay route cannot precede the guarded writer");
    },
    undefined,
    {
      ensureAppRunning: async () => {
        appChecks += 1;
        return true;
      },
      writer: {
        write: async (request) => {
          writes.push({...request});
          return {deliveredVerified: true, messageId: "cold-native-server-id"};
        },
      },
    },
  );
});

test("a newly relaunched desktop is primed after the daemon attaches", async () => {
  const order: string[] = [];
  let controlled: Relay | undefined;
  await withBridge(
    async ({bridge, hub, relay}) => {
      controlled = relay;
      relay.emit({
        messageId: "relaunch-prime-open",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      relay.setWeChatAttached(false);
      const eventId = await hub.send(room.roomId, "warm before one send");
      await bridge.waitForOutbound(eventId, 3_000);
      assert.deepEqual(order, ["launch", "prime", "write"]);
      assert.equal(
        relay.sent.length,
        0,
        "an unattached relay is never given an ambiguous first send",
      );
    },
    undefined,
    {
      ensureAppRunning: async () => {
        order.push("launch");
        controlled?.setWeChatAttached(true);
        controlled?.setHijackArmed(true);
        return true;
      },
      primeApp: async () => {
        order.push("prime");
        return true;
      },
      writer: {
        write: async () => {
          order.push("write");
          return {deliveredVerified: true, messageId: "relaunch-verified"};
        },
      },
    },
  );
});

test("an active daemon cannot bypass the guarded native text writer", async () => {
  let nativeWrites = 0;
  await withBridge(
    async ({bridge, hub, relay}) => {
      relay.emit({
        messageId: "active-daemon-open",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      const eventId = await hub.send(room.roomId, "daemon stays active");
      await bridge.waitForOutbound(eventId, 5_000);
      assert.deepEqual(relay.sent, []);
      assert.equal(nativeWrites, 1);
    },
    undefined,
    {
      writer: {
        write: async () => {
          nativeWrites += 1;
          return {deliveredVerified: true};
        },
      },
    },
  );
});

test("native text fallback defers relay ingestion until its writer finishes", async () => {
  let finishWrite!: () => void;
  let writerStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    writerStarted = resolve;
  });
  const finish = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  await withBridge(
    async ({bridge, hub, relay}) => {
      relay.emit({
        messageId: "desktop-fallback-open",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      const eventId = await hub.send(room.roomId, "desktop pipeline");
      await started;

      relay.emit({
        messageId: "during-desktop-fallback",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "arrived while sending",
        fromSelf: true,
        timestamp: 2,
      });
      finishWrite();
      await bridge.waitForOutbound(eventId, 2_000);
      await threadWhen(
        hub,
        ({messages}) =>
          messages.some((item) => item.body === "arrived while sending"),
        "the queued relay message to arrive after native sending",
      );
      assert.equal(
        relay.connections,
        1,
        "desktop-owned text does not tear down and reconnect the relay",
      );
    },
    (relay) => relay.setHijackArmed(false),
    {
      primeApp: async () => false,
      writer: {
        write: async () => {
          writerStarted();
          await finish;
          return {deliveredVerified: true, messageId: "desktop-server-id"};
        },
      },
    },
  );
});

test("a shared Hub image is sent to WeChat and its returned echo is not duplicated", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "polymux-wechat-image-send-"),
  );
  const log = path.join(directory, "send.jsonl");
  const cli = await stubCli({}, log);
  await withBridge(
    async ({ hub, relay }) => {
      relay.emit({
        messageId: "open",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      const url = await hub.upload("parity.png", "image/png", bytes);
      await hub.sendMedia(room.roomId, {
        url,
        name: "parity.png",
        msgtype: "m.image",
        mimetype: "image/png",
        size: bytes.length,
      });
      await until(() => existsSync(log), "the image to reach WeChat");
      const sent = JSON.parse((await readFile(log, "utf8")).trim()) as {
        args: string[];
        bytes: string;
      };
      assert.deepEqual(sent.args.slice(-3), ["--wxid", "filehelper", "--json"]);
      assert.deepEqual(Buffer.from(sent.bytes, "base64"), Buffer.from(bytes));

      relay.emit({
        messageId: "image-echo",
        chatId: "filehelper",
        messageKind: "image",
        body: "[Photo]",
        fromSelf: true,
        timestamp: 2,
      });
      relay.emit({
        messageId: "after",
        chatId: "filehelper",
        body: "after image",
        fromSelf: true,
        timestamp: 3,
      });
      const { messages } = await threadWhen(
        hub,
        ({ messages }) => messages.some((item) => item.body === "after image"),
        "the event after the image echo",
      );
      assert.equal(
        messages.filter((item) =>
          item.attachments.some((attachment) => attachment.kind === "image"),
        ).length,
        1,
      );
    },
    undefined,
    { cliPaths: [cli] },
  );
});

test("a Hub video sent as a desktop file keeps one video bubble", async () => {
  const writes: WeChatWriteRequest[] = [];
  await withBridge(
    async ({ hub, relay }) => {
      relay.emit({
        messageId: "open",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      const bytes = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]);
      const url = await hub.upload("parity.mp4", "video/mp4", bytes);
      await hub.sendMedia(room.roomId, {
        url,
        name: "parity.mp4",
        msgtype: "m.video",
        mimetype: "video/mp4",
        size: bytes.length,
      });
      await until(() => writes.length === 1, "the video to reach WeChat");
      assert.equal(writes[0]?.kind, "media");
      if (writes[0]?.kind === "media") {
        assert.equal(writes[0].mediaType, "video");
        assert.equal(writes[0].name, "parity.mp4");
      }

      relay.emit({
        messageId: "video-file-echo",
        server_id: "video-file-native",
        chatId: "filehelper",
        messageKind: "file",
        body: "[File] parity.mp4",
        fromSelf: true,
        timestamp: 2,
      });
      relay.emit({
        messageId: "after-video",
        chatId: "filehelper",
        body: "after video",
        fromSelf: true,
        timestamp: 3,
      });
      const { messages } = await threadWhen(
        hub,
        ({ messages }) => messages.some((item) => item.body === "after video"),
        "the event after the video file echo",
      );
      assert.equal(
        messages.filter((item) =>
          item.attachments.some((attachment) => attachment.kind === "video"),
        ).length,
        1,
      );
      assert.equal(
        messages.filter((item) =>
          item.attachments.some((attachment) => attachment.kind === "file"),
        ).length,
        0,
      );
    },
    undefined,
    {
      writer: {
        write: async (request) => {
          writes.push({ ...request });
          return { deliveredVerified: true, messageId: "video-file-native" };
        },
      },
    },
  );
});

test("a native Matrix sticker event reaches WeChat and its echo is suppressed", async () => {
  const writes: Array<{
    request: WeChatWriteRequest;
    bytes?: Buffer;
  }> = [];
  await withBridge(
    async ({ bridge, hub, relay, homeserver, accessToken }) => {
      const bytes = Buffer.from("GIF89a" + "\u0000".repeat(20), "binary");
      const md5 = createHash("md5").update(bytes).digest("hex");
      relay.emit({
        messageId: "catalog-sticker",
        chatId: "wxid_friend",
        chatName: "A Friend",
        senderId: "wxid_friend",
        messageKind: "emoticon",
        body: `<msg><emoji fromusername="wxid_friend" type="2" md5="${md5}" cdnurl="${relay.url}/sticker.gif" width="240" height="180"></emoji></msg>`,
        timestamp: 1,
      });
      await threadWhen(
        hub,
        ({ messages }) => (messages[0]?.attachments.length ?? 0) > 0,
        "the native sticker reference to be catalogued",
      );
      const [catalogSticker] = await bridge.stickerCatalog();
      assert.equal(catalogSticker?.id, md5);
      assert.match(catalogSticker?.uri ?? "", /^mxc:\/\//);
      assert.equal(catalogSticker?.mimeType, "image/gif");
      assert.equal(catalogSticker?.size, bytes.length);
      assert.equal(catalogSticker?.width, 240);
      assert.equal(catalogSticker?.height, 180);

      relay.emit({
        messageId: "open",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 2,
      });
      const rooms = await roomsWhen(
        hub,
        (rooms) => rooms.length === 2,
        "File Transfer to open",
      );
      const room = rooms.find((item) => item.name === "File Transfer");
      assert.ok(room);
      const url = await hub.upload("parity.gif", "image/gif", bytes);
      const sent = await fetch(
        new URL(
          `/_matrix/client/v3/rooms/${encodeURIComponent(room.roomId)}/send/m.sticker/sticker-parity`,
          homeserver.baseUrl,
        ),
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            body: "Sticker",
            url,
            info: { mimetype: "image/gif", size: bytes.length },
          }),
        },
      );
      assert.equal(sent.ok, true);
      await until(
        () => writes.length === 1,
        "the sticker to reach WeChat's sender",
      );
      assert.deepEqual(writes[0].bytes, Buffer.from(bytes));
      assert.equal(writes[0].request.kind, "media");
      if (writes[0].request.kind === "media") {
        assert.equal(writes[0].request.mediaType, "sticker");
        assert.match(writes[0].request.emojiXml ?? "", new RegExp(md5));
      }

      relay.emit({
        messageId: "sticker-echo",
        server_id: "sticker-native",
        chatId: "filehelper",
        messageKind: "emoticon",
        body: "[Sticker]",
        fromSelf: true,
        timestamp: 3,
      });
      relay.emit({
        messageId: "after-sticker",
        chatId: "filehelper",
        body: "after sticker",
        fromSelf: true,
        timestamp: 4,
      });
      const { messages } = await threadWhen(
        hub,
        ({ messages }) =>
          messages.some((item) => item.body === "after sticker"),
        "the event after the sticker echo",
      );
      assert.equal(
        messages.filter((item) =>
          item.attachments.some((attachment) => attachment.sticker),
        ).length,
        1,
      );
    },
    undefined,
    {
      writer: {
        // Production exposes the probe even on builds whose native picker
        // cannot be enumerated. History-verified references must still power
        // the Polymux picker in that case.
        stickers: async () => [],
        write: async (request) => {
          writes.push({
            request: { ...request },
            ...(request.kind === "media"
              ? { bytes: await readFile(request.path) }
              : {}),
          });
          return { deliveredVerified: true, messageId: "sticker-native" };
        },
      },
    },
  );
});

test("files and videos never masquerade as images without a native writer", async () => {
  const logs: string[] = [];
  await withBridge(
    async ({ hub, relay }) => {
      relay.emit({
        messageId: "open",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      for (const fixture of [
        {
          name: "parity.txt",
          mimetype: "text/plain",
          msgtype: "m.file",
          bytes: new TextEncoder().encode(
            "Polymux File Transfer parity fixture\n",
          ),
        },
        {
          name: "parity.mp4",
          mimetype: "video/mp4",
          msgtype: "m.video",
          bytes: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]),
        },
      ] as const) {
        const url = await hub.upload(
          fixture.name,
          fixture.mimetype,
          fixture.bytes,
        );
        await hub.sendMedia(room.roomId, {
          ...fixture,
          url,
          size: fixture.bytes.length,
        });
        const kind = fixture.msgtype === "m.file" ? "file" : "video";
        await until(
          () =>
            logs.some((line) =>
              line.includes(`WeChat ${kind} sending needs the native writer`),
            ),
          `${kind} refusal to be reported`,
        );
      }
    },
    undefined,
    {log: (line) => logs.push(line)},
  );
});

for (const testFence of [
  {name: "File Transfer", options: {testOnlyFileHelper: true}},
  {name: "selected chats", options: {testChatIds: ["filehelper", "123456@chatroom"]}},
]) test(`live-test mode fences every outbound path to ${testFence.name}`, async () => {
  const writes: WeChatWriteRequest[] = [];
  await withBridge(
    async ({bridge, hub, relay}) => {
      relay.emit({
        messageId: "outside-target", server_id: "outside-target",
        chatId: "wxid_not_filehelper",
        chatName: "Not File Transfer",
        body: "must stay untouched",
        fromSelf: false,
        timestamp: 1,
      });
      const outside = await threadWhen(
        hub,
        ({messages}) => messages.length === 1,
        "the non-File Transfer room to open",
      );
      assert.throws(
        () => bridge.assertLiveTestDestination(outside.room.roomId),
        /live WeChat testing is restricted to (?:filehelper|the selected test chats)/,
      );
      const targetEventId = outside.messages[0].eventId;
      const outboundEventId = await hub.send(
        outside.room.roomId,
        "must not leave Polymux",
      );
      await assert.rejects(
        bridge.waitForOutbound(outboundEventId, 2_000),
        /live WeChat testing is restricted to (?:filehelper|the selected test chats)/,
      );
      await assert.rejects(
        bridge.recall(outside.room.roomId, targetEventId),
        /live WeChat testing is restricted to (?:filehelper|the selected test chats)/,
      );
      await assert.rejects(
        bridge.markRead(outside.room.roomId, targetEventId),
        /live WeChat testing is restricted to (?:filehelper|the selected test chats)/,
      );
      assert.deepEqual(relay.sent, []);
      assert.deepEqual(writes, []);

      relay.emit({
        messageId: "filehelper-target",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "allowed target",
        fromSelf: true,
        timestamp: 2,
      });
      const rooms = await roomsWhen(
        hub,
        (items) => items.some((room) => room.name === "File Transfer"),
        "File Transfer to open",
      );
      const fileTransfer = rooms.find((room) => room.name === "File Transfer");
      assert.ok(fileTransfer);
      assert.doesNotThrow(() =>
        bridge.assertLiveTestDestination(fileTransfer.roomId),
      );
      const allowedEventId = await hub.send(
        fileTransfer.roomId,
        "File Transfer remains allowed",
      );
      await bridge.waitForOutbound(allowedEventId, 2_000);
      assert.deepEqual(relay.sent, []);
      assert.deepEqual(writes, [
        {kind: "text", chatId: "filehelper", body: "File Transfer remains allowed"},
      ]);
    },
    undefined,
    {
      ...testFence.options,
      sessionState: async () => "signed_in",
      writer: {
        write: async (request) => {
          writes.push({...request});
          return {deliveredVerified: true};
        },
      },
    },
  );
});

test("the native writer receives the operations WeChat permits in File Transfer", async () => {
  const writes: WeChatWriteRequest[] = [];
  await withBridge(
    async ({ hub, relay }) => {
      relay.emit({
        messageId: "native-target", server_id: "native-target",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "reply to me",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      const { messages } = await threadWhen(
        hub,
        ({ messages }) => messages.length === 1,
        "the target to arrive",
      );

      await hub.send(room.roomId, "native reply", messages[0].eventId);
      for (const file of [
        { name: "notes.pdf", msgtype: "m.file", mimetype: "application/pdf" },
        { name: "clip.mp4", msgtype: "m.video", mimetype: "video/mp4" },
        { name: "voice.silk", msgtype: "m.audio", mimetype: "audio/silk" },
      ]) {
        const bytes = new Uint8Array([1, 2, 3, writes.length]);
        const url = await hub.upload(file.name, file.mimetype, bytes);
        await hub.sendMedia(room.roomId, { ...file, url, size: bytes.length });
      }
      await hub.markRead(room.roomId, messages[0].eventId);

      await until(
        () => writes.length === 5,
        "all native writes to be dispatched",
      );
      assert.deepEqual(
        writes.map((item) => item.kind),
        ["text", "media", "media", "media", "read"],
      );
      assert.deepEqual(writes[0], {
        kind: "text",
        chatId: "filehelper",
        body: "native reply",
        replyTo: "native-target",
        fallbackBody: "↳ Earlier message: reply to me\nnative reply",
        replyContext: {
          body: "reply to me",
          sender: "Earlier message",
          kind: "text",
          createTime: 1,
        },
      });
      assert.deepEqual(
        writes
          .filter((item) => item.kind === "media")
          .map((item) => item.mediaType),
        ["file", "video", "audio"],
      );
    },
    undefined,
    {
      writer: {
        write: async (request) => {
          writes.push({ ...request });
          return {
            deliveredVerified: true,
            messageId: request.kind === "text" ? "sent-native" : undefined,
          };
        },
      },
    },
  );
});

test("native delivery results reach the caller and failed local sends can be discarded", async () => {
  await withBridge(
    async ({bridge, hub, relay, homeserver}) => {
      relay.emit({
        messageId: "open-ack",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(hub, (rooms) => rooms.length === 1, "File Transfer to open");
      relay.sendResults.push({
        success: false,
        error: "slot_send_bp_armed_no_fire",
        diagnostic: {reason: "slot_send_bp_armed_no_fire"},
      });
      const eventId = await hub.send(room.roomId, "must fail remotely");
      await assert.rejects(
        bridge.waitForOutbound(eventId, 5_000),
        /native delivery rejected/,
      );
      homeserver.discardOutbound(eventId);
      const {messages} = await hub.messages(room.roomId, 20);
      assert.equal(messages.some((item) => item.eventId === eventId), false);
    },
    undefined,
    {
      outboundReconcileMs: 0,
      writer: {
        write: async () => ({
          deliveredVerified: false,
          reason: "native delivery rejected",
        }),
      },
    },
  );
});

test("a late native text acknowledgement is reconciled before the caller can retry", async () => {
  const at = Math.floor(Date.now() / 1_000);
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-late-native-"));
  const submitted = path.join(directory, "submitted");
  const cli = path.join(directory, "wechat-use");
  await writeFile(cli, `#!/usr/bin/env node
const fs = require('node:fs');
const rows = [{create_time: ${at}, real_sender_id: '2', server_id: 'older-id',
  message_kind: 'text', display_text: 'late but delivered'}];
if (fs.existsSync(${JSON.stringify(submitted)})) rows.push({create_time: ${at}, real_sender_id: '2',
  server_id: 'late-server-id', message_kind: 'text', display_text: 'late but delivered'});
process.stdout.write(JSON.stringify({rows}));
`, {mode: 0o700});
  await withBridge(
    async ({bridge, hub, relay}) => {
      relay.emit({
        messageId: "open-late-ack",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: at - 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      relay.sendResults.push({
        success: false,
        error: "slot_send_bp_armed_no_fire",
        diagnostic: {reason: "slot_send_bp_armed_no_fire"},
      });
      const eventId = await hub.send(room.roomId, "late but delivered");
      await bridge.waitForOutbound(eventId, 5_000);

      relay.emit({
        messageId: "late-server-id",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "late but delivered",
        fromSelf: false,
        timestamp: at,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const {messages} = await hub.messages(room.roomId, 20);
      assert.equal(
        messages.filter((item) => item.body === "late but delivered").length,
        1,
        "the late remote echo is consumed instead of duplicating the local bubble",
      );
    },
    undefined,
    {
      cliPaths: [cli],
      outboundReconcileMs: 1_000,
      writer: {
        write: async () => {
          await writeFile(submitted, "submitted");
          return {deliveredVerified: false, reason: "native delivery rejected"};
        },
      },
    },
  );
});

test("a cold File Transfer echo is consumed when the relay omits fromSelf", async () => {
  const at = Math.floor(Date.now() / 1_000);
  await withBridge(
    async ({bridge, hub, relay}) => {
      relay.emit({
        messageId: "open-cold-filehelper",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: at - 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      relay.setWeChatAttached(false);
      const eventId = await hub.send(room.roomId, "one exact cold message");
      await bridge.waitForOutbound(eventId, 2_000);
      relay.emit({
        messageId: "cold-filehelper-echo",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "one exact cold message",
        fromSelf: false,
        timestamp: at,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const {messages} = await hub.messages(room.roomId, 20);
      assert.equal(
        messages.filter((item) => item.body === "one exact cold message").length,
        1,
      );
    },
    undefined,
    {
      writer: {
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("an earlier identical text cannot settle a failed native send", async () => {
  const at = Math.floor(Date.now() / 1000);
  const cli = await stubCli({filehelper: [{create_time: at, real_sender_id: "2",
    server_id: "already-sent", message_kind: "text", display_text: "same text"}]});
  await withBridge(async ({bridge, hub, relay}) => {
    relay.emit({messageId: "seed", chatId: "filehelper", body: "ready", timestamp: at - 1});
    const {room} = await threadWhen(hub, ({messages}) => messages.length === 1, "File Transfer");
    relay.setWeChatAttached(false);
    const eventId = await hub.send(room.roomId, "same text");
    await assert.rejects(bridge.waitForOutbound(eventId, 5000), /native send failed/);
  }, undefined, {cliPaths: [cli], outboundReconcileMs: 300,
    writer: {write: async () => ({deliveredVerified: false, reason: "native send failed"})}});
});

test("a verified native send is immediately recallable by its client id", async () => {
  const writes: WeChatWriteRequest[] = [];
  await withBridge(
    async ({bridge, hub, relay}) => {
      relay.emit({
        messageId: "open-recall",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(hub, (rooms) => rooms.length === 1, "File Transfer to open");
      relay.sendResults.push({
        success: false,
        error: "slot_send_bp_armed_no_fire",
        diagnostic: {reason: "slot_send_bp_armed_no_fire"},
      });
      const eventId = await hub.send(room.roomId, "recall me");
      await bridge.waitForOutbound(eventId, 5_000);
      await bridge.recall(room.roomId, eventId);
      assert.deepEqual(writes[1], {
        kind: "recall",
        chatId: "filehelper",
        messageId: "server-fresh",
        clientMessageId: "client-fresh",
      });
      const {messages} = await hub.messages(room.roomId, 20);
      assert.equal(messages.some((item) => item.eventId === eventId), false);
    },
    undefined,
    {
      writer: {
        write: async (request) => {
          writes.push({...request});
          return request.kind === "text"
            ? {
                deliveredVerified: true,
                messageId: "server-fresh",
                clientMessageId: "client-fresh",
              }
            : {deliveredVerified: true};
        },
      },
    },
  );
});

test("a native refermsg echo is consumed exactly once", async () => {
  const writes: WeChatWriteRequest[] = [];
  let emitReplyEcho: (() => void) | undefined;
  await withBridge(
    async ({ hub, relay }) => {
      relay.emit({
        messageId: "reply-target", server_id: "reply-target",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "reply to this",
        fromSelf: true,
        timestamp: 1,
      });
      const { room, messages } = await threadWhen(
        hub,
        ({ messages }) => messages.length === 1,
        "the reply target to arrive",
      );
      emitReplyEcho = () =>
        relay.emit({
          messageId: "reply-echo", server_id: "native-reply-remote",
          chatId: "filehelper",
          messageKind: "text",
          body: "<msg><appmsg><title>native reply</title><type>57</type><refermsg><svrid>reply-target</svrid><content>reply to this</content></refermsg></appmsg></msg>",
          fromSelf: true,
          timestamp: 2,
        });
      await hub.send(room.roomId, "native reply", messages[0].eventId);
      await until(() => writes.length === 1, "the native reply to be dispatched");
      relay.emit({
        messageId: "after-reply",
        chatId: "filehelper",
        body: "after native reply",
        fromSelf: true,
        timestamp: 3,
      });
      const thread = await threadWhen(
        hub,
        ({ messages }) =>
          messages.some((item) => item.body === "after native reply"),
        "the event after the native reply echo",
      );
      assert.equal(
        thread.messages.filter((item) => item.body === "native reply").length,
        1,
      );
    },
    undefined,
    {
      writer: {
        write: async (request) => {
          writes.push({ ...request });
          emitReplyEcho?.();
          return { deliveredVerified: true, messageId: "native-reply-remote" };
        },
      },
    },
  );
});

test("a painted reply echo is consumed when the writer falls back", async () => {
  const writes: WeChatWriteRequest[] = [];
  await withBridge(
    async ({ hub, relay }) => {
      relay.emit({
        messageId: "painted-target", server_id: "painted-target",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "reply to this",
        fromSelf: true,
        timestamp: 1,
      });
      const { room, messages } = await threadWhen(
        hub,
        ({ messages }) => messages.length === 1,
        "the painted reply target to arrive",
      );
      await hub.send(room.roomId, "painted reply", messages[0].eventId);
      await until(() => writes.length === 1, "the fallback reply to be dispatched");
      assert.equal(
        writes[0].kind === "text" ? writes[0].fallbackBody : undefined,
        "↳ Earlier message: reply to this\npainted reply",
      );
      relay.emit({
        messageId: "painted-reply-echo",
        chatId: "filehelper",
        messageKind: "text",
        body:
          writes[0].kind === "text" ? writes[0].fallbackBody : "unexpected",
        fromSelf: true,
        timestamp: 2,
      });
      relay.emit({
        messageId: "after-painted-reply",
        chatId: "filehelper",
        body: "after painted reply",
        fromSelf: true,
        timestamp: 3,
      });
      const thread = await threadWhen(
        hub,
        ({ messages }) =>
          messages.some((item) => item.body === "after painted reply"),
        "the event after the painted reply echo",
      );
      assert.equal(
        thread.messages.filter((item) => item.body === "painted reply").length,
        1,
      );
    },
    undefined,
    {
      writer: {
        write: async (request) => {
          writes.push({ ...request });
          return { deliveredVerified: true, messageId: "painted-reply-remote" };
        },
      },
    },
  );
});

test("native mention recovery maps self and upgrades an existing message without duplicating it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wechat-mention-reader-"));
  const cli = path.join(directory, "reader");
  await writeFile(cli, `#!/usr/bin/env node
process.stdout.write(JSON.stringify(process.argv[2] === 'accounts'
 ? {accounts:[{wxid:'wxid_me'}]} : {meta:{},rows:[]}));
`, {mode: 0o755});
  let available = false, reads = 0;
  const incoming = {chatId: "123456@chatroom", chatName: "Test group", server_id: "1167859275151065185",
    local_id: "50", timestamp: 1788665978, body: "@Me", messageKind: "text", senderId: "wxid_friend", fromSelf: false};
  await withBridge(async ({hub, relay, homeserver, accessToken}) => {
    relay.emit(incoming);
    const first = await threadWhen(hub, ({messages}) => messages.some(m => m.body === "@Me"), "the plain mention text");
    const original = first.messages.find(m => m.body === "@Me")!;
    available = true; relay.emit(incoming);
    const edits = async (): Promise<Array<{content: Record<string, any>}>> => {
      const response = await fetch(new URL(`/_matrix/client/v3/rooms/${encodeURIComponent(first.room.roomId)}/messages?dir=b&limit=20`, homeserver.baseUrl),
        {headers: {Authorization: `Bearer ${accessToken}`}});
      return (await response.json() as {chunk: Array<{content: Record<string, any>}>}).chunk
        .filter(e => e.content["m.relates_to"]?.event_id === original.eventId);
    };
    await eventually(edits, rows => rows.length === 1, "the native mention edit");
    assert.deepEqual((await edits())[0].content["m.new_content"]["m.mentions"], {user_ids: ["@polymux-test:polymux.local"]});
    relay.emit(incoming);
    const thread = await threadWhen(hub, ({messages}) => messages.some(m => m.body === "@Me"), "the recovered mention");
    assert.equal(thread.messages.filter(m => m.body === "@Me").length, 1);
    assert.equal(thread.messages.find(m => m.body === "@Me")?.eventId, original.eventId);
    assert.equal(reads, 2);
    assert.equal(relay.sent.length, 0);
  }, undefined, {cliPaths: [cli], writer: {
    readMentions: async request => {
      reads += 1;
      assert.deepEqual(request, {chatId: incoming.chatId, serverId: incoming.server_id, localId: incoming.local_id, timestamp: incoming.timestamp});
      return available ? ["wxid_me"] : null;
    },
    write: async () => {throw new Error("A mention read must never send");},
  }});
});

test("an installed native writer preserves group mentions with the native request", async () => {
  const writes: WeChatWriteRequest[] = [];
  const directory = await mkdtemp(
    path.join(tmpdir(), "polymux-wechat-native-mention-"),
  );
  const log = path.join(directory, "send.jsonl");
  const cli = await stubCli({}, log);
  await withBridge(
    async ({ hub, relay, homeserver, accessToken }) => {
      relay.emit({
        messageId: "mention-target",
        chatId: "study@chatroom",
        chatName: "Study Group",
        senderId: "wxid_alex",
        senderName: "Alex",
        isGroup: true,
        body: "hello",
        timestamp: 1,
      });
      const { room, messages } = await threadWhen(
        hub,
        ({ messages }) => messages.length === 1,
        "the mentioned contact to arrive",
      );
      const response = await fetch(
        new URL(
          `/_matrix/client/v3/rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/native-mention`,
          homeserver.baseUrl,
        ),
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            msgtype: "m.text",
            body: "@Alex are you coming?",
            "m.mentions": { user_ids: [messages[0].sender] },
          }),
        },
      );
      assert.equal(response.ok, true);
      await until(() => writes.length === 1, "the native mention to be dispatched");
      assert.deepEqual(writes[0], {
        kind: "text", chatId: "study@chatroom", body: "@Alex are you coming?",
        mentions: ["wxid_alex"],
      });
      assert.equal(existsSync(log), false);
    },
    undefined,
    {
      writer: {
        write: async (request) => {
          writes.push({ ...request });
          return { deliveredVerified: true };
        },
      },
      cliPaths: [cli],
    },
  );
});

test("native mentions use wechat-use when no custom writer is installed", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "polymux-wechat-mention-"),
  );
  const log = path.join(directory, "send.jsonl");
  const cli = await stubCli({}, log);
  await withBridge(
    async ({ hub, relay, homeserver, accessToken }) => {
      relay.emit({
        messageId: "mention-cli-target",
        chatId: "study@chatroom",
        chatName: "Study Group",
        senderId: "wxid_alex",
        senderName: "Alex",
        isGroup: true,
        body: "hello",
        timestamp: 1,
      });
      const { room, messages } = await threadWhen(
        hub,
        ({ messages }) => messages.length === 1,
        "the mentioned contact to arrive",
      );
      const response = await fetch(
        new URL(
          `/_matrix/client/v3/rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/cli-mention`,
          homeserver.baseUrl,
        ),
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            msgtype: "m.text",
            body: "@Alex are you coming?",
            "m.mentions": { user_ids: [messages[0].sender] },
          }),
        },
      );
      assert.equal(response.ok, true);
      await until(() => existsSync(log), "wechat-use to receive the mention");
      const sent = JSON.parse((await readFile(log, "utf8")).trim()) as {
        args: string[];
      };
      assert.deepEqual(sent.args, [
        "send",
        "@Alex are you coming?",
        "--wxid",
        "study@chatroom",
        "--json",
        "--mention",
        "wxid_alex",
      ]);
    },
    undefined,
    { cliPaths: [cli] },
  );
});

test("a Polymux message keeps the WeChat id needed for a later recall", async () => {
  const writes: WeChatWriteRequest[] = [];
  await withBridge(
    async ({ hub, relay }) => {
      relay.emit({
        messageId: "filehelper-open",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      relay.sendResults.push({
        success: false,
        error: "slot_send_bp_armed_no_fire",
        diagnostic: {reason: "slot_send_bp_armed_no_fire"},
      });
      const eventId = await hub.send(room.roomId, "recall this later");
      await until(() => writes.length === 1, "the message to reach the writer");
      await hub.redact(room.roomId, eventId);

      await until(
        () => writes.length === 2,
        "the recall request to be dispatched",
      );
      assert.deepEqual(writes[1], {
        kind: "recall",
        chatId: "filehelper",
        messageId: "wechat-sent-42",
      });
    },
    undefined,
    {
      writer: {
        write: async (request) => {
          writes.push({ ...request });
          return {
            deliveredVerified: true,
            messageId: request.kind === "text" ? "wechat-sent-42" : undefined,
          };
        },
      },
    },
  );
});

test("our own message coming back from WeChat is not posted twice", async () => {
  await withBridge(async ({ hub, relay }) => {
    relay.emit({
      messageId: "m1",
      chatId: "wxid_friend",
      body: "ping",
      timestamp: 1,
    });
    const [room] = await roomsWhen(
      hub,
      (rooms) => rooms.length === 1,
      "the portal to open",
    );
    await hub.send(room.roomId, "pong");
    await until(() => relay.sent.length > 0, "the reply to reach the relay");
    // WeChat echoes everything the account sends, including through us.
    relay.emit({
      messageId: "m2",
      chatId: "wxid_friend",
      body: "pong",
      timestamp: 2,
      fromSelf: true,
    });
    /**
     * The echo must produce nothing, and nothing cannot be waited for. A later
     * message on the same ordered stream can be: once the marker has arrived,
     * the echo ahead of it has already been handled, so a duplicate would be
     * here by now. Sleeping instead only guessed at how long that took.
     */
    relay.emit({
      messageId: "m3",
      chatId: "wxid_friend",
      body: "after the echo",
      timestamp: 3,
    });
    const { messages } = await threadWhen(
      hub,
      ({ messages }) => messages.some((item) => item.body === "after the echo"),
      "the message sent after the echo, by which point the echo has been handled",
    );
    assert.equal(messages.filter((item) => item.body === "pong").length, 1);
  });
});

test("a sticker reads as one rather than as its markup", async () => {
  await withBridge(async ({ hub, relay }) => {
    relay.emit({
      messageId: "m1",
      chatId: "wxid_friend",
      messageKind: "emoticon",
      body: '<msg><emoji fromusername="x" md5="abc" type="2"/></msg>',
      timestamp: 1,
    });
    const { messages } = await threadWhen(
      hub,
      ({ messages }) => messages.length >= 1,
      "the sticker to arrive",
    );
    assert.equal(messages[0].body, "[Sticker]");
  });
});

test("remote-only media keeps its attachment shape and says where it can be seen", async () => {
  await withBridge(async ({ hub, relay }) => {
    // No id the message store knows, so extraction cannot succeed.
    relay.emit({
      messageId: "999999",
      chatId: "wxid_x",
      messageKind: "voice",
      hasMedia: true,
      timestamp: 1,
    });
    relay.emit({
      messageId: "999998",
      chatId: "wxid_x",
      messageKind: "file",
      hasMedia: true,
      timestamp: 2,
      body: "<msg><appmsg><title>notes &amp; links.pdf</title><type>6</type><appattach><totallen>1572864</totallen><aeskey>private</aeskey></appattach></appmsg></msg>",
    });
    relay.emit({
      messageId: "999997",
      chatId: "wxid_x",
      body: "just text",
      timestamp: 3,
    });
    // The voice note is the slow one: extraction is attempted and fails before
    // the placeholder is written, which is why this wait used to be doubled.
    const { messages } = await threadWhen(
      hub,
      ({ messages }) =>
        messages.some((item) => item.attachments[0]?.kind === "audio") &&
        messages.some(
          (item) => item.attachments[0]?.name === "notes & links.pdf",
        ) &&
        messages.some((item) => item.body === "just text"),
      "the remote attachments and ordinary message to arrive",
    );
    const voice = messages.find(
      (item) => item.attachments[0]?.kind === "audio",
    );
    const file = messages.find(
      (item) => item.attachments[0]?.name === "notes & links.pdf",
    );
    const text = messages.find((item) => item.body === "just text");
    assert.equal(voice?.body, "");
    assert.deepEqual(voice?.attachments[0], {
      kind: "audio",
      url: null,
      name: "Voice message",
      mimeType: null,
      size: null,
      width: null,
      height: null,
      duration: null,
    });
    assert.deepEqual(voice?.viewIn, { app: "WeChat", url: "weixin://" });
    assert.equal(file?.attachments[0]?.size, 1_572_864);
    assert.deepEqual(file?.viewIn, { app: "WeChat", url: "weixin://" });
    // An ordinary message has nothing to go and look at elsewhere.
    assert.equal(text?.viewIn, null);
  });
});

test("merged WeChat forwards reach the Hub as individual readable entries", async () => {
  await withBridge(async ({hub, relay}) => {
    relay.emit({
      messageId: "forwarded-record-1", chatId: "wxid_x", messageKind: "appmsg", timestamp: 1,
      body: '<msg><appmsg><type>19</type><title>Chat record</title><recorditem><![CDATA[<recordinfo><datalist count="1"><dataitem datatype="1"><sourcename>Alice</sourcename><datadesc>Hello &amp; welcome</datadesc><cdndatakey>private-key</cdndatakey></dataitem></datalist></recordinfo>]]></recorditem></appmsg></msg>',
    });
    const {messages} = await threadWhen(hub, ({messages}) => messages.length === 1, "the forwarded bundle to arrive");
    assert.deepEqual(messages[0].forwarded, {
      title: "Chat record", truncated: false,
      messages: [{senderName: "Alice", sentAt: null, kind: "text", body: "Hello & welcome"}],
    });
    assert.equal(messages[0].linkPreview, null);
    assert.equal(messages[0].body, "Chat record\nAlice: Hello & welcome");
    assert.doesNotMatch(JSON.stringify(messages[0]), /private-key/);
    assert.deepEqual(messages[0].viewIn, {app: "WeChat", url: "weixin://"});
  });
});

test("Desktop's forward label is hydrated only from its exact native row", async () => {
  const body = '<msg><appmsg><title>Chat History for Test</title><type>19</type><recorditem>&lt;recordinfo&gt;&lt;datalist count="2"&gt;&lt;dataitem datatype="1"&gt;&lt;sourcename&gt;Test&lt;/sourcename&gt;&lt;sourcetime&gt;2026-09-05 22:25&lt;/sourcetime&gt;&lt;datadesc&gt;Identical text&lt;/datadesc&gt;&lt;/dataitem&gt;&lt;dataitem datatype="1"&gt;&lt;sourcename&gt;Test&lt;/sourcename&gt;&lt;sourcetime&gt;2026-09-05 22:27&lt;/sourcetime&gt;&lt;datadesc&gt;Identical text&lt;/datadesc&gt;&lt;/dataitem&gt;&lt;/datalist&gt;&lt;/recordinfo&gt;</recorditem></appmsg></msg>';
  const cli = await stubCli({filehelper: [{local_id: "220", server_id: "731104528264161646",
    create_time: 1788659216, real_sender_id: "2", message_kind: "forward", message_content: body}]});
  await withBridge(async ({hub, relay}) => {
    relay.emit({messageId: "220", chatId: "filehelper", messageKind: "forward",
      real_sender_id: "2", timestamp: 1788659216, body: "[合并转发]"});
    const {messages} = await threadWhen(hub, ({messages}) => messages.length === 1, "the Desktop forward");
    assert.equal(messages[0].forwarded?.messages.length, 2);
    assert.deepEqual(messages[0].forwarded?.messages.map(m => m.body), ["Identical text", "Identical text"]);
    assert.deepEqual(messages[0].forwarded?.messages.map(m => m.sentAt), ["2026-09-05 22:25", "2026-09-05 22:27"]);
    assert.equal(messages[0].mine, true);
    relay.emit({messageId: "221", chatId: "filehelper", messageKind: "forward", timestamp: 1788659216, body: "[合并转发]"});
    const wrong = await threadWhen(hub, ({messages}) => messages.length === 2, "the unmatched native row");
    assert.equal(wrong.messages.filter(m => m.forwarded).length, 1);
  }, undefined, {cliPaths: [cli]});
});

test("a later forward payload upgrades the original event without losing its identity", async () => {
  await withBridge(async ({hub, relay}) => {
    const native = {messageId: "220", server_id: "731104528264161646", chatId: "filehelper",
      messageKind: "forward", timestamp: 1788659216, body: "[合并转发]"};
    relay.emit(native);
    const before = await threadWhen(hub, ({messages}) => messages.length === 1, "the forward placeholder");
    relay.emit({...native, body: '<msg><appmsg><type>19</type><title>Chat History</title><recorditem><recordinfo><datalist count="1"><dataitem datatype="1"><sourcename>Test</sourcename><datadesc>Hello</datadesc></dataitem></datalist></recordinfo></recorditem></appmsg></msg>'});
    const after = await threadWhen(hub, ({messages}) => !!messages[0]?.forwarded, "the recovered forward");
    assert.equal(after.messages.length, 1);
    assert.ok(before.messages[0].eventId);
    assert.equal(after.messages[0].eventId, before.messages[0].eventId);
    assert.equal(after.messages[0].sentAt, before.messages[0].sentAt);
    assert.equal(after.messages[0].forwarded?.messages[0].body, "Hello");
    assert.equal(after.messages[0].mine, true);
  });
});

test("a late native server id enriches the original local row without duplicating identical text", async () => {
  await withBridge(async ({hub, relay}) => {
    const first = {messageId: "219", chatId: "filehelper", timestamp: 1788659201,
      real_sender_id: "2", messageKind: "text", body: "Identical test text"};
    relay.emit(first);
    const before = await threadWhen(hub, ({messages}) => messages.length === 1, "the local-only native row");
    relay.emit({...first, server_id: "1809685911984618656"});
    relay.emit({...first, messageId: "220", server_id: "1809685911984618657"});
    const after = await threadWhen(hub, ({messages}) => messages.length >= 2, "the distinct same-second duplicate text");
    assert.equal(after.messages.length, 2);
    assert.ok(after.messages.some(m => m.eventId === before.messages[0].eventId));
    relay.emit({...first, server_id: "1809685911984618656"});
    relay.emit({...first, messageId: "219", timestamp: 1788659202, server_id: "1809685911984618658"});
    const rotated = await threadWhen(hub, ({messages}) => messages.length >= 3, "a reused row in a later second");
    assert.equal(rotated.messages.length, 3);
  });
});

test("reconnect reconciles a prior local-only import and removes only its proven native duplicate", async () => {
  await withBridge(async ({bridge, hub, relay, homeserver, directory}) => {
    const native = {messageId: "219", chatId: "filehelper", timestamp: 1788659201,
      real_sender_id: "2", messageKind: "text", body: "Same text"};
    relay.emit(native);
    const before = await threadWhen(hub, ({messages}) => messages.length === 1, "the local-only original");
    const original = before.messages[0];
    await bridge.close();
    const registration = JSON.parse(await readFile(path.join(directory, "wechat", "registration.json"), "utf8"));
    const url = new URL(`/_matrix/client/v3/rooms/${encodeURIComponent(before.room.roomId)}/send/m.room.message/duplicate-fixture`, homeserver.baseUrl);
    url.searchParams.set("user_id", original.sender);
    url.searchParams.set("ts", String(native.timestamp * 1000));
    const response = await fetch(url, {method: "PUT", headers: {Authorization: `Bearer ${registration.asToken}`, "Content-Type": "application/json"}, body: JSON.stringify({
      msgtype: "m.text", body: native.body, "co.polymux.wechat.remote": true,
      "co.polymux.wechat.native": {localId: "219", serverId: "1809685911984618656", kind: "text"},
    })});
    assert.equal(response.ok, true);
    const duplicate = await response.json() as {event_id: string};
    const statePath = path.join(directory, "wechat", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    delete state.nativeLocalMessageEvents;
    state.nativeMessageEvents = {filehelper: {"1809685911984618656": duplicate.event_id}};
    state.remoteMessageIds = {[duplicate.event_id]: "1809685911984618656"};
    await writeFile(statePath, JSON.stringify(state));
    relay.catalogue.chats = [{username: "filehelper", display_name: "File Transfer", unread_count: 0}];
    relay.catalogue.history.filehelper = [{...native, server_id: "1809685911984618656"}];
    let writes = 0;
    const restored = new WeChatBridge({...noDeviceOptions, homeserver, directory, relayUrl: relay.url,
      binaryDirectories: [], writer: {write: async () => {writes++; throw new Error("must not send or recall");}}});
    try {
      await restored.start(original.sender);
      const after = await threadWhen(hub, ({messages}) => messages.length === 1, "the reconciled original");
      assert.equal(after.messages[0].eventId, original.eventId);
      assert.equal(writes, 0, "local cleanup cannot invoke a native recall");
    } finally {await restored.close();}
  });
});

test("a Desktop image reply gains its exact quote without replacing or duplicating its attachment", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-image-reply-"));
  const cli = path.join(directory, "reader");
  const viewed = path.join(directory, "viewed");
  await writeFile(cli, `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] === 'image') {
  if (process.argv[4] === '222' && !fs.existsSync(${JSON.stringify(viewed)})) {
    process.stdout.write(JSON.stringify({error:'not yet available'})); process.exit(0);
  }
  fs.writeFileSync(process.argv[process.argv.indexOf('--out') + 1], Buffer.from([0xff,0xd8,0xff,0xd9]));
  process.stdout.write(JSON.stringify({mime:'image/jpeg'}));
} else process.stdout.write(JSON.stringify({rows:[]}));
`, {mode: 0o755});
  await withBridge(async ({hub, relay}) => {
    const original = {messageId: "215", server_id: "1076601126396071190", timestamp: 1788618540,
      chatId: "filehelper", real_sender_id: "2", messageKind: "image", body: '<msg><img/></msg>'};
    relay.emit(original);
    const first = await threadWhen(hub, ({messages}) => !!messages[0]?.attachments[0]?.url, "the original image");
    const reply = {...original, messageId: "221", server_id: "7864944564158252933", timestamp: 1788660397};
    relay.emit(reply);
    const before = await threadWhen(hub, ({messages}) => messages.length === 2, "the reply image before native context");
    const image = before.messages.find(m => m.eventId !== first.messages[0].eventId)!;
    relay.emit({...reply, body: '<msg><img/><extcommoninfo><refermsg><createtime>1788618540</createtime><svrid>1076601126396071190</svrid></refermsg></extcommoninfo></msg>'});
    const after = await threadWhen(hub, ({messages}) => messages.some(m => m.replyTo === first.messages[0].eventId), "the image quote relation");
    const fixed = after.messages.find(m => m.eventId === image.eventId)!;
    assert.equal(after.messages.length, 2);
    assert.deepEqual(fixed.attachments, image.attachments);
    assert.equal(fixed.replyTo, first.messages[0].eventId);
    assert.equal(fixed.sentAt, image.sentAt);
    relay.emit({...reply, messageId: "222", server_id: "7864944564158252934", timestamp: 1788660398,
      body: '<msg><img/><extcommoninfo><refermsg><svrid>1076601126396071190</svrid></refermsg></extcommoninfo></msg>'});
    const pending = await threadWhen(hub, ({messages}) => messages.length === 3, "the quoted image awaiting bytes");
    const pendingImage = pending.messages.find(m => m.attachments.length === 0)!;
    assert.equal(pendingImage.replyTo, first.messages[0].eventId);
    await writeFile(viewed, "ready");
    const decoded = await threadWhen(hub, ({messages}) => messages.every(m => !!m.attachments[0]?.url), "the delayed image reply");
    assert.equal(decoded.messages.length, 3);
    assert.equal(decoded.messages.find(m => m.eventId === pendingImage.eventId)?.replyTo, first.messages[0].eventId);
  }, undefined, {cliPaths: [cli], imageRetrySweepMs: 50, imageRetryDelaysMs: [60_000]});
});

test("a WeChat rich reply keeps its readable title and quoted context", async () => {
  await withBridge(async ({ hub, relay }) => {
    relay.emit({
      messageId: "rich-1",
      chatId: "wxid_x",
      messageKind: "appmsg",
      timestamp: 1,
      body: "<msg><appmsg><title>My answer</title><type>57</type><url>https://example.test/item</url><refermsg><displayname>Alice &amp; Bob</displayname><content>Earlier &lt;text&gt;</content></refermsg></appmsg></msg>",
    });
    const { messages } = await threadWhen(
      hub,
      ({ messages }) => messages.length === 1,
      "the rich reply to arrive",
    );
    assert.equal(
      messages[0].body,
      "My answer\n↳ Alice & Bob: Earlier <text>\nhttps://example.test/item",
    );
    assert.deepEqual(messages[0].viewIn, { app: "WeChat", url: "weixin://" });
  });
});

test("WeChat locations, contact cards, transfers, and red packets keep their semantics", async () => {
  await withBridge(async ({ hub, relay, homeserver, accessToken }) => {
    for (const message of [
      {
        messageId: "location-1",
        messageKind: "location",
        body: '<msg><location x="1.2966" y="103.7764" label="NUS School of Computing" /></msg>',
      },
      {
        messageId: "card-1",
        messageKind: "card",
        body: '<msg username="wxid_percival" nickname="Percival" />',
      },
      {
        messageId: "transfer-1",
        messageKind: "transfer",
        body: "<msg><appmsg><wcpayinfo><feedesc>S$8.50</feedesc><pay_memo>Lunch</pay_memo><receivertitle>Received</receivertitle></wcpayinfo></appmsg></msg>",
      },
      {
        messageId: "redpacket-1",
        messageKind: "redpacket",
        body: "<msg><appmsg><wcpayinfo><sendertitle>Best wishes</sendertitle></wcpayinfo></appmsg></msg>",
      },
    ])
      relay.emit({
        ...message,
        chatId: "filehelper",
        chatName: "File Transfer",
        fromSelf: true,
        timestamp: Number(message.messageId.match(/\d+/)?.[0] ?? 1),
      });

    const { room, messages } = await threadWhen(
      hub,
      ({ messages }) => messages.length === 4,
      "the structured messages to arrive",
    );
    assert.ok(messages.some((item) => item.body === "NUS School of Computing"));
    assert.ok(
      messages.some(
        (item) => item.body === "Contact: Percival (wxid_percival)",
      ),
    );
    assert.ok(
      messages.some(
        (item) => item.body === "Transfer · S$8.50 · Lunch · Received",
      ),
    );
    assert.ok(
      messages.some((item) => item.body === "Red packet · Best wishes"),
    );

    const location = messages.find(
      (item) => item.body === "NUS School of Computing",
    );
    assert.ok(location);
    const response = await fetch(
      new URL(
        `/_matrix/client/v3/rooms/${encodeURIComponent(room.roomId)}/event/${encodeURIComponent(location.eventId)}`,
        homeserver.baseUrl,
      ),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    assert.equal(response.ok, true);
    const event = (await response.json()) as {
      content?: Record<string, unknown>;
    };
    assert.equal(event.content?.msgtype, "m.location");
    assert.equal(event.content?.geo_uri, "geo:1.2966,103.7764");
  });
});

test("a WeChat link becomes a shared structured preview card", async () => {
  await withBridge(async ({ hub, relay }) => {
    relay.emit({
      messageId: "card-1",
      chatId: "wxid_x",
      messageKind: "url",
      timestamp: 1,
      body: "<msg><appmsg><title>Useful article</title><des>A short description</des><type>5</type><url>https://example.test/article</url><aeskey>private</aeskey></appmsg></msg>",
    });
    const { messages } = await threadWhen(
      hub,
      ({ messages }) => messages.length === 1,
      "the preview card to arrive",
    );
    assert.equal(messages[0].body, "https://example.test/article");
    assert.deepEqual(messages[0].linkPreview, {
      title: "Useful article",
      description: "A short description",
      url: "https://example.test/article",
      source: "example.test",
      imageUrl: null,
      imageMimeType: null,
      imageWidth: null,
      imageHeight: null,
    });
  });
});

test("a recalled WeChat item is a conversation notice", async () => {
  await withBridge(async ({ hub, relay }) => {
    relay.emit({
      messageId: "recall-1",
      chatId: "wxid_x",
      messageKind: "recalled",
      body: "A message was recalled",
      timestamp: 1,
    });
    const { messages } = await threadWhen(
      hub,
      ({ messages }) => messages.length === 1,
      "the recall notice to arrive",
    );
    assert.equal(messages[0].notice, true);
  });
});

test("a picture WeChat would not decrypt yet becomes the picture once it will", async () => {
  /**
   * WeChat stores images encrypted and only decrypts one into the running
   * app's heap when someone opens it, so a picture nobody has looked at cannot
   * be read at all. Importing it once therefore froze it as a text placeholder
   * for good, even after the user opened it in WeChat and it became readable.
   */
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-cli-"));
  const viewed = path.join(directory, "viewed-in-wechat");
  const calls = path.join(directory, "calls.log");
  const cli = path.join(directory, "wechat-use");
  await writeFile(
    cli,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n');`,
      "if (process.argv[2] !== 'image') {",
      "  process.stdout.write(JSON.stringify({meta: {}, rows: []}));",
      "  process.exit(0);",
      "}",
      // Stands in for the picture having been opened in WeChat: until then the
      // real tool answers with exactly this refusal, hint and all.
      `if (!fs.existsSync(${JSON.stringify(viewed)})) {`,
      "  process.stdout.write(JSON.stringify({error: 'image not yet viewed in WeChat (heap empty), and CDN fallback failed\\nhint: open the image in WeChat once'}));",
      "  process.exit(0);",
      "}",
      "const out = process.argv[process.argv.indexOf('--out') + 1];",
      "fs.writeFileSync(out, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));",
      "process.stdout.write(JSON.stringify({mime: 'image/jpeg'}));",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(cli, 0o755);
  await withBridge(
    async ({ hub, relay }) => {
      relay.emit({
        messageId: "23971",
        chatId: "wxid_friend",
        chatName: "A Friend",
        messageKind: "image",
        hasMedia: true,
        timestamp: 1,
      });
      const placeholder = await threadWhen(
        hub,
        ({ messages }) => messages.length >= 1,
        "the unreadable picture to arrive as a placeholder",
      );
      assert.equal(placeholder.messages[0].attachments.length, 0);
      assert.ok(
        placeholder.messages[0].viewIn,
        "and it says where the picture can be seen",
      );

      // The user opens it in WeChat. The long CDN backoff below is deliberate:
      // the cheap heap sweep must notice this promptly on its own.
      await writeFile(viewed, "", "utf8");

      const { messages } = await threadWhen(
        hub,
        ({ messages }) => messages.some((item) => item.attachments.length > 0),
        "the retry to bring the picture across",
      );
      assert.equal(
        messages.length,
        1,
        "the placeholder became the picture rather than the picture arriving as a second message",
      );
      assert.equal(messages[0].attachments[0].mimeType, "image/jpeg");
      assert.equal((await hub.rooms())[0].unread, 1, "decoding a photo does not add an unread message");
      assert.match(
        await readFile(calls, "utf8"),
        /--from heap --variant mid/,
        "the quick heap path recovered it without waiting for another CDN capture",
      );
    },
    undefined,
    {
      imageRetrySweepMs: 50,
      imageRetryDelaysMs: [60_000],
      cliPaths: [cli],
    },
  );
});

test("a relay that is not running leaves WeChat unlinked rather than failing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-"));
  // No port: the OS picks a free one and the harness reads it back off the
  // server. Counting up from a fixed base made two test files run at once
  // fight over the same numbers, which fails as a bridge error rather than as
  // anything to do with the bridge.
  const homeserver = new Homeserver({
    serverName: "polymux.local",
    dataDirectory: directory,
  });
  await homeserver.start();
  const owner = homeserver.createLocalUser("polymux-test");
  // Nothing is listening on this port, which is the ordinary case on a Mac
  // without the relay installed.
  const bridge = new WeChatBridge({
    ...noDeviceOptions,
    homeserver,
    directory,
    relayUrl: "http://127.0.0.1:1",
    binaryDirectories: [],
  });
  assert.equal(await bridge.start(owner.userId), false);
  await bridge.close();
  await homeserver.close();
});

test("setup names the missing piece, starting with WeChat itself", () => {
  // Order matters: someone with no WeChat at all must not be sent looking for
  // a relay they have never heard of, so the app is reported first.
  assert.match(
    setupHint({ wechat: false, relay: false }, "darwin") ?? "",
    /WeChat for Mac is not installed/,
  );
  assert.match(
    setupHint({ wechat: false, relay: true }, "darwin") ?? "",
    /WeChat for Mac is not installed/,
  );
  assert.match(
    setupHint({ wechat: true, relay: false }, "darwin") ?? "",
    /WeChat is open and signed in/,
  );
  // How Polymux reaches WeChat is its own plumbing. Naming any of it hands the
  // user a task they cannot act on instead of the one they can.
  for (const hint of [
    setupHint({ wechat: false, relay: false }, "darwin"),
    setupHint({ wechat: true, relay: false }, "darwin"),
  ])
    assert.doesNotMatch(
      hint ?? "",
      /relay|wechat-use|wechatd|daemon|loopback|port/i,
    );
  // Both present is not a setup problem, so there is nothing to say.
  assert.equal(setupHint({ wechat: true, relay: true }, "darwin"), null);
});

test("setup offers the official installer only when WeChat itself is missing", () => {
  assert.deepEqual(setupGuidance({wechat: false, relay: false}, "darwin"), {
    error: "WeChat for Mac is not installed. Install it and sign in — Polymux reads WeChat from the desktop app on this Mac rather than through a sign-in of its own.",
    installUrl: WECHAT_DOWNLOAD_URL,
  });
  assert.equal(WECHAT_DOWNLOAD_URL, "https://mac.weixin.qq.com/en");
  assert.equal(weChatDownloadUrl("win32"), "https://pc.weixin.qq.com/");
  assert.equal(weChatDownloadUrl("linux"), "https://linux.weixin.qq.com/");
  assert.deepEqual(
    setupGuidance({wechat: false, relay: false}, "win32"),
    {
      error:
        "WeChat for Windows is not installed. Install it and sign in — Polymux reads WeChat from the desktop app on this PC rather than through a sign-in of its own.",
      installUrl: WECHAT_DOWNLOAD_URLS.win32,
    },
  );
  assert.equal(
    setupGuidance({wechat: false, relay: false}, "linux").installUrl,
    WECHAT_DOWNLOAD_URLS.linux,
  );
  assert.equal(setupGuidance({wechat: true, relay: false}, "darwin").installUrl, null);
  assert.equal(setupGuidance({wechat: true, relay: true}, "darwin").installUrl, null);
});

test("the daemon is told where the shipped CDN-capture helper lives", () => {
  // The released wechatd falls back to a helper path on the machine it was
  // built on, so without this variable its CDN fallback for media WeChat has
  // not decrypted can never arm.
  const shipped = "/bundle/wechat/wxcdn_fileid_capture.py";
  assert.equal(
    relayEnvironment({ PATH: "/usr/bin" }, shipped).WECHAT_CDN_CAPTURE_SCRIPT,
    shipped,
  );
  // An operator who exported a helper of their own keeps it: the variable is
  // the documented way to swap the script out.
  assert.equal(
    relayEnvironment({ WECHAT_CDN_CAPTURE_SCRIPT: "/their/copy.py" }, shipped)
      .WECHAT_CDN_CAPTURE_SCRIPT,
    "/their/copy.py",
  );
  // No shipped copy resolved: the environment passes through untouched rather
  // than gaining a variable that points at nothing.
  const base = { PATH: "/usr/bin" };
  assert.equal(relayEnvironment(base), base);

  assert.equal(
    weChatDaemonPid("wechatd is running pid=64610 socket=/tmp/wechatd.sock"),
    64610,
  );
  assert.equal(weChatDaemonPid("wechatd is not running"), null);
  assert.equal(
    daemonUsesCaptureScript(
      "wechatd WECHAT_CDN_CAPTURE_SCRIPT=/bundle/wxcdn_fileid_capture.py PATH=/usr/bin",
      "/bundle/wxcdn_fileid_capture.py",
    ),
    true,
  );
  assert.equal(
    daemonUsesCaptureScript(
      "wechatd WECHAT_CDN_CAPTURE_SCRIPT=/old/copy.py PATH=/usr/bin",
      "/bundle/wxcdn_fileid_capture.py",
    ),
    false,
  );
  assert.equal(
    daemonUsesCaptureScript(
      "wechatd WECHAT_CDN_CAPTURE_SCRIPT=/bundle/wxcdn_fileid_capture.py.old PATH=/usr/bin",
      "/bundle/wxcdn_fileid_capture.py",
    ),
    false,
  );
});

test("a reconnected stream does not re-post what the first one already carried", async () => {
  await withBridge(async ({ hub, relay }) => {
    // WeChat has not accepted this message yet, so it comes down without an id
    // and will come back down without one: a replay is indistinguishable from
    // a second delivery unless the bridge remembers it by what it is made of.
    const at = Math.floor(Date.now() / 1000);
    const message = {
      chatId: "wxid_friend",
      chatName: "A Friend",
      senderId: "wxid_friend",
      senderName: "A Friend",
      body: "no id yet",
      timestamp: at,
    };
    relay.emit(message);
    const thread = await threadWhen(
      hub,
      ({ messages }) => messages.length === 1,
      "the message to arrive",
    );
    // The stream dies and the bridge reconnects. The relay's tail is what it
    // has not got an acknowledgement for, which still includes this one, so it
    // re-delivers exactly this message on the new connection.
    relay.dropStream();
    await until(() => relay.connections === 2, "the stream to reconnect");
    relay.emit(message);
    // Give the replay a moment to do what a broken bridge would do: post twice.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const { messages } = await hub.messages(thread.room.roomId, 20);
    assert.equal(messages.length, 1);
  });
});

test("a desktop-authored message is reconciled on the next stream pulse", async () => {
  const at = Math.floor(Date.now() / 1_000);
  const cli = await stubCli({
    filehelper: [{create_time: at, real_sender_id: "2"}],
  });
  await withBridge(
    async ({hub, relay}) => {
      // The real relay's long-lived hook omitted this self-authored message,
      // but its incremental history exposes it as a newest-first batch as soon
      // as the stream reopens. It also cannot identify this as self-authored;
      // the bridge calibrates that from WeChat's own File Transfer history.
      await until(() => relay.connections >= 2, "the desktop sync pulse");
      relay.emit([
        {
          messageId: "desktop-self-send",
          chatId: "filehelper",
          chatName: "File Transfer",
          body: "typed in WeChat",
          fromSelf: false,
          timestamp: at,
        },
        {
          messageId: "older-desktop-self-send",
          chatId: "filehelper",
          chatName: "File Transfer",
          body: "typed just before",
          fromSelf: false,
          timestamp: at - 1,
        },
      ]);
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.some((item) => item.preview === "typed in WeChat"),
        "the desktop-authored message to reach the Hub",
      );
      assert.equal(room.preview, "typed in WeChat");
      const {messages} = await hub.messages(room.roomId, 20);
      assert.deepEqual(
        messages.map((item) => item.body),
        ["typed in WeChat", "typed just before"],
      );
    },
    undefined,
    {desktopMessageSyncMs: 50, cliPaths: [cli]},
  );
});

test("desktop sync pulses leave old image recovery on its own cadence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-pulse-"));
  const calls = path.join(directory, "image-calls.log");
  const cli = path.join(directory, "wechat-use");
  await writeFile(
    cli,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `const calls = ${JSON.stringify(calls)};`,
      "if (process.argv[2] === 'image' && process.argv[3] === 'get') {",
      "  fs.appendFileSync(calls, process.argv.slice(2).join(' ') + '\\n');",
      "  process.stdout.write(JSON.stringify({error: 'image is not ready'}));",
      "  process.exit(0);",
      "}",
      "process.stdout.write(JSON.stringify({meta: {}, rows: []}));",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(cli, 0o755);

  await withBridge(
    async ({hub, relay}) => {
      relay.emit({
        messageId: "pulse-image",
        chatId: "filehelper",
        chatName: "File Transfer",
        messageKind: "image",
        hasMedia: true,
        fromSelf: true,
        timestamp: 1,
      });
      await threadWhen(
        hub,
        ({messages}) => messages.length === 1,
        "the unreadable image placeholder to arrive",
      );
      const before = (await readFile(calls, "utf8")).trim().split("\n").length;
      await until(() => relay.connections >= 4, "several desktop sync pulses");
      await new Promise((resolve) => setTimeout(resolve, 150));
      const after = (await readFile(calls, "utf8")).trim().split("\n").length;
      assert.equal(after, before, "stream pulses do not launch heap retries");
    },
    undefined,
    {
      desktopMessageSyncMs: 50,
      imageRetrySweepMs: 10_000,
      cliPaths: [cli],
    },
  );
});

test("a native write cancels an in-progress image recovery scan", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-cancel-"));
  const calls = path.join(directory, "image-calls.log");
  const count = path.join(directory, "image-count");
  const cli = path.join(directory, "wechat-use");
  await writeFile(
    cli,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `const calls = ${JSON.stringify(calls)};`,
      `const count = ${JSON.stringify(count)};`,
      "if (process.argv[2] === 'image' && process.argv[3] === 'get') {",
      "  const next = (fs.existsSync(count) ? Number(fs.readFileSync(count, 'utf8')) : 0) + 1;",
      "  fs.writeFileSync(count, String(next));",
      "  fs.appendFileSync(calls, `start:${next}\\n`);",
      "  if (next <= 2) {",
      "    process.stdout.write(JSON.stringify({error: 'image is not ready'}));",
      "    process.exit(0);",
      "  }",
      "  process.on('SIGTERM', () => { fs.appendFileSync(calls, `abort:${next}\\n`); process.exit(0); });",
      "  setInterval(() => {}, 1000);",
      "} else {",
      "  process.stdout.write(JSON.stringify({meta: {}, rows: []}));",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(cli, 0o755);
  const writes: WeChatWriteRequest[] = [];

  await withBridge(
    async ({bridge, hub, relay}) => {
      relay.emit({
        messageId: "cancel-image",
        chatId: "filehelper",
        chatName: "File Transfer",
        messageKind: "image",
        hasMedia: true,
        fromSelf: true,
        timestamp: 1,
      });
      const placeholder = await threadWhen(
        hub,
        ({messages}) => messages.length === 1,
        "the image placeholder to arrive",
      );
      await eventually(
        async () =>
          existsSync(calls) ? await readFile(calls, "utf8") : "",
        (value) => value.includes("start:3"),
        "the background image retry to start",
      );
      const eventId = await hub.send(
        placeholder.room.roomId,
        "text takes priority",
      );
      await bridge.waitForOutbound(eventId, 2_000);
      assert.equal(writes.length, 1);
      assert.match(await readFile(calls, "utf8"), /abort:3/);
    },
    (relay) => relay.setHijackArmed(false),
    {
      imageRetrySweepMs: 20,
      imageRetryDelaysMs: [60_000],
      cliPaths: [cli],
      primeApp: async () => false,
      writer: {
        write: async (request) => {
          writes.push({...request});
          return {deliveredVerified: true, messageId: "priority-send"};
        },
      },
    },
  );
});

test("a disconnected relay stops the stream instead of retrying forever", async () => {
  const logs: string[] = [];
  await withBridge(
    async ({ relay }) => {
      assert.equal(relay.connections, 1);
      relay.disconnect();
      await until(
        () =>
          logs.some((line) =>
            line.includes("stream stopped: relay is disconnected"),
          ),
        "the stream consumer to stop",
      );
      // The first old retry was one second, so crossing that boundary proves
      // the consumer did not quietly schedule another connection.
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      assert.equal(relay.connections, 1);
      assert.equal(
        logs.some((line) => line.includes("retrying in")),
        false,
      );
    },
    undefined,
    { log: (line) => logs.push(line) },
  );
});

test("a vanished relay stays down while the desktop session is signed out", async () => {
  const logs: string[] = [];
  await withBridge(
    async ({relay}) => {
      await relay.vanish();
      await until(
        () =>
          logs.some((line) =>
            line.includes("stream stopped: desktop session is remembered_login"),
          ),
        "the passive stream follower to recognise the signed-out desktop",
      );
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      assert.equal(
        logs.some((line) => line.includes("local relay stopped; restarting it")),
        false,
      );
    },
    undefined,
    {
      log: (line) => logs.push(line),
      sessionState: async () => "remembered_login",
      writer: {
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("a manually signed-in desktop resumes its relay without relaunching WeChat", async () => {
  const logs: string[] = [];
  let launches = 0;
  await withBridge(
    async ({bridge, relay}) => {
      relay.disconnect();
      assert.equal(
        await bridge.start("@polymux-test:polymux.local"),
        true,
      );
      assert.equal(launches, 0);
      assert.ok(
        logs.some((line) => line.includes("no relay binary")),
        "the already-signed-in desktop reaches relay recovery without an app launch",
      );
    },
    undefined,
    {
      log: (line) => logs.push(line),
      ensureAppRunning: async () => {
        launches += 1;
        return true;
      },
      sessionState: async () => "signed_in",
      writer: {
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("a quit WeChat app stays closed until outbound readiness is requested", async () => {
  let controlled: Relay | undefined;
  let launches = 0;
  await withBridge(
    async ({bridge, relay}) => {
      relay.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      assert.equal(launches, 0, "passive stream recovery leaves the app closed");
      assert.equal(relay.connections, 1);
      assert.equal(await bridge.start("@polymux-test:polymux.local"), true);
      assert.equal(launches, 0, "periodic bridge status leaves it closed");
      assert.equal(await bridge.outboundStatus(), false);
      assert.equal(launches, 0, "passive sender status also leaves it closed");

      assert.equal(await bridge.outboundReady(), true);
      await until(() => relay.connections >= 2, "the on-demand stream reconnect");
      assert.equal(launches, 1, "the explicit readiness request launches once");
    },
    (relay) => {
      controlled = relay;
    },
    {
      ensureAppRunning: async () => {
        launches += 1;
        controlled?.reconnect();
        return true;
      },
    },
  );
});

test("a first passive start with a writer leaves a quit WeChat app closed", async () => {
  let launches = 0;
  await withBridge(
    async ({bridge, relay}) => {
      await bridge.close();
      relay.disconnect();
      assert.equal(await bridge.start("@polymux-test:polymux.local"), true);
      assert.equal(launches, 0);
      assert.equal(await bridge.outboundStatus(), true);
      assert.equal(launches, 0);
    },
    undefined,
    {
      ensureAppRunning: async () => {
        launches += 1;
        return true;
      },
      writer: {
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("a bundled writer keeps quit WeChat available without waking it", async () => {
  let launches = 0;
  await withBridge(
    async ({bridge, relay}) => {
      relay.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(await bridge.outboundStatus(), true);
      assert.equal(launches, 0);
    },
    undefined,
    {
      ensureAppRunning: async () => {
        launches += 1;
        return true;
      },
      writer: {
        write: async () => ({deliveredVerified: true}),
      },
    },
  );
});

test("a status refresh cannot restart the relay during a native write", async () => {
  let releaseWriter!: () => void;
  let writerStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    writerStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });
  let appChecks = 0;
  await withBridge(
    async ({bridge, hub, relay}) => {
      relay.emit({
        messageId: "open-writer-race",
        chatId: "filehelper",
        chatName: "File Transfer",
        body: "ready",
        fromSelf: true,
        timestamp: 1,
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.length === 1,
        "File Transfer to open",
      );
      relay.sendResults.push({
        success: false,
        error: "slot_send_bp_armed_no_fire",
        diagnostic: {reason: "slot_send_bp_armed_no_fire"},
      });
      const eventId = await hub.send(room.roomId, "prepare native recall");
      await bridge.waitForOutbound(eventId, 2_000);
      const recall = bridge.recall(room.roomId, eventId);
      await started;
      assert.equal(appChecks, 2, "each writer operation checks the native app once");

      // This is the intentional relay gap that a live Hub status poll used to
      // misread as a crash, starting media recovery against the same process.
      relay.disconnect();
      assert.equal(
        await bridge.start("@polymux-test:polymux.local"),
        true,
        "the still-running appservice remains linked during the write",
      );
      assert.equal(appChecks, 2, "no app or relay recovery starts inside the native critical section");

      releaseWriter();
      await recall;
    },
    undefined,
    {
      ensureAppRunning: async () => {
        appChecks += 1;
        return true;
      },
      writer: {
        write: async (request) => {
          if (request.kind === "text")
            return {
              deliveredVerified: true,
              messageId: "status-race-server-id",
            };
          writerStarted();
          await released;
          return {deliveredVerified: true};
        },
      },
    },
  );
});

for (const [identitySource, operation] of [["relay", "read"], ["host", "read"], ["unavailable", "read"], ["host", "text"]] as const) {
test(`an owned relay requires its exact WeChat target from ${identitySource} for ${operation}`,
  {skip: process.platform !== "darwin"}, async () => {
  const binaryDirectory = await mkdtemp(path.join(tmpdir(), "wechat-owned-relay-"));
  const relayBinary = path.join(binaryDirectory, "wechat-bridge");
  const starts = path.join(binaryDirectory, "starts.log");
  const target = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: "ignore"});
  await writeFile(relayBinary, `#!/usr/bin/env node
const http=require('node:http'),fs=require('node:fs');
const port=Number(process.argv[process.argv.indexOf('--port')+1]);
fs.appendFileSync(${JSON.stringify(starts)},'start\\n');
const sockets=new Set();
const server=http.createServer((request,response)=>{
  if(request.url.startsWith('/health')) return response.end(JSON.stringify({status:'connected',hijackArmed:false${identitySource === "relay" ? `,wechatPid:${target.pid}` : ""}}));
  if(request.url.startsWith('/unread')) return response.end('{}');
  if(request.url.startsWith('/chats')) return response.end(JSON.stringify({rows:[]}));
  if(request.url.startsWith('/messages/stream')) {response.writeHead(200,{'content-type':'text/event-stream'});response.write(': ready\\n\\n');return;}
  response.end('{}');
});
server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
server.listen(port,'127.0.0.1');
process.on('SIGTERM',()=>{for(const socket of sockets)socket.destroy();server.close(()=>process.exit(0));});
`, {mode: 0o700});
  const pins: Array<{pid: number; identity: string} | null> = [];
  let pinDuringWrite: {pid: number; identity: string} | null = null;
  try {
    await withBridge(async ({bridge, hub, relay}) => {
      relay.setWeChatPid(target.pid);
      relay.emit({messageId: "owned-relay-target", chatId: "filehelper",
        chatName: "File Transfer", body: "fixture", fromSelf: true, timestamp: 1});
      const {room, messages} = await threadWhen(hub, thread => thread.messages.length === 1,
        "the owned-relay fixture message");
      await relay.vanish();
      await eventually(async () => existsSync(starts) ? await readFile(starts, "utf8") : "",
        value => value.includes("start"), "the bridge-owned relay to start");
      if (identitySource === "unavailable") {
        await assert.rejects(bridge.markRead(room.roomId, messages[0].eventId), /exact process identity/);
        assert.equal(pinDuringWrite, null, "ambiguous host discovery must not start a writer");
        assert.equal(pins.length, 0, "a stale relay PID cannot replace failed host discovery");
        return;
      }
      if (operation === "text") {
        const eventId = await hub.send(room.roomId, "long native text operation");
        await bridge.waitForOutbound(eventId, 12_000);
      } else {
        await bridge.markRead(room.roomId, messages[0].eventId);
      }
      assert.equal(pinDuringWrite?.pid, target.pid);
      assert.match(pinDuringWrite?.identity ?? "", /node/);
      await eventually(async () => pins.at(-1), value => value === null,
        "the verified writer cleanup to clear its target pin");
    }, undefined, {
      binaryDirectories: [binaryDirectory],
      ...(identitySource !== "relay" ? {
        appProcessId: async () => identitySource === "host" ? target.pid! : null,
      } : {}),
      writer: {
        setNativeTarget: (pin) => pins.push(pin),
        write: async () => {
          pinDuringWrite = pins.at(-1) ?? null;
          if (operation === "text") {
            const startsBefore = await readFile(starts, "utf8");
            await new Promise(resolve => setTimeout(resolve, 6_000));
            assert.equal(await readFile(starts, "utf8"), startsBefore,
              "the relay cannot restart when a native text send outlasts the priority window");
            assert.equal(pins.at(-1), pinDuringWrite, "the process pin stays held until delivery settles");
          }
          return {deliveredVerified: true};
        },
      },
    });
  } finally {
    target.kill("SIGKILL");
    await rm(binaryDirectory, {recursive: true, force: true});
  }
});
}

for (const answer of [{success: true}, {ok: true}, {success: true, delivered_verified: false}]) {
  test(`relay acceptance without a delivery receipt stays unverified: ${JSON.stringify(answer)}`, async () => {
    await withBridge(async ({bridge, hub, relay}) => {
      relay.emit({messageId: "receipt-open", chatId: "filehelper", body: "ready", timestamp: 1});
      const [room] = await roomsWhen(hub, rows => rows.length === 1, "File Transfer");
      relay.sendResults.push(answer);
      const eventId = await hub.send(room.roomId, "receipt required");
      await assert.rejects(bridge.waitForOutbound(eventId, 5_000), /delivery is unverified/);
      assert.equal(relay.sent.length, 1);
    });
  });
}

test("an image CLI that exits after dispatch is not replayed through another installed copy", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wechat-send-no-replay-"));
  const firstLog = path.join(directory, "first-send");
  const secondLog = path.join(directory, "second-send");
  const first = path.join(directory, "first-cli");
  await writeFile(first, `#!/usr/bin/env node
if (process.argv[2] === 'send') {
  require('node:fs').writeFileSync(${JSON.stringify(firstLog)}, 'dispatched');
  process.exit(1);
}
process.stdout.write('{"rows":[]}');
`, {mode: 0o700});
  const second = await stubCli({}, secondLog);
  try {
    await withBridge(async ({bridge, hub, relay}) => {
      relay.emit({messageId: "image-no-replay-open", chatId: "filehelper", body: "ready", timestamp: 1});
      const [room] = await roomsWhen(hub, rows => rows.length === 1, "File Transfer");
      const bytes = new Uint8Array([1, 2, 3]);
      const url = await hub.upload("test.png", "image/png", bytes);
      const eventId = await hub.sendMedia(room.roomId, {
        url, name: "test.png", msgtype: "m.image", mimetype: "image/png", size: bytes.length,
      });
      await assert.rejects(bridge.waitForOutbound(eventId, 5_000), /send outcome is unknown/);
      assert.equal(existsSync(firstLog), true);
      assert.equal(existsSync(secondLog), false);
    }, undefined, {cliPaths: [path.join(directory, "missing-cli"), first, second]});
  } finally {
    await rm(directory, {recursive: true, force: true});
    await rm(path.dirname(second), {recursive: true, force: true});
  }
});

test("passive recovery retries a failed initial directory import on an existing bridge", async () => {
  const realFetch = globalThis.fetch;
  let available = false, failures = 0;
  const guardedFetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input).includes('/chats?') && !available) {
      failures++;
      return new Response('temporarily unavailable', {status: 503});
    }
    return realFetch(input, init);
  };
  await withBridge(async ({bridge, hub}) => {
    await until(() => failures > 0, 'initial directory failure');
    assert.deepEqual(await hub.rooms(), []);
    available = true;
    await new Promise(resolve => setTimeout(resolve, 20));
    const owner = '@polymux-test:polymux.local';
    await Promise.all([bridge.start(owner), bridge.start(owner)]);
    await roomsWhen(hub, rows => rows.some(row => row.name === 'Recovered chat'), 'passive import recovery');
    assert.equal((await hub.rooms()).filter(row => row.name === 'Recovered chat').length, 1);
  }, relay => {
    relay.catalogue.chats = [{username: 'wxid_recovered', display_name: 'Recovered chat'}];
  }, {fetch: guardedFetch, readSyncSweepMs: 60_000});
});

test("a replacement local Hub identity regains existing WeChat rooms without duplicating history", async () => {
  await withBridge(async ({bridge, hub, homeserver, directory, relay}) => {
    const original = await roomsWhen(hub, rows => rows.some(row => row.name === 'Existing owner chat'), 'original owner room');
    const roomId = original.find(row => row.name === 'Existing owner chat')!.roomId;
    const owner = homeserver.createLocalUser('polymux-replacement');
    const replacement = new MatrixHub({baseUrl: homeserver.baseUrl, homeserverUrl: homeserver.baseUrl,
      directory, embedded: true, auth: () => ({matrixToken: owner.accessToken, userId: owner.userId})});
    assert.deepEqual(await replacement.rooms(), []);
    for (let attempt = 0; attempt < 20; attempt++) {
      await bridge.start(owner.userId);
      if ((await replacement.rooms()).some(row => row.roomId === roomId)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const repaired = await replacement.rooms();
    assert.equal(repaired.filter(row => row.name === 'Existing owner chat').length, 1);
    assert.equal(repaired.find(row => row.name === 'Existing owner chat')?.roomId, roomId);
    assert.equal(relay.sent.length, 0, 'membership repair never sends to WeChat');
    await bridge.start(owner.userId);
    assert.equal((await replacement.rooms()).filter(row => row.roomId === roomId).length, 1);
  }, relay => {relay.catalogue.chats = [{username: 'wxid_existing_owner', display_name: 'Existing owner chat'}];});
});


test("cached photos, appmsg stickers and call records recover locally without new messages", async (t) => {
  const fixture = await nativeInboundFixture();
  const account = path.join(fixture.store.dbDir, "account");
  await mkdir(path.join(account, "db_storage"), {recursive: true});
  const bytes = Buffer.from("GIF89a" + "\u0000".repeat(20), "binary");
  const digest = createHash("md5").update(bytes).digest("hex");
  const store = {...fixture.store, dbDir: path.join(account, "db_storage"),
    messageShards: (): string[] => [], has: (name: string) => name === "message/message_resource.db",
    snapshot: async () => ({refresh: async () => false, query: async (read: (db: unknown) => unknown) => read({prepare: () => ({all: () =>
      [{packed_info: Buffer.concat([Buffer.from([18,34,10,32]), Buffer.from(digest)])}]})})}),
  } as unknown as WeChatNativeStore;
  try {
    await withBridge(async ({hub, relay, bridge, homeserver, accessToken}) => {
      relay.emit({chatId: "wxid_peer", localId: "1", serverId: "9001", timestamp: 1788886800,
        messageKind: "image", body: "[Photo]"});
      relay.emit({chatId: "wxid_peer", localId: "2", serverId: "9002", timestamp: 1788886801,
        messageKind: "emoticon", body: `<msg><appmsg><type>8</type><appattach><emoticonmd5>${digest}</emoticonmd5></appattach></appmsg></msg>`});
      relay.emit({chatId: "wxid_peer", localId: "3", serverId: "9003", timestamp: 1788886802,
        messageKind: "unknown", body: "[unknown]"});
      const before = await threadWhen(hub, page => page.messages.length === 3, "the three placeholders");
      const [room] = await hub.rooms();
      const photo = path.join(account, "msg/attach", createHash("md5").update("wxid_peer").digest("hex"), "2026-09/Img", `${digest}_t.dat`);
      const sticker = path.join(account, "cache/2026-09/Emoticon", digest.slice(0,2), digest);
      for (const file of [photo, sticker]) {await mkdir(path.dirname(file), {recursive:true}); await writeFile(file, bytes);}
      assert.equal(await bridge.refreshCachedMedia("!unmapped:polymux.local", before.messages.map(m => m.eventId)), false);
      assert.equal(await bridge.refreshCachedMedia(room.roomId, before.messages.map(m => m.eventId)), true);
      relay.emit({chatId: "wxid_peer", localId: "3", serverId: "9003", timestamp: 1788886802,
        messageKind: "unknown", body: "<voipmsg><msg>Call ended</msg></voipmsg>"});
      const after = await threadWhen(hub, page => page.messages.some(m => m.body === "[Call]") &&
        page.messages.filter(m => m.attachments.some(a => a.url)).length === 2, "the local media and call label");
      assert.deepEqual(after.messages.map(m => m.eventId), before.messages.map(m => m.eventId));
      assert.equal(after.messages.flatMap(m => m.attachments).find(a => a.sticker)?.sticker, true);
      for (const item of after.messages.filter(m => m.attachments.length)) {
        assert.equal(item.viewIn, null);
        const mediaPath = item.attachments[0].url!.replace("polymux-media://", "");
        const response = await fetch(new URL(`/_matrix/media/v3/download/${mediaPath}`, homeserver.baseUrl), {headers: {Authorization: `Bearer ${accessToken}`}});
        assert.equal(response.ok, true);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      }
      assert.equal(await bridge.refreshCachedMedia(room.roomId, before.messages.map(m => m.eventId)), false);
      const original = Buffer.from("GIF89a" + "\u0000".repeat(200), "binary");
      await writeFile(photo.replace('_t.dat', '.dat'), original);
      t.mock.timers.enable({apis: ['Date'], now: Date.now()});
      t.mock.timers.tick(61_000);
      assert.equal(await bridge.refreshCachedMedia(room.roomId, before.messages.map(m => m.eventId)), true);
      const upgraded = await hub.messages(room.roomId, 20);
      assert.deepEqual(upgraded.messages.map(m => m.eventId), before.messages.map(m => m.eventId));
      const photoMessage = upgraded.messages.find(m => m.eventId === before.messages.find(m => m.body === '[Photo]')?.eventId)!;
      const download = photoMessage.attachments[0].url!.replace('polymux-media://', '');
      const response = await fetch(new URL(`/_matrix/media/v3/download/${download}`, homeserver.baseUrl), {headers: {Authorization: `Bearer ${accessToken}`}});
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
      t.mock.timers.tick(61_000);
      assert.equal(await bridge.refreshCachedMedia(room.roomId, [photoMessage.eventId]), false);
      t.mock.timers.reset();
      assert.equal(relay.sent.length, 0);
    }, undefined, {preferNativeInbound: true, nativeStores: [store], imageRetryDelaysMs: [60_000]});
  } finally {await rm(fixture.store.dbDir, {recursive:true, force:true});}
});


test("appmsg sticker references download their matching GIF and reject mismatched digests", async () => {
  const bytes = Buffer.from("GIF89a" + "\u0000".repeat(20), "binary");
  const digest = createHash("md5").update(bytes).digest("hex");
  await withBridge(async ({hub, relay}) => {
    const reference = (id: string) => {
      const url = Buffer.from(`${relay.url}/sticker.gif`);
      const info = Buffer.concat([Buffer.from([10,32]),Buffer.from(id),Buffer.from([18,url.length]),url]).toString("base64");
      return `<msg><appmsg><type>8</type><appattach><emoticonmd5><![CDATA[${id}]]></emoticonmd5><emojiinfo>${info}</emojiinfo></appattach></appmsg></msg>`;
    };
    relay.emit({chatId:"wxid_peer",localId:"1",serverId:"9901",timestamp:1788886800,messageKind:"appmsg",body:reference(digest)});
    relay.emit({chatId:"wxid_peer",localId:"2",serverId:"9902",timestamp:1788886801,messageKind:"appmsg",body:reference("a".repeat(32))});
    const page = await threadWhen(hub, p => p.messages.length === 2, "the appmsg sticker payloads");
    assert.equal(page.messages.filter(m => m.attachments.some(a => a.sticker && a.url)).length,1);
    assert.equal(page.messages.filter(m => m.body === "[Sticker]").length,1);
    assert.equal(relay.sent.length,0);
  });
});


test("native-only bridge imports and preserves chats without any relay requests", async () => {
  const native = await nativeInboundFixture();
  let externalRequests = 0;
  let nativeActions = 0;
  try {
    await native.commit("wxid_local_only", ["native-only history"]);
    await withBridge(async ({hub, bridge, relay}) => {
      const page = await threadWhen(hub, thread => thread.messages.some(row => row.body === "native-only history"), "native-only import");
      assert.equal(await bridge.outboundReady(), false);
      assert.equal(externalRequests, 0);
      assert.equal(nativeActions, 0);
      assert.equal(page.messages.length, 1);
      assert.equal(relay.connections, 0);
      assert.equal(bridge.nativeReadable(), true);
    }, undefined, {nativeStores:[native.store], preferNativeInbound:true, externalProvider:false,
      writer: {compatible:async () => false, readinessFailure:() => "Unsupported WeChat build", write:async () => {nativeActions++; throw new Error("must not write");}},
      ensureAppRunning:async () => {nativeActions++; return true;},
      primeApp:async () => {nativeActions++; return true;},
      sessionState:async () => {nativeActions++; return "signed_in";},
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/health" || url.pathname === "/messages/stream" || url.pathname === "/unread" || url.pathname === "/chats") {
          externalRequests++; throw new Error("Native-only mode must never request the external relay");
        }
        return globalThis.fetch(input, init);
      }}, false);
  } finally {await native.dispose();}
});

test("native-only history keeps its cache and retries when a missing shard becomes readable", async () => {
  const native = await nativeInboundFixture();
  const shardOf = native.store.shardOf.bind(native.store);
  let available = true;
  let probes = 0;
  native.store.shardOf = async chatId => {probes++; return available ? shardOf(chatId) : null;};
  try {
    await native.commit("wxid_local_only", ["cached native message"]);
    await withBridge(async ({hub, bridge, relay}) => {
      const page = await threadWhen(hub, thread => thread.messages.length === 1, "the cached native thread");
      available = false;
      assert.equal(await bridge.loadOlderHistory(page.room.roomId, 10), false);
      assert.deepEqual((await hub.messages(page.room.roomId, 10)).messages.map(row => row.body), ["cached native message"]);
      const before = probes;
      available = true;
      assert.equal(await bridge.loadOlderHistory(page.room.roomId, 10), false);
      assert.ok(probes > before, "an unavailable shard must not persist an exhausted history cursor");
      assert.equal((await hub.messages(page.room.roomId, 10)).messages.length, 1);
      assert.equal(relay.connections, 0);
      assert.equal(relay.sent.length, 0);
    }, undefined, {nativeStores: [native.store], preferNativeInbound: true, externalProvider: false}, false);
  } finally {await native.dispose();}
});

test("an unconfirmed submission keeps one marked event and accepts a later fresh native echo", async () => {
  const at = Math.floor(Date.now() / 1000);
  const cli = await stubCli({filehelper: []});
  let submissions = 0;
  await withBridge(async ({bridge, hub, relay, homeserver}) => {
    relay.emit({messageId: "uncertain-seed", chatId: "filehelper", body: "ready", timestamp: at - 2});
    const {room} = await threadWhen(hub, ({messages}) => messages.length === 1, "File Transfer");
    const eventId = await hub.send(room.roomId, "one uncertain attempt");
    await assert.rejects(bridge.waitForOutbound(eventId, 5000), error =>
      error instanceof Error && "code" in error && error.code === "wechat_delivery_unconfirmed");
    assert.equal(homeserver.outboundDeliveryStatus(eventId), "unconfirmed");
    let page = await hub.messages(room.roomId, 20);
    assert.equal(page.messages.find(message => message.eventId === eventId)?.deliveryStatus, "unconfirmed");
    assert.equal(submissions, 1);
    relay.emit({messageId: "uncertain-final", serverId: "7890123456789012345", chatId: "filehelper",
      body: "one uncertain attempt", fromSelf: true, timestamp: Math.floor(Date.now() / 1000)});
    await threadWhen(hub, ({messages}) => messages.some(message => message.eventId === eventId &&
      message.deliveryStatus === undefined), "late native acknowledgement");
    page = await hub.messages(room.roomId, 20);
    assert.equal(page.messages.filter(message => message.body === "one uncertain attempt").length, 1);
    assert.equal(homeserver.outboundDeliveryStatus(eventId), null);
    assert.equal(submissions, 1, "reconciliation never replays the send");
  }, undefined, {cliPaths: [cli], outboundReconcileMs: 0,
    writer: {write: async request => {
      if (request.kind !== "text") return {deliveredVerified: true};
      submissions++;
      return {deliveredVerified: false, deliveryUnconfirmed: true, reason: "submission unconfirmed"};
    }}});
});

test("a timed-out wait stays unconfirmed when the delayed writer later rejects", async () => {
  const cli = await stubCli({filehelper: []});
  let release!: () => void;
  let entered!: () => void;
  const enteredWriter = new Promise<void>(resolve => {entered = resolve;});
  const heldWriter = new Promise<void>(resolve => {release = resolve;});
  await withBridge(async ({bridge, hub, relay, homeserver}) => {
    relay.emit({messageId: "delayed-seed", chatId: "filehelper", body: "ready", timestamp: 1});
    const {room} = await threadWhen(hub, ({messages}) => messages.length === 1, "File Transfer");
    const eventId = await hub.send(room.roomId, "delayed result");
    try {
      await enteredWriter;
      await assert.rejects(bridge.waitForOutbound(eventId, 10), /delivery is unconfirmed/);
      release();
      await assert.rejects(bridge.waitForOutbound(eventId, 5000), /fixture rejected after deadline/);
      assert.equal(homeserver.outboundDeliveryStatus(eventId), "unconfirmed");
      const page = await hub.messages(room.roomId, 20);
      assert.equal(page.messages.find(message => message.eventId === eventId)?.deliveryStatus, "unconfirmed");
    } finally {release();}
  }, undefined, {cliPaths: [cli], outboundReconcileMs: 0,
    writer: {write: async request => {
      if (request.kind !== "text") return {deliveredVerified: true};
      entered();
      await heldWriter;
      throw new Error("fixture rejected after deadline");
    }}});
});

test("restart restores an uncertain send and its late receipt without replaying the native action", async (t) => {
  const at = Math.floor(Date.now() / 1000);
  const cli = await stubCli({filehelper: []});
  let submissions = 0;
  let submittedAt = 0;
  await withBridge(async ({bridge, hub, relay, homeserver, directory}) => {
    relay.emit({messageId: "restart-seed", chatId: "filehelper", body: "ready", timestamp: at - 2});
    const {room} = await threadWhen(hub, ({messages}) => messages.length === 1, "restart File Transfer");
    const body = "one attempt across restart";
    const eventId = await hub.send(room.roomId, body);
    await assert.rejects(bridge.waitForOutbound(eventId, 5000), /unconfirmed/);
    assert.ok(submittedAt > 0);
    await bridge.close();

    const resetReplayCache = async () => {
      const file = path.join(directory, "wechat/state.json");
      const state = JSON.parse(await readFile(file, "utf8"));
      state.outboundEchoes = [];
      state.seenTransactions = {};
      state.nativeMessageEvents = {};
      state.remoteMessageIds = {};
      await writeFile(file, JSON.stringify(state));
    };
    const restart = async () => {
      const restarted = new WeChatBridge({...noDeviceOptions, homeserver, directory,
        relayUrl: relay.url, binaryDirectories: [], cliPaths: [cli], outboundReconcileMs: 0,
        writer: {write: async () => {submissions++; throw new Error("must not resubmit after restart");}}});
      await restarted.start("@polymux-test:polymux.local");
      return restarted;
    };
    const replay = async (id: string) => {
      const registration = JSON.parse(await readFile(path.join(directory, "wechat/registration.json"), "utf8"));
      const response = await fetch(`http://127.0.0.1:${registration.port}/_matrix/app/v1/transactions/${id}`, {
        method: "PUT", headers: {Authorization: `Bearer ${registration.hsToken}`, "Content-Type": "application/json"},
        body: JSON.stringify({events: [{event_id: eventId, room_id: room.roomId,
          sender: "@polymux-test:polymux.local", type: "m.room.message", content: {msgtype: "m.text", body}}]}),
      });
      assert.equal(response.status, 200);
    };
    await resetReplayCache();
    // Recovery a long time later must consider the message's authored time,
    // without accepting a new same-body message composed after the attempt.
    t.mock.timers.enable({apis: ["Date"], now: Date.now() + 3_600_000});
    const restarted = await restart();
    try {
      assert.equal(homeserver.outboundDeliveryStatus(eventId), "unconfirmed");
      await replay("interrupted-batch");
      await assert.rejects(restarted.waitForOutbound(eventId, 5000), /unconfirmed/);
      assert.equal(submissions, 1);
      relay.emit({chatId: "filehelper", messageId: "later-independent", serverId: "7890123456789012999",
        body, fromSelf: true, timestamp: submittedAt + 3_600});
      await threadWhen(hub, ({messages}) => messages.filter(row => row.body === body).length === 2,
        "a separate later Desktop message");
      assert.equal(homeserver.outboundDeliveryStatus(eventId), "unconfirmed");
      relay.emit({chatId: "filehelper", messageId: "restart-final", serverId: "7890123456789012345",
        body, fromSelf: true, timestamp: submittedAt});
      await threadWhen(hub, ({messages}) => messages.some(row => row.eventId === eventId &&
        row.deliveryStatus === undefined), "the recovered acknowledgement");
      assert.equal(submissions, 1);
    } finally {await restarted.close();}
    await resetReplayCache();
    const confirmed = await restart();
    try {
      await replay("confirmed-batch");
      await confirmed.waitForOutbound(eventId, 5000);
      assert.equal(homeserver.outboundDeliveryStatus(eventId), null);
      assert.equal(submissions, 1);
      const page = await hub.messages(room.roomId, 20);
      assert.equal(page.messages.filter(row => row.body === body).length, 2);
    } finally {await confirmed.close(); t.mock.timers.reset();}
  }, undefined, {cliPaths: [cli], outboundReconcileMs: 0,
    writer: {write: async request => {
      if (request.kind !== "text") return {deliveredVerified: true};
      submissions++;
      // Use the actual dispatch time. Slow setup must not create an echo
      // authored before the send boundary the production guard protects.
      submittedAt = Math.floor(Date.now() / 1000);
      return {deliveredVerified: false, deliveryUnconfirmed: true};
    }}});
});

for (const media of [
  {kind: "image", name: "restart.png", mimetype: "image/png", msgtype: "m.image"},
  {kind: "audio", name: "voice.wav", mimetype: "audio/wav", msgtype: "m.audio"},
] as const) {
test(`${media.kind} is fenced before native dispatch and remains unconfirmed after a restart`, async () => {
  let fixtureDirectory = "";
  let submissions = 0;
  await withBridge(async ({bridge, hub, relay, homeserver, directory}) => {
    fixtureDirectory = directory;
    relay.emit({messageId: "media-restart-seed", chatId: "filehelper", body: "ready", timestamp: 1});
    const {room} = await threadWhen(hub, ({messages}) => messages.length === 1, "media restart File Transfer");
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const url = await hub.upload(media.name, media.mimetype, bytes);
    const eventId = await hub.sendMedia(room.roomId, {
      url, name: media.name, msgtype: media.msgtype, mimetype: media.mimetype, size: bytes.length,
    });
    await assert.rejects(bridge.waitForOutbound(eventId, 5_000), /unconfirmed/);
    await bridge.close();
    await bridge.start("@polymux-test:polymux.local");
    assert.equal(homeserver.outboundDeliveryStatus(eventId), "unconfirmed");
    const registration = JSON.parse(await readFile(path.join(directory, "wechat/registration.json"), "utf8"));
    const response = await fetch(`http://127.0.0.1:${registration.port}/_matrix/app/v1/transactions/media-replayed`, {
      method: "PUT", headers: {Authorization: `Bearer ${registration.hsToken}`, "Content-Type": "application/json"},
      body: JSON.stringify({events: [{event_id: eventId, room_id: room.roomId, sender: "@polymux-test:polymux.local",
        type: "m.room.message", content: {msgtype: media.msgtype, url, body: media.name}}]}),
    });
    assert.equal(response.status, 200);
    await assert.rejects(bridge.waitForOutbound(eventId, 5_000), /unconfirmed/);
    assert.equal(submissions, 1);
    const page = await hub.messages(room.roomId, 20);
    assert.equal(page.messages.filter(row => row.eventId === eventId).length, 1);
    assert.equal(page.messages.find(row => row.eventId === eventId)?.attachments[0]?.kind, media.kind);
  }, undefined, {writer: {write: async request => {
    if (request.kind !== "media") return {deliveredVerified: true};
    assert.equal(request.mediaType, media.kind);
    const db = new DatabaseSync(path.join(fixtureDirectory, "wechat/outbox.sqlite"), {readOnly: true});
    try {
      const rows = db.prepare("SELECT status, chat_id FROM attempts").all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "pending", "the fence is already on disk before the writer is invoked");
      assert.equal(rows[0].chat_id, "filehelper");
    } finally {db.close();}
    submissions++;
    return {deliveredVerified: false, deliveryUnconfirmed: true};
  }}});
});
}

test("native reads recover after manual login without launching Desktop or preparing a sender", async () => {
  const state: {snapshotError?: string} = {snapshotError: 'not readable before login'};
  const native = await nativeInboundFixture(state);
  let mutations = 0;
  try {
    await native.commit('wxid_local_only', ['available after manual login']);
    await withBridge(async ({bridge, hub, relay}) => {
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(bridge.nativeReadable(), false);
      state.snapshotError = undefined;
      await Promise.all([bridge.start('@polymux-test:polymux.local'), bridge.start('@polymux-test:polymux.local')]);
      const page = await threadWhen(hub, row => row.messages.some(message => message.body === 'available after manual login'), 'native manual-login recovery');
      assert.equal(bridge.nativeReadable(), true);
      await bridge.start('@polymux-test:polymux.local');
      assert.equal((await hub.messages(page.room.roomId, 20)).messages.length, 1);
      assert.equal(mutations, 0);
      assert.equal(relay.connections, 0);
      assert.equal(relay.sent.length, 0);
    }, undefined, {nativeStores: [native.store], preferNativeInbound: true, externalProvider: false,
      ensureAppRunning: async () => {mutations++; return false;},
      primeApp: async () => {mutations++; return false;},
      sessionState: async () => state.snapshotError ? 'interactive_login' : 'signed_in',
    }, false);
  } finally {await native.dispose();}
});
