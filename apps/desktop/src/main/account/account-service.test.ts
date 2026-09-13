import assert from "node:assert/strict";
import test from "node:test";
import {AccountService} from "./account-service.js";
import type {ApiKeyCredential, CredentialStore} from "@earendil-works/pi-ai";

function memoryCredentials(): CredentialStore {
  const values = new Map<string, ApiKeyCredential>();
  return {
    async read(id) {
      return values.get(id) ?? null;
    },
    async modify(id, update) {
      const next = await update(values.get(id) ?? null);
      if (next && next.type === "api_key") values.set(id, next);
      else values.delete(id);
      return next;
    },
    async delete(id) {
      values.delete(id);
    },
    async list() {
      return [...values.keys()].map((providerId) => ({providerId, type: "api_key" as const}));
    },
  } as CredentialStore;
}

test("account sign-in is unavailable when Supabase is not configured", async () => {
  const service = new AccountService({
    url: null,
    anonKey: null,
    credentials: memoryCredentials(),
    openExternal: () => {},
    onSignedIn: () => {},
    onSignedOut: () => {},
  });

  assert.deepEqual(service.status(), {signedIn: false, available: false, profile: null, accounts: []});
  const signIn = await service.signInWithPassword("you@example.com", "secret");
  assert.equal(signIn.signedIn, false);
  assert.match(signIn.error ?? "", /not available/i);
  const signUp = await service.signUp("you@example.com", "secret");
  assert.match(signUp.error ?? "", /not available/i);
  const oauth = await service.signInWithOAuth("google");
  assert.match(oauth.error ?? "", /not available/i);
  const reset = await service.requestPasswordReset("you@example.com");
  assert.equal(reset.ok, false);
  assert.match(reset.error ?? "", /not available/i);
  const update = await service.updatePassword("secret-secret");
  assert.match(update.error ?? "", /not available/i);
});

test("sign-out of an unconfigured service stays signed out", async () => {
  const service = new AccountService({
    url: "",
    anonKey: "   ",
    credentials: memoryCredentials(),
    openExternal: () => {},
    onSignedIn: () => {},
    onSignedOut: () => {},
  });
  const status = await service.signOut();
  assert.equal(status.signedIn, false);
  assert.equal(status.available, false);
  assert.deepEqual(status.accounts, []);
});

test("switchTo is unavailable when Supabase is not configured", async () => {
  const service = new AccountService({
    url: null,
    anonKey: null,
    credentials: memoryCredentials(),
    openExternal: () => {},
    onSignedIn: () => {},
    onSignedOut: () => {},
  });
  const result = await service.switchTo("anyone");
  assert.equal(result.signedIn, false);
  assert.match(result.error ?? "", /not available/i);
});

function accountFixture() {
  const calls: string[] = [];
  let registered: string | null = null;
  const token = (id: string) => `e30.${Buffer.from(JSON.stringify({sub: id, exp: Math.floor(Date.now() / 1000) + 3600})).toString("base64url")}.sig`;
  const session = (id: string) => ({access_token: token(id), refresh_token: `refresh-${id}`, token_type: "bearer", expires_in: 3600, user: {id, email: `${id}@example.com`, user_metadata: {}}});
  let service: AccountService;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const access = headers.get("authorization")?.replace(/^Bearer /, "");
    const user = access?.split(".")[1] ? JSON.parse(Buffer.from(access.split(".")[1]!, "base64url").toString()).sub : null;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});
    if (url.pathname.endsWith("/token")) {
      const id = body.email?.split("@")[0] ?? body.refresh_token?.replace("refresh-", "");
      calls.push(`auth:${id}`);
      return response(session(id));
    }
    if (url.pathname.endsWith("/user")) return response(session(user).user);
    if (url.pathname.endsWith("/logout")) { calls.push(`logout:${user}`); return response({}); }
    if (url.pathname.endsWith("/devices")) {
      if (init?.method === "DELETE") {
        calls.push(`withdraw:${user}:${service.status().profile?.userId}`);
        if (registered && registered !== user) return response({message: "RLS ownership mismatch"}, 403);
        registered = null;
        return response([]);
      }
      if (registered && registered !== user) return response({message: "RLS ownership mismatch"}, 403);
      registered = user;
      return response([]);
    }
    throw new Error(`Unexpected account request ${url.pathname}`);
  };
  service = new AccountService({url: "https://account.example.com", anonKey: "public", credentials: memoryCredentials(), fetch: fetcher,
    openExternal: () => {}, onSignedIn: () => {}, onSignedOut: () => {},
    onBeforeSessionChange: async () => {
      const {error} = await service.client!.from("devices").delete().eq("user_id", service.status().profile!.userId);
      if (error) throw new Error(error.message);
    },
  });
  return {service, calls, owner: () => registered, register: async () => {
    const {error} = await service.client!.from("devices").upsert({device_id: "installation", user_id: service.status().profile!.userId}, {onConflict: "user_id,device_id"});
    assert.equal(error, null);
  }};
}

test("account transitions withdraw using the outgoing token before sign-out and saved switch", async () => {
  const {service, calls, register, owner} = accountFixture();
  try {
    assert.equal((await service.signInWithPassword("a@example.com", "password")).profile?.userId, "a");
    await register();
    assert.equal((await service.signInWithPassword("b@example.com", "password")).profile?.userId, "b");
    await register();
    assert.equal(owner(), "b");
    assert.ok(calls.indexOf("withdraw:a:a") < calls.indexOf("auth:b"));
    assert.equal((await service.switchTo("a")).profile?.userId, "a");
    await register();
    assert.equal(owner(), "a");
    assert.ok(calls.includes("withdraw:b:b"));
    await service.signOut();
    assert.equal(owner(), null);
    assert.equal(service.status().signedIn, false);
    assert.deepEqual(calls.slice(-2), ["withdraw:a:a", "logout:a"]);
  } finally { await service.close(); }
});

test("concurrent account mutations serialize outgoing withdrawal and incoming sign-in", async () => {
  const {service, calls, register, owner} = accountFixture();
  try {
    await service.signInWithPassword("a@example.com", "password");
    await register();
    await Promise.all([service.signOut(), service.signInWithPassword("b@example.com", "password")]);
    await register();
    assert.deepEqual(calls.slice(-3), ["withdraw:a:a", "logout:a", "auth:b"]);
    assert.equal(owner(), "b");
  } finally { await service.close(); }
});
