import {base64ToBytes, vaultChecksum} from "./checksum.js";
import type {LockerCloudStore} from "./cloud.js";
import {MISSING_CLOUD_VAULT} from "./cloud.js";
import {LockerSession, type LockerSessionStatus} from "./session.js";
import {planSync} from "./sync.js";
import type {VaultStorage} from "./meta.js";

export const DESKTOP_OFFLINE = "desktop-offline";

export function isDesktopOffline(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as {code?: unknown}).code === DESKTOP_OFFLINE);
}

export function shouldUseCloudSync(storage: VaultStorage | undefined, signedIn: boolean): boolean {
  return signedIn && storage !== "local";
}

/**
 * Prefer the desktop loopback while Polymux is running; fall back only when
 * the hub answers 503 / desktop-offline.
 */
export async function preferDesktopLoopback<T>(
  desktop: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<{source: "desktop" | "device"; value: T}> {
  try {
    return {source: "desktop", value: await desktop()};
  } catch (cause) {
    if (!isDesktopOffline(cause)) throw cause;
    return {source: "device", value: await fallback()};
  }
}

export interface CloudSyncResult {
  status: LockerSessionStatus;
  missing: boolean;
}

/**
 * Last-write ciphertext sync. Skips entirely for local-only vaults so a
 * signed-in client cannot upload or overwrite that policy.
 */
export async function syncSessionWithCloud(
  session: LockerSession,
  cloud: LockerCloudStore,
  options: {allowPull?: boolean; force?: "push" | "pull"} = {},
): Promise<CloudSyncResult> {
  const current = session.status();
  if (!shouldUseCloudSync(current.sync.storage, cloud.signedIn()))
    return {status: current, missing: false};

  const remote = await cloud.pull();
  const localBlob = session.exportBlob();
  const local = localBlob
    ? {
        revision: localBlob.meta.revision,
        updatedAt: localBlob.meta.updatedAt,
        checksum: localBlob.meta.checksum,
        dirty: localBlob.meta.dirty,
        lastSyncedAt: localBlob.meta.lastSyncedAt,
      }
    : null;
  const plan = options.force ? {action: options.force} : planSync(local, remote);

  if (plan.action === "pull") {
    if (options.allowPull === false) return {status: session.status(), missing: !remote && !local};
    if (!remote) return {status: session.status(), missing: !local};
    await session.importCloud(remote);
  } else if (plan.action === "push") {
    if (!localBlob) return {status: session.status(), missing: !remote};
    const bytes = base64ToBytes(localBlob.bytes);
    await cloud.push({
      bytes,
      revision: localBlob.meta.revision,
      updatedAt: localBlob.meta.updatedAt,
      checksum: localBlob.meta.checksum || vaultChecksum(bytes),
    });
    await session.acknowledgePush();
  }

  const status = session.status();
  return {status, missing: !status.exists};
}

export async function pullAccountVault(
  session: LockerSession,
  cloud: LockerCloudStore,
): Promise<LockerSessionStatus> {
  const result = await syncSessionWithCloud(session, cloud, {allowPull: true});
  if (!result.status.exists) throw new Error(MISSING_CLOUD_VAULT);
  return result.status;
}
