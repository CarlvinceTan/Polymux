import {createWriteStream} from "node:fs";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";

/**
 * A JSON API call that turns a failure into a message worth showing.
 *
 * Cloud storage APIs answer errors with a JSON envelope the user should never
 * see; what they need is the sentence inside it, which is what this digs out.
 */
export async function jsonRequest<T>(
  url: string,
  init: RequestInit,
  label: string,
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw await requestError(response, label);
  // A 204 has no body to parse, which several delete endpoints return.
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function requestError(
  response: Response,
  label: string,
): Promise<Error> {
  const body = await response.text().catch(() => "");
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as {
      error?: {message?: string} | string;
      error_description?: string;
      error_summary?: string;
      message?: string;
    };
    detail =
      (typeof parsed.error === "object" ? parsed.error?.message : parsed.error) ??
      parsed.error_description ??
      parsed.error_summary ??
      parsed.message ??
      detail;
  } catch {
    // Not JSON — the truncated body is the best description available.
  }
  return new Error(`${label} failed (${response.status}): ${detail}`);
}

/** Streams a response body to a file rather than buffering it, so a large
 * download does not have to fit in memory. */
export async function streamToFile(
  response: Response,
  destination: string,
): Promise<void> {
  if (!response.body) throw new Error("The download returned no content.");
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(destination),
  );
}
