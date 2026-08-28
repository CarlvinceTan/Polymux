import type {ChatMessageDto} from '@polymux/protocol';

/**
 * New messages lead the page, while fresh copies of known messages replace
 * them in place. The latter matters for mutable Matrix relations: a reaction
 * can change long after the message itself was first loaded.
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
  ];
}
