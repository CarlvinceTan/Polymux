import type {Session} from "electron";

/**
 * The document title of a page, read here so Summary can show "Polymux" rather
 * than the hostname the citation fell back to.
 *
 * Favicons already fetch the page from the browsing session; this is the same
 * idea for `<title>` / `og:title`. Never rejects: a site that will not answer
 * is a site whose row keeps the hostname until the next try.
 */

export type TitleSession = Pick<Session, "fetch">;

const CACHE_LIMIT = 256;
const cache = new Map<string, string | null>();
const MAX_PAGE_BYTES = 256 * 1024;

export function clearPageTitleCache(): void {
  cache.clear();
}

/** Parse a page title out of HTML. `og:title` wins: it is the name the site
 * chose to be cited by, and `<title>` is often a tab suffix on top of it. */
export function titleFromHtml(html: string): string | null {
  const og =
    metaContent(html, "property", "og:title") ??
    metaContent(html, "name", "og:title") ??
    metaContent(html, "name", "twitter:title");
  const tagged = /<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  return usableTitle(og) ?? usableTitle(tagged);
}

export async function fetchPageTitle(
  session: TitleSession,
  pageUrl: string,
): Promise<string | null> {
  const url = canonicalFetchUrl(pageUrl);
  if (!url) return null;
  const cached = cache.get(url);
  if (cached !== undefined) return cached;
  const resolved = await readTitle(session, url).catch((): null => null);
  remember(url, resolved);
  return resolved;
}

function canonicalFetchUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function readTitle(session: TitleSession, url: string): Promise<string | null> {
  const response = await session.fetch(url);
  if (!response.ok) return null;
  const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type && type !== "text/html" && type !== "application/xhtml+xml") return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  return titleFromHtml(bytes.subarray(0, MAX_PAGE_BYTES).toString("utf8"));
}

function metaContent(html: string, attr: string, value: string): string | undefined {
  const pattern = new RegExp(
    `<meta\\b[^>]*(?:${attr}\\s*=\\s*["']${escapeRegExp(value)}["'][^>]*content\\s*=\\s*("([^"]*)"|'([^']*)')|content\\s*=\\s*("([^"]*)"|'([^']*)')[^>]*${attr}\\s*=\\s*["']${escapeRegExp(value)}["'])[^>]*>`,
    "i",
  );
  const match = pattern.exec(html);
  return match?.[2] ?? match?.[3] ?? match?.[5] ?? match?.[6] ?? undefined;
}

function usableTitle(value: string | undefined): string | null {
  if (value == null) return null;
  const title = decodeEntities(value).replace(/\s+/g, " ").trim();
  if (!title) return null;
  if (/^https?:\/\//i.test(title)) return null;
  if (/^(just a moment|attention required|access denied|403|404|error)\b/i.test(title)) return null;
  return title;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => fromCodePoint(Number(code)));
}

function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  return String.fromCodePoint(code);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function remember(key: string, value: string | null): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
}
