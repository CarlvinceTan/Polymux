import {createHash} from "node:crypto";

// Desktop's session directory also contains folders. Their unread count and
// preview aggregate real conversations, which are listed separately.
const SESSION_CONTAINERS = new Set([
  "@placeholder_foldgroup",
  "brandsessionholder",
  "brandservicesessionholder",
]);

export function isWeChatSessionContainer(chatId: string): boolean {
  return SESSION_CONTAINERS.has(chatId);
}

export function weChatPortalChannelId(chatId: string): string {
  return createHash("sha256").update(chatId).digest("hex").slice(0, 24);
}

const CONTAINER_CHANNELS = new Set([...SESSION_CONTAINERS].map(weChatPortalChannelId));

/** Also recognizes previously imported folders without deleting local rooms. */
export function isWeChatContainerChannel(channelId: string | undefined): boolean {
  return channelId !== undefined && CONTAINER_CHANNELS.has(channelId);
}

/** Untitled groups can use their native member directory, never the latest
 * speaker's name. Keep native member order and distinct people with one name. */
export function weChatMemberTitle(rows: unknown, self: string | null): string | null {
  if (!Array.isArray(rows)) return null;
  const members = new Map<string, string>();
  for (const row of rows) {
    if (!row || typeof row.wxid !== "string" || row.wxid === self) continue;
    const name = [row.group_nickname, row.display_name].find(value =>
      typeof value === "string" && value.trim() && value.trim() !== row.wxid);
    if (typeof name === "string") members.set(row.wxid, name.trim());
  }
  const names = [...members.values()];
  return names.length ? `${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}`.slice(0, 1_024) : null;
}
