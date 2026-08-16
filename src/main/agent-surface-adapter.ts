import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Adapter for the user's Agent Surface installation — the local presentation
 * layer whose macOS menu-bar app replicates the ChatGPT desktop Computer Use
 * pill (capsule status item, overlapping app icons, and the native
 * `Stop Using <App>` menu).
 *
 * FlareAI publishes expiring `window` leases to the loopback service on
 * `127.0.0.1:47652` while it is driving something the user can see (for now,
 * browser control through the FlareAI extension), refreshes them while the work
 * continues, and releases them when it stops. Choosing `Stop Using <App>` in
 * the menu turns into a stop request that this adapter polls and hands back
 * to FlareAI so the owning run is actually cancelled.
 *
 * Everything degrades to a no-op when Agent Surface is not installed or the
 * service is not running: the mutation token in `~/.agent-surface/token` is
 * the capability, and every request failure is swallowed.
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:47652";
const DEFAULT_TTL_MS = 15_000;
const DEFAULT_REFRESH_MS = 5_000;
const DEFAULT_STOP_POLL_MS = 2_000;

export interface AgentSurfaceAdapterOptions {
  baseUrl?: string;
  tokenPath?: string;
  agentId?: string;
  agentName?: string;
  ttlMs?: number;
  refreshMs?: number;
  stopPollMs?: number;
  /** Called with the lease's sessionId when the user asks FlareAI to stop. */
  onStop?: (sessionId: string) => void;
}

export interface WindowLeaseInput {
  appName: string;
  bundleId?: string;
  windowTitle?: string;
  /** Identifier handed back through stop requests. */
  sessionId: string;
}

export class AgentSurfaceAdapter {
  readonly #baseUrl: string;
  readonly #tokenPath: string;
  readonly #agentId: string;
  readonly #agentName: string;
  readonly #ttlMs: number;
  readonly #refreshMs: number;
  readonly #stopPollMs: number;
  readonly #onStop?: (sessionId: string) => void;
  readonly #held = new Map<string, WindowLeaseInput>();
  #refreshTimer: ReturnType<typeof setInterval> | null = null;
  #stopTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AgentSurfaceAdapterOptions = {}) {
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#tokenPath =
      options.tokenPath ?? path.join(homedir(), ".agent-surface", "token");
    this.#agentId = options.agentId ?? "flareai";
    this.#agentName = options.agentName ?? "FlareAI";
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#refreshMs = options.refreshMs ?? DEFAULT_REFRESH_MS;
    this.#stopPollMs = options.stopPollMs ?? DEFAULT_STOP_POLL_MS;
    this.#onStop = options.onStop;
  }

  /** Whether an Agent Surface installation is present at all. */
  available(): boolean {
    return this.#token() !== null;
  }

  async acquireWindow(id: string, input: WindowLeaseInput): Promise<boolean> {
    if (!this.available()) return false;
    this.#held.set(id, input);
    const ok = await this.#publish(id, input);
    this.#ensureTimers();
    return ok;
  }

  async release(id: string): Promise<void> {
    if (!this.#held.delete(id)) return;
    this.#ensureTimers();
    await this.#request("DELETE", `/v1/leases/${encodeURIComponent(id)}`);
  }

  async releaseAll(): Promise<void> {
    const ids = [...this.#held.keys()];
    await Promise.all(ids.map((id) => this.release(id)));
  }

  close(): void {
    if (this.#refreshTimer) clearInterval(this.#refreshTimer);
    if (this.#stopTimer) clearInterval(this.#stopTimer);
    this.#refreshTimer = null;
    this.#stopTimer = null;
    void this.releaseAll();
  }

  #ensureTimers(): void {
    const active = this.#held.size > 0;
    if (active && !this.#refreshTimer) {
      this.#refreshTimer = setInterval(() => {
        for (const [id, input] of this.#held) void this.#publish(id, input);
      }, this.#refreshMs);
      this.#refreshTimer.unref?.();
    }
    if (active && !this.#stopTimer) {
      this.#stopTimer = setInterval(() => void this.#pollStops(), this.#stopPollMs);
      this.#stopTimer.unref?.();
    }
    if (!active) {
      if (this.#refreshTimer) clearInterval(this.#refreshTimer);
      if (this.#stopTimer) clearInterval(this.#stopTimer);
      this.#refreshTimer = null;
      this.#stopTimer = null;
    }
  }

  async #publish(id: string, input: WindowLeaseInput): Promise<boolean> {
    const response = await this.#request(
      "PUT",
      `/v1/leases/${encodeURIComponent(id)}`,
      {
        agent: { id: this.#agentId, name: this.#agentName },
        kind: "window",
        state: "active",
        app: {
          name: input.appName,
          ...(input.bundleId ? { bundleId: input.bundleId } : {}),
        },
        ...(input.windowTitle ? { window: { title: input.windowTitle } } : {}),
        control: { sessionId: input.sessionId },
        ttlMs: this.#ttlMs,
      },
    );
    return response !== null;
  }

  async #pollStops(): Promise<void> {
    const response = await this.#request(
      "GET",
      `/v1/stop-requests?agent=${encodeURIComponent(this.#agentId)}`,
    );
    if (!response) return;
    const requests = Array.isArray(
      (response as { requests?: unknown }).requests,
    )
      ? ((response as { requests: Array<Record<string, unknown>> }).requests)
      : [];
    for (const request of requests) {
      const id = typeof request.id === "string" ? request.id : null;
      const target = typeof request.target === "string" ? request.target : null;
      if (!id) continue;
      // Acknowledge first so a throwing handler cannot wedge the queue.
      await this.#request(
        "DELETE",
        `/v1/stop-requests/${encodeURIComponent(id)}`,
      );
      this.#held.delete(id);
      this.#ensureTimers();
      if (target && this.#onStop) {
        try {
          this.#onStop(target);
        } catch {
          // The stop already happened from the service's perspective.
        }
      }
    }
  }

  #token(): string | null {
    try {
      const value = readFileSync(this.#tokenPath, "utf8").trim();
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  async #request(
    method: string,
    pathname: string,
    body?: unknown,
  ): Promise<unknown | null> {
    const token = this.#token();
    if (!token) return null;
    try {
      const response = await fetch(`${this.#baseUrl}${pathname}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) return null;
      return (await response.json().catch(() => ({}))) as unknown;
    } catch {
      return null;
    }
  }
}
