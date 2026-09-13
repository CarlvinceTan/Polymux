import assert from "node:assert/strict";
import {createServer, type Server} from "node:http";
import {mkdir, mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import {COMMS_PLATFORMS} from "@polymux/protocol";
import {MatrixHub, provisioningSecret} from "../src/hub.js";
import {weChatPortalChannelId} from "@polymux/wechat";

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
        embedded: directory !== null,
        auth: () => auth,
      }),
      calls,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const WA = "/bridges/whatsapp/_matrix/provision/v3";

test("lists remote contacts through one linked bridge account", async () => {
  await withHub(
    {
      [`GET ${WA}/contacts`]: {
        body: {
          contacts: [
            {
              id: "61400111222@s.whatsapp.net",
              name: "Jules Tan",
              avatar_url: "mxc://local/jules",
              identifiers: ["tel:+61400111222"],
              dm_room_mxid: "!jules:local",
            },
          ],
        },
      },
    },
    async (hub, calls) => {
      assert.deepEqual(await hub.contacts("whatsapp", "61400999888"), [
        {
          id: "61400111222@s.whatsapp.net",
          name: "Jules Tan",
          avatarUrl: "polymux-media://local/jules",
          identifiers: ["tel:+61400111222"],
          chatId: "!jules:local",
        },
      ]);
      assert.deepEqual(calls[0]?.query, {
        login_id: "61400999888",
        user_id: "@me:local",
      });
      assert.equal(calls[0]?.auth, "Bearer syt_token");
    },
  );
});

test("opens a DM and creates a named remote group through provisioning", async () => {
  const remoteId = "61400111222@s.whatsapp.net";
  await withHub(
    {
      [`POST ${WA}/create_dm/${encodeURIComponent(remoteId)}`]: {
        body: {id: remoteId, dm_room_mxid: "!jules:local"},
      },
      [`POST ${WA}/create_group/group`]: {
        body: {id: "group-1", mxid: "!group:local"},
      },
    },
    async (hub, calls) => {
      assert.equal(
        await hub.createChat("whatsapp", "61400999888", [remoteId]),
        "!jules:local",
      );
      assert.equal(
        await hub.createChat(
          "whatsapp",
          "61400999888",
          [remoteId, "61400333444@s.whatsapp.net"],
          "Weekend",
        ),
        "!group:local",
      );
      assert.deepEqual(calls[0]?.body, {});
      assert.deepEqual(calls[1]?.body, {
        participants: [remoteId, "61400333444@s.whatsapp.net"],
        name: {name: "Weekend"},
      });
      assert.equal(calls[1]?.query.login_id, "61400999888");
    },
  );
});

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
              profile: {phone: "+61400000000", avatar: "mxc://local/my-profile"},
              state: {state_event: "CONNECTED", info: {is_bot: true}},
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
      assert.equal(bridge.accounts[0].avatarUrl, "polymux-media://local/my-profile");
      assert.equal(bridge.accounts[0].kind, "bot");
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

test("rooms expose Matrix Space containers and both forms of current parent link", async () => {
  const bridge = {
    type: "m.bridge",
    state_key: "whatsapp",
    content: {protocol: {id: "whatsapp"}},
  };
  await withHub(
    {"GET /_matrix/client/v3/sync": {body: {rooms: {join: {
      "!default:local": {
        state: {events: [
          {type: "m.room.create", state_key: "", content: {type: "m.space"}},
          {type: "m.room.name", state_key: "", content: {name: "WhatsApp (+61426982339)"}},
          {
            ...bridge,
            content: {
              ...bridge.content,
              "com.beeper.room_type.v2": "personal_filtering_space",
            },
          },
          {
            type: "m.space.child",
            state_key: "!social:local",
            content: {via: ["local"]},
          },
        ]},
        timeline: {events: []},
      },
      "!community:local": {
        state: {events: [
          {type: "m.room.create", state_key: "", content: {type: "m.space"}},
          {type: "m.room.name", state_key: "", content: {name: "NUS exchange students"}},
          {
            type: "m.space.child",
            state_key: "!running:local",
            content: {via: ["local"]},
          },
        ]},
        timeline: {events: []},
      },
      "!social:local": {
        state: {events: [
          {type: "m.room.name", state_key: "", content: {name: "Social"}},
          bridge,
          {
            type: "m.space.parent",
            state_key: "!community:local",
            content: {via: ["local"]},
          },
          // An empty current-state event means this older parent was removed.
          {type: "m.space.parent", state_key: "!old:local", content: {}},
        ]},
        timeline: {events: []},
      },
      "!running:local": {
        state: {events: [
          {type: "m.room.name", state_key: "", content: {name: "Running"}},
          bridge,
        ]},
        timeline: {events: []},
      },
    }}}}},
    async (hub) => {
      const byId = new Map((await hub.rooms()).map((room) => [room.roomId, room]));
      assert.equal(byId.get("!default:local")?.space, true);
      assert.equal(byId.get("!default:local")?.defaultSpace, true);
      assert.equal(byId.get("!community:local")?.space, true);
      assert.equal(byId.get("!community:local")?.defaultSpace, false);
      assert.equal(byId.get("!community:local")?.platform, "whatsapp");
      assert.deepEqual(byId.get("!community:local")?.parentIds, []);
      assert.equal(byId.get("!social:local")?.space, false);
      assert.deepEqual(
        byId.get("!social:local")?.parentIds,
        ["!community:local", "!default:local"],
      );
      assert.deepEqual(byId.get("!running:local")?.parentIds, ["!community:local"]);
    },
  );
});

test("rooms expose official badges only from bridge-attested trust metadata", async () => {
  const embeddedDirectory = await mkdtemp(path.join(tmpdir(), "polymux-official-badge-"));
  const room = (platform: string, trust: Record<string, unknown>, memberTrust: Record<string, unknown> = {}) => ({
    state: {events: [
      {type: "m.room.name", state_key: "", content: {name: `${platform} support`}},
      {
        type: "m.bridge",
        state_key: platform,
        content: {protocol: {id: platform}, "com.beeper.room_type": "dm", ...trust},
      },
      {
        type: "m.room.member",
        state_key: `@${platform}_support:local`,
        content: {membership: "join", displayname: `${platform} support`, ...memberTrust},
      },
      {type: "m.room.member", state_key: "@me:local", content: {membership: "join"}},
    ]},
    timeline: {events: [] as Array<Record<string, unknown>>},
  });
  await withHub(
    {"GET /_matrix/client/v3/sync": {body: {rooms: {join: {
      "!telegram:local": room("telegram", {"com.beeper.is_verified": true}),
      "!whatsapp:local": room("whatsapp", {}, {is_official: true}),
      "!ordinary:local": room("signal", {}),
      "!named:local": room("slack", {}, {displayname: "Official support"}),
    }}}}},
    async (hub) => {
      const byId = new Map((await hub.rooms()).map((item) => [item.roomId, item]));
      assert.equal(byId.get("!telegram:local")?.official, true);
      assert.equal(byId.get("!whatsapp:local")?.official, true);
      assert.equal(byId.get("!ordinary:local")?.official, undefined);
      assert.equal(byId.get("!named:local")?.official, undefined);
    },
    undefined,
    embeddedDirectory,
  );
});

test("native WeChat unread counts require the local bridge identity", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-native-unread-"));
  const room = (count: number, sender = "@wechatbot:local", bridgeSender = "@wechatbot:local") => ({
    state: {events: [
      {type: "m.bridge", state_key: "wechat", sender: bridgeSender, content: {protocol: {id: "wechat"}}},
      {type: "co.polymux.wechat.unread", state_key: "", sender, content: {count}},
    ]},
    timeline: {events: [] as Array<Record<string, unknown>>},
    unread_notifications: {notification_count: 4},
  });
  const routes = {"GET /_matrix/client/v3/sync": {body: {rooms: {join: {
    "!read:local": room(0), "!marked:local": room(1),
    "!forged:local": room(99, "@me:local"),
    "!forged-bridge:local": room(99, "@wechatbot:local", "@me:local"),
    "!invalid:local": room(-1),
  }}}}};
  await withHub(routes, async (hub) => {
    const counts = Object.fromEntries((await hub.rooms()).map((room) => [room.roomId, room.unread]));
    assert.deepEqual(counts, {"!read:local": 0, "!marked:local": 1,
      "!forged:local": 4, "!forged-bridge:local": 4, "!invalid:local": 4});
  }, undefined, directory);
  await withHub(routes, async (hub) => {
    assert.ok((await hub.rooms()).every((room) => room.unread === 4), "remote state cannot attest native counts");
  });
});

test("WeChat rows use native message time while setup events and untrusted summaries cannot create recency", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-native-recency-"));
  const room = (timestamp: number | null, sender = "@wechatbot:local", messageTimestamp?: number) => ({
    state: {events: [
      {type: "m.bridge", state_key: "wechat", sender: "@wechatbot:local", content: {protocol: {id: "wechat"}}},
      {type: "co.polymux.wechat.session", state_key: "", sender,
        content: {last_message_ts: timestamp, preview: "Native latest message"}},
    ]},
    timeline: {events: [
      ...(messageTimestamp ? [{type: "m.room.message", sender: "@wechat_friend:local",
        origin_server_ts: messageTimestamp, content: {body: "Imported message", msgtype: "m.text"}}] : []),
      {type: "m.room.name", state_key: "", origin_server_ts: 9_999_000, content: {name: "Set up now"}},
      {type: "m.room.member", state_key: "@wechat_friend:local", origin_server_ts: 9_999_001,
        content: {membership: "join", displayname: "Friend"}},
    ]},
  });
  const routes = {"GET /_matrix/client/v3/sync": {body: {rooms: {join: {
    "!old:local": room(1_000), "!recent:local": room(2_000),
    "!new-stream:local": room(2_000, "@wechatbot:local", 3_000),
    "!partial-history:local": room(2_000, "@wechatbot:local", 500),
    "!pending:local": room(null), "!forged:local": room(99_000, "@me:local"),
    "!invalid:local": room(9e20),
  }}}}};
  await withHub(routes, async (hub) => {
    const rooms = await hub.rooms();
    assert.equal(rooms[0]?.roomId, "!new-stream:local");
    const byId = new Map(rooms.map((row) => [row.roomId, row]));
    assert.equal(byId.get("!old:local")?.lastActivity, new Date(1_000).toISOString());
    assert.equal(byId.get("!recent:local")?.lastActivity, new Date(2_000).toISOString());
    assert.equal(byId.get("!partial-history:local")?.preview, "Native latest message");
    assert.equal(byId.get("!new-stream:local")?.preview, "Imported message");
    for (const id of ["!pending:local", "!forged:local", "!invalid:local"]) {
      assert.equal(byId.get(id)?.lastActivity, null);
      assert.equal(byId.get(id)?.preview, null);
    }
  }, undefined, directory);
  await withHub(routes, async (hub) => {
    const rows = await hub.rooms();
    assert.equal(rows.find((row) => row.roomId === "!recent:local")?.lastActivity, null,
      "external room state cannot attest the Desktop session");
  });
});

test("remote Matrix room state cannot forge official badges", async () => {
  await withHub(
    {"GET /_matrix/client/v3/sync": {body: {rooms: {join: {
      "!remote:local": {
        state: {events: [
          {type: "m.room.name", state_key: "", content: {name: "Support"}},
          {type: "m.bridge", state_key: "signal", content: {
            protocol: {id: "signal"},
            "com.beeper.room_type": "dm",
            "com.beeper.is_verified": true,
          }},
          {type: "m.room.member", state_key: "@support:local", content: {
            membership: "join",
            is_official: true,
          }},
          {type: "m.room.member", state_key: "@me:local", content: {membership: "join"}},
        ]},
        timeline: {events: []},
      },
    }}}}},
    async (hub) => {
      assert.equal((await hub.rooms())[0]?.official, undefined);
    },
  );
});

test("WhatsApp contact and group names hide bridge metadata", async () => {
  const room = (name: string, protocol: string, roomType: string) => ({
    state: {events: [
      {type: "m.room.name", state_key: "", content: {name}},
      {
        type: "m.bridge",
        state_key: protocol,
        content: {
          protocol: {id: protocol},
          "com.beeper.room_type": roomType,
        },
      },
    ]},
    timeline: {events: [] as Array<Record<string, unknown>>},
  });
  await withHub(
    {"GET /_matrix/client/v3/sync": {body: {rooms: {join: {
      "!contact:local": room("Jules Tan (WA)", "whatsapp", "dm"),
      "!number:local": room("@whatsapp_13135550002:polymux.local", "whatsapp", "dm"),
      "!group:local": room("Weekend Plans (WA)", "whatsapp", "group"),
      "!number-group:local": room("@whatsapp_13135550002:polymux.local", "whatsapp", "group"),
      "!other:local": room("Release (WA)", "slackgo", "dm"),
    }}}}},
    async (hub) => {
      const byId = new Map((await hub.rooms()).map((item) => [item.roomId, item.name]));
      assert.equal(byId.get("!contact:local"), "Jules Tan");
      assert.equal(byId.get("!number:local"), "+13135550002");
      assert.equal(byId.get("!group:local"), "Weekend Plans");
      assert.equal(byId.get("!number-group:local"), "@whatsapp_13135550002:polymux.local");
      assert.equal(byId.get("!other:local"), "Release (WA)");
    },
  );
});

test("previously imported WeChat folders are hidden without hiding their real chats or similarly named rooms", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-folders-"));
  const room = (chatId: string, sender = "@wechatbot:local", platform = "wechat") => ({
    state: {events: [
      {type: "m.room.name", state_key: "", content: {name: "WeChat"}},
      {type: "m.bridge", state_key: "wechat", sender, content: {
        protocol: {id: platform}, channel: {id: weChatPortalChannelId(chatId)},
        "com.beeper.room_type": "dm",
      }},
    ]},
    timeline: {events: [] as Array<Record<string, unknown>>},
    unread_notifications: {notification_count: 17},
  });
  const routes = {"GET /_matrix/client/v3/sync": {body: {rooms: {join: {
    "!folded:local": room("@placeholder_foldgroup"),
    "!subscriptions:local": room("brandsessionholder"),
    "!services:local": room("brandservicesessionholder"),
    "!group:local": room("123456@chatroom"),
    "!official:local": room("gh_news"),
    "!friend:local": room("wxid_wechat"),
    "!untrusted:local": room("brandsessionholder", "@me:local"),
    "!different-platform:local": room("brandsessionholder", "@wechatbot:local", "telegram"),
  }}}}};
  await withHub(routes, async hub => {
    const rooms = await hub.rooms();
    assert.deepEqual(rooms.map(row => row.roomId).sort(),
      ["!group:local", "!official:local", "!friend:local", "!untrusted:local", "!different-platform:local"].sort());
    assert.ok(rooms.every(row => row.name === "WeChat" && row.unread === 17));
  }, undefined, directory);
  await withHub(routes, async hub => {
    assert.equal((await hub.rooms()).length, 8, "remote Matrix state cannot hide a room as a native folder");
  });
});

test("WeChat rooms expose one stable contact identity and the current writable portal", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-wechat-portals-"));
  const bridgeDirectory = path.join(directory, "bridges", "wechat");
  await mkdir(bridgeDirectory, {recursive: true});
  await writeFile(
    path.join(bridgeDirectory, "state.json"),
    JSON.stringify({rooms: {wxid_person: {roomId: "!current:local", isGroup: false}}}),
  );
  const room = () => ({
    state: {events: [
      {type: "m.room.name", state_key: "", content: {name: "·W·"}},
      {
        type: "m.bridge",
        state_key: "wechat",
        content: {
          protocol: {id: "wechat"},
          "com.beeper.room_type": "dm",
          channel: {id: "8f53f833f8a8e7a08946b1ec"},
        },
      },
    ]},
    timeline: {events: [] as Array<Record<string, unknown>>},
  });
  await withHub(
    {"GET /_matrix/client/v3/sync": {body: {rooms: {join: {
      "!old:local": room(),
      "!current:local": room(),
    }}}}},
    async (hub) => {
      const byId = new Map((await hub.rooms()).map((item) => [item.roomId, item]));
      assert.equal(byId.get("!old:local")?.remoteId, "8f53f833f8a8e7a08946b1ec");
      assert.equal(byId.get("!old:local")?.currentPortal, undefined);
      assert.equal(byId.get("!current:local")?.remoteId, "8f53f833f8a8e7a08946b1ec");
      assert.equal(byId.get("!current:local")?.currentPortal, true);
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("WhatsApp sender names hide bridge metadata above messages", async () => {
  await withHub(
    {
      "GET /_matrix/client/v3/rooms/!kheam%3Alocal/messages": {
        body: {
          chunk: [{
            type: "m.room.message",
            event_id: "$message",
            room_id: "!kheam:local",
            sender: "@whatsapp_kheam:local",
            content: {body: "Hello"},
          }],
          state: [{
            type: "m.room.member",
            state_key: "@whatsapp_kheam:local",
            content: {membership: "join", displayname: "Kheam Tan (WA)"},
          }],
        },
      },
    },
    async (hub) => {
      const [message] = (await hub.messages("!kheam:local", 10)).messages;
      assert.equal(message.senderName, "Kheam Tan");
    },
  );
});

test("rooms carry the linked account that owns their bridge portal", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-room-accounts-"));
  const bridgeDirectory = path.join(directory, "bridges", "whatsapp");
  await mkdir(bridgeDirectory, {recursive: true});
  const database = new DatabaseSync(path.join(bridgeDirectory, "bridge.db"));
  database.exec(`
    CREATE TABLE portal (
      bridge_id TEXT NOT NULL,
      id TEXT NOT NULL,
      receiver TEXT NOT NULL,
      mxid TEXT
    );
    CREATE TABLE user_portal (
      bridge_id TEXT NOT NULL,
      login_id TEXT NOT NULL,
      portal_id TEXT NOT NULL,
      portal_receiver TEXT NOT NULL
    );
    INSERT INTO portal VALUES
      ('whatsapp', 'alice', 'personal', '!alice:local'),
      ('whatsapp', 'work', 'work-account', '!work:local');
  `);
  database.close();

  const room = (name: string) => ({
    state: {events: [
      {type: "m.room.name", state_key: "", content: {name}},
      {type: "m.bridge", state_key: "wa", content: {protocol: {id: "whatsapp"}}},
    ]},
    timeline: {events: [] as Array<Record<string, unknown>>},
  });
  await withHub(
    {"GET /_matrix/client/v3/sync": {body: {rooms: {join: {
      "!alice:local": room("Alice"),
      "!work:local": room("Work group"),
    }}}}},
    async (hub) => {
      const listed = await hub.rooms();
      assert.deepEqual(
        Object.fromEntries(listed.map((item) => [item.roomId, item.accountIds])),
        {"!alice:local": ["personal"], "!work:local": ["work-account"]},
      );
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("a direct room uses the contact portal avatar instead of the linked account avatar", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-room-avatar-"));
  const bridgeDirectory = path.join(directory, "bridges", "instagram");
  await mkdir(bridgeDirectory, {recursive: true});
  const database = new DatabaseSync(path.join(bridgeDirectory, "bridge.db"));
  database.exec(`
    CREATE TABLE portal (
      bridge_id TEXT NOT NULL,
      id TEXT NOT NULL,
      receiver TEXT NOT NULL,
      mxid TEXT,
      avatar_mxc TEXT
    );
    CREATE TABLE user_portal (
      bridge_id TEXT NOT NULL,
      login_id TEXT NOT NULL,
      portal_id TEXT NOT NULL,
      portal_receiver TEXT NOT NULL
    );
    INSERT INTO portal VALUES (
      'instagram', 'pranav', 'my-account', '!pranav:local',
      'mxc://local/pranav-avatar'
    );
    INSERT INTO user_portal VALUES (
      'instagram', 'my-account', 'pranav', 'my-account'
    );
  `);
  database.close();

  await withHub(
    {"GET /_matrix/client/v3/sync": {body: {rooms: {join: {
      "!pranav:local": {
        state: {events: [
          {type: "m.room.name", state_key: "", content: {name: "Pranav"}},
          {
            type: "m.bridge",
            state_key: "instagram",
            content: {
              protocol: {id: "instagram"},
              "com.beeper.room_type": "dm",
            },
          },
          // The linked account arrives first. Falling back to the first other
          // member reproduces the bug: it puts the user's portrait on Pranav.
          {
            type: "m.room.member",
            state_key: "@meta_my-account:local",
            content: {membership: "join", displayname: "Me", avatar_url: "mxc://local/my-avatar"},
          },
          {
            type: "m.room.member",
            state_key: "@meta_pranav:local",
            content: {membership: "join", displayname: "Pranav"},
          },
          {type: "m.room.member", state_key: "@me:local", content: {membership: "join"}},
        ]},
        timeline: {events: []},
      },
    }}}}},
    async (hub) => {
      const [room] = await hub.rooms();
      assert.equal(room?.name, "Pranav");
      assert.equal(room?.avatarUrl, "polymux-media://local/pranav-avatar");
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("a direct room with no contact picture never borrows the linked account picture", async () => {
  await withHub(
    {"GET /_matrix/client/v3/sync": {body: {rooms: {join: {
      "!pranav:local": {
        state: {events: [
          {type: "m.room.name", state_key: "", content: {name: "Pranav (WA)"}},
          {
            type: "m.bridge",
            state_key: "whatsapp",
            content: {
              protocol: {id: "whatsapp"},
              "com.beeper.room_type": "dm",
            },
          },
          // Both bridge ghosts are other Matrix members. Only the second one
          // names this room; the first is the signed-in WhatsApp account.
          {
            type: "m.room.member",
            state_key: "@whatsapp_mine:local",
            content: {membership: "join", displayname: "Me (WA)", avatar_url: "mxc://local/my-avatar"},
          },
          {
            type: "m.room.member",
            state_key: "@whatsapp_pranav:local",
            content: {membership: "join", displayname: "Pranav (WA)"},
          },
          {type: "m.room.member", state_key: "@me:local", content: {membership: "join"}},
        ]},
        timeline: {events: []},
      },
    }}}}},
    async (hub) => {
      const [room] = await hub.rooms();
      assert.equal(room?.name, "Pranav");
      assert.equal(room?.avatarUrl, null);
    },
  );
});

test("WhatsApp unread counts follow remote reads and recognise both self identities", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-whatsapp-unread-"));
  const bridgeDirectory = path.join(directory, "bridges", "whatsapp");
  await mkdir(bridgeDirectory, {recursive: true});
  const database = new DatabaseSync(path.join(bridgeDirectory, "bridge.db"));
  database.exec(`
    CREATE TABLE portal (
      bridge_id TEXT NOT NULL,
      id TEXT NOT NULL,
      receiver TEXT NOT NULL,
      mxid TEXT
    );
    CREATE TABLE user_portal (
      bridge_id TEXT NOT NULL,
      login_id TEXT NOT NULL,
      portal_id TEXT NOT NULL,
      portal_receiver TEXT NOT NULL,
      last_read BIGINT
    );
    CREATE TABLE whatsmeow_device (jid TEXT NOT NULL, lid TEXT);
    CREATE TABLE whatsapp_history_sync_conversation (
      bridge_id TEXT NOT NULL,
      user_login_id TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      last_message_timestamp BIGINT,
      synced_login_ts BIGINT,
      unread_count INTEGER,
      marked_as_unread BOOLEAN
    );
    CREATE TABLE message (
      bridge_id TEXT NOT NULL,
      id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      room_receiver TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      timestamp BIGINT NOT NULL
    );

    INSERT INTO whatsmeow_device VALUES
      ('61400000000:7@s.whatsapp.net', '123456789:7@lid');
    INSERT INTO portal VALUES
      ('whatsapp', 'replied', '61400000000', '!replied:local'),
      ('whatsapp', 'read-elsewhere', '61400000000', '!read:local'),
      ('whatsapp', 'waiting', '61400000000', '!waiting:local');
    INSERT INTO user_portal VALUES
      ('whatsapp', '61400000000', 'replied', '61400000000', 1050000000000),
      ('whatsapp', '61400000000', 'read-elsewhere', '61400000000', 1050000000000),
      ('whatsapp', '61400000000', 'waiting', '61400000000', 1050000000000);
    INSERT INTO whatsapp_history_sync_conversation VALUES
      ('whatsapp', '61400000000', 'replied', 1001, 1000, 5, 0),
      ('whatsapp', '61400000000', 'read-elsewhere', 1001, 1000, 2, 0),
      ('whatsapp', '61400000000', 'waiting', 1001, 1000, 2, 0);
    INSERT INTO message VALUES
      ('whatsapp', 'reply-in', 'replied', '61400000000', '44770000000', 1700000000000),
      ('whatsapp', 'reply-out', 'replied', '61400000000', 'lid-123456789', 1800000000000),
      ('whatsapp', 'read-in', 'read-elsewhere', '61400000000', '44770000001', 1900000000000),
      ('whatsapp', 'waiting-one', 'waiting', '61400000000', '44770000002', 1700000000000),
      ('whatsapp', 'waiting-two', 'waiting', '61400000000', '44770000002', 1800000000000);
  `);
  database.close();
  const homeserver = new DatabaseSync(path.join(directory, "homeserver.sqlite"));
  homeserver.exec(`
    CREATE TABLE receipts (user_id TEXT, room_id TEXT, stream_order INTEGER);
    CREATE TABLE events (stream_order INTEGER, origin_server_ts INTEGER);
    INSERT INTO receipts VALUES ('@me:local', '!read:local', 1);
    INSERT INTO events VALUES (1, 2000000);
  `);
  homeserver.close();

  const room = (name: string) => ({
    state: {events: [
      {type: "m.room.name", state_key: "", content: {name}},
      {type: "m.bridge", state_key: "wa", content: {protocol: {id: "whatsapp"}}},
    ]},
    timeline: {events: [] as Array<Record<string, unknown>>},
    // Deliberately wrong: backfilled events make Matrix's raw count huge.
    unread_notifications: {notification_count: 99},
  });
  await withHub(
    {"GET /_matrix/client/v3/sync": {body: {rooms: {join: {
      "!replied:local": room("Replied"),
      "!read:local": room("Read elsewhere"),
      "!waiting:local": room("Waiting"),
    }}}}},
    async (hub) => {
      const byId = new Map((await hub.rooms()).map((item) => [item.roomId, item]));
      assert.equal(byId.get("!replied:local")?.unread, 0, "a latest message from the linked LID is mine");
      assert.equal(byId.get("!read:local")?.unread, 0, "a later remote read watermark clears the chat");
      assert.equal(byId.get("!waiting:local")?.unread, 4, "native unread plus later inbound messages remains unread");
      assert.deepEqual(byId.get("!waiting:local")?.unreadByAccount, {61400000000: 4});
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("Bridge v2 unread counts follow read markers changed outside Polymux", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-remote-unread-"));
  const bridgeDirectory = path.join(directory, "bridges", "instagram");
  await mkdir(bridgeDirectory, {recursive: true});
  const database = new DatabaseSync(path.join(bridgeDirectory, "bridge.db"));
  database.exec(`
    CREATE TABLE portal (
      bridge_id TEXT NOT NULL,
      id TEXT NOT NULL,
      receiver TEXT NOT NULL,
      mxid TEXT
    );
    CREATE TABLE user_portal (
      bridge_id TEXT NOT NULL,
      login_id TEXT NOT NULL,
      portal_id TEXT NOT NULL,
      portal_receiver TEXT NOT NULL,
      last_read BIGINT
    );
    CREATE TABLE message (
      bridge_id TEXT NOT NULL,
      id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      room_receiver TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      timestamp BIGINT NOT NULL
    );

    INSERT INTO portal VALUES
      ('instagram', 'read-elsewhere', 'account', '!read-elsewhere:local'),
      ('instagram', 'marked-unread', 'account', '!marked-unread:local'),
      ('instagram', 'local-only', 'account', '!local-only:local'),
      ('instagram', 'no-marker', 'account', '!no-marker:local');
    INSERT INTO user_portal VALUES
      ('instagram', 'account', 'read-elsewhere', 'account', 3000000000),
      -- The native app moved its marker behind the newest message again.
      ('instagram', 'account', 'marked-unread', 'account', 1000000000),
      ('instagram', 'account', 'local-only', 'account', NULL),
      ('instagram', 'account', 'no-marker', 'account', NULL);
    INSERT INTO message VALUES
      ('instagram', 'read-message', 'read-elsewhere', 'account', 'friend', 2000000000),
      ('instagram', 'unread-message', 'marked-unread', 'account', 'friend', 2000000000),
      ('instagram', 'local-message', 'local-only', 'account', 'friend', 2000000000),
      ('instagram', 'fallback-message', 'no-marker', 'account', 'friend', 2000000000);
  `);
  database.close();

  const homeserver = new DatabaseSync(path.join(directory, "homeserver.sqlite"));
  homeserver.exec(`
    CREATE TABLE receipts (user_id TEXT, room_id TEXT, stream_order INTEGER);
    CREATE TABLE events (stream_order INTEGER, origin_server_ts INTEGER);
    INSERT INTO receipts VALUES
      ('@me:local', '!marked-unread:local', 1),
      ('@me:local', '!local-only:local', 2);
    INSERT INTO events VALUES (1, 3000), (2, 3000);
  `);
  homeserver.close();

  const room = (name: string, unread: number) => ({
    state: {events: [
      {type: "m.room.name", state_key: "", content: {name}},
      {type: "m.bridge", state_key: "instagram", content: {protocol: {id: "instagram"}}},
    ]},
    timeline: {events: [] as Array<Record<string, unknown>>},
    unread_notifications: {notification_count: unread},
  });
  await withHub(
    {"GET /_matrix/client/v3/sync": {body: {rooms: {join: {
      "!read-elsewhere:local": room("Read elsewhere", 9),
      "!marked-unread:local": room("Marked unread elsewhere", 0),
      "!local-only:local": room("Read in Polymux", 9),
      "!no-marker:local": room("Matrix fallback", 7),
    }}}}},
    async (hub) => {
      const byId = new Map((await hub.rooms()).map((item) => [item.roomId, item]));
      assert.equal(byId.get("!read-elsewhere:local")?.unread, 0);
      assert.equal(byId.get("!marked-unread:local")?.unread, 1);
      assert.equal(byId.get("!local-only:local")?.unread, 0);
      assert.equal(byId.get("!no-marker:local")?.unread, 7);
      assert.deepEqual(byId.get("!marked-unread:local")?.unreadByAccount, {account: 1});
      assert.equal(byId.get("!no-marker:local")?.unreadByAccount, undefined);
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("messages recognise a linked bridge login's ghost as the user", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-instagram-ownership-"));
  const bridgeDirectory = path.join(directory, "bridges", "instagram");
  await mkdir(bridgeDirectory, {recursive: true});
  const database = new DatabaseSync(path.join(bridgeDirectory, "bridge.db"));
  database.exec(`
    CREATE TABLE portal (
      bridge_id TEXT NOT NULL,
      id TEXT NOT NULL,
      receiver TEXT NOT NULL,
      mxid TEXT
    );
    CREATE TABLE user_portal (
      bridge_id TEXT NOT NULL,
      login_id TEXT NOT NULL,
      portal_id TEXT NOT NULL,
      portal_receiver TEXT NOT NULL
    );
    CREATE TABLE message (
      bridge_id TEXT NOT NULL,
      mxid TEXT NOT NULL,
      room_id TEXT NOT NULL,
      room_receiver TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_mxid TEXT NOT NULL
    );
    INSERT INTO portal VALUES ('instagram', 'thread-1', '', '!instagram:local');
    INSERT INTO user_portal VALUES ('instagram', 'account-42', 'thread-1', '');
    INSERT INTO message VALUES
      ('instagram', '$mine', 'thread-1', '', 'account-42', '@meta_account-42:local'),
      -- Batch backfill replaces this remote id in the local homeserver.
      ('instagram', '$remote-backfill-id', 'thread-1', '', 'account-42', '@meta_account-42:local'),
      ('instagram', '$theirs', 'thread-1', '', 'friend-7', '@meta_friend-7:local');
  `);
  database.close();

  await withHub(
    {
      "GET /_matrix/client/v3/rooms/!instagram%3Alocal/messages": {
        body: {
          chunk: [
            {
              type: "m.room.message",
              event_id: "$mine",
              room_id: "!instagram:local",
              sender: "@meta_account-42:local",
              content: {body: "sent on Instagram"},
            },
            {
              type: "m.room.message",
              event_id: "$theirs",
              room_id: "!instagram:local",
              sender: "@meta_friend-7:local",
              content: {body: "received on Instagram"},
            },
            {
              type: "m.room.message",
              event_id: "$local-backfill-id",
              room_id: "!instagram:local",
              sender: "@meta_account-42:local",
              content: {body: "sent earlier on Instagram"},
            },
            {
              type: "m.room.message",
              event_id: "$matrix",
              room_id: "!instagram:local",
              sender: "@me:local",
              content: {body: "sent from Polymux"},
            },
          ],
        },
      },
      "POST /_matrix/client/v3/search": {
        body: {search_categories: {room_events: {results: [
          {result: {
            type: "m.room.message",
            event_id: "$search-mine",
            room_id: "!instagram:local",
            sender: "@meta_account-42:local",
            content: {body: "my matching message"},
          }},
          {result: {
            type: "m.room.message",
            event_id: "$search-theirs",
            room_id: "!instagram:local",
            sender: "@meta_friend-7:local",
            content: {body: "their matching message"},
          }},
        ]}}},
      },
      "GET /_matrix/client/v3/notifications": {
        body: {notifications: [
          {read: false, room_id: "!instagram:local", event: {
            type: "m.room.message",
            event_id: "$unread-mine",
            room_id: "!instagram:local",
            sender: "@meta_account-42:local",
            content: {body: "my apparent unread"},
          }},
          {read: false, room_id: "!instagram:local", event: {
            type: "m.room.message",
            event_id: "$unread-theirs",
            room_id: "!instagram:local",
            sender: "@meta_friend-7:local",
            content: {body: "their unread"},
          }},
        ]},
      },
      "GET /_matrix/client/v3/rooms/!instagram%3Alocal/state/m.room.name": {
        body: {name: "Friend"},
      },
    },
    async (hub) => {
      const byId = new Map((await hub.messages("!instagram:local", 10)).messages.map(
        (message) => [message.eventId, message],
      ));
      assert.equal(byId.get("$mine")?.mine, true, "the linked remote account is mine");
      assert.equal(byId.get("$mine")?.senderName, "You", "its incomplete profile never leaks");
      assert.equal(
        byId.get("$local-backfill-id")?.mine,
        true,
        "backfill remains mine when its local event id was replaced",
      );
      assert.equal(byId.get("$theirs")?.mine, false, "another remote account stays incoming");
      assert.equal(byId.get("$matrix")?.mine, true, "the direct Matrix identity remains mine");
      assert.equal(hub.senderIsMine("!instagram:local", "@meta_account-42:local"), true);
      assert.equal(hub.senderIsMine("!instagram:local", "@meta_friend-7:local"), false);

      const searched = new Map((await hub.search("matching", 10)).messages.map(
        (message) => [message.eventId, message],
      ));
      assert.equal(searched.get("$search-mine")?.mine, true);
      assert.equal(searched.get("$search-mine")?.senderName, "You");
      assert.equal(searched.get("$search-theirs")?.mine, false);

      const unread = await hub.unread(10);
      assert.deepEqual(
        unread.map((message) => message.eventId),
        ["$unread-theirs"],
        "the account's bridge ghost is never reported as an unread sender",
      );
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("messages recognise WhatsApp's alternate LID as the linked account", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-whatsapp-ownership-"));
  const bridgeDirectory = path.join(directory, "bridges", "whatsapp");
  await mkdir(bridgeDirectory, {recursive: true});
  const database = new DatabaseSync(path.join(bridgeDirectory, "bridge.db"));
  database.exec(`
    CREATE TABLE portal (
      bridge_id TEXT NOT NULL,
      id TEXT NOT NULL,
      receiver TEXT NOT NULL,
      mxid TEXT
    );
    CREATE TABLE user_portal (
      bridge_id TEXT NOT NULL,
      login_id TEXT NOT NULL,
      portal_id TEXT NOT NULL,
      portal_receiver TEXT NOT NULL
    );
    CREATE TABLE message (
      bridge_id TEXT NOT NULL,
      mxid TEXT NOT NULL,
      room_id TEXT NOT NULL,
      room_receiver TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_mxid TEXT NOT NULL
    );
    CREATE TABLE whatsmeow_device (jid TEXT NOT NULL, lid TEXT);
    INSERT INTO portal VALUES ('whatsapp', 'chat-1', '61400000000', '!whatsapp:local');
    INSERT INTO user_portal VALUES ('whatsapp', '61400000000', 'chat-1', '61400000000');
    INSERT INTO whatsmeow_device VALUES (
      '61400000000:7@s.whatsapp.net',
      '123456789:7@lid'
    );
    INSERT INTO message VALUES (
      'whatsapp', '$remote-lid', 'chat-1', '61400000000', 'lid-123456789',
      '@whatsapp_lid-123456789:local'
    );
  `);
  database.close();

  await withHub(
    {
      "GET /_matrix/client/v3/rooms/!whatsapp%3Alocal/messages": {
        body: {
          chunk: [
            {
              type: "m.room.message",
              event_id: "$local-lid",
              room_id: "!whatsapp:local",
              sender: "@whatsapp_lid-123456789:local",
              content: {body: "sent from the linked phone"},
            },
          ],
        },
      },
    },
    async (hub) => {
      const [message] = (await hub.messages("!whatsapp:local", 10)).messages;
      assert.equal(message.mine, true, "LID ownership survives a rewritten backfill event id");
      assert.equal(message.senderName, "You", "the linked LID never reads as an unknown user");
      assert.equal(hub.senderIsMine("!whatsapp:local", "@whatsapp_lid-123456789:local"), true);
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("embedded message pages keep new messages ahead of later-inserted backfill", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-timeline-order-"));
  const database = new DatabaseSync(path.join(directory, "homeserver.sqlite"));
  database.exec(`
    CREATE TABLE events (
      stream_order INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      type TEXT NOT NULL,
      state_key TEXT,
      content_json TEXT NOT NULL,
      origin_server_ts INTEGER NOT NULL,
      redacts TEXT,
      redacted_by TEXT
    );
    INSERT INTO events VALUES
      (1, '$today', '!instagram:local', '@meta_friend:local', 'm.room.message', NULL, '{"body":"today"}', 3000, NULL, NULL),
      (2, '$yesterday', '!instagram:local', '@meta_friend:local', 'm.room.message', NULL, '{"body":"yesterday"}', 2000, NULL, NULL),
      -- Imported last, but authored first: insertion order must not put it at
      -- the head of a person's conversation.
      (3, '$old-backfill', '!instagram:local', '@meta_friend:local', 'm.room.message', NULL, '{"body":"old"}', 1000, NULL, NULL);
  `);
  database.close();

  await withHub(
    {
      "GET /_matrix/client/v3/rooms/!instagram%3Alocal/messages": {
        body: {chunk: [{type: "m.room.message", content: {body: "wrong edge"}}]},
      },
    },
    async (hub, calls) => {
      const first = await hub.messages("!instagram:local", 2);
      assert.deepEqual(first.messages.map((message) => message.body), ["today", "yesterday"]);
      assert.match(first.nextBefore ?? "", /^local:/);

      const second = await hub.messages("!instagram:local", 2, first.nextBefore!);
      assert.deepEqual(second.messages.map((message) => message.body), ["old"]);
      assert.equal(second.nextBefore, null);
      assert.ok(
        calls.every((call) => !call.path.endsWith("/messages")),
        "the embedded reader does not ask the insertion-ordered Matrix page",
      );
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("embedded pages fold recovered photos at their original time across page boundaries", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-timeline-order-"));
  const database = new DatabaseSync(path.join(directory, "homeserver.sqlite"));
  database.exec(`
    CREATE TABLE events (
      stream_order INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      type TEXT NOT NULL,
      state_key TEXT,
      content_json TEXT NOT NULL,
      origin_server_ts INTEGER NOT NULL,
      redacts TEXT,
      redacted_by TEXT
    );
    INSERT INTO events VALUES
      (1, '$today', '!instagram:local', '@meta_friend:local', 'm.room.message', NULL, '{"body":"today"}', 3000, NULL, NULL),
      (2, '$yesterday', '!instagram:local', '@meta_friend:local', 'm.room.message', NULL, '{"body":"yesterday"}', 2000, NULL, NULL),
      -- Imported last, but authored first: insertion order must not put it at
      -- the head of a person's conversation.
      (3, '$old-backfill', '!instagram:local', '@meta_friend:local', 'm.room.message', NULL, '{"body":"old"}', 1000, NULL, NULL),
      (4, '$photo-update', '!instagram:local', '@meta_friend:local', 'm.room.message', NULL,
       '{"body":"update","m.relates_to":{"rel_type":"m.replace","event_id":"$old-backfill"},"m.new_content":{"body":"recovered photo","msgtype":"m.image","url":"mxc://local/photo"}}', 4000, NULL, NULL);
  `);
  database.close();

  await withHub(
    {
      "GET /_matrix/client/v3/rooms/!instagram%3Alocal/messages": {
        body: {chunk: [{type: "m.room.message", content: {body: "wrong edge"}}]},
      },
    },
    async (hub, calls) => {
      const first = await hub.messages("!instagram:local", 2);
      assert.deepEqual(first.messages.map((message) => message.body), ["today", "yesterday"]);
      assert.match(first.nextBefore ?? "", /^local:/);

      const second = await hub.messages("!instagram:local", 2, first.nextBefore!);
      assert.equal(second.messages[0]?.attachments[0]?.name, "recovered photo");
      assert.equal(second.nextBefore, null);
      assert.equal(second.messages[0]?.eventId, "$old-backfill");
      assert.equal(second.messages[0]?.sentAt, new Date(1000).toISOString());
      assert.ok(
        calls.every((call) => !call.path.endsWith("/messages")),
        "the embedded reader does not ask the insertion-ordered Matrix page",
      );
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("embedded Telegram pages keep visible events ahead of room setup noise", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-telegram-timeline-"));
  const database = new DatabaseSync(path.join(directory, "homeserver.sqlite"));
  database.exec(`
    CREATE TABLE events (
      stream_order INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      type TEXT NOT NULL,
      state_key TEXT,
      content_json TEXT NOT NULL,
      origin_server_ts INTEGER NOT NULL,
      redacts TEXT,
      redacted_by TEXT
    );
  `);
  const insert = database.prepare(`
    INSERT INTO events (
      stream_order, event_id, room_id, sender, type, state_key,
      content_json, origin_server_ts, redacts, redacted_by
    ) VALUES (?, ?, '!telegram:local', ?, ?, ?, ?, ?, NULL, NULL)
  `);
  insert.run(
    1,
    "$slides",
    "@telegram_presenter:local",
    "m.room.message",
    null,
    JSON.stringify({
      body: "https://docs.google.com/presentation/d/tutorial/edit?usp=sharing",
      msgtype: "m.text",
      "com.beeper.linkpreviews": [{
        matched_url: "https://docs.google.com/presentation/d/tutorial/edit?usp=sharing",
        "og:title": "CS3210 Tutorial 1",
        "og:description": "Instrumentation, Profiling, Slurm, and Report Writing",
        "og:image": "mxc://local/tutorial",
        "og:image:type": "image/jpeg",
        "og:image:width": 1200,
        "og:image:height": 630,
      }],
    }),
    1_000,
  );
  // These are transport/setup rows, not fifty chat items. Before the reader
  // filtered at the database boundary they consumed the whole first page and
  // pushed the real link message out of sight.
  for (let index = 0; index < 55; index += 1)
    insert.run(
      2 + index,
      `$setup-${index}`,
      "@telegrambot:local",
      "m.room.power_levels",
      `setup-${index}`,
      "{}",
      1_100 + index,
    );
  insert.run(
    57,
    "$invite",
    "@telegrambot:local",
    "m.room.member",
    "@telegram_kaiwen:local",
    JSON.stringify({
      membership: "invite",
      displayname: "Kaiwen",
      "fi.mau.will_auto_accept": true,
    }),
    1_200,
  );
  insert.run(
    58,
    "$join",
    "@telegram_kaiwen:local",
    "m.room.member",
    "@telegram_kaiwen:local",
    JSON.stringify({membership: "join", displayname: "Kaiwen"}),
    1_201,
  );
  insert.run(
    59,
    "$followup",
    "@telegram_presenter:local",
    "m.room.message",
    null,
    JSON.stringify({body: "today's slides", msgtype: "m.text"}),
    1_202,
  );
  database.close();

  await withHub(
    {},
    async (hub) => {
      const page = await hub.messages("!telegram:local", 50);
      assert.equal(page.nextBefore, null, "invisible setup rows do not create a phantom older page");
      assert.deepEqual(page.messages.map((message) => message.body), [
        "today's slides",
        "https://docs.google.com/presentation/d/tutorial/edit?usp=sharing",
      ]);
      const preview = page.messages[1].linkPreview;
      assert.equal(preview?.title, "CS3210 Tutorial 1");
      assert.equal(preview?.source, "docs.google.com");
      assert.equal(preview?.imageUrl, "polymux-media://local/tutorial");
      assert.equal(preview?.imageWidth, 1200);
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("WhatsApp roster sync stays hidden while other membership notices remain visible", async () => {
  const members = [
    ["@whatsapp_alice:local", "WhatsApp Alice"],
    ["@telegram_alice:local", "Telegram Alice"],
    ["@signal_alice:local", "Signal Alice"],
    ["@facebook_alice:local", "Messenger Alice"],
    ["@meta_alice:local", "Instagram Alice"],
    ["@discord_alice:local", "Discord Alice"],
    ["@slack_alice:local", "Slack Alice"],
    ["@linkedin_alice:local", "LinkedIn Alice"],
    ["@googlechat_alice:local", "Google Chat Alice"],
    ["@gmessages_alice:local", "Google Messages Alice"],
    ["@twitter_alice:local", "X Alice"],
    ["@bluesky_alice:local", "Bluesky Alice"],
    ["@gvoice_alice:local", "Google Voice Alice"],
    ["@zulip_alice:local", "Zulip Alice"],
    ["@imessage_alice:local", "iMessage Alice"],
    ["@wechat_alice:local", "WeChat Alice"],
    ["@matrix-alice:local", "Matrix Alice"],
  ] as const;
  await withHub(
    {
      "GET /_matrix/client/v3/rooms/room1/messages": {
        body: {
          end: null,
          chunk: [
            ...members.map(([stateKey, name], index) => ({
              type: "m.room.member",
              event_id: `$member-${index}`,
              room_id: "room1",
              sender: stateKey,
              state_key: stateKey,
              origin_server_ts: 1_000 + index,
              content: {membership: "join", displayname: name},
            })),
            {
              type: "m.room.member",
              event_id: "$setup",
              room_id: "room1",
              sender: "@whatsappbot:local",
              state_key: "@whatsapp_setup:local",
              origin_server_ts: 2_000,
              content: {
                membership: "invite",
                displayname: "Transport puppet",
                "com.beeper.exclude_from_timeline": true,
              },
            },
          ],
        },
      },
    },
    async (hub) => {
      const {messages} = await hub.messages("room1", 50);
      const visibleMembers = members.filter(([stateKey]) => !stateKey.startsWith("@whatsapp_"));
      assert.equal(messages.length, visibleMembers.length);
      assert.deepEqual(
        messages.map((message) => [message.body, message.notice]),
        visibleMembers.map(([, name]) => [`${name} joined the group`, true]),
      );
    },
  );
});

test("the signed-in user's membership activity stays out of the conversation", async () => {
  await withHub(
    {
      "GET /_matrix/client/v3/rooms/room1/messages": {
        body: {
          end: null,
          chunk: [
            {
              type: "m.room.member",
              event_id: "$self-join",
              room_id: "room1",
              sender: "@me:local",
              state_key: "@me:local",
              origin_server_ts: 1_000,
              content: {membership: "join", displayname: "Unknown user"},
            },
            {
              type: "m.room.member",
              event_id: "$self-rename",
              room_id: "room1",
              sender: "@me:local",
              state_key: "@me:local",
              origin_server_ts: 2_000,
              unsigned: {prev_content: {membership: "join", displayname: "Unknown user"}},
              content: {membership: "join", displayname: "Carlvince Tan"},
            },
            {
              type: "m.room.member",
              event_id: "$alice-join",
              room_id: "room1",
              sender: "@telegram_alice:local",
              state_key: "@telegram_alice:local",
              origin_server_ts: 3_000,
              content: {membership: "join", displayname: "Alice"},
            },
          ],
        },
      },
    },
    async (hub) => {
      const {messages} = await hub.messages("room1", 50);
      assert.deepEqual(messages.map((message) => message.body), ["Alice joined the group"]);
    },
  );
});

test("profile-only membership refreshes stay out of every platform conversation", async () => {
  const profileRefreshes = COMMS_PLATFORMS.map((platform, index) => ({
    type: "m.room.member",
    event_id: `$${platform.value}-profile`,
    room_id: "room1",
    sender: `@${platform.value}_contact:local`,
    state_key: `@${platform.value}_contact:local`,
    origin_server_ts: index + 1,
    unsigned: {
      prev_content: {membership: "join", displayname: `${platform.label} contact`},
    },
    content: {membership: "join", displayname: `Real ${platform.label} contact`},
  }));
  await withHub(
    {
      "GET /_matrix/client/v3/rooms/room1/messages": {
        body: {end: null, chunk: profileRefreshes},
      },
    },
    async (hub) => {
      const {messages} = await hub.messages("room1", 50);
      assert.deepEqual(messages, []);
    },
  );
});

test("bridge auto-accept membership setup stays out of every platform conversation", async () => {
  const setup = COMMS_PLATFORMS.flatMap((platform, index) => {
    const stateKey = `@${platform.value}_contact:local`;
    const invite = {
      type: "m.room.member",
      event_id: `$${platform.value}-setup-invite`,
      room_id: "room1",
      sender: `@${platform.value}bot:local`,
      state_key: stateKey,
      origin_server_ts: index * 2 + 1,
      content: {
        membership: "invite",
        displayname: `${platform.label} contact`,
        "fi.mau.will_auto_accept": true,
      },
    };
    return [invite, {
      type: "m.room.member",
      event_id: `$${platform.value}-setup-join`,
      room_id: "room1",
      sender: stateKey,
      state_key: stateKey,
      origin_server_ts: index * 2 + 2,
      unsigned: {prev_content: invite.content},
      content: {membership: "join", displayname: `${platform.label} contact`},
    }];
  });
  await withHub(
    {
      "GET /_matrix/client/v3/rooms/room1/messages": {
        body: {end: null, chunk: setup},
      },
    },
    async (hub) => {
      const {messages} = await hub.messages("room1", 100);
      assert.deepEqual(messages, []);
    },
  );
});

test("embedded rooms hide setup and profile sync but retain real membership changes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-membership-timeline-"));
  const database = new DatabaseSync(path.join(directory, "homeserver.sqlite"));
  database.exec(`
    CREATE TABLE events (
      stream_order INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      type TEXT NOT NULL,
      state_key TEXT,
      content_json TEXT NOT NULL,
      origin_server_ts INTEGER NOT NULL,
      redacts TEXT,
      redacted_by TEXT
    );
    INSERT INTO events VALUES
      (1, '$create', '!telegram:local', '@telegrambot:local', 'm.room.create', '', '{}', 1000, NULL, NULL),
      (2, '$setup', '!telegram:local', '@telegram_alice:local', 'm.room.member', '@telegram_alice:local', '{"membership":"join","displayname":"Setup Alice"}', 2000, NULL, NULL),
      (3, '$rename', '!telegram:local', '@telegram_alice:local', 'm.room.member', '@telegram_alice:local', '{"membership":"join","displayname":"Alice"}', 400000, NULL, NULL),
      (4, '$bob-invite', '!telegram:local', '@telegrambot:local', 'm.room.member', '@telegram_bob:local', '{"membership":"invite","displayname":"Bob","fi.mau.will_auto_accept":true}', 2001, NULL, NULL),
      (5, '$bob-setup-join', '!telegram:local', '@telegram_bob:local', 'm.room.member', '@telegram_bob:local', '{"membership":"join","displayname":"Bob","com.beeper.exclude_from_timeline":true}', 2002, NULL, NULL),
      -- The hidden setup join must not hide Bob's real later departure.
      (6, '$leave', '!telegram:local', '@telegram_bob:local', 'm.room.member', '@telegram_bob:local', '{"membership":"leave","displayname":"Bob"}', 401000, NULL, NULL),
      (7, '$self-join', '!telegram:local', '@me:local', 'm.room.member', '@me:local', '{"membership":"join","displayname":"Unknown user"}', 402000, NULL, NULL),
      (8, '$self-rename', '!telegram:local', '@me:local', 'm.room.member', '@me:local', '{"membership":"join","displayname":"Carlvince Tan"}', 403000, NULL, NULL),
      (9, '$message', '!telegram:local', '@telegram_alice:local', 'm.room.message', NULL, '{"msgtype":"m.text","body":"See you"}', 404000, NULL, NULL);
  `);
  database.close();

  await withHub(
    {},
    async (hub) => {
      const {messages} = await hub.messages("!telegram:local", 20);
      assert.deepEqual(messages.map((message) => message.body), [
        "See you",
        "Bob left the group",
      ]);
      assert.deepEqual(messages.map((message) => message.notice), [false, true]);
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("embedded WhatsApp resync membership does not enter the thread or its preview", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-whatsapp-membership-resync-"));
  const database = new DatabaseSync(path.join(directory, "homeserver.sqlite"));
  database.exec(`
    CREATE TABLE events (
      stream_order INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      type TEXT NOT NULL,
      state_key TEXT,
      content_json TEXT NOT NULL,
      origin_server_ts INTEGER NOT NULL,
      redacts TEXT,
      redacted_by TEXT
    );
    INSERT INTO events VALUES
      (1, '$create', '!whatsapp:local', '@whatsappbot:local', 'm.room.create', '', '{}', 1000, NULL, NULL),
      (2, '$joined', '!whatsapp:local', '@whatsapp_61426982339:local', 'm.room.member', '@whatsapp_61426982339:local', '{"membership":"join","displayname":"+61426982339"}', 2000, NULL, NULL),
      (3, '$resync-leave', '!whatsapp:local', '@whatsappbot:local', 'm.room.member', '@whatsapp_61426982339:local', '{"membership":"leave","displayname":"+61426982339"}', 401000, NULL, NULL),
      (4, '$message', '!whatsapp:local', '@whatsapp_alice:local', 'm.room.message', NULL, '{"body":"See you"}', 400000, NULL, NULL);
  `);
  database.close();

  await withHub(
    {
      "GET /_matrix/client/v3/sync": {
        body: {
          rooms: {
            join: {
              "!whatsapp:local": {
                state: {events: [
                  {type: "m.room.name", state_key: "", content: {name: "Group"}},
                  {type: "m.bridge", state_key: "whatsapp", content: {protocol: {id: "whatsapp"}}},
                ]},
                timeline: {events: []},
              },
            },
          },
        },
      },
    },
    async (hub) => {
      const page = await hub.messages("!whatsapp:local", 1);
      assert.deepEqual(page.messages.map((message) => message.body), ["See you"]);
      assert.equal(page.nextBefore, null, "hidden roster state does not create another page");

      const [room] = await hub.rooms();
      assert.equal(room?.preview, "See you");
      assert.equal(room?.lastActivity, new Date(400000).toISOString());
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
});

test("an external homeserver can enrich a plain cross-platform link", async () => {
  await withHub(
    {
      "GET /_matrix/client/v3/rooms/room1/messages": {
        body: {
          end: null,
          chunk: [{
            type: "m.room.message",
            event_id: "$link",
            room_id: "room1",
            sender: "@slack_alice:local",
            origin_server_ts: 1_000,
            content: {body: "See https://example.test/story", msgtype: "m.text"},
          }],
        },
      },
      "GET /_matrix/client/v1/media/preview_url": {
        body: {
          "og:title": "A useful story",
          "og:description": "The short version",
          "og:url": "https://example.test/story",
          "og:image": "mxc://local/story",
          "og:image:type": "image/jpeg",
          "og:image:width": 800,
          "og:image:height": 450,
        },
      },
    },
    async (hub, calls) => {
      const [message] = (await hub.messages("room1", 10)).messages;
      assert.equal(message.linkPreview?.title, "A useful story");
      assert.equal(message.linkPreview?.source, "example.test");
      assert.equal(message.linkPreview?.imageUrl, "polymux-media://local/story");
      const previewCall = calls.find((call) => call.path.endsWith("/preview_url"));
      assert.equal(previewCall?.query.url, "https://example.test/story");
    },
  );
});

test("embedded room rows keep new messages ahead of later-inserted backfill", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-room-order-"));
  const database = new DatabaseSync(path.join(directory, "homeserver.sqlite"));
  database.exec(`
    CREATE TABLE events (
      stream_order INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      type TEXT NOT NULL,
      state_key TEXT,
      content_json TEXT NOT NULL,
      origin_server_ts INTEGER NOT NULL,
      redacts TEXT,
      redacted_by TEXT
    );
    INSERT INTO events VALUES
      (1, '$today', '!instagram:local', '@meta_friend:local', 'm.room.message', NULL, '{"body":"today"}', 3000, NULL, NULL),
      -- Imported afterward, but authored first: it must not replace the row's
      -- current preview, timestamp, or position.
      (2, '$old-backfill', '!instagram:local', '@meta_friend:local', 'm.room.message', NULL, '{"body":"old"}', 1000, NULL, NULL),
      -- The signed-in account's own profile rewrite is Matrix bookkeeping,
      -- not newer conversation activity.
      (3, '$self-profile', '!instagram:local', '@me:local', 'm.room.member', '@me:local', '{"membership":"join","displayname":"Carlvince Tan"}', 4000, NULL, NULL);
  `);
  database.close();

  await withHub(
    {
      "GET /_matrix/client/v3/sync": {
        body: {rooms: {join: {
          "!instagram:local": {
            state: {events: [
              {type: "m.room.name", state_key: "", content: {name: "Friends"}},
              {type: "m.bridge", state_key: "instagram", content: {protocol: {id: "instagram"}}},
            ]},
            timeline: {events: [{
              event_id: "$old-backfill",
              room_id: "!instagram:local",
              sender: "@meta_friend:local",
              type: "m.room.message",
              origin_server_ts: 1000,
              content: {body: "old"},
            }]},
          },
        }}},
      },
    },
    async (hub) => {
      const [room] = await hub.rooms();
      assert.equal(room.preview, "today");
      assert.equal(room.lastActivity, new Date(3000).toISOString());
    },
    {matrixToken: "syt_token", userId: "@me:local"},
    directory,
  );
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

test("reactions carry each reactor's resolved profile and deduplicate one person's emoji", async () => {
  await withHub(
    {
      "GET /_matrix/client/v3/rooms/room1/messages": {
        body: {
          end: null,
          state: [
            {type: "m.room.member", state_key: "@whatsapp_jules:local", content: {displayname: "Jules (WA)"}},
            {type: "m.room.member", state_key: "@whatsapp_amy:local", content: {displayname: "Amy (WA)", avatar_url: "mxc://local/amy"}},
            {type: "m.room.member", state_key: "@whatsapp_ben:local", content: {displayname: "Ben (WA)"}},
            {type: "m.room.member", state_key: "@me:local", content: {displayname: "Carlvince", avatar_url: "mxc://local/me"}},
          ],
          chunk: [
            {
              type: "m.room.message",
              event_id: "$message",
              room_id: "room1",
              sender: "@whatsapp_jules:local",
              origin_server_ts: 1_000,
              content: {body: "Hello"},
            },
            {
              type: "m.reaction",
              event_id: "$mine",
              sender: "@me:local",
              content: {"m.relates_to": {event_id: "$message", key: "👍"}},
            },
            {
              type: "m.reaction",
              event_id: "$amy",
              sender: "@whatsapp_amy:local",
              content: {"m.relates_to": {event_id: "$message", key: "👍"}},
            },
            {
              type: "m.reaction",
              event_id: "$amy-duplicate",
              sender: "@whatsapp_amy:local",
              content: {"m.relates_to": {event_id: "$message", key: "👍"}},
            },
            {
              type: "m.reaction",
              event_id: "$ben",
              sender: "@whatsapp_ben:local",
              content: {"m.relates_to": {event_id: "$message", key: "👍"}},
            },
          ],
        },
      },
    },
    async (hub) => {
      const {messages} = await hub.messages("room1", 20);
      assert.deepEqual(messages[0]?.reactions, [{
        key: "👍",
        count: 3,
        mineEventId: "$mine",
        reactors: [
          {id: "@me:local", name: "You", avatarUrl: "polymux-media://local/me", mine: true},
          {id: "@whatsapp_amy:local", name: "Amy", avatarUrl: "polymux-media://local/amy", mine: false},
          {id: "@whatsapp_ben:local", name: "Ben", avatarUrl: null, mine: false},
        ],
      }]);
    },
  );
});

test("late reactions follow historical message ids across bridge platforms and pages", async () => {
  for (const platform of ["telegram", "instagram", "whatsapp", "messenger"]) {
    const directory = await mkdtemp(path.join(tmpdir(), `polymux-${platform}-reaction-alias-`));
    const bridgeDirectory = path.join(directory, "bridges", platform);
    await mkdir(bridgeDirectory, {recursive: true});
    const homeserver = new DatabaseSync(path.join(directory, "homeserver.sqlite"));
    homeserver.exec(`
      CREATE TABLE events (
        stream_order INTEGER PRIMARY KEY,
        event_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        type TEXT NOT NULL,
        state_key TEXT,
        content_json TEXT NOT NULL,
        origin_server_ts INTEGER NOT NULL,
        redacts TEXT,
        redacted_by TEXT
      );
      INSERT INTO events VALUES
        (1, '$local-old', '!chat:local', '@${platform}_alice:local', 'm.room.message', NULL, '{"body":"old"}', 1700000000000, NULL, NULL),
        (2, '$local-new', '!chat:local', '@${platform}_alice:local', 'm.room.message', NULL, '{"body":"new"}', 1700000001000, NULL, NULL),
        (3, '$late-reaction', '!chat:local', '@${platform}_bob:local', 'm.reaction', NULL, '{"m.relates_to":{"rel_type":"m.annotation","event_id":"$old-server-id:example.org","key":"🔥"}}', 1700000002000, NULL, NULL);
    `);
    homeserver.close();

    const bridge = new DatabaseSync(path.join(bridgeDirectory, "bridge.db"));
    bridge.exec(`
      CREATE TABLE portal (
        bridge_id TEXT NOT NULL,
        id TEXT NOT NULL,
        receiver TEXT NOT NULL,
        mxid TEXT
      );
      CREATE TABLE message (
        rowid INTEGER PRIMARY KEY,
        bridge_id TEXT NOT NULL,
        id TEXT NOT NULL,
        part_id TEXT NOT NULL,
        mxid TEXT NOT NULL,
        room_id TEXT NOT NULL,
        room_receiver TEXT NOT NULL,
        sender_mxid TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      INSERT INTO portal VALUES ('${platform}', 'remote-chat', 'account', '!chat:local');
      INSERT INTO message VALUES (
        1, '${platform}', 'remote-message', '', '$old-server-id:example.org',
        'remote-chat', 'account', '@${platform}_alice:local', 1700000000000000000
      );
    `);
    bridge.close();

    await withHub(
      {},
      async (hub) => {
        const first = await hub.messages("!chat:local", 1);
        assert.deepEqual(first.messages.map((message) => message.eventId), ["$local-new"]);
        assert.match(first.nextBefore ?? "", /^local:/);

        const second = await hub.messages("!chat:local", 1, first.nextBefore!);
        assert.equal(second.messages[0]?.eventId, "$local-old");
        assert.equal(second.messages[0]?.reactions[0]?.key, "🔥");
        assert.equal(second.messages[0]?.reactions[0]?.count, 1);
        assert.equal(
          second.messages[0]?.reactions[0]?.reactors[0]?.id,
          `@${platform}_bob:local`,
        );
      },
      {matrixToken: "syt_token", userId: "@me:local"},
      directory,
    );
  }
});

test("an Instagram reel cover keeps a route to the original post", async () => {
  await withHub(
    {
      "GET /_matrix/client/v3/rooms/room1/messages": {
        body: {
          end: null,
          chunk: [
            {
              type: "m.room.message",
              event_id: "$reel-cover",
              room_id: "room1",
              sender: "@instagram_1:local",
              origin_server_ts: 1_000,
              content: {
                body: "Reel cover",
                msgtype: "m.image",
                url: "mxc://local/reel-cover",
                external_url: "https://www.instagram.com/reel/example/",
                info: {mimetype: "image/jpeg", w: 720, h: 1280},
              },
            },
          ],
        },
      },
    },
    async (hub) => {
      const {messages} = await hub.messages("room1", 10);
      assert.equal(messages[0].attachments[0]?.kind, "image");
      assert.deepEqual(messages[0].viewIn, {
        app: "Instagram",
        url: "https://www.instagram.com/reel/example/",
      });
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

test("only a same-author native update fills a missing reply and existing targets remain fixed", async () => {
  for (const [native, sender, originalTarget, expected] of [
    [true, "@wechat_me:local", undefined, "$original-image"],
    [true, "@someone_else:local", undefined, null],
    [false, "@wechat_me:local", undefined, null],
    [true, "@wechat_me:local", "$existing-target", "$existing-target"],
  ] as const) {
    await withHub({"GET /_matrix/client/v3/rooms/room1/messages": {body: {end: null, chunk: [
      {type: "m.room.message", event_id: "$edit", sender, origin_server_ts: 2000,
        content: {"m.relates_to": {rel_type: "m.replace", event_id: "$image"},
          "m.new_content": {msgtype: "m.image", body: "Image", url: "mxc://local/image",
            "co.polymux.wechat.remote": true,
            "m.relates_to": {"m.in_reply_to": {event_id: "$original-image"}}}}},
      {type: "m.room.message", event_id: "$image", sender: "@wechat_me:local", origin_server_ts: 1000,
        content: {msgtype: "m.image", body: "Image", url: "mxc://local/image",
          "co.polymux.wechat.remote": native,
          ...(originalTarget ? {"m.relates_to": {"m.in_reply_to": {event_id: originalTarget}}} : {})}},
    ]}}}, async hub => {
      const {messages} = await hub.messages("room1", 10);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].replyTo, expected);
    });
  }
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
    await hub.logout("whatsapp", "wa-1");
    assert.equal(calls[0].path, `${WA}/logout/wa-1`);
    assert.equal(calls[0].method, "POST");
  });
});

test("reports a bridge without v3 routes as unreachable", async () => {
  await withHub(
    {
      "GET /bridges/whatsapp/_matrix/provision/v3/whoami": {
        status: 404,
        body: {errcode: "M_NOT_FOUND"},
      },
    },
    async (hub) => {
      const bridge = await hub.bridge("whatsapp", "WhatsApp", "whatsapp");
      assert.equal(bridge.api, "bridgev2");
      assert.equal(bridge.state, "unreachable");
      assert.match(bridge.error ?? "", /provisioning API/);
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

test("sends structured mentions with an idempotent transaction id", async () => {
  const sent: Array<{path: string; body: Record<string, unknown>}> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      sent.push({
        path: new URL(request.url ?? "/", "http://127.0.0.1").pathname,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      });
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
    assert.equal(await hub.send(
      "!room:local",
      "Hello @alice & @everyone",
      undefined,
      {
        users: [{userId: "@telegram_alice:local", label: "@alice"}],
        everyone: true,
      },
    ), "$evt");
    assert.match(sent[0].path, /^\/_matrix\/client\/v3\/rooms\/!room%3Alocal\/send\/m\.room\.message\/polymux-/);
    assert.deepEqual(sent[0].body["m.mentions"], {
      user_ids: ["@telegram_alice:local"],
      room: true,
    });
    assert.equal(
      sent[0].body.formatted_body,
      'Hello <a href="https://matrix.to/#/@telegram_alice:local">@alice</a> &amp; @everyone',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("lists mentionable joined members without the signed-in user or bridge bot", async () => {
  await withHub(
    {
      "GET /_matrix/client/v3/rooms/!group%3Alocal/joined_members": {
        body: {
          joined: {
            "@me:local": {display_name: "Me"},
            "@telegrambot:local": {display_name: "Telegram bridge"},
            "@telegram_alice:local": {
              display_name: "Alice",
              avatar_url: "mxc://local/alice",
            },
          },
        },
      },
    },
    async (hub) => {
      assert.deepEqual(await hub.members("!group:local"), [{
        userId: "@telegram_alice:local",
        name: "Alice",
        avatarUrl: "polymux-media://local/alice",
      }]);
    },
  );
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

/** The secret is found wherever the provisioning block sits. */
test("the provisioning secret is found in either config layout", () => {
  const modern = [
    "provisioning:",
    "    shared_secret: modern-secret",
    "    allow_matrix_auth: true",
    "",
  ].join("\n");
  assert.equal(provisioningSecret(modern), "modern-secret");

  // Nested under `bridge:`, with the comments the binary writes back when
  // it upgrades the file in place.
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


test("call summaries stay in authored bubbles across bridge formats", async () => {
  const room = "!calls:local";
  const contents = [
    {msgtype:"m.text",body:"[Call]","co.polymux.wechat.remote":true,
      "co.polymux.wechat.native":{kind:"call",body:"<voipmsg><msg>Duration: 18:55</msg></voipmsg>"}},
    {msgtype:"m.text",body:"Incoming voice call. Use the WhatsApp app to answer.",
      "com.beeper.action_message":{type:"call",call_type:"voice"}},
    {msgtype:"m.notice",body:"Call ended (18:55)"},
    {msgtype:"m.notice",body:"Changed the group name"},
  ];
  await withHub({"GET /_matrix/client/v3/rooms/!calls%3Alocal/messages":{body:{chunk:contents.map((content,i)=>({
    event_id:`$call${i}`,room_id:room,sender:"@peer:local",type:"m.room.message",origin_server_ts:1000+i,content,
  }))}}},async hub=>{
    const {messages}=await hub.messages(room,10);
    for(let i=0;i<3;i++) {
      const item=messages.find(m=>m.eventId===`$call${i}`)!;
      assert.equal(item.call?.kind,"voice");
      assert.equal(item.notice,false);
    }
    assert.equal(messages.find(m=>m.eventId==="$call0")?.call?.durationSeconds,1135);
    assert.equal(messages.find(m=>m.eventId==="$call2")?.call?.durationSeconds,1135);
    assert.equal(messages.find(m=>m.eventId==="$call3")?.notice,true);
    assert.equal(messages.find(m=>m.eventId==="$call3")?.call,undefined);
  });
});

test("WeChat's native ownership map fixes old imported authors only for its current owner and room", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wechat-ownership-map-"));
  const folder = path.join(directory,"bridges/wechat"); await mkdir(folder,{recursive:true});
  const state = {owner:"@me:local",roomToChat:{"!wechat:local":"wxid_peer"},ownMessageEvents:{wxid_peer:{$mine:true,$theirs:false}}};
  await writeFile(path.join(folder,"state.json"),JSON.stringify(state));
  const routes = {"GET /_matrix/client/v3/rooms/!wechat%3Alocal/messages": {body:{chunk:[
    {event_id:"$mine",sender:"@old:local",type:"m.room.message",origin_server_ts:1000,content:{msgtype:"m.text",body:"Own imported text"}},
    {event_id:"$theirs",sender:"@wechat_peer:local",type:"m.room.message",origin_server_ts:2000,content:{msgtype:"m.text",body:"Incoming text"}},
  ]}}};
  await withHub(routes,async hub=>{
    const page=await hub.messages("!wechat:local",10);
    assert.equal(page.messages.find(m=>m.eventId==="$mine")?.mine,true);
    assert.equal(page.messages.find(m=>m.eventId==="$theirs")?.mine,false);
    state.owner="@someoneelse:local";
    await writeFile(path.join(folder,"state.json"),JSON.stringify(state));
    assert.equal((await hub.messages("!wechat:local",10)).messages.find(m=>m.eventId==="$mine")?.mine,false);
  },undefined,directory);
});
