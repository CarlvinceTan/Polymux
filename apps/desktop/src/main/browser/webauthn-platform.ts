import { spawnSync } from "node:child_process";
import type { App } from "electron";

export interface PlatformWebAuthnStatus {
  enabled: boolean;
  keychainAccessGroup?: string;
  reason?:
    | "unsupported-platform"
    | "unsigned-build"
    | "missing-entitlement"
    | "configuration-failed";
}

/** Reads only public code-signing metadata from the current executable. The
 * same two values are what packaging uses to create the keychain entitlement,
 * so runtime cannot drift onto a differently signed group's credentials. */
export function webAuthnKeychainAccessGroup(
  signature: string,
): string | null {
  const team = /^TeamIdentifier=([A-Z0-9]+)$/m.exec(signature)?.[1];
  const identifier = /^Identifier=([A-Za-z0-9.-]+)$/m.exec(signature)?.[1];
  if (!team || !identifier) return null;
  return `${team}.${identifier}.webauthn`;
}

function inspectCodeSignature(executable: string): string {
  const signature = spawnSync(
    "/usr/bin/codesign",
    ["-d", "--verbose=4", executable],
    { encoding: "utf8" },
  );
  if (signature.status !== 0) return "";
  const entitlements = spawnSync(
    "/usr/bin/codesign",
    ["-d", "--entitlements", "-", executable],
    { encoding: "utf8" },
  );
  // `codesign -d` writes its report to stderr by design.
  return [
    signature.stdout ?? "",
    signature.stderr ?? "",
    entitlements.stdout ?? "",
    entitlements.stderr ?? "",
  ].join("\n");
}

/** Enables Electron's Secure Enclave authenticator after `app.ready`.
 * Unsigned/ad-hoc builds keep running with WebAuthn honestly unavailable; a
 * signing mistake must not turn the whole desktop app into a startup failure. */
export function configurePlatformWebAuthn(
  electronApp: Pick<App, "configureWebAuthn">,
  options: {
    platform?: NodeJS.Platform;
    executable?: string;
    inspectSignature?: (executable: string) => string;
  } = {},
): PlatformWebAuthnStatus {
  if ((options.platform ?? process.platform) !== "darwin")
    return { enabled: false, reason: "unsupported-platform" };

  const executable = options.executable ?? process.execPath;
  const signature = (options.inspectSignature ?? inspectCodeSignature)(executable);
  const group = webAuthnKeychainAccessGroup(signature);
  if (!group) return { enabled: false, reason: "unsigned-build" };
  if (!signature.includes(group))
    return { enabled: false, reason: "missing-entitlement" };

  try {
    electronApp.configureWebAuthn({
      touchID: {
        keychainAccessGroup: group,
        promptReason: "verify your identity on $1",
      },
    });
    return { enabled: true, keychainAccessGroup: group };
  } catch {
    return {
      enabled: false,
      keychainAccessGroup: group,
      reason: "configuration-failed",
    };
  }
}
