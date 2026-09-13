import type {ChatMessageDto} from '@polymux/protocol';

/**
 * Merge updated content by identity, then order by authored time. Sync can
 * discover older history or recover media long after newer messages arrived.
 * Stable ties preserve the page order for messages sent in the same instant.
 */
export function mergeChatPage(
  known: ChatMessageDto[],
  fresh: ChatMessageDto[],
): ChatMessageDto[] {
  const knownIds = new Set(known.map((item) => item.id));
  const byId = new Map(fresh.map((item) => [item.id, item]));
  return [
    ...fresh.filter((item) => !knownIds.has(item.id)),
    ...known.map((item) => byId.get(item.id) ?? item),
  ].sort((left, right) => {
    const a = Date.parse(left.sentAt);
    const b = Date.parse(right.sentAt);
    return Number.isFinite(a) && Number.isFinite(b) ? b - a : 0;
  });
}
