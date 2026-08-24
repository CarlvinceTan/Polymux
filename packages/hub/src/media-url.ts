/**
 * Scheme the renderer loads bridged media over. The bytes live behind the
 * homeserver's authenticated media endpoint, which an `<img src>` cannot reach
 * on its own — a handler in the main process does the authenticated fetch.
 *
 * Kept apart from that handler so this stays importable outside Electron: the
 * hub client builds these urls, and its tests run in plain Node.
 */
export const MEDIA_SCHEME = "polymux-media";

/** Builds the renderer-facing url for an `mxc://` uri, or null if it is not one. */
export function mediaUrl(mxc: string | undefined): string | null {
  if (!mxc?.startsWith("mxc://")) return null;
  const [server, mediaId] = mxc.slice("mxc://".length).split("/");
  if (!server || !mediaId) return null;
  return `${MEDIA_SCHEME}://${server}/${encodeURIComponent(mediaId)}`;
}
