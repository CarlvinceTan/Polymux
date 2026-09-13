import type {ChatAttachmentDto, ChatMessageDto} from '@polymux/protocol';

const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'webp']);
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'wav', 'webm']);
const VIDEO_EXTENSIONS = new Set(['m4v', 'mov', 'mp4', 'ogv', 'webm']);

export interface ChatDraftSnapshot {
  text: string;
  replyTo: string | null;
  files: string[];
}

export function pendingFileAttachment(filePath: string): ChatAttachmentDto {
  const name = filePath.split(/[\\/]/).at(-1) || filePath;
  const extension = name.includes('.') ? name.split('.').at(-1)?.toLowerCase() ?? '' : '';
  const kind = IMAGE_EXTENSIONS.has(extension)
    ? 'image'
    : VIDEO_EXTENSIONS.has(extension)
      ? 'video'
      : AUDIO_EXTENSIONS.has(extension)
        ? 'audio'
        : 'file';
  return {kind, url: null, name, mimeType: null, size: null};
}

export function pendingChatMessage(options: {
  id: string;
  chatId: string;
  body?: string;
  replyTo?: string | null;
  attachments?: ChatAttachmentDto[];
  sentAt?: string;
}): ChatMessageDto {
  return {
    id: options.id,
    chatId: options.chatId,
    sender: '',
    senderName: 'You',
    body: options.body ?? '',
    sentAt: options.sentAt ?? new Date().toISOString(),
    mine: true,
    attachments: options.attachments ?? [],
    reactions: [],
    replyTo: options.replyTo ?? null,
  };
}

export function replaceChatMessage(
  messages: ChatMessageDto[],
  pendingId: string,
  sent: ChatMessageDto,
): ChatMessageDto[] {
  // A room-activity refresh can learn the real event while native delivery is
  // still being verified. Remove that fresh copy before replacing the local
  // placeholder, or confirmation would leave the message twice.
  const withoutSent = messages.filter((message) => message.id !== sent.id);
  const index = withoutSent.findIndex((message) => message.id === pendingId);
  if (index < 0) return [sent, ...withoutSent];
  return withoutSent.map((message, at) => (at === index ? sent : message));
}

export function removeChatMessage(messages: ChatMessageDto[], id: string): ChatMessageDto[] {
  return messages.filter((message) => message.id !== id);
}

function pendingEchoMatches(pending: ChatMessageDto, fresh: ChatMessageDto): boolean {
  if (!pending.mine || !fresh.mine) return false;
  const pendingAt = Date.parse(pending.sentAt);
  const freshAt = Date.parse(fresh.sentAt);
  if (
    Number.isFinite(pendingAt) &&
    Number.isFinite(freshAt) &&
    Math.abs(freshAt - pendingAt) > 10 * 60_000
  ) return false;
  const pendingFiles = pending.attachments ?? [];
  const freshFiles = fresh.attachments ?? [];
  if (pendingFiles.length > 0)
    return pendingFiles.length === freshFiles.length &&
      pendingFiles.every((attachment, index) => {
        const candidate = freshFiles[index];
        return Boolean(candidate) &&
          (attachment.name === candidate.name ||
            (attachment.name === 'Voice message' && attachment.kind === candidate.kind));
      });
  return pending.body === fresh.body &&
    (pending.replyTo ?? null) === (fresh.replyTo ?? null);
}

/** A local Matrix event exists before its native bridge confirms it. Keep the
 * optimistic bubble as the single visible copy until that confirmation settles. */
export function withoutUnconfirmedChatEchoes(
  known: ChatMessageDto[],
  fresh: ChatMessageDto[],
  pendingIds: ReadonlySet<string>,
): ChatMessageDto[] {
  const pending = known.filter((message) => pendingIds.has(message.id));
  if (pending.length === 0) return fresh;
  return fresh.filter((message) => !pending.some((candidate) => pendingEchoMatches(candidate, message)));
}

/** Restores a failed send without overwriting anything typed while it was in flight. */
export function mergeFailedChatDraft(
  current: ChatDraftSnapshot,
  failed: ChatDraftSnapshot,
): ChatDraftSnapshot {
  const currentText = current.text.trim();
  const failedText = failed.text.trim();
  const text = !failedText
    ? current.text
    : !currentText || currentText === failedText
      ? failed.text
      : `${failed.text}\n${current.text}`;
  return {
    text,
    replyTo: current.replyTo ?? failed.replyTo,
    files: [...new Set([...failed.files, ...current.files])],
  };
}
