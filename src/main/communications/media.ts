import { protocol, net } from "electron";
import { MEDIA_SCHEME, mediaUrl } from "./media-url.js";

export { MEDIA_SCHEME, mediaUrl };

/**
 * Bridged messages carry their media as `mxc://` uris, which nothing in a page
 * can load: the bytes live behind the homeserver's authenticated media
 * endpoint, and an `<img src>` cannot send an Authorization header.
 *
 * So the renderer is handed `flareai-media://<server>/<mediaId>` instead, and
 * this handler does the authenticated fetch on its behalf. Streaming it rather
 * than inlining base64 matters for voice notes and video, where a data: uri
 * would mean holding the whole file in the page.
 */

/**
 * Must run before `app.whenReady`: a scheme the renderer treats as ordinary
 * media has to be privileged before any window exists, or `<audio>` and
 * `<video>` refuse to seek within it.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {stream: true, supportFetchAPI: true, bypassCSP: true, secure: true},
    },
  ]);
}

export interface MediaAuth {
  homeserverUrl: string;
  token: string | null;
}

/** Wires the handler up once the app is ready. `auth` is read per request so a
 * sign-in that happens later is picked up without re-registering. */
export function serveMedia(auth: () => MediaAuth): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const {homeserverUrl, token} = auth();
    if (!token) return new Response("Not signed in", {status: 401});
    const url = new URL(request.url);
    // `host` is the media's origin server; the path carries its id.
    const server = url.host;
    const mediaId = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!server || !mediaId) return new Response("Bad media url", {status: 400});
    const target = new URL(
      `/_matrix/client/v1/media/download/${encodeURIComponent(server)}/${encodeURIComponent(mediaId)}`,
      homeserverUrl,
    );
    try {
      const response = await net.fetch(target.toString(), {
        headers: {Authorization: `Bearer ${token}`},
      });
      // The homeserver stores media by id alone, with no federation and no
      // remote-media proxy, so anything a bridge advertises on another server
      // can never resolve here. That is worth saying once with the mxc in
      // hand: it is the difference between "the picture is missing" and "the
      // bridge pointed us at a server we do not have."
      if (!response.ok)
        console.warn(
          `[media] ${response.status} for mxc://${server}/${mediaId} — the homeserver does not hold this media`,
        );
      return response;
    } catch (cause) {
      return new Response(cause instanceof Error ? cause.message : "Media fetch failed", {
        status: 502,
      });
    }
  });
}
