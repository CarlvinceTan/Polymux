import assert from "node:assert/strict";
import {createServer, type Server} from "node:http";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {AgentSurfaceAdapter} from "../agent-surface-adapter.js";

interface FakeService {
  server: Server;
  base: string;
  puts: Array<{id: string; body: Record<string, unknown>; auth: string | null}>;
  deletes: string[];
  stopRequests: Array<Record<string, unknown>>;
  stopAcks: string[];
}

async function startFakeService(): Promise<FakeService> {
  const state: Omit<FakeService, "server" | "base"> = {
    puts: [],
    deletes: [],
    stopRequests: [],
    stopAcks: [],
  };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const auth = request.headers.authorization ?? null;
      const reply = (status: number, value: unknown): void => {
        const body = JSON.stringify(value);
        response.writeHead(status, {"Content-Type": "application/json"});
        response.end(body);
      };
      const leaseMatch = url.pathname.match(/^\/v1\/leases\/([^/]+)$/);
      if (leaseMatch && request.method === "PUT") {
        state.puts.push({
          id: decodeURIComponent(leaseMatch[1]),
          body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
          auth,
        });
        reply(200, {ok: true});
        return;
      }
      if (leaseMatch && request.method === "DELETE") {
        state.deletes.push(decodeURIComponent(leaseMatch[1]));
        reply(200, {ok: true});
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/stop-requests") {
        reply(200, {requests: state.stopRequests});
        return;
      }
      const stopMatch = url.pathname.match(/^\/v1\/stop-requests\/([^/]+)$/);
      if (stopMatch && request.method === "DELETE") {
        const id = decodeURIComponent(stopMatch[1]);
        state.stopAcks.push(id);
        state.stopRequests = state.stopRequests.filter((item) => item.id !== id);
        reply(200, {ok: true});
        return;
      }
      reply(404, {error: "not found"});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {...state, server, base: `http://127.0.0.1:${port}`} as FakeService;
}

async function withAdapter(
  run: (service: FakeService, adapter: AgentSurfaceAdapter, stops: string[]) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "flareai-surface-"));
  const tokenPath = path.join(dir, "token");
  await writeFile(tokenPath, "test-token\n", "utf8");
  const service = await startFakeService();
  const stops: string[] = [];
  const adapter = new AgentSurfaceAdapter({
    baseUrl: service.base,
    tokenPath,
    refreshMs: 50,
    stopPollMs: 40,
    onStop: (sessionId) => stops.push(sessionId),
  });
  try {
    await run(service, adapter, stops);
  } finally {
    adapter.close();
    await new Promise<void>((resolve) => service.server.close(() => resolve()));
    await rm(dir, {recursive: true, force: true});
  }
}

test("publishes a window lease with the Codex-compatible shape and token", async () => {
  await withAdapter(async (service, adapter) => {
    const ok = await adapter.acquireWindow("flareai-browser", {
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      windowTitle: "Docs",
      sessionId: "flareai-browser",
    });
    assert.equal(ok, true);
    assert.equal(service.puts.length, 1);
    const {id, body, auth} = service.puts[0];
    assert.equal(id, "flareai-browser");
    assert.equal(auth, "Bearer test-token");
    assert.equal(body.kind, "window");
    assert.equal(body.state, "active");
    assert.deepEqual(body.agent, {id: "flareai", name: "FlareAI"});
    assert.deepEqual(body.app, {name: "Google Chrome", bundleId: "com.google.Chrome"});
    assert.deepEqual(body.control, {sessionId: "flareai-browser"});
  });
});

test("refreshes held leases and releases them", async () => {
  await withAdapter(async (service, adapter) => {
    await adapter.acquireWindow("flareai-browser", {
      appName: "Browser",
      sessionId: "flareai-browser",
    });
    await new Promise((resolve) => setTimeout(resolve, 140));
    assert.ok(service.puts.length >= 2, "expected refresh PUTs");
    await adapter.release("flareai-browser");
    assert.deepEqual(service.deletes, ["flareai-browser"]);
    const count = service.puts.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(service.puts.length, count, "no refreshes after release");
  });
});

test("stop requests from the pill are acknowledged and forwarded", async () => {
  await withAdapter(async (service, adapter, stops) => {
    await adapter.acquireWindow("flareai-browser", {
      appName: "Browser",
      sessionId: "flareai-browser",
    });
    service.stopRequests.push({
      id: "flareai-browser",
      agentId: "flareai",
      target: "flareai-browser",
      requestedAtMs: Date.now(),
      expiresAtMs: Date.now() + 60_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(stops, ["flareai-browser"]);
    assert.deepEqual(service.stopAcks, ["flareai-browser"]);
  });
});

test("degrades to a no-op without an Agent Surface token", async () => {
  const adapter = new AgentSurfaceAdapter({
    baseUrl: "http://127.0.0.1:9",
    tokenPath: "/nonexistent/token",
  });
  assert.equal(adapter.available(), false);
  assert.equal(
    await adapter.acquireWindow("x", {appName: "A", sessionId: "x"}),
    false,
  );
  adapter.close();
});
