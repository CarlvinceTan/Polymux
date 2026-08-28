import type {ChatDto} from '@polymux/protocol';

/** One visible row per remote person. Matrix portal ids are transport details:
 * reconnecting a bridge may leave an older room beside the current writable
 * room even though both represent the same contact. */
export function dedupeContactChats(chats: ChatDto[]): ChatDto[] {
  const rows = new Map<string, ChatDto>();
  for (const chat of chats) {
    if (chat.group || chat.space) continue;
    const remoteId = chat.remoteId?.trim().normalize('NFKC').toLowerCase();
    const key = remoteId
      ? `${chat.platform.trim().toLowerCase()}:remote:${remoteId}`
      : `${chat.platform.trim().toLowerCase()}:room:${chat.id}`;
    const previous = rows.get(key);
    if (!previous || preferContactChat(chat, previous)) rows.set(key, chat);
  }
  return [...rows.values()];
}

function preferContactChat(candidate: ChatDto, previous: ChatDto): boolean {
  if (Boolean(candidate.currentPortal) !== Boolean(previous.currentPortal))
    return Boolean(candidate.currentPortal);
  return activity(candidate) > activity(previous);
}

function activity(chat: ChatDto): number {
  if (!chat.lastActivity) return 0;
  const parsed = Date.parse(chat.lastActivity);
  return Number.isFinite(parsed) ? parsed : 0;
}
