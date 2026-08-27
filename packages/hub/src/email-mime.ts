import {randomUUID} from "node:crypto";
import path from "node:path";

/**
 * Builds the raw RFC 5322 message, which is what gets sent and what gets
 * appended to Drafts. Header values are folded onto one line each, because a
 * newline in a header would let a subject or address inject headers of its own.
 */
export interface OutgoingAttachment {
  name: string;
  mime: string;
  /** Raw bytes, base64-encoded when written into the message. */
  content: Buffer;
}

/** A header value with anything that could forge a new header removed. */
function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function mimeMessage(options: {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  importance?: "high" | "normal" | "low";
  attachments?: OutgoingAttachment[];
  /** Reused when the same message is both sent and filed, so the two match. */
  messageId?: string;
  /**
   * Whether the Bcc header stays in the message.
   *
   * It must, in a draft: the header is the only record of who the user chose to
   * blind-copy, and a draft they come back to would otherwise have quietly lost
   * them. It must not in a message being sent — the recipients travel in the
   * SMTP envelope, and a Bcc header left in the body is delivered to everyone,
   * which is the one thing blind copying exists to prevent.
   */
  retainBcc?: boolean;
}): string {
  const files = options.attachments ?? [];
  // A reply that carries neither header starts a new thread in the reader's
  // client, however much the subject line looks like an answer.
  const chain = [...(options.references ?? []), ...(options.inReplyTo ? [options.inReplyTo] : [])]
    .map(headerValue)
    .filter(Boolean);
  const headers = [
    `From: ${headerValue(options.from)}`,
    `To: ${options.to.map(headerValue).join(", ")}`,
    ...(options.cc.length ? [`Cc: ${options.cc.map(headerValue).join(", ")}`] : []),
    ...(options.retainBcc && options.bcc.length
      ? [`Bcc: ${options.bcc.map(headerValue).join(", ")}`]
      : []),
    `Subject: ${headerValue(options.subject)}`,
    ...(options.inReplyTo ? [`In-Reply-To: ${headerValue(options.inReplyTo)}`] : []),
    ...(chain.length ? [`References: ${chain.join(" ")}`] : []),
    // Two spellings because clients disagree on which they read: Outlook
    // follows the RFC 2156 header, most others the X- one Eudora introduced.
    // "normal" is what a message says by saying nothing.
    ...(options.importance === "high"
      ? ["Importance: high", "X-Priority: 1 (Highest)"]
      : options.importance === "low"
        ? ["Importance: low", "X-Priority: 5 (Lowest)"]
        : []),
    // Ours, so that a copy of this message can be recognised wherever it ends
    // up — which is how the Sent folder is checked without guessing at the
    // provider. A server assigns one anyway; assigning it here means we know it.
    `Message-ID: ${options.messageId ?? newMessageId(options.from)}`,
    "MIME-Version: 1.0",
  ];
  const body = options.body.replace(/\r?\n/g, "\r\n");
  const html = options.html?.replace(/\r?\n/g, "\r\n");
  if (files.length === 0 && !html)
    return `${[...headers, "Content-Type: text/plain; charset=utf-8"].join("\r\n")}\r\n\r\n${body}\r\n`;

  const alternativeBoundary = `polymux-alt-${Date.now().toString(36)}`;
  const alternativeBody = html
    ? [
        `--${alternativeBoundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
        `--${alternativeBoundary}`,
        "Content-Type: text/html; charset=utf-8",
        "",
        html,
        `--${alternativeBoundary}--`,
      ].join("\r\n")
    : "";
  if (files.length === 0)
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      "",
      alternativeBody,
      "",
    ].join("\r\n");

  const boundary = `polymux-${Date.now().toString(36)}-${files.length}`;
  const parts = [
    html
      ? [
          `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
          "",
          alternativeBody,
        ].join("\r\n")
      : ["Content-Type: text/plain; charset=utf-8", "", body].join("\r\n"),
    ...files.map((file) =>
      [
        `Content-Type: ${file.mime}; name="${headerValue(file.name)}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${headerValue(file.name)}"`,
        "",
        file.content.toString("base64").replace(/(.{76})/g, "$1\r\n"),
      ].join("\r\n"),
    ),
  ];
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.map((part) => `--${boundary}\r\n${part}`),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}



/**
 * Enough of a type table to label the files people actually attach; anything
 * unrecognised travels as octet-stream, which every client can still save.
 */
const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

/** A Message-ID owned by the sending domain, as the RFC asks. */
export function newMessageId(from: string): string {
  const domain = from.split("@").pop()?.replace(/[>\s]/g, "") || "localhost";
  return `<${randomUUID()}@${domain}>`;
}

export function mimeType(file: string): string {
  return MIME_TYPES[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";
}
