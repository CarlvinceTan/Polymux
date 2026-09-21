import assert from "node:assert/strict";
import test from "node:test";
import type {AgentTool} from "@polymux/core";
import {hostWorkspaceTools, teamWorkspaceTools, teamToolContext} from "./workspace-tools.js";

function tool(name: string): AgentTool {
  return {
    name,
    description: name,
    parameters: {type: "object", properties: {}},
    async execute() {
      return {content: "ok"};
    },
  };
}

test("the external-agent workspace bridge includes every host-owned app tool family", () => {
  const names = hostWorkspaceTools({
    workspace: tool("workspace_show"),
    hubDraft: tool("hub_draft"),
    mobile: tool("mobile"),
    browser: [tool("browser"), tool("browser_snapshot_many"), tool("browser_read")],
    communications: [tool("message_contacts"), tool("email_search")],
    drive: [tool("drive_sources"), tool("drive_list"), tool("drive_read")],
    reminders: [tool("reminders_list"), tool("reminders_create")],
    schedule: tool("schedule"),
    tasks: tool("tasks"),
    agentMessage: tool("agent_message"),
    teamSetup: tool("team_setup"),
  }).map((entry) => entry.name);

  assert.deepEqual(names, [
    "workspace_show",
    "hub_draft",
    "mobile",
    "browser",
    "browser_snapshot_many",
    "browser_read",
    "message_contacts",
    "email_search",
    "drive_sources",
    "drive_list",
    "drive_read",
    "reminders_list",
    "reminders_create",
    "schedule",
    "tasks",
    "agent_message",
    "team_setup",
  ]);
});

test("Team ACP tools exclude Assistant authority and require the owning active run", () => {
  assert.deepEqual(teamWorkspaceTools({agentMessage: tool("agent_message"), workspace: tool("team_workspace"), connections: tool("team_connections")}).map((tool) => tool.name), ["agent_message", "team_workspace", "team_connections"]);
  const runs: Parameters<typeof teamToolContext>[2] = [
    {id: "other", conversationId: "other-chat", parentRunId: null, status: "running" as const},
    {id: "done", conversationId: "bot-chat", parentRunId: null, status: "completed" as const},
    {id: "current", conversationId: "bot-chat", parentRunId: null, status: "running" as const},
    {id: "child", conversationId: "bot-chat", parentRunId: "current", status: "running" as const},
  ];
  assert.equal(teamToolContext("bot-chat", "bot-chat", runs).runId, "current");
  assert.throws(() => teamToolContext("bot-chat", undefined, runs), /no longer belongs/);
  assert.throws(() => teamToolContext("other-chat", "bot-chat", runs), /no longer belongs/);
  assert.throws(() => teamToolContext("bot-chat", "bot-chat", runs.filter((run) => run.id !== "current")), /active run/);
});

test("Team MCP delivers with bot attribution and revokes discarded session credentials", async () => {
  const {Client} = await import("@modelcontextprotocol/sdk/client/index.js");
  const {StreamableHTTPClientTransport} = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const {ToolMcpServer} = await import("@polymux/tools");
  const {SqliteStorage} = await import("@polymux/storage/sqlite");
  const {ProfileManager} = await import("../profiles.js");
  const {TeamService, createAgentMessageTool, relayOrigin} = await import("../team/service.js");
  const {TeamComputerManager} = await import("../team/computers.js");
  const {mkdtemp, rm} = await import("node:fs/promises");
  const {tmpdir} = await import("node:os");
  const path = await import("node:path");
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-mcp-"));
  const storage = new SqliteStorage(":memory:");
  const team = new TeamService({storage, profiles: new ProfileManager(storage, root), computers: new TeamComputerManager()});
  const member = team.create({name: "Maya", role: "Research", profileId: "default", avatar: {shape: "circle", color: "#8b5cf6"}});
  const peer = team.create({name: "Linus", role: "Build", profileId: "default", avatar: {shape: "circle", color: "#8b5cf6"}});
  const group = team.createGroup({name: "Review", memberIds: [member.id, peer.id]});
  storage.createRun({id: "bot-run", conversationId: member.conversationId, status: "running"});
  let active = true;
  const server = new ToolMcpServer({name: "Polymux Team", version: "1", tools: () => teamWorkspaceTools({agentMessage: createAgentMessageTool(team), workspace: tool("team_workspace"), connections: tool("team_connections")}),
    context: (scope) => teamToolContext(scope, team.botByConversation(scope)?.conversationId, active ? [storage.getRun("bot-run")!] : []),
  });
  const descriptor = await server.descriptor(member.conversationId);
  const headers = Object.fromEntries(descriptor.headers.map(({name, value}) => [name, value]));
  const client = new Client({name: "fixture", version: "1"});
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(descriptor.url), {requestInit: {headers}}));
    assert.deepEqual((await client.listTools()).tools.map((entry) => entry.name), ["agent_message", "team_workspace", "team_connections"]);
    const reply = await client.callTool({name: "agent_message", arguments: {action: "send", to: group.conversationId, message: "Finished reviewing"}});
    assert.notEqual(reply.isError, true);
    const message = storage.latestMessage(group.conversationId)!;
    assert.equal(message.role, "tool");
    assert.equal(relayOrigin(message.metadata)?.memberId, member.id);
    assert.equal(relayOrigin(message.metadata)?.conversationId, member.conversationId);
    active = false;
    await assert.rejects(client.callTool({name: "agent_message", arguments: {action: "send", to: group.conversationId, message: "Stale"}}), /active run/);
    assert.equal(storage.listMessages(group.conversationId).length, 1);
    server.revoke(member.conversationId);
    const stale = await fetch(descriptor.url, {method: "POST", headers: {...headers, "Content-Type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "tools/list", params: {}})});
    assert.equal(stale.status, 401);
    const replacement = await server.descriptor(member.conversationId);
    assert.notEqual(replacement.headers[0]?.value, descriptor.headers[0]?.value);
  } finally {
    await client.close(); await server.close(); storage.close(); await rm(root, {recursive: true, force: true});
  }
});
