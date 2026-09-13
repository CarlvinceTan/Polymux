/** Parse native history without rounding WeChat's 64-bit identifiers. JSON
 * string tokens are left untouched, including quoted JSON inside a message. */
export function parseWeChatHistory(output) {
  const lossless = String(output || "{}").replace(
    /"(?:\\.|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (token, number) => number && /^-?\d+$/.test(number) &&
      !Number.isSafeInteger(Number(number)) ? `"${number}"` : token,
  );
  const parsed = JSON.parse(lossless);
  if (!parsed || !Array.isArray(parsed.rows))
    throw new Error("WeChat history did not return a message list");
  return parsed;
}

export function historyMessageId(row) {
  const id = row?.server_id;
  if (typeof id === "number" && !Number.isSafeInteger(id)) return undefined;
  return id != null && String(id) !== "0" && String(id).trim()
    ? String(id) : undefined;
}

export function freshSentRows(rows, {
  sinceEpoch,
  selfWxid,
  excludedIds = [],
  expectedMessageId,
}) {
  const excluded = new Set(excludedIds);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const id = historyMessageId(row);
    // Numeric Name2Id rows belong to their message shard, not the account.
    // Missing author metadata cannot be replaced by File Transfer's rowid.
    return id && typeof selfWxid === "string" && selfWxid.length > 0 && row.sender_wxid === selfWxid &&
      Number.isFinite(sinceEpoch) && Number(row.create_time) >= sinceEpoch &&
      !excluded.has(id) && (!expectedMessageId || id === String(expectedMessageId));
  });
}

export function xmlElementText(xml, tag) {
  // Callers supply fixed tag names. CDATA is text, not entity-escaped XML.
  const value = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i")
    .exec(String(xml ?? ""))?.[1];
  if (value === undefined) return undefined;
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>|&(#x[\da-f]+|#\d+|lt|gt|quot|apos|amp);/gi,
    (token, cdata, entity) => {
      if (cdata !== undefined) return cdata;
      const named = {lt: "<", gt: ">", quot: '"', apos: "'", amp: "&"};
      if (named[entity]) return named[entity];
      const point = entity[1]?.toLowerCase() === "x"
        ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point) : token;
    });
}

export function hasMentionHistory(rows) {
  return rows.some((row) => typeof row.message_source === "string" ||
    typeof row.msg_source === "string" || Array.isArray(row.mentionedIds));
}

function mentionsMatch(row, expected) {
  if (!expected?.length) return true;
  const source = row.message_source ?? row.msg_source ?? "";
  const users = xmlElementText(source, "atuserlist");
  if (users === undefined && !Array.isArray(row.mentionedIds)) return false;
  const actual = new Set(Array.isArray(row.mentionedIds) ? row.mentionedIds :
    users.split(",").map((user) => user.trim()).filter(Boolean));
  return actual.size === new Set(expected).size && expected.every((user) => actual.has(user));
}

export function recallConfirmed(rows, messageId) {
  return rows.some((row) => {
    if (!["recalled", "system"].includes(row.message_kind)) return false;
    if (row.message_kind === "recalled" && historyMessageId(row) === String(messageId)) return true;
    if (String(row.recall?.replacedMsgId ?? "") === String(messageId)) return true;
    const revoke = /<revokemsg(?:\s[^>]*)?>[\s\S]*?<\/revokemsg>/i
      .exec(String(row.message_content ?? ""))?.[0];
    return revoke && ["newmsgid", "svrid"].some((tag) =>
      xmlElementText(revoke, tag) === String(messageId));
  });
}

/** A submitted operation needs one fresh exact row. Prefix matches, an older
 * identical message, or two indistinguishable concurrent sends are not proof. */
export function sentTextMessageId(rows, expected) {
  const candidates = freshSentRows(rows, expected).filter((row) => {
    if (!mentionsMatch(row, expected.mentions)) return false;
    if (expected.replyTo) {
      const content = String(row.message_content ?? "");
      const quote = /<refermsg(?:\s[^>]*)?>[\s\S]*?<\/refermsg>/i.exec(content)?.[0];
      const app = /<appmsg(?:\s[^>]*)?>([\s\S]*?)<\/appmsg>/i.exec(content)?.[1];
      return quote && app && xmlElementText(app, "type") === "57" &&
        xmlElementText(app, "title") === expected.body &&
        xmlElementText(quote, "svrid") === String(expected.replyTo);
    }
    return row.message_kind === "text" &&
      (row.message_content === expected.body || row.display_text === expected.body);
  });
  return candidates.length === 1 ? historyMessageId(candidates[0]) : undefined;
}

export function sentStickerMessageId(rows, expected) {
  const candidates = freshSentRows(rows, expected).filter((row) =>
    row.message_kind === "emoticon" &&
    /<emoji\b[^>]*\bmd5=["']([a-f\d]{32})["']/i
      .exec(String(row.message_content ?? ""))?.[1]?.toLowerCase() === expected.md5.toLowerCase(),
  );
  return candidates.length === 1 ? historyMessageId(candidates[0]) : undefined;
}
