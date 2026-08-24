/**
 * The sentence macOS shows in each privacy prompt, keyed by its Info.plist
 * key. One record rather than two: it is read into the app's own Info.plist by
 * `forge.config.ts`, and linked into the native permission helper as its
 * `__info_plist` section by `app-permissions.ts`. macOS terminates a process
 * that touches a privacy class without a description for it, so a class added
 * on one side and forgotten on the other is a crash rather than a bad string.
 *
 * Electron-free, so both the Forge config and the main process can read it.
 */
export const PERMISSION_USAGE_DESCRIPTIONS: Record<string, string> = {
  NSRemindersFullAccessUsageDescription:
    "Polymux reads and changes your reminders only when a skill you enabled asks it to.",
  NSCalendarsFullAccessUsageDescription:
    "Polymux reads and changes your calendar only when a skill you enabled asks it to.",
  NSContactsUsageDescription:
    "Polymux reads your contacts only when a skill you enabled asks it to.",
  NSPhotoLibraryUsageDescription:
    "Polymux reads your photo library only when a skill you enabled asks it to.",
  NSAppleEventsUsageDescription:
    "Polymux controls other applications only when a skill you enabled asks it to.",
};

/** The same record as an Info.plist document, for the helper's linked section. */
export function permissionUsagePlist(
  extra: Record<string, string> = {},
): string {
  const entries = Object.entries({...PERMISSION_USAGE_DESCRIPTIONS, ...extra})
    .map(([key, value]) => `\t<key>${key}</key>\n\t<string>${value}</string>`)
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    entries,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}
