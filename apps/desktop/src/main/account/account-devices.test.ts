import assert from "node:assert/strict";
import test from "node:test";
import type {ApiKeyCredential, CredentialStore} from "@earendil-works/pi-ai";
import type {TeamService} from "../team/service.js";
import type {TeamHostServer} from "../team/host-server.js";
import {AccountDevices} from "./account-devices.js";
import {AccountService} from "./account-service.js";

function fixture() {
  const stored = new Map<string, ApiKeyCredential>();
  const credentials = {
    async read(id: string) { return stored.get(id) ?? null; },
    async modify(id: string, update: (value: ApiKeyCredential | null) => Promise<ApiKeyCredential | null>) {
      const value = await update(stored.get(id) ?? null);
      if (value) stored.set(id, value); else stored.delete(id);
      return value;
    },
    async delete(id: string) { stored.delete(id); },
    async list() { return [...stored.keys()].map((providerId) => ({providerId, type: "api_key" as const})); },
  } as CredentialStore;
  const rows = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const failures = {withdraw: false, logout: false, register: false};
  let gate: string | null = null;
  let releaseRegistration: (() => void) | null = null;
  let holdRegistration = false;
  const session = (id: string) => ({
    access_token: `e30.${Buffer.from(JSON.stringify({sub: id, exp: Math.floor(Date.now() / 1000) + 3600})).toString("base64url")}.sig`,
    refresh_token: `refresh-${id}`, token_type: "bearer", expires_in: 3600,
    user: {id, email: `${id}@example.com`, user_metadata: {}},
  });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const authorization = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");
    const encoded = authorization?.split(".")[1];
    const user = encoded ? JSON.parse(Buffer.from(encoded, "base64url").toString()).sub as string : "";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {"Content-Type": "application/json"}});
    if (url.pathname.endsWith("/token")) {
      const id = String(body.email ?? "").split("@")[0] || String(body.refresh_token).replace("refresh-", "");
      calls.push(`auth:${id}`);
      return respond(session(id));
    }
    if (url.pathname.endsWith("/user")) return respond(session(user).user);
    if (url.pathname.endsWith("/logout")) { calls.push(`logout:${user}`); return respond(failures.logout ? {message: "offline"} : {}, failures.logout ? 503 : 200); }
    if (url.pathname.endsWith("/devices")) {
      if (init?.method === "DELETE") {
        assert.equal(url.searchParams.get("user_id"), `eq.${user}`);
        calls.push(`withdraw:${user}`);
        if (failures.withdraw) return respond({message: "registry offline"}, 503);
        rows.delete(`${user}:${url.searchParams.get("device_id")?.replace(/^eq\./, "")}`);
        return respond([]);
      }
      if (init?.method === "POST") {
        assert.equal(url.searchParams.get("on_conflict"), "user_id,device_id");
        assert.equal(body.user_id, user);
        calls.push(`register:${user}`);
        if (holdRegistration) await new Promise<void>((resolve) => { releaseRegistration = resolve; });
        if (failures.register) return respond({message: "registry offline"}, 503);
        rows.set(`${user}:${body.device_id}`, body);
        return respond([]);
      }
      assert.equal(url.searchParams.get("user_id"), `eq.${user}`);
      return respond([...rows.values()].filter((row) => row.user_id === user));
    }
    throw new Error(`Unexpected fixture request ${url.pathname}`);
  };
  let devices: AccountDevices;
  const service = new AccountService({url: "https://account.example.com", anonKey: "public", credentials, fetch: fetcher,
    openExternal: () => {}, onBeforeSessionChange: () => devices.withdraw(),
    onSignedIn: () => devices.start(), onSignedOut: () => devices.revoke(),
  });
  devices = new AccountDevices({service, credentials, appVersion: "test", onHostsChanged: () => {},
    team: {localHost: () => ({desktopId: "physical-device", hostId: "host", deviceName: "Test", deviceType: "desktop"}), hosts: (): ReturnType<TeamService["hosts"]> => []} as unknown as TeamService,
    hostServer: {
      authorizeAccountPeer: (secret: string) => { gate = secret; }, revokeAccountPeer: () => { gate = null; },
      snapshot: () => ({endpoint: "https://connect.polymux.com/host"}),
    } as unknown as TeamHostServer,
  });
  return {service, devices, rows, stored, failures, calls, gate: () => gate,
    hold() { holdRegistration = true; }, release() { holdRegistration = false; releaseRegistration?.(); },
    async close() { holdRegistration = false; releaseRegistration?.(); await devices.close(); await service.close(); },
  };
}

for (const scope of ["global", "local"] as const) {
  test(`${scope} offline sign-out clears local tokens and account pairing while the next account registers independently`, async () => {
    const f = fixture();
    try {
      await f.service.signInWithPassword("a@example.com", "password");
      await f.devices.sync();
      const outgoingSecret = f.gate();
      assert.ok(outgoingSecret);
      f.failures.withdraw = true;
      f.failures.logout = true;
      const status = await f.service.signOut(scope);
      assert.equal(status.signedIn, false);
      assert.equal(f.gate(), null);
      assert.equal(f.stored.has("polymux-account:device-pairing:a"), false);
      assert.equal(f.stored.has("polymux-account:session:a"), false);
      assert.equal((await f.service.client!.auth.getSession()).data.session, null);
      assert.equal([...f.stored.keys()].some((key) => key.startsWith("sb-") && key.endsWith("-auth-token")), false);
      await f.service.restore();
      assert.equal(f.service.status().signedIn, false);
      // Failed cloud deletion leaves A's own row intact; B must not overwrite it.
      assert.equal(f.rows.get("a:physical-device")?.pairing_secret, outgoingSecret);
      f.failures.logout = false;
      await f.service.signInWithPassword("b@example.com", "password");
      await f.devices.sync();
      assert.equal(f.service.status().profile?.userId, "b");
      assert.ok(f.gate());
      assert.notEqual(f.gate(), outgoingSecret);
      assert.equal(f.rows.get("a:physical-device")?.pairing_secret, outgoingSecret);
      assert.equal(f.rows.get("b:physical-device")?.pairing_secret, f.gate());
    } finally { await f.close(); }
  });
}

test("failed registration never opens the account pairing gate", async () => {
  const f = fixture();
  try {
    f.failures.register = true;
    await f.service.signInWithPassword("a@example.com", "password");
    await f.devices.sync();
    assert.equal(f.gate(), null);
    assert.equal(f.devices.status().registered, false);
    assert.equal(f.rows.size, 0);
  } finally { await f.close(); }
});

test("revocation fences an in-flight registration from reopening the gate", async () => {
  const f = fixture();
  try {
    f.hold();
    await f.service.signInWithPassword("a@example.com", "password");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(f.calls.includes("register:a"));
    const signOut = f.service.signOut();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.gate(), null);
    f.release();
    await signOut;
    assert.equal(f.gate(), null);
    assert.equal(f.stored.has("polymux-account:device-pairing:a"), false);
    assert.equal(f.service.status().signedIn, false);
    assert.equal(f.rows.size, 0);
  } finally { await f.close(); }
});

test("replacement remains blocked when outgoing withdrawal fails, without switching credentials", async () => {
  const f = fixture();
  try {
    await f.service.signInWithPassword("a@example.com", "password");
    await f.devices.sync();
    const oldSecret = f.gate();
    f.failures.withdraw = true;
    await assert.rejects(f.service.signInWithPassword("b@example.com", "password"), /withdrawal failed/);
    await f.devices.sync();
    assert.equal(f.service.status().profile?.userId, "a");
    assert.equal(f.calls.includes("auth:b"), false);
    assert.ok(f.gate());
    assert.notEqual(f.gate(), oldSecret);
    assert.equal(f.rows.get("a:physical-device")?.pairing_secret, f.gate());
  } finally { await f.close(); }
});
