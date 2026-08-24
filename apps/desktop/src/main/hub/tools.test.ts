import assert from "node:assert/strict";
import test from "node:test";
import {Communications, matchContactChats, resolveChatAliasFromRooms} from "./index.js";
import type {EmailAccounts} from "@polymux/hub";
import {createCommunicationsTools} from "./tools.js";

function toolResult(value: {content?: unknown}): unknown {
  return JSON.parse(String(value.content));
}

test("hub_state returns complete compact requested surfaces without message bodies", async () => {
  let statusCalls = 0;
  let chatCalls = 0;
  const tools = createCommunicationsTools({
    async status() {
      statusCalls += 1;
      return {
        bridges: [{
          platform: "whatsapp", name: "WhatsApp", state: "connected",
          accounts: [{id: "wa-1", name: "Personal"}],
        }],
        email: {accounts: [{
          id: "mail-1", email: "me@example.com", displayName: "Me",
          isDefault: true, status: "ok",
        }]},
      };
    },
    async chats() {
      chatCalls += 1;
      return [{
        roomId: "room-1", name: "Dad", platform: "whatsapp",
        unread: 2, lastActivity: "2026-08-24T01:00:00Z", preview: "private body",
      }];
    },
  } as unknown as Communications);
  const tool = tools.find((candidate) => candidate.name === "hub_state")!;

  assert.deepEqual(toolResult(await tool.execute({kinds: ["platforms", "accounts", "chats"]}, {} as never)), {
    platforms: [{
      platform: "whatsapp", name: "WhatsApp", state: "connected",
      accounts: [{id: "wa-1", name: "Personal"}],
    }],
    accounts: [{
      account: "mail-1", email: "me@example.com", display_name: "Me",
      default: true, status: "ok",
    }],
    chats: [{
      chat_id: "room-1", name: "Dad", platform: "whatsapp", unread: 2,
      updated_at: "2026-08-24T01:00:00Z",
    }],
  });
  assert.equal(statusCalls, 1);
  assert.equal(chatCalls, 1);
});

test("hub_state reads only the requested surface kind", async () => {
  let statusCalls = 0;
  const tools = createCommunicationsTools({
    status: async () => { statusCalls += 1; throw new Error("not needed"); },
    chats: async (): Promise<never[]> => [],
  } as unknown as Communications);
  const tool = tools.find((candidate) => candidate.name === "hub_state")!;

  assert.deepEqual(toolResult(await tool.execute({kinds: ["chats"]}, {} as never)), {chats: []});
  assert.equal(statusCalls, 0);
});

test("message tools include current connected coverage without probing", async () => {
  let coverageCalls = 0;
  let searchCalls = 0;
  const tools = createCommunicationsTools({
    messageCoverage() {
      coverageCalls += 1;
      return [{platform: "whatsapp", state: "connected", live: true}];
    },
    async searchChats() {
      searchCalls += 1;
      return {nextBatch: null as string | null, messages: [{body: "hello", platform: "whatsapp"}]};
    },
  } as unknown as Communications);
  const tool = tools.find((candidate) => candidate.name === "message_search")!;

  const result = toolResult(await tool.execute({query: "Dad"}, {} as never));

  assert.deepEqual(result, {
    coverage: [{platform: "whatsapp", state: "connected", live: true}],
    next_batch: null,
    messages: [{body: "hello", platform: "whatsapp"}],
  });
  assert.equal(searchCalls, 1);
  assert.equal(coverageCalls, 1, "coverage is a cached snapshot, not another status probe");
});

test("message search marks logged-out cached WhatsApp coverage as non-live", async () => {
  const tools = createCommunicationsTools({
    messageCoverage: () => [{platform: "whatsapp", state: "logged-out", live: false}],
    searchChats: async () => ({
      nextBatch: null as string | null,
      messages: [{body: "cached Dad match", platform: "whatsapp"}],
    }),
  } as unknown as Communications);
  const tool = tools.find((candidate) => candidate.name === "message_search")!;

  const result = toolResult(await tool.execute({query: "Dad"}, {} as never)) as {
    coverage: Array<{platform: string; state: string; live: boolean}>;
    messages: unknown[];
  };

  assert.deepEqual(result.coverage, [
    {platform: "whatsapp", state: "logged-out", live: false},
  ]);
  assert.equal(result.messages.length, 1, "historical matches remain available with an explicit warning");
  assert.match(tool.description, /cached/i);
  assert.match(tool.description, /latest/i);
});

test("message chat lists preserve cached rooms beside disconnected coverage", async () => {
  const tools = createCommunicationsTools({
    messageCoverage: () => [{platform: "whatsapp", state: "logged-out", live: false}],
    resolveChatAlias: async () => ({
      status: "direct", identities: [] as never[],
      chats: [{roomId: "room-1", name: "Dad", platform: "whatsapp"}],
    }),
  } as unknown as Communications);
  const tool = tools.find((candidate) => candidate.name === "message_chats")!;

  assert.deepEqual(toolResult(await tool.execute({query: "Dad"}, {} as never)), {
    coverage: [{platform: "whatsapp", state: "logged-out", live: false}],
    resolution: {status: "direct", contact_matches: 0, chat_matches: 1, ambiguous: false},
    chats: [{chat_id: "room-1", name: "Dad", platform: "whatsapp"}],
  });
});

test("message_chats refuses an accidental unfiltered inventory", async () => {
  let listed = false;
  const tools = createCommunicationsTools({
    chats: async () => { listed = true; return [{roomId: "private", name: "Private", platform: "wechat"}]; },
  } as unknown as Communications);
  const tool = tools.find((candidate) => candidate.name === "message_chats")!;
  const result = await tool.execute({}, {} as never);
  assert.equal(result.isError, true);
  assert.equal(listed, false);
  assert.doesNotMatch(result.content as string, /Private/);
});

test("contact aliases match chats by real name or normalized phone without guessing", () => {
  const rooms = [
    {roomId: "name", name: "Alex Tan", platform: "whatsapp"},
    {roomId: "phone", name: "+61 412 345 678", platform: "whatsapp"},
    {roomId: "other", name: "Unrelated", platform: "whatsapp"},
  ] as never;
  const matches = matchContactChats(rooms, [{
    name: "Alex Tan", aliases: ["Dad", "Father"], phones: ["0412 345 678"],
  }]);
  assert.deepEqual(matches.map((room) => room.roomId), ["name", "phone"]);
});

test("an exact chat-name hit never pays for Contacts lookup", async () => {
  let lookups = 0;
  const result = await resolveChatAliasFromRooms(
    [{roomId: "dad", name: "Dad", platform: "whatsapp"}] as never,
    "dad",
    async () => {
      lookups += 1;
      return {status: "granted", matches: []};
    },
  );
  assert.equal(result.status, "direct");
  assert.equal(result.chats[0]?.roomId, "dad");
  assert.equal(lookups, 0);
});

test("an explicitly remembered alias survives a changed room id", async () => {
  let lookups = 0;
  const result = await resolveChatAliasFromRooms(
    [{roomId: "new-room", name: "Alex Tan", platform: "whatsapp"}] as never,
    "Dad",
    async () => { lookups += 1; return {status: "granted", matches: []}; },
    [{alias: "Dad", roomId: "old-room", name: "Alex Tan", platform: "whatsapp"}],
  );
  assert.equal(result.status, "remembered");
  assert.equal(result.chats[0]?.roomId, "new-room");
  assert.equal(lookups, 0);
});

test("linking an alias requires an exact chat and returns no message action", async () => {
  const calls: Array<{alias: string; chatId: string}> = [];
  const tools = createCommunicationsTools({
    async linkChatAlias(alias: string, chatId: string) {
      calls.push({alias, chatId});
      return {alias, roomId: chatId, name: "Alex Tan", platform: "whatsapp"};
    },
  } as unknown as Communications);
  const tool = tools.find((candidate) => candidate.name === "message_link_alias")!;
  const result = toolResult(await tool.execute({alias: "Dad", chat_id: "room-1"}, {} as never));
  assert.deepEqual(calls, [{alias: "Dad", chatId: "room-1"}]);
  assert.deepEqual(result, {remembered: true, alias: "Dad", name: "Alex Tan", platform: "whatsapp"});
  assert.match(tool.description, /explicitly states or confirms/i);
  assert.match(tool.description, /sends nothing/i);
});

test("ambiguous contact resolution is exposed instead of silently selecting a room", async () => {
  const tools = createCommunicationsTools({
    messageCoverage: () => [{platform: "whatsapp", state: "connected", live: true}],
    resolveChatAlias: async () => ({
      status: "granted",
      identities: [
        {name: "Alex Tan", aliases: ["Dad"], phones: [] as string[]},
        {name: "Alexander Tan", aliases: ["Dad"], phones: [] as string[]},
      ],
      chats: [
        {roomId: "one", name: "Alex Tan", platform: "whatsapp"},
        {roomId: "two", name: "Alexander Tan", platform: "whatsapp"},
      ],
    }),
  } as unknown as Communications);
  const tool = tools.find((candidate) => candidate.name === "message_chats")!;
  const result = toolResult(await tool.execute({query: "Dad"}, {} as never)) as {
    resolution: {ambiguous: boolean}; chats: unknown[];
  };
  assert.equal(result.resolution.ambiguous, true);
  assert.equal(result.chats.length, 2);
  assert.match(tool.description, /never guess/i);
});

test("the all-inbox search does not change the normal tool surface", () => {
    const tools = createCommunicationsTools({} as Communications);
    assert.equal(tools.some((tool) => tool.name === "email_search_all"), false);
});

test("one unified tool call searches every account", async () => {
    const calls: Array<{queries: string[]; limitPerQuery: number; maxResults: number; timeoutMs?: number}> = [];
    const emailSearchAll = async (options: {queries: string[]; limitPerQuery: number; maxResults: number; timeoutMs?: number}) => {
      calls.push(options);
      return [
      {account: "nus", email: "student@example.edu", messages: [{id: "42"}]},
      ];
    };
    const tools = createCommunicationsTools(
      {emailSearchAll} as unknown as Communications,
      {searchAllEmail: true, searchAllEmailTimeoutMs: 3_500},
    );
    const tool = tools.find((candidate) => candidate.name === "email_search_all");

    assert.ok(tool);
    const result = await tool.execute(
      {queries: ["since 1-Aug-2026 subject NUS"], limitPerQuery: 4, maxResults: 8},
      {} as never,
    );

    assert.deepEqual(calls, [{
      queries: ["since 1-Aug-2026 subject NUS"],
      limitPerQuery: 4,
      maxResults: 8,
      timeoutMs: 3_500,
    }]);
    assert.deepEqual(JSON.parse(result.content as string), [
      {account: "nus", email: "student@example.edu", messages: [{id: "42"}]},
    ]);
});

test("one worker run cannot repeat the all-inbox search", async () => {
  let calls = 0;
  const tools = createCommunicationsTools(
    {emailSearchAll: async () => {
      calls += 1;
      return {messages: [{id: "one"}], errors: []} as never;
    }} as unknown as Communications,
    {searchAllEmail: true},
  );
  const tool = tools.find((candidate) => candidate.name === "email_search_all")!;
  const context = {runId: "worker-1"} as never;

  await tool.execute({queries: ["subject NUS"]}, context);
  const repeated = await tool.execute({queries: ["subject Singapore"]}, context);
  await tool.execute({queries: ["subject Singapore"]}, {runId: "worker-2"} as never);

  assert.equal(calls, 2, "a second worker remains independent");
  assert.deepEqual(JSON.parse(repeated.content as string), {
    searchComplete: true,
    reused: true,
    messageCount: 1,
    errorCount: 0,
    note: "The bounded all-inbox search already completed in this worker run. Use its earlier results; do not search the same mailboxes again.",
  });
});

test("all-inbox search deduplicates, caps, compacts, and isolates account failures", async () => {
  const queries: Array<{account: string; query?: string}> = [];
  const envelope = (id: string, date: string) => ({
    id,
    subject: `Subject ${id}`,
    from: {name: "Sender", address: "sender@example.com"},
    to: null as never,
    date,
    seen: false,
    flagged: false,
    answered: false,
    draft: false,
    hasAttachment: false,
    preview: `Preview ${id}`,
  });
  const email = {
    async list() {
      return [
        {id: "good", email: "good@example.com"},
        {id: "broken", email: "broken@example.com"},
      ];
    },
    async envelopes(options: {account: string; query?: string}) {
      queries.push({account: options.account, query: options.query});
      if (options.account === "broken") throw new Error("mailbox offline");
      return options.query?.includes("NUS")
        ? [envelope("same", "2026-08-18T00:00:00Z"), envelope("older", "2026-08-17T00:00:00Z")]
        : [envelope("newer", "2026-08-20T00:00:00Z"), envelope("same", "2026-08-18T00:00:00Z")];
    },
  } as unknown as EmailAccounts;
  const comms = new Communications({
    credentials: {} as never,
    storage: {getPreference: () => undefined, setPreference: () => {}},
    onChange: () => {},
    home: "/tmp/polymux-email-search-test",
    email,
  });

  const result = await comms.emailSearchAll({
    queries: ["since 5-Aug-2026 subject NUS", "since 5-Aug-2026 subject Singapore"],
    limitPerQuery: 5,
    maxResults: 2,
  });

  assert.deepEqual(result.errors, [
    {
      account: "broken",
      email: "broken@example.com",
      query: "since 5-Aug-2026 subject NUS",
      error: "mailbox offline",
    },
    {
      account: "broken",
      email: "broken@example.com",
      query: "since 5-Aug-2026 subject Singapore",
      error: "mailbox offline",
    },
  ]);
  assert.deepEqual(result.messages.map((message) => message.id), ["newer", "same"]);
  assert.deepEqual(Object.keys(result.messages[0]!).sort(), [
    "account", "date", "email", "from", "hasAttachment", "id", "preview", "subject",
  ]);
  assert.equal(queries.length, 4);
});

test("all-inbox search bounds a stalled mailbox without hiding healthy results", async () => {
  const email = {
    async list() {
      return [
        {id: "healthy", email: "healthy@example.com"},
        {id: "stalled", email: "stalled@example.com"},
      ];
    },
    async envelopes(options: {account: string}) {
      if (options.account === "stalled") return new Promise<never>(() => {});
      return [{
        id: "match", subject: "Singapore update",
        from: {name: "NUS", address: "nus@example.edu"}, to: null as never,
        date: "2026-08-20T00:00:00Z", seen: false, flagged: false,
        answered: false, draft: false, hasAttachment: false, preview: "Update",
      }];
    },
  } as unknown as EmailAccounts;
  const comms = new Communications({
    credentials: {} as never,
    storage: {getPreference: () => undefined, setPreference: () => {}},
    onChange: () => {},
    home: "/tmp/polymux-email-timeout-test",
    email,
  });

  const started = Date.now();
  const result = await comms.emailSearchAll({
    queries: ["since 5-Aug-2026 subject Singapore"],
    limitPerQuery: 5,
    maxResults: 5,
    timeoutMs: 20,
  });

  assert.ok(Date.now() - started < 500);
  assert.deepEqual(result.messages.map((message) => message.id), ["match"]);
  assert.deepEqual(result.errors, [{
    account: "stalled",
    email: "stalled@example.com",
    query: "since 5-Aug-2026 subject Singapore",
    error: "Mailbox search timed out after 20 ms",
  }]);
});

test("all-inbox search merges Apple Mail coverage without another agent call", async () => {
  const email = {
    async list(): Promise<Array<{id: string; email: string}>> { return []; },
  } as unknown as EmailAccounts;
  let fallbacks = 0;
  const comms = new Communications({
    credentials: {} as never,
    storage: {getPreference: () => undefined, setPreference: () => {}},
    onChange: () => {},
    home: "/tmp/polymux-apple-mail-search-test",
    email,
    appleMailSearch: async ({queries, maxResults}) => {
      fallbacks += 1;
      assert.deepEqual(queries, ["since 20-Aug-2026 subject NUS"]);
      assert.equal(maxResults, 5);
      return {messages: [{
        account: "apple-mail", email: "Apple Mail", id: "apple-1",
        subject: "NUS interview booking",
        from: {name: "NUS", address: "recruitment@nus.edu.sg"},
        date: "2026-08-21T00:00:00Z", preview: "Choose an interview slot.",
        hasAttachment: false,
      }], errors: []};
    },
  });

  const result = await comms.emailSearchAll({
    queries: ["since 20-Aug-2026 subject NUS"], limitPerQuery: 5, maxResults: 5,
  });

  assert.equal(fallbacks, 1);
  assert.deepEqual(result.messages.map((message) => message.id), ["apple-1"]);
  assert.deepEqual(result.errors, []);
});
