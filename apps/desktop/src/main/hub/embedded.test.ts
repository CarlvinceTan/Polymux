import assert from "node:assert/strict";
import {createServer, type Server} from "node:http";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import type {Credential, CredentialStore} from "@earendil-works/pi-ai";
import type {CommsBridgeDto} from "@polymux/protocol";
import {bridgeStatusFingerprint, Communications} from "./index.js";
import {Homeserver} from "@polymux/hub";

/**
 * The tier-3 loop, end to end: Polymux's comms service running against the
 * in-process homeserver, with a fake mautrix bridge on the far side. No
 * Synapse, no Docker, no account for the user to create.
 */

function memoryCredentials(initial: Record<string, Credential> = {}): CredentialStore {
  const store = new Map<string, Credential>(Object.entries(initial));
  return {
    read: async (id) => store.get(id),
    list: async () =>
      [...store.entries()].map(([providerId, credential]) => ({providerId, type: credential.type})),
    modify: async (id, fn) => {
      const next = await fn(store.get(id));
      if (next !== undefined) store.set(id, next);
      return next ?? store.get(id);
    },
    delete: async (id) => {
      store.delete(id);
    },
  };
}

test("concurrent embedded startup reads wait for one authenticated Hub", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-concurrent-auth-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const stored = memoryCredentials();
  let releaseRead!: () => void;
  let announceRead!: () => void;
  const readReleased = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const readStarted = new Promise<void>((resolve) => {
    announceRead = resolve;
  });
  let provisions = 0;
  const credentials: CredentialStore = {
    read: async (id) => {
      announceRead();
      await readReleased;
      return stored.read(id);
    },
    list: () => stored.list(),
    modify: (id, modify) => stored.modify(id, modify),
    delete: (id) => stored.delete(id),
  };
  const comms = new Communications({
    credentials,
    storage: memoryPreferences(),
    onChange: () => {},
    embedded: {
      baseUrl: hs.baseUrl,
      directory,
      provision: (localpart) => {
        provisions += 1;
        return hs.createLocalUser(localpart);
      },
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });

  try {
    const first = comms.chats();
    await readStarted;
    const second = comms.chats();
    releaseRead();
    assert.deepEqual(await Promise.all([first, second]), [[], []]);
    assert.equal(provisions, 1);
  } finally {
    comms.close();
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("a stale disposable embedded token is replaced on the first read", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-stale-embedded-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const credentials = memoryCredentials({
    "matrix-hub": {
      type: "api_key",
      key: "stale-token",
      env: {MATRIX_USER_ID: "@polymux-stale:polymux.local"},
    },
  });
  const comms = new Communications({
    credentials,
    storage: memoryPreferences(),
    onChange: () => {},
    embedded: {
      baseUrl: hs.baseUrl,
      directory,
      provision: (localpart) => hs.createLocalUser(localpart),
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });

  try {
    assert.deepEqual(await comms.chats(), []);
    const replacement = await credentials.read("matrix-hub");
    assert.equal(replacement?.type, "api_key");
    assert.notEqual(replacement?.type === "api_key" ? replacement.key : null, "stale-token");
    assert.match(
      replacement?.type === "api_key" ? String(replacement.env?.MATRIX_USER_ID) : "",
      /^@polymux-[0-9a-f]{8}:polymux\.local$/,
    );
  } finally {
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

function memoryPreferences() {
  const values = new Map<string, unknown>();
  return {
    getPreference: (key: string) => (values.has(key) ? {value: values.get(key)} : undefined),
    setPreference: (key: string, value: unknown) => values.set(key, value),
  };
}

async function startFakeBridge(): Promise<{
  base: string;
  transactions: Array<{events: Array<Record<string, unknown>>}>;
  close: () => Promise<void>;
}> {
  const transactions: Array<{events: Array<Record<string, unknown>>}> = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      if (request.method === "PUT" && request.url?.includes("/transactions/"))
        transactions.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(200, {"Content-Type": "application/json"});
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as {port: number}).port;
  return {
    base: `http://127.0.0.1:${port}`,
    transactions,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test("login waits for an on-demand bridge before requesting its first step", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-login-ready-"));
  const bridge = await new Promise<{base: string; close: () => Promise<void>}>((resolve) => {
    const server = createServer((request, response) => {
      response.writeHead(200, {"Content-Type": "application/json"});
      if (request.url?.includes("/login/start/instagram")) {
        response.end(JSON.stringify({
          login_id: "instagram-login",
          type: "cookies",
          step_id: "cookies",
          cookies: {
            url: "https://www.instagram.com/accounts/login/",
            fields: [],
          },
        }));
      } else {
        response.end(JSON.stringify({
          logins: [],
          flows: [{id: "instagram", name: "instagram.com"}],
        }));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as {port: number}).port;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  let ensures = 0;
  const comms = new Communications({
    credentials: memoryCredentials(),
    storage: memoryPreferences(),
    onChange: () => {},
    embedded: {
      baseUrl: hs.baseUrl,
      directory,
      provision: (localpart) => hs.createLocalUser(localpart),
      ensure: async (platform) => {
        ensures += 1;
        assert.equal(platform, "instagram");
        hs.setProvisioningTarget("instagram", bridge.base);
      },
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });

  try {
    const step = await comms.loginStart("instagram", "instagram");
    assert.equal(ensures, 1);
    assert.equal(step.type, "cookies");
    if (step.type === "cookies")
      assert.equal(step.url, "https://www.instagram.com/accounts/login/");
  } finally {
    comms.close();
    await hs.close();
    await bridge.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("a message landing is announced as it happens, not when next asked for", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-activity-"));
  const seen: Array<{roomId: string; sender: string; senderName: string | null; type: string; ts: number}> =
    [];
  const hs = new Homeserver({
    serverName: "polymux.local",
    dataDirectory: directory,
    onActivity: (activity) => seen.push(activity),
  });
  await hs.start();
  try {
    const user = hs.createLocalUser("polymux");
    const created = await fetch(`${hs.baseUrl}/_matrix/client/v3/createRoom`, {
      method: "POST",
      headers: {Authorization: `Bearer ${user.accessToken}`, "Content-Type": "application/json"},
      body: JSON.stringify({name: "A room"}),
    });
    const {room_id: roomId} = (await created.json()) as {room_id: string};
    await fetch(
      `${hs.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/t1`,
      {
        method: "PUT",
        headers: {Authorization: `Bearer ${user.accessToken}`, "Content-Type": "application/json"},
        body: JSON.stringify({msgtype: "m.text", body: "hello"}),
      },
    );

    // Only conversation traffic: creating the room wrote a pile of state, and
    // a view woken for each of those would be woken for nothing.
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.roomId, roomId);
    assert.equal(seen[0]?.sender, user.userId);
    assert.equal(seen[0]?.type, "m.room.message");
    // The timestamp is what tells a live message from history a bridge is
    // backfilling, so it has to arrive with one.
    assert.ok(typeof seen[0]?.ts === "number" && seen[0].ts > 0);
  } finally {
    await hs.close();
  }
});

test("Communications follows sync and announces a changed room without polling", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-sync-follower-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const activity: Array<{roomId: string; sender: string}> = [];
  const credentials = memoryCredentials();
  const comms = new Communications({
    credentials,
    storage: memoryPreferences(),
    onChange: () => {},
    onActivity: (event) => activity.push(event),
    embedded: {
      baseUrl: hs.baseUrl,
      directory,
      provision: (localpart) => hs.createLocalUser(localpart),
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });

  try {
    await comms.status();
    // Let the zero-timeout initial sync establish the token before the event.
    await new Promise((resolve) => setTimeout(resolve, 25));
    const credential = await credentials.read("matrix-hub");
    assert.equal(credential?.type, "api_key");
    const created = await fetch(`${hs.baseUrl}/_matrix/client/v3/createRoom`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential?.type === "api_key" ? credential.key : ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({name: "Live room"}),
    });
    const roomId = ((await created.json()) as {room_id: string}).room_id;
    for (let attempt = 0; attempt < 100 && activity.length === 0; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(activity, [{roomId, sender: credential!.env!.MATRIX_USER_ID as string}]);
  } finally {
    comms.close();
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("zero-config connect and a full message round-trip on the embedded hub", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-embedded-"));
  const bridge = await startFakeBridge();
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const asToken = "as-embedded";
  hs.registerAppservice({
    id: "whatsapp",
    asToken,
    hsToken: "hs-embedded",
    url: bridge.base,
    senderLocalpart: "whatsappbot",
    userNamespaces: ["@whatsapp_.*:polymux\\.local"],
  });

  const comms = new Communications({
    credentials: memoryCredentials(),
    storage: memoryPreferences(),
    onChange: () => {},
    embedded: {
      baseUrl: hs.baseUrl,
      directory,
      provision: (localpart) => hs.createLocalUser(localpart),
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });

  try {
    // No setup call at all: the first status() arrives already signed in.
    const connected = await comms.status();
    assert.equal(connected.hub.status, "signed-in");
    assert.match(connected.hub.userId ?? "", /^@polymux-[0-9a-f]{8}:polymux\.local$/);
    assert.equal(connected.hub.baseUrl, hs.baseUrl);

    // A bridge creates a portal and speaks; the user sees it with no daemon.
    const userId = connected.hub.userId!;
    const created = await fetch(`${hs.baseUrl}/_matrix/client/v3/createRoom?user_id=${encodeURIComponent("@whatsapp_1:polymux.local")}`, {
      method: "POST",
      headers: {Authorization: `Bearer ${asToken}`, "Content-Type": "application/json"},
      body: JSON.stringify({name: "Jules Tan (WA)", invite: [userId]}),
    });
    const {room_id} = (await created.json()) as {room_id: string};
    await fetch(
      `${hs.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(room_id)}/send/m.room.message/t1?user_id=${encodeURIComponent("@whatsapp_1:polymux.local")}`,
      {
        method: "PUT",
        headers: {Authorization: `Bearer ${asToken}`, "Content-Type": "application/json"},
        body: JSON.stringify({msgtype: "m.text", body: "are we still on?"}),
      },
    );

    const chats = await comms.chats();
    assert.equal(chats.length, 1);
    assert.equal(chats[0].name, "Jules Tan");
    assert.equal(chats[0].platform, "whatsapp");

    const unread = await comms.unreadChats(10);
    assert.equal((unread as Array<{body: string}>)[0].body, "are we still on?");

    // The user's reply reaches the bridge as an appservice transaction.
    await comms.sendChat(room_id, "yes, 2pm");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (
        bridge.transactions.some((txn) =>
          txn.events.some((event) => (event.content as {body?: string})?.body === "yes, 2pm"),
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const delivered = bridge.transactions.some((txn) =>
      txn.events.some((event) => (event.content as {body?: string})?.body === "yes, 2pm"),
    );
    assert.equal(delivered, true, "the reply must be pushed to the bridge");

    // Reconnecting reuses the stored token rather than minting a new account.
    const again = await comms.connect();
    assert.equal(again.hub.userId, userId);
  } finally {
    await hs.close();
    await bridge.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("WeChat scrolling fills a native history gap before returning local cursors", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-history-gap-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const asToken = "as-wechat-history-gap";
  const sender = "@wechat_history:polymux.local";
  hs.registerAppservice({id: "wechat", asToken, hsToken: "hs-wechat-history-gap",
    url: "http://127.0.0.1:9", senderLocalpart: "wechatbot",
    userNamespaces: ["@wechat_.*:polymux\\.local"]});
  const call = async (endpoint: string, body: unknown, method = "PUT") => {
    const url = new URL(`/_matrix/client/v3/${endpoint}`, hs.baseUrl);
    url.searchParams.set("user_id", sender);
    const response = await fetch(url, {method,
      headers: {Authorization: `Bearer ${asToken}`, "Content-Type": "application/json"},
      body: JSON.stringify(body)});
    assert.equal(response.ok, true);
    return await response.json() as {room_id: string};
  };
  let roomId: string;
  const insert = async (timestamp: number) => {
    await call(`rooms/${encodeURIComponent(roomId)}/send/m.room.message/native-${timestamp}?ts=${timestamp * 1_000}`,
      {msgtype: "m.text", body: String(timestamp), "co.polymux.backfill": true});
  };
  const nativePages = [[95, 90], [85, 80], [75, 70], [10]];
  let cursor: number | undefined;
  let connected = false;
  let queries = 0;
  const comms = new Communications({
    credentials: memoryCredentials(), storage: memoryPreferences(), onChange: () => {},
    embedded: {
      baseUrl: hs.baseUrl, directory, provision: (localpart) => hs.createLocalUser(localpart),
      loadOlderWeChatHistory: async (chatId, _limit, through) => {
        assert.equal(chatId, roomId);
        if (!connected) throw new Error("Native history is disconnected");
        if (!nativePages.length || (cursor !== undefined && through !== undefined && cursor <= through))
          return false;
        queries += 1;
        assert.ok(queries <= 4, "history loading must make bounded progress");
        const batch = nativePages.shift()!;
        for (const timestamp of batch) await insert(timestamp);
        cursor = batch.at(-1)! * 1_000;
        return nativePages.length > 0;
      },
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });
  try {
    const status = await comms.status();
    roomId = (await call("createRoom", {name: "History", invite: [status.hub.userId]}, "POST")).room_id;
    await insert(10);
    await insert(100);
    assert.deepEqual((await comms.readChat(roomId, 2)).messages.map((row) => row.body), ["100", "10"],
      "cached messages remain readable while Desktop is disconnected");
    connected = true;
    const bodies: string[] = [];
    let before: string | undefined;
    for (let pageNumber = 0; pageNumber < 6; pageNumber += 1) {
      const page = await comms.readChat(roomId, 2, before);
      bodies.push(...page.messages.map((row) => row.body));
      if (!page.nextBefore) break;
      before = page.nextBefore;
    }
    assert.deepEqual(bodies, ["100", "95", "90", "85", "80", "75", "70", "10"]);
    assert.equal(queries, 4);
  } finally {
    comms.close();
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("the live-test recipient fence runs before readiness or Matrix mutation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-test-fence-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const asToken = "as-wechat-test-fence";
  hs.registerAppservice({
    id: "wechat",
    asToken,
    hsToken: "hs-wechat-test-fence",
    url: "http://127.0.0.1:9",
    senderLocalpart: "wechatbot",
    userNamespaces: [
      "@wechatbot:polymux\\.local",
      "@wechat_.*:polymux\\.local",
    ],
  });
  let destinationChecks = 0;
  let readinessChecks = 0;
  let recalls = 0;
  const comms = new Communications({
    credentials: memoryCredentials(),
    storage: memoryPreferences(),
    onChange: () => {},
    platform: "darwin",
    embedded: {
      baseUrl: hs.baseUrl,
      directory,
      provision: (localpart) => hs.createLocalUser(localpart),
      startWeChat: async () => true,
      assertWeChatLiveTestDestination: () => {
        destinationChecks += 1;
        throw new Error("live WeChat testing is restricted to filehelper");
      },
      weChatOutboundReady: async () => {
        readinessChecks += 1;
        return true;
      },
      weChatOutboundStatus: async () => true,
      weChatStickers: async () => [],
      recallWeChat: async () => {
        recalls += 1;
      },
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });

  try {
    const status = await comms.status();
    const userId = status.hub.userId!;
    const created = await fetch(
      `${hs.baseUrl}/_matrix/client/v3/createRoom?user_id=${encodeURIComponent("@wechat_not_filehelper:polymux.local")}`,
      {
        method: "POST",
        headers: {Authorization: `Bearer ${asToken}`, "Content-Type": "application/json"},
        body: JSON.stringify({name: "Not File Transfer", invite: [userId]}),
      },
    );
    const {room_id} = (await created.json()) as {room_id: string};
    const restricted = /live WeChat testing is restricted to filehelper/;
    await assert.rejects(comms.sendChat(room_id, "must not enqueue"), restricted);
    await assert.rejects(
      comms.sendChatFiles(room_id, [{
        name: "must-not-upload.txt",
        mimetype: "text/plain",
        bytes: new TextEncoder().encode("never leaves the UI"),
      }]),
      restricted,
    );
    await assert.rejects(comms.sendChatSticker(room_id, "not-a-sticker"), restricted);
    await assert.rejects(comms.sendChatFiles(room_id, [{
      name: "voice.wav", mimetype: "audio/wav", bytes: new Uint8Array([0]),
    }]), restricted);
    await assert.rejects(comms.recallChat(room_id, "$must-not-recall"), restricted);

    assert.equal(destinationChecks, 5);
    assert.equal(readinessChecks, 0, "the rejected recipient never wakes WeChat");
    assert.equal(recalls, 0);
    const page = await comms.readChat(room_id, 20);
    assert.equal(page.messages.length, 0, "no optimistic Matrix event is created");
  } finally {
    comms.close();
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("an unready WeChat relay rejects before creating a Matrix event",
  {skip: process.platform !== "darwin"}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-ready-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const asToken = "as-wechat-readiness";
  hs.registerAppservice({
    id: "wechat",
    asToken,
    hsToken: "hs-wechat-readiness",
    url: "http://127.0.0.1:9",
    senderLocalpart: "wechatbot",
    userNamespaces: [
      "@wechatbot:polymux\\.local",
      "@wechat_.*:polymux\\.local",
    ],
  });
  let readinessChecks = 0;
  let passiveChecks = 0;
  let recalls = 0;
  let nativeReads = 0;
  let session: "interactive_login" | "locked" = "interactive_login";
  let loginReads = 0;
  const comms = new Communications({
    credentials: memoryCredentials(),
    storage: memoryPreferences(),
    onChange: () => {},
    platform: "darwin",
    embedded: {
      baseUrl: hs.baseUrl,
      directory,
      provision: (localpart) => hs.createLocalUser(localpart),
      startWeChat: async () => true,
      weChatOutboundReady: async () => {
        readinessChecks += 1;
        return false;
      },
      weChatOutboundStatus: async () => {
        passiveChecks += 1;
        return false;
      },
      weChatSessionState: async () => session,
      weChatLogin: async () => {
        loginReads += 1;
        return {state: session, qrDataUrl: "fixture-only-qr", expiresAt: Date.now() + 10_000, optionsReady: true};
      },
      recallWeChat: async () => {
        recalls += 1;
      },
      markWeChatRead: async () => {
        nativeReads += 1;
        throw new Error("WeChat still reports unread messages");
      },
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });

  try {
    const status = await comms.status();
    assert.equal(readinessChecks, 0, "ordinary status does not wake WeChat");
    assert.equal(status.bridges.find(bridge => bridge.platform === "wechat")?.attention?.title,
      "Sign in to WeChat Desktop");
    assert.equal(loginReads, 0, "passive status never captures or changes the login surface");
    assert.equal((await comms.weChatLogin()).qrDataUrl, "fixture-only-qr");
    assert.equal(loginReads, 1);
    assert.equal(JSON.stringify(await comms.status()).includes("fixture-only-qr"), false,
      "QR data is not part of saved status snapshots");
    assert.ok(passiveChecks >= 1);
    const wake = await comms.wake("wechat");
    assert.equal(wake.platform, "wechat");
    assert.equal(wake.ready, false);
    assert.equal(
      wake.status.bridges.find((bridge) => bridge.platform === "wechat")?.error,
      null,
    );
    assert.equal(readinessChecks, 1, "explicit platform use wakes WeChat");
    const userId = status.hub.userId!;
    const created = await fetch(
      `${hs.baseUrl}/_matrix/client/v3/createRoom?user_id=${encodeURIComponent("@wechat_filehelper:polymux.local")}`,
      {
        method: "POST",
        headers: {Authorization: `Bearer ${asToken}`, "Content-Type": "application/json"},
        body: JSON.stringify({name: "File Transfer", invite: [userId]}),
      },
    );
    const {room_id} = (await created.json()) as {room_id: string};
    await assert.rejects(
      comms.sendChat(room_id, "must stay in the composer"),
      /Sign in to WeChat Desktop/,
    );
    const page = await comms.readChat(room_id, 20);
    assert.equal(
      page.messages.some((message) => message.body === "must stay in the composer"),
      false,
    );
    assert.equal(readinessChecks, 2, "the send rechecks exact readiness");
    await assert.rejects(
      comms.recallChat(room_id, "$must-not-recall"),
      /Sign in to WeChat Desktop/,
    );
    assert.equal(readinessChecks, 3, "recall performs the same hidden readiness gate");
    assert.equal(recalls, 0, "an unready desktop is never handed a recall operation");
    session = "locked";
    await assert.rejects(comms.sendChat(room_id, "wait for unlock"), /Unlock your Mac/);
    assert.equal(readinessChecks, 3, "a locked Mac is not asked to prepare its native sender");
    await assert.rejects(comms.markChatRead(room_id, "$native-marker"), /still reports unread/);
    assert.equal(nativeReads, 1, "WeChat read acknowledgements go through its native bridge");
  } finally {
    comms.close();
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("a ready WeChat wake does not wait for a second fleet status pass", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-fast-wake-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  let holdPassiveStatus = false;
  let releasePassiveStatus!: () => void;
  const passiveStatusGate = new Promise<void>((resolve) => {
    releasePassiveStatus = resolve;
  });
  const comms = new Communications({
    credentials: memoryCredentials(),
    storage: memoryPreferences(),
    onChange: () => {},
    platform: "darwin",
    embedded: {
      baseUrl: hs.baseUrl,
      directory,
      provision: (localpart) => hs.createLocalUser(localpart),
      startWeChat: async () => true,
      weChatOutboundReady: async () => true,
      weChatOutboundStatus: async () => {
        if (holdPassiveStatus) await passiveStatusGate;
        return true;
      },
      weChatSessionState: async () => "signed_in",
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });

  try {
    await comms.status();
    holdPassiveStatus = true;
    const wake = await Promise.race([
      comms.wake("wechat"),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100)),
    ]);
    assert.notEqual(wake, "blocked", "the composer must not wait for status polling");
    if (wake === "blocked") return;
    assert.equal(wake.ready, true);
    assert.equal(
      wake.status.bridges.find((bridge) => bridge.platform === "wechat")?.state,
      "connected",
    );
  } finally {
    releasePassiveStatus();
    comms.close();
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("an explicit external address turns embedded mode off", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-embedded-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const comms = new Communications({
    credentials: memoryCredentials(),
    storage: memoryPreferences(),
    onChange: () => {},
    embedded: {baseUrl: hs.baseUrl, directory, provision: (localpart) => hs.createLocalUser(localpart)},
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });
  try {
    const status = await comms.setHubUrl("http://127.0.0.1:9");
    assert.equal(status.hub.baseUrl, "http://127.0.0.1:9");
    assert.equal(status.hub.homeserverUrl, "http://127.0.0.1:9");
    assert.equal(status.hub.status, "unreachable");

    const moved = await comms.setHubUrl("http://127.0.0.1:10");
    assert.equal(moved.hub.baseUrl, "http://127.0.0.1:10");
    assert.equal(moved.hub.homeserverUrl, "http://127.0.0.1:10");
  } finally {
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("a stored external address is the only thing that disables embedded mode", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-embedded-"));
  const storage = memoryPreferences();
  storage.setPreference("comms-hub", {baseUrl: "http://127.0.0.1:18080"});
  const comms = new Communications({
    credentials: memoryCredentials(),
    storage,
    onChange: () => {},
    embedded: {
      baseUrl: "http://127.0.0.1:47664",
      directory,
      provision: () => {
        throw new Error("external mode must never mint an embedded account");
      },
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });
  try {
    const status = await comms.status();
    // The configured deployment's address, not the embedded server.
    assert.equal(status.hub.baseUrl, "http://127.0.0.1:18080");
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

/**
 * A bridge can change state with nobody asking it to — the WeChat relay is
 * started by the status read itself, and a binary the host was holding back
 * can come up later. Every other push follows an action taken in the tab, so
 * without this a window already open keeps the fleet it happened to load with.
 */
test("a bridge that changes state on its own is pushed to open windows", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-embedded-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const pushes: string[] = [];
  let whatsappRunning = false;
  const preferences = memoryPreferences();
  // WeChat has its own native status route, independent of inventory(). Its
  // live account can appear between reads and legitimately publish a change.
  // This test owns only the fake WhatsApp bridge, so keep WeChat unlinked.
  preferences.setPreference("comms-wechat", {linked: false});
  const comms = new Communications({
    credentials: memoryCredentials(),
    storage: preferences,
    onChange: (status) => {
      const bridge = status.bridges.find((item) => item.platform === "whatsapp");
      if (bridge) pushes.push(bridge.state);
    },
    embedded: {
      baseUrl: hs.baseUrl,
      directory,
      provision: (localpart) => hs.createLocalUser(localpart),
      // Only WhatsApp moves; the rest are absent, so the fleet around it is
      // steady and any push has exactly one cause.
      inventory: async () => [
        {platform: "whatsapp", binary: "mautrix-whatsapp", installed: true, running: whatsappRunning},
      ],
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });

  try {
    const first = await comms.status();
    assert.equal(first.bridges.find((item) => item.platform === "whatsapp")?.state, "dormant");
    const afterFirst = pushes.length;

    // Read again with nothing changed: a status read is not itself news.
    const second = await comms.status();
    assert.deepEqual(second.bridges, first.bridges, "the fixture's bridge states must remain unchanged");
    assert.equal(pushes.length, afterFirst, "an unchanged fleet must not be re-pushed");

    // Now it is up, and the tab never asked for it.
    whatsappRunning = true;
    const moved = await comms.status();
    assert.notEqual(moved.bridges.find((item) => item.platform === "whatsapp")?.state, "dormant");
    assert.equal(pushes.length, afterFirst + 1, "the change must reach open windows");
  } finally {
    comms.close();
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("a bridge missing from the package has a platform-neutral message", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-missing-bridge-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const comms = new Communications({
    credentials: memoryCredentials(),
    storage: memoryPreferences(),
    onChange: () => {},
    embedded: {
      baseUrl: hs.baseUrl,
      directory,
      provision: (localpart) => hs.createLocalUser(localpart),
      inventory: async () => [
        {platform: "instagram", binary: "mautrix-instagram", installed: false},
      ],
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });

  try {
    const instagram = (await comms.status()).bridges.find(
      (bridge) => bridge.platform === "instagram",
    );
    assert.equal(instagram?.state, "unavailable");
    assert.equal(instagram?.error, "The Instagram bridge is not installed.");
    assert.doesNotMatch(instagram?.error ?? "", /Mac|Windows|mautrix/i);
  } finally {
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("Windows omits bridges that cannot run instead of offering a broken install", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-windows-bridges-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const comms = new Communications({
    credentials: memoryCredentials(),
    storage: memoryPreferences(),
    onChange: () => {},
    platform: "win32",
    embedded: {
      baseUrl: hs.baseUrl,
      directory,
      provision: (localpart) => hs.createLocalUser(localpart),
      inventory: async () => [
        {
          platform: "instagram",
          binary: "mautrix-instagram",
          supported: true,
          installed: true,
          running: false,
        },
        {platform: "signal", binary: "mautrix-signal", supported: false, installed: false},
        {platform: "imessage", binary: "mautrix-imessage", supported: false, installed: false},
      ],
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });

  try {
    const platforms = (await comms.status()).bridges.map((bridge) => bridge.platform);
    assert.ok(platforms.includes("instagram"));
    assert.ok(!platforms.includes("signal"));
    assert.ok(!platforms.includes("imessage"));
    assert.ok(!platforms.includes("wechat"));
  } finally {
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("Linux offers its native bridge fleet without Mac-only rows", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-linux-bridges-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const comms = new Communications({
    credentials: memoryCredentials(),
    storage: memoryPreferences(),
    onChange: () => {},
    platform: "linux",
    embedded: {
      baseUrl: hs.baseUrl,
      directory,
      provision: (localpart) => hs.createLocalUser(localpart),
      inventory: async () => [
        {
          platform: "instagram",
          binary: "mautrix-instagram",
          supported: true,
          installed: true,
          running: false,
        },
        {
          platform: "signal",
          binary: "mautrix-signal",
          supported: true,
          installed: true,
          running: false,
        },
        {platform: "imessage", binary: "mautrix-imessage", supported: false, installed: false},
      ],
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });

  try {
    const platforms = (await comms.status()).bridges.map((bridge) => bridge.platform);
    assert.ok(platforms.includes("instagram"));
    assert.ok(platforms.includes("signal"));
    assert.ok(!platforms.includes("imessage"));
    assert.ok(!platforms.includes("wechat"));
  } finally {
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("connected account replacement is a Hub-visible bridge change", () => {
  const bridge = (id: string, name: string, avatarUrl: string | null = null): CommsBridgeDto => ({
    platform: "whatsapp" as const,
    name: "WhatsApp",
    api: "bridgev2" as const,
    state: "connected" as const,
    accounts: [{id, name, avatarUrl, state: "connected" as const, error: null}],
    flows: [],
    setup: null,
    managementRoomHint: null,
    error: null,
  });
  const australia = bridge("61426982339", "Carlvince Tan");
  const singapore = bridge("6591222011", "+6591222011");
  assert.notEqual(bridgeStatusFingerprint(australia), bridgeStatusFingerprint(singapore));
  assert.notEqual(
    bridgeStatusFingerprint(australia),
    bridgeStatusFingerprint(bridge("61426982339", "Carlvince Tan", "polymux-media://local/me")),
  );
  assert.notEqual(
    bridgeStatusFingerprint(australia),
    bridgeStatusFingerprint({...australia, installUrl: "https://mac.weixin.qq.com/en"}),
    "an installer becoming available refreshes an open Hub pane",
  );
  assert.equal(bridgeStatusFingerprint(australia), bridgeStatusFingerprint(structuredClone(australia)));
});

/**
 * WeChat has no login to end — the account is whichever one WeChat.app holds —
 * so unlinking it means one thing: stop carrying that app's messages. The
 * choice has to survive a status read, which is the very thing that would
 * otherwise start the relay again a moment later.
 */
test("unlinking WeChat stops the relay and is remembered across status reads", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const calls: string[] = [];
  const comms = new Communications({
    credentials: memoryCredentials(),
    storage: memoryPreferences(),
    onChange: () => {},
    platform: "darwin",
    embedded: {
      baseUrl: hs.baseUrl,
      directory,
      provision: (localpart) => hs.createLocalUser(localpart),
      inventory: async () => [],
      startWeChat: async () => {
        calls.push("start");
        return false;
      },
      stopWeChat: async () => {
        calls.push("stop");
      },
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });

  try {
    await comms.status();
    assert.deepEqual(calls, ["start"], "reading the status is what brings the relay up");

    const unlinked = await comms.bridgeLogout("wechat", "wxid_test");
    const row = (status: typeof unlinked) =>
      status.bridges.find((item) => item.platform === "wechat")!;
    assert.deepEqual(calls, ["start", "stop"]);
    assert.equal(row(unlinked).state, "logged-out");
    assert.equal(row(unlinked).accounts.length, 0);
    assert.equal(row(unlinked).flows.length, 1, "an unlinked relay offers the way back in");

    // The read that follows must not undo the choice.
    const later = await comms.status();
    assert.equal(row(later).state, "logged-out");
    assert.deepEqual(calls, ["start", "stop"], "an unlinked relay is not started again");

    // Linking is one button: nothing to ask for, so it completes on the spot.
    const step = await comms.loginStart("wechat", "relay");
    assert.equal(step.type, "complete");
    assert.deepEqual(calls, ["start", "stop", "start"]);
    assert.notEqual(row(await comms.status()).state, "logged-out");
  } finally {
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("readable WeChat conversations stay connected when the sender is unavailable", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-readable-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  hs.createLocalUser("wechatbot");
  const asToken = "as-readable-wechat";
  hs.registerAppservice({id: "wechat", asToken, hsToken: "hs-readable-wechat",
    url: "http://127.0.0.1:9", senderLocalpart: "wechatbot",
    userNamespaces: ["@wechatbot:polymux\\.local", "@wechat_.*:polymux\\.local"]});
  let sends = 0;
  const comms = new Communications({
    credentials: memoryCredentials(), storage: memoryPreferences(), onChange: () => {},
    platform: "darwin",
    embedded: {
      baseUrl: hs.baseUrl, directory, provision: (name) => hs.createLocalUser(name),
      startWeChat: async () => true,
      weChatNativeReadable: () => true,
      weChatOutboundStatus: async () => false,
      weChatOutboundReady: async () => { sends++; return false; },
      weChatSessionState: async () => "signed_in",
    },
    emailStorePath: path.join(directory, "email-accounts.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  });
  try {
    const status = await comms.status();
    assert.equal(status.bridges.find(b => b.platform === "wechat")?.state, "connected");
    assert.equal(sends, 0, "reading status never prepares the sender");
    const created = await fetch(`${hs.baseUrl}/_matrix/client/v3/createRoom?user_id=${encodeURIComponent("@wechat_filehelper:polymux.local")}`, {
      method: "POST", headers: {Authorization: `Bearer ${asToken}`, "Content-Type": "application/json"},
      body: JSON.stringify({name: "File Transfer", invite: [status.hub.userId]}),
    });
    assert.equal(created.ok, true);
    const {room_id} = await created.json() as {room_id: string};
    assert.ok((await comms.chats()).some(room => room.roomId === room_id));
    await assert.rejects(comms.sendChat(room_id, "must not send"));
    assert.equal(sends, 1, "sending still checks its independent readiness gate");
    assert.equal((await comms.readChat(room_id, 20)).messages.length, 0);
  } finally {
    comms.close(); await hs.close(); await rm(directory, {recursive: true, force: true});
  }
});

test("background WeChat sync starts before Hub reads, retries without overlap, and stops on close", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-background-wechat-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const preferences = memoryPreferences();
  let calls = 0, active = 0, maximum = 0, wakes = 0;
  const comms = new Communications({
    credentials: memoryCredentials(), storage: preferences, onChange: () => {},
    embedded: {baseUrl: hs.baseUrl, directory, provision: name => hs.createLocalUser(name),
      startWeChat: async owner => {
        assert.match(owner, /^@polymux-/);
        calls++; active++; maximum = Math.max(maximum, active);
        await new Promise(resolve => setTimeout(resolve, 15));
        active--;
        if (calls === 1) throw new Error("access is not ready yet");
        return true;
      },
      weChatOutboundReady: async () => {wakes++; return true;},
    }, emailStorePath: path.join(directory, "email.json"),
  });
  try {
    comms.startBackgroundSync(10);
    comms.startBackgroundSync(10);
    for (let i = 0; i < 100 && calls < 3; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(calls >= 3, "recovery runs without a status/chats request");
    assert.equal(maximum, 1);
    assert.equal(wakes, 0, "passive ingestion never prepares a send");
    preferences.setPreference('comms-wechat', {linked: false});
    const unlinkedAt = calls;
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(calls, unlinkedAt, 'explicit unlink suspends background starts');
    preferences.setPreference('comms-wechat', {linked: true});
    for (let i = 0; i < 100 && calls === unlinkedAt; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(calls > unlinkedAt, 'relink resumes without opening Hub');
    await comms.close();
    const stoppedAt = calls;
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(calls, stoppedAt);
  } finally {await comms.close(); await hs.close(); await rm(directory, {recursive: true, force: true});}
});

test("reading Hub retries missing own voice, video, file and generic appmsg attachments", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-cache-refresh-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const asToken = "as-cache-refresh";
  hs.registerAppservice({id: "wechat", asToken, hsToken: "hs-cache-refresh",
    url: "http://127.0.0.1:9", senderLocalpart: "wechatbot",
    userNamespaces: ["@wechatbot:polymux\\.local", "@wechat_.*:polymux\\.local"]});
  const credentials = memoryCredentials();
  const refreshed: string[] = [];
  const comms = new Communications({credentials, storage: memoryPreferences(), onChange: () => {}, platform: "darwin",
    embedded: {baseUrl: hs.baseUrl, directory, provision: localpart => hs.createLocalUser(localpart),
      startWeChat: async () => true, refreshWeChatMedia: async (_room, ids) => {refreshed.push(...ids); return false;}},
    emailStorePath: path.join(directory, "email.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"})});
  try {
    const status = await comms.status();
    const created = await fetch(`${hs.baseUrl}/_matrix/client/v3/createRoom?user_id=${encodeURIComponent("@wechat_filehelper:polymux.local")}`,
      {method: "POST", headers: {Authorization: `Bearer ${asToken}`, "Content-Type": "application/json"},
        body: JSON.stringify({name: "File Transfer", invite: [status.hub.userId]})});
    const {room_id} = await created.json() as {room_id: string};
    const credential = await credentials.read("matrix-hub");
    assert.equal(credential?.type, "api_key");
    const expected: string[] = [];
    let sequence = 0;
    for (const content of [
      {msgtype: "m.audio", body: "[Voice]", "co.polymux.view_in": {app: "WeChat", url: "weixin://"}},
      {msgtype: "m.video", body: "[Video]", "co.polymux.view_in": {app: "WeChat", url: "weixin://"}},
      {msgtype: "m.file", body: "notes.txt", "co.polymux.view_in": {app: "WeChat", url: "weixin://"}},
      {msgtype: "m.image", body: "photo.jpg", url: "mxc://polymux.local/image"},
      {msgtype: "m.text", body: "clip.mp4", "co.polymux.view_in": {app: "WeChat", url: "weixin://"}},
      {msgtype: "m.file", body: "ready.txt", url: "mxc://polymux.local/ready"},
      {msgtype: "m.text", body: "already readable"},
    ]) {
      const response: Response = await fetch(`${hs.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(room_id)}/send/m.room.message/cache-${sequence++}`,
        {method: "PUT", headers: {Authorization: `Bearer ${credential?.type === "api_key" ? credential.key : ""}`, "Content-Type": "application/json"},
          body: JSON.stringify(content)});
      assert.equal(response.ok, true);
      const {event_id} = await response.json() as {event_id: string};
      if (sequence <= 5) expected.push(event_id);
    }
    const page = await comms.readChat(room_id, 20);
    assert.equal(page.messages.length, 7);
    assert.ok(page.messages.every(message => message.mine));
    assert.deepEqual([...new Set(refreshed)].sort(), expected.sort());
  } finally {await comms.close(); await hs.close(); await rm(directory, {recursive: true, force: true});}
});

test("unconfirmed WeChat delivery keeps its bubble and status across reload, while rejection removes it", async () => {
  const {WeChatDeliveryUnconfirmedError} = await import("@polymux/wechat");
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-delivery-state-"));
  const hs = new Homeserver({serverName: "polymux.local", dataDirectory: directory});
  await hs.start();
  const asToken = "as-delivery-state";
  hs.registerAppservice({id: "wechat", asToken, hsToken: "hs-delivery-state",
    url: "http://127.0.0.1:9", senderLocalpart: "wechatbot",
    userNamespaces: ["@wechatbot:polymux\\.local", "@wechat_.*:polymux\\.local"]});
  let reject = false, discarded = 0, sends = 0;
  const credentials = memoryCredentials(), storage = memoryPreferences();
  const options = {
    credentials, storage, onChange: () => {}, platform: "darwin" as const,
    embedded: {baseUrl: hs.baseUrl, directory, provision: (localpart: string) => hs.createLocalUser(localpart),
      startWeChat: async () => true, weChatOutboundReady: async () => true,
      waitForWeChatOutbound: async (id: string) => {
        sends++;
        if (reject) throw new Error("rejected before submission");
        hs.setOutboundDeliveryStatus(id, "unconfirmed");
        throw new WeChatDeliveryUnconfirmedError();
      },
      discardOutbound: (id: string) => {discarded++; hs.discardOutbound(id);},
      outboundDeliveryStatus: (id: string) => hs.outboundDeliveryStatus(id)},
    emailStorePath: path.join(directory, "email.json"),
    run: async () => ({code: 1, stdout: "", stderr: "not installed"}),
  };
  const comms = new Communications(options);
  let reopened: Communications | undefined;
  try {
    const status = await comms.status();
    const created = await fetch(`${hs.baseUrl}/_matrix/client/v3/createRoom?user_id=${encodeURIComponent("@wechat_filehelper:polymux.local")}`,
      {method: "POST", headers: {Authorization: `Bearer ${asToken}`, "Content-Type": "application/json"},
        body: JSON.stringify({name: "File Transfer", invite: [status.hub.userId]})});
    const {room_id} = await created.json() as {room_id: string};
    const id = await comms.sendChat(room_id, "uncertain delivery");
    assert.equal(comms.outboundDeliveryStatus(id), "unconfirmed");
    assert.equal(discarded, 0);
    const page = await comms.readChat(room_id, 20);
    const original = page.messages.find(message => message.eventId === id)!;
    assert.equal(original.deliveryStatus, "unconfirmed");
    const voice = {name: "voice.wav", mimetype: "audio/wav", bytes: new Uint8Array([1, 2, 3])};
    // This is the route used by Hub's recorder. An uncertain native result
    // resolves to the persisted bubble so the UI clears its submitted take.
    await comms.sendChatFiles(room_id, [voice]);
    const audio = (await comms.readChat(room_id, 20)).messages.find(message =>
      message.attachments.some(attachment => attachment.kind === "audio"))!;
    assert.ok(audio);
    assert.equal(audio.deliveryStatus, "unconfirmed");
    assert.equal(discarded, 0);
    comms.close();
    reopened = new Communications(options);
    assert.equal((await reopened.readChat(room_id, 20)).messages.find(message => message.eventId === id)?.deliveryStatus, "unconfirmed");
    const recoveredAudio = (await reopened.readChat(room_id, 20)).messages.filter(message => message.eventId === audio.eventId);
    assert.equal(recoveredAudio.length, 1);
    assert.equal(recoveredAudio[0].deliveryStatus, "unconfirmed");
    hs.setOutboundDeliveryStatus(id, null);
    const confirmed = (await reopened.readChat(room_id, 20)).messages.find(message => message.eventId === id)!;
    assert.equal(confirmed.deliveryStatus, undefined);
    assert.equal(confirmed.sentAt, original.sentAt);
    reject = true;
    await assert.rejects(reopened.sendChat(room_id, "definite rejection"), /rejected before submission/);
    assert.equal(discarded, 1);
    assert.equal((await reopened.readChat(room_id, 20)).messages.some(message => message.body === "definite rejection"), false);
    await assert.rejects(reopened.sendChatFiles(room_id, [{...voice, name: "rejected.wav"}]), /rejected before submission/);
    assert.equal(discarded, 2);
    const final = await reopened.readChat(room_id, 20);
    assert.equal(final.messages.filter(message => message.attachments.some(attachment => attachment.kind === "audio")).length, 1);
    assert.equal(sends, 4, "each submitted draft is dispatched exactly once");
  } finally {
    comms.close(); reopened?.close(); await hs.close(); await rm(directory, {recursive: true, force: true});
  }
});

test("background WeChat observer detects manual login without invoking login or sender helpers",
  {skip: process.platform !== "darwin"}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'polymux-manual-signin-'));
  const hs = new Homeserver({serverName: 'polymux.local', dataDirectory: directory});
  await hs.start();
  let state: 'interactive_login' | 'signed_in' = 'interactive_login';
  let readable = false, mutations = 0, reads = 0;
  let hold: Promise<void> | null = null;
  const comms = new Communications({
    credentials: memoryCredentials(), storage: memoryPreferences(), onChange: () => {}, platform: 'darwin',
    embedded: {baseUrl: hs.baseUrl, directory, provision: name => hs.createLocalUser(name),
      weChatNativeOnly: true,
      startWeChat: async () => {readable = state === 'signed_in'; return true;},
      weChatNativeReadable: () => readable,
      weChatSessionState: async () => {reads++; await hold; return state;},
      weChatOutboundStatus: async () => false,
      weChatOutboundReady: async () => {mutations++; return false;},
      weChatLogin: async () => {mutations++; throw new Error('must not automate login');},
    },
    emailStorePath: path.join(directory, 'email.json'),
    run: async () => ({code: 1, stdout: '', stderr: 'not installed'}),
  });
  try {
    await comms.status();
    await comms.pollWeChat();
    assert.equal((await comms.status()).bridges.find(row => row.platform === 'wechat')?.attention?.title, 'Sign in to WeChat Desktop');
    let release!: () => void;
    hold = new Promise<void>(resolve => {release = resolve;});
    const before = reads;
    const first = comms.pollWeChat(), second = comms.pollWeChat();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(reads, before + 1, 'concurrent polls share one observation');
    state = 'signed_in';
    hold = null;
    release();
    await Promise.all([first, second]);
    assert.equal(readable, true);
    assert.equal((await comms.status()).bridges.find(row => row.platform === 'wechat')?.attention, null);
    assert.equal(mutations, 0);
  } finally {comms.close(); await hs.close(); await rm(directory, {recursive: true, force: true});}
});
