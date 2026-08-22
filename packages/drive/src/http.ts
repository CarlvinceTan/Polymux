/**
 * Statuses that mean "the provider did not do the thing, ask again".
 *
 * 429 and 503 are the ones a working connection actually meets: every provider
 * here rate-limits, and Drive and Graph both document exponential backoff as
 * the expected client behaviour rather than as a courtesy.
 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** How many times one request is sent before the failure reaches the user. */
const DEFAULT_ATTEMPTS = 5;
/**
 * How long to wait for response *headers*. It deliberately does not bound the
 * body: a download of a large file is slow on purpose, and a deadline that
 * covered the whole transfer would cancel exactly the uploads worth keeping.
 */
const DEFAULT_TIMEOUT_MS = 60_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 20_000;
/**
 * The longest `Retry-After` worth honouring. A provider asking for more than a
 * minute is rate-limiting by the hour — sleeping on it would look like a hang,
 * so the failure goes to the user instead, who can try again later.
 */
const MAX_RETRY_AFTER_MS = 60_000;

/** A failed request, carrying what the provider said for the retry policy to
 * read without consuming the body twice. */
export class DriveRequestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, label: string) {
    super(`${label} failed (${status}): ${describe(body)}`);
    this.name = "DriveRequestError";
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  timeoutMs?: number;
  /** Deadline for small response bodies such as JSON error envelopes. */
  bodyTimeoutMs?: number;
  /**
   * Statuses outside 2xx that are an answer rather than a failure, returned
   * with the body unread. A resumable upload needs 308 this way: it is how
   * Drive reports progress, and its `Range` header is the only authority on
   * what the server actually holds.
   */
  accept?: number[];
  /**
   * Provider hook for a retryable condition the status alone does not show —
   * Drive reports rate limiting as a 403 with a reason inside the body, which
   * is indistinguishable from a permission failure without reading it.
   */
  retryable?: (status: number, body: string) => boolean;
  /**
   * Provider hook for a wait the provider states somewhere other than
   * `Retry-After`, in seconds. Dropbox puts it in the JSON error.
   */
  retryAfter?: (status: number, body: string) => number | null;
  signal?: AbortSignal;
  /** Seams for tests: a fake transport, a clock that does not really wait, and
   * pinned jitter. Nothing in the app passes these. */
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/**
 * One HTTP call to a provider, with the timeout and the retry policy every
 * adapter should have and none of them should write again.
 *
 * A returned response is always `ok` and always has its body unread. A failure
 * throws `DriveRequestError` with the body already drained, so callers never
 * have to decide who consumes it.
 */
export async function request(
  url: string,
  init: RequestInit,
  label: string,
  options: RequestOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const send = options.fetch ?? ((input, request) => fetch(input, request));
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let failure: Error | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const last = attempt === attempts - 1;
    let wait: number | null = null;

    try {
      const response = await withTimeout(
        (signal) => send(url, { ...init, signal }),
        timeoutMs,
        options.signal,
      );
      if (response.ok || options.accept?.includes(response.status))
        return response;

      const body = await response.text().catch(() => "");
      failure = new DriveRequestError(response.status, body, label);
      if (last) break;
      const retryable =
        RETRYABLE_STATUS.has(response.status) ||
        (options.retryable?.(response.status, body) ?? false);
      if (!retryable) break;
      wait =
        headerDelayMs(response.headers.get("retry-after")) ??
        secondsToMs(options.retryAfter?.(response.status, body));
      // A provider that names a wait longer than the cap is not going to be
      // ready within a retry loop's lifetime.
      if (wait !== null && wait > MAX_RETRY_AFTER_MS) break;
    } catch (cause) {
      // A transport failure — DNS, a dropped connection, the timeout above.
      // The request never reached the provider, or its answer never arrived,
      // which is the case retrying exists for.
      if (options.signal?.aborted) throw cause;
      failure =
        cause instanceof Error
          ? cause
          : new Error(`${label} failed: ${String(cause)}`);
      if (last) break;
    }

    await sleep(wait ?? backoffMs(attempt, random));
  }

  throw failure ?? new Error(`${label} failed.`);
}

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
  options?: RequestOptions,
): Promise<T> {
  const response = await request(url, init, label, options);
  // A 204 has no body to parse, which several delete endpoints return.
  if (response.status === 204) return undefined as T;
  const text = await responseText(
    response,
    options?.bodyTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    label,
  );
  return (text ? JSON.parse(text) : undefined) as T;
}

async function responseText(
  response: Response,
  timeoutMs: number,
  label: string,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      response.text(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          void response.body?.cancel().catch(() => {});
          reject(new Error(`${label} response timed out.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function requestError(
  response: Response,
  label: string,
): Promise<Error> {
  const body = await response.text().catch(() => "");
  return new DriveRequestError(response.status, body, label);
}

/**
 * Runs one attempt under a deadline that is cancelled the moment the response
 * headers arrive, so a slow body is never mistaken for a stalled request.
 */
async function withTimeout(
  attempt: (signal: AbortSignal) => Promise<Response>,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const abort = (): void => controller.abort(outer?.reason);
  if (outer?.aborted) abort();
  outer?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("The request timed out.")),
    timeoutMs,
  );
  try {
    return await attempt(controller.signal);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", abort);
  }
}

/** Exponential backoff with full jitter: spreading the retries is what keeps
 * a batch of parallel calls from marching back in step and re-rating-limiting
 * itself. */
function backoffMs(attempt: number, random: () => number): number {
  return Math.round(
    random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt),
  );
}

/** `Retry-After` is either delta-seconds or an HTTP date; both are in use. */
function headerDelayMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(value);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
}

function secondsToMs(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value * 1000)
    : null;
}

/** The sentence inside a provider's error envelope, or the raw body when it
 * has none. */
function describe(body: string): string {
  const fallback = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
      error_description?: string;
      error_summary?: string;
      message?: string;
    };
    return (
      (typeof parsed.error === "object"
        ? parsed.error?.message
        : parsed.error) ??
      parsed.error_description ??
      parsed.error_summary ??
      parsed.message ??
      fallback
    );
  } catch {
    // Not JSON — the truncated body is the best description available.
    return fallback;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
