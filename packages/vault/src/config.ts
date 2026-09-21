/** Same publishable project the desktop AccountService uses. */
export const DEFAULT_ACCOUNT_URL = "https://zeparkyoyqvjzavrejsa.supabase.co";

export interface AccountConfig {
  url: string;
  anonKey: string;
}

/** Server-only secret keys must never be treated as a client-safe anon key. */
export function isSecretKey(key: string): boolean {
  return key.startsWith("sb_secret_");
}

/** Returns null when the publishable key is missing or server-only, matching desktop. */
export function resolveAccountConfig(input?: {
  url?: string | null;
  anonKey?: string | null;
}): AccountConfig | null {
  const url = input?.url?.trim() || DEFAULT_ACCOUNT_URL;
  const anonKey = input?.anonKey?.trim() || "";
  if (!url || !anonKey || isSecretKey(anonKey)) return null;
  return {url, anonKey};
}
