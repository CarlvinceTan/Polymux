import { randomUUID } from "node:crypto";
import type { JsonValue } from "@polymux/protocol";
import { AccountService } from "../../../apps/desktop/src/main/account/account-service.js";
import { AccountDevices } from "../../../apps/desktop/src/main/account/account-devices.js";
import type { TeamService } from "../../../apps/desktop/src/main/team/service.js";
import type { TeamHostServer } from "../../../apps/desktop/src/main/team/host-server.js";
import { HeadlessCredentialStore } from "./credentials.js";

export interface HostAccountOptions {
  url: string | null;
  anonKey: string | null;
  credentialFile: string;
  adminSecret: string;
  team: TeamService;
  server: TeamHostServer;
  appVersion: string;
}

/** The daemon is the sole owner of refresh tokens and account device discovery. */
export class HostAccount {
  readonly service: AccountService;
  readonly devices: AccountDevices;
  private pending?: { id: string; expiresAt: number };
  private operation: Promise<unknown> | null = null;
  private closed = false;
  private readonly credentials: HeadlessCredentialStore;

  constructor(private readonly options: HostAccountOptions) {
    const credentials = new HeadlessCredentialStore(
      options.credentialFile,
      options.adminSecret,
    );
    this.credentials = credentials;
    this.service = new AccountService({
      url: options.url,
      anonKey: options.anonKey,
      credentials,
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            ...(init?.signal ? [init.signal] : []),
            AbortSignal.timeout(15_000),
          ]),
        }),
      openExternal: () => {
        throw new Error("Use polymux auth login google or apple.");
      },
      onBeforeSessionChange: () => this.devices.withdraw(),
      onSignedIn: () => {},
      onSignedOut: () => {
        this.devices?.revoke();
        options.server.revokeAccountPeer();
      },
    });
    this.devices = new AccountDevices({
      service: this.service,
      team: options.team,
      hostServer: options.server,
      credentials,
      appVersion: options.appVersion,
      onHostsChanged: () => options.team.publish(),
    });
  }

  async restore(): Promise<void> {
    await this.service.restore();
    if (this.service.status().signedIn) this.devices.start();
    else this.options.server.revokeAccountPeer();
  }

  status(): JsonValue {
    return {
      ...this.service.status(),
      device: this.devices.status(),
      connectedDevices: this.options.server.snapshot().connectedDevices,
    } as unknown as JsonValue;
  }

  async request(value: unknown): Promise<JsonValue> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Expected an account request.");
    const request = value as Record<string, unknown>;
    if (request.action === "status") return this.status();
    if (this.closed) throw new Error("Host is shutting down.");
    if (this.operation)
      throw new Error("Another account operation is already running.");
    const operation = this.perform(request);
    this.operation = operation;
    try {
      return await operation;
    } finally {
      this.operation = null;
    }
  }

  private async perform(request: Record<string, unknown>): Promise<JsonValue> {
    switch (request.action) {
      case "login": {
        this.requireSignedOut();
        if (this.pending && this.pending.expiresAt > Date.now())
          throw new Error("A browser sign-in is already in progress.");
        if (request.provider === "email") {
          const email = required(request.email, "Email");
          const password = required(request.password, "Password");
          const result = await this.service.signInWithPassword(email, password);
          if (result.error || !result.signedIn)
            throw new Error(result.error || "Sign-in did not complete.");
          await this.link();
          return this.status();
        }
        if (request.provider !== "google" && request.provider !== "apple")
          throw new Error("Choose google, apple, or email.");
        const url = await this.service.beginOAuth(request.provider);
        this.pending = { id: randomUUID(), expiresAt: Date.now() + 5 * 60_000 };
        return { ...this.pending, url };
      }
      case "complete": {
        if (
          !this.pending ||
          request.id !== this.pending.id ||
          Date.now() >= this.pending.expiresAt
        )
          throw new Error(
            "Sign-in expired or was cancelled. Start login again.",
          );
        this.pending = undefined;
        const result = await this.service.completeOAuth(
          required(request.code, "Authorization code"),
        );
        if (result.error || !result.signedIn)
          throw new Error(result.error || "Sign-in did not complete.");
        await this.link();
        return this.status();
      }
      case "cancel":
        if (this.pending && request.id === this.pending.id)
          this.pending = undefined;
        return this.status();
      case "sync":
        if (!this.service.status().signedIn)
          throw new Error("Sign in with polymux auth login first.");
        await this.link();
        return this.status();
      case "logout":
        this.pending = undefined;
        await this.service.signOut("local");
        return this.status();
      default:
        throw new Error("Unknown account command.");
    }
  }

  private requireSignedOut(): void {
    if (!this.service.status().available)
      throw new Error(
        "Account sign-in is not configured. Set POLYMUX_SUPABASE_URL and POLYMUX_SUPABASE_ANON_KEY for the Host, then restart it.",
      );
    if (this.service.status().signedIn)
      throw new Error(
        "This Host is already signed in. Use polymux auth status, or logout before changing accounts.",
      );
  }

  private async link(): Promise<void> {
    this.devices.start();
    await this.devices.sync();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.pending = undefined;
    await this.operation?.catch(() => {});
    await this.devices.close();
    await this.service.close();
    await this.credentials.flush();
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 8192)
    throw new Error(`${label} is required.`);
  return value;
}
