import type {ChatDto} from '@polymux/protocol';

/** One visible row per remote conversation. Matrix portal ids are transport
 * details: reconnecting a bridge may leave an older room beside the current
 * writable room even though both represent the same chat. Spaces and rooms
 * without a bridge-attested remote identity remain distinct. */
export function dedupePortalChats(chats: ChatDto[]): ChatDto[] {
  const rows: ChatDto[] = [];
  const positions = new Map<string, number>();
  for (const chat of chats) {
    const key = portalKey(chat);
    if (!key) {
      rows.push(chat);
      continue;
    }
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, rows.length);
      rows.push(chat);
      continue;
    }
    rows[position] = mergePortalChats(rows[position], chat);
  }
  return rows;
}

/** Contacts are the direct-chat subset of the same portal identity rule. */
export function dedupeContactChats(chats: ChatDto[]): ChatDto[] {
  return dedupePortalChats(chats.filter((chat) => !chat.group && !chat.space));
}

function portalKey(chat: ChatDto): string | null {
  if (chat.space) return null;
  const remoteId = chat.remoteId?.trim().normalize('NFKC').toLowerCase();
  if (!remoteId) return null;
  return `${chat.platform.trim().toLowerCase()}:${chat.group ? 'group' : 'direct'}:${remoteId}`;
}

function mergePortalChats(left: ChatDto, right: ChatDto): ChatDto {
  const current = preferPortalChat(right, left) ? right : left;
  const latest = activity(right) > activity(left) ? right : left;
  const merged: ChatDto = {
    ...current,
    lastActivity: latest.lastActivity ?? current.lastActivity,
    preview: latest.preview ?? current.preview,
  };
  const accountIds = union(left.accountIds, right.accountIds);
  const parentIds = union(left.parentIds, right.parentIds);
  const unreadByAccount = mergeUnreadByAccount(left.unreadByAccount, right.unreadByAccount);
  if (accountIds) merged.accountIds = accountIds;
  if (parentIds) merged.parentIds = parentIds;
  if (unreadByAccount) merged.unreadByAccount = unreadByAccount;
  if (left.unread !== undefined || right.unread !== undefined)
    merged.unread = Math.max(left.unread ?? 0, right.unread ?? 0);
  if (left.official === true || right.official === true) merged.official = true;
  return merged;
}

function preferPortalChat(candidate: ChatDto, previous: ChatDto): boolean {
  if (Boolean(candidate.currentPortal) !== Boolean(previous.currentPortal))
    return Boolean(candidate.currentPortal);
  return activity(candidate) > activity(previous);
}

function union(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  if (!left && !right) return undefined;
  return [...new Set([...(left ?? []), ...(right ?? [])])];
}

function mergeUnreadByAccount(
  left: Record<string, number> | undefined,
  right: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!left && !right) return undefined;
  const merged = {...left};
  for (const [account, unread] of Object.entries(right ?? {}))
    merged[account] = Math.max(merged[account] ?? 0, unread);
  return merged;
}

function activity(chat: ChatDto): number {
  if (!chat.lastActivity) return 0;
  const parsed = Date.parse(chat.lastActivity);
  return Number.isFinite(parsed) ? parsed : 0;
}
