import type {ChatDto, CommsBridgeDto} from '@polymux/protocol';

/** The live part of Hub status that decides whether cached conversations are
 * currently usable. Cached rooms remain available for a later reconnect, but
 * they are not navigation while their bridge is unavailable. */
export type ChatConnectionStatus = {
  bridges: ReadonlyArray<Pick<CommsBridgeDto, 'platform' | 'state'>>;
} | null;

export function isPlatformConnected(
  platform: string,
  status: ChatConnectionStatus,
): boolean {
  const wanted = platform.trim().toLowerCase();
  return status?.bridges.some(
    (bridge) => bridge.state === 'connected' && bridge.platform === wanted,
  ) ?? false;
}

export function isChatConnected(chat: ChatDto, status: ChatConnectionStatus): boolean {
  return isPlatformConnected(chat.platform, status);
}

export function filterConnectedChats(
  chats: readonly ChatDto[],
  status: ChatConnectionStatus,
): ChatDto[] {
  return chats.filter((chat) => isChatConnected(chat, status));
}
