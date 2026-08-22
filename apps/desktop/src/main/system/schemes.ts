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
      privileges: {stream: true, supportFetchAPI: true, bypassCSP: true, secure: true},
    },
    {scheme: PREVIEW_SCHEME, privileges: {...PREVIEW_PRIVILEGES}},
  ]);
}
