import { closeSync, openSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { desktopCapturer, shell, systemPreferences } from "electron";
import type {
  SystemPermissionKind,
  SystemPermissionStatus,
} from "@flareai/protocol";

/** Where each grant lives in System Settings. */
const SETTINGS_PANE: Record<SystemPermissionKind | "location", string> = {
  microphone: "Privacy_Microphone",
  "screen-recording": "Privacy_ScreenCapture",
  accessibility: "Privacy_Accessibility",
  "full-disk-access": "Privacy_AllFiles",
  location: "Privacy_LocationServices",
};

/**
 * macOS exposes no API for Full Disk Access: nothing to query, nothing to
 * prompt with. The only honest answer comes from reading something the grant
 * covers and nothing else does, so the user's own TCC database stands in for
 * the whole permission. `home` is a seam for tests, which cannot revoke a
 * grant on the machine they are running on.
 *
 * The answer is empirical rather than declarative, which is what makes it
 * worth trusting: a grant that has been given but needs a relaunch to take
 * effect reads as denied here, because this process genuinely cannot read yet.
 */
export function fullDiskAccessStatus(home = homedir()): SystemPermissionStatus {
  const probe = path.join(
    home,
    "Library",
    "Application Support",
    "com.apple.TCC",
    "TCC.db",
  );
  try {
    closeSync(openSync(probe, "r"));
    return "granted";
  } catch {
    return "denied";
  }
}

export function systemPermissionStatus(
  permission: SystemPermissionKind,
): SystemPermissionStatus {
  if (process.platform !== "darwin") return "granted";
  if (permission === "accessibility")
    return systemPreferences.isTrustedAccessibilityClient(false)
      ? "granted"
      : "denied";
  if (permission === "full-disk-access") return fullDiskAccessStatus();
  return systemPreferences.getMediaAccessStatus(
    permission === "microphone" ? "microphone" : "screen",
  );
}

export async function requestSystemPermission(
  permission: SystemPermissionKind,
): Promise<SystemPermissionStatus> {
  if (process.platform !== "darwin") return "granted";

  if (permission === "microphone") {
    await systemPreferences.askForMediaAccess("microphone");
  } else if (permission === "accessibility") {
    // Prompting registers FlareAI in Privacy & Security → Accessibility and
    // shows the system dialog pointing there; there is no async grant flow.
    systemPreferences.isTrustedAccessibilityClient(true);
  } else if (permission === "full-disk-access") {
    // There is no dialog to raise. Full Disk Access is switched on by hand and
    // nowhere else, so asking for it means opening the pane it lives in.
    await openSystemPermissionSettings(permission);
  } else if (systemPermissionStatus(permission) !== "granted") {
    // macOS registers Screen Recording access when an application first tries
    // to enumerate a display. The tiny thumbnail avoids doing real Chronicle
    // work while still ensuring FlareAI appears in Privacy & Security.
    try {
      await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false,
      });
    } catch {
      // A denied Screen Recording request can reject source enumeration. The
      // status below is still authoritative and lets the UI offer Settings.
    }
  }

  return systemPermissionStatus(permission);
}

export async function openSystemPermissionSettings(
  permission: SystemPermissionKind | "location",
): Promise<void> {
  if (process.platform !== "darwin") return;
  await shell.openExternal(
    `x-apple.systempreferences:com.apple.preference.security?${SETTINGS_PANE[permission]}`,
  );
}
