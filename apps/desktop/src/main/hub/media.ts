import { protocol, net } from "electron";
import { MEDIA_SCHEME, mediaUrl } from "@polymux/hub";
import {mediaResponse, type MediaAuth} from "./media-response.js";

export { MEDIA_SCHEME, mediaUrl };
export type {MediaAuth} from "./media-response.js";

/**
 * Bridged messages carry their media as `mxc://` uris, which nothing in a page
 * can load: the bytes live behind the homeserver's authenticated media
 * endpoint, and an `<img src>` cannot send an Authorization header.
 *
 * So the renderer is handed `polymux-media://<server>/<mediaId>` instead, and
 * this handler does the authenticated fetch on its behalf. Streaming it rather
 * than inlining base64 matters for voice notes and video, where a data: uri
 * would mean holding the whole file in the page.
 */

/** How long a media request waits for sign-in before giving up; see below. */
const SIGN_IN_POLL_MS = 100;
const SIGN_IN_GRACE_ATTEMPTS = 50;

/** Wires the handler up once the app is ready. `auth` is read per request so a
 * sign-in that happens later is picked up without re-registering. */
export function serveMedia(auth: () => Omit<MediaAuth, "token"> & {token: string | null}): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    /**
     * Signing in to the hub happens after the window is up, so the pictures
     * already on screen at launch ask for their bytes before there is a token
     * to ask with. Answering 401 straight away made every one of them fail at
     * once — and a failed <img> is not retried by the page, so they stayed
     * empty until the conversation was reopened. Waiting out the gap is the
     * difference between a thread that fills in and one that looks broken.
     */
    let {homeserverUrl, token} = auth();
    for (let attempt = 0; !token && attempt < SIGN_IN_GRACE_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, SIGN_IN_POLL_MS));
      ({homeserverUrl, token} = auth());
    }
    if (!token) return new Response("Not signed in", {status: 401});
    return mediaResponse(
      {homeserverUrl, token},
      request,
      (url, init) => net.fetch(url, init),
    );
  });
}
