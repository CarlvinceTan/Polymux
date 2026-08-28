import type {ChatMessageDto, ClipboardContentDto} from '@polymux/protocol';
import {attachmentRenderKind} from './chatAttachments';

/** Selects the message value a native messenger's single Copy action means. */
export function chatClipboardContent(message: ChatMessageDto): ClipboardContentDto | null {
  // Media messages sometimes retain a filename or caption in `body`. The
  // attachment is still the message's primary value: copying a photo should
  // place image pixels on the clipboard, and copying a document should place
  // a pasteable file there, never just that fallback text.
  const attachment = message.attachments?.find((item) => item.url);
  if (attachment?.url)
    return {
      kind: 'attachment',
      url: attachment.url,
      name: attachment.name,
      mimeType: attachment.mimeType,
      copyAs: attachmentRenderKind(attachment) === 'image' ? 'image' : 'file',
    };

  if (message.body)
    return {
      kind: 'text',
      text: message.body,
      ...(message.linkPreview?.title ? {title: message.linkPreview.title} : {}),
    };

  if (message.linkPreview?.url)
    return {
      kind: 'text',
      text: message.linkPreview.url,
      title: message.linkPreview.title,
    };

  const unavailable = message.attachments?.[0]?.name;
  return unavailable ? {kind: 'text', text: unavailable} : null;
}
