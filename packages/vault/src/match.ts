/**
 * Whether a KeePass entry's URL belongs to the page the browser is on.
 *
 * Matching is hostname-based: `github.com` fills `https://github.com/login`,
 * and `google.com` fills `mail.google.com`. A lookalike host
 * (`evil-google.com`) does not match `google.com`. Entries with no URL are
 * never offered — there is no site to attribute them to.
 */

export function hostKey(hostname: string): string {
  return hostname.replace(/\.$/, "").replace(/^www\./i, "").toLowerCase();
}

export function parseSiteUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

export function entryMatchesPage(entryUrl: string, pageUrl: string): boolean {
  const entry = parseSiteUrl(entryUrl);
  const page = parseSiteUrl(pageUrl);
  if (!entry || !page) return false;
  const stored = hostKey(entry.hostname);
  const current = hostKey(page.hostname);
  if (!stored || !current) return false;
  return current === stored || current.endsWith(`.${stored}`);
}

export function matchItems<T extends { url: string }>(items: T[], pageUrl: string): T[] {
  return items.filter((item) => entryMatchesPage(item.url, pageUrl));
}
