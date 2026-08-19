/**
 * The preview scheme against real Electron, which is the only thing that can
 * answer what its file handler actually does.
 *
 * It was worth writing: the handler honours a `Range` in the body but replies
 * `200` with no `Content-Range`, so forwarding the header — which reads as
 * obviously correct, and which every unit test with a stub will agree with —
 * hands a media element the wrong bytes for a seek and calls it the whole
 * file. Nothing short of a live check finds that.
 *
 * Opt-in and quick. Run it after changing `workspace/preview.ts`:
 *   npm run test:preview-live
 */
import { app, net, protocol } from "electron";
import { mkdtempSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PREVIEW_SCHEME, PREVIEW_PRIVILEGES, PreviewGrants, previewResponse } from "../.vite/preview-live/preview.mjs";

protocol.registerSchemesAsPrivileged([{scheme: PREVIEW_SCHEME, privileges: {...PREVIEW_PRIVILEGES}}]);

const home = mkdtempSync(path.join(tmpdir(), "preview-live-"));
const clip = path.join(home, "clip one.mp4");
const body = Buffer.from(Array.from({length: 1000}, (_, i) => i % 256));
writeFileSync(clip, body);

const grants = new PreviewGrants();
const url = grants.url(clip);
const out = [];
const check = (name, ok, detail) => out.push(`${ok ? "PASS" : "FAIL"} | ${name} | ${detail}`);

app.whenReady().then(async () => {
  protocol.handle(PREVIEW_SCHEME, (request) =>
    previewResponse(grants, request, (u, init) => net.fetch(u, init), async (f) => (await stat(f)).size));

  const whole = await net.fetch(url);
  const wholeBytes = Buffer.from(await whole.arrayBuffer());
  check("whole file: bytes, type, and seekability advertised",
    whole.status === 200 && wholeBytes.equals(body)
      && whole.headers.get("accept-ranges") === "bytes"
      && whole.headers.get("content-length") === "1000"
      && whole.headers.get("content-type") === "video/mp4",
    `status=${whole.status} len=${wholeBytes.length} type=${whole.headers.get("content-type")} accept-ranges=${whole.headers.get("accept-ranges")} content-length=${whole.headers.get("content-length")}`);

  const part = await net.fetch(url, {headers: {Range: "bytes=200-499"}});
  const partBytes = Buffer.from(await part.arrayBuffer());
  check("range: 206 with the right bytes and Content-Range",
    part.status === 206 && partBytes.equals(body.subarray(200, 500))
      && part.headers.get("content-range") === "bytes 200-499/1000",
    `status=${part.status} len=${partBytes.length} content-range=${part.headers.get("content-range")} matches=${partBytes.equals(body.subarray(200, 500))}`);

  const tail = await net.fetch(url, {headers: {Range: "bytes=-128"}});
  const tailBytes = Buffer.from(await tail.arrayBuffer());
  check("suffix range reads the last bytes",
    tail.status === 206 && tailBytes.equals(body.subarray(872)),
    `status=${tail.status} content-range=${tail.headers.get("content-range")} matches=${tailBytes.equals(body.subarray(872))}`);

  const bad = await net.fetch(url, {headers: {Range: "bytes=5000-6000"}});
  check("unsatisfiable range is 416", bad.status === 416,
    `status=${bad.status} content-range=${bad.headers.get("content-range")}`);

  const refused = await net.fetch(`${PREVIEW_SCHEME}://guessed/clip%20one.mp4`);
  check("an ungranted token is refused", refused.status === 404, `status=${refused.status}`);

  for (const line of out) console.log(line);
  app.exit(out.every((l) => l.startsWith("PASS")) ? 0 : 1);
});
