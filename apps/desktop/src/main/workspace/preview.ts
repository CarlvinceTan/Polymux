import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A file the agent produced lives on disk, and the renderer cannot load it:
 * the window is served over http in development and a page may not reach
 * `file://` at all. Handing the path to an `<img>` or `<video>` therefore
 * fails in exactly the case that matters — a rendered page image or a clip
 * sitting beside the deliverable it came from.
 *
 * So the renderer is handed `flareai-preview://<token>/<name>` instead, and
 * this handler streams the bytes on its behalf. Streaming rather than inlining
 * matters for video, where a data: uri would mean holding the whole file in
 * the page — the same reason `flareai-media://` streams.
 *
 * The token is the point. Nothing in the url says which file it is, and only
 * the main process mints one, so a page cannot ask for a path it was never
 * given. That is deliberately the same boundary the browser tool draws when it
 * refuses a `file://` url outright: reaching the disk stays the host's to
 * decide, never the page's or the agent's to spell.
 */
export const PREVIEW_SCHEME = "flareai-preview";

/**
 * Registered before `app.whenReady`: a scheme the renderer treats as ordinary
 * media has to be privileged before any window exists, or `<video>` refuses to
 * seek within it.
 */
export const PREVIEW_PRIVILEGES = {
  stream: true,
  supportFetchAPI: true,
  secure: true,
} as const;

/**
 * What the renderer is currently allowed to read, each folder behind a token it
 * cannot guess.
 *
 * A token stands for the *folder* a granted file sits in, not the file alone,
 * and the url names the file within it. That is what lets a page be opened at
 * all: an HTML file whose stylesheet and images sit beside it asks for them
 * relative to itself, and a token that meant one file would answer 404 to
 * every one of them. The folder is the smallest unit that keeps a document
 * whole, and it is still only the folder the user opened something from —
 * never a parent, and never the disk.
 *
 * A folder granted twice keeps its first token, so reopening a tab does not
 * accumulate grants and a url already on screen stays valid.
 */
export class PreviewGrants {
  readonly #folderByToken = new Map<string, string>();
  readonly #tokenByFolder = new Map<string, string>();

  /** Grants access to one file's folder and returns the url that serves it. */
  url(target: string): string {
    const file = path.resolve(target);
    const folder = path.dirname(file);
    let token = this.#tokenByFolder.get(folder);
    if (!token) {
      token = randomUUID();
      this.#tokenByFolder.set(folder, token);
      this.#folderByToken.set(token, folder);
    }
    // The name rides along so the view can tell a clip from a still, and so a
    // devtools network row says which file it is.
    return `${PREVIEW_SCHEME}://${token}/${encodeURIComponent(path.basename(file))}`;
  }

  /**
   * The file a token and a path within it stand for, or nothing.
   *
   * The containment check is the whole point of resolving here rather than
   * joining at the call site: `..` in a url is not always collapsed for us, so
   * a page served from a granted folder could otherwise walk out of it and
   * read anything the app can.
   */
  resolve(token: string, within = ""): string | undefined {
    const folder = this.#folderByToken.get(token);
    if (!folder) return undefined;
    const target = path.resolve(folder, decodeURIComponent(within).replace(/^\/+/, ""));
    if (target !== folder && !target.startsWith(folder + path.sep)) return undefined;
    return target;
  }
}

/**
 * What a request for `flareai-preview://…` resolves to: the file on disk, or
 * nothing at all when the token was never minted here.
 */
export function previewTarget(grants: PreviewGrants, url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return grants.resolve(parsed.host, parsed.pathname);
  } catch {
    return undefined;
  }
}

/** Just enough of a request to answer one, so the rule can be tested without
 * standing up a protocol handler. */
export interface PreviewRequest {
  url: string;
  headers: {get(name: string): string | null};
}

/** Reads the bytes; `net.fetch` in the app, a stub under test. */
export type FetchFile = (
  url: string,
  init?: {headers?: Record<string, string>},
) => Promise<Response>;

/** How large the file is, which a range answer cannot be written without. */
export type SizeOf = (file: string) => Promise<number>;

/** `bytes=a-b`, `bytes=a-` and `bytes=-n`, which is what a player actually
 * sends. Anything else is not a range this answers. */
function parseRange(header: string, size: number): {start: number; end: number} | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return undefined;
  // A suffix range asks for the last n bytes, so it is measured from the end.
  const start = rawStart ? Number(rawStart) : Math.max(0, size - Number(rawEnd));
  const end = rawStart ? (rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1) : size - 1;
  if (start > end || start >= size) return undefined;
  return {start, end};
}

/**
 * Answers one preview request, and writes the range answer itself.
 *
 * Forwarding `Range` to the file handler is not enough, which a live Electron
 * check is the only way to find out: it honours the range in the *body* but
 * replies `200` with no `Content-Range` and no `Accept-Ranges`. To a media
 * element that reads as "here is the whole resource", so the bytes it gets for
 * a seek are silently the wrong ones and seeking never works. The status,
 * `Content-Range` and `Content-Length` are therefore composed here, over the
 * bytes the handler returns.
 *
 * `Accept-Ranges` rides on every answer, including the whole-file one — a
 * player asks for the file first and decides from that response whether
 * seeking is available at all.
 */
export async function previewResponse(
  grants: PreviewGrants,
  request: PreviewRequest,
  fetchFile: FetchFile,
  sizeOf: SizeOf,
): Promise<Response> {
  const file = previewTarget(grants, request.url);
  // Refused before the disk is touched: an unrecognised token is not a missing
  // file, it is a page asking for something it was never handed.
  if (!file) return new Response("Not granted", {status: 404});
  const url = pathToFileURL(file).toString();
  const asked = request.headers.get("Range");
  if (!asked) {
    const whole = await fetchFile(url);
    return withHeaders(whole, {
      "Accept-Ranges": "bytes",
      ...(await contentLength(file, sizeOf)),
    });
  }

  let size: number;
  try {
    size = await sizeOf(file);
  } catch {
    // Unknown size, so no range can be stated. The whole file is a truthful
    // answer where a made-up `Content-Range` would not be.
    const whole = await fetchFile(url);
    return withHeaders(whole, {"Accept-Ranges": "bytes"});
  }

  const range = parseRange(asked, size);
  // A range that cannot be met is refused as one, not answered with the file:
  // 416 is what tells a player to ask again differently.
  if (!range)
    return new Response(null, {
      status: 416,
      headers: {"Accept-Ranges": "bytes", "Content-Range": `bytes */${size}`},
    });

  const part = await fetchFile(url, {headers: {Range: `bytes=${range.start}-${range.end}`}});
  return new Response(part.body, {
    status: 206,
    headers: {
      ...Object.fromEntries(part.headers),
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      "Content-Length": String(range.end - range.start + 1),
    },
  });
}

/** Adds to a response without discarding what the file handler worked out —
 * its `Content-Type` is sniffed from the extension and is worth keeping. */
function withHeaders(response: Response, extra: Record<string, string>): Response {
  return new Response(response.body, {
    status: response.status,
    headers: {...Object.fromEntries(response.headers), ...extra},
  });
}

/** Absent rather than wrong when the file cannot be measured. */
async function contentLength(file: string, sizeOf: SizeOf): Promise<Record<string, string>> {
  try {
    return {"Content-Length": String(await sizeOf(file))};
  } catch {
    return {};
  }
}
