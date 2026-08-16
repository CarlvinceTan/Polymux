import assert from "node:assert/strict";
import {createServer, type Server, type ServerResponse} from "node:http";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {Homeserver} from "../homeserver/server.js";
import {WeChatBridge} from "../homeserver/wechat-bridge.js";
import {MatrixHub} from "../communications/hub.js";
import {setupHint} from "../communications/wechat-relay.js";

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
  /** Pushes one message down the stream, as a new WeChat message would arrive. */
  emit: (message: Record<string, unknown>) => void;
  /** Resolves once the bridge has actually subscribed to the stream. */
  connected: () => Promise<void>;
}

async function stubRelay(): Promise<Relay> {
  const sent: Relay["sent"] = [];
  let stream: ServerResponse | null = null;
  const server = createServer((request, response) => {
    const reply = (body: unknown): void => {
      response.writeHead(200, {"Content-Type": "application/json"});
      response.end(JSON.stringify(body));
    };
    const url = request.url ?? "/";
    if (url.startsWith("/health")) return reply({status: "connected"});
    if (url.startsWith("/unread")) return reply([]);
    if (url.startsWith("/messages/stream")) {
      response.writeHead(200, {"Content-Type": "text/event-stream"});
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
    emit: (message) => stream?.write(`data: ${JSON.stringify(message)}\n\n`),
    // Emitting before the bridge has subscribed writes into nothing, so every
    // test waits for the subscription rather than for a guessed delay.
    connected: async () => {
      for (let attempt = 0; attempt < 100 && !stream; attempt += 1)
        await new Promise((resolve) => setTimeout(resolve, 20));
      if (!stream) throw new Error("the bridge never subscribed to the relay stream");
    },
  };
}

let nextPort = 47_900;

async function withBridge(
  body: (context: {bridge: WeChatBridge; hub: MatrixHub; relay: Relay}) => Promise<void>,
): Promise<void> {
  const relay = await stubRelay();
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-wechat-"));
  const homeserver = new Homeserver({
    serverName: "flareai.local",
    dataDirectory: directory,
    port: (nextPort += 1),
  });
  await homeserver.start();
  const owner = homeserver.createLocalUser("flareai-test");
  // No binary directories: these tests must never spawn the real relay or
  // touch the WeChat app on the machine running them.
  const bridge = new WeChatBridge({
    homeserver,
    directory,
    relayUrl: relay.url,
    binaryDirectories: [],
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

/** Lets the stream, the homeserver's push loop and the bridge settle. */
function settle(ms = 1_500): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    await settle();
    const rooms = await hub.rooms();
    assert.equal(rooms.length, 1);
    // The portal carries an `m.bridge` event, so it is recognised by the same
    // rule every mautrix room is — no WeChat special case in the chat list.
    assert.equal(rooms[0].platform, "wechat");
    assert.equal(rooms[0].name, "A Friend");
    assert.equal(rooms[0].preview, "ping");
    assert.equal(rooms[0].unread, 1);
  });
});

test("a reply is delivered to the relay for the right conversation", async () => {
  await withBridge(async ({hub, relay}) => {
    relay.emit({messageId: "m1", chatId: "wxid_friend", body: "ping", timestamp: 1});
    await settle();
    const [room] = await hub.rooms();
    await hub.send(room.roomId, "pong");
    await settle();
    assert.deepEqual(relay.sent, [{chatId: "wxid_friend", message: "pong"}]);
  });
});

test("our own message coming back from WeChat is not posted twice", async () => {
  await withBridge(async ({hub, relay}) => {
    relay.emit({messageId: "m1", chatId: "wxid_friend", body: "ping", timestamp: 1});
    await settle();
    const [room] = await hub.rooms();
    await hub.send(room.roomId, "pong");
    await settle();
    // WeChat echoes everything the account sends, including through us.
    relay.emit({messageId: "m2", chatId: "wxid_friend", body: "pong", timestamp: 2, fromSelf: true});
    await settle();
    const {messages} = await hub.messages(room.roomId, 20);
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
    await settle();
    const [room] = await hub.rooms();
    const {messages} = await hub.messages(room.roomId, 5);
    assert.equal(messages[0].body, "[Sticker]");
  });
});

test("media that cannot be carried across says where it can be seen", async () => {
  await withBridge(async ({hub, relay}) => {
    // No id the message store knows, so extraction cannot succeed.
    relay.emit({messageId: "999999", chatId: "wxid_x", messageKind: "voice", hasMedia: true, timestamp: 1});
    relay.emit({messageId: "999998", chatId: "wxid_x", body: "just text", timestamp: 2});
    await settle(3_000);
    const [room] = await hub.rooms();
    const {messages} = await hub.messages(room.roomId, 10);
    const voice = messages.find((item) => item.body === "[Voice message]");
    const text = messages.find((item) => item.body === "just text");
    assert.deepEqual(voice?.viewIn, {app: "WeChat", url: "weixin://"});
    // An ordinary message has nothing to go and look at elsewhere.
    assert.equal(text?.viewIn, null);
  });
});

test("a relay that is not running leaves WeChat unlinked rather than failing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-wechat-"));
  const homeserver = new Homeserver({
    serverName: "flareai.local",
    dataDirectory: directory,
    port: (nextPort += 1),
  });
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
