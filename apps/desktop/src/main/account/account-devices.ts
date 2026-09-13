import {randomBytes} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {CredentialStore} from "@earendil-works/pi-ai";
import {deviceType as parseDeviceType} from "@polymux/protocol";
import type {TeamHostServer} from "../team/host-server.js";
import type {TeamService} from "../team/service.js";
import {AccountService} from "./account-service.js";

const HEARTBEAT_MS = 15_000;
const REGISTRY_TIMEOUT_MS = 5_000;
/** Rows older than this are treated as asleep and are not auto-connected to. */
const ONLINE_WINDOW_MS = 45_000;
const SECRET_CREDENTIAL_ID = "polymux-account:device-pairing";

interface DeviceRow {
  user_id: string;
  device_id: string;
  device_name: string;
  device_type?: string | null;
  platform?: string | null;
  app_version?: string | null;
  host_id?: string | null;
  host_name?: string | null;
  pairing_secret?: string | null;
  public_endpoint?: string | null;
  last_heartbeat: string;
}

export interface AccountDevicesOptions {
  service: AccountService;
  team: TeamService;
  hostServer: TeamHostServer;
  credentials: CredentialStore;
  appVersion: string;
  /** Called whenever auto-connect changes the configured Team Hosts. */
  onHostsChanged: () => void;
}

/**
 * Keeps the signed-in installation present in the account's device registry
 * and connects to the other devices registered there. Each device publishes
 * its host id plus a pairing secret that row-level security scopes to the
 * account, so signed-in devices pair without a code while everyone else is
 * still turned away by the ordinary pairing gate.
 */
export class AccountDevices {
  readonly #service: AccountService;
  readonly #team: TeamService;
  readonly #hostServer: TeamHostServer;
  readonly #credentials: CredentialStore;
  readonly #appVersion: string;
  readonly #onHostsChanged: AccountDevicesOptions["onHostsChanged"];
  #timer: ReturnType<typeof setInterval> | undefined;
  #tick: Promise<void> | null = null;
  #secret: {userId: string; value: string} | null = null;
  #generation = 0;
  #enabled = false;
  #registered = false;
  #error: string | null = null;

  constructor(options: AccountDevicesOptions) {
    this.#service = options.service;
    this.#team = options.team;
    this.#hostServer = options.hostServer;
    this.#credentials = options.credentials;
    this.#appVersion = options.appVersion;
    this.#onHostsChanged = options.onHostsChanged;
  }

  start(): void {
    this.#enabled = true;
    this.#timer ??= setInterval(() => {
      if (this.#tick) return;
      this.#tick = this.#beat().finally(() => this.#tick = null);
    }, HEARTBEAT_MS);
    this.#timer.unref?.();
    if (!this.#tick) this.#tick = this.#beat().finally(() => this.#tick = null);
  }

  stop(): void {
    this.#generation += 1;
    this.#enabled = false;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  status(): {registered: boolean; syncing: boolean; error: string | null} {
    return {registered: this.#registered, syncing: Boolean(this.#tick), error: this.#error};
  }

  async sync(): Promise<void> {
    if (!this.#enabled) return;
    this.#tick ??= this.#beat().finally(() => this.#tick = null);
    await this.#tick;
  }

  async close(): Promise<void> {
    this.stop();
    await this.#tick;
  }

  /** Removes this installation from the registry when the user signs out. */
  async withdraw(): Promise<void> {
    const client = this.#service.client;
    const userId = this.#service.status().profile?.userId;
    // Revoke synchronously before waiting for any in-flight network work.
    this.revoke();
    await this.close();
    if (userId) await this.#credentials.delete(`${SECRET_CREDENTIAL_ID}:${userId}`);
    this.#secret = null;
    if (!client || !userId) return;
    try {
      const {error} = await client.from("devices").delete()
        .eq("user_id", userId)
        .eq("device_id", this.#team.localHost().desktopId)
        .abortSignal(AbortSignal.timeout(REGISTRY_TIMEOUT_MS));
      if (error) throw new Error(error.message);
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
      throw new Error(`Account device withdrawal failed: ${this.#error}`);
    }
  }

  /** Local revocation also works after an expired session signs out itself. */
  revoke(): void {
    this.stop();
    this.#secret = null;
    this.#registered = false;
    this.#hostServer.revokeAccountPeer();
  }

  async #beat(): Promise<void> {
    const status = this.#service.status();
    const client = this.#service.client;
    const profile = status.profile;
    const generation = this.#generation;
    const current = () => this.#enabled && this.#generation === generation && this.#service.status().profile?.userId === profile?.userId;
    if (!this.#enabled || !status.signedIn || !client || !profile) return;
    try {
      this.#error = null;
      const secret = await this.#pairingSecret(profile.userId);
      if (!current()) return;
      const local = this.#team.localHost();
      const endpoint = this.#hostServer.snapshot().endpoint;
      const row: DeviceRow = {
        user_id: profile.userId,
        device_id: local.desktopId,
        device_name: local.deviceName,
        device_type: local.deviceType,
        platform: process.platform,
        app_version: this.#appVersion,
        host_id: endpoint?.startsWith("https://") ? local.hostId : null,
        host_name: endpoint?.startsWith("https://") ? local.deviceName : null,
        pairing_secret: endpoint?.startsWith("https://") ? secret : null,
        public_endpoint: endpoint?.startsWith("https://") ? endpoint : null,
        last_heartbeat: new Date().toISOString(),
      };
      const {error} = await client.from("devices").upsert(row, {onConflict: "user_id,device_id"})
        .abortSignal(AbortSignal.timeout(REGISTRY_TIMEOUT_MS));
      if (!current()) return;
      if (error) {
        this.#error = error.message;
        console.warn("Account device heartbeat failed:", error.message);
        return;
      }
      this.#registered = true;
      // Only a successfully published capability for the current account may
      // open the local pairing gate. A stale outgoing row cannot re-arm it.
      this.#hostServer.authorizeAccountPeer(secret);
      await this.#connectPeers(client, profile.userId, local, secret, current);
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
      console.warn("Account device sync failed:", error instanceof Error ? error.message : error);
    }
  }

  async #connectPeers(
    client: SupabaseClient,
    userId: string,
    local: ReturnType<TeamService["localHost"]>,
    secret: string,
    current: () => boolean,
  ): Promise<void> {
    const {data, error} = await client.from("devices").select("*").eq("user_id", userId)
      .abortSignal(AbortSignal.timeout(REGISTRY_TIMEOUT_MS));
    if (!current()) return;
    if (error) {
      this.#error = error.message;
      console.warn("Account device discovery failed:", error.message);
      return;
    }
    const rows = (Array.isArray(data) ? data : []) as DeviceRow[];
    const cutoff = Date.now() - ONLINE_WINDOW_MS;
    const known = new Set(this.#team.hosts().map((host) => host.hostId));
    for (const row of rows) {
      if (!current()) return;
      if (row.user_id !== userId) continue;
      if (row.device_id === local.desktopId) continue;
      if (!row.host_id || !row.pairing_secret || !row.public_endpoint) continue;
      if (known.has(row.host_id)) continue;
      if (Date.parse(row.last_heartbeat) < cutoff) continue;
      try {
        await this.#connectPeer(row, local, secret, current);
        known.add(row.host_id);
      } catch (error) {
        this.#error = error instanceof Error ? error.message : String(error);
        console.warn(`Account device connect to ${row.device_name} failed:`, error instanceof Error ? error.message : error);
      }
    }
  }

  async #connectPeer(
    row: DeviceRow,
    local: ReturnType<TeamService["localHost"]>,
    secret: string,
    current: () => boolean,
  ): Promise<void> {
    if (!current()) return;
    const snapshot = this.#hostServer.snapshot();
    const response = await fetch(`${row.public_endpoint}/polymux-host/v1/pair`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        accountSecret: row.pairing_secret,
        desktopId: local.desktopId,
        deviceName: local.deviceName,
        deviceType: local.deviceType,
        // Advertise our own endpoint so the other side registers us too,
        // mirroring the reciprocal step of the number-match pairing flow.
        peer: snapshot.endpoint?.startsWith("https://")
          ? {endpoint: snapshot.endpoint, hostId: local.hostId, secret}
          : undefined,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const value = await response.json() as Record<string, unknown>;
    if (!current()) return;
    if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "Account pairing failed.");
    if (value.hostId !== row.host_id || typeof value.secret !== "string") throw new Error("Device identity changed during pairing.");
    await this.#team.savePeerConnection(row.public_endpoint, {
      hostId: row.host_id,
      deviceName: row.host_name || row.device_name,
      secret: value.secret,
      deviceType: parseDeviceType(value.deviceType),
    });
    this.#onHostsChanged();
  }

  async #pairingSecret(userId: string): Promise<string> {
    if (this.#secret?.userId === userId) return this.#secret.value;
    const credentialId = `${SECRET_CREDENTIAL_ID}:${userId}`;
    const stored = await this.#credentials.read(credentialId);
    if (typeof stored?.key === "string" && stored.key) {
      this.#secret = {userId, value: stored.key};
      return stored.key;
    }
    const created = randomBytes(32).toString("base64url");
    await this.#credentials.modify(credentialId, async () => ({type: "api_key", key: created}));
    this.#secret = {userId, value: created};
    return created;
  }
}
