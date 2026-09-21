import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {ImapFlow} from "imapflow";
import {HOST_PAIRING_CODE, type AgentMessageOriginDto} from "@polymux/protocol";
import type {JsonValue} from "@polymux/storage";
import {HeadlessHostRuntime, TeamHostClient} from "../src/index.js";

test("headless runtime serves the Desktop Host protocol without Electron", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-headless-host-"));
  const runtime = new HeadlessHostRuntime({
    dataDirectory: directory,
    listen: "127.0.0.1",
    port: 0,
    adminSecret: "local-cli-secret",
  });
  try {
    const snapshot = await runtime.start();
    assert.equal(snapshot.state, "listening");
    assert.ok(snapshot.endpoint);
    assert.match(snapshot.pairingCode ?? "", HOST_PAIRING_CODE);

    const cli = new TeamHostClient(snapshot.endpoint!, "local-cli-secret");
    assert.deepEqual(await cli.call("team.list"), []);
    assert.deepEqual(
      (await cli.call<Array<{id: string; teamEligible: boolean}>>("team.profiles"))
        .map(({id, teamEligible}) => ({id, teamEligible})),
      [{id: "default", teamEligible: true}],
    );
    assert.deepEqual(await cli.call('runs.activeAll'), []);
    const assistant = await cli.call<{id: string}>('assistant.ensure', ['remote-assistant', 'Remote Assistant']);
    assert.equal(assistant.id, 'remote-assistant');
    await cli.call('conversations.rename', ['remote-assistant', 'Renamed Assistant']);
    assert.ok((await cli.call<Array<{title:string}>>('conversations.list')).some(chat => chat.title === 'Renamed Assistant'));
    assert.deepEqual(await cli.call('conversations.messages', ['remote-assistant']), []);
    await cli.call('goals.execute', [{conversationId: 'remote-assistant', action: 'create', objective: 'Test goal'}]);
    assert.equal((await cli.call<{objective: string}>('goals.get', ['remote-assistant'])).objective, 'Test goal');
    await cli.call('goals.execute', [{conversationId: 'remote-assistant', action: 'pause'}]);
    assert.equal((await cli.call<{status: string}>('goals.get', ['remote-assistant'])).status, 'paused');
    await cli.call('goals.execute', [{conversationId: 'remote-assistant', action: 'clear'}]);
    const copy = await cli.call<{id:string}>('conversations.duplicate', ['remote-assistant']);
    assert.notEqual(copy.id, 'remote-assistant');
    const first = runtime.storage.appendMessage({id: "first", conversationId: assistant.id, role: "user", content: "Keep"});
    runtime.storage.appendMessage({id: "later", conversationId: assistant.id, role: "user", content: "Exclude"});
    const bounded = await cli.call<{id: string}>("conversations.duplicate", [assistant.id, first.id]);
    assert.deepEqual(runtime.storage.listMessages(bounded.id).map((message) => message.content), ["Keep"]);
    assert.deepEqual(runtime.storage.getConversation(bounded.id)?.metadata, {deviceAssistant: true});
    await assert.rejects(cli.call("conversations.duplicate", [assistant.id, 17]), /message id/);
    const origin: AgentMessageOriginDto = {kind: "assistant", memberId: null, conversationId: "remote-source", name: "Peer", role: null, avatar: null, traceId: "trace", hop: -1, automatic: false};
    await assert.rejects(cli.call("team.sendExternal", [{to: assistant.id, text: "Rejected"}, origin as unknown as JsonValue]), /hop/);
    assert.equal(runtime.storage.listMessages(assistant.id).length, 2);
    await cli.call('conversations.archive', [copy.id]);
    assert.equal((await cli.call<Array<{id: string}>>('conversations.list')).some((chat) => chat.id === copy.id), false);
    assert.ok((await cli.call<Array<{id: string}>>('conversations.listArchived')).some((chat) => chat.id === copy.id));
    await cli.call('conversations.unarchive', [copy.id]);
    assert.ok((await cli.call<Array<{id: string}>>('conversations.list')).some((chat) => chat.id === copy.id));
    assert.equal(await cli.call('conversations.remove', [copy.id]), true);
    assert.equal(await cli.call('conversations.remove', ['remote-assistant']), true);
    const refreshed = await cli.beginPairing();
    assert.match(refreshed.pairingCode ?? "", HOST_PAIRING_CODE);
  } finally {
    await runtime.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("headless Host provisions and removes a real isolated Team computer", {
  skip: process.env.POLYMUX_LIVE_CONTAINER !== "1",
  timeout: 180_000,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-headless-container-"));
  const runtime = new HeadlessHostRuntime({
    dataDirectory: directory,
    listen: "127.0.0.1",
    port: 0,
    adminSecret: "local-container-test",
    beginPairing: false,
  });
  let memberId = "";
  try {
    const member = runtime.team.create({
      name: "Container Test",
      role: "Verify the isolated computer",
      profileId: "default",
      avatar: {shape: "circle", color: "#5271ff"},
      laptopAccess: "off",
    });
    memberId = member.id;
    const started = await runtime.team.startComputer(member.id);
    assert.equal(started.computer.state, "running", started.computer.detail ?? undefined);
    assert.match(started.computer.provider, /^(podman|docker)$/);
    assert.equal(started.computer.network, "none");
    assert.equal(await runtime.team.remove(member.id), true);
    memberId = "";
  } finally {
    if (memberId) await runtime.team.remove(memberId).catch(() => false);
    await runtime.close();
    await rm(directory, {recursive: true, force: true});
  }
});

// Vault RPCs are covered against the built bundle in
// apps/cli/test/integration.test.ts: kdbxweb's CJS namespace does not survive
// tsx's ESM loader (the package's own test suite fails the same way there),
// while the esbuild bundle the CLI ships serves the vault fine.
test("headless runtime manages password mailboxes without macOS keychain", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-headless-mail-"));
  const runtime = new HeadlessHostRuntime({
    dataDirectory: directory,
    listen: "127.0.0.1",
    port: 0,
    adminSecret: "local-mail-test",
    beginPairing: false,
  });
  try {
    const snapshot = await runtime.start();
    const cli = new TeamHostClient(snapshot.endpoint!, "local-mail-test");
    assert.deepEqual(await cli.call("hub.emailAccounts"), []);
    await assert.rejects(
      cli.call("hub.saveEmailAccount", [{id: "Bad id!", email: "x", preset: "custom"}]),
      /Account name/,
    );
    const account = {
      id: "local",
      email: "user@example.com",
      preset: "custom",
      imapHost: "127.0.0.1",
      imapPort: 10943,
      imapEncryption: "tls",
      smtpHost: "127.0.0.1",
      smtpPort: 10025,
      smtpEncryption: "none",
      password: "mail-secret",
    };
    const saved = await cli.call<Array<{id: string; email: string}>>("hub.saveEmailAccount", [account]);
    assert.deepEqual(saved.map((entry) => entry.id), ["local"]);
    // The sealed secrets file round-trips the password without the OS keychain.
    await cli.call("hub.removeEmailAccount", ["local"]);
    assert.deepEqual(await cli.call("hub.emailAccounts"), []);
  } finally {
    await runtime.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("headless runtime waits for pooled mailbox connections to close", async (t): Promise<void> => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-headless-mail-close-"));
  let logoutStarted = false;
  let releaseLogout!: () => void;
  const logoutReleased = new Promise<void>((resolve) => { releaseLogout = resolve; });
  t.mock.method(ImapFlow.prototype, "connect", async () => {});
  t.mock.method(ImapFlow.prototype, "list", async (): Promise<[]> => []);
  t.mock.method(ImapFlow.prototype, "logout", async () => {
    logoutStarted = true;
    await logoutReleased;
  });
  const runtime = new HeadlessHostRuntime({
    dataDirectory: directory,
    listen: "127.0.0.1",
    port: 0,
    adminSecret: "local-mail-close-test",
    beginPairing: false,
  });
  let closing: Promise<void> | undefined;
  try {
    const snapshot = await runtime.start();
    const cli = new TeamHostClient(snapshot.endpoint!, "local-mail-close-test");
    await cli.call("hub.saveEmailAccount", [{
      id: "local",
      email: "user@example.com",
      preset: "custom",
      imapHost: "127.0.0.1",
      imapPort: 10943,
      imapEncryption: "tls",
      smtpHost: "127.0.0.1",
      smtpPort: 10025,
      smtpEncryption: "none",
      password: "mail-secret",
    }]);
    const tested = await cli.call<{status: string}>("hub.testEmailAccount", ["local"]);
    assert.equal(tested.status, "ok");
    assert.equal(logoutStarted, false, "Testing should retain the connection for reuse");
    let closed = false;
    closing = runtime.close().then(() => { closed = true; });
    // Shutdown drains any status read already in flight before it tears the
    // mailbox down, so wait for the logout rather than counting event-loop
    // turns. Both properties still have to hold: it starts, and it is awaited.
    const deadline = Date.now() + 5_000;
    while (!logoutStarted && Date.now() < deadline)
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    assert.equal(logoutStarted, true, "Shutdown should close the pooled mailbox connection");
    assert.equal(closed, false, "Shutdown must wait for mailbox logout to finish");
    releaseLogout();
    await closing;
    assert.equal(closed, true);
  } finally {
    releaseLogout();
    await (closing ?? runtime.close());
    await rm(directory, {recursive: true, force: true});
  }
});

test('workspace RPCs persist bot schedules, preserve task outcomes and enforce Host authentication', async () => {  const directory = await mkdtemp(path.join(tmpdir(), 'polymux-workspace-host-'));
  const options = {dataDirectory: directory, listen: '127.0.0.1', port: 0, adminSecret: 'workspace-test', beginPairing: false};
  let runtime = new HeadlessHostRuntime(options);
  try {
    let snapshot = await runtime.start();
    let cli = new TeamHostClient(snapshot.endpoint!, options.adminSecret);
    const bot = await cli.call<{id: string; conversationId: string}>('team.create', [{name: 'Research', role: 'Check sources', profileId: 'default', avatar: {shape: 'circle', color: '#61afef'}}]);
    const assistant = await cli.call<{id: string}>('assistant.ensure', ['settings-test', 'Assistant']);
    const models = await cli.call<Array<{provider: string; id: string}>>('models.list');
    assert.ok(models.length >= 2);
    const first = `${models[0].provider}/${models[0].id}`;
    const second = `${models[1].provider}/${models[1].id}`;
    await cli.call('runs.configure', [assistant.id, {model: first, reasoning: 'medium'}]);
    await cli.call('runs.configure', [bot.conversationId, {model: second, reasoning: 'low'}]);
    const unchanged = await cli.call<{model: string; reasoning: string}>('runs.configuration', [assistant.id]);
    assert.equal(unchanged.model, first);
    assert.equal(unchanged.reasoning, 'medium');
    const botConfig = await cli.call<{model: string; reasoning: string}>('runs.configuration', [bot.conversationId]);
    assert.equal(botConfig.model, second);
    assert.equal(botConfig.reasoning, 'low');
    const input = {title: 'Check sources', prompt: 'Find references', botId: bot.id, frequency: {kind: 'once', at: Date.now() + 86_400_000}};
    const schedule = await cli.call<{id: string}>('schedules.create', [input]);
    await cli.call('schedules.update', [schedule.id, {status: 'paused'}]);
    await assert.rejects(cli.call('schedules.create', [{...input, botId: 'missing'}]), /not found|Unknown/i);
    await assert.rejects(cli.call('schedules.create', [{...input, frequency: {kind: 'cron', expression: 'invalid'}}]), /cron|field/i);
    await assert.rejects(new TeamHostClient(snapshot.endpoint!, 'wrong-secret').call('schedules.list'), /authori|paired/i);
    runtime.storage.createRun({id: 'failed', conversationId: bot.conversationId});
    runtime.storage.updateRun('failed', {status: 'failed', error: {message: 'Fixture failure'}});
    const tasks = await cli.call<Array<{id: string; status: string; error: string}>>('tasks.snapshot');
    assert.equal(tasks.find(task => task.id === 'failed')?.status, 'failed');
    assert.equal(tasks.find(task => task.id === 'failed')?.error, 'Fixture failure');
    const usage = await cli.call<{scope: string; totalChats: number}>('usage.get', [{scope: 'assistant'}]);
    assert.equal(usage.scope, 'assistant');
    await runtime.close();
    runtime = new HeadlessHostRuntime(options);
    snapshot = await runtime.start();
    cli = new TeamHostClient(snapshot.endpoint!, options.adminSecret);
    const restored = await cli.call<Array<{id: string; botId: string; status: string}>>('schedules.list');
    assert.deepEqual(restored.map(({id, botId, status}) => ({id, botId, status})), [{id: schedule.id, botId: bot.id, status: 'paused'}]);
    await cli.call('schedules.remove', [schedule.id]);
    assert.deepEqual(await cli.call('schedules.list'), []);
  } finally {
    await runtime.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('removing a bot retires its schedules so they never fire for a missing bot', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'polymux-host-retire-'));
  const options = {dataDirectory: directory, listen: '127.0.0.1', port: 0, adminSecret: 'retire-test', beginPairing: false};
  const runtime = new HeadlessHostRuntime(options);
  try {
    const snapshot = await runtime.start();
    const cli = new TeamHostClient(snapshot.endpoint!, options.adminSecret);
    const avatar = {shape: 'circle', color: '#61afef'};
    const maya = await cli.call<{id: string}>('team.create', [{name: 'Maya', role: 'Research', profileId: 'default', avatar}]);
    const linus = await cli.call<{id: string}>('team.create', [{name: 'Linus', role: 'Builder', profileId: 'default', avatar}]);
    const input = {title: 'Check sources', prompt: 'Find references', frequency: {kind: 'once', at: Date.now() + 86_400_000}};
    const first = await cli.call<{id: string}>('schedules.create', [{...input, botId: maya.id}]);
    const second = await cli.call<{id: string}>('schedules.create', [{...input, botId: linus.id}]);
    const spawned = await cli.call<{id: string}>('team.spawn', [{name: 'Scout', role: 'Helper', profileId: 'default', avatar}, maya.id]);
    const third = await cli.call<{id: string}>('schedules.create', [{...input, botId: spawned.id}]);
    assert.deepEqual(
      (await cli.call<Array<{id: string}>>('schedules.list')).map((item) => item.id).sort(),
      [first.id, second.id, third.id].sort(),
    );
    // Archiving a spawned peer retires only its schedules.
    await cli.call('team.archiveSpawn', [maya.id, 'Scout']);
    assert.deepEqual(
      (await cli.call<Array<{id: string}>>('schedules.list')).map((item) => item.id).sort(),
      [first.id, second.id].sort(),
    );
    // Deleting the bot retires the rest of its schedules with it.
    assert.equal(await cli.call('team.remove', [maya.id]), true);
    assert.deepEqual(
      (await cli.call<Array<{id: string}>>('schedules.list')).map((item) => item.id),
      [second.id],
    );
  } finally {
    await runtime.close();
    await rm(directory, {recursive: true, force: true});
  }
});
