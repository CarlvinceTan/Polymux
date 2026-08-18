import type {GeneralSettingsDto, SystemPermissionKind} from "@flareai/protocol";

export type PermissionSwitches = GeneralSettingsDto["permissions"];

/**
 * Whether the app may use each OS grant, separately from whether macOS has
 * given it. Every capability starts on: the grant is the real gate, and this
 * map exists so one can be switched off without handing the grant back.
 *
 * Electron-free on purpose, unlike the rest of the settings folder, so the
 * coercion these switches ride on is testable under plain Node.
 */
export const DEFAULT_PERMISSION_SWITCHES: PermissionSwitches = {
  microphone: true,
  "screen-recording": true,
  accessibility: true,
  "full-disk-access": true,
  // The app grants a skill can declare. On by default like the rest: a skill
  // that asked for one has to be installed before this switch means anything,
  // and macOS is still the gate.
  reminders: true,
  calendars: true,
  contacts: true,
  photos: true,
  automation: true,
};

/** Unknown keys are dropped and missing ones keep their default, so a
 * permission added after these settings were written starts switched on
 * rather than absent. */
export function permissionSwitches(
  value: unknown,
  defaults: PermissionSwitches = DEFAULT_PERMISSION_SWITCHES,
): PermissionSwitches {
  const result = {...defaults};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const record = value as Record<string, unknown>;
  for (const kind of Object.keys(defaults) as SystemPermissionKind[])
    if (typeof record[kind] === "boolean") result[kind] = record[kind];
  return result;
}

/** An update carries only the switches the user moved, so it patches the map
 * rather than replacing it — and names a bad key rather than ignoring it. */
export function permissionSwitchesUpdate(
  value: unknown,
  current: PermissionSwitches,
): PermissionSwitches {
  if (value === undefined) return {...current};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("permissions must map known permission kinds to booleans");
  for (const [kind, allowed] of Object.entries(value as Record<string, unknown>))
    if (!Object.hasOwn(current, kind) || typeof allowed !== "boolean")
      throw new Error("permissions must map known permission kinds to booleans");
  return {...current, ...(value as Partial<PermissionSwitches>)};
}
