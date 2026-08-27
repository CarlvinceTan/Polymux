import type {ChatDto} from '@polymux/protocol';

/** The chats directly linked beneath one Matrix Space. */
export function chatsInSpace(chats: ChatDto[], spaceId: string, query = ''): ChatDto[] {
  const needle = query.trim().toLowerCase();
  return chats.filter(
    (chat) =>
      !chat.space &&
      chat.parentIds?.includes(spaceId) &&
      matches(chat, needle),
  );
}

/**
 * Rows shown at the root of a platform: ordinary unfiled chats and one
 * summary row per Space. Children stay behind their stack instead of appearing
 * twice. A search for a child keeps its containing Space reachable.
 */
export function spaceRootChats(chats: ChatDto[], query = ''): ChatDto[] {
  const needle = query.trim().toLowerCase();
  // A bridge's personal filtering Space is only an account-wide envelope. Its
  // children are the platform's ordinary chat list, so the envelope itself is
  // transparent. Remote communities remain visible as stacks.
  const spaces = chats.filter((chat) => chat.space && !chat.defaultSpace);
  const spaceIds = new Set(spaces.map((space) => space.id));
  const summaries = spaces
    .map((space) => {
      const children = chatsInSpace(chats, space.id);
      return {space: summariseSpace(space, children), children};
    })
    .filter(({space, children}) => matches(space, needle) || children.some((chat) => matches(chat, needle)))
    .map(({space}) => space);
  const loose = chats.filter(
    (chat) =>
      !chat.space &&
      !chat.parentIds?.some((parentId) => spaceIds.has(parentId)) &&
      matches(chat, needle),
  );
  return [...summaries, ...loose].sort((a, b) => activity(b) - activity(a));
}

/** A Space row borrows its children’s activity, unread total and names. */
export function summariseSpace(space: ChatDto, children: ChatDto[]): ChatDto {
  const unreadByAccount = aggregateUnreadByAccount(children);
  const newest = children.reduce<ChatDto | null>(
    (latest, chat) => activity(chat) > activity(latest) ? chat : latest,
    null,
  );
  return {
    ...space,
    lastActivity: newest?.lastActivity ?? space.lastActivity ?? null,
    preview: children.map((chat) => chat.name).join(', '),
    unread: children.reduce((total, chat) => total + (chat.unread ?? 0), 0),
    ...(unreadByAccount ? {unreadByAccount} : {}),
  };
}

function aggregateUnreadByAccount(chats: ChatDto[]): Record<string, number> | undefined {
  const totals: Record<string, number> = {};
  for (const chat of chats) {
    const perAccount = Object.entries(chat.unreadByAccount ?? {});
    for (const [account, unread] of perAccount)
      totals[account] = (totals[account] ?? 0) + unread;
    // A single-account bridge may only expose Matrix's aggregate count. It is
    // still safe to attribute that count when there is exactly one owner.
    if (perAccount.length === 0 && chat.accountIds?.length === 1)
      totals[chat.accountIds[0]!] = (totals[chat.accountIds[0]!] ?? 0) + (chat.unread ?? 0);
  }
  return Object.keys(totals).length ? totals : undefined;
}

function matches(chat: ChatDto, needle: string): boolean {
  return !needle ||
    chat.name.toLowerCase().includes(needle) ||
    (chat.preview ?? '').toLowerCase().includes(needle);
}

function activity(chat: ChatDto | null): number {
  if (!chat?.lastActivity) return 0;
  const parsed = Date.parse(chat.lastActivity);
  return Number.isNaN(parsed) ? 0 : parsed;
}
