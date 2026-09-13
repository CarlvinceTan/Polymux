import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { HeadlessHostRuntime } from "../src/runtime.js";
import { HeadlessCredentialStore } from "../src/credentials.js";

test(
  "account password/OAuth, encrypted restore, same-account linking, and local logout use the shared Host flow",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "polymux-account-"));
    const realFetch = globalThis.fetch;
    const routes = new Map<string, string>();
    const rows = new Map<string, Record<string, any>>();
    const userId = "11111111-1111-4111-8111-111111111111";
    const email = "fixture@example.test";
    const user = {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email,
      user_metadata: { name: "Fixture" },
      app_metadata: {},
      created_at: new Date().toISOString(),
    };
    const sessions = new Map<string, string>();
    let expectedChallenge = "";
    let logoutScope = "";
    let rejectRegistry = false;
    let rejectLogout = false;
    let refreshes = 0;
    function session() {
      const jwt = [
        Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
          "base64url",
        ),
        Buffer.from(
          JSON.stringify({
            sub: userId,
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000),
            session_id: randomUUID(),
          }),
        ).toString("base64url"),
        "test-signature",
      ].join(".");
      const refresh = randomUUID();
      sessions.set(refresh, jwt);
      return {
        access_token: jwt,
        refresh_token: refresh,
        token_type: "bearer",
        expires_in: 3600,
        user,
      };
    }
    const supabase = createServer(async (request, response) => {
      const url = new URL(request.url!, "http://localhost");
      let text = "";
      for await (const chunk of request) text += chunk;
      const body = text ? JSON.parse(text) : {};
      const reply = (status: number, value: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (url.pathname === "/auth/v1/token") {
        const grant = url.searchParams.get("grant_type");
        if (
          grant === "password" &&
          (body.email !== email || body.password !== "fixture-password")
        )
          return reply(400, {
            msg: "Invalid login credentials",
            error_code: "invalid_credentials",
          });
        if (
          grant === "pkce" &&
          (body.auth_code !== "fixture-code" ||
            createHash("sha256")
              .update(body.code_verifier ?? "")
              .digest("base64url") !== expectedChallenge)
        )
          return reply(400, { msg: "Invalid code verifier" });
        if (grant === "refresh_token") {
          refreshes++;
          if (!sessions.has(body.refresh_token))
            return reply(400, { msg: "Invalid refresh token" });
        }
        return reply(200, session());
      }
      if (url.pathname === "/auth/v1/user") return reply(200, user);
      if (url.pathname === "/auth/v1/logout") {
        logoutScope = url.searchParams.get("scope") ?? "";
        return reply(rejectLogout ? 503 : 200, rejectLogout ? {message: "Auth temporarily unavailable"} : {});
      }
      if (url.pathname === "/rest/v1/devices") {
        if (rejectRegistry)
          return reply(500, { message: "Registry temporarily unavailable" });
        if (request.method === "POST") {
          assert.equal(url.searchParams.get("on_conflict"), "user_id,device_id");
          rows.set(`${body.user_id}:${body.device_id}`, body);
        }
        if (request.method === "DELETE")
          rows.delete(
            `${(url.searchParams.get("user_id") ?? "").replace(/^eq\./, "")}:${(url.searchParams.get("device_id") ?? "").replace(/^eq\./, "")}`,
          );
        return reply(200, request.method === "GET" ? [...rows.values()] : []);
      }
      reply(404, { message: "Fixture route not found" });
    });
    await new Promise<void>((resolve) =>
      supabase.listen(0, "127.0.0.1", resolve),
    );
    const address = supabase.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const options = (name: string) => ({
      dataDirectory: path.join(root, name),
      listen: "127.0.0.1",
      port: 0,
      adminSecret: "fixture-admin",
      publicEndpoint: `https://${name}.test`,
      beginPairing: false,
      account: { url, anonKey: "fixture-public-key" },
    });
    let first = new HeadlessHostRuntime(options("first"));
    const second = new HeadlessHostRuntime(options("second"));
    globalThis.fetch = (input, init) => {
      const original =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const parsed = new URL(original);
      const mapped = routes.get(parsed.origin);
      return realFetch(
        mapped ? `${mapped}${parsed.pathname}${parsed.search}` : input,
        init,
      );
    };
    const request = async (
      endpoint: string,
      value: object,
      expect = 200,
    ): Promise<any> => {
      const response = await realFetch(
        `${endpoint}/polymux-host/v1/admin/account`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer fixture-admin",
            "content-type": "application/json",
          },
          body: JSON.stringify(value),
        },
      );
      const data = (await response.json()) as any;
      assert.equal(response.status, expect, JSON.stringify(data));
      return data.result ?? data;
    };
    try {
      let a = await first.start();
      const b = await second.start();
      routes.set("https://first.test", a.localEndpoint!);
      routes.set("https://second.test", b.localEndpoint!);
      assert.equal(
        (await request(a.localEndpoint!, { action: "status" })).signedIn,
        false,
      );
      await request(
        a.localEndpoint!,
        { action: "login", provider: "email", email, password: "wrong" },
        400,
      );
      assert.equal(rows.size, 0);
      const signedIn = await request(a.localEndpoint!, {
        action: "login",
        provider: "email",
        email,
        password: "fixture-password",
      });
      assert.equal(signedIn.profile.userId, userId);
      assert.equal(signedIn.device.registered, true);
      assert.ok(!JSON.stringify(signedIn).includes("access_token"));
      await request(
        a.localEndpoint!,
        {
          action: "login",
          provider: "email",
          email,
          password: "fixture-password",
        },
        400,
      );
      const google = await request(b.localEndpoint!, {
        action: "login",
        provider: "google",
      });
      const loginUrl = new URL(google.url);
      assert.equal(loginUrl.searchParams.get("provider"), "google");
      assert.equal(
        loginUrl.searchParams.get("redirect_to"),
        "http://127.0.0.1:47667/auth/callback",
      );
      expectedChallenge = loginUrl.searchParams.get("code_challenge")!;
      assert.ok(expectedChallenge);
      await request(
        b.localEndpoint!,
        { action: "complete", id: "wrong", code: "fixture-code" },
        400,
      );
      await request(
        b.localEndpoint!,
        { action: "login", provider: "apple" },
        400,
      );
      await request(b.localEndpoint!, {
        action: "complete",
        id: google.id,
        code: "fixture-code",
      });
      assert.equal(rows.size, 2);
      assert.ok(
        second.team
          .hosts()
          .some((host) => host.hostId === first.team.localHost().hostId),
      );
      assert.ok(
        first.team
          .hosts()
          .some((host) => host.hostId === second.team.localHost().hostId),
      );
      const credentialPath = path.join(
        root,
        "first/config/account-credentials.json",
      );
      const disk = await readFile(credentialPath, "utf8");
      assert.ok(
        !disk.includes(email) &&
          !disk.includes("access_token") &&
          !disk.includes("fixture-password"),
      );
      assert.equal((await stat(credentialPath)).mode & 0o777, 0o600);
      await first.close();
      const sealed = new HeadlessCredentialStore(
        credentialPath,
        "fixture-admin",
      );
      const sessionKey = (await sealed.list()).find(
        (entry) =>
          entry.providerId.startsWith("sb-") &&
          entry.providerId.endsWith("-auth-token"),
      )?.providerId;
      assert.ok(sessionKey);
      await sealed.modify(sessionKey, async (credential) => {
        assert.ok(credential?.type === "api_key" && credential.key);
        const stored = JSON.parse(credential.key);
        stored.expires_at = Math.floor(Date.now() / 1000) - 60;
        return { type: "api_key", key: JSON.stringify(stored) };
      });
      first = new HeadlessHostRuntime(options("first"));
      a = await first.start();
      routes.set("https://first.test", a.localEndpoint!);
      assert.equal(
        (await request(a.localEndpoint!, { action: "status" })).profile.userId,
        userId,
      );
      rejectRegistry = true;
      const pending = await request(a.localEndpoint!, { action: "sync" });
      assert.equal(pending.signedIn, true);
      assert.match(pending.device.error, /Registry/);
      rejectRegistry = false;
      await request(b.localEndpoint!, { action: "logout" });
      assert.equal(logoutScope, "local");
      assert.equal(
        (await request(a.localEndpoint!, { action: "status" })).signedIn,
        true,
      );
      const apple = await request(b.localEndpoint!, {
        action: "login",
        provider: "apple",
      });
      assert.equal(new URL(apple.url).searchParams.get("provider"), "apple");
      await request(b.localEndpoint!, { action: "cancel", id: apple.id });
      await request(
        b.localEndpoint!,
        { action: "complete", id: apple.id, code: "fixture-code" },
        400,
      );
      const retry = await request(b.localEndpoint!, {
        action: "login",
        provider: "apple",
      });
      expectedChallenge = new URL(retry.url).searchParams.get(
        "code_challenge",
      )!;
      await request(b.localEndpoint!, {
        action: "complete",
        id: retry.id,
        code: "fixture-code",
      });
      await request(a.localEndpoint!, { action: "logout" });
      const staleSecret = [...rows.values()][0]?.pairing_secret;
      assert.ok(staleSecret);
      rejectRegistry = true;
      rejectLogout = true;
      const offlineLogout = await request(b.localEndpoint!, { action: "logout" });
      assert.equal(offlineLogout.signedIn, false);
      const oldPairing = await realFetch(`${b.localEndpoint}/polymux-host/v1/pair`, {
        method: "POST", headers: {"content-type": "application/json"},
        body: JSON.stringify({accountSecret: staleSecret, desktopId: "old-account-device", deviceName: "Old account"}),
      });
      assert.equal(oldPairing.status, 403);
      const signedOutCredentials = new HeadlessCredentialStore(path.join(root, "second/config/account-credentials.json"), "fixture-admin");
      assert.equal((await signedOutCredentials.list()).some((entry) => entry.providerId === `polymux-account:session:${userId}` || entry.providerId === `polymux-account:device-pairing:${userId}` || entry.providerId.endsWith("-auth-token")), false);
      rejectRegistry = false;
      rejectLogout = false;
      await request(b.localEndpoint!, {action: "login", provider: "email", email, password: "fixture-password"});
      assert.notEqual([...rows.values()][0]?.pairing_secret, staleSecret);
      await request(b.localEndpoint!, { action: "logout" });
      assert.equal(rows.size, 0);
      assert.equal(
        refreshes,
        1,
        "expired saved session refreshes once without asking for a password",
      );
    } finally {
      await first.close();
      await second.close();
      globalThis.fetch = realFetch;
      supabase.closeAllConnections();
      await new Promise<void>((resolve) => supabase.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
);
