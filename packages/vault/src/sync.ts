/** Last-write plan for one encrypted kdbx blob. Never inspects vault contents. */

export interface VaultRevision {
  revision: number;
  updatedAt: string;
  checksum: string;
  dirty?: boolean;
  lastSyncedAt?: string | null;
}

export type SyncAction = "noop" | "push" | "pull";

export interface SyncPlan {
  action: SyncAction;
  reason: string;
}

/**
 * Decide whether the local ciphertext should upload, download, or stay.
 *
 * First link (local has never synced, remote exists) always pulls so a new
 * empty vault cannot overwrite an account vault. After that, dirty local
 * wins only when its revision is ahead or its timestamp is newer at the
 * same revision.
 */
export function planSync(local: VaultRevision | null, remote: VaultRevision | null): SyncPlan {
  if (!local && !remote) return {action: "noop", reason: "empty"};
  if (!remote && local) return {action: "push", reason: "cloud-empty"};
  if (!local && remote) return {action: "pull", reason: "local-empty"};
  if (!local || !remote) return {action: "noop", reason: "empty"};

  if (!local.lastSyncedAt) return {action: "pull", reason: "first-link"};

  if (remote.revision > local.revision) {
    if (!local.dirty) return {action: "pull", reason: "remote-ahead"};
    if (timestamp(local.updatedAt) > timestamp(remote.updatedAt))
      return {action: "push", reason: "local-newer-dirty"};
    return {action: "pull", reason: "remote-ahead-conflict"};
  }

  if (local.revision > remote.revision) return {action: "push", reason: "local-ahead"};

  if (local.checksum === remote.checksum) return {action: "noop", reason: "same"};
  if (local.dirty) return {action: "push", reason: "same-revision-dirty"};
  return {action: "pull", reason: "same-revision-remote"};
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
