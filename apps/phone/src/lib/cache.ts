import type {ChatDto, ChatMessageDto, ConversationDto, MessageDto, BotDto} from '@polymux/protocol';

const PREFIX = 'polymux-phone-cache:';

export interface PhoneCache {
  conversations: ConversationDto[];
  team: BotDto[];
  messages: Record<string, MessageDto[]>;
  hubChats: ChatDto[];
  hubMessages: Record<string, ChatMessageDto[]>;
  selected: string | null;
}

const empty: PhoneCache = {
  conversations: [],
  team: [],
  messages: {},
  hubChats: [],
  hubMessages: {},
  selected: null,
};

export function readCache(hostId: string): PhoneCache {
  try {
    const value = localStorage.getItem(`${PREFIX}${hostId}`);
    return value ? {...empty, ...JSON.parse(value) as PhoneCache} : {...empty};
  } catch {
    return {...empty};
  }
}

export function writeCache(hostId: string, value: PhoneCache): void {
  try {
    localStorage.setItem(`${PREFIX}${hostId}`, JSON.stringify(value));
  } catch {
    // A full webview cache must never interrupt a live conversation.
  }
}
