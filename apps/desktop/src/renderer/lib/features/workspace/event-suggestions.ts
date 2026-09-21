import type {CalendarEventDto, CalendarEventInput} from '@polymux/protocol';

/**
 * Apple-Calendar-style event suggestions grounded in the Hub.
 *
 * The Hub (messages + email) is the evidence; the calendar snapshot is the
 * dedup authority. Extraction is deliberately on-device and deterministic so
 * suggestions work with no model configured, cost no inference, and never
 * send message bodies anywhere. A future LLM pass can upgrade confidence and
 * titles — it must reuse these ids and dedup keys so dismissals survive.
 */

export interface SuggestionInput {
  id: string;
  kind: 'message' | 'email';
  /** Human label for the origin, e.g. "WhatsApp with Maya". */
  label: string;
  text: string;
  /** When the source was written, ISO string. */
  sentAt: string;
  url?: string;
}

export interface EventSuggestionSource {
  kind: 'message' | 'email';
  id: string;
  label: string;
  preview: string;
}

export interface EventSuggestion {
  /** Stable across rescans: hash of normalized title + start + allDay. */
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  url?: string;
  availability: CalendarEventInput['availability'];
  alarmMinutes?: number;
  /** 0-1, filtered below 0.5 at extraction. */
  confidence: number;
  reason: string;
  source: EventSuggestionSource;
  /** How many additional inputs merged into this one. */
  alsoSeen?: number;
  /** Existing calendar event this duplicates, when known. */
  duplicateOf?: string;
}

const MIN_CONFIDENCE = 0.5;
const MAX_TITLE_WORDS = 7;
const EXCERPT_CHARS = 220;

const TRIGGERS = [
  'dinner', 'lunch', 'breakfast', 'brunch', 'coffee', 'drinks',
  'meeting', 'call', 'sync', 'standup', 'stand-up', 'interview',
  'appointment', 'reservation', 'booking', 'booked',
  'flight', 'concert', 'show', 'gig', 'wedding', 'party', 'birthday',
  'dentist', 'doctor', 'checkup', 'check-up',
  'class', 'lecture', 'workshop', 'conference', 'summit',
  'trip', 'travel', 'hotel', 'check-in', 'checkin',
] as const;

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sept: 8, sep: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const STOPWORDS = new Set([
  'a', 'an', 'the', 'on', 'at', 'in', 'for', 'to', 'of', 'and', 'or', 'with',
  'my', 'our', 'your', 'this', 'that', 'are', 'is', 'we', 'you', 'let',
]);

export function extractEventSuggestions(
  inputs: SuggestionInput[],
  now = new Date(),
): EventSuggestion[] {
  const found: EventSuggestion[] = [];
  for (const input of inputs) {
    const text = (input.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 12 || text.length > 4000) continue;
    for (const sentence of splitSentences(text)) {
      const candidate = suggestFromSentence(sentence, input, now);
      if (candidate && candidate.confidence >= MIN_CONFIDENCE) found.push(candidate);
      if (found.length >= inputs.length * 2 + 8) break;
    }
  }
  return sortSuggestions(mergeDuplicateSuggestions(found));
}

export function suggestFromSentence(
  sentence: string,
  input: SuggestionInput,
  now: Date,
): EventSuggestion | null {
  const cleaned = sentence.trim();
  if (cleaned.length < 12) return null;
  const lower = cleaned.toLowerCase();

  const trigger = TRIGGERS.find((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(cleaned));
  const flightCode = /\b([A-Z]{2})\s?(\d{2,4})\b/.exec(cleaned);
  const hasDate = findDate(cleaned, now) !== null;
  const time = findTimeRange(cleaned);
  const hasTime = time !== null;

  // Require signal, not just any sentence with a date fragment: a trigger
  // word, a flight code, or both a date and a time. This is what keeps
  // "see you sometime" and order-tracking dates from becoming noise.
  if (!trigger && !flightCode && !(hasDate && hasTime)) return null;
  // A bare trigger with no date at all ("let's do dinner soon") is not
  // schedulable — Apple shows nothing there either.
  if (!hasDate && !hasTime) return null;

  const date = findDate(cleaned, now) ?? dateFromSentAt(input.sentAt, now);
  if (!date) return null;

  const {start, end, allDay} = resolveRange(date, time, now);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  // Stale evidence is not a suggestion. Keep a one-day grace for
  // "last night"-style follow-ups, then drop the past.
  if (end.getTime() < now.getTime() - 86_400_000) return null;
  // Far-future dates from a misparsed year are worse than no suggestion.
  if (start.getTime() > now.getTime() + 400 * 86_400_000) return null;

  const title = buildTitle(cleaned, trigger ?? (flightCode ? 'flight' : null), flightCode?.[0] ?? null);
  if (!title) return null;
  const location = extractLocation(cleaned);
  const url = input.url ?? firstUrl(cleaned);
  const preview = excerpt(cleaned);

  let confidence = 0.55;
  if (trigger) confidence += 0.15;
  if (flightCode) confidence += 0.1;
  if (hasTime) confidence += 0.1;
  else if (!trigger) confidence -= 0.15;
  if (location) confidence += 0.08;
  if (url) confidence += 0.04;
  if (start.getTime() < now.getTime()) confidence -= 0.2;
  confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));

  const sentLabel = safeDate(input.sentAt)?.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
  const reason = trigger
    ? `Mentions ${trigger} on ${describeDate(start, allDay)}`
    : hasTime
      ? `Mentions ${describeDate(start, allDay)}`
      : `Dated ${describeDate(start, allDay)}`;
  void sentLabel;

  const normalized = normalizeTitle(title);
  const id = `sug-${fnv1a(`${normalized}|${start.toISOString()}|${allDay ? 'day' : 'time'}`).toString(16)}`;

  return {
    id,
    title,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay,
    ...(location ? {location} : {}),
    notes: `${preview}\n\nSuggested from ${input.label}.`,
    ...(url ? {url} : {}),
    availability: allDay ? 'free' : 'busy',
    ...(allDay ? {} : {alarmMinutes: 15}),
    confidence,
    reason,
    source: {kind: input.kind, id: input.id, label: input.label, preview},
  };
}

/** Remove suggestions that duplicate an event already on the calendar. */
export function dedupeSuggestionsAgainstEvents(
  suggestions: EventSuggestion[],
  events: CalendarEventDto[],
): EventSuggestion[] {
  return suggestions.filter((suggestion) => !findDuplicateEvent(suggestion, events));
}

/** The existing event a suggestion duplicates, if any. */
export function findDuplicateEvent(
  suggestion: EventSuggestion,
  events: CalendarEventDto[],
): CalendarEventDto | undefined {
  const startMs = Date.parse(suggestion.start);
  return events.find((event) => {
    if (!titlesMatch(suggestion.title, event.title)) return false;
    if (suggestion.allDay || event.allDay) return sameCalendarDay(suggestion.start, event.start);
    const eventStart = Date.parse(event.start);
    const eventEnd = Date.parse(event.end);
    if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd)) return false;
    const overlap = Math.min(Date.parse(suggestion.end), eventEnd) - Math.max(startMs, eventStart);
    const suggestionLen = Date.parse(suggestion.end) - startMs;
    return Math.abs(eventStart - startMs) <= 30 * 60_000 || (suggestionLen > 0 && overlap / suggestionLen > 0.5);
  });
}

/** Merge suggestions that are the same event seen in more than one message. */
export function mergeDuplicateSuggestions(suggestions: EventSuggestion[]): EventSuggestion[] {
  const byKey = new Map<string, EventSuggestion>();
  for (const suggestion of suggestions) {
    const key = `${normalizeTitle(suggestion.title)}|${suggestion.allDay ? suggestion.start.slice(0, 10) : suggestion.start.slice(0, 13)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, suggestion);
      continue;
    }
    // Keep the strongest evidence; count the rest so the UI can say "seen twice".
    if (suggestion.confidence > existing.confidence) {
      byKey.set(key, {...suggestion, alsoSeen: (existing.alsoSeen ?? 1) + 1});
    } else {
      byKey.set(key, {...existing, alsoSeen: (existing.alsoSeen ?? 1) + 1});
    }
  }
  return [...byKey.values()];
}

export function filterDismissed(
  suggestions: EventSuggestion[],
  dismissed: ReadonlySet<string>,
): EventSuggestion[] {
  if (!dismissed.size) return suggestions;
  return suggestions.filter((suggestion) => !dismissed.has(suggestion.id));
}

/** Full metadata for `calendar.create` — a suggestion must already be a proper event. */
export function buildSuggestionInput(
  suggestion: EventSuggestion,
  calendarId: string,
): CalendarEventInput {
  return {
    calendarId,
    title: suggestion.title,
    start: suggestion.start,
    end: suggestion.end,
    allDay: suggestion.allDay,
    ...(suggestion.location ? {location: suggestion.location} : {}),
    ...(suggestion.notes ? {notes: suggestion.notes} : {}),
    ...(suggestion.url ? {url: suggestion.url} : {}),
    availability: suggestion.availability,
    ...(suggestion.alarmMinutes !== undefined ? {alarmMinutes: suggestion.alarmMinutes} : {}),
  };
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titlesMatch(left: string, right: string): boolean {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const tokensA = new Set(a.split(' ').filter((token) => token && !STOPWORDS.has(token)));
  const tokensB = new Set(b.split(' ').filter((token) => token && !STOPWORDS.has(token)));
  if (!tokensA.size || !tokensB.size) return false;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared += 1;
  return shared / Math.max(tokensA.size, tokensB.size) >= 0.6;
}

// --- bounded Hub collection -------------------------------------------------

export interface SuggestionHubReader {
  chats(): Promise<Array<{id: string; name: string; platform: string; lastActivity?: string | null}>>;
  chatMessages(
    chatId: string,
    limit?: number,
  ): Promise<{messages: Array<{id: string; body: string; sentAt: string; linkPreview?: {url?: string | null} | null}>}>;
  status(): Promise<{email: {accounts: Array<{id: string}>}}>;
  mailEnvelopes(request: {account?: string; folder?: string; pageSize?: number}): Promise<
    Array<{id: string; subject: string; from: {name?: string | null; address?: string | null} | null; date: string; preview?: string}>
  >;
  mailMessage(
    id: string,
    account?: string,
    folder?: string,
  ): Promise<{subject: string; body: string; date: string}>;
}

export interface CollectOptions {
  maxChats?: number;
  messagesPerChat?: number;
  maxEmails?: number;
  lookbackDays?: number;
}

/**
 * Bounded Hub read for suggestions: recent chats first, newest mail next.
 * Every source is best-effort — one failing chat never blocks the rest —
 * and nothing here marks anything read.
 */
export async function collectSuggestionInputs(
  reader: SuggestionHubReader,
  now = new Date(),
  options: CollectOptions = {},
): Promise<SuggestionInput[]> {
  const maxChats = options.maxChats ?? 12;
  const messagesPerChat = options.messagesPerChat ?? 15;
  const maxEmails = options.maxEmails ?? 15;
  const lookbackMs = (options.lookbackDays ?? 21) * 86_400_000;
  const cutoff = now.getTime() - lookbackMs;
  const inputs: SuggestionInput[] = [];

  try {
    const chats = (await reader.chats())
      .filter((chat) => !Date.parse(chat.lastActivity ?? '') || Date.parse(chat.lastActivity!) >= cutoff)
      .sort((a, b) => Date.parse(b.lastActivity ?? '') - Date.parse(a.lastActivity ?? ''))
      .slice(0, maxChats);
    for (const chat of chats) {
      try {
        const page = await reader.chatMessages(chat.id, messagesPerChat);
        for (const message of page.messages.slice(0, messagesPerChat)) {
          if (!message.body?.trim() || Date.parse(message.sentAt) < cutoff) continue;
          inputs.push({
            id: `${chat.id}:${message.id}`,
            kind: 'message',
            label: `${chat.platform} with ${chat.name}`,
            text: message.body,
            sentAt: message.sentAt,
            ...(message.linkPreview?.url ? {url: message.linkPreview.url} : {}),
          });
        }
      } catch {
        // One unreadable chat is not a failed scan.
      }
    }
  } catch {
    // No chats readable — mail may still suggest.
  }

  try {
    const accounts = (await reader.status()).email.accounts.map((account) => account.id);
    const targets = accounts.length ? accounts.slice(0, 3) : [undefined];
    let remaining = maxEmails;
    for (const account of targets) {
      if (remaining <= 0) break;
      try {
        const envelopes = await reader.mailEnvelopes({account, folder: 'INBOX', pageSize: Math.min(remaining, 10)});
        for (const envelope of envelopes) {
          if (remaining <= 0) break;
          if (Date.parse(envelope.date) < cutoff) continue;
          const subject = envelope.subject?.trim() ?? '';
          const preview = envelope.preview?.trim() ?? '';
          // A promising envelope earns a full read; anything else contributes
          // only its subject line so the scan stays bounded.
          const looksPromising = /\b(invitation|invite|booking|reservation|itinerary|appointment|meeting|flight|hotel|ticket|r\.?s\.?v\.?p\.?|dinner|lunch)\b/i.test(`${subject} ${preview}`);
          if (looksPromising) {
            try {
              const full = await reader.mailMessage(envelope.id, account, 'INBOX');
              inputs.push({
                id: `mail:${account ?? 'default'}:${envelope.id}`,
                kind: 'email',
                label: `Email${envelope.from?.address ? ` from ${envelope.from.address}` : ''}`,
                text: `${full.subject}\n${full.body}`.slice(0, 3000),
                sentAt: full.date,
              });
              remaining -= 1;
              continue;
            } catch {
              // Fall through to the envelope-only input below.
            }
          }
          if (subject) {
            inputs.push({
              id: `mail:${account ?? 'default'}:${envelope.id}:subject`,
              kind: 'email',
              label: `Email${envelope.from?.address ? ` from ${envelope.from.address}` : ''}`,
              text: preview ? `${subject}\n${preview}` : subject,
              sentAt: envelope.date,
            });
            remaining -= 1;
          }
        }
      } catch {
        // One unreadable mailbox is not a failed scan.
      }
    }
  } catch {
    // No mail configured — chat evidence still stands.
  }

  return inputs;
}

// --- internals ---------------------------------------------------------------

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?\n])\s+(?=[A-Z0-9“"(\[])/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function buildTitle(sentence: string, trigger: string | null, flight: string | null): string | null {
  if (flight) {
    const route = /\b([A-Z][a-z]+)\s+(to)\s+([A-Z][a-z]+)\b/.exec(sentence);
    if (route) return `Flight ${flight} ${route[1]} to ${route[3]}`;
    return `Flight ${flight}`;
  }
  if (!trigger) {
    const words = sentence.split(/\s+/).slice(0, MAX_TITLE_WORDS).join(' ');
    return capitalize(words.replace(/[.?!]+$/, '')) || null;
  }
  // "dinner with Maya on Friday" -> "Dinner with Maya"
  const pattern = new RegExp(`(.{0,40}?)\\b${escapeRegExp(trigger)}\\b(.{0,40})`, 'i');
  const match = pattern.exec(sentence);
  const fragment = match ? `${match[1]} ${trigger} ${match[2]}`.replace(/\s+/g, ' ').trim() : trigger;
  const clipped = fragment
    .replace(/\b(on|at|for)\b\s+(mon|tue|wed|thu|fri|sat|sun)[a-z]*.*$/i, '')
    .replace(/\b(on|at|for)\b\s+\S+\s+\d{1,2}.*$/i, '')
    .replace(/\s+(at|on)\s+\d.*$/i, '')
    .trim();
  const words = clipped.split(/\s+/).filter(Boolean).slice(0, MAX_TITLE_WORDS).join(' ');
  return capitalize(words.replace(/[.?!,:;]+$/, '')) || capitalize(trigger);
}

function extractLocation(sentence: string): string | undefined {
  const candidates: string[] = [];
  const atPattern = /\bat\s+([A-Z0-9a-z][^,.;\n!?]{2,60})/g;
  let match: RegExpExecArray | null;
  while ((match = atPattern.exec(sentence)) !== null) {
    let value = match[1].trim().replace(/\s+(at|on)\s+\d.*$/i, '').trim();
    // "tomorrow at 7pm at Marina Bay Sands" captures from the first "at":
    // strip a leading time (and its trailing "at") to reach the real place.
    value = value.replace(/^(\d{1,2}(:\d{2})?\s*([ap]\.?m\.?)?\s*(at\s+)?)/i, '').trim();
    // A place starts with a capital or digit ("Marina Bay Sands", "COM3-01-20");
    // "was great" or "7pm was great" never does.
    if (!/^[A-Z0-9]/.test(value)) continue;
    if (/\b(was|were|is|are|had|has|will|would)\b/i.test(value)) continue;
    if (/^(noon|midnight|morning|afternoon|evening|night)$/i.test(value)) continue;
    if (value.split(/\s+/).length > 7) continue;
    candidates.push(value);
  }
  const inPattern = /\bin\s+([A-Z][A-Za-z'&.-]+(?:\s+[A-Z][A-Za-z'&.-]+){0,3})/.exec(sentence);
  if (inPattern && !/^(the|morning|afternoon|evening|spring|summer|autumn|winter)\b/i.test(inPattern[1])) {
    candidates.push(inPattern[1].trim());
  }
  // Prefer the longest plausible place ("Marina Bay Sands" over "Marina").
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0]?.replace(/[.?!]+$/, '');
}

function firstUrl(text: string): string | undefined {
  return /https?:\/\/[^\s)]+/.exec(text)?.[0];
}

function excerpt(text: string): string {
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS - 1).trimEnd()}…` : text;
}

interface ParsedTime {
  hour: number;
  minute: number;
  hasTime: boolean;
  endHour?: number;
  endMinute?: number;
  durationMinutes?: number;
}

function findTimeRange(text: string): ParsedTime | null {
  // "3-5pm", "3 to 5pm", "10:00-11:30"
  const range = /(\d{1,2})(?::(\d{2}))?\s*(?:-|–|—|\bto\b)\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i.exec(text);
  if (range) {
    const meridiem = range[5]?.toLowerCase();
    let startHour = Number(range[1]);
    const startMin = Number(range[2] ?? 0);
    let endHour = Number(range[3]);
    const endMin = Number(range[4] ?? 0);
    if (meridiem?.startsWith('p') && startHour < 12) startHour += 12;
    if (meridiem?.startsWith('p') && endHour < 12) endHour += 12;
    if (meridiem?.startsWith('a')) {
      if (startHour === 12) startHour = 0;
      if (endHour === 12) endHour = 0;
    }
    if (startHour <= 23 && endHour <= 23) {
      return {hour: startHour, minute: startMin, hasTime: true, endHour, endMinute: endMin};
    }
  }
  const clock = /(?:\bat\b\s*)?(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)\b/i.exec(text);
  if (clock) {
    let hour = Number(clock[1]) % 12;
    if (/p/i.test(clock[3])) hour += 12;
    return {hour, minute: Number(clock[2] ?? 0), hasTime: true};
  }
  const twentyFour = /(?:\bat\b\s*)?\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (twentyFour) return {hour: Number(twentyFour[1]), minute: Number(twentyFour[2]), hasTime: true};
  if (/\bnoon\b/i.test(text)) return {hour: 12, minute: 0, hasTime: true};
  if (/\bmidnight\b/i.test(text)) return {hour: 0, minute: 0, hasTime: true};
  const until = /\buntil\s+(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i.exec(text);
  if (until) {
    let endHour = Number(until[1]);
    const endMin = Number(until[2] ?? 0);
    const suffix = until[3]?.toLowerCase();
    if (suffix?.startsWith('p') && endHour < 12) endHour += 12;
    if (suffix?.startsWith('a') && endHour === 12) endHour = 0;
    return {hour: 9, minute: 0, hasTime: false, endHour, endMinute: endMin};
  }
  const duration = /\bfor\s+(\d+)\s*(hours?|hrs?|minutes?|mins?)\b/i.exec(text);
  if (duration) {
    const amount = Number(duration[1]);
    const minutes = /hour|hr/i.test(duration[2]) ? amount * 60 : amount;
    // A bare duration still needs a start time from elsewhere; mark as no
    // explicit time so the caller can leave the event all-day or drop it.
    return {hour: 9, minute: 0, hasTime: false, durationMinutes: minutes};
  }
  return null;
}

function findDate(text: string, now: Date): Date | null {
  const lower = text.toLowerCase();

  // Relative days first — they beat any stray absolute date in the same line.
  if (/\bday after tomorrow\b/.test(lower)) return addDays(startOfDay(now), 2);
  if (/\btomorrow\b/.test(lower) || /\btmrw?\b/.test(lower)) return addDays(startOfDay(now), 1);
  if (/\btonight\b/.test(lower)) return startOfDay(now);
  if (/\btoday\b/.test(lower)) return startOfDay(now);
  if (/\byesterday\b/.test(lower) || /\blast night\b/.test(lower)) return addDays(startOfDay(now), -1);

  // "last Monday" is the recent past, not the upcoming Monday — it must
  // resolve backwards so the staleness filter can drop it.
  const lastWeekday = /\blast\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(lower);
  if (lastWeekday) return pastWeekdayFrom(now, WEEKDAYS[lastWeekday[1]]);

  const nextWeekday = /\bnext\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(lower);
  if (nextWeekday) return weekdayFrom(now, WEEKDAYS[nextWeekday[1]], 7);
  const thisWeekday = /\bthis\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(lower);
  if (thisWeekday) return weekdayFrom(now, WEEKDAYS[thisWeekday[1]], 0);
  const bareWeekday = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(lower);
  // Avoid weekday substrings inside other matches (e.g. "sun" in "sunday roast"
  // is fine — that IS the weekday — but not inside an email address).
  if (bareWeekday && !/@/.test(text)) {
    const candidate = weekdayFrom(now, WEEKDAYS[bareWeekday[1]], 0);
    // A weekday mentioned beside a time is almost always the upcoming one,
    // even when an absolute date also appears in the thread.
    if (/\d/.test(text) || candidate.getTime() >= startOfDay(now).getTime()) return candidate;
  }

  // "September 20th", "20 September", "Sep 20"
  const monthFirst = /\b(january|february|march|april|may|june|july|august|september|sept|sep|october|oct|november|nov|december|dec|jan|feb|mar|apr|jun|jul|aug)\.?(\s+\d{1,2})(st|nd|rd|th)?\b/i.exec(text);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    const day = Number.parseInt(monthFirst[2], 10);
    const year = pickYear(now, month, day);
    const candidate = new Date(now.getFullYear() + (year === 'next' ? 1 : 0), month, day);
    if (Number.isFinite(candidate.getTime())) return startOfDay(candidate);
  }
  const dayFirst = /\b(\d{1,2})(st|nd|rd|th)?\s+(of\s+)?(january|february|march|april|may|june|july|august|september|sept|sep|october|oct|november|nov|december|dec|jan|feb|mar|apr|jun|jul|aug)\b/i.exec(text);
  if (dayFirst) {
    const month = MONTHS[dayFirst[4].toLowerCase()];
    const day = Number.parseInt(dayFirst[1], 10);
    const year = pickYear(now, month, day);
    const candidate = new Date(now.getFullYear() + (year === 'next' ? 1 : 0), month, day);
    if (Number.isFinite(candidate.getTime())) return startOfDay(candidate);
  }
  // ISO and numeric dates.
  const iso = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (iso) {
    const candidate = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (Number.isFinite(candidate.getTime())) return startOfDay(candidate);
  }
  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/.exec(text);
  if (numeric) {
    // Assume day-first (Polymux default locale is en-AU/en-GB leaning); fall
    // back gracefully when the first field can only be a month.
    let day = Number(numeric[1]);
    let month = Number(numeric[2]) - 1;
    if (day > 31 || month > 11) return null;
    if (day <= 12 && month > 12) {
      // already day-first, nothing to swap
    }
    if (numeric[3]) {
      const candidate = new Date(Number(numeric[3]), month, day);
      if (Number.isFinite(candidate.getTime())) return startOfDay(candidate);
    } else {
      const year = pickYear(now, month, day);
      const candidate = new Date(now.getFullYear() + (year === 'next' ? 1 : 0), month, day);
      if (Number.isFinite(candidate.getTime())) return startOfDay(candidate);
    }
  }
  return null;
}

function resolveRange(
  day: Date,
  time: ParsedTime | null,
  _now: Date,
): {start: Date; end: Date; allDay: boolean} {
  if (!time?.hasTime) {
    if (time?.endHour !== undefined) {
      const start = new Date(day);
      start.setHours(9, 0, 0, 0);
      const end = new Date(day);
      end.setHours(time.endHour, time.endMinute ?? 0, 0, 0);
      if (end > start) return {start, end, allDay: false};
    }
    const start = startOfDay(day);
    return {start, end: addDays(start, 1), allDay: true};
  }
  const start = new Date(day);
  start.setHours(time.hour, time.minute, 0, 0);
  if (time.endHour !== undefined) {
    const end = new Date(day);
    end.setHours(time.endHour, time.endMinute ?? 0, 0, 0);
    if (end > start) return {start, end, allDay: false};
  }
  if (time.durationMinutes) {
    return {start, end: new Date(start.getTime() + time.durationMinutes * 60_000), allDay: false};
  }
  return {start, end: new Date(start.getTime() + 3_600_000), allDay: false};
}

function dateFromSentAt(sentAt: string, now: Date): Date | null {
  const sent = safeDate(sentAt);
  if (!sent) return startOfDay(now);
  // A timed message with no date ("see you at 7") means today, or tomorrow
  // when that time already passed.
  return startOfDay(sent > now ? now : now);
}

function weekdayFrom(now: Date, weekday: number, minOffset: number): Date {
  const base = startOfDay(now);
  let offset = (weekday - base.getDay() + 7) % 7;
  if (offset < minOffset) offset += 7;
  // "next Friday" from a Friday is 7 days out, never today.
  if (minOffset >= 7 && offset < 7) offset += 7;
  return addDays(base, offset);
}

function pastWeekdayFrom(now: Date, weekday: number): Date {
  const base = startOfDay(now);
  let offset = -((base.getDay() - weekday + 7) % 7);
  // "last Monday" said on a Monday means seven days ago, not today.
  if (offset === 0) offset = -7;
  return addDays(base, offset);
}

function pickYear(now: Date, month: number, day: number): 'this' | 'next' {
  const thisYear = new Date(now.getFullYear(), month, day).getTime();
  // A date more than a week in the past belongs to next year ("Jan 5" said in
  // September); within the last week it is likely just-passed context.
  return thisYear < startOfDay(now).getTime() - 7 * 86_400_000 ? 'next' : 'this';
}

function describeDate(date: Date, allDay: boolean): string {
  const day = date.toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'});
  if (allDay) return day;
  const time = date.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
  return `${day} at ${time}`;
}

function sameCalendarDay(left: string, right: string): boolean {
  const a = safeDate(left);
  const b = safeDate(right);
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function sortSuggestions(suggestions: EventSuggestion[]): EventSuggestion[] {
  return [...suggestions].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start) || b.confidence - a.confidence,
  );
}

function startOfDay(day: Date): Date {
  const result = new Date(day);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(day: Date, amount: number): Date {
  const result = new Date(day);
  result.setDate(result.getDate() + amount);
  return result;
}

function safeDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
