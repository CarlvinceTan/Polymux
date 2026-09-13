/**
 * Builds the exact plain-text body written to SMTP or a Drafts folder.
 *
 * The composer keeps authored text and the chosen reusable ending separate so
 * changing the menu never rewrites what the user typed. They meet only at the
 * transport boundary, with the conventional blank line between them.
 */
export function mailBodyWithSignature(body: string, signature: string): string {
  const ending = signature.trim();
  if (!ending) return body;
  const message = body.trimEnd();
  return message ? `${message}\n\n${ending}` : ending;
}

export interface PositionedMailAttachment {
  name: string;
  contentId: string;
  /** UTF-16 body offset, matching textarea selection offsets. */
  offset: number;
}

/** Builds the HTML alternative when the signature or positioned files need
 * it. Attachment links become the authored `cid:` nodes the reader resolves
 * back into cards and previews. */
export function mailHtmlWithSignature(
  body: string,
  signatureHtml: string | null,
  attachments: PositionedMailAttachment[] = [],
): string | undefined {
  const ending = signatureHtml?.trim();
  if (!ending && attachments.length === 0) return undefined;
  const message = body.trimEnd();
  const authored = attachmentHtml(message, attachments);
  if (!ending) return `<div>${authored}</div>`;
  const signature = `<div data-polymux-signature="true">${ending}</div>`;
  return authored ? `<div>${authored}</div><br><br>${signature}` : signature;
}

function attachmentHtml(body: string, attachments: PositionedMailAttachment[]): string {
  let from = 0;
  let html = '';
  for (const file of attachments
    .map((file, order) => ({file, order}))
    .sort((left, right) => left.file.offset - right.file.offset || left.order - right.order)
    .map(({file}) => file)) {
    const offset = Math.max(from, Math.min(body.length, file.offset));
    html += escapeHtml(body.slice(from, offset)).replace(/\n/g, '<br>');
    html += `<div><a href="cid:${escapeAttribute(file.contentId)}">${escapeHtml(file.name)}</a></div>`;
    from = offset;
  }
  return html + escapeHtml(body.slice(from)).replace(/\n/g, '<br>');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
