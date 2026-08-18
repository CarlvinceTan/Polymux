import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "@flareai/inference";
import type { WorkspaceRevealDto } from "@flareai/protocol";
import { createHubDraftTool, createWorkspaceTool, revealRequest } from "./tools.js";

function shown(input: JsonObject): Promise<WorkspaceRevealDto | null> {
  let last: WorkspaceRevealDto | null = null;
  const tool = createWorkspaceTool({ reveal: (request) => (last = request) });
  return tool
    .execute(input, {} as never)
    .then((result) => (result.isError ? null : last));
}

test("a mail target carries the mailbox, folder and message", async () => {
  assert.deepEqual(
    await shown({ surface: "hub", account: "gmail", folder: "Drafts", messageId: "42" }),
    { surface: "hub", mail: { account: "gmail", folder: "Drafts", messageId: "42" } },
  );
});

test("a draft with no id still names the folder, so the newest one opens", async () => {
  assert.deepEqual(await shown({ surface: "hub", account: "gmail", folder: "Drafts" }), {
    surface: "hub",
    mail: { account: "gmail", folder: "Drafts" },
  });
});

test("fields belonging to another surface are left out", () => {
  // A drive path on the hub surface would be acted on by nothing; carrying it
  // only invites a view to guess.
  assert.deepEqual(revealRequest({ surface: "hub", path: "/reports", account: "" }), {
    surface: "hub",
  });
});

test("an unknown surface is refused rather than guessed at", async () => {
  assert.equal(await shown({ surface: "settings" }), null);
});

test("a chat can be named when its id is not known", async () => {
  assert.deepEqual(await shown({ surface: "hub", chatName: "Mum" }), {
    surface: "hub",
    chat: { name: "Mum" },
  });
});

/** A hub with one mailbox and one chat linked, for the draft checks. */
const linkedHub = {
  mailAccounts: [{ id: "acct-1", email: "carl@live.com" }],
  chats: [{ id: "!room:flare", name: "Ming" }],
};

function draftTool(linked: typeof linkedHub | null = linkedHub) {
  let last: WorkspaceRevealDto | null = null;
  const tool = createHubDraftTool({
    reveal: (request) => (last = request),
    linked: async () => {
      if (!linked) throw new Error("hub unavailable");
      return linked;
    },
  });
  return {
    tool,
    run: (input: JsonObject, subagent = false) =>
      tool
        .execute(input, { subagent } as never)
        .then((result) => ({ ...result, shown: last })),
  };
}

test("a chat draft fills that chat's box, and sends nothing", async () => {
  const { run } = draftTool();
  const result = await run({ chatName: "Ming", draft: "On my way." });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.shown, {
    surface: "hub",
    chat: { name: "Ming", draft: "On my way." },
  });
});

test("a mail draft opens the composer, titling the new message rather than searching for one", async () => {
  const { run } = draftTool();
  const result = await run({
    account: "carl@live.com",
    to: "dana@example.com",
    subject: "Friday",
    draft: "Are we still on?",
  });
  assert.deepEqual(result.shown, {
    surface: "hub",
    mail: {
      account: "carl@live.com",
      compose: { to: "dana@example.com", subject: "Friday", body: "Are we still on?" },
    },
  });
});

test("a draft for an account that is not linked is refused, and names where the words belong", async () => {
  const { run } = draftTool();
  const result = await run({ account: "work@corp.com", draft: "Hello" });
  assert.equal(result.isError, true);
  assert.equal(typeof result.content, "string");
  assert.match(String(result.content), /not linked|No email account/);
  assert.match(String(result.content), /in your reply/);
  assert.equal(result.shown, null);
});

test("a draft for a chat that is not linked is refused too", async () => {
  const { run } = draftTool();
  const result = await run({ chatName: "Nobody", draft: "Hello" });
  assert.equal(result.isError, true);
  assert.equal(result.shown, null);
});

test("a hub that cannot answer keeps the draft out of it rather than guessing", async () => {
  const { run } = draftTool(null);
  const result = await run({ chatName: "Ming", draft: "Hello" });
  assert.equal(result.isError, true);
  assert.equal(result.shown, null);
});

test("navigating to an unlinked mailbox is still allowed — only drafts are checked", async () => {
  assert.deepEqual(await shown({ surface: "hub", account: "work@corp.com", folder: "Inbox" }), {
    surface: "hub",
    mail: { account: "work@corp.com", folder: "Inbox" },
  });
});

test("a chat draft can answer one message rather than the thread's end", async () => {
  const { run } = draftTool();
  const result = await run({
    chatId: "!room:flare",
    replyTo: "msg-7",
    draft: "Yes — 2pm.",
  });
  assert.deepEqual(result.shown, {
    surface: "hub",
    chat: { id: "!room:flare", draft: "Yes — 2pm.", replyTo: "msg-7" },
  });
});

test("a reply keeps naming the message it answers, and lets the composer title it", async () => {
  const { run } = draftTool();
  const result = await run({
    account: "carl@live.com",
    folder: "INBOX",
    messageId: "88",
    // A reply's subject is derived by the composer, so this one narrows the
    // search for the message rather than titling the answer.
    subject: "Invoice ready",
    mode: "reply",
    draft: "Thanks — paying today.",
  });
  assert.deepEqual(result.shown, {
    surface: "hub",
    mail: {
      account: "carl@live.com",
      folder: "INBOX",
      messageId: "88",
      subject: "Invoice ready",
      compose: { body: "Thanks — paying today.", mode: "reply" },
    },
  });
});

test("a forward carries the same shape, and may name a new recipient", async () => {
  const { run } = draftTool();
  const result = await run({
    account: "carl@live.com",
    messageId: "88",
    mode: "forward",
    to: "dana@example.com",
    draft: "Passing this on.",
  });
  assert.deepEqual(result.shown, {
    surface: "hub",
    mail: {
      account: "carl@live.com",
      messageId: "88",
      compose: { to: "dana@example.com", body: "Passing this on.", mode: "forward" },
    },
  });
});

test("a new message keeps subject as its title, not as a search", async () => {
  const { run } = draftTool();
  const result = await run({
    account: "carl@live.com",
    mode: "new",
    subject: "Friday",
    draft: "Are we still on?",
  });
  assert.deepEqual(result.shown, {
    surface: "hub",
    mail: {
      account: "carl@live.com",
      compose: { subject: "Friday", body: "Are we still on?", mode: "new" },
    },
  });
});

test("an unknown mode is dropped rather than passed through", () => {
  const request = revealRequest({
    surface: "hub",
    account: "carl@live.com",
    mode: "bounce",
    draft: "Hi",
  });
  assert.deepEqual(request?.mail?.compose, { body: "Hi" });
});

test("a drafted mail carries copies, attachments and its priority flag", async () => {
  const { run } = draftTool();
  const result = await run({
    account: "carl@live.com",
    to: "dana@example.com",
    cc: "sam@example.com, kit@example.com",
    bcc: "records@example.com",
    subject: "Friday",
    draft: "Are we still on?",
    attachments: ["/Users/carl/Documents/agenda.pdf", "  "],
    importance: "high",
  });
  assert.deepEqual(result.shown?.mail?.compose, {
    to: "dana@example.com",
    cc: "sam@example.com, kit@example.com",
    bcc: "records@example.com",
    subject: "Friday",
    body: "Are we still on?",
    // A blank path is dropped rather than becoming an attachment with no name.
    attachments: ["/Users/carl/Documents/agenda.pdf"],
    importance: "high",
  });
});

test("copies alone are enough to open the composer, with no words yet written", async () => {
  const { run } = draftTool();
  const result = await run({
    account: "carl@live.com",
    to: "dana@example.com",
    cc: "sam@example.com",
  });
  assert.deepEqual(result.shown?.mail?.compose, {
    to: "dana@example.com",
    cc: "sam@example.com",
  });
});

test("an importance the flag has no setting for is left off", () => {
  const request = revealRequest({
    surface: "hub",
    account: "carl@live.com",
    draft: "Hi",
    importance: "urgent!!",
  });
  assert.deepEqual(request?.mail?.compose, { body: "Hi" });
});

test("showing a surface belongs to the run the user is talking to", () => {
  // Several delegated runs finish at once; whichever called last would decide
  // what is on screen, so none of them get this tool at all.
  const tool = createWorkspaceTool({ reveal: () => {} });
  assert.equal(tool.mainAgentOnly, true);
});

test("drafting is not withheld from delegated runs — doing the work is the point", () => {
  const { tool } = draftTool();
  assert.equal(tool.mainAgentOnly, undefined);
});

test("a delegated run's draft lands without taking the screen, and says so", async () => {
  const { run } = draftTool();
  const result = await run({ chatName: "Ming", draft: "On my way." }, true);
  assert.equal(result.shown?.focus, false);
  assert.match(String(result.content), /without opening it/);
  assert.match(String(result.content), /"shown":false/);
});

test("the same draft from the user's own run does bring it forward", async () => {
  const { run } = draftTool();
  const result = await run({ chatName: "Ming", draft: "On my way." });
  assert.equal(result.shown?.focus, undefined);
  assert.match(String(result.content), /"shown":true/);
});

test("a draft with neither a chat nor an account is refused before anything is shown", async () => {
  const { run } = draftTool();
  const result = await run({ draft: "Hello" });
  assert.equal(result.isError, true);
  assert.equal(result.shown, null);
});
