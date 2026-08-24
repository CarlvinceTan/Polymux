import {cronError} from "@polymux/protocol";
import type {BrowserImportRequestDto, BrowserPermissionDto, MailListRequest, PermissionDecisionDto, SaveCustomMcpRequest, SaveCustomSkillRequest, ScheduleInput, SchedulePatch, ScheduleWeekday, SendMailRequest, SkillUploadFile, SystemPermissionKind, WorkspaceSnapshotDto} from "@polymux/protocol";
import {app} from "electron";
import {randomUUID} from "node:crypto";
import {parse as parseToml} from "smol-toml";

/**
 * Coercion for everything the renderer sends over IPC. Each function takes an
 * `unknown` payload and either returns the shape the backend works in or
 * throws — the preload bridge is not a trust boundary, so nothing downstream
 * sees a value that was not checked here.
 */
export function json(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

export function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
/**
 * Answers to a bridge login step. Field ids come from the bridge, so the map is
 * accepted as-is apart from requiring every value to be a string.
 */

export function mailListRequest(value: unknown): MailListRequest {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    account: typeof input.account === "string" ? input.account : undefined,
    folder: typeof input.folder === "string" ? input.folder : undefined,
    page: typeof input.page === "number" ? input.page : undefined,
    pageSize: typeof input.pageSize === "number" ? input.pageSize : undefined,
    sort: MAIL_SORTS.includes(input.sort as string)
      ? (input.sort as MailListRequest["sort"])
      : undefined,
    query: typeof input.query === "string" && input.query.trim() ? input.query : undefined,
  };
}

export const MAIL_SORTS = ["date-desc", "date-asc", "subject", "from"];

export const SCHEDULE_KINDS = ["once", "hourly", "daily", "weekly", "monthly", "yearly", "cron"];

/**
 * A cadence from the renderer. Only the fields the kind actually uses are
 * read: the scheduler stores what it is given, so an unchecked field would
 * outlive the window it came from.
 */

export function scheduleFrequency(value: unknown): ScheduleInput["frequency"] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Frequency must be an object");
  const input = value as Record<string, unknown>;
  const kind = input.kind;
  if (typeof kind !== "string" || !SCHEDULE_KINDS.includes(kind))
    throw new Error(`Unsupported schedule frequency: ${String(kind)}`);
  const timeZone = typeof input.timeZone === "string" ? input.timeZone : undefined;
  const interval = typeof input.interval === "number" && Number.isFinite(input.interval)
    ? Math.min(99, Math.max(1, Math.round(input.interval)))
    : undefined;
  const time = /^\d{1,2}:\d{2}$/.test(String(input.time)) ? String(input.time) : "09:00";
  const dayOfMonth = Math.min(31, Math.max(1, Math.round(Number(input.dayOfMonth) || 1)));
  switch (kind) {
    case "cron": {
      const expression = typeof input.expression === "string" ? input.expression.trim() : "";
      // Rejected here rather than stored and discovered at fire time: a
      // schedule that can never run is not a schedule.
      const problem = cronError(expression);
      if (problem) throw new Error(problem);
      return {kind: "cron", expression, timeZone};
    }
    case "once": {
      const at = Number(input.at);
      if (!Number.isFinite(at)) throw new Error("A one-off schedule needs a time");
      return {kind: "once", at, timeZone};
    }
    case "hourly":
      return {
        kind: "hourly",
        interval,
        minute: Math.min(59, Math.max(0, Math.round(Number(input.minute) || 0))),
        timeZone,
      };
    case "daily":
      return {kind: "daily", interval, time, timeZone};
    case "weekly": {
      const days = Array.isArray(input.days)
        ? [...new Set(input.days.map(Number).filter((day) => day >= 0 && day <= 6))]
        : [];
      if (!days.length) throw new Error("A weekly schedule needs at least one day");
      return {kind: "weekly", interval, days: days as ScheduleWeekday[], time, timeZone};
    }
    case "monthly":
      return {kind: "monthly", interval, dayOfMonth, time, timeZone};
    default:
      return {
        kind: "yearly",
        interval,
        month: Math.min(11, Math.max(0, Math.round(Number(input.month) || 0))),
        dayOfMonth,
        time,
        timeZone,
      };
  }
}

export function scheduleInput(value: unknown): ScheduleInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Schedule must be an object");
  const input = value as Record<string, unknown>;
  return {
    title: required(input.title, "title"),
    prompt: required(input.prompt, "prompt"),
    frequency: scheduleFrequency(input.frequency),
  };
}

export function schedulePatch(value: unknown): SchedulePatch {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Schedule patch must be an object");
  const input = value as Record<string, unknown>;
  const status = input.status === "active" || input.status === "paused" ? input.status : undefined;
  return {
    ...(typeof input.title === "string" ? {title: input.title} : {}),
    ...(typeof input.prompt === "string" ? {prompt: input.prompt} : {}),
    ...(input.frequency !== undefined ? {frequency: scheduleFrequency(input.frequency)} : {}),
    ...(status ? {status} : {}),
  };
}

export function taskCardInput(value: unknown): import("@polymux/protocol").TaskCardInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Tasks card must be an object");
  const input = value as Record<string, unknown>;
  return {
    chatId: required(input.chatId, "chat id"),
    title: required(input.title, "title"),
    ...(typeof input.detail === "string" ? {detail: input.detail} : {}),
  };
}

export function taskCardPatch(value: unknown): import("@polymux/protocol").TaskCardPatch {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Tasks card patch must be an object");
  const input = value as Record<string, unknown>;
  const status = input.status === "todo" || input.status === "in_progress" || input.status === "done" ? input.status : undefined;
  return {
    ...(typeof input.title === "string" ? {title: input.title} : {}),
    ...(typeof input.detail === "string" ? {detail: input.detail} : {}),
    ...(status ? {status} : {}),
    ...(typeof input.owner === "string" ? {owner: input.owner} : {}),
    ...(typeof input.reviewed === "boolean" ? {reviewed: input.reviewed} : {}),
    ...(typeof input.order === "number" ? {order: input.order} : {}),
  };
}

export function sendMailRequest(value: unknown): SendMailRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Mail request must be an object");
  const input = value as Record<string, unknown>;
  const to = optionalStringArray(input.to, "to");
  if (to.length === 0) throw new Error("At least one recipient is required");
  return {
    account: typeof input.account === "string" ? input.account : undefined,
    to,
    cc: optionalStringArray(input.cc, "cc"),
    bcc: optionalStringArray(input.bcc, "bcc"),
    subject: typeof input.subject === "string" ? input.subject : "",
    body: typeof input.body === "string" ? input.body : "",
    draft: input.draft === true,
    attachments: optionalStringArray(input.attachments, "attachments"),
    importance: mailImportance(input.importance),
    inReplyTo: typeof input.inReplyTo === "string" ? input.inReplyTo : undefined,
    references: optionalStringArray(input.references, "references"),
    replacesDraft: draftReference(input.replacesDraft),
  };
}

/** Anything but the two flags is "normal", which writes no header at all. */
export function mailImportance(value: unknown): SendMailRequest["importance"] {
  return value === "high" || value === "low" ? value : "normal";
}

/** The draft an edited message replaces, when it came from one. */

export function draftReference(value: unknown): SendMailRequest["replacesDraft"] {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  return typeof input.id === "string" && typeof input.folder === "string"
    ? {id: input.id, folder: input.folder}
    : null;
}

/** Identifies this run of the app, for the snapshot drawer-openness rule. */

export const WORKSPACE_BOOT_ID = randomUUID();

/**
 * A workspace snapshot from the renderer: tab records with whatever fields
 * they carried, plus the active tab and drawer state. Tab kinds are validated
 * by the renderer on restore, so storage only guards the shape.
 */

export function workspaceSnapshot(value: unknown): WorkspaceSnapshotDto {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Workspace snapshot must be an object");
  const input = value as Record<string, unknown>;
  const tabs = Array.isArray(input.tabs) ? input.tabs : [];
  return {
    tabs: tabs
      .filter((tab): tab is Record<string, unknown> => !!tab && typeof tab === "object")
      .map((tab) => ({
        id: String(tab.id ?? ""),
        title: String(tab.title ?? ""),
        kind: String(tab.kind ?? ""),
        ...(typeof tab.url === "string" ? {url: tab.url} : {}),
        ...(typeof tab.favicon === "string" ? {favicon: tab.favicon} : {}),
        ...(typeof tab.section === "string" ? {section: tab.section} : {}),
      }))
      .filter((tab) => tab.id && tab.kind),
    activeTabId: typeof input.activeTabId === "string" ? input.activeTabId : null,
    open: input.open === true,
  };
}

export function loginValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Login values must be an object");
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, item] of entries)
    if (typeof item !== "string") throw new Error(`${key} must be a string`);
  return Object.fromEntries(entries) as Record<string, string>;
}

export function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => required(item, `${label}[${index}]`));
}

/**
 * Every kind the protocol declares, as a map rather than a list of literals so
 * that a kind added to SystemPermissionKind fails to compile here instead of
 * being rejected at the IPC boundary — which is how Accessibility ended up
 * unaskable from onboarding while both sides of it worked.
 */

export const SYSTEM_PERMISSIONS: Record<SystemPermissionKind, true> = {
  microphone: true,
  "screen-recording": true,
  accessibility: true,
  "full-disk-access": true,
  reminders: true,
  calendars: true,
  contacts: true,
  photos: true,
  automation: true,
};

export function systemPermission(value: unknown): SystemPermissionKind;
export function systemPermission(
  value: unknown,
  includeLocation: true,
): SystemPermissionKind | "location";
export function systemPermission(
  value: unknown,
  includeLocation = false,
): SystemPermissionKind | "location" {
  if (typeof value === "string" && Object.hasOwn(SYSTEM_PERMISSIONS, value))
    return value as SystemPermissionKind;
  if (includeLocation && value === "location") return "location";
  throw new Error(`Unknown system permission: ${String(value)}`);
}

export function number(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error("sequence must be a non-negative integer");
  return Number(value);
}

export function computerHistoryQuery(value: unknown): {
  since?: Date;
  until?: Date;
  limit?: number;
} {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("ComputerHistory query must be an object");
  const record = value as Record<string, unknown>;
  const result: { since?: Date; until?: Date; limit?: number } = {};
  for (const key of ["since", "until"] as const) {
    const raw = record[key];
    if (raw === undefined) continue;
    if (typeof raw !== "string" || !Number.isFinite(Date.parse(raw)))
      throw new Error(`${key} must be an ISO timestamp`);
    result[key] = new Date(raw);
  }
  if (record.limit !== undefined) {
    if (!Number.isSafeInteger(record.limit) || Number(record.limit) < 1)
      throw new Error("limit must be a positive integer");
    result.limit = Math.min(Number(record.limit), 1_000);
  }
  return result;
}

export function computerHistoryPatch(value: unknown): {
  excludeApps?: string[];
  excludeSites?: string[];
  recordPrivateBrowsing?: boolean;
  interactionEvents?: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("ComputerHistory settings must be an object");
  const record = value as Record<string, unknown>;
  const patch: {
    excludeApps?: string[];
    excludeSites?: string[];
    recordPrivateBrowsing?: boolean;
    interactionEvents?: boolean;
  } = {};
  for (const key of ["excludeApps", "excludeSites"] as const) {
    const raw = record[key];
    if (raw === undefined) continue;
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string"))
      throw new Error(`${key} must be an array of strings`);
    patch[key] = (raw as string[]).map((item) => item.trim()).filter(Boolean);
  }
  for (const key of ["recordPrivateBrowsing", "interactionEvents"] as const) {
    const raw = record[key];
    if (raw === undefined) continue;
    if (typeof raw !== "boolean") throw new Error(`${key} must be a boolean`);
    patch[key] = raw;
  }
  return patch;
}

/** A closed time range the user asked ComputerHistory to forget. */
export function computerHistoryRange(since: unknown, until: unknown): {since: Date; until: Date} {
  const parse = (value: unknown, name: string) => {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
      throw new Error(`${name} must be an ISO timestamp`);
    return new Date(value);
  };
  const from = parse(since, "since");
  const to = parse(until, "until");
  if (from > to) throw new Error("since must not be after until");
  return {since: from, until: to};
}

export function audioBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value))
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("Dictation audio must be binary");
}

export function integrationId(value: unknown, label: string): string {
  const id = required(value, label);
  if (!/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/i.test(id))
    throw new Error(`${label} may contain letters, numbers, dashes, underscores, and dots`);
  return id;
}

export function customMcpRequest(value: unknown): SaveCustomMcpRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("MCP server must be an object");
  const record = value as Record<string, unknown>;
  const id = integrationId(record.id, "MCP id");
  const name = required(record.name, "MCP name");
  const description = optionalText(record.description);
  const transport = record.transport === "streamable-http" ? "streamable-http" : "stdio";
  const args = optionalStrings(record.args, "MCP arguments");
  const env = optionalStringRecord(record.env, "MCP environment");
  const headers = optionalStringRecord(record.headers, "MCP headers");
  if (transport === "stdio")
    return {id, name, description, transport, command: required(record.command, "MCP command"), args, env, cwd: optionalText(record.cwd)};
  const url = required(record.url, "MCP URL");
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("MCP URL must use HTTP or HTTPS");
  return {id, name, description, transport, url: parsed.toString(), headers};
}

export function customSkillRequest(value: unknown): SaveCustomSkillRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Skill must be an object");
  const record = value as Record<string, unknown>;
  const name = integrationId(record.name, "skill name");
  const originalName = record.originalName === undefined
    ? undefined
    : integrationId(record.originalName, "original skill name");
  const description = required(record.description, "skill description");
  if (/\r|\n/.test(description)) throw new Error("skill description must be one line");
  const instructions = required(record.instructions, "skill instructions");
  return {originalName, name, description, instructions};
}

export function skillUploadFiles(value: unknown): SkillUploadFile[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Choose a skill folder to upload");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid skill folder");
    const record = item as Record<string, unknown>;
    return {path: required(record.path, "skill file path"), relativePath: required(record.relativePath, "skill relative path")};
  });
}

export function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function optionalStrings(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error(`${label} must be a list of strings`);
  return value.map((item) => item.trim()).filter(Boolean);
}

export function optionalStringRecord(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.values(value).every((item) => typeof item === "string"))
    throw new Error(`${label} must contain text values`);
  return value as Record<string, string>;
}

/**
 * Carries an existing MCP configuration over from the application-support
 * directory it used to live in. Copied rather than moved, and only when
 * ~/.polymux has none: an older build left running against the same machine
 * still finds its file, and a user who has already configured servers in the
 * new location never has them overwritten by a stale one.
 */

export function validProviderLogo(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 1_500_000 || !/^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(value))
    throw new Error("provider image must be a PNG, JPEG, WebP, GIF, or SVG under 1 MB");
  return value;
}

/** Zero is a real price — free models publish it — so only a missing or
 * malformed rate becomes null (rendered as "unavailable"). */

export function knownRate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** For rates where zero means "not offered" rather than "free". */

export function positiveRate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * A file's media type from its name. Enough to decide whether a network shows
 * an attachment inline as a picture, a voice note, or a plain download.
 */

const BROWSER_PERMISSIONS = [
  "geolocation",
  "media",
  "notifications",
  "clipboard-read",
  "pointerLock",
  "fullscreen",
  "openExternal",
];

/** A capability name the embedded browser negotiates. Anything else is a
 * request for something no prompt was designed for, so it is refused rather
 * than passed through to Chromium. */
export function browserPermission(value: unknown): BrowserPermissionDto {
  if (typeof value !== "string" || !BROWSER_PERMISSIONS.includes(value))
    throw new Error(`Unknown browser permission: ${String(value)}`);
  return value as BrowserPermissionDto;
}

export function permissionDecision(value: unknown): PermissionDecisionDto {
  if (value !== "allow" && value !== "deny" && value !== "ask")
    throw new Error(`Unknown permission decision: ${String(value)}`);
  return value;
}

/** An origin as `scheme://host[:port]`. Round-tripped through `URL` so a path,
 * query or fragment the renderer sent is dropped rather than stored as part of
 * the site's identity. */
export function origin(value: unknown): string {
  const parsed = new URL(required(value, "origin"));
  if (parsed.origin === "null") throw new Error("origin must be a real site");
  return parsed.origin;
}

export function browserSettingsPatch(value: unknown): {
  downloadDirectory?: string | null;
  askWhereToSave?: boolean;
  autofillEnabled?: boolean;
} {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    // null is meaningful here — it asks the main process to open the picker —
    // so it is kept, and only absence means "unchanged".
    downloadDirectory:
      input.downloadDirectory === null
        ? null
        : typeof input.downloadDirectory === "string"
          ? input.downloadDirectory
          : undefined,
    askWhereToSave:
      typeof input.askWhereToSave === "boolean" ? input.askWhereToSave : undefined,
    autofillEnabled:
      typeof input.autofillEnabled === "boolean" ? input.autofillEnabled : undefined,
  };
}

export function clearDataOptions(value: unknown): {
  cookies: boolean;
  cache: boolean;
  downloads: boolean;
  permissions: boolean;
  logins: boolean;
} {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  // Everything defaults off: a malformed payload must not clear more than it
  // was asked to.
  return {
    cookies: input.cookies === true,
    cache: input.cache === true,
    downloads: input.downloads === true,
    permissions: input.permissions === true,
    logins: input.logins === true,
  };
}

export function browserImportRequest(value: unknown): BrowserImportRequestDto {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    sourceId: required(input.sourceId, "source id"),
    profileId: required(input.profileId, "profile id"),
    cookies: input.cookies === true,
    passwords: input.passwords === true,
    history: input.history === true,
  };
}

/** The options a history read takes. A limit is clamped rather than trusted:
 * the renderer asking for a million rows is a renderer that hangs. */
export function browserHistoryQuery(value: unknown): {query?: string; limit?: number} {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const query = typeof input.query === "string" ? input.query.slice(0, 200) : undefined;
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(1000, Math.max(1, Math.trunc(input.limit)))
      : undefined;
  return {query, limit};
}
