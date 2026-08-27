import type {
  CalendarEventDto,
  CalendarEventInput,
  CalendarRecurrenceDto,
} from "@polymux/protocol";

/** A deliberately bounded iCalendar reader: VEVENT fields Polymux can
 * faithfully round-trip are imported, while unsupported components are left
 * alone instead of guessed at. */
export function parseIcsEvents(source: string, calendarId: string): {
  events: CalendarEventInput[];
  skipped: number;
} {
  const lines = unfold(source);
  const events: CalendarEventInput[] = [];
  let skipped = 0;
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.toUpperCase() === "BEGIN:VEVENT") {
      current = [];
      continue;
    }
    if (line.toUpperCase() === "END:VEVENT") {
      if (!current) continue;
      const parsed = parseEvent(current, calendarId);
      if (parsed) events.push(parsed);
      else skipped += 1;
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  return {events, skipped};
}

export function serializeIcsEvents(events: CalendarEventDto[]): string {
  const body = events.flatMap((event) => {
    const lines = [
      "BEGIN:VEVENT",
      `UID:${escapeText(event.id)}@polymux`,
      `DTSTAMP:${utcStamp(new Date())}`,
      event.allDay
        ? `DTSTART;VALUE=DATE:${localDateStamp(new Date(event.start))}`
        : `DTSTART:${utcStamp(new Date(event.start))}`,
      event.allDay
        ? `DTEND;VALUE=DATE:${localDateStamp(new Date(event.end))}`
        : `DTEND:${utcStamp(new Date(event.end))}`,
      `SUMMARY:${escapeText(event.title)}`,
    ];
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    if (event.recurrence) lines.push(`RRULE:${recurrenceLine(event.recurrence)}`);
    if (event.alarmMinutes !== undefined) {
      lines.push(
        "BEGIN:VALARM",
        `TRIGGER:-PT${Math.max(0, event.alarmMinutes)}M`,
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(event.title)}`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
    return lines;
  });
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Polymux//Calendar//EN",
    "CALSCALE:GREGORIAN",
    ...body,
    "END:VCALENDAR",
    "",
  ].map(fold).join("\r\n");
}

function parseEvent(lines: string[], calendarId: string): CalendarEventInput | null {
  const fields = lines.map(property);
  const title = textValue(fields, "SUMMARY")?.trim();
  const startField = fields.find((field) => field.name === "DTSTART");
  const endField = fields.find((field) => field.name === "DTEND");
  if (!title || !startField) return null;
  const allDay = startField.params.VALUE?.toUpperCase() === "DATE" || /^\d{8}$/.test(startField.value);
  const start = calendarDate(startField.value, startField.params.TZID, allDay);
  if (!start) return null;
  const parsedEnd = endField
    ? calendarDate(endField.value, endField.params.TZID, allDay)
    : null;
  const end = parsedEnd ?? new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000));
  const recurrence = recurrenceValue(fields.find((field) => field.name === "RRULE")?.value);
  const trigger = fields.find((field) => field.name === "TRIGGER")?.value;
  const alarmMinutes = trigger ? triggerMinutes(trigger) : undefined;
  const url = textValue(fields, "URL");
  return {
    calendarId,
    title: unescapeText(title),
    start: start.toISOString(),
    end: end.toISOString(),
    allDay,
    ...(textValue(fields, "LOCATION") ? {location: unescapeText(textValue(fields, "LOCATION")!)} : {}),
    ...(textValue(fields, "DESCRIPTION") ? {notes: unescapeText(textValue(fields, "DESCRIPTION")!)} : {}),
    ...(url ? {url} : {}),
    ...(recurrence ? {recurrence} : {}),
    ...(alarmMinutes !== undefined ? {alarmMinutes} : {}),
  };
}

type Property = {name: string; params: Record<string, string>; value: string};

function property(line: string): Property {
  const colon = unescapedColon(line);
  const head = colon < 0 ? line : line.slice(0, colon);
  const value = colon < 0 ? "" : line.slice(colon + 1);
  const [rawName, ...rawParams] = head.split(";");
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const split = raw.indexOf("=");
    if (split > 0) params[raw.slice(0, split).toUpperCase()] = raw.slice(split + 1).replace(/^"|"$/g, "");
  }
  return {name: rawName.toUpperCase(), params, value};
}

function textValue(fields: Property[], name: string): string | undefined {
  return fields.find((field) => field.name === name)?.value;
}

function unfold(source: string): string[] {
  return source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").reduce<string[]>((lines, line) => {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
    return lines;
  }, []);
}

function unescapedColon(line: string): number {
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === ":" && !escaped) return index;
    escaped = line[index] === "\\" && !escaped;
    if (line[index] !== "\\") escaped = false;
  }
  return -1;
}

function calendarDate(value: string, timeZone: string | undefined, allDay: boolean): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00", zulu] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (allDay) return new Date(parts[0], parts[1] - 1, parts[2]);
  if (zulu) return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  if (timeZone) return zonedDate(parts, timeZone);
  return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
}

/** Converts wall-clock components in an IANA timezone to an instant. Two
 * passes settle daylight-saving offsets around the requested date. */
function zonedDate(parts: number[], timeZone: string): Date {
  const target = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  let guess = target;
  for (let pass = 0; pass < 2; pass += 1) {
    const formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
    const represented = Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour) % 24, Number(values.minute), Number(values.second),
    );
    guess += target - represented;
  }
  return new Date(guess);
}

function recurrenceValue(value?: string): CalendarRecurrenceDto | undefined {
  if (!value) return undefined;
  const entries = Object.fromEntries(value.split(";").map((part) => {
    const [key, raw = ""] = part.split("=", 2);
    return [key.toUpperCase(), raw];
  }));
  const frequency = entries.FREQ?.toLowerCase();
  if (frequency !== "daily" && frequency !== "weekly" && frequency !== "monthly" && frequency !== "yearly") return undefined;
  const interval = Math.max(1, Number.parseInt(entries.INTERVAL ?? "1", 10) || 1);
  const count = Number.parseInt(entries.COUNT ?? "", 10);
  const until = entries.UNTIL ? calendarDate(entries.UNTIL, undefined, false)?.toISOString() : undefined;
  return {
    frequency,
    interval,
    ...(count > 0 ? {count} : {}),
    ...(until ? {until} : {}),
  };
}

function triggerMinutes(value: string): number | undefined {
  const match = /^-?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i.exec(value);
  if (!match) return undefined;
  return Number(match[1] ?? 0) * 1_440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function recurrenceLine(rule: CalendarRecurrenceDto): string {
  const parts = [`FREQ=${rule.frequency.toUpperCase()}`, `INTERVAL=${Math.max(1, rule.interval)}`];
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  else if (rule.until) parts.push(`UNTIL=${utcStamp(new Date(rule.until))}`);
  return parts.join(";");
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function localDateStamp(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function fold(line: string): string {
  if (line.length <= 73) return line;
  const chunks: string[] = [];
  for (let at = 0; at < line.length; at += 73) chunks.push((at ? " " : "") + line.slice(at, at + 73));
  return chunks.join("\r\n");
}
