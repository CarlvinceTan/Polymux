import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchReleaseBuffer,
  fetchReleaseResource,
} from "./release-fetch.mjs";

function response({body, headers = new Map(), ok = true, status = 200, ...methods}) {
  return {
    ...methods,
    body,
    headers: {get: (name) => headers.get(name.toLowerCase()) ?? null},
    ok,
    status,
  };
}

test("retries transient responses, cancels their bodies, and honors Retry-After", async () => {
  let calls = 0;
  let cancelled = 0;
  const delays = [];
  const result = await fetchReleaseResource("https://example.invalid/asset", {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1)
        return response({
          body: {cancel: async () => { cancelled += 1; }},
          headers: new Map([["retry-after", "2"]]),
          ok: false,
          status: 429,
        });
      return response({status: 200});
    },
    sleep: async (delay) => { delays.push(delay); },
  });
  assert.equal(result.response.status, 200);
  assert.equal(calls, 2);
  assert.equal(cancelled, 1);
  assert.deepEqual(delays, [2_000]);
});

test("retries network and response-body failures inside one bounded operation", async () => {
  let calls = 0;
  const delays = [];
  const body = await fetchReleaseBuffer("https://example.invalid/asset", {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("network reset");
      if (calls === 2)
        return response({
          body: {cancel: async () => undefined},
          arrayBuffer: async () => { throw new Error("stream reset"); },
        });
      return response({
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
      });
    },
    sleep: async (delay) => { delays.push(delay); },
  });
  assert.deepEqual(body.body, Buffer.from([1, 2, 3]));
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 500]);
});

test("returns the final transient response and exhausts repeated body failures", async () => {
  let statusCalls = 0;
  const final = await fetchReleaseResource("https://example.invalid/status", {
    attempts: 2,
    fetchImpl: async () => {
      statusCalls += 1;
      return response({ok: false, status: 504});
    },
    sleep: async () => undefined,
  });
  assert.equal(final.response.status, 504);
  assert.equal(statusCalls, 2);

  await assert.rejects(
    fetchReleaseBuffer("https://example.invalid/body", {
      attempts: 2,
      fetchImpl: async () => response({
        arrayBuffer: async () => { throw new Error("truncated"); },
      }),
      sleep: async () => undefined,
    }),
    /truncated/,
  );
});
