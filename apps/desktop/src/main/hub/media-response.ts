export interface MediaAuth {
  homeserverUrl: string;
  token: string;
}

export interface MediaRequest {
  url: string;
  headers: {get(name: string): string | null};
}

export type FetchMedia = (
  url: string,
  init: {headers: Record<string, string>},
) => Promise<Response>;

/**
 * Resolves one renderer-facing media request to the authenticated Matrix
 * endpoint. A media element reads and seeks with byte ranges, so its Range
 * header must survive this hop exactly; dropping it lets the first fragment
 * play and makes the next read look like a corrupt stream.
 */
export async function mediaResponse(
  auth: MediaAuth,
  request: MediaRequest,
  fetchMedia: FetchMedia,
  warn: (message: string) => void = console.warn,
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return new Response("Bad media url", {status: 400});
  }
  // `host` is the media's origin server; the path carries its id.
  const server = url.host;
  const mediaId = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!server || !mediaId) return new Response("Bad media url", {status: 400});

  const target = new URL(
    `/_matrix/client/v1/media/download/${encodeURIComponent(server)}/${encodeURIComponent(mediaId)}`,
    auth.homeserverUrl,
  );
  const range = request.headers.get("Range");
  try {
    const response = await fetchMedia(target.toString(), {
      headers: {
        Authorization: `Bearer ${auth.token}`,
        ...(range ? {Range: range} : {}),
      },
    });
    if (!response.ok)
      warn(
        `[media] ${response.status} for mxc://${server}/${mediaId} — the homeserver does not hold this media`,
      );
    return response;
  } catch (cause) {
    return new Response(cause instanceof Error ? cause.message : "Media fetch failed", {
      status: 502,
    });
  }
}
