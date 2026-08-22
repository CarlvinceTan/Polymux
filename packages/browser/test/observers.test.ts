import assert from "node:assert/strict";
import test from "node:test";
import { PageObservers } from "../src/observers.js";

test("a redirect reuses its request row for the final destination", async () => {
  const listeners = new Map<string, (params: any) => void>();
  const observers = new PageObservers({
    enableDomain: async () => {},
    onEvent: (method: string, listener: (params: any) => void) => {
      listeners.set(method, listener);
      return () => listeners.delete(method);
    },
    send: async () => ({}),
  });
  await observers.start();

  listeners.get("Network.requestWillBeSent")?.({
    requestId: "r1",
    request: {url: "https://example.test/old", method: "GET"},
    type: "Document",
  });
  listeners.get("Network.requestWillBeSent")?.({
    requestId: "r1",
    request: {url: "https://example.test/new", method: "GET"},
    type: "Document",
    redirectResponse: {status: 302},
  });
  listeners.get("Network.responseReceived")?.({
    requestId: "r1",
    response: {status: 200, mimeType: "text/html"},
    type: "Document",
  });

  assert.deepEqual(observers.requests, [{
    id: "r1",
    url: "https://example.test/new",
    method: "GET",
    type: "Document",
    status: 200,
    mimeType: "text/html",
  }]);
  observers.stop();
});
