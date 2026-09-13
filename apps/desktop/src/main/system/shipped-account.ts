/**
 * Publishable Polymux account credentials shipped with the desktop app.
 *
 * The URL and anon key identify the Supabase project; they do not grant admin
 * access. Vite replaces the globals in packaged builds. An ambient environment
 * value still wins so development and emergency overrides keep working.
 */

declare const __POLYMUX_SUPABASE_URL__: string | undefined;
declare const __POLYMUX_SUPABASE_ANON_KEY__: string | undefined;

export const SHIPPED_ACCOUNT_VARIABLES = [
  "POLYMUX_SUPABASE_URL",
  "POLYMUX_SUPABASE_ANON_KEY",
] as const;

export type ShippedAccountVariable = (typeof SHIPPED_ACCOUNT_VARIABLES)[number];
export type ShippedAccountValues = Partial<Record<ShippedAccountVariable, string>>;

function bundledValues(): ShippedAccountValues {
  return {
    POLYMUX_SUPABASE_URL:
      typeof __POLYMUX_SUPABASE_URL__ === "undefined" ? "" : __POLYMUX_SUPABASE_URL__,
    POLYMUX_SUPABASE_ANON_KEY:
      typeof __POLYMUX_SUPABASE_ANON_KEY__ === "undefined" ? "" : __POLYMUX_SUPABASE_ANON_KEY__,
  };
}

/** Installs packaged values before AccountService is constructed. */
export function applyShippedAccountCredentials(
  environment: NodeJS.ProcessEnv = process.env,
  bundled: ShippedAccountValues = bundledValues(),
): void {
  for (const variable of SHIPPED_ACCOUNT_VARIABLES) {
    if (environment[variable]?.trim()) continue;
    const value = bundled[variable]?.trim();
    if (value) environment[variable] = value;
  }
}
