import { existsSync, readFileSync } from "node:fs";

/**
 * What the app knows about window-use driving a native window.
 *
 * window-use is a skill, not a tool: it reaches macOS through Swift scripts
 * run under `bash`, so nothing in the main process is called when it takes a
 * window. What it does do is write a lease, and that file is the only honest
 * signal available — the skill has already committed to it as the thing that
 * stops two controllers overlapping, so reading it here adds no new contract
 * and cannot get out of step with what the skill believes.
 *
 * Read-only, deliberately. The token that would let anyone *release* a lease
 * is hashed in the registry and held by the run that took it; the pill reports
 * control, it does not seize it.
 */

export interface WindowControlLease {
  /** Bundle identifier, e.g. `com.apple.calculator`. */
  appId: string;
  windowId: string;
  scope: "window" | "tab";
  /** The run holding it. */
  owner: string;
  controller?: string;
  acquiredAt: number;
  expiresAt: number;
}

interface RawLease {
  app_id?: unknown;
  window_id?: unknown;
  scope?: unknown;
  owner?: unknown;
  controller?: unknown;
  acquired_at?: unknown;
  expires_at?: unknown;
}

/**
 * Active leases, newest first. A malformed or half-written registry reads as
 * "nothing is being driven": the pill is an indicator, and showing none is a
 * far better failure than showing one that is wrong.
 */
export function readWindowControlLeases(
  registryPath: string,
  now: number = Date.now(),
): WindowControlLease[] {
  if (!existsSync(registryPath)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch {
    return [];
  }
  const leases = (parsed as { leases?: unknown })?.leases;
  if (!leases || typeof leases !== "object") return [];
  const active: WindowControlLease[] = [];
  for (const value of Object.values(leases as Record<string, RawLease>)) {
    const lease = coerce(value);
    // Seconds since the epoch in the registry, milliseconds here.
    if (lease && lease.expiresAt * 1000 > now) active.push(lease);
  }
  return active.sort((a, b) => b.acquiredAt - a.acquiredAt);
}

function coerce(value: RawLease): WindowControlLease | null {
  if (!value || typeof value !== "object") return null;
  const appId = typeof value.app_id === "string" ? value.app_id : "";
  const owner = typeof value.owner === "string" ? value.owner : "";
  const expiresAt = typeof value.expires_at === "number" ? value.expires_at : 0;
  if (!appId || !owner || !expiresAt) return null;
  return {
    appId,
    windowId: typeof value.window_id === "string" ? value.window_id : "",
    scope: value.scope === "tab" ? "tab" : "window",
    owner,
    ...(typeof value.controller === "string" ? { controller: value.controller } : {}),
    acquiredAt: typeof value.acquired_at === "number" ? value.acquired_at : 0,
    expiresAt,
  };
}

/**
 * A name to show a person. The registry holds bundle identifiers, so the
 * readable name comes from a window listing when one is to hand; failing that
 * the identifier's last segment is a better guess than showing the whole
 * reverse-DNS string — `com.apple.calculator` reads as "Calculator".
 */
export function appNameFor(
  appId: string,
  windows: ReadonlyArray<{ app: string; bundleId?: string }> = [],
): string {
  const known = windows.find((window) => window.bundleId === appId);
  if (known?.app) return known.app;
  const tail = appId.split(".").filter(Boolean).pop() ?? appId;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}
