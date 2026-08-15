import assert from "node:assert/strict";
import {createServer, type Server} from "node:http";
import {mkdir, mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {MatrixHub, provisioningSecret} from "../communications/hub.js";

interface Recorded {
  method: string;
  path: string;
  query: Record<string, string>;
  auth: string | null;
  body: unknown;
}

interface Route {
  status?: number;
  body: unknown;
}

async function withHub(
  routes: Record<string, Route>,
  body: (hub: MatrixHub, calls: Recorded[]) => Promise<void>,
  auth: {matrixToken: string | null; userId: string | null} = {
    matrixToken: "syt_token",
    userId: "@me:local",
  },
  directory: string | null = null,
): Promise<void> {
  const calls: Recorded[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const raw = Buffer.concat(chunks).toString("utf8");
      calls.push({
        method: request.method ?? "GET",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        auth: request.headers.authorization ?? null,
        body: raw ? JSON.parse(raw) : undefined,
      });
      const route = routes[`${request.method} ${url.pathname}`];
      const status = route?.status ?? (route ? 200 : 404);
      response.writeHead(status, {"Content-Type": "application/json"});
      response.end(
        JSON.stringify(route?.body ?? {errcode: "M_NOT_FOUND", error: "Not found"}),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as {port: number}).port;
  try {
    await body(
      new MatrixHub({
        baseUrl: `http://127.0.0.1:${port}`,
        homeserverUrl: `http://127.0.0.1:${port}`,
        directory,
        auth: () => auth,
      }),
      calls,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const WA = "/bridges/whatsapp/_matrix/provision/v3";

test("reports a linked bridge account from whoami", async () => {
  await withHub(
    {
      [`GET ${WA}/whoami`]: {
        body: {
          network: {displayname: "WhatsApp"},
          management_room: "!admin:local",
          login_flows: [
            {id: "qr", name: "QR", description: "Scan a QR code"},
            {id: "phone", name: "Pairing code", description: "Use a phone number"},
          ],
          logins: [
            {
              id: "wa-1",
              name: "fallback",
              profile: {phone: "+61400000000"},
              state: {state_event: "CONNECTED"},
            },
          ],
        },
      },
    },
    async (hub, calls) => {
      const bridge = await hub.bridge("whatsapp", "WhatsApp", "whatsapp");
      assert.equal(bridge.api, "bridgev2");
      assert.equal(bridge.state, "connected");
      assert.equal(bridge.accounts.length, 1);
      // The remote profile is a better label than the login's own name.
      assert.equal(bridge.accounts[0].name, "+61400000000");
      assert.equal(bridge.managementRoomHint, "!admin:local");
      assert.deepEqual(
        bridge.flows.map((flow) => flow.id),
        ["qr", "phone"],
      );
      // whoami carries the flows, so no second request should be made.
      assert.equal(calls.length, 1);
      assert.equal(calls[0].auth, "Bearer syt_token");
      // Matrix-token auth is still validated against this user, so the query
      // parameter is mandatory in both auth modes.
      assert.equal(calls[0].query.user_id, "@me:local");
    },
  );
});

test("surfaces a credential failure as an actionable account state", async () => {
  await withHub(
    {
      [`GET ${WA}/whoami`]: {
        body: {
          logins: [
            {
              id: "wa-1",
              name: "+61400000000",
              state: {
                state_event: "BAD_CREDENTIALS",
                error: "wa-connection-failed",
                message: "You were logged out of WhatsApp on your phone.",
              },
            },
          ],
        },
      },
    },
    async (hub) => {
      const bridge = await hub.bridge("whatsapp", "WhatsApp", "whatsapp");
      assert.equal(bridge.state, "error");
      assert.equal(bridge.accounts[0].state, "bad-credentials");
      // The human-readable message wins over the error code.
      assert.equal(bridge.accounts[0].error, "You were logged out of WhatsApp on your phone.");
    },
  );
});

test("treats an empty login list as not linked", async () => {
  await withHub({[`GET ${WA}/whoami`]: {body: {logins: []}}}, async (hub) => {
    const bridge = await hub.bridge("whatsapp", "WhatsApp", "whatsapp");
    assert.equal(bridge.state, "logged-out");
  });
});

test("a platform with no bridge route is reported as local only", async () => {
  await withHub({}, async (hub, calls) => {
    const bridge = await hub.bridge("imessage", "iMessage", null);
    assert.equal(bridge.state, "unavailable");
    assert.equal(bridge.api, "none");
    assert.match(bridge.error ?? "", /local relay/);
    assert.equal(calls.length, 0, "a routeless platform must not be probed");
  });
});

test("an unreachable bridge degrades to a row instead of throwing", async () => {
  await withHub({[`GET ${WA}/whoami`]: {status: 502, body: {error: "bad gateway"}}}, async (hub) => {
    const bridge = await hub.bridge("whatsapp", "WhatsApp", "whatsapp");
    assert.equal(bridge.state, "unreachable");
    assert.equal(bridge.error, "bad gateway");
  });
});

test("parses a QR step and carries the login id forward", async () => {
  await withHub(
    {
      [`POST ${WA}/login/start/qr`]: {
        body: {
          login_id: "login-42",
          type: "display_and_wait",
          step_id: "qr-step",
          instructions: "Scan this from WhatsApp on your phone.",
          display_and_wait: {type: "qr", data: "2@abc/def"},
        },
      },
    },
    async (hub, calls) => {
      const step = await hub.loginStart("whatsapp", "qr");
      assert.equal(step.type, "display_and_wait");
      if (step.type !== "display_and_wait") return;
      assert.equal(step.loginId, "login-42");
      assert.equal(step.stepId, "qr-step");
      assert.equal(step.display, "qr");
      assert.equal(step.data, "2@abc/def");
      assert.equal(step.instructions, "Scan this from WhatsApp on your phone.");
      assert.equal(calls[0].method, "POST");
    },
  );
});

test("refuses a login start that returns no login id", async () => {
  await withHub(
    {
      [`POST ${WA}/login/start/qr`]: {
        body: {type: "display_and_wait", step_id: "qr", display_and_wait: {type: "qr", data: "x"}},
      },
    },
    async (hub) => {
      // Without a login id every later step is unaddressable, so failing loudly
      // beats stranding the user mid-flow.
      await assert.rejects(hub.loginStart("whatsapp", "qr"), /login id/);
    },
  );
});

test("waits on a display step at the display_and_wait path", async () => {
  await withHub(
    {
      [`POST ${WA}/login/step/login-42/qr-step/display_and_wait`]: {
        body: {
          login_id: "login-42",
          type: "complete",
          step_id: "done",
          complete: {user_login_id: "wa-1"},
        },
      },
    },
    async (hub, calls) => {
      const step = await hub.loginWait("whatsapp", "login-42", "qr-step");
      assert.equal(step.type, "complete");
      if (step.type !== "complete") return;
      assert.equal(step.accountId, "wa-1");
      assert.equal(calls[0].path, `${WA}/login/step/login-42/qr-step/display_and_wait`);
    },
  );
});

test("submits user input as a flat field map", async () => {
  await withHub(
    {
      [`POST ${WA}/login/step/login-42/phone/user_input`]: {
        body: {
          login_id: "login-42",
          type: "user_input",
          step_id: "code",
          user_input: {
            fields: [
              {
                type: "2fa_code",
                id: "code",
                name: "Pairing code",
                description: "Enter the code shown on your phone",
                pattern: "^[0-9]{6}$",
              },
            ],
          },
        },
      },
    },
    async (hub, calls) => {
      const step = await hub.loginSubmit("whatsapp", "login-42", "phone", "user_input", {
        phone: "+61400000000",
      });
      assert.deepEqual(calls[0].body, {phone: "+61400000000"});
      assert.equal(step.type, "user_input");
      if (step.type !== "user_input") return;
      assert.equal(step.fields[0].type, "2fa_code");
      assert.equal(step.fields[0].pattern, "^[0-9]{6}$");
      assert.equal(step.fields[0].description, "Enter the code shown on your phone");
    },
  );
});

test("parses a cookie step's page and the values it needs collected", async () => {
  await withHub(
    {
      [`POST ${WA}/login/start/messenger`]: {
        body: {
          login_id: "login-9",
          type: "cookies",
          step_id: "cookies",
          cookies: {
            url: "https://www.messenger.com/",
            user_agent: "Mozilla/5.0 test",
            wait_for_url_pattern: "^https://www\\.messenger\\.com/t/",
            fields: [
              {id: "c_user", required: true, sources: [{type: "cookie", name: "c_user"}]},
              {id: "xs", required: true, sources: [{type: "cookie", name: "xs"}]},
              {
                id: "device_id",
                required: false,
                sources: [{type: "local_storage", name: "device_id"}],
              },
            ],
          },
        },
      },
    },
    async (hub) => {
      const step = await hub.loginStart("whatsapp", "messenger");
      assert.equal(step.type, "cookies");
      if (step.type !== "cookies") return;
      assert.equal(step.url, "https://www.messenger.com/");
      assert.equal(step.userAgent, "Mozilla/5.0 test");
      assert.equal(step.waitForUrl, "^https://www\\.messenger\\.com/t/");
      assert.deepEqual(step.fields, [
        {source: "cookie", id: "c_user", required: true},
        {source: "cookie", id: "xs", required: true},
        {source: "local_storage", id: "device_id", required: false},
      ]);
    },
  );
});

test("rejects a step type the app cannot render", async () => {
  await withHub(
    {
      [`POST ${WA}/login/start/qr`]: {
        body: {login_id: "l", type: "webauthn", step_id: "w", webauthn: {}},
      },
    },
    async (hub) => {
      await assert.rejects(hub.loginStart("whatsapp", "qr"), /unsupported login step/);
    },
  );
});

test("cancels at the login/cancel path", async () => {
  await withHub({[`POST ${WA}/login/cancel/login-42`]: {body: {}}}, async (hub, calls) => {
    await hub.loginCancel("whatsapp", "login-42");
    assert.equal(calls[0].path, `${WA}/login/cancel/login-42`);
  });
});

test("logs a bridgev2 account out by its login id", async () => {
  await withHub({[`POST ${WA}/logout/wa-1`]: {body: {}}}, async (hub, calls) => {
    await hub.logout("whatsapp", "wa-1", "bridgev2");
    assert.equal(calls[0].path, `${WA}/logout/wa-1`);
    assert.equal(calls[0].method, "POST");
  });
});

/**
 * The legacy API accepts only its own shared secret, which lives in the
 * bridge's config file, so a legacy bridge exercises the on-disk secret path.
 */
async function legacyHubDirectory(secret: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "midas-hub-"));
  await mkdir(path.join(directory, "bridges", "discord"), {recursive: true});
  await writeFile(
    path.join(directory, "bridges", "discord", "config.yaml"),
    [
      "appservice:",
      "    id: discord",
      "provisioning:",
      "    prefix: /_matrix/provision",
      `    shared_secret: ${secret}`,
      "    allow_matrix_auth: true",
      "encryption:",
      "    allow: false",
      "",
    ].join("\n"),
    "utf8",
  );
  return directory;
}

test("falls back to the legacy API when v3 is absent", async () => {
  const legacy = "/bridges/discord/_matrix/provision/v1";
  const directory = await legacyHubDirectory("a-secret-at-least-16-chars");
  await withHub(
    {
      "GET /bridges/discord/_matrix/provision/v3/whoami": {
        status: 404,
        body: {errcode: "M_NOT_FOUND", error: "Not found"},
      },
      [`GET ${legacy}/ping`]: {
        body: {
          // mautrix-discord serialises this key capitalised.
          Discord: {id: "12345", logged_in: true, connected: true},
          management_room: "!discord:local",
        },
      },
    },
    async (hub, calls) => {
      const bridge = await hub.bridge("discord", "Discord", "discord");
      assert.equal(bridge.api, "legacy");
      assert.equal(bridge.state, "connected");
      assert.equal(bridge.accounts[0].id, "12345");
      assert.equal(bridge.managementRoomHint, "!discord:local");
      // A linked legacy bridge offers nothing more to do.
      assert.deepEqual(bridge.flows, []);
      // The legacy call authenticates with the secret read from the config,
      // never with the Matrix token, which it does not understand.
      const ping = calls.find((call) => call.path.endsWith("/v1/ping"));
      assert.equal(ping?.auth, "Bearer a-secret-at-least-16-chars");
      assert.equal(ping?.query.user_id, "@me:local");
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("offers a token flow for an unlinked legacy bridge", async () => {
  const legacy = "/bridges/discord/_matrix/provision/v1";
  const directory = await legacyHubDirectory("another-secret-16-chars");
  await withHub(
    {
      "GET /bridges/discord/_matrix/provision/v3/whoami": {
        status: 404,
        body: {errcode: "M_NOT_FOUND"},
      },
      [`GET ${legacy}/ping`]: {body: {Discord: {logged_in: false, connected: false}}},
    },
    async (hub) => {
      const bridge = await hub.bridge("discord", "Discord", "discord");
      assert.equal(bridge.state, "logged-out");
      assert.deepEqual(
        bridge.flows.map((flow) => flow.id),
        ["token"],
      );
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("reports a legacy bridge as unreachable when its secret cannot be read", async () => {
  await withHub(
    {
      "GET /bridges/discord/_matrix/provision/v3/whoami": {
        status: 404,
        body: {errcode: "M_NOT_FOUND"},
      },
    },
    async (hub) => {
      const bridge = await hub.bridge("discord", "Discord", "discord");
      assert.equal(bridge.api, "legacy");
      assert.equal(bridge.state, "unreachable");
      assert.match(bridge.error ?? "", /provisioning secret/);
    },
    {matrixToken: "syt_token", userId: "@me:local"},
  );
});

test("will not touch a bridge before the app is signed in", async () => {
  await withHub(
    {[`GET ${WA}/whoami`]: {body: {logins: []}}},
    async (hub, calls) => {
      const bridge = await hub.bridge("whatsapp", "WhatsApp", "whatsapp");
      assert.equal(bridge.state, "unreachable");
      assert.match(bridge.error ?? "", /Sign in/);
      assert.equal(calls.length, 0, "no request should be sent without a user id");
    },
    {matrixToken: null, userId: null},
  );
});

test("signs in and returns the token the homeserver issued", async () => {
  await withHub(
    {
      "POST /_matrix/client/v3/login": {
        body: {user_id: "@me:local", access_token: "syt_new"},
      },
    },
    async (hub, calls) => {
      const result = await hub.signIn("@me:local", "hunter2");
      assert.deepEqual(result, {userId: "@me:local", accessToken: "syt_new"});
      const body = calls[0].body as Record<string, unknown>;
      assert.equal(body.type, "m.login.password");
      // The homeserver wants the localpart, not the full Matrix ID.
      assert.deepEqual(body.identifier, {type: "m.id.user", user: "me"});
    },
    {matrixToken: null, userId: null},
  );
});

test("sends a message with an idempotent transaction id", async () => {
  const sent: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      sent.push(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      response.writeHead(200, {"Content-Type": "application/json"});
      response.end(JSON.stringify({event_id: "$evt"}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as {port: number}).port;
  try {
    const hub = new MatrixHub({
      baseUrl: `http://127.0.0.1:${port}`,
      homeserverUrl: `http://127.0.0.1:${port}`,
      directory: null,
      auth: () => ({matrixToken: "syt_token", userId: "@me:local"}),
    });
    assert.equal(await hub.send("!room:local", "hello"), "$evt");
    assert.match(sent[0], /^\/_matrix\/client\/v3\/rooms\/!room%3Alocal\/send\/m\.room\.message\/midas-/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("refuses Matrix calls when the app holds no token", async () => {
  await withHub(
    {},
    async (hub) => {
      await assert.rejects(hub.send("!room:local", "hi"), /not signed in/);
    },
    {matrixToken: null, userId: "@me:local"},
  );
});

/**
 * Both config generations keep the provisioning secret in a different place,
 * and the fleet runs one of each. Reading only the modern layout left Discord
 * reporting that its login could not be driven from here while its secret sat
 * in the file.
 */
test("the provisioning secret is found in either config layout", () => {
  const modern = [
    "provisioning:",
    "    shared_secret: modern-secret",
    "    allow_matrix_auth: true",
    "",
  ].join("\n");
  assert.equal(provisioningSecret(modern), "modern-secret");

  // Pre-megabridge: nested under `bridge:`, with the comments the binary
  // writes back when it upgrades the file in place.
  const legacy = [
    "bridge:",
    "    provisioning:",
    "        # Prefix for the provisioning API paths.",
    "        prefix: /_matrix/provision",
    "        shared_secret: legacy-secret",
    "        debug_endpoints: false",
    "    permissions:",
    '        "midas.local": user',
    "",
  ].join("\n");
  assert.equal(provisioningSecret(legacy), "legacy-secret");

  assert.equal(
    provisioningSecret(["bridge:", "    permissions:", "        a: user", ""].join("\n")),
    null,
    "a config with no provisioning block at all has no secret to find",
  );
  assert.equal(
    provisioningSecret(["provisioning:", "", "encryption:", "    shared_secret: nope", ""].join("\n")),
    null,
    "and the search stops at the end of the block rather than running on",
  );
});
