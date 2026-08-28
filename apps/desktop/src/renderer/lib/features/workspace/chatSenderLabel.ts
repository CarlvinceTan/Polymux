import {
  commsPlatformLabel,
  type ChatDto,
  type ChatMessageDto,
  type CommsPlatform,
} from '@polymux/protocol';

function cleanBridgeName(value: string, platform: string): string {
  const name = value.trim();
  return platform === 'whatsapp' ? name.replace(/(?:\s*\(WA\))+$/i, '').trimEnd() : name;
}

function genericBridgeName(value: string, platform: string): boolean {
  const name = value.trim().toLocaleLowerCase();
  const platformName = commsPlatformLabel(platform as CommsPlatform).toLocaleLowerCase();
  return name === 'unknown user'
    || name === 'unknown contact'
    || name === `${platformName} user`
    || name === `${platformName} contact`;
}

/**
 * The visible author above a chat bubble. Every bridge uses the same Matrix
 * profile path, but a direct room has one extra authoritative identity: its
 * contact name. Use that when a bridge profile is missing or still generic;
 * never apply the room title to a group, where it would misname the speaker.
 */
export function chatSenderLabel(
  message: ChatMessageDto,
  chat: ChatDto | null | undefined,
): string {
  if (message.mine) return 'You';
  const platform = chat?.platform ?? '';
  const profile = cleanBridgeName(message.senderName ?? '', platform);
  if (profile && profile !== message.sender && !genericBridgeName(profile, platform))
    return profile;

  const directName = cleanBridgeName(chat?.name ?? '', platform);
  if (
    chat &&
    !chat.group &&
    directName &&
    directName !== chat.id &&
    !genericBridgeName(directName, platform)
  ) return directName;

  if (profile && profile !== message.sender) return profile;
  return message.sender.replace(/^@/, '').split(':')[0];
}
