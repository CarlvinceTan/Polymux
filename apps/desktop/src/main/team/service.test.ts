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
import {TeamService, agentRelayInferenceText, createAgentMessageTool, createTeamSetupTool, createTeamConnectionsTool, createTeamSpawnTool, relayIntent, relayOrigin, parseAgentMessageOrigin} from "./service.js";
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

test("a bot created without a role asks its first turn to propose one", async () => {
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
    // "New Chat" from the To: bar: no role, so setup happens in the conversation.
    const bot = team.create({name: "New Chat", role: "", profileId: "default", avatar});
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    assert.equal(team.require(bot.id).role, "");
    assert.equal(delivered[0]!.text, teamBotSetupPrompt(bot));
    assert.match(delivered[0]!.text, /no role or assignment chosen yet/);
    assert.match(delivered[0]!.text, /propose two or three concrete roles/);

    // A role can be added later, and cleared again without being rejected.
    const named = team.update(bot.id, {role: "Research lead"});
    assert.equal(named.role, "Research lead");
    assert.equal(team.update(bot.id, {role: ""}).role, "");
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
    team.setLaptopBroker(async (_member, _capability, _tool, _input, _context, accessForDevice) => {
      const hostId = team.localHost().hostId;
      approvals.push(accessForDevice(hostId).requiresApproval);
      return {approved: true, hostId, result: {content: "brokered laptop result"}};
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
    assert.match(String(denied.content), /not allowed to use this device/);
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
    const imported = targetStorage.listMessages(maya.conversationId);
    // The hidden first-run cue travels with the history, so the moved bot can
    // still introduce itself when its setup turn was never delivered.
    assert.equal(isTeamBotSetupCue(imported[0]!.metadata), true);
    const importedMessage = imported[1]!;
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

test("Assistant can inspect setup and create a bot with default device access", async () => {
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
    assert.ok(options.content.includes(team.localHost().hostId));
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
    assert.equal(maya.laptopAccess, "allow");
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
    const deviceAccess = {[team.localHost().hostId]: "ask"};
    await tool.execute({action: "update", member: maya.id, deviceAccess}, context);
    assert.deepEqual(team.require(maya.id).deviceAccess, deviceAccess);
    await assert.rejects(tool.execute({action: "update", member: maya.id, deviceAccess: {device: "alow"}}, context), /Device access/);

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


test("device access defaults to allow; ask approvals are scoped and revoked when policy tightens", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-device-access-"));
  const storage = new SqliteStorage(":memory:");
  try {
    let approvals = 0;
    const team = new TeamService({storage, profiles: new ProfileManager(storage, root), computers: new TeamComputerManager(),
      requestLaptopAccess: async () => { approvals++; return true; }});
    const member = team.create({name: "Maya", role: "Research", profileId: "default", avatar});
    const localId = team.localHost().hostId;
    await team.savePeerConnection("http://127.0.0.1:9551", {hostId: "device-a", deviceName: "A", secret: "test-a"});
    await team.savePeerConnection("http://127.0.0.1:9552", {hostId: "device-b", deviceName: "B", secret: "test-b"});
    storage.createRun({id: "policy-run", conversationId: member.conversationId, model: "provider/model"});
    const context: AgentToolContext = {runId: "policy-run", turn: 0, callId: "call", signal: new AbortController().signal, emitProgress: async () => {}};
    assert.equal(member.laptopAccess, "allow");
    assert.equal(await team.authorizeLaptopTool(context, "files", "read_file"), true);
    assert.equal(approvals, 0);
    assert.equal(team.leases(member.id).length, 0);
    assert.equal(team.deviceAccessMode(member, "unknown-device"), "off");

    team.update(member.id, {deviceAccess: {[localId]: "ask", "device-a": "ask", "device-b": "ask"}});
    assert.equal(await team.authorizeLaptopTool(context, "files", "read_file"), true);
    assert.equal(await team.authorizeLaptopTool(context, "files", "read_file"), true);
    assert.equal(approvals, 1);
    assert.equal(team.leases(member.id)[0]!.hostId, localId);

    const destinations = ["device-a", "device-b", "device-a"];
    const requested: Array<{device: string; requiresApproval: boolean}> = [];
    team.setLaptopBroker(async (_member, _capability, _tool, _input, _context, accessForDevice) => {
      const hostId = destinations.shift()!;
      const policy = accessForDevice(hostId);
      assert.equal(policy.allowed, true);
      requested.push({device: hostId, requiresApproval: policy.requiresApproval});
      return {hostId, approved: true, result: {content: hostId}};
    });
    const guarded = team.guardLaptopTool({name: "read_file", description: "test", parameters: {type: "object"}, execute: async () => ({content: "local"})}, "files");
    for (let index = 0; index < 3; index++) await guarded.execute({}, context);
    assert.deepEqual(requested, [
      {device: "device-a", requiresApproval: true}, {device: "device-b", requiresApproval: true}, {device: "device-a", requiresApproval: false},
    ]);
    const oldLease = team.leases(member.id).find((lease) => lease.hostId === "device-a")!;
    team.update(member.id, {deviceAccess: {[localId]: "ask", "device-a": "off", "device-b": "ask"}});
    assert.equal(team.hasDeviceLease(member.id, "device-a", "files"), false);
    assert.equal(team.hasDeviceLease(member.id, "device-b", "files"), true);
    // An old grant cannot override a newly restrictive policy, even if restored.
    storage.setPreference("team.laptop-leases", [...team.leases(), oldLease] as never);
    team.setLaptopBroker(async (_member, _capability, _tool, _input, _context, accessForDevice) => {
      assert.deepEqual(accessForDevice("device-a"), {allowed: false, requiresApproval: false});
      assert.deepEqual(accessForDevice("device-b"), {allowed: true, requiresApproval: false});
      return {hostId: "device-a", approved: true, result: {content: "should not be accepted"}};
    });
    assert.equal((await guarded.execute({}, context)).isError, true);
    team.update(member.id, {deviceAccess: {[localId]: "off", "device-a": "off", "device-b": "ask"}});
    assert.equal(await team.authorizeLaptopTool(context, "files", "read_file"), false);
    assert.equal(approvals, 1);
  } finally { storage.close(); await rm(root, {recursive: true, force: true}); }
});

test("device policies validate input, survive transfer, and migrate old defaults without retaining unscoped approvals", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-device-migration-"));
  const storage = new SqliteStorage(":memory:");
  const targetStorage = new SqliteStorage(":memory:");
  try {
    const team = new TeamService({storage, profiles: new ProfileManager(storage, root), computers: new TeamComputerManager()});
    const target = new TeamService({storage: targetStorage, profiles: new ProfileManager(targetStorage, root), computers: new TeamComputerManager()});
    const request = {name: "Maya", role: "Research", profileId: "default", avatar};
    for (const deviceAccess of [{a: "alow"}, [], "allow", {" ": "off"}, {a: null}, null] as unknown[])
      assert.throws(() => team.create({...request, deviceAccess} as never), /Device access/);
    for (const laptopAccess of ["alow", null]) assert.throws(() => team.create({...request, laptopAccess} as never), /Device access/);
    const member = team.create({...request, deviceAccess: {"device-a": "ask", "device-b": "off"}, skills: ["research"]});
    assert.throws(() => team.update(member.id, {deviceAccess: {a: "alow"}} as never), /Device access/);
    const moved = await target.importBot(await team.exportBot(member.id), "default");
    assert.deepEqual(moved.deviceAccess, member.deviceAccess);
    assert.deepEqual(moved.skills, ["research"]);
    for (const oldPolicy of ["ask", "off"]) {
      const old = team.create({...request, name: oldPolicy});
      const metadata = JSON.parse(JSON.stringify(storage.getConversation(old.conversationId)!.metadata));
      delete metadata.bot.deviceAccess;
      metadata.bot.laptopAccess = oldPolicy;
      storage.updateConversation(old.conversationId, {metadata});
      assert.equal(team.require(old.id).laptopAccess, oldPolicy === "ask" ? "allow" : "off");
    }
    storage.setPreference("team.laptop-leases", [{id: "legacy", memberId: member.id, capabilities: ["files"], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString()}]);
    assert.deepEqual(team.leases(), []);
  } finally { storage.close(); targetStorage.close(); await rm(root, {recursive: true, force: true}); }
});

test("bot agent configuration is independent of shared profiles and survives transfer", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-bot-runtime-"));
  const storage = new SqliteStorage(":memory:");
  const destinationStorage = new SqliteStorage(":memory:");
  try {
    const profiles = new ProfileManager(storage, path.join(root, "source"));
    const team = new TeamService({storage, profiles, computers: new TeamComputerManager()});
    const runtime = {kind: "acp" as const, name: "Fixture ACP", command: "node", args: ["fixture.mjs"], config: {model: "fast"}};
    const first = team.create({name: "First", role: "Research", profileId: "default", avatar, agentRuntime: runtime});
    const second = team.create({name: "Second", role: "Review", profileId: "default", avatar, agentRuntime: runtime});
    assert.equal(first.agentRuntime?.kind, "acp");
    assert.notDeepEqual(first.agentRuntime, second.agentRuntime, "each bot gets its own configuration slot");
    const selected = first.agentRuntime!;
    assert.equal(selected.kind, "acp");
    if (selected.kind !== "acp") throw new Error("Expected ACP");
    team.update(first.id, {agentRuntime: {...selected, config: {model: "capable", brave: true}}});
    assert.deepEqual(team.require(second.id).agentRuntime, second.agentRuntime);
    assert.equal(profiles.preference("agent-runtime"), null);
    const reread = new TeamService({storage, profiles, computers: new TeamComputerManager()});
    assert.deepEqual(reread.require(first.id).agentRuntime, team.require(first.id).agentRuntime);
    const destination = new TeamService({storage: destinationStorage, profiles: new ProfileManager(destinationStorage, path.join(root, "destination")), computers: new TeamComputerManager()});
    const moved = await destination.importBot(await team.exportBot(first.id), "default");
    assert.deepEqual(moved.agentRuntime, team.require(first.id).agentRuntime);
    assert.throws(() => team.update(first.id, {agentRuntime: {kind: "acp", name: "Bad", command: " "}}), /command/i);
    const safe = team.update(first.id, {agentRuntime: {...selected, configId: "../../other-bot", registryEnvironment: {HOME: "/other", TOKEN: "secret", COLOR: "yes"}}}).agentRuntime;
    assert.equal(safe?.kind, "acp");
    if (safe?.kind === "acp") { assert.match(safe.configId!, /^[a-z0-9-]+$/); assert.deepEqual(safe.registryEnvironment, {COLOR: "yes"}); }
  } finally { storage.close(); destinationStorage.close(); await rm(root, {recursive: true, force: true}); }
});

test("a bot spawning a peer reuses its spawn key and tracks the parent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-spawn-"));
  const storage = new SqliteStorage(path.join(root, "team.sqlite"));
  try {
    const delivered: Array<{conversationId: string; text: string; messageId: string}> = [];
    const team = new TeamService({
      storage,
      profiles: new ProfileManager(storage, root),
      computers: new TeamComputerManager(),
      deliver: (input) => delivered.push(input),
    });
    const maya = team.create({name: "Maya", role: "Research lead", profileId: "default", avatar});
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const scout = team.spawn({
      name: "Scout", role: "Field researcher", profileId: "default",
      avatar, prompt: "Survey the inbox.", spawnKey: "spawn-key-1",
    }, maya.id);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    assert.equal(scout.parentBotId, maya.id);
    assert.deepEqual(team.children(maya.id).map((member) => member.id), [scout.id]);
    // The peer opens with the hidden setup cue, then its first task follows it.
    const childMessages = storage.listMessages(scout.conversationId);
    assert.equal(childMessages.length, 2);
    assert.equal(isTeamBotSetupCue(childMessages[0]!.metadata), true);
    assert.equal(childMessages[1]!.content, "Survey the inbox.");
    const childDeliveries = delivered.filter((item) => item.conversationId === scout.conversationId);
    assert.equal(childDeliveries.length, 2);
    assert.equal(childDeliveries[1]!.text, "Survey the inbox.");

    // A retried spawn reuses the winner instead of duplicating the peer.
    const duplicate = team.spawn({
      name: "Scout Again", role: "Field researcher", profileId: "default",
      avatar, prompt: "Survey the inbox.", spawnKey: "spawn-key-1",
    }, maya.id);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(duplicate.id, scout.id);
    assert.equal(team.list().length, 2);
    // ...and it does not re-store or re-deliver the first task.
    assert.equal(storage.listMessages(scout.conversationId).length, 2);
    assert.equal(delivered.filter((item) => item.conversationId === scout.conversationId).length, 2);

    // Parentage survives a move to another Host.
    const destinationStorage = new SqliteStorage(":memory:");
    try {
      const destination = new TeamService({
        storage: destinationStorage,
        profiles: new ProfileManager(destinationStorage, path.join(root, "destination")),
        computers: new TeamComputerManager(),
      });
      const moved = await destination.importBot(await team.exportBot(scout.id), "default");
      assert.equal(moved.parentBotId, maya.id);
    } finally { destinationStorage.close(); }
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("a bot archives only its own spawned peers with an exact-name confirmation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-archive-spawn-"));
  const storage = new SqliteStorage(":memory:");
  try {
    const team = new TeamService({
      storage,
      profiles: new ProfileManager(storage, root),
      computers: new TeamComputerManager(),
      deliver: () => {},
    });
    const maya = team.create({name: "Maya", role: "Research lead", profileId: "default", avatar});
    const linus = team.create({name: "Linus", role: "Builder", profileId: "default", avatar});
    const scout = team.spawn({name: "Scout", role: "Helper", profileId: "default", avatar}, maya.id);
    await assert.rejects(team.archiveSpawnedBot(maya.id, ""), /confirm_name/);
    await assert.rejects(team.archiveSpawnedBot(maya.id, "Wrong name"), /did not create/);
    await assert.rejects(team.archiveSpawnedBot(linus.id, "Scout"), /did not create/);
    await assert.rejects(team.archiveSpawnedBot(maya.id, "Scout", linus.id), /not created by this bot/);
    // A bot cannot archive itself, even when the name matches.
    await assert.rejects(team.archiveSpawnedBot(maya.id, "Maya", maya.id), /not created by this bot/);
    const archived = await team.archiveSpawnedBot(maya.id, "Scout");
    assert.equal(archived.id, scout.id);
    assert.equal(team.bot(scout.id), null);

    // Two peers sharing a name require the id to disambiguate.
    const first = team.spawn({name: "Scout", role: "One", profileId: "default", avatar, spawnKey: "key-1"}, maya.id);
    const second = team.spawn({name: "Scout", role: "Two", profileId: "default", avatar, spawnKey: "key-2"}, maya.id);
    await assert.rejects(team.archiveSpawnedBot(maya.id, "Scout"), /bot_id/);
    await team.archiveSpawnedBot(maya.id, "Scout", second.id);
    assert.equal(team.bot(second.id), null);
    assert.equal(team.require(first.id).name, "Scout");
  } finally { storage.close(); await rm(root, {recursive: true, force: true}); }
});

test("a stalled setup cue stays pending until the bot replies and retry re-delivers it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-retry-"));
  const storage = new SqliteStorage(path.join(root, "team.sqlite"));
  try {
    const delivered: Array<{conversationId: string; text: string; messageId: string}> = [];
    const team = new TeamService({
      storage,
      profiles: new ProfileManager(storage, root),
      computers: new TeamComputerManager(),
      deliver: (input) => delivered.push(input),
    });
    const bot = team.create({name: "Maya", role: "Research lead", profileId: "default", avatar});
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(delivered.length, 1);
    assert.equal(team.require(bot.id).setupPending, true);
    assert.equal(team.require(bot.id).setupError, null);
    assert.deepEqual(team.pendingBotSetups().map((member) => member.id), [bot.id]);

    const cue = storage.listMessages(bot.conversationId)[0]!;
    assert.equal(isTeamBotSetupCue(cue.metadata), true);
    storage.updateMessage(cue.id, {metadata: {setupCue: true, deliveryError: "No model is available"}});
    assert.equal(team.require(bot.id).setupError, "No model is available");

    team.retrySetup(bot.id);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(delivered.length, 2);
    assert.equal(delivered[1]!.messageId, cue.id);
    assert.equal(team.require(bot.id).setupError, null);
    assert.equal(team.require(bot.id).setupPending, true);

    storage.appendMessage({id: "assistant-1", conversationId: bot.conversationId, runId: null, role: "assistant", content: "Hello!"});
    assert.equal(team.require(bot.id).setupPending, false);
    assert.deepEqual(team.pendingBotSetups(), []);
    await assert.rejects(async () => team.retrySetup(bot.id), /already completed/);

    // The user engaging first also settles the setup, as in Rakazo's focus prompt.
    const quiet = team.create({name: "Quiet", role: "", profileId: "default", avatar});
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(team.require(quiet.id).setupPending, true);
    storage.appendMessage({id: "user-1", conversationId: quiet.conversationId, runId: null, role: "user", content: "Hi there"});
    assert.equal(team.require(quiet.id).setupPending, false);
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("team_spawn lets a bot grow durable peers but not touch other bots", async () => {  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-spawn-tool-"));
  const storage = new SqliteStorage(path.join(root, "team.sqlite"));
  try {
    const profiles = new ProfileManager(storage, root);
    const delivered: string[] = [];
    const team = new TeamService({
      storage, profiles, computers: new TeamComputerManager(),
      deliver: ({conversationId}) => delivered.push(conversationId),
    });
    const tool = createTeamSpawnTool(team, {
      options: async () => ({profiles: profiles.snapshot().profiles}),
      spawn: async (request, parentBotId) => team.spawn(request, parentBotId),
      children: async (parentBotId) => team.children(parentBotId),
      updateSelf: async (parentBotId, request) => team.update(parentBotId, request),
      archive: async (parentBotId, confirmName, botId) => team.archiveSpawnedBot(parentBotId, confirmName, botId),
    });
    const context = (runId: string): AgentToolContext => ({
      runId, turn: 0, callId: "spawn", signal: new AbortController().signal,
      emitProgress: async () => {},
    });
    const maya = team.create({name: "Maya", role: "Research lead", profileId: "default", avatar});
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    storage.createRun({id: "run-maya", conversationId: maya.conversationId, model: "provider/model"});
    const mayaContext = context("run-maya");

    await assert.rejects(tool.execute({action: "spawn", name: "Scout"}, {...context("assistant-run")}), /only for Team bots/);
    const spawned = await tool.execute({action: "spawn", name: "Scout", role: "Helper", prompt: "Say hi"}, mayaContext);
    if (typeof spawned.content !== "string") assert.fail("Expected text spawn result");
    assert.match(spawned.content, /Created Scout/);
    const childId = (spawned.metadata as {memberId: string}).memberId;
    assert.equal(team.require(childId).parentBotId, maya.id);
    const repeated = await tool.execute({action: "spawn", name: "Scout", role: "Helper"}, mayaContext);
    assert.equal((repeated.metadata as {memberId: string}).memberId, childId);

    const listed = await tool.execute({action: "list"}, mayaContext);
    assert.match(String(listed.content), /Scout — Helper/);
    const renamed = await tool.execute({action: "update", role: "Night watch"}, mayaContext);
    assert.match(String(renamed.content), /Night watch/);
    assert.equal(team.require(maya.id).role, "Night watch");

    const linus = team.create({name: "Linus", role: "Builder", profileId: "default", avatar});
    storage.createRun({id: "run-linus", conversationId: linus.conversationId, model: "provider/model"});
    await assert.rejects(
      tool.execute({action: "archive", confirm_name: "Scout"}, context("run-linus")),
      /did not create/,
    );
    const archived = await tool.execute({action: "archive", confirm_name: "Scout"}, mayaContext);
    assert.match(String(archived.content), /Archived Scout/);
    assert.equal(team.bot(childId), null);
    assert.equal(delivered.filter((id) => id === maya.conversationId).length, 1);
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("agent messages carry an optional triage intent into the delivery", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-intent-"));
  const storage = new SqliteStorage(":memory:");
  try {
    const delivered: Array<{text: string; messageId: string}> = [];
    const team = new TeamService({
      storage,
      profiles: new ProfileManager(storage, root),
      computers: new TeamComputerManager(),
      deliver: ({text, messageId}) => delivered.push({text, messageId}),
    });
    const maya = team.create({name: "Maya", role: "Research lead", profileId: "default", avatar});
    const linus = team.create({name: "Linus", role: "Builder", profileId: "default", avatar});
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    storage.createRun({id: "run-maya", conversationId: maya.conversationId, model: "provider/model"});

    const requested = await team.sendFromRun("run-maya", linus.id, "Please build the parser.", [], "request");
    assert.equal(relayIntent(requested.metadata), "request");
    assert.equal(agentRelayInferenceText(requested), "Request from Maya (Research lead):\n\nPlease build the parser.");
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.ok(delivered.some((item) => item.messageId === requested.id && item.text.startsWith("Request from Maya")));

    const plain = await team.send({fromMemberId: maya.id, to: linus.id, text: "Heads up."});
    assert.equal(relayIntent(plain.metadata), undefined);
    assert.equal(agentRelayInferenceText(plain), "Message from Maya (Research lead):\n\nHeads up.");

    await assert.rejects(team.send({fromMemberId: maya.id, to: linus.id, text: "Nope.", intent: "urgent"} as never), /intent/);

    const tool = createAgentMessageTool(team);
    const toolContext: AgentToolContext = {runId: "run-maya", turn: 0, callId: "mail", signal: new AbortController().signal, emitProgress: async () => {}};
    const sent = await tool.execute({action: "send", to: linus.name, message: "Done.", intent: "result"}, toolContext);
    assert.equal((sent.metadata as {intent: string}).intent, "result");
    await assert.rejects(tool.execute({action: "send", to: linus.name, message: "Done.", intent: "urgent"}, toolContext), /intent/);
  } finally { storage.close(); await rm(root, {recursive: true, force: true}); }
});

test("a failed peer-message wakeup is re-armed without duplicating the row", async () => {  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-relay-retry-"));
  const storage = new SqliteStorage(path.join(root, "team.sqlite"));
  try {
    const delivered: Array<{conversationId: string; text: string; messageId: string}> = [];
    const team = new TeamService({
      storage,
      profiles: new ProfileManager(storage, root),
      computers: new TeamComputerManager(),
      deliver: (input) => delivered.push(input),
    });
    const maya = team.create({name: "Maya", role: "Research lead", profileId: "default", avatar});
    const linus = team.create({name: "Linus", role: "Builder", profileId: "default", avatar});
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    // Both introductions land, so setup is settled before the peer mail.
    for (const member of [maya, linus]) {
      storage.appendMessage({id: `hello-${member.id}`, conversationId: member.conversationId, runId: null, role: "assistant", content: "Hello!"});
    }
    storage.createRun({id: "run-maya", conversationId: maya.conversationId, model: "provider/model"});
    const relay = await team.sendFromRun("run-maya", linus.id, "Please build the parser.");
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    // Linus's deliveries are its setup cue plus this peer wakeup.
    const wakeups = delivered.filter((item) => item.conversationId === linus.conversationId);
    assert.equal(wakeups.length, 2);
    assert.equal(wakeups[1]!.messageId, relay.id);

    // The wakeup fails (usually "no model available") and is recorded on the row.
    storage.updateMessage(relay.id, {metadata: {...relay.metadata as Record<string, never>, deliveryError: "No model is available"}});
    assert.equal(team.retryRelayDelivery(linus.conversationId), true);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const retried = delivered.filter((item) => item.conversationId === linus.conversationId);
    assert.equal(retried.length, 3);
    assert.equal(retried[2]!.messageId, relay.id);
    assert.equal(storage.listMessages(linus.conversationId).filter((message) => relayOrigin(message.metadata)).length, 1);

    // Once the bot replies, there is nothing left to re-arm.
    storage.appendMessage({id: "linus-reply", conversationId: linus.conversationId, runId: null, role: "assistant", content: "On it."});
    assert.equal(team.retryRelayDelivery(linus.conversationId), false);

    // A bot whose setup never ran keeps its introduction first: relays wait.
    const quiet = team.create({name: "Quiet", role: "", profileId: "default", avatar});
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(team.require(quiet.id).setupPending, true);
    const parked = await team.send({fromMemberId: maya.id, to: quiet.id, text: "Parked peer mail."});
    assert.equal(relayOrigin(parked.metadata)?.name, "Maya");
    storage.updateMessage(parked.id, {metadata: {...parked.metadata as Record<string, never>, deliveryError: "No model is available"}});
    assert.equal(team.retryRelayDelivery(quiet.conversationId), false);
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});

test("ensureSetup posts a first turn once for legacy bots with empty conversations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-team-ensure-"));
  const storage = new SqliteStorage(path.join(root, "team.sqlite"));
  try {
    const delivered: Array<{conversationId: string; messageId: string}> = [];
    const team = new TeamService({
      storage,
      profiles: new ProfileManager(storage, root),
      computers: new TeamComputerManager(),
      deliver: ({conversationId, messageId}) => delivered.push({conversationId, messageId}),
    });
    const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));
    const legacy = team.create({name: "Mark", role: "Job Seeker", profileId: "default", avatar});
    await flush();
    assert.equal(delivered.length, 1);
    // Simulate a pre-cue bot: no pinned cue and a fully empty conversation.
    const conversation = storage.getConversation(legacy.conversationId)!;
    const metadata = JSON.parse(JSON.stringify(conversation.metadata));
    delete metadata.bot.setupMessageId;
    storage.updateConversation(conversation.id, {metadata});
    storage.deleteMessagesAfter(legacy.conversationId, 0);
    assert.equal(storage.listMessages(legacy.conversationId).length, 0);

    const healed = team.ensureSetup(legacy.id);
    // The conversation-open path immediately re-arms a pending setup. The cue
    // delivery queued by ensureSetup must win without starting a second run.
    team.retrySetup(legacy.id);
    await flush();
    assert.equal(healed.setupPending, true);
    const cue = storage.listMessages(legacy.conversationId);
    assert.equal(cue.length, 1);
    assert.equal(isTeamBotSetupCue(cue[0]!.metadata), true);
    assert.equal(delivered.length, 2);
    assert.equal(delivered[1]!.messageId, cue[0]!.id);

    // A second call never duplicates the first turn.
    team.ensureSetup(legacy.id);
    await flush();
    assert.equal(storage.listMessages(legacy.conversationId).length, 1);
    assert.equal(delivered.length, 2);

    // Bots with history but no pinned cue are left alone.
    const historian = team.create({name: "Nora", role: "Librarian", profileId: "default", avatar});
    await flush();
    const historianConversation = storage.getConversation(historian.conversationId)!;
    const historianMetadata = JSON.parse(JSON.stringify(historianConversation.metadata));
    delete historianMetadata.bot.setupMessageId;
    storage.updateConversation(historianConversation.id, {metadata: historianMetadata});
    assert.equal(team.ensureSetup(historian.id).id, historian.id);
    await flush();
    assert.ok(storage.listMessages(historian.conversationId).length >= 1);
    assert.equal(
      storage.listMessages(historian.conversationId).filter((message) => isTeamBotSetupCue(message.metadata)).length,
      1,
      "the original cue is not duplicated",
    );
  } finally {
    storage.close();
    await rm(root, {recursive: true, force: true});
  }
});
