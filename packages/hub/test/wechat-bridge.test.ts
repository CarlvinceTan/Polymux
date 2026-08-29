import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Homeserver } from "../src/server.js";
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
import { MatrixHub } from "../src/hub.js";
import {
  setupGuidance,
  setupHint,
  WECHAT_DOWNLOAD_URL,
  WECHAT_DOWNLOAD_URLS,
  weChatDownloadUrl,
} from "../src/wechat-relay.js";

test("native WeChat failure codes become actionable messages", () => {
  assert.equal(
    weChatWriterFailureMessage("wechat_not_running", "media"),
    "Open WeChat and make sure you are signed in, then try again.",
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
  /** What `/chats` answers, and the history each chat hands back on import. */
  catalogue: { chats: unknown[]; history: Record<string, unknown[]> };
  /** How many times the bridge has opened the stream, reconnects included. */
  connections: number;
  /** Pushes one message down the stream, as a new WeChat message would arrive. */
  emit: (message: Record<string, unknown>) => void;
  /** Ends the stream as a network blip would, so the bridge reconnects. */
  dropStream: () => void;
  /** Reports WeChat disconnected and ends the stream permanently. */
  disconnect: () => void;
  /** Makes the relay report connected again after a hidden app relaunch. */
  reconnect: () => void;
  /** Resolves once the bridge has actually subscribed to the stream. */
  connected: () => Promise<void>;
}

async function stubRelay(): Promise<Relay> {
  const sent: Relay["sent"] = [];
  const catalogue: Relay["catalogue"] = { chats: [], history: {} };
  let connections = 0;
  let stream: ServerResponse | null = null;
  let health = "connected";
  let hijackArmed: boolean | undefined;
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
      });
    if (url.startsWith("/chats")) return reply(catalogue.chats);
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
    if (history)
      return reply(catalogue.history[decodeURIComponent(history[1])] ?? []);
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
        reply(sendResults.shift() ?? { success: true });
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
    catalogue,
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
      stream?.end();
      stream = null;
    },
    reconnect: () => {
      health = "connected";
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
  }) => Promise<void>,
  /** Runs before the bridge starts, for state its initial import should find. */
  prepare?: (relay: Relay) => void,
  /** Bridge options a test needs to differ, e.g. the image-retry cadence. */
  overrides: Partial<ConstructorParameters<typeof WeChatBridge>[0]> = {},
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
    await relay.connected();
    await body({
      bridge,
      hub,
      relay,
      homeserver,
      accessToken: owner.accessToken,
    });
  } finally {
    await bridge.close();
    relay.server.close();
    await homeserver.close();
  }
}

/**
 * A stand-in for `wechat-use`, which is where the account's own participant
 * number comes from. Answers `history` with whatever the test asked for, in
 * the `{meta, rows}` shape the real tool uses with `--fields`.
 */
async function stubCli(
  rows: Record<string, Array<{ create_time: number; real_sender_id: string }>>,
  sendLog?: string,
  audio?: Uint8Array,
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
      chatName: "Same chat",
      senderId: "wxid_same_chat",
      senderName: "Same chat",
      body: "after",
      timestamp: 2,
    });
    const rooms = await roomsWhen(
      hub,
      (list) =>
        list.length === 1 &&
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

test("WeChat's own unread counts decide what the hub calls unread", async () => {
  await withBridge(
    async ({ hub }) => {
      const rooms = await eventually(
        () => hub.rooms(),
        (rooms) =>
          rooms.length === 2 &&
          rooms.every((room) => room.name !== room.roomId),
        "both conversations to be imported",
      );
      const unread = new Map(rooms.map((room) => [room.name, room.unread]));
      // Read in WeChat itself, so the import is history rather than news: the
      // count it arrives with is the one WeChat states, not one per message.
      await eventually(
        () => hub.rooms(),
        (rooms) =>
          rooms.find((room) => room.name === "Already Read")?.unread === 0,
        "the read conversation to stop counting as unread",
      );
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

test("a WeChat voice message carries its exact SILK bytes into Matrix", async () => {
  const bytes = Buffer.from("#!SILK_V3\u0002polymux-voice-fixture", "binary");
  const cli = await stubCli({}, undefined, bytes);
  await withBridge(
    async ({ hub, relay, homeserver, accessToken }) => {
      relay.emit({
        messageId: "voice-123",
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
    // Every message in the file-transfer chat is one the account sent itself,
    // which is what says the account's own number is 2.
    filehelper: [{ create_time: 1, real_sender_id: "2" }],
    wxid_friend: [
      { create_time: 100, real_sender_id: "2" },
      { create_time: 101, real_sender_id: "50" },
    ],
  });
  await withBridge(
    async ({ hub, relay }) => {
      // The relay reports both of these the same way — as the contact, with
      // `fromSelf` false — so without WeChat's own numbering the user's half
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
        timestamp: 101,
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

test("a reply reaches WeChat with the quoted context its API cannot encode", async () => {
  await withBridge(async ({ hub, relay }) => {
    relay.emit({
      messageId: "m1",
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
    await hub.send(room.roomId, "pong", messages[0].eventId);
    await until(() => relay.sent.length > 0, "the reply to reach the relay");
    assert.deepEqual(relay.sent, [
      { chatId: "wxid_friend", message: "↳ Alex: ping\npong" },
    ]);
  });
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

test("an unwarmed relay is primed in the background and retried once", async () => {
  let primes = 0;
  await withBridge(
    async ({hub, relay}) => {
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
      await hub.send(room.roomId, "retry after hidden prime");
      await until(() => relay.sent.length === 2, "the primed send retry");
      assert.equal(primes, 1);
      assert.deepEqual(relay.sent, [
        {chatId: "filehelper", message: "retry after hidden prime"},
        {chatId: "filehelper", message: "retry after hidden prime"},
      ]);
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

test("the native writer primes a relay that advertises an unarmed daemon", async () => {
  let primes = 0;
  const writes: WeChatWriteRequest[] = [];
  await withBridge(
    async ({hub, relay}) => {
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
      relay.sendResults.push(
        {
          success: false,
          error: "slot_send_bp_armed_no_fire",
          diagnostic: {reason: "slot_send_bp_armed_no_fire"},
        },
      );
      await hub.send(room.roomId, "writer after hidden prime");
      await until(() => writes.length === 1, "the primed writer call");
      assert.equal(primes, 1);
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

test("an active daemon sends plain text without pausing the native app", async () => {
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
      assert.deepEqual(relay.sent, [
        {chatId: "filehelper", message: "daemon stays active"},
      ]);
      assert.equal(nativeWrites, 0);
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

test("a native Matrix sticker event reaches WeChat and its echo is suppressed", async () => {
  const writes: Array<{
    request: WeChatWriteRequest;
    bytes?: Buffer;
  }> = [];
  await withBridge(
    async ({ hub, relay, homeserver, accessToken }) => {
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

test("the native writer receives the operations WeChat permits in File Transfer", async () => {
  const writes: WeChatWriteRequest[] = [];
  await withBridge(
    async ({ hub, relay }) => {
      relay.emit({
        messageId: "native-target",
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
      writer: {
        write: async () => ({
          deliveredVerified: false,
          reason: "native delivery rejected",
        }),
      },
    },
  );
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
        messageId: "reply-target",
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
          messageId: "reply-echo",
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
        messageId: "painted-target",
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

test("an installed native writer leaves mentions on the daemon-owned path", async () => {
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
      await until(() => existsSync(log), "the daemon-owned mention to be dispatched");
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
      assert.equal(writes.length, 0);
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
    setupHint({ wechat: false, relay: false }) ?? "",
    /WeChat for Mac is not installed/,
  );
  assert.match(
    setupHint({ wechat: false, relay: true }) ?? "",
    /WeChat for Mac is not installed/,
  );
  assert.match(
    setupHint({ wechat: true, relay: false }) ?? "",
    /WeChat is open and signed in/,
  );
  // How Polymux reaches WeChat is its own plumbing. Naming any of it hands the
  // user a task they cannot act on instead of the one they can.
  for (const hint of [
    setupHint({ wechat: false, relay: false }),
    setupHint({ wechat: true, relay: false }),
  ])
    assert.doesNotMatch(
      hint ?? "",
      /relay|wechat-use|wechatd|daemon|loopback|port/i,
    );
  // Both present is not a setup problem, so there is nothing to say.
  assert.equal(setupHint({ wechat: true, relay: true }), null);
});

test("setup offers the official installer only when WeChat itself is missing", () => {
  assert.deepEqual(setupGuidance({wechat: false, relay: false}), {
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
  assert.equal(setupGuidance({wechat: true, relay: false}).installUrl, null);
  assert.equal(setupGuidance({wechat: true, relay: true}).installUrl, null);
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

test("a linked bridge quietly relaunches WeChat and resumes its stream", async () => {
  let controlled: Relay | undefined;
  let launches = 0;
  await withBridge(
    async ({hub, relay}) => {
      relay.disconnect();
      await until(() => relay.connections >= 2, "the stream after WeChat relaunches");
      relay.emit({
        messageId: "after-hidden-relaunch",
        chatId: "filehelper",
        chatName: "File Transfer",
        senderId: "filehelper",
        senderName: "File Transfer",
        body: "back after hidden launch",
        timestamp: Math.floor(Date.now() / 1000),
      });
      const [room] = await roomsWhen(
        hub,
        (rooms) => rooms.some((item) => item.preview === "back after hidden launch"),
        "the resumed stream to carry a message",
      );
      assert.equal(room.preview, "back after hidden launch");
      assert.equal(launches, 1, "one disconnect requests one quiet relaunch");
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
      const [room] = await roomsWhen(hub, (rooms) => rooms.length === 1, "File Transfer to open");
      relay.sendResults.push({
        success: false,
        error: "slot_send_bp_armed_no_fire",
        diagnostic: {reason: "slot_send_bp_armed_no_fire"},
      });
      const eventId = await hub.send(room.roomId, "hold the native writer");
      await started;
      assert.equal(appChecks, 1, "the writer checks the native app once");

      // This is the intentional relay gap that a live Hub status poll used to
      // misread as a crash, starting media recovery against the same process.
      relay.disconnect();
      assert.equal(
        await bridge.start("@polymux-test:polymux.local"),
        true,
        "the still-running appservice remains linked during the write",
      );
      assert.equal(appChecks, 1, "no app or relay recovery starts inside the native critical section");

      releaseWriter();
      await bridge.waitForOutbound(eventId, 5_000);
    },
    undefined,
    {
      ensureAppRunning: async () => {
        appChecks += 1;
        return true;
      },
      writer: {
        write: async () => {
          writerStarted();
          await released;
          return {deliveredVerified: true};
        },
      },
    },
  );
});
