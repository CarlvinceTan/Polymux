import assert from 'node:assert/strict';
import test from 'node:test';
import {stripTerminalSequences, visibleWidth} from '@earendil-works/pi-tui';
import type {BotDto, JsonValue} from '@polymux/protocol';
import {browseBots, botChoice} from '../src/tui/bots.js';
import {browseHub} from '../src/tui/hub.js';
import {browseVault} from '../src/tui/vault.js';
import {browseSchedules} from '../src/tui/schedules.js';
import {WorkspaceList} from '../src/tui/workspace-list.js';
import type {WorkspaceUi} from '../src/tui/workspace-ui.js';

const bot: BotDto = {id: 'bot-a', conversationId: 'chat-a', name: 'Research bot', role: 'Find references',
  profileId: 'default', profileName: 'Default', hostId: 'host', hostName: 'Test Host',
  avatar: {shape: 'circle', color: '#61afef'}, laptopAccess: 'ask', status: 'working',
  preview: 'Researching', updatedAt: '', unread: true,
  computer: {provider: 'unavailable', state: 'stopped', detail: null, persistent: true, network: 'none'}};

function fixture(choices: Array<string | undefined>, prompts: Array<string | undefined>, handler: (method: string, args: JsonValue[]) => unknown) {
  const calls: Array<{method: string; args: JsonValue[]}> = [];
  const ui: WorkspaceUi = {
    client: {async call<T>(method: string, args: JsonValue[] = []) {calls.push({method, args}); return handler(method, args) as T;}},
    async pick(_title, items) {const choice = choices.shift(); if (choice) assert.ok(items.some(i => i.value === choice), `Missing choice ${choice}`); return choice;},
    async prompt() {return prompts.shift();}, async show() {}, async openChat() {}, notify() {},
  };
  return {ui, calls};
}

test('bot actions edit only the selected bot and opening it marks the right conversation read', async () => {
  const {ui, calls} = fixture(['bot-a', 'edit', 'role', 'chat'], ['New instructions'], method => method === 'team.list' ? [bot, {...bot, id: 'bot-b'}] : null);
  let opened = '';
  ui.openChat = async chat => {opened = chat.id;};
  await browseBots(ui);
  assert.equal(opened, 'chat-a');
  assert.deepEqual(calls.find(c => c.method === 'team.update')?.args, ['bot-a', {role: 'New instructions'}]);
  assert.deepEqual(calls.find(c => c.method === 'team.markRead')?.args, ['bot-a']);
});

test('bot creation cancellation and delete cancellation never mutate the Host', async () => {
  for (const [choices, prompts] of [
    [['+', undefined], ['Name', undefined]],
    [['bot-a', 'remove', 'cancel', undefined, undefined], []],
  ] as Array<[Array<string | undefined>, Array<string | undefined>]>) {
    const {ui, calls} = fixture(choices, prompts, method => method === 'team.list' ? [bot] : null);
    await browseBots(ui);
    assert.ok(calls.every(c => c.method === 'team.list'));
  }
});

test('Midas-style lists preserve status alignment and contain long unicode/control text', () => {
  const items = [botChoice(bot), {...botChoice(bot), value: 'b', label: 'Very long 项目 title '.repeat(30), description: '\x1b[2J\nInjected', status: 'Needs device'}];
  const list = new WorkspaceList(items);
  for (const width of [1, 2, 12, 30, 90]) {
    const rows = list.render(width);
    assert.ok(rows.every(row => visibleWidth(row) <= width));
    assert.ok(rows.every(row => !row.includes('\x1b[2J') && !row.includes('\n')));
  }
  const rows = list.render(90).map(stripTerminalSequences);
  assert.equal(rows[0].length, 90);
  assert.match(rows[0], /Working$/);
  assert.match(rows[1], /Needs device$/);
});

test('Hub uses cursor pagination without marking read or sending from cancelled drafts', async () => {
  const {ui, calls} = fixture(['room', 'more', 'compose', 'cancel', undefined, undefined], ['Draft'], (method, args) => {
    if (method === 'hub.chats') return [{id: 'room', name: 'Room', platform: 'test'}];
    if (method === 'hub.messages') return {messages: [], nextBefore: args.length > 2 ? null : 'cursor'};
    throw new Error(method);
  });
  await browseHub(ui);
  assert.ok(calls.some(c => c.method === 'hub.messages' && c.args[2] === 'cursor'));
  assert.ok(!calls.some(c => c.method === 'hub.markRead' || c.method === 'hub.send'));
});

test('editing one Vault field retains public fields and never fetches passwords', async () => {
  const item = {id: 'entry', title: 'Site', username: 'name', url: 'https://example.test', notes: 'Keep notes', groupName: 'Group'};
  const {ui, calls} = fixture(['entry', 'edit', 'title', undefined], ['Renamed'], method => {
    if (method === 'vault.status') return {exists: true, unlocked: true};
    if (method === 'vault.list') return {items: [item], trash: []};
    if (method === 'vault.save') return item;
    throw new Error(method);
  });
  await browseVault(ui);
  assert.deepEqual(calls.find(c => c.method === 'vault.save')?.args, [{...item, title: 'Renamed'}]);
});

test('bot schedule creation retains its owner and encodes weekday names correctly', async () => {
  const {ui, calls} = fixture(['+', 'weekly', undefined], ['Morning check', 'Check references', '09:15', 'mon,wed,fri'], method => {
    if (method === 'schedules.list') return [];
    if (method === 'team.list') return [bot];
    if (method === 'schedules.create') return {};
    throw new Error(method);
  });
  await browseSchedules(ui, bot.id);
  const input = calls.find(c => c.method === 'schedules.create')?.args[0] as any;
  assert.equal(input.botId, bot.id);
  assert.deepEqual(input.frequency.days, [1, 3, 5]);
});

test('yearly schedules translate calendar months and reject invalid clock times before saving', async () => {
  const handler = (method: string) => method === 'schedules.list' ? [] : method === 'team.list' ? [bot] : {};
  const {ui, calls} = fixture(['+', 'yearly', undefined], ['Anniversary', 'Check in', '09:15', '15', '9'], handler);
  await browseSchedules(ui, bot.id);
  const input = calls.find(c => c.method === 'schedules.create')?.args[0] as any;
  assert.equal(input.frequency.month, 8);
  for (const time of ['25:00', '12:61', 'tomorrow']) {
    const bad = fixture(['+', 'daily'], ['Title', 'Prompt', time], handler);
    await assert.rejects(browseSchedules(bad.ui, bot.id), /00:00 to 23:59/);
    assert.ok(!bad.calls.some(c => c.method === 'schedules.create'));
  }
});

test('bot device policy editing preserves overrides for other devices', async () => {
  const {ui, calls} = fixture(['bot-a', 'access', 'laptop', 'off', undefined, undefined], [], method => {
    if (method === 'team.list') return [{...bot, deviceAccess: {server: 'ask'}}];
    if (method === 'team.hosts') return [{hostId: 'laptop', deviceName: 'Laptop'}];
    if (method === 'team.update') return {};
    throw new Error(method);
  });
  await browseBots(ui);
  assert.deepEqual(calls.find(c => c.method === 'team.update')?.args, ['bot-a', {deviceAccess: {server: 'ask', laptop: 'off'}}]);
});

test('Polymux model controls configure the selected bot conversation', async () => {
  const {ui, calls} = fixture(['bot-a', 'agent', 'options', 'reasoning', 'low', undefined, undefined], [], method => {
    if (method === 'team.list') return [bot];
    if (method === 'runs.configuration') return {model: 'test/model', reasoning: 'medium'};
    if (method === 'runs.configure') return {};
    throw new Error(method);
  });
  await browseBots(ui);
  assert.deepEqual(calls.find(c => c.method === 'runs.configure')?.args, ['chat-a', {reasoning: 'low'}]);
});

test('device approval requires an explicit matching choice and cancelled disconnect preserves access', async () => {
  const {browseDevices} = await import('../src/tui/devices.js');
  const {ui} = fixture(['approval:pending', undefined, 'peer', 'cancel', undefined], [], () => null);
  const requests: unknown[] = [];
  await browseDevices(ui, async request => {
    requests.push(request);
    return {approvals: [{id: 'pending', deviceName: 'Laptop', choices: ['12', '34', '56'], expiresAt: 'later'}], outgoing: null,
      connectedDevices: [{deviceId: 'peer', deviceName: 'Server', pairedAt: 'earlier'}]};
  });
  assert.ok(requests.every((r: any) => r.action === 'state'));
});
