import {DOMParser, type Element} from "@xmldom/xmldom";
import type {ChatForwardedBundleDto, ChatForwardedMessageDto} from "@polymux/protocol";

const MAX_XML = 2 * 1024 * 1024;
const MAX_MESSAGES = 500;
const MAX_DEPTH = 6;
const MAX_TEXT = 100_000;
const KINDS = new Set<ChatForwardedMessageDto["kind"]>([
  "text", "image", "audio", "video", "file", "link", "location", "record", "unknown",
]);
const DATA_KINDS: Record<string, ChatForwardedMessageDto["kind"]> = {
  "1": "text", "2": "image", "3": "audio", "4": "video", "5": "link", "6": "location", "8": "file",
};

function child(parent: Element | null, name: string): Element | null {
  for (let node = parent?.firstChild; node; node = node.nextSibling)
    if (node.nodeType === 1 && node.nodeName === name) return node as Element;
  return null;
}

/** Only a field's own text, never a descendant's transport data. */
function scalar(parent: Element | null, name: string): string {
  let value = "";
  for (let node = child(parent, name)?.firstChild; node; node = node.nextSibling)
    if (node.nodeType === 3 || node.nodeType === 4) value += node.nodeValue ?? "";
  return value.trim();
}

function root(xml: string): Element | null {
  if (!xml || xml.length > MAX_XML || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) return null;
  try {
    return new DOMParser({onError: () => {throw new Error("invalid forwarded XML");}})
      .parseFromString(xml, "text/xml").documentElement;
  } catch {
    return null;
  }
}

/** WeChat appmsg type 19 wraps recordinfo in CDATA or escaped XML. */
export function weChatForwardedBundle(xml: string): ChatForwardedBundleDto | null {
  const document = root(xml);
  const app = document?.nodeName === "appmsg" ? document : child(document, "appmsg");
  if (scalar(app, "type") !== "19") return null;
  const record = child(child(app, "recorditem"), "recordinfo") ?? root(scalar(app, "recorditem"));
  if (record?.nodeName !== "recordinfo") return null;
  const budget = {messages: MAX_MESSAGES, text: MAX_TEXT};
  const result = readRecord(record, scalar(app, "title"), 0, budget);
  return result.messages.length ? result : null;
}

/** Plain-text fallback also makes individual forwarded entries searchable. */
export function forwardedBundleText(bundle: ChatForwardedBundleDto): string {
  const labels: Record<ChatForwardedMessageDto["kind"], string> = {
    text: "Message", image: "Photo", audio: "Voice message", video: "Video",
    file: "File", link: "Link", location: "Location", record: "Forwarded messages", unknown: "Attachment",
  };
  return [bundle.title || "Forwarded messages", ...bundle.messages.map((message) => {
    const body = message.forwarded ? forwardedBundleText(message.forwarded) : message.body || `[${labels[message.kind]}]`;
    return `${message.senderName ? `${message.senderName}: ` : ""}${body}`;
  })].join("\n");
}

function readRecord(
  record: Element, fallbackTitle: string, depth: number,
  budget: {messages: number; text: number},
): ChatForwardedBundleDto {
  const bundle: ChatForwardedBundleDto = {title: "", messages: [], truncated: false};
  function text(value: string, maximum = 10_000): string {
    const kept = value.slice(0, Math.max(0, Math.min(maximum, budget.text)));
    budget.text -= kept.length;
    if (kept.length !== value.length) bundle.truncated = true;
    return kept;
  }
  bundle.title = text(scalar(record, "title") || fallbackTitle, 256);
  const list = child(record, "datalist");
  for (let node = list?.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1 || node.nodeName !== "dataitem") continue;
    if (budget.messages <= 0 || budget.text <= 0) {bundle.truncated = true; break;}
    budget.messages--;
    const item = node as Element;
    const kind = DATA_KINDS[item.getAttribute("datatype") ?? ""] ?? "unknown";
    const entry: ChatForwardedMessageDto = {
      senderName: text(scalar(item, "sourcename"), 256) || null,
      sentAt: text(scalar(item, "sourcetime"), 64) || null,
      kind,
      body: text(kind === "text" ? scalar(item, "datadesc") : scalar(item, "datatitle") || scalar(item, "datadesc")),
    };
    if (kind === "link") {
      const link = child(item, "weburlitem");
      entry.body = text([scalar(link, "pagetitle") || entry.body, scalar(link, "pagedesc")]
        .filter(Boolean).join("\n"));
    }
    const nested = child(item, "recordinfo") ?? child(child(item, "recorditem"), "recordinfo") ??
      root(scalar(item, "recorditem"));
    if (nested?.nodeName === "recordinfo") {
      entry.kind = "record";
      if (depth >= MAX_DEPTH) bundle.truncated = true;
      else {
        const forwarded = readRecord(nested, entry.body, depth + 1, budget);
        if (forwarded.messages.length) entry.forwarded = forwarded;
        else bundle.truncated = true;
      }
    }
    bundle.messages.push(entry);
  }
  const declared = Number(list?.getAttribute("count"));
  if (Number.isSafeInteger(declared) && declared > bundle.messages.length) bundle.truncated = true;
  return bundle;
}

/** Matrix content is untrusted even when it resembles a bridge-owned field. */
export function forwardedBundleOf(value: unknown): ChatForwardedBundleDto | null {
  const budget = {messages: MAX_MESSAGES, text: MAX_TEXT};
  function read(raw: unknown, depth: number): ChatForwardedBundleDto | null {
    if (!raw || typeof raw !== "object" || depth > MAX_DEPTH) return null;
    const item = raw as Record<string, unknown>;
    if (typeof item.title !== "string" || item.title.length > 256 ||
      typeof item.truncated !== "boolean" || !Array.isArray(item.messages) || !item.messages.length ||
      item.messages.length > budget.messages) return null;
    budget.messages -= item.messages.length;
    budget.text -= item.title.length;
    const messages: ChatForwardedMessageDto[] = [];
    for (const rawMessage of item.messages) {
      if (!rawMessage || typeof rawMessage !== "object") return null;
      const message = rawMessage as Record<string, unknown>;
      if (typeof message.body !== "string" || message.body.length > 10_000 ||
        typeof message.kind !== "string" || !KINDS.has(message.kind as ChatForwardedMessageDto["kind"]) ||
        !(message.senderName === null || typeof message.senderName === "string" && message.senderName.length <= 256) ||
        !(message.sentAt === null || typeof message.sentAt === "string" && message.sentAt.length <= 64)) return null;
      budget.text -= message.body.length +
        (typeof message.senderName === "string" ? message.senderName.length : 0) +
        (typeof message.sentAt === "string" ? message.sentAt.length : 0);
      if (budget.text < 0) return null;
      const forwarded = message.forwarded == null ? null : read(message.forwarded, depth + 1);
      if (message.forwarded != null && !forwarded) return null;
      messages.push({
        senderName: message.senderName as string | null,
        sentAt: message.sentAt as string | null,
        kind: message.kind as ChatForwardedMessageDto["kind"], body: message.body,
        ...(forwarded ? {forwarded} : {}),
      });
    }
    return {title: item.title, messages, truncated: item.truncated};
  }
  return read(value, 0);
}
