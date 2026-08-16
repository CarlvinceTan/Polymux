import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

/**
 * Loopback agent-surface feed and command channel for the FlareAI browser
 * extension.
 *
 * Speaks the same protocol as the Hermes/Agent Surface extension so the
 * in-page presentation (Codex-style favicon badge and the ChatGPT-style
 * cursor) carries over unchanged:
 *
 *  - `GET /v1/snapshot`            → `{revision, leases: [...]}`; with
 *    `?after=<revision>&waitMs=<n>` it long-polls until the revision moves.
 *  - `POST /v1/cursor-arrivals`    → `{leaseId, moveSequence}` acknowledges
 *    that the cursor animation reached its target.
 *  - `POST /v1/results`            → `{leaseId, commandId, ok, ...}` reports a
 *    finished control command.
 *
 * Control extends the lease shape: a lease may carry one pending `command`
 * (navigate, click, type, scroll, read) that the extension's content script
 * executes in the matched tab, animating the cursor first for pointer
 * actions. The server binds to 127.0.0.1 only.
 */

export interface SurfaceTab {
  url: string;
  title: string;
  faviconUrl?: string;
}

export interface SurfaceCursor {
  x: number;
  y: number;
  visible: boolean;
  animateMovement: boolean;
  moveSequence: number;
}

export interface SurfaceCommand {
  id: string;
  kind: "navigate" | "click" | "type" | "scroll" | "read";
  /** Input pacing: calm (default) reads as an unhurried human; fast is the
   * quickest profile that still looks human. */
  pace?: "fast" | "calm";
  url?: string;
  selector?: string;
  text?: string;
  x?: number;
  y?: number;
  deltaY?: number;
  submit?: boolean;
  maxChars?: number;
}

export interface SurfaceCommandResult {
  ok: boolean;
  error?: string;
  pageUrl?: string;
  pageTitle?: string;
  content?: string;
}

export interface SurfaceLease {
  id: string;
  kind: "tab";
  state: "active" | "deliverable" | "handoff";
  tab: SurfaceTab;
  cursor: SurfaceCursor | null;
  command: SurfaceCommand | null;
  expiresAtMs: number;
  updatedAtMs: number;
}

const LEASE_TTL_MS = 120_000;
// 47652 is the Agent Surface presentation service and 47653 its
// browser-host CDP port; FlareAI takes the next port up.
const DEFAULT_PORT = 47_654;
const MAX_WAIT_MS = 25_000;
const MAX_BODY_BYTES = 1024 * 1024;

interface PendingCommand {
  resolve: (result: SurfaceCommandResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AgentSurfaceServer {
  readonly #port: number;
  /** Notified after every revision bump with the current live leases. */
  onLeasesChanged: ((leases: SurfaceLease[]) => void) | null = null;
  #server: Server | null = null;
  #revision = 0;
  readonly #leases = new Map<string, SurfaceLease>();
  readonly #waiters = new Set<() => void>();
  readonly #pendingCommands = new Map<string, PendingCommand>();
  #clock: () => number;

  constructor(options: { port?: number; clock?: () => number } = {}) {
    this.#port =
      options.port ??
      Number(process.env.FLAREAI_AGENT_SURFACE_PORT || DEFAULT_PORT);
    this.#clock = options.clock ?? Date.now;
  }

  get port(): number {
    return this.#port;
  }

  async start(): Promise<void> {
    if (this.#server) return;
    const server = createServer((request, response) =>
      void this.#handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }),
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.#port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    this.#server = server;
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    for (const waiter of this.#waiters) waiter();
    this.#waiters.clear();
    for (const [, pending] of this.#pendingCommands) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: "Agent surface is closing" });
    }
    this.#pendingCommands.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Bind a lease to the tab identified by URL and/or title. */
  createLease(tab: SurfaceTab): SurfaceLease {
    const lease: SurfaceLease = {
      id: randomUUID(),
      kind: "tab",
      state: "active",
      tab,
      cursor: null,
      command: null,
      expiresAtMs: this.#clock() + LEASE_TTL_MS,
      updatedAtMs: this.#clock(),
    };
    this.#leases.set(lease.id, lease);
    this.#bump();
    return lease;
  }

  getLease(id: string): SurfaceLease | undefined {
    const lease = this.#leases.get(id);
    if (lease && lease.expiresAtMs <= this.#clock()) {
      this.#leases.delete(id);
      return undefined;
    }
    return lease;
  }

  releaseLease(id: string): boolean {
    const existed = this.#leases.delete(id);
    if (existed) this.#bump();
    return existed;
  }

  /** Issue a command on a lease and wait for the extension's result. */
  async runCommand(
    leaseId: string,
    command: Omit<SurfaceCommand, "id">,
    timeoutMs = 20_000,
  ): Promise<SurfaceCommandResult> {
    const lease = this.getLease(leaseId);
    if (!lease)
      return { ok: false, error: `Unknown or expired lease: ${leaseId}` };
    if (lease.command)
      return { ok: false, error: "A command is already pending on this lease" };
    const full: SurfaceCommand = { ...command, id: randomUUID() };
    lease.command = full;
    lease.expiresAtMs = this.#clock() + LEASE_TTL_MS;
    lease.updatedAtMs = this.#clock();
    this.#bump();
    return await new Promise<SurfaceCommandResult>((resolve) => {
      const timer = setTimeout(() => {
        this.#pendingCommands.delete(full.id);
        const current = this.#leases.get(leaseId);
        if (current?.command?.id === full.id) current.command = null;
        resolve({
          ok: false,
          error:
            "The browser extension did not respond. Is the FlareAI extension installed and the tab open?",
        });
      }, timeoutMs);
      this.#pendingCommands.set(full.id, { resolve, timer });
    });
  }

  /** Move the visible cursor on a lease (presentation only). */
  moveCursor(leaseId: string, x: number, y: number, animate = true): boolean {
    const lease = this.getLease(leaseId);
    if (!lease) return false;
    const sequence = (lease.cursor?.moveSequence ?? 0) + 1;
    lease.cursor = {
      x,
      y,
      visible: true,
      animateMovement: animate,
      moveSequence: sequence,
    };
    lease.updatedAtMs = this.#clock();
    lease.expiresAtMs = this.#clock() + LEASE_TTL_MS;
    this.#bump();
    return true;
  }

  snapshot(): { revision: number; leases: SurfaceLease[] } {
    const now = this.#clock();
    for (const [id, lease] of this.#leases)
      if (lease.expiresAtMs <= now) this.#leases.delete(id);
    return { revision: this.#revision, leases: [...this.#leases.values()] };
  }

  #bump(): void {
    this.#revision += 1;
    for (const waiter of [...this.#waiters]) waiter();
    this.#waiters.clear();
    try {
      this.onLeasesChanged?.(this.snapshot().leases);
    } catch {
      // Presentation mirroring must never break the command channel.
    }
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/v1/snapshot") {
      const after = Number(url.searchParams.get("after"));
      const waitMs = Math.max(
        0,
        Math.min(MAX_WAIT_MS, Number(url.searchParams.get("waitMs")) || 0),
      );
      if (Number.isInteger(after) && this.#revision <= after && waitMs > 0)
        await this.#waitForChange(waitMs);
      json(response, 200, this.snapshot());
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/cursor-arrivals") {
      // Acknowledged but otherwise unused: nothing blocks on cursor arrival
      // today, and the extension only needs a 200 to stop retrying.
      await readBody(request);
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/results") {
      const body = await readBody(request);
      const commandId = String(body.commandId ?? "");
      const lease = this.#leases.get(String(body.leaseId ?? ""));
      if (lease?.command?.id === commandId) {
        lease.command = null;
        lease.updatedAtMs = this.#clock();
        this.#bump();
      }
      const pending = this.#pendingCommands.get(commandId);
      if (pending) {
        this.#pendingCommands.delete(commandId);
        clearTimeout(pending.timer);
        pending.resolve({
          ok: body.ok === true,
          error: typeof body.error === "string" ? body.error : undefined,
          pageUrl: typeof body.pageUrl === "string" ? body.pageUrl : undefined,
          pageTitle:
            typeof body.pageTitle === "string" ? body.pageTitle : undefined,
          content: typeof body.content === "string" ? body.content : undefined,
        });
      }
      json(response, 200, { ok: true });
      return;
    }
    json(response, 404, { error: "not found" });
  }

  #waitForChange(waitMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(waiter);
        resolve();
      }, waitMs);
      const waiter = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.#waiters.add(waiter);
    });
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
