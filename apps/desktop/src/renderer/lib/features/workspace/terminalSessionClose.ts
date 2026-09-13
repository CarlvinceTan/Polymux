/**
 * Shared tab-strip update when a PTY session goes away. Workspace Terminal
 * tabs and IDE inner terminals both key rows by session id and pick the same
 * neighbor the tab X already uses: the previous item, or the new first item
 * when the closed row was first.
 *
 * Returns null when this strip does not own that session, so a second close
 * (user X vs process already exited) is a no-op.
 */
export function afterSessionClosed<T extends {id: string}>(
  items: readonly T[],
  activeId: string | null,
  closedId: string,
): {items: T[]; activeId: string | null} | null {
  const index = items.findIndex((item) => item.id === closedId);
  if (index < 0) return null;
  const remaining = items.filter((item) => item.id !== closedId);
  if (activeId !== closedId) return {items: remaining, activeId};
  return {items: remaining, activeId: remaining[Math.max(0, index - 1)]?.id ?? null};
}

export function isWorkspaceTerminalSession(
  tab: {id: string; kind: string},
  sessionId: string,
): boolean {
  return tab.kind === 'terminal' && tab.id === sessionId;
}
