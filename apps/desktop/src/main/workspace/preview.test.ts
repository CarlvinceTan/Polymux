import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { PreviewGrants, previewResponse, previewTarget } from "./preview.js";

const token = (url: string): string => new URL(url).host;

test("a granted file is reachable, and nothing else is", () => {
  const grants = new PreviewGrants();
  const url = grants.url("/tmp/report/page-1.png");
  assert.equal(grants.resolve(token(url), "/page-1.png"), "/tmp/report/page-1.png");
  // A path the host never granted has no token, so a page cannot ask for it.
  assert.equal(grants.resolve("not-a-token", "/page-1.png"), undefined);
});

test("a sibling is reachable, which is what keeps a page whole", () => {
  // An HTML file asks for its stylesheet and images relative to itself. A
  // token that meant one file would answer 404 to every one of them.
  const grants = new PreviewGrants();
  const url = grants.url("/tmp/site/index.html");
  assert.equal(grants.resolve(token(url), "/assets/app.css"), "/tmp/site/assets/app.css");
  assert.equal(grants.resolve(token(url), "/logo.png"), "/tmp/site/logo.png");
});

test("a page cannot walk out of the folder it was granted", () => {
  const grants = new PreviewGrants();
  const url = grants.url("/tmp/site/index.html");
  const escape = grants.resolve(token(url), "/../secrets/keys.json");
  assert.equal(escape, undefined, "a page climbed out of its own folder");
  assert.equal(grants.resolve(token(url), "/..%2f..%2fetc/passwd"), undefined);
  // A folder whose name merely starts the same way is still a different folder.
  assert.equal(grants.resolve(token(url), "/../site-backup/index.html"), undefined);
});

test("one token serves the whole folder, so two files in it share a grant", () => {
  const grants = new PreviewGrants();
  const first = grants.url("/tmp/shots/a.png");
  const second = grants.url("/tmp/shots/b.png");
  assert.equal(token(first), token(second), "the folder was granted twice");
  assert.ok(second.endsWith("/b.png"), second);
});

test("the url carries the name but never the path", () => {
  const grants = new PreviewGrants();
  const url = grants.url("/Users/someone/Secret Plans/clip one.mp4");
  assert.ok(url.endsWith("/clip%20one.mp4"), url);
  assert.ok(!url.includes("Secret"), "the directory leaked into the url");
});

test("granting the same file twice keeps the url already on screen valid", () => {
  const grants = new PreviewGrants();
  const first = grants.url("/tmp/a.png");
  assert.equal(grants.url("/tmp/a.png"), first);
  // Resolved from anywhere it is written, so a relative grant is the same grant.
  assert.equal(grants.url(path.join("/tmp", "b", "..", "a.png")), first);
});

test("a request resolves to its file, and a malformed url to nothing", () => {
  const grants = new PreviewGrants();
  const url = grants.url("/tmp/a.png");
  assert.equal(previewTarget(grants, url), "/tmp/a.png");
  assert.equal(previewTarget(grants, "polymux-preview://stolen/a.png"), undefined);
  assert.equal(previewTarget(grants, "not a url"), undefined);
});

/** Records what the handler asked the filesystem for, so the request the page
 * makes can be checked against the request that actually reaches the disk. */
function recordingFetch(body = "bytes") {
  const calls: Array<{url: string; headers?: Record<string, string>}> = [];
  const fetchFile = async (url: string, init?: {headers?: Record<string, string>}) => {
    calls.push({url, ...(init?.headers ? {headers: init.headers} : {})});
    // Electron answers 200 to a range request, with no Content-Range: the very
    // thing `previewResponse` exists to correct, so the stub answers the same.
    return new Response(body, {status: 200, headers: {"Content-Type": "video/mp4"}});
  };
  return {calls, fetchFile};
}

/** The file is 1000 bytes unless a test says otherwise. */
const sizeOf = (size = 1000) => async () => size;
const missingSize = async () => {
  throw new Error("gone");
};

const headers = (values: Record<string, string> = {}) => ({
  get: (name: string) => values[name] ?? null,
});

test("a granted url is read from the file it stands for", async () => {
  const grants = new PreviewGrants();
  const url = grants.url("/tmp/report/page 1.png");
  const {calls, fetchFile} = recordingFetch();

  const response = await previewResponse(grants, {url, headers: headers()}, fetchFile, sizeOf());

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "file:///tmp/report/page%201.png");
  assert.equal(calls[0]!.headers, undefined, "no range was asked for, so none was sent");
  // A player decides from the first response whether it may seek at all.
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
  assert.equal(response.headers.get("Content-Length"), "1000");
});

test("a range is answered as one: 206, Content-Range, and the length of the part", async () => {
  // Electron's file handler honours a range in the body but replies 200 with
  // no Content-Range, which a player reads as the whole file. Composing the
  // answer here is the difference between seeking and silently wrong bytes.
  const grants = new PreviewGrants();
  const url = grants.url("/tmp/clip.mp4");
  const {calls, fetchFile} = recordingFetch();

  const response = await previewResponse(
    grants, {url, headers: headers({Range: "bytes=200-499"})}, fetchFile, sizeOf(1000));

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 200-499/1000");
  assert.equal(response.headers.get("Content-Length"), "300");
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
  // The handler's own sniffed type survives; only the range headers are ours.
  assert.equal(response.headers.get("Content-Type"), "video/mp4");
  assert.deepEqual(calls[0]!.headers, {Range: "bytes=200-499"});
});

test("an open-ended range runs to the last byte", async () => {
  const grants = new PreviewGrants();
  const url = grants.url("/tmp/clip.mp4");
  const {calls, fetchFile} = recordingFetch();

  const response = await previewResponse(
    grants, {url, headers: headers({Range: "bytes=900-"})}, fetchFile, sizeOf(1000));

  assert.equal(response.headers.get("Content-Range"), "bytes 900-999/1000");
  assert.deepEqual(calls[0]!.headers, {Range: "bytes=900-999"});
});

test("a suffix range is measured from the end, which is how a player reads a trailer", async () => {
  const grants = new PreviewGrants();
  const url = grants.url("/tmp/clip.mp4");
  const {calls, fetchFile} = recordingFetch();

  const response = await previewResponse(
    grants, {url, headers: headers({Range: "bytes=-128"})}, fetchFile, sizeOf(1000));

  assert.equal(response.headers.get("Content-Range"), "bytes 872-999/1000");
  assert.deepEqual(calls[0]!.headers, {Range: "bytes=872-999"});
});

test("an end past the file is clamped rather than refused", async () => {
  const grants = new PreviewGrants();
  const url = grants.url("/tmp/clip.mp4");
  const {fetchFile} = recordingFetch();

  const response = await previewResponse(
    grants, {url, headers: headers({Range: "bytes=500-99999"})}, fetchFile, sizeOf(1000));

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 500-999/1000");
});

test("a range that cannot be met is 416, not the whole file", async () => {
  const grants = new PreviewGrants();
  const url = grants.url("/tmp/clip.mp4");
  const {calls, fetchFile} = recordingFetch();

  const response = await previewResponse(
    grants, {url, headers: headers({Range: "bytes=5000-6000"})}, fetchFile, sizeOf(1000));

  assert.equal(response.status, 416);
  assert.equal(response.headers.get("Content-Range"), "bytes */1000");
  assert.deepEqual(calls, [], "a refused range still read the file");
});

test("an unmeasurable file answers whole rather than inventing a range", async () => {
  const grants = new PreviewGrants();
  const url = grants.url("/tmp/clip.mp4");
  const {fetchFile} = recordingFetch();

  const response = await previewResponse(
    grants, {url, headers: headers({Range: "bytes=0-10"})}, fetchFile, missingSize);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Range"), null);
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
});

test("an ungranted token is refused before the disk is touched", async () => {
  const grants = new PreviewGrants();
  grants.url("/tmp/granted.png");
  const {calls, fetchFile} = recordingFetch();

  const response = await previewResponse(
    grants,
    {url: "polymux-preview://guessed/granted.png", headers: headers()},
    fetchFile,
    sizeOf(),
  );

  assert.equal(response.status, 404);
  assert.deepEqual(calls, [], "a refused request still reached for a file");
});
