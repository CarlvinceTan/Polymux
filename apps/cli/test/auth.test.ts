import assert from "node:assert/strict";
import test from "node:test";
import { authCallback } from "../src/auth.js";

test("OAuth listener binds first, accepts only callback GET, and closes after receiving a code", async () => {
  const controller = new AbortController();
  const listener = await authCallback(controller.signal, 0);
  const url = `http://127.0.0.1:${listener.port}`;
  try {
    assert.equal((await fetch(`${url}/unrelated`)).status, 404);
    assert.equal(
      (await fetch(`${url}/auth/callback`, { method: "POST" })).status,
      404,
    );
    const response = await fetch(`${url}/auth/callback?code=temporary-code`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await listener.code, "temporary-code");
    await assert.rejects(fetch(url));
  } finally {
    listener.close();
  }
});

test("OAuth denial, cancellation and timeouts release the callback listener", async () => {
  const controller = new AbortController();
  const denied = await authCallback(controller.signal, 0);
  await fetch(
    `http://127.0.0.1:${denied.port}/auth/callback?error=access_denied`,
  );
  await assert.rejects(denied.code, /access_denied/);
  const cancelled = await authCallback(controller.signal, denied.port);
  controller.abort();
  await assert.rejects(cancelled.code, /cancelled/);
  const timeout = await authCallback(
    new AbortController().signal,
    denied.port,
    10,
  );
  await assert.rejects(timeout.code, /timed out/);
});

test("an occupied callback port fails before any sign-in can start", async () => {
  const first = await authCallback(new AbortController().signal, 0);
  try {
    await assert.rejects(
      authCallback(new AbortController().signal, first.port),
      /busy/,
    );
  } finally {
    first.close();
  }
});
