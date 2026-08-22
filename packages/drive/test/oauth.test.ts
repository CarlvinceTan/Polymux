import assert from "node:assert/strict";
import test from "node:test";
import { OAuthClient, type OAuthApp } from "../src/oauth.js";
import type { DriveConsentPrompt, DriveSecretStore } from "../src/types.js";

const app: OAuthApp = {
  clientId: "client",
  clientSecret: null,
  authorizeUrl: "https://example.test/authorize",
  tokenUrl: "https://example.test/token",
  scopes: ["files"],
};

const consent: DriveConsentPrompt = {
  open: async () => {
    throw new Error("authorization is not used in refresh tests");
  },
};

function fixture(): {
  client: OAuthClient;
  stored: Map<string, string>;
  cleared: string[];
} {
  const id = "drive:google-drive:default";
  const stored = new Map([
    [
      id,
      JSON.stringify({
        accessToken: "expired",
        refreshToken: "refresh",
        expiresAt: 0,
        scope: null,
      }),
    ],
  ]);
  const cleared: string[] = [];
  const secrets: DriveSecretStore = {
    read: async (key) => stored.get(key),
    write: async (key, value) => void stored.set(key, value),
    clear: async (key) => {
      cleared.push(key);
      stored.delete(key);
    },
  };
  return {
    client: new OAuthClient("google-drive", app, secrets, consent, "default"),
    stored,
    cleared,
  };
}

test("a transient refresh failure keeps the saved connection", async () => {
  const { client, stored, cleared } = fixture();
  const before = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network unavailable");
  }) as typeof globalThis.fetch;
  try {
    await assert.rejects(client.accessToken(), /saved connection was kept/);
    assert.ok(stored.has("drive:google-drive:default"));
    assert.deepEqual(cleared, []);
  } finally {
    globalThis.fetch = before;
  }
});

test("invalid_grant clears a refresh token that cannot work again", async () => {
  const { client, stored, cleared } = fixture();
  const before = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "invalid_grant" }), {
      status: 400,
    })) as typeof globalThis.fetch;
  try {
    await assert.rejects(client.accessToken(), /Connect it again/);
    assert.equal(stored.has("drive:google-drive:default"), false);
    assert.ok(cleared.includes("drive:google-drive:default"));
  } finally {
    globalThis.fetch = before;
  }
});
