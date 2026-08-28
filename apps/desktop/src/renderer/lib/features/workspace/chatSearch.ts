import type {ChatAttachmentDto, ChatMessageDto} from '@polymux/protocol';
import {attachmentRenderKind} from './chatAttachments';

export type ChatSearchFilter = 'all' | 'messages' | 'media' | 'files' | 'links';
export type ChatSearchResultKind = 'message' | 'media' | 'file' | 'link';

export interface ChatSearchResult {
  key: string;
  kind: ChatSearchResultKind;
  message: ChatMessageDto;
  title: string;
  detail: string | null;
  attachment?: ChatAttachmentDto;
  url?: string;
}

/** One searchable representation of everything a conversation has shared.
 * A result points back to its message so the UI can return to the surrounding
 * conversation instead of opening a detached search-only copy. */
export function searchChatMessages(
  messages: ChatMessageDto[],
  query: string,
  filter: ChatSearchFilter,
): ChatSearchResult[] {
  const needle = normalise(query);
  return messages.flatMap((message) =>
    message.notice
      ? []
      : resultsForMessage(message).filter(
          (result) =>
            matchesFilter(result, filter) && matchesQuery(result, needle),
        ),
  );
}

function resultsForMessage(message: ChatMessageDto): ChatSearchResult[] {
  const results: ChatSearchResult[] = [];
  const body = compact(message.body);
  if (body) {
    results.push({
      key: `${message.id}:message`,
      kind: 'message',
      message,
      title: body,
      detail: null,
    });
  }

  for (const [index, attachment] of (message.attachments ?? []).entries()) {
    const rendered = attachmentRenderKind(attachment);
    const kind = rendered === 'file' ? 'file' : 'media';
    results.push({
      key: `${message.id}:${kind}:${index}`,
      kind,
      message,
      title: attachment.name || fallbackAttachmentName(rendered),
      detail: attachment.mimeType,
      attachment,
    });
  }

  for (const [index, link] of linksInMessage(message).entries()) {
    results.push({
      key: `${message.id}:link:${index}`,
      kind: 'link',
      message,
      title: link.title,
      detail: link.url,
      url: link.url,
    });
  }
  return results;
}

function matchesFilter(
  result: ChatSearchResult,
  filter: ChatSearchFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'messages') return result.kind === 'message';
  if (filter === 'files') return result.kind === 'file';
  if (filter === 'links') return result.kind === 'link';
  return result.kind === 'media';
}

function matchesQuery(result: ChatSearchResult, needle: string): boolean {
  if (!needle) return true;
  const message = result.message;
  return normalise(
    [
      result.title,
      result.detail,
      message.body,
      message.senderName,
      message.sender,
      result.attachment?.mimeType,
      result.attachment?.name,
      message.linkPreview?.title,
      message.linkPreview?.description,
      message.linkPreview?.source,
    ]
      .filter(Boolean)
      .join(' '),
  ).includes(needle);
}

function linksInMessage(
  message: ChatMessageDto,
): Array<{title: string; url: string}> {
  const urls = linksInText(message.body);
  if (message.linkPreview?.url) urls.unshift(message.linkPreview.url);
  const unique = [...new Set(urls)];
  return unique.map((url) => {
    const preview =
      message.linkPreview?.url === url ? message.linkPreview : null;
    return {
      title: compact(preview?.title ?? '') || hostname(url),
      url,
    };
  });
}

/** Mirrors the message renderer's punctuation handling so a link shown in a
 * bubble is the same link listed by search. */
function linksInText(body: string): string[] {
  const links: string[] = [];
  for (const match of body.matchAll(/https?:\/\/[^\s<>]+/gi)) {
    let url = match[0];
    while (/[.,!?;:]$/.test(url)) url = url.slice(0, -1);
    if (
      url.endsWith(')') &&
      (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)
    )
      url = url.slice(0, -1);
    if (url) links.push(url);
  }
  return links;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

function fallbackAttachmentName(kind: ChatAttachmentDto['kind']): string {
  if (kind === 'image') return 'Image';
  if (kind === 'audio') return 'Audio';
  if (kind === 'video') return 'Video';
  return 'File';
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalise(value: string): string {
  return value.trim().toLocaleLowerCase();
}
