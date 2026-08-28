import type {
  BuiltInPermissionKind,
  SystemPermissionStatus,
} from "@polymux/protocol";

/**
 * Whether this operating system has a meaningful user-consent request for the
 * built-in capability. A missing equivalent is available through the host's
 * ordinary process rights, so it must not produce a fake permission prompt.
 */
export function builtInPermissionRequestsUser(
  permission: BuiltInPermissionKind,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === "darwin") return true;
  if (platform === "win32") return permission === "microphone";
  if (platform === "linux")
    return permission === "microphone" || permission === "screen-recording";
  return false;
}

/** The real media attempt is more precise than a coarse platform-wide value;
 * use the latter only when the device request could not decide. */
export function resolvedMediaPermissionStatus(
  platformStatus: SystemPermissionStatus,
  attempted: SystemPermissionStatus,
): SystemPermissionStatus {
  return attempted === "unknown" || attempted === "not-determined"
    ? platformStatus
    : attempted;
}
