import WebSocket, {type RawData} from "ws";
import {
  HOST_PAIRING_CODE,
  HOST_RELAY_PROTOCOL_VERSION,
  hostRelayConnectCodeEndpoint,
  hostRelayConnectConfigEndpoint,
  hostRelayPublicEndpoint,
  hostRelayWebSocketEndpoint,
  isHostRelayConnectConfig,
  isHostRelayRequest,
  normalizeHostPairingCode,
  type HostRelayRequest,
  type HostRelayResponse,
} from "@polymux/protocol";

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_CONNECT_CONFIG_BYTES = 16 * 1024;
const MAX_MESSAGE_BYTES = Math.ceil(MAX_BODY_BYTES / 3) * 4 + 32_768;
const RECONNECT_MS = 2_000;
const MAX_RECONNECT_MS = 30_000;

interface ConnectCodeRegistration {
  code: string;
  expiresAt: number;
}

export interface TeamHostRelayOptions {
  relayOrigin: string;
  hostId: string;
  hostSecret: string;
  localEndpoint: string;
  onConnectionChange?: (connected: boolean, detail: string | null) => void;
}

/** Keeps a private Host reachable without opening a port or installing a VPN. */
export class TeamHostRelay {
  readonly #options: TeamHostRelayOptions;
  readonly publicEndpoint: string;
  #socket: WebSocket | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectDelay = RECONNECT_MS;
  #closed = false;
  #connectCode: ConnectCodeRegistration | null | undefined;

  constructor(options: TeamHostRelayOptions) {
    this.#options = options;
    this.publicEndpoint = hostRelayPublicEndpoint(options.relayOrigin, options.hostId);
  }

  async start(): Promise<void> {
    this.#closed = false;
    try {
      await this.#connect();
    } catch (error) {
      this.#scheduleReconnect();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    const socket = this.#socket;
    this.#socket = null;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        socket.terminate();
        resolve();
      }, 1_000);
      socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.close(1000, "Polymux Host stopped");
    });
  }

  /** Publishes only the short-lived code-to-Host route. The Host still validates
   * the code and issues the paired bearer credential. */
  async updateConnectCode(code: string | null, expiresAt: number | null): Promise<boolean> {
    if (code === null) this.#connectCode = null;
    else {
      const pairing = normalizeHostPairingCode(code);
      if (!HOST_PAIRING_CODE.test(pairing) || !Number.isInteger(expiresAt) || !expiresAt || expiresAt <= Date.now())
        throw new Error("The Polymux connect code is invalid or expired");
      this.#connectCode = {code: pairing, expiresAt};
    }
    return this.#publishConnectCode();
  }

  async #connect(): Promise<void> {
    if (this.#closed) return;
    const webSocketEndpoint = await this.#discoverWebSocketEndpoint();
    if (this.#closed) return;
    const socket = new WebSocket(webSocketEndpoint, {
      headers: {
        authorization: `Bearer ${this.#options.hostSecret}`,
        "x-polymux-register": "1",
      },
      handshakeTimeout: 8_000,
      maxPayload: MAX_MESSAGE_BYTES,
    });
    this.#socket = socket;
    await new Promise<void>((resolve, reject) => {
      let opened = false;
      socket.once("open", () => {
        opened = true;
        this.#reconnectDelay = RECONNECT_MS;
        this.#options.onConnectionChange?.(true, null);
        if (this.#connectCode !== undefined)
          void this.#publishConnectCode().then((published) => {
            if (!published)
              this.#options.onConnectionChange?.(true, "Connected, but the connect code is being refreshed…");
          }).catch((error) => {
            this.#options.onConnectionChange?.(
              true,
              `Connected, but the connect code could not be published: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        resolve();
      });
      socket.once("error", (error) => {
        if (!opened) reject(error);
      });
      socket.on("message", (data, isBinary) => this.#message(socket, data, isBinary));
      socket.once("close", () => {
        if (this.#socket === socket) this.#socket = null;
        this.#options.onConnectionChange?.(false, "Polymux Connect is reconnecting…");
        this.#scheduleReconnect();
      });
    });
  }

  async #discoverWebSocketEndpoint(): Promise<string> {
    const response = await fetch(hostRelayConnectConfigEndpoint(this.#options.relayOrigin), {
      headers: {accept: "application/json"},
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Polymux Connect discovery returned HTTP ${response.status}`);
    const body = await readBoundedResponse(response, MAX_CONNECT_CONFIG_BYTES);
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(body).toString("utf8"));
    } catch {
      throw new Error("Polymux Connect returned invalid discovery data");
    }
    if (!isHostRelayConnectConfig(value))
      throw new Error("Polymux Connect returned an unsupported discovery document");
    return hostRelayWebSocketEndpoint(value.webSocketOrigin, this.#options.hostId);
  }

  async #publishConnectCode(): Promise<boolean> {
    const registration = this.#connectCode;
    if (registration === undefined) return true;
    const response = await fetch(hostRelayConnectCodeEndpoint(this.#options.relayOrigin, this.#options.hostId), {
      method: registration ? "PUT" : "DELETE",
      headers: {
        authorization: `Bearer ${this.#options.hostSecret}`,
        ...(registration ? {"content-type": "application/json"} : {}),
      },
      body: registration ? JSON.stringify(registration) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 409) return false;
    if (!response.ok) {
      const value = await response.json().catch(() => ({})) as {error?: string};
      throw new Error(value.error ?? `Polymux Connect returned ${response.status}`);
    }
    return true;
  }

  #message(socket: WebSocket, data: RawData, isBinary: boolean): void {
    if (isBinary) {
      socket.close(1003, "Polymux relay messages must be JSON");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(data.toString());
    } catch {
      socket.close(1007, "Invalid Polymux relay message");
      return;
    }
    if (!isHostRelayRequest(value) || value.bodyBase64.length > maximumBase64Length(MAX_BODY_BYTES)) {
      socket.close(1007, "Invalid Polymux relay request");
      return;
    }
    void this.#forward(socket, value).catch((error) => {
      this.#sendError(socket, value.id, error instanceof Error ? error.message : String(error));
    });
  }

  async #forward(socket: WebSocket, request: HostRelayRequest): Promise<void> {
    const url = new URL(request.path, `${this.#options.localEndpoint}/`);
    if (url.origin !== new URL(this.#options.localEndpoint).origin || !url.pathname.startsWith("/polymux-host/v1/"))
      throw new Error("The relay requested an invalid Host path");
    const headers = new Headers();
    for (const name of ["authorization", "content-type", "origin"]) {
      const value = request.headers[name];
      if (value) headers.set(name, value);
    }
    const response = await fetch(url, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "OPTIONS"
        ? undefined
        : Buffer.from(request.bodyBase64, "base64"),
      signal: AbortSignal.timeout(40_000),
    });
    const body = await readBoundedResponse(response, MAX_BODY_BYTES);
    const message: HostRelayResponse = {
      type: "response",
      version: HOST_RELAY_PROTOCOL_VERSION,
      id: request.id,
      status: response.status,
      headers: responseHeaders(response.headers),
      bodyBase64: Buffer.from(body).toString("base64"),
    };
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  #sendError(socket: WebSocket, id: string, detail: string): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    console.error(JSON.stringify({message: "relayed Host request failed", error: detail}));
    const message: HostRelayResponse = {
      type: "response",
      version: HOST_RELAY_PROTOCOL_VERSION,
      id,
      status: 502,
      headers: {"content-type": "application/json; charset=utf-8"},
      bodyBase64: Buffer.from(JSON.stringify({error: "Polymux Host could not handle the relayed request."})).toString("base64"),
    };
    socket.send(JSON.stringify(message));
  }

  #scheduleReconnect(): void {
    if (this.#closed || this.#reconnectTimer) return;
    const delay = this.#reconnectDelay;
    this.#reconnectDelay = Math.min(MAX_RECONNECT_MS, this.#reconnectDelay * 2);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#connect().catch((error) => {
        this.#options.onConnectionChange?.(
          false,
          `Polymux Connect is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.#scheduleReconnect();
      });
    }, delay);
  }
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error("The Host response is too large for Polymux Connect");
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

function responseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
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
    const value = headers.get(name);
    if (value) result[name] = value;
  }
  return result;
}

function maximumBase64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}
