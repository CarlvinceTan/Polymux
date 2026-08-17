import type { Session } from "electron";

/**
 * Site icons, fetched here and handed to the renderer as `data:` urls.
 *
 * The renderer's CSP is `img-src 'self' data: blob:` — deliberately, so that
 * markdown from a model or a page can never turn an <img> into a tracking
 * beacon. That also blocks every real favicon, which is why an icon has to
 * arrive as bytes rather than as a url the renderer goes and loads. Fetching
 * from the main process keeps the CSP intact, and using the browsing session
 * means an icon behind a login is fetched with the same cookies as the page.
 */

/** All this needs of a session is its fetch, which keeps the module usable
 * from a test without an Electron runtime under it. */
export type FaviconSession = Pick<Session, "fetch">;

/** Re-encodes icon bytes at `size`, or returns null for anything it cannot
 * decode. Electron's `nativeImage` behind a seam, for the same reason. */
export type IconScaler = (bytes: Buffer, size: number) => Promise<string | null>;

/** Icons are re-reported on every navigation, so the same handful of urls come
 * back constantly; a small cache keeps that off the network. Failures are
 * cached too — a site with no `/favicon.ico` should be asked once, not once per
 * page view. */
const CACHE_LIMIT = 256;
const cache = new Map<string, string | null>();

/** Big enough for any real icon, small enough that a mis-served video or
 * installer is dropped rather than buffered. */
const MAX_BYTES = 512 * 1024;
/** Icons that cannot be decoded and re-encoded pass through as-is, and the
 * result is small enough to live in tab state and visit history, so those are
 * held to a tighter limit than the fetch itself. */
const MAX_PASSTHROUGH_BYTES = 64 * 1024;
/** A tab or a link shows the icon at 16px, so anything larger is a payload
 * with no visible benefit. */
const ICON_SIZE = 32;

const EXTENSION_TYPES: Record<string, string> = {
  ico: "image/x-icon",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

/**
 * Drops everything fetched so far. Sites serve a different icon per colour
 * scheme, so a theme change invalidates what is held here: the cached bytes
 * were chosen under the old scheme and would keep a white-on-white icon on
 * screen for as long as the tab lives.
 */
export function clearFaviconCache(): void {
  cache.clear();
}

/**
 * The icon at `url` as a `data:` url, or null when there is none to show —
 * which the renderer draws as the browser globe. Never rejects: a site with a
 * broken, missing or hostile icon is a site whose tab shows a globe.
 */
export async function faviconDataUrl(
  session: FaviconSession,
  url: string,
  scale: IconScaler = scaleWithNativeImage,
): Promise<string | null> {
  const cached = cache.get(url);
  if (cached !== undefined) return cached;
  const resolved = await fetchFavicon(session, url, scale).catch((): null => null);
  remember(url, resolved);
  return resolved;
}

function remember(key: string, value: string | null): void {
  // Insertion-ordered, so the oldest key is the first one out.
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
}

/**
 * The icon for a *site*, rather than for an icon url that is already known.
 *
 * `/favicon.ico` is the last resort here, not the first guess. Sites routinely
 * declare their real mark in the page instead — often twice, once per colour
 * scheme — and Luma is the case in point: `/favicon.ico` redirects to its own
 * 404 page, while the page names a black icon for light and a white one for
 * dark. Reading the page is what gets the right one of those, so it is read
 * first and the conventional path is kept behind it for sites that only have
 * that.
 *
 * Never rejects: a site whose page cannot be read is a site with a globe.
 */
export async function siteFaviconDataUrl(
  session: FaviconSession,
  siteUrl: string,
  options: {scale?: IconScaler; prefersDark?: boolean} = {},
): Promise<string | null> {
  const {scale = scaleWithNativeImage, prefersDark = false} = options;
  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return null;
  }
  // Held per scheme as well as per site: the two answers are different icons,
  // and a theme change clears the whole cache anyway.
  const key = `site:${prefersDark ? "dark" : "light"}:${origin}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const resolved = await resolveSiteIcon(session, origin, scale, prefersDark).catch((): null => null);
  remember(key, resolved);
  return resolved;
}

async function resolveSiteIcon(
  session: FaviconSession,
  origin: string,
  scale: IconScaler,
  prefersDark: boolean,
): Promise<string | null> {
  const declared = await pageIconUrls(session, origin, prefersDark).catch((): string[] => []);
  for (const candidate of [...declared, `${origin}/favicon.ico`]) {
    const icon = await fetchFavicon(session, candidate, scale).catch((): null => null);
    if (icon) return icon;
  }
  return null;
}

/** How much of a page is worth reading to find its `<link rel="icon">`: the
 * head comes first, and a document that buries it past this is a document
 * whose icon is not worth the bytes. */
const MAX_PAGE_BYTES = 256 * 1024;

/**
 * The icon urls a page declares, best first.
 *
 * A `media` attribute is the whole point of reading the page, so one that
 * contradicts the scheme in use is dropped rather than ranked: a white mark on
 * light chrome is worse than no mark at all. Among the rest, an icon that
 * names the current scheme beats one that names none, which beats a
 * touch icon — those are built for a home screen and are usually a padded
 * square rather than the site's mark.
 */
async function pageIconUrls(
  session: FaviconSession,
  origin: string,
  prefersDark: boolean,
): Promise<string[]> {
  const response = await session.fetch(origin);
  if (!response.ok) return [];
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type && type !== "text/html" && type !== "application/xhtml+xml") return [];
  const bytes = Buffer.from(await response.arrayBuffer());
  const html = bytes.subarray(0, MAX_PAGE_BYTES).toString("utf8");

  const ranked: {url: string; rank: number}[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attribute(tag, "rel")?.toLowerCase() ?? "";
    if (!/(^|\s)(shortcut\s+)?(icon|apple-touch-icon(-precomposed)?)(\s|$)/.test(rel)) continue;
    const href = attribute(tag, "href");
    if (!href) continue;
    const media = attribute(tag, "media")?.toLowerCase() ?? "";
    const wantsDark = media.includes("prefers-color-scheme: dark") || media.includes("prefers-color-scheme:dark");
    const wantsLight = media.includes("prefers-color-scheme: light") || media.includes("prefers-color-scheme:light");
    if ((wantsDark && !prefersDark) || (wantsLight && prefersDark)) continue;
    let url: string;
    try {
      url = new URL(href, origin).href;
    } catch {
      continue;
    }
    const touch = rel.includes("apple-touch-icon");
    ranked.push({url, rank: (wantsDark || wantsLight ? 2 : 1) - (touch ? 2 : 0)});
  }
  // A stable sort keeps document order among equals, which is the order the
  // site itself put them in.
  return ranked
    .sort((a, b) => b.rank - a.rank)
    .map((entry) => entry.url)
    .filter((url, at, all) => all.indexOf(url) === at);
}

/** Attributes as written in real markup: quoted either way, or bare. */
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? null;
}

async function fetchFavicon(
  session: FaviconSession,
  url: string,
  scale: IconScaler,
): Promise<string | null> {
  // Chromium reports some icons inline already; those need no fetch at all.
  if (url.startsWith("data:")) return url.length <= MAX_PASSTHROUGH_BYTES ? url : null;
  if (!/^https?:\/\//i.test(url)) return null;

  const response = await session.fetch(url);
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return null;

  // A missing `/favicon.ico` is often a 200 with the site's own 404 page, so
  // what came back has to look like an image before it is treated as one.
  const declared = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const type = declared || guessType(url);
  if (type && !type.startsWith("image/")) return null;

  const scaled = await scale(bytes, ICON_SIZE);
  if (scaled) return scaled;

  // Formats Chromium will render but nativeImage will not decode — svg, and
  // ico off Windows — go through untouched.
  if (!type || bytes.length > MAX_PASSTHROUGH_BYTES) return null;
  return `data:${type};base64,${bytes.toString("base64")}`;
}

function guessType(url: string): string | null {
  const extension = url.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? null;
}

async function scaleWithNativeImage(bytes: Buffer, size: number): Promise<string | null> {
  const { nativeImage } = await import("electron");
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const scaled = width > size || height > size
    ? image.resize({ width: size, height: size, quality: "better" })
    : image;
  return scaled.toDataURL();
}
