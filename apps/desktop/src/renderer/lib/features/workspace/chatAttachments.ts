import type {ChatAttachmentDto} from '@polymux/protocol';

/** Containers Electron's Chromium player can present inline. More general
 * video containers such as Matroska stay files because labelling something a
 * video is not enough to make the browser able to decode it. */
const PLAYABLE_VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'm4v', 'mov', 'ogv']);
const PLAYABLE_VIDEO_MIME_TYPES = new Set([
  'application/mp4',
  'video/mp4',
  'video/ogg',
  'video/quicktime',
  'video/webm',
]);

/**
 * Bridges sometimes preserve a reel as `m.file`, especially when it arrived
 * through a generic share/file route. Recover only formats the page can play;
 * the declared kind remains authoritative for every non-file attachment.
 */
export function attachmentRenderKind(
  attachment: Pick<ChatAttachmentDto, 'kind' | 'mimeType' | 'name'>,
): ChatAttachmentDto['kind'] {
  if (attachment.kind !== 'file') return attachment.kind;

  const mimeType = attachment.mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (PLAYABLE_VIDEO_MIME_TYPES.has(mimeType)) return 'video';

  const name = attachment.name.split(/[?#]/, 1)[0] ?? '';
  const dot = name.lastIndexOf('.');
  const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return PLAYABLE_VIDEO_EXTENSIONS.has(extension) ? 'video' : 'file';
}
