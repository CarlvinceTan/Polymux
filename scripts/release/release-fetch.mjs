const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

const defaultSleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function retryAfterMilliseconds(response, now = Date.now()) {
  if (response.status !== 429) return undefined;
  const value = response.headers?.get?.("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

async function cancelBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    // A failed or already-consumed stream needs no further cleanup.
  }
}

/** Fetches immutable release material with bounded retries for transient HTTP,
 * network, and response-stream failures. A reader keeps body consumption in
 * the retry boundary; checksum validation remains the caller's responsibility.
 */
export async function fetchReleaseResource(
  resource,
  {
    attempts = 4,
    fetchImpl = globalThis.fetch,
    init,
    now = () => Date.now(),
    read,
    sleep = defaultSleep,
  } = {},
) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(resource, init);
      const transient = TRANSIENT_HTTP_STATUSES.has(response.status);
      if (transient && attempt < attempts - 1) {
        const delay =
          retryAfterMilliseconds(response, now()) ?? 250 * 2 ** attempt;
        await cancelBody(response);
        await sleep(delay);
        continue;
      }
      if (!read || !response.ok) return {response};
      return {response, body: await read(response)};
    } catch (error) {
      lastError = error;
      await cancelBody(response);
      if (attempt === attempts - 1) throw error;
      await sleep(250 * 2 ** attempt);
    }
  }
  throw lastError ?? new Error("release download failed after retries");
}

export async function fetchReleaseHead(resource, options = {}) {
  return (await fetchReleaseResource(resource, options)).response;
}

export async function fetchReleaseText(resource, options = {}) {
  return await fetchReleaseResource(resource, {
    ...options,
    read: (response) => response.text(),
  });
}

export async function fetchReleaseBuffer(resource, options = {}) {
  return await fetchReleaseResource(resource, {
    ...options,
    read: async (response) => Buffer.from(await response.arrayBuffer()),
  });
}
