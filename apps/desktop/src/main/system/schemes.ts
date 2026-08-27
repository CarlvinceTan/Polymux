import { protocol } from "electron";
import { MEDIA_SCHEME } from "../hub/media.js";
import { PREVIEW_PRIVILEGES, PREVIEW_SCHEME } from "../workspace/preview.js";

/**
 * Every scheme the renderer treats as ordinary media, registered in one call.
 *
 * The single call is the point: `registerSchemesAsPrivileged` takes the whole
 * set, so a second call is not additive — it is the list, and whichever ran
 * first is forgotten. Two domains each registering their own would leave the
 * loser's `<video>` unable to seek, silently and only at runtime. So the
 * schemes are collected here instead, and a new one is a line in this array.
 *
 * Must run before `app.whenReady`: a scheme cannot be privileged once a window
 * exists.
 */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      // The media URL has HTTP-style authority/path semantics and Chromium's
      // player issues cross-origin byte-range requests against it. `stream`
      // alone makes the body incremental, but leaves the scheme non-standard
      // and outside CORS; Electron can then decode the first response and
      // reject the follow-up request as an unsupported media source.
      privileges: {
        standard: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true,
        bypassCSP: true,
        secure: true,
      },
    },
    {scheme: PREVIEW_SCHEME, privileges: {...PREVIEW_PRIVILEGES}},
  ]);
}
