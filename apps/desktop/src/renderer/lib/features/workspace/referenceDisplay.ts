/**
 * How a Summary reference reads: the page's own title, then the url under it.
 * A stored title that is just the hostname (the recorder's fallback) is not a
 * title — the url is shown once until a real name arrives.
 */

export function referenceCopy(reference: {
  title: string;
  kind?: 'web' | 'file' | 'other';
  uri?: string;
}): {title: string; detail: string | null} {
  if (reference.kind !== 'web' || !reference.uri) {
    return {title: reference.title, detail: null};
  }
  const detail = displayUrl(reference.uri);
  if (!detail) return {title: reference.title, detail: null};
  const title = isUrlLikeTitle(reference.title, reference.uri) ? detail : reference.title;
  return {title, detail: title === detail ? null : detail};
}

export function displayUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.pathname = cleanPath(parsed.pathname);
    const host = parsed.host.replace(/^www\./i, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${host}${path}${parsed.search}`;
  } catch {
    return value;
  }
}

function cleanPath(pathname: string): string {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // A malformed percent-escape stays as written; trailing markdown is still dropped.
  }
  path = path.replace(/[`*_~]+$/g, '');
  return path || '/';
}

function isUrlLikeTitle(title: string, url: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return true;
  if (/^https?:\/\//i.test(trimmed)) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    if (trimmed === parsed.hostname || trimmed === host) return true;
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    if (trimmed === `${host}${path}` || trimmed === `${parsed.hostname}${path}`) return true;
    if (trimmed === displayUrl(url)) return true;
  } catch {
    if (trimmed === url) return true;
  }
  return false;
}
