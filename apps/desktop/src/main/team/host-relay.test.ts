import assert from "node:assert/strict";
import {createServer} from "node:http";
import test from "node:test";
import {WebSocketServer} from "ws";
import {
  HOST_RELAY_PROTOCOL_VERSION,
  type HostRelayRequest,
  type HostRelayResponse,
} from "@polymux/protocol";
import {TeamHostRelay} from "./host-relay.js";

test("Host relay authenticates outbound and forwards to the loopback server", async () => {
  const local = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      response.writeHead(200, {"content-type": "application/json"});
      response.end(JSON.stringify({
        path: request.url,
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      }));
    });
  });
  await listen(local);
  const localAddress = local.address();
  if (!localAddress || typeof localAddress === "string") throw new Error("Local Host did not listen");

  const websocket = new WebSocketServer({port: 0});
  await new Promise<void>((resolve) => websocket.once("listening", resolve));
  const relayAddress = websocket.address();
  if (typeof relayAddress === "string") throw new Error("Relay did not listen");

  let resolveRegistration!: (value: unknown) => void;
  const registration = new Promise<unknown>((resolve) => { resolveRegistration = resolve; });
  const publicRelay = createServer((request, response) => {
    if (request.url === "/connect-config") {
      response.writeHead(200, {"content-type": "application/json"});
      response.end(JSON.stringify({
        version: HOST_RELAY_PROTOCOL_VERSION,
        webSocketOrigin: `http://127.0.0.1:${relayAddress.port}`,
      }));
      return;
    }
    assert.equal(request.url, "/relay/86c92dd5-5042-4aa4-a33f-b656bf641e28/connect-code");
    assert.equal(request.method, "PUT");
    assert.equal(request.headers.authorization, "Bearer test-relay-secret-that-is-at-least-thirty-two-characters");
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      resolveRegistration(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(204);
      response.end();
    });
  });
  await listen(publicRelay);
  const publicRelayAddress = publicRelay.address();
  if (!publicRelayAddress || typeof publicRelayAddress === "string")
    throw new Error("Public relay did not listen");

  const result = new Promise<HostRelayResponse>((resolve, reject) => {
    websocket.once("connection", (socket, request) => {
      try {
        assert.equal(request.headers.authorization, "Bearer test-relay-secret-that-is-at-least-thirty-two-characters");
        assert.equal(request.headers["x-polymux-register"], "1");
      } catch (error) {
        reject(error);
        return;
      }
      const relayed: HostRelayRequest = {
        type: "request",
        version: HOST_RELAY_PROTOCOL_VERSION,
        id: "relay-test-request",
        method: "POST",
        path: "/polymux-host/v1/rpc",
        headers: {authorization: "Bearer paired-client", "content-type": "application/json"},
        bodyBase64: Buffer.from(JSON.stringify({method: "team.list", args: []})).toString("base64"),
      };
      socket.once("message", (message) => resolve(JSON.parse(message.toString()) as HostRelayResponse));
      socket.send(JSON.stringify(relayed));
    });
  });

  const relay = new TeamHostRelay({
    relayOrigin: `http://127.0.0.1:${publicRelayAddress.port}`,
    hostId: "86c92dd5-5042-4aa4-a33f-b656bf641e28",
    hostSecret: "test-relay-secret-that-is-at-least-thirty-two-characters",
    localEndpoint: `http://127.0.0.1:${localAddress.port}`,
  });
  try {
    await relay.start();
    assert.equal(await relay.updateConnectCode("318204771", Date.now() + 5 * 60_000), true);
    const registered = await registration as {code: string; expiresAt: number};
    assert.equal(registered.code, "318204771");
    assert.ok(registered.expiresAt > Date.now());
    const response = await result;
    assert.equal(response.type, "response");
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(Buffer.from(response.bodyBase64, "base64").toString("utf8")), {
      path: "/polymux-host/v1/rpc",
      authorization: "Bearer paired-client",
      body: {method: "team.list", args: []},
    });
    assert.match(relay.publicEndpoint, new RegExp(`^http://127\\.0\\.0\\.1:${publicRelayAddress.port}/h/`));
  } finally {
    await relay.close();
    await Promise.all([
      new Promise<void>((resolve) => local.close(() => resolve())),
      new Promise<void>((resolve) => publicRelay.close(() => resolve())),
      new Promise<void>((resolve) => websocket.close(() => resolve())),
    ]);
  }
});

test("Host relay refuses a redirected socket discovery document", async () => {
  let redirectedRequests = 0;
  const redirected = createServer((_request, response) => {
    redirectedRequests += 1;
    response.writeHead(200, {"content-type": "application/json"});
    response.end(JSON.stringify({
      version: HOST_RELAY_PROTOCOL_VERSION,
      webSocketOrigin: "https://attacker.example",
    }));
  });
  await listen(redirected);
  const redirectedAddress = redirected.address();
  if (!redirectedAddress || typeof redirectedAddress === "string")
    throw new Error("Redirect target did not listen");

  const publicRelay = createServer((_request, response) => {
    response.writeHead(302, {
      location: `http://127.0.0.1:${redirectedAddress.port}/connect-config`,
    });
    response.end();
  });
  await listen(publicRelay);
  const publicRelayAddress = publicRelay.address();
  if (!publicRelayAddress || typeof publicRelayAddress === "string")
    throw new Error("Public relay did not listen");

  const relay = new TeamHostRelay({
    relayOrigin: `http://127.0.0.1:${publicRelayAddress.port}`,
    hostId: "86c92dd5-5042-4aa4-a33f-b656bf641e28",
    hostSecret: "test-relay-secret-that-is-at-least-thirty-two-characters",
    localEndpoint: "http://127.0.0.1:1",
  });
  try {
    await assert.rejects(relay.start(), /fetch failed|redirect/i);
    assert.equal(redirectedRequests, 0);
  } finally {
    await relay.close();
    await Promise.all([
      new Promise<void>((resolve) => publicRelay.close(() => resolve())),
      new Promise<void>((resolve) => redirected.close(() => resolve())),
    ]);
  }
});

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}
