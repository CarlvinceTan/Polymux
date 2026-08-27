import assert from "node:assert/strict";
import test from "node:test";
import {mediaResponse, type FetchMedia, type MediaRequest} from "./media-response.js";

const auth = {homeserverUrl: "http://127.0.0.1:8008", token: "secret-token"};
const request = (range?: string): MediaRequest => ({
  url: "polymux-media://polymux.test/reel-id",
  headers: {get: (name) => name.toLowerCase() === "range" ? range ?? null : null},
});

test("an inline player's byte range reaches the authenticated media endpoint", async () => {
  const calls: Array<{url: string; headers: Record<string, string>}> = [];
  const fetchMedia: FetchMedia = async (url, init) => {
    calls.push({url, headers: init.headers});
    return new Response("part", {
      status: 206,
      headers: {"Content-Range": "bytes 1024-2047/4096"},
    });
  };

  const response = await mediaResponse(auth, request("bytes=1024-2047"), fetchMedia);

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 1024-2047/4096");
  assert.deepEqual(calls, [{
    url: "http://127.0.0.1:8008/_matrix/client/v1/media/download/polymux.test/reel-id",
    headers: {Authorization: "Bearer secret-token", Range: "bytes=1024-2047"},
  }]);
});

test("an ordinary image request adds no range of its own", async () => {
  let forwarded: Record<string, string> | undefined;
  await mediaResponse(auth, request(), async (_url, init) => {
    forwarded = init.headers;
    return new Response("whole");
  });
  assert.deepEqual(forwarded, {Authorization: "Bearer secret-token"});
});

test("bad media urls and upstream failures become bounded responses", async () => {
  let fetched = false;
  const bad = await mediaResponse(
    auth,
    {url: "not a url", headers: {get: () => null}},
    async () => { fetched = true; return new Response(); },
  );
  assert.equal(bad.status, 400);
  assert.equal(fetched, false);

  const failed = await mediaResponse(auth, request(), async () => {
    throw new Error("connection ended");
  });
  assert.equal(failed.status, 502);
  assert.equal(await failed.text(), "connection ended");
});
