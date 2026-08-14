import { desktopCapturer, shell, systemPreferences } from "electron";
import type {
  SystemPermissionKind,
  SystemPermissionStatus,
} from "@midas/protocol";

export function systemPermissionStatus(
  permission: SystemPermissionKind,
): SystemPermissionStatus {
  if (process.platform !== "darwin") return "granted";
  if (permission === "accessibility")
    return systemPreferences.isTrustedAccessibilityClient(false)
      ? "granted"
      : "denied";
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
    // Prompting registers Midas in Privacy & Security → Accessibility and
    // shows the system dialog pointing there; there is no async grant flow.
    systemPreferences.isTrustedAccessibilityClient(true);
  } else if (systemPermissionStatus(permission) !== "granted") {
    // macOS registers Screen Recording access when an application first tries
    // to enumerate a display. The tiny thumbnail avoids doing real Chronicle
    // work while still ensuring Midas appears in Privacy & Security.
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
  const pane = permission === "microphone"
    ? "Privacy_Microphone"
    : permission === "screen-recording"
      ? "Privacy_ScreenCapture"
      : permission === "accessibility"
        ? "Privacy_Accessibility"
        : "Privacy_LocationServices";
  await shell.openExternal(
    `x-apple.systempreferences:com.apple.preference.security?${pane}`,
  );
}
