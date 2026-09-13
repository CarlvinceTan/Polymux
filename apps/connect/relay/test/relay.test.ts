import {env, exports} from "cloudflare:workers";
import {describe, expect, it} from "vitest";
import {
  HOST_RELAY_PROTOCOL_VERSION,
  isHostRelayRequest,
  type HostRelayResponse,
} from "@polymux/protocol";

describe("Polymux Connect", () => {
  it("reports service health", async () => {
    const response = await exports.default.fetch("https://connect.polymux.com/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ok: true, service: "polymux-connect", protocol: 1});
  });

  it("discovers the direct Worker socket origin behind the Polymux HTTP domain", async () => {
    const response = await exports.default.fetch("https://polymux-connect.example.workers.dev/connect-config");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      version: HOST_RELAY_PROTOCOL_VERSION,
      webSocketOrigin: "https://polymux-connect.example.workers.dev",
    });
  });

  it("returns offline without exposing whether a Host is registered", async () => {
    const response = await exports.default.fetch(
      "https://connect.polymux.com/h/4a783f28-77f5-4ca3-a912-2bf81a736643/polymux-host/v1/health",
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error: "This Polymux Host is offline."});
  });

  it("authenticates the Host and relays a complete HTTP request", async () => {
    const hostId = "86c92dd5-5042-4aa4-a33f-b656bf641e28";
    const secret = "relay-secret-that-is-long-enough-for-authentication";
    const code = "318204771";
    const upgrade = await exports.default.fetch(`https://connect.polymux.com/relay/${hostId}`, {
      headers: {
        authorization: `Bearer ${secret}`,
        upgrade: "websocket",
        "x-polymux-register": "1",
      },
    });
    expect(upgrade.status).toBe(101);
    const socket = upgrade.webSocket;
    expect(socket).toBeTruthy();
    socket!.accept();

    const registered = await exports.default.fetch(`https://connect.polymux.com/relay/${hostId}/connect-code`, {
      method: "PUT",
      headers: {authorization: `Bearer ${secret}`, "content-type": "application/json"},
      body: JSON.stringify({code, expiresAt: Date.now() + 5 * 60_000}),
    });
    expect(registered.status).toBe(204);

    const requestMessage = nextMessage(socket!);
    const relayed = exports.default.fetch(
      "https://connect.polymux.com/connect",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "tauri://localhost",
          "cf-connecting-ip": "203.0.113.12",
        },
        body: JSON.stringify({code, desktopId: "phone-a"}),
      },
    );
    const message = JSON.parse(await requestMessage) as unknown;
    expect(isHostRelayRequest(message)).toBe(true);
    if (!isHostRelayRequest(message)) throw new Error("Relay request was invalid");
    expect(message.path).toBe("/polymux-host/v1/pair");
    expect(message.headers.origin).toBe("tauri://localhost");
    expect(JSON.parse(decode(message.bodyBase64))).toEqual({code, desktopId: "phone-a"});

    const response: HostRelayResponse = {
      type: "response",
      version: HOST_RELAY_PROTOCOL_VERSION,
      id: message.id,
      status: 202,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "tauri://localhost",
      },
      bodyBase64: encode(JSON.stringify({hostId, status: "pending", id: "pair-request", number: "42", token: "request-only-token"})),
    };
    socket!.send(JSON.stringify(response));

    const result = await relayed;
    expect(result.status).toBe(202);
    expect(result.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    expect(await result.json()).toEqual({hostId, status: "pending", id: "pair-request", number: "42", token: "request-only-token"});

    const reused = await exports.default.fetch("https://connect.polymux.com/connect", {
      method: "POST",
      headers: {"content-type": "application/json", "cf-connecting-ip": "203.0.113.12"},
      body: JSON.stringify({code, desktopId: "phone-b"}),
    });
    expect(reused.status).toBe(401);

    socket!.close(1000, "test complete");
  });

  it("rejects a connect-code collision without replacing the first Host", async () => {
    const code = "477193620";
    const first = await registerHost("be0355f4-aa13-4a8d-b39e-560a6c14baa3", "first-host-secret-that-is-at-least-thirty-two-characters");
    const second = await registerHost("d133cdad-a25b-46f9-8ed6-69fb775cf18c", "second-host-secret-that-is-at-least-thirty-two-characters");
    const firstCode = await registerCode(first.hostId, first.secret, code);
    const collision = await registerCode(second.hostId, second.secret, code);
    expect(firstCode.status).toBe(204);
    expect(collision.status).toBe(409);
    first.socket.close(1000, "test complete");
    second.socket.close(1000, "test complete");
  });

  it("expires connect-code directory entries", async () => {
    const code = "123456789";
    const hostId = "bbf33f75-4f9e-4aa6-a32f-3ac5b5d152df";
    const registry = env.CONNECT_CODES.getByName("connect-code-123");
    expect(await registry.register(code, hostId, 20_000, 10_000)).toBe(true);
    expect(await registry.resolve(code, 19_999)).toBe(hostId);
    expect(await registry.resolve(code, 20_000)).toBeNull();
  });

  it("rate-limits repeated public connect attempts by client", async () => {
    const request = () => exports.default.fetch("https://connect.polymux.com/connect", {
      method: "POST",
      headers: {"content-type": "application/json", "cf-connecting-ip": "198.51.100.42"},
      body: JSON.stringify({code: "999888777", desktopId: "rate-limited-phone"}),
    });
    for (let attempt = 0; attempt < 8; attempt += 1) expect((await request()).status).toBe(401);
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("rejects a different secret after the Host identity is registered", async () => {
    const hostId = "05fb5da1-0250-4f49-807a-3737705e6d38";
    const first = await exports.default.fetch(`https://connect.polymux.com/relay/${hostId}`, {
      headers: {
        authorization: "Bearer first-secret-that-is-at-least-thirty-two-characters",
        upgrade: "websocket",
        "x-polymux-register": "1",
      },
    });
    expect(first.status).toBe(101);
    first.webSocket!.accept();

    const rejected = await exports.default.fetch(`https://connect.polymux.com/relay/${hostId}`, {
      headers: {
        authorization: "Bearer second-secret-that-is-at-least-thirty-two-characters",
        upgrade: "websocket",
        "x-polymux-register": "1",
      },
    });
    expect(rejected.status).toBe(401);
    first.webSocket!.close(1000, "test complete");
  });
});

async function registerHost(hostId: string, secret: string): Promise<{hostId: string; secret: string; socket: WebSocket}> {
  const response = await exports.default.fetch(`https://connect.polymux.com/relay/${hostId}`, {
    headers: {authorization: `Bearer ${secret}`, upgrade: "websocket", "x-polymux-register": "1"},
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  return {hostId, secret, socket};
}

function registerCode(hostId: string, secret: string, code: string): Promise<Response> {
  return exports.default.fetch(`https://connect.polymux.com/relay/${hostId}/connect-code`, {
    method: "PUT",
    headers: {authorization: `Bearer ${secret}`, "content-type": "application/json"},
    body: JSON.stringify({code, expiresAt: Date.now() + 5 * 60_000}),
  });
}

function nextMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Relay did not deliver a request")), 2_000);
    socket.addEventListener("message", (event) => {
      clearTimeout(timeout);
      resolve(String(event.data));
    }, {once: true});
  });
}

function encode(value: string): string {
  return btoa(value);
}

function decode(value: string): string {
  return atob(value);
}
