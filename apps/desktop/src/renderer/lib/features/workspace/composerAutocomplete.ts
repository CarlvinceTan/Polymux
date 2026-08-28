import type {
  ChatMemberDto,
  ChatMentionsDto,
  ChatMessageDto,
} from '@polymux/protocol';

export type ComposerToken = {
  kind: 'mention' | 'command';
  start: number;
  end: number;
  query: string;
};

export type ComposerSuggestion = {
  id: string;
  kind: 'mention' | 'command';
  /** Primary row text. */
  label: string;
  /** Text inserted into the draft. */
  value: string;
  detail: string;
  avatarUrl: string | null;
  userId: string | null;
};

const DEFAULT_TELEGRAM_COMMANDS = [
  {value: '/start', detail: 'Start the bot'},
  {value: '/help', detail: 'Show available commands'},
  {value: '/settings', detail: 'Open bot settings'},
  {value: '/cancel', detail: 'Cancel the current action'},
];

const MAX_SUGGESTIONS = 6;
const HANDLE_CHARACTER = /[\p{L}\p{N}_.-]/u;

/** The unfinished token touching the caret, if it is one the active platform
 * can complete. Earlier text and text beyond the caret are deliberately
 * ignored so editing in the middle of a draft behaves like normal typing. */
export function activeComposerToken(
  text: string,
  cursor: number,
  platform: string,
): ComposerToken | null {
  const caret = Math.max(0, Math.min(cursor, text.length));
  const beforeCaret = text.slice(0, caret);
  const mention = /(?:^|[\s([{])@([\p{L}\p{N}_.-]*)$/u.exec(beforeCaret);
  if (mention) {
    const start = beforeCaret.lastIndexOf('@');
    return {kind: 'mention', start, end: caret, query: mention[1] ?? ''};
  }
  if (platform !== 'telegram') return null;
  const command = /(?:^|\s)\/([A-Za-z0-9_]*)$/.exec(beforeCaret);
  if (!command) return null;
  const start = beforeCaret.lastIndexOf('/');
  return {kind: 'command', start, end: caret, query: command[1] ?? ''};
}

/** A readable, platform-neutral handle. The Matrix identity stays separately
 * attached to it, so presentation never becomes the notification target. */
export function memberHandle(member: ChatMemberDto): string {
  const fromName = member.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/^@/, '')
    .replace(/[^\p{L}\p{N}_.-]+/gu, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '')
    .replace(/[_\-.]{2,}/g, '_');
  if (fromName) return `@${fromName}`;
  const localpart = member.userId.replace(/^@/, '').split(':')[0]
    ?.replace(/^[a-z]+_/, '')
    .replace(/[^\p{L}\p{N}_.-]+/gu, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');
  return `@${localpart || 'user'}`;
}

/** A failed participant fetch can still recover identities from already
 * loaded messages, but only when they are real Matrix ids. */
export function mergeComposerMembers(
  members: ChatMemberDto[],
  messages: ChatMessageDto[],
): ChatMemberDto[] {
  const merged = new Map(members.map((member) => [member.userId, member]));
  for (const message of messages) {
    if (
      message.mine ||
      message.notice ||
      !/^@[^:\s]+:[^\s]+$/u.test(message.sender) ||
      merged.has(message.sender)
    ) continue;
    merged.set(message.sender, {
      userId: message.sender,
      name: message.senderName?.trim() || matrixLocalpart(message.sender),
      avatarUrl: message.senderAvatarUrl ?? null,
    });
  }
  return [...merged.values()].sort((left, right) =>
    left.name.localeCompare(right.name) || left.userId.localeCompare(right.userId),
  );
}

export function mentionSuggestions(
  token: ComposerToken | null,
  members: ChatMemberDto[],
  includeEveryone: boolean,
): ComposerSuggestion[] {
  if (token?.kind !== 'mention') return [];
  const query = token.query.toLocaleLowerCase();
  const suggestions: ComposerSuggestion[] = [];
  if (includeEveryone && 'everyone'.includes(query)) {
    suggestions.push({
      id: 'mention:everyone',
      kind: 'mention',
      label: 'Everyone',
      value: '@everyone',
      detail: 'Notify everyone in this chat',
      avatarUrl: null,
      userId: null,
    });
  }
  for (const {member, handle} of membersWithHandles(members)) {
    const searchable = `${member.name} ${handle}`.toLocaleLowerCase();
    if (query && !searchable.includes(query)) continue;
    suggestions.push({
      id: `mention:${member.userId}`,
      kind: 'mention',
      label: member.name,
      value: handle,
      detail: handle,
      avatarUrl: member.avatarUrl,
      userId: member.userId,
    });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }
  return suggestions.slice(0, MAX_SUGGESTIONS);
}

export function telegramCommandSuggestions(
  token: ComposerToken | null,
  messages: ChatMessageDto[],
): ComposerSuggestion[] {
  if (token?.kind !== 'command') return [];
  const query = token.query.toLocaleLowerCase();
  const discovered = new Map<string, string>();
  for (const message of messages) {
    if (message.notice) continue;
    const pattern = /(?:^|\s)(\/[a-z][a-z0-9_]{0,31})(?:@[a-z0-9_]+)?(?:\s*(?:-|–|—|:)\s*([^\n]{1,80}))?/gimu;
    for (const match of message.body.matchAll(pattern)) {
      const value = match[1]?.toLocaleLowerCase();
      if (value && !discovered.has(value)) discovered.set(value, match[2]?.trim() ?? 'Used in this chat');
    }
  }
  for (const command of DEFAULT_TELEGRAM_COMMANDS)
    if (!discovered.has(command.value)) discovered.set(command.value, command.detail);
  return [...discovered]
    .filter(([value]) => value.slice(1).includes(query))
    .slice(0, MAX_SUGGESTIONS)
    .map(([value, detail]) => ({
      id: `command:${value}`,
      kind: 'command' as const,
      label: value,
      value,
      detail,
      avatarUrl: null,
      userId: null,
    }));
}

export function replaceComposerToken(
  text: string,
  token: ComposerToken,
  value: string,
): {text: string; caret: number} {
  const after = text.slice(token.end);
  const separator = !after || !/^[\s,.;:!?)]/u.test(after) ? ' ' : '';
  const inserted = `${value}${separator}`;
  return {
    text: `${text.slice(0, token.start)}${inserted}${after}`,
    caret: token.start + inserted.length,
  };
}

/** Rebuilds the structured payload from the current text. Draft persistence
 * therefore remains plain text and manual edits cannot leave stale targets. */
export function mentionsInDraft(
  text: string,
  members: ChatMemberDto[],
  includeEveryone: boolean,
): ChatMentionsDto | undefined {
  const users = membersWithHandles(members).flatMap(({member, handle}) =>
    hasMention(text, handle) ? [{userId: member.userId, label: handle}] : [],
  );
  const everyone = includeEveryone && hasMention(text, '@everyone');
  return users.length > 0 || everyone
    ? {users, ...(everyone ? {everyone: true} : {})}
    : undefined;
}

function membersWithHandles(
  members: ChatMemberDto[],
): Array<{member: ChatMemberDto; handle: string}> {
  const used = new Map<string, number>();
  return members.map((member) => {
    const base = memberHandle(member);
    const next = (used.get(base) ?? 0) + 1;
    used.set(base, next);
    return {member, handle: next === 1 ? base : `${base}_${next}`};
  });
}

function hasMention(text: string, label: string): boolean {
  let from = 0;
  while (from < text.length) {
    const start = text.indexOf(label, from);
    if (start < 0) return false;
    const before = text[start - 1] ?? '';
    const after = text[start + label.length] ?? '';
    if ((!before || !HANDLE_CHARACTER.test(before)) && (!after || !HANDLE_CHARACTER.test(after)))
      return true;
    from = start + label.length;
  }
  return false;
}

function matrixLocalpart(userId: string): string {
  return userId.replace(/^@/, '').split(':')[0]?.replace(/^[a-z]+_/, '') || userId;
}
