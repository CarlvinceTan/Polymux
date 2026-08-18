import assert from "node:assert/strict";
import test from "node:test";
import {DriveRequestError, request} from "../src/http.js";

/**
 * The retry policy, which is the part of the drive that only shows itself on a
 * bad day. Every case here is one a provider actually produces: the statuses
 * come from their own error guides, and the awkward ones — a rate limit
 * dressed as a 403, a wait stated in the body — are the reason the policy
 * takes provider hooks at all.
 */

/** A transport that answers from a script and records what it was asked. */
function transport(script: (Response | Error)[]): {
  fetch: typeof globalThis.fetch;
  calls: {url: string; signal: boolean}[];
} {
  const calls: {url: string; signal: boolean}[] = [];
  let index = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({url: String(input), signal: Boolean(init?.signal)});
    const answer = script[Math.min(index, script.length - 1)];
    index += 1;
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof globalThis.fetch;
  return {fetch, calls};
}

/** A clock that records the waits instead of serving them. */
function clock(): {sleep: (ms: number) => Promise<void>; waits: number[]} {
  const waits: number[] = [];
  return {
    sleep: async (ms) => {
      waits.push(ms);
    },
    waits,
  };
}

const ok = (): Response => new Response("{}", {status: 200});
const status = (code: number, body = "", headers?: HeadersInit): Response =>
  new Response(body, {status: code, headers});

test("a request that works is sent once", async () => {
  const {fetch, calls} = transport([ok()]);
  const {waits} = clock();
  const response = await request("https://example.test/", {}, "The call", {
    fetch,
    sleep: async () => {},
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

test("a rate limit is retried, and the body is still readable afterwards", async () => {
  const {fetch, calls} = transport([status(429), ok()]);
  const {sleep, waits} = clock();
  const response = await request("https://example.test/", {}, "The call", {
    fetch,
    sleep,
    random: () => 1,
  });
  assert.equal(calls.length, 2);
  assert.equal(waits.length, 1);
  // The failed attempt's body is drained by the policy; the successful one's
  // must not be, or every caller would get an empty payload.
  assert.equal(await response.text(), "{}");
});

test("a server error is retried and a client error is not", async () => {
  for (const code of [500, 502, 503, 504, 408]) {
    const {fetch, calls} = transport([status(code), ok()]);
    await request("https://example.test/", {}, "The call", {
      fetch,
      sleep: async () => {},
    });
    assert.equal(calls.length, 2, `${code} should be retried`);
  }
  for (const code of [400, 401, 403, 404, 409]) {
    const {fetch, calls} = transport([status(code), ok()]);
    await assert.rejects(
      request("https://example.test/", {}, "The call", {
        fetch,
        sleep: async () => {},
      }),
      (error: unknown) =>
        error instanceof DriveRequestError && error.status === code,
    );
    assert.equal(calls.length, 1, `${code} should not be retried`);
  }
});

test("backoff grows with each attempt and is jittered", async () => {
  const {fetch, calls} = transport([status(503)]);
  const {sleep, waits} = clock();
  await assert.rejects(
    request("https://example.test/", {}, "The call", {
      fetch,
      sleep,
      attempts: 4,
      // Full jitter with the die pinned high: the waits are the ceiling of
      // each attempt's window, which is what makes the growth checkable.
      random: () => 1,
    }),
  );
  assert.equal(calls.length, 4);
  assert.deepEqual(waits, [500, 1000, 2000]);
});

test("a stated Retry-After is honoured instead of the backoff", async () => {
  const {fetch} = transport([status(429, "", {"retry-after": "7"}), ok()]);
  const {sleep, waits} = clock();
  await request("https://example.test/", {}, "The call", {fetch, sleep});
  assert.deepEqual(waits, [7000]);
});

test("Retry-After as an HTTP date is honoured too", async () => {
  const when = new Date(Date.now() + 4000).toUTCString();
  const {fetch} = transport([status(503, "", {"retry-after": when}), ok()]);
  const {sleep, waits} = clock();
  await request("https://example.test/", {}, "The call", {fetch, sleep});
  assert.ok(waits[0]! > 2000 && waits[0]! <= 4000, `waited ${waits[0]}`);
});

test("a wait longer than the cap fails rather than sleeping on it", async () => {
  const {fetch, calls} = transport([status(429, "", {"retry-after": "3600"})]);
  const {sleep, waits} = clock();
  await assert.rejects(
    request("https://example.test/", {}, "The call", {fetch, sleep}),
  );
  // An hour is not a retry, it is a hang; the user gets the failure now.
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
});

test("a provider hook can make a 4xx retryable", async () => {
  const body = JSON.stringify({
    error: {errors: [{reason: "userRateLimitExceeded"}]},
  });
  const {fetch, calls} = transport([status(403, body), ok()]);
  await request("https://example.test/", {}, "The call", {
    fetch,
    sleep: async () => {},
    retryable: (code, seen) =>
      code === 403 && seen.includes("userRateLimitExceeded"),
  });
  assert.equal(calls.length, 2);
});

test("a provider hook can state the wait from the body", async () => {
  const body = JSON.stringify({error: {retry_after: 3}});
  const {fetch} = transport([status(429, body), ok()]);
  const {sleep, waits} = clock();
  await request("https://example.test/", {}, "The call", {
    fetch,
    sleep,
    retryAfter: (code, seen) =>
      code === 429 ? (JSON.parse(seen) as {error: {retry_after: number}}).error.retry_after : null,
  });
  assert.deepEqual(waits, [3000]);
});

test("a dropped connection is retried", async () => {
  const {fetch, calls} = transport([new TypeError("fetch failed"), ok()]);
  await request("https://example.test/", {}, "The call", {
    fetch,
    sleep: async () => {},
  });
  assert.equal(calls.length, 2);
});

test("an accepted status is returned rather than thrown, unread", async () => {
  const {fetch} = transport([status(308, "", {range: "bytes=0-99"})]);
  const response = await request("https://example.test/", {}, "The call", {
    fetch,
    sleep: async () => {},
    accept: [308],
  });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("range"), "bytes=0-99");
});

test("the failure carries the provider's own sentence", async () => {
  const body = JSON.stringify({error: {message: "File not found: 4bc."}});
  const {fetch} = transport([status(404, body)]);
  await assert.rejects(
    request("https://example.test/", {}, "The download", {
      fetch,
      sleep: async () => {},
    }),
    (error: unknown) =>
      error instanceof DriveRequestError &&
      error.message === "The download failed (404): File not found: 4bc." &&
      error.body === body,
  );
});

test("every attempt carries a signal, so nothing can hang forever", async () => {
  const {fetch, calls} = transport([status(500), ok()]);
  await request("https://example.test/", {}, "The call", {
    fetch,
    sleep: async () => {},
  });
  assert.deepEqual(
    calls.map((call) => call.signal),
    [true, true],
  );
});

test("a slow request is abandoned once the timeout passes", async () => {
  const stalled = (async () =>
    new Promise<Response>((_resolve, reject) => {
      // A connection that accepts and then says nothing — the case a bare
      // fetch waits on indefinitely.
      setTimeout(() => reject(new Error("never answered")), 50);
    })) as unknown as typeof globalThis.fetch;
  await assert.rejects(
    request("https://example.test/", {}, "The call", {
      fetch: stalled,
      sleep: async () => {},
      attempts: 1,
      timeoutMs: 5,
    }),
  );
});

test("a caller's abort is not retried", async () => {
  const controller = new AbortController();
  const {fetch, calls} = transport([new Error("aborted")]);
  controller.abort(new Error("the user closed the drive"));
  await assert.rejects(
    request("https://example.test/", {}, "The call", {
      fetch,
      sleep: async () => {},
      signal: controller.signal,
    }),
  );
  assert.equal(calls.length, 1);
});
