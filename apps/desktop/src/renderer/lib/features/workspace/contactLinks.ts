import type {
  ChatDto,
  ContactLinkDto,
  ContactLinkMemberDto,
  CommsPlatform,
} from '@polymux/protocol';
import {dedupeContactChats} from './chatContacts';

export interface ContactIdentityRow {
  id: string;
  name: string;
  primary: ChatDto;
  chats: ChatDto[];
  platforms: CommsPlatform[];
  official: boolean;
  link: ContactLinkDto | null;
}

/** Builds the Contacts view from conservative per-platform deduplication plus
 * the cross-platform links the user explicitly approved. */
export function contactIdentityRows(chats: ChatDto[], links: ContactLinkDto[]): ContactIdentityRow[] {
  const direct = dedupeContactChats(chats);
  const used = new Set<string>();
  const rows: ContactIdentityRow[] = [];

  for (const link of links) {
    const matches = direct.filter((chat) =>
      link.members.some((member) => memberMatchesChat(member, chat)));
    if (matches.length === 0) continue;
    for (const chat of matches) used.add(chat.id);
    const arranged = [...matches].sort(preferChat);
    rows.push(identityRow(link.id, link.name, arranged, link));
  }

  for (const chat of direct) {
    if (used.has(chat.id)) continue;
    rows.push(identityRow(`chat:${chat.id}`, chat.name, [chat], null));
  }
  return rows;
}

export function contactLinkForChat(chat: ChatDto, links: ContactLinkDto[]): ContactLinkDto | null {
  return links.find((link) => link.members.some((member) => memberMatchesChat(member, chat))) ?? null;
}

export function memberForChat(chat: ChatDto): ContactLinkMemberDto {
  return {
    platform: chat.platform as CommsPlatform,
    remoteId: chat.remoteId?.trim() || null,
    chatId: chat.id,
  };
}

export function memberMatchesChat(member: ContactLinkMemberDto, chat: ChatDto): boolean {
  if (member.platform !== chat.platform) return false;
  const memberRemote = normalized(member.remoteId);
  const chatRemote = normalized(chat.remoteId ?? null);
  return memberRemote && chatRemote ? memberRemote === chatRemote : member.chatId === chat.id;
}

function identityRow(
  id: string,
  name: string,
  chats: ChatDto[],
  link: ContactLinkDto | null,
): ContactIdentityRow {
  const primary = chats[0]!;
  return {
    id,
    name,
    primary,
    chats,
    platforms: [...new Set(chats.map((chat) => chat.platform as CommsPlatform))],
    official: chats.some((chat) => chat.official === true),
    link,
  };
}

function preferChat(left: ChatDto, right: ChatDto): number {
  if (Boolean(left.currentPortal) !== Boolean(right.currentPortal))
    return left.currentPortal ? -1 : 1;
  return activity(right) - activity(left);
}

function activity(chat: ChatDto): number {
  const parsed = Date.parse(chat.lastActivity ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalized(value: string | null): string {
  return value?.trim().normalize('NFKC').toLowerCase() ?? '';
}
