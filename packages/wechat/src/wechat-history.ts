import {DOMParser, type Element} from "@xmldom/xmldom";

/** Only the outer app message decides its kind. A quoted or forwarded file
 * must never turn the surrounding message into an attachment. */
export function weChatAppMessageType(xml: string): string | null {
  if (!xml.trimStart().startsWith("<") || xml.length > 2 * 1024 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) return null;
  const children = (parent: Element | null, name: string): Element[] => {
    const found: Element[] = [];
    for (let node = parent?.firstChild; node; node = node.nextSibling)
      if (node.nodeType === 1 && node.nodeName === name) found.push(node as Element);
    return found;
  };
  try {
    const root = new DOMParser({onError: () => {throw new Error("invalid app message XML");}})
      .parseFromString(xml, "text/xml").documentElement;
    const apps = root?.nodeName === "appmsg" ? [root] : root?.nodeName === "msg" ? children(root, "appmsg") : [];
    if (apps.length !== 1) return null;
    const types = children(apps[0], "type");
    if (types.length !== 1) return null;
    for (let node = types[0].firstChild; node; node = node.nextSibling)
      if (node.nodeType !== 3 && node.nodeType !== 4) return null;
    const value = types[0].textContent?.trim() ?? "";
    return /^\d{1,5}$/.test(value) ? value : null;
  } catch {return null;}
}

/** Desktop attachment replies carry their target beside the media element,
 * under msg/extcommoninfo/refermsg, rather than the text-reply appmsg. */
export function weChatAttachmentReply(xml: string): {svrId: string} | undefined {
  if (!xml.trimStart().startsWith("<") || xml.length > 2 * 1024 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) return undefined;
  const child = (parent: Element | null, name: string): Element | null => {
    for (let node = parent?.firstChild; node; node = node.nextSibling)
      if (node.nodeType === 1 && node.nodeName === name) return node as Element;
    return null;
  };
  try {
    const root = new DOMParser({onError: () => {throw new Error("invalid reply XML");}})
      .parseFromString(xml, "text/xml").documentElement;
    if (root?.nodeName !== "msg") return undefined;
    const reference = child(child(root, "extcommoninfo"), "refermsg");
    const value = child(reference, "svrid");
    if (!value) return undefined;
    for (let node = value.firstChild; node; node = node.nextSibling)
      if (node.nodeType !== 3 && node.nodeType !== 4) return undefined;
    const id = value.textContent?.trim() ?? "";
    return /^[1-9]\d{0,19}$/.test(id) && BigInt(id) <= 0xffffffffffffffffn ? {svrId: id} : undefined;
  } catch {return undefined;}
}

/** Native ids exceed JavaScript's integer range. Tokenize strings first so
 * JSON embedded in a message body is never rewritten as an outer field. */
export function parseWeChatJson<T>(source: string): T {
  return JSON.parse(source.replace(
    /"(?:\\.|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (token, number: string | undefined) => number && /^-?\d+$/.test(number) &&
      !Number.isSafeInteger(Number(number)) ? `"${number}"` : token,
  )) as T;
}

export interface WeChatHistoryQuery {until?: number; limit: number}

/** The relay lists the most recent 20 sessions by default and supports a
 * limit, but no offset. Only a short explicitly sized page proves completion. */
export async function weChatConversationList<T>(read: (limit: number) => Promise<T[]>): Promise<T[]> {
  let limit = 1_000;
  while (true) {
    const rows = await read(limit);
    if (!Array.isArray(rows)) throw new Error("WeChat did not return a conversation list");
    if (rows.length < limit) return rows;
    if (limit === 65_536) throw new Error("WeChat's conversation list is too large to load completely");
    limit = Math.min(65_536, limit * 2);
  }
}

/** WeChat has an exclusive timestamp cursor, with one-second precision.
 * Finish the whole boundary second before advancing: subtracting one second
 * from a truncated page silently loses the rest of that second's messages. */
export async function weChatHistoryPage<T>(
  read: (query: WeChatHistoryQuery) => Promise<T[]>,
  timestamp: (row: T) => number,
  {until, limit}: WeChatHistoryQuery,
): Promise<{rows: T[]; nextUntil: number | null}> {
  const pageSize = Math.max(1, Math.min(1_000, Math.trunc(limit) || 50));
  if (until !== undefined && (!Number.isSafeInteger(until) || until <= 0))
    throw new Error("WeChat history cursor is invalid");
  let requested = pageSize + 1;
  let boundary: number | undefined;
  while (requested <= 65_536) {
    const rows = await read({until, limit: requested});
    if (!Array.isArray(rows) || rows.some((row) => {
      const time = timestamp(row);
      return !Number.isSafeInteger(time) || time <= 0 ||
        (until !== undefined && time >= until);
    })) throw new Error("WeChat returned an invalid history page");
    rows.sort((a, b) => timestamp(b) - timestamp(a));
    if (!rows.length) return {rows: [], nextUntil: null};
    boundary ??= timestamp(rows[Math.min(pageSize, rows.length) - 1]);
    const older = rows.some((row) => timestamp(row) < boundary!);
    if (older || rows.length < requested) {
      return {
        rows: rows.filter((row) => timestamp(row) >= boundary!).reverse(),
        nextUntil: older ? boundary : null,
      };
    }
    requested = Math.min(65_537, requested * 2);
  }
  throw new Error("WeChat history has too many messages in one second to page safely");
}
