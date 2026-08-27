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

/** Builds the HTML alternative only when the chosen signature has formatting. */
export function mailHtmlWithSignature(body: string, signatureHtml: string | null): string | undefined {
  const ending = signatureHtml?.trim();
  if (!ending) return undefined;
  const message = body.trimEnd();
  const authored = escapeHtml(message).replace(/\n/g, '<br>');
  const signature = `<div data-polymux-signature="true">${ending}</div>`;
  return authored ? `<div>${authored}</div><br><br>${signature}` : signature;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
