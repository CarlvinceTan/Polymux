import { closeSync, openSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { desktopCapturer, shell, systemPreferences } from "electron";
import type {
  AppPermissionKind,
  SystemPermissionKind,
  SystemPermissionStatus,
} from "@flareai/protocol";
import { isAppPermissionKind } from "@flareai/protocol";
import type { AppPermissions } from "./app-permissions.js";

/** Where each grant lives in System Settings. */
const SETTINGS_PANE: Record<SystemPermissionKind | "location", string> = {
  microphone: "Privacy_Microphone",
  "screen-recording": "Privacy_ScreenCapture",
  accessibility: "Privacy_Accessibility",
  "full-disk-access": "Privacy_AllFiles",
  location: "Privacy_LocationServices",
  reminders: "Privacy_Reminders",
  calendars: "Privacy_Calendars",
  contacts: "Privacy_Contacts",
  photos: "Privacy_Photos",
  automation: "Privacy_Automation",
};

/**
 * The native helper behind the grants Electron cannot reach, installed once by
 * the backend. Process-wide like the Electron APIs beside it, because there is
 * one set of grants per running app and nothing here is worth threading
 * through every caller.
 */
let helper: AppPermissions | undefined;

/**
 * The last answer the helper gave for each app grant. It exists because
 * reading one costs a child process while half the callers — the ambient
 * capability checks that run on every turn — are synchronous and cannot wait.
 * They get the last reading; anything that acts on the answer calls
 * `permissionStatus` and gets a fresh one, which also refreshes this.
 */
const lastAppStatus = new Map<AppPermissionKind, SystemPermissionStatus>();

export function useAppPermissions(instance: AppPermissions): void {
  helper = instance;
}

/**
 * A fresh reading, including the app grants the sync form can only remember.
 * Anything that is about to act on the answer should ask through this.
 */
export async function permissionStatus(
  permission: SystemPermissionKind,
): Promise<SystemPermissionStatus> {
  if (process.platform !== "darwin") return "granted";
  if (!isAppPermissionKind(permission)) return systemPermissionStatus(permission);
  if (!helper) return "unknown";
  const status = await helper.status(permission);
  lastAppStatus.set(permission, status);
  return status;
}

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

/**
 * What is granted right now, without waiting. App grants answer from the last
 * reading — "unknown" until something has asked for one — so a caller that
 * needs certainty uses `permissionStatus` instead.
 */
export function systemPermissionStatus(
  permission: SystemPermissionKind,
): SystemPermissionStatus {
  if (process.platform !== "darwin") return "granted";
  if (isAppPermissionKind(permission))
    return lastAppStatus.get(permission) ?? "unknown";
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

  if (isAppPermissionKind(permission)) {
    // The framework call *is* the prompt, so there is nothing to raise
    // separately and nothing to poll: the helper returns once the user has
    // answered, or straight away when the grant was already decided.
    const status = helper ? await helper.request(permission) : "unknown";
    lastAppStatus.set(permission, status);
    return status;
  }

  if (permission === "microphone") {
    await systemPreferences.askForMediaAccess("microphone");
  } else if (permission === "accessibility") {
    // Prompting registers FlareAI in Privacy & Security → Accessibility and
    // shows the system dialog pointing there; there is no async grant flow.
    systemPreferences.isTrustedAccessibilityClient(true);
  } else if (permission === "full-disk-access") {
    // There is no dialog to raise. Full Disk Access is switched on by hand and
    // nowhere else, so asking for it means opening the pane it lives in.
    //
    // The probe runs first, and that ordering is the point: macOS lists an
    // application under Full Disk Access once it has been *refused* a file the
    // grant covers, so a pane opened before the refusal is a pane with no
    // FlareAI row in it — which is exactly the dead end this looked like.
    fullDiskAccessStatus();
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
