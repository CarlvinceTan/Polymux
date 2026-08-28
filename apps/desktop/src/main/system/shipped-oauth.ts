/**
 * OAuth application registrations shipped with the desktop app.
 *
 * These identify Polymux to the provider; they do not sign a user in or grant
 * access to an account. Vite replaces the globals in packaged builds. An
 * ambient environment value still wins so development and emergency overrides
 * keep working without another package.
 */

declare const __POLYMUX_GOOGLE_DRIVE_CLIENT_ID__: string | undefined;
declare const __POLYMUX_GOOGLE_DRIVE_CLIENT_SECRET__: string | undefined;
declare const __POLYMUX_DROPBOX_CLIENT_ID__: string | undefined;
declare const __POLYMUX_DROPBOX_CLIENT_SECRET__: string | undefined;
declare const __POLYMUX_ONEDRIVE_CLIENT_ID__: string | undefined;
declare const __POLYMUX_ONEDRIVE_CLIENT_SECRET__: string | undefined;
declare const __POLYMUX_GOOGLE_MAIL_CLIENT_ID__: string | undefined;
declare const __POLYMUX_GOOGLE_MAIL_CLIENT_SECRET__: string | undefined;
declare const __POLYMUX_MICROSOFT_MAIL_CLIENT_ID__: string | undefined;
declare const __POLYMUX_MICROSOFT_MAIL_CLIENT_SECRET__: string | undefined;

export const SHIPPED_OAUTH_VARIABLES = [
  "POLYMUX_GOOGLE_DRIVE_CLIENT_ID",
  "POLYMUX_GOOGLE_DRIVE_CLIENT_SECRET",
  "POLYMUX_DROPBOX_CLIENT_ID",
  "POLYMUX_DROPBOX_CLIENT_SECRET",
  "POLYMUX_ONEDRIVE_CLIENT_ID",
  "POLYMUX_ONEDRIVE_CLIENT_SECRET",
  "POLYMUX_GOOGLE_MAIL_CLIENT_ID",
  "POLYMUX_GOOGLE_MAIL_CLIENT_SECRET",
  "POLYMUX_MICROSOFT_MAIL_CLIENT_ID",
  "POLYMUX_MICROSOFT_MAIL_CLIENT_SECRET",
] as const;

export type ShippedOAuthVariable = (typeof SHIPPED_OAUTH_VARIABLES)[number];
export type ShippedOAuthValues = Partial<Record<ShippedOAuthVariable, string>>;

function bundledValues(): ShippedOAuthValues {
  return {
    POLYMUX_GOOGLE_DRIVE_CLIENT_ID:
      typeof __POLYMUX_GOOGLE_DRIVE_CLIENT_ID__ === "undefined"
        ? ""
        : __POLYMUX_GOOGLE_DRIVE_CLIENT_ID__,
    POLYMUX_GOOGLE_DRIVE_CLIENT_SECRET:
      typeof __POLYMUX_GOOGLE_DRIVE_CLIENT_SECRET__ === "undefined"
        ? ""
        : __POLYMUX_GOOGLE_DRIVE_CLIENT_SECRET__,
    POLYMUX_DROPBOX_CLIENT_ID:
      typeof __POLYMUX_DROPBOX_CLIENT_ID__ === "undefined"
        ? ""
        : __POLYMUX_DROPBOX_CLIENT_ID__,
    POLYMUX_DROPBOX_CLIENT_SECRET:
      typeof __POLYMUX_DROPBOX_CLIENT_SECRET__ === "undefined"
        ? ""
        : __POLYMUX_DROPBOX_CLIENT_SECRET__,
    POLYMUX_ONEDRIVE_CLIENT_ID:
      typeof __POLYMUX_ONEDRIVE_CLIENT_ID__ === "undefined"
        ? ""
        : __POLYMUX_ONEDRIVE_CLIENT_ID__,
    POLYMUX_ONEDRIVE_CLIENT_SECRET:
      typeof __POLYMUX_ONEDRIVE_CLIENT_SECRET__ === "undefined"
        ? ""
        : __POLYMUX_ONEDRIVE_CLIENT_SECRET__,
    POLYMUX_GOOGLE_MAIL_CLIENT_ID:
      typeof __POLYMUX_GOOGLE_MAIL_CLIENT_ID__ === "undefined"
        ? ""
        : __POLYMUX_GOOGLE_MAIL_CLIENT_ID__,
    POLYMUX_GOOGLE_MAIL_CLIENT_SECRET:
      typeof __POLYMUX_GOOGLE_MAIL_CLIENT_SECRET__ === "undefined"
        ? ""
        : __POLYMUX_GOOGLE_MAIL_CLIENT_SECRET__,
    POLYMUX_MICROSOFT_MAIL_CLIENT_ID:
      typeof __POLYMUX_MICROSOFT_MAIL_CLIENT_ID__ === "undefined"
        ? ""
        : __POLYMUX_MICROSOFT_MAIL_CLIENT_ID__,
    POLYMUX_MICROSOFT_MAIL_CLIENT_SECRET:
      typeof __POLYMUX_MICROSOFT_MAIL_CLIENT_SECRET__ === "undefined"
        ? ""
        : __POLYMUX_MICROSOFT_MAIL_CLIENT_SECRET__,
  };
}

/** Installs packaged values before Drive or Mail is constructed. */
export function applyShippedOAuthCredentials(
  environment: NodeJS.ProcessEnv = process.env,
  bundled: ShippedOAuthValues = bundledValues(),
): void {
  for (const variable of SHIPPED_OAUTH_VARIABLES) {
    if (environment[variable]?.trim()) continue;
    const value = bundled[variable]?.trim();
    if (value) environment[variable] = value;
  }
}
