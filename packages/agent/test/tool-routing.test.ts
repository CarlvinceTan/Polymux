import assert from "node:assert/strict";
import test from "node:test";
import type { AgentTool } from "@flareai/core";
import {
  boundedResearchToolTurnBudget,
  inferTaskToolGroups,
  selectTaskSkills,
  selectTaskTools,
  taskGroupEnabled,
} from "../src/subagents/tool-routing.js";

const tool = (name: string): AgentTool => ({
  name,
  description: name,
  parameters: { type: "object", properties: {} },
  async execute() { return { content: "ok" }; },
});

const catalogue = [
  "browser", "browser_tabs", "browser_current_read", "browser_read", "browser_snapshot_many", "browser_control", "resolve_current_location",
  "email_accounts", "email_folders", "email_list", "email_read", "email_search", "email_search_all", "email_draft", "email_send",
  "message_chats", "message_read", "message_search", "message_unread", "message_link_alias", "message_send",
  "drive_sources", "drive_list", "drive_read", "drive_write", "drive_move",
  "read", "write", "edit", "bash", "reminders_create", "reminders_list", "reminders_update", "schedule", "record_workflow",
  "hub_draft", "third_party_unknown",
].map(tool);

test("task capability routing keeps only explicit groups plus skill reading", () => {
  assert.deepEqual(
    selectTaskTools(catalogue, ["browser", "email"]).map((item) => item.name),
    ["browser", "browser_tabs", "browser_current_read", "browser_read", "browser_snapshot_many", "browser_control", "email_accounts", "email_folders", "email_list", "email_read", "email_search", "email_search_all", "email_draft", "email_send", "read"],
  );
});

test("browser-read exposes only non-mutating current-page evidence tools", () => {
  assert.deepEqual(
    selectTaskTools(catalogue, ["browser-read"]).map((item) => item.name),
    ["browser_current_read", "read"],
  );
});

test("browser-research exposes embedded research without external-browser leases", () => {
  assert.deepEqual(
    selectTaskTools(catalogue, ["browser-research"]).map((item) => item.name),
    ["browser", "browser_read", "browser_snapshot_many", "resolve_current_location", "read"],
  );
});

test("communication read routes exclude draft and send actions", () => {
  assert.deepEqual(
    selectTaskTools(catalogue, ["email-triage"]).map((item) => item.name),
    ["email_read", "email_search_all", "read"],
  );
  assert.deepEqual(
    selectTaskTools(catalogue, ["email-read"]).map((item) => item.name),
    ["email_accounts", "email_folders", "email_list", "email_read", "email_search", "email_search_all", "read"],
  );
  assert.deepEqual(
    selectTaskTools(catalogue, ["messages-read"]).map((item) => item.name),
    ["message_chats", "message_read", "message_search", "message_unread", "read"],
  );
});

test("message reads retain configured connector evidence without retaining mutations", () => {
  const configured = [
    "whatsapp__list_chats",
    "whatsapp__search_contacts",
    "whatsapp__list_messages",
    "matrix-hub__matrix_list_rooms",
    "matrix-hub__matrix_get_messages",
    "discord__get_channel_history",
    "whatsapp__send_message",
    "matrix-hub__matrix_mark_room_read",
    "notion__search_pages",
  ].map(tool);
  assert.deepEqual(
    selectTaskTools(configured, ["messages-read"]).map((item) => item.name),
    [
      "whatsapp__list_chats",
      "whatsapp__search_contacts",
      "whatsapp__list_messages",
      "matrix-hub__matrix_list_rooms",
      "matrix-hub__matrix_get_messages",
      "discord__get_channel_history",
    ],
  );
});

test("the direct communication follow-up route spans email and chat actions", () => {
  assert.deepEqual(
    selectTaskTools(catalogue, ["communications"]).map((item) => item.name),
    [
      "email_accounts", "email_folders", "email_list", "email_read", "email_search",
      "email_search_all", "email_draft", "email_send", "message_chats", "message_read",
      "message_search", "message_unread", "message_link_alias", "message_send", "read",
    ],
  );
});

test("file and action groups map to their complete bounded families", () => {
  assert.deepEqual(
    selectTaskTools(catalogue, ["files", "reminders", "schedule"]).map((item) => item.name),
    ["read", "write", "edit", "bash", "reminders_create", "reminders_list", "reminders_update", "schedule"],
  );
});

test("resume exposes ComputerHistory-adjacent reversible work without send tools", () => {
  const names = selectTaskTools(catalogue, ["resume"]).map((item) => item.name);
  assert.ok(names.includes("bash"));
  assert.ok(names.includes("browser_control"));
  assert.ok(names.includes("email_draft"));
  assert.ok(names.includes("message_read"));
  assert.ok(names.includes("reminders_update"));
  assert.ok(!names.includes("email_send"));
  assert.ok(!names.includes("message_send"));
  assert.ok(!names.includes("third_party_unknown"));
});

test("missing, empty, and all routes preserve the complete catalogue", () => {
  assert.equal(selectTaskTools(catalogue), catalogue);
  assert.equal(selectTaskTools(catalogue, []), catalogue);
  assert.equal(selectTaskTools(catalogue, ["all"]), catalogue);
});

test("skill routing uses exact names and falls back losslessly on a typo", () => {
  const skills = [
    { name: "browser-use", description: "Browse", filePath: "/browser/SKILL.md", baseDir: "/browser", disableModelInvocation: false, source: "official" as const },
    { name: "email-use", description: "Mail", filePath: "/email/SKILL.md", baseDir: "/email", disableModelInvocation: false, source: "official" as const },
  ];
  assert.deepEqual(selectTaskSkills(skills, ["browser-use"]), [skills[0]]);
  assert.deepEqual(selectTaskSkills(skills, []), []);
  assert.equal(selectTaskSkills(skills), skills);
  assert.equal(selectTaskSkills(skills, ["browser-ues"]), skills);
});

test("internal source groups are lossless by default and bounded when routed", () => {
  assert.equal(taskGroupEnabled(undefined, "history"), true);
  assert.equal(taskGroupEnabled(["all"], "history"), true);
  assert.equal(taskGroupEnabled(["browser", "history"], "history"), true);
  assert.equal(taskGroupEnabled(["browser"], "history"), false);
});

test("omitted experimental routes infer only explicit read-only evidence families", () => {
  assert.deepEqual(
    inferTaskToolGroups(
      "Check funding status",
      "Review local records, email correspondence, and official current sources. Read-only only; do not submit, send, or modify anything.",
    ),
    ["browser-research", "email-triage", "drive-read"],
  );
  assert.deepEqual(
    inferTaskToolGroups("Find Dad's latest message", "Read WhatsApp only; do not send anything."),
    ["messages-read"],
  );
  assert.equal(
    inferTaskToolGroups("Complete the form", "Fill and submit the current application."),
    undefined,
  );
  assert.equal(
    inferTaskToolGroups("Fix the build", "Inspect and edit the TypeScript implementation."),
    undefined,
  );
});

test("drive-read and files-read cannot mutate data", () => {
  assert.deepEqual(
    selectTaskTools(catalogue, ["drive-read", "files-read"]).map((item) => item.name),
    ["drive_sources", "drive_list", "drive_read", "read"],
  );
});

test("only routed read-only web research receives a deterministic tool-turn budget", () => {
  assert.equal(boundedResearchToolTurnBudget(["browser-research"])?.maximum, 4);
  assert.equal(boundedResearchToolTurnBudget(["browser-research", "email-triage"])?.maximum, 6);
  assert.equal(boundedResearchToolTurnBudget(["browser-research", "drive-read"])?.maximum, 6);
  assert.equal(boundedResearchToolTurnBudget(["browser-research", "browser"]), undefined);
  assert.equal(boundedResearchToolTurnBudget(["browser-research", "drive"]), undefined);
  assert.equal(boundedResearchToolTurnBudget(["browser-research", "all"]), undefined);
  assert.equal(boundedResearchToolTurnBudget(["messages-read"]), undefined);
  assert.equal(boundedResearchToolTurnBudget(undefined), undefined);
});
