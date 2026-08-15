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
  // Insertion-ordered, so the oldest key is the first one out.
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(url, resolved);
  return resolved;
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
