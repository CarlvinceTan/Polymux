import {DurableObject} from "cloudflare:workers";
import {
  HOST_PAIRING_CODE,
  HOST_RELAY_CODE_PAIR_PATH,
  HOST_RELAY_CONNECT_CONFIG_PATH,
  HOST_RELAY_PROTOCOL_VERSION,
  isHostRelayResponse,
  normalizeHostPairingCode,
  type HostRelayRequest,
  type HostRelayResponse,
} from "@polymux/protocol";

const HOST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_CONNECT_BODY_BYTES = 4 * 1024;
const MAX_ACTIVE_REQUESTS = 32;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_CONNECT_CODE_TTL_MS = 15 * 60_000;
const CONNECT_ATTEMPTS_PER_MINUTE = 8;
const CONNECT_ATTEMPTS_PER_HOUR = 30;
const NETWORK_ATTEMPTS_PER_MINUTE = 300;
const NETWORK_ATTEMPTS_PER_HOUR = 3_000;
const SECRET_STORAGE_KEY = "host-secret-sha256";
const HOST_ID_STORAGE_KEY = "host-id";
const CONNECT_CODE_STORAGE_KEY = "connect-code";
const MOBILE_ORIGINS = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz"))
        return Response.json(
          {ok: true, service: "polymux-connect", protocol: HOST_RELAY_PROTOCOL_VERSION},
          {headers: {"cache-control": "no-store", "x-content-type-options": "nosniff"}},
        );

      if (request.method === "GET" && url.pathname === HOST_RELAY_CONNECT_CONFIG_PATH)
        return Response.json(
          {version: HOST_RELAY_PROTOCOL_VERSION, webSocketOrigin: url.origin},
          {headers: {"cache-control": "no-store", "x-content-type-options": "nosniff"}},
        );

      if (url.pathname === HOST_RELAY_CODE_PAIR_PATH)
        return pairByConnectCode(request, env);

      const relay = route(url.pathname, "/relay/");
      if (relay) {
        if (!HOST_ID.test(relay.hostId)) return notFound();
        if (!relay.rest) {
          if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket")
            return Response.json({error: "Expected a WebSocket connection."}, {status: 426});
          const headers = new Headers({upgrade: "websocket"});
          copyHeader(request.headers, headers, "authorization");
          copyHeader(request.headers, headers, "x-polymux-register");
          headers.set("x-polymux-host-id", relay.hostId);
          return env.HOST_RELAY.getByName(relay.hostId).fetch(new Request("https://relay.internal/connect", {
            method: "GET",
            headers,
          }));
        }
        if (relay.rest === "/connect-code") {
          if (request.method !== "PUT" && request.method !== "DELETE")
            return Response.json({error: "Method not allowed."}, {status: 405, headers: {allow: "PUT, DELETE"}});
          if (requestBodyTooLarge(request, MAX_CONNECT_BODY_BYTES))
            return Response.json({error: "Connect-code registration is too large."}, {status: 413});
          const headers = new Headers();
          copyHeader(request.headers, headers, "authorization");
          copyHeader(request.headers, headers, "content-type");
          headers.set("x-polymux-host-id", relay.hostId);
          return env.HOST_RELAY.getByName(relay.hostId).fetch(new Request("https://relay.internal/connect-code", {
            method: request.method,
            headers,
            body: request.method === "DELETE" ? undefined : request.body,
          }));
        }
        return notFound();
      }

      const host = route(url.pathname, "/h/");
      if (host) {
        if (!HOST_ID.test(host.hostId) || !host.rest.startsWith("/polymux-host/v1/")) return notFound();
        if (request.method !== "GET" && request.method !== "POST" && request.method !== "OPTIONS")
          return Response.json({error: "Method not allowed."}, {status: 405, headers: {allow: "GET, POST, OPTIONS"}});
        if (requestBodyTooLarge(request, MAX_BODY_BYTES))
          return Response.json({error: "Host request is too large."}, {status: 413});
        const headers = forwardedRequestHeaders(request.headers);
        headers.set("x-polymux-proxy-path", `${host.rest}${url.search}`);
        return env.HOST_RELAY.getByName(host.hostId).fetch(new Request("https://relay.internal/proxy", {
          method: request.method,
          headers,
          body: request.method === "GET" ? undefined : request.body,
        }));
      }

      return notFound();
    } catch (error) {
      console.error(JSON.stringify({
        message: "relay request failed",
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return Response.json({error: "Polymux Connect could not complete the request."}, {status: 500});
    }
  },
} satisfies ExportedHandler<Env>;

interface PendingRequest {
  resolve: (response: Response) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ConnectCodeRecord {
  code: string;
  expiresAt: number;
}

interface ConnectPairBody {
  code: string;
  desktopId: string;
  deviceName?: string;
}

export class HostRelay extends DurableObject<Env> {
  readonly #pending = new Map<string, PendingRequest>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connect") return this.#connect(request);
    if (url.pathname === "/connect-code") return this.#connectCode(request);
    if (url.pathname === "/proxy") return this.#proxy(request);
    return notFound();
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") {
      socket.close(1003, "Polymux relay messages must be JSON");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(message);
    } catch {
      socket.close(1007, "Invalid Polymux relay message");
      return;
    }
    if (!isHostRelayResponse(value) || value.bodyBase64.length > maximumBase64Length(MAX_BODY_BYTES)) {
      socket.close(1007, "Invalid Polymux relay response");
      return;
    }
    const pending = this.#pending.get(value.id);
    if (!pending) return;
    this.#pending.delete(value.id);
    clearTimeout(pending.timer);
    pending.resolve(new Response(base64ToBytes(value.bodyBase64), {
      status: value.status,
      headers: forwardedResponseHeaders(value.headers),
    }));
  }

  webSocketClose(_socket: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    if (!this.#connectedHost()) this.#finishPending("The Polymux Host disconnected.");
  }

  webSocketError(_socket: WebSocket, error: unknown): void {
    console.error(JSON.stringify({message: "host relay WebSocket error", error: String(error)}));
    if (!this.#connectedHost()) this.#finishPending("The Polymux Host connection failed.");
  }

  async #connect(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return Response.json({error: "Expected a WebSocket connection."}, {status: 426});
    const authenticationError = await this.#authenticateHost(request, true);
    if (authenticationError) return authenticationError;
    const identityError = await this.#recordHostId(request);
    if (identityError) return identityError;

    for (const current of this.ctx.getWebSockets("host")) current.close(1012, "Host reconnected");
    const [client, server] = Object.values(new WebSocketPair());
    server.serializeAttachment({role: "host", version: HOST_RELAY_PROTOCOL_VERSION});
    this.ctx.acceptWebSocket(server, ["host"]);
    console.log(JSON.stringify({message: "host connected"}));
    return new Response(null, {status: 101, webSocket: client});
  }

  async #connectCode(request: Request): Promise<Response> {
    const authenticationError = await this.#authenticateHost(request, false);
    if (authenticationError) return authenticationError;
    const identityError = await this.#recordHostId(request);
    if (identityError) return identityError;
    const hostId = request.headers.get("x-polymux-host-id")!;
    const current = await this.ctx.storage.get<ConnectCodeRecord>(CONNECT_CODE_STORAGE_KEY);
    if (request.method === "DELETE") {
      await this.ctx.storage.delete(CONNECT_CODE_STORAGE_KEY);
      if (current)
        await this.env.CONNECT_CODES.getByName(connectCodeShard(current.code)).remove(current.code, hostId);
      return new Response(null, {status: 204});
    }
    if (request.method !== "PUT")
      return Response.json({error: "Method not allowed."}, {status: 405, headers: {allow: "PUT, DELETE"}});

    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(await readBoundedBody(request, MAX_CONNECT_BODY_BYTES)));
    } catch (error) {
      if (error instanceof RelayHttpError)
        return Response.json({error: error.message}, {status: error.status});
      return Response.json({error: "Connect-code registration is invalid."}, {status: 400});
    }
    if (!record(body))
      return Response.json({error: "Connect-code registration is invalid."}, {status: 400});
    const code = typeof body.code === "string" ? normalizeHostPairingCode(body.code) : "";
    const expiresAt = typeof body.expiresAt === "number" ? body.expiresAt : 0;
    const now = Date.now();
    if (!HOST_PAIRING_CODE.test(code) || !Number.isInteger(expiresAt) || expiresAt <= now || expiresAt > now + MAX_CONNECT_CODE_TTL_MS)
      return Response.json({error: "Connect-code registration is invalid."}, {status: 400});

    const registry = this.env.CONNECT_CODES.getByName(connectCodeShard(code));
    if (!await registry.register(code, hostId, expiresAt, now))
      return Response.json({error: "That connect code is already active. Generate another code."}, {status: 409});
    const next = {code, expiresAt};
    await this.ctx.storage.put(CONNECT_CODE_STORAGE_KEY, next);
    if (current && current.code !== code)
      await this.env.CONNECT_CODES.getByName(connectCodeShard(current.code)).remove(current.code, hostId);
    return new Response(null, {status: 204});
  }

  async #authenticateHost(request: Request, allowRegistration: boolean): Promise<Response | null> {
    const secret = bearer(request.headers.get("authorization"));
    if (!secret || secret.length < 32 || secret.length > 256)
      return Response.json({error: "Host authentication is required."}, {status: 401});
    const providedHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    const storedHash = await this.ctx.storage.get<ArrayBuffer>(SECRET_STORAGE_KEY);
    if (!storedHash) {
      if (!allowRegistration || request.headers.get("x-polymux-register") !== "1")
        return Response.json({error: "This Host has not registered with Polymux Connect."}, {status: 401});
      await this.ctx.storage.put(SECRET_STORAGE_KEY, providedHash);
    } else if (!crypto.subtle.timingSafeEqual(storedHash, providedHash)) {
      return Response.json({error: "Host authentication failed."}, {status: 401});
    }
    return null;
  }

  async #recordHostId(request: Request): Promise<Response | null> {
    const hostId = request.headers.get("x-polymux-host-id") ?? "";
    if (!HOST_ID.test(hostId))
      return Response.json({error: "Host identity is invalid."}, {status: 400});
    const stored = await this.ctx.storage.get<string>(HOST_ID_STORAGE_KEY);
    if (stored && stored !== hostId)
      return Response.json({error: "Host identity does not match this relay."}, {status: 409});
    if (!stored) await this.ctx.storage.put(HOST_ID_STORAGE_KEY, hostId);
    return null;
  }

  async #proxy(request: Request): Promise<Response> {
    const host = this.#connectedHost();
    if (!host)
      return Response.json({error: "This Polymux Host is offline."}, {status: 503, headers: {"retry-after": "3"}});
    if (this.#pending.size >= MAX_ACTIVE_REQUESTS)
      return Response.json({error: "This Polymux Host is busy."}, {status: 429, headers: {"retry-after": "1"}});
    const method = request.method;
    if (method !== "GET" && method !== "POST" && method !== "OPTIONS")
      return Response.json({error: "Method not allowed."}, {status: 405});
    const path = request.headers.get("x-polymux-proxy-path") ?? "";
    if (!path.startsWith("/polymux-host/v1/") || path.length > 2_048) return notFound();
    let body: Uint8Array;
    try {
      body = await readBoundedBody(request, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof RelayHttpError)
        return Response.json({error: error.message}, {status: error.status});
      throw error;
    }
    const id = crypto.randomUUID();
    const message: HostRelayRequest = {
      type: "request",
      version: HOST_RELAY_PROTOCOL_VERSION,
      id,
      method,
      path,
      headers: Object.fromEntries(forwardedRequestHeaders(request.headers)),
      bodyBase64: bytesToBase64(body),
    };
    return new Promise<Response>((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        resolve(Response.json({error: "The Polymux Host did not answer in time."}, {status: 504}));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, {resolve, timer});
      try {
        host.send(JSON.stringify(message));
      } catch {
        clearTimeout(timer);
        this.#pending.delete(id);
        resolve(Response.json({error: "The Polymux Host disconnected."}, {status: 503}));
      }
    });
  }

  #connectedHost(): WebSocket | null {
    return this.ctx.getWebSockets("host").find((socket) => socket.readyState === WebSocket.OPEN) ?? null;
  }

  #finishPending(message: string): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(Response.json({error: message}, {status: 503}));
    }
    this.#pending.clear();
  }
}

export class ConnectCodeRegistry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS connect_codes (
          code TEXT PRIMARY KEY,
          host_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS connect_codes_expiry ON connect_codes(expires_at);
      `);
    });
  }

  async register(code: string, hostId: string, expiresAt: number, now: number): Promise<boolean> {
    if (!HOST_PAIRING_CODE.test(code) || !HOST_ID.test(hostId) || !Number.isInteger(expiresAt) || expiresAt <= now)
      return false;
    this.ctx.storage.sql.exec("DELETE FROM connect_codes WHERE expires_at <= ?", now);
    const current = this.ctx.storage.sql.exec<{host_id: string}>(
      "SELECT host_id FROM connect_codes WHERE code = ?",
      code,
    ).toArray()[0];
    if (current && current.host_id !== hostId) return false;
    this.ctx.storage.sql.exec(
      `INSERT INTO connect_codes (code, host_id, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET host_id = excluded.host_id, expires_at = excluded.expires_at`,
      code,
      hostId,
      expiresAt,
    );
    await this.#scheduleNextAlarm();
    return true;
  }

  resolve(code: string, now: number): string | null {
    if (!HOST_PAIRING_CODE.test(code)) return null;
    this.ctx.storage.sql.exec("DELETE FROM connect_codes WHERE expires_at <= ?", now);
    return this.ctx.storage.sql.exec<{host_id: string}>(
      "SELECT host_id FROM connect_codes WHERE code = ?",
      code,
    ).toArray()[0]?.host_id ?? null;
  }

  async remove(code: string, hostId: string): Promise<void> {
    if (!HOST_PAIRING_CODE.test(code) || !HOST_ID.test(hostId)) return;
    this.ctx.storage.sql.exec("DELETE FROM connect_codes WHERE code = ? AND host_id = ?", code, hostId);
    await this.#scheduleNextAlarm();
  }

  async alarm(): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM connect_codes WHERE expires_at <= ?", Date.now());
    await this.#scheduleNextAlarm();
  }

  async #scheduleNextAlarm(): Promise<void> {
    const next = this.ctx.storage.sql.exec<{expires_at: number | null}>(
      "SELECT MIN(expires_at) AS expires_at FROM connect_codes",
    ).one().expires_at;
    if (typeof next === "number") await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
}

export class ConnectAttemptLimiter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS attempt_window (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          minute_window INTEGER NOT NULL,
          minute_count INTEGER NOT NULL,
          hour_window INTEGER NOT NULL,
          hour_count INTEGER NOT NULL
        );
      `);
    });
  }

  take(now: number, minuteLimit: number, hourLimit: number): {allowed: boolean; retryAfterSeconds: number} {
    if (!Number.isInteger(now) || !Number.isInteger(minuteLimit) || !Number.isInteger(hourLimit)
      || minuteLimit < 1 || hourLimit < minuteLimit || hourLimit > 10_000)
      return {allowed: false, retryAfterSeconds: 60};
    const minuteWindow = Math.floor(now / 60_000);
    const hourWindow = Math.floor(now / 3_600_000);
    const current = this.ctx.storage.sql.exec<{
      minute_window: number;
      minute_count: number;
      hour_window: number;
      hour_count: number;
    }>("SELECT minute_window, minute_count, hour_window, hour_count FROM attempt_window WHERE id = 1").toArray()[0];
    const minuteCount = current?.minute_window === minuteWindow ? current.minute_count : 0;
    const hourCount = current?.hour_window === hourWindow ? current.hour_count : 0;
    const minuteLimited = minuteCount >= minuteLimit;
    const hourLimited = hourCount >= hourLimit;
    if (minuteLimited || hourLimited) {
      const retryAt = hourLimited ? (hourWindow + 1) * 3_600_000 : (minuteWindow + 1) * 60_000;
      return {allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1_000))};
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO attempt_window (id, minute_window, minute_count, hour_window, hour_count)
       VALUES (1, ?, 1, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         minute_window = excluded.minute_window,
         minute_count = ?,
         hour_window = excluded.hour_window,
         hour_count = ?`,
      minuteWindow,
      hourWindow,
      minuteCount + 1,
      hourCount + 1,
    );
    return {allowed: true, retryAfterSeconds: 0};
  }
}

async function pairByConnectCode(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS")
    return withMobileCors(request, new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST, OPTIONS",
        "cache-control": "no-store",
        vary: "origin",
      },
    }));
  if (request.method !== "POST")
    return withMobileCors(request, Response.json({error: "Method not allowed."}, {status: 405, headers: {allow: "POST, OPTIONS"}}));
  if (requestBodyTooLarge(request, MAX_CONNECT_BODY_BYTES))
    return connectError(request, 413, "The connect request is too large.");

  let body: ConnectPairBody;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(await readBoundedBody(request, MAX_CONNECT_BODY_BYTES)));
    if (!isConnectPairBody(parsed)) throw new Error("invalid body");
    body = parsed;
  } catch (error) {
    if (error instanceof RelayHttpError) return connectError(request, error.status, error.message);
    return connectError(request, 400, "Enter the connect code shown by Polymux Host.");
  }

  const now = Date.now();
  const [networkKey, clientKey] = await Promise.all([
    connectClientKey(request, "network"),
    connectClientKey(request, `client:${body.desktopId}`),
  ]);
  const [networkLimit, clientLimit] = await Promise.all([
    env.CONNECT_LIMITER.getByName(networkKey).take(now, NETWORK_ATTEMPTS_PER_MINUTE, NETWORK_ATTEMPTS_PER_HOUR),
    env.CONNECT_LIMITER.getByName(clientKey).take(now, CONNECT_ATTEMPTS_PER_MINUTE, CONNECT_ATTEMPTS_PER_HOUR),
  ]);
  if (!networkLimit.allowed || !clientLimit.allowed)
    return connectError(
      request,
      429,
      "Too many connect attempts. Try again shortly.",
      Math.max(networkLimit.retryAfterSeconds, clientLimit.retryAfterSeconds),
    );

  const registry = env.CONNECT_CODES.getByName(connectCodeShard(body.code));
  const hostId = await registry.resolve(body.code, now);
  if (!hostId) return connectError(request, 401, "The connect code is invalid or expired.");

  const headers = forwardedRequestHeaders(request.headers);
  headers.set("content-type", "application/json");
  headers.set("x-polymux-proxy-path", "/polymux-host/v1/pair");
  const response = await env.HOST_RELAY.getByName(hostId).fetch(new Request("https://relay.internal/proxy", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }));
  if (response.status === 202) await registry.remove(body.code, hostId);
  return response;
}

function isConnectPairBody(value: unknown): value is ConnectPairBody {
  if (!record(value)) return false;
  if (typeof value.code !== "string") return false;
  const code = normalizeHostPairingCode(value.code);
  if (!HOST_PAIRING_CODE.test(code)) return false;
  value.code = code;
  if (typeof value.desktopId !== "string" || value.desktopId.length < 1 || value.desktopId.length > 120) return false;
  return value.deviceName === undefined || typeof value.deviceName === "string" && value.deviceName.length <= 120;
}

function connectCodeShard(code: string): string {
  return `connect-code-${code.slice(0, 3)}`;
}

async function connectClientKey(request: Request, scope: string): Promise<string> {
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`polymux-connect-client-v1:${address}:${scope}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function connectError(request: Request, status: number, error: string, retryAfterSeconds?: number): Response {
  const headers = new Headers({"cache-control": "no-store", "x-content-type-options": "nosniff"});
  if (retryAfterSeconds) headers.set("retry-after", String(retryAfterSeconds));
  return withMobileCors(request, Response.json({error}, {status, headers}));
}

function withMobileCors(request: Request, response: Response): Response {
  const origin = request.headers.get("origin") ?? "";
  if (!MOBILE_ORIGINS.has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "origin");
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

function requestBodyTooLarge(request: Request, maximumBytes: number): boolean {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  return Number.isFinite(contentLength) && contentLength > maximumBytes;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function route(pathname: string, prefix: string): {hostId: string; rest: string} | null {
  if (!pathname.startsWith(prefix)) return null;
  const value = pathname.slice(prefix.length);
  const slash = value.indexOf("/");
  const encodedHostId = slash < 0 ? value : value.slice(0, slash);
  try {
    return {hostId: decodeURIComponent(encodedHostId), rest: slash < 0 ? "" : value.slice(slash)};
  } catch {
    return {hostId: "", rest: ""};
  }
}

function bearer(value: string | null): string {
  return value?.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function forwardedRequestHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "origin"]) copyHeader(source, headers, name);
  return headers;
}

function forwardedResponseHeaders(source: Record<string, string>): Headers {
  const headers = new Headers();
  for (const name of [
    "access-control-allow-headers",
    "access-control-allow-methods",
    "access-control-allow-origin",
    "cache-control",
    "content-type",
    "retry-after",
    "vary",
    "x-content-type-options",
  ]) {
    const value = source[name];
    if (value) headers.set(name, value);
  }
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

function copyHeader(source: Headers, target: Headers, name: string): void {
  const value = source.get(name);
  if (value) target.set(name, value);
}

async function readBoundedBody(request: Request, maximumBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new RelayHttpError(413, "Host request is too large.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function maximumBase64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

function notFound(): Response {
  return Response.json({error: "Not found."}, {status: 404});
}

class RelayHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
