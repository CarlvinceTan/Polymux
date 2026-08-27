import assert from "node:assert/strict";
import {createServer, type Server} from "node:http";
import {mkdir, mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {MatrixHub, provisioningSecret} from "../src/hub.js";

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

test("incremental sync establishes a token then reports changed rooms", async () => {
  await withHub(
    {
      "GET /_matrix/client/v3/sync": {
        body: {
          next_batch: "42",
          rooms: {
            join: {
              "!chat:local": {
                timeline: {
                  events: [
                    {
                      event_id: "$message",
                      room_id: "!chat:local",
                      sender: "@whatsapp_jules:local",
                      type: "m.room.message",
                      content: {body: "hello"},
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    async (hub, calls) => {
      const initial = await hub.sync(null);
      assert.deepEqual(initial, {nextBatch: "42", activities: []});

      const incremental = await hub.sync("41");
      assert.deepEqual(incremental, {
        nextBatch: "42",
        activities: [{roomId: "!chat:local", sender: "@whatsapp_jules:local"}],
      });
      assert.deepEqual(calls[0]?.query, {timeout: "0"});
      assert.deepEqual(calls[1]?.query, {timeout: "30000", since: "41"});
    },
  );
});

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
      // Do not collapse the bridge's choices to a preferred method, even when
      // an account is already linked and this is an add-another-account flow.
      assert.deepEqual(
        bridge.flows.map((flow) => flow.id),
        ["qr", "phone"],
      );
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

test("keeps every advertised method and adds known limitation notes", async () => {
  await withHub(
    {
      [`GET ${WA}/whoami`]: {
        body: {
          login_flows: [
            {id: "phone", name: "Phone Number", description: "Phone"},
            {id: "qr", name: "QR Code", description: "QR"},
            {id: "bot", name: "Bot token", description: "Bot"},
            {id: "manual", name: "Manual", description: "Manual"},
          ],
          logins: [],
        },
      },
    },
    async (hub) => {
      const bridge = await hub.bridge("telegram", "Telegram", "whatsapp");
      assert.deepEqual(bridge.flows.map((flow) => flow.id), ["phone", "qr", "bot", "manual"]);
      assert.equal(bridge.flows[0]!.description, "Phone");
      assert.match(bridge.flows[2]!.description, /Bots only/);
      assert.match(bridge.flows[3]!.description, /Advanced/);
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

test("treats a WhatsApp device removed on the phone as unlinked", async () => {
  await withHub(
    {
      [`GET ${WA}/whoami`]: {
        body: {
          login_flows: [{id: "qr", name: "QR", description: "Scan a QR code"}],
          logins: [
            {
              id: "61400000000",
              name: "+61400000000",
              state: {
                state_event: "BAD_CREDENTIALS",
                error: "wa-not-logged-in",
                message: "You're not logged into WhatsApp. Relogin to continue using the bridge.",
              },
            },
          ],
        },
      },
    },
    async (hub) => {
      const bridge = await hub.bridge("whatsapp", "WhatsApp", "whatsapp");
      assert.equal(bridge.state, "logged-out");
      assert.deepEqual(bridge.accounts, []);
      assert.equal(bridge.flows[0]?.id, "qr");
      assert.equal(
        bridge.error,
        "You're not logged into WhatsApp. Relogin to continue using the bridge.",
      );
    },
  );
});

test("treats an empty login list as not linked", async () => {
  await withHub({[`GET ${WA}/whoami`]: {body: {logins: []}}}, async (hub) => {
    const bridge = await hub.bridge("whatsapp", "WhatsApp", "whatsapp");
    assert.equal(bridge.state, "logged-out");
  });
});

test("maps every Bridge v2 login state conservatively", async () => {
  const stateCases: ReadonlyArray<readonly [string | null, string, string]> = [
    ["CONNECTED", "connected", "connected"],
    ["RUNNING", "connected", "connected"],
    ["CONNECTING", "connecting", "connecting"],
    ["BACKFILLING", "connecting", "connecting"],
    ["STARTING", "connecting", "connecting"],
    ["TRANSIENT_DISCONNECT", "connecting", "connecting"],
    ["BAD_CREDENTIALS", "bad-credentials", "error"],
    ["UNKNOWN_ERROR", "error", "error"],
    ["BRIDGE_UNREACHABLE", "error", "error"],
    ["A_FUTURE_STATE", "unknown", "unknown"],
    [null, "unknown", "unknown"],
  ];

  for (const [event, accountState, bridgeState] of stateCases) {
    await withHub(
      {
        [`GET ${WA}/whoami`]: {
          body: {
            logins: [{id: "account-1", state: event ? {state_event: event} : {}}],
          },
        },
      },
      async (hub) => {
        const bridge = await hub.bridge("whatsapp", "WhatsApp", "whatsapp");
        assert.equal(bridge.accounts[0]?.state, accountState, event ?? "missing event");
        assert.equal(bridge.state, bridgeState, event ?? "missing event");
      },
    );
  }
});

test("logged-out and unconfigured Bridge v2 logins are no longer linked accounts", async () => {
  for (const event of ["LOGGED_OUT", "UNCONFIGURED"] as const) {
    await withHub(
      {
        [`GET ${WA}/whoami`]: {
          body: {logins: [{id: "stale-account", state: {state_event: event}}]},
        },
      },
      async (hub) => {
        const bridge = await hub.bridge("whatsapp", "WhatsApp", "whatsapp");
        assert.equal(bridge.state, "logged-out", event);
        assert.deepEqual(bridge.accounts, [], event);
      },
    );
  }
});

test("every bridge's rooms are filed under the platform its tab uses", async () => {
  // Each of these was filed under a name no tab matches — the go-suffixed
  // protocol id passed through raw, or a ghost prefix that the hand-written
  // list of platforms had never been extended to cover — which put the
  // conversation in the app but in no tab that could reach it.
  const rooms = {
    "!slack:local": {protocol: "slackgo", ghost: "@slack_U1:local", expect: "slack"},
    "!signal:local": {protocol: "signalgo", ghost: "@signal_2:local", expect: "signal"},
    "!twitter:local": {protocol: "twittergo", ghost: "@twitter_3:local", expect: "twitter"},
    "!gvoice:local": {protocol: "gvoicego", ghost: "@gvoice_4:local", expect: "gvoice"},
    "!bluesky:local": {protocol: "blueskygo", ghost: "@bluesky_5:local", expect: "bluesky"},
    "!chat:local": {protocol: "googlechatgo", ghost: "@googlechat_6:local", expect: "googlechat"},
    // Meta's is a genuine rename rather than a suffix, both in the protocol
    // id and in the ghosts.
    "!meta:local": {protocol: "facebookgo", ghost: "@facebook_7:local", expect: "messenger"},
  };
  const join: Record<string, unknown> = {};
  for (const [roomId, room] of Object.entries(rooms))
    join[roomId] = {
      state: {
        events: [
          {type: "m.room.name", state_key: "", content: {name: roomId}},
          {type: "m.bridge", state_key: "x", content: {protocol: {id: room.protocol}}},
          {type: "m.room.member", state_key: room.ghost, content: {membership: "join"}},
          {type: "m.room.member", state_key: "@me:local", content: {membership: "join"}},
        ],
      },
      timeline: {events: []},
    };
  await withHub({"GET /_matrix/client/v3/sync": {body: {rooms: {join}}}}, async (hub) => {
    const listed = await hub.rooms();
    const byId = new Map(listed.map((room) => [room.roomId, room.platform]));
    for (const [roomId, room] of Object.entries(rooms))
      assert.equal(byId.get(roomId), room.expect, `${roomId} filed under ${byId.get(roomId)}`);
  });
});

test("a room is filed by its ghosts when the bridge writes no protocol id", async () => {
  await withHub(
    {
      "GET /_matrix/client/v3/sync": {
        body: {
          rooms: {
            join: {
              "!slack:local": {
                state: {
                  events: [
                    {type: "m.room.name", state_key: "", content: {name: "Standup"}},
                    {type: "m.room.member", state_key: "@slack_U1:local", content: {membership: "join"}},
                    {type: "m.room.member", state_key: "@me:local", content: {membership: "join"}},
                  ],
                },
                timeline: {events: []},
              },
            },
          },
        },
      },
    },
    async (hub) => {
      const [room] = await hub.rooms();
      assert.equal(room.platform, "slack");
    },
  );
});

test("a sticker is carried into the thread rather than dropped", async () => {
  // Stickers are their own event type. Reading only `m.room.message` did not
  // render them plainly — it left them out of the conversation altogether,
  // which is what every mautrix bridge sends a sticker as.
  await withHub(
    {
      "GET /_matrix/client/v3/rooms/room1/messages": {
        body: {
          end: null,
          chunk: [
            {
              type: "m.sticker",
              event_id: "$sticker",
              room_id: "room1",
              sender: "@whatsapp_1:local",
              origin_server_ts: 1_000,
              content: {
                body: "party parrot",
                url: "mxc://local/parrot",
                info: {mimetype: "image/webp", w: 240, h: 240},
              },
            },
          ],
        },
      },
    },
    async (hub) => {
      const {messages} = await hub.messages("room1", 10);
      assert.equal(messages.length, 1);
      const [attachment] = messages[0].attachments;
      assert.equal(attachment?.kind, "image");
      assert.equal(attachment?.width, 240);
      assert.match(attachment?.url ?? "", /parrot/);
    },
  );
});

test("an edit folds onto the message it edits rather than starring beside it", async () => {
  // mautrix leans on edits: a media message whose bytes turn out to be gone is
  // edited into the notice that says so. Read raw, that page held a blank
  // full-size picture and, next to it, the notice again with a `* ` in front.
  await withHub(
    {
      "GET /_matrix/client/v3/rooms/room1/messages": {
        body: {
          end: null,
          chunk: [
            {
              type: "m.room.message",
              event_id: "$edit",
              room_id: "room1",
              sender: "@whatsapp_1:local",
              origin_server_ts: 2_000,
              content: {
                body: "* Failed to bridge photo, please view it on the WhatsApp app",
                msgtype: "m.notice",
                "m.new_content": {
                  body: "Failed to bridge photo, please view it on the WhatsApp app",
                  msgtype: "m.notice",
                },
                "m.relates_to": {rel_type: "m.replace", event_id: "$photo"},
              },
            },
            {
              type: "m.room.message",
              event_id: "$photo",
              room_id: "room1",
              sender: "@whatsapp_1:local",
              origin_server_ts: 1_000,
              content: {
                body: "",
                msgtype: "m.image",
                url: "mxc://local/gone",
                info: {mimetype: "image/jpeg", w: 1600, h: 900},
              },
            },
          ],
        },
      },
    },
    async (hub) => {
      const {messages} = await hub.messages("room1", 10);
      assert.equal(messages.length, 1, "the edit is folded, not shown as its own message");
      const [message] = messages;
      assert.equal(message.eventId, "$photo", "under the original's id and place in the thread");
      assert.equal(message.body, "Failed to bridge photo, please view it on the WhatsApp app");
      assert.equal(message.attachments.length, 0, "the picture that has no bytes is not framed");
    },
  );
});

test("an edit whose message is off the page shows what it says now", async () => {
  await withHub(
    {
      "GET /_matrix/client/v3/rooms/room1/messages": {
        body: {
          end: null,
          chunk: [
            {
              type: "m.room.message",
              event_id: "$edit",
              room_id: "room1",
              sender: "@whatsapp_1:local",
              origin_server_ts: 2_000,
              content: {
                body: "* corrected",
                msgtype: "m.text",
                "m.new_content": {body: "corrected", msgtype: "m.text"},
                "m.relates_to": {rel_type: "m.replace", event_id: "$elsewhere"},
              },
            },
          ],
        },
      },
    },
    async (hub) => {
      const {messages} = await hub.messages("room1", 10);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].body, "corrected", "the `* ` fallback body is not what is shown");
    },
  );
});

test("a platform with no bridge route is reported as unavailable", async () => {
  await withHub({}, async (hub, calls) => {
    const bridge = await hub.bridge("imessage", "iMessage", null);
    assert.equal(bridge.state, "unavailable");
    assert.equal(bridge.api, "none");
    // Deliberately not a claim about a relay: this branch is reached by a
    // platform with no route and no relay handler of its own, and WeChat —
    // the only one that ever had a relay — is built from it before this runs.
    assert.match(bridge.error ?? "", /no way to bring this platform in yet/);
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
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-hub-"));
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

test("offers every supported login flow for an unlinked Discord bridge", async () => {
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
        ["qr", "user-token", "bot-token", "oauth-token"],
      );
      assert.match(bridge.flows[0]!.description, /CAPTCHA/);
      assert.match(bridge.flows[2]!.description, /Servers only/);
      assert.match(bridge.flows[3]!.description, /cannot provide all personal messages/);
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
    assert.match(sent[0], /^\/_matrix\/client\/v3\/rooms\/!room%3Alocal\/send\/m\.room\.message\/polymux-/);
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
    '        "polymux.local": user',
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
