import type {
  CalendarAvailability,
  CalendarEventDto,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarImportResultDto,
  CalendarListDto,
  CalendarRecurrenceDto,
} from "@polymux/protocol";
import { permissionUsagePlist } from "../system/permission-usage.js";
import { SwiftHelper } from "../system/swift-helper.js";
import { parseIcsEvents } from "./ics.js";

const NOT_AUTHORIZED = "not-authorized";

export interface CalendarAccess {
  /** Null when the system calendar may be used, otherwise a user-facing reason. */
  ensure(): Promise<string | null>;
}

export interface NativeCalendarOptions {
  sourcePath: string;
  cacheDirectory: string;
  access: CalendarAccess;
}

/** The Mac's EventKit store. Apple Calendar and Polymux are two views over the
 * same events, so system-connected providers keep syncing without a second
 * credential store or a provider-specific copy of the data. */
export class NativeCalendar {
  readonly #helper: SwiftHelper;
  readonly #access: CalendarAccess;

  constructor(options: NativeCalendarOptions) {
    this.#access = options.access;
    this.#helper = new SwiftHelper({
      name: "calendar",
      sourcePath: options.sourcePath,
      cacheDirectory: options.cacheDirectory,
      infoPlist: permissionUsagePlist(),
      missingCompilerMessage:
        "Calendar needs the Swift compiler. Install the Xcode Command Line Tools: xcode-select --install",
      missingSourceMessage: (path) => `Calendar helper source is missing at ${path}`,
    });
  }

  calendars(): Promise<CalendarListDto[]> {
    return this.#run<CalendarListDto[]>("calendars", {});
  }

  async events(start: string, end: string, calendarIds?: string[]): Promise<CalendarEventDto[]> {
    const from = instant(start, "calendar range start");
    const until = instant(end, "calendar range end");
    if (Date.parse(from) >= Date.parse(until)) throw new Error("Calendar range end must follow its start");
    return await this.#run<CalendarEventDto[]>("list", {
      start: from,
      end: until,
      ...(calendarIds ? {calendars: calendarIds.map((id) => required(id, "calendar id"))} : {}),
    });
  }

  async create(value: unknown): Promise<CalendarEventDto> {
    return await this.#run<CalendarEventDto>("create", eventInput(value));
  }

  async update(id: string, value: unknown): Promise<CalendarEventDto> {
    return await this.#run<CalendarEventDto>("update", {
      id: required(id, "event id"),
      ...eventPatch(value),
    });
  }

  async remove(id: string): Promise<void> {
    await this.#run("delete", {id: required(id, "event id")});
  }

  async importIcs(source: string, calendarId: string, fileName: string | null): Promise<CalendarImportResultDto> {
    const parsed = parseIcsEvents(source, required(calendarId, "calendar id"));
    let imported = 0;
    let skipped = parsed.skipped;
    for (const event of parsed.events) {
      try {
        await this.create(event);
        imported += 1;
      } catch {
        skipped += 1;
      }
    }
    return {imported, skipped, fileName};
  }

  async #run<T>(action: string, payload: object): Promise<T> {
    const refused = await this.#access.ensure();
    if (refused) throw new Error(refused);
    const first = await this.#invoke<T>(action, payload);
    if (!first.error) return first.result as T;
    if (first.error !== NOT_AUTHORIZED) throw new Error(first.error);
    const refusedAgain = await this.#access.ensure();
    if (refusedAgain) throw new Error(refusedAgain);
    const second = await this.#invoke<T>(action, payload);
    if (!second.error) return second.result as T;
    throw new Error(
      second.error === NOT_AUTHORIZED
        ? "Polymux has not been given access to Calendars. Allow it in System Settings → Privacy & Security → Calendars."
        : second.error,
    );
  }

  async #invoke<T>(
    action: string,
    payload: object,
  ): Promise<{result?: T; error?: string}> {
    const line = await this.#helper.run([action, JSON.stringify(payload)], 30_000);
    const parsed = JSON.parse(line) as {ok?: boolean; result?: T; error?: string};
    return parsed.ok ? {result: parsed.result} : {error: parsed.error ?? "Calendar reported no reason"};
  }
}

function eventInput(value: unknown): CalendarEventInput {
  const record = object(value, "calendar event");
  const input: CalendarEventInput = {
    calendarId: required(record.calendarId, "calendar id"),
    title: required(record.title, "event title"),
    start: instant(record.start, "event start"),
    end: instant(record.end, "event end"),
    allDay: boolean(record.allDay, "allDay"),
  };
  if (Date.parse(input.start) >= Date.parse(input.end)) throw new Error("An event must end after it starts");
  optionalString(record, "location", input);
  optionalString(record, "notes", input);
  optionalString(record, "url", input);
  if (record.recurrence !== undefined) input.recurrence = recurrence(record.recurrence);
  if (record.alarmMinutes !== undefined) input.alarmMinutes = nullableMinutes(record.alarmMinutes);
  if (record.availability !== undefined) input.availability = availability(record.availability);
  return input;
}

function eventPatch(value: unknown): CalendarEventPatch {
  const record = object(value, "calendar event patch");
  const patch: CalendarEventPatch = {};
  if (record.calendarId !== undefined) patch.calendarId = required(record.calendarId, "calendar id");
  if (record.title !== undefined) patch.title = required(record.title, "event title");
  if (record.start !== undefined) patch.start = instant(record.start, "event start");
  if (record.end !== undefined) patch.end = instant(record.end, "event end");
  if (record.allDay !== undefined) patch.allDay = boolean(record.allDay, "allDay");
  optionalPatchString(record, "location", patch);
  optionalPatchString(record, "notes", patch);
  optionalPatchString(record, "url", patch);
  if (record.recurrence !== undefined) patch.recurrence = recurrence(record.recurrence);
  if (record.alarmMinutes !== undefined) patch.alarmMinutes = nullableMinutes(record.alarmMinutes);
  if (record.availability !== undefined) patch.availability = availability(record.availability);
  return patch;
}

function recurrence(value: unknown): CalendarRecurrenceDto | null {
  if (value === null) return null;
  const record = object(value, "event recurrence");
  if (record.frequency !== "daily" && record.frequency !== "weekly" && record.frequency !== "monthly" && record.frequency !== "yearly")
    throw new Error("Unknown recurrence frequency");
  const interval = Number(record.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) throw new Error("Recurrence interval is invalid");
  const result: CalendarRecurrenceDto = {frequency: record.frequency, interval};
  if (record.count !== undefined) {
    const count = Number(record.count);
    if (!Number.isInteger(count) || count < 1 || count > 9999) throw new Error("Recurrence count is invalid");
    result.count = count;
  }
  if (record.until !== undefined) result.until = instant(record.until, "recurrence end");
  return result;
}

function availability(value: unknown): CalendarAvailability {
  if (value === "busy" || value === "free" || value === "tentative" || value === "unavailable") return value;
  throw new Error("Unknown event availability");
}

function nullableMinutes(value: unknown): number | null {
  if (value === null) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 525_600) throw new Error("Event alert is invalid");
  return number;
}

function optionalString(record: Record<string, unknown>, key: string, target: object): void {
  if (!(key in record)) return;
  if (record[key] !== null && typeof record[key] !== "string") throw new Error(`${key} must be text`);
  (target as Record<string, unknown>)[key] = typeof record[key] === "string" ? record[key] : undefined;
}

function optionalPatchString(record: Record<string, unknown>, key: string, target: object): void {
  if (!(key in record)) return;
  if (record[key] !== null && typeof record[key] !== "string") throw new Error(`${key} must be text or null`);
  (target as Record<string, unknown>)[key] = record[key];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function instant(value: unknown, label: string): string {
  const text = required(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} is invalid`);
  return new Date(text).toISOString();
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false`);
  return value;
}
