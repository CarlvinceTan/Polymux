import {createServer, type Server} from "node:http";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {Homeserver, type HomeserverOptions} from "../src/server.js";

/**
 * Shared scaffolding for the homeserver suites.
 *
 * The conformance tests beside this file are ported from what Matrix's own
 * Complement suite asserts about a homeserver — the suite every server the
 * bridges are actually tested against is graded on. They are written against
 * this server's real HTTP surface rather than its internals for the same
 * reason Complement is: a bridge only ever sees the HTTP, so that is the only
 * thing worth pinning. The assertions are re-derived from the specification;
 * no Complement code is copied.
 */

export interface FakeBridge {
  base: string;
  /** Every appservice transaction the homeserver pushed, in order. */
  transactions: Array<{txnId: string; auth: string | null; events: Array<Record<string, unknown>>}>;
  pings: Array<Record<string, unknown>>;
  /** Bodies of every message event delivered, which is what a bridge would send on. */
  delivered: () => string[];
  close: () => Promise<void>;
}

/** A stand-in for a mautrix bridge's appservice listener. */
export async function startFakeBridge(): Promise<FakeBridge> {
  const state: Pick<FakeBridge, "transactions" | "pings"> = {transactions: [], pings: []};
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const raw = Buffer.concat(chunks).toString("utf8");
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const txnMatch = url.pathname.match(/^\/_matrix\/app\/v1\/transactions\/(.+)$/);
      if (txnMatch)
        state.transactions.push({
          txnId: decodeURIComponent(txnMatch[1]),
          auth: request.headers.authorization ?? null,
          events: (parsed.events ?? []) as Array<Record<string, unknown>>,
        });
      if (/\/ping$/.test(url.pathname)) state.pings.push(parsed);
      response.writeHead(200, {"Content-Type": "application/json"});
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as {port: number}).port;
  return {
    base: `http://127.0.0.1:${port}`,
    ...state,
    delivered: () =>
      state.transactions
        .flatMap((txn) => txn.events)
        .map((event) => (event.content as {body?: string} | undefined)?.body ?? "")
        .filter(Boolean),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export interface Harness {
  hs: Homeserver;
  bridge: FakeBridge;
  /** The appservice token, i.e. how a bridge authenticates. */
  asToken: string;
  /** A local human account with its own client token, i.e. how Polymux does. */
  user: {userId: string; accessToken: string};
  directory: string;
  cleanup: () => Promise<void>;
}

/**
 * A running homeserver with one registered bridge and one signed-in user —
 * the shape every test here needs before it can assert anything.
 */
export async function startHarness(
  options: Partial<HomeserverOptions> & {serverName?: string} = {},
): Promise<Harness> {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-hs-"));
  const bridge = await startFakeBridge();
  const hs = new Homeserver({
    serverName: options.serverName ?? "polymux.test",
    dataDirectory: directory,
    ...options,
  });
  await hs.start();
  const asToken = "as-token-test";
  hs.registerAppservice({
    id: "whatsapp",
    asToken,
    hsToken: "hs-token-test",
    url: bridge.base,
    senderLocalpart: "whatsappbot",
    userNamespaces: [`@whatsapp_.*:${(options.serverName ?? "polymux.test").replace(/\./g, "\\.")}`],
  });
  const user = hs.createLocalUser("polymux");
  return {
    hs,
    bridge,
    asToken,
    user,
    directory,
    cleanup: async () => {
      await hs.close();
      await bridge.close();
      await rm(directory, {recursive: true, force: true});
    },
  };
}

export interface Response {
  status: number;
  body: Record<string, unknown>;
}

/** One client-server request. `query.user_id` is how an appservice masquerades. */
export async function call(
  hs: Homeserver,
  method: string,
  endpoint: string,
  options: {token?: string; body?: unknown; query?: Record<string, string>} = {},
): Promise<Response> {
  const url = new URL(`${hs.baseUrl}${endpoint}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: {
      ...(options.token ? {Authorization: `Bearer ${options.token}`} : {}),
      ...(options.body === undefined ? {} : {"Content-Type": "application/json"}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

/** Creates a room and returns its id, failing loudly rather than returning undefined. */
export async function createRoom(
  hs: Homeserver,
  token: string,
  body: Record<string, unknown> = {},
  query: Record<string, string> = {},
): Promise<string> {
  const created = await call(hs, "POST", "/_matrix/client/v3/createRoom", {token, body, query});
  const roomId = created.body.room_id;
  if (created.status !== 200 || typeof roomId !== "string")
    throw new Error(`createRoom failed: ${created.status} ${JSON.stringify(created.body)}`);
  return roomId;
}

let txnCounter = 0;

/** Sends a message, returning the event id. Each call gets its own transaction id. */
export async function sendMessage(
  hs: Homeserver,
  token: string,
  roomId: string,
  content: Record<string, unknown>,
  query: Record<string, string> = {},
): Promise<string> {
  txnCounter += 1;
  const sent = await call(
    hs,
    "PUT",
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/txn-${txnCounter}`,
    {token, body: content, query},
  );
  const eventId = sent.body.event_id;
  if (sent.status !== 200 || typeof eventId !== "string")
    throw new Error(`send failed: ${sent.status} ${JSON.stringify(sent.body)}`);
  return eventId;
}

/** Polls until a condition holds, so a test never races the push loop. */
export async function until(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
