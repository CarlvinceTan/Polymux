import {createHash, randomBytes, randomInt, randomUUID} from "node:crypto";
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import {hostname} from "node:os";
import type {JsonValue, Storage} from "@polymux/storage";
import type {AgentToolResult} from "@polymux/core";
import {createHostPairingCode, deviceType, LOCKER_HOST_METHODS, normalizeHostPairingCode, type DeviceType} from "@polymux/protocol";
import {DevicePairingSessions, type DevicePeer} from './device-pairing.js';
import {TeamHostRelay} from "./host-relay.js";
import {parsePhonePush, phonePushAvailable, sendPhonePush, type PhonePushSubscription} from './phone-push.js';

const PAIRING_KEY = "devices.authorized-peers";
const RELAY_SECRET_KEY = "team.host-relay-secret";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RPC_BODY_BYTES = 20 * 1024 * 1024;
const PAIRING_CODE_MS = 15 * 60_000;
const PAIRING_SESSION_MS = 5 * 60_000;
const MAX_PAIRING_FAILURES = 5;
const PAIRING_LOCKOUT_MS = 15 * 60_000;

interface PairingRecord {
  push?: PhonePushSubscription;
  deviceType?: DeviceType;
  version: 1;
  desktopId: string;
  desktopName: string;
  secretHash: string;
  pairedAt: string;
  /** Set for the placeholder record that trusts any peer presenting the
   * account pairing secret published to the user's device registry. */
  account?: true;
}

export interface TeamHostServerSnapshot {
  deviceType?: DeviceType;
  state: "starting" | "listening" | "error";
  endpoint: string | null;
  /** Loopback endpoint for same-machine administration. Never placed in a QR. */
  localEndpoint?: string | null;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  pairedDesktopName: string | null;
  detail: string | null;
  approvals: import("./device-pairing.js").PairingApproval[];
  connectedDevices: Array<{deviceId: string; deviceName: string; pairedAt: string; deviceType?: DeviceType; online?: boolean}>;
}

export interface TeamDeviceRequest {
  id: string;
  memberId: string;
  memberName: string;
  capability: "browser" | "computer" | "files" | "team";
  tool: string;
  input: JsonValue;
  requiresApproval: boolean;
  createdAt: string;
}

interface TeamDeviceResolution {
  approved: boolean;
  result: AgentToolResult;
}

interface TeamHostServerOptions {
  deviceType?: DeviceType;
  storage: Storage;
  /** Dispatches only the deliberately exposed Team/Run methods below. */
  call: (method: string, args: JsonValue[]) => Promise<JsonValue>;
  host?: string;
  port?: number;
  publicEndpoint?: string | null;
  relayEndpoint?: string | null;
  deviceRequestTimeoutMs?: number;
  devicePollWaitMs?: number;
  pairingSessionMs?: number;
  pairingLockoutMs?: number;
  /** Local CLI administration token. It can open pairing and call the same
   * allow-listed RPC surface, but it is never accepted as a paired Desktop for
   * laptop device requests. */
  adminSecret?: string;
  onPeerApproved?: (peer: DevicePeer) => Promise<void>;
}

/**
 * Personal Polymux Host transport.
 *
 * The Host stores only a token hash and accepts exactly one Desktop identity.
 * The HTTP listener remains loopback-only by default. When a relay endpoint is
 * configured, an authenticated outbound connection makes the Host reachable at
 * a Polymux HTTPS address without opening a port or requiring a VPN.
 */
export class TeamHostServer {
  /** Only currently authorised peers receive completion notifications. */
  async notifyPhones(): Promise<void> {
    if (!phonePushAvailable()) return;
    await Promise.allSettled(this.#pairings().filter(peer => peer.push && !peer.account).map(async peer => {
      const result = await sendPhonePush(peer.push!);
      if (result === 'expired') this.#storage.setPreference(PAIRING_KEY, this.#pairings().map(current => {
        if (current.secretHash !== peer.secretHash || current.push?.token !== peer.push?.token) return current;
        const {push, ...rest} = current; return rest;
      }) as unknown as JsonValue);
    }));
  }
  readonly #storage: Storage;
  readonly #call: TeamHostServerOptions["call"];
  readonly #host: string;
  readonly #port: number;
  readonly #publicEndpoint: string | null;
  readonly #relayEndpoint: string | null;
  readonly #deviceRequestTimeoutMs: number;
  readonly #devicePollWaitMs: number;
  readonly #pairingSessionMs: number;
  readonly #pairingLockoutMs: number;
  readonly #adminSecretHash: string | null;
  readonly pairing = new DevicePairingSessions();
  readonly #onPeerApproved?: TeamHostServerOptions["onPeerApproved"];
  #server: Server | null = null;
  #relay: TeamHostRelay | null = null;
  #state: TeamHostServerSnapshot["state"] = "starting";
  #endpoint: string | null = null;
  #localEndpoint: string | null = null;
  readonly #deviceType: DeviceType;
  readonly #peerActivity = new Map<string, number>();
  #detail: string | null = null;
  #pairCode = "";
  #pairCodeExpiresAt = 0;
  #pairingEnabledUntil = 0;
  #connectCodeSync: Promise<void> = Promise.resolve();
  readonly #pairingFailures = new Map<string, {count: number; lockedUntil: number}>();
  readonly #deviceQueue: TeamDeviceRequest[] = [];
  readonly #devicePending = new Map<string, {
    resolve: (value: TeamDeviceResolution) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    deliveredTo: string | null;
  }>();
  readonly #deviceWaiters: Array<(value: TeamDeviceRequest | null) => void> = [];

  constructor(options: TeamHostServerOptions) {
    this.#storage = options.storage;
    // Preserve an existing valuable device grant once when moving to peer records.
    if (!this.#storage.getPreference(PAIRING_KEY)) {
      const legacy = this.#storage.getPreference('team.host-server-pairing')?.value;
      if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
        this.#storage.setPreference(PAIRING_KEY, [legacy]);
        this.#storage.setPreference('team.host-server-pairing', null);
      }
    }
    this.#deviceType = options.deviceType ?? 'server';
    this.#onPeerApproved = options.onPeerApproved;
    this.#call = options.call;
    this.#host = options.host ?? personalHostListenAddress();
    this.#port = options.port ?? 0;
    this.#publicEndpoint = options.publicEndpoint ?? null;
    this.#relayEndpoint = options.relayEndpoint ?? null;
    this.#deviceRequestTimeoutMs = options.deviceRequestTimeoutMs ?? 2 * 60_000;
    this.#devicePollWaitMs = options.devicePollWaitMs ?? 25_000;
    this.#pairingSessionMs = options.pairingSessionMs ?? PAIRING_SESSION_MS;
    this.#pairingLockoutMs = options.pairingLockoutMs ?? PAIRING_LOCKOUT_MS;
    this.#adminSecretHash = options.adminSecret ? hash(options.adminSecret) : null;
  }

  async start(): Promise<TeamHostServerSnapshot> {
    if (this.#server) return this.snapshot();
    this.#state = "starting";
    const server = createServer((request, response) => void this.#route(request, response));
    this.#server = server;
    server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => reject(error);
        server.once("error", failed);
        server.listen(this.#port, this.#host, () => {
          server.off("error", failed);
          resolve();
        });
      });
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : this.#port;
      const localEndpoint = `http://${displayHost(this.#host)}:${port}`;
      this.#localEndpoint = localEndpoint;
      this.#endpoint = this.#publicEndpoint ?? localEndpoint;
      this.#state = "listening";
      if (!this.#publicEndpoint && this.#relayEndpoint) {
        this.#relay = new TeamHostRelay({
          relayOrigin: this.#relayEndpoint,
          hostId: this.#hostId(),
          hostSecret: this.#relaySecret(),
          localEndpoint,
          onConnectionChange: (connected, detail) => {
            this.#detail = connected
              ? "Connected through Polymux Connect. No VPN is required."
              : detail;
          },
        });
        this.#endpoint = this.#relay.publicEndpoint;
        this.#detail = "Connecting through Polymux Connect…";
        try {
          await this.#relay.start();
        } catch (error) {
          this.#detail = `Polymux Connect is unavailable and will retry: ${error instanceof Error ? error.message : String(error)}`;
        }
      } else if (!this.#publicEndpoint) {
        this.#detail = "Loopback only. Configure Polymux Connect or a private HTTPS endpoint for another device.";
      } else {
        this.#detail = null;
      }
    } catch (error) {
      this.#state = "error";
      this.#detail = error instanceof Error ? error.message : String(error);
      await this.close();
    }
    return this.snapshot();
  }

  snapshot(): TeamHostServerSnapshot {
    const pairing = this.#pairing();
    const pairingCode = this.#activePairCode();
    return {
      state: this.#state,
      endpoint: this.#endpoint,
      localEndpoint: this.#localEndpoint,
      pairingCode,
      pairingExpiresAt: pairingCode
        ? new Date(Math.min(this.#pairCodeExpiresAt, this.#pairingEnabledUntil)).toISOString()
        : null,
      pairedDesktopName: pairing?.desktopName ?? null,
      detail: this.#detail,
      approvals: this.pairing.approvals(),
      deviceType: this.#deviceType,
      connectedDevices: this.#pairings().filter(p => !p.account).map(p => ({deviceId: p.desktopId, deviceName: p.desktopName, pairedAt: p.pairedAt, deviceType: p.deviceType, online: Date.now() - (this.#peerActivity.get(p.desktopId) ?? 0) < 60000})),
    };
  }

  resetPairing(): TeamHostServerSnapshot {
    this.#cancelDeviceRequests("Host pairing was reset.");
    this.#storage.setPreference(PAIRING_KEY, null);
    this.pairing.reset();
    this.beginPairing();
    return this.snapshot();
  }

  /** Pairing is accepted only after the user explicitly opens the Host flow. */
  beginPairing(preserveFailures = false): TeamHostServerSnapshot {
    // Rotating a code must never erase the attempt limit.
    void preserveFailures;
    this.#pairingEnabledUntil = Date.now() + this.#pairingSessionMs;
    this.#rotatePairCode();
    return this.snapshot();
  }

  paired(): boolean {
    return Boolean(this.#pairing());
  }

  async requestDevice(input: Omit<TeamDeviceRequest, "id" | "createdAt">): Promise<TeamDeviceResolution | null> {
    if (!this.#pairing()) return null;
    const request: TeamDeviceRequest = {
      ...input,
      requiresApproval: input.requiresApproval || input.capability !== 'team' && this.#pairings().length > 1,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    return new Promise<TeamDeviceResolution>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#devicePending.delete(request.id);
        const queued = this.#deviceQueue.findIndex((candidate) => candidate.id === request.id);
        if (queued >= 0) this.#deviceQueue.splice(queued, 1);
        reject(new Error("The paired laptop did not answer the device request in time."));
      }, this.#deviceRequestTimeoutMs);
      this.#devicePending.set(request.id, {resolve, reject, timer, deliveredTo: null});
      const waiter = this.#deviceWaiters.shift();
      if (waiter) waiter(request);
      else this.#deviceQueue.push(request);
    });
  }

  async close(): Promise<void> {
    this.#cancelDeviceRequests("Polymux Host stopped.");
    this.pairing.reset();
    const relay = this.#relay;
    if (relay) {
      await this.#connectCodeSync.catch(() => {});
      await relay.updateConnectCode(null, null).catch(() => {});
    }
    this.#relay = null;
    if (relay) await relay.close();
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // App shutdown must not be held open by an incomplete request body or a
      // device long-poll whose peer has stopped responding.
      server.closeAllConnections();
    });
  }

  async #route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    try {
      const url = new URL(request.url ?? "/", "http://polymux-host.local");
      this.#allowMobileOrigin(request, response);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/polymux-host/v1/health") {
        reply(response, 200, {
          ok: true,
          hostId: this.#hostId(),
          deviceName: hostname() || "Polymux Host",
          paired: Boolean(this.#pairing()),
          deviceType: this.#deviceType,
          apiVersion: 1,
          capabilities: ["assistant", "team", "hub", "runs", "uploads", "locker"],
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/polymux-host/v1/pair") {
        await this.#pair(request, response);
        return;
      }
      if (request.method === 'POST' && ['/polymux-host/v1/pair/status', '/polymux-host/v1/pair/cancel', '/polymux-host/v1/pair/ack'].includes(url.pathname)) {
        const body = await bodyRecord(request, 4096);
        try {
          const id = typeof body.id === 'string' ? body.id : '';
          const token = typeof body.token === 'string' ? body.token : '';
          if (url.pathname.endsWith('/ack')) { this.pairing.acknowledge(id, token); reply(response, 200, {ok: true}); }
          else if (url.pathname.endsWith('/cancel')) {
            const cancelled = this.pairing.cancel(id, token);
            if (cancelled?.credentials?.secret) this.revokePeer(cancelled.peer.deviceId, cancelled.credentials.secret);
            reply(response, 200, {ok: true});
          }
          else reply(response, 200, this.pairing.poll(id, token));
        } catch { reply(response, 401, {error: 'Pairing expired or cancelled.'}); }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/polymux-host/v1/admin/account') {
        if (!this.#adminAuthenticated(request)) { reply(response, 401, {error: 'Local administration is required for account sign-in.'}); return; }
        const body = await bodyRecord(request, 16 * 1024);
        try { reply(response, 200, {result: await this.#call('account.request', [body as JsonValue])}); }
        catch (error) { reply(response, 400, {error: error instanceof Error ? error.message : 'Account request failed.'}); }
        return;
      }
      if (request.method === 'POST' && url.pathname.startsWith('/polymux-host/v1/admin/devices/')) {
        if (!this.#adminAuthenticated(request)) { reply(response, 401, {error: 'Local approval required.'}); return; }
        const body = await bodyRecord(request, 4096);
        if (url.pathname.endsWith('/request')) {
          reply(response, 200, await this.#call('devices.request', [body as JsonValue]));
        } else if (url.pathname.endsWith('/approve')) {
          await this.approvePairing(String(body.id ?? ''), typeof body.number === 'string' ? body.number : null);
          reply(response, 200, {ok: true});
        } else if (url.pathname.endsWith('/status')) reply(response, 200, this.snapshot());
        else reply(response, 404, {error: 'Not found'});
        return;
      }
      if (request.method === "POST" && url.pathname === "/polymux-host/v1/admin/pairing") {
        if (!this.#adminAuthenticated(request)) {
          reply(response, 401, {error: "This CLI is not authorised to administer the Host."});
          return;
        }
        reply(response, 200, {host: this.beginPairing()});
        return;
      }
      if (request.method === "POST" && url.pathname === "/polymux-host/v1/rpc") {
        await this.#rpc(request, response);
        return;
      }
      if (request.method === "POST" && url.pathname === "/polymux-host/v1/device/next") {
        await this.#deviceNext(request, response);
        return;
      }
      if (request.method === "POST" && url.pathname === "/polymux-host/v1/device/resolve") {
        await this.#deviceResolve(request, response);
        return;
      }
      reply(response, 404, {error: "Not found"});
    } catch (error) {
      reply(response, 500, {error: error instanceof Error ? error.message : String(error)});
    }
  }

  async #pair(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await bodyRecord(request, 4096);
    const code = typeof body.code === "string" ? normalizeHostPairingCode(body.code) : "";
    const desktopId = typeof body.desktopId === "string" ? body.desktopId.trim() : "";
    const deviceName = typeof body.deviceName === "string" ? body.deviceName.trim() : "Polymux Desktop";
    const source = request.socket.remoteAddress ?? "unknown";
    const attempt = this.#pairingFailures.get(source);
    if (attempt && attempt.lockedUntil > Date.now()) {
      response.setHeader("retry-after", Math.max(1, Math.ceil((attempt.lockedUntil - Date.now()) / 1_000)));
      reply(response, 429, {error: "Pairing is locked after repeated failures. Open Devices to try again."});
      return;
    }
    const activeCode = this.#activePairCode();
    const invitation = typeof body.invitation === "string" ? body.invitation : "";
    const invitationValid = invitation ? this.pairing.consumeInvitation(invitation) : false;
    // Devices signed in to the same Polymux account pair with the secret the
    // host publishes to the account's device registry — no code exchange.
    const accountSecret = typeof body.accountSecret === "string" ? body.accountSecret.trim() : "";
    const accountAuthorized = accountSecret !== "" && this.#pairings().some(
      (record) => record.account === true && record.secretHash === hash(accountSecret),
    );
    if (!desktopId || !(invitationValid || (activeCode && code === activeCode) || accountAuthorized)) {
      const count = (attempt?.lockedUntil && attempt.lockedUntil <= Date.now() ? 0 : attempt?.count ?? 0) + 1;
      if (count >= MAX_PAIRING_FAILURES) {
        this.#pairingFailures.set(source, {count, lockedUntil: Date.now() + this.#pairingLockoutMs});
        this.#pairingEnabledUntil = 0;
        this.#clearPairCode();
        response.setHeader("retry-after", Math.ceil(this.#pairingLockoutMs / 1_000));
        reply(response, 429, {error: "Pairing was locked after repeated failures. Reopen Devices to generate a new code."});
      } else {
        this.#pairingFailures.set(source, {count, lockedUntil: 0});
        reply(response, activeCode ? 401 : 403, {
          error: activeCode
            ? "The pairing code is invalid or expired."
            : "Open Devices before connecting another device.",
        });
      }
      return;
    }
    const peer: DevicePeer = {deviceId: desktopId, deviceName: deviceName.slice(0, 120), deviceType: deviceType(body.deviceType)};
    if (body.peer && typeof body.peer === 'object' && !Array.isArray(body.peer)) {
      const remote = body.peer as Record<string, unknown>;
      if (typeof remote.endpoint !== 'string' || typeof remote.hostId !== 'string' || typeof remote.secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(remote.secret)) {
        reply(response, 400, {error: 'Invalid reciprocal device identity.'}); return;
      }
      const endpoint = new URL(remote.endpoint);
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
      if ((endpoint.protocol !== 'https:' && !(loopback && endpoint.protocol === 'http:')) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || remote.hostId === this.#hostId()) {
        reply(response, 400, {error: 'Invalid device endpoint.'}); return;
      }
      peer.deviceId = remote.hostId;
      peer.endpoint = remote.endpoint; peer.hostId = remote.hostId; peer.secret = remote.secret;
    }
    if (accountAuthorized) {
      // Both sides are already trusted by the account, so approval is instant
      // and the peer learns its long-lived credential straight away.
      try {
        const credentials = await this.#approveAccountPeer(peer);
        reply(response, 200, {...credentials, endpoint: this.#endpoint, deviceName: hostname(), deviceType: this.#deviceType});
      } catch (error) {
        reply(response, 429, {error: error instanceof Error ? error.message : 'Account pairing unavailable.'});
      }
      return;
    }
    try {
      const challenge = this.pairing.create(peer);
      this.#clearPairCode();
      this.#pairingEnabledUntil = 0;
      reply(response, 202, {...challenge, hostId: this.#hostId(), endpoint: this.#endpoint, deviceName: hostname(), deviceType: this.#deviceType});
    } catch (error) {
      reply(response, 429, {error: error instanceof Error ? error.message : 'Pairing unavailable.'});
    }
  }

  async #approveAccountPeer(peer: DevicePeer): Promise<{hostId: string; pairedAt: string; secret: string; deviceType: DeviceType}> {
    const secret = randomBytes(32).toString('base64url');
    if (peer.endpoint) await this.#onPeerApproved?.(peer);
    this.authorizePeer(peer.deviceId, peer.deviceName, secret, peer.deviceType);
    return {hostId: this.#hostId(), pairedAt: new Date().toISOString(), secret, deviceType: this.#deviceType};
  }

  async approvePairing(id: string, number: string | null): Promise<void> {
    await this.pairing.approve(id, number, async (peer, assertActive) => {
      const secret = randomBytes(32).toString('base64url');
      if (peer.endpoint) await this.#onPeerApproved?.(peer);
      assertActive();
      const pairedAt = new Date().toISOString();
      this.authorizePeer(peer.deviceId, peer.deviceName, secret, peer.deviceType);
      return {hostId: this.#hostId(), deviceName: hostname(), pairedAt, secret, deviceType: this.#deviceType};
    });
  }

  authorizePeer(deviceId: string, deviceName: string, secret: string, type?: DeviceType): void {
    const records = this.#pairings().filter(peer => peer.desktopId !== deviceId);
    this.#peerActivity.set(deviceId, Date.now());
    records.push({deviceType: type, version: 1, desktopId: deviceId, desktopName: deviceName, secretHash: hash(secret), pairedAt: new Date().toISOString()});
    this.#storage.setPreference(PAIRING_KEY, records as unknown as JsonValue);
  }

  /** Trusts the account pairing secret published to the user's device
   * registry, so devices signed in to the same account can pair without a
   * code. Only ever one placeholder record; per-peer records are separate. */
  authorizeAccountPeer(secret: string): void {
    const records = this.#pairings().filter(peer => peer.account !== true);
    records.push({version: 1, desktopId: "account", desktopName: "Account devices", secretHash: hash(secret), pairedAt: new Date().toISOString(), account: true});
    this.#storage.setPreference(PAIRING_KEY, records as unknown as JsonValue);
  }

  revokeAccountPeer(): void {
    this.#storage.setPreference(PAIRING_KEY, this.#pairings().filter(peer => peer.account !== true) as unknown as JsonValue);
  }

  revokePeer(deviceId: string, secret?: string): void {
    this.#storage.setPreference(PAIRING_KEY, this.#pairings().filter(peer => peer.desktopId !== deviceId || secret !== undefined && peer.secretHash !== hash(secret)) as unknown as JsonValue);
  }

  async #rpc(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.#authenticated(request) && !this.#adminAuthenticated(request)) {
      reply(response, 401, {error: "This client is not authorised to use the Host."});
      return;
    }
    const body = await bodyRecord(request, MAX_RPC_BODY_BYTES);
    const peer = this.#authenticatedPeer(request);
    const reportedType = deviceType(body.deviceType);
    if (peer && reportedType && peer.deviceType !== reportedType) this.#storage.setPreference(PAIRING_KEY, this.#pairings().map(record => record.desktopId === peer.desktopId ? {...record, deviceType: reportedType} : record) as unknown as JsonValue);
    const method = typeof body.method === "string" ? body.method : "";
    const args = Array.isArray(body.args) ? body.args as JsonValue[] : [];
    if (method === 'notifications.status') {
      reply(response, 200, {result: {available: phonePushAvailable(), enabled: Boolean(peer?.push)}}); return;
    }
    if (method === 'notifications.register' || method === 'notifications.unregister') {
      if (!peer || peer.account) { reply(response, 403, {error: 'Pair this phone before enabling notifications.'}); return; }
      const push = method === 'notifications.register' ? parsePhonePush(args[0]) : null;
      if (method === 'notifications.register' && (!push || !phonePushAvailable())) {
        reply(response, 400, {error: 'Phone notifications are not configured on this Host.'}); return;
      }
      this.#storage.setPreference(PAIRING_KEY, this.#pairings().map(current => {
        if (current.secretHash !== peer.secretHash) return current;
        const {push: previous, ...rest} = current;
        return push ? {...rest, push} : rest;
      }) as unknown as JsonValue);
      reply(response, 200, {result: {enabled: Boolean(push)}}); return;
    }
    if (!HOST_METHODS.has(method)) {
      reply(response, 404, {error: "That Host method is not available."});
      return;
    }
    try {
      reply(response, 200, {result: method === 'devices.info' ? {deviceType: this.#deviceType} : await this.#call(method, args)});
    } catch (error) {
      reply(response, 400, {error: error instanceof Error ? error.message : String(error)});
    }
  }

  async #deviceNext(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.#authenticated(request)) {
      reply(response, 401, {error: "This Desktop is not paired to the Host."});
      return;
    }
    const queued = this.#deviceQueue.shift();
    if (queued) {
      const pending = this.#devicePending.get(queued.id);
      if (pending) pending.deliveredTo = this.#authenticatedPeer(request)?.secretHash ?? null;
      reply(response, 200, {request: queued});
      return;
    }
    const next = await new Promise<TeamDeviceRequest | null>((resolve) => {
      const timer = setTimeout(() => {
        const index = this.#deviceWaiters.indexOf(deliver);
        if (index >= 0) this.#deviceWaiters.splice(index, 1);
        resolve(null);
      }, this.#devicePollWaitMs);
      const deliver = (value: TeamDeviceRequest | null) => {
        clearTimeout(timer);
        resolve(value);
      };
      this.#deviceWaiters.push(deliver);
    });
    const peer = this.#authenticatedPeer(request);
    if (!peer) { reply(response, 401, {error: 'Device access was revoked.'}); return; }
    if (next) { const pending = this.#devicePending.get(next.id); if (pending) pending.deliveredTo = peer.secretHash; }
    reply(response, 200, {request: next});
  }

  async #deviceResolve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.#authenticated(request)) {
      reply(response, 401, {error: "This Desktop is not paired to the Host."});
      return;
    }
    const body = await bodyRecord(request);
    const id = typeof body.id === "string" ? body.id : "";
    const pending = this.#devicePending.get(id);
    if (!pending) {
      reply(response, 404, {error: "That device request is no longer waiting."});
      return;
    }
    if (pending.deliveredTo !== this.#authenticatedPeer(request)?.secretHash) {
      reply(response, 403, {error: 'This request belongs to another device.'}); return;
    }
    this.#devicePending.delete(id);
    clearTimeout(pending.timer);
    const result = body.result && typeof body.result === "object" && !Array.isArray(body.result)
      ? body.result as unknown as AgentToolResult
      : {content: "The paired laptop returned an invalid tool result.", isError: true};
    pending.resolve({approved: body.approved === true, result});
    reply(response, 200, {ok: true});
  }

  #authenticated(request: IncomingMessage): boolean { return Boolean(this.#authenticatedPeer(request)); }
  #authenticatedPeer(request: IncomingMessage): PairingRecord | undefined {
    const authorization = request.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    const peer = token ? this.#pairings().find(pairing => hash(token) === pairing.secretHash) : undefined;
    if (peer) this.#peerActivity.set(peer.desktopId, Date.now());
    return peer;
  }

  #allowMobileOrigin(request: IncomingMessage, response: ServerResponse): void {
    const origin = request.headers.origin ?? "";
    if (!MOBILE_ORIGINS.has(origin)) return;
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader("access-control-allow-headers", "authorization, content-type");
    response.setHeader("vary", "origin");
  }

  #adminAuthenticated(request: IncomingMessage): boolean {
    const authorization = request.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    return Boolean(this.#adminSecretHash && token && hash(token) === this.#adminSecretHash);
  }

  #pairings(): PairingRecord[] {
    const value = this.#storage.getPreference(PAIRING_KEY)?.value;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is unknown & PairingRecord & JsonValue => Boolean(item && typeof item === 'object' && !Array.isArray(item) && item.version === 1 && typeof item.desktopId === 'string' && typeof item.desktopName === 'string' && typeof item.secretHash === 'string' && typeof item.pairedAt === 'string')) as unknown as PairingRecord[];
  }
  #pairing(): PairingRecord | null { return this.#pairings()[0] ?? null; }

  #activePairCode(): string | null {
    if (Date.now() >= this.#pairingEnabledUntil) {
      this.#clearPairCode();
      return null;
    }
    if (!this.#pairCode || Date.now() >= this.#pairCodeExpiresAt) this.#rotatePairCode();
    return this.#pairCode;
  }

  #rotatePairCode(): void {
    this.#pairCode = createHostPairingCode((max) => randomInt(max));
    this.#pairCodeExpiresAt = Date.now() + PAIRING_CODE_MS;
    this.#syncConnectCode(this.#pairCode, Math.min(this.#pairCodeExpiresAt, this.#pairingEnabledUntil));
  }

  #clearPairCode(): void {
    if (!this.#pairCode && !this.#pairCodeExpiresAt) return;
    this.#pairCode = "";
    this.#pairCodeExpiresAt = 0;
    this.#syncConnectCode(null, null);
  }

  #syncConnectCode(code: string | null, expiresAt: number | null): void {
    const relay = this.#relay;
    if (!relay) return;
    this.#connectCodeSync = this.#connectCodeSync.then(async () => {
      if (this.#relay !== relay) return;
      const published = await relay.updateConnectCode(code, expiresAt);
      if (!published && code && this.#pairCode === code) this.#rotatePairCode();
    }).catch((error) => {
      if (this.#relay !== relay) return;
      this.#detail = `Connected, but the connect code could not be published: ${error instanceof Error ? error.message : String(error)}`;
    });
  }

  #hostId(): string {
    const current = this.#storage.getPreference("team.local-host-id")?.value;
    if (typeof current === "string" && current) return current;
    const value = randomUUID();
    this.#storage.setPreference("team.local-host-id", value);
    return value;
  }

  #relaySecret(): string {
    const current = this.#storage.getPreference(RELAY_SECRET_KEY)?.value;
    if (typeof current === "string" && current.length >= 32) return current;
    const value = randomBytes(32).toString("base64url");
    this.#storage.setPreference(RELAY_SECRET_KEY, value);
    return value;
  }

  #cancelDeviceRequests(message: string): void {
    this.#deviceQueue.splice(0);
    for (const pending of this.#devicePending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.#devicePending.clear();
    for (const waiter of this.#deviceWaiters.splice(0)) waiter(null);
  }
}

export class TeamHostClient {
  constructor(
    readonly endpoint: string,
    readonly secret: string,
    readonly deviceType?: DeviceType,
  ) {}

  async call<T>(method: string, args: JsonValue[] = []): Promise<T> {
    const response = await fetch(`${this.endpoint}/polymux-host/v1/rpc`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({method, args, deviceType: this.deviceType}),
      signal: AbortSignal.timeout(30_000),
    });
    const value = await response.json() as {result?: T; error?: string};
    if (!response.ok) throw new Error(value.error ?? `Polymux Host returned ${response.status}`);
    return value.result as T;
  }

  async beginPairing(): Promise<TeamHostServerSnapshot> {
    const response = await fetch(`${this.endpoint}/polymux-host/v1/admin/pairing`, {
      method: "POST",
      headers: {authorization: `Bearer ${this.secret}`},
      signal: AbortSignal.timeout(10_000),
    });
    const value = await response.json() as {host?: TeamHostServerSnapshot; error?: string};
    if (!response.ok) throw new Error(value.error ?? `Polymux Host returned ${response.status}`);
    if (!value.host) throw new Error("Polymux Host returned no pairing state");
    return value.host;
  }

  async nextDeviceRequest(): Promise<TeamDeviceRequest | null> {
    const response = await fetch(`${this.endpoint}/polymux-host/v1/device/next`, {
      method: "POST",
      headers: {authorization: `Bearer ${this.secret}`},
      signal: AbortSignal.timeout(30_000),
    });
    const value = await response.json() as {request?: TeamDeviceRequest | null; error?: string};
    if (!response.ok) throw new Error(value.error ?? `Polymux Host returned ${response.status}`);
    return value.request ?? null;
  }

  async resolveDeviceRequest(id: string, approved: boolean, result: AgentToolResult): Promise<void> {
    const response = await fetch(`${this.endpoint}/polymux-host/v1/device/resolve`, {
      method: "POST",
      headers: {authorization: `Bearer ${this.secret}`, "content-type": "application/json"},
      body: JSON.stringify({id, approved, result}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const value = await response.json().catch(() => ({})) as {error?: string};
      throw new Error(value.error ?? `Polymux Host returned ${response.status}`);
    }
  }
}

const HOST_METHODS = new Set([
  "devices.info", "assistant.ensure", "conversations.updateMessage", "conversations.duplicate", "conversations.fork", "goals.get", "goals.execute",
  "team.list", "team.profiles", "team.create", "team.update", "team.markRead", "team.remove",
  "team.export", "team.import",
  "team.send", "team.sendExternal", "team.startComputer", "team.stopComputer", "team.leases",
  "team.grantLease", "team.revokeLease", "conversations.list", "conversations.listArchived",
  "conversations.create", "conversations.rename", "conversations.archive", "conversations.unarchive",
  "conversations.remove", "conversations.messages", "conversations.upload",
  "hub.chats", "hub.messages", "hub.markRead", "hub.send", "hub.sendFiles",
  "hub.emailAccounts", "hub.saveEmailAccount", "hub.removeEmailAccount", "hub.testEmailAccount",
  "runs.start", "runs.active", "runs.activeAll", "runs.cancel", "runs.steer", "runs.events",
  "runs.configuration", "runs.configure", "runs.updates", "models.list",
  ...LOCKER_HOST_METHODS,
]);

const MOBILE_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
]);

async function bodyRecord(
  request: IncomingMessage,
  maximumBytes = MAX_BODY_BYTES,
): Promise<Record<string, JsonValue>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) throw new Error("Host request is too large");
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Host request must be an object");
  return value as Record<string, JsonValue>;
}

function reply(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {"content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body)});
  response.end(body);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function displayHost(value: string): string {
  return value === "0.0.0.0" || value === "::" ? "127.0.0.1" : value;
}

/** The local listener never needs to be reachable from the public network. */
export function personalHostListenAddress(): string {
  return "127.0.0.1";
}
