import {randomUUID} from "node:crypto";
import type {ComputerState} from "./state.js";
import type {ControlDecision, ControlRequest} from "./types.js";

interface Lease extends ControlRequest {
  token: string;
  createdAt: number;
  appId?: string;
  windowId?: string;
}

export class ComputerArbiter {
  readonly #state: ComputerState;
  readonly #leases = new Map<string, Lease>();

  constructor(state: ComputerState) {
    this.#state = state;
  }

  request(request: ControlRequest): ControlDecision {
    const surface = this.#state.surface(request.surfaceId);
    if (!surface) return {decision: "deny", reason: "The requested surface is no longer available."};
    if (this.#state.locked()) return {decision: "deny", reason: "The computer session is locked."};
    if (!surface.capabilities.read) return {decision: "deny", reason: "The surface has no verified read route."};
    if (request.operation === "read") return {decision: "allow", reason: "Read-only access does not mutate the surface."};
    if (!surface.capabilities.control || !surface.capabilities.scopes.includes(request.scope))
      return {decision: "read_only", reason: "The verified route does not support that control scope."};
    if (surface.userControlled && request.explicitlyRequested !== true)
      return {decision: "read_only", reason: "The user currently controls this surface and did not explicitly grant this mutation."};
    const context = this.#state.controlContext(request.surfaceId);
    const conflict = [...this.#leases.values()].find((lease) => conflicts(lease, {...request, ...context}));
    if (conflict)
      return {decision: "pause", reason: "Another controller already holds a conflicting surface lease."};
    const token = randomUUID();
    this.#leases.set(token, {...request, ...context, token, createdAt: Date.now()});
    return {
      decision: surface.userControlled ? "allow" : "allow_background_only",
      reason: surface.userControlled ? "The user explicitly granted this operation on the current surface." : "The exact background surface supports isolated control.",
      token,
      constraints: {surfaceId: surface.id, scope: request.scope, mustRemainBackground: !surface.userControlled},
    };
  }

  validate(token: string, surfaceId: string, operation?: ControlRequest["operation"], scope?: ControlRequest["scope"]): boolean {
    const lease = this.#leases.get(token);
    return Boolean(
      lease && lease.surfaceId === surfaceId && this.#state.surface(surfaceId) &&
      (!operation || lease.operation === operation) && (!scope || lease.scope === scope),
    );
  }

  userActivity(surfaceId: string): number {
    let revoked = 0;
    for (const [token, lease] of this.#leases)
      if (lease.surfaceId === surfaceId) {
        this.#leases.delete(token);
        revoked += 1;
      }
    return revoked;
  }

  release(token: string): boolean {
    return this.#leases.delete(token);
  }
}

function conflicts(
  left: ControlRequest & {appId?: string; windowId?: string},
  right: ControlRequest & {appId?: string; windowId?: string},
): boolean {
  if (left.ownerId === right.ownerId && left.surfaceId === right.surfaceId) return false;
  if (left.surfaceId === right.surfaceId) return true;
  if ((left.scope === "app" || right.scope === "app") && left.appId && left.appId === right.appId)
    return true;
  return Boolean(
    (left.scope === "window" || right.scope === "window") &&
    left.windowId && left.windowId === right.windowId,
  );
}
