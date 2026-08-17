import assert from "node:assert/strict";
import test from "node:test";
import {
  clearFaviconCache,
  faviconDataUrl,
  siteFaviconDataUrl,
  type FaviconSession,
  type IconScaler,
} from "./favicon.js";

const PNG_DATA_URL = "data:image/png;base64,scaled";

/** Stands in for Electron's decoder: anything labelled png decodes, everything
 * else (svg, an html error page, a broken ico) does not. */
const scale: IconScaler = async (bytes) =>
  bytes.toString().startsWith("png") ? PNG_DATA_URL : null;

/** The same, but the result names which bytes it decoded, so a test can tell
 * two icons from the same site apart. */
const named: IconScaler = async (bytes) => {
  const body = bytes.toString();
  return body.startsWith("png-") ? `data:image/png;base64,${body.slice(4)}` : null;
};

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

test("a theme change re-fetches, since sites serve one icon per colour scheme", async () => {
  const remote = session({ type: "image/png" });
  const url = "https://themed.test/favicon.ico";

  assert.equal(await faviconDataUrl(remote, url, scale), PNG_DATA_URL);
  clearFaviconCache();
  assert.equal(await faviconDataUrl(remote, url, scale), PNG_DATA_URL);
  assert.deepEqual(remote.calls, [url, url]);
});

/** A site that answers each url differently, which is what reading a page for
 * its icons needs: the page, then whichever icon is asked for. */
function siteSession(routes: Record<string, {ok?: boolean; type?: string; body?: string}>): FaviconSession & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      calls.push(url);
      const route = routes[url] ?? { ok: false };
      const body = Buffer.from(route.body ?? "png-bytes");
      return {
        ok: route.ok ?? true,
        headers: new Headers(route.type ? { "content-type": route.type } : {}),
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      } as Response;
    },
  } as FaviconSession & { calls: string[] };
}

/** Luma's markup, and the shape of the bug this exists for: `/favicon.ico`
 * redirects to a 404 page, and the real mark is declared twice, once per
 * scheme. */
const LUMA_PAGE = `<!doctype html><html><head>
  <link rel="icon" href="/favicons/favicon-black.ico" type="image/x-icon"/>
  <link rel="icon" href="/favicons/favicon-black.ico" media="(prefers-color-scheme: light)" type="image/x-icon"/>
  <link rel="icon" href="/favicons/favicon-white.ico" media="(prefers-color-scheme: dark)" type="image/x-icon"/>
</head><body></body></html>`;

test("takes the icon the page declares for the scheme in use", async () => {
  const routes = {
    "https://luma.test": { type: "text/html", body: LUMA_PAGE },
    "https://luma.test/favicons/favicon-black.ico": { type: "image/x-icon", body: "png-black" },
    "https://luma.test/favicons/favicon-white.ico": { type: "image/x-icon", body: "png-white" },
    "https://luma.test/favicon.ico": { ok: false },
  };
  const light = siteSession(routes);
  const dark = siteSession(routes);

  assert.equal(
    await siteFaviconDataUrl(light, "https://luma.test/dream-machine", { scale: named, prefersDark: false }),
    "data:image/png;base64,black",
  );
  assert.equal(
    await siteFaviconDataUrl(dark, "https://luma.test/dream-machine", { scale: named, prefersDark: true }),
    "data:image/png;base64,white",
  );
  // The one the scheme names is tried first, so the other is never fetched.
  assert.ok(!light.calls.includes("https://luma.test/favicons/favicon-white.ico"));
  assert.ok(!dark.calls.includes("https://luma.test/favicons/favicon-black.ico"));
});

test("falls back to /favicon.ico for a page that declares nothing", async () => {
  const remote = siteSession({
    "https://plain.test": { type: "text/html", body: "<!doctype html><title>Plain</title>" },
    "https://plain.test/favicon.ico": { type: "image/png" },
  });

  assert.equal(await siteFaviconDataUrl(remote, "https://plain.test/a/b", { scale }), PNG_DATA_URL);
});

test("asks a site once per scheme, and again after a theme change", async () => {
  const routes = {
    "https://cached.test": { type: "text/html", body: "<!doctype html><title>Cached</title>" },
    "https://cached.test/favicon.ico": { type: "image/png" },
  };
  const remote = siteSession(routes);

  assert.equal(await siteFaviconDataUrl(remote, "https://cached.test/one", { scale }), PNG_DATA_URL);
  assert.equal(await siteFaviconDataUrl(remote, "https://cached.test/two", { scale }), PNG_DATA_URL);
  const asked = remote.calls.length;
  clearFaviconCache();
  await siteFaviconDataUrl(remote, "https://cached.test/one", { scale });
  assert.equal(remote.calls.length, asked * 2);
});

test("a site that cannot be read at all is a site with no icon", async () => {
  const remote = siteSession({});

  assert.equal(await siteFaviconDataUrl(remote, "https://gone.test", { scale }), null);
  assert.equal(await siteFaviconDataUrl(remote, "not a url", { scale }), null);
});
