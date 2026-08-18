import type {GeneralSettingsDto, NotificationKind} from "@flareai/protocol";
import {NOTIFICATION_KINDS} from "@flareai/protocol";

export type NotificationSwitches = GeneralSettingsDto["notifications"];

/**
 * Which events post a system notification. The master switch in front of them
 * is what silences the lot: these say what the user wants *when* notifications
 * are on, so they are never rewritten by the master going off and back on.
 *
 * Electron-free on purpose, like the permission switches beside it, so the
 * coercion is testable under plain Node.
 */
export const DEFAULT_NOTIFICATION_SWITCHES: NotificationSwitches = {
  "schedule-completed": true,
  "schedule-failed": true,
  "agent-completed": true,
  "agent-attention": true,
  // Off by default: a chat notification for every message that lands is the
  // noisiest of these kinds by far, so it is the one the user opts into.
  "message-received": false,
};

/** Unknown keys are dropped and missing ones keep their default, so a kind
 * added after these settings were written starts at that default rather than
 * absent. */
export function notificationSwitches(
  value: unknown,
  defaults: NotificationSwitches = DEFAULT_NOTIFICATION_SWITCHES,
): NotificationSwitches {
  const result = {...defaults};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const record = value as Record<string, unknown>;
  for (const kind of NOTIFICATION_KINDS)
    if (typeof record[kind] === "boolean") result[kind] = record[kind];
  return result;
}

/** An update carries only the switches the user moved, so it patches the map
 * rather than replacing it — and names a bad key rather than ignoring it. */
export function notificationSwitchesUpdate(
  value: unknown,
  current: NotificationSwitches,
): NotificationSwitches {
  if (value === undefined) return {...current};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("notifications must map known notification kinds to booleans");
  for (const [kind, allowed] of Object.entries(value as Record<string, unknown>))
    if (!Object.hasOwn(current, kind) || typeof allowed !== "boolean")
      throw new Error("notifications must map known notification kinds to booleans");
  return {...current, ...(value as Partial<Record<NotificationKind, boolean>>)};
}
