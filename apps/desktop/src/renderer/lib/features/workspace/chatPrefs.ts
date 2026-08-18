/**
 * What the chat list has been told about individual conversations: which are
 * pinned to the top, and which have been hidden from it.
 *
 * The list's natural order is whatever the platform reports — most recent
 * first — which is right until one conversation matters more than its last
 * message says. Pinning lifts it out of that order; hiding takes a room nobody
 * reads out of the list without leaving the platform it belongs to.
 *
 * Hiding never removes anything. What is hidden collects under one row at the
 * foot of the list that expands the way the rail's account groups do, so there
 * is always a way back to a conversation and always a reminder that it exists.
 *
 * Kept in localStorage next to `hubRailOrder`, for the same reason: it is a
 * preference about this window rather than anything the backend needs to know.
 * Only ids are stored, so a chat that disappears leaves a stale id behind and a
 * stale id simply never matches.
 */
const KEY = 'flareaiHubChatPrefs';

export type ChatPrefs = {
  /** Chat ids lifted to the top of the list, in the order they were pinned. */
  pinned: string[];
  /** Chat ids collected under the hidden row rather than shown in the list. */
  hidden: string[];
};

const EMPTY: ChatPrefs = {pinned: [], hidden: []};

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

export function loadChatPrefs(): ChatPrefs {
  if (typeof localStorage === 'undefined') return EMPTY;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return EMPTY;
    const stored = raw as Partial<ChatPrefs>;
    return {pinned: ids(stored.pinned), hidden: ids(stored.hidden)};
  } catch {
    return EMPTY;
  }
}

function persist(prefs: ChatPrefs): ChatPrefs {
  if (typeof localStorage === 'undefined') return prefs;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // A full or unavailable store costs the arrangement, not the list.
  }
  return prefs;
}

/** Pins a chat, or unpins one already pinned. A pinned chat is never hidden. */
export function togglePinned(prefs: ChatPrefs, id: string): ChatPrefs {
  const pinned = prefs.pinned.includes(id)
    ? prefs.pinned.filter((item) => item !== id)
    : [...prefs.pinned, id];
  return persist({pinned, hidden: prefs.hidden.filter((item) => item !== id)});
}

/** Hides a chat, or restores one already hidden. A hidden chat is never pinned. */
export function toggleHidden(prefs: ChatPrefs, id: string): ChatPrefs {
  const hidden = prefs.hidden.includes(id)
    ? prefs.hidden.filter((item) => item !== id)
    : [...prefs.hidden, id];
  return persist({pinned: prefs.pinned.filter((item) => item !== id), hidden});
}

/**
 * The list as it is shown: pinned rows first in the order they were pinned,
 * everything else in the order it arrived. Hidden rows are left out — they are
 * listed separately, under their own row — except for the one currently open,
 * which stays where it is rather than vanishing out from under whoever is
 * reading it.
 */
export function arrangeChats<T>(
  chats: T[],
  key: (chat: T) => string,
  prefs: ChatPrefs,
  open: string | null = null,
): T[] {
  const rank = new Map(prefs.pinned.map((id, index) => [id, index] as const));
  return chats
    .filter((chat) => !prefs.hidden.includes(key(chat)) || key(chat) === open)
    .map((chat, index) => ({chat, index}))
    .sort((a, b) => {
      const left = rank.get(key(a.chat)) ?? Number.POSITIVE_INFINITY;
      const right = rank.get(key(b.chat)) ?? Number.POSITIVE_INFINITY;
      return left === right ? a.index - b.index : left - right;
    })
    .map((entry) => entry.chat);
}

/** What the hidden row holds: everything hidden that is not currently open. */
export function hiddenChats<T>(chats: T[], key: (chat: T) => string, prefs: ChatPrefs, open: string | null = null): T[] {
  return chats.filter((chat) => prefs.hidden.includes(key(chat)) && key(chat) !== open);
}
