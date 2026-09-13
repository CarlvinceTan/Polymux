import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {SqliteStorage} from "@polymux/storage/sqlite";
import type {AgentTool, AgentToolContext} from "@polymux/core";
import {TEAM_AVATAR_SHAPES, type AgentMessageOriginDto} from "@polymux/protocol";
import {ProfileManager} from "../profiles.js";
import {TeamComputerManager} from "./computers.js";
import {TeamHostServer} from "./host-server.js";
import {TeamService, agentRelayInferenceText, createAgentMessageTool, createTeamSetupTool, createTeamConnectionsTool, relayOrigin, parseAgentMessageOrigin} from "./service.js";
import {isTeamBotSetupCue, teamBotSetupPrompt} from "./setup.js";

const avatar = {shape: "circle" as const, color: "#8b5cf6"};

test("external Team origins reject malformed loop controls and strip untrusted metadata", () => {
  const origin: AgentMessageOriginDto = {kind: "assistant", memberId: null, conversationId: "source", name: "Assistant", role: null, avatar: null, traceId: "trace", hop: 0, automatic: false};
  assert.deepEqual(parseAgentMessageOrigin({...origin, permissions: ["all"]}), origin);
  for (const hop of [-1, 0.5, NaN, Infinity, "0"]) assert.throws(() => parseAgentMessageOrigin({...origin, hop}), /hop/);
  assert.throws(() => parseAgentMessageOrigin({...origin, traceId: " "}), /trace/);
  assert.throws(() => parseAgentMessageOrigin({...origin, automatic: "false"}), /boolean/);
  assert.throws(() => parseAgentMessageOrigin({...origin, memberId: "impersonated"}), /Assistant/);
  assert.throws(() => parseAgentMessageOrigin({...origin, kind: "team"}), /member/);
});

test("external Team messages validate before storing and retain hop limits", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-ingress-"));
  const storage = new SqliteStorage(":memory:");
  try {
    const team = new TeamService({storage, profiles: new ProfileManager(storage, root), computers: new TeamComputerManager()});
    storage.createConversation({id: "target", title: "Target"});
    const origin: AgentMessageOriginDto = {kind: "assistant", memberId: null, conversationId: "source", name: "Assistant", role: null, avatar: null, traceId: "trace", hop: 0, automatic: false};
    for (const request of [null, [], {to: "target", text: "hello", attachments: "file"}, {to: "target", text: "hello", automatic: "yes"}] as unknown[]) {
      await assert.rejects(team.sendFromOrigin(request, origin));
    }
    await assert.rejects(team.sendFromOrigin({to: "target", text: "hello"}, {...origin, hop: -1}), /hop/);
    await assert.rejects(team.sendFromOrigin({to: "target", text: "hello"}, {...origin, hop: 999}), /hop limit/);
    assert.equal(storage.listMessages("target").length, 0);
    const message = await team.sendFromOrigin({to: "target", text: "hello"}, {...origin, elevated: true});
    assert.deepEqual(relayOrigin(message.metadata), origin);
    assert.equal(message.role, "tool");
    await assert.rejects(team.sendFromOrigin({to: "target", text: "again"}, origin), /already reached/);
  } finally { storage.close(); await rm(root, {recursive: true, force: true}); }
});
const adaptiveAvatar = {
  shape: "circle" as const,
  color: "#0a0a0c",
  colorPair: {light: "#0a0a0c", dark: "#f1efe9"},
};

test("creating a Team bot opens its conversation with a hidden setup turn", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-setup-"));
  const storage = new SqliteStorage(path.join(root, "team.sqlite"));
  try {
    const delivered: Array<{conversationId: string; text: string}> = [];
    const team = new TeamService({
      storage,
      profiles: new ProfileManager(storage, root),
      computers: new TeamComputerManager(),
      deliver: ({conversationId, text}) => delivered.push({conversationId, text}),
    });
    const bot = team.create({name: "Maya", role: "Research lead", profileId: "default", avatar});
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    // The cue opens the bot's own conversation as its first turn...
    assert.deepEqual(delivered.map((item) => item.conversationId), [bot.conversationId]);
    assert.equal(delivered[0]!.text, teamBotSetupPrompt(bot));
    const messages = storage.listMessages(bot.conversationId);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.role, "user");
    assert.equal(isTeamBotSetupCue(messages[0]!.metadata), true);
    // ...and it is not the preview the bot list shows before the bot answers.
    assert.equal(team.require(bot.id).preview, "Research lead");
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("editing a Team avatar saves every picker shape and preserves its colours", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-avatar-"));
  const storage = new SqliteStorage(path.join(root, "team.sqlite"));
  try {
    const team = new TeamService({
      storage,
      profiles: new ProfileManager(storage, root),
      computers: new TeamComputerManager(),
      deliver: () => {},
    });
    const bot = team.create({name: "Bob", role: "Video Editor", profileId: "default", avatar: adaptiveAvatar});
    for (const shape of TEAM_AVATAR_SHAPES) {
      const nextAvatar = {...adaptiveAvatar, shape};
      assert.deepEqual(team.update(bot.id, {avatar: nextAvatar}).avatar, nextAvatar);
      assert.deepEqual(team.require(bot.id).avatar, nextAvatar);
    }
    assert.throws(() => team.update(bot.id, {
      avatar: {...adaptiveAvatar, shape: "invalid" as typeof adaptiveAvatar.shape},
    }), /Unknown avatar shape/);
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("direct Team agents keep private conversations with attributed durable mail", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-"));
  const storage = new SqliteStorage(path.join(root, "team.sqlite"));
  try {
    const profiles = new ProfileManager(storage, root);
    const delivered: string[] = [];
    const team = new TeamService({
      storage,
      profiles,
      computers: new TeamComputerManager(),
      deliver: ({conversationId}) => delivered.push(conversationId),
    });
    const assistant = storage.createConversation({id: "assistant", title: "Planning"});
    const maya = team.create({name: "Maya", role: "Research lead", profileId: "default", avatar: adaptiveAvatar});
    const linus = team.create({name: "Linus", role: "Builder", profileId: "default", avatar: {...avatar, color: "#1B93A8"}});
    // Creating a bot opens its own setup turn; this test is about peer mail.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    delivered.length = 0;

    assert.deepEqual(team.assistantConversations().map((item) => item.id), [assistant.id]);
    assert.equal(team.list().length, 2);
    assert.equal(team.list().every((member) => member.conversationId !== assistant.id), true);
    assert.equal("expression" in maya.avatar, false);
    assert.deepEqual(maya.avatar.colorPair, adaptiveAvatar.colorPair);

    const message = await team.send({fromMemberId: maya.id, to: linus.id, text: "Please build the parser.", automatic: true});
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(message.role, "tool");
    assert.equal(relayOrigin(message.metadata)?.name, "Maya");
    assert.equal(relayOrigin(message.metadata)?.role, "Research lead");
    assert.equal("expression" in relayOrigin(message.metadata)!.avatar!, false);
    assert.deepEqual(relayOrigin(message.metadata)?.avatar?.colorPair, adaptiveAvatar.colorPair);
    assert.equal(agentRelayInferenceText(message), "Message from Maya (Research lead):\n\nPlease build the parser.");
    assert.deepEqual(delivered, [linus.conversationId]);
    assert.equal(team.require(linus.id).unread, true);
    assert.equal(team.require(linus.id).unreadCount, 1);
    assert.equal(team.markRead(linus.id).unread, false);
    assert.equal(team.require(linus.id).unreadCount, 0);

    storage.createRun({id: "run-linus", conversationId: linus.conversationId, model: "provider/model"});
    await team.sendFromRun("run-linus", assistant.id, "I received Maya's request.");
    storage.createRun({id: "run-assistant", conversationId: assistant.id, model: "provider/model"});
    await assert.rejects(
      team.sendFromRun("run-assistant", linus.id, "Loop this back."),
      /already reached that conversation/,
    );

    const fromAssistant = await team.send({fromConversationId: assistant.id, to: maya.name, text: "Coordinate this explicitly."});
    assert.equal(relayOrigin(fromAssistant.metadata)?.kind, "assistant");
    assert.equal(relayOrigin(fromAssistant.metadata)?.automatic, false);
    assert.throws(() => team.update(maya.id, {
      avatar: {...adaptiveAvatar, colorPair: {light: "white", dark: "#f1efe9"}},
    }), /six-digit hex colours/);
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("Team groups persist membership and collect attributed agent replies without a central run", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-group-"));
  const storage = new SqliteStorage(path.join(root, "team.sqlite"));
  try {
    const delivered: string[] = [];
    const team = new TeamService({
      storage,
      profiles: new ProfileManager(storage, root),
      computers: new TeamComputerManager(),
      deliver: ({conversationId}) => delivered.push(conversationId),
    });
    const maya = team.create({name: "Maya", role: "Research lead", profileId: "default", avatar});
    const linus = team.create({name: "Linus", role: "Builder", profileId: "default", avatar});
    // Creating a bot opens its own setup turn; this test is about group fan-out.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    delivered.length = 0;
    const group = team.createGroup({name: "Launch room", memberIds: [maya.id, linus.id, maya.id]});

    assert.deepEqual(group.memberIds, [maya.id, linus.id]);
    assert.equal(team.assistantConversations().some((item) => item.id === group.conversationId), false);
    assert.equal(team.targets().some((item) => item.id === group.conversationId && item.name === "Launch room"), true);

    await team.send({fromConversationId: group.conversationId, to: maya.id, text: "Check the launch claims."});
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.deepEqual(delivered, [maya.conversationId]);

    storage.createRun({id: "run-maya-group", conversationId: maya.conversationId, model: "provider/model"});
    const reply = await team.sendFromRun("run-maya-group", group.conversationId, "Two claims need sources.");
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(relayOrigin(reply.metadata)?.name, "Maya");
    assert.deepEqual(delivered, [maya.conversationId]);
    assert.equal(team.group(group.id)?.preview, "Two claims need sources.");
    assert.equal(team.group(group.id)?.unread, true);
    assert.equal(team.markGroupRead(group.id).unreadCount, 0);

    const updated = team.updateGroup(group.id, {name: "Launch review", memberIds: [maya.id]});
    assert.equal(updated.name, "Launch review");
    assert.deepEqual(updated.memberIds, [maya.id]);
    assert.equal(team.removeGroup(group.id), true);
    assert.equal(team.group(group.id), null);
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("bot communication is always available while laptop access stays bounded", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-policy-"));
  const storage = new SqliteStorage(path.join(root, "team.sqlite"));
  try {
    const team = new TeamService({
      storage,
      profiles: new ProfileManager(storage, root),
      computers: new TeamComputerManager(),
    });
    const maya = team.create({
      name: "Maya", role: "Research lead", profileId: "default", avatar,
      laptopAccess: "ask",
    });
    const linus = team.create({name: "Linus", role: "Builder", profileId: "default", avatar});
    // Previously saved opt-outs must not prevent bot communication.
    const metadata = JSON.parse(JSON.stringify(storage.getConversation(maya.conversationId)!.metadata));
    metadata.bot.automaticCommunication = false;
    storage.updateConversation(maya.conversationId, {metadata});
    storage.createRun({id: "run-maya", conversationId: maya.conversationId, model: "provider/model"});
    const handoff = await team.sendFromRun("run-maya", linus.id, "Automatic handoff");
    assert.equal(handoff.conversationId, linus.conversationId);

    const approvals: boolean[] = [];
    team.setLaptopBroker(async (_member, _capability, _tool, _input, _context, requiresApproval) => {
      approvals.push(requiresApproval);
      return {approved: true, result: {content: "brokered laptop result"}};
    });
    let localExecutions = 0;
    const tool: AgentTool = {
      name: "computer_state",
      description: "test",
      parameters: {type: "object"},
      execute: async () => { localExecutions += 1; return {content: "local"}; },
    };
    const guarded = team.guardLaptopTool(tool, "computer");
    const context: AgentToolContext = {
      runId: "run-maya", turn: 0, callId: "call", signal: new AbortController().signal,
      emitProgress: async () => {},
    };
    assert.equal((await guarded.execute({}, context)).content, "brokered laptop result");
    assert.equal((await guarded.execute({}, {...context, callId: "call-2"})).content, "brokered laptop result");
    assert.deepEqual(approvals, [true, false]);
    assert.equal(localExecutions, 0);
    assert.deepEqual(team.leases(maya.id)[0]?.capabilities, ["computer"]);
    team.update(maya.id, {laptopAccess: "off"});
    const denied = await guarded.execute({}, {...context, callId: "call-3"});
    assert.equal(denied.isError, true);
    assert.match(String(denied.content), /not allowed to use this laptop/);
    assert.deepEqual(approvals, [true, false]);
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("agent messaging falls through to the Desktop broker for another Host", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-broker-"));
  const storage = new SqliteStorage(path.join(root, "team.sqlite"));
  try {
    const team = new TeamService({
      storage,
      profiles: new ProfileManager(storage, root),
      computers: new TeamComputerManager(),
    });
    const maya = team.create({name: "Maya", role: "Research lead", profileId: "default", avatar});
    storage.createRun({id: "broker-run", conversationId: maya.conversationId, model: "provider/model"});
    const calls: string[] = [];
    const tool = createAgentMessageTool(team, async (input) => {
      calls.push(String(input.action));
      return input.action === "list"
        ? {content: "- Linus [team] — Builder (linus) · Studio Linux"}
        : {content: "Delivered across Hosts.", metadata: {messageId: "remote-message"}};
    });
    const context: AgentToolContext = {
      runId: "broker-run", turn: 0, callId: "broker", signal: new AbortController().signal,
      emitProgress: async () => {},
    };
    assert.match(String((await tool.execute({action: "list"}, context)).content), /Studio Linux/);
    assert.match(String((await tool.execute({action: "send", to: "Linus", message: "Please continue."}, context)).content), /across Hosts/);
    assert.deepEqual(calls, ["list", "send"]);
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("Desktop saves multiple Hosts and keeps one default for new bots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-multiple-hosts-"));
  const desktopStorage = new SqliteStorage(path.join(root, "desktop.sqlite"));
  const hostAStorage = new SqliteStorage(path.join(root, "host-a.sqlite"));
  const hostBStorage = new SqliteStorage(path.join(root, "host-b.sqlite"));
  const secrets = new Map<string, string>();
  const team = new TeamService({
    storage: desktopStorage,
    profiles: new ProfileManager(desktopStorage, path.join(root, "desktop")),
    computers: new TeamComputerManager(),
    writeHostSecret: async (hostId, secret) => {
      if (secret) secrets.set(hostId, secret);
      else secrets.delete(hostId);
    },
  });
  const servers = [hostAStorage, hostBStorage].map((storage) => new TeamHostServer({
    storage,
    host: "127.0.0.1",
    port: 0,
    call: async () => null,
  }));
  try {
    const paired = [];
    for (const server of servers) {
      await server.start();
      const pairing = server.beginPairing();
      const response = await fetch(`${pairing.endpoint}/polymux-host/v1/pair`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({code: pairing.pairingCode, desktopId: 'test-desktop', deviceName: 'Desktop'})});
      const challenge = await response.json() as {id: string; token: string; number: string};
      await server.approvePairing(challenge.id, challenge.number);
      const grant = server.pairing.poll(challenge.id, challenge.token);
      paired.push(await team.savePeerConnection(pairing.endpoint!, grant.credentials!));
    }
    assert.equal(team.hosts().length, 3);
    assert.equal(team.host().hostId, team.localHost().hostId);
    assert.equal(secrets.size, 2);
    assert.equal(team.setDefaultHost(paired[0]!.hostId).hostId, paired[0]!.hostId);
    await team.removeHost(paired[1]!.hostId);
    assert.deepEqual(team.hosts().map((host) => host.hostId), [team.localHost().hostId, paired[0]!.hostId]);
    assert.equal(secrets.has(paired[1]!.hostId), false);
  } finally {
    await Promise.all(servers.map((server) => server.close()));
    desktopStorage.close();
    hostAStorage.close();
    hostBStorage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("Desktop drops legacy insecure Host records instead of reconnecting through them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-insecure-host-records-"));
  const storage = new SqliteStorage(path.join(root, "desktop.sqlite"));
  try {
    storage.setPreference("team.hosts", [
      {
        mode: "remote",
        state: "connected",
        endpoint: "http://100.90.80.70:47680",
        hostId: "legacy-host",
        deviceName: "Legacy Host",
        fingerprint: "legacy-fingerprint",
        pairedAt: null,
        detail: null,
      },
      {
        mode: "remote",
        state: "connected",
        endpoint: "https://connect.polymux.com/h/86c92dd5-5042-4aa4-a33f-b656bf641e28",
        hostId: "connect-host",
        deviceName: "Polymux Connect Host",
        fingerprint: "connect-fingerprint",
        pairedAt: null,
        detail: null,
      },
    ]);
    storage.setPreference("team.default-host", "legacy-host");
    const team = new TeamService({
      storage,
      profiles: new ProfileManager(storage, root),
      computers: new TeamComputerManager(),
    });

    assert.deepEqual(team.hosts().map((host) => host.hostId), [team.localHost().hostId, "connect-host"]);
    assert.equal(team.host().mode, "local");
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("moving a bot preserves identity, conversation and attachments", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-transfer-"));
  const sourceStorage = new SqliteStorage(path.join(root, "source.sqlite"));
  const targetStorage = new SqliteStorage(path.join(root, "target.sqlite"));
  try {
    const source = new TeamService({
      storage: sourceStorage,
      profiles: new ProfileManager(sourceStorage, path.join(root, "source")),
      computers: new TeamComputerManager(),
      transferDirectory: path.join(root, "source-transfers"),
    });
    const target = new TeamService({
      storage: targetStorage,
      profiles: new ProfileManager(targetStorage, path.join(root, "target")),
      computers: new TeamComputerManager(),
      transferDirectory: path.join(root, "target-transfers"),
    });
    const maya = source.create({name: "Maya", role: "Research lead", profileId: "default", avatar});
    const createdAt = "2026-08-30T04:05:06.000Z";
    const message = sourceStorage.appendMessage({
      id: "move-message",
      conversationId: maya.conversationId,
      role: "user",
      content: "Keep this history.",
      createdAt,
    });
    const attachmentPath = path.join(root, "brief.txt");
    await writeFile(attachmentPath, "transfer evidence");
    sourceStorage.addAttachment({
      id: "move-attachment",
      messageId: message.id,
      name: "brief.txt",
      path: attachmentPath,
      mimeType: "text/plain",
      size: 17,
      sha256: null,
    });

    const moved = await target.importBot(await source.exportBot(maya.id), "default");
    assert.equal(moved.id, maya.id);
    assert.equal(moved.conversationId, maya.conversationId);
    assert.equal(moved.hostId, target.localHost().hostId);
    const importedMessage = targetStorage.listMessages(maya.conversationId)[0]!;
    assert.equal(importedMessage.content, "Keep this history.");
    assert.equal(importedMessage.createdAt, createdAt);
    const importedAttachment = targetStorage.listAttachments(importedMessage.id)[0]!;
    assert.equal(await readFile(importedAttachment.path, "utf8"), "transfer evidence");
    assert.equal(await source.remove(maya.id), true);
    assert.equal(source.bot(maya.id), null);
    assert.equal(target.require(maya.id).name, "Maya");
  } finally {
    sourceStorage.close();
    targetStorage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("Assistant can inspect setup and create a bot without granting laptop access", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-setup-"));
  const storage = new SqliteStorage(path.join(root, "team.sqlite"));
  try {
    const profiles = new ProfileManager(storage, root);
    const team = new TeamService({storage, profiles, computers: new TeamComputerManager()});
    const tool = createTeamSetupTool(team, {
      options: async () => ({
        host: team.host(),
        profiles: profiles.snapshot().profiles,
        connections: {
          skills: [{name: "web-search", description: "Search the web"}],
          mcpServers: [{id: "github", name: "GitHub"}],
          plugins: [{id: "data-analysis", name: "Data Analysis"}],
        },
      }),
      list: async () => team.list(),
      create: async (request) => team.create(request),
      update: async (id, request) => team.update(id, request),
      remove: async (id) => team.remove(id),
    });
    const context: AgentToolContext = {
      runId: "assistant-run", turn: 0, callId: "setup", signal: new AbortController().signal,
      emitProgress: async () => {},
    };

    const options = await tool.execute({action: "options"}, context);
    if (typeof options.content !== "string") assert.fail("Expected text setup options");
    assert.match(options.content, /Eligible profiles:\n- Default Profile \(default\)/);
    assert.match(options.content, /Available connections pool in workspace/);
    assert.match(options.content, /Skills: web-search/);
    const created = await tool.execute({
      action: "create",
      name: "Maya",
      role: "Research lead",
      profile: "Default Profile",
      skills: ["web-search"],
      mcpServers: ["github"],
    }, context);
    if (typeof created.content !== "string") assert.fail("Expected text setup result");
    assert.match(created.content, /Created Maya, Research lead/);
    const maya = team.list()[0]!;
    assert.equal(maya.laptopAccess, "off");
    assert.match(maya.avatar.color, /^#[0-9a-f]{6}$/i);
    assert.deepEqual(maya.skills, ["web-search"]);
    assert.deepEqual(maya.mcpServers, ["github"]);

    const listed = await tool.execute({action: "list"}, context);
    assert.match(String(listed.content), /Maya — Research lead/);
    assert.match(String(listed.content), /skills: \[web-search\]/);
    assert.match(String(listed.content), /mcp: \[github\]/);
    const updated = await tool.execute({action: "update", member: maya.id, role: "Staff researcher", skills: ["web-search", "deep-research"]}, context);
    assert.match(String(updated.content), /Staff researcher/);
    assert.deepEqual(team.list()[0]!.skills, ["web-search", "deep-research"]);

    await assert.rejects(tool.execute({action: "remove", member: maya.id}, context), /confirm=true/);
    const removed = await tool.execute({action: "remove", member: maya.id, confirm: true}, context);
    assert.match(String(removed.content), /Removed Maya/);
    const recreated = team.create({name: "Maya", role: "Research lead", profileId: "default", avatar, skills: ["web-search"]});

    storage.createRun({id: "maya-run", conversationId: recreated.conversationId, model: "provider/model"});
    await assert.rejects(
      tool.execute({action: "create", name: "Peer", role: "Peer", profile: "default"}, {...context, runId: "maya-run"}),
      /Only the Assistant/,
    );

    // Test bot self-service tool
    const botConnectionsTool = createTeamConnectionsTool(team, {
      pool: async () => ({
        skills: [{name: "web-search", description: "Search"}, {name: "calculator", description: "Math"}],
        mcpServers: [{id: "github", name: "GitHub"}],
        plugins: [],
      }),
      connect: async (botId, conns) => {
        const current = team.require(botId);
        const nextSkills = [...new Set([...(current.skills ?? []), ...(conns.skills ?? [])])];
        const nextMcp = [...new Set([...(current.mcpServers ?? []), ...(conns.mcpServers ?? [])])];
        const nextPlugins = [...new Set([...(current.plugins ?? []), ...(conns.plugins ?? [])])];
        return team.update(botId, {skills: nextSkills, mcpServers: nextMcp, plugins: nextPlugins});
      },
      disconnect: async (botId, conns) => {
        const current = team.require(botId);
        const remSkills = new Set(conns.skills ?? []);
        const remMcp = new Set(conns.mcpServers ?? []);
        const remPlugins = new Set(conns.plugins ?? []);
        const nextSkills = (current.skills ?? []).filter((s) => !remSkills.has(s));
        const nextMcp = (current.mcpServers ?? []).filter((m) => !remMcp.has(m));
        const nextPlugins = (current.plugins ?? []).filter((p) => !remPlugins.has(p));
        return team.update(botId, {skills: nextSkills, mcpServers: nextMcp, plugins: nextPlugins});
      },
    });

    const mayaContext = {...context, runId: "maya-run"};
    const mayaPool = await botConnectionsTool.execute({action: "pool"}, mayaContext);
    assert.match(String(mayaPool.content), /Current connections for Maya:/);
    assert.match(String(mayaPool.content), /Skills: web-search/);
    assert.match(String(mayaPool.content), /calculator/);

    const mayaConnected = await botConnectionsTool.execute({action: "connect", skills: ["calculator"], mcpServers: ["github"]}, mayaContext);
    assert.match(String(mayaConnected.content), /Connected requested connections to Maya/);
    assert.deepEqual(team.require(recreated.id).skills, ["web-search", "calculator"]);
    assert.deepEqual(team.require(recreated.id).mcpServers, ["github"]);

    const mayaDisconnected = await botConnectionsTool.execute({action: "disconnect", skills: ["web-search"]}, mayaContext);
    assert.match(String(mayaDisconnected.content), /Disconnected requested connections from Maya/);
    assert.deepEqual(team.require(recreated.id).skills, ["calculator"]);
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("archived assistant chats leave the drawer list and stay out of Team", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-archive-"));
  const storage = new SqliteStorage(path.join(root, "team.sqlite"));
  try {
    const team = new TeamService({
      storage,
      profiles: new ProfileManager(storage, root),
      computers: new TeamComputerManager(),
      deliver: () => {},
    });
    const assistant = storage.createConversation({id: "assistant", title: "Planning"});
    const maya = team.create({name: "Maya", role: "Research lead", profileId: "default", avatar});
    storage.updateConversation(assistant.id, {archived: true});
    assert.deepEqual(team.assistantConversations().map((item) => item.id), []);
    assert.deepEqual(team.archivedAssistantConversations().map((item) => item.id), [assistant.id]);
    storage.updateConversation(maya.conversationId, {archived: true});
    assert.equal(team.archivedAssistantConversations().some((item) => item.id === maya.conversationId), false);
    assert.equal(team.isAssistantConversation(assistant.id), true);
    assert.equal(team.isAssistantConversation(maya.conversationId), false);
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});
