import assert from "node:assert/strict";
import {test} from "node:test";
import {
  ACCOUNT_SESSION_KEY,
  PolymuxAccountClient,
  authCodeFromUrl,
  resolveAccountConfig,
  type AccountStorage,
} from "../src/index.js";

function memoryStorage(): AccountStorage & {values: Map<string, string>} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

test('native Apple sign-in exchanges its identity token with the original nonce', async () => {
  const storage = memoryStorage();
  const client = new PolymuxAccountClient({url: 'https://example.supabase.co', anonKey: 'sb_publishable_test', storage, fetch: async (url, init) => {
    assert.equal(url, 'https://example.supabase.co/auth/v1/token?grant_type=id_token');
    assert.deepEqual(JSON.parse(String(init?.body)), {provider: 'apple', id_token: 'apple-token', nonce: 'original-nonce'});
    return Response.json({access_token: 'access', refresh_token: 'refresh', user: {id: 'owner'}});
  }});
  assert.equal((await client.signInWithAppleIdentity('apple-token', 'original-nonce')).signedIn, true);
  assert.ok(!storage.values.get(ACCOUNT_SESSION_KEY)?.includes('apple-token'));
});

test("account sign-in is unavailable without a publishable key", async () => {
  assert.equal(resolveAccountConfig({url: "https://example.supabase.co", anonKey: ""}), null);
  const client = new PolymuxAccountClient({
    url: "https://example.supabase.co",
    anonKey: "",
    storage: memoryStorage(),
  });
  assert.equal(client.available(), false);
  const result = await client.signInWithPassword("you@example.com", "secret");
  assert.equal(result.signedIn, false);
  assert.match(result.error ?? "", /not available/i);
});

test("a server-only secret key is never accepted as a publishable key", async () => {
  assert.equal(
    resolveAccountConfig({url: "https://example.supabase.co", anonKey: "sb_secret_example"}),
    null,
  );
  const client = new PolymuxAccountClient({
    url: "https://example.supabase.co",
    anonKey: "sb_secret_example",
    storage: memoryStorage(),
  });
  assert.equal(client.available(), false);
  const result = await client.signInWithPassword("you@example.com", "secret");
  assert.equal(result.signedIn, false);
  assert.match(result.error ?? "", /not available/i);
});

test("password sign-in stores a session and never puts the password in the URL", async () => {
  const storage = memoryStorage();
  const calls: Array<{url: string; body: string}> = [];
  const client = new PolymuxAccountClient({
    url: "https://example.supabase.co",
    anonKey: "anon-key",
    storage,
    fetch: async (url, init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({url: String(url), body});
      return new Response(
        JSON.stringify({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          user: {id: "user-1", email: "you@example.com", user_metadata: {full_name: "Ada"}},
        }),
        {status: 200, headers: {"content-type": "application/json"}},
      );
    },
  });
  const result = await client.signInWithPassword("you@example.com", "s3cret-password");
  assert.equal(result.signedIn, true);
  assert.equal(result.profile?.email, "you@example.com");
  assert.equal(result.profile?.userId, "user-1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/auth\/v1\/token\?grant_type=password$/);
  assert.equal(calls[0].url.includes("s3cret-password"), false);
  assert.match(calls[0].body, /"email":"you@example.com"/);
  assert.match(calls[0].body, /"password":"s3cret-password"/);
  const stored = JSON.parse(storage.values.get(ACCOUNT_SESSION_KEY) ?? "{}") as {access_token?: string};
  assert.equal(stored.access_token, "access-1");
});

test("sign-out clears the stored session even if logout fails", async () => {
  const storage = memoryStorage();
  const client = new PolymuxAccountClient({
    url: "https://example.supabase.co",
    anonKey: "anon-key",
    storage,
    fetch: async (url) => {
      if (String(url).includes("/logout")) return new Response("nope", {status: 500});
      return new Response(
        JSON.stringify({
          access_token: "access-1",
          refresh_token: "refresh-1",
          user: {id: "user-1", email: "you@example.com"},
        }),
        {status: 200, headers: {"content-type": "application/json"}},
      );
    },
  });
  await client.signInWithPassword("you@example.com", "secret");
  const status = await client.signOut();
  assert.equal(status.signedIn, false);
  assert.equal(storage.values.has(ACCOUNT_SESSION_KEY), false);
});

test("restore reloads a persisted session", async () => {
  const storage = memoryStorage();
  storage.values.set(
    ACCOUNT_SESSION_KEY,
    JSON.stringify({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {id: "user-1", email: "you@example.com"},
    }),
  );
  const client = new PolymuxAccountClient({
    url: "https://example.supabase.co",
    anonKey: "anon-key",
    storage,
    fetch: async () => new Response("{}", {status: 500}),
  });
  const status = await client.restore();
  assert.equal(status.signedIn, true);
  assert.equal(status.profile?.email, "you@example.com");
  assert.equal(await client.accessToken(), "access-1");
});

test("authCodeFromUrl reads the PKCE code from a redirect", () => {
  assert.equal(authCodeFromUrl("https://ext.chromiumapp.org/?code=abc123"), "abc123");
  assert.equal(authCodeFromUrl("not a url"), null);
});
