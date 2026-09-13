import type {ChatCallDto} from "@polymux/protocol";
import {weChatCallText} from "@polymux/wechat";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** These are call captions, not arbitrary message text. Require bridge call
 * metadata (or an exact legacy notice) before interpreting a duration. */
export function callOf(content: Record<string, unknown>): ChatCallDto | null {
  const explicit = record(content["co.polymux.call"]);
  const action = record(content["com.beeper.action_message"]);
  const native = record(content["co.polymux.wechat.native"]);
  const body = typeof content.body === "string" ? content.body.trim() : "";
  const wechat = content["co.polymux.wechat.remote"] === true;
  const caption = wechat && typeof native.body === "string" ? weChatCallText(native.body) : null;
  const legacy = content.msgtype === "m.notice" &&
    /^(?:(?:Missed|Incoming|Outgoing|Cancelled|Canceled|Declined) (?:voice |video |phone )?call|(?:Video |Voice |Phone )?Call (?:ended|missed|rejected|disconnected))(?: \([\d\s:.,a-z]+\))?[.!]?$/i.test(body);
  const structured = explicit.kind === "voice" || explicit.kind === "video";
  if (!structured && action.type !== "call" && !caption &&
      !(wechat && (body === "[Call]" || ["call", "voip", "voipmsg"].includes(String(native.kind)))) && !legacy) return null;
  const text = (caption ?? body).slice(0, 512);
  const kind = explicit.kind === "video" || action.call_type === "video" || /\bvideo\b|视频|視訊/i.test(text) ? "video" : "voice";
  const status: ChatCallDto["status"] = /missed|not answered|wasn't answered|未接听|未接聽|无人接听/i.test(text) ? "missed"
    : /declin|reject|拒绝|拒絕/i.test(text) ? "declined"
    : /cancel|取消/i.test(text) ? "cancelled"
    : /incoming/i.test(text) ? "incoming"
    : /started|starting/i.test(text) ? "started" : "unknown";
  const time = /(?:^|[^\d:])(\d{1,4}:\d{2}(?::\d{2})?)(?![\d:])/.exec(text)?.[1];
  let durationSeconds: number | null = null;
  if (time) {
    const parts = time.split(":").map(Number);
    if (parts.slice(1).every(n => n < 60)) durationSeconds = parts.reduce((sum, n) => sum * 60 + n, 0);
  }
  // Some bridges format their call duration as words instead of a clock.
  const words = /\(((?:\d+\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)[,\s]*)+)\)/i.exec(text)?.[1];
  if (durationSeconds === null && words) {
    durationSeconds = [...words.matchAll(/(\d+)\s*(h[a-z]*|m[a-z]*|s[a-z]*)/gi)]
      .reduce((sum, m) => sum + Number(m[1]) * (m[2][0].toLowerCase() === "h" ? 3600 : m[2][0].toLowerCase() === "m" ? 60 : 1), 0);
    if (!Number.isSafeInteger(durationSeconds)) durationSeconds = null;
  }
  if (typeof explicit.durationSeconds === "number" && Number.isSafeInteger(explicit.durationSeconds) && explicit.durationSeconds >= 0)
    durationSeconds = explicit.durationSeconds;
  const statuses: ChatCallDto["status"][] = ["ended", "missed", "declined", "cancelled", "incoming", "started", "unknown"];
  const resolvedStatus = statuses.includes(explicit.status as ChatCallDto["status"]) ? explicit.status as ChatCallDto["status"]
    : status !== "unknown" ? status : durationSeconds !== null || /ended|结束|結束/i.test(text) ? "ended" : "unknown";
  return {kind, status: resolvedStatus, durationSeconds: ["missed", "declined", "cancelled"].includes(resolvedStatus) ? null : durationSeconds};
}
