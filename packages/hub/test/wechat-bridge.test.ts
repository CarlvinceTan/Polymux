import assert from "node:assert/strict";
import {createServer, type Server, type ServerResponse} from "node:http";
import {chmod, mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {Homeserver} from "../src/server.js";
import {WeChatBridge} from "../src/wechat-bridge.js";
import {MatrixHub} from "../src/hub.js";
import {setupHint} from "../src/wechat-relay.js";

/**
 * The relay, stubbed. Everything the bridge needs from the WeChat side is
 * loopback HTTP plus an SSE stream, so a fake one exercises the whole bridge
 * without a WeChat account — and without sending anything to a real person.
 */
interface Relay {
  server: Server;
  url: string;
  /** Payloads the bridge asked the relay to send outward. */
  sent: Array<{chatId?: string; message?: string}>;
  /** What `/chats` answers, and the history each chat hands back on import. */
  catalogue: {chats: unknown[]; history: Record<string, unknown[]>};
  /** How many times the bridge has opened the stream, reconnects included. */
  connections: number;
  /** Pushes one message down the stream, as a new WeChat message would arrive. */
  emit: (message: Record<string, unknown>) => void;
  /** Ends the stream as a network blip would, so the bridge reconnects. */
  dropStream: () => void;
  /** Resolves once the bridge has actually subscribed to the stream. */
  connected: () => Promise<void>;
}

async function stubRelay(): Promise<Relay> {
  const sent: Relay["sent"] = [];
  const catalogue: Relay["catalogue"] = {chats: [], history: {}};
  let connections = 0;
  let stream: ServerResponse | null = null;
  const server = createServer((request, response) => {
    const reply = (body: unknown): void => {
      response.writeHead(200, {"Content-Type": "application/json"});
      response.end(JSON.stringify(body));
    };
    const url = request.url ?? "/";
    if (url.startsWith("/health")) return reply({status: "connected"});
    if (url.startsWith("/chats")) return reply(catalogue.chats);
    if (url.startsWith("/sticker.gif")) {
      response.writeHead(200, {"Content-Type": "application/octet-stream"});
      // A real GIF header: the CDN labels everything octet-stream, so the
      // bytes are what the bridge has to read the type from.
      return response.end(Buffer.from("GIF89a" + "\u0000".repeat(20), "binary"));
    }
    if (url.startsWith("/face.jpg")) {
      response.writeHead(200, {"Content-Type": "image/jpeg"});
      return response.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }
    if (url.startsWith("/unread")) return reply([]);
    const history = /^\/chat\/([^/]+)\/history/.exec(url);
    if (history) return reply(catalogue.history[decodeURIComponent(history[1])] ?? []);
    if (url.startsWith("/messages/stream")) {
      response.writeHead(200, {"Content-Type": "text/event-stream"});
      connections += 1;
      stream = response;
      return;
    }
    if (request.method === "POST" && url.startsWith("/send")) {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk as Buffer));
      request.on("end", () => {
        sent.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Relay["sent"][number]);
        reply({success: true});
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
    catalogue,
    get connections() {
      return connections;
    },
    emit: (message) => stream?.write(`data: ${JSON.stringify(message)}\n\n`),
    dropStream: () => {
      stream?.end();
      stream = null;
    },
    // Emitting before the bridge has subscribed writes into nothing, so every
    // test waits for the subscription rather than for a guessed delay.
    connected: async () => {
      for (let attempt = 0; attempt < 100 && !stream; attempt += 1)
        await new Promise((resolve) => setTimeout(resolve, 20));
      if (!stream) throw new Error("the bridge never subscribed to the relay stream");
    },
  };
}

async function withBridge(
  body: (context: {bridge: WeChatBridge; hub: MatrixHub; relay: Relay}) => Promise<void>,
  /** Runs before the bridge starts, for state its initial import should find. */
  prepare?: (relay: Relay) => void,
  /** Bridge options a test needs to differ, e.g. the image-retry cadence. */
  overrides: Partial<ConstructorParameters<typeof WeChatBridge>[0]> = {},
): Promise<void> {
  const relay = await stubRelay();
  prepare?.(relay);
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-wechat-"));
  // No port: the OS picks a free one and the harness reads it back off the
  // server. Counting up from a fixed base made two test files run at once
  // fight over the same numbers, which fails as a bridge error rather than as
  // anything to do with the bridge.
  const homeserver = new Homeserver({serverName: "flareai.local", dataDirectory: directory});
  await homeserver.start();
  const owner = homeserver.createLocalUser("flareai-test");
  // No binary directories: these tests must never spawn the real relay or
  // touch the WeChat app on the machine running them.
  const bridge = new WeChatBridge({
    homeserver,
    directory,
    relayUrl: relay.url,
    binaryDirectories: [],
    log: (line) => { if (process.env.WECHAT_TEST_LOG) console.log(line); },
    ...overrides,
  });
  await bridge.start(owner.userId);
  const hub = new MatrixHub({
    baseUrl: homeserver.baseUrl,
    homeserverUrl: homeserver.baseUrl,
    directory,
    auth: () => ({matrixToken: owner.accessToken, userId: owner.userId}),
  });
  try {
    await relay.connected();
    await body({bridge, hub, relay});
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
async function stubCli(rows: Record<string, Array<{create_time: number; real_sender_id: string}>>): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-wechat-cli-"));
  const file = path.join(directory, "wechat-use");
  const table = JSON.stringify(rows).replace(/'/g, "'\\''");
  await writeFile(
    file,
    [
      "#!/usr/bin/env node",
      `const table = JSON.parse(process.env.WECHAT_STUB_ROWS ?? '{}');`,
      "const chat = process.argv[3];",
      "process.stdout.write(JSON.stringify({meta: {}, rows: table[chat] ?? []}));",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(file, 0o755);
  process.env.WECHAT_STUB_ROWS = JSON.stringify(rows);
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
  throw new Error(`Timed out waiting for ${what}; last read was ${JSON.stringify(last)}`);
}

/** Polls a plain condition, for state that is not read out of the hub. */
function until(check: () => boolean, what: string): Promise<unknown> {
  return eventually(async () => check(), (ready) => ready, what);
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
async function threadWhen(hub: MatrixHub, ready: (thread: Thread) => boolean, what: string): Promise<Thread> {
  const state = await eventually(
    async (): Promise<Thread | null> => {
      const rooms = await hub.rooms();
      if (rooms.length === 0) return null;
      const {messages} = await hub.messages(rooms[0].roomId, 20);
      return {room: rooms[0], messages};
    },
    (thread) => thread !== null && ready(thread),
    what,
  );
  // eventually only returns once ready held, and ready cannot hold for null.
  return state as Thread;
}

test("an inbound message opens a portal room the hub files under WeChat", async () => {
  await withBridge(async ({hub, relay}) => {
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
      (list) => list.length === 1 && list[0].preview !== null && (list[0].unread ?? 0) > 0,
      "the portal to carry the message and its unread count",
    );
    assert.equal(rooms.length, 1);
    // The portal carries an `m.bridge` event, so it is recognised by the same
    // rule every mautrix room is — no WeChat special case in the chat list.
    assert.equal(rooms[0].platform, "wechat");
    assert.equal(rooms[0].name, "A Friend");
    assert.equal(rooms[0].preview, "ping");
    assert.equal(rooms[0].unread, 1);
  });
});

test("a group message is attributed to whoever sent it, in either case", async () => {
  await withBridge(async ({hub, relay}) => {
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
    const {messages} = await threadWhen(
      hub,
      ({messages}) => messages.length >= 2,
      "both group messages to arrive",
    );
    const named = new Map(messages.map((item) => [item.body, item.senderName]));
    assert.equal(named.get("court is booked"), "Ann");
    assert.equal(named.get("see you there"), "Bo");
  });
});

test("a conversation with nothing unread is imported too", async () => {
  await withBridge(
    async ({hub}) => {
      const names = (
        await roomsWhen(hub, (rooms) => rooms.length === 2, "both conversations to be imported")
      )
        .map((room) => room.name)
        .sort();
      // Importing only what was unread showed a fraction of the account: a
      // chat that has been read is still a chat the user expects to find.
      assert.deepEqual(names, ["Already Read", "Has Unread"]);
    },
    (relay) => {
      relay.catalogue.chats = [
        {username: "wxid_read", display_name: "Already Read", unread_count: 0},
        {username: "wxid_unread", display_name: "Has Unread", unread_count: 2},
      ];
      relay.catalogue.history = {
        wxid_read: [
          {message_id: "r1", chat_id: "wxid_read", chat_name: "Already Read", sender_id: "wxid_read", sender_name: "Already Read", body: "seen this", timestamp: 1},
        ],
        wxid_unread: [
          {message_id: "u1", chat_id: "wxid_unread", chat_name: "Has Unread", sender_id: "wxid_unread", sender_name: "Has Unread", body: "new one", timestamp: 2},
        ],
      };
    },
  );
});

test("WeChat's own unread counts decide what the hub calls unread", async () => {
  await withBridge(
    async ({hub}) => {
      const rooms = await eventually(
        () => hub.rooms(),
        (rooms) => rooms.length === 2 && rooms.every((room) => room.name !== room.roomId),
        "both conversations to be imported",
      );
      const unread = new Map(rooms.map((room) => [room.name, room.unread]));
      // Read in WeChat itself, so the import is history rather than news: the
      // count it arrives with is the one WeChat states, not one per message.
      await eventually(
        () => hub.rooms(),
        (rooms) => rooms.find((room) => room.name === "Already Read")?.unread === 0,
        "the read conversation to stop counting as unread",
      );
      // And a chat that really does have one waiting keeps it.
      assert.ok((unread.get("Has Unread") ?? 0) >= 1);
    },
    (relay) => {
      relay.catalogue.chats = [
        {username: "wxid_read", display_name: "Already Read", unread_count: 0},
        {username: "wxid_unread", display_name: "Has Unread", unread_count: 1},
      ];
      relay.catalogue.history = {
        wxid_read: [
          {message_id: "r1", chat_id: "wxid_read", chat_name: "Already Read", sender_id: "wxid_read", sender_name: "Already Read", body: "seen this", timestamp: 1},
          {message_id: "r2", chat_id: "wxid_read", chat_name: "Already Read", sender_id: "wxid_read", sender_name: "Already Read", body: "and this", timestamp: 2},
        ],
        wxid_unread: [
          {message_id: "u1", chat_id: "wxid_unread", chat_name: "Has Unread", sender_id: "wxid_unread", sender_name: "Has Unread", body: "read one", timestamp: 1},
          {message_id: "u2", chat_id: "wxid_unread", chat_name: "Has Unread", sender_id: "wxid_unread", sender_name: "Has Unread", body: "new one", timestamp: 2},
        ],
      };
    },
  );
});

test("an imported message keeps the time WeChat sent it", async () => {
  await withBridge(async ({hub, relay}) => {
    const sentAt = Math.floor(Date.parse("2026-08-10T02:30:00.000Z") / 1000);
    relay.emit({
      messageId: "m1",
      chatId: "wxid_friend",
      chatName: "A Friend",
      body: "last week",
      timestamp: sentAt,
    });
    const {room, messages} = await threadWhen(
      hub,
      ({room, messages}) => messages.length >= 1 && room.lastActivity !== null,
      "the imported message and the activity time taken from it",
    );
    // Stamped on import, a week of history all lands at the current moment:
    // every row shows the same time and the list cannot be sorted by recency.
    assert.equal(messages[0].sentAt, new Date(sentAt * 1000).toISOString());
    assert.equal(room.lastActivity, new Date(sentAt * 1000).toISOString());
  });
});

test("a contact's picture becomes the chat's avatar when the relay sends one", async () => {
  await withBridge(async ({hub, relay}) => {
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
    const {room, messages} = await threadWhen(
      hub,
      ({room, messages}) => room.avatarUrl !== null && messages.length >= 1,
      "the portal to take the contact's picture",
    );
    assert.ok(room.avatarUrl, "the portal took the contact's picture");
    assert.ok(messages[0].senderAvatarUrl, "and so did the contact");
  });
});

test("a sticker arrives as the picture rather than as its markup", async () => {
  await withBridge(async ({hub, relay}) => {
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
    const {room, messages} = await threadWhen(
      hub,
      ({messages}) => (messages[0]?.attachments.length ?? 0) > 0,
      "the sticker's picture to be carried across",
    );
    const [attachment] = messages[0].attachments;
    assert.equal(attachment?.kind, "image");
    assert.equal(attachment?.mimeType, "image/gif");
    assert.equal(attachment?.width, 240);
    assert.equal(room.preview, "Sticker", "the list names it, rather than showing markup");
  });
});

test("a sticker whose picture cannot be fetched still arrives as a message", async () => {
  await withBridge(async ({hub, relay}) => {
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
    const {messages} = await threadWhen(
      hub,
      ({messages}) => messages.length >= 1,
      "the sticker to arrive even though its picture could not be fetched",
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0].attachments.length, 0);
    assert.equal(messages[0].body, "[Sticker]");
    assert.equal(messages[0].viewIn?.app, "WeChat", "and it says where it can be seen");
  });
});

test("a message the account sent in WeChat itself is shown as its own", async () => {
  const cli = await stubCli({
    // Every message in the file-transfer chat is one the account sent itself,
    // which is what says the account's own number is 2.
    filehelper: [{create_time: 1, real_sender_id: "2"}],
    wxid_friend: [
      {create_time: 100, real_sender_id: "2"},
      {create_time: 101, real_sender_id: "50"},
    ],
  });
  process.env.FLAREAI_WECHAT_CLI = cli;
  try {
    await withBridge(async ({hub, relay}) => {
      // The relay reports both of these the same way — as the contact, with
      // `fromSelf` false — so without WeChat's own numbering the user's half
      // of the conversation appears as the other person's.
      relay.emit({messageId: "m1", chatId: "wxid_friend", chatName: "A Friend", senderId: "wxid_friend", senderName: "A Friend", body: "mine", timestamp: 100});
      relay.emit({messageId: "m2", chatId: "wxid_friend", senderId: "wxid_friend", senderName: "A Friend", body: "theirs", timestamp: 101});
      const {messages} = await threadWhen(
        hub,
        ({messages}) => messages.length >= 2,
        "both sides of the conversation to arrive",
      );
      const senders = new Map(messages.map((item) => [item.body, item.sender]));
      assert.match(senders.get("mine") ?? "", /^@flareai-/, "the account's own message is its own");
      assert.match(senders.get("theirs") ?? "", /^@wechat_/, "and the contact's is still theirs");
    });
  } finally {
    delete process.env.FLAREAI_WECHAT_CLI;
    delete process.env.WECHAT_STUB_ROWS;
  }
});

test("a reply is delivered to the relay for the right conversation", async () => {
  await withBridge(async ({hub, relay}) => {
    relay.emit({messageId: "m1", chatId: "wxid_friend", body: "ping", timestamp: 1});
    const [room] = await roomsWhen(hub, (rooms) => rooms.length === 1, "the portal to open");
    await hub.send(room.roomId, "pong");
    await until(() => relay.sent.length > 0, "the reply to reach the relay");
    assert.deepEqual(relay.sent, [{chatId: "wxid_friend", message: "pong"}]);
  });
});

test("our own message coming back from WeChat is not posted twice", async () => {
  await withBridge(async ({hub, relay}) => {
    relay.emit({messageId: "m1", chatId: "wxid_friend", body: "ping", timestamp: 1});
    const [room] = await roomsWhen(hub, (rooms) => rooms.length === 1, "the portal to open");
    await hub.send(room.roomId, "pong");
    await until(() => relay.sent.length > 0, "the reply to reach the relay");
    // WeChat echoes everything the account sends, including through us.
    relay.emit({messageId: "m2", chatId: "wxid_friend", body: "pong", timestamp: 2, fromSelf: true});
    /**
     * The echo must produce nothing, and nothing cannot be waited for. A later
     * message on the same ordered stream can be: once the marker has arrived,
     * the echo ahead of it has already been handled, so a duplicate would be
     * here by now. Sleeping instead only guessed at how long that took.
     */
    relay.emit({messageId: "m3", chatId: "wxid_friend", body: "after the echo", timestamp: 3});
    const {messages} = await threadWhen(
      hub,
      ({messages}) => messages.some((item) => item.body === "after the echo"),
      "the message sent after the echo, by which point the echo has been handled",
    );
    assert.equal(messages.filter((item) => item.body === "pong").length, 1);
  });
});

test("a sticker reads as one rather than as its markup", async () => {
  await withBridge(async ({hub, relay}) => {
    relay.emit({
      messageId: "m1",
      chatId: "wxid_friend",
      messageKind: "emoticon",
      body: '<msg><emoji fromusername="x" md5="abc" type="2"/></msg>',
      timestamp: 1,
    });
    const {messages} = await threadWhen(
      hub,
      ({messages}) => messages.length >= 1,
      "the sticker to arrive",
    );
    assert.equal(messages[0].body, "[Sticker]");
  });
});

test("media that cannot be carried across says where it can be seen", async () => {
  await withBridge(async ({hub, relay}) => {
    // No id the message store knows, so extraction cannot succeed.
    relay.emit({messageId: "999999", chatId: "wxid_x", messageKind: "voice", hasMedia: true, timestamp: 1});
    relay.emit({messageId: "999998", chatId: "wxid_x", body: "just text", timestamp: 2});
    // The voice note is the slow one: extraction is attempted and fails before
    // the placeholder is written, which is why this wait used to be doubled.
    const {messages} = await threadWhen(
      hub,
      ({messages}) =>
        messages.some((item) => item.body === "[Voice message]") &&
        messages.some((item) => item.body === "just text"),
      "both the unextractable voice note and the ordinary message to arrive",
    );
    const voice = messages.find((item) => item.body === "[Voice message]");
    const text = messages.find((item) => item.body === "just text");
    assert.deepEqual(voice?.viewIn, {app: "WeChat", url: "weixin://"});
    // An ordinary message has nothing to go and look at elsewhere.
    assert.equal(text?.viewIn, null);
  });
});

test("a picture WeChat would not decrypt yet becomes the picture once it will", async () => {
  /**
   * WeChat stores images encrypted and only decrypts one into the running
   * app's heap when someone opens it, so a picture nobody has looked at cannot
   * be read at all. Importing it once therefore froze it as a text placeholder
   * for good, even after the user opened it in WeChat and it became readable.
   */
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-wechat-cli-"));
  const viewed = path.join(directory, "viewed-in-wechat");
  const cli = path.join(directory, "wechat-use");
  await writeFile(
    cli,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
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
  process.env.FLAREAI_WECHAT_CLI = cli;
  try {
    await withBridge(
      async ({hub, relay}) => {
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
          ({messages}) => messages.length >= 1,
          "the unreadable picture to arrive as a placeholder",
        );
        assert.equal(placeholder.messages[0].attachments.length, 0);
        assert.ok(placeholder.messages[0].viewIn, "and it says where the picture can be seen");

        // The user opens it in WeChat, which is the only thing that makes it
        // readable — and which nothing here can hurry along.
        await writeFile(viewed, "", "utf8");

        const {messages} = await threadWhen(
          hub,
          ({messages}) => messages.some((item) => item.attachments.length > 0),
          "the retry to bring the picture across",
        );
        assert.equal(
          messages.length,
          1,
          "the placeholder became the picture rather than the picture arriving as a second message",
        );
        assert.equal(messages[0].attachments[0].mimeType, "image/jpeg");
      },
      undefined,
      {imageRetrySweepMs: 50, imageRetryDelaysMs: [10]},
    );
  } finally {
    delete process.env.FLAREAI_WECHAT_CLI;
  }
});

test("a relay that is not running leaves WeChat unlinked rather than failing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-wechat-"));
  // No port: the OS picks a free one and the harness reads it back off the
  // server. Counting up from a fixed base made two test files run at once
  // fight over the same numbers, which fails as a bridge error rather than as
  // anything to do with the bridge.
  const homeserver = new Homeserver({serverName: "flareai.local", dataDirectory: directory});
  await homeserver.start();
  const owner = homeserver.createLocalUser("flareai-test");
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
    setupHint({wechat: false, relay: false}) ?? "",
    /WeChat for Mac is not installed/,
  );
  assert.match(setupHint({wechat: false, relay: true}) ?? "", /WeChat for Mac is not installed/);
  assert.match(setupHint({wechat: true, relay: false}) ?? "", /WeChat is open and signed in/);
  // How FlareAI reaches WeChat is its own plumbing. Naming any of it hands the
  // user a task they cannot act on instead of the one they can.
  for (const hint of [
    setupHint({wechat: false, relay: false}),
    setupHint({wechat: true, relay: false}),
  ])
    assert.doesNotMatch(hint ?? "", /relay|wechat-use|wechatd|daemon|loopback|port/i);
  // Both present is not a setup problem, so there is nothing to say.
  assert.equal(setupHint({wechat: true, relay: true}), null);
});

test("a reconnected stream does not re-post what the first one already carried", async () => {
  await withBridge(async ({hub, relay}) => {
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
      ({messages}) => messages.length === 1,
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
    const {messages} = await hub.messages(thread.room.roomId, 20);
    assert.equal(messages.length, 1);
  });
});
