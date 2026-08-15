import assert from "node:assert/strict";
import test from "node:test";
import { faviconDataUrl, type FaviconSession, type IconScaler } from "../favicon.js";

const PNG_DATA_URL = "data:image/png;base64,scaled";

/** Stands in for Electron's decoder: anything labelled png decodes, everything
 * else (svg, an html error page, a broken ico) does not. */
const scale: IconScaler = async (bytes) =>
  bytes.toString().startsWith("png") ? PNG_DATA_URL : null;

function session(reply: {
  ok?: boolean;
  type?: string;
  body?: string | Buffer;
}): FaviconSession & { calls: string[] } {
  const calls: string[] = [];
  const body = Buffer.from(reply.body ?? "png-bytes");
  return {
    calls,
    fetch: async (input: string | Request) => {
      calls.push(typeof input === "string" ? input : input.url);
      return {
        ok: reply.ok ?? true,
        headers: new Headers(reply.type ? { "content-type": reply.type } : {}),
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      } as Response;
    },
  } as FaviconSession & { calls: string[] };
}

test("re-encodes a decodable icon and asks the network once per url", async () => {
  const remote = session({ type: "image/png" });
  const url = "https://decodable.test/favicon.ico";

  assert.equal(await faviconDataUrl(remote, url, scale), PNG_DATA_URL);
  assert.equal(await faviconDataUrl(remote, url, scale), PNG_DATA_URL);
  assert.deepEqual(remote.calls, [url]);
});

test("passes through what the decoder cannot read but a page can render", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const remote = session({ type: "image/svg+xml", body: svg });

  const resolved = await faviconDataUrl(remote, "https://svg.test/icon.svg", scale);

  assert.equal(resolved, `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
});

test("a site's 404 page served as the icon is no icon at all", async () => {
  const html = session({ type: "text/html", body: "<!doctype html><title>Not found</title>" });
  const missing = session({ ok: false });

  assert.equal(await faviconDataUrl(html, "https://html.test/favicon.ico", scale), null);
  assert.equal(await faviconDataUrl(missing, "https://missing.test/favicon.ico", scale), null);
});

test("an undecodable icon with no type to declare is dropped rather than guessed", async () => {
  // Content type absent and an extension that says nothing: passing the bytes
  // through would put an <img> with an unreadable payload in a tab.
  const remote = session({ body: "not-an-image" });

  assert.equal(await faviconDataUrl(remote, "https://typeless.test/icon", scale), null);
});

test("only http(s) and inline icons are fetched", async () => {
  const remote = session({ type: "image/png" });

  assert.equal(await faviconDataUrl(remote, "chrome://favicon/x", scale), null);
  assert.equal(await faviconDataUrl(remote, "data:image/png;base64,AAAA", scale), "data:image/png;base64,AAAA");
  assert.deepEqual(remote.calls, []);
});
