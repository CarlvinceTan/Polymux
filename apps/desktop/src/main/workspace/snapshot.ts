import type {WorkspaceSnapshotDto} from "@flareai/protocol";

/**
 * The drawer-openness rule for stored workspace snapshots: a snapshot restores
 * its tabs always, but `open` only survives within the app run that saved it.
 * Within a session, returning to a chat brings the workspace back exactly as
 * left; browsing archived chats after a relaunch starts with the drawer
 * closed. The caller supplies its run's boot id on both save and read.
 */
export function sessionScopedSnapshot(
  stored: unknown,
  bootId: string,
): WorkspaceSnapshotDto | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const {bootId: storedBootId, ...snapshot} = stored as WorkspaceSnapshotDto & {bootId?: string};
  return storedBootId === bootId ? snapshot : {...snapshot, open: false};
}
