import assert from "node:assert/strict";
import {createServer, type Server} from "node:http";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import type {Credential, CredentialStore} from "@earendil-works/pi-ai";
import {Communications} from "./index.js";
import {Homeserver} from "@flareai/hub";

/**
 * The tier-3 loop, end to end: FlareAI's comms service running against the
 * in-process homeserver, with a fake mautrix bridge on the far side. No
 * Synapse, no Docker, no account for the user to create.
 */

function memoryCredentials(): CredentialStore {
  const store = new Map<string, Credential>();
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

test("a message landing is announced as it happens, not when next asked for", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-activity-"));
  const seen: Array<{roomId: string; sender: string; senderName: string | null; type: string; ts: number}> =
    [];
  const hs = new Homeserver({
    serverName: "flareai.local",
    dataDirectory: directory,
    onActivity: (activity) => seen.push(activity),
  });
  await hs.start();
  try {
    const user = hs.createLocalUser("flareai");
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

test("zero-config connect and a full message round-trip on the embedded hub", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-embedded-"));
  const bridge = await startFakeBridge();
  const hs = new Homeserver({serverName: "flareai.local", dataDirectory: directory});
  await hs.start();
  const asToken = "as-embedded";
  hs.registerAppservice({
    id: "whatsapp",
    asToken,
    hsToken: "hs-embedded",
    url: bridge.base,
    senderLocalpart: "whatsappbot",
    userNamespaces: ["@whatsapp_.*:flareai\\.local"],
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
    assert.match(connected.hub.userId ?? "", /^@flareai-[0-9a-f]{8}:flareai\.local$/);
    assert.equal(connected.hub.baseUrl, hs.baseUrl);

    // A bridge creates a portal and speaks; the user sees it with no daemon.
    const userId = connected.hub.userId!;
    const created = await fetch(`${hs.baseUrl}/_matrix/client/v3/createRoom?user_id=${encodeURIComponent("@whatsapp_1:flareai.local")}`, {
      method: "POST",
      headers: {Authorization: `Bearer ${asToken}`, "Content-Type": "application/json"},
      body: JSON.stringify({name: "Jules Tan (WA)", invite: [userId]}),
    });
    const {room_id} = (await created.json()) as {room_id: string};
    await fetch(
      `${hs.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(room_id)}/send/m.room.message/t1?user_id=${encodeURIComponent("@whatsapp_1:flareai.local")}`,
      {
        method: "PUT",
        headers: {Authorization: `Bearer ${asToken}`, "Content-Type": "application/json"},
        body: JSON.stringify({msgtype: "m.text", body: "are we still on?"}),
      },
    );

    const chats = await comms.chats();
    assert.equal(chats.length, 1);
    assert.equal(chats[0].name, "Jules Tan (WA)");
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

test("an explicit external address turns embedded mode off", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-embedded-"));
  const hs = new Homeserver({serverName: "flareai.local", dataDirectory: directory});
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
    assert.equal(status.hub.status, "unreachable");
  } finally {
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("a stored external address is the only thing that disables embedded mode", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-embedded-"));
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
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-embedded-"));
  const hs = new Homeserver({serverName: "flareai.local", dataDirectory: directory});
  await hs.start();
  const pushes: string[] = [];
  let whatsappRunning = false;
  const comms = new Communications({
    credentials: memoryCredentials(),
    storage: memoryPreferences(),
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
    await comms.status();
    assert.equal(pushes.length, afterFirst, "an unchanged fleet must not be re-pushed");

    // Now it is up, and the tab never asked for it.
    whatsappRunning = true;
    const moved = await comms.status();
    assert.notEqual(moved.bridges.find((item) => item.platform === "whatsapp")?.state, "dormant");
    assert.equal(pushes.length, afterFirst + 1, "the change must reach open windows");
  } finally {
    await hs.close();
    await rm(directory, {recursive: true, force: true});
  }
});

/**
 * WeChat has no login to end — the account is whichever one WeChat.app holds —
 * so unlinking it means one thing: stop carrying that app's messages. The
 * choice has to survive a status read, which is the very thing that would
 * otherwise start the relay again a moment later.
 */
test("unlinking WeChat stops the relay and is remembered across status reads", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flareai-wechat-"));
  const hs = new Homeserver({serverName: "flareai.local", dataDirectory: directory});
  await hs.start();
  const calls: string[] = [];
  const comms = new Communications({
    credentials: memoryCredentials(),
    storage: memoryPreferences(),
    onChange: () => {},
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
