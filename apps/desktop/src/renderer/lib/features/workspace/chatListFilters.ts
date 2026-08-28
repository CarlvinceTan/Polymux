export type ConversationListFilter = 'all' | 'unread' | 'read';
export type ConversationListSort = 'latest' | 'earliest';

/** Whether a chat or mail row belongs in the selected read-state slice. */
export function matchesConversationFilter(
  unread: number,
  filter: ConversationListFilter,
): boolean {
  if (filter === 'unread') return unread > 0;
  if (filter === 'read') return unread <= 0;
  return true;
}

/**
 * Compare two conversation timestamps in the chosen direction. Rows without
 * a message stay last: they are navigation or empty rooms, not the earliest
 * message received.
 */
export function compareConversationActivity(
  left: string | null | undefined,
  right: string | null | undefined,
  sort: ConversationListSort,
): number {
  const leftTime = activity(left);
  const rightTime = activity(right);
  if (leftTime === null && rightTime === null) return 0;
  if (leftTime === null) return 1;
  if (rightTime === null) return -1;
  return sort === 'latest' ? rightTime - leftTime : leftTime - rightTime;
}

function activity(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
